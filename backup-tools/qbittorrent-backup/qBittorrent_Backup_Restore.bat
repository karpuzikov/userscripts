@echo off
setlocal EnableExtensions DisableDelayedExpansion
title qBittorrent Backup and Restore

call :EnsureWinget
if errorlevel 1 (
    echo.
    echo ERROR: Dependency bootstrap failed.
    pause
    exit /b 1
)

if /I "%~1"=="--backup" goto Backup
if /I "%~1"=="--restore" (
    if /I "%~2"=="--elevated" set "QBT_RESTORE_ELEVATED=1"
    goto Restore
)

:Menu
cls
echo.
echo ==========================================
echo       qBittorrent Backup and Restore
echo ==========================================
echo.
echo  [1] Create backup
echo  [2] Restore newest backup
echo  [3] Exit
echo.
choice /C 123 /N /M "Select an option: "
if errorlevel 3 exit /b 0
if errorlevel 2 goto Restore
if errorlevel 1 goto Backup
goto Menu

:Backup
set "CURDIR=%~dp0"
for /f "usebackq delims=" %%T in (`powershell.exe -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd-HH-mm'"`) do set "TIMESTAMP=%%T"
if not defined TIMESTAMP (
    echo ERROR: Could not generate backup timestamp.
    pause
    exit /b 1
)
set "ZIPFILE=%CURDIR%qBittorrent_Backup_%TIMESTAMP%.zip"
set "TMPZIP=%CURDIR%qBittorrent_Backup_%TIMESTAMP%.tmp.zip"
if exist "%ZIPFILE%" (
    echo ERROR: A backup for this minute already exists:
    echo "%ZIPFILE%"
    echo.
    echo Run the backup again after the minute changes.
    pause
    exit /b 1
)
set "STAGE=%TEMP%\qBittorrent_Backup_Stage_%RANDOM%_%RANDOM%"

set "ROAMING_SRC=%APPDATA%\qBittorrent"
set "LOCAL_SRC=%LOCALAPPDATA%\qBittorrent"
set "INSTALL_SRC="

if exist "%ProgramFiles%\qBittorrent\qbittorrent.exe" set "INSTALL_SRC=%ProgramFiles%\qBittorrent"
if not defined INSTALL_SRC if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\qBittorrent\qbittorrent.exe" set "INSTALL_SRC=%ProgramFiles(x86)%\qBittorrent"

cls
echo.
echo ==========================================
echo          qBittorrent Backup
echo ==========================================
echo.

call :B_RequireQBittorrentClosed || goto :B_Failed

if exist "%STAGE%" rd /s /q "%STAGE%" >nul 2>&1
mkdir "%STAGE%" >nul 2>&1
if errorlevel 1 (
    echo ERROR: Could not create the temporary staging folder:
    echo "%STAGE%"
    goto :B_Failed
)

set "PROFILE_FOUND=0"

if exist "%ROAMING_SRC%\" (
    echo [COPY] Roaming profile
    call :B_CopyDir "%ROAMING_SRC%" "%STAGE%\AppData\Roaming\qBittorrent" || goto :B_CopyFailed
    set "PROFILE_FOUND=1"
) else (
    echo [SKIP] Roaming profile not found
)

if exist "%LOCAL_SRC%\" (
    echo [COPY] Local profile
    call :B_CopyDir "%LOCAL_SRC%" "%STAGE%\AppData\Local\qBittorrent" || goto :B_CopyFailed
    set "PROFILE_FOUND=1"
) else (
    echo [SKIP] Local profile not found
)

if defined INSTALL_SRC (
    echo [COPY] qBittorrent installation
    call :B_CopyDir "%INSTALL_SRC%" "%STAGE%\Program Files\qBittorrent" || goto :B_CopyFailed
) else (
    echo [SKIP] qBittorrent installation folder not found
)

if "%PROFILE_FOUND%"=="0" (
    echo.
    echo ERROR: No qBittorrent profile folders were found.
    goto :B_FailedKeepStage
)

> "%STAGE%\Backup_Info.txt" (
    echo qBittorrent backup
    echo Created: %DATE% %TIME%
    echo Computer: %COMPUTERNAME%
    echo User: %USERNAME%
    if defined INSTALL_SRC echo Installation source: %INSTALL_SRC%
)

if exist "%TMPZIP%" del /f /q "%TMPZIP%" >nul 2>&1

set "QBT_STAGE=%STAGE%"
set "QBT_TMPZIP=%TMPZIP%"

echo.
echo [ZIP] Creating archive...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
 "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:QBT_STAGE,$env:QBT_TMPZIP,[System.IO.Compression.CompressionLevel]::Optimal,$false); $z=[System.IO.Compression.ZipFile]::OpenRead($env:QBT_TMPZIP); try { if($z.Entries.Count -lt 1){ throw 'Archive is empty.' } } finally { $z.Dispose() }"
if errorlevel 1 (
    echo.
    echo ERROR: Failed to create or verify the ZIP archive.
    goto :B_FailedKeepStage
)

if not exist "%TMPZIP%" (
    echo.
    echo ERROR: ZIP archive was not created.
    goto :B_FailedKeepStage
)

for %%Z in ("%TMPZIP%") do if %%~zZ LEQ 0 (
    echo.
    echo ERROR: ZIP archive is empty.
    goto :B_FailedKeepStage
)

move /y "%TMPZIP%" "%ZIPFILE%" >nul
if errorlevel 1 (
    echo.
    echo ERROR: Could not replace the final backup file.
    echo Temporary archive preserved at:
    echo "%TMPZIP%"
    goto :B_FailedKeepStage
)

rd /s /q "%STAGE%" >nul 2>&1

echo.
echo ==========================================
echo Backup completed successfully.
echo ==========================================
echo "%ZIPFILE%"
echo.
pause
exit /b 0

:B_CopyDir
robocopy "%~1" "%~2" /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 exit /b 1
exit /b 0

:B_RequireQBittorrentClosed
tasklist /FI "IMAGENAME eq qbittorrent.exe" 2>nul | find /I "qbittorrent.exe" >nul
if errorlevel 1 exit /b 0

echo qBittorrent is currently running.
echo.
echo Exit qBittorrent completely first - Ctrl+Q in qBittorrent -
echo then press any key to continue.
echo.
pause >nul

tasklist /FI "IMAGENAME eq qbittorrent.exe" 2>nul | find /I "qbittorrent.exe" >nul
if errorlevel 1 exit /b 0

echo.
echo ERROR: qBittorrent is still running.
echo Backup was not started to avoid inconsistent resume/config data.
exit /b 1

:B_CopyFailed
echo.
echo ERROR: A folder could not be copied completely.

goto :B_FailedKeepStage

:B_FailedKeepStage
echo.
echo Staging data was preserved for troubleshooting:
echo "%STAGE%"
goto :B_FailedNoCleanup

:B_Failed
if exist "%STAGE%" rd /s /q "%STAGE%" >nul 2>&1

:B_FailedNoCleanup
echo.
echo Backup failed. No completed timestamped backup was created.
echo.
pause
exit /b 1

:Restore
set "CURDIR=%~dp0"
set "ZIPFILE="
for /f "delims=" %%F in ('dir /b /a-d /o-d "%CURDIR%qBittorrent_Backup_????-??-??-??-??.zip" 2^>nul') do if not defined ZIPFILE set "ZIPFILE=%CURDIR%%%F"
if not defined ZIPFILE if exist "%CURDIR%qBittorrent_Backup.zip" set "ZIPFILE=%CURDIR%qBittorrent_Backup.zip"
set "EXTRACTDIR=%TEMP%\qBittorrent_Restore_Stage_%RANDOM%_%RANDOM%"

cls
echo.
echo ==========================================
echo          qBittorrent Restore
echo ==========================================
echo.

if not defined ZIPFILE (
    echo ERROR: No qBittorrent backup ZIP was found in:
    echo "%CURDIR%"
    echo.
    echo Expected a file such as:
    echo qBittorrent_Backup_2026-09-24-06-52.zip
    echo.
    echo The old qBittorrent_Backup.zip name is also supported.
    echo.
    pause
    exit /b 1
)

echo Using backup:
echo "%ZIPFILE%"
echo.

call :R_EnsureAdmin
fltmc >nul 2>&1
if not errorlevel 1 exit /b 0

if defined QBT_RESTORE_ELEVATED exit /b 1

set "QBT_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
 "try { $p=Start-Process -FilePath $env:QBT_SELF -ArgumentList '--restore','--elevated' -Verb RunAs -PassThru; exit 0 } catch { exit 1 }"
if errorlevel 1 exit /b 1
exit /b 2

:R_RequireQBittorrentClosed || goto :R_Failed

if exist "%EXTRACTDIR%" rd /s /q "%EXTRACTDIR%" >nul 2>&1
mkdir "%EXTRACTDIR%" >nul 2>&1
if errorlevel 1 (
    echo ERROR: Could not create the temporary extraction folder:
    echo "%EXTRACTDIR%"
    goto :R_Failed
)

set "QBT_ZIPFILE=%ZIPFILE%"
set "QBT_EXTRACT=%EXTRACTDIR%"

echo [ZIP] Verifying and extracting backup...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
 "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead($env:QBT_ZIPFILE); try { if($z.Entries.Count -lt 1){ throw 'Archive is empty.' } } finally { $z.Dispose() }; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:QBT_ZIPFILE,$env:QBT_EXTRACT)"
if errorlevel 1 (
    echo.
    echo ERROR: Backup ZIP is invalid or could not be extracted.
    goto :R_FailedKeepStage
)

set "SRC_ROAM=%EXTRACTDIR%\AppData\Roaming\qBittorrent"
set "SRC_LOCAL=%EXTRACTDIR%\AppData\Local\qBittorrent"
set "SRC_INSTALL=%EXTRACTDIR%\Program Files\qBittorrent"

rem Compatibility with the older backup layout: Users\<name>\AppData\...
if not exist "%SRC_ROAM%\" call :R_FindLegacyLayout

set "FOUND=0"

if exist "%SRC_ROAM%\" (
    echo [RESTORE] Roaming profile
    call :R_MirrorDir "%SRC_ROAM%" "%APPDATA%\qBittorrent" || goto :R_RestoreFailed
    set "FOUND=1"
) else (
    echo [SKIP] Roaming profile is not present in the backup
)

if exist "%SRC_LOCAL%\" (
    echo [RESTORE] Local profile
    call :R_MirrorDir "%SRC_LOCAL%" "%LOCALAPPDATA%\qBittorrent" || goto :R_RestoreFailed
    set "FOUND=1"
) else (
    echo [SKIP] Local profile is not present in the backup
)

if exist "%SRC_INSTALL%\" (
    call :R_DetectInstallDestination
    echo [RESTORE] qBittorrent installation
    call :R_MirrorDir "%SRC_INSTALL%" "%INSTALL_DST%" || goto :R_RestoreFailed
    set "FOUND=1"
) else (
    echo [SKIP] qBittorrent installation is not present in the backup
)

if "%FOUND%"=="0" (
    echo.
    echo ERROR: No qBittorrent data was found inside the backup.
    goto :R_FailedKeepStage
)

rd /s /q "%EXTRACTDIR%" >nul 2>&1

echo.
echo ==========================================
echo Restore completed successfully.
echo ==========================================
echo.
pause
exit /b 0

:R_MirrorDir
robocopy "%~1" "%~2" /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 exit /b 1
exit /b 0

:R_FindLegacyLayout
for /d %%U in ("%EXTRACTDIR%\Users\*") do call :R_CheckLegacyUser "%%~fU"
exit /b 0

:R_CheckLegacyUser
if not defined LEGACY_USER if exist "%~1\AppData\Roaming\qBittorrent\" set "LEGACY_USER=%~1"
if not defined LEGACY_USER if exist "%~1\AppData\Local\qBittorrent\" set "LEGACY_USER=%~1"
if not defined LEGACY_USER exit /b 0
set "SRC_ROAM=%LEGACY_USER%\AppData\Roaming\qBittorrent"
set "SRC_LOCAL=%LEGACY_USER%\AppData\Local\qBittorrent"
exit /b 0

:R_DetectInstallDestination
set "INSTALL_DST=%ProgramFiles%\qBittorrent"
if exist "%ProgramFiles%\qBittorrent\qbittorrent.exe" exit /b 0
if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\qBittorrent\qbittorrent.exe" set "INSTALL_DST=%ProgramFiles(x86)%\qBittorrent"
exit /b 0

:R_EnsureAdmin
fltmc >nul 2>&1
if not errorlevel 1 exit /b 0

if /I "%~1"=="--elevated" exit /b 1

set "QBT_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
 "try { $p=Start-Process -FilePath $env:QBT_SELF -ArgumentList '--elevated' -Verb RunAs -PassThru; exit 0 } catch { exit 1 }"
if errorlevel 1 exit /b 1
exit /b 2

:R_RequireQBittorrentClosed
tasklist /FI "IMAGENAME eq qbittorrent.exe" 2>nul | find /I "qbittorrent.exe" >nul
if errorlevel 1 exit /b 0

echo qBittorrent is currently running.
echo.
echo Exit qBittorrent completely first - Ctrl+Q in qBittorrent -
echo then press any key to continue.
echo.
pause >nul

tasklist /FI "IMAGENAME eq qbittorrent.exe" 2>nul | find /I "qbittorrent.exe" >nul
if errorlevel 1 exit /b 0

echo.
echo ERROR: qBittorrent is still running.
echo Restore was not started to avoid corrupting live qBittorrent data.
exit /b 1

:R_RestoreFailed
echo.
echo ERROR: A folder could not be restored completely.
goto :R_FailedKeepStage

:R_FailedKeepStage
echo.
echo Extracted backup was preserved for troubleshooting:
echo "%EXTRACTDIR%"
goto :R_FailedNoCleanup

:R_Failed
if exist "%EXTRACTDIR%" rd /s /q "%EXTRACTDIR%" >nul 2>&1

:R_FailedNoCleanup
echo.
echo Restore failed.
echo.
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
