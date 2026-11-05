@echo off
title SMM Panel - Startup
color 0A

REM Selalu ke folder proyek (bisa dijalankan dari Explorer/sembarang cwd)
cd /d "%~dp0"

echo ========================================
echo    SMM Panel - Starting Services
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js tidak ditemukan!
    echo Silakan install Node.js terlebih dahulu.
    pause
    exit /b 1
)

REM Port sudah dipakai? Artinya layanan sudah jalan, jangan double-start.
set PORT_BUSY=0
netstat -aon | findstr "LISTENING" | findstr ":3000 " >nul 2>nul && set PORT_BUSY=1
netstat -aon | findstr "LISTENING" | findstr ":5175 " >nul 2>nul && set PORT_BUSY=1
if %PORT_BUSY%==1 (
    echo [WARN] Ada layanan yang sudah jalan di port 3000/5175.
    echo        Jalankan stop.bat dulu kalau mau mulai bersih.
    echo.
)

echo [1/4] Starting Main Server (Dashboard + API, port 3000)...
start "SMM Panel - Server" cmd /k "node server.js"
timeout /t 3 >nul

echo [2/4] Starting Background Worker (Queue Processing)...
start "SMM Panel - Worker" cmd /k "node worker.js"
timeout /t 2 >nul

echo [3/4] Starting Scheduler (Auto Post)...
start "SMM Panel - Scheduler" cmd /k "node index.js"
timeout /t 2 >nul

echo [4/4] Starting Frontend React (Vite, port 5175)...
if not exist "frontend\node_modules" (
    echo        node_modules frontend belum ada - install dulu ^(bisa 1-2 menit^)...
    start "SMM Panel - Frontend" cmd /k "cd /d %~dp0frontend && npm install && npm run dev"
) else (
    start "SMM Panel - Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
)
timeout /t 5 >nul

echo.
echo ========================================
echo    All Services Started Successfully!
echo ========================================
echo.
echo Panel React    : http://localhost:5175
echo Dashboard lama : http://localhost:3000
echo Monitoring     : http://localhost:3000/monitoring.html
echo.
echo Press any key to open the panel in browser...
pause >nul

start http://localhost:5175

echo.
echo To stop all services, close all terminal windows
echo or run stop.bat
echo.
pause
