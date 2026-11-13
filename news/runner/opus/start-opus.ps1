# Сторож исполнителя «Опус 5.5» на ПК: запускает news/runner/opus/server.ts и поднимает его снова, если он упал.
# Работает скрыто, без окна:
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File <папка news>\runner\opus\start-opus.ps1
# Ключи (токен мостов Claude, ElevenLabs и Codex для вставок) — из .env основного проекта. Мост Claude «Новостей» (43141)
# — на этом же ПК. Журнал — news\.work\opus.log. Файл в UTF-8 с BOM: иначе Windows PowerShell 5.1 прочтёт русские строки как ANSI.
param([string]$EnvFile = "C:\Users\user\Desktop\gudini\.env")
$ErrorActionPreference = "Continue"
$news = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir = Join-Path $news ".work"
$log = Join-Path $logDir "opus.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$text) {
  $line = "{0} [сторож] {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"), $text
  [System.IO.File]::AppendAllText($log, $line + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
}

$mutex = New-Object System.Threading.Mutex($false, "Local\gudini-opus-runner-watch")
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) { exit 0 }

(Get-Process -Id $PID).PriorityClass = "BelowNormal"

foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
  if ($line -match '^\s*(CLAUDE_BRIDGE_TOKEN|CODEX_BRIDGE_TOKEN|ELEVENLABS_API_KEY|CODEX_MODEL|CODEX_UTIL_MODEL)\s*=\s*(.*)$') {
    Set-Item -Path "env:$($Matches[1])" -Value ($Matches[2].Trim().Trim('"').Trim("'"))
  }
}
$env:CODEX_BRIDGE_URL = "http://127.0.0.1:43127"
$env:NEWS_CLAUDE_URL = "http://127.0.0.1:43141"
# звуки, музыка и мемы — из папки news основной папки (её пополняет владелец), работа — вне кода
$env:NEWS_MEDIA_DIR = "C:\Users\user\Desktop\gudini\news"
$env:OPUS_WORK_DIR = Join-Path $env:USERPROFILE "gudini-opus-data"
# свой порт сервера кадров Remotion: «Новости» рендерят в соседнем процессе на 3000-х портах
$env:NEWS_RENDER_PORT = "3470"

$quickExits = 0
while ($true) {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) { Move-Item -Force $log "$log.1" }
  Write-Log "запускаю исполнитель «Опус 5.5»"
  $started = Get-Date
  $process = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /c node --import tsx runner/opus/server.ts >> `"$log`" 2>&1" `
    -WorkingDirectory $news -WindowStyle Hidden -PassThru -Wait
  $seconds = [int]((Get-Date) - $started).TotalSeconds
  Write-Log "исполнитель остановился (код $($process.ExitCode)) через $seconds с"
  if ($seconds -lt 60) { $quickExits++ } else { $quickExits = 0 }
  Start-Sleep -Seconds ([Math]::Min(300, 5 * [Math]::Pow(2, [Math]::Min($quickExits, 6))))
}
