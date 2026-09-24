@echo off
setlocal EnableExtensions DisableDelayedExpansion
title qBittorrent Restore

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

call :EnsureAdmin %*
if errorlevel 2 exit /b 0
if errorlevel 1 (
    echo.
    echo ERROR: Administrator privileges are required to restore Program Files.
    echo.
    pause
    exit /b 1
)

call :RequireQBittorrentClosed || goto :Failed

if exist "%EXTRACTDIR%" rd /s /q "%EXTRACTDIR%" >nul 2>&1
mkdir "%EXTRACTDIR%" >nul 2>&1
if errorlevel 1 (
    echo ERROR: Could not create the temporary extraction folder:
    echo "%EXTRACTDIR%"
    goto :Failed
)

set "QBT_ZIPFILE=%ZIPFILE%"
set "QBT_EXTRACT=%EXTRACTDIR%"

echo [ZIP] Verifying and extracting backup...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
 "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead($env:QBT_ZIPFILE); try { if($z.Entries.Count -lt 1){ throw 'Archive is empty.' } } finally { $z.Dispose() }; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:QBT_ZIPFILE,$env:QBT_EXTRACT)"
if errorlevel 1 (
    echo.
    echo ERROR: Backup ZIP is invalid or could not be extracted.
    goto :FailedKeepStage
)

set "SRC_ROAM=%EXTRACTDIR%\AppData\Roaming\qBittorrent"
set "SRC_LOCAL=%EXTRACTDIR%\AppData\Local\qBittorrent"
set "SRC_INSTALL=%EXTRACTDIR%\Program Files\qBittorrent"

rem Compatibility with the older backup layout: Users\<name>\AppData\...
if not exist "%SRC_ROAM%\" call :FindLegacyLayout

set "FOUND=0"

if exist "%SRC_ROAM%\" (
    echo [RESTORE] Roaming profile
    call :MirrorDir "%SRC_ROAM%" "%APPDATA%\qBittorrent" || goto :RestoreFailed
    set "FOUND=1"
) else (
    echo [SKIP] Roaming profile is not present in the backup
)

if exist "%SRC_LOCAL%\" (
    echo [RESTORE] Local profile
    call :MirrorDir "%SRC_LOCAL%" "%LOCALAPPDATA%\qBittorrent" || goto :RestoreFailed
    set "FOUND=1"
) else (
    echo [SKIP] Local profile is not present in the backup
)

if exist "%SRC_INSTALL%\" (
    call :DetectInstallDestination
    echo [RESTORE] qBittorrent installation
    call :MirrorDir "%SRC_INSTALL%" "%INSTALL_DST%" || goto :RestoreFailed
    set "FOUND=1"
) else (
    echo [SKIP] qBittorrent installation is not present in the backup
)

if "%FOUND%"=="0" (
    echo.
    echo ERROR: No qBittorrent data was found inside the backup.
    goto :FailedKeepStage
)

rd /s /q "%EXTRACTDIR%" >nul 2>&1

echo.
echo ==========================================
echo Restore completed successfully.
echo ==========================================
echo.
pause
exit /b 0

:MirrorDir
robocopy "%~1" "%~2" /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 exit /b 1
exit /b 0

:FindLegacyLayout
for /d %%U in ("%EXTRACTDIR%\Users\*") do call :CheckLegacyUser "%%~fU"
exit /b 0

:CheckLegacyUser
if not defined LEGACY_USER if exist "%~1\AppData\Roaming\qBittorrent\" set "LEGACY_USER=%~1"
if not defined LEGACY_USER if exist "%~1\AppData\Local\qBittorrent\" set "LEGACY_USER=%~1"
if not defined LEGACY_USER exit /b 0
set "SRC_ROAM=%LEGACY_USER%\AppData\Roaming\qBittorrent"
set "SRC_LOCAL=%LEGACY_USER%\AppData\Local\qBittorrent"
exit /b 0

:DetectInstallDestination
set "INSTALL_DST=%ProgramFiles%\qBittorrent"
if exist "%ProgramFiles%\qBittorrent\qbittorrent.exe" exit /b 0
if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\qBittorrent\qbittorrent.exe" set "INSTALL_DST=%ProgramFiles(x86)%\qBittorrent"
exit /b 0

:EnsureAdmin
fltmc >nul 2>&1
if not errorlevel 1 exit /b 0

if /I "%~1"=="--elevated" exit /b 1

set "QBT_SELF=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
 "try { $p=Start-Process -FilePath $env:QBT_SELF -ArgumentList '--elevated' -Verb RunAs -PassThru; exit 0 } catch { exit 1 }"
if errorlevel 1 exit /b 1
exit /b 2

:RequireQBittorrentClosed
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

:RestoreFailed
echo.
echo ERROR: A folder could not be restored completely.
goto :FailedKeepStage

:FailedKeepStage
echo.
echo Extracted backup was preserved for troubleshooting:
echo "%EXTRACTDIR%"
goto :FailedNoCleanup

:Failed
if exist "%EXTRACTDIR%" rd /s /q "%EXTRACTDIR%" >nul 2>&1

:FailedNoCleanup
echo.
echo Restore failed.
echo.
pause
exit /b 1
