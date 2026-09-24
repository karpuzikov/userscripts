@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Current Artist Names Picard Plugin Downloader

call :EnsureWinget
if errorlevel 1 goto :failed

call :FindPicard
if defined PICARD_EXE (
    "%WINGET%" list --id MusicBrainz.Picard -e >nul 2>&1
    if not errorlevel 1 (
        call :EnsureWingetPackage MusicBrainz.Picard
    ) else (
        echo [SETUP] Existing non-WinGet Picard detected. Its release channel will be preserved.
    )
) else (
    call :EnsureWingetPackage MusicBrainz.Picard
    if errorlevel 1 goto :failed
)

set "OUT=%~dp0Current_Artist_Names_Picard_Plugin"
set "BASE=https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/current-artist-names"
mkdir "%OUT%" 2>nul

for %%F in (__init__.py MANIFEST.toml) do (
    call :Download "%BASE%/%%F" "%OUT%\%%F"
    if errorlevel 1 goto :failed
)

echo.
echo Downloaded to:
echo "%OUT%"
pause
exit /b 0

:FindPicard
set "PICARD_EXE="
for /f "delims=" %%P in ('where picard.exe 2^>nul') do if not defined PICARD_EXE set "PICARD_EXE=%%P"
if not defined PICARD_EXE if exist "%ProgramFiles%\MusicBrainz Picard\picard.exe" set "PICARD_EXE=%ProgramFiles%\MusicBrainz Picard\picard.exe"
if not defined PICARD_EXE if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\MusicBrainz Picard\picard.exe" set "PICARD_EXE=%ProgramFiles(x86)%\MusicBrainz Picard\picard.exe"
if not defined PICARD_EXE if exist "%LOCALAPPDATA%\Programs\MusicBrainz Picard\picard.exe" set "PICARD_EXE=%LOCALAPPDATA%\Programs\MusicBrainz Picard\picard.exe"
exit /b 0

:Download
set "DL_URL=%~1"
set "DL_DEST=%~2"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $env:DL_URL -OutFile $env:DL_DEST"
exit /b %ERRORLEVEL%

:failed
echo.
echo ERROR: Picard/plugin setup failed.
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
