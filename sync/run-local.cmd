@echo off
chcp 65001 >nul
rem ============================================================
rem  Ручной запуск проверки новых песен.
rem  То же самое Планировщик заданий делает каждый день в 15:00.
rem ============================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-local.ps1"
echo.
echo Результат записан в файл: sync\local-sync.log
pause
