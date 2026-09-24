@echo off
setlocal EnableExtensions DisableDelayedExpansion
title CUE Filename Fixer - UTF-8 Recursive

call :EnsureWinget
if errorlevel 1 goto :failed
call :EnsurePython313
if errorlevel 1 goto :failed

set "APPDIR=%LOCALAPPDATA%\KarpuzikovTools\CUE_Filename_Fixer"
set "SCRIPT=%APPDIR%\CUE_Filename_Fixer_UTF8_Recursive.pyw"
set "URL=https://raw.githubusercontent.com/karpuzikov/userscripts/main/audio-tools/cue-filename-fixer/CUE_Filename_Fixer_UTF8_Recursive.pyw"

mkdir "%APPDIR%" 2>nul
call :DownloadLatest "%URL%" "%SCRIPT%"
if errorlevel 1 goto :failed

start "" "%PYTHONW313%" "%SCRIPT%"
exit /b 0

:DownloadLatest
set "DL_URL=%~1"
set "DL_DEST=%~2"
set "DL_TEMP=%~2.download"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $env:DL_URL -OutFile $env:DL_TEMP"
if errorlevel 1 (
    if exist "%DL_DEST%" (
        echo [WARNING] Could not download the latest script. Using the cached copy.
        exit /b 0
    )
    exit /b 1
)
move /y "%DL_TEMP%" "%DL_DEST%" >nul
exit /b %ERRORLEVEL%

:failed
echo.
echo ERROR: Automatic setup failed.
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
if not defined PYTHON313 (
    echo ERROR: Python 3.13 was installed but could not be located.
    exit /b 1
)
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
