@echo off
setlocal EnableExtensions DisableDelayedExpansion
title ArchiveMedia v6.0.20 - Under construction

set "WINGET="
where winget.exe >nul 2>&1
if not errorlevel 1 set "WINGET=winget.exe"
if not defined WINGET if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" set "WINGET=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"

if not defined WINGET (
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

if not defined WINGET (
    echo.
    echo ERROR: WinGet is still unavailable after installation.
    pause
    exit /b 1
)

"%WINGET%" source update >nul 2>&1

for %%K in (Microsoft.PowerShell Gyan.FFmpeg ImageMagick.ImageMagick) do (
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

rem ArchiveMedia v6.0.20 analysis-performance and payload-integrity patch.
rem No CALL/GOTO labels are used so GitHub Raw LF line endings cannot break execution.
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $workerPattern='if \(\$storageType -in @\([^)]+\)\) \{\s*\$AnalysisParallel = \[Math\]::Min\(8, \[Math\]::Max\(4, \$logicalCpu\)\)\s*\}\s*else \{\s*\$AnalysisParallel = \[Math\]::Min\(24, \[Math\]::Max\(8, \$logicalCpu \* 2\)\)\s*\}'; $workerReplacement='if ($storageType -in @(''HDD'', ''Unknown'', ''Unspecified'')) { $AnalysisParallel = [Math]::Min(8, [Math]::Max(4, $logicalCpu)) } elseif ($storageType -eq ''SSD'') { $AnalysisParallel = [Math]::Min(48, [Math]::Max(24, $logicalCpu * 3)) } else { $AnalysisParallel = [Math]::Min(24, [Math]::Max(8, $logicalCpu * 2)) }'; $s2=[regex]::Replace($s,$workerPattern,$workerReplacement,1); if($s2 -eq $s){throw 'ArchiveMedia v6.0.20 worker patch did not match embedded payload.'}; $s=$s2; $before=$s; $s=$s.Replace('$children = @($analysisJob.ChildJobs)','$children = $analysisJob.ChildJobs'); if($s -eq $before){throw 'ArchiveMedia v6.0.20 child-job patch did not match embedded payload.'}; $donePattern='\$done = @\(\$children \| Where-Object State -in @\([^)]+\)\)\.Count'; $doneReplacement='$done = 0; foreach ($child in $children) { if ($child.State -in @(''Completed'', ''Failed'', ''Stopped'')) { $done++ } }'; $s2=[regex]::Replace($s,$donePattern,$doneReplacement,1); if($s2 -eq $s){throw 'ArchiveMedia v6.0.20 progress-count patch did not match embedded payload.'}; $s=$s2; $before=$s; $s=$s.Replace('Start-Sleep -Milliseconds 150','Start-Sleep -Milliseconds 1000'); if($s -eq $before){throw 'ArchiveMedia v6.0.20 progress-poll patch did not match embedded payload.'}; $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count -gt 0){$msg=($parseErrors | ForEach-Object { '{0}: {1}' -f $_.Extent.StartLineNumber,$_.Message }) -join '; '; throw ('ArchiveMedia payload syntax check failed: ' + $msg)}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo.
    echo ERROR: Archive Media Compressor payload validation failed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.20 no-growth precommit protection (integrity-checked before launch).
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $needle='            $sourceFull = [IO.Path]::GetFullPath($t.Source)'; $first=$s.IndexOf($needle,[StringComparison]::Ordinal); if($first -lt 0 -or $s.IndexOf($needle,$first+1,[StringComparison]::Ordinal) -ge 0){throw 'ArchiveMedia precommit patch marker must occur exactly once.'}; $insert=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('CiAgICAgICAgICAgICMgQXJjaGl2ZU1lZGlhIHY2LjAuMTQ6IHJlamVjdCBub24tc2F2aW5nIGNvbnZlcnNpb25zIEJFRk9SRSBjb21taXQuCiAgICAgICAgICAgIGlmICgkdC5BY3Rpb24gLWluIEAoIkNvbnZlcnRQaG90byIsICJSZW11eFZpZGVvIiwgIkVuY29kZVZpZGVvIikpIHsKICAgICAgICAgICAgICAgIFtJbnQ2NF0kY2FuZGlkYXRlQnl0ZXMgPSAoW0lPLkZpbGVJbmZvXTo6bmV3KCR0ZW1wKSkuTGVuZ3RoCiAgICAgICAgICAgICAgICBpZiAoJGNhbmRpZGF0ZUJ5dGVzIC1nZSBbSW50NjRdJHQuU291cmNlQnl0ZXMpIHsKICAgICAgICAgICAgICAgICAgICBSZW1vdmUtSXRlbSAtTGl0ZXJhbFBhdGggJHRlbXAgLUZvcmNlIC1FcnJvckFjdGlvbiBTdG9wCgogICAgICAgICAgICAgICAgICAgIGlmICgkdXNpbmc6T3BlcmF0aW9uTW9kZSAtZXEgIlJlcGxhY2UiKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICRyZXN1bHQgPSBbcHNjdXN0b21vYmplY3RdQHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFN1Y2Nlc3MgPSAkdHJ1ZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgU291cmNlID0gJHQuU291cmNlCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbiA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgQWN0aW9uID0gIlNraXAiCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBCZWZvcmVCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICAgICAgQWZ0ZXJCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICAgICAgRXJyb3IgPSAiIgogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICRyZXN1bHRCYWcuQWRkKCRyZXN1bHQpCiAgICAgICAgICAgICAgICAgICAgICAgIFdyaXRlLUhvc3QgKCJbS0VQVCBPUklHSU5BTF0gezB9IC0gY2FuZGlkYXRlIHsxfSB3YXMgbm90IHNtYWxsZXIgdGhhbiB7Mn0iIC1mICR0LlNvdXJjZSwgKEZvcm1hdC1CeXRlc0xvY2FsICRjYW5kaWRhdGVCeXRlcyksIChGb3JtYXQtQnl0ZXNMb2NhbCAoW0ludDY0XSR0LlNvdXJjZUJ5dGVzKSkpIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAkcmVzdWx0CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICAkcmVsYXRpdmVPcmlnaW5hbCA9IFtJTy5QYXRoXTo6R2V0UmVsYXRpdmVQYXRoKCR1c2luZzpJbnB1dFJvb3QsICR0LlNvdXJjZSkKICAgICAgICAgICAgICAgICAgICBpZiAoW0lPLlBhdGhdOjpJc1BhdGhSb290ZWQoJHJlbGF0aXZlT3JpZ2luYWwpIC1vciAkcmVsYXRpdmVPcmlnaW5hbCAtZXEgIi4uIiAtb3IgJHJlbGF0aXZlT3JpZ2luYWwuU3RhcnRzV2l0aCgiLi4iICsgW0lPLlBhdGhdOjpEaXJlY3RvcnlTZXBhcmF0b3JDaGFyKSkgewogICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyAiVW5zYWZlIGZhbGxiYWNrIHBhdGg6ICRyZWxhdGl2ZU9yaWdpbmFsIgogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAkZmFsbGJhY2sgPSBbSU8uUGF0aF06OkdldEZ1bGxQYXRoKChKb2luLVBhdGggJHVzaW5nOk91dHB1dFJvb3QgJHJlbGF0aXZlT3JpZ2luYWwpKQogICAgICAgICAgICAgICAgICAgIGlmIChbc3RyaW5nXTo6RXF1YWxzKCRmYWxsYmFjaywgW0lPLlBhdGhdOjpHZXRGdWxsUGF0aCgkdC5Tb3VyY2UpLCBbU3RyaW5nQ29tcGFyaXNvbl06Ok9yZGluYWxJZ25vcmVDYXNlKSkgewogICAgICAgICAgICAgICAgICAgICAgICAkcmVzdWx0ID0gW3BzY3VzdG9tb2JqZWN0XUB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdWNjZXNzID0gJHRydWUKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFNvdXJjZSA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgRGVzdGluYXRpb24gPSAkdC5Tb3VyY2UKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFjdGlvbiA9ICJTa2lwIgogICAgICAgICAgICAgICAgICAgICAgICAgICAgQmVmb3JlQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFmdGVyQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVycm9yID0gIiIKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAkcmVzdWx0QmFnLkFkZCgkcmVzdWx0KQogICAgICAgICAgICAgICAgICAgICAgICBXcml0ZS1Ib3N0ICgiW0tFUFQgT1JJR0lOQUxdIHswfSAtIG5vIHNtYWxsZXIgb3V0cHV0IiAtZiAkdC5Tb3VyY2UpIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAkcmVzdWx0CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICAjIEZpbGVNb2RlLkNyZWF0ZU5ldyBpcyBhdG9taWMgYW5kIG11c3Qgbm90IHJlcGxhY2UgZXhpc3RpbmcgYXJjaGl2ZSBmaWxlcy4KICAgICAgICAgICAgICAgICAgICAkZmFsbGJhY2tEaXIgPSBbSU8uUGF0aF06OkdldERpcmVjdG9yeU5hbWUoJGZhbGxiYWNrKQogICAgICAgICAgICAgICAgICAgIFtJTy5EaXJlY3RvcnldOjpDcmVhdGVEaXJlY3RvcnkoJGZhbGxiYWNrRGlyKSB8IE91dC1OdWxsCiAgICAgICAgICAgICAgICAgICAgJHJlYWRTdHJlYW0gPSAkbnVsbAogICAgICAgICAgICAgICAgICAgICR3cml0ZVN0cmVhbSA9ICRudWxsCiAgICAgICAgICAgICAgICAgICAgJGNyZWF0ZWRGYWxsYmFjayA9ICRmYWxzZQogICAgICAgICAgICAgICAgICAgICRjb3B5U3VjY2VlZGVkID0gJGZhbHNlCiAgICAgICAgICAgICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgICAgICAgICAgICAgJHdyaXRlU3RyZWFtID0gW0lPLkZpbGVdOjpPcGVuKCRmYWxsYmFjaywgW0lPLkZpbGVNb2RlXTo6Q3JlYXRlTmV3LCBbSU8uRmlsZUFjY2Vzc106OldyaXRlLCBbSU8uRmlsZVNoYXJlXTo6Tm9uZSkKICAgICAgICAgICAgICAgICAgICAgICAgJGNyZWF0ZWRGYWxsYmFjayA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgICRyZWFkU3RyZWFtID0gW0lPLkZpbGVdOjpPcGVuKCR0LlNvdXJjZSwgW0lPLkZpbGVNb2RlXTo6T3BlbiwgW0lPLkZpbGVBY2Nlc3NdOjpSZWFkLCBbSU8uRmlsZVNoYXJlXTo6UmVhZCkKICAgICAgICAgICAgICAgICAgICAgICAgJHJlYWRTdHJlYW0uQ29weVRvKCR3cml0ZVN0cmVhbSkKICAgICAgICAgICAgICAgICAgICAgICAgJHdyaXRlU3RyZWFtLkZsdXNoKCkKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCR3cml0ZVN0cmVhbS5MZW5ndGggLW5lIFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcyAtb3IgJHJlYWRTdHJlYW0uTGVuZ3RoIC1uZSBbSW50NjRdJHQuU291cmNlQnl0ZXMpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93ICJTb3VyY2Ugc2l6ZSBjaGFuZ2VkIGR1cmluZyBvcmlnaW5hbC1jb3B5IGZhbGxiYWNrLiIKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAkY29weVN1Y2NlZWRlZCA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIGZpbmFsbHkgewogICAgICAgICAgICAgICAgICAgICAgICBpZiAoJG51bGwgLW5lICRyZWFkU3RyZWFtKSB7ICRyZWFkU3RyZWFtLkRpc3Bvc2UoKSB9CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgkbnVsbCAtbmUgJHdyaXRlU3RyZWFtKSB7ICR3cml0ZVN0cmVhbS5EaXNwb3NlKCkgfQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoLW5vdCAkY29weVN1Y2NlZWRlZCAtYW5kICRjcmVhdGVkRmFsbGJhY2spIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJlbW92ZS1JdGVtIC1MaXRlcmFsUGF0aCAkZmFsbGJhY2sgLUZvcmNlIC1FcnJvckFjdGlvbiBTaWxlbnRseUNvbnRpbnVlCiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgU2V0LU91dHB1dFRpbWVzICRmYWxsYmFjayAkdC5DcmVhdGlvblRpbWUgJHQuTGFzdFdyaXRlVGltZQogICAgICAgICAgICAgICAgICAgICRyZXN1bHQgPSBbcHNjdXN0b21vYmplY3RdQHsKICAgICAgICAgICAgICAgICAgICAgICAgU3VjY2VzcyA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgIFNvdXJjZSA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbiA9ICRmYWxsYmFjawogICAgICAgICAgICAgICAgICAgICAgICBBY3Rpb24gPSAiQ29weSIKICAgICAgICAgICAgICAgICAgICAgICAgQmVmb3JlQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgQWZ0ZXJCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICBFcnJvciA9ICIiCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICRyZXN1bHRCYWcuQWRkKCRyZXN1bHQpCiAgICAgICAgICAgICAgICAgICAgV3JpdGUtSG9zdCAoIltLRVBUIE9SSUdJTkFMIEZPUk1BVF0gezB9IC0gY2FuZGlkYXRlIHdhcyBub3Qgc21hbGxlcjsgdW5jaGFuZ2VkIGZpbGUgc2F2ZWQgdG8gezF9IiAtZiAkdC5Tb3VyY2UsICRmYWxsYmFjaykgLUZvcmVncm91bmRDb2xvciBZZWxsb3cKICAgICAgICAgICAgICAgICAgICByZXR1cm4gJHJlc3VsdAogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9Cgo=')); $s=$s.Replace($needle,$insert+$needle); $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count -gt 0){throw ('ArchiveMedia safety patch syntax error: '+(($parseErrors | ForEach-Object Message) -join '; '))}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo ERROR: ArchiveMedia safety patch failed. Nothing was processed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.20: SKIP lines contain only status and path.
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
AAAQTgAAAAA=
