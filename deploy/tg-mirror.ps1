# Перенос постов из телеграм-канала владельца t.me/owner_channel в Threads @owner.threads и X @OwnerX (запускается из start-gudini.ps1).
#
# Владелец 7.11: «посты теперь должны браться отсюда, без редактирования, публикация моментальная; если более 7 часов
# нету постов, ищи там же контент, который не привязан по времени; без рекламных постов».
# Раз в 2 минуты копирует threads\scripts\claude\tg-mirror.mjs в контейнер gudini-threads-app и запускает его:
# скрипт читает публичную страницу канала, новые посты сразу ставит в публикатор обеих площадок, пересланное и
# рекламу пропускает, а после 7 часов тишины днём выпускает пост из запаса вневременных (settings key='tg_mirror').
# Пауза: tg_mirror.enabled=false, стоп на дашборде или settings.claude_sessions.paused. Журнал — data\tg-mirror.log.
# Файл в UTF-8 с BOM: иначе Windows PowerShell 5.1 прочтёт русские строки как ANSI.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root "data\tg-mirror.log"
$script = Join-Path $root "threads\scripts\claude\tg-mirror.mjs"
$container = "gudini-threads-app"
$intervalSeconds = 120

function Write-Log([string]$text) {
  $l = "{0} {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"), $text
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null
  [System.IO.File]::AppendAllText($log, $l + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding $false))
}

Write-Log "перенос из телеграма запущен"
$lastProblem = ""
while ($true) {
  $running = & docker inspect -f "{{.State.Running}}" $container 2>$null
  if ($running -ne "true") {
    if ($lastProblem -ne "container") { Write-Log "контейнер $container не запущен — жду"; $lastProblem = "container" }
  } else {
    & docker exec $container mkdir -p /tmp/claude 2>$null | Out-Null
    & docker cp $script "${container}:/tmp/claude/tg-mirror.mjs" 2>$null | Out-Null
    # Вывод скрипта приходит в UTF-8: читаем его байтами, чтобы русский текст не превратился в кракозябры.
    $psi = New-Object System.Diagnostics.ProcessStartInfo "docker", "exec -w /app $container node /tmp/claude/tg-mirror.mjs"
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd(); $err = $p.StandardError.ReadToEnd()
    if (-not $p.WaitForExit(600000)) { $p.Kill(); Write-Log "проход завис дольше 10 минут — остановлен" }
    # В журнал — только события (публикация, пропуск, ошибка); пустой проход журнал не засоряет.
    foreach ($line in ($out -split "`r?`n")) { if ($line.Trim()) { Write-Log $line.Trim() } }
    if ($p.ExitCode -ne 0) {
      $short = ($err -split "`r?`n" | Where-Object { $_ -match 'Error|error' } | Select-Object -First 2) -join " "
      if ($lastProblem -ne $short) { Write-Log "проход упал (код $($p.ExitCode)): $short"; $lastProblem = $short }
    } else { $lastProblem = "" }
  }
  Start-Sleep -Seconds $intervalSeconds
}
