@echo off
setlocal EnableExtensions DisableDelayedExpansion
title ArchiveMedia v6.0.19 - Under construction

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

rem ArchiveMedia v6.0.19 analysis-performance and payload-integrity patch.
rem No CALL/GOTO labels are used so GitHub Raw LF line endings cannot break execution.
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $workerPattern='if \(\$storageType -in @\([^)]+\)\) \{\s*\$AnalysisParallel = \[Math\]::Min\(8, \[Math\]::Max\(4, \$logicalCpu\)\)\s*\}\s*else \{\s*\$AnalysisParallel = \[Math\]::Min\(24, \[Math\]::Max\(8, \$logicalCpu \* 2\)\)\s*\}'; $workerReplacement='if ($storageType -in @(''HDD'', ''Unknown'', ''Unspecified'')) { $AnalysisParallel = [Math]::Min(8, [Math]::Max(4, $logicalCpu)) } elseif ($storageType -eq ''SSD'') { $AnalysisParallel = [Math]::Min(48, [Math]::Max(24, $logicalCpu * 3)) } else { $AnalysisParallel = [Math]::Min(24, [Math]::Max(8, $logicalCpu * 2)) }'; $s2=[regex]::Replace($s,$workerPattern,$workerReplacement,1); if($s2 -eq $s){throw 'ArchiveMedia v6.0.19 worker patch did not match embedded payload.'}; $s=$s2; $before=$s; $s=$s.Replace('$children = @($analysisJob.ChildJobs)','$children = $analysisJob.ChildJobs'); if($s -eq $before){throw 'ArchiveMedia v6.0.19 child-job patch did not match embedded payload.'}; $donePattern='\$done = @\(\$children \| Where-Object State -in @\([^)]+\)\)\.Count'; $doneReplacement='$done = 0; foreach ($child in $children) { if ($child.State -in @(''Completed'', ''Failed'', ''Stopped'')) { $done++ } }'; $s2=[regex]::Replace($s,$donePattern,$doneReplacement,1); if($s2 -eq $s){throw 'ArchiveMedia v6.0.19 progress-count patch did not match embedded payload.'}; $s=$s2; $before=$s; $s=$s.Replace('Start-Sleep -Milliseconds 150','Start-Sleep -Milliseconds 1000'); if($s -eq $before){throw 'ArchiveMedia v6.0.19 progress-poll patch did not match embedded payload.'}; $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count -gt 0){$msg=($parseErrors | ForEach-Object { '{0}: {1}' -f $_.Extent.StartLineNumber,$_.Message }) -join '; '; throw ('ArchiveMedia payload syntax check failed: ' + $msg)}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo.
    echo ERROR: Archive Media Compressor payload validation failed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.19 no-growth precommit protection (integrity-checked before launch).
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $needle='            $sourceFull = [IO.Path]::GetFullPath($t.Source)'; $first=$s.IndexOf($needle,[StringComparison]::Ordinal); if($first -lt 0 -or $s.IndexOf($needle,$first+1,[StringComparison]::Ordinal) -ge 0){throw 'ArchiveMedia precommit patch marker must occur exactly once.'}; $insert=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('CiAgICAgICAgICAgICMgQXJjaGl2ZU1lZGlhIHY2LjAuMTQ6IHJlamVjdCBub24tc2F2aW5nIGNvbnZlcnNpb25zIEJFRk9SRSBjb21taXQuCiAgICAgICAgICAgIGlmICgkdC5BY3Rpb24gLWluIEAoIkNvbnZlcnRQaG90byIsICJSZW11eFZpZGVvIiwgIkVuY29kZVZpZGVvIikpIHsKICAgICAgICAgICAgICAgIFtJbnQ2NF0kY2FuZGlkYXRlQnl0ZXMgPSAoW0lPLkZpbGVJbmZvXTo6bmV3KCR0ZW1wKSkuTGVuZ3RoCiAgICAgICAgICAgICAgICBpZiAoJGNhbmRpZGF0ZUJ5dGVzIC1nZSBbSW50NjRdJHQuU291cmNlQnl0ZXMpIHsKICAgICAgICAgICAgICAgICAgICBSZW1vdmUtSXRlbSAtTGl0ZXJhbFBhdGggJHRlbXAgLUZvcmNlIC1FcnJvckFjdGlvbiBTdG9wCgogICAgICAgICAgICAgICAgICAgIGlmICgkdXNpbmc6T3BlcmF0aW9uTW9kZSAtZXEgIlJlcGxhY2UiKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICRyZXN1bHQgPSBbcHNjdXN0b21vYmplY3RdQHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFN1Y2Nlc3MgPSAkdHJ1ZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgU291cmNlID0gJHQuU291cmNlCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbiA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgQWN0aW9uID0gIlNraXAiCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBCZWZvcmVCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICAgICAgQWZ0ZXJCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICAgICAgRXJyb3IgPSAiIgogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICRyZXN1bHRCYWcuQWRkKCRyZXN1bHQpCiAgICAgICAgICAgICAgICAgICAgICAgIFdyaXRlLUhvc3QgKCJbS0VQVCBPUklHSU5BTF0gezB9IC0gY2FuZGlkYXRlIHsxfSB3YXMgbm90IHNtYWxsZXIgdGhhbiB7Mn0iIC1mICR0LlNvdXJjZSwgKEZvcm1hdC1CeXRlc0xvY2FsICRjYW5kaWRhdGVCeXRlcyksIChGb3JtYXQtQnl0ZXNMb2NhbCAoW0ludDY0XSR0LlNvdXJjZUJ5dGVzKSkpIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAkcmVzdWx0CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICAkcmVsYXRpdmVPcmlnaW5hbCA9IFtJTy5QYXRoXTo6R2V0UmVsYXRpdmVQYXRoKCR1c2luZzpJbnB1dFJvb3QsICR0LlNvdXJjZSkKICAgICAgICAgICAgICAgICAgICBpZiAoW0lPLlBhdGhdOjpJc1BhdGhSb290ZWQoJHJlbGF0aXZlT3JpZ2luYWwpIC1vciAkcmVsYXRpdmVPcmlnaW5hbCAtZXEgIi4uIiAtb3IgJHJlbGF0aXZlT3JpZ2luYWwuU3RhcnRzV2l0aCgiLi4iICsgW0lPLlBhdGhdOjpEaXJlY3RvcnlTZXBhcmF0b3JDaGFyKSkgewogICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyAiVW5zYWZlIGZhbGxiYWNrIHBhdGg6ICRyZWxhdGl2ZU9yaWdpbmFsIgogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAkZmFsbGJhY2sgPSBbSU8uUGF0aF06OkdldEZ1bGxQYXRoKChKb2luLVBhdGggJHVzaW5nOk91dHB1dFJvb3QgJHJlbGF0aXZlT3JpZ2luYWwpKQogICAgICAgICAgICAgICAgICAgIGlmIChbc3RyaW5nXTo6RXF1YWxzKCRmYWxsYmFjaywgW0lPLlBhdGhdOjpHZXRGdWxsUGF0aCgkdC5Tb3VyY2UpLCBbU3RyaW5nQ29tcGFyaXNvbl06Ok9yZGluYWxJZ25vcmVDYXNlKSkgewogICAgICAgICAgICAgICAgICAgICAgICAkcmVzdWx0ID0gW3BzY3VzdG9tb2JqZWN0XUB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdWNjZXNzID0gJHRydWUKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFNvdXJjZSA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgRGVzdGluYXRpb24gPSAkdC5Tb3VyY2UKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFjdGlvbiA9ICJTa2lwIgogICAgICAgICAgICAgICAgICAgICAgICAgICAgQmVmb3JlQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFmdGVyQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVycm9yID0gIiIKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAkcmVzdWx0QmFnLkFkZCgkcmVzdWx0KQogICAgICAgICAgICAgICAgICAgICAgICBXcml0ZS1Ib3N0ICgiW0tFUFQgT1JJR0lOQUxdIHswfSAtIG5vIHNtYWxsZXIgb3V0cHV0IiAtZiAkdC5Tb3VyY2UpIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAkcmVzdWx0CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICAjIEZpbGVNb2RlLkNyZWF0ZU5ldyBpcyBhdG9taWMgYW5kIG11c3Qgbm90IHJlcGxhY2UgZXhpc3RpbmcgYXJjaGl2ZSBmaWxlcy4KICAgICAgICAgICAgICAgICAgICAkZmFsbGJhY2tEaXIgPSBbSU8uUGF0aF06OkdldERpcmVjdG9yeU5hbWUoJGZhbGxiYWNrKQogICAgICAgICAgICAgICAgICAgIFtJTy5EaXJlY3RvcnldOjpDcmVhdGVEaXJlY3RvcnkoJGZhbGxiYWNrRGlyKSB8IE91dC1OdWxsCiAgICAgICAgICAgICAgICAgICAgJHJlYWRTdHJlYW0gPSAkbnVsbAogICAgICAgICAgICAgICAgICAgICR3cml0ZVN0cmVhbSA9ICRudWxsCiAgICAgICAgICAgICAgICAgICAgJGNyZWF0ZWRGYWxsYmFjayA9ICRmYWxzZQogICAgICAgICAgICAgICAgICAgICRjb3B5U3VjY2VlZGVkID0gJGZhbHNlCiAgICAgICAgICAgICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgICAgICAgICAgICAgJHdyaXRlU3RyZWFtID0gW0lPLkZpbGVdOjpPcGVuKCRmYWxsYmFjaywgW0lPLkZpbGVNb2RlXTo6Q3JlYXRlTmV3LCBbSU8uRmlsZUFjY2Vzc106OldyaXRlLCBbSU8uRmlsZVNoYXJlXTo6Tm9uZSkKICAgICAgICAgICAgICAgICAgICAgICAgJGNyZWF0ZWRGYWxsYmFjayA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgICRyZWFkU3RyZWFtID0gW0lPLkZpbGVdOjpPcGVuKCR0LlNvdXJjZSwgW0lPLkZpbGVNb2RlXTo6T3BlbiwgW0lPLkZpbGVBY2Nlc3NdOjpSZWFkLCBbSU8uRmlsZVNoYXJlXTo6UmVhZCkKICAgICAgICAgICAgICAgICAgICAgICAgJHJlYWRTdHJlYW0uQ29weVRvKCR3cml0ZVN0cmVhbSkKICAgICAgICAgICAgICAgICAgICAgICAgJHdyaXRlU3RyZWFtLkZsdXNoKCkKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCR3cml0ZVN0cmVhbS5MZW5ndGggLW5lIFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcyAtb3IgJHJlYWRTdHJlYW0uTGVuZ3RoIC1uZSBbSW50NjRdJHQuU291cmNlQnl0ZXMpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93ICJTb3VyY2Ugc2l6ZSBjaGFuZ2VkIGR1cmluZyBvcmlnaW5hbC1jb3B5IGZhbGxiYWNrLiIKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAkY29weVN1Y2NlZWRlZCA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIGZpbmFsbHkgewogICAgICAgICAgICAgICAgICAgICAgICBpZiAoJG51bGwgLW5lICRyZWFkU3RyZWFtKSB7ICRyZWFkU3RyZWFtLkRpc3Bvc2UoKSB9CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgkbnVsbCAtbmUgJHdyaXRlU3RyZWFtKSB7ICR3cml0ZVN0cmVhbS5EaXNwb3NlKCkgfQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoLW5vdCAkY29weVN1Y2NlZWRlZCAtYW5kICRjcmVhdGVkRmFsbGJhY2spIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJlbW92ZS1JdGVtIC1MaXRlcmFsUGF0aCAkZmFsbGJhY2sgLUZvcmNlIC1FcnJvckFjdGlvbiBTaWxlbnRseUNvbnRpbnVlCiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgU2V0LU91dHB1dFRpbWVzICRmYWxsYmFjayAkdC5DcmVhdGlvblRpbWUgJHQuTGFzdFdyaXRlVGltZQogICAgICAgICAgICAgICAgICAgICRyZXN1bHQgPSBbcHNjdXN0b21vYmplY3RdQHsKICAgICAgICAgICAgICAgICAgICAgICAgU3VjY2VzcyA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgIFNvdXJjZSA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbiA9ICRmYWxsYmFjawogICAgICAgICAgICAgICAgICAgICAgICBBY3Rpb24gPSAiQ29weSIKICAgICAgICAgICAgICAgICAgICAgICAgQmVmb3JlQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgQWZ0ZXJCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICBFcnJvciA9ICIiCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICRyZXN1bHRCYWcuQWRkKCRyZXN1bHQpCiAgICAgICAgICAgICAgICAgICAgV3JpdGUtSG9zdCAoIltLRVBUIE9SSUdJTkFMIEZPUk1BVF0gezB9IC0gY2FuZGlkYXRlIHdhcyBub3Qgc21hbGxlcjsgdW5jaGFuZ2VkIGZpbGUgc2F2ZWQgdG8gezF9IiAtZiAkdC5Tb3VyY2UsICRmYWxsYmFjaykgLUZvcmVncm91bmRDb2xvciBZZWxsb3cKICAgICAgICAgICAgICAgICAgICByZXR1cm4gJHJlc3VsdAogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9Cgo=')); $s=$s.Replace($needle,$insert+$needle); $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count -gt 0){throw ('ArchiveMedia safety patch syntax error: '+(($parseErrors | ForEach-Object Message) -join '; '))}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo ERROR: ArchiveMedia safety patch failed. Nothing was processed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.19: SKIP lines contain only status and path.
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $needle='            $label = Get-ActionLabel $Action'; $start=$s.IndexOf($needle,[StringComparison]::Ordinal); if($start -lt 0 -or $s.IndexOf($needle,$start+1,[StringComparison]::Ordinal) -ge 0){throw 'ArchiveMedia SKIP log patch marker must occur exactly once.'}; $append=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('ICAgICAgICAgICAgaWYgKCRBY3Rpb24gLWVxICdTa2lwJykgewogICAgICAgICAgICAgICAgV3JpdGUtSG9zdCAoJ1t7MH1dIHsxfScgLWYgJGxhYmVsLCAkUGF0aCkKICAgICAgICAgICAgICAgIHJldHVybgogICAgICAgICAgICB9Cg==')); $s=$s.Replace($needle,$needle+[char]10+$append); $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count){throw ('SKIP log patch failed syntax check: '+(($parseErrors | ForEach-Object Message) -join '; '))}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo ERROR: ArchiveMedia SKIP log patch failed. Nothing was processed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.19: minimal mode selector and remembered folders.
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $folderNeedle='        $dialog.ShowNewFolderButton = $true'; $modeStart='Write-Section '+[char]34+'Mode'+[char]34; $modeEnd='# ---- Hardware detection ----'; $extra=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('ICAgICAgICBpZiAoJHNjcmlwdDpSZWNlbnRGb2xkZXIgLWFuZCAoVGVzdC1QYXRoIC1MaXRlcmFsUGF0aCAkc2NyaXB0OlJlY2VudEZvbGRlciAtUGF0aFR5cGUgQ29udGFpbmVyKSkgewogICAgICAgICAgICAkZGlhbG9nLlNlbGVjdGVkUGF0aCA9IFtzdHJpbmddJHNjcmlwdDpSZWNlbnRGb2xkZXIKICAgICAgICB9Cg==')); $flow=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('IyAtLS0tIE1vZGUgYW5kIGZvbGRlcnM6IHNhZmUgZGVmYXVsdCwgcmVtZW1iZXJlZCBmb2xkZXIgbG9jYXRpb25zIC0tLS0KJHNldHRpbmdzRGlyID0gSm9pbi1QYXRoIChbRW52aXJvbm1lbnRdOjpHZXRGb2xkZXJQYXRoKCJNeURvY3VtZW50cyIpKSAiS2FycHV6aWtvdiBUb29sc1xBcmNoaXZlTWVkaWEiCiRzZXR0aW5nc1BhdGggPSBKb2luLVBhdGggJHNldHRpbmdzRGlyICJzZXR0aW5ncy5qc29uIgokcmVjZW50ID0gJG51bGwKaWYgKFRlc3QtUGF0aCAtTGl0ZXJhbFBhdGggJHNldHRpbmdzUGF0aCAtUGF0aFR5cGUgTGVhZikgewogICAgdHJ5IHsgJHJlY2VudCA9IEdldC1Db250ZW50IC1MaXRlcmFsUGF0aCAkc2V0dGluZ3NQYXRoIC1SYXcgLUVycm9yQWN0aW9uIFN0b3AgfCBDb252ZXJ0RnJvbS1Kc29uIC1FcnJvckFjdGlvbiBTdG9wIH0KICAgIGNhdGNoIHsgJHJlY2VudCA9ICRudWxsIH0KfQoKZG8gewogICAgJG1vZGVDaG9pY2UgPSAoUmVhZC1Ib3N0ICJNb2RlOiBDb3B5IFtFbnRlcl0gLyBSZXBsYWNlIFtSXSIpLlRyaW0oKS5Ub1VwcGVySW52YXJpYW50KCkKfSB3aGlsZSAoJG1vZGVDaG9pY2UgLW5vdGluIEAoIiIsICJSIikpCiRPcGVyYXRpb25Nb2RlID0gaWYgKCRtb2RlQ2hvaWNlIC1lcSAiUiIpIHsgIlJlcGxhY2UiIH0gZWxzZSB7ICJDb3B5IiB9Cgokc2NyaXB0OlJlY2VudEZvbGRlciA9IGlmICgkcmVjZW50IC1hbmQgJHJlY2VudC5Tb3VyY2UpIHsgW3N0cmluZ10kcmVjZW50LlNvdXJjZSB9IGVsc2UgeyAkbnVsbCB9CiRJbnB1dFJvb3QgPSBTZWxlY3QtRm9sZGVyICJTb3VyY2UgZm9sZGVyIgokc2NyaXB0OlJlY2VudEZvbGRlciA9ICRudWxsCmlmICgtbm90ICRJbnB1dFJvb3QpIHsgdGhyb3cgIk5vIHNvdXJjZSBmb2xkZXIgc2VsZWN0ZWQuIiB9CmlmICgtbm90IChUZXN0LVBhdGggLUxpdGVyYWxQYXRoICRJbnB1dFJvb3QgLVBhdGhUeXBlIENvbnRhaW5lcikpIHsKICAgIHRocm93ICJTb3VyY2UgZm9sZGVyIGRvZXMgbm90IGV4aXN0OiAkSW5wdXRSb290Igp9CgppZiAoJE9wZXJhdGlvbk1vZGUgLWVxICJDb3B5IikgewogICAgJHNjcmlwdDpSZWNlbnRGb2xkZXIgPSBpZiAoJHJlY2VudCAtYW5kICRyZWNlbnQuRGVzdGluYXRpb24gLWFuZCAoVGVzdC1QYXRoIC1MaXRlcmFsUGF0aCAoW3N0cmluZ10kcmVjZW50LkRlc3RpbmF0aW9uKSAtUGF0aFR5cGUgQ29udGFpbmVyKSkgewogICAgICAgIFtzdHJpbmddJHJlY2VudC5EZXN0aW5hdGlvbgogICAgfSBlbHNlIHsKICAgICAgICBbSU8uUGF0aF06OkdldERpcmVjdG9yeU5hbWUoW0lPLlBhdGhdOjpHZXRGdWxsUGF0aCgkSW5wdXRSb290KS5UcmltRW5kKCJcIikpCiAgICB9CiAgICAkT3V0cHV0Um9vdCA9IFNlbGVjdC1Gb2xkZXIgIkRlc3RpbmF0aW9uIGZvbGRlciIKICAgICRzY3JpcHQ6UmVjZW50Rm9sZGVyID0gJG51bGwKICAgIGlmICgtbm90ICRPdXRwdXRSb290KSB7IHRocm93ICJObyBkZXN0aW5hdGlvbiBmb2xkZXIgc2VsZWN0ZWQuIiB9CgogICAgaWYgKFtzdHJpbmddOjpFcXVhbHMoCiAgICAgICAgW0lPLlBhdGhdOjpHZXRGdWxsUGF0aCgkSW5wdXRSb290KS5UcmltRW5kKCJcIiksCiAgICAgICAgW0lPLlBhdGhdOjpHZXRGdWxsUGF0aCgkT3V0cHV0Um9vdCkuVHJpbUVuZCgiXCIpLAogICAgICAgIFtTdHJpbmdDb21wYXJpc29uXTo6T3JkaW5hbElnbm9yZUNhc2UKICAgICkpIHsKICAgICAgICB0aHJvdyAiU291cmNlIGFuZCBkZXN0aW5hdGlvbiBtdXN0IGRpZmZlci4gQ2hvb3NlIFJlcGxhY2UgdG8gcHJvY2VzcyBmaWxlcyBpbiBwbGFjZS4iCiAgICB9CiAgICBOZXctSXRlbSAtSXRlbVR5cGUgRGlyZWN0b3J5IC1QYXRoICRPdXRwdXRSb290IC1Gb3JjZSB8IE91dC1OdWxsCiAgICBXcml0ZS1Ib3N0ICJDb3B5OiAkSW5wdXRSb290IgogICAgV3JpdGUtSG9zdCAiICAgLT4gJE91dHB1dFJvb3QiCn0KZWxzZSB7CiAgICAkT3V0cHV0Um9vdCA9ICRJbnB1dFJvb3QKICAgIFdyaXRlLUhvc3QgIlJlcGxhY2U6ICRJbnB1dFJvb3QiIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93Cn0KCiMgUmVtZW1iZXIgb25seSBzdWNjZXNzZnVsIHNlbGVjdGlvbnM7IG5ldmVyIHJlbWVtYmVyIFJlcGxhY2UgYXMgdGhlIGRlZmF1bHQgbW9kZS4KdHJ5IHsKICAgIFtJTy5EaXJlY3RvcnldOjpDcmVhdGVEaXJlY3RvcnkoJHNldHRpbmdzRGlyKSB8IE91dC1OdWxsCiAgICAkcmVtZW1iZXJlZERlc3RpbmF0aW9uID0gaWYgKCRPcGVyYXRpb25Nb2RlIC1lcSAiQ29weSIpIHsgJE91dHB1dFJvb3QgfSBlbHNlaWYgKCRyZWNlbnQpIHsgW3N0cmluZ10kcmVjZW50LkRlc3RpbmF0aW9uIH0gZWxzZSB7ICIiIH0KICAgIFtwc2N1c3RvbW9iamVjdF1AewogICAgICAgIFNvdXJjZSA9ICRJbnB1dFJvb3QKICAgICAgICBEZXN0aW5hdGlvbiA9ICRyZW1lbWJlcmVkRGVzdGluYXRpb24KICAgIH0gfCBDb252ZXJ0VG8tSnNvbiAtQ29tcHJlc3MgfCBTZXQtQ29udGVudCAtTGl0ZXJhbFBhdGggJHNldHRpbmdzUGF0aCAtRW5jb2RpbmcgdXRmOCAtRXJyb3JBY3Rpb24gU3RvcAp9CmNhdGNoIHsKICAgICMgU2V0dGluZ3MgbXVzdCBuZXZlciBibG9jayBhcmNoaXZlIHByb2Nlc3NpbmcuCn0KCg==')); $m=$s.IndexOf($folderNeedle,[StringComparison]::Ordinal); if($m -lt 0 -or $s.IndexOf($folderNeedle,$m+1,[StringComparison]::Ordinal) -ge 0){throw 'Folder picker anchor mismatch'}; $s=$s.Replace($folderNeedle,$folderNeedle+[char]10+$extra); $a=$s.IndexOf($modeStart,[StringComparison]::Ordinal); $b=$s.IndexOf($modeEnd,[StringComparison]::Ordinal); if($a -lt 0 -or $b -le $a -or $s.IndexOf($modeStart,$a+1,[StringComparison]::Ordinal) -ge 0){throw 'Mode block marker mismatch'}; $s=$s.Substring(0,$a)+$flow+[char]10+$s.Substring($b); $tokens=$null; $errors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$errors); if($errors.Count){throw ('ArchiveMedia UI patch syntax error: '+(($errors|ForEach-Object Message)-join '; '))}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo ERROR: ArchiveMedia UI patch failed. Nothing was processed.
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
