@echo off
setlocal EnableExtensions DisableDelayedExpansion
title qBittorrent Backup

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

call :RequireQBittorrentClosed || goto :Failed

if exist "%STAGE%" rd /s /q "%STAGE%" >nul 2>&1
mkdir "%STAGE%" >nul 2>&1
if errorlevel 1 (
    echo ERROR: Could not create the temporary staging folder:
    echo "%STAGE%"
    goto :Failed
)

set "PROFILE_FOUND=0"

if exist "%ROAMING_SRC%\" (
    echo [COPY] Roaming profile
    call :CopyDir "%ROAMING_SRC%" "%STAGE%\AppData\Roaming\qBittorrent" || goto :CopyFailed
    set "PROFILE_FOUND=1"
) else (
    echo [SKIP] Roaming profile not found
)

if exist "%LOCAL_SRC%\" (
    echo [COPY] Local profile
    call :CopyDir "%LOCAL_SRC%" "%STAGE%\AppData\Local\qBittorrent" || goto :CopyFailed
    set "PROFILE_FOUND=1"
) else (
    echo [SKIP] Local profile not found
)

if defined INSTALL_SRC (
    echo [COPY] qBittorrent installation
    call :CopyDir "%INSTALL_SRC%" "%STAGE%\Program Files\qBittorrent" || goto :CopyFailed
) else (
    echo [SKIP] qBittorrent installation folder not found
)

if "%PROFILE_FOUND%"=="0" (
    echo.
    echo ERROR: No qBittorrent profile folders were found.
    goto :FailedKeepStage
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
    goto :FailedKeepStage
)

if not exist "%TMPZIP%" (
    echo.
    echo ERROR: ZIP archive was not created.
    goto :FailedKeepStage
)

for %%Z in ("%TMPZIP%") do if %%~zZ LEQ 0 (
    echo.
    echo ERROR: ZIP archive is empty.
    goto :FailedKeepStage
)

move /y "%TMPZIP%" "%ZIPFILE%" >nul
if errorlevel 1 (
    echo.
    echo ERROR: Could not replace the final backup file.
    echo Temporary archive preserved at:
    echo "%TMPZIP%"
    goto :FailedKeepStage
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

:CopyDir
robocopy "%~1" "%~2" /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 exit /b 1
exit /b 0

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
echo Backup was not started to avoid inconsistent resume/config data.
exit /b 1

:CopyFailed
echo.
echo ERROR: A folder could not be copied completely.

goto :FailedKeepStage

:FailedKeepStage
echo.
echo Staging data was preserved for troubleshooting:
echo "%STAGE%"
goto :FailedNoCleanup

:Failed
if exist "%STAGE%" rd /s /q "%STAGE%" >nul 2>&1

:FailedNoCleanup
echo.
echo Backup failed. No completed timestamped backup was created.
echo.
pause
exit /b 1
