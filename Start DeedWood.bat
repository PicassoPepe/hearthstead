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

echo.
echo  Getting DeedWood ready (first time: a few minutes)...
echo.
where corepack >nul 2>nul
if errorlevel 1 (
  call npx -y pnpm@10.28.0 install --frozen-lockfile
) else (
  call corepack pnpm install --frozen-lockfile
)
if errorlevel 1 (
  echo.
  echo  Installing packages failed. Check your internet connection and double-click "Start DeedWood" again.
  pause
  exit /b 1
)

node scripts\start.mjs
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
