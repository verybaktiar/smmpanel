@echo off
REM Dipanggil Task Scheduler: backup terenkripsi ke branch backup-data.
cd /d "%~dp0.."
node scripts\backup-github.js
exit /b %ERRORLEVEL%
