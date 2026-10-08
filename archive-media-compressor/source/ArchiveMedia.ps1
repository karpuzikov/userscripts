#requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------- USER-TUNABLE SETTINGS ----------------
$MaxParallel = 4

# Re-encode threshold / output target. Bitrates are bits per second.
$Threshold1080 = 6000000
$Target1080    = 5000000

$Threshold720  = 3500000
$Target720     = 3000000

$ThresholdSD   = 2000000
$TargetSD      = 1500000

# >45 fps gets more bitrate.
$HighFpsMultiplier = 1.50

# Existing JPG/JPEG files within the size limit are copied byte-for-byte.
# PNG files with actual transparency (alpha < 250/255) are preserved as PNG.
# Other still images are converted to high-quality 4:4:4 JPEG.
$JpegQuality = 95
# --------------------------------------------------------

$RawExtensions = @(
    ".3fr", ".arw", ".cr2", ".cr3", ".dcr", ".dng", ".erf", ".fff",
    ".iiq", ".k25", ".kdc", ".mef", ".mos", ".mrw", ".nef", ".nrw",
    ".orf", ".pef", ".raf", ".raw", ".rw2", ".rwl", ".sr2", ".srf",
    ".srw", ".x3f"
)

$PhotoExtensions = @(
    ".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".bmp",
    ".tif", ".tiff", ".avif", ".jxl"
)

# Known video/container extensions. Limiting FFprobe to these avoids launching it
# for documents, archives, audio-only files, torrents, and other passthrough data.
$VideoExtensions = @(
    ".3g2", ".3gp", ".264", ".265", ".amv", ".apng", ".asf", ".avi",
    ".bik", ".bik2", ".divx", ".dv", ".dvr-ms", ".f4v", ".flv", ".gif",
    ".h264", ".h265", ".hevc", ".ivf", ".m1v", ".m2ts", ".m2v", ".m4v",
    ".mjpeg", ".mjpg", ".mkv", ".mod", ".mov", ".mp4", ".mpe", ".mpeg",
    ".mpg", ".mpv", ".mts", ".mxf", ".nsv", ".nut", ".ogm", ".ogv",
    ".qt", ".r3d", ".rm", ".rmvb", ".roq", ".smk", ".tod", ".ts",
    ".vob", ".vro", ".webm", ".wmv", ".wtv", ".y4m"
)

function Write-Section([string]$Text) {
    Write-Host ""
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}

function Format-Bytes([Int64]$Bytes) {
    if ($Bytes -ge 1TB) { return "{0:N2} TiB" -f ($Bytes / 1TB) }
    if ($Bytes -ge 1GB) { return "{0:N2} GiB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N2} MiB" -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return "{0:N2} KiB" -f ($Bytes / 1KB) }
    return "$Bytes B"
}

function Select-Folder([string]$Title) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = [System.Windows.Forms.FolderBrowserDialog]::new()
        $dialog.Description = $Title
        $dialog.ShowNewFolderButton = $true
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            return [IO.Path]::GetFullPath($dialog.SelectedPath).TrimEnd("\")
        }
    }
    catch {
        # Fall back to console input.
    }

    $p = (Read-Host $Title).Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($p)) { return $null }
    return [IO.Path]::GetFullPath($p).TrimEnd("\")
}

function Resolve-Executable([string]$Name, [string[]]$FallbackPatterns = @()) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $wingetLink = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\$Name"
    if (Test-Path -LiteralPath $wingetLink) {
        return (Get-Item -LiteralPath $wingetLink).FullName
    }

    foreach ($pattern in $FallbackPatterns) {
        $matches = Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending
        if ($matches) { return $matches[0].FullName }
    }
    return $null
}

function Install-WingetPackage([string]$Id, [string]$FriendlyName) {
    Write-Host "Installing $FriendlyName..." -ForegroundColor Yellow
    & winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "winget failed to install $FriendlyName ($Id). Exit code: $LASTEXITCODE"
    }
}

function Test-Encoder([string]$FFmpeg, [string]$Encoder) {
    & $FFmpeg -hide_banner -loglevel error -f lavfi -i "color=c=black:s=320x180:r=30" `
        -frames:v 3 -c:v $Encoder -f null NUL 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Get-VideoPolicy(
    [int]$Width,
    [int]$Height,
    [double]$Fps,
    [Int64]$Bitrate,
    [string]$Codec
) {
    $longSide  = [Math]::Max($Width, $Height)
    $shortSide = [Math]::Min($Width, $Height)
    $pixels = [Int64]$Width * [Int64]$Height

    # Anything above a 1920x1080-equivalent box is reduced to 1080p.
    $needsResize = ($longSide -gt 1920 -or $shortSide -gt 1080)

    if ($pixels -ge 1400000 -or $longSide -ge 1600) {
        $threshold = [double]$script:Threshold1080
        $target = [double]$script:Target1080
        $bucket = "1080p"
    }
    elseif ($pixels -ge 600000 -or $longSide -ge 1100) {
        $threshold = [double]$script:Threshold720
        $target = [double]$script:Target720
        $bucket = "720p"
    }
    else {
        $threshold = [double]$script:ThresholdSD
        $target = [double]$script:TargetSD
        $bucket = "SD"
    }

    if ($Fps -gt 45) {
        $threshold *= $script:HighFpsMultiplier
        $target *= $script:HighFpsMultiplier
    }

    # H.264 needs a little more bitrate than HEVC/AV1 for similar quality.
    # For output encoding, the target is adjusted later if the selected encoder is H.264.
    $codecLower = $Codec.ToLowerInvariant()
    if ($codecLower -in @("av1", "hevc", "h265")) {
        # Keep our own ~5 Mb/s AV1/HEVC outputs from being needlessly encoded again.
        $threshold *= 1.05
    }

    [pscustomobject]@{
        NeedsResize = $needsResize
        Threshold   = [Int64][Math]::Round($threshold)
        Target      = [Int64][Math]::Round($target)
        Bucket      = $bucket
        Bitrate     = $Bitrate
    }
}

function Get-Fps([string]$Rate) {
    if ([string]::IsNullOrWhiteSpace($Rate) -or $Rate -eq "0/0") { return 0.0 }
    if ($Rate -match "^(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)$") {
        $n = [double]$Matches[1]
        $d = [double]$Matches[2]
        if ($d -ne 0) { return $n / $d }
    }
    $v = 0.0
    if ([double]::TryParse($Rate, [ref]$v)) { return $v }
    return 0.0
}

function Get-RelativePathSafe([string]$Root, [string]$Path) {
    return [IO.Path]::GetRelativePath($Root, $Path)
}

function Get-OutputPath(
    [string]$InputRoot,
    [string]$OutputRoot,
    [IO.FileInfo]$File,
    [string]$Kind
) {
    $relative = Get-RelativePathSafe $InputRoot $File.FullName
    $relativeDir = [IO.Path]::GetDirectoryName($relative)
    $base = [IO.Path]::GetFileNameWithoutExtension($relative)

    switch ($Kind) {
        "Video"    { $name = "$base.mp4" }
        "Photo"    { $name = "$base.jpg" }
        "PNGAlpha" { $name = [IO.Path]::GetFileName($relative) }
        default      { $name = [IO.Path]::GetFileName($relative) }
    }

    if ([string]::IsNullOrEmpty($relativeDir)) {
        return Join-Path $OutputRoot $name
    }
    return Join-Path (Join-Path $OutputRoot $relativeDir) $name
}

# ---- Dependencies ----
Write-Section "Dependency check"

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Windows Package Manager (winget) is missing. Install Microsoft App Installer, then run this again."
}

$FFmpeg = Resolve-Executable "ffmpeg.exe" @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg*\**\ffmpeg.exe"
)
$FFprobe = Resolve-Executable "ffprobe.exe" @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg*\**\ffprobe.exe"
)

if (-not $FFmpeg -or -not $FFprobe) {
    Install-WingetPackage "Gyan.FFmpeg" "FFmpeg"
    $FFmpeg = Resolve-Executable "ffmpeg.exe" @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg*\**\ffmpeg.exe"
    )
    $FFprobe = Resolve-Executable "ffprobe.exe" @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg*\**\ffprobe.exe"
    )
}
if (-not $FFmpeg -or -not $FFprobe) {
    throw "FFmpeg/FFprobe were installed but could not be located."
}

$Magick = Resolve-Executable "magick.exe" @(
    "$env:ProgramFiles\ImageMagick-*\magick.exe",
    "${env:ProgramFiles(x86)}\ImageMagick-*\magick.exe"
)
if (-not $Magick) {
    Install-WingetPackage "ImageMagick.ImageMagick" "ImageMagick"
    $Magick = Resolve-Executable "magick.exe" @(
        "$env:ProgramFiles\ImageMagick-*\magick.exe",
        "${env:ProgramFiles(x86)}\ImageMagick-*\magick.exe"
    )
}
if (-not $Magick) {
    throw "ImageMagick was installed but magick.exe could not be located."
}

Write-Host "FFmpeg:     $FFmpeg"
Write-Host "FFprobe:    $FFprobe"
Write-Host "ImageMagick:$Magick"

# First-class cloud backend. The original analysis and conversion engine runs
# in a child process on one locally staged file; its media policies are unchanged.
function Test-RclonePath([string]$p) {
    if ($p -match '^[A-Za-z]:([\\/]|$)') { return $false }
    return $p -match '^[A-Za-z0-9][A-Za-z0-9 _.-]*:'
}
function Join-CloudPath([string]$root, [string]$relative) {
    $rel = $relative.Replace('\','/').TrimStart('/')
    if (-not $rel -or $rel -match '(^|/)\.\.?(/|$)' -or $rel -match '^[A-Za-z]:') {
        throw "Unsafe relative cloud path: $relative"
    }
    if ($root.EndsWith(':')) { return ($root + $rel) }
    return ($root.TrimEnd('/') + '/' + $rel)
}
function Cloud-Id([string]$value) {
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData(
        [Text.Encoding]::UTF8.GetBytes($value))).ToLowerInvariant()
}
function Cloud-Call([string]$exe, [string[]]$args, [bool]$allowMissing = $false) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = @(& $exe @args 2>&1)
        $rc = $LASTEXITCODE
    } finally { $ErrorActionPreference = $previous }
    if ($rc -ne 0) {
        if ($allowMissing -and $rc -in @(3,4)) { return $null }
        throw ("rclone {0} failed ({1}): {2}" -f $args[0], $rc, ($lines -join ' '))
    }
    return ($lines -join [Environment]::NewLine)
}
function Cloud-Stat([string]$exe, [string]$path) {
    if (Test-RclonePath $path) {
        $raw = Cloud-Call $exe @('lsjson','--stat','--hash','--retries','8','--low-level-retries','30','--timeout','60m',$path) $true
        if (-not $raw) { return $null }
        $item = $raw | ConvertFrom-Json
        if ($item.IsDir) { return $null }
        $md5 = if ($item.Hashes) { [string]$item.Hashes.MD5 } else { '' }
        return [pscustomobject]@{ Size=[Int64]$item.Size; MD5=$md5.ToLowerInvariant() }
    }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    $file = Get-Item -LiteralPath $path
    return [pscustomobject]@{
        Size=[Int64]$file.Length
        MD5=(Get-FileHash -LiteralPath $path -Algorithm MD5).Hash.ToLowerInvariant()
    }
}
function Cloud-Transfer([string]$exe, [string[]]$args) {
    & $exe @args --retries 8 --low-level-retries 30 --timeout 60m --yandex-upload-wait 2s --progress --stats 5s --stats-one-line
    if ($LASTEXITCODE -ne 0) { throw "rclone $($args[0]) failed with exit code $LASTEXITCODE" }
}
function Invoke-ArchiveCloud([string]$src, [string]$dst) {
    $rclone = Resolve-Executable 'rclone.exe' @("$env:LOCALAPPDATA\Microsoft\WinGet\Links\rclone.exe")
    if (-not $rclone) { throw 'rclone.exe not found; update rclone from WinGet.' }
    $remotes = @(Cloud-Call $rclone @('listremotes')) -split '\r?\n'
    foreach ($p in @($src,$dst)) {
        if (Test-RclonePath $p) {
            $remote = $p.Split(':')[0] + ':'
            if ($remote -notin $remotes) { throw "rclone remote $remote not configured. Run rclone config." }
        }
    }
    if ((Test-RclonePath $src) -and (Test-RclonePath $dst)) {
        $a = $src.Replace('\','/').TrimEnd('/')
        $b = $dst.Replace('\','/').TrimEnd('/')
        if ($a.Equals($b,[StringComparison]::OrdinalIgnoreCase) -or
            $a.StartsWith($b + '/', [StringComparison]::OrdinalIgnoreCase) -or
            $b.StartsWith($a + '/', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Cloud source and destination folders must not overlap.'
        }
    }
    $docs = [Environment]::GetFolderPath([Environment+SpecialFolder]::MyDocuments)
    if (-not $docs) { $docs = Join-Path $env:USERPROFILE 'Documents' }
    $stateRoot = Join-Path $docs 'Karpuzikov Tools\ArchiveMedia'
    $routeId = (Cloud-Id ($src.ToLowerInvariant() + '|' + $dst.ToLowerInvariant())).Substring(0,20)
    $workRoot = Join-Path $stateRoot ('temp\cloud\' + $routeId)
    $logRoot = Join-Path $stateRoot 'logs'
    New-Item -ItemType Directory -Path $workRoot,$logRoot -Force | Out-Null
    $journal = Join-Path $logRoot ('rclone-' + $routeId + '.jsonl')
    $finished = @{}
    if (Test-Path -LiteralPath $journal) {
        foreach ($line in [IO.File]::ReadLines($journal)) {
            try {
                $record = $line | ConvertFrom-Json
                if ($record.Key -and $record.Target -and $record.MD5) { $finished[[string]$record.Key] = $record }
            } catch { }
        }
    }
    [Int64]$cap = 64GB
    if ($env:ARCHIVEMEDIA_CACHE_GIB -match '^[0-9]{1,4}$') {
        $cap = [Int64]::Parse($env:ARCHIVEMEDIA_CACHE_GIB) * 1GB
    }
    if ($cap -lt 3GB) { throw 'Staging limit must be at least 3 GiB.' }
    Write-Section 'Cloud inventory'
    $all = [System.Collections.Generic.List[object]]::new()
    if (Test-RclonePath $src) {
        $json = Cloud-Call $rclone @('lsjson','--recursive','--files-only','--hash','--retries','8','--timeout','60m',$src)
        foreach ($entry in @($json | ConvertFrom-Json)) {
            $rel = [string]$entry.Path
            $full = Join-CloudPath $src $rel
            $hash = if ($entry.Hashes) { [string]$entry.Hashes.MD5 } else { '' }
            if ($hash -notmatch '^[A-Fa-f0-9]{32}$') { throw "No cloud MD5 for $rel. Verification required." }
            $all.Add([pscustomobject]@{
                Rel=$rel; Source=$full; Size=[Int64]$entry.Size
                Modified=[string]$entry.ModTime; MD5=$hash.ToLowerInvariant()
            })
        }
    } else {
        $opts = [IO.EnumerationOptions]::new()
        $opts.RecurseSubdirectories = $true
        $opts.IgnoreInaccessible = $true
        $opts.AttributesToSkip = [IO.FileAttributes]0
        foreach ($local in [IO.Directory]::EnumerateFiles($src,'*',$opts)) {
            $fi = [IO.FileInfo]::new($local)
            $rel = [IO.Path]::GetRelativePath($src,$local).Replace('\','/')
            $all.Add([pscustomobject]@{
                Rel=$rel; Source=$local; Size=[Int64]$fi.Length
                Modified=$fi.LastWriteTimeUtc.ToString('o'); MD5=''
            })
        }
    }
    $ordered = @($all | Sort-Object Rel)
    $success = 0; $resumed = 0; $failed = 0
    $clock = [Diagnostics.Stopwatch]::StartNew()
    Write-Host ("Files: {0}. Cache limit: {1}. Pipeline: download > process > upload > verify." -f $ordered.Count,(Format-Bytes $cap))
    foreach ($file in $ordered) {
        $key = Cloud-Id ("$src|$dst|$($file.Rel)|$($file.Size)|$($file.Modified)|$($file.MD5)")
        try {
            $old = $finished[$key]
            if ($old) {
                $stat = Cloud-Stat $rclone ([string]$old.Target)
                if ($stat -and $stat.Size -eq [Int64]$old.Size -and
                    $stat.MD5 -eq ([string]$old.MD5).ToLowerInvariant()) {
                    $resumed++
                    Write-Host ("[RESUME] {0} ({1}/{2})" -f $file.Rel,($success+$resumed),$ordered.Count)
                    continue
                }
            }
            $job = Join-Path $workRoot $key.Substring(0,24)
            $inRoot = Join-Path $job 'input'
            $outRoot = Join-Path $job 'output'
            New-Item -ItemType Directory -Path $inRoot,$outRoot -Force | Out-Null
            [Int64]$used = 0
            foreach ($p in [IO.Directory]::EnumerateFiles($workRoot,'*',[IO.SearchOption]::AllDirectories)) {
                $used += [IO.FileInfo]::new($p).Length
            }
            [Int64]$reserve = [Math]::Max(1GB,([Int64]$file.Size * 3))
            $free = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($job)).AvailableFreeSpace
            if ($used + $reserve -gt $cap -or $free -lt $reserve + 1GB) {
                throw "Staging limit/free space insufficient. Need $(Format-Bytes $reserve) plus existing $(Format-Bytes $used). Adjust ARCHIVEMEDIA_CACHE_GIB or free disk space."
            }
            $original = [string]$file.Source
            if (Test-RclonePath $src) {
                $original = Join-Path $inRoot $file.Rel.Replace('/','\')
                New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($original)) -Force | Out-Null
                $localStat = Cloud-Stat $rclone $original
                if (-not $localStat -or $localStat.Size -ne $file.Size -or $localStat.MD5 -ne $file.MD5) {
                    Write-Section ("Download {0}/{1}: {2}" -f ($success+$resumed+1),$ordered.Count,$file.Rel)
                    Cloud-Transfer $rclone @('copyto',$file.Source,$original)
                    $localStat = Cloud-Stat $rclone $original
                    if (-not $localStat -or $localStat.Size -ne $file.Size -or $localStat.MD5 -ne $file.MD5) {
                        throw "Downloaded checksum mismatch: $($file.Rel)"
                    }
                }
            }
            Write-Section ("Process {0}/{1}: {2}" -f ($success+$resumed+1),$ordered.Count,$file.Rel)
            $report = Join-Path $job 'result.json'
            Remove-Item -LiteralPath $report -Force -ErrorAction SilentlyContinue
            $env:ARCHIVEMEDIA_BATCH_FILE = $original
            $env:ARCHIVEMEDIA_BATCH_INPUT = if (Test-RclonePath $src) { $inRoot } else { $src }
            $env:ARCHIVEMEDIA_BATCH_OUTPUT = $outRoot
            $env:ARCHIVEMEDIA_BATCH_RESULT = $report
            try {
                & (Get-Process -Id $PID).Path -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File $PSCommandPath
                $childExit = $LASTEXITCODE
            } finally {
                Remove-Item Env:ARCHIVEMEDIA_BATCH_FILE,Env:ARCHIVEMEDIA_BATCH_INPUT,Env:ARCHIVEMEDIA_BATCH_OUTPUT,Env:ARCHIVEMEDIA_BATCH_RESULT -ErrorAction SilentlyContinue
            }
            if ($childExit -ne 0 -or -not (Test-Path -LiteralPath $report)) {
                throw "Compressor child process failed: exit $childExit"
            }
            $result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
            if (-not $result.Success -or @($result.Results).Count -ne 1) { throw 'Compressor reported failure.' }
            $output = [string]$result.Results[0].Destination
            if (-not (Test-Path -LiteralPath $output -PathType Leaf)) { throw 'Processed file not found.' }
            $relativeOut = [IO.Path]::GetRelativePath($outRoot,$output).Replace('\','/')
            $target = if (Test-RclonePath $dst) { Join-CloudPath $dst $relativeOut } else { Join-Path $dst $relativeOut.Replace('/','\') }
            $data = Cloud-Stat $rclone $output
            $existing = Cloud-Stat $rclone $target
            if ($existing) {
                if ($existing.Size -ne $data.Size -or $existing.MD5 -ne $data.MD5) {
                    throw "Different destination already exists. Refusing overwrite: $target"
                }
                Write-Host "[UPLOAD SKIPPED] Destination is byte-identical."
            } elseif (Test-RclonePath $dst) {
                Write-Section ("Upload {0}/{1}: {2}" -f ($success+$resumed+1),$ordered.Count,$relativeOut)
                $remoteTemp = $target + '.archivemedia-uploading-' + $routeId
                Cloud-Transfer $rclone @('copyto',$output,$remoteTemp)
                $intermediate = Cloud-Stat $rclone $remoteTemp
                if (-not $intermediate -or $intermediate.Size -ne $data.Size -or $intermediate.MD5 -ne $data.MD5) {
                    throw "Remote staging checksum mismatch: $remoteTemp"
                }
                if (Cloud-Stat $rclone $target) { throw "Destination appeared during transfer: $target" }
                Cloud-Transfer $rclone @('moveto',$remoteTemp,$target)
            } else {
                Write-Section ("Save local {0}/{1}: {2}" -f ($success+$resumed+1),$ordered.Count,$relativeOut)
                New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
                $temp = $target + '.archivemedia-uploading-' + $routeId
                Copy-Item -LiteralPath $output -Destination $temp -Force
                if ((Cloud-Stat $rclone $temp).MD5 -ne $data.MD5) { throw 'Local transfer checksum mismatch.' }
                if (Test-Path -LiteralPath $target) { throw "Destination appeared while copying: $target" }
                Move-Item -LiteralPath $temp -Destination $target
            }
            $verified = Cloud-Stat $rclone $target
            if (-not $verified -or $verified.Size -ne $data.Size -or $verified.MD5 -ne $data.MD5) {
                throw "Final checksum verification failed: $target"
            }
            $entry = [pscustomobject]@{
                Key=$key; Target=$target; Size=[Int64]$data.Size; MD5=$data.MD5
                Source=$file.Source; FinishedUtc=[DateTime]::UtcNow.ToString('o')
            }
            Add-Content -LiteralPath $journal -Value ($entry | ConvertTo-Json -Compress) -Encoding UTF8
            Remove-Item -LiteralPath $job -Recurse -Force
            $success++
            Write-Host ("[VERIFIED] {0} ({1}/{2}, elapsed {3})" -f $file.Rel,($success+$resumed),$ordered.Count,$clock.Elapsed) -ForegroundColor Green
        } catch {
            $failed++
            Write-Host ("[FAILED] {0}: {1}" -f $file.Rel,$_.Exception.Message) -ForegroundColor Red
            Write-Host 'Staging was preserved; fix the issue and rerun to resume.' -ForegroundColor Yellow
            break
        }
    }
    Write-Section 'Cloud summary'
    Write-Host ("Verified: {0}; resumed: {1}; failed: {2}; total: {3}" -f $success,$resumed,$failed,$ordered.Count)
    Write-Host "Journal: $journal"
    if ($failed) { throw 'Cloud processing stopped after failure.' }
}

# ---- Operation mode / source / destination ----
Write-Section "Mode"
Write-Host "1. Copy files mode"
Write-Host "   Process files into another folder and keep all source files unchanged."
Write-Host "2. Replace mode"
Write-Host "   Process files in place and replace each original only after its output succeeds."
Write-Host ""

do {
    $modeChoice = (Read-Host "Choose mode [1/2]").Trim()
} while ($modeChoice -notin @("1", "2"))

$OperationMode = if ($modeChoice -eq "1") { "Copy" } else { "Replace" }

Write-Section "Folders"
$InputRoot = Select-Folder $(if ($OperationMode -eq "Copy") { "Select SOURCE folder" } else { "Select folder to process in place" })
if (-not $InputRoot) { throw "No input folder selected." }
if (-not (Test-Path -LiteralPath $InputRoot -PathType Container)) {
    throw "Input folder does not exist: $InputRoot"
}

if ($OperationMode -eq "Copy") {
    $OutputRoot = Select-Folder "Select DESTINATION folder"
    if (-not $OutputRoot) { throw "No destination folder selected." }

    if ([string]::Equals(
        [IO.Path]::GetFullPath($InputRoot).TrimEnd("\"),
        [IO.Path]::GetFullPath($OutputRoot).TrimEnd("\"),
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Source and destination folders must be different in Copy files mode. Use Replace mode to process files in place."
    }

    New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
    Write-Host "Mode:        Copy files"
    Write-Host "Source:      $InputRoot"
    Write-Host "Destination: $OutputRoot"
}
else {
    $OutputRoot = $InputRoot
    Write-Host "Mode:   Replace"
    Write-Host "Folder: $InputRoot"
}

# ---- Hardware detection ----
Write-Section "Hardware detection"
$CpuNames = @(Get-CimInstance Win32_Processor | ForEach-Object Name)
$GpuNames = @(Get-CimInstance Win32_VideoController | ForEach-Object Name)

Write-Host ("CPU: " + ($CpuNames -join " | "))
Write-Host ("GPU: " + ($GpuNames -join " | "))

$gpuText = ($GpuNames -join " ").ToLowerInvariant()
$encoderCandidates = [System.Collections.Generic.List[string]]::new()

if ($gpuText -match "nvidia") {
    @("av1_nvenc", "hevc_nvenc", "h264_nvenc") | ForEach-Object { $encoderCandidates.Add($_) }
}
if ($gpuText -match "intel") {
    @("av1_qsv", "hevc_qsv", "h264_qsv") | ForEach-Object {
        if (-not $encoderCandidates.Contains($_)) { $encoderCandidates.Add($_) }
    }
}
if ($gpuText -match "amd|radeon") {
    @("av1_amf", "hevc_amf", "h264_amf") | ForEach-Object {
        if (-not $encoderCandidates.Contains($_)) { $encoderCandidates.Add($_) }
    }
}

# If vendor detection is incomplete, still try all common hardware backends.
@(
    "av1_nvenc", "av1_qsv", "av1_amf",
    "hevc_nvenc", "hevc_qsv", "hevc_amf",
    "h264_nvenc", "h264_qsv", "h264_amf"
) | ForEach-Object {
    if (-not $encoderCandidates.Contains($_)) { $encoderCandidates.Add($_) }
}

$SelectedEncoder = $null
foreach ($enc in $encoderCandidates) {
    Write-Host "Testing $enc..." -NoNewline
    if (Test-Encoder $FFmpeg $enc) {
        $SelectedEncoder = $enc
        Write-Host " OK" -ForegroundColor Green
        break
    }
    Write-Host " unavailable" -ForegroundColor DarkGray
}

if (-not $SelectedEncoder) {
    if (Test-Encoder $FFmpeg "libx265") {
        $SelectedEncoder = "libx265"
    }
    else {
        throw "No usable hardware encoder and no libx265 fallback were found."
    }
}

$OutputCodecClass =
    if ($SelectedEncoder -match "^av1_") { "AV1" }
    elseif ($SelectedEncoder -match "^hevc_" -or $SelectedEncoder -eq "libx265") { "HEVC" }
    else { "H264" }

Write-Host "Selected encoder: $SelectedEncoder ($OutputCodecClass)" -ForegroundColor Green
Write-Host "Parallel jobs:    $MaxParallel"

# ---- Scan ----
$runTimer = [Diagnostics.Stopwatch]::StartNew()

Write-Section "Scanning"

$outputPrefix = [IO.Path]::GetFullPath($OutputRoot).TrimEnd("\") + "\"

# .NET enumeration has substantially less PowerShell object/pipeline overhead than
# recursive Get-ChildItem on very large trees. AttributesToSkip = 0 keeps hidden and
# system items visible, matching the previous -Force behavior.
$enumOptions = [IO.EnumerationOptions]::new()
$enumOptions.RecurseSubdirectories = $true
$enumOptions.IgnoreInaccessible = $true
$enumOptions.ReturnSpecialDirectories = $false
$enumOptions.AttributesToSkip = [IO.FileAttributes]0

$allFiles = @(
    [IO.Directory]::EnumerateFiles($InputRoot, "*", $enumOptions) |
    Where-Object {
        $OperationMode -eq "Replace" -or
        -not $_.StartsWith($outputPrefix, [StringComparison]::OrdinalIgnoreCase)
    } |
    ForEach-Object { [IO.FileInfo]::new($_) } |
    # Process already-standardized formats first so they keep the clean output name
    # when another source file has the same stem (for example .jpg + .png).
    Sort-Object `
        @{ Expression = { [IO.Path]::GetDirectoryName($_.FullName) }; Ascending = $true }, `
        @{ Expression = { [IO.Path]::GetFileNameWithoutExtension($_.Name) }; Ascending = $true }, `
        @{ Expression = {
            switch ($_.Extension.ToLowerInvariant()) {
                ".jpg"  { 0 }
                ".mp4"  { 0 }
                ".jpeg" { 1 }
                default { 2 }
            }
        }; Ascending = $true }, `
        @{ Expression = { $_.Extension.ToLowerInvariant() }; Ascending = $true }
)

if ($allFiles.Count -eq 0) {
    throw "No files found under: $InputRoot"
}

# Re-create directory tree, including empty folders.
if ($OperationMode -eq "Copy") {
    foreach ($dirPath in [IO.Directory]::EnumerateDirectories($InputRoot, "*", $enumOptions)) {
        if ($dirPath.StartsWith($outputPrefix, [StringComparison]::OrdinalIgnoreCase)) { continue }
        $relDir = Get-RelativePathSafe $InputRoot $dirPath
        New-Item -ItemType Directory -Path (Join-Path $OutputRoot $relDir) -Force | Out-Null
    }
}

# Analysis is mostly external-process startup + short metadata reads, so it benefits
# from more concurrency than the actual encoders. HDDs intentionally use a lower
# ceiling to avoid seek thrashing; SSD/NVMe can use a larger pool.
$logicalCpu = [Math]::Max(1, [Environment]::ProcessorCount)
$storageType = "Unknown"
try {
    $root = [IO.Path]::GetPathRoot($InputRoot).TrimEnd("\")
    if ($root -match "^([A-Za-z]):$") {
        $letter = $Matches[1]
        $partition = Get-Partition -DriveLetter $letter -ErrorAction Stop
        $disk = $partition | Get-Disk -ErrorAction Stop
        $physical = Get-PhysicalDisk -ErrorAction Stop |
            Where-Object { [string]$_.DeviceId -eq [string]$disk.Number } |
            Select-Object -First 1
        if ($physical -and $physical.MediaType) {
            $storageType = [string]$physical.MediaType
        }
    }
}
catch {
    # Storage type detection is only an optimization hint.
}

if ($storageType -eq 'HDD') { $AnalysisParallel = [Math]::Min(8, [Math]::Max(4, $logicalCpu)) } elseif ($storageType -eq 'SSD') { $AnalysisParallel = [Math]::Min(48, [Math]::Max(24, $logicalCpu * 3)) } else { $AnalysisParallel = [Math]::Min(24, [Math]::Max(8, $logicalCpu * 2)) }

Write-Host "Files found:         $($allFiles.Count)"
Write-Host "Storage type:        $storageType"
Write-Host "Analysis workers:    $AnalysisParallel"

$scanInputs = for ($i = 0; $i -lt $allFiles.Count; $i++) {
    $f = $allFiles[$i]
    [pscustomobject]@{
        Index      = $i
        FullName   = $f.FullName
        Extension  = $f.Extension.ToLowerInvariant()
        Length     = [Int64]$f.Length
    }
}

# Analyze independent files in parallel. Common image formats use System.Drawing
# for dimensions first, avoiding a separate ImageMagick process for most photos.
$analysisJob = $scanInputs | ForEach-Object -Parallel {
    $item = $_
    $ext = $item.Extension
    $fullName = $item.FullName
    $sourceBytes = [Int64]$item.Length

    $rawExtensions = $using:RawExtensions
    $photoExtensions = $using:PhotoExtensions
    $videoExtensions = $using:VideoExtensions
    $magick = $using:Magick
    $ffprobe = $using:FFprobe
    $outputCodecClass = $using:OutputCodecClass

    $threshold1080 = [Int64]$using:Threshold1080
    $target1080 = [Int64]$using:Target1080
    $threshold720 = [Int64]$using:Threshold720
    $target720 = [Int64]$using:Target720
    $thresholdSD = [Int64]$using:ThresholdSD
    $targetSD = [Int64]$using:TargetSD
    $highFpsMultiplier = [double]$using:HighFpsMultiplier

    $kind = "Passthrough"
    $action = "Copy"
    $details = ""
    $targetBitrate = 0L
    $needsResize = $false
    $videoCodec = ""
    $videoBitrate = 0L
    $fps = 0.0
    $width = 0
    $height = 0
    $allAudioAAC = $true

    if ($rawExtensions -contains $ext) {
        $kind = "RAW"
        $action = "Copy"
        $details = "RAW copied unchanged"
    }
    elseif ($photoExtensions -contains $ext) {
        $kind = "Photo"
        $gotDimensions = $false
        $pngHasTransparency = $false
        $pngAlphaCheckCompleted = ($ext -ne ".png")

        # JPEG dimensions are read directly from the header. This avoids decoding
        # every JPEG during scanning and prevents libjpeg warnings from leaking into
        # the console for old/truncated-but-viewable images.
        if ($ext -in @(".jpg", ".jpeg")) {
            try {
                $fs = [IO.File]::Open(
                    $fullName,
                    [IO.FileMode]::Open,
                    [IO.FileAccess]::Read,
                    [IO.FileShare]::ReadWrite
                )
                try {
                    if ($fs.ReadByte() -eq 0xFF -and $fs.ReadByte() -eq 0xD8) {
                        $sofMarkers = @(
                            0xC0, 0xC1, 0xC2, 0xC3,
                            0xC5, 0xC6, 0xC7,
                            0xC9, 0xCA, 0xCB,
                            0xCD, 0xCE, 0xCF
                        )

                        while ($fs.Position -lt $fs.Length) {
                            $prefix = $fs.ReadByte()
                            if ($prefix -lt 0) { break }
                            if ($prefix -ne 0xFF) { continue }

                            do {
                                $marker = $fs.ReadByte()
                            } while ($marker -eq 0xFF)

                            if ($marker -lt 0) { break }

                            # Standalone markers have no payload length.
                            if (
                                $marker -eq 0xD8 -or
                                $marker -eq 0xD9 -or
                                $marker -eq 0x01 -or
                                ($marker -ge 0xD0 -and $marker -le 0xD7)
                            ) {
                                continue
                            }

                            $lenHi = $fs.ReadByte()
                            $lenLo = $fs.ReadByte()
                            if ($lenHi -lt 0 -or $lenLo -lt 0) { break }

                            $segmentLength = ($lenHi -shl 8) -bor $lenLo
                            if ($segmentLength -lt 2) { break }

                            if ($sofMarkers -contains $marker) {
                                $precision = $fs.ReadByte()
                                $hHi = $fs.ReadByte()
                                $hLo = $fs.ReadByte()
                                $wHi = $fs.ReadByte()
                                $wLo = $fs.ReadByte()
                                if (@($precision, $hHi, $hLo, $wHi, $wLo) -contains -1) { break }

                                $height = [int](($hHi -shl 8) -bor $hLo)
                                $width  = [int](($wHi -shl 8) -bor $wLo)
                                $gotDimensions = ($width -gt 0 -and $height -gt 0)
                                break
                            }

                            $skip = $segmentLength - 2
                            if ($skip -gt 0) {
                                [void]$fs.Seek($skip, [IO.SeekOrigin]::Current)
                            }
                        }
                    }
                }
                finally {
                    $fs.Dispose()
                }
            }
            catch {
                $gotDimensions = $false
            }
        }
        # Keep System.Drawing as a fast path for the other common raster formats.
        # For PNG, also detect actual transparency using the same rule as the
        # supplied PNG converter: preserve the PNG if any used pixel has alpha < 250.
        elseif ($ext -in @(".png", ".bmp", ".tif", ".tiff")) {
            try {
                Add-Type -AssemblyName System.Drawing -ErrorAction Stop
                $img = [System.Drawing.Image]::FromFile($fullName)
                try {
                    $width = [int]$img.Width
                    $height = [int]$img.Height
                    $gotDimensions = ($width -gt 0 -and $height -gt 0)

                    if ($ext -eq ".png") {
                        $alphaThreshold = 250
                        $pixelFormat = $img.PixelFormat
                        $hasAlphaChannel = (
                            (($pixelFormat -band [System.Drawing.Imaging.PixelFormat]::Alpha) -ne 0) -or
                            (($pixelFormat -band [System.Drawing.Imaging.PixelFormat]::PAlpha) -ne 0)
                        )

                        # Indexed PNG transparency is stored in the palette. As in
                        # the supplied script, a transparent palette entry only means
                        # we need to inspect pixels; unused transparent entries do not
                        # by themselves make the image transparent.
                        if (-not $hasAlphaChannel -and (($pixelFormat -band [System.Drawing.Imaging.PixelFormat]::Indexed) -ne 0)) {
                            foreach ($entry in ($img.Palette.Entries) {
                                if ($entry.A -lt 255) {
                                    $hasAlphaChannel = $true
                                    break
                                }
                            }
                        }

                        if ($hasAlphaChannel -and $gotDimensions) {
                            $scanBitmap = [System.Drawing.Bitmap]::new(
                                $width,
                                $height,
                                [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
                            )
                            try {
                                $graphics = [System.Drawing.Graphics]::FromImage($scanBitmap)
                                try {
                                    $graphics.DrawImageUnscaled($img, 0, 0)
                                }
                                finally {
                                    $graphics.Dispose()
                                }

                                $rect = [System.Drawing.Rectangle]::new(0, 0, $width, $height)
                                $bitmapData = $scanBitmap.LockBits(
                                    $rect,
                                    [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                                    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
                                )
                                try {
                                    $stride = [Math]::Abs($bitmapData.Stride)
                                    $buffer = [byte[]]::new($stride * $height)
                                    [Runtime.InteropServices.Marshal]::Copy(
                                        $bitmapData.Scan0,
                                        $buffer,
                                        0,
                                        $buffer.Length
                                    )

                                    :alphaRows for ($y = 0; $y -lt $height; $y++) {
                                        $row = $y * $stride
                                        for ($x = 0; $x -lt $width; $x++) {
                                            # Format32bppArgb is BGRA h (memory.
                                            if ($buffer[$row + ($x * 4) + 3] -lt $alphaThreshold) {
                                                $pngHasTransparency = $true
                                                break alphaRows
                                            }
                                        }
                                    }
                                }
                                finally {
                                    $scanBitmap.UnlockBits($bitmapData)
                                }
                            }
                            finally {
                                $scanBitmap.Dispose()
                            }
                        }

                        $pngAlphaCheckCompleted = $true
                    }
                }
                finally {
                    $img.Dispose()
                }
            }
            catch {
                $gotDimensions = $false
                if ($ext -eq ".png") { $pngAlphaCheckCompleted = $false }
            }
        }

        if (-not $gotDimensions) {
            $photoInfo = & $magick $fullName -auto-orient -format "%w|%h" "info:" 2>$null
            if ($LASTEXITCODE -eq 0 -and $photoInfo) {
                $parts = (($photoInfo | Select-Object -First 1).ToString().Trim()) -split "\|"
                if ($parts.Count -ge 2) {
                    $width = [int]$parts[0]
                    $height = [int]$parts[1]
                    $gotDimensions = ($width -gt 0 -and $height -gt 0)
                }
            }
        }

        # Exact fallback for a PNG System.Drawing could not inspect. ImageMagick
        # returns the minimum normalized alpha value; match the supplied script's
        # rule exactly: preserve only when a used pixel has alpha < 250/255.
        if ($ext -eq ".png" -and -not $pngAlphaCheckCompleted -and $gotDimensions) {
            $alphaInfo = & $magick $fullName -format "%[fx:minima.a]" "info:" 2>$null
            if ($LASTEXITCODE -eq 0 -and $alphaInfo) {
                $alphaText = (($alphaInfo | Select-Object -First 1).ToString().Trim())
                $minAlpha = 1.0
                if ([double]::TryParse(
                    $alphaText,
                    [Globalization.NumberStyles]::Float,
                    [Globalization.CultureInfo]::InvariantCulture,
                    [ref]$minAlpha
                )) {
                    if ($minAlpha -lt (250.0 / 255.0)) {
                        $pngHasTransparency = $true
                    }
                    $pngAlphaCheckCompleted = $true
                }
            }
        }

        if (-not $gotDimensions) {
            $kind = "Passthrough"
            $action = "Copy"
            $details = "ImageMagick could not identify image; copied unchanged"
        }
        elseif ($ext -eq ".png" -and $pngHasTransparency) {
            $kind = "PNGAlpha"
            $action = "PreservePNG"
            $details = "PNG contains actual transparency; preserved byte-for-byte"
        }
        else {
            $longSide = [Math]::Max($width, $height)
            $shortSide = [Math]::Min($width, $height)
            $photoTooLarge = ($longSide -gt 4096 -or $shortSide -gt 2160)

            if (($ext -eq ".jpg" -or $ext -eq ".jpeg") -and -not $photoTooLarge) {
                $action = "CopyPhoto"
                $details = "JPEG already within 4K limit; byte-for-byte copy"
            }
            else {
                $action = "ConvertPhoto"
                $details = if ($photoTooLarge) {
                    "Convert to JPG + resize to 4096x2160-equivalent"
                } else {
                    "Convert to JPG"
                }
            }
        }
    }
    elseif ($videoExtensions -contains $ext) {
        $probeJson = & $ffprobe -v error -show_streams -show_format -of json -- $fullName 2>$null
        if ($LASTEXITCODE -eq 0 -and $probeJson) {
            try {
                $probe = ($probeJson -join "`n") | ConvertFrom-Json
                $video = @($probe.streams | Where-Object codec_type -eq "video") | Select-Object -First 1

                if ($video) {
                    $kind = "Video"
                    $width = [int]$video.width
                    $height = [int]$video.height
                    $videoCodec = [string]$video.codec_name

                    $rate = [string]$video.avg_frame_rate
                    if (-not [string]::IsNullOrWhiteSpace($rate) -and $rate -ne "0/0") {
                        if ($rate -match "^(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)$") {
                            $n = [double]$Matches[1]
                            $d = [double]$Matches[2]
                            if ($d -ne 0) { $fps = $n / $d }
                        }
                        else {
                            $tmpFps = 0.0
                            if ([double]::TryParse($rate, [ref]$tmpFps)) { $fps = $tmpFps }
                        }
                    }

                    if ($video.bit_rate) {
                        $videoBitrate = [Int64]$video.bit_rate
                    }
                    elseif ($probe.format.bit_rate) {
                        $videoBitrate = [Int64]$probe.format.bit_rate
                    }
                    elseif ($probe.format.duration -and [double]$probe.format.duration -gt 0) {
                        $videoBitrate = [Int64](($sourceBytes * 8.0) / [double]$probe.format.duration)
                    }

                    $audioStreams = @($probe.streams | Where-Object codec_type -eq "audio")
                    if ($audioStreams.Count -gt 0) {
                        $allAudioAAC = (@($audioStreams | Where-Object codec_name -ne "aac").Count -eq 0)
                    }

                    $longSide = [Math]::Max($width, $height)
                    $shortSide = [Math]::Min($width, $height)
                    $pixels = [Int64]$width * [Int64]$height
                    $needsResize = ($longSide -gt 1920 -or $shortSide -gt 1080)

                    if ($pixels -ge 1400000 -or $longSide -ge 1600) {
                        $threshold = [double]$threshold1080
                        $target = [double]$target1080
                    }
                    elseif ($pixels -ge 600000 -or $longSide -ge 1100) {
                        $threshold = [double]$threshold720
                        $target = [double]$target720
                    }
                    else {
                        $threshold = [double]$thresholdSD
                        $target = [double]$targetSD
                    }

                    if ($fps -gt 45) {
                        $threshold *= $highFpsMultiplier
                        $target *= $highFpsMultiplier
                    }

                    $codecLower = $videoCodec.ToLowerInvariant()
                    if ($codecLower -in @("av1", "hevc", "h265")) {
                        $threshold *= 1.05
                    }

                    $targetBitrate = [Int64][Math]::Round($target)
                    if ($outputCodecClass -eq "H264") {
                        $targetBitrate = [Int64][Math]::Round($targetBitrate * 1.40)
                    }
                    elseif ($outputCodecClass -eq "HEVC") {
                        $targetBitrate = [Int64][Math]::Round($targetBitrate * 1.10)
                    }

                    $thresholdInt = [Int64][Math]::Round($threshold)
                    $isMp4 = ($ext -eq ".mp4")

                    if ($needsResize) {
                        $action = "EncodeVideo"
                        $details = "Above 1080p -> resize + encode"
                    }
                    elseif ($videoBitrate -gt 0 -and $videoBitrate -le $thresholdInt) {
                        if ($isMp4) {
                            $action = "CopyVideo"
                            $details = "Already below bitrate threshold -> byte-for-byte copy"
                        }
                        else {
                            $action = "RemuxVideo"
                            $details = "Already below bitrate threshold -> remux to MP4"
                        }
                    }
                    else {
                        $action = "EncodeVideo"
                        if ($videoBitrate -gt 0) {
                            $details = "Bitrate $([Math]::Round($videoBitrate / 1000000.0, 2)) Mb/s > threshold $([Math]::Round($thresholdInt / 1000000.0, 2)) Mb/s"
                        }
                        else {
                            $details = "Unknown bitrate -> encode conservatively"
                        }
                    }
                }
            }
            catch {
                # Unreadable/invalid video container: passthrough copy.
            }
        }
    }

    [pscustomobject]@{
        Index          = [int]$item.Index
        Kind           = $kind
        Action         = $action
        Details        = $details
        Width          = $width
        Height         = $height
        Fps            = $fps
        Codec          = $videoCodec
        VideoBitrate   = $videoBitrate
        TargetBitrate  = $targetBitrate
        NeedsResize    = $needsResize
        AllAudioAAC    = $allAudioAAC
    }
} -ThrottleLimit $AnalysisParallel -AsJob

try {
    while ($analysisJob.State -notin @("Completed", "Failed", "Stopped")) {
        $children = $analysisJob.ChildJobs
        if ($children.Count -gt 0) {
            $done = 0; foreach ($child in $children) { if ($child.State -in @('Completed', 'Failed', 'Stopped')) { $done++ } }
            $percent = [Math]::Min(100, ($done / $children.Count) * 100)
            Write-Progress -Activity "Analyzing media in parallel" -Status "$done / $($children.Count)" -PercentComplete $percent
        }
        Start-Sleep -Milliseconds 1000
    }

    $analysisResults = @(Receive-Job -Job $analysisJob -Wait)
    if ($analysisJob.State -eq "Failed") {
        throw "Parallel media analysis failed."
    }
}
finally {
    Write-Progress -Activity "Analyzing media in parallel" -Completed
    Remove-Job -Job $analysisJob -Force -ErrorAction SilentlyContinue
}

if ($analysisResults.Count -ne $allFiles.Count) {
    throw "Media analysis returned $($analysisResults.Count) results for $($allFiles.Count) files."
}

$tasks = [System.Collections.Generic.List[object]]::new()
$destinations = [System.Collections.Generic.Dictionary[string,string]]::new(
    [StringComparer]::OrdinalIgnoreCase
)
$renamedCollisions = [System.Collections.Generic.List[string]]::new()

foreach ($analysis in ($analysisResults | Sort-Object Index)) {
    $file = $allFiles[[int]$analysis.Index]
    $kind = [string]$analysis.Kind

    $dest = Get-OutputPath $InputRoot $OutputRoot $file $kind
    $destKey = [IO.Path]::GetFullPath($dest)

    if ($destinations.ContainsKey($destKey)) {
        $originalDestKey = $destKey
        $destDir = [IO.Path]::GetDirectoryName($destKey)
        $destExt = [IO.Path]::GetExtension($destKey)
        $destBase = [IO.Path]::GetFileNameWithoutExtension($destKey)
        $sourceTag = $file.Extension.TrimStart([char]'.').ToLowerInvariant()
        if ([string]::IsNullOrWhiteSpace($sourceTag)) { $sourceTag = "file" }

        $suffixNumber = 1
        do {
            $tag = if ($suffixNumber -eq 1) { $sourceTag } else { "$sourceTag-$suffixNumber" }
            $candidate = Join-Path $destDir ("$destBase [$tag]$destExt")
            $destKey = [IO.Path]::GetFullPath($candidate)
            $suffixNumber++
        } while ($destinations.ContainsKey($destKey))

        $renamedCollisions.Add(
            "OUTPUT NAME COLLISION RESOLVED:`n  $($destinations[$originalDestKey])`n  $($file.FullName)`n  -> $destKey"
        )
    }
    $destinations[$destKey] = $file.FullName

    $taskAction = [string]$analysis.Action
    $taskDetails = [string]$analysis.Details

    # In Replace mode, files that already meet the rules should remain completely
    # untouched. Calling these COPY operations is misleading and also causes
    # unnecessary disk I/O, so report and process them as SKIP instead.
    if ($OperationMode -eq "Replace" -and $taskAction -in @("Copy", "CopyPhoto", "CopyVideo", "PreservePNG")) {
        $taskAction = "Skip"
        if ([string]::IsNullOrWhiteSpace($taskDetails)) {
            $taskDetails = "Already compliant -> skipped"
        }
        else {
            $taskDetails += " -> skipped in Replace mode"
        }
    }

    $tasks.Add([pscustomobject]@{
        Source         = $file.FullName
        Destination    = $destKey
        Kind           = $kind
        Action         = $taskAction
        Details        = $taskDetails
        SourceBytes    = [Int64]$file.Length
        CreationTime   = $file.CreationTime
        LastWriteTime  = $file.LastWriteTime
        Width          = [int]$analysis.Width
        Height         = [int]$analysis.Height
        Fps            = [double]$analysis.Fps
        Codec          = [string]$analysis.Codec
        VideoBitrate   = [Int64]$analysis.VideoBitrate
        TargetBitrate  = [Int64]$analysis.TargetBitrate
        NeedsResize    = [bool]$analysis.NeedsResize
        AllAudioAAC    = [bool]$analysis.AllAudioAAC
    })
}

if ($renamedCollisions.Count -gt 0) {
    Write-Host ""
    Write-Host "Output filename collisions were resolved automatically." -ForegroundColor Yellow
    Write-Host "The first standardized file keeps the clean name; additional files get their source extension in brackets." -ForegroundColor DarkGray
    foreach ($c in $renamedCollisions) {
        Write-Host ""
        Write-Host $c -ForegroundColor Yellow
    }
}

$beforeBytes = [Int64](($tasks | Measure-Object SourceBytes -Sum).Sum)
Write-Host "Files to handle: $($tasks.Count)"
Write-Host "Input size:      $(Format-Bytes $beforeBytes)"

# ---- Parallel processing ----
Write-Section "Processing"

$completedResults = [System.Collections.Concurrent.ConcurrentBag[object]]::new()
$terminated = $false
$processingException = $null

try {
    $null = $tasks | ForEach-Object -Parallel {
        $t = $_
        $ffmpeg = $using:FFmpeg
        $magick = $using:Magick
        $encoder = $using:SelectedEncoder
        $codecClass = $using:OutputCodecClass
        $jpegQuality = $using:JpegQuality
        $resultBag = $using:completedResults

        function Format-BytesLocal([Int64]$Bytes) {
            if ($Bytes -ge 1TB) { return "{0:N2} TiB" -f ($Bytes / 1TB) }
            if ($Bytes -ge 1GB) { return "{0:N2} GiB" -f ($Bytes / 1GB) }
            if ($Bytes -ge 1MB) { return "{0:N2} MiB" -f ($Bytes / 1MB) }
            if ($Bytes -ge 1KB) { return "{0:N2} KiB" -f ($Bytes / 1KB) }
            return "$Bytes B"
        }

        function Get-ActionLabel([string]$Action) {
            switch ($Action) {
                "Copy"          { return "COPY" }
                "CopyPhoto"     { return "PHOTO COPY" }
                "PreservePNG"   { return "PNG ALPHA" }
                "ConvertPhoto"  { return "PHOTO" }
                "CopyVideo"     { return "VIDEO COPY" }
                "RemuxVideo"    { return "REMUX" }
                "EncodeVideo"   { return "ENCODE" }
                "Skip"          { return "SKIP" }
                default         { return $Action.ToUpperInvariant() }
            }
        }

        function Write-FileResultLine([string]$Path, [string]$Action, [Int64]$Before, [Int64]$After) {
            [Int64]$delta = $Before - $After
            $label = Get-ActionLabel $Action
            if ($delta -gt 0) {
                Write-Host ("[{0}] {1} [{2}] -> [{3}] {4} saved" -f $label, $Path, (Format-BytesLocal $Before), (Format-BytesLocal $After), (Format-BytesLocal $delta)) -ForegroundColor Green
            }
            elseif ($delta -lt 0) {
                Write-Host ("[{0}] {1} [{2}] -> [{3}] +{4}" -f $label, $Path, (Format-BytesLocal $Before), (Format-BytesLocal $After), (Format-BytesLocal (-$delta))) -ForegroundColor Yellow
            }
            else {
                Write-Host ("[{0}] {1} [{2}] -> [{3}] 0 B saved" -f $label, $Path, (Format-BytesLocal $Before), (Format-BytesLocal $After))
            }
        }

        # Replace mode: already-compliant files are genuine no-op skips.
        # Do not create a temporary file or rewrite the original.
        if ($t.Action -eq "Skip") {
            $result = [pscustomobject]@{
                Success     = $true
                Source      = $t.Source
                Destination = $t.Source
                Action      = "Skip"
                BeforeBytes = [Int64]$t.SourceBytes
                AfterBytes  = [Int64]$t.SourceBytes
                Error       = ""
            }
            $resultBag.Add($result)
            Write-FileResultLine $t.Source "Skip" ([Int64]$t.SourceBytes) ([Int64]$t.SourceBytes)
            return $result
        }

        $destDir = [IO.Path]::GetDirectoryName($t.Destination)
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null

        $ext = [IO.Path]::GetExtension($t.Destination)
        $stem = [IO.Path]::GetFileNameWithoutExtension($t.Destination)
        $temp = Join-Path $destDir ($stem + ".__working" + $ext)

        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue

        function Set-OutputTimes([string]$Path, [datetime]$Created, [datetime]$Modified) {
            try {
                [IO.File]::SetCreationTime($Path, $Created)
                [IO.File]::SetLastWriteTime($Path, $Modified)
            } catch {}
        }

        function Get-EncoderArgs([string]$Encoder, [Int64]$Target) {
            $maxRate = [Int64][Math]::Round($Target * 1.40)
            $bufSize = [Int64][Math]::Round($Target * 5.60)

            $a = [System.Collections.Generic.List[string]]::new()
            $a.Add("-c:v"); $a.Add($Encoder)

            # NVIDIA AV1/HEVC use the same high-quality path that was verified
            # separately on RTX 50-series hardware.
            if ($Encoder -eq "av1_nvenc") {
                $a.Add("-preset"); $a.Add("p7")
                $a.Add("-tune"); $a.Add("uhq")
                $a.Add("-rc"); $a.Add("vbr")
                $a.Add("-multipass"); $a.Add("fullres")
                $a.Add("-spatial-aq"); $a.Add("1")
                $a.Add("-aq-strength"); $a.Add("8")
                $a.Add("-pix_fmt"); $a.Add("p010le")
            }
            elseif ($Encoder -eq "hevc_nvenc") {
                $a.Add("-preset"); $a.Add("p7")
                $a.Add("-tune"); $a.Add("uhq")
                $a.Add("-rc"); $a.Add("vbr")
                $a.Add("-multipass"); $a.Add("fullres")
                $a.Add("-spatial-aq"); $a.Add("1")
                $a.Add("-aq-strength"); $a.Add("8")
                $a.Add("-pix_fmt"); $a.Add("p010le")
            }
            elseif ($Encoder -eq "h264_nvenc") {
                $a.Add("-preset"); $a.Add("p7")
                $a.Add("-tune"); $a.Add("hq")
                $a.Add("-rc"); $a.Add("vbr")
                $a.Add("-multipass"); $a.Add("fullres")
                $a.Add("-spatial-aq"); $a.Add("1")
                $a.Add("-aq-strength"); $a.Add("8")
                $a.Add("-pix_fmt"); $a.Add("yuv420p")
            }
            elseif ($Encoder -match "_qsv$") {
                $a.Add("-preset"); $a.Add("slow")
                $a.Add("-pix_fmt"); $a.Add("nv12")
            }
            elseif ($Encoder -match "_amf$") {
                $a.Add("-quality"); $a.Add("quality")
                $a.Add("-pix_fmt"); $a.Add("nv12")
            }
            elseif ($Encoder -eq "libx265") {
                $a.Add("-preset"); $a.Add("medium")
                $a.Add("-pix_fmt"); $a.Add("yuv420p10le")
            }
            else {
                $a.Add("-pix_fmt"); $a.Add("yuv420p")
            }

            $a.Add("-b:v"); $a.Add([string]$Target)
            $a.Add("-maxrate"); $a.Add([string]$maxRate)
            $a.Add("-bufsize"); $a.Add([string]$bufSize)
            return $a.ToArray()
        }

        function Invoke-Ffmpeg([Parameter(Mandatory=$true)][string[]]$ArgumentList) {
            $displayArgs = foreach ($arg in $ArgumentList) {
                if ($arg -match '[\s"]') {
                    '"' + ($arg -replace '"', '\"') + '"'
                }
                else {
                    $arg
                }
            }
            $displayCommand = '"' + $ffmpeg + '" ' + ($displayArgs -join ' ')

            # Do not allow the script-wide Stop preference to hide FFmpeg's own
            # diagnostic output on a non-zero native-process exit.
            $oldPreference = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            try {
                $msg = & $ffmpeg @ArgumentList 2>&1
                $code = $LASTEXITCODE
            }
            catch {
                $code = if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }
                $msg = @($_.Exception.Message)
            }
            finally {
                $ErrorActionPreference = $oldPreference
            }

            return [pscustomobject]@{
                ExitCode = $code
                Message  = (($msg | Select-Object -Last 80) -join "`n")
                Command  = $displayCommand
            }
        }

        try {
            switch ($t.Action) {
                "Copy" {
                    Copy-Item -LiteralPath $t.Source -Destination $temp -Force
                }

                "CopyPhoto" {
                    Copy-Item -LiteralPath $t.Source -Destination $temp -Force
                }

                "PreservePNG" {
                    Copy-Item -LiteralPath $t.Source -Destination $temp -Force
                }

                "ConvertPhoto" {

                    # Auto-orient first. Landscape fits 4096x2160; portrait fits 2160x4096.
                    $box = if ($t.Width -ge $t.Height) { "4096x2160>" } else { "2160x4096>" }

                    $imMsg = & $magick $t.Source `
                        -auto-orient `
                        -filter Lanczos `
                        -resize $box `
                        -background white `
                        -alpha remove `
                        -alpha off `
                        -sampling-factor "4:4:4" `
                        -quality ([string]$jpegQuality) `
                        $temp 2>&1

                    if ($LASTEXITCODE -ne 0) {
                        # FFmpeg fallback for formats unsupported by this ImageMagick build.
                        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
                        $photoFilter = "scale='if(gte(iw,ih),min(iw,4096),min(iw,2160))':'if(gte(iw,ih),min(ih,2160),min(ih,4096))':force_original_aspect_ratio=decrease:force_divisible_by=2"
                        $r = Invoke-Ffmpeg -ArgumentList @(
                            "-y", "-hide_banner", "-loglevel", "error",
                            "-i", $t.Source,
                            "-frames:v", "1",
                            "-vf", $photoFilter,
                            "-q:v", "2",
                            $temp
                        )
                        if ($r.ExitCode -ne 0) {
                            throw "Photo conversion failed.`nImageMagick: $($imMsg -join "`n")`nFFmpeg: $($r.Message)"
                        }
                    }
                }

                "CopyVideo" {
                    Copy-Item -LiteralPath $t.Source -Destination $temp -Force
                }

                "RemuxVideo" {

                    $r = Invoke-Ffmpeg -ArgumentList @(
                        "-y", "-hide_banner", "-loglevel", "error",
                        "-noautorotate",
                        "-i", $t.Source,
                        "-map", "0:v:0",
                        "-map", "0:a?",
                        "-map_metadata", "0",
                        "-map_chapters", "0",
                        "-c", "copy",
                        "-movflags", "+faststart",
                        $temp
                    )

                    if ($r.ExitCode -ne 0) {
                        # Keep video lossless; only normalize incompatible audio.
                        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
                        $r = Invoke-Ffmpeg -ArgumentList @(
                            "-y", "-hide_banner", "-loglevel", "error",
                            "-noautorotate",
                            "-i", $t.Source,
                            "-map", "0:v:0",
                            "-map", "0:a?",
                            "-map_metadata", "0",
                            "-map_chapters", "0",
                            "-c:v", "copy",
                            "-c:a", "aac",
                            "-b:a", "128k",
                            "-movflags", "+faststart",
                            $temp
                        )
                    }

                    if ($r.ExitCode -ne 0) {
                        # Last fallback: full transcode if the video codec itself cannot be muxed into MP4.
                        Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
                        $encArgs = Get-EncoderArgs $encoder $t.TargetBitrate
                        $ffArgs = [System.Collections.Generic.List[string]]::new()
                        @("-y", "-hide_banner", "-loglevel", "error", "-noautorotate",
                          "-i", $t.Source, "-map", "0:v:0", "-map", "0:a?",
                          "-map_metadata", "0", "-map_chapters", "0") |
                            ForEach-Object { $ffArgs.Add($_) }
                        $encArgs | ForEach-Object { $ffArgs.Add($_) }
                        $ffArgs.Add("-fps_mode"); $ffArgs.Add("passthrough")
                        $ffArgs.Add("-c:a"); $ffArgs.Add("aac")
                        $ffArgs.Add("-b:a"); $ffArgs.Add("128k")
                        $ffArgs.Add("-movflags"); $ffArgs.Add("+faststart")
                        $ffArgs.Add($temp)

                        $r = Invoke-Ffmpeg -ArgumentList ($ffArgs.ToArray())
                    }

                    if ($r.ExitCode -ne 0) {
                        throw "Remux/transcode failed.`nCOMMAND:`n$($r.Command)`n`nFFMPEG OUTPUT:`n$($r.Message)"
                    }
                }

                "EncodeVideo" {

                    $encArgs = Get-EncoderArgs $encoder $t.TargetBitrate
                    $ffArgs = [System.Collections.Generic.List[string]]::new()

                    @(
                        "-y", "-hide_banner", "-loglevel", "error",
                        "-noautorotate",
                        "-i", $t.Source,
                        "-map", "0:v:0",
                        "-map", "0:a?",
                        "-map_metadata", "0",
                        "-map_chapters", "0"
                    ) | ForEach-Object { $ffArgs.Add($_) }

                    if ($t.NeedsResize) {
                        $videoFilter = "scale='if(gte(iw,ih),min(iw,1920),min(iw,1080))':'if(gte(iw,ih),min(ih,1080),min(ih,1920))':force_original_aspect_ratio=decrease:force_divisible_by=2"
                        $ffArgs.Add("-vf"); $ffArgs.Add($videoFilter)
                    }

                    $encArgs | ForEach-Object { $ffArgs.Add($_) }

                    $ffArgs.Add("-fps_mode"); $ffArgs.Add("passthrough")

                    if ($t.AllAudioAAC) {
                        $ffArgs.Add("-c:a"); $ffArgs.Add("copy")
                    }
                    else {
                        $ffArgs.Add("-c:a"); $ffArgs.Add("aac")
                        $ffArgs.Add("-b:a"); $ffArgs.Add("128k")
                    }

                    $ffArgs.Add("-movflags"); $ffArgs.Add("+faststart")
                    $ffArgs.Add($temp)

                    $r = Invoke-Ffmpeg -ArgumentList ($ffArgs.ToArray())
                    if ($r.ExitCode -ne 0) {
                        throw "Video encode failed.`nCOMMAND:`n$($r.Command)`n`nFFMPEG OUTPUT:`n$($r.Message)"
                    }
                }

                default {
                    throw "Unknown task action: $($t.Action)"
                }
            }

            if (-not (Test-Path -LiteralPath $temp -PathType Leaf)) {
                throw "Expected output file was not created."
            }

            $sourceFull = [IO.Path]::GetFullPath($t.Source)
            $destinationFull = [IO.Path]::GetFullPath($t.Destination)
            $samePath = [string]::Equals(
                $sourceFull,
                $destinationFull,
                [StringComparison]::OrdinalIgnoreCase
            )

            Move-Item -LiteralPath $temp -Destination $t.Destination -Force
            Set-OutputTimes $t.Destination $t.CreationTime $t.LastWriteTime

            # Copy files mode behaves like the original ArchiveMedia workflow:
            # write the processed result to the destination and keep the source untouched.
            # Replace mode removes a differently-named original only after the new output
            # has been committed successfully. If source and destination are the same path,
            # Move-Item above has already replaced the original.
            if ($using:OperationMode -eq "Replace" -and -not $samePath -and (Test-Path -LiteralPath $t.Source -PathType Leaf)) {
                Remove-Item -LiteralPath $t.Source -Force
            }

            $outFile = Get-Item -LiteralPath $t.Destination -Force
            $result = [pscustomobject]@{
                Success     = $true
                Source      = $t.Source
                Destination = $t.Destination
                Action      = $t.Action
                BeforeBytes = [Int64]$t.SourceBytes
                AfterBytes  = [Int64]$outFile.Length
                Error       = ""
            }
            $resultBag.Add($result)
            Write-FileResultLine $t.Source $t.Action ([Int64]$t.SourceBytes) ([Int64]$outFile.Length)
            $result
        }
        catch {
            Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
            $result = [pscustomobject]@{
                Success     = $false
                Source      = $t.Source
                Destination = $t.Destination
                Action      = $t.Action
                BeforeBytes = [Int64]$t.SourceBytes
                AfterBytes  = 0L
                Error       = $_.Exception.Message
            }
            $resultBag.Add($result)
            Write-Host ("[FAILED] {0} [{1}]" -f $t.Source, (Format-BytesLocal ([Int64]$t.SourceBytes))) -ForegroundColor Red
            $result
        }
    } -ThrottleLimit $MaxParallel
}
catch [System.Management.Automation.PipelineStoppedException] {
    $terminated = $true
}
catch [System.OperationCanceledException] {
    $terminated = $true
}
catch {
    $terminated = $true
    $processingException = $_.Exception.Message
}
finally {
    $results = @($completedResults.ToArray())
}

if ($results.Count -lt $tasks.Count) {
    $terminated = $true
}

# ---- Summary ----
Write-Section $(if ($terminated) { "Finished - TERMINATED" } else { "Finished" })

$runTimer.Stop()

$successes = @($results | Where-Object { $_.Success -eq $true })
$failures = @($results | Where-Object { $_.Success -ne $true })

$completedSources = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($r in $results) { [void]$completedSources.Add([string]$r.Source) }
$pendingTasks = @($tasks | Where-Object { -not $completedSources.Contains([string]$_.Source) })
[Int64]$pendingSourceBytes = 0
foreach ($t in $pendingTasks) { $pendingSourceBytes += [Int64]$t.SourceBytes }

[Int64]$successfulAfterBytes = 0
[Int64]$successfulBeforeBytes = 0
[Int64]$failedSourceBytes = 0

foreach ($r in $successes) {
    $successfulAfterBytes += [Int64]$r.AfterBytes
    $successfulBeforeBytes += [Int64]$r.BeforeBytes
}
foreach ($r in $failures) {
    # Failed files are deliberately left at their original source paths.
    $failedSourceBytes += [Int64]$r.BeforeBytes
}

Write-Host ("Before: {0}  ({1} files)" -f (Format-Bytes $beforeBytes), $tasks.Count)
Write-Host ("Processed: {0} / {1}" -f $results.Count, $tasks.Count)
if ($pendingTasks.Count -gt 0) {
    Write-Host ("Unprocessed: {0}  ({1})" -f $pendingTasks.Count, (Format-Bytes $pendingSourceBytes)) -ForegroundColor Yellow
}
if ($processingException) {
    Write-Host ("Processing stopped: {0}" -f $processingException) -ForegroundColor Yellow
}

if ($OperationMode -eq "Replace") {
    # This is the actual footprint after the run: completed replacements plus
    # originals that were left untouched because their processing failed.
    [Int64]$effectiveAfterBytes = $successfulAfterBytes + $failedSourceBytes + $pendingSourceBytes
    Write-Host ("After:  {0}  ({1} files)" -f (Format-Bytes $effectiveAfterBytes), $tasks.Count)

    [Int64]$savedBytes = $beforeBytes - $effectiveAfterBytes
    [double]$savedPct = if ($beforeBytes -gt 0) {
        ($savedBytes / [double]$beforeBytes) * 100.0
    } else {
        0.0
    }

    if ($savedBytes -ge 0) {
        Write-Host ("Saved:  {0}  ({1:N1}%)" -f (Format-Bytes $savedBytes), $savedPct) -ForegroundColor Green
    }
    else {
        Write-Host ("Change: +{0}  ({1:N1}% larger)" -f (Format-Bytes (-$savedBytes)), (-$savedPct)) -ForegroundColor Yellow
    }
}
else {
    Write-Host ("Output completed: {0}  ({1} files)" -f (Format-Bytes $successfulAfterBytes), $successes.Count)

    if ($failures.Count -eq 0 -and $pendingTasks.Count -eq 0) {
        [Int64]$savedBytes = $beforeBytes - $successfulAfterBytes
        [double]$savedPct = if ($beforeBytes -gt 0) {
            ($savedBytes / [double]$beforeBytes) * 100.0
        } else {
            0.0
        }

        if ($savedBytes -ge 0) {
            Write-Host ("Saved vs source: {0}  ({1:N1}%)" -f (Format-Bytes $savedBytes), $savedPct) -ForegroundColor Green
        }
        else {
            Write-Host ("Change vs source: +{0}  ({1:N1}% larger)" -f (Format-Bytes (-$savedBytes)), (-$savedPct)) -ForegroundColor Yellow
        }
    }
    elseif ($successes.Count -gt 0) {
        [Int64]$successfulSavedBytes = $successfulBeforeBytes - $successfulAfterBytes
        [double]$successfulSavedPct = if ($successfulBeforeBytes -gt 0) {
            ($successfulSavedBytes / [double]$successfulBeforeBytes) * 100.0
        } else {
            0.0
        }

        Write-Host ("Successful source size: {0}" -f (Format-Bytes $successfulBeforeBytes))
        if ($successfulSavedBytes -ge 0) {
            Write-Host ("Saved on successful files: {0} ({1:N1}%)" -f (Format-Bytes $successfulSavedBytes), $successfulSavedPct) -ForegroundColor Green
        }
        else {
            Write-Host ("Change on successful files: +{0} ({1:N1}% larger)" -f (Format-Bytes (-$successfulSavedBytes)), (-$successfulSavedPct)) -ForegroundColor Yellow
        }
    }
    else {
        Write-Host "Successful source size: 0 B"
        Write-Host "Saved on successful files: 0 B (0.0%)" -ForegroundColor Green
    }
}

$elapsed = $runTimer.Elapsed
$elapsedText = if ($elapsed.TotalHours -ge 1) {
    "{0}:{1:00}:{2:00}" -f [int]$elapsed.TotalHours, $elapsed.Minutes, $elapsed.Seconds
} else {
    "{0}:{1:00}" -f [int]$elapsed.TotalMinutes, $elapsed.Seconds
}
Write-Host ("Elapsed: {0}" -f $elapsedText)

# Count only successful actions. Failed attempts are shown separately below so
# the report cannot claim that an encode/remux succeeded when it did not.
$counts = $successes | Group-Object Action | Sort-Object Name
Write-Host ""
foreach ($g in $counts) {
    Write-Host ("{0,-14} {1,6}" -f ($g.Name + ":"), $g.Count)
}
if ($failures.Count -gt 0) {
    Write-Host ("{0,-14} {1,6}" -f "Failed:", $failures.Count) -ForegroundColor Red
}

if ($failures.Count -gt 0) {
    $errorLog = Join-Path $OutputRoot "ArchiveMedia_errors.txt"
    $log = foreach ($f in $failures) {
        @"
SOURCE: $($f.Source)
DEST:   $($f.Destination)
ACTION: $($f.Action)
ERROR:
$($f.Error)

"@
    }
    Set-Content -LiteralPath $errorLog -Value $log -Encoding UTF8

    Write-Host ""
    Write-Host "FAILED: $($failures.Count) file(s)" -ForegroundColor Red
    Write-Host "Error log: $errorLog" -ForegroundColor Yellow
    Write-Host ""
    foreach ($f in $failures) {
        Write-Host ("FAILED FILE: " + $f.Source) -ForegroundColor Red
        Write-Host $f.Error -ForegroundColor Yellow
        Write-Host ""
    }
    Write-Host "Files that failed were left at their original source paths." -ForegroundColor Yellow
}
elseif ($terminated -or $pendingTasks.Count -gt 0) {
    Write-Host ""
    Write-Host ("Run terminated. {0} of {1} files reached a final result; {2} file(s) were not processed." -f $results.Count, $tasks.Count, $pendingTasks.Count) -ForegroundColor Yellow
    Write-Host "Unprocessed files remain untouched at their source paths." -ForegroundColor Yellow
}
else {
    Write-Host ""
    Write-Host "All $($successes.Count) files completed successfully in $OperationMode mode." -ForegroundColor Green
}

# Keep the final result visible when ArchiveMedia is launched by double-click.
Write-Host ""
Write-Host "Press Enter to close ArchiveMedia..." -ForegroundColor Cyan
[void](Read-Host)
