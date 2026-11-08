@echo off
REM DeedWood: download the latest version. Keeps your settings (.env) and your data (.deedwood folder).
title Update DeedWood
cd /d "%~dp0"
echo.
if exist ".git" (
  where git >nul 2>nul
  if not errorlevel 1 (
    echo  Updating with git...
    git pull
    goto :done
  )
)
echo  Downloading the latest DeedWood...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$zip = Join-Path $env:TEMP 'deedwood-latest.zip'; $dir = Join-Path $env:TEMP 'deedwood-latest';" ^
  "Invoke-WebRequest 'https://github.com/PicassoPepe/hearthstead/archive/refs/heads/main.zip' -OutFile $zip;" ^
  "if (Test-Path $dir) { Remove-Item $dir -Recurse -Force };" ^
  "Expand-Archive $zip $dir;" ^
  "$src = (Get-ChildItem $dir -Directory | Select-Object -First 1).FullName;" ^
  "robocopy $src '.' /E /XD .git node_modules .next .deedwood /XF .env /NFL /NDL /NJH /NJS /NP | Out-Null;" ^
  "if ($LASTEXITCODE -ge 8) { throw 'Copying the new files failed' } else { exit 0 }"
if errorlevel 1 (
  echo.
  echo  The update didn't finish. Check your internet connection and try again.
  pause
  exit /b 1
)
:done
echo.
echo  Updated. Double-click "Start DeedWood" to run the new version (it rebuilds once, a few minutes).
pause
