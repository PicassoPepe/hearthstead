@echo off
REM DeedWood: make the marketing website as a folder you can drag into Cloudflare Pages.
REM The folder appears on your Desktop: DeedWood\deploy\pages-static
title Make DeedWood website folder
cd /d "%~dp0"
set COREPACK_ENABLE_DOWNLOAD_PROMPT=0
set npm_config_confirm_modules_purge=false
set CI=true
echo.
set /p SITE=Your website address (for example https://deedwood.com): 
set /p APP=Your DeedWood app address (for example https://app.deedwood.com): 
echo.
where corepack >nul 2>nul
if errorlevel 1 (
  call npx -y pnpm@10.28.0 install --frozen-lockfile
) else (
  call corepack pnpm install --frozen-lockfile
)
node "%CD%\scripts\export-marketing.mjs" --out "%USERPROFILE%\Desktop\DeedWood\deploy\pages-static" --site "%SITE%" --app "%APP%"
if errorlevel 1 (
  echo.
  echo  Something went wrong making the folder. Send a screenshot of this window.
  pause
  exit /b 1
)
echo.
echo  Done! Open Cloudflare: Workers ^& Pages - Create - Pages - Upload assets,
echo  and drag in the folder:  Desktop\DeedWood\deploy\pages-static
echo.
pause
