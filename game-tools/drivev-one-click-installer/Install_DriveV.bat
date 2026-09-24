@echo off
setlocal EnableExtensions
cd /d "%~dp0"

call :launch %*
if %errorlevel%==0 exit /b 0

echo.
echo Python 3 was not found. Installing it automatically...
where winget.exe >nul 2>&1
if %errorlevel%==0 (
    winget install -e --id Python.Python.3.12 --silent --accept-package-agreements --accept-source-agreements
    call :launch %*
    if %errorlevel%==0 exit /b 0
)

echo winget install was unavailable or did not expose Python yet.
echo Downloading the official Python 3.12 installer from python.org...
set "PYSETUP=%TEMP%\python-3.12.10-amd64.exe"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' -OutFile '%PYSETUP%'"
if not exist "%PYSETUP%" goto :failed
"%PYSETUP%" /quiet InstallAllUsers=0 PrependPath=1 Include_launcher=1 Include_tcltk=1 Include_test=0
if errorlevel 1 goto :failed

del /q "%PYSETUP%" >nul 2>&1
call :launch %*
if %errorlevel%==0 exit /b 0

goto :failed

:launch
where pyw.exe >nul 2>&1 && (start "" pyw.exe -3 "%~dp0DriveV_AutoInstaller.pyw" %* & exit /b 0)
where pythonw.exe >nul 2>&1 && (start "" pythonw.exe "%~dp0DriveV_AutoInstaller.pyw" %* & exit /b 0)
where py.exe >nul 2>&1 && (py.exe -3 "%~dp0DriveV_AutoInstaller.pyw" %* & exit /b %errorlevel%)
where python.exe >nul 2>&1 && (python.exe "%~dp0DriveV_AutoInstaller.pyw" %* & exit /b %errorlevel%)
exit /b 1

:failed
echo.
echo ERROR: The automatic Python bootstrap failed.
echo Windows may have blocked winget/python.org or software installation.
pause
exit /b 1