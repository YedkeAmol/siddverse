@echo off
title SiddVerse Server
echo ========================================================
echo                 Starting SiddVerse Server
echo ========================================================
echo.
cd /d "%~dp0"
echo Starting Node server at http://127.0.0.1:3000 ...
start http://127.0.0.1:3000
node server.js
pause
