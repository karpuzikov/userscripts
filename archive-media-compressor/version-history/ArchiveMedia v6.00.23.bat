@echo off
setlocal EnableExtensions DisableDelayedExpansion
title ArchiveMedia v6.0.23 - Under construction

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
SFAAAAAA
