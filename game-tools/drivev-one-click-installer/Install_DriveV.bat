@echo off
setlocal EnableExtensions DisableDelayedExpansion
title DriveV One-Click Auto Installer
cd /d "%~dp0"

call :EnsureWinget
if errorlevel 1 goto :failed
call :EnsurePython313
if errorlevel 1 goto :failed
call :EnsureWingetPackage 7zip.7zip
if errorlevel 1 goto :failed

set "APPDIR=%LOCALAPPDATA%\KarpuzikovTools\DriveV_AutoInstaller"
set "SCRIPT=%APPDIR%\DriveV_AutoInstaller.pyw"
set "DL_URL=https://raw.githubusercontent.com/karpuzikov/userscripts/main/game-tools/drivev-one-click-installer/DriveV_AutoInstaller.pyw"
set "DL_TEMP=%SCRIPT%.download"

mkdir "%APPDIR%" >nul 2>&1

echo [SETUP] Downloading/updating DriveV Auto Installer...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $env:DL_URL -OutFile $env:DL_TEMP"
if errorlevel 1 (
    if exist "%SCRIPT%" (
        echo [WARNING] Could not download the latest version. Using the cached copy.
    ) else (
        goto :failed
    )
) else (
    move /y "%DL_TEMP%" "%SCRIPT%" >nul
    if errorlevel 1 goto :failed
)

start "" "%PYTHONW313%" "%SCRIPT%" %*
exit /b 0

:failed
if defined DL_TEMP if exist "%DL_TEMP%" del /f /q "%DL_TEMP%" >nul 2>&1
echo.
echo ERROR: Automatic DriveV setup failed.
echo Check the internet connection and Windows software-installation permissions.
pause
exit /b 1

:EnsureWingetPackage
setlocal
set "PKG=%~1"
"%WINGET%" list --id "%PKG%" -e >nul 2>&1
if errorlevel 1 (
    echo [SETUP] Installing %PKG%...
    "%WINGET%" install --id "%PKG%" -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if errorlevel 1 (
        endlocal & exit /b 1
    )
) else (
    echo [SETUP] Checking %PKG% for updates...
    "%WINGET%" upgrade --id "%PKG%" -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity >nul 2>&1
)
endlocal & exit /b 0

:EnsurePython313
call :EnsureWingetPackage Python.Python.3.13
if errorlevel 1 exit /b 1
call :FindPython313
if not defined PYTHON313 exit /b 1
exit /b 0

:FindPython313
set "PYTHON313="
set "PYTHONW313="
if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" set "PYTHON313=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not defined PYTHON313 if exist "%ProgramFiles%\Python313\python.exe" set "PYTHON313=%ProgramFiles%\Python313\python.exe"
if not defined PYTHON313 if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\Python313-32\python.exe" set "PYTHON313=%ProgramFiles(x86)%\Python313-32\python.exe"
if not defined PYTHON313 (
    where py.exe >nul 2>&1
    if not errorlevel 1 (
        for /f "delims=" %%P in ('py.exe -3.13 -c "import sys; print(sys.executable)" 2^>nul') do if not defined PYTHON313 set "PYTHON313=%%P"
    )
)
if defined PYTHON313 (
    for %%P in ("%PYTHON313%") do if exist "%%~dpPpythonw.exe" set "PYTHONW313=%%~dpPpythonw.exe"
)
if not defined PYTHONW313 set "PYTHONW313=%PYTHON313%"
exit /b 0
