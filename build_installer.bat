@echo off
setlocal enabledelayedexpansion

echo ====================================
echo   ECHO Launcher - Build Installer
echo ====================================
echo.

echo [1/3] Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo Error installing dependencies!
    pause
    exit /b 1
)

echo.
echo [2/3] Building installer...
call npm run build-installer
if %ERRORLEVEL% NEQ 0 (
    echo Error building installer!
    pause
    exit /b 1
)

echo.
echo [3/3] Done!
echo Installer created in: dist\
echo.

start "" explorer dist

pause