# ArchiveMedia continuity

## TLDR / current checkpoint (2026-10-08)
- Product: Archive Media Compressor. **Current development build v6.1.0 - Under construction ⚠️**, branch `archivemedia-rclone`; main's last prior build is v6.0.13.
- Product root: `archive-media-compressor/` inside `karpuzikov/userscripts`.
- Downloadable single-file build: `archive-media-compressor/ArchiveMedia v6.1.0.bat` on the development branch.
- Editable embedded source: `archive-media-compressor/source/ArchiveMedia.ps1`.
- Documentation: `archive-media-compressor/README.md`; GitHub index: monorepo root `README.md`.
- Standard: canonical root `SOFTWARE_RULES.md` applies. Re-read it and current UXDT guidelines before further UI work; no separate project RULES.md currently exists.
- **Do not mark ready/stable or merge as finished** until the user runs the Windows/Yandex integration test, reports any errors and confirms completion.

## Legacy behavior to retain
- Single BAT launcher, launched by double-click; setup checks WinGet, PowerShell 7, FFmpeg/FFprobe and ImageMagick, now also rclone.
- Local Copy and local Replace remain in original media engine, not a separate conversion implementation.
- Recursive paths and output formats; source precedence/collision handling; existing video bitrate/size/codec policy, photo JPEG 95, 4096x2160-equivalent photos, 1080p-equivalent video, transparent PNG preservation; passthrough RAW/unknown and already-compliant files. No quality downgrades without user approval.
- Original local engine `$MaxParallel = 4` FFmpeg concurrency. Preserve reporting, failures and recovery.
- File naming must always embed actual version in physical BAT filename; status is a separate UI/README property.

## Native rclone backend implementation
- `Select-Folder` accepts either Windows local path or configured rclone path such as `yandex:`, `yandex:Pictures` or `yandex:Videos`; blank input still uses the Windows local folder picker.
- Copy modes: cloud->local, local->cloud, cloud->cloud, local->local. Cloud Replace is disabled to prevent accidental destructive overwrites; user must select distinct nonoverlapping cloud source and output.
- Uses `rclone listremotes` and `rclone lsjson --recursive --files-only --hash` to enumerate source, including sizes, paths, modification times and Yandex MD5.
- Stage one source file at a time at `Documents\Karpuzikov Tools\ArchiveMedia\temp\cloud\<route-id>\<file-id>\`.
- Cloud download uses `rclone copyto` and verifies MD5 and length. Local sources are hashed and checked again before committing.
- Runs the original compressor script in child PowerShell process with batch environment variables; locally produces original media-policy output.
- Calculates processed local MD5/size. Uploads cloud target under an `.archivemedia-uploading-<route-id>` name, verifies remote MD5/size, `rclone moveto` to final, verifies final. Local destinations staged, hashed and moved similarly.
- Different existing destination contents trigger an error; no silent overwrite. Identical existing destination is reused.
- After output verification, writes a persistent JSONL journal `Documents\Karpuzikov Tools\ArchiveMedia\logs\rclone-<route-id>.jsonl`; only then clears local per-file staging. Relaunch verifies and resumes completed outputs; failed per-file stages remain for recovery.
- Staging cap default 64 GiB, override `ARCHIVEMEDIA_CACHE_GIB` (integer GiB, minimum 3); preflight reserves approx max(1 GiB, 3x input), checks free disk, retains failed data.
- Cloud transfer retries, 60-minute timeout, 2s Yandex upload wait; progress sections Download, Process, Upload, Verified.
- Cloud mode currently handles files **serially** (one at a time) for bounded space; local engine remains four parallel jobs. This difference is a known performance limitation, not equivalent 4-concurrent cloud encode capability.
- Existing unrecognized media files are copied according to previous rules. Existing cloud filenames that collide after compression (e.g., png+jpg) may not get automatic collision suffixes because processing uses one-file batches. Test and fix this before stable release.

## Packaging and bootstrap
- BAT startup bootstraps WinGet when missing and loops packages `Microsoft.PowerShell`, `Gyan.FFmpeg`, `ImageMagick.ImageMagick`, `Rclone.Rclone`, updating installed software.
- BAT includes base64 UTF-8 PowerShell source, decodes to a per-run temporary script, uses PowerShell parser to fail fast on syntax problems, launches in STA PowerShell 7, removes bootstrap temp after exit.
- Source from `source/ArchiveMedia.ps1` must exactly match embedded BAT payload for each code revision.
- Avoid the v6.0.13 architecture that rewrote damaged source at runtime. v6.1.0 includes a clean repaired source, notably `foreach ($entry in $img.Palette.Entries)`.

## Validation performed in this chat
- Read original v6.0.13 BAT; decoded embedded ZIP and extracted original ~63KB PowerShell engine; applied previous runtime patches directly to editable source before new backend work.
- JS-based static brace/bracket scan of edited PS1 reported zero mismatches/unclosed delimiters; **not a substitute for the real Windows PowerShell parser**.
- Verified v6.1.0 BAT's decoded UTF-8 PowerShell payload is **byte-for-byte identical** to `source/ArchiveMedia.ps1`, 77,367 bytes.
- README and root GitHub version/download row point to v6.1.0 **development branch**, not main.
- **Not tested**: PowerShell parser/runtime on Windows, WinGet rclone install/update, real `yandex:` transfer, upload MD5 behavior, resume after interruption, >limit files, collision and error paths. No user data touched.

## Known caveats / blockers
- Windows/Yandex live smoke test is required. Do **not** assume cloud mode tested or universally safe yet.
- Cloud work serial only, so user's four-job concurrency target is met only for preexisting local workloads.
- Cloud empty directories aren't currently created at the destination because source inventory is files-only.
- Cloud collisions between different file extensions sharing the same output basename need deterministic suffix/priority handling before stable release.
- Source/output display is console path text; audit universal open-location path control rule and implement closest Windows terminal-appropriate equivalent before stability claim.
- Remote temp upload object from a failed/terminated upload can remain until a successful retry; do not erase it automatically without evidence of safe recovery.
- A very large file cannot be processed if its 3x reserve exceeds max cache; aborts without downloading that file, preserves upstream source.
- Use of remote MD5 is a hard requirement for this initial Yandex integration; providers lacking MD5 are unsupported and fail closed.
- An existing destination collision always fails closed instead of overwriting.
- No GitHub Actions workflows created. Do not add routine userscript validation workflows.

## Next actions
1. Run BAT `ArchiveMedia v6.1.0.bat` under PowerShell 7/Windows 11; confirm WinGet/rclone bootstrap, parser and input prompts.
2. Test Yandex->local, local->Yandex, Yandex->Yandex against a **small disposable** test folder with JPG, PNG alpha, video, and unknown file. Confirm exact format and same relative path outputs, MD5 and completion journal.
3. Interrupt transfers mid-copy and after upload but before journal; rerun and verify no corrupted output and no unnecessary re-encoding.
4. Fix any failures. Add collision output-name handling, empty directories, higher optional cloud concurrency while respecting bounded cache and four-encode ceiling if needed.
5. Audit whole-product software rules, UXDT checklist and test status, then update the BAT, README and this file in the same checkpoint; merge only after tests complete; remove **Under construction ⚠️** only after user explicitly says tested/done.
