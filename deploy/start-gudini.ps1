# Единый автозапуск Гудини на ПК: одна запись «Гудини» в автозагрузке Windows запускает этот скрипт, а он — сторожей
# всех фоновых служб. У каждой службы свой сторож (поднимает её, если упала), этот скрипт только стартует их.
# Сторож, который уже работает, второй раз не запускается — скрипт можно запускать сколько угодно раз.
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\Users\user\Desktop\gudini\deploy\start-gudini.ps1
#   ... -List — только показать, что запущено, а что нет.
# Исполнители «3Д» и «Новостей» работают из своих worktree на проверенном коммите (gudini-work\*-runner):
# основная папка — общая рабочая копия, чужая недописанная правка в ней не должна ронять рендер.
# Журнал — data\start-gudini.log. Файл в UTF-8 с BOM: иначе Windows PowerShell 5.1 прочтёт русские строки как ANSI.
param([switch]$List)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "data\start-gudini.log"
$work = "C:\Users\user\gudini-work"

# Мосты Codex запускаются разовым скриптом без сторожа: живы ли они — видно по самому node моста (Alive).
$services = @(
  @{ Name = "мост Codex";                Script = Join-Path $root "deploy\start-codex-bridge.ps1"; Alive = Join-Path $root "scripts\codex-bridge.ts" },
  @{ Name = "мост картинок Codex";       Script = Join-Path $root "deploy\start-codex-image-bridge.ps1"; Alive = Join-Path $root "scripts\codex-image-bridge.ts" },
  @{ Name = "мост Claude (Threads, сайт)"; Script = Join-Path $root "threads\scripts\bridge-watch.ps1" },
  @{ Name = "мост Claude «3Д»";          Script = Join-Path $work "3d-runner\studio3d\bridge\start-bridge.ps1" },
  @{ Name = "исполнитель «3Д»";          Script = Join-Path $work "3d-runner\studio3d\deploy\host\start-runner.ps1" },
  @{ Name = "мост Claude «Новостей»";    Script = Join-Path $work "news-runner\news\bridge\start-bridge.ps1" },
  @{ Name = "исполнитель «Новостей»";    Script = Join-Path $work "news-runner\news\runner\start-runner.ps1" },
  # монтаж «Опус 5.5» в проектах главной (5.11): воркер сайта отдаёт ему запись на порт 43147
  @{ Name = "исполнитель «Опус 5.5»";    Script = Join-Path $work "opus\news\runner\opus\start-opus.ps1" },
  @{ Name = "мост Claude «Карусели»";    Script = Join-Path $work "carousel-runner\carousel\bridge\start-bridge.ps1" },
  # сторож сайта (6.11): после загрузки ПК сайт висел на «Starting…» — Docker на жёстком диске D:, браузеры забивали
  # диск; сторож ставит браузеры на паузу, пока сайт запускается, и сам перезапускает зависший сайт или Caddy
  @{ Name = "сторож сайта";              Script = Join-Path $root "deploy\site-watchdog.ps1" },
  # перенос постов (7.11): новые посты телеграм-канала владельца t.me/owner_channel сразу и без правок уходят
  # в Threads @owner.threads и X @OwnerX, после 7 часов тишины — вневременной пост из запаса
  @{ Name = "перенос из телеграма";      Script = Join-Path $root "deploy	g-mirror.ps1" },
  # ответы на комментарии (12.11): через 10–30 минут после комментария, после включения ПК — сразу всем накопленным
  @{ Name = "ответы на комментарии";     Script = Join-Path $root "deployeply-watch.ps1" }
)

function Write-Log([string]$text) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"), $text
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null
  [System.IO.File]::AppendAllText($log, $line + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
  Write-Output $line
}

$running = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.Name -in @("powershell.exe", "node.exe") } | ForEach-Object { $_.CommandLine }
foreach ($s in $services) {
  if (-not (Test-Path -LiteralPath $s.Script)) { Write-Log "нет файла — пропуск: $($s.Name) ($($s.Script))"; continue }
  $mark = if ($s.Alive) { $s.Alive } else { $s.Script }
  $alive = $running | Where-Object { $_ -and $_.Contains($mark) }
  if ($alive) { Write-Log "уже работает: $($s.Name)"; continue }
  if ($List) { Write-Log "не запущено: $($s.Name)"; continue }
  Start-Process -FilePath powershell.exe -WindowStyle Hidden -WorkingDirectory (Split-Path -Parent $s.Script) `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$($s.Script)`""
  Write-Log "запущено: $($s.Name)"
}
