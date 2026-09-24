@echo off
setlocal EnableExtensions DisableDelayedExpansion

title Backup and Restore Windows Drivers
set "APP_TITLE=Backup and Restore Windows Drivers"
set "PRODUCT=Windows_Drivers"
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_FILE=%~f0"
set "PNPUTIL=%SystemRoot%\System32\pnputil.exe"
if exist "%SystemRoot%\Sysnative\pnputil.exe" set "PNPUTIL=%SystemRoot%\Sysnative\pnputil.exe"

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

call :EnsureAdmin backup
if errorlevel 2 exit /b 0
if errorlevel 1 goto ElevationError

cls
call :Header
echo [1/4] Checking requirements...
if not exist "%PNPUTIL%" (
    echo [ERROR] PnPUtil was not found:
    echo         "%PNPUTIL%"
    echo [INFO] PnPUtil is built into Windows.
    goto BackupFailed
)
echo [OK] PnPUtil found.
if exist "%BACKUP_FILE%" (
    echo [ERROR] A backup for this minute already exists:
    echo         "%BACKUP_FILE%"
    goto BackupFailed
)
echo.

echo [2/4] Creating backup...
if exist "%STAGE%" rd /s /q "%STAGE%" >nul 2>&1
mkdir "%STAGE%" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Could not create the staging folder:
    echo         "%STAGE%"
    goto BackupFailed
)

call :Log "Backup started."
call :Log "Computer: %COMPUTERNAME%"
call :Log "PnPUtil: %PNPUTIL%"
call :Log "Destination: %BACKUP_FILE%"

"%PNPUTIL%" /export-driver * "%STAGE%" >>"%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo [ERROR] Driver export failed.
    call :Log "ERROR: PnPUtil export failed with exit code %ERRORLEVEL%."
    goto BackupFailedKeepStage
)
echo [OK] Driver export completed.
echo.

echo [3/4] Validating backup...
set "INF_COUNT=0"
for /r "%STAGE%" %%F in (*.inf) do set /a INF_COUNT+=1 >nul
if "%INF_COUNT%"=="0" (
    echo [ERROR] Export completed but no INF files were found.
    call :Log "ERROR: No INF files were found after export."
    goto BackupFailedKeepStage
)

>"%STAGE%\Backup_Info.txt" echo %APP_TITLE%
>>"%STAGE%\Backup_Info.txt" echo Created: %TIMESTAMP%
>>"%STAGE%\Backup_Info.txt" echo Computer: %COMPUTERNAME%
>>"%STAGE%\Backup_Info.txt" echo User: %USERNAME%
>>"%STAGE%\Backup_Info.txt" echo INF packages: %INF_COUNT%

if exist "%TEMP_ZIP%" del /f /q "%TEMP_ZIP%" >nul 2>&1
set "ZIP_STAGE=%STAGE%"
set "ZIP_TARGET=%TEMP_ZIP%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:ZIP_STAGE,$env:ZIP_TARGET,[System.IO.Compression.CompressionLevel]::Optimal,$false); $z=[System.IO.Compression.ZipFile]::OpenRead($env:ZIP_TARGET); try { if($z.Entries.Count -lt 1){ throw 'Archive is empty.' } } finally { $z.Dispose() }" >>"%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo [ERROR] ZIP creation or verification failed.
    call :Log "ERROR: ZIP creation or verification failed."
    goto BackupFailedKeepStage
)
for %%Z in ("%TEMP_ZIP%") do if %%~zZ LEQ 0 (
    echo [ERROR] ZIP archive is empty.
    goto BackupFailedKeepStage
)
echo [OK] Validation passed: %INF_COUNT% INF package(s).
echo.

echo [4/4] Finalizing...
move /y "%TEMP_ZIP%" "%BACKUP_FILE%" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Could not finalize the backup archive.
    goto BackupFailedKeepStage
)
rd /s /q "%STAGE%" >nul 2>&1
call :Log "Backup completed successfully. INF packages: %INF_COUNT%."
echo [OK] Backup finalized.
echo.
call :SuccessHeader "BACKUP COMPLETED SUCCESSFULLY"
echo Backup:  "%BACKUP_FILE%"
echo Drivers: %INF_COUNT% INF package(s)
echo Log:     "%LOG_FILE%"
echo ============================================================
echo.
pause
exit /b 0

:Restore
call :GetTimestamp
if not defined TIMESTAMP goto TimestampError
set "LOG_FILE=%SCRIPT_DIR%%PRODUCT%_Restore_%TIMESTAMP%.log"
set "RESTORE_STAGE="
set "BACKUP_SOURCE="
set "BACKUP_KIND="

call :EnsureAdmin restore
if errorlevel 2 exit /b 0
if errorlevel 1 goto ElevationError

cls
call :Header
echo [1/4] Checking requirements...
if not exist "%PNPUTIL%" (
    echo [ERROR] PnPUtil was not found:
    echo         "%PNPUTIL%"
    goto RestoreFailed
)
echo [OK] PnPUtil found.
echo.

echo [2/4] Finding backup...
for /f "delims=" %%F in ('dir /b /a-d /o-n "%SCRIPT_DIR%%PRODUCT%_Backup_????-??-??-??-??.zip" 2^>nul') do if not defined BACKUP_SOURCE set "BACKUP_SOURCE=%SCRIPT_DIR%%%F"
if defined BACKUP_SOURCE set "BACKUP_KIND=zip"

if not defined BACKUP_SOURCE for /f "delims=" %%D in ('dir /b /ad /o-n "%SCRIPT_DIR%Driver_Backup_????-??-??-??-??" 2^>nul') do if not defined BACKUP_SOURCE set "BACKUP_SOURCE=%SCRIPT_DIR%%%D"
if defined BACKUP_SOURCE if not defined BACKUP_KIND set "BACKUP_KIND=folder"

if not defined BACKUP_SOURCE if exist "%SCRIPT_DIR%DriverBackup\" (
    set "BACKUP_SOURCE=%SCRIPT_DIR%DriverBackup"
    set "BACKUP_KIND=folder"
)
if not defined BACKUP_SOURCE if exist "%SCRIPT_DIR%DriverBackup_Previous\" (
    set "BACKUP_SOURCE=%SCRIPT_DIR%DriverBackup_Previous"
    set "BACKUP_KIND=folder"
)

if not defined BACKUP_SOURCE (
    echo [ERROR] No Windows driver backup was found next to this script.
    echo [INFO] Expected: %PRODUCT%_Backup_YYYY-MM-DD-HH-MM.zip
    echo [INFO] Legacy Driver_Backup_* and DriverBackup folders are also supported.
    goto RestoreFailed
)
echo [OK] Backup found:
echo      "%BACKUP_SOURCE%"
echo.

if /I "%BACKUP_KIND%"=="zip" goto ExtractRestoreZip
set "RESTORE_ROOT=%BACKUP_SOURCE%"
goto RestoreValidate

:ExtractRestoreZip
set "RESTORE_STAGE=%TEMP%\%PRODUCT%_Restore_Stage_%RANDOM%_%RANDOM%"
if exist "%RESTORE_STAGE%" rd /s /q "%RESTORE_STAGE%" >nul 2>&1
mkdir "%RESTORE_STAGE%" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Could not create the restore staging folder.
    goto RestoreFailed
)
set "ZIP_SOURCE=%BACKUP_SOURCE%"
set "ZIP_EXTRACT=%RESTORE_STAGE%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[System.IO.Compression.ZipFile]::OpenRead($env:ZIP_SOURCE); try { if($z.Entries.Count -lt 1){ throw 'Archive is empty.' } } finally { $z.Dispose() }; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:ZIP_SOURCE,$env:ZIP_EXTRACT)" >>"%LOG_FILE%" 2>&1
if errorlevel 1 (
    echo [ERROR] Backup ZIP is invalid or could not be extracted.
    goto RestoreFailedKeepStage
)
set "RESTORE_ROOT=%RESTORE_STAGE%"

:RestoreValidate
set "TOTAL_COUNT=0"
for /r "%RESTORE_ROOT%" %%F in (*.inf) do set /a TOTAL_COUNT+=1 >nul
if "%TOTAL_COUNT%"=="0" (
    echo [ERROR] The selected backup contains no INF files.
    goto RestoreFailedKeepStage
)
echo [OK] Drivers found: %TOTAL_COUNT% INF package(s).
echo.

set "PROCESSED_COUNT=0"
set "INSTALLED_COUNT=0"
set "SKIPPED_COUNT=0"
set "ERROR_COUNT=0"
set "REBOOT_REQUIRED=0"
call :Log "Restore started."
call :Log "Computer: %COMPUTERNAME%"
call :Log "Backup: %BACKUP_SOURCE%"
call :Log "INF packages: %TOTAL_COUNT%"

echo [3/4] Restoring drivers...
for /r "%RESTORE_ROOT%" %%F in (*.inf) do call :RestoreOne "%%~fF"
echo.

echo [4/4] Finalizing...
if defined RESTORE_STAGE rd /s /q "%RESTORE_STAGE%" >nul 2>&1
call :Log "Restore summary: processed=%PROCESSED_COUNT%, successful=%INSTALLED_COUNT%, skipped=%SKIPPED_COUNT%, errors=%ERROR_COUNT%, reboot_required=%REBOOT_REQUIRED%."
if not "%ERROR_COUNT%"=="0" goto RestoreFinishedWithErrors

echo [OK] Restore finalized.
echo.
call :SuccessHeader "RESTORE COMPLETED SUCCESSFULLY"
echo Backup:     "%BACKUP_SOURCE%"
echo Processed:  %PROCESSED_COUNT%
echo Successful: %INSTALLED_COUNT%
echo Skipped:    %SKIPPED_COUNT%
echo Errors:     %ERROR_COUNT%
if "%REBOOT_REQUIRED%"=="1" echo Reboot:     REQUIRED
echo Log:        "%LOG_FILE%"
echo ============================================================
if "%REBOOT_REQUIRED%"=="1" echo [INFO] Restart Windows to finish driver installation.
echo.
pause
exit /b 0

:RestoreOne
set /a PROCESSED_COUNT+=1 >nul
echo [%PROCESSED_COUNT%/%TOTAL_COUNT%] %~nx1
call :Log "Installing: %~1"
"%PNPUTIL%" /add-driver "%~1" /install >>"%LOG_FILE%" 2>&1
set "DRIVER_RC=%ERRORLEVEL%"
if "%DRIVER_RC%"=="0" goto DriverSuccess
if "%DRIVER_RC%"=="259" goto DriverSkipped
if "%DRIVER_RC%"=="3010" goto DriverReboot
if "%DRIVER_RC%"=="1641" goto DriverReboot
set /a ERROR_COUNT+=1 >nul
call :Log "ERROR (%DRIVER_RC%): %~1"
echo        [ERROR %DRIVER_RC%]
exit /b 0

:DriverSuccess
set /a INSTALLED_COUNT+=1 >nul
call :Log "SUCCESS: %~1"
exit /b 0

:DriverSkipped
set /a SKIPPED_COUNT+=1 >nul
call :Log "SKIPPED (259): %~1"
exit /b 0

:DriverReboot
set /a INSTALLED_COUNT+=1 >nul
set "REBOOT_REQUIRED=1"
call :Log "SUCCESS (%DRIVER_RC%): Reboot required: %~1"
exit /b 0

:RestoreFinishedWithErrors
echo [WARN] Restore finalized with errors.
echo.
call :SuccessHeader "RESTORE COMPLETED WITH ERRORS"
echo Backup:     "%BACKUP_SOURCE%"
echo Processed:  %PROCESSED_COUNT%
echo Successful: %INSTALLED_COUNT%
echo Skipped:    %SKIPPED_COUNT%
echo Errors:     %ERROR_COUNT%
if "%REBOOT_REQUIRED%"=="1" echo Reboot:     REQUIRED
echo Log:        "%LOG_FILE%"
echo ============================================================
echo [INFO] Windows driver-install log: "%SystemRoot%\inf\setupapi.dev.log"
echo.
pause
exit /b 1

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
if defined RESTORE_STAGE (
    echo [INFO] Extracted data was preserved for troubleshooting:
    echo        "%RESTORE_STAGE%"
)
goto RestoreFailedNoCleanup

:RestoreFailed
if defined RESTORE_STAGE if exist "%RESTORE_STAGE%" rd /s /q "%RESTORE_STAGE%" >nul 2>&1

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
echo  %APP_TITLE%
echo ============================================================
echo.
exit /b 0

:SuccessHeader
echo ============================================================
echo  %~1
echo ============================================================
exit /b 0

:GetTimestamp
set "TIMESTAMP="
for /f "delims=" %%T in ('powershell.exe -NoLogo -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd-HH-mm'" 2^>nul') do set "TIMESTAMP=%%T"
exit /b 0

:EnsureAdmin
fltmc >nul 2>&1
if not errorlevel 1 exit /b 0
echo [INFO] Administrator rights are required. Requesting elevation...
set "ELEVATE_MODE=%~1"
powershell.exe -NoLogo -NoProfile -Command "try { Start-Process -FilePath $env:SCRIPT_FILE -ArgumentList '--%ELEVATE_MODE%' -Verb RunAs | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 2

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
