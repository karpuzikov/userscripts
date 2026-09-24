# Archive Media Compressor

Double-click `ArchiveMedia.bat`.

## What it does

- Checks dependencies and installs PowerShell 7, FFmpeg/FFprobe, and ImageMagick through WinGet when needed.
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

[Download ArchiveMedia.zip](https://raw.githubusercontent.com/karpuzikov/userscripts/main/archive-media-compressor/ArchiveMedia.zip)

The ZIP contains `ArchiveMedia.bat`, `ArchiveMedia.ps1`, and the full README.

## Important

JPEG conversion/resizing is not mathematically lossless. Existing JPEG files already within the configured size limit are copied unchanged.

Verify the output before deleting the original archive.

## License

MIT
