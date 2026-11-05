@echo off
title SMM Panel - Development Mode
color 0B

cd /d "%~dp0"

echo ========================================
echo    SMM Panel - Dev Mode (Server Only)
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js tidak ditemukan!
    pause
    exit /b 1
)

echo Starting Server in development mode...
echo Panel React : http://localhost:5175
echo Dashboard   : http://localhost:3000
echo.
echo Press Ctrl+C to stop the server
echo.

REM Start frontend (kalau ada) lalu open browser
if exist "frontend\node_modules" (
    start "SMM Panel - Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
)

start "" cmd /c "timeout /t 3 >nul && start http://localhost:5175"
node server.js

pause
