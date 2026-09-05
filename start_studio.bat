@echo off
title Sprite Pixel Motion Studio
cd /d "%~dp0"

echo ===================================================
echo     Starting Sprite Pixel Motion Studio...
echo ===================================================
echo.
echo Opening http://localhost:8000 in your browser...
echo Press Ctrl+C in this terminal when you want to stop the server.
echo.

:: Launch default browser
start http://localhost:8000

:: Start Python HTTP Server
python -m http.server 8000

pause
