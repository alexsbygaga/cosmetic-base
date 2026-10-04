@echo off
rem Запуск локального сервера каталога «Косметическая база»
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите Node.js 18 или новее: https://nodejs.org/
  pause
  exit /b 1
)
echo Запускаю сервер на http://127.0.0.1:8787
start "" http://127.0.0.1:8787
node server\serve.mjs %*
pause
