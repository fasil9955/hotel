@echo off
echo Allows the order tablets to reach Hotel billing on port 3780.
echo The Windows firewall stays on. Only this port is opened.
echo.
netsh advfirewall firewall show rule name="Hotel billing tablets" >nul 2>&1
if %errorlevel%==0 (
  echo The tablet rule is already there.
  pause
  exit /b 0
)
netsh advfirewall firewall add rule name="Hotel billing tablets" dir=in action=allow protocol=TCP localport=3780 profile=private,public
if errorlevel 1 (
  echo Right-click this file and choose Run as administrator, then try again.
  pause
  exit /b 1
)
echo Tablets on the hotel Wi-Fi can now open this PC.
pause
