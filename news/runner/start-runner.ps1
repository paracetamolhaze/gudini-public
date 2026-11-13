# Сторож исполнителя «Новостей» на ПК: запускает news/runner/index.ts и поднимает его снова, если он упал.
# Работает скрыто, без окна:
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File <папка news>\runner\start-runner.ps1
# Ключи (пароль сайта, ElevenLabs, токены мостов Claude и Codex, их модели) — из .env основного проекта.
# Мосты Claude (43131, с поиском) и Codex (43127) — на этом же ПК. Журнал — news\.work\runner.log.
# Второй сторож рядом с первым сразу выходит. Файл в UTF-8 с BOM: иначе Windows PowerShell 5.1 прочтёт русские строки как ANSI.
param([string]$EnvFile = "C:\Users\user\Desktop\gudini\.env")
$ErrorActionPreference = "Continue"
$news = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $news ".work"
$log = Join-Path $logDir "runner.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$text) {
  $line = "{0} [сторож] {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"), $text
  [System.IO.File]::AppendAllText($log, $line + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
}

$mutex = New-Object System.Threading.Mutex($false, "Local\gudini-news-runner-watch")
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) { exit 0 }

# Ниже обычного: рендер и скачивание не мешают рабочему столу.
(Get-Process -Id $PID).PriorityClass = "BelowNormal"

# Только нужные исполнителю ключи; значения в журнал не попадают.
foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
  if ($line -match '^\s*(SITE_PASSWORD|ELEVENLABS_API_KEY|CLAUDE_BRIDGE_TOKEN|CODEX_BRIDGE_TOKEN|CLAUDE_SCRIPT_MODEL|CODEX_MODEL|CODEX_SCRIPT_MODEL|CODEX_STORY_MODEL|CODEX_UTIL_MODEL|CODEX_REASONING_EFFORT|CODEX_TIMEOUT_MS)\s*=\s*(.*)$') {
    Set-Item -Path "env:$($Matches[1])" -Value ($Matches[2].Trim().Trim('"').Trim("'"))
  }
}
$env:GUDINI_URL = "http://127.0.0.1:3000"
$env:CLAUDE_BRIDGE_URL = "http://127.0.0.1:43131"
$env:CODEX_BRIDGE_URL = "http://127.0.0.1:43127"
# звуки, музыка и образец голоса — в папке news основной папки (её пополняет владелец); работа — вне кода,
# чтобы смена кода не стирала папки готовых роликов (по ним меняется музыка)
$env:NEWS_MEDIA_DIR = "C:\Users\user\Desktop\gudini\news"
$env:NEWS_WORK_DIR = Join-Path $env:USERPROFILE "gudini-news-data\work"

$quickExits = 0
while ($true) {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) { Move-Item -Force $log "$log.1" }
  Write-Log "запускаю исполнитель: сайт $env:GUDINI_URL"
  $started = Get-Date
  $process = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /c node --import tsx runner/index.ts >> `"$log`" 2>&1" `
    -WorkingDirectory $news -WindowStyle Hidden -PassThru -Wait
  $seconds = [int]((Get-Date) - $started).TotalSeconds
  Write-Log "исполнитель остановился (код $($process.ExitCode)) через $seconds с"
  if ($seconds -lt 60) { $quickExits++ } else { $quickExits = 0 }
  Start-Sleep -Seconds ([Math]::Min(300, 5 * [Math]::Pow(2, [Math]::Min($quickExits, 6))))
}
