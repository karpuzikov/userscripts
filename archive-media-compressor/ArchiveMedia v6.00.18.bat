@echo off
setlocal EnableExtensions DisableDelayedExpansion
title ArchiveMedia v6.0.18 - Under construction

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

rem ArchiveMedia v6.0.18 analysis-performance and payload-integrity patch.
rem No CALL/GOTO labels are used so GitHub Raw LF line endings cannot break execution.
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $workerPattern='if \(\$storageType -in @\([^)]+\)\) \{\s*\$AnalysisParallel = \[Math\]::Min\(8, \[Math\]::Max\(4, \$logicalCpu\)\)\s*\}\s*else \{\s*\$AnalysisParallel = \[Math\]::Min\(24, \[Math\]::Max\(8, \$logicalCpu \* 2\)\)\s*\}'; $workerReplacement='if ($storageType -in @(''HDD'', ''Unknown'', ''Unspecified'')) { $AnalysisParallel = [Math]::Min(8, [Math]::Max(4, $logicalCpu)) } elseif ($storageType -eq ''SSD'') { $AnalysisParallel = [Math]::Min(48, [Math]::Max(24, $logicalCpu * 3)) } else { $AnalysisParallel = [Math]::Min(24, [Math]::Max(8, $logicalCpu * 2)) }'; $s2=[regex]::Replace($s,$workerPattern,$workerReplacement,1); if($s2 -eq $s){throw 'ArchiveMedia v6.0.18 worker patch did not match embedded payload.'}; $s=$s2; $before=$s; $s=$s.Replace('$children = @($analysisJob.ChildJobs)','$children = $analysisJob.ChildJobs'); if($s -eq $before){throw 'ArchiveMedia v6.0.18 child-job patch did not match embedded payload.'}; $donePattern='\$done = @\(\$children \| Where-Object State -in @\([^)]+\)\)\.Count'; $doneReplacement='$done = 0; foreach ($child in $children) { if ($child.State -in @(''Completed'', ''Failed'', ''Stopped'')) { $done++ } }'; $s2=[regex]::Replace($s,$donePattern,$doneReplacement,1); if($s2 -eq $s){throw 'ArchiveMedia v6.0.18 progress-count patch did not match embedded payload.'}; $s=$s2; $before=$s; $s=$s.Replace('Start-Sleep -Milliseconds 150','Start-Sleep -Milliseconds 1000'); if($s -eq $before){throw 'ArchiveMedia v6.0.18 progress-poll patch did not match embedded payload.'}; $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count -gt 0){$msg=($parseErrors | ForEach-Object { '{0}: {1}' -f $_.Extent.StartLineNumber,$_.Message }) -join '; '; throw ('ArchiveMedia payload syntax check failed: ' + $msg)}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo.
    echo ERROR: Archive Media Compressor payload validation failed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.18 no-growth precommit protection (integrity-checked before launch).
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $needle='            $sourceFull = [IO.Path]::GetFullPath($t.Source)'; $first=$s.IndexOf($needle,[StringComparison]::Ordinal); if($first -lt 0 -or $s.IndexOf($needle,$first+1,[StringComparison]::Ordinal) -ge 0){throw 'ArchiveMedia precommit patch marker must occur exactly once.'}; $insert=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('CiAgICAgICAgICAgICMgQXJjaGl2ZU1lZGlhIHY2LjAuMTQ6IHJlamVjdCBub24tc2F2aW5nIGNvbnZlcnNpb25zIEJFRk9SRSBjb21taXQuCiAgICAgICAgICAgIGlmICgkdC5BY3Rpb24gLWluIEAoIkNvbnZlcnRQaG90byIsICJSZW11eFZpZGVvIiwgIkVuY29kZVZpZGVvIikpIHsKICAgICAgICAgICAgICAgIFtJbnQ2NF0kY2FuZGlkYXRlQnl0ZXMgPSAoW0lPLkZpbGVJbmZvXTo6bmV3KCR0ZW1wKSkuTGVuZ3RoCiAgICAgICAgICAgICAgICBpZiAoJGNhbmRpZGF0ZUJ5dGVzIC1nZSBbSW50NjRdJHQuU291cmNlQnl0ZXMpIHsKICAgICAgICAgICAgICAgICAgICBSZW1vdmUtSXRlbSAtTGl0ZXJhbFBhdGggJHRlbXAgLUZvcmNlIC1FcnJvckFjdGlvbiBTdG9wCgogICAgICAgICAgICAgICAgICAgIGlmICgkdXNpbmc6T3BlcmF0aW9uTW9kZSAtZXEgIlJlcGxhY2UiKSB7CiAgICAgICAgICAgICAgICAgICAgICAgICRyZXN1bHQgPSBbcHNjdXN0b21vYmplY3RdQHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFN1Y2Nlc3MgPSAkdHJ1ZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgU291cmNlID0gJHQuU291cmNlCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbiA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgQWN0aW9uID0gIlNraXAiCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBCZWZvcmVCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICAgICAgQWZ0ZXJCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICAgICAgRXJyb3IgPSAiIgogICAgICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgICAgICRyZXN1bHRCYWcuQWRkKCRyZXN1bHQpCiAgICAgICAgICAgICAgICAgICAgICAgIFdyaXRlLUhvc3QgKCJbS0VQVCBPUklHSU5BTF0gezB9IC0gY2FuZGlkYXRlIHsxfSB3YXMgbm90IHNtYWxsZXIgdGhhbiB7Mn0iIC1mICR0LlNvdXJjZSwgKEZvcm1hdC1CeXRlc0xvY2FsICRjYW5kaWRhdGVCeXRlcyksIChGb3JtYXQtQnl0ZXNMb2NhbCAoW0ludDY0XSR0LlNvdXJjZUJ5dGVzKSkpIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAkcmVzdWx0CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICAkcmVsYXRpdmVPcmlnaW5hbCA9IFtJTy5QYXRoXTo6R2V0UmVsYXRpdmVQYXRoKCR1c2luZzpJbnB1dFJvb3QsICR0LlNvdXJjZSkKICAgICAgICAgICAgICAgICAgICBpZiAoW0lPLlBhdGhdOjpJc1BhdGhSb290ZWQoJHJlbGF0aXZlT3JpZ2luYWwpIC1vciAkcmVsYXRpdmVPcmlnaW5hbCAtZXEgIi4uIiAtb3IgJHJlbGF0aXZlT3JpZ2luYWwuU3RhcnRzV2l0aCgiLi4iICsgW0lPLlBhdGhdOjpEaXJlY3RvcnlTZXBhcmF0b3JDaGFyKSkgewogICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyAiVW5zYWZlIGZhbGxiYWNrIHBhdGg6ICRyZWxhdGl2ZU9yaWdpbmFsIgogICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICAkZmFsbGJhY2sgPSBbSU8uUGF0aF06OkdldEZ1bGxQYXRoKChKb2luLVBhdGggJHVzaW5nOk91dHB1dFJvb3QgJHJlbGF0aXZlT3JpZ2luYWwpKQogICAgICAgICAgICAgICAgICAgIGlmIChbc3RyaW5nXTo6RXF1YWxzKCRmYWxsYmFjaywgW0lPLlBhdGhdOjpHZXRGdWxsUGF0aCgkdC5Tb3VyY2UpLCBbU3RyaW5nQ29tcGFyaXNvbl06Ok9yZGluYWxJZ25vcmVDYXNlKSkgewogICAgICAgICAgICAgICAgICAgICAgICAkcmVzdWx0ID0gW3BzY3VzdG9tb2JqZWN0XUB7CiAgICAgICAgICAgICAgICAgICAgICAgICAgICBTdWNjZXNzID0gJHRydWUKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFNvdXJjZSA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICAgICAgRGVzdGluYXRpb24gPSAkdC5Tb3VyY2UKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFjdGlvbiA9ICJTa2lwIgogICAgICAgICAgICAgICAgICAgICAgICAgICAgQmVmb3JlQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFmdGVyQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgICAgIEVycm9yID0gIiIKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAkcmVzdWx0QmFnLkFkZCgkcmVzdWx0KQogICAgICAgICAgICAgICAgICAgICAgICBXcml0ZS1Ib3N0ICgiW0tFUFQgT1JJR0lOQUxdIHswfSAtIG5vIHNtYWxsZXIgb3V0cHV0IiAtZiAkdC5Tb3VyY2UpIC1Gb3JlZ3JvdW5kQ29sb3IgWWVsbG93CiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAkcmVzdWx0CiAgICAgICAgICAgICAgICAgICAgfQoKICAgICAgICAgICAgICAgICAgICAjIEZpbGVNb2RlLkNyZWF0ZU5ldyBpcyBhdG9taWMgYW5kIG11c3Qgbm90IHJlcGxhY2UgZXhpc3RpbmcgYXJjaGl2ZSBmaWxlcy4KICAgICAgICAgICAgICAgICAgICAkZmFsbGJhY2tEaXIgPSBbSU8uUGF0aF06OkdldERpcmVjdG9yeU5hbWUoJGZhbGxiYWNrKQogICAgICAgICAgICAgICAgICAgIFtJTy5EaXJlY3RvcnldOjpDcmVhdGVEaXJlY3RvcnkoJGZhbGxiYWNrRGlyKSB8IE91dC1OdWxsCiAgICAgICAgICAgICAgICAgICAgJHJlYWRTdHJlYW0gPSAkbnVsbAogICAgICAgICAgICAgICAgICAgICR3cml0ZVN0cmVhbSA9ICRudWxsCiAgICAgICAgICAgICAgICAgICAgJGNyZWF0ZWRGYWxsYmFjayA9ICRmYWxzZQogICAgICAgICAgICAgICAgICAgICRjb3B5U3VjY2VlZGVkID0gJGZhbHNlCiAgICAgICAgICAgICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgICAgICAgICAgICAgJHdyaXRlU3RyZWFtID0gW0lPLkZpbGVdOjpPcGVuKCRmYWxsYmFjaywgW0lPLkZpbGVNb2RlXTo6Q3JlYXRlTmV3LCBbSU8uRmlsZUFjY2Vzc106OldyaXRlLCBbSU8uRmlsZVNoYXJlXTo6Tm9uZSkKICAgICAgICAgICAgICAgICAgICAgICAgJGNyZWF0ZWRGYWxsYmFjayA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgICRyZWFkU3RyZWFtID0gW0lPLkZpbGVdOjpPcGVuKCR0LlNvdXJjZSwgW0lPLkZpbGVNb2RlXTo6T3BlbiwgW0lPLkZpbGVBY2Nlc3NdOjpSZWFkLCBbSU8uRmlsZVNoYXJlXTo6UmVhZCkKICAgICAgICAgICAgICAgICAgICAgICAgJHJlYWRTdHJlYW0uQ29weVRvKCR3cml0ZVN0cmVhbSkKICAgICAgICAgICAgICAgICAgICAgICAgJHdyaXRlU3RyZWFtLkZsdXNoKCkKICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCR3cml0ZVN0cmVhbS5MZW5ndGggLW5lIFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcyAtb3IgJHJlYWRTdHJlYW0uTGVuZ3RoIC1uZSBbSW50NjRdJHQuU291cmNlQnl0ZXMpIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93ICJTb3VyY2Ugc2l6ZSBjaGFuZ2VkIGR1cmluZyBvcmlnaW5hbC1jb3B5IGZhbGxiYWNrLiIKICAgICAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICAgICAkY29weVN1Y2NlZWRlZCA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgIGZpbmFsbHkgewogICAgICAgICAgICAgICAgICAgICAgICBpZiAoJG51bGwgLW5lICRyZWFkU3RyZWFtKSB7ICRyZWFkU3RyZWFtLkRpc3Bvc2UoKSB9CiAgICAgICAgICAgICAgICAgICAgICAgIGlmICgkbnVsbCAtbmUgJHdyaXRlU3RyZWFtKSB7ICR3cml0ZVN0cmVhbS5EaXNwb3NlKCkgfQogICAgICAgICAgICAgICAgICAgICAgICBpZiAoLW5vdCAkY29weVN1Y2NlZWRlZCAtYW5kICRjcmVhdGVkRmFsbGJhY2spIHsKICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJlbW92ZS1JdGVtIC1MaXRlcmFsUGF0aCAkZmFsbGJhY2sgLUZvcmNlIC1FcnJvckFjdGlvbiBTaWxlbnRseUNvbnRpbnVlCiAgICAgICAgICAgICAgICAgICAgICAgIH0KICAgICAgICAgICAgICAgICAgICB9CiAgICAgICAgICAgICAgICAgICAgU2V0LU91dHB1dFRpbWVzICRmYWxsYmFjayAkdC5DcmVhdGlvblRpbWUgJHQuTGFzdFdyaXRlVGltZQogICAgICAgICAgICAgICAgICAgICRyZXN1bHQgPSBbcHNjdXN0b21vYmplY3RdQHsKICAgICAgICAgICAgICAgICAgICAgICAgU3VjY2VzcyA9ICR0cnVlCiAgICAgICAgICAgICAgICAgICAgICAgIFNvdXJjZSA9ICR0LlNvdXJjZQogICAgICAgICAgICAgICAgICAgICAgICBEZXN0aW5hdGlvbiA9ICRmYWxsYmFjawogICAgICAgICAgICAgICAgICAgICAgICBBY3Rpb24gPSAiQ29weSIKICAgICAgICAgICAgICAgICAgICAgICAgQmVmb3JlQnl0ZXMgPSBbSW50NjRdJHQuU291cmNlQnl0ZXMKICAgICAgICAgICAgICAgICAgICAgICAgQWZ0ZXJCeXRlcyA9IFtJbnQ2NF0kdC5Tb3VyY2VCeXRlcwogICAgICAgICAgICAgICAgICAgICAgICBFcnJvciA9ICIiCiAgICAgICAgICAgICAgICAgICAgfQogICAgICAgICAgICAgICAgICAgICRyZXN1bHRCYWcuQWRkKCRyZXN1bHQpCiAgICAgICAgICAgICAgICAgICAgV3JpdGUtSG9zdCAoIltLRVBUIE9SSUdJTkFMIEZPUk1BVF0gezB9IC0gY2FuZGlkYXRlIHdhcyBub3Qgc21hbGxlcjsgdW5jaGFuZ2VkIGZpbGUgc2F2ZWQgdG8gezF9IiAtZiAkdC5Tb3VyY2UsICRmYWxsYmFjaykgLUZvcmVncm91bmRDb2xvciBZZWxsb3cKICAgICAgICAgICAgICAgICAgICByZXR1cm4gJHJlc3VsdAogICAgICAgICAgICAgICAgfQogICAgICAgICAgICB9Cgo=')); $s=$s.Replace($needle,$insert+$needle); $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count -gt 0){throw ('ArchiveMedia safety patch syntax error: '+(($parseErrors | ForEach-Object Message) -join '; '))}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo ERROR: ArchiveMedia safety patch failed. Nothing was processed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.18: SKIP lines contain only status and path.
set "ARCHIVEMEDIA_PS1=%PAYLOAD_DIR%\ArchiveMedia.ps1"
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $p=$env:ARCHIVEMEDIA_PS1; $s=[IO.File]::ReadAllText($p); $needle='            $label = Get-ActionLabel $Action'; $start=$s.IndexOf($needle,[StringComparison]::Ordinal); if($start -lt 0 -or $s.IndexOf($needle,$start+1,[StringComparison]::Ordinal) -ge 0){throw 'ArchiveMedia SKIP log patch marker must occur exactly once.'}; $append=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('ICAgICAgICAgICAgaWYgKCRBY3Rpb24gLWVxICdTa2lwJykgewogICAgICAgICAgICAgICAgV3JpdGUtSG9zdCAoJ1t7MH1dIHsxfScgLWYgJGxhYmVsLCAkUGF0aCkKICAgICAgICAgICAgICAgIHJldHVybgogICAgICAgICAgICB9Cg==')); $s=$s.Replace($needle,$needle+[char]10+$append); $tokens=$null; $parseErrors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$parseErrors); if($parseErrors.Count){throw ('SKIP log patch failed syntax check: '+(($parseErrors | ForEach-Object Message) -join '; '))}; [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo ERROR: ArchiveMedia SKIP log patch failed. Nothing was processed.
    pause
    exit /b 1
)
set "ARCHIVEMEDIA_PS1="

rem ArchiveMedia v6.0.18: minimal mode selector and remembered folders.
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
AAMAtAAAAIRIAAAAAA==
