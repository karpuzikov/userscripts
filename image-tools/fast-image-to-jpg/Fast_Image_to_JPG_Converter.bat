@echo off
setlocal DisableDelayedExpansion

:loop
echo.
echo Enter full path to folder with images (leave blank to quit):
set /p "imgfolder=> "

if "%imgfolder%"=="" goto end
set "imgfolder=%imgfolder:"=%"

if not exist "%imgfolder%" (
    echo Folder not found: "%imgfolder%"
    goto loop
)

set "IMG_FOLDER=%imgfolder%"

powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
"$script = (Get-Content -LiteralPath '%~f0' -Raw) -replace '(?s).*::BEGIN_SCRIPT(.*)::END_SCRIPT.*', '$1'; $env:IMG_FOLDER = '%IMG_FOLDER%'; Invoke-Expression $script"

goto loop

:end
echo.
echo All conversions finished.
pause
exit /b

::BEGIN_SCRIPT
Add-Type -AssemblyName System.Drawing

if (-not ('FastImageConvert' -as [type])) {
    Add-Type -Language CSharp -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
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
            Color[] entries = palette.Entries;
            for (int i = 0; i < entries.Length; i++)
            {
                if (entries[i].A < 255)
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

            // Create/overwrite directly. This avoids Test-Path and a second filesystem lookup.
            using (FileStream stream = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 1024))
            {
                image.Save(stream, JpegCodec, parameters);
            }
        }
    }

    private static string ConvertOne(string filePath, byte alphaThreshold, long jpegQuality)
    {
        string ext = Path.GetExtension(filePath);

        if (ext.Equals(".jpg", StringComparison.OrdinalIgnoreCase))
            return "SKIPPED (already JPG): " + filePath;

        try
        {
            string jpgPath = Path.ChangeExtension(filePath, ".jpg");

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

            // Image.FromFile locks the source, so delete only after Image.Dispose().
            File.Delete(filePath);
            return "Converted: " + filePath;
        }
        catch (Exception ex)
        {
            return "ERROR: " + filePath + " " + ex.Message;
        }
    }

    public static string[] ProcessFolder(string folder, int maxThreads, byte alphaThreshold, long jpegQuality)
    {
        ConcurrentQueue<string> results = new ConcurrentQueue<string>();

        IEnumerable<string> files = Directory.EnumerateFiles(folder, "*", SearchOption.AllDirectories)
            .Where(delegate(string path) { return Extensions.Contains(Path.GetExtension(path)); });

        ParallelOptions options = new ParallelOptions();
        options.MaxDegreeOfParallelism = Math.Max(1, maxThreads);

        Parallel.ForEach(files, options, delegate(string file)
        {
            results.Enqueue(ConvertOne(file, alphaThreshold, jpegQuality));
        });

        return results.ToArray();
    }
}
'@
}

$imgfolder = $env:IMG_FOLDER
$maxThreads = [Environment]::ProcessorCount
$alphaThreshold = [byte]250
$jpegQuality = 100L

$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
    $results = [FastImageConvert]::ProcessFolder($imgfolder, $maxThreads, $alphaThreshold, $jpegQuality)
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