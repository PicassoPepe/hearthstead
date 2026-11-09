@echo off
REM DeedWood: double-click to start. Installs what it needs the first time, then opens your browser.
title DeedWood
cd /d "%~dp0"
set COREPACK_ENABLE_DOWNLOAD_PROMPT=0
REM Never stop to ask questions while installing (e.g. "reinstall node_modules? Y/n").
set npm_config_confirm_modules_purge=false
set CI=true

where node >nul 2>nul
if errorlevel 1 goto :installnode
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 goto :installnode

REM Close any DeedWood that is still running from this folder (it locks files during an update).
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$here = (Get-Location).Path;" ^
  "Get-CimInstance Win32_Process | Where-Object { ($_.Name -in 'node.exe','postgres.exe','pg_ctl.exe') -and (($_.ExecutablePath -like ($here + '*')) -or ($_.CommandLine -like ('*' + $here + '*'))) } | ForEach-Object { Write-Host ('  Closing an older DeedWood that was still running (' + $_.Name + ')'); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" ^
  "Start-Sleep -Seconds 2" 2>nul

echo.
echo  Getting DeedWood ready (first time: a few minutes)...
echo.
set TRIES=0
:install
set /a TRIES+=1
where corepack >nul 2>nul
if errorlevel 1 (
  call npx -y pnpm@10.28.0 install --frozen-lockfile
) else (
  call corepack pnpm install --frozen-lockfile
)
if not errorlevel 1 goto :installed
if %TRIES% LSS 2 (
  echo.
  echo  That didn't work - trying once more...
  timeout /t 5 /nobreak >nul
  goto :install
)
echo.
echo  Installing packages failed.
echo  1. Close every other DeedWood window (and restart the computer if this keeps happening).
echo  2. Check your internet connection.
echo  3. Double-click "Start DeedWood" again.
pause
exit /b 1

:installed

node "%CD%\scripts\start.mjs"
echo.
pause
exit /b 0

:installnode
echo.
echo  DeedWood needs Node.js 22 or newer. Installing it now...
echo.
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo.
  echo  Couldn't install Node.js automatically.
  echo  Please install the "LTS" version from https://nodejs.org, then double-click "Start DeedWood" again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
echo.
echo  Node.js is installed. Close this window and double-click "Start DeedWood" again.
pause
exit /b 0
