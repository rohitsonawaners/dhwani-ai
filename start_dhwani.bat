@echo off
title Dhwani AI Starter
echo ==========================================
echo Starting Dhwani AI Companion...
echo ==========================================

echo [1/3] Closing any stale backend instances on port 5000...
for /f "tokens=5" %%a in ('netstat -aon ^| find ":5000" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>&1

echo [2/3] Launching Backend Server on http://127.0.0.1:5000 ...
start "Dhwani AI Backend" cmd /k "cd Dhwani.AI-Backend && python app.py"

timeout /t 2 /nobreak >nul

echo [3/3] Opening Dhwani AI Web Interface...
start "" "%~dp0Dhwani.AI\index.html"

echo.
echo ==========================================
echo Dhwani AI is running! Enjoy your chat!
echo ==========================================
