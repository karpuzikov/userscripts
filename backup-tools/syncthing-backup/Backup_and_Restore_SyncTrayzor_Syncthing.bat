@echo off
setlocal EnableExtensions DisableDelayedExpansion

title Backup and Restore SyncTrayzor ^& Syncthing
set "PRODUCT=SyncTrayzor_Syncthing"
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_FILE=%~f0"
set "REQUESTED_USER="

call :EnsureWinget

if /I "%~1"=="--backup" (
    set "REQUESTED_USER=%~2"
    goto Backup
)
if /I "%~1"=="--restore" goto Restore
if not "%~1"=="" (
    set "REQUESTED_USER=%~1"
    goto Backup
)
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

if defined REQUESTED_USER goto BackupOtherUser
set "SOURCE_USER=%USERNAME%"
set "SRC_ROAMING=%APPDATA%\SyncTrayzor"
set "SRC_LOCAL=%LOCALAPPDATA%\Syncthing"
goto BackupPathsReady

:BackupOtherUser
set "SOURCE_USER=%REQUESTED_USER%"
set "SRC_ROAMING=%SystemDrive%\Users\%REQUESTED_USER%\AppData\Roaming\SyncTrayzor"
set "SRC_LOCAL=%SystemDrive%\Users\%REQUESTED_USER%\AppData\Local\Syncthing"

:BackupPathsReady
cls
call :Header
echo [1/4] Checking requirements...
if exist "%BACKUP_FILE%" (
    echo [ERROR] A backup for this minute already exists:
    echo         "%BACKUP_FILE%"
    goto BackupFailed
)
if not exist "%SRC_ROAMING%\" if not exist "%SRC_LOCAL%\" (
    echo [ERROR] No SyncTrayzor or Syncthing configuration was found for:
    echo         %SOURCE_USER%
    goto BackupFailed
)
call :RequireAppsClosed
if errorlevel 1 goto BackupFailed
echo [OK] Source configuration found.
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
call :Log "Source user: %SOURCE_USER%"
call :Log "Destination: %BACKUP_FILE%"

set "FOUND=0"
if exist "%SRC_ROAMING%\" (
    echo [INFO] Copying SyncTrayzor configuration...
    call :CopyDir "%SRC_ROAMING%" "%STAGE%\AppData\Roaming\SyncTrayzor"
    if errorlevel 1 goto BackupCopyFailed
    set "FOUND=1"
)
if exist "%SRC_LOCAL%\" (
    echo [INFO] Copying Syncthing configuration...
    call :CopyDir "%SRC_LOCAL%" "%STAGE%\AppData\Local\Syncthing"
    if errorlevel 1 goto BackupCopyFailed
    set "FOUND=1"
)
if "%FOUND%"=="0" (
    echo [ERROR] Nothing was copied.
    goto BackupFailedKeepStage
)
echo [OK] Configuration copied.
echo.

echo [3/4] Validating backup...
>"%STAGE%\Backup_Info.txt" echo Backup and Restore SyncTrayzor ^& Syncthing
>>"%STAGE%\Backup_Info.txt" echo Created: %TIMESTAMP%
>>"%STAGE%\Backup_Info.txt" echo Computer: %COMPUTERNAME%
>>"%STAGE%\Backup_Info.txt" echo Source user: %SOURCE_USER%

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

cls
call :Header
echo [1/4] Checking requirements...
call :RequireAppsClosed
if errorlevel 1 goto RestoreFailed
echo [OK] SyncTrayzor and Syncthing are not running.
echo.

echo [2/4] Finding backup...
for /f "delims=" %%F in ('dir /b /a-d /o-n "%SCRIPT_DIR%%PRODUCT%_Backup_????-??-??-??-??.zip" 2^>nul') do if not defined BACKUP_FILE set "BACKUP_FILE=%SCRIPT_DIR%%%F"
if not defined BACKUP_FILE for /f "delims=" %%F in ('dir /b /a-d /o-n "%SCRIPT_DIR%SyncBack_*.zip" 2^>nul') do if not defined BACKUP_FILE set "BACKUP_FILE=%SCRIPT_DIR%%%F"
if not defined BACKUP_FILE (
    echo [ERROR] No SyncTrayzor/Syncthing backup was found next to this script.
    echo [INFO] Expected: %PRODUCT%_Backup_YYYY-MM-DD-HH-MM.zip
    echo [INFO] Legacy SyncBack_*.zip backups are also supported.
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

set "RESTORE_ROAMING=%EXTRACT_DIR%\AppData\Roaming\SyncTrayzor"
set "RESTORE_LOCAL=%EXTRACT_DIR%\AppData\Local\Syncthing"
if exist "%RESTORE_ROAMING%\" goto RestoreLayoutReady
if exist "%RESTORE_LOCAL%\" goto RestoreLayoutReady
call :FindLegacyLayout

:RestoreLayoutReady
if not exist "%RESTORE_ROAMING%\" if not exist "%RESTORE_LOCAL%\" (
    echo [ERROR] No SyncTrayzor or Syncthing configuration was found inside the backup.
    goto RestoreFailedKeepStage
)
echo [OK] Backup archive verified.
echo.

echo [3/4] Restoring configuration...
call :Log "Restore started."
call :Log "Backup: %BACKUP_FILE%"
set "RESTORED=0"
if exist "%RESTORE_ROAMING%\" (
    echo [INFO] Restoring SyncTrayzor configuration...
    call :MirrorDir "%RESTORE_ROAMING%" "%APPDATA%\SyncTrayzor"
    if errorlevel 1 goto RestoreCopyFailed
    set "RESTORED=1"
)
if exist "%RESTORE_LOCAL%\" (
    echo [INFO] Restoring Syncthing configuration...
    call :MirrorDir "%RESTORE_LOCAL%" "%LOCALAPPDATA%\Syncthing"
    if errorlevel 1 goto RestoreCopyFailed
    set "RESTORED=1"
)
if "%RESTORED%"=="0" goto RestoreFailedKeepStage
echo [OK] Configuration restored.
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
set "RESTORE_ROAMING=%LEGACY_USER_DIR%\AppData\Roaming\SyncTrayzor"
set "RESTORE_LOCAL=%LEGACY_USER_DIR%\AppData\Local\Syncthing"
exit /b 0

:CheckLegacyUser
if exist "%~1\AppData\Roaming\SyncTrayzor\" set "LEGACY_USER_DIR=%~1"
if exist "%~1\AppData\Local\Syncthing\" set "LEGACY_USER_DIR=%~1"
exit /b 0

:RequireAppsClosed
set "APP_RUNNING=0"
tasklist /FI "IMAGENAME eq SyncTrayzor.exe" 2>nul | find /I "SyncTrayzor.exe" >nul && set "APP_RUNNING=1"
tasklist /FI "IMAGENAME eq syncthing.exe" 2>nul | find /I "syncthing.exe" >nul && set "APP_RUNNING=1"
if "%APP_RUNNING%"=="0" exit /b 0
echo [WARN] SyncTrayzor or Syncthing is currently running.
echo [INFO] Exit both completely, then press any key to continue.
pause >nul
set "APP_RUNNING=0"
tasklist /FI "IMAGENAME eq SyncTrayzor.exe" 2>nul | find /I "SyncTrayzor.exe" >nul && set "APP_RUNNING=1"
tasklist /FI "IMAGENAME eq syncthing.exe" 2>nul | find /I "syncthing.exe" >nul && set "APP_RUNNING=1"
if "%APP_RUNNING%"=="0" exit /b 0
echo [ERROR] SyncTrayzor or Syncthing is still running.
exit /b 1

:CopyDir
robocopy "%~1" "%~2" /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP >>"%LOG_FILE%" 2>&1
if errorlevel 8 exit /b 1
exit /b 0

:MirrorDir
robocopy "%~1" "%~2" /MIR /COPY:DAT /DCOPY:DAT /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP >>"%LOG_FILE%" 2>&1
if errorlevel 8 exit /b 1
exit /b 0

:BackupCopyFailed
echo [ERROR] A configuration folder could not be copied completely.
goto BackupFailedKeepStage

:RestoreCopyFailed
echo [ERROR] A configuration folder could not be restored completely.
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

:Header
echo ============================================================
echo  Backup and Restore SyncTrayzor ^& Syncthing
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
