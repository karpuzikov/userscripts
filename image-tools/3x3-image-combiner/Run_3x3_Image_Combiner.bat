@echo off
setlocal EnableExtensions DisableDelayedExpansion
title 3x3 Image Combiner

call :EnsureWinget
if errorlevel 1 goto :failed
call :EnsurePython313
if errorlevel 1 goto :failed

echo [SETUP] Checking Pillow...
"%PYTHON313%" -m ensurepip --upgrade >nul 2>&1
"%PYTHON313%" -m pip install --upgrade --disable-pip-version-check Pillow >nul 2>&1
if errorlevel 1 goto :failed

set "TEMP_PYW=%TEMP%\3x3_Image_Combiner_%RANDOM%_%RANDOM%.pyw"
set "PAYLOAD_SELF=%~f0"
set "PAYLOAD_OUT=%TEMP_PYW%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $lines=Get-Content -LiteralPath $env:PAYLOAD_SELF; $m=[Array]::IndexOf($lines,'::PYTHON_PAYLOAD'); if($m -lt 0){throw 'Embedded Python payload not found.'}; $b64=($lines[($m+1)..($lines.Count-1)] -join ''); [IO.File]::WriteAllBytes($env:PAYLOAD_OUT,[Convert]::FromBase64String($b64))"
if errorlevel 1 goto :failed

"%PYTHONW313%" "%TEMP_PYW%"
set "RC=%ERRORLEVEL%"
del /f /q "%TEMP_PYW%" >nul 2>&1
exit /b %RC%

:failed
if defined TEMP_PYW del /f /q "%TEMP_PYW%" >nul 2>&1
echo.
echo ERROR: Automatic setup failed.
echo Check the internet connection and Windows software-installation permissions.
pause
exit /b 1

:EnsureWinget
if errorlevel 1 goto :failed
call :EnsurePython313
if errorlevel 1 goto :failed

echo [SETUP] Checking Pillow...
"%PYTHON313%" -c "import PIL" >nul 2>&1
if errorlevel 1 (
    "%PYTHON313%" -m ensurepip --upgrade >nul 2>&1
    "%PYTHON313%" -m pip install --upgrade --disable-pip-version-check Pillow
    if errorlevel 1 goto :failed
) else (
    "%PYTHON313%" -m pip install --upgrade --disable-pip-version-check Pillow >nul 2>&1
)

set "APPDIR=%LOCALAPPDATA%\KarpuzikovTools\3x3_Image_Combiner"
set "SCRIPT=%APPDIR%\3x3_Image_Combiner.pyw"
set "URL=https://raw.githubusercontent.com/karpuzikov/userscripts/main/image-tools/3x3-image-combiner/3x3_Image_Combiner.pyw"

mkdir "%APPDIR%" 2>nul
call :DownloadLatest "%URL%" "%SCRIPT%"
if errorlevel 1 goto :failed

start "" "%PYTHONW313%" "%SCRIPT%"
exit /b 0

:DownloadLatest
set "DL_URL=%~1"
set "DL_DEST=%~2"
set "DL_TEMP=%~2.download"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $env:DL_URL -OutFile $env:DL_TEMP"
if errorlevel 1 (
    if exist "%DL_DEST%" (
        echo [WARNING] Could not download the latest script. Using the cached copy.
        exit /b 0
    )
    exit /b 1
)
move /y "%DL_TEMP%" "%DL_DEST%" >nul
exit /b %ERRORLEVEL%

:failed
echo.
echo ERROR: Automatic setup failed.
echo Check the internet connection and Windows software-installation permissions.
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

:EnsureWingetPackage
setlocal
set "PKG=%~1"
"%WINGET%" list --id "%PKG%" -e >nul 2>&1
if errorlevel 1 (
    echo [SETUP] Installing %PKG%...
    "%WINGET%" install --id "%PKG%" -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if errorlevel 1 (
        endlocal & exit /b 1
    )
) else (
    echo [SETUP] Checking %PKG% for updates...
    "%WINGET%" upgrade --id "%PKG%" -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity >nul 2>&1
)
endlocal & exit /b 0

:EnsurePython313
call :EnsureWingetPackage Python.Python.3.13
if errorlevel 1 exit /b 1
call :FindPython313
if not defined PYTHON313 (
    echo ERROR: Python 3.13 was installed but could not be located.
    exit /b 1
)
exit /b 0

:FindPython313
set "PYTHON313="
set "PYTHONW313="
if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" set "PYTHON313=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not defined PYTHON313 if exist "%ProgramFiles%\Python313\python.exe" set "PYTHON313=%ProgramFiles%\Python313\python.exe"
if not defined PYTHON313 if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\Python313-32\python.exe" set "PYTHON313=%ProgramFiles(x86)%\Python313-32\python.exe"
if not defined PYTHON313 (
    where py.exe >nul 2>&1
    if not errorlevel 1 (
        for /f "delims=" %%P in ('py.exe -3.13 -c "import sys; print(sys.executable)" 2^>nul') do if not defined PYTHON313 set "PYTHON313=%%P"
    )
)
if defined PYTHON313 (
    for %%P in ("%PYTHON313%") do if exist "%%~dpPpythonw.exe" set "PYTHONW313=%%~dpPpythonw.exe"
)
if not defined PYTHONW313 set "PYTHONW313=%PYTHON313%"
exit /b 0

::PYTHON_PAYLOAD
ZnJvbSBQSUwgaW1wb3J0IEltYWdlLCBJbWFnZU9wcwpmcm9tIHRraW50ZXIgaW1wb3J0IFRrLCBm
aWxlZGlhbG9nLCBtZXNzYWdlYm94CmZyb20gcGF0aGxpYiBpbXBvcnQgUGF0aAoKR1JJRF9TSVpF
ID0gMwpDRUxMX1NJWkUgPSAxMDAwCk9VVFBVVF9TSVpFID0gR1JJRF9TSVpFICogQ0VMTF9TSVpF
CkJBQ0tHUk9VTkQgPSAoMCwgMCwgMCkKSlBFR19RVUFMSVRZID0gOTUKClNVUFBPUlRFRCA9IFsK
ICAgICgiSW1hZ2VzIiwgIiouanBnICouanBlZyAqLnBuZyAqLndlYnAgKi5ibXAgKi50aWYgKi50
aWZmIiksCiAgICAoIkFsbCBmaWxlcyIsICIqLioiKSwKXQoKCmRlZiBtYWluKCk6CiAgICByb290
ID0gVGsoKQogICAgcm9vdC53aXRoZHJhdygpCiAgICByb290LmF0dHJpYnV0ZXMoIi10b3Btb3N0
IiwgVHJ1ZSkKCiAgICB0cnk6CiAgICAgICAgZmlsZXMgPSBmaWxlZGlhbG9nLmFza29wZW5maWxl
bmFtZXMoCiAgICAgICAgICAgIHBhcmVudD1yb290LAogICAgICAgICAgICB0aXRsZT0iU2VsZWN0
IHVwIHRvIDkgcGljdHVyZXMiLAogICAgICAgICAgICBmaWxldHlwZXM9U1VQUE9SVEVELAogICAg
ICAgICkKCiAgICAgICAgaWYgbm90IGZpbGVzOgogICAgICAgICAgICByZXR1cm4KCiAgICAgICAg
ZmlsZXMgPSBsaXN0KGZpbGVzKVs6OV0KCiAgICAgICAgY2FudmFzID0gSW1hZ2UubmV3KAogICAg
ICAgICAgICAiUkdCIiwKICAgICAgICAgICAgKE9VVFBVVF9TSVpFLCBPVVRQVVRfU0laRSksCiAg
ICAgICAgICAgIEJBQ0tHUk9VTkQKICAgICAgICApCgogICAgICAgIGZvciBpbmRleCwgZmlsZW5h
bWUgaW4gZW51bWVyYXRlKGZpbGVzKToKICAgICAgICAgICAgd2l0aCBJbWFnZS5vcGVuKGZpbGVu
YW1lKSBhcyBpbWc6CiAgICAgICAgICAgICAgICBpbWcgPSBJbWFnZU9wcy5leGlmX3RyYW5zcG9z
ZShpbWcpLmNvbnZlcnQoIlJHQiIpCgogICAgICAgICAgICAgICAgaW1nID0gSW1hZ2VPcHMuZml0
KAogICAgICAgICAgICAgICAgICAgIGltZywKICAgICAgICAgICAgICAgICAgICAoQ0VMTF9TSVpF
LCBDRUxMX1NJWkUpLAogICAgICAgICAgICAgICAgICAgIG1ldGhvZD1JbWFnZS5SZXNhbXBsaW5n
LkxBTkNaT1MsCiAgICAgICAgICAgICAgICAgICAgY2VudGVyaW5nPSgwLjUsIDAuNSksCiAgICAg
ICAgICAgICAgICApCgogICAgICAgICAgICAgICAgY29sdW1uID0gaW5kZXggJSBHUklEX1NJWkUK
ICAgICAgICAgICAgICAgIHJvdyA9IGluZGV4IC8vIEdSSURfU0laRQoKICAgICAgICAgICAgICAg
IHggPSBjb2x1bW4gKiBDRUxMX1NJWkUKICAgICAgICAgICAgICAgIHkgPSByb3cgKiBDRUxMX1NJ
WkUKCiAgICAgICAgICAgICAgICBjYW52YXMucGFzdGUoaW1nLCAoeCwgeSkpCgogICAgICAgIGZp
cnN0X2ZpbGUgPSBQYXRoKGZpbGVzWzBdKQogICAgICAgIG91dHB1dF9wYXRoID0gZmlyc3RfZmls
ZS5wYXJlbnQgLyAiY29tYmluZWRfM3gzLmpwZyIKCiAgICAgICAgY291bnRlciA9IDIKICAgICAg
ICB3aGlsZSBvdXRwdXRfcGF0aC5leGlzdHMoKToKICAgICAgICAgICAgb3V0cHV0X3BhdGggPSBm
aXJzdF9maWxlLnBhcmVudCAvIGYiY29tYmluZWRfM3gzX3tjb3VudGVyfS5qcGciCiAgICAgICAg
ICAgIGNvdW50ZXIgKz0gMQoKICAgICAgICBjYW52YXMuc2F2ZSgKICAgICAgICAgICAgb3V0cHV0
X3BhdGgsCiAgICAgICAgICAgICJKUEVHIiwKICAgICAgICAgICAgcXVhbGl0eT1KUEVHX1FVQUxJ
VFksCiAgICAgICAgICAgIHN1YnNhbXBsaW5nPTAsCiAgICAgICAgICAgIG9wdGltaXplPVRydWUs
CiAgICAgICAgKQoKICAgICAgICBtZXNzYWdlYm94LnNob3dpbmZvKAogICAgICAgICAgICAiRG9u
ZSIsCiAgICAgICAgICAgIGYiU2F2ZWQ6XG57b3V0cHV0X3BhdGh9IiwKICAgICAgICAgICAgcGFy
ZW50PXJvb3QKICAgICAgICApCgogICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOgogICAgICAgIG1l
c3NhZ2Vib3guc2hvd2Vycm9yKAogICAgICAgICAgICAiRXJyb3IiLAogICAgICAgICAgICBzdHIo
ZSksCiAgICAgICAgICAgIHBhcmVudD1yb290CiAgICAgICAgKQoKICAgIGZpbmFsbHk6CiAgICAg
ICAgcm9vdC5kZXN0cm95KCkKCgppZiBfX25hbWVfXyA9PSAiX19tYWluX18iOgogICAgbWFpbigp
