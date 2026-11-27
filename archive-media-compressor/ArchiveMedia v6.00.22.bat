@echo off
setlocal EnableExtensions DisableDelayedExpansion
title ArchiveMedia v6.0.22 - Under construction

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

rem ArchiveMedia v6.0.22 analysis-performance and payload-integrity patch.
rem No CALL/GOTO labels are used so GitHub Raw LF line endings cannot break execution.
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $workerPattern='if \(\$storageType -in @\([^)]+\)\) \{\s*\$AnalysisParallel = \[Math\]::Min\(8, \[Math\]::Max\(4, \$logicalCpu\)\)\s*\}\s*else \{\s*\$AnalysisParallel = \[Math\]::Min\(24, \[Math\]::Max\(8, \$logicalCpu \* 2\)\)\s*\}'; $workerReplacement='if ($storageType -in @(''HDD'', ''Unknown'', ''Unspecified'')) { $AnalysisParallel = [Math]::Min(8, [Math]::Max(4, $logicalCpu)) } elseif ($storageType -eq ''SSD'') { $AnalysisParallel = [Math]::Min(48, [Math]::Max(24, $logicalCpu * 3)) } else { $AnalysisParallel = [Math]::Min(24, [Math]::Max(8, $logicalCpu * 2)) }'; $s2=[regex]::Replace($s,$workerPattern,$workerReplacement,1); if($s2 -eq $s){throw 'ArchiveMedia v6.0.22 worker patch did not match embedded payload.'}; $s=$s2; $before=$s; $s=$s.Replace('$children = @($analysisJob.ChildJobs)','$children = $analysisJob.ChildJobs'); if($s -eq $before){throw 'ArchiveMedia v6.0.22 child-job patch did not match embedded payload.'}; $donePattern='\$done = @\(\$children \| Where-Object State -in @\([^)]+\)\)\.Count'; $doneReplacement='$done = 0; foreach ($child in $children) { if ($child.State -in @(''Completed'', ''Failed'', ''Stopped'')) { $done++ } }'; $s2=[regex]::Replace($s,$donePattern,$doneReplacement,1); if($s2 -eq $s){throw 'ArchiveMedia v6.0.22 progress-count patch did not match embedded payload.'}; $s=$s2; $before=$s; $s=$s.Replace('Start-Sleep -Milliseconds 150','Start-Sleep -Milliseconds 1000'); if($s -eq $before){throw 'ArchiveMedia v6.0.22 progress-poll patch did not match embedded payload.'}; $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count -gt 0){$msg=($parseErrors | ForEach-Object { '{0}: {1}' -f $_.Extent.StartLineNumber,$_.Message }) -join '; '; throw ('ArchiveMedia payload syntax check failed: ' + $msg)}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo.
    echo ERROR: Archive Media Compressor payload validation failed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.22 no-growth precommit protection (integrity-checked before launch).
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $needle='            $sourceFull = [IO.Path]::GetFullPath($t.Source)'; $first=$s.IndexOf($needle,[StringComparison]::Ordinal); if($first -lt 0 -or $s.IndexOf($needle,$first+1,[StringComparison]::Ordinal) -ge 0){throw 'ArchiveMedia precommit patch marker must occur exactly once.'}; $insert=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('CiAgICAgICAgICAgICMgQXJjaGl2ZU1lZGlhIHY2LjAuMTQ6IHJlamVjdCBub24tc2F2aW5nIGNvbnZlcnNpb25zIEJFRk9SRSBjb21taXQuCiAgICAgICAgICAgIGlmICgkdC5BY3Rpb24gLWluIEAoIkNvbnZlcnRQaG90byIsICJSZW11eFZpZGVvIiwgIkVuY29kZVZpZGVvIikpIHsKICAgICAgICAgICAgICAgIFtJbnQ2NF0kY2FuZGlkYXRlQnl0ZXMgPSAoW0lPLkZpbGVJbmZvXTo6bmV3KCR0ZW1wKSkuTGVuZ3RoCiAgICAgICAgICAgICAgICBpZiAoJGNhbmRpZGF0ZUJ5dGVzIC1nZSBbSW50NjRdJHQuU291cmNlQnl0ZXMpIHsKICAgICAgICAgICAgICAgICAgICBSZW1vdmUtSXRlbSAtTGl0ZXJhbFBhdGggJHRlbXAgLUZvcmNlIC1FcnJvckFjdGlvbiBTdG9wCgogICAgICAgICAgICAgICAgICAgIGlmICgkdXNpbmc6T3BlcmF0aW9uTW9kZSAtZXEgIlJlcGxhY2UiKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICRyZXN1bHQgPSBbcHNjdXN0b21vYmplY3RdQHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFN1Y2Nlc3MgPSAkdHJ1ZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgU291cmNlID0gJHQuU291cmNlCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbiA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgQWN0aW9uID0gIlNraXAiCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBCZWZvcmVCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICAgICAgQWZ0ZXJCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICAgICAgRXJyb3IgPSAiIgogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICRyZXN1bHRCYWcuQWRkKCRyZXN1bHQpCiAgICAgICAgICAgICAgICAgICAgICAgIFdyaXRlLUhvc3QgKCJbS0VQVCBPUklHSU5BTF0gezB9IC0gY2FuZGlkYXRlIHsxfSB3YXMgbm90IHNtYWxsZXIgdGhhbiB7Mn0iIC1mICR0LlNvdXJjZSwgKEZvcm1hdC1CeXRlc0xvY2FsICRjYW5kaWRhdGVCeXRlcyksIChGb3JtYXQtQnl0ZXNMb2NhbCAoW0ludDY0XSR0LlNvdXJjZUJ5dGVzKSkpIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAkcmVzdWx0CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICAkcmVsYXRpdmVPcmlnaW5hbCA9IFtJTy5QYXRoXTo6R2V0UmVsYXRpdmVQYXRoKCR1c2luZzpJbnB1dFJvb3QsICR0LlNvdXJjZSkKICAgICAgICAgICAgICAgICAgICBpZiAoW0lPLlBhdGhdOjpJc1BhdGhSb290ZWQoJHJlbGF0aXZlT3JpZ2luYWwpIC1vciAkcmVsYXRpdmVPcmlnaW5hbCAtZXEgIi4uIiAtb3IgJHJlbGF0aXZlT3JpZ2luYWwuU3RhcnRzV2l0aCgiLi4iICsgW0lPLlBhdGhdOjpEaXJlY3RvcnlTZXBhcmF0b3JDaGFyKSkgewogICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyAiVW5zYWZlIGZhbGxiYWNrIHBhdGg6ICRyZWxhdGl2ZU9yaWdpbmFsIgogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAkZmFsbGJhY2sgPSBbSU8uUGF0aF06OkdldEZ1bGxQYXRoKChKb2luLVBhdGggJHVzaW5nOk91dHB1dFJvb3QgJHJlbGF0aXZlT3JpZ2luYWwpKQogICAgICAgICAgICAgICAgICAgIGlmIChbc3RyaW5nXTo6RXF1YWxzKCRmYWxsYmFjaywgW0lPLlBhdGhdOjpHZXRGdWxsUGF0aCgkdC5Tb3VyY2UpLCBbU3RyaW5nQ29tcGFyaXNvbl06Ok9yZGluYWxJZ25vcmVDYXNlKSkgewogICAgICAgICAgICAgICAgICAgICAgICAkcmVzdWx0ID0gW3BzY3VzdG9tb2JqZWN0XUB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdWNjZXNzID0gJHRydWUKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFNvdXJjZSA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgRGVzdGluYXRpb24gPSAkdC5Tb3VyY2UKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFjdGlvbiA9ICJTa2lwIgogICAgICAgICAgICAgICAgICAgICAgICAgICAgQmVmb3JlQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFmdGVyQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVycm9yID0gIiIKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAkcmVzdWx0QmFnLkFkZCgkcmVzdWx0KQogICAgICAgICAgICAgICAgICAgICAgICBXcml0ZS1Ib3N0ICgiW0tFUFQgT1JJR0lOQUxdIHswfSAtIG5vIHNtYWxsZXIgb3V0cHV0IiAtZiAkdC5Tb3VyY2UpIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAkcmVzdWx0CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICAjIEZpbGVNb2RlLkNyZWF0ZU5ldyBpcyBhdG9taWMgYW5kIG11c3Qgbm90IHJlcGxhY2UgZXhpc3RpbmcgYXJjaGl2ZSBmaWxlcy4KICAgICAgICAgICAgICAgICAgICAkZmFsbGJhY2tEaXIgPSBbSU8uUGF0aF06OkdldERpcmVjdG9yeU5hbWUoJGZhbGxiYWNrKQogICAgICAgICAgICAgICAgICAgIFtJTy5EaXJlY3RvcnldOjpDcmVhdGVEaXJlY3RvcnkoJGZhbGxiYWNrRGlyKSB8IE91dC1OdWxsCiAgICAgICAgICAgICAgICAgICAgJHJlYWRTdHJlYW0gPSAkbnVsbAogICAgICAgICAgICAgICAgICAgICR3cml0ZVN0cmVhbSA9ICRudWxsCiAgICAgICAgICAgICAgICAgICAgJGNyZWF0ZWRGYWxsYmFjayA9ICRmYWxzZQogICAgICAgICAgICAgICAgICAgICRjb3B5U3VjY2VlZGVkID0gJGZhbHNlCiAgICAgICAgICAgICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgICAgICAgICAgICAgJHdyaXRlU3RyZWFtID0gW0lPLkZpbGVdOjpPcGVuKCRmYWxsYmFjaywgW0lPLkZpbGVNb2RlXTo6Q3JlYXRlTmV3LCBbSU8uRmlsZUFjY2Vzc106OldyaXRlLCBbSU8uRmlsZVNoYXJlXTo6Tm9uZSkKICAgICAgICAgICAgICAgICAgICAgICAgJGNyZWF0ZWRGYWxsYmFjayA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgICRyZWFkU3RyZWFtID0gW0lPLkZpbGVdOjpPcGVuKCR0LlNvdXJjZSwgW0lPLkZpbGVNb2RlXTo6T3BlbiwgW0lPLkZpbGVBY2Nlc3NdOjpSZWFkLCBbSU8uRmlsZVNoYXJlXTo6UmVhZCkKICAgICAgICAgICAgICAgICAgICAgICAgJHJlYWRTdHJlYW0uQ29weVRvKCR3cml0ZVN0cmVhbSkKICAgICAgICAgICAgICAgICAgICAgICAgJHdyaXRlU3RyZWFtLkZsdXNoKCkKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCR3cml0ZVN0cmVhbS5MZW5ndGggLW5lIFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcyAtb3IgJHJlYWRTdHJlYW0uTGVuZ3RoIC1uZSBbSW50NjRdJHQuU291cmNlQnl0ZXMpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93ICJTb3VyY2Ugc2l6ZSBjaGFuZ2VkIGR1cmluZyBvcmlnaW5hbC1jb3B5IGZhbGxiYWNrLiIKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAkY29weVN1Y2NlZWRlZCA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIGZpbmFsbHkgewogICAgICAgICAgICAgICAgICAgICAgICBpZiAoJG51bGwgLW5lICRyZWFkU3RyZWFtKSB7ICRyZWFkU3RyZWFtLkRpc3Bvc2UoKSB9CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgkbnVsbCAtbmUgJHdyaXRlU3RyZWFtKSB7ICR3cml0ZVN0cmVhbS5EaXNwb3NlKCkgfQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoLW5vdCAkY29weVN1Y2NlZWRlZCAtYW5kICRjcmVhdGVkRmFsbGJhY2spIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJlbW92ZS1JdGVtIC1MaXRlcmFsUGF0aCAkZmFsbGJhY2sgLUZvcmNlIC1FcnJvckFjdGlvbiBTaWxlbnRseUNvbnRpbnVlCiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgU2V0LU91dHB1dFRpbWVzICRmYWxsYmFjayAkdC5DcmVhdGlvblRpbWUgJHQuTGFzdFdyaXRlVGltZQogICAgICAgICAgICAgICAgICAgICRyZXN1bHQgPSBbcHNjdXN0b21vYmplY3RdQHsKICAgICAgICAgICAgICAgICAgICAgICAgU3VjY2VzcyA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgIFNvdXJjZSA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbiA9ICRmYWxsYmFjawogICAgICAgICAgICAgICAgICAgICAgICBBY3Rpb24gPSAiQ29weSIKICAgICAgICAgICAgICAgICAgICAgICAgQmVmb3JlQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgQWZ0ZXJCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICBFcnJvciA9ICIiCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICRyZXN1bHRCYWcuQWRkKCRyZXN1bHQpCiAgICAgICAgICAgICAgICAgICAgV3JpdGUtSG9zdCAoIltLRVBUIE9SSUdJTkFMIEZPUk1BVF0gezB9IC0gY2FuZGlkYXRlIHdhcyBub3Qgc21hbGxlcjsgdW5jaGFuZ2VkIGZpbGUgc2F2ZWQgdG8gezF9IiAtZiAkdC5Tb3VyY2UsICRmYWxsYmFjaykgLUZvcmVncm91bmRDb2xvciBZZWxsb3cKICAgICAgICAgICAgICAgICAgICByZXR1cm4gJHJlc3VsdAogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9Cgo=')); $s=$s.Replace($needle,$insert+$needle); $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count -gt 0){throw ('ArchiveMedia safety patch syntax error: '+(($parseErrors | ForEach-Object Message) -join '; '))}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo ERROR: ArchiveMedia safety patch failed. Nothing was processed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.22: SKIP lines contain only status and path.
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
AAAAAwADALQAAAAZTgAAAAA=
