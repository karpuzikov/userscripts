@echo off
setlocal EnableExtensions DisableDelayedExpansion
title AudioChecker UTF-8 Patch Installer

call :EnsureWinget
if errorlevel 1 (
    echo ERROR: Dependency bootstrap failed.
    pause
    exit /b 1
)

set /p "ROOT=Enter the folder containing achkgui.exe: "
set "ROOT=%ROOT:"=%"
if not exist "%ROOT%\achkgui.exe" (
    echo achkgui.exe was not found in that folder.
    pause
    exit /b 1
)

set "AUDIOCHECKER_ROOT=%ROOT%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $root=$env:AUDIOCHECKER_ROOT; $items=@(@('achkgui.exe.manifest','AudioChecker.UTF8.achkgui'),@('Codecs\APE\mac.exe.manifest','AudioChecker.UTF8.Codecs.APE.mac'),@('Codecs\Analyzer\aucdtect.exe.manifest','AudioChecker.UTF8.Codecs.Analyzer.aucdtect'),@('Codecs\FLAC\flac.exe.manifest','AudioChecker.UTF8.Codecs.FLAC.flac'),@('Codecs\LPAC\lpac.exe.manifest','AudioChecker.UTF8.Codecs.LPAC.lpac'),@('Codecs\SHN\shortn32.exe.manifest','AudioChecker.UTF8.Codecs.SHN.shortn32')); $utf8=New-Object Text.UTF8Encoding($false); foreach($item in $items){ $dest=Join-Path $root $item[0]; [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest)) ^| Out-Null; $xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + [Environment]::NewLine + '<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">' + [Environment]::NewLine + '  <assemblyIdentity type="win32" name="'+$item[1]+'" version="1.0.0.0" processorArchitecture="x86"/>' + [Environment]::NewLine + '  <application>' + [Environment]::NewLine + '    <windowsSettings>' + [Environment]::NewLine + '      <activeCodePage xmlns="http://schemas.microsoft.com/SMI/2019/WindowsSettings">UTF-8</activeCodePage>' + [Environment]::NewLine + '    </windowsSettings>' + [Environment]::NewLine + '  </application>' + [Environment]::NewLine + '</assembly>' + [Environment]::NewLine; [IO.File]::WriteAllText($dest,$xml,$utf8) }"
if errorlevel 1 (
    echo.
    echo ERROR: Could not create one or more manifests.
    pause
    exit /b 1
)

echo.
echo UTF-8 manifests installed. Restart AudioChecker and test a Unicode path.
pause
exit /b 0

:EnsureWinget
if errorlevel 1 (
    echo ERROR: Dependency bootstrap failed.
    pause
    exit /b 1
)

set "BASE=https://raw.githubusercontent.com/karpuzikov/userscripts/main/audio-tools/audiochecker-utf8-patch"
set /p "ROOT=Enter the folder containing achkgui.exe: "
set "ROOT=%ROOT:"=%"
if not exist "%ROOT%\achkgui.exe" (
    echo achkgui.exe was not found in that folder.
    pause
    exit /b 1
)

for %%D in ("Codecs\APE" "Codecs\Analyzer" "Codecs\FLAC" "Codecs\LPAC" "Codecs\SHN") do mkdir "%ROOT%\%%~D" 2>nul
call :get "achkgui.exe.manifest" "%ROOT%\achkgui.exe.manifest" || goto :download_failed
call :get "Codecs/APE/mac.exe.manifest" "%ROOT%\Codecs\APE\mac.exe.manifest" || goto :download_failed
call :get "Codecs/Analyzer/aucdtect.exe.manifest" "%ROOT%\Codecs\Analyzer\aucdtect.exe.manifest" || goto :download_failed
call :get "Codecs/FLAC/flac.exe.manifest" "%ROOT%\Codecs\FLAC\flac.exe.manifest" || goto :download_failed
call :get "Codecs/LPAC/lpac.exe.manifest" "%ROOT%\Codecs\LPAC\lpac.exe.manifest" || goto :download_failed
call :get "Codecs/SHN/shortn32.exe.manifest" "%ROOT%\Codecs\SHN\shortn32.exe.manifest" || goto :download_failed

echo.
echo UTF-8 manifests installed. Restart AudioChecker and test a Unicode path.
pause
exit /b 0

:get
set "DL_URL=%BASE%/%~1"
set "DL_DEST=%~2"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $env:DL_URL -OutFile $env:DL_DEST"
exit /b %ERRORLEVEL%

:download_failed
echo ERROR: A required manifest could not be downloaded.
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
