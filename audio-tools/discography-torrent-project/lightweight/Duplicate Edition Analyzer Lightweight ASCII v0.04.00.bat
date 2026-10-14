@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Duplicate Edition Analyzer Lightweight ASCII v0.4.0
cd /d "%~dp0"
set "DEA_SCRIPT=%~dp0Duplicate Edition Analyzer Lightweight v0.4.0.pyw"
if not exist "%DEA_SCRIPT%" (
  echo ERROR: The matching v0.4.0 .pyw file must be beside this launcher.
  pause
  exit /b 1
)
where py >nul 2>&1
if %errorlevel% equ 0 (
  py -3 "%DEA_SCRIPT%" --ascii-ui
  set "RET=!errorlevel!"
  goto :end
)
where python >nul 2>&1
if %errorlevel% equ 0 (
  python "%DEA_SCRIPT%" --ascii-ui
  set "RET=!errorlevel!"
  goto :end
)
echo ERROR: No working Python command found. Install Python 3.11 or newer.
set "RET=1"
:end
if not "%RET%"=="0" (
  echo.
  echo ASCII interface failed with code %RET%.
  pause
)
exit /b %RET%
