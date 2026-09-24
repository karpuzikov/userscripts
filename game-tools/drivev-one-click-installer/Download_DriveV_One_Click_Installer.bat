@echo off
setlocal EnableExtensions
set "OUT=%~dp0DriveV_One_Click_Auto_Installer"
set "BASE=https://raw.githubusercontent.com/karpuzikov/userscripts/main/game-tools/drivev-one-click-installer"
mkdir "%OUT%" 2>nul
mkdir "%OUT%\Packages" 2>nul
for %%F in (DriveV_AutoInstaller.pyw drivev_installer_core.py manifest.json Install_DriveV.bat Restore_DriveV.bat README.md SOURCES.md) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '%BASE%/%%F' -OutFile '%OUT%\%%F'"
    if errorlevel 1 exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '%BASE%/Packages/README.txt' -OutFile '%OUT%\Packages\README.txt'"
if errorlevel 1 exit /b 1
echo Downloaded to:
echo %OUT%
pause