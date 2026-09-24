# Archive Media Compressor

Download and double-click `ArchiveMedia.bat`.

## Single-file design

`ArchiveMedia.bat` is self-contained. It embeds the compressor PowerShell payload and extracts it only to a temporary folder while running. Temporary payload files are removed when the run finishes.

On startup it:

- checks whether WinGet is installed and bootstraps it if needed;
- installs or updates PowerShell 7;
- installs or updates FFmpeg/FFprobe;
- installs or updates ImageMagick;
- extracts the embedded compressor payload to `%TEMP%`;
- runs the compressor and cleans up the temporary payload.

## What it does

- Asks for input and output folders.
- Recursively preserves the source folder structure.
- Detects NVIDIA, Intel, and AMD hardware encoding support.
- Automatically chooses analysis and encode concurrency for the current PC and source storage.
- Standardizes videos to MP4 and photos to JPG.
- Uses bitrate/resolution rules to avoid unnecessary video re-encoding.
- Reduces video above 1080p to a 1920x1080-equivalent size.
- Copies already-suitable MP4/JPEG files unchanged when possible.
- Limits converted photos to a 4096x2160-equivalent size.
- Copies camera RAW and unrecognized files unchanged.
- Reports file count and total size before/after.
- Writes failed-file details to `ArchiveMedia_errors.txt`.

## Download

[Download ArchiveMedia.bat](https://raw.githubusercontent.com/karpuzikov/userscripts/main/archive-media-compressor/ArchiveMedia.bat)

## Important

JPEG conversion/resizing is not mathematically lossless. Existing JPEG files already within the configured size limit are copied unchanged.

Verify the output before deleting the original archive.

## License

MIT
