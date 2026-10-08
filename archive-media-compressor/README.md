# Archive Media Compressor

**ArchiveMedia v6.1.1 - Under construction ⚠️** (Windows/Yandex integration needs testing).

## Download (development branch)

[Download ArchiveMedia v6.1.1.bat](https://raw.githubusercontent.com/karpuzikov/userscripts/archivemedia-rclone/archive-media-compressor/ArchiveMedia%20v6.1.1.bat)

The BAT is the single-file launcher. Double-click it, choose **Copy** or **Replace**, and enter the source and destination. Type local paths or any configured rclone remote (for example `yandex:Pictures`); leave the path blank to browse local folders.

For Yandex, configure rclone once (`rclone config`), creating the remote `yandex:`. ArchiveMedia checks WinGet and updates/installs PowerShell 7, FFmpeg, ImageMagick, and rclone as needed.

### Supported Copy routes

- `yandex:Pictures` → `F:\Yandex Pictures Compressed`
- `F:\Photos` → `yandex:Compressed/Photos`
- `yandex:Pictures` → `yandex:Compressed/Pictures`
- Local folder → local folder (previous behavior)

Cloud **Replace** is intentionally disabled while under construction. Use **Copy** to a different, non-overlapping output path. The original cloud data is not deleted.

### Cloud pipeline

1. Inventory source paths with rclone, retaining relative folder structure.
2. Stage one file locally under the user's Documents\Karpuzikov Tools\ArchiveMedia\temp directory; never download the whole library.
3. Verify downloaded MD5 (cloud source) and invoke the **original** compressor/analysis pipeline for that file, retaining its media quality and naming rules.
4. Upload output to a temporary remote name, verify MD5 and size, then move to the final name and verify again. Local outputs are also checksum-verified before final placement.
5. Journal the verified result under Documents\Karpuzikov Tools\ArchiveMedia\logs. Only after journaling may the temporary files be cleared.
6. On restart, completed files are verified against the journal and skipped; failed staging remains for recovery.

Default temporary-storage budget is **64 GiB**; available disk space is checked before processing each file. To choose another ceiling, set `ARCHIVEMEDIA_CACHE_GIB` before starting the BAT (minimum 3 GiB). Large individual files may require increasing the limit. Existing destination content with a different checksum is **never overwritten**.

Cloud transfers retry automatically, and the console distinguishes **Download**, **Process**, **Upload**, and final **Verified** progress. Current cloud mode handles one file at a time; the original local engine retains its configured maximum of four concurrent FFmpeg encodes.

## Existing media processing rules

- Recursive source traversal and relative output layout.
- Auto-select hardware encoding (NVIDIA/AMD/Intel) where supported.
- Standardize videos to MP4, applying bitrate/resolution skip policy and reducing >1080p video to a 1080p-equivalent size.
- Standardize non-transparent still photos to high-quality JPEG up to a 4096x2160-equivalent limit.
- Copy compliant MP4/JPEG files and passthrough RAW/unsupported files unchanged where possible.
- Report source/output sizes and failures. Ordinary local Replace mode keeps its existing behavior.

JPEG conversion is not mathematically lossless. Verify outputs before choosing to delete the originals manually.

## Source and test status

The editable PowerShell engine is in [source/ArchiveMedia.ps1](https://github.com/karpuzikov/userscripts/blob/archivemedia-rclone/archive-media-compressor/source/ArchiveMedia.ps1). It is embedded directly in the downloadable BAT, not installed as a separate utility.

**Unverified:** PowerShell parsing/execution on the user's Windows PC; real Yandex transfer/upload verification; cross-format filename collisions and large-file staging; interruption/resume behavior. Do not use cloud mode to modify irreplaceable originals. See [CONTINUITY.md](CONTINUITY.md).

## License

MIT

### v6.1.1 audit notes

- + Deterministic cloud filename collision suffixes, consistent with existing JPEG/MP4 precedence.
- + rclone final move uses an immutable guard and verifies the destination after writing.
- + Windows drive-relative inputs (for example `D:Photos`) are rejected.
- Cloud processing remains sequential. This build has **not** been run on the user's Windows/Yandex account; do not use it as a finished release.
