@echo off
setlocal EnableExtensions DisableDelayedExpansion
title SyncTrayzor and Syncthing Backup

call :EnsureWinget
if errorlevel 1 (
    echo ERROR: Dependency bootstrap failed.
    pause
    exit /b 1
)

set "CURDIR=%~dp0"
if "%CURDIR:~-1%"=="\" set "CURDIR=%CURDIR:~0,-1%"

if "%~1"=="" (
    set "USERFOLDER=%USERNAME%"
    set "SRC1=%APPDATA%\SyncTrayzor"
    set "SRC2=%LOCALAPPDATA%\Syncthing"
) else (
    set "USERFOLDER=%~1"
    set "SRC1=%SystemDrive%\Users\%~1\AppData\Roaming\SyncTrayzor"
    set "SRC2=%SystemDrive%\Users\%~1\AppData\Local\Syncthing"
)

set "TMPDIR=%TEMP%\SyncTrayzor_Backup_%RANDOM%_%RANDOM%"
set "LOG=%CURDIR%\backup.log"

for /f "delims=" %%T in ('powershell.exe -NoProfile -Command "Get-Date -Format ''yyyy-MM-dd_HH-mm-ss''"') do set "TS=%%T"
if not defined TS (
    echo ERROR: Could not generate a timestamp.
    pause
    exit /b 1
)

set "ZIP=%CURDIR%\SyncBack_%USERFOLDER%_%TS%.zip"
set "TMPZIP=%CURDIR%\SyncBack_%USERFOLDER%_%TS%.tmp.zip"

>>"%LOG%" echo [%date% %time%] --- Backup started for %USERFOLDER% ---

if not exist "%SRC1%\" if not exist "%SRC2%\" (
    echo Neither SyncTrayzor nor Syncthing configuration folder was found.
    >>"%LOG%" echo [%date% %time%] ERROR: No source folders found.
    pause
    exit /b 2
)

call :RequireAppsClosed
if errorlevel 1 exit /b 5

if exist "%TMPDIR%" rd /s /q "%TMPDIR%" >nul 2>&1
mkdir "%TMPDIR%\Users\%USERFOLDER%\AppData\Roaming" >nul 2>&1
mkdir "%TMPDIR%\Users\%USERFOLDER%\AppData\Local" >nul 2>&1

if exist "%SRC1%\" (
    echo [COPY] SyncTrayzor
    call :CopyDir "%SRC1%" "%TMPDIR%\Users\%USERFOLDER%\AppData\Roaming\SyncTrayzor"
    if errorlevel 1 goto :copy_error
)
if exist "%SRC2%\" (
    echo [COPY] Syncthing
    call :CopyDir "%SRC2%" "%TMPDIR%\Users\%USERFOLDER%\AppData\Local\Syncthing"
    if errorlevel 1 goto :copy_error
)

set "SYNC_STAGE=%TMPDIR%"
set "SYNC_TMPZIP=%TMPZIP%"
if exist "%TMPZIP%" del /f /q "%TMPZIP%" >nul 2>&1

echo [ZIP] Creating and verifying archive...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
 "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:SYNC_STAGE,$env:SYNC_TMPZIP,[System.IO.Compression.CompressionLevel]::Optimal,$false); $z=[System.IO.Compression.ZipFile]::OpenRead($env:SYNC_TMPZIP); try { if($z.Entries.Count -lt 1){ throw 'Archive is empty.' } } finally { $z.Dispose() }"
if errorlevel 1 goto :zip_error
if not exist "%TMPZIP%" goto :zip_error
for %%Z in ("%TMPZIP%") do if %%~zZ LEQ 0 goto :zip_error

move /y "%TMPZIP%" "%ZIP%" >nul
if errorlevel 1 goto :zip_error

rd /s /q "%TMPDIR%" >nul 2>&1
>>"%LOG%" echo [%date% %time%] OK: %ZIP%

echo.
echo Backup created:
echo "%ZIP%"
pause
exit /b 0

:CopyDir
robocopy "%~1" "%~2" /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP >>"%LOG%" 2>&1
if errorlevel 8 exit /b 1
exit /b 0

:RequireAppsClosed
set "RUNNING=0"
tasklist /FI "IMAGENAME eq SyncTrayzor.exe" 2>nul | find /I "SyncTrayzor.exe" >nul && set "RUNNING=1"
tasklist /FI "IMAGENAME eq syncthing.exe" 2>nul | find /I "syncthing.exe" >nul && set "RUNNING=1"
if "%RUNNING%"=="0" exit /b 0
echo.
echo SyncTrayzor or Syncthing is currently running.
echo Exit them completely, then press any key to continue.
pause >nul
set "RUNNING=0"
tasklist /FI "IMAGENAME eq SyncTrayzor.exe" 2>nul | find /I "SyncTrayzor.exe" >nul && set "RUNNING=1"
tasklist /FI "IMAGENAME eq syncthing.exe" 2>nul | find /I "syncthing.exe" >nul && set "RUNNING=1"
if "%RUNNING%"=="0" exit /b 0
echo ERROR: SyncTrayzor or Syncthing is still running.
exit /b 1

:copy_error
>>"%LOG%" echo [%date% %time%] ERROR: Robocopy failed.
echo ERROR: File copy failed. Staging data was preserved:
echo "%TMPDIR%"
pause
exit /b 3

:zip_error
>>"%LOG%" echo [%date% %time%] ERROR: ZIP creation failed.
echo ERROR: ZIP creation or verification failed. Staging data was preserved:
echo "%TMPDIR%"
pause
exit /b 4

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
