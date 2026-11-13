# Сторож моста «Новостей» к Claude: запускает news/bridge/claude-bridge.mjs и поднимает его снова, если мост упал.
# Работает скрыто, без окна, поэтому его нельзя закрыть случайно:
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File <репозиторий>\news\bridge\start-bridge.ps1
# Журнал моста и сторожа — news\.work\claude-bridge.log. Второй сторож рядом с первым сразу выходит.
# Файл сохранён в UTF-8 с BOM: иначе Windows PowerShell 5.1 прочтёт русские строки журнала как ANSI.
$ErrorActionPreference = "Continue"
$news = Split-Path -Parent $PSScriptRoot
$bridge = Join-Path $PSScriptRoot "claude-bridge.mjs"
$logDir = Join-Path $news ".work"
$log = Join-Path $logDir "claude-bridge.log"
$port = if ($env:NEWS_CLAUDE_PORT) { [int]$env:NEWS_CLAUDE_PORT } else { 43141 }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$text) {
  $line = "{0} [сторож] {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"), $text
  # Без BOM и в той же кодировке, что пишет node: журнал читается одним файлом.
  [System.IO.File]::AppendAllText($log, $line + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
}

$mutex = New-Object System.Threading.Mutex($false, "Local\gudini-news-bridge-watch")
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) { exit 0 }

$quickExits = 0
while ($true) {
  # Порт уже слушают — мост запущен вручную; второй упал бы на занятом порту, так что ждём.
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    Start-Sleep -Seconds 60
    continue
  }
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) { Move-Item -Force $log "$log.1" }
  Write-Log "запускаю мост на 127.0.0.1:$port"
  $started = Get-Date
  # cmd дописывает вывод node в журнал как есть (UTF-8), вместе с ошибками.
  $process = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /c node `"$bridge`" >> `"$log`" 2>&1" `
    -WorkingDirectory $news -WindowStyle Hidden -PassThru -Wait
  $seconds = [int]((Get-Date) - $started).TotalSeconds
  Write-Log "мост остановился (код $($process.ExitCode)) через $seconds с"
  # Мост, падающий сразу (нет токена, занят порт), не должен перезапускаться каждую секунду: пауза растёт до 5 минут.
  if ($seconds -lt 60) { $quickExits++ } else { $quickExits = 0 }
  Start-Sleep -Seconds ([Math]::Min(300, 5 * [Math]::Pow(2, [Math]::Min($quickExits, 6))))
}
