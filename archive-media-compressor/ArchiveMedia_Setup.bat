@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Archive Media Compressor Setup

call :EnsureWinget
if errorlevel 1 goto :failed
call :EnsureWingetPackage Microsoft.PowerShell
if errorlevel 1 goto :failed
call :EnsureWingetPackage Gyan.FFmpeg
if errorlevel 1 goto :failed
call :EnsureWingetPackage ImageMagick.ImageMagick
if errorlevel 1 goto :failed

set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WinGet\Links;%ProgramFiles%\PowerShell\7"
for /d %%D in ("%ProgramFiles%\ImageMagick-*") do if exist "%%~fD\magick.exe" set "PATH=%PATH%;%%~fD"

set "OUT=%~dp0ArchiveMedia"
set "ZIPTMP=%TEMP%\ArchiveMedia_%RANDOM%_%RANDOM%.zip"
set "DL_URL=https://raw.githubusercontent.com/karpuzikov/userscripts/main/archive-media-compressor/ArchiveMedia.zip"
set "DL_DEST=%ZIPTMP%"

echo [SETUP] Downloading the latest Archive Media Compressor...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $env:DL_URL -OutFile $env:DL_DEST"
if errorlevel 1 goto :failed_cleanup

if exist "%OUT%" rd /s /q "%OUT%" >nul 2>&1
mkdir "%OUT%" >nul 2>&1
set "ARCHIVE_MEDIA_OUT=%OUT%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:DL_DEST -DestinationPath $env:ARCHIVE_MEDIA_OUT -Force"
if errorlevel 1 goto :failed_cleanup

del /f /q "%ZIPTMP%" >nul 2>&1

if not exist "%OUT%\ArchiveMedia.bat" (
    echo ERROR: ArchiveMedia.bat was not found after extraction.
    goto :failed
)

call "%OUT%\ArchiveMedia.bat"
exit /b %ERRORLEVEL%

:failed_cleanup
if exist "%ZIPTMP%" del /f /q "%ZIPTMP%" >nul 2>&1

:failed
echo.
echo ERROR: Archive Media Compressor setup failed.
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
