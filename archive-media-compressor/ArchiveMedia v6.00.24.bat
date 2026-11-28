@echo off
setlocal EnableExtensions DisableDelayedExpansion
title ArchiveMedia v6.0.24 - Under construction

rem Dependency install/update check runs at most once a week; a missing tool triggers it immediately.
set "ARCHIVEMEDIA_DEPENDENCY_STAMP_DIR=%LOCALAPPDATA%\Karpuzikov Tools\ArchiveMedia"
set "ARCHIVEMEDIA_CHECK_DEPENDENCIES=1"
if exist "%ARCHIVEMEDIA_DEPENDENCY_STAMP_DIR%\last-dependency-check.txt" (
    forfiles /p "%ARCHIVEMEDIA_DEPENDENCY_STAMP_DIR%" /m "last-dependency-check.txt" /d -7 >nul 2>&1
    if errorlevel 1 set "ARCHIVEMEDIA_CHECK_DEPENDENCIES=0"
)
where pwsh.exe >nul 2>&1 || if not exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "ARCHIVEMEDIA_CHECK_DEPENDENCIES=1"
where ffmpeg.exe >nul 2>&1 || if not exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe" set "ARCHIVEMEDIA_CHECK_DEPENDENCIES=1"
where ffprobe.exe >nul 2>&1 || if not exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\ffprobe.exe" set "ARCHIVEMEDIA_CHECK_DEPENDENCIES=1"
where magick.exe >nul 2>&1 || dir /b /ad "%ProgramFiles%\ImageMagick-*" >nul 2>&1 || set "ARCHIVEMEDIA_CHECK_DEPENDENCIES=1"

set "WINGET="
where winget.exe >nul 2>&1
if not errorlevel 1 set "WINGET=winget.exe"
if not defined WINGET if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" set "WINGET=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"

if not defined WINGET if "%ARCHIVEMEDIA_CHECK_DEPENDENCIES%"=="1" (
    echo [SETUP] WinGet is not installed. Installing the latest WinGet...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; try { if(-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)){ Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force | Out-Null }; if(-not (Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue)){ Register-PSRepository -Default }; Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; Install-Module -Name Microsoft.WinGet.Client -Repository PSGallery -Scope CurrentUser -Force -AllowClobber; Import-Module Microsoft.WinGet.Client -Force; Repair-WinGetPackageManager -Latest -Force } catch { $tmp=Join-Path $env:TEMP 'Microsoft.DesktopAppInstaller.msixbundle'; Invoke-WebRequest -UseBasicParsing 'https://aka.ms/getwinget' -OutFile $tmp; Add-AppxPackage -Path $tmp; Remove-Item $tmp -Force -ErrorAction SilentlyContinue }"
    if errorlevel 1 (
        echo.
        echo ERROR: Automatic WinGet installation failed.
        pause
        exit /b 1
    )
    if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" set "WINGET=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"
    if not defined WINGET for /f "delims=" %%W in ('where winget.exe 2^>nul') do if not defined WINGET set "WINGET=%%W"
)

if not defined WINGET if "%ARCHIVEMEDIA_CHECK_DEPENDENCIES%"=="1" (
    echo.
    echo ERROR: WinGet is still unavailable after installation.
    pause
    exit /b 1
)

if "%ARCHIVEMEDIA_CHECK_DEPENDENCIES%"=="1" "%WINGET%" source update >nul 2>&1

if "%ARCHIVEMEDIA_CHECK_DEPENDENCIES%"=="1" for %%K in (Microsoft.PowerShell Gyan.FFmpeg ImageMagick.ImageMagick) do (
    "%WINGET%" list --id "%%K" -e >nul 2>&1
    if errorlevel 1 (
        echo [SETUP] Installing %%K...
        "%WINGET%" install --id "%%K" -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
        if errorlevel 1 (
            echo.
            echo ERROR: Failed to install %%K.
            pause
            exit /b 1
        )
    ) else (
        echo [SETUP] Checking %%K for updates...
        "%WINGET%" upgrade --id "%%K" -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity >nul 2>&1
    )
)
if "%ARCHIVEMEDIA_CHECK_DEPENDENCIES%"=="1" if not exist "%ARCHIVEMEDIA_DEPENDENCY_STAMP_DIR%" mkdir "%ARCHIVEMEDIA_DEPENDENCY_STAMP_DIR%"
if "%ARCHIVEMEDIA_CHECK_DEPENDENCIES%"=="1" (echo Last ArchiveMedia dependency check)> "%ARCHIVEMEDIA_DEPENDENCY_STAMP_DIR%\last-dependency-check.txt"

set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WinGet\Links;%ProgramFiles%\PowerShell\7"
for /d %%D in ("%ProgramFiles%\ImageMagick-*") do if exist "%%~fD\magick.exe" set "PATH=%PATH%;%%~fD"

set "PWSH="
for /f "delims=" %%P in ('where pwsh.exe 2^>nul') do if not defined PWSH set "PWSH=%%P"
if not defined PWSH if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not defined PWSH (
    echo.
    echo ERROR: PowerShell 7 is unavailable after dependency setup.
    pause
    exit /b 1
)

set "WORK=%TEMP%\ArchiveMedia_%RANDOM%_%RANDOM%"
set "PAYLOAD_SELF=%~f0"
set "PAYLOAD_ZIP=%WORK%\ArchiveMedia.zip"
set "PAYLOAD_DIR=%WORK%\app"
mkdir "%WORK%" >nul 2>&1
mkdir "%PAYLOAD_DIR%" >nul 2>&1

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $lines=Get-Content -LiteralPath $env:PAYLOAD_SELF; $m=[Array]::LastIndexOf($lines,'::ARCHIVE_PAYLOAD'); if($m -lt 0){throw 'Embedded ArchiveMedia payload not found.'}; $b64=($lines[($m+1)..($lines.Count-1)] -join ''); [IO.File]::WriteAllBytes($env:PAYLOAD_ZIP,[Convert]::FromBase64String($b64)); Expand-Archive -LiteralPath $env:PAYLOAD_ZIP -DestinationPath $env:PAYLOAD_DIR -Force"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo.
    echo ERROR: Archive Media Compressor payload extraction failed.
    pause
    exit /b 1
)

if not exist "%PAYLOAD_DIR%\ArchiveMedia.ps1" (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo.
    echo ERROR: ArchiveMedia.ps1 was not found in the embedded payload.
    pause
    exit /b 1
)

rem ArchiveMedia v6.0.23 analysis-performance and payload-integrity patch.
rem No CALL/GOTO labels are used so GitHub Raw LF line endings cannot break execution.
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $workerPattern='if \(\$storageType -in @\([^)]+\)\) \{\s*\$AnalysisParallel = \[Math\]::Min\(8, \[Math\]::Max\(4, \$logicalCpu\)\)\s*\}\s*else \{\s*\$AnalysisParallel = \[Math\]::Min\(24, \[Math\]::Max\(8, \$logicalCpu \* 2\)\)\s*\}'; $workerReplacement='if ($storageType -in @(''HDD'', ''Unknown'', ''Unspecified'')) { $AnalysisParallel = [Math]::Min(8, [Math]::Max(4, $logicalCpu)) } elseif ($storageType -eq ''SSD'') { $AnalysisParallel = [Math]::Min(48, [Math]::Max(24, $logicalCpu * 3)) } else { $AnalysisParallel = [Math]::Min(24, [Math]::Max(8, $logicalCpu * 2)) }'; $s2=[regex]::Replace($s,$workerPattern,$workerReplacement,1); if($s2 -eq $s){throw 'ArchiveMedia v6.0.23 worker patch did not match embedded payload.'}; $s=$s2; $before=$s; $s=$s.Replace('$children = @($analysisJob.ChildJobs)','$children = $analysisJob.ChildJobs'); if($s -eq $before){throw 'ArchiveMedia v6.0.23 child-job patch did not match embedded payload.'}; $donePattern='\$done = @\(\$children \| Where-Object State -in @\([^)]+\)\)\.Count'; $doneReplacement='$done = 0; foreach ($child in $children) { if ($child.State -in @(''Completed'', ''Failed'', ''Stopped'')) { $done++ } }'; $s2=[regex]::Replace($s,$donePattern,$doneReplacement,1); if($s2 -eq $s){throw 'ArchiveMedia v6.0.23 progress-count patch did not match embedded payload.'}; $s=$s2; $before=$s; $s=$s.Replace('Start-Sleep -Milliseconds 150','Start-Sleep -Milliseconds 1000'); if($s -eq $before){throw 'ArchiveMedia v6.0.23 progress-poll patch did not match embedded payload.'}; $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count -gt 0){$msg=($parseErrors | ForEach-Object { '{0}: {1}' -f $_.Extent.StartLineNumber,$_.Message }) -join '; '; throw ('ArchiveMedia payload syntax check failed: ' + $msg)}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo.
    echo ERROR: Archive Media Compressor payload validation failed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.23 no-growth precommit protection (integrity-checked before launch).
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $needle='            $sourceFull = [IO.Path]::GetFullPath($t.Source)'; $first=$s.IndexOf($needle,[StringComparison]::Ordinal); if($first -lt 0 -or $s.IndexOf($needle,$first+1,[StringComparison]::Ordinal) -ge 0){throw 'ArchiveMedia precommit patch marker must occur exactly once.'}; $insert=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('CiAgICAgICAgICAgICMgQXJjaGl2ZU1lZGlhIHY2LjAuMTQ6IHJlamVjdCBub24tc2F2aW5nIGNvbnZlcnNpb25zIEJFRk9SRSBjb21taXQuCiAgICAgICAgICAgIGlmICgkdC5BY3Rpb24gLWluIEAoIkNvbnZlcnRQaG90byIsICJSZW11eFZpZGVvIiwgIkVuY29kZVZpZGVvIikpIHsKICAgICAgICAgICAgICAgIFtJbnQ2NF0kY2FuZGlkYXRlQnl0ZXMgPSAoW0lPLkZpbGVJbmZvXTo6bmV3KCR0ZW1wKSkuTGVuZ3RoCiAgICAgICAgICAgICAgICBpZiAoJGNhbmRpZGF0ZUJ5dGVzIC1nZSBbSW50NjRdJHQuU291cmNlQnl0ZXMpIHsKICAgICAgICAgICAgICAgICAgICBSZW1vdmUtSXRlbSAtTGl0ZXJhbFBhdGggJHRlbXAgLUZvcmNlIC1FcnJvckFjdGlvbiBTdG9wCgogICAgICAgICAgICAgICAgICAgIGlmICgkdXNpbmc6T3BlcmF0aW9uTW9kZSAtZXEgIlJlcGxhY2UiKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICRyZXN1bHQgPSBbcHNjdXN0b21vYmplY3RdQHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFN1Y2Nlc3MgPSAkdHJ1ZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgU291cmNlID0gJHQuU291cmNlCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbiA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgQWN0aW9uID0gIlNraXAiCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBCZWZvcmVCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICAgICAgQWZ0ZXJCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICAgICAgRXJyb3IgPSAiIgogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICRyZXN1bHRCYWcuQWRkKCRyZXN1bHQpCiAgICAgICAgICAgICAgICAgICAgICAgIFdyaXRlLUhvc3QgKCJbS0VQVCBPUklHSU5BTF0gezB9IC0gY2FuZGlkYXRlIHsxfSB3YXMgbm90IHNtYWxsZXIgdGhhbiB7Mn0iIC1mICR0LlNvdXJjZSwgKEZvcm1hdC1CeXRlc0xvY2FsICRjYW5kaWRhdGVCeXRlcyksIChGb3JtYXQtQnl0ZXNMb2NhbCAoW0ludDY0XSR0LlNvdXJjZUJ5dGVzKSkpIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAkcmVzdWx0CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICAkcmVsYXRpdmVPcmlnaW5hbCA9IFtJTy5QYXRoXTo6R2V0UmVsYXRpdmVQYXRoKCR1c2luZzpJbnB1dFJvb3QsICR0LlNvdXJjZSkKICAgICAgICAgICAgICAgICAgICBpZiAoW0lPLlBhdGhdOjpJc1BhdGhSb290ZWQoJHJlbGF0aXZlT3JpZ2luYWwpIC1vciAkcmVsYXRpdmVPcmlnaW5hbCAtZXEgIi4uIiAtb3IgJHJlbGF0aXZlT3JpZ2luYWwuU3RhcnRzV2l0aCgiLi4iICsgW0lPLlBhdGhdOjpEaXJlY3RvcnlTZXBhcmF0b3JDaGFyKSkgewogICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyAiVW5zYWZlIGZhbGxiYWNrIHBhdGg6ICRyZWxhdGl2ZU9yaWdpbmFsIgogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAkZmFsbGJhY2sgPSBbSU8uUGF0aF06OkdldEZ1bGxQYXRoKChKb2luLVBhdGggJHVzaW5nOk91dHB1dFJvb3QgJHJlbGF0aXZlT3JpZ2luYWwpKQogICAgICAgICAgICAgICAgICAgIGlmIChbc3RyaW5nXTo6RXF1YWxzKCRmYWxsYmFjaywgW0lPLlBhdGhdOjpHZXRGdWxsUGF0aCgkdC5Tb3VyY2UpLCBbU3RyaW5nQ29tcGFyaXNvbl06Ok9yZGluYWxJZ25vcmVDYXNlKSkgewogICAgICAgICAgICAgICAgICAgICAgICAkcmVzdWx0ID0gW3BzY3VzdG9tb2JqZWN0XUB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdWNjZXNzID0gJHRydWUKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFNvdXJjZSA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgRGVzdGluYXRpb24gPSAkdC5Tb3VyY2UKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFjdGlvbiA9ICJTa2lwIgogICAgICAgICAgICAgICAgICAgICAgICAgICAgQmVmb3JlQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFmdGVyQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVycm9yID0gIiIKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAkcmVzdWx0QmFnLkFkZCgkcmVzdWx0KQogICAgICAgICAgICAgICAgICAgICAgICBXcml0ZS1Ib3N0ICgiW0tFUFQgT1JJR0lOQUxdIHswfSAtIG5vIHNtYWxsZXIgb3V0cHV0IiAtZiAkdC5Tb3VyY2UpIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAkcmVzdWx0CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICAjIEZpbGVNb2RlLkNyZWF0ZU5ldyBpcyBhdG9taWMgYW5kIG11c3Qgbm90IHJlcGxhY2UgZXhpc3RpbmcgYXJjaGl2ZSBmaWxlcy4KICAgICAgICAgICAgICAgICAgICAkZmFsbGJhY2tEaXIgPSBbSU8uUGF0aF06OkdldERpcmVjdG9yeU5hbWUoJGZhbGxiYWNrKQogICAgICAgICAgICAgICAgICAgIFtJTy5EaXJlY3RvcnldOjpDcmVhdGVEaXJlY3RvcnkoJGZhbGxiYWNrRGlyKSB8IE91dC1OdWxsCiAgICAgICAgICAgICAgICAgICAgJHJlYWRTdHJlYW0gPSAkbnVsbAogICAgICAgICAgICAgICAgICAgICR3cml0ZVN0cmVhbSA9ICRudWxsCiAgICAgICAgICAgICAgICAgICAgJGNyZWF0ZWRGYWxsYmFjayA9ICRmYWxzZQogICAgICAgICAgICAgICAgICAgICRjb3B5U3VjY2VlZGVkID0gJGZhbHNlCiAgICAgICAgICAgICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgICAgICAgICAgICAgJHdyaXRlU3RyZWFtID0gW0lPLkZpbGVdOjpPcGVuKCRmYWxsYmFjaywgW0lPLkZpbGVNb2RlXTo6Q3JlYXRlTmV3LCBbSU8uRmlsZUFjY2Vzc106OldyaXRlLCBbSU8uRmlsZVNoYXJlXTo6Tm9uZSkKICAgICAgICAgICAgICAgICAgICAgICAgJGNyZWF0ZWRGYWxsYmFjayA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgICRyZWFkU3RyZWFtID0gW0lPLkZpbGVdOjpPcGVuKCR0LlNvdXJjZSwgW0lPLkZpbGVNb2RlXTo6T3BlbiwgW0lPLkZpbGVBY2Nlc3NdOjpSZWFkLCBbSU8uRmlsZVNoYXJlXTo6UmVhZCkKICAgICAgICAgICAgICAgICAgICAgICAgJHJlYWRTdHJlYW0uQ29weVRvKCR3cml0ZVN0cmVhbSkKICAgICAgICAgICAgICAgICAgICAgICAgJHdyaXRlU3RyZWFtLkZsdXNoKCkKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCR3cml0ZVN0cmVhbS5MZW5ndGggLW5lIFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcyAtb3IgJHJlYWRTdHJlYW0uTGVuZ3RoIC1uZSBbSW50NjRdJHQuU291cmNlQnl0ZXMpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93ICJTb3VyY2Ugc2l6ZSBjaGFuZ2VkIGR1cmluZyBvcmlnaW5hbC1jb3B5IGZhbGxiYWNrLiIKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAkY29weVN1Y2NlZWRlZCA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIGZpbmFsbHkgewogICAgICAgICAgICAgICAgICAgICAgICBpZiAoJG51bGwgLW5lICRyZWFkU3RyZWFtKSB7ICRyZWFkU3RyZWFtLkRpc3Bvc2UoKSB9CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgkbnVsbCAtbmUgJHdyaXRlU3RyZWFtKSB7ICR3cml0ZVN0cmVhbS5EaXNwb3NlKCkgfQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoLW5vdCAkY29weVN1Y2NlZWRlZCAtYW5kICRjcmVhdGVkRmFsbGJhY2spIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJlbW92ZS1JdGVtIC1MaXRlcmFsUGF0aCAkZmFsbGJhY2sgLUZvcmNlIC1FcnJvckFjdGlvbiBTaWxlbnRseUNvbnRpbnVlCiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgU2V0LU91dHB1dFRpbWVzICRmYWxsYmFjayAkdC5DcmVhdGlvblRpbWUgJHQuTGFzdFdyaXRlVGltZQogICAgICAgICAgICAgICAgICAgICRyZXN1bHQgPSBbcHNjdXN0b21vYmplY3RdQHsKICAgICAgICAgICAgICAgICAgICAgICAgU3VjY2VzcyA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgIFNvdXJjZSA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbiA9ICRmYWxsYmFjawogICAgICAgICAgICAgICAgICAgICAgICBBY3Rpb24gPSAiQ29weSIKICAgICAgICAgICAgICAgICAgICAgICAgQmVmb3JlQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgQWZ0ZXJCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICBFcnJvciA9ICIiCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICRyZXN1bHRCYWcuQWRkKCRyZXN1bHQpCiAgICAgICAgICAgICAgICAgICAgV3JpdGUtSG9zdCAoIltLRVBUIE9SSUdJTkFMIEZPUk1BVF0gezB9IC0gY2FuZGlkYXRlIHdhcyBub3Qgc21hbGxlcjsgdW5jaGFuZ2VkIGZpbGUgc2F2ZWQgdG8gezF9IiAtZiAkdC5Tb3VyY2UsICRmYWxsYmFjaykgLUZvcmVncm91bmRDb2xvciBZZWxsb3cKICAgICAgICAgICAgICAgICAgICByZXR1cm4gJHJlc3VsdAogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9Cgo=')); $s=$s.Replace($needle,$insert+$needle); $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count -gt 0){throw ('ArchiveMedia safety patch syntax error: '+(($parseErrors | ForEach-Object Message) -join '; '))}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo ERROR: ArchiveMedia safety patch failed. Nothing was processed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.23: SKIP lines contain only status and path.
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $needle='            $label = Get-ActionLabel $Action'; $start=$s.IndexOf($needle,[StringComparison]::Ordinal); if($start -lt 0 -or $s.IndexOf($needle,$start+1,[StringComparison]::Ordinal) -ge 0){throw 'ArchiveMedia SKIP log patch marker must occur exactly once.'}; $append=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('ICAgICAgICAgICAgaWYgKCRBY3Rpb24gLWVxICdTa2lwJykgewogICAgICAgICAgICAgICAgV3JpdGUtSG9zdCAoJ1t7MH1dIHsxfScgLWYgJGxhYmVsLCAkUGF0aCkKICAgICAgICAgICAgICAgIHJldHVybgogICAgICAgICAgICB9Cg==')); $s=$s.Replace($needle,$needle+[char]10+$append); $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count){throw ('SKIP log patch failed syntax check: '+(($parseErrors | ForEach-Object Message) -join '; '))}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo ERROR: ArchiveMedia SKIP log patch failed. Nothing was processed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

"%PWSH%" -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%PAYLOAD_DIR%\ArchiveMedia.ps1"
set "RC=%ERRORLEVEL%"
rd /s /q "%WORK%" >nul 2>&1
exit /b %RC%

::ARCHIVE_PAYLOAD
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
