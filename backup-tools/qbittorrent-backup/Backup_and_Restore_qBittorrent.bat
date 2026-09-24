@echo off
setlocal EnableExtensions DisableDelayedExpansion

title Backup and Restore qBittorrent
set "PRODUCT=qBittorrent"
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_FILE=%~f0"

call :EnsureWinget

if /I "%~1"=="--backup" goto Backup
if /I "%~1"=="--restore" goto Restore
goto Menu

:Menu
cls
call :Header
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
call :GetTimestamp
if not defined TIMESTAMP goto TimestampError
set "BACKUP_FILE=%SCRIPT_DIR%%PRODUCT%_Backup_%TIMESTAMP%.zip"
set "TEMP_ZIP=%SCRIPT_DIR%%PRODUCT%_Backup_%TIMESTAMP%.tmp.zip"
set "STAGE=%TEMP%\%PRODUCT%_Backup_Stage_%RANDOM%_%RANDOM%"
set "LOG_FILE=%SCRIPT_DIR%%PRODUCT%_Backup_%TIMESTAMP%.log"
set "ROAMING_SRC=%APPDATA%\qBittorrent"
set "LOCAL_SRC=%LOCALAPPDATA%\qBittorrent"
set "INSTALL_SRC="
if exist "%ProgramFiles%\qBittorrent\qbittorrent.exe" set "INSTALL_SRC=%ProgramFiles%\qBittorrent"
if not defined INSTALL_SRC if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\qBittorrent\qbittorrent.exe" set "INSTALL_SRC=%ProgramFiles(x86)%\qBittorrent"

cls
call :Header
echo [1/4] Checking requirements...
if exist "%BACKUP_FILE%" (
    echo [ERROR] A backup for this minute already exists:
    echo         "%BACKUP_FILE%"
    goto BackupFailed
)
if not exist "%ROAMING_SRC%\" if not exist "%LOCAL_SRC%\" (
    echo [ERROR] No qBittorrent profile folders were found.
    goto BackupFailed
)
call :RequireQBittorrentClosed
if errorlevel 1 goto BackupFailed
echo [OK] qBittorrent profile found.
echo.

echo [2/4] Creating backup...
if exist "%STAGE%" rd /s /q "%STAGE%" >nul 2>&1
mkdir "%STAGE%\AppData\Roaming" >nul 2>&1
mkdir "%STAGE%\AppData\Local" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Could not create the staging folder.
    goto BackupFailed
)
call :Log "Backup started."
call :Log "Destination: %BACKUP_FILE%"
set "PROFILE_FOUND=0"

if exist "%ROAMING_SRC%\" (
    echo [INFO] Copying Roaming profile...
    call :CopyDir "%ROAMING_SRC%" "%STAGE%\AppData\Roaming\qBittorrent"
    if errorlevel 1 goto BackupCopyFailed
    set "PROFILE_FOUND=1"
)
if exist "%LOCAL_SRC%\" (
    echo [INFO] Copying Local profile...
    call :CopyDir "%LOCAL_SRC%" "%STAGE%\AppData\Local\qBittorrent"
    if errorlevel 1 goto BackupCopyFailed
    set "PROFILE_FOUND=1"
)
if defined INSTALL_SRC (
    echo [INFO] Copying qBittorrent installation...
    call :CopyDir "%INSTALL_SRC%" "%STAGE%\Program Files\qBittorrent"
    if errorlevel 1 goto BackupCopyFailed
) else (
    echo [WARN] qBittorrent installation folder was not found. Profile data will still be backed up.
)
if "%PROFILE_FOUND%"=="0" (
    echo [ERROR] No qBittorrent profile data was copied.
    goto BackupFailedKeepStage
)
echo [OK] qBittorrent data copied.
echo.

echo [3/4] Validating backup...
>"%STAGE%\Backup_Info.txt" echo Backup and Restore qBittorrent
>>"%STAGE%\Backup_Info.txt" echo Created: %TIMESTAMP%
>>"%STAGE%\Backup_Info.txt" echo Computer: %COMPUTERNAME%
>>"%STAGE%\Backup_Info.txt" echo User: %USERNAME%
if defined INSTALL_SRC >>"%STAGE%\Backup_Info.txt" echo Installation source: %INSTALL_SRC%

if exist "%TEMP_ZIP%" del /f /q "%TEMP_ZIP%" >nul 2>&1
set "ZIP_STAGE=%STAGE%"
set "ZIP_TARGET=%TEMP_ZIP%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:ZIP_STAGE,$env:ZIP_TARGET,[System.IO.Compression.CompressionLevel]::Optimal,$false); $z=[System.IO.Compression.ZipFile]::OpenRead($env:ZIP_TARGET); try { if($z.Entries.Count -lt 1){ throw 'Archive is empty.' } } finally { $z.Dispose() }" >>"%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo [ERROR] ZIP creation or verification failed.
    goto BackupFailedKeepStage
)
for %%Z in ("%TEMP_ZIP%") do if %%~zZ LEQ 0 (
    echo [ERROR] ZIP archive is empty.
    goto BackupFailedKeepStage
)
echo [OK] Backup archive verified.
echo.

echo [4/4] Finalizing...
move /y "%TEMP_ZIP%" "%BACKUP_FILE%" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Could not finalize the backup archive.
    goto BackupFailedKeepStage
)
rd /s /q "%STAGE%" >nul 2>&1
call :Log "Backup completed successfully."
echo [OK] Backup finalized.
echo.
call :ResultHeader "BACKUP COMPLETED SUCCESSFULLY"
echo Backup: "%BACKUP_FILE%"
echo Log:    "%LOG_FILE%"
echo ============================================================
echo.
pause
exit /b 0

:Restore
call :GetTimestamp
if not defined TIMESTAMP goto TimestampError
set "LOG_FILE=%SCRIPT_DIR%%PRODUCT%_Restore_%TIMESTAMP%.log"
set "BACKUP_FILE="
set "EXTRACT_DIR=%TEMP%\%PRODUCT%_Restore_Stage_%RANDOM%_%RANDOM%"

call :EnsureAdmin restore
if errorlevel 2 exit /b 0
if errorlevel 1 goto ElevationError

cls
call :Header
echo [1/4] Checking requirements...
call :RequireQBittorrentClosed
if errorlevel 1 goto RestoreFailed
echo [OK] qBittorrent is not running.
echo.

echo [2/4] Finding backup...
for /f "delims=" %%F in ('dir /b /a-d /o-n "%SCRIPT_DIR%%PRODUCT%_Backup_????-??-??-??-??.zip" 2^>nul') do if not defined BACKUP_FILE set "BACKUP_FILE=%SCRIPT_DIR%%%F"
if not defined BACKUP_FILE if exist "%SCRIPT_DIR%qBittorrent_Backup.zip" set "BACKUP_FILE=%SCRIPT_DIR%qBittorrent_Backup.zip"
if not defined BACKUP_FILE (
    echo [ERROR] No qBittorrent backup was found next to this script.
    echo [INFO] Expected: %PRODUCT%_Backup_YYYY-MM-DD-HH-MM.zip
    echo [INFO] Legacy qBittorrent_Backup.zip is also supported.
    goto RestoreFailed
)
echo [OK] Backup found:
echo      "%BACKUP_FILE%"
echo.

if exist "%EXTRACT_DIR%" rd /s /q "%EXTRACT_DIR%" >nul 2>&1
mkdir "%EXTRACT_DIR%" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Could not create the restore staging folder.
    goto RestoreFailed
)
set "ZIP_SOURCE=%BACKUP_FILE%"
set "ZIP_EXTRACT=%EXTRACT_DIR%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead($env:ZIP_SOURCE); try { if($z.Entries.Count -lt 1){ throw 'Archive is empty.' } } finally { $z.Dispose() }; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:ZIP_SOURCE,$env:ZIP_EXTRACT)" >>"%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo [ERROR] Backup ZIP is invalid or could not be extracted.
    goto RestoreFailedKeepStage
)

set "SRC_ROAM=%EXTRACT_DIR%\AppData\Roaming\qBittorrent"
set "SRC_LOCAL=%EXTRACT_DIR%\AppData\Local\qBittorrent"
set "SRC_INSTALL=%EXTRACT_DIR%\Program Files\qBittorrent"
if exist "%SRC_ROAM%\" goto RestoreLayoutReady
if exist "%SRC_LOCAL%\" goto RestoreLayoutReady
call :FindLegacyLayout

:RestoreLayoutReady
if not exist "%SRC_ROAM%\" if not exist "%SRC_LOCAL%\" if not exist "%SRC_INSTALL%\" (
    echo [ERROR] No qBittorrent data was found inside the backup.
    goto RestoreFailedKeepStage
)
echo [OK] Backup archive verified.
echo.

echo [3/4] Restoring qBittorrent...
call :Log "Restore started."
call :Log "Backup: %BACKUP_FILE%"
set "RESTORED=0"
if exist "%SRC_ROAM%\" (
    echo [INFO] Restoring Roaming profile...
    call :MirrorDir "%SRC_ROAM%" "%APPDATA%\qBittorrent"
    if errorlevel 1 goto RestoreCopyFailed
    set "RESTORED=1"
)
if exist "%SRC_LOCAL%\" (
    echo [INFO] Restoring Local profile...
    call :MirrorDir "%SRC_LOCAL%" "%LOCALAPPDATA%\qBittorrent"
    if errorlevel 1 goto RestoreCopyFailed
    set "RESTORED=1"
)
if exist "%SRC_INSTALL%\" (
    call :DetectInstallDestination
    echo [INFO] Restoring qBittorrent installation...
    call :MirrorDir "%SRC_INSTALL%" "%INSTALL_DST%"
    if errorlevel 1 goto RestoreCopyFailed
    set "RESTORED=1"
)
if "%RESTORED%"=="0" goto RestoreFailedKeepStage
echo [OK] qBittorrent data restored.
echo.

echo [4/4] Finalizing...
rd /s /q "%EXTRACT_DIR%" >nul 2>&1
call :Log "Restore completed successfully."
echo [OK] Restore finalized.
echo.
call :ResultHeader "RESTORE COMPLETED SUCCESSFULLY"
echo Backup: "%BACKUP_FILE%"
echo Log:    "%LOG_FILE%"
echo ============================================================
echo.
pause
exit /b 0

:FindLegacyLayout
set "LEGACY_USER_DIR="
for /d %%U in ("%EXTRACT_DIR%\Users\*") do if not defined LEGACY_USER_DIR call :CheckLegacyUser "%%~fU"
if not defined LEGACY_USER_DIR exit /b 0
set "SRC_ROAM=%LEGACY_USER_DIR%\AppData\Roaming\qBittorrent"
set "SRC_LOCAL=%LEGACY_USER_DIR%\AppData\Local\qBittorrent"
exit /b 0

:CheckLegacyUser
if exist "%~1\AppData\Roaming\qBittorrent\" set "LEGACY_USER_DIR=%~1"
if exist "%~1\AppData\Local\qBittorrent\" set "LEGACY_USER_DIR=%~1"
exit /b 0

:DetectInstallDestination
set "INSTALL_DST=%ProgramFiles%\qBittorrent"
if exist "%ProgramFiles%\qBittorrent\qbittorrent.exe" exit /b 0
if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\qBittorrent\qbittorrent.exe" set "INSTALL_DST=%ProgramFiles(x86)%\qBittorrent"
exit /b 0

:RequireQBittorrentClosed
tasklist /FI "IMAGENAME eq qbittorrent.exe" 2>nul | find /I "qbittorrent.exe" >nul
if errorlevel 1 exit /b 0
echo [WARN] qBittorrent is currently running.
echo [INFO] Exit qBittorrent completely - Ctrl+Q - then press any key to continue.
pause >nul
tasklist /FI "IMAGENAME eq qbittorrent.exe" 2>nul | find /I "qbittorrent.exe" >nul
if errorlevel 1 exit /b 0
echo [ERROR] qBittorrent is still running.
exit /b 1

:CopyDir
robocopy "%~1" "%~2" /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP >>"%LOG_FILE%" 2>&1
if errorlevel 8 exit /b 1
exit /b 0

:MirrorDir
robocopy "%~1" "%~2" /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP >>"%LOG_FILE%" 2>&1
if errorlevel 8 exit /b 1
exit /b 0

:EnsureAdmin
fltmc >nul 2>&1
if not errorlevel 1 exit /b 0
echo [INFO] Administrator rights are required. Requesting elevation...
set "ELEVATE_MODE=%~1"
powershell.exe -NoLogo -NoProfile -Command "try { Start-Process -FilePath $env:SCRIPT_FILE -ArgumentList '--%ELEVATE_MODE%' -Verb RunAs | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 2

:BackupCopyFailed
echo [ERROR] A qBittorrent folder could not be copied completely.
goto BackupFailedKeepStage

:RestoreCopyFailed
echo [ERROR] A qBittorrent folder could not be restored completely.
goto RestoreFailedKeepStage

:BackupFailedKeepStage
echo [INFO] Staging data was preserved for troubleshooting:
echo        "%STAGE%"
goto BackupFailedNoCleanup

:BackupFailed
if defined STAGE if exist "%STAGE%" rd /s /q "%STAGE%" >nul 2>&1

:BackupFailedNoCleanup
if defined TEMP_ZIP if exist "%TEMP_ZIP%" del /f /q "%TEMP_ZIP%" >nul 2>&1
echo.
echo [ERROR] Backup failed. No completed backup was created.
if defined LOG_FILE echo [INFO] Log: "%LOG_FILE%"
echo.
pause
exit /b 1

:RestoreFailedKeepStage
if defined EXTRACT_DIR if exist "%EXTRACT_DIR%\" (
    echo [INFO] Extracted data was preserved for troubleshooting:
    echo        "%EXTRACT_DIR%"
)
goto RestoreFailedNoCleanup

:RestoreFailed
if defined EXTRACT_DIR if exist "%EXTRACT_DIR%" rd /s /q "%EXTRACT_DIR%" >nul 2>&1

:RestoreFailedNoCleanup
echo.
echo [ERROR] Restore failed.
if defined LOG_FILE echo [INFO] Log: "%LOG_FILE%"
echo.
pause
exit /b 1

:TimestampError
echo [ERROR] Could not generate a timestamp.
pause
exit /b 1

:ElevationError
echo [ERROR] Administrator elevation failed or was cancelled.
pause
exit /b 1

:Header
echo ============================================================
echo  Backup and Restore qBittorrent
echo ============================================================
echo.
exit /b 0

:ResultHeader
echo ============================================================
echo  %~1
echo ============================================================
exit /b 0

:GetTimestamp
set "TIMESTAMP="
for /f "delims=" %%T in ('powershell.exe -NoLogo -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd-HH-mm'" 2^>nul') do set "TIMESTAMP=%%T"
exit /b 0

:EnsureWinget
where winget.exe >nul 2>&1
if not errorlevel 1 exit /b 0
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" exit /b 0
echo [INFO] WinGet was not found. Attempting Microsoft bootstrap...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; try { if(-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)){ Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force | Out-Null }; if(-not (Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue)){ Register-PSRepository -Default }; Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; Install-Module Microsoft.WinGet.Client -Repository PSGallery -Scope CurrentUser -Force -AllowClobber; Import-Module Microsoft.WinGet.Client -Force; Repair-WinGetPackageManager -Latest -Force } catch { exit 1 }" >nul 2>&1
where winget.exe >nul 2>&1
if not errorlevel 1 exit /b 0
if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" exit /b 0
echo [WARN] WinGet bootstrap failed or WinGet is not yet visible.
echo [WARN] Continuing because this tool has no external dependencies.
exit /b 0

:Log
>>"%LOG_FILE%" echo [%DATE% %TIME%] %~1
exit /b 0
