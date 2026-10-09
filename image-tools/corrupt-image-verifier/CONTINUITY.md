# Corrupt Image Verifier - Continuity

## Current version, status, links
- **Development version:** 1.1.7
- **Internal build:** 1.1.7-NATIVE-TEST
- **Status:** **1.1.7 - Under construction ⚠️**
- **Branch:** main of karpuzikov/userscripts
- **Source:** image-tools/corrupt-image-verifier/Corrupt Image Verifier v1.1.7 NATIVE TEST.pyw
- **Download:** https://raw.githubusercontent.com/karpuzikov/userscripts/main/image-tools/corrupt-image-verifier/Corrupt%20Image%20Verifier%20v1.1.7%20NATIVE%20TEST.pyw
- v1.1.4 and v1.0.2 remain as historical sources. Keep README linked to the current versioned source.

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
