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

if not exist "%~dp0DriveV_AutoInstaller.pyw" (
    echo ERROR: DriveV_AutoInstaller.pyw is missing.
    goto :failed
)
if not exist "%~dp0drivev_installer_core.py" (
    echo ERROR: drivev_installer_core.py is missing.
    goto :failed
)

start "" "%PYTHONW313%" "%~dp0DriveV_AutoInstaller.pyw" %*
exit /b 0

:failed
echo.
echo ERROR: Automatic dependency setup failed.
echo Check the internet connection and Windows software-installation permissions.
pause
exit /b 1

:EnsureWinget
set "WINGET="
where winget.exe >nul 2>&1
if not errorlevel 1 set "WINGET=winget.exe"
if not defined WINGET if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" set "WINGET=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"
if not defined WINGET (
    echo [SETUP] WinGet is not installed. Installing the latest WinGet...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
     "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; try { if(-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)){ Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force | Out-Null }; if(-not (Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue)){ Register-PSRepository -Default }; Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; Install-Module -Name Microsoft.WinGet.Client -Repository PSGallery -Scope CurrentUser -Force -AllowClobber; Import-Module Microsoft.WinGet.Client -Force; Repair-WinGetPackageManager -Latest -Force } catch { $tmp=Join-Path $env:TEMP 'Microsoft.DesktopAppInstaller.msixbundle'; Invoke-WebRequest -UseBasicParsing 'https://aka.ms/getwinget' -OutFile $tmp; Add-AppxPackage -Path $tmp; Remove-Item $tmp -Force -ErrorAction SilentlyContinue }"
    if errorlevel 1 exit /b 1
    if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" set "WINGET=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"
    if not defined WINGET (
        where winget.exe >nul 2>&1
        if not errorlevel 1 set "WINGET=winget.exe"
    )
)
if not defined WINGET exit /b 1
"%WINGET%" source update >nul 2>&1
exit /b 0

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
