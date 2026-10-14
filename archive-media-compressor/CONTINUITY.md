# Archive Media Compressor - Continuity

## Purpose and current baseline
- Product: Archive Media Compressor, under `karpuzikov/userscripts/archive-media-compressor/`.
- Current verified source at checkpoint start: `ArchiveMedia v6.00.13.bat` (semantic version 6.0.13), **Under construction ⚠️**.
- Default branch: `main`. No alternate active branch is established.
- A single versioned Windows .bat embeds a Base64 ZIP containing `ArchiveMedia.ps1`; the BAT bootstraps WinGet, PowerShell 7, FFmpeg/FFprobe, and ImageMagick; extracts payload into a temporary folder; then runs PowerShell. The BAT contains temporary source-repair/worker-tuning transformations in 6.0.13.
- Project README: `archive-media-compressor/README.md`; repository-wide download/version table: root `README.md`.

## Operational behavior and invariants
- Recursive source scanning, relative folder preservation, image/video processing, photo size cap (4096x2160 equivalent), video size cap (1080p equivalent), FFprobe analysis, conditional stream remux/re-encoding, source metadata/timestamps, RAW/unknown-file copying and failed-file reporting.
- Source folder, output folder and mode are selected at runtime. Copy mode must preserve originals. Replace mode may replace files only after a valid output is available. Original non-compliant media in either mode must never be destroyed merely because a conversion is unnecessary or produced a larger result.
- Target file names must retain their actual extension: never place unchanged AVI/MOV bytes under an .mp4 filename.
- No compression result that is equal to or larger than the source is worth committing: discard temporary candidate. In Replace mode leave original untouched and report a skip; in Copy mode copy original byte-for-byte with original relative path and extension, without overwriting an unrelated pre-existing destination.
- Maintain collision protection, no inadvertent output recursion, bounded storage-aware concurrency, safe cleanup and meaningful summary counts. Avoid reprocessing existing output archives.
- Versioned downloadable filename follows `ArchiveMedia v<MAJOR>.<MINOR:02>.<PATCH:02>.bat`; semantic version in README/status has no zero padding. Any change increments patch. Status stays **Under construction ⚠️** until real Windows testing and user confirmation.
- Existing compressed output may be larger and may have replaced the source when users selected Replace in v6.0.13. A new build cannot automatically restore overwritten originals. Advise backup recovery where necessary.

## Relevant standards and rules
- `SOFTWARE_RULES.md`, `UI_UX_RULES.md`, `UI_UX_ACCEPTANCE.md` at repository root; UXDT complete guideline tree. This product has an interactive Windows console UI, with prompt, progress and action status surfaces.
- Windows native runtime and interactive acceptance tests cannot be inferred from source inspection or static validation.

## Open defect as of 2026-10-14
- Reported v6.0.13 `[REMUX]` AVI and MOV files increased in size; e.g. `CD1E.MOV` 93.71 MiB to 160.39 MiB, and multiple `Gogo` AVI files became roughly 8-14 MiB larger.
- Verified from embedded PowerShell: below-bitrate non-MP4 material is planned as `RemuxVideo`; remux tries stream copy, then AAC 128k fallback, then full transcode, but all retain `RemuxVideo` label. After writing the temp result, code unconditionally moves it to the output and in Replace mode deletes the original on a differently named path. There is no output-byte-size gate.
- Need a loss-prevention pre-commit guard on every conversion, including photos and video; avoid temporary output retention if candidate does not save bytes; in Copy mode preserve original relative name/extension on fallback.

## Validation
- Source and README inspected through the authenticated GitHub connector (2026-10-14).
- Windows .bat execution, PowerShell 7 parsing, FFmpeg end-to-end on the user's MOV/AVI, Replace-mode regression, disk-collision tests and interactive console acceptance: **NOT RUN**.
- Never describe an untested code checkpoint as stable.

## Next actions
1. Implement a pre-commit size gate and safe fallback; update source and semantic/padded filename, README and root version table, and this file together.
2. Verify raw GitHub source, payload extraction/contents, patch placement and static invariants.
3. On Windows test Copy and Replace modes with expendable MOV/AVI fixtures and original unchanged-byte hash checks, colliding filenames, reruns, and FFmpeg failures; record PASS/FAIL. Test the user's listed samples. Leave Under construction until Windows tests pass.
