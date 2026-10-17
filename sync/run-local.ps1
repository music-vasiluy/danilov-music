# Локальная проверка новых песен в Telegram-канале и публикация на сайте.
# Каждый день в 15:00 этот скрипт запускает Планировщик заданий Windows
# (задание «DanilovMusicSync»). Можно запустить вручную: sync\run-local.cmd
# Подробности работы записываются в sync\local-sync.log

$ErrorActionPreference = "Continue"

$syncDir   = $PSScriptRoot
$root      = Split-Path -Parent $syncDir
$log       = Join-Path $syncDir "local-sync.log"
$tokenFile = Join-Path $syncDir ".token"

Set-Location $root

$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Log([string]$message) {
    $line = ('{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message)
    [System.IO.File]::AppendAllText($log, $line + "`r`n", $utf8)
}

if (-not (Test-Path $tokenFile)) {
    Write-Log "Не найден файл sync\.token — вставьте в него токен бота от @BotFather."
    exit 1
}

$env:BOT_TOKEN = (Get-Content $tokenFile -Raw).Trim()
$env:CHANNEL   = "Danilov_Vasilii_music"

Write-Log "--- Проверка новых песен ---"

# 1. Забираем новые посты из Telegram (подробности — в лог).
& cmd.exe /c 'node sync\sync.mjs >> sync\local-sync.log 2>&1'
if ($LASTEXITCODE -ne 0) {
    Write-Log "Ошибка связи с Telegram — попробую при следующем запуске."
    exit 1
}

# 2. Если появились файлы (новые песни) — публикуем их на сайте.
& cmd.exe /c 'git add -A & git diff --cached --quiet'
$changed = ($LASTEXITCODE -ne 0)

if ($changed) {
    & cmd.exe /c 'git commit -m "Новые песни из Telegram (проверка с ПК)" >> sync\local-sync.log 2>&1'
    if ($LASTEXITCODE -ne 0) {
        Write-Log "Не удалось создать коммит — подробности в логе."
        exit 1
    }
}

& cmd.exe /c 'git pull --rebase --autostash >> sync\local-sync.log 2>&1'
if ($LASTEXITCODE -ne 0) {
    & cmd.exe /c 'git rebase --abort >> sync\local-sync.log 2>&1'
    Write-Log "Не удалось обновить версию сайта с GitHub (нет интернета или конфликт) — повтор при следующем запуске."
    exit 1
}

& cmd.exe /c 'git push >> sync\local-sync.log 2>&1'
if ($LASTEXITCODE -ne 0) {
    Write-Log "Не удалось отправить на GitHub (нет интернета?) — повтор при следующем запуске."
    exit 1
}

if ($changed) { Write-Log "Готово: новые песни опубликованы на сайте.