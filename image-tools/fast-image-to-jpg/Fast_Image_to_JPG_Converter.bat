@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Fast Image to JPG Converter

call :EnsureWinget
if errorlevel 1 goto :bootstrap_failed
call :EnsureWingetPackage ImageMagick.ImageMagick
if errorlevel 1 goto :bootstrap_failed
call :FindMagick
if not defined MAGICK_EXE (
    echo ERROR: ImageMagick was installed but magick.exe could not be located.
    goto :bootstrap_failed
)

set "FAST_CONVERTER_SELF=%~f0"

:loop
echo.
echo Enter full path to folder with images (leave blank to quit):
set /p "imgfolder=> "

if "%imgfolder%"=="" goto end
set "imgfolder=%imgfolder:"=%"

if not exist "%imgfolder%\" (
    echo Folder not found: "%imgfolder%"
    goto loop
)

set "IMG_FOLDER=%imgfolder%"

powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
 "$script=(Get-Content -LiteralPath $env:FAST_CONVERTER_SELF -Raw) -replace '(?s).*::BEGIN_SCRIPT(.*)::END_SCRIPT.*','$1'; Invoke-Expression $script"

goto loop

:end
echo.
echo All conversions finished.
pause
exit /b 0

:bootstrap_failed
echo.
echo ERROR: Automatic dependency setup failed.
pause
exit /b 1

:FindMagick
set "MAGICK_EXE="
for /f "delims=" %%M in ('where magick.exe 2^>nul') do if not defined MAGICK_EXE set "MAGICK_EXE=%%M"
if defined MAGICK_EXE exit /b 0
for /d %%D in ("%ProgramFiles%\ImageMagick-*") do if exist "%%~fD\magick.exe" set "MAGICK_EXE=%%~fD\magick.exe"
if not defined MAGICK_EXE if defined ProgramFiles(x86) for /d %%D in ("%ProgramFiles(x86)%\ImageMagick-*") do if exist "%%~fD\magick.exe" set "MAGICK_EXE=%%~fD\magick.exe"
exit /b 0

:EnsureWinget
set "WINGET="
where winget.exe >nul 2>&1
if not errorlevel 1 set "WINGET=winget.exe"
if not defined WINGET if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" set "WINGET=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"
if not defined WINGET (
    echo [SETUP] WinGet is not installed. Installing the latest WinGet...
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
     "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; try { if(-not (Get-PackageProvider -Name NuGet -ListAvailable -ErrorAction SilentlyContinue)){ Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force | Out-Null }; if(-not (Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue)){ Register-PSRepository -Default }; Set-PSRepository -Name PSGallery -InstallationPolicy Trusted; Install-Module -Name Microsoft.WinGet.Client -Repository PSGallery -Scope CurrentUser -Force -AllowClobber; Import-Module Microsoft.WinGet.Client -Force; Repair-WinGetPackageManager -Latest -Force } catch { $tmp=Join-Path $env:TEMP 'Microsoft.DesktopAppInstaller.msixbundle'; Invoke-WebRequest -UseBasicParsing 'https://aka.ms/getwinget' -OutFile $tmp; Add-AppxPackage -Path $tmp; Remove-Item $tmp -Force -ErrorAction SilentlyContinue }"
    if errorlevel 1 exit /b 1
    if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe" set "WINGET=%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe"
    if not defined WINGET (
        where winget.exe >nul 2>&1
        if not errorlevel 1 set "WINGET=winget.exe"
    )
)
if not defined WINGET exit /b 1
"%WINGET%" source update >nul 2>&1
exit /b 0

:EnsureWingetPackage
setlocal
set "PKG=%~1"
"%WINGET%" list --id "%PKG%" -e >nul 2>&1
if errorlevel 1 (
    echo [SETUP] Installing %PKG%...
    "%WINGET%" install --id "%PKG%" -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
    if errorlevel 1 (
        endlocal & exit /b 1
    )
) else (
    echo [SETUP] Checking %PKG% for updates...
    "%WINGET%" upgrade --id "%PKG%" -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity >nul 2>&1
)
endlocal & exit /b 0


::BEGIN_SCRIPT
Add-Type -AssemblyName System.Drawing

if (-not ('FastImageConvert' -as [type])) {
    Add-Type -Language CSharp -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

public static class FastImageConvert
{
    private static readonly HashSet<string> Extensions = new HashSet<string>(
        new string[] { ".png", ".heic", ".heif", ".jpeg", ".jpg", ".jpe", ".jfif" },
        StringComparer.OrdinalIgnoreCase);

    private static readonly ImageCodecInfo JpegCodec = ImageCodecInfo.GetImageEncoders()
        .First(delegate(ImageCodecInfo x) { return x.MimeType == "image/jpeg"; });

    private static bool HasPotentialAlpha(Image image)
    {
        PixelFormat pf = image.PixelFormat;
        if ((pf & PixelFormat.Alpha) != 0 || (pf & PixelFormat.PAlpha) != 0)
            return true;

        if ((pf & PixelFormat.Indexed) != 0)
        {
            ColorPalette palette = image.Palette;
            foreach (Color entry in palette.Entries)
            {
                if (entry.A < 255)
                    return true;
            }
        }
        return false;
    }

    private static bool HasAlphaBelowThreshold(Image image, byte threshold)
    {
        if (!HasPotentialAlpha(image))
            return false;

        using (Bitmap bitmap = new Bitmap(image.Width, image.Height, PixelFormat.Format32bppArgb))
        {
            using (Graphics g = Graphics.FromImage(bitmap))
            {
                g.CompositingMode = CompositingMode.SourceCopy;
                g.DrawImageUnscaled(image, 0, 0);
            }

            Rectangle rect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
            BitmapData data = bitmap.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try
            {
                int rowBytes = bitmap.Width * 4;
                byte[] row = new byte[rowBytes];

                for (int y = 0; y < bitmap.Height; y++)
                {
                    IntPtr rowPtr = IntPtr.Add(data.Scan0, y * data.Stride);
                    Marshal.Copy(rowPtr, row, 0, rowBytes);

                    for (int i = 3; i < rowBytes; i += 4)
                    {
                        if (row[i] < threshold)
                            return true;
                    }
                }
            }
            finally
            {
                bitmap.UnlockBits(data);
            }
        }
        return false;
    }

    private static void SaveJpeg(Image image, string destination, long quality)
    {
        using (EncoderParameters parameters = new EncoderParameters(1))
        {
            parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
            using (FileStream stream = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 1024))
            {
                image.Save(stream, JpegCodec, parameters);
            }
        }
    }

    private static string Quote(string value)
    {
        return "\"" + value + "\"";
    }

    private static string ConvertHeic(string filePath, string jpgPath, string magickExe, long jpegQuality)
    {
        ProcessStartInfo psi = new ProcessStartInfo();
        psi.FileName = magickExe;
        psi.Arguments = Quote(filePath) + " -auto-orient -colorspace sRGB -quality " + jpegQuality +
                        " -sampling-factor 4:4:4 " + Quote(jpgPath);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.RedirectStandardOutput = true;
        psi.RedirectStandardError = true;

        using (Process process = Process.Start(psi))
        {
            string stdout = process.StandardOutput.ReadToEnd();
            string stderr = process.StandardError.ReadToEnd();
            process.WaitForExit();

            if (process.ExitCode != 0)
                return "ERROR: " + filePath + " ImageMagick: " + (stderr.Trim().Length > 0 ? stderr.Trim() : stdout.Trim());
        }

        if (!File.Exists(jpgPath) || new FileInfo(jpgPath).Length <= 0)
            return "WARNING: JPG not created: " + filePath;

        File.Delete(filePath);
        return "Converted: " + filePath;
    }

    private static string ConvertOne(string filePath, byte alphaThreshold, long jpegQuality, string magickExe)
    {
        string ext = Path.GetExtension(filePath);

        if (ext.Equals(".jpg", StringComparison.OrdinalIgnoreCase))
            return "SKIPPED (already JPG): " + filePath;

        try
        {
            string jpgPath = Path.ChangeExtension(filePath, ".jpg");

            if (ext.Equals(".heic", StringComparison.OrdinalIgnoreCase) ||
                ext.Equals(".heif", StringComparison.OrdinalIgnoreCase))
            {
                return ConvertHeic(filePath, jpgPath, magickExe, jpegQuality);
            }

            using (Image image = Image.FromFile(filePath, false))
            {
                if (ext.Equals(".png", StringComparison.OrdinalIgnoreCase) &&
                    HasAlphaBelowThreshold(image, alphaThreshold))
                {
                    return "SKIPPED (alpha channel): " + filePath;
                }

                SaveJpeg(image, jpgPath, jpegQuality);
            }

            if (!File.Exists(jpgPath))
                return "WARNING: JPG not created: " + filePath;

            File.Delete(filePath);
            return "Converted: " + filePath;
        }
        catch (Exception ex)
        {
            return "ERROR: " + filePath + " " + ex.Message;
        }
    }

    public static string[] ProcessFolder(string folder, int maxThreads, byte alphaThreshold, long jpegQuality, string magickExe)
    {
        ConcurrentQueue<string> results = new ConcurrentQueue<string>();

        IEnumerable<string> files = Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories)
            .Where(delegate(string path) { return Extensions.Contains(Path.GetExtension(path)); });

        ParallelOptions options = new ParallelOptions();
        options.MaxDegreeOfParallelism = Math.Max(1, maxThreads);

        Parallel.ForEach(files, options, delegate(string file)
        {
            results.Enqueue(ConvertOne(file, alphaThreshold, jpegQuality, magickExe));
        });

        return results.ToArray();
    }
}
'@
}

$imgfolder = $env:IMG_FOLDER
$magickExe = $env:MAGICK_EXE
$maxThreads = [Environment]::ProcessorCount
$alphaThreshold = [byte]250
$jpegQuality = 100L

$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $results = [FastImageConvert]::ProcessFolder($imgfolder, $maxThreads, $alphaThreshold, $jpegQuality, $magickExe)
    if ($results.Count -eq 0) {
        Write-Host 'No supported image files found.'
    } else {
        $results | ForEach-Object { Write-Host $_ }
    }
}
catch {
    Write-Host ('ERROR: ' + $_.Exception.Message)
}
finally {
    $sw.Stop()
    Write-Host ('Finished in {0:N2} s using up to {1} threads.' -f $sw.Elapsed.TotalSeconds, $maxThreads)
}
::END_SCRIPT
