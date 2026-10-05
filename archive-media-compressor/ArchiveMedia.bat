@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Archive Media Compressor

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

set "PWSH="
for /f "delims=" %%P in ('where pwsh.exe 2^>nul') do if not defined PWSH set "PWSH=%%P"
if not defined PWSH if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not defined PWSH goto :failed

set "WORK=%TEMP%\ArchiveMedia_%RANDOM%_%RANDOM%"
set "PAYLOAD_SELF=%~f0"
set "PAYLOAD_ZIP=%WORK%\ArchiveMedia.zip"
set "PAYLOAD_DIR=%WORK%\app"
mkdir "%WORK%" >nul 2>&1
mkdir "%PAYLOAD_DIR%" >nul 2>&1

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $lines=Get-Content -LiteralPath $env:PAYLOAD_SELF; $m=[Array]::LastIndexOf($lines,'::ARCHIVE_PAYLOAD'); if($m -lt 0){throw 'Embedded ArchiveMedia payload not found.'}; $b64=($lines[($m+1)..($lines.Count-1)] -join ''); [IO.File]::WriteAllBytes($env:PAYLOAD_ZIP,[Convert]::FromBase64String($b64)); Expand-Archive -LiteralPath $env:PAYLOAD_ZIP -DestinationPath $env:PAYLOAD_DIR -Force"
if errorlevel 1 goto :failed_cleanup

if not exist "%PAYLOAD_DIR%\ArchiveMedia.ps1" goto :failed_cleanup

"%PWSH%" -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%PAYLOAD_DIR%\ArchiveMedia.ps1"
set "RC=%ERRORLEVEL%"
rd /s /q "%WORK%" >nul 2>&1
exit /b %RC%

:failed_cleanup
if defined WORK if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1

:failed
echo.
echo ERROR: Archive Media Compressor setup or launch failed.
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
    if errorlevel 1 (
        echo ERROR: Automatic WinGet installation failed.
        exit /b 1
    )
    if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" set "WINGET=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"
    if not defined WINGET (
        where winget.exe >nul 2>&1
        if not errorlevel 1 set "WINGET=winget.exe"
    )
)
if not defined WINGET (
    echo ERROR: WinGet is still unavailable after installation.
    exit /b 1
)
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

::ARCHIVE_PAYLOAD
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[...CONTENT TRUNCATED FOR BREVIT
Y IN TOOL INPUT...]
