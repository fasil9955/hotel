@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Install the 64-bit Node.js 24 installer, then run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)
if not exist client\dist\index.html (
  call npm run build
  if errorlevel 1 (
    echo The build failed.
    pause
    exit /b 1
  )
)
if not exist server\dist\index.js (
  call npm run build
  if errorlevel 1 (
    echo The build failed.
    pause
    exit /b 1
  )
)
echo.
echo On this PC, open http://localhost:3780 in Chrome.
echo Leave this window open while billing. Closing it stops the software.
echo After joining the hotel Wi-Fi, the tablet address is on the Setup page.
echo.
call npm start
if errorlevel 1 pause
