# Corrupt Image Verifier - Continuity

## Current version, status, links
- **Version:** 2.4.0
- **Status:** **2.4.0 - Under construction ⚠️**
- **Branch:** main of karpuzikov/userscripts
- **Source / download:** image-tools/corrupt-image-verifier/Corrupt Image Verifier v2.04.00.bat
- **Link (user wants github.com blob links only, never raw):** https://github.com/karpuzikov/userscripts/blob/main/image-tools/corrupt-image-verifier/Corrupt%20Image%20Verifier%20v2.04.00.bat
- All Python versions (v1.0.2 - v1.1.7) are in version-history/ and are superseded.

## v2.4.0 - visual heuristic and review step removed (2026-11-27, current)

User (drive scan): 150+ files were offered for visual review; the samples are healthy, bold-colored art (mirror sculpture, neon portrait, red 3D renders) that open fine everywhere. User: "the whole point of this program is to save my time so I will not review" and "refine your corruption detection".
- **Deleted** the "VISUAL DAMAGE SUSPECTED" heuristic (CheckVisualDamage/DetectVisualAnomaly), the `Visual review [R]/[D]` step and manual-confirmation moves. Detection now relies only on hard evidence: zero bytes, bytes that match no format, decoder errors/damage warnings, missing JPEG end marker, wrong extension/video. **Do not re-add any pixel-guessing check or any per-file review prompt.**
- Trade-off: JPEGs that decode without any decoder complaint but look visually broken are no longer flagged (the old glitch fixture is now GOOD).
- Reason texts no longer say "manual review": "JPEG cut short (missing FF D9; ...)".
- Linux test: the 4 user art samples GOOD; truncated JPEG/HEIC still WARNING; fake/empty PNG CORRUPT.
- Note: one of the user's attachments was sexual content depicting child characters; it was not used or stored. Never use it as a fixture.

## v2.3.1 - drive-root crash fix (2026-11-27)

User picked drive `T:\` -> scan crashed: `Invalid URI: A Dos path must be rooted` in Format-PathLink. Root cause: every picked folder was `.TrimEnd("\")`, turning `T:\` into `T:` = "current folder on drive T", so unreadable folders came back as unrooted paths like `T:System Volume Information`.
- New `ConvertTo-FolderPath`: full path, trailing slash removed except for a drive root. Used by the folder picker, typed paths, dropped folders and Get-QuarantineRoot (drive root -> `T:\_CORRUPTED`).
- Format-PathLink falls back to plain text if a path cannot become a link (display only).
- Folder walk skips folders that are both Hidden and System (`System Volume Information`, `$RECYCLE.BIN`) instead of listing them as ERROR.
- NOT RUN on Windows; Linux check of the helper only.

## v2.3.0 - "Fix extensions" step (2026-11-27)

Third Windows run (v2.2.0, `august`, 498 files, 62 s): GOOD 350, CORRUPT 2, WARNING 146, UNSUPPORTED 0. Hypothesis confirmed: ~20 JPEG named .HEIC, 5 HEIC named .JPG, ~115 .HEIC files are QuickTime videos (ftyp `qt`, iPhone Live Photo parts), 6 .JPG are MP4 (mp42). The 2 CORRUPT (IMG_6954.JPG, IMG_7044.JPG) start `00 00 00 08 77 69 64 65` = classic QuickTime `wide` atom -> videos, not corrupt.

User asked to fix "Not an image" and "Wrong extension" files. Added:
- `DetectContentFormat`: ftyp `qt` -> "Video (QuickTime MOV)"; other ftyp brands -> "Video (MP4, brand X)"; classic QuickTime first atoms (`wide`, `mdat`, `moov`, `free`, `skip`, `pnot`) -> QuickTime MOV.
- `CorruptImageVerifierResult.RealExtension` (.jpg/.png/.gif/.bmp/.tif/.webp/.heic/.avif/.jp2/.mov/.mp4) for wrong-extension and not-an-image results.
- New prompt after the result: "Fix extensions" lists counts per `old -> new`, then `Rename N file(s) to their real type [F] / Leave them [Enter]`. Rename in the same folder, same base name, keeps upper case if the old extension was upper case (`.HEIC` -> `.MOV`), never overwrites (`IMG_7300 (1).MOV` when `IMG_7300.MOV` exists - typical for Live Photo pairs), checks size+mtime first, recorded in the same undo manifest as moves (one run id per run, so one Undo reverts renames and moves together). Undo prompt text: "Last run moved or renamed N file(s)".
- Linux test PASS: mp42 .JPG -> .MP4, `wide` .JPG -> .MOV, qt .HEIC -> `IMG_7300 (1).MOV` (existing .MOV untouched), JPEG .HEIC -> .JPG; undo restored all 4 names.
- NOT RUN on Windows. Expected next run on `august`: ~146 renames offered, 0 CORRUPT; after renaming, a rescan should show only real problems.

## v2.2.0 - decode by real content (2026-11-27)

Second Windows run (v2.1.0, same `august` folder, 498 images, 46 s): GOOD 362, CORRUPT 2, WARNING 16, UNSUPPORTED 118.
- 118 .HEIC files still "image type not supported" via ImageMagick: they did not take the FFmpeg path, so their bytes are a known non-HEIC format (most likely JPEG named .HEIC); ImageMagick then picked its HEIC coder from the extension. Fix: compare real content with the format the extension promises (`ExtensionFormats`), force the ImageMagick coder from content (`jpeg:FILE`, `png:FILE`...), report "Wrong extension: content is JPEG, named .HEIC". **Hypothesis not yet confirmed on the real files.**
- 5 HEICs: "Application provided invalid, non monotonically increasing dts to muxer" - FFmpeg null-muxer noise for tiles/thumbnails with equal timestamps, not damage. Those stderr lines are now ignored (could not reproduce locally; filter untested on real files).
- 6 .JPG files are MP4 videos (ftyp mp42, e.g. LQWE4370.JPG): now WARNING "Not an image: Video/ISO media (brand mp42), named .JPG" without a decode attempt.
- IMG_6954.JPG, IMG_7044.JPG: CORRUPT, bytes match no known format. CORRUPT reasons now include the first 12 bytes in hex so the next run shows what they are.
- Missing-EOI and visual checks now follow real JPEG content, not the extension.
- Linux test PASS: JPEG named .HEIC -> wrong extension; mp42 named .JPG -> not an image; zero-filled .JPG -> CORRUPT with "00 00 ..."; HEIC with 2 thumbnails -> GOOD.
- Open question for the user: wrong-extension files are WARNING (listed); if ~120 of them clutter the list, consider GOOD + a one-line count.

## v2.1.0 - HEIC via FFmpeg, wrong-extension fix (2026-11-27)

First Windows run of v2.0.0 (user, folder `D:\Pictures\Liberman-laptop\Pictures\august`, 498 images, 45 s, 10.9 files/s): weekly dependency check ran (first run), folder picker OK, 285 GOOD, **205 HEIC UNSUPPORTED** ("image type not supported": the ImageMagick Windows build lists HEIC but has no HEVC decoder), **8 JPGs falsely CORRUPT** ("Invalid JPEG signature") - almost certainly valid images (likely HEIC) with a .JPG extension. User did not move them.

Fixes:
- HEIC/HEIF content (by magic bytes, or .heic/.heif extension with unknown bytes) is decoded with FFmpeg: `ffmpeg -v error -nostdin -i FILE -map 0:v -f null -` (decodes every tile of iPhone grid images). Any stderr text or non-zero exit -> WARNING with the first FFmpeg message (`[hevc @ 0x..]` prefixes stripped). Dependency `Gyan.FFmpeg` added to the .bat (same as ArchiveMedia); a missing ffmpeg forces the weekly check.
- `DetectContentFormat` (JPEG/PNG/GIF/BMP/TIFF/WebP/HEIC/AVIF/JPEG 2000/other ISO media). A signature mismatch is CORRUPT only when the bytes match **no** known format. Valid content with the wrong extension -> WARNING "Wrong extension: content is HEIC, named .JPG" (or "... - decoder failed: ...").
- Removed the "ImageMagick cannot read HEIC" NOTE (FFmpeg now handles HEIC).
- Weekly dependency check (user asked again 2026-11-27): already in place since 2.0.0; the first run always checks because no stamp exists yet.
- Linux test (PowerShell 7.4.6, FFmpeg 9.0.2, ImageMagick 6.9): pillow-heif HEICs GOOD, truncated HEIC WARNING "Invalid NAL unit size", HEIC renamed .JPG WARNING wrong extension, fake PNG still CORRUPT.
- **NOT RUN:** real iPhone grid HEICs and the 8 user JPGs on Windows.

Next: user re-runs v2.1.0 on the same folder; expect 0 UNSUPPORTED and the 8 JPGs as WARNING wrong extension (or GOOD/real damage). Ask for one JPG's first bytes if they are still CORRUPT.

## v2.0.0 - BAT rewrite (2026-11-27)

User request: "re make this whole app into a bat script, check ArchiveMedia v6.00.21.bat and make this one in the same way, throw away all that python". The Python/Tkinter app, the unpublished PySide6 v1.3.0 draft and the unpublished Go v1.2.x prototypes are all abandoned. **Do not go back to Python or a GUI toolkit.**

### Architecture (same pattern as ArchiveMedia)
- One file: `Corrupt Image Verifier vX.XX.XX.bat`. The top is a batch bootstrap; the PowerShell 7 app is stored **as plain text** after the last `::CORRUPT_IMAGE_VERIFIER_PAYLOAD` line (ArchiveMedia uses a base64 zip; plain text was chosen so the code is readable/diffable on GitHub). Keep the payload ASCII-only. Batch never reads past `exit /b`. No CALL/GOTO labels (LF-safe). File is committed with CRLF.
- Bootstrap: finds/installs WinGet (same block as ArchiveMedia), installs/updates `Microsoft.PowerShell`, `Gyan.FFmpeg` (since 2.1.0) and `ImageMagick.ImageMagick` **at most once a week** (stamp `%LOCALAPPDATA%\Karpuzikov Tools\Corrupt Image Verifier\last-dependency-check.txt`, same rule as ArchiveMedia v6.0.22; a missing pwsh/magick forces the check). Extracts the payload to `%TEMP%\CorruptImageVerifier_*`, parse-checks it, runs it with `pwsh -STA -File ... %*`, deletes the temp folder.
- Decoder: ImageMagick `magick.exe` (covers JPEG/PNG/GIF/WebP/BMP/TIFF/ICO/JPEG 2000/HEIC/HEIF/AVIF/PCX/TGA/PNM/DDS). The app prints a NOTE if the installed ImageMagick cannot read HEIC.
- Engine: C# class `CorruptImageVerifierEngine` compiled with Add-Type inside the payload (classification, folder walk, visual detector, byte compare). Scan runs `ForEach-Object -Parallel`; each worker calls the engine; child `magick` processes get `MAGICK_THREAD_LIMIT=1`.
- Workers: any HDD/Unknown source drive -> min(8, max(4, CPU)); otherwise max(4, CPU). `shortcut: one pool for all drives, per-drive pools only if multi-drive scans are slow.`

### Console workflow
1. Double-click: if an undo list exists -> `Undo it [U] / New scan [Enter]`. Then folder picker (remembers last folder in `settings.json`) and `Add another folder [A] / Start scan [Enter]`.
2. Drop folders on the .bat -> scanned directly, no prompts. Drop files -> single-file check, always prints the result incl. GOOD, never moves.
3. Scan is read-only. Only non-GOOD files are printed: `[CORRUPT]` red, `[WARNING]` yellow, `[UNSUPPORTED]` gray, `[ERROR]` magenta, each with a reason line. Paths are OSC-8 links (Ctrl+click opens the file in Windows Terminal; plain text in old conhost). Progress via Write-Progress (throttled to 4/s). Summary table + files/s.
4. Visual suspects: `Review them now [R] / Skip [Enter]`; each image opens in the default viewer, `Damaged - allow moving it [D] / Not damaged [Enter]`.
5. `Move N corrupt file(s) ... [M] / Leave them [Enter]`, showing each `<folder>_CORRUPTED` target first.
6. Every run writes a new log: `Documents\Karpuzikov Tools\Corrupt Image Verifier\logs\{scan|check|undo}-YYYY-MM-DD-HH-MM-SS-xxxxxx.log`; the path is printed at the end.

### Classification contract (unchanged safety rules)
- CORRUPT: zero-byte file, or decoder failure **and** magic bytes that do not match the extension. HEIC/HEIF/AVIF/TGA/DIB are never CORRUPT by signature.
- WARNING: decoder failed with a valid signature; decoded with a damage-type warning (premature end, corrupt, truncated, CRC, huffman, invalid...); JPEG missing FF D9; visual-damage heuristic; decoder timeout (10 min). Benign decoder warnings (e.g. unknown TIFF tags) stay GOOD.
- UNSUPPORTED: decoder says no delegate / not supported.
- ERROR: missing file, symlink, permission/read failure, unreadable folder (reported, not silently skipped).
- Visual heuristic: same algorithm and thresholds as v1.1.7 (seam >= 30, saturation shift >= 0.40, max >= 0.65, rows 18%-82%) on a Box-resized sRGB raster, width min(160,W), height clamp 96-384. JPEG-family only, >=128 px.

### Move / undo contract (unchanged)
- Move re-checks size + mtime and re-classifies; manual visual confirmations must still be visual WARNINGs.
- Destination `<source parent>\<source name>_CORRUPTED\<relative path>` (drive root -> `D:\_CORRUPTED`). Copy to a private `.stage-<guid>`, byte compare, no-overwrite rename, undo record written, then original deleted. A failure after the copy removes the copy and the undo record if the original still exists.
- Undo manifest `undo\last_run.json` keeps the Python format (`version, run_id, created_at, sources, moves[original, moved_to]`), so undo lists from v1.x still work. Previous manifests go to `undo\history`. Undo never overwrites; failures stay in the list; empty quarantine folders are removed.

### Tests run (Linux, PowerShell 7.4.6 + ImageMagick 6.9 via a `magick` shim) - 2026-11-27
- PASS: scan of 37 fixtures: 30 good JPEGs + bracket name `IMG [1] copy.jpg` GOOD; zero-byte PNG and fake PNG CORRUPT; truncated JPEG WARNING (missing FF D9); glitched JPEG WARNING VISUAL DAMAGE SUSPECTED (seam 158 at 60%); bogus TIFF WARNING.
- PASS: visual review [R]/[D] -> move [M] -> 3 files in `photos_CORRUPTED` with relative paths; undo [U] restored all 3 and removed the empty quarantine folders.
- PASS: existing quarantine file -> `[LEFT IN PLACE] Destination already exists`, existing file untouched, other file moved; undo restored it.
- PASS: drop-files check prints GOOD and WARNING; payload extraction one-liner reproduces the script and it runs.
- HEIC was UNSUPPORTED only because the Linux ImageMagick lacks the codec; **HEIC on Windows ImageMagick is NOT RUN**.
- **NOT RUN on Windows:** the .bat bootstrap (winget install/weekly stamp, PATH discovery of magick.exe), FolderBrowserDialog, Windows Terminal links, real photo libraries (HEIC from iPhone, CMYK TIFF banners, nannerl_lee JPEGs), Get-PhysicalDisk worker sizing, speed on 100k files.

### Known limits
- `shortcut: paths containing & or ^ dropped on the .bat can be mangled by cmd's %*; double-click + folder picker handles them.`
- Ctrl+C stops a scan safely (read-only). Ctrl+C during a move can leave a `.stage-*` file next to a quarantine target; the original stays intact.
- Progress shows counts, not per-drive detail.

### Exact next action
1. User runs the .bat on Windows: first on a folder with the HEIC files from the v1.1.7 screenshot (`D:\Pictures\Liberman-laptop\Pictures\august`); confirm HEIC decodes as GOOD, then send the console output.
2. Check the v1.1.6/v1.1.7 regression fixtures listed below with the new engine.
3. Keep `Under construction ⚠️` until the user confirms.

## History before v2.0.0 (Python and Go versions - superseded, kept for context)

## Purpose and architecture
Single-file Python/Tkinter desktop verifier with a compact dark UI inspired by ReNamer 7.10, background per-physical-disk thread pools, queue-based GUI results, multiple folder sources, persistent Undo and heuristically flagged visual anomalies. Group multiple source folders on one physical drive under one worker allocation; different physical drives can scan concurrently. The canonical rules are repository-root SOFTWARE_RULES.md. No project-specific RULES.md was present during this update.

## Current safety workflow
1. Scan Images is read-only. Discovered image files are verified and categorized, then non-GOOD results are listed in a reviewable table.
2. Exactly five classification states: GOOD; WARNING - LEFT IN PLACE (including suspected JPEG visual anomalies); UNSUPPORTED - LEFT IN PLACE; ERROR - LEFT IN PLACE; CONFIRMED CORRUPT.
3. Only objective invalid-signature evidence after identification failure, or a zero-byte image, can currently produce CONFIRMED CORRUPT. TIFF decoder failures alone never prove corruption. Missing JPEG EOI, valid-looking but ambiguously truncated images, decoder errors and huge decompression-bomb warnings must stay in place.
4. Move Confirmed Corrupt is a separate confirmed action enabled only after a complete scan with candidates. All auto-confirmed candidates and explicitly user-confirmed visual suspects are eligible. Every candidate is rechecked before movement and skipped if its size/mtime has changed; manually confirmed visual suspects must still exhibit a visual-anomaly WARNING on recheck.
5. File move destination is the adjacent source-name_CORRUPTED sibling, retaining its relative hierarchy. Exclude directories ending _CORRUPTED during discovery and disallow them as user-selected sources.
6. Copy is staged privately, verified byte-for-byte, and published atomically without overwriting an occupied quarantine destination. Only after recording Undo does the original get removed. A crashed process can leave an orphaned .stage-* file; source remains intact during staging.
7. Undo Last Run uses persisted manifest and exclusive no-overwrite restore. Unresolved conflicts remain available. Previous manifests are archived in undo/history before new runs.
8. Separate progress stages, discovered/checked totals, elapsed time, throughput, drive/worker counts; source and results tables have mouse/keyboard OPEN cells before paths, and log paths have an adjacent clickable [DIR] tag. Review includes Preview Selected Image and Confirm Selected Visual Damage buttons. The latter is enabled only for visual warnings after a completed scan. Action controls are on two rows, stats wrap to a four-column grid, and content scrolls at smaller sizes. Removed forced Tk scaling.

## v1.1.6 visual-anomaly regression (2026-10-09)

User submitted two JPEG files:
- nannerl_lee-06022025-0002.jpg: 1358x1358 JPEG, valid FF D8 / FF D9, Pillow verify/load OK; FFmpeg decodes without errors. Visible severe lower-half green/red blocking; visual-anomaly detector flags strong horizontal seam at about 49% and anomalous saturation shift.
- nannerl_lee-06022025-0005(1).jpg: 1170x1169 JPEG, valid FF D8 / FF D9, Pillow verify/load OK; FFmpeg decodes without errors. Visible high-contrast yellow/green bands; detector flags abnormal horizontal seam around 69% and anomalous saturation shift.

New detector is a bounded (160 px across, max 384 px high) Pillow RGB heuristic measuring full-width abrupt row differences plus large saturation changes in image regions; no new package dependency. It is only run on successfully decoded JPEG-family files. Flagged files appear as WARNING - LEFT IN PLACE with the diagnostic reason and a Preview Selected Image action. The user may explicitly Confirm Selected Visual Damage after reviewing the image; this changes the selected result to CONFIRMED CORRUPT (MANUAL), making it eligible for a separate, confirmed Move Confirmed Corrupt action. Before moving, the candidate is checked for changed size/mtime and visual anomaly is recomputed; no auto-move on heuristic alone. It cannot establish whether damage is unintentional: deliberate glitch art and collage graphics can trigger it. **Never move an image just from this heuristic without user confirmation.**

Independent local detector regression on the two submitted files: BOTH FLAGGED. Six scikit-image reference photographs (astronaut, coffee, chelsea, rocket, cat, hubble_deep_field) were NOT flagged. Synthetic split-color graphic deliberately flags, documenting false-positive risk. This was a detector-level run, NOT an end-to-end execution of the GitHub .pyw app.

## v1.1.7 ReNamer-inspired UI and detection diagnostics

Reference supplied 2026-10-09: renamer-7.10.zip containing the ReNamer 7.10 portable Windows executable. Its bundled Copyrights.txt lists Virtual Treeview, SMComponents and other Pascal components. The app's interface has native toolbars, menus, file tables, status bars, and a split workflow layout. These specific Pascal/Delphi components cannot be dropped into Python Tkinter as-is. Use lightweight themed ttk equivalents, and do not copy the executable or icons.

v1.1.7 replaces the ASCII test UI (new user request overrides the older visual preference). It uses Segoe UI 9, dark ttk Treeview panes, drag-adjustable vertical splitter, a compact toolbar, native menu, Results/Activity tabs, real progress bar, and a fixed bottom status/stats area. Paths still have adjacent Open columns or clickable log controls.

New toolbar/menu action: **Check File** (Ctrl+F). Directly verifies a selected image in a background thread and always displays a result row, INCLUDING GOOD. This makes it possible to identify whether a file was skipped by folder discovery versus classified GOOD. Scanning remains read-only; only non-GOOD findings are in batch result rows for scalability. Scan logs show how many JPEGs were visually evaluated and how many were suspicious. Menu shortcuts are guarded against operations during active jobs.

New evidence: user reports *zero detected change* from v1.1.6 for two previous uploaded JPGs. Isolated reproduction of v1.1.6's exact detector against both real image files yielded visual warnings for BOTH (severe horizontal seams and saturation shifts); Pillow's verify and full load both pass. The GUI-level cause remains UNPROVEN. Do not assert this specific issue is resolved until Check File and a complete folder scan on the user's Windows system reproduce the warnings.

Visual heuristic sensitivity was adjusted from seam 32/color-shift 0.48/max-saturation 0.74 to seam 30/color-shift 0.40/max-saturation 0.65. An isolated detector check continued to flag both supplied JPEGs without flagging six independent normal reference photos. More varied real-world false-positive testing is still required. The full in-app classifier/run was not executed against real Windows files.

A native-style Tkinter layout prototype was instantiated at 1000x660 and 750x440 under Xvfb, but this is NOT a successful startup test of the full v1.1.7 code. The GitHub source received a structural delimiter/indent validation and a detected indentation issue was corrected. Full py_compile and real Windows GUI tests remain unverified. The isolated detector flagged both sample JPEGs and six independent normal reference photos were not flagged; neither result proves absence of false positives generally.

- Column sorting, context menu and DPI-responsive toolbar layout were added after the initial checkpoint.

## Dependencies and persistent storage
Pillow is required; pillow-heif and tifffile are optional decoders. Missing Python packages are installed using pip --target into the per-application dependencies folder, not global site-packages. winget is checked for availability; automatic missing-winget repair/installation remains incomplete. winget has no direct equivalent to the Python wheel packages.

Persistent directory: Documents\Karpuzikov Tools\Corrupt Image Verifier\
- dependencies\python\
- undo\last_run.json
- undo\history\*.json
- logs\startup-error.log

Resolve redirected Documents using the existing Windows registry method.

## Required regression test matrix
The following are required expected classifications; **v1.1.6 has NOT yet been executed against these real files**:
- GOOD: Баннеры на фасад_бок салатневый.tif; Баннеры на фасад_бок оранжевый.tif; Баннеры на фасад_лицо.tif. All are valid five-channel CMYK plus unassociated-alpha TIFFs, recognized by tifffile fallback. Historical v1.1.4 tests passed.
- CONFIRMED CORRUPT: p0080 (3).jpg with invalid JPEG start marker; zero-byte image. Historically v1.1.4 classified the former corrupt.
- WARNING - LEFT IN PLACE: fourteen visually intact but missing FF D9 JPEGs; huge/decompression-bomb images; ambiguous truncation; visual artifact suspects including both 2026-10-09 user-supplied nannerl_lee JPEGs.
- UNSUPPORTED - LEFT IN PLACE: missing HEIC decoder and unsupported TIFF compression.
- ERROR - LEFT IN PLACE: permissions/read failures.
- Successfully decoded valid image under a mismatched file extension remains GOOD.
- Scan must NEVER move files; move only candidates still confirmed corrupt at execution.
- Same-drive sources share worker pool, different-drive groups run concurrently.
- Move and Undo never overwrite an existing destination/original, even on interrupted operations; Undo restores exact bytes and retains conflicts. Manually confirmed visual suspects require TWO confirmations (manual promotion and explicit move) and rescanning must drop stale confirmation.
- Check stopping scan, stopping move, concurrent drive reads, path controls, UI focus and keyboard traversal. Check File must show explicit GOOD or flagged result even when image passes decoding.

## Mandatory UI / rule review
- Full UXDT guidelines at https://www.uxdt.nic.in/guidelines/ are mandatory. Relevant navigation, visual accessibility, accessibility testing, implementation and UX audit pages were consulted 2026-10-09.
- Latest user request supersedes ASCII test skin: mimic ReNamer's compact, dark native-style interface. Reuse lightweight Tk/ttk equivalents of native controls, without embedding ReNamer's proprietary compiled components.
- Every displayed filesystem path must have an adjacent open-location control, including source/result rows, logs, errors, Undo, moved paths, dialogs and diagnostics.
- Read and apply all current SOFTWARE_RULES.md; pre-existing violations are not grandfathered.
- Version must appear alongside Under construction ⚠️; maintain status until user confirms testing.

## Test status and known blockers
v1.1.7 implementation and README were committed to GitHub, but Windows tests and release certification remain **incomplete**:
- Remote source was inspected/modified through the GitHub connector; container network cannot reach raw.githubusercontent.com. The visual-anomaly helper was executed locally, but Python py_compile on the full remote .pyw and direct Windows execution remain unverified.
- Not verified: Tk GUI startup, 100/125/150/200% DPI, minimum-size layout, mouse/keyboard path open/preview/confirmation controls, all known real-image samples through the full application, collision/undo/interruption and worker scheduling regression tests.
- Whole-product/global UXDT and winget/bootstrap audit not yet complete; no claim of compliance.
- If final runtime testing exposes failures, fix them before removing Under construction ⚠️. Keep current state explicitly unfinished.

## Rejected approaches
- Pillow UnidentifiedImageError alone does not prove corruption, notably valid TIFFs.
- Do not move missing-EOI but visually intact JPEGs.
- Do not overwrite originals or existing quarantine destinations.
- Do not silently couple scan and file modification.
- Do not remove Undo. The user's new ReNamer-style GUI instruction explicitly replaces the earlier ASCII UI requirement.
- Do not hide software version behind its development status.

## Exact next action
1. Download current 1.1.7 file and run Python syntax compilation; fix any errors immediately.
2. Execute listed image fixtures including both nannerl_lee JPEGs through the application (expected WARNING with visual-anomaly reasons), and all copy/Undo collision and partial-interruption tests.
3. Run Check File on both user JPEGs, then Scan Images on their parent folder; verify visual warnings, Preview, user confirmation, Move, Undo and conflict behavior. Exercise Windows UI at 100/125/150/200% DPI, keyboard-only, window minimum, multi-drive workloads; complete missing-winget behavior.
4. Update source, README and this CONTINUITY.md together; mark stable only after user test confirmation.

## Native Win32 EXE prototype (2026-10-09, v1.2.0 NATIVE TEST)

User clarified that a native, lightweight Windows executable is required, rather than another Python/Tkinter GUI. The previous v1.1.7 NATIVE TEST.pyw was **not** a native build and does not satisfy this request.

A 64-bit Windows GUI prototype, "Corrupt Image Verifier v1.2.0 NATIVE TEST.exe", was cross-compiled from Go 1.23 standard library on Linux. Output: 2,496,512 bytes, Windows PE32+ GUI, no Python runtime or third-party DLL requirement. It is available as a conversation sandbox artifact, **not committed to GitHub**. Keep the canonical GitHub version/download unchanged until source and binary have been published and the Windows GUI/regression gates pass.

User's provided ReNamer 7.10 zip lists original Delphi/Pascal components including Virtual Treeview and SMComponents. These exact Delphi components were NOT reused: the prototype uses Win32 native common controls (owner-data SysListView32, Button, ProgressBar, menu, split panes, status and log views). This delivers a lightweight .exe and native component family, not binary-identical ReNamer component reuse.

Prototype functionality: multiple source folders; Explorer directory open control before table paths; single-file Check; read-only recursive Scan; visual JPEG anomaly warnings; explicit manual confirmation for visually damaged JPEGs; separate Move Confirmed; byte-verified no-clobber quarantine preserving relative paths; Undo Last Run with persisted JSON and historical records; no-overwrite Undo; drag-and-drop paths; stop; disk/SSD-HDD best-effort native Windows drive queries and per-drive worker pools. Prior Tkinter build remains available as a fallback.

Tests executed on Linux for the portable core: both user JPEGs report WARNING / VISUAL DAMAGE SUSPECTED (bands at ~49% and ~37%); zero-byte and invalid-signature JPEGs classify CONFIRMED CORRUPT; missing JPEG EOI remains WARNING; no-overwrite destination test passes; exact relative-path Move+Undo and occupied-original Undo tests pass. Windows x64 cross compilation succeeds. **Actual Windows GUI startup, native control behavior, 100/125/150/200% DPI and full real-world scan are UNTESTED.**

Critical missing parity: TIFF including five-channel CMYK+alpha, HEIF/AVIF, WebP, BMP, JPEG2000 and other nonstandard formats currently classify UNSUPPORTED in the Go prototype (except native Go-supported JPEG, PNG, GIF). This must be completed through native WIC and/or independent decoders before declaring the native app feature-equivalent. Physical disk identification relies on IOCTL queries that require Windows testing. More visual false-positive evaluation is needed. Do not mark the native prototype stable or update README's canonical download until these issues are addressed.

Exact next step: Windows-test the native EXE, first with single-file Check on both damaged JPEGs, then scan their containing folder; verify result rows, native UI, no-overwrite moves, Undo and test fixtures. Implement missing decoder parity, complete UI compliance, then publish versioned EXE and native source in the GitHub project and update README and this continuity file in the same checkpoint.

## Native Win32 UI redesign checkpoint (2026-10-09, v1.2.1 NATIVE TEST)

The user provided side-by-side screenshots comparing v1.2.0 with ReNamer Lite and rejected the previous UI. Concrete regressions: oversized/wrong font, default white Win32 menu and buttons, clipped toolbar captions, missing action icons, white top line, mismatched spacing and style.

v1.2.1 is an experimental, **local conversation artifact** at the versioned filename `Corrupt Image Verifier v1.2.1 NATIVE TEST.exe`; it is **not yet published on GitHub**, and v1.1.7 remains the canonical GitHub download. The Go source lives in the working container in `/mnt/data/civ_native/core.go`, `gui_windows.go`, `gui_skin_windows.go`, `core_test.go` (not yet committed to GitHub). Generated with Go x64 Windows GUI, stripped and CGO disabled. Do not mistake the temporary container source path for a persistent remote link.

Native UI changes: the stock light menubar was replaced with a custom dark File/View/Help navigation row and functional popup actions; Win32 buttons are now owner-drawn flat dark toolbar controls; primary/secondary toolbar actions receive individually drawn colorful GDI vector icons with disabled/focus/hover states; table headers use dark custom painting with Segoe UI ~9pt; compact two-row toolbar, results/activity tabs and visually unified footer/status/progress with charcoal palette modeled on the ReNamer screenshot. The original 1.2.0 scan/move/undo engine is retained. Width constraints computed for a minimum 600px outer window; final visual geometry requires a real Windows check. ReNamer's proprietary Delphi/VCL/Virtual Treeview binaries were **not** reused; this is a Win32-native equivalent, not literal component reuse.

Validation on 2026-10-09: `GO111MODULE=off go test ./...` passes on Linux; sample JPEG `nannerl_lee-06022025-0002.jpg` and `nannerl_lee-06022025-0005(1).jpg` each return WARNING VISUAL DAMAGE SUSPECTED; empty JPEG and invalid signature classify CONFIRMED CORRUPT; missing EOI returns WARNING; no-overwrite collision, move/Undo exactness, and occupied-original Undo pass. Cross-compile GOOS=windows GOARCH=amd64 CGO_ENABLED=0 produces a PE32+ Windows x64 GUI executable of about 2.5MB. **Windows UI launch has not been tested**, and the Delphi component stack is not identical. Decoder parity and 100/125/150/200% DPI remain blockers. Keep **1.2.1 - Under construction ⚠️**.

Exact next action: Have user launch v1.2.1 EXE and send screenshot, verify no clipped/white controls, interaction with menus and dark headers, compare against ReNamer, then test both real corrupt images via Check File and folder scan, and perform regression on missing image formats, Undo and multi-drive before publishing the native source/exe and updating canonical README.
