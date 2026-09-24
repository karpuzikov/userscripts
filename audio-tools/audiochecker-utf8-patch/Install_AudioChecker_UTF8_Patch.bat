@echo off
setlocal EnableExtensions
set "BASE=https://raw.githubusercontent.com/karpuzikov/userscripts/main/audio-tools/audiochecker-utf8-patch"
set /p "ROOT=Enter the folder containing achkgui.exe: "
set "ROOT=%ROOT:"=%"
if not exist "%ROOT%\achkgui.exe" (
    echo achkgui.exe was not found in that folder.
    pause
    exit /b 1
)
for %%D in ("Codecs\APE" "Codecs\Analyzer" "Codecs\FLAC" "Codecs\LPAC" "Codecs\SHN") do mkdir "%ROOT%\%%~D" 2>nul
call :get "achkgui.exe.manifest" "%ROOT%\achkgui.exe.manifest" || exit /b 1
call :get "Codecs/APE/mac.exe.manifest" "%ROOT%\Codecs\APE\mac.exe.manifest" || exit /b 1
call :get "Codecs/Analyzer/aucdtect.exe.manifest" "%ROOT%\Codecs\Analyzer\aucdtect.exe.manifest" || exit /b 1
call :get "Codecs/FLAC/flac.exe.manifest" "%ROOT%\Codecs\FLAC\flac.exe.manifest" || exit /b 1
call :get "Codecs/LPAC/lpac.exe.manifest" "%ROOT%\Codecs\LPAC\lpac.exe.manifest" || exit /b 1
call :get "Codecs/SHN/shortn32.exe.manifest" "%ROOT%\Codecs\SHN\shortn32.exe.manifest" || exit /b 1
echo.
echo UTF-8 manifests installed. Restart AudioChecker and test a Unicode path.
pause
exit /b 0
:get
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '%BASE%/%~1' -OutFile '%~2'"
exit /b %ERRORLEVEL%