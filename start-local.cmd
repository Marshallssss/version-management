@echo off
setlocal

cd /d "%~dp0"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1" %*
) else (
  powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1" %*
)

set "START_LOCAL_EXIT=%ERRORLEVEL%"
echo.
if errorlevel 1 (
  echo Start failed. Exit code: %START_LOCAL_EXIT%
  echo Please send me the error text above if it still does not run.
) else (
  echo Program stopped.
)
echo Press any key to close this window...
pause >nul
exit /b %START_LOCAL_EXIT%
