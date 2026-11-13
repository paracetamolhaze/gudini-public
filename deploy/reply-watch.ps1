# Ответы на комментарии под постами Threads @owner.threads и X @OwnerX (запускается из start-gudini.ps1).
#
# Владелец 12.11: «ответ должен быть через 10–30 минут, если комп выключен и потом включили — нужно сразу ответить всем
# в течение 1–5 минут». Раз в 2 минуты копирует threads\scripts\claudeeply-watch.mjs в контейнер gudini-threads-app и
# запускает его: скрипт собирает новые комментарии, каждому назначает случайную минуту ответа через 10–30 минут, созревшие
# ответы пишет Claude (мост, Opus) одним вызовом и отправляет; накопленное за время выключенного ПК уходит на первом проходе.
# Пауза: settings reply_watch.enabled=false, стоп на дашборде или settings.claude_sessions.paused. Журнал — dataeply-watch.log.
# Файл в UTF-8 с BOM: иначе Windows PowerShell 5.1 прочтёт русские строки как ANSI.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "data\reply-watch.log"
$script = Join-Path $root "threads\scripts\claude\reply-watch.mjs"
$container = "gudini-threads-app"
$intervalSeconds = 120

function Write-Log([string]$text) {
  $l = "{0} {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"), $text
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null
  [System.IO.File]::AppendAllText($log, $l + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
}

Write-Log "ответы на комментарии запущены"
$lastProblem = ""
while ($true) {
  $running = & docker inspect -f "{{.State.Running}}" $container 2>$null
  if ($running -ne "true") {
    if ($lastProblem -ne "container") { Write-Log "контейнер $container не запущен — жду"; $lastProblem = "container" }
  } else {
    & docker exec $container mkdir -p /tmp/claude 2>$null | Out-Null
    & docker cp $script "${container}:/tmp/claude/reply-watch.mjs" 2>$null | Out-Null
    # Вывод скрипта приходит в UTF-8: читаем его байтами, чтобы русский текст не превратился в кракозябры.
    $psi = New-Object System.Diagnostics.ProcessStartInfo "docker", "exec -w /app $container node /tmp/claude/reply-watch.mjs"
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd(); $err = $p.StandardError.ReadToEnd()
    if (-not $p.WaitForExit(600000)) { $p.Kill(); Write-Log "проход завис дольше 10 минут — остановлен" }
    # В журнал — только события (публикация, пропуск, ошибка); пустой проход журнал не засоряет.
    # Служебные JSON-строки сервиса (каждый найденный комментарий) в журнал не пишем — только строки скрипта.
    foreach ($line in ($out -split "`r?`n")) { if ($line.Trim() -and -not $line.Trim().StartsWith("{")) { Write-Log $line.Trim() } }
    if ($p.ExitCode -ne 0) {
      $short = ($err -split "`r?`n" | Where-Object { $_ -match 'Error|error' } | Select-Object -First 2) -join " "
      if ($lastProblem -ne $short) { Write-Log "проход упал (код $($p.ExitCode)): $short"; $lastProblem = $short }
    } else { $lastProblem = "" }
  }
  Start-Sleep -Seconds $intervalSeconds
}
