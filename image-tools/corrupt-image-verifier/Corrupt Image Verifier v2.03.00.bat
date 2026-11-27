@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Corrupt Image Verifier v2.3.0 - Under construction

rem Drop image folders (scan) or image files (single check) onto this .bat, or double-click it.
rem No CALL/GOTO labels are used so GitHub Raw LF line endings cannot break execution.

rem Dependency install/update check runs at most once a week; a missing tool triggers it immediately.
set "CIV_DEPENDENCY_STAMP_DIR=%LOCALAPPDATA%\Karpuzikov Tools\Corrupt Image Verifier"
set "CIV_CHECK_DEPENDENCIES=1"
if exist "%CIV_DEPENDENCY_STAMP_DIR%\last-dependency-check.txt" (
    forfiles /p "%CIV_DEPENDENCY_STAMP_DIR%" /m "last-dependency-check.txt" /d -7 >nul 2>&1
    if errorlevel 1 set "CIV_CHECK_DEPENDENCIES=0"
)
where pwsh.exe >nul 2>&1 || if not exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "CIV_CHECK_DEPENDENCIES=1"
where ffmpeg.exe >nul 2>&1 || if not exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe" set "CIV_CHECK_DEPENDENCIES=1"
where magick.exe >nul 2>&1 || dir /b /ad "%ProgramFiles%\ImageMagick-*" >nul 2>&1 || set "CIV_CHECK_DEPENDENCIES=1"

set "WINGET="
where winget.exe >nul 2>&1
if not errorlevel 1 set "WINGET=winget.exe"
if not defined WINGET if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" set "WINGET=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"

if not defined WINGET if "%CIV_CHECK_DEPENDENCIES%"=="1" (
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

if not defined WINGET if "%CIV_CHECK_DEPENDENCIES%"=="1" (
    echo.
    echo ERROR: WinGet is still unavailable after installation.
    pause
    exit /b 1
)

if "%CIV_CHECK_DEPENDENCIES%"=="1" "%WINGET%" source update >nul 2>&1

if "%CIV_CHECK_DEPENDENCIES%"=="1" for %%K in (Microsoft.PowerShell Gyan.FFmpeg ImageMagick.ImageMagick) do (
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
if "%CIV_CHECK_DEPENDENCIES%"=="1" if not exist "%CIV_DEPENDENCY_STAMP_DIR%" mkdir "%CIV_DEPENDENCY_STAMP_DIR%"
if "%CIV_CHECK_DEPENDENCIES%"=="1" (echo Last Corrupt Image Verifier dependency check)> "%CIV_DEPENDENCY_STAMP_DIR%\last-dependency-check.txt"

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

set "WORK=%TEMP%\CorruptImageVerifier_%RANDOM%_%RANDOM%"
set "CIV_SELF=%~f0"
set "CIV_PS1=%WORK%\CorruptImageVerifier.ps1"
mkdir "%WORK%" >nul 2>&1

rem The PowerShell app is stored as plain text after the payload marker at the end of this file.
"%PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $lines=[IO.File]::ReadAllLines($env:CIV_SELF); $marker=[Array]::LastIndexOf($lines,'::CORRUPT_IMAGE_VERIFIER_PAYLOAD'); if($marker -lt 0){throw 'Embedded Corrupt Image Verifier payload not found.'}; $script=$lines[($marker+1)..($lines.Count-1)] -join [Environment]::NewLine; $tokens=$null; $errors=$null; $null=[Management.Automation.Language.Parser]::ParseInput($script,[ref]$tokens,[ref]$errors); if($errors.Count){throw ('Payload syntax error: '+(($errors | ForEach-Object { '{0}: {1}' -f $_.Extent.StartLineNumber,$_.Message }) -join '; '))}; [IO.File]::WriteAllText($env:CIV_PS1,$script,[Text.UTF8Encoding]::new($true))"
if errorlevel 1 (
    if exist "%WORK%" rd /s /q "%WORK%" >nul 2>&1
    echo.
    echo ERROR: Corrupt Image Verifier payload extraction failed.
    pause
    exit /b 1
)

"%PWSH%" -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%CIV_PS1%" %*
set "RC=%ERRORLEVEL%"
rd /s /q "%WORK%" >nul 2>&1
exit /b %RC%

::CORRUPT_IMAGE_VERIFIER_PAYLOAD
#requires -Version 7.0
# Corrupt Image Verifier - console app embedded in "Corrupt Image Verifier vX.XX.XX.bat".
# Dropped files are checked one by one; dropped folders are scanned.
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CorruptImageVerifierDroppedPaths = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$CorruptImageVerifierVersion = "2.3.0"
$VisualDamagePrefix = "VISUAL DAMAGE SUSPECTED"

$ImageExtensions = @(
    ".jpg", ".jpeg", ".jpe", ".jfif", ".png", ".apng", ".gif", ".webp",
    ".bmp", ".dib", ".tif", ".tiff", ".ico", ".jp2", ".j2k", ".jpf",
    ".jpx", ".jpm", ".heic", ".heif", ".avif", ".pcx", ".tga", ".ppm",
    ".pgm", ".pbm", ".pnm", ".dds"
)

# Classification rules (never weaken):
# - CORRUPT only for a zero-byte file, or a decoder failure on a file whose magic bytes
#   match no known image format. Decoder failure alone never proves corruption, and a
#   valid image with the wrong extension (e.g. HEIC named .JPG) is never CORRUPT.
# - HEIC/HEIF content is decoded with FFmpeg (ImageMagick's Windows build has no HEVC decoder).
# - Truncated/missing-EOI JPEGs, decoder warnings and visual-damage suspects are WARNING.
# - Scanning is read-only. Files move only after an explicit [M] and a fresh re-check.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

public sealed class CorruptImageVerifierResult
{
    public string Status;
    public string Reason;
    public string RealExtension;  // set when the bytes are another format than the extension says
    public CorruptImageVerifierResult(string status, string reason) { Status = status; Reason = reason; }
}

public sealed class CorruptImageVerifierFolderScan
{
    public List<string> Files = new List<string>();
    public List<string> UnreadableFolders = new List<string>();
}

public static class CorruptImageVerifierEngine
{
    public const string VisualDamagePrefix = "VISUAL DAMAGE SUSPECTED";
    public static int DecoderTimeoutMilliseconds = 10 * 60 * 1000;

    // Format each extension promises; used to spot files whose bytes are another format.
    static readonly Dictionary<string, string> ExtensionFormats = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { ".jpg", "JPEG" }, { ".jpeg", "JPEG" }, { ".jpe", "JPEG" }, { ".jfif", "JPEG" },
        { ".png", "PNG" }, { ".apng", "PNG" }, { ".gif", "GIF" }, { ".bmp", "BMP" },
        { ".tif", "TIFF" }, { ".tiff", "TIFF" }, { ".webp", "WebP" }, { ".heic", "HEIC" }, { ".avif", "AVIF" },
        { ".jp2", "JPEG 2000" }, { ".j2k", "JPEG 2000" }, { ".jpf", "JPEG 2000" }, { ".jpx", "JPEG 2000" }, { ".jpm", "JPEG 2000" }
    };

    static readonly Dictionary<string, string> ContentExtensions = new Dictionary<string, string>
    {
        { "JPEG", ".jpg" }, { "PNG", ".png" }, { "GIF", ".gif" }, { "BMP", ".bmp" }, { "TIFF", ".tif" },
        { "WebP", ".webp" }, { "HEIC", ".heic" }, { "AVIF", ".avif" }, { "JPEG 2000", ".jp2" },
        { "Video (QuickTime MOV)", ".mov" }
    };

    // ImageMagick coder forced from the real content, so a wrong extension cannot pick the wrong decoder.
    static readonly Dictionary<string, string> MagickCoders = new Dictionary<string, string>
    {
        { "JPEG", "jpeg" }, { "PNG", "png" }, { "GIF", "gif" }, { "BMP", "bmp" }, { "TIFF", "tiff" },
        { "WebP", "webp" }, { "AVIF", "avif" }, { "JPEG 2000", "jp2" }
    };

    // Words in decoder warnings that point at damaged data (benign TIFF tag warnings stay GOOD).
    static readonly string[] DamageWords = {
        "premature end", "corrupt", "truncat", "crc", "insufficient image data", "unexpected end",
        "huffman", "invalid", "broken", "not enough", "end of file", "checksum", "damaged"
    };

    sealed class ProcessRun { public int ExitCode; public byte[] Output; public string Error; public bool TimedOut; }


    static CorruptImageVerifierResult Result(string status, string reason)
    {
        return new CorruptImageVerifierResult(status, reason);
    }

    public static CorruptImageVerifierFolderScan CollectImages(string root, string[] extensions)
    {
        var wanted = new HashSet<string>(extensions, StringComparer.OrdinalIgnoreCase);
        var scan = new CorruptImageVerifierFolderScan();
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.Count > 0)
        {
            string folder = pending.Pop();
            try
            {
                foreach (string file in Directory.EnumerateFiles(folder))
                    if (wanted.Contains(Path.GetExtension(file))) scan.Files.Add(file);
                foreach (string child in Directory.EnumerateDirectories(folder))
                {
                    var info = new DirectoryInfo(child);
                    if ((info.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                    if (info.Name.EndsWith("_CORRUPTED", StringComparison.OrdinalIgnoreCase)) continue;
                    pending.Push(child);
                }
            }
            catch (Exception) when (folder != root)
            {
                scan.UnreadableFolders.Add(folder);
            }
        }
        return scan;
    }

    public static CorruptImageVerifierResult Classify(string path, string magick, string ffmpeg)
    {
        FileInfo info;
        try
        {
            info = new FileInfo(path);
            if (!info.Exists) return Result("error", "File no longer exists");
            if (info.LinkTarget != null) return Result("error", "Symbolic links are never modified");
            if (info.Length == 0) return Result("corrupt", "Empty image file (0 bytes)");
        }
        catch (Exception e) { return Result("error", "File access failed: " + e.Message); }

        string extension = info.Extension.ToLowerInvariant();
        byte[] head;
        bool missingEndMarker = false;
        try
        {
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                head = new byte[Math.Min(64L, stream.Length)];
                int read = 0;
                while (read < head.Length)
                {
                    int n = stream.Read(head, read, head.Length - read);
                    if (n <= 0) break;
                    read += n;
                }
                if (stream.Length >= 4 && head[0] == 0xFF && head[1] == 0xD8)
                {
                    stream.Seek(-2, SeekOrigin.End);
                    missingEndMarker = !(stream.ReadByte() == 0xFF && stream.ReadByte() == 0xD9);
                }
            }
        }
        catch (UnauthorizedAccessException e) { return Result("error", "Permission denied: " + e.Message); }
        catch (IOException e) { return Result("error", "File read failed: " + e.Message); }

        string content = DetectContentFormat(head);
        string expected;
        string wrongExtension = content != null && ExtensionFormats.TryGetValue(extension, out expected) && expected != content
            ? "Wrong extension: content is " + content + ", named " + info.Extension : null;
        string realExtension = null;
        if (content != null && !ContentExtensions.TryGetValue(content, out realExtension))
            realExtension = content.StartsWith("Video") ? ".mp4" : null;
        if (content != null && content.StartsWith("Video"))
            return new CorruptImageVerifierResult("warning", "Not an image: " + content + ", named " + info.Extension) { RealExtension = realExtension };
        CorruptImageVerifierResult classified = ClassifyImage(path, magick, ffmpeg, info, extension, head, content, wrongExtension, missingEndMarker);
        if (wrongExtension != null) classified.RealExtension = realExtension;
        return classified;
    }

    static CorruptImageVerifierResult ClassifyImage(string path, string magick, string ffmpeg, FileInfo info, string extension,
        byte[] head, string content, string wrongExtension, bool missingEndMarker)
    {
        bool isJpeg = content == "JPEG";
        bool isHeif = content == "HEIC" || ((extension == ".heic" || extension == ".heif") && content == null);
        string coder;
        string magickInput = content != null && MagickCoders.TryGetValue(content, out coder) ? coder + ":" + path : path;

        ProcessRun decode = isHeif
            ? Run(ffmpeg, new[] { "-v", "error", "-nostdin", "-i", path, "-map", "0:v", "-f", "null", "-" })
            : Run(magick, new[] { magickInput, "-format", "%w %h\\n", "info:" });
        if (decode.TimedOut) return Result("warning", "Decoder timed out after 10 minutes - left in place");
        if (isHeif)  // The null muxer complains about equal timestamps of HEIC tiles; that is not damage.
            decode.Error = string.Join("\n", (decode.Error ?? "").Split('\n')
                .Where(l => l.Trim().Length > 0 && !l.Contains("non monotonically increasing dts")));
        string message = CleanMessage(decode.Error, path);
        if (isHeif)
        {
            // FFmpeg reports damage only on stderr at -v error; exit code alone misses some.
            if (decode.ExitCode == 0 && message.Length == 0)
                return Result(wrongExtension != null ? "warning" : "good", wrongExtension ?? "");
            string failure = message.Length > 0 ? message : "exit code " + decode.ExitCode;
            return Result("warning", (wrongExtension != null ? wrongExtension + " - " : "") + "HEIC decoder failed: " + failure);
        }

        if (decode.ExitCode == 0)
        {
            if (wrongExtension != null) return Result("warning", wrongExtension);
            bool damagedWarning = LooksDamaged(message);
            if (missingEndMarker)
                return Result("warning", damagedWarning
                    ? "JPEG missing FF D9; image retained for manual review (" + message + ")"
                    : "JPEG missing final FF D9 marker; fully decodable");
            if (damagedWarning) return Result("warning", message);
            if (isJpeg)
            {
                string visual = CheckVisualDamage(magickInput, path, magick, Encoding.ASCII.GetString(decode.Output));
                if (visual.Length > 0) return Result("warning", visual);
            }
            return Result("good", "");
        }

        string signatureIssue = SignatureIssue(extension, head);
        if (signatureIssue != null && content == null)
            return Result("corrupt", signatureIssue + ", no other known format; first bytes: "
                + BitConverter.ToString(head, 0, Math.Min(12, head.Length)).Replace("-", " "));
        if (wrongExtension != null) return Result("warning", wrongExtension + " - decoder failed: " + message);
        string lower = message.ToLowerInvariant();
        if (lower.Contains("no decode delegate") || lower.Contains("delegate library support not built-in")
            || lower.Contains("not supported") || lower.Contains("unsupported"))
            return Result("unsupported", message);
        if (missingEndMarker) return Result("warning", "JPEG missing FF D9; image retained for manual review (" + message + ")");
        return Result("warning", message.Length > 0 ? message : "Decoder failed with exit code " + decode.ExitCode);
    }

    static bool LooksDamaged(string message)
    {
        string lower = message.ToLowerInvariant();
        return DamageWords.Any(word => lower.Contains(word));
    }

    static string CleanMessage(string error, string path)
    {
        string line = (error ?? "").Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0) ?? "";
        line = line.Replace("`" + path + "'", "").Replace(path, "[this image]");
        line = System.Text.RegularExpressions.Regex.Replace(line, @"^(magick|convert)[\w.-]*:\s*", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        line = System.Text.RegularExpressions.Regex.Replace(line, @"^(\[[^\]]*\]\s*)+", "");
        int at = line.IndexOf(" @ ", StringComparison.Ordinal);
        if (at > 0) line = line.Substring(0, at);
        return line.Trim().TrimEnd('.', ' ');
    }

    // What the bytes really are, whatever the extension says. null = no known image format.
    public static string DetectContentFormat(byte[] head)
    {
        string ascii = Encoding.ASCII.GetString(head);
        if (head.Length >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF) return "JPEG";
        if (head.Length >= 4 && head[0] == 0x89 && ascii.Substring(1, 3) == "PNG") return "PNG";
        if (ascii.StartsWith("GIF87a") || ascii.StartsWith("GIF89a")) return "GIF";
        if (ascii.StartsWith("BM")) return "BMP";
        if (ascii.StartsWith("II*\0") || ascii.StartsWith("MM\0*")) return "TIFF";
        if (ascii.Length >= 12 && ascii.StartsWith("RIFF") && ascii.Substring(8, 4) == "WEBP") return "WebP";
        if (ascii.Length >= 12 && ascii.Substring(4, 4) == "ftyp")
        {
            string brands = ascii.Substring(8);
            foreach (string brand in new[] { "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1" })
                if (brands.Contains(brand)) return brands.Contains("avif") ? "AVIF" : "HEIC";
            if (brands.Contains("avif") || brands.Contains("avis")) return "AVIF";
            string majorBrand = ascii.Substring(8, 4).Trim('\0', ' ');
            return majorBrand == "qt" ? "Video (QuickTime MOV)" : "Video (MP4, brand " + majorBrand + ")";
        }
        // Classic QuickTime files start with an atom other than ftyp.
        if (ascii.Length >= 8 && new[] { "wide", "mdat", "moov", "free", "skip", "pnot" }.Contains(ascii.Substring(4, 4)))
            return "Video (QuickTime MOV)";
        if (head.Length >= 12 && head[4] == 0x6A && head[5] == 0x50) return "JPEG 2000";
        return null;
    }

    public static string SignatureIssue(string extension, byte[] head)
    {
        Func<byte[], bool> startsWith = bytes => head.Length >= bytes.Length && bytes.Select((b, i) => head[i] == b).All(x => x);
        byte[] jpeg = { 0xFF, 0xD8 };
        byte[] png = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        byte[] tiffLittle = { 0x49, 0x49, 0x2A, 0x00 };
        byte[] tiffBig = { 0x4D, 0x4D, 0x00, 0x2A };
        string ascii = Encoding.ASCII.GetString(head);
        switch (extension)
        {
            case ".jpg": case ".jpeg": case ".jpe": case ".jfif":
                return startsWith(jpeg) ? null : "Invalid JPEG signature (missing FF D8 start marker)";
            case ".png": case ".apng":
                return startsWith(png) ? null : "Invalid PNG signature";
            case ".gif":
                return ascii.StartsWith("GIF87a") || ascii.StartsWith("GIF89a") ? null : "Invalid GIF signature";
            case ".bmp":
                return ascii.StartsWith("BM") ? null : "Invalid BMP signature";
            case ".tif": case ".tiff":
                return startsWith(tiffLittle) || startsWith(tiffBig) ? null : "Invalid TIFF signature";
            case ".webp":
                return ascii.Length >= 12 && ascii.StartsWith("RIFF") && ascii.Substring(8, 4) == "WEBP" ? null : "Invalid WebP signature";
            case ".ico":
                return startsWith(new byte[] { 0, 0, 1, 0 }) ? null : "Invalid ICO signature";
            case ".dds":
                return ascii.StartsWith("DDS ") ? null : "Invalid DDS signature";
            case ".pcx":
                return startsWith(new byte[] { 0x0A }) ? null : "Invalid PCX signature";
            case ".ppm":
                return ascii.StartsWith("P3") || ascii.StartsWith("P6") ? null : "Invalid PPM signature";
            case ".pgm":
                return ascii.StartsWith("P2") || ascii.StartsWith("P5") ? null : "Invalid PGM signature";
            case ".pbm":
                return ascii.StartsWith("P1") || ascii.StartsWith("P4") ? null : "Invalid PBM signature";
            case ".pnm":
                return ascii.Length >= 2 && ascii[0] == 'P' && ascii[1] >= '1' && ascii[1] <= '6' ? null : "Invalid PNM signature";
            case ".jp2": case ".j2k": case ".jpf": case ".jpx": case ".jpm":
                bool box = startsWith(new byte[] { 0, 0, 0, 0x0C, 0x6A, 0x50, 0x20, 0x20, 0x0D, 0x0A, 0x87, 0x0A });
                bool codestream = startsWith(new byte[] { 0xFF, 0x4F, 0xFF, 0x51 });
                return box || codestream ? null : "Invalid JPEG 2000 signature";
            default:
                return null;  // HEIC/HEIF/AVIF/TGA/DIB: no reliable magic bytes, never CORRUPT by signature
        }
    }

    static string CheckVisualDamage(string magickInput, string path, string magick, string dimensions)
    {
        string[] parts = dimensions.Split(new[] { ' ', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        int fullWidth, fullHeight;
        if (parts.Length < 2 || !int.TryParse(parts[0], out fullWidth) || !int.TryParse(parts[1], out fullHeight))
            return "Visual check could not read image size from the decoder";
        if (fullWidth < 128 || fullHeight < 128) return "";
        int width = Math.Min(160, fullWidth);
        int height = Math.Min(384, Math.Max(96, (int)Math.Round(fullHeight * (double)width / fullWidth)));
        ProcessRun raster = Run(magick, new[] {
            magickInput, "-colorspace", "sRGB", "-filter", "Box", "-resize", width + "x" + height + "!",
            "-depth", "8", "rgb:-" });
        int needed = width * height * 3;
        if (raster.ExitCode != 0 || raster.Output.Length < needed)
            return "Visual check could not run: " + CleanMessage(raster.Error, path);
        return DetectVisualAnomaly(raster.Output, width, height);
    }

    // Heuristic (not proof): a full-width abrupt row change plus a large saturation shift,
    // typical of JPEG blocks decoded with wrong data. Glitch art and collages can trigger it.
    public static string DetectVisualAnomaly(byte[] rgb, int width, int height)
    {
        int stride = width * 3;
        var saturationByRow = new double[height];
        var jumps = new double[height];
        for (int row = 0; row < height; row++)
        {
            int start = row * stride;
            int saturated = 0;
            for (int k = start; k < start + stride; k += 3)
            {
                int hi = Math.Max(rgb[k], Math.Max(rgb[k + 1], rgb[k + 2]));
                int lo = Math.Min(rgb[k], Math.Min(rgb[k + 1], rgb[k + 2]));
                if (hi > 20 && (hi - lo) * 100 >= hi * 85) saturated++;
            }
            saturationByRow[row] = saturated / (double)width;
            if (row > 0)
            {
                long sum = 0;
                for (int k = 0; k < stride; k++) sum += Math.Abs(rgb[start + k] - rgb[start - stride + k]);
                jumps[row] = sum / (double)stride;
            }
        }
        int first = (int)Math.Round(height * 0.18), last = (int)Math.Round(height * 0.82);
        foreach (int boundary in Enumerable.Range(first, last - first).OrderByDescending(y => jumps[y]))
        {
            double seam = jumps[boundary];
            if (seam < 30) break;
            double before = saturationByRow.Take(boundary).Average();
            double after = saturationByRow.Skip(boundary).Average();
            if (Math.Abs(before - after) < 0.40 || Math.Max(before, after) < 0.65) continue;
            return string.Format(CultureInfo.InvariantCulture,
                "{0} - abrupt horizontal band ({1:F0} RGB levels at {2:F0}% height); unusual color/saturation shift ({3:F0}% to {4:F0}%). Review the image; not moved automatically",
                VisualDamagePrefix, seam, boundary * 100.0 / height, before * 100, after * 100);
        }
        return "";
    }

    public static bool FilesEqual(string first, string second)
    {
        using (var a = new FileStream(first, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (var b = new FileStream(second, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            if (a.Length != b.Length) return false;
            var bufferA = new byte[1 << 20];
            var bufferB = new byte[1 << 20];
            while (true)
            {
                int readA = a.Read(bufferA, 0, bufferA.Length);
                int readB = 0;
                while (readB < readA)
                {
                    int n = b.Read(bufferB, readB, readA - readB);
                    if (n <= 0) return false;
                    readB += n;
                }
                if (readA == 0) return true;
                if (!bufferA.AsSpan(0, readA).SequenceEqual(bufferB.AsSpan(0, readA))) return false;
            }
        }
    }

    static ProcessRun Run(string exe, string[] arguments)
    {
        var start = new ProcessStartInfo(exe)
        {
            UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true
        };
        foreach (string argument in arguments) start.ArgumentList.Add(argument);
        // Files already run in parallel; one decoder thread each avoids oversubscription.
        start.Environment["MAGICK_THREAD_LIMIT"] = "1";
        using (var process = Process.Start(start))
        {
            var errorTask = process.StandardError.ReadToEndAsync();
            var output = new MemoryStream();
            var outputTask = process.StandardOutput.BaseStream.CopyToAsync(output);
            if (!process.WaitForExit(DecoderTimeoutMilliseconds))
            {
                try { process.Kill(true); } catch (Exception) { }
                return new ProcessRun { ExitCode = -1, Output = new byte[0], Error = "", TimedOut = true };
            }
            outputTask.Wait();
            return new ProcessRun { ExitCode = process.ExitCode, Output = output.ToArray(), Error = errorTask.Result };
        }
    }
}
'@

$StatusLabels = @{ good = "GOOD"; corrupt = "CORRUPT"; warning = "WARNING"; unsupported = "UNSUPPORTED"; error = "ERROR" }
$StatusColors = @{ good = "Green"; corrupt = "Red"; warning = "Yellow"; unsupported = "DarkGray"; error = "Magenta" }

function Write-Section([string]$Text) {
    Write-Host ""
    Write-Host "=== $Text ===" -ForegroundColor Cyan
}

# Ctrl+click opens the file in Windows Terminal (OSC 8 link); plain text elsewhere.
function Format-PathLink([string]$Path) {
    $uri = [Uri]::new($Path).AbsoluteUri
    return "`e]8;;$uri`e\$Path`e]8;;`e\"
}

function Write-RunLog([string]$Line) {
    if ($script:RunLog) { $script:RunLog.WriteLine(("{0:HH:mm:ss} {1}" -f (Get-Date), $Line)) }
}

function Write-Finding([string]$Status, [string]$Path, [string]$Reason) {
    $label = $StatusLabels[$Status]
    Write-Host ("[{0}] " -f $label) -ForegroundColor $StatusColors[$Status] -NoNewline
    Write-Host (Format-PathLink $Path)
    if ($Reason) { Write-Host "    $Reason" -ForegroundColor DarkGray }
    Write-RunLog "[$label] $Path$(if ($Reason) { " | $Reason" })"
}

function Select-Folder([string]$Title) {
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $dialog = [System.Windows.Forms.FolderBrowserDialog]::new()
        $dialog.Description = $Title
        $dialog.ShowNewFolderButton = $false
        if ($script:RecentFolder -and (Test-Path -LiteralPath $script:RecentFolder -PathType Container)) {
            $dialog.SelectedPath = [string]$script:RecentFolder
        }
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            return [IO.Path]::GetFullPath($dialog.SelectedPath).TrimEnd("\")
        }
        return $null
    }
    catch {
        # No folder dialog available (e.g. non-Windows test host): fall back to console input.
    }
    $typed = (Read-Host $Title).Trim().Trim('"')
    if ([string]::IsNullOrWhiteSpace($typed)) { return $null }
    return [IO.Path]::GetFullPath($typed).TrimEnd("\")
}

function Resolve-Executable([string]$Name, [string[]]$FallbackPatterns = @()) {
    $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { return $command.Source }
    foreach ($pattern in $FallbackPatterns) {
        $found = Get-ChildItem -Path $pattern -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
        if ($found) { return $found[0].FullName }
    }
    return $null
}

function Get-StorageType([string]$Folder) {
    try {
        $root = [IO.Path]::GetPathRoot($Folder).TrimEnd("\")
        if ($root -match "^([A-Za-z]):$") {
            $disk = Get-Partition -DriveLetter $Matches[1] -ErrorAction Stop | Get-Disk -ErrorAction Stop
            $physical = Get-PhysicalDisk -ErrorAction Stop |
                Where-Object { [string]$_.DeviceId -eq [string]$disk.Number } | Select-Object -First 1
            if ($physical -and $physical.MediaType) { return [string]$physical.MediaType }
        }
    }
    catch {
        # Storage type only tunes the worker count.
    }
    return "Unknown"
}

function Get-QuarantineRoot([string]$SourceRoot) {
    $root = [IO.Path]::GetFullPath($SourceRoot).TrimEnd("\")
    $parent = [IO.Path]::GetDirectoryName($root)
    if (-not $parent) { return Join-Path $root "_CORRUPTED" }  # drive root: D:\_CORRUPTED
    return Join-Path $parent ([IO.Path]::GetFileName($root) + "_CORRUPTED")
}

function Test-PathInside([string]$Path, [string]$Folder) {
    $prefix = [IO.Path]::GetFullPath($Folder).TrimEnd("\", "/") + [IO.Path]::DirectorySeparatorChar
    return [IO.Path]::GetFullPath($Path).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

# Byte-verified private stage, then a no-overwrite rename. Never replaces an existing file.
function Copy-FileVerifiedNoOverwrite([string]$From, [string]$To) {
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($To))
    if ([IO.File]::Exists($To) -or [IO.Directory]::Exists($To)) { throw "Destination already exists: $To" }
    $stage = "$To.stage-" + [guid]::NewGuid().ToString("N")
    try {
        [IO.File]::Copy($From, $stage, $false)
        if (-not [CorruptImageVerifierEngine]::FilesEqual($From, $stage)) { throw "Byte-for-byte copy verification failed" }
        [IO.File]::Move($stage, $To, $false)
    }
    finally {
        if ([IO.File]::Exists($stage)) { [IO.File]::Delete($stage) }
    }
}

# ---- Undo manifest (same format as the earlier Python versions) ----
function Read-UndoManifest {
    if (-not (Test-Path -LiteralPath $UndoManifestPath -PathType Leaf)) { return $null }
    $data = Get-Content -LiteralPath $UndoManifestPath -Raw | ConvertFrom-Json
    if (-not $data.moves) { return $null }
    $data.moves = [Collections.Generic.List[object]]@($data.moves)
    return $data
}

function Save-UndoManifest($Data) {
    if ($Data.moves.Count -eq 0) {
        if (Test-Path -LiteralPath $UndoManifestPath) { Remove-Item -LiteralPath $UndoManifestPath -Force }
        return
    }
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($UndoManifestPath))
    $temp = "$UndoManifestPath.tmp"
    $Data | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temp -Encoding utf8
    [IO.File]::Move($temp, $UndoManifestPath, $true)
}

function Add-UndoMove([string]$RunId, [string[]]$Sources, [string]$Original, [string]$MovedTo) {
    $data = Read-UndoManifest
    if (-not $data -or $data.run_id -ne $RunId) {
        if ($data) {
            $history = Join-Path (Split-Path $UndoManifestPath) "history"
            [void][IO.Directory]::CreateDirectory($history)
            $safeId = ([string]$data.run_id) -replace '[^\w.-]', '_'
            Copy-Item -LiteralPath $UndoManifestPath -Destination (Join-Path $history "$safeId.json") -Force
        }
        $data = [pscustomobject]@{
            version    = 2
            run_id     = $RunId
            created_at = (Get-Date).ToString("o")
            sources    = @($Sources)
            moves      = [Collections.Generic.List[object]]::new()
        }
    }
    $data.moves.Add([pscustomobject]@{ original = $Original; moved_to = $MovedTo })
    Save-UndoManifest $data
}

function Remove-UndoMove([string]$Original, [string]$MovedTo) {
    $data = Read-UndoManifest
    if (-not $data) { return }
    $data.moves = [Collections.Generic.List[object]]@($data.moves | Where-Object { -not ($_.original -eq $Original -and $_.moved_to -eq $MovedTo) })
    Save-UndoManifest $data
}

function Move-FindingToQuarantine($Finding, [string]$RunId, [string[]]$Sources) {
    $file = [IO.FileInfo]::new($Finding.Path)
    if (-not $file.Exists) { throw "File no longer exists" }
    if ($file.LinkTarget) { throw "Symbolic link - left in place" }
    if ($file.Length -ne $Finding.Size -or $file.LastWriteTimeUtc.Ticks -ne $Finding.WriteTicks) {
        throw "Changed since the scan - left in place; scan again"
    }
    $recheck = [CorruptImageVerifierEngine]::Classify($file.FullName, $Magick, $FFmpeg)
    $userConfirmedVisual = $Finding.UserConfirmed -and $recheck.Status -eq "warning" -and $recheck.Reason.StartsWith($VisualDamagePrefix)
    if ($recheck.Status -ne "corrupt" -and -not $userConfirmedVisual) {
        throw "Re-check is $($StatusLabels[$recheck.Status]): $($recheck.Reason)"
    }
    $relative = [IO.Path]::GetRelativePath($Finding.Source, $file.FullName)
    if ([IO.Path]::IsPathRooted($relative) -or $relative.StartsWith("..")) { throw "File is outside its scanned folder" }
    $destination = Join-Path (Get-QuarantineRoot $Finding.Source) $relative

    Copy-FileVerifiedNoOverwrite $file.FullName $destination
    try {
        $file.Refresh()
        if ($file.Length -ne $Finding.Size -or $file.LastWriteTimeUtc.Ticks -ne $Finding.WriteTicks) {
            throw "Changed during the copy - left in place"
        }
        Add-UndoMove $RunId $Sources $file.FullName $destination  # recorded BEFORE the original is removed
        [IO.File]::Delete($file.FullName)
    }
    catch {
        if ([IO.File]::Exists($file.FullName)) {
            [IO.File]::Delete($destination)
            Remove-UndoMove $file.FullName $destination
        }
        throw
    }
    return $destination
}

# Same folder, same name, real extension (keeps upper/lower case). Never overwrites: "name (1).MOV".
function Rename-FindingToRealExtension($Finding, [string]$RunId, [string[]]$Sources) {
    $file = [IO.FileInfo]::new($Finding.Path)
    if (-not $file.Exists) { throw "File no longer exists" }
    if ($file.Length -ne $Finding.Size -or $file.LastWriteTimeUtc.Ticks -ne $Finding.WriteTicks) {
        throw "Changed since the scan - left as is; scan again"
    }
    $extension = $Finding.RealExtension
    if ($file.Extension -ceq $file.Extension.ToUpperInvariant()) { $extension = $extension.ToUpperInvariant() }
    $baseName = Join-Path $file.DirectoryName ([IO.Path]::GetFileNameWithoutExtension($file.Name))
    $target = "$baseName$extension"
    for ($n = 1; [IO.File]::Exists($target) -or [IO.Directory]::Exists($target); $n++) { $target = "$baseName ($n)$extension" }
    Add-UndoMove $RunId $Sources $file.FullName $target
    try { [IO.File]::Move($file.FullName, $target, $false) }
    catch {
        Remove-UndoMove $file.FullName $target
        throw
    }
    return $target
}

function Remove-EmptyQuarantineFolders([string]$MovedTo, [string[]]$Sources, [string]$Original) {
    $source = $Sources | Where-Object { Test-PathInside $Original $_ } | Select-Object -First 1
    if (-not $source) { return }
    $quarantine = [IO.Path]::GetFullPath((Get-QuarantineRoot $source)).TrimEnd("\", "/")
    $folder = [IO.Path]::GetDirectoryName($MovedTo)
    while ($folder -and ((Test-PathInside $folder $quarantine) -or $folder -eq $quarantine)) {
        if (-not [IO.Directory]::Exists($folder) -or [IO.Directory]::EnumerateFileSystemEntries($folder).GetEnumerator().MoveNext()) { break }
        [IO.Directory]::Delete($folder)
        if ($folder -eq $quarantine) { break }
        $folder = [IO.Path]::GetDirectoryName($folder)
    }
}

function Invoke-UndoLastMove($Manifest) {
    Write-Section "Undo last move"
    $moves = @($Manifest.moves)
    $remaining = [Collections.Generic.List[object]]::new()
    $restored = 0
    for ($i = $moves.Count - 1; $i -ge 0; $i--) {
        $move = $moves[$i]
        try {
            if (-not [IO.File]::Exists($move.moved_to)) { throw "Moved file is no longer at $($move.moved_to)" }
            if ([IO.File]::Exists($move.original) -or [IO.Directory]::Exists($move.original)) {
                throw "Something already exists at the original path; nothing was overwritten"
            }
            Copy-FileVerifiedNoOverwrite $move.moved_to $move.original
            [IO.File]::Delete($move.moved_to)
            Remove-EmptyQuarantineFolders $move.moved_to @($Manifest.sources) $move.original
            $restored++
            Write-Host "[RESTORED] " -ForegroundColor Green -NoNewline
            Write-Host (Format-PathLink $move.original)
            Write-RunLog "[RESTORED] $($move.original)"
        }
        catch {
            $remaining.Insert(0, $move)
            Write-Host "[NOT RESTORED] " -ForegroundColor Red -NoNewline
            Write-Host (Format-PathLink $move.original)
            Write-Host "    $($_.Exception.Message)" -ForegroundColor DarkGray
            Write-RunLog "[NOT RESTORED] $($move.original) | $($_.Exception.Message)"
        }
    }
    $Manifest.moves = $remaining
    Save-UndoManifest $Manifest
    Write-Host ""
    Write-Host "Restored $restored of $($moves.Count)." -ForegroundColor $(if ($remaining.Count) { "Yellow" } else { "Green" })
    if ($remaining.Count) { Write-Host "$($remaining.Count) file(s) stay in the undo list; fix the reason above and run Undo again." -ForegroundColor Yellow }
}

function Start-RunLog([string]$Kind) {
    [void][IO.Directory]::CreateDirectory($LogsFolder)
    $name = "{0}-{1:yyyy-MM-dd-HH-mm-ss}-{2}.log" -f $Kind, (Get-Date), [guid]::NewGuid().ToString("N").Substring(0, 6)
    $script:RunLogPath = Join-Path $LogsFolder $name
    $script:RunLog = [IO.StreamWriter]::new($script:RunLogPath, $false, [Text.UTF8Encoding]::new($false))
    $script:RunLog.AutoFlush = $true
    Write-RunLog "Corrupt Image Verifier $CorruptImageVerifierVersion - $Kind"
}

# ---------------- main ----------------
$documentsFolder = [Environment]::GetFolderPath("MyDocuments")
if (-not $documentsFolder) { $documentsFolder = $HOME }  # non-Windows test hosts
$AppDataFolder = Join-Path $documentsFolder "Karpuzikov Tools\Corrupt Image Verifier"
$UndoManifestPath = Join-Path $AppDataFolder "undo\last_run.json"
$SettingsPath = Join-Path $AppDataFolder "settings.json"
$LogsFolder = Join-Path $AppDataFolder "logs"
$script:RunLog = $null
$script:RunLogPath = $null
$exitCode = 0

try {
    Write-Host "Corrupt Image Verifier v$CorruptImageVerifierVersion" -ForegroundColor Cyan

    $Magick = Resolve-Executable "magick" @(
        "$env:ProgramFiles\ImageMagick-*\magick.exe",
        "${env:ProgramFiles(x86)}\ImageMagick-*\magick.exe"
    )
    if (-not $Magick) { throw "ImageMagick (magick.exe) was not found. Run the .bat again to install it." }
    $FFmpeg = Resolve-Executable "ffmpeg" @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg*\**\ffmpeg.exe"
    )
    if (-not $FFmpeg) { throw "FFmpeg (ffmpeg.exe, used for HEIC) was not found. Run the .bat again to install it." }

    $droppedFiles = @($CorruptImageVerifierDroppedPaths | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) })
    $droppedFolders = @($CorruptImageVerifierDroppedPaths | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) })

    # ---- Check single dropped files: always show the result, never move ----
    if ($droppedFiles.Count -and -not $droppedFolders.Count) {
        Start-RunLog "check"
        Write-Section "Check file"
        foreach ($path in $droppedFiles) {
            $full = [IO.Path]::GetFullPath($path)
            $result = [CorruptImageVerifierEngine]::Classify($full, $Magick, $FFmpeg)
            Write-Finding $result.Status $full $(if ($result.Reason) { $result.Reason } else { "Full decode and visual checks passed" })
        }
        Write-Host ""
        Write-Host "Single-file checks never move files. Drop the folder on the .bat to scan and quarantine." -ForegroundColor DarkGray
        return
    }

    # ---- Undo offer ----
    $manifest = Read-UndoManifest
    if ($manifest -and -not $droppedFolders.Count) {
        $answer = (Read-Host "Last run moved or renamed $($manifest.moves.Count) file(s). Undo it [U] / New scan [Enter]").Trim().ToUpperInvariant()
        if ($answer -eq "U") {
            Start-RunLog "undo"
            Invoke-UndoLastMove $manifest
            return
        }
    }

    # ---- Folders ----
    $settings = $null
    if (Test-Path -LiteralPath $SettingsPath -PathType Leaf) {
        try { $settings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json } catch { $settings = $null }
    }
    $sources = [Collections.Generic.List[string]]::new()
    $candidates = @($droppedFolders)
    $script:RecentFolder = if ($settings -and $settings.Source) { [string]$settings.Source } else { $null }
    $pickMore = -not $droppedFolders.Count
    $index = 0
    do {
        if ($index -lt $candidates.Count) { $picked = [IO.Path]::GetFullPath($candidates[$index]).TrimEnd("\"); $index++ }
        elseif ($pickMore) { $picked = Select-Folder "Folder to scan" }
        else { break }
        if (-not $picked) { break }
        $overlap = $sources | Where-Object { (Test-PathInside $picked $_) -or (Test-PathInside $_ $picked) -or $_ -eq $picked } | Select-Object -First 1
        if (-not (Test-Path -LiteralPath $picked -PathType Container)) { Write-Host "Folder does not exist: $picked" -ForegroundColor Red }
        elseif ($picked.EndsWith("_CORRUPTED", [StringComparison]::OrdinalIgnoreCase)) { Write-Host "Quarantine folders (*_CORRUPTED) cannot be scanned: $picked" -ForegroundColor Red }
        elseif ($overlap) { Write-Host "Not added: overlaps $overlap" -ForegroundColor Red }
        else {
            $sources.Add($picked)
            Write-Host ("Folder {0}: {1}" -f $sources.Count, $picked)
        }
        if ($index -ge $candidates.Count -and $pickMore) {
            $more = (Read-Host "Add another folder [A] / Start scan [Enter]").Trim().ToUpperInvariant()
            if ($more -ne "A") { break }
            $script:RecentFolder = $null
        }
    } while ($true)
    if ($sources.Count -eq 0) { throw "No folder selected." }
    try {
        [void][IO.Directory]::CreateDirectory($AppDataFolder)
        [pscustomobject]@{ Source = $sources[0] } | ConvertTo-Json -Compress | Set-Content -LiteralPath $SettingsPath -Encoding utf8
    }
    catch {
        Write-Host "[NOTE] Could not remember the folder: $($_.Exception.Message)" -ForegroundColor DarkGray
    }

    # ---- Scan (read-only) ----
    Start-RunLog "scan"
    Write-Section "Scan (read-only)"
    $items = [Collections.Generic.List[object]]::new()
    foreach ($source in $sources) {
        $found = [CorruptImageVerifierEngine]::CollectImages($source, [string[]]$ImageExtensions)
        foreach ($folder in $found.UnreadableFolders) { Write-Finding "error" $folder "Folder could not be read - its images were not checked" }
        foreach ($path in $found.Files) { $items.Add([pscustomobject]@{ Source = $source; Path = $path }) }
        Write-RunLog "Folder $source : $($found.Files.Count) images"
    }
    $logicalCpu = [Math]::Max(1, [Environment]::ProcessorCount)
    $storageTypes = @($sources | ForEach-Object { Get-StorageType $_ } | Select-Object -Unique)
    $hddOrUnknown = @($storageTypes | Where-Object { $_ -in @("HDD", "Unknown", "Unspecified") }).Count -gt 0
    $workers = if ($hddOrUnknown) { [Math]::Min(8, [Math]::Max(4, $logicalCpu)) } else { [Math]::Max(4, $logicalCpu) }
    Write-Host ("Images found: {0:N0}   Storage: {1}   Workers: {2}" -f $items.Count, ($storageTypes -join ", "), $workers)
    Write-RunLog "Images: $($items.Count) | Storage: $($storageTypes -join ', ') | Workers: $workers"

    $counts = @{ good = 0; corrupt = 0; warning = 0; unsupported = 0; error = 0 }
    $findings = [Collections.Generic.List[object]]::new()
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $lastProgress = -1000
    $done = 0
    $magickForWorkers = $Magick
    $ffmpegForWorkers = $FFmpeg
    $items | ForEach-Object -ThrottleLimit $workers -Parallel {
        $result = [CorruptImageVerifierEngine]::Classify($_.Path, $using:magickForWorkers, $using:ffmpegForWorkers)
        [pscustomobject]@{ Source = $_.Source; Path = $_.Path; Status = $result.Status; Reason = $result.Reason; RealExtension = $result.RealExtension }
    } | ForEach-Object {
        $done++
        $counts[$_.Status]++
        if ($_.Status -ne "good") {
            $file = [IO.FileInfo]::new($_.Path)
            $findings.Add([pscustomobject]@{
                Source = $_.Source; Path = $_.Path; Status = $_.Status; Reason = $_.Reason
                Size = $(if ($file.Exists) { $file.Length } else { -1 })
                WriteTicks = $(if ($file.Exists) { $file.LastWriteTimeUtc.Ticks } else { -1 })
                UserConfirmed = $false
                RealExtension = $_.RealExtension
            })
            Write-Finding $_.Status $_.Path $_.Reason
        }
        if ($clock.ElapsedMilliseconds - $lastProgress -ge 250) {
            $lastProgress = $clock.ElapsedMilliseconds
            $rate = $done / [Math]::Max(0.001, $clock.Elapsed.TotalSeconds)
            Write-Progress -Activity "Scanning (read-only)" -Status ("{0:N0} / {1:N0}  |  {2:N1} files/s  |  {3} corrupt, {4} warnings" -f $done, $items.Count, $rate, $counts.corrupt, $counts.warning) -PercentComplete ([int](100 * $done / [Math]::Max(1, $items.Count)))
        }
    }
    Write-Progress -Activity "Scanning (read-only)" -Completed
    $clock.Stop()

    Write-Section "Result"
    foreach ($status in @("good", "corrupt", "warning", "unsupported", "error")) {
        Write-Host ("{0,-12} {1,8:N0}" -f $StatusLabels[$status], $counts[$status]) -ForegroundColor $(if ($counts[$status]) { $StatusColors[$status] } else { "DarkGray" })
    }
    $summary = "{0:N0} images in {1:hh\:mm\:ss} ({2:N1} files/s)" -f $done, $clock.Elapsed, ($done / [Math]::Max(0.001, $clock.Elapsed.TotalSeconds))
    Write-Host $summary
    Write-RunLog ("Result: " + (($counts.GetEnumerator() | ForEach-Object { "$($StatusLabels[$_.Key]) $($_.Value)" }) -join ", ") + " | $summary")

    # One undo record per run: renames and moves are undone together.
    $runId = (Get-Date).ToString("yyyy-MM-ddTHH-mm-ss.fffffffzzz").Replace(":", "")

    # ---- Fix extensions: rename files whose bytes are another format ----
    $toRename = @($findings | Where-Object { $_.RealExtension })
    if ($toRename.Count) {
        Write-Section "Fix extensions"
        $toRename | Group-Object { "{0} -> {1}" -f [IO.Path]::GetExtension($_.Path).ToLowerInvariant(), $_.RealExtension } |
            Sort-Object Count -Descending | ForEach-Object { Write-Host ("  {0,5} x {1}" -f $_.Count, $_.Name) }
        $answer = (Read-Host "Rename $($toRename.Count) file(s) to their real type [F] / Leave them [Enter]").Trim().ToUpperInvariant()
        if ($answer -eq "F") {
            $renamed = 0
            foreach ($finding in $toRename) {
                try {
                    $newPath = Rename-FindingToRealExtension $finding $runId ([string[]]$sources)
                    $renamed++
                    $finding.Status = "renamed"
                    Write-Host "[RENAMED] " -ForegroundColor Green -NoNewline
                    Write-Host (Format-PathLink $newPath)
                    Write-RunLog "[RENAMED] $($finding.Path) -> $newPath"
                }
                catch {
                    Write-Host "[NOT RENAMED] " -ForegroundColor Yellow -NoNewline
                    Write-Host (Format-PathLink $finding.Path)
                    Write-Host "    $($_.Exception.Message)" -ForegroundColor DarkGray
                    Write-RunLog "[NOT RENAMED] $($finding.Path) | $($_.Exception.Message)"
                }
            }
            Write-Host ""
            Write-Host "Renamed $renamed of $($toRename.Count). To undo: run the .bat again and press U." -ForegroundColor $(if ($renamed -eq $toRename.Count) { "Green" } else { "Yellow" })
        }
    }

    # ---- Visual review: heuristic suspects need a human yes ----
    $visualSuspects = @($findings | Where-Object { $_.Status -eq "warning" -and $_.Reason.StartsWith($VisualDamagePrefix) })
    if ($visualSuspects.Count) {
        Write-Section "Visual review"
        $answer = (Read-Host "$($visualSuspects.Count) image(s) look visually damaged but decode fine. Review them now [R] / Skip [Enter]").Trim().ToUpperInvariant()
        if ($answer -eq "R") {
            foreach ($suspect in $visualSuspects) {
                Write-Host (Format-PathLink $suspect.Path)
                Invoke-Item -LiteralPath $suspect.Path
                $verdict = (Read-Host "Damaged - allow moving it [D] / Not damaged [Enter]").Trim().ToUpperInvariant()
                $suspect.UserConfirmed = ($verdict -eq "D")
                if ($suspect.UserConfirmed) { Write-RunLog "[USER CONFIRMED VISUAL DAMAGE] $($suspect.Path)" }
            }
        }
    }

    # ---- Move confirmed corrupt files (explicit, re-checked, undoable) ----
    $toMove = @($findings | Where-Object { $_.Status -eq "corrupt" -or ($_.UserConfirmed -and $_.Status -ne "renamed") })
    if ($toMove.Count) {
        Write-Section "Move"
        foreach ($source in $sources) {
            if (@($toMove | Where-Object Source -eq $source).Count) { Write-Host "  -> $(Get-QuarantineRoot $source)" -ForegroundColor DarkGray }
        }
        $answer = (Read-Host "Move $($toMove.Count) corrupt file(s) to the _CORRUPTED folder(s) above [M] / Leave them [Enter]").Trim().ToUpperInvariant()
        if ($answer -eq "M") {
            $moved = 0
            foreach ($finding in $toMove) {
                try {
                    $destination = Move-FindingToQuarantine $finding $runId ([string[]]$sources)
                    $moved++
                    Write-Host "[MOVED] " -ForegroundColor Green -NoNewline
                    Write-Host (Format-PathLink $destination)
                    Write-RunLog "[MOVED] $($finding.Path) -> $destination"
                }
                catch {
                    Write-Host "[LEFT IN PLACE] " -ForegroundColor Yellow -NoNewline
                    Write-Host (Format-PathLink $finding.Path)
                    Write-Host "    $($_.Exception.Message)" -ForegroundColor DarkGray
                    Write-RunLog "[LEFT IN PLACE] $($finding.Path) | $($_.Exception.Message)"
                }
            }
            Write-Host ""
            Write-Host "Moved $moved of $($toMove.Count). To undo: run the .bat again and press U." -ForegroundColor $(if ($moved -eq $toMove.Count) { "Green" } else { "Yellow" })
        }
    }
    elseif ($counts.warning -or $counts.unsupported -or $counts.error) {
        Write-Host ""
        Write-Host "Nothing is confirmed corrupt; warnings, unsupported and error files stay in place." -ForegroundColor DarkGray
    }
}
catch {
    $exitCode = 1
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-RunLog "ERROR: $($_.Exception.Message)`n$($_.ScriptStackTrace)"
}
finally {
    if ($script:RunLog) {
        $script:RunLog.Dispose()
        Write-Host ""
        Write-Host "Log: " -ForegroundColor DarkGray -NoNewline
        Write-Host (Format-PathLink $script:RunLogPath) -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "Press Enter to close Corrupt Image Verifier..." -ForegroundColor Cyan
    [void](Read-Host)
}
exit $exitCode
