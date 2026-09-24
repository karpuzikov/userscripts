@echo off
setlocal EnableExtensions

rem SyncTrayzor & Syncthing Backup
rem Usage: run normally for the current Windows user, or pass another user folder as the first argument.

set "CURDIR=%~dp0"
if "%CURDIR:~-1%"=="\" set "CURDIR=%CURDIR:~0,-1%"

if "%~1"=="" (
    set "USERFOLDER=%USERNAME%"
) else (
    set "USERFOLDER=%~1"
)

set "SRC1=C:\Users\%USERFOLDER%\AppData\Roaming\SyncTrayzor"
set "SRC2=C:\Users\%USERFOLDER%\AppData\Local\Syncthing"
set "TMPDIR=%TEMP%\SyncTrayzor_Backup_tmp_%USERNAME%_%RANDOM%_%RANDOM%"
set "LOG=%CURDIR%\backup.log"

for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'"`) do set "TS=%%T"
set "ZIP=%CURDIR%\SyncBack_%USERFOLDER%_%TS%.zip"

>>"%LOG%" echo [%date% %time%] --- Backup started for %USERFOLDER% ---

if not exist "%SRC1%\" if not exist "%SRC2%\" (
    echo Neither SyncTrayzor nor Syncthing configuration folder was found.
    >>"%LOG%" echo [%date% %time%] ERROR: No source folders found.
    exit /b 2
)

mkdir "%TMPDIR%\Users\%USERFOLDER%\AppData\Roaming\SyncTrayzor" 2>nul
mkdir "%TMPDIR%\Users\%USERFOLDER%\AppData\Local\Syncthing" 2>nul

if exist "%SRC1%\" (
    robocopy "%SRC1%" "%TMPDIR%\Users\%USERFOLDER%\AppData\Roaming\SyncTrayzor" /MIR /COPYALL /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP >>"%LOG%" 2>&1
    if errorlevel 8 goto :copy_error
)

if exist "%SRC2%\" (
    robocopy "%SRC2%" "%TMPDIR%\Users\%USERFOLDER%\AppData\Local\Syncthing" /MIR /COPYALL /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS /NP >>"%LOG%" 2>&1
    if errorlevel 8 goto :copy_error
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -LiteralPath '%TMPDIR%\Users' -DestinationPath '%ZIP%' -CompressionLevel Optimal -Force"
if errorlevel 1 goto :zip_error

rmdir /s /q "%TMPDIR%" 2>nul
>>"%LOG%" echo [%date% %time%] OK: %ZIP%
echo.
echo Backup created:
echo %ZIP%
exit /b 0

:copy_error
>>"%LOG%" echo [%date% %time%] ERROR: Robocopy failed.
echo Robocopy failed. See:
echo %LOG%
rmdir /s /q "%TMPDIR%" 2>nul
exit /b 3

:zip_error
>>"%LOG%" echo [%date% %time%] ERROR: ZIP creation failed.
echo ZIP creation failed. See:
echo %LOG%
rmdir /s /q "%TMPDIR%" 2>nul
exit /b 4