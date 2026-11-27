@echo off
rem Double-click to start Cutroom on Windows. It opens in your browser; close this window to stop it.
rem First run: installs Node.js (with winget) if needed, then Cutroom's packages.
setlocal
title Cutroom
cd /d "%~dp0"

call :node_ok
if errorlevel 1 goto install_node
goto packages

:install_node
echo Node.js 20.19 or newer was not found.
where winget >nul 2>nul
if errorlevel 1 goto manual_node
echo Installing Node.js LTS with winget, one time...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
rem winget updates PATH for new windows only, so add the usual location for this one
set "PATH=%ProgramFiles%\nodejs;%PATH%"
call :node_ok
if errorlevel 1 goto manual_node
goto packages

:manual_node
echo Please install the LTS version of Node.js from https://nodejs.org and then run Cutroom.bat again.
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:packages
if not exist "node_modules\.cutroom-installed" goto install_packages
node -e "const fs=require('fs');process.exit(fs.statSync('package-lock.json').mtimeMs>fs.statSync('node_modules/.cutroom-installed').mtimeMs?1:0)"
if errorlevel 1 goto install_packages
goto start

:install_packages
echo Installing Cutroom's packages. The first run takes a few minutes...
call npm ci --no-audit --no-fund
if errorlevel 1 call npm install --no-audit --no-fund
if errorlevel 1 goto install_failed
type nul > "node_modules\.cutroom-installed"
goto start

:install_failed
echo Installing the packages failed. Check your internet connection and run Cutroom.bat again.
pause
exit /b 1

:start
node bin\director.mjs start %*
if errorlevel 1 pause
exit /b

:node_ok
where node >nul 2>nul
if errorlevel 1 exit /b 1
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)"
exit /b
