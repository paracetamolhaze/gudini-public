# Сторож сайта Гудини: следит, чтобы сайт отвечал, и сам чинит известные поломки (запускается из start-gudini.ps1).
#
# Почему он нужен (6.11): весь Docker лежит на жёстком диске D: (HDD Seagate 1 ТБ, D:\DockerDesktop). После каждой
# загрузки ПК стартуют все контейнеры разом, три браузера (X, TikTok, Instagram) читают свои профили, диск захлёбывается
# (занят на 1000–3000 % при 1–5 МБ/с), и сайт висит на «Starting…». Владелец каждый день просил поднять его вручную.
#
# Что делает (раз в минуту; пока сайт не отвечает — каждые 15 с):
#  1. Контейнер сайта запустился меньше 15 минут назад, а сайт не отвечает — браузеры ставятся на паузу (docker pause),
#     чтобы диск достался сайту; как только сайт ответил — пауза снимается. Дольше 20 минут подряд пауза не держится.
#  2. Сайт не отвечает 3 минуты подряд, а контейнер запущен больше 4 минут назад — перезапуск контейнера (браузеры на
#     паузе). Не чаще раза в 10 минут; три перезапуска подряд не помогли — дело не в диске, следующий через час.
#  3. У контейнера сайта нет сети (было 20.10) — подключить к gudini_default.
#  4. Сайт на 3000 отвечает, а через Caddy (443) нет 3 проверки подряд — перезапуск Caddy (Docker оставлял 443 на
#     старом IP Caddy, было 02.10). Не чаще раза в 10 минут.
#  5. Сам Docker не отвечает (10.11: Microsoft Store обновил WSL, виртуалка остановилась, сайт лежал, пока владелец не
#     нажал Restart) — «docker desktop restart». Остановлен или завис — через 3 минуты; ещё запускается — ждём 12 минут;
#     Docker Desktop закрыт совсем — запускаем через 10 минут. Не чаще раза в 20 минут.
#  6. Сайт внутри контейнера жив, а порт 3000 на компьютере мёртв (после перезапуска Docker пробросы остаются
#     пустыми) — перезапуск контейнера сразу, без трёх минут ожидания. То же для Threads на 8600.
# Остановленный вручную контейнер сайта сторож не трогает. Журнал — data\site-watchdog.log.
# Файл в UTF-8 с BOM: иначе Windows PowerShell 5.1 прочтёт русские строки как ANSI.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "data\site-watchdog.log"
$site = "gudini-site"
$browsers = @("gudini-x-browser", "gudini-tiktok-browser", "gudini-ig-browser")
$domain = "your-site.example"
try {
  $line = Get-Content (Join-Path $root ".env") -ErrorAction Stop | Where-Object { $_ -match '^DOMAIN=' } | Select-Object -First 1
  if ($line) { $domain = ($line -replace '^DOMAIN=', '').Trim('"', ' ') }
} catch {}

function Write-Log([string]$text) {
  $l = "{0} {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"), $text
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null
  [System.IO.File]::AppendAllText($log, $l + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
}

function Get-Code([string[]]$curlArgs) {
  $out = & curl.exe -s -o NUL -w "%{http_code}" --max-time 20 @curlArgs 2>$null
  if ($out) { return [string]$out } else { return "000" }
}
function Test-Site { return (Get-Code @("http://127.0.0.1:3000/login")) -match '^(2|3)' }
function Test-Caddy { return (Get-Code @("-k", "--resolve", "${domain}:443:127.0.0.1", "https://$domain/login")) -match '^(2|3)' }

# docker с пределом по времени: при лежащем движке обычный вызов может висеть минутами
function Invoke-Docker([string]$arguments, [int]$seconds = 20) {
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "docker"
    $psi.Arguments = $arguments
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $outTask = $p.StandardOutput.ReadToEndAsync()
    $null = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($seconds * 1000)) { try { $p.Kill() } catch {}; return $null }
    if ($p.ExitCode -ne 0) { return $null }
    return ([string]$outTask.Result).Trim()
  } catch { return $null }
}
function Test-Engine { return [bool](Invoke-Docker 'version --format "{{.Server.Version}}"') }
# что говорит о себе Docker Desktop: running / starting / stopped / …; absent — программа закрыта
function Get-DesktopStatus {
  if (-not (Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue)) { return "absent" }
  $j = Invoke-Docker 'desktop status --format json' 15
  if (-not $j) { return "unknown" }
  try { return ([string]($j | ConvertFrom-Json).Status).ToLower() } catch { return "unknown" }
}
# отвечает ли сайт внутри своего контейнера (мимо проброса порта на компьютер)
function Test-SiteInside {
  $js = "fetch('http://127.0.0.1:3000/login',{signal:AbortSignal.timeout(15000)}).then(r=>process.exit(r.status<400?0:1)).catch(()=>process.exit(1))"
  return ($null -ne (Invoke-Docker "exec $site node -e `"$js`"" 25))
}
function Get-ContainerAge([string]$name) {
  $raw = Invoke-Docker "inspect -f `"{{.State.Running}}|{{.State.StartedAt}}`" $name"
  if (-not $raw) { return -1 }
  $p = $raw.Split('|')
  if ($p[0] -ne "true") { return -1 }
  try { return ((Get-Date).ToUniversalTime() - [DateTime]::Parse($p[1]).ToUniversalTime()).TotalMinutes } catch { return -1 }
}

# состояние контейнера сайта: работает ли, когда стартовал (UTC), сколько у него сетей
function Get-SiteState {
  $raw = & docker inspect -f "{{.State.Running}}|{{.State.StartedAt}}|{{len .NetworkSettings.Networks}}" $site 2>$null
  if (-not $raw) { return $null }
  $p = ([string]$raw).Split('|')
  $started = [DateTime]::MinValue
  try { $started = [DateTime]::Parse($p[1]).ToUniversalTime() } catch {}
  return @{ Running = ($p[0] -eq "true"); Started = $started; Networks = [int]$p[2] }
}

$script:pausedByUs = @()
$script:pausedAt = $null
function Suspend-Browsers([string]$why) {
  if ($script:pausedByUs.Count) { return }
  $toPause = @()
  foreach ($b in $browsers) {
    $st = & docker inspect -f "{{.State.Running}}|{{.State.Paused}}" $b 2>$null
    if ($st -eq "true|false") { $toPause += $b }
  }
  if (-not $toPause.Count) { return }
  & docker pause @toPause 2>$null | Out-Null
  $script:pausedByUs = $toPause
  $script:pausedAt = Get-Date
  Write-Log "браузеры на паузе ($($toPause -join ', ')): $why"
}
function Resume-Browsers([string]$why) {
  if (-not $script:pausedByUs.Count) { return }
  & docker unpause @($script:pausedByUs) 2>$null | Out-Null
  Write-Log "браузеры снова работают: $why"
  $script:pausedByUs = @()
  $script:pausedAt = $null
}

$lastRestart = [DateTime]::MinValue
$restartsInRow = 0
$lastCaddy = [DateTime]::MinValue
$failSince = $null
$caddyFails = 0
$wasDown = $false
$engineDownSince = $null
$lastEngineFix = [DateTime]::MinValue
$lastPortFix = [DateTime]::MinValue
$threadsFails = 0
$lastThreadsFix = [DateTime]::MinValue
Write-Log "сторож запущен (домен $domain)"

while ($true) {
  $sleep = 60
  try {
    $engineOk = Test-Engine
    if (-not $engineOk) {
      $now = Get-Date
      if (-not $engineDownSince) { $engineDownSince = $now; Write-Log "Docker не отвечает" }
      $status = Get-DesktopStatus
      $wait = 3
      if ($status -eq "starting") { $wait = 12 } elseif ($status -eq "absent") { $wait = 10 }
      $down = ($now - $engineDownSince).TotalMinutes
      if ($down -ge $wait -and ($now - $lastEngineFix).TotalMinutes -ge 20) {
        $verb = "restart"
        if ($status -eq "absent") { $verb = "start" }
        Write-Log ("Docker не отвечает {0:N0} мин (состояние: {1}) — docker desktop {2}" -f $down, $status, $verb)
        Start-Process -FilePath "docker" -ArgumentList "desktop", $verb -WindowStyle Hidden
        $lastEngineFix = Get-Date
      }
      $sleep = 30
    } elseif ($engineDownSince) {
      Write-Log ("Docker снова отвечает (молчал {0:N0} мин)" -f ((Get-Date) - $engineDownSince).TotalMinutes)
      $engineDownSince = $null
      # после перезапуска движка никто не на паузе, а проверки начинаем с чистого листа
      $script:pausedByUs = @()
      $script:pausedAt = $null
      $failSince = $null
      $threadsFails = 0
    }
    $st = $null
    if ($engineOk) { $st = Get-SiteState }
    if (-not $engineOk) {
      # движком занимается блок выше
    } elseif (-not $st -or -not $st.Running) {
      # Docker ещё поднимается или контейнер остановлен вручную — не вмешиваемся
      Resume-Browsers "контейнера сайта нет или он остановлен"
      $failSince = $null
      $sleep = 30
    } elseif (Test-Site) {
      if ($wasDown) { Write-Log ("сайт отвечает (контейнер запущен {0:N1} мин назад)" -f ((Get-Date).ToUniversalTime() - $st.Started).TotalMinutes) }
      $wasDown = $false
      $failSince = $null
      $restartsInRow = 0
      Resume-Browsers "сайт ответил"
      if (Test-Caddy) { $caddyFails = 0 } else {
        $caddyFails++
        if ($caddyFails -ge 3 -and ((Get-Date) - $lastCaddy).TotalMinutes -ge 10) {
          Write-Log "сайт на 3000 отвечает, а через Caddy ($domain) нет — перезапуск gudini-caddy"
          & docker restart gudini-caddy 2>$null | Out-Null
          $lastCaddy = Get-Date
          $caddyFails = 0
        }
      }
    } else {
      $now = Get-Date
      if (-not $failSince) { $failSince = $now; Write-Log "сайт не отвечает" }
      $wasDown = $true
      $age = ($now.ToUniversalTime() - $st.Started).TotalMinutes
      if ($st.Networks -eq 0) {
        Write-Log "у контейнера сайта нет сети — подключаю к gudini_default"
        & docker network connect --alias gudini-site gudini_default $site 2>$null | Out-Null
      }
      # сайт внутри жив, а с компьютера не виден — мёртвый проброс порта, ждать нечего
      if ($st.Networks -gt 0 -and $age -ge 1 -and ($now - $lastPortFix).TotalMinutes -ge 10 -and (Test-SiteInside)) {
        Write-Log "сайт внутри контейнера отвечает, а порт 3000 на компьютере нет — перезапуск $site, чтобы Docker пробросил порт заново"
        & docker restart $site 2>$null | Out-Null
        $lastPortFix = Get-Date
        $lastRestart = Get-Date
        $failSince = Get-Date
        $st.Started = (Get-Date).ToUniversalTime()
        $age = 0
      }
      # пауза — только пока контейнер сайта запускается: сломанный не диском сайт браузеры не держит
      if ($age -lt 15) { Suspend-Browsers "сайт запускается — диск отдаём ему" } else { Resume-Browsers "сайт давно запущен, дело не в диске" }
      $stuck = ($age -ge 4) -and (($now - $failSince).TotalMinutes -ge 3)
      $cool = 10
      if ($restartsInRow -ge 3) { $cool = 60 }
      if ($stuck -and ($now - $lastRestart).TotalMinutes -ge $cool) {
        if ($restartsInRow -ge 3) { $restartsInRow = 0 }
        Suspend-Browsers "перезапуск сайта"
        Write-Log ("сайт не отвечает {0:N0} мин, контейнер запущен {1:N0} мин назад — перезапуск {2}" -f ($now - $failSince).TotalMinutes, $age, $site)
        & docker restart $site 2>$null | Out-Null
        $lastRestart = Get-Date
        $failSince = Get-Date
        $restartsInRow++
        if ($restartsInRow -ge 3) { Write-Log "3 перезапуска подряд не помогли — следующий не раньше чем через час" }
      }
      if ($script:pausedAt -and ((Get-Date) - $script:pausedAt).TotalMinutes -ge 20) { Resume-Browsers "20 минут паузы — дольше браузеры не держим" }
      $sleep = 15
    }
    # Threads: тот же мёртвый проброс, только на 8600 (приложение отвечает 401 без входа — это «живо»)
    if ($engineOk) {
      if ((Get-Code @("http://127.0.0.1:8600/threads")) -ne "000") { $threadsFails = 0 } else {
        $threadsFails++
        if ($threadsFails -ge 3 -and ((Get-Date) - $lastThreadsFix).TotalMinutes -ge 10 -and (Get-ContainerAge "gudini-threads-app") -ge 3) {
          Write-Log "Threads на 8600 не отвечает, контейнер запущен — перезапуск gudini-threads-app"
          & docker restart gudini-threads-app 2>$null | Out-Null
          $lastThreadsFix = Get-Date
          $threadsFails = 0
        }
      }
    }
  } catch {
    Write-Log "ошибка сторожа: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds $sleep
}
