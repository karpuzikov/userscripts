@echo off
setlocal EnableExtensions DisableDelayedExpansion
title ArchiveMedia v6.0.17 - Under construction

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

rem ArchiveMedia v6.0.17 analysis-performance and payload-integrity patch.
rem No CALL/GOTO labels are used so GitHub Raw LF line endings cannot break execution.
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $workerPattern='if \(\$storageType -in @\([^)]+\)\) \{\s*\$AnalysisParallel = \[Math\]::Min\(8, \[Math\]::Max\(4, \$logicalCpu\)\)\s*\}\s*else \{\s*\$AnalysisParallel = \[Math\]::Min\(24, \[Math\]::Max\(8, \$logicalCpu \* 2\)\)\s*\}'; $workerReplacement='if ($storageType -in @(''HDD'', ''Unknown'', ''Unspecified'')) { $AnalysisParallel = [Math]::Min(8, [Math]::Max(4, $logicalCpu)) } elseif ($storageType -eq ''SSD'') { $AnalysisParallel = [Math]::Min(48, [Math]::Max(24, $logicalCpu * 3)) } else { $AnalysisParallel = [Math]::Min(24, [Math]::Max(8, $logicalCpu * 2)) }'; $s2=[regex]::Replace($s,$workerPattern,$workerReplacement,1); if($s2 -eq $s){throw 'ArchiveMedia v6.0.17 worker patch did not match embedded payload.'}; $s=$s2; $before=$s; $s=$s.Replace('$children = @($analysisJob.ChildJobs)','$children = $analysisJob.ChildJobs'); if($s -eq $before){throw 'ArchiveMedia v6.0.17 child-job patch did not match embedded payload.'}; $donePattern='\$done = @\(\$children \| Where-Object State -in @\([^)]+\)\)\.Count'; $doneReplacement='$done = 0; foreach ($child in $children) { if ($child.State -in @(''Completed'', ''Failed'', ''Stopped'')) { $done++ } }'; $s2=[regex]::Replace($s,$donePattern,$doneReplacement,1); if($s2 -eq $s){throw 'ArchiveMedia v6.0.17 progress-count patch did not match embedded payload.'}; $s=$s2; $before=$s; $s=$s.Replace('Start-Sleep -Milliseconds 150','Start-Sleep -Milliseconds 1000'); if($s -eq $before){throw 'ArchiveMedia v6.0.17 progress-poll patch did not match embedded payload.'}; $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count -gt 0){$msg=($parseErrors | ForEach-Object { '{0}: {1}' -f $_.Extent.StartLineNumber,$_.Message }) -join '; '; throw ('ArchiveMedia payload syntax check failed: ' + $msg)}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo.
    echo ERROR: Archive Media Compressor payload validation failed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.17 no-growth precommit protection (integrity-checked before launch).
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $needle='            $sourceFull = [IO.Path]::GetFullPath($t.Source)'; $first=$s.IndexOf($needle,[StringComparison]::Ordinal); if($first -lt 0 -or $s.IndexOf($needle,$first+1,[StringComparison]::Ordinal) -ge 0){throw 'ArchiveMedia precommit patch marker must occur exactly once.'}; $insert=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('CiAgICAgICAgICAgICMgQXJjaGl2ZU1lZGlhIHY2LjAuMTQ6IHJlamVjdCBub24tc2F2aW5nIGNvbnZlcnNpb25zIEJFRk9SRSBjb21taXQuCiAgICAgICAgICAgIGlmICgkdC5BY3Rpb24gLWluIEAoIkNvbnZlcnRQaG90byIsICJSZW11eFZpZGVvIiwgIkVuY29kZVZpZGVvIikpIHsKICAgICAgICAgICAgICAgIFtJbnQ2NF0kY2FuZGlkYXRlQnl0ZXMgPSAoW0lPLkZpbGVJbmZvXTo6bmV3KCR0ZW1wKSkuTGVuZ3RoCiAgICAgICAgICAgICAgICBpZiAoJGNhbmRpZGF0ZUJ5dGVzIC1nZSBbSW50NjRdJHQuU291cmNlQnl0ZXMpIHsKICAgICAgICAgICAgICAgICAgICBSZW1vdmUtSXRlbSAtTGl0ZXJhbFBhdGggJHRlbXAgLUZvcmNlIC1FcnJvckFjdGlvbiBTdG9wCgogICAgICAgICAgICAgICAgICAgIGlmICgkdXNpbmc6T3BlcmF0aW9uTW9kZSAtZXEgIlJlcGxhY2UiKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICRyZXN1bHQgPSBbcHNjdXN0b21vYmplY3RdQHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFN1Y2Nlc3MgPSAkdHJ1ZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgU291cmNlID0gJHQuU291cmNlCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbiA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgQWN0aW9uID0gIlNraXAiCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBCZWZvcmVCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICAgICAgQWZ0ZXJCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICAgICAgRXJyb3IgPSAiIgogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICRyZXN1bHRCYWcuQWRkKCRyZXN1bHQpCiAgICAgICAgICAgICAgICAgICAgICAgIFdyaXRlLUhvc3QgKCJbS0VQVCBPUklHSU5BTF0gezB9IC0gY2FuZGlkYXRlIHsxfSB3YXMgbm90IHNtYWxsZXIgdGhhbiB7Mn0iIC1mICR0LlNvdXJjZSwgKEZvcm1hdC1CeXRlc0xvY2FsICRjYW5kaWRhdGVCeXRlcyksIChGb3JtYXQtQnl0ZXNMb2NhbCAoW0ludDY0XSR0LlNvdXJjZUJ5dGVzKSkpIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAkcmVzdWx0CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICAkcmVsYXRpdmVPcmlnaW5hbCA9IFtJTy5QYXRoXTo6R2V0UmVsYXRpdmVQYXRoKCR1c2luZzpJbnB1dFJvb3QsICR0LlNvdXJjZSkKICAgICAgICAgICAgICAgICAgICBpZiAoW0lPLlBhdGhdOjpJc1BhdGhSb290ZWQoJHJlbGF0aXZlT3JpZ2luYWwpIC1vciAkcmVsYXRpdmVPcmlnaW5hbCAtZXEgIi4uIiAtb3IgJHJlbGF0aXZlT3JpZ2luYWwuU3RhcnRzV2l0aCgiLi4iICsgW0lPLlBhdGhdOjpEaXJlY3RvcnlTZXBhcmF0b3JDaGFyKSkgewogICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyAiVW5zYWZlIGZhbGxiYWNrIHBhdGg6ICRyZWxhdGl2ZU9yaWdpbmFsIgogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAkZmFsbGJhY2sgPSBbSU8uUGF0aF06OkdldEZ1bGxQYXRoKChKb2luLVBhdGggJHVzaW5nOk91dHB1dFJvb3QgJHJlbGF0aXZlT3JpZ2luYWwpKQogICAgICAgICAgICAgICAgICAgIGlmIChbc3RyaW5nXTo6RXF1YWxzKCRmYWxsYmFjaywgW0lPLlBhdGhdOjpHZXRGdWxsUGF0aCgkdC5Tb3VyY2UpLCBbU3RyaW5nQ29tcGFyaXNvbl06Ok9yZGluYWxJZ25vcmVDYXNlKSkgewogICAgICAgICAgICAgICAgICAgICAgICAkcmVzdWx0ID0gW3BzY3VzdG9tb2JqZWN0XUB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdWNjZXNzID0gJHRydWUKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFNvdXJjZSA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgRGVzdGluYXRpb24gPSAkdC5Tb3VyY2UKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFjdGlvbiA9ICJTa2lwIgogICAgICAgICAgICAgICAgICAgICAgICAgICAgQmVmb3JlQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFmdGVyQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVycm9yID0gIiIKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAkcmVzdWx0QmFnLkFkZCgkcmVzdWx0KQogICAgICAgICAgICAgICAgICAgICAgICBXcml0ZS1Ib3N0ICgiW0tFUFQgT1JJR0lOQUxdIHswfSAtIG5vIHNtYWxsZXIgb3V0cHV0IiAtZiAkdC5Tb3VyY2UpIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAkcmVzdWx0CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICAjIEZpbGVNb2RlLkNyZWF0ZU5ldyBpcyBhdG9taWMgYW5kIG11c3Qgbm90IHJlcGxhY2UgZXhpc3RpbmcgYXJjaGl2ZSBmaWxlcy4KICAgICAgICAgICAgICAgICAgICAkZmFsbGJhY2tEaXIgPSBbSU8uUGF0aF06OkdldERpcmVjdG9yeU5hbWUoJGZhbGxiYWNrKQogICAgICAgICAgICAgICAgICAgIFtJTy5EaXJlY3RvcnldOjpDcmVhdGVEaXJlY3RvcnkoJGZhbGxiYWNrRGlyKSB8IE91dC1OdWxsCiAgICAgICAgICAgICAgICAgICAgJHJlYWRTdHJlYW0gPSAkbnVsbAogICAgICAgICAgICAgICAgICAgICR3cml0ZVN0cmVhbSA9ICRudWxsCiAgICAgICAgICAgICAgICAgICAgJGNyZWF0ZWRGYWxsYmFjayA9ICRmYWxzZQogICAgICAgICAgICAgICAgICAgICRjb3B5U3VjY2VlZGVkID0gJGZhbHNlCiAgICAgICAgICAgICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgICAgICAgICAgICAgJHdyaXRlU3RyZWFtID0gW0lPLkZpbGVdOjpPcGVuKCRmYWxsYmFjaywgW0lPLkZpbGVNb2RlXTo6Q3JlYXRlTmV3LCBbSU8uRmlsZUFjY2Vzc106OldyaXRlLCBbSU8uRmlsZVNoYXJlXTo6Tm9uZSkKICAgICAgICAgICAgICAgICAgICAgICAgJGNyZWF0ZWRGYWxsYmFjayA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgICRyZWFkU3RyZWFtID0gW0lPLkZpbGVdOjpPcGVuKCR0LlNvdXJjZSwgW0lPLkZpbGVNb2RlXTo6T3BlbiwgW0lPLkZpbGVBY2Nlc3NdOjpSZWFkLCBbSU8uRmlsZVNoYXJlXTo6UmVhZCkKICAgICAgICAgICAgICAgICAgICAgICAgJHJlYWRTdHJlYW0uQ29weVRvKCR3cml0ZVN0cmVhbSkKICAgICAgICAgICAgICAgICAgICAgICAgJHdyaXRlU3RyZWFtLkZsdXNoKCkKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCR3cml0ZVN0cmVhbS5MZW5ndGggLW5lIFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcyAtb3IgJHJlYWRTdHJlYW0uTGVuZ3RoIC1uZSBbSW50NjRdJHQuU291cmNlQnl0ZXMpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93ICJTb3VyY2Ugc2l6ZSBjaGFuZ2VkIGR1cmluZyBvcmlnaW5hbC1jb3B5IGZhbGxiYWNrLiIKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAkY29weVN1Y2NlZWRlZCA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIGZpbmFsbHkgewogICAgICAgICAgICAgICAgICAgICAgICBpZiAoJG51bGwgLW5lICRyZWFkU3RyZWFtKSB7ICRyZWFkU3RyZWFtLkRpc3Bvc2UoKSB9CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgkbnVsbCAtbmUgJHdyaXRlU3RyZWFtKSB7ICR3cml0ZVN0cmVhbS5EaXNwb3NlKCkgfQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoLW5vdCAkY29weVN1Y2NlZWRlZCAtYW5kICRjcmVhdGVkRmFsbGJhY2spIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJlbW92ZS1JdGVtIC1MaXRlcmFsUGF0aCAkZmFsbGJhY2sgLUZvcmNlIC1FcnJvckFjdGlvbiBTaWxlbnRseUNvbnRpbnVlCiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgU2V0LU91dHB1dFRpbWVzICRmYWxsYmFjayAkdC5DcmVhdGlvblRpbWUgJHQuTGFzdFdyaXRlVGltZQogICAgICAgICAgICAgICAgICAgICRyZXN1bHQgPSBbcHNjdXN0b21vYmplY3RdQHsKICAgICAgICAgICAgICAgICAgICAgICAgU3VjY2VzcyA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgIFNvdXJjZSA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbiA9ICRmYWxsYmFjawogICAgICAgICAgICAgICAgICAgICAgICBBY3Rpb24gPSAiQ29weSIKICAgICAgICAgICAgICAgICAgICAgICAgQmVmb3JlQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgQWZ0ZXJCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICBFcnJvciA9ICIiCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICRyZXN1bHRCYWcuQWRkKCRyZXN1bHQpCiAgICAgICAgICAgICAgICAgICAgV3JpdGUtSG9zdCAoIltLRVBUIE9SSUdJTkFMIEZPUk1BVF0gezB9IC0gY2FuZGlkYXRlIHdhcyBub3Qgc21hbGxlcjsgdW5jaGFuZ2VkIGZpbGUgc2F2ZWQgdG8gezF9IiAtZiAkdC5Tb3VyY2UsICRmYWxsYmFjaykgLUZvcmVncm91bmRDb2xvciBZZWxsb3cKICAgICAgICAgICAgICAgICAgICByZXR1cm4gJHJlc3VsdAogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9Cgo=')); $s=$s.Replace($needle,$insert+$needle); $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count -gt 0){throw ('ArchiveMedia safety patch syntax error: '+(($parseErrors | ForEach-Object Message) -join '; '))}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo ERROR: ArchiveMedia safety patch failed. Nothing was processed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.17: SKIP lines contain only status and path.
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $needle='            $label = Get-ActionLabel $Action'; $start=$s.IndexOf($needle,[StringComparison]::Ordinal); if($start -lt 0 -or $s.IndexOf($needle,$start+1,[StringComparison]::Ordinal) -ge 0){throw 'ArchiveMedia SKIP log patch marker must occur exactly once.'}; $append=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('ICAgICAgICAgICAgaWYgKCRBY3Rpb24gLWVxICdTa2lwJykgewogICAgICAgICAgICAgICAgV3JpdGUtSG9zdCAoJ1t7MH1dIHsxfScgLWYgJGxhYmVsLCAkUGF0aCkKICAgICAgICAgICAgICAgIHJldHVybgogICAgICAgICAgICB9Cg==')); $s=$s.Replace($needle,$needle+[char]10+$append); $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count){throw ('SKIP log patch failed syntax check: '+(($parseErrors | ForEach-Object Message) -join '; '))}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo ERROR: ArchiveMedia SKIP log patch failed. Nothing was processed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.17: minimal mode selector and remembered folders.
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
