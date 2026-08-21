@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (echo Install Node.js 18+ first. & pause & exit /b 1)
if not exist node_modules call npm install
if not exist .env copy .env.example .env
npm start
pause
