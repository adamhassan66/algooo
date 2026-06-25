@echo off
title PolyBot - enable live trading
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org first.
  pause
  exit /b 1
)

echo.
echo   Installing live-trading dependencies (Polymarket client + ethers v5)...
echo   This is only needed once, and only if you want to trade real funds.
echo.
call npm install
echo.
echo   Done. Now run start.bat, open Settings, and connect a wallet.
echo   Tip: keep paper-trading until the readiness banner turns green.
echo.
pause
