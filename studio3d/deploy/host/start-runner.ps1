# Сторож исполнителя «3Д» на ПК владельца: рендер на видеокарте (Direct3D), 2 кадра разом, пониженный приоритет.
# Запускает studio3d/runner/index.ts из своей папки и поднимает его снова, если он упал. Работает скрыто, без окна:
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File <папка исполнителя>\studio3d\deploy\host\start-runner.ps1
# Ключи (пароль сайта, ElevenLabs, токен моста Claude, токен моста картинок GPT для целевого кадра) — из .env основного проекта; работа и кэш — в -Data.
# Журнал — studio3d\.work\runner.log рядом с исполнителем. Второй сторож рядом с первым сразу выходит.
# Файл сохранён в UTF-8 с BOM: иначе Windows PowerShell 5.1 прочтёт русские строки журнала как ANSI.
param(
  [string]$EnvFile = "C:\Users\user\Desktop\gudini\.env",
  [string]$Data = (Join-Path $env:USERPROFILE "gudini-3d-data")
)
$ErrorActionPreference = "Continue"
$studio = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$logDir = Join-Path $studio ".work"
$log = Join-Path $logDir "runner.log"
New-Item -ItemType Directory -Force -Path $logDir, (Join-Path $Data "work") | Out-Null

function Write-Log([string]$text) {
  $line = "{0} [сторож] {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"), $text
  # Без BOM и в той же кодировке, что пишет node: журнал читается одним файлом.
  [System.IO.File]::AppendAllText($log, $line + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
}

$mutex = New-Object System.Threading.Mutex($false, "Local\gudini-studio3d-runner-watch")
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) { exit 0 }

# Ниже обычного: cmd, node и Chrome рендера наследуют этот класс, так что игра и рабочий стол всегда идут первыми.
(Get-Process -Id $PID).PriorityClass = "BelowNormal"

# Только нужные исполнителю ключи; значения в журнал не попадают.
foreach ($line in Get-Content -LiteralPath $EnvFile -Encoding UTF8) {
  if ($line -match '^\s*(SITE_PASSWORD|GUDINI_PASSWORD|ELEVENLABS_API_KEY|CLAUDE_BRIDGE_TOKEN|CODEX_BRIDGE_TOKEN)\s*=\s*(.*)$') {
    Set-Item -Path "env:$($Matches[1])" -Value ($Matches[2].Trim().Trim('"').Trim("'"))
  }
}
$env:GUDINI_URL = "http://127.0.0.1:3000"
$env:STUDIO3D_GL = "angle"
$env:STUDIO3D_TABS = "2"
$env:STUDIO3D_WORK = Join-Path $Data "work"

$quickExits = 0
while ($true) {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) { Move-Item -Force $log "$log.1" }
  Write-Log "запускаю исполнитель: сайт $env:GUDINI_URL, рендер $env:STUDIO3D_GL × $env:STUDIO3D_TABS, работа $env:STUDIO3D_WORK"
  $started = Get-Date
  # cmd дописывает вывод node в журнал как есть (UTF-8), вместе с ошибками.
  $process = Start-Process -FilePath $env:ComSpec -ArgumentList "/d /c node --import tsx runner/index.ts >> `"$log`" 2>&1" `
    -WorkingDirectory $studio -WindowStyle Hidden -PassThru -Wait
  $seconds = [int]((Get-Date) - $started).TotalSeconds
  Write-Log "исполнитель остановился (код $($process.ExitCode)) через $seconds с"
  # Исполнитель, падающий сразу (нет пароля, сайт не поднят), не перезапускается каждую секунду: пауза растёт до 5 минут.
  if ($seconds -lt 60) { $quickExits++ } else { $quickExits = 0 }
  Start-Sleep -Seconds ([Math]::Min(300, 5 * [Math]::Pow(2, [Math]::Min($quickExits, 6))))
}
