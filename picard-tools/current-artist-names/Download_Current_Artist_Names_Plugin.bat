@echo off
setlocal EnableExtensions
set "OUT=%~dp0Current_Artist_Names_Picard_Plugin"
set "BASE=https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/current-artist-names"
mkdir "%OUT%" 2>nul
for %%F in (__init__.py MANIFEST.toml README.md test_helpers.py) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '%BASE%/%%F' -OutFile '%OUT%\%%F'"
    if errorlevel 1 exit /b 1
)
echo Downloaded to:
echo %OUT%
pause