@echo off
title SMM Panel - Stop Services
color 0C

cd /d "%~dp0"

echo ========================================
echo    SMM Panel - Stopping Services
echo ========================================
echo.

echo Killing SMM Panel service windows...
taskkill /FI "WINDOWTITLE eq SMM Panel - Server*" /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq SMM Panel - Worker*" /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq SMM Panel - Scheduler*" /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq SMM Panel - Frontend*" /F >nul 2>nul

echo Killing remaining listeners on ports 3000/5175...
for /f "tokens=5" %%a in ('netstat -aon ^| find "LISTENING" ^| find ":3000"') do (
    taskkill /F /PID %%a >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon ^| find "LISTENING" ^| find ":5175"') do (
    taskkill /F /PID %%a >nul 2>nul
)

echo.
echo ========================================
echo    All Services Stopped
echo ========================================
echo.
pause
