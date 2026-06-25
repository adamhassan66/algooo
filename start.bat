@echo off
title PolyBot
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Install the LTS version from https://nodejs.org then double-click this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting PolyBot...
echo   The dashboard will open at http://localhost:3000
echo   Keep this window open while using the bot. Close it to stop.
echo.

REM open the browser a few seconds after the server starts
start "" /min cmd /c "timeout /t 3 >nul & start http://localhost:3000"

node src/server.js
echo.
echo   PolyBot stopped.
pause
