@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================================
rem Requirements Manager
rem Combines:
rem   - install_requirements_auto.bat
rem   - path.bat
rem   - add_context_menu.bat
rem   - remove_context_menu.bat
rem ============================================================

call :EnsureWinget
if errorlevel 1 (
    echo ERROR: Dependency bootstrap failed.
    pause
    exit /b 1
)

set "SELF=%~f0"

rem Context-menu mode: install the selected requirements file.
if /I "%~1"=="--install-file" (
    if "%~2"=="" (
        echo ERROR: No requirements file was supplied.
        pause
        exit /b 1
    )
    call :InstallFile "%~2"
    exit /b %errorlevel%
)

:Menu
cls
title Requirements Manager
echo.
echo ==========================================
echo            Requirements Manager
echo ==========================================
echo.
echo  [1] Install one requirements.txt
echo  [2] Install all requirements.txt in folder
echo  [3] Add "Install requirements" context menu
echo  [4] Remove "Install requirements" context menu
echo  [5] Exit
echo.
choice /C 12345 /N /M "Select an option: "

if errorlevel 5 exit /b 0
if errorlevel 4 goto RemoveContextMenu
if errorlevel 3 goto AddContextMenu
if errorlevel 2 goto InstallAll
if errorlevel 1 goto InstallOne

goto Menu


:InstallOne
cls
echo.
set "REQ_FILE="
set /p "REQ_FILE=Enter requirements.txt path: "

rem Remove quotes if the path was pasted/dragged with quotes.
for %%I in ("%REQ_FILE%") do set "REQ_FILE=%%~fI"

if not defined REQ_FILE (
    echo.
    echo No file specified.
    pause
    goto Menu
)

call :InstallFile "%REQ_FILE%"
echo.
pause
goto Menu


:InstallAll
cls
title Install All requirements.txt
echo.
set "ROOT="
set /p "ROOT=Enter the root folder: "

rem Remove quotes and normalize the folder path.
for %%I in ("%ROOT%") do set "ROOT=%%~fI"

if not defined ROOT (
    echo.
    echo No folder specified.
    pause
    goto Menu
)

if not exist "%ROOT%\" (
    echo.
    echo Folder not found:
    echo "%ROOT%"
    pause
    goto Menu
)

echo.
echo Scanning...
echo.

set /a COUNT=0
set /a INSTALLED=0
set /a FAILED=0

for /R "%ROOT%" %%F in (requirements.txt) do (
    if exist "%%F" if not exist "%%F\" (
        set /a COUNT+=1
        echo [!COUNT!] %%F

        call :RunPipForFile "%%F" 1
        if !errorlevel! equ 0 (
            set /a INSTALLED+=1
        ) else (
            set /a FAILED+=1
        )
    )
)

echo.
echo ==========================================
echo Finished
echo Found:      !COUNT! requirements.txt
echo Installed:  !INSTALLED!
echo Failed:     !FAILED!
echo ==========================================
echo.
pause
goto Menu


:AddContextMenu
cls
echo.
echo Installing context menu...
echo.

set "CTX_KEY=HKCU\Software\Classes\SystemFileAssociations\.txt\shell\Install requirements"

reg add "%CTX_KEY%" /ve /d "Install requirements" /f >nul
if errorlevel 1 goto ContextAddError

reg add "%CTX_KEY%\command" /ve /d "\"%SELF%\" --install-file \"%%1\"" /f >nul
if errorlevel 1 goto ContextAddError

echo Context menu installed.
echo.
echo Right-click a requirements.txt file and choose:
echo Install requirements
echo.
pause
goto Menu

:ContextAddError
echo ERROR: Could not create the context-menu entry.
echo.
pause
goto Menu


:RemoveContextMenu
cls
echo.
echo Removing context menu...
echo.

rem Remove the per-user entry created by this combined BAT.
reg delete "HKCU\Software\Classes\SystemFileAssociations\.txt\shell\Install requirements" /f >nul 2>nul

rem Also try to clean up entries created by the old standalone BATs.
reg delete "HKCU\Software\Classes\txtfile\shell\Install requirements" /f >nul 2>nul
reg delete "HKCR\txtfile\shell\Install requirements" /f >nul 2>nul
reg delete "HKCR\SystemFileAssociations\.txt\shell\Install requirements" /f >nul 2>nul

echo Context-menu entries removed where accessible.
echo.
pause
goto Menu


:InstallFile
setlocal
set "REQ_FILE=%~f1"

if not exist "%REQ_FILE%" (
    echo.
    echo ERROR: File not found:
    echo "%REQ_FILE%"
    endlocal & exit /b 1
)

echo.
echo Installing:
echo "%REQ_FILE%"
echo.

call :RunPipForFile "%REQ_FILE%" 0
set "RC=%errorlevel%"

echo.
if "%RC%"=="0" (
    echo Installation completed successfully.
) else (
    echo ERROR: pip exited with code %RC%.
)

endlocal & exit /b %RC%


:RunPipForFile
setlocal EnableDelayedExpansion
set "REQ_FILE=%~f1"
set "QUIET=%~2"
set "PYTHON="
set "CURRENT=%~dp1"

rem Search upward for ComfyUI's embedded Python.
:SearchEmbedded
if exist "!CURRENT!python_embeded\python.exe" (
    set "PYTHON=!CURRENT!python_embeded\python.exe"
    goto PythonFound
)

for %%I in ("!CURRENT!..") do set "PARENT=%%~fI\"
if /I "!PARENT!"=="!CURRENT!" goto SearchSystemPython

set "CURRENT=!PARENT!"
goto SearchEmbedded


:SearchSystemPython
rem Prefer the Python launcher if available.
where py.exe >nul 2>nul
if not errorlevel 1 (
    set "PYTHON=py"
    goto PythonFound
)

for /f "delims=" %%I in ('where python.exe 2^>nul') do (
    set "PYTHON=%%I"
    goto PythonFound
)

echo [SETUP] Python not found. Installing/updating Python 3.13...
call :EnsureWingetPackage Python.Python.3.13
if errorlevel 1 (
    echo ERROR: Python installation failed.
    endlocal & exit /b 1
)

set "PATH=!PATH!;%LOCALAPPDATA%\Programs\Python\Python313;%LOCALAPPDATA%\Programs\Python\Python313\Scripts;%LOCALAPPDATA%\Programs\Python\Launcher"

where py.exe >nul 2>nul
if not errorlevel 1 (
    set "PYTHON=py"
    goto PythonFound
)

if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" (
    set "PYTHON=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    goto PythonFound
)

if exist "%ProgramFiles%\Python313\python.exe" (
    set "PYTHON=%ProgramFiles%\Python313\python.exe"
    goto PythonFound
)

echo ERROR: Python 3.13 was installed but could not be located.
endlocal & exit /b 1


:PythonFound
if /I "!PYTHON!"=="py" (
    if "!QUIET!"=="1" (
        py -m pip install -r "!REQ_FILE!" >nul 2>nul
    ) else (
        echo Using system Python launcher:
        echo py
        echo.
        py -m pip install -r "!REQ_FILE!"
    )
) else (
    if "!QUIET!"=="1" (
        "!PYTHON!" -m pip install -r "!REQ_FILE!" >nul 2>nul
    ) else (
        echo Using Python:
        echo "!PYTHON!"
        echo.
        "!PYTHON!" -m pip install -r "!REQ_FILE!"
    )
)

set "RC=!errorlevel!"
endlocal & exit /b %RC%
