@echo off
setlocal EnableExtensions DisableDelayedExpansion
title CUE Filename Fixer - UTF-8 Recursive

call :EnsureWinget
if errorlevel 1 goto :failed
call :EnsurePython313
if errorlevel 1 goto :failed

set "TEMP_PYW=%TEMP%\CUE_Filename_Fixer_%RANDOM%_%RANDOM%.pyw"
set "PAYLOAD_SELF=%~f0"
set "PAYLOAD_OUT=%TEMP_PYW%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $lines=Get-Content -LiteralPath $env:PAYLOAD_SELF; $m=[Array]::LastIndexOf($lines,'::PYTHON_PAYLOAD'); if($m -lt 0){throw 'Embedded Python payload not found.'}; $b64=($lines[($m+1)..($lines.Count-1)] -join ''); [IO.File]::WriteAllBytes($env:PAYLOAD_OUT,[Convert]::FromBase64String($b64))"
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
IyAtKi0gY29kaW5nOiB1dGYtOCAtKi0KaW1wb3J0IHJlCmltcG9ydCBzaHV0aWwKaW1wb3J0IHRr
aW50ZXIgYXMgdGsKZnJvbSBwYXRobGliIGltcG9ydCBQYXRoCmZyb20gdGtpbnRlciBpbXBvcnQg
ZmlsZWRpYWxvZywgbWVzc2FnZWJveAoKQVVESU9fRVhUUyA9IHsKICAgICIubTRhIiwgIi5tcDQi
LCAiLmZsYWMiLCAiLndhdiIsICIuYWlmZiIsICIuYWlmIiwgIi5hcGUiLCAiLnd2IiwKICAgICIu
bXAzIiwgIi5vZ2ciLCAiLm9wdXMiLCAiLmFhYyIsICIudHRhIiwgIi50YWsiLCAiLmFsYWMiLCAi
LmNhZiIKfQoKRklMRV9SRSA9IHJlLmNvbXBpbGUoCiAgICByJ14oP1A8aW5kZW50PlxzKilGSUxF
XHMrIig/UDxuYW1lPlteIl0rKSIoP1A8dGFpbD5ccytcUysuKikkJywKICAgIHJlLklHTk9SRUNB
U0UKKQoKTEVBRElOR19OVU1CRVJfUkUgPSByZS5jb21waWxlKHInXlxzKjAqKFxkKykoPz1cRHwk
KScpCgoKZGVmIHJlYWRfdGV4dF9hdXRvKHBhdGg6IFBhdGgpIC0+IHN0cjoKICAgIGRhdGEgPSBw
YXRoLnJlYWRfYnl0ZXMoKQoKICAgIGZvciBlbmMgaW4gKCJ1dGYtOC1zaWciLCAidXRmLTgiLCAi
dXRmLTE2IiwgInV0Zi0xNi1sZSIsICJ1dGYtMTYtYmUiKToKICAgICAgICB0cnk6CiAgICAgICAg
ICAgIHJldHVybiBkYXRhLmRlY29kZShlbmMpCiAgICAgICAgZXhjZXB0IFVuaWNvZGVEZWNvZGVF
cnJvcjoKICAgICAgICAgICAgcGFzcwoKICAgIGZvciBlbmMgaW4gKAogICAgICAgICJjcDEyNTEi
LCAiY3AxMjUyIiwgImNwOTMyIiwgInNoaWZ0X2ppcyIsICJldWNfanAiLAogICAgICAgICJnYjE4
MDMwIiwgImJpZzUiLCAiZXVjX2tyIiwgImNwMTI1NSIsICJpc28tODg1OS04IgogICAgKToKICAg
ICAgICB0cnk6CiAgICAgICAgICAgIHJldHVybiBkYXRhLmRlY29kZShlbmMpCiAgICAgICAgZXhj
ZXB0IFVuaWNvZGVEZWNvZGVFcnJvcjoKICAgICAgICAgICAgcGFzcwoKICAgIHJldHVybiBkYXRh
LmRlY29kZSgibGF0aW4tMSIpCgoKZGVmIHRyYWNrX251bWJlcl9mcm9tX25hbWUobmFtZTogc3Ry
KToKICAgIG0gPSBMRUFESU5HX05VTUJFUl9SRS5tYXRjaChQYXRoKG5hbWUpLm5hbWUpCiAgICBy
ZXR1cm4gaW50KG0uZ3JvdXAoMSkpIGlmIG0gZWxzZSBOb25lCgoKZGVmIGNvbGxlY3RfYXVkaW9f
ZmlsZXMoZm9sZGVyOiBQYXRoKToKICAgIGZpbGVzID0gW10KCiAgICBmb3IgcCBpbiBmb2xkZXIu
aXRlcmRpcigpOgogICAgICAgIGlmIG5vdCBwLmlzX2ZpbGUoKToKICAgICAgICAgICAgY29udGlu
dWUKCiAgICAgICAgaWYgcC5zdWZmaXgubG93ZXIoKSBub3QgaW4gQVVESU9fRVhUUzoKICAgICAg
ICAgICAgY29udGludWUKCiAgICAgICAgbiA9IHRyYWNrX251bWJlcl9mcm9tX25hbWUocC5uYW1l
KQogICAgICAgIGlmIG4gaXMgbm90IE5vbmU6CiAgICAgICAgICAgIGZpbGVzLmFwcGVuZCgobiwg
cCkpCgogICAgcmV0dXJuIGZpbGVzCgoKZGVmIGNob29zZV9tYXRjaCh0cmFja19ubzogaW50LCBv
bGRfbmFtZTogc3RyLCBjYW5kaWRhdGVzKToKICAgIHNhbWVfdHJhY2sgPSBbcCBmb3IgbiwgcCBp
biBjYW5kaWRhdGVzIGlmIG4gPT0gdHJhY2tfbm9dCgogICAgaWYgbm90IHNhbWVfdHJhY2s6CiAg
ICAgICAgcmV0dXJuIE5vbmUKCiAgICBvbGRfZXh0ID0gUGF0aChvbGRfbmFtZSkuc3VmZml4Lmxv
d2VyKCkKICAgIHNhbWVfZXh0ID0gW3AgZm9yIHAgaW4gc2FtZV90cmFjayBpZiBwLnN1ZmZpeC5s
b3dlcigpID09IG9sZF9leHRdCiAgICBwb29sID0gc2FtZV9leHQgaWYgc2FtZV9leHQgZWxzZSBz
YW1lX3RyYWNrCgogICAgaWYgbGVuKHBvb2wpID09IDE6CiAgICAgICAgcmV0dXJuIHBvb2xbMF0K
CiAgICBvbGRfcHJlZml4X21hdGNoID0gcmUubWF0Y2gocideXHMqKFxkKyknLCBQYXRoKG9sZF9u
YW1lKS5uYW1lKQogICAgaWYgb2xkX3ByZWZpeF9tYXRjaDoKICAgICAgICBvbGRfcHJlZml4ID0g
b2xkX3ByZWZpeF9tYXRjaC5ncm91cCgxKQoKICAgICAgICBzYW1lX3ByZWZpeCA9IFtdCiAgICAg
ICAgZm9yIHAgaW4gcG9vbDoKICAgICAgICAgICAgbSA9IHJlLm1hdGNoKHInXlxzKihcZCspJywg
cC5uYW1lKQogICAgICAgICAgICBpZiBtIGFuZCBtLmdyb3VwKDEpID09IG9sZF9wcmVmaXg6CiAg
ICAgICAgICAgICAgICBzYW1lX3ByZWZpeC5hcHBlbmQocCkKCiAgICAgICAgaWYgbGVuKHNhbWVf
cHJlZml4KSA9PSAxOgogICAgICAgICAgICByZXR1cm4gc2FtZV9wcmVmaXhbMF0KCiAgICBuYW1l
cyA9ICJcbiIuam9pbihmIiAg4oCiIHtwLm5hbWV9IiBmb3IgcCBpbiBwb29sKQogICAgcmFpc2Ug
UnVudGltZUVycm9yKAogICAgICAgIGYi0JTQu9GPINGC0YDQtdC60LAge3RyYWNrX25vOjAyZH0g
0L3QsNC50LTQtdC90L4g0L3QtdGB0LrQvtC70YzQutC+INC/0L7QtNGF0L7QtNGP0YnQuNGFINGE
0LDQudC70L7QsjpcbntuYW1lc30iCiAgICApCgoKZGVmIGZpeF9jdWUoY3VlX3BhdGg6IFBhdGgp
OgogICAgdGV4dCA9IHJlYWRfdGV4dF9hdXRvKGN1ZV9wYXRoKQogICAgYXVkaW9fZmlsZXMgPSBj
b2xsZWN0X2F1ZGlvX2ZpbGVzKGN1ZV9wYXRoLnBhcmVudCkKCiAgICBpZiBub3QgYXVkaW9fZmls
ZXM6CiAgICAgICAgcmV0dXJuICJza2lwcGVkIiwgMCwgItCSINC/0LDQv9C60LUgQ1VFINC90LXR
giDQv9GA0L7QvdGD0LzQtdGA0L7QstCw0L3QvdGL0YUg0LDRg9C00LjQvtGE0LDQudC70L7Qsi4i
CgogICAgbGluZXMgPSB0ZXh0LnNwbGl0bGluZXMoa2VlcGVuZHM9VHJ1ZSkKICAgIGNoYW5nZWQg
PSAwCiAgICBtaXNzaW5nID0gW10KICAgIG91dCA9IFtdCgogICAgZm9yIGxpbmUgaW4gbGluZXM6
CiAgICAgICAgbmV3bGluZSA9ICIiCiAgICAgICAgYm9keSA9IGxpbmUKCiAgICAgICAgaWYgYm9k
eS5lbmRzd2l0aCgiXHJcbiIpOgogICAgICAgICAgICBib2R5LCBuZXdsaW5lID0gYm9keVs6LTJd
LCAiXHJcbiIKICAgICAgICBlbGlmIGJvZHkuZW5kc3dpdGgoIlxuIikgb3IgYm9keS5lbmRzd2l0
aCgiXHIiKToKICAgICAgICAgICAgYm9keSwgbmV3bGluZSA9IGJvZHlbOi0xXSwgYm9keVstMV0K
CiAgICAgICAgbSA9IEZJTEVfUkUubWF0Y2goYm9keSkKCiAgICAgICAgaWYgbm90IG06CiAgICAg
ICAgICAgIG91dC5hcHBlbmQobGluZSkKICAgICAgICAgICAgY29udGludWUKCiAgICAgICAgb2xk
X25hbWUgPSBtLmdyb3VwKCJuYW1lIikKICAgICAgICB0cmFja19ubyA9IHRyYWNrX251bWJlcl9m
cm9tX25hbWUob2xkX25hbWUpCgogICAgICAgIGlmIHRyYWNrX25vIGlzIE5vbmU6CiAgICAgICAg
ICAgIG91dC5hcHBlbmQobGluZSkKICAgICAgICAgICAgY29udGludWUKCiAgICAgICAgbWF0Y2gg
PSBjaG9vc2VfbWF0Y2godHJhY2tfbm8sIG9sZF9uYW1lLCBhdWRpb19maWxlcykKCiAgICAgICAg
aWYgbWF0Y2ggaXMgTm9uZToKICAgICAgICAgICAgbWlzc2luZy5hcHBlbmQoZiJ7dHJhY2tfbm86
MDJkfToge29sZF9uYW1lfSIpCiAgICAgICAgICAgIG91dC5hcHBlbmQobGluZSkKICAgICAgICAg
ICAgY29udGludWUKCiAgICAgICAgbmV3X2JvZHkgPSBmJ3ttLmdyb3VwKCJpbmRlbnQiKX1GSUxF
ICJ7bWF0Y2gubmFtZX0ie20uZ3JvdXAoInRhaWwiKX0nCiAgICAgICAgb3V0LmFwcGVuZChuZXdf
Ym9keSArIG5ld2xpbmUpCgogICAgICAgIGlmIG1hdGNoLm5hbWUgIT0gb2xkX25hbWU6CiAgICAg
ICAgICAgIGNoYW5nZWQgKz0gMQoKICAgIGlmIG1pc3Npbmc6CiAgICAgICAgcmV0dXJuICgKICAg
ICAgICAgICAgImVycm9yIiwKICAgICAgICAgICAgMCwKICAgICAgICAgICAgItCd0LUg0L3QsNC5
0LTQtdC90Ysg0LDRg9C00LjQvtGE0LDQudC70Ysg0LTQu9GPOlxuIiArICJcbiIuam9pbihtaXNz
aW5nKQogICAgICAgICkKCiAgICBpZiBjaGFuZ2VkID09IDA6CiAgICAgICAgcmV0dXJuICJ1bmNo
YW5nZWQiLCAwLCAi0JjQt9C80LXQvdC10L3QuNGPINC90LUg0YLRgNC10LHRg9GO0YLRgdGPLiIK
CiAgICBiYWNrdXAgPSBjdWVfcGF0aC53aXRoX3N1ZmZpeChjdWVfcGF0aC5zdWZmaXggKyAiLmJh
ayIpCgogICAgIyDQndC1INC30LDRgtC40YDQsNC10Lwg0YHRgtCw0YDRi9C5IGJhY2t1cC4KICAg
IGlmIGJhY2t1cC5leGlzdHMoKToKICAgICAgICBpID0gMQogICAgICAgIHdoaWxlIFRydWU6CiAg
ICAgICAgICAgIGNhbmRpZGF0ZSA9IGN1ZV9wYXRoLndpdGhfbmFtZShjdWVfcGF0aC5uYW1lICsg
ZiIuYmFre2l9IikKICAgICAgICAgICAgaWYgbm90IGNhbmRpZGF0ZS5leGlzdHMoKToKICAgICAg
ICAgICAgICAgIGJhY2t1cCA9IGNhbmRpZGF0ZQogICAgICAgICAgICAgICAgYnJlYWsKICAgICAg
ICAgICAgaSArPSAxCgogICAgc2h1dGlsLmNvcHkyKGN1ZV9wYXRoLCBiYWNrdXApCgogICAgIyBV
VEYtOCB3aXRob3V0IEJPTS4KICAgIGN1ZV9wYXRoLndyaXRlX3RleHQoIiIuam9pbihvdXQpLCBl
bmNvZGluZz0idXRmLTgiLCBuZXdsaW5lPSIiKQoKICAgIHJldHVybiAiZml4ZWQiLCBjaGFuZ2Vk
LCBmItCY0YHQv9GA0LDQstC70LXQvdC+INGB0YLRgNC+0LogRklMRToge2NoYW5nZWR9IgoKCmRl
ZiBtYWluKCk6CiAgICByb290ID0gdGsuVGsoKQogICAgcm9vdC53aXRoZHJhdygpCiAgICByb290
LnVwZGF0ZSgpCgogICAgZm9sZGVyX25hbWUgPSBmaWxlZGlhbG9nLmFza2RpcmVjdG9yeSgKICAg
ICAgICB0aXRsZT0i0JLRi9Cx0LXRgNC40YLQtSDQv9Cw0L/QutGDINC00LvRjyDQv9C+0LjRgdC6
0LAgQ1VFLdGE0LDQudC70L7QsiIKICAgICkKCiAgICBpZiBub3QgZm9sZGVyX25hbWU6CiAgICAg
ICAgcm9vdC5kZXN0cm95KCkKICAgICAgICByZXR1cm4KCiAgICByb290X2ZvbGRlciA9IFBhdGgo
Zm9sZGVyX25hbWUpCgogICAgY3VlX2ZpbGVzID0gc29ydGVkKAogICAgICAgIHAgZm9yIHAgaW4g
cm9vdF9mb2xkZXIucmdsb2IoIioiKQogICAgICAgIGlmIHAuaXNfZmlsZSgpIGFuZCBwLnN1ZmZp
eC5sb3dlcigpID09ICIuY3VlIgogICAgKQoKICAgIGlmIG5vdCBjdWVfZmlsZXM6CiAgICAgICAg
bWVzc2FnZWJveC5zaG93aW5mbygKICAgICAgICAgICAgItCT0L7RgtC+0LLQviIsCiAgICAgICAg
ICAgICLQkiDQstGL0LHRgNCw0L3QvdC+0Lkg0L/QsNC/0LrQtSDQuCDQtdGRINC/0L7QtNC/0LDQ
v9C60LDRhSBDVUUt0YTQsNC50LvRiyDQvdC1INC90LDQudC00LXQvdGLLiIKICAgICAgICApCiAg
ICAgICAgcm9vdC5kZXN0cm95KCkKICAgICAgICByZXR1cm4KCiAgICBmaXhlZF9maWxlcyA9IDAK
ICAgIGZpeGVkX2xpbmVzID0gMAogICAgdW5jaGFuZ2VkX2ZpbGVzID0gMAogICAgc2tpcHBlZF9m
aWxlcyA9IDAKICAgIGVycm9ycyA9IFtdCgogICAgZm9yIGN1ZV9wYXRoIGluIGN1ZV9maWxlczoK
ICAgICAgICB0cnk6CiAgICAgICAgICAgIHN0YXR1cywgY2hhbmdlZCwgaW5mbyA9IGZpeF9jdWUo
Y3VlX3BhdGgpCgogICAgICAgICAgICBpZiBzdGF0dXMgPT0gImZpeGVkIjoKICAgICAgICAgICAg
ICAgIGZpeGVkX2ZpbGVzICs9IDEKICAgICAgICAgICAgICAgIGZpeGVkX2xpbmVzICs9IGNoYW5n
ZWQKICAgICAgICAgICAgZWxpZiBzdGF0dXMgPT0gInVuY2hhbmdlZCI6CiAgICAgICAgICAgICAg
ICB1bmNoYW5nZWRfZmlsZXMgKz0gMQogICAgICAgICAgICBlbGlmIHN0YXR1cyA9PSAic2tpcHBl
ZCI6CiAgICAgICAgICAgICAgICBza2lwcGVkX2ZpbGVzICs9IDEKICAgICAgICAgICAgZWxpZiBz
dGF0dXMgPT0gImVycm9yIjoKICAgICAgICAgICAgICAgIGVycm9ycy5hcHBlbmQoZiJ7Y3VlX3Bh
dGh9XG57aW5mb30iKQoKICAgICAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGU6CiAgICAgICAgICAg
IGVycm9ycy5hcHBlbmQoZiJ7Y3VlX3BhdGh9XG57ZX0iKQoKICAgIHJlcG9ydCA9ICgKICAgICAg
ICBmItCd0LDQudC00LXQvdC+IENVRToge2xlbihjdWVfZmlsZXMpfVxuIgogICAgICAgIGYi0JjR
gdC/0YDQsNCy0LvQtdC90L4gQ1VFOiB7Zml4ZWRfZmlsZXN9XG4iCiAgICAgICAgZiLQmNGB0L/R
gNCw0LLQu9C10L3QviDRgdGC0YDQvtC6IEZJTEU6IHtmaXhlZF9saW5lc31cbiIKICAgICAgICBm
ItCR0LXQtyDQuNC30LzQtdC90LXQvdC40Lk6IHt1bmNoYW5nZWRfZmlsZXN9XG4iCiAgICAgICAg
ZiLQn9GA0L7Qv9GD0YnQtdC90L46IHtza2lwcGVkX2ZpbGVzfVxuIgogICAgICAgIGYi0J7RiNC4
0LHQvtC6OiB7bGVuKGVycm9ycyl9IgogICAgKQoKICAgIGlmIGVycm9yczoKICAgICAgICBlcnJv
cl9sb2cgPSByb290X2ZvbGRlciAvICJDVUVfRml4X0Vycm9ycy50eHQiCiAgICAgICAgZXJyb3Jf
bG9nLndyaXRlX3RleHQoCiAgICAgICAgICAgICJcblxuIiArICgiXG5cbiIgKyAiPSIgKiA4MCAr
ICJcblxuIikuam9pbihlcnJvcnMpLAogICAgICAgICAgICBlbmNvZGluZz0idXRmLTgiCiAgICAg
ICAgKQoKICAgICAgICByZXBvcnQgKz0gKAogICAgICAgICAgICBmIlxuXG7Qn9C+0LTRgNC+0LHQ
vdC+0YHRgtC4INC+0YjQuNCx0L7QuiDRgdC+0YXRgNCw0L3QtdC90Ysg0LI6XG57ZXJyb3JfbG9n
fSIKICAgICAgICApCgogICAgbWVzc2FnZWJveC5zaG93aW5mbygi0JPQvtGC0L7QstC+IiwgcmVw
b3J0KQogICAgcm9vdC5kZXN0cm95KCkKCgppZiBfX25hbWVfXyA9PSAiX19tYWluX18iOgogICAg
bWFpbigp
