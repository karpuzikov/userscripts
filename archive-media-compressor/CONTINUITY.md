# ArchiveMedia continuity

## Product and current state
- Product: Archive Media Compressor (ArchiveMedia), in `karpuzikov/userscripts/archive-media-compressor`.
- Stable baseline at start of this work: `ArchiveMedia v6.0.13.bat` on `main`; 2026-10-08 development branch `archivemedia-rclone`.
- Status: Under construction ⚠️; always keep the actual software version alongside this status.
- Delivery: single, double-clickable versioned BAT containing an embedded PowerShell 7 compression engine. Existing BAT extracts ZIP payload, applies v6.0.13 startup patches, launches PowerShell and deletes temporary extracted code.
- Existing source ZIP contains `ArchiveMedia.ps1` (~63 KB), a nested BAT and README. Existing compressor handles recursive local folders, NVIDIA/AMD/Intel encoding selection, video MP4 normalization, image processing through ImageMagick, copies passthrough originals, and reports results.
- Existing behavior and media quality rules must remain intact. In particular max parallel encoding defaults to 4; no unexpected transcoding; output path naming and recursive relative paths preserved.

## Global and UI rules
- Follow canonical `/SOFTWARE_RULES.md` (monorepo root), and current UXDT guidance at `https://www.uxdt.nic.in/guidelines/`.
- Filename: `ArchiveMedia v<version>.bat`; this is independent of `Under construction ⚠️`.
- Default dark UI where a GUI is used; stage-specific progress, explicit file-path controls and actionable errors.
- Minimal file count: one BAT downloadable file preferred; documentation in README and this continuity file.

## Dependencies and state
- Windows 11, PowerShell 7, WinGet, FFmpeg/FFprobe, ImageMagick.
- New requirement: first-class rclone support using existing configured `yandex:` remote; auto-check/install/update `rclone` through WinGet where required.
- All persistent app logs/journals/cache/temp/settings: dynamically resolved `Documents\Karpuzikov Tools\ArchiveMedia\`. Do not persist directly into shared parent or system TEMP beyond ephemeral bootstrap extraction.

## Requested rclone integration (work underway)
- Accept either local paths or `yandex:`, `yandex:Pictures`, `yandex:Videos` in source/destination prompts.
- Supported routes: Yandex->local, local->Yandex, Yandex->Yandex; local->local unchanged.
- Never require downloading complete cloud library. Stage bounded batches/individual files to local SSD, process through original ArchiveMedia compressor, verify local outputs, upload to destination and verify remote data BEFORE removing staging input/output. Failures preserve recoverable local data.
- Preserve folder layout and filenames under existing compression/naming rules; never scan destination folders recursively as source.
- Resume after crash/interruption using a persistent journal; safe rechecking and retry handling; show download/process/upload separately with file counts and elapsed time.
- Avoid rclone mount/drive-letter integration as the main implementation.

## Known baseline problems
- The v6.0.13 BAT patches an embedded v6.0.12 PowerShell script at runtime (including a malformed foreach token), making maintenance fragile. New changes should remove patch-on-boot and integrate into real embedded source when practical.
- No `CONTINUITY.md` existed in project before this work; this file establishes authoritative continuity.
- Yandex cloud integration has not yet been run against the actual user account. No live remote permissions, MD5 or upload verification test performed.
- Current branch is a development checkpoint, not a tested release. Do not claim rclone integration works before tests.

## Development procedure / next steps
1. Decode/inspect existing embedded PowerShell source and map its input/output and task pipeline.
2. Integrate a native rclone backend without replacing transcoding/quality rules.
3. Test parse, staging, resume, verification and no-destructive-delete behavior as far as tool environment permits; request a Windows/Yandex smoke test.
4. Update one-file BAT, README, any directory/version references, and this continuity file together.
5. Preserve status `Under construction ⚠️` until user completes testing.
