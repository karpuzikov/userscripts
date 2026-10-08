# Corrupt Image Verifier - Continuity

## Current version, status, links
- **Development version:** 1.1.5
- **Internal build:** 1.1.5-ASCII-TEST
- **Status:** **1.1.5 - Under construction ⚠️**
- **Branch:** main of karpuzikov/userscripts
- **Source:** image-tools/corrupt-image-verifier/Corrupt Image Verifier v1.1.5 ASCII TEST.pyw
- **Download:** https://raw.githubusercontent.com/karpuzikov/userscripts/main/image-tools/corrupt-image-verifier/Corrupt%20Image%20Verifier%20v1.1.5%20ASCII%20TEST.pyw
- v1.1.4 and v1.0.2 remain as historical sources. Keep README linked to the current versioned source.

## Purpose and architecture
Single-file Python/Tkinter desktop verifier with requested ASCII/terminal dark UI, background per-physical-disk thread pools, queue-based GUI results, multiple folder sources, persistent Undo. Group multiple source folders on one physical drive under one worker allocation; different physical drives can scan concurrently. The canonical rules are repository-root SOFTWARE_RULES.md. No project-specific RULES.md was present during this update.

## v1.1.5 safety workflow
1. Scan Images is read-only. Discovered image files are verified and categorized, then non-GOOD results are listed in a reviewable table.
2. Exactly five classification states: GOOD; WARNING - LEFT IN PLACE; UNSUPPORTED - LEFT IN PLACE; ERROR - LEFT IN PLACE; CONFIRMED CORRUPT.
3. Only objective invalid-signature evidence after identification failure, or a zero-byte image, can currently produce CONFIRMED CORRUPT. TIFF decoder failures alone never prove corruption. Missing JPEG EOI, valid-looking but ambiguously truncated images, decoder errors and huge decompression-bomb warnings must stay in place.
4. Move Confirmed Corrupt is a separate confirmed action enabled only after a complete scan with candidates. Every candidate is rechecked before movement and skipped if its size/mtime has changed.
5. File move destination is the adjacent source-name_CORRUPTED sibling, retaining its relative hierarchy. Exclude directories ending _CORRUPTED during discovery and disallow them as user-selected sources.
6. Copy is staged privately, verified byte-for-byte, and published atomically without overwriting an occupied quarantine destination. Only after recording Undo does the original get removed. A crashed process can leave an orphaned .stage-* file; source remains intact during staging.
7. Undo Last Run uses persisted manifest and exclusive no-overwrite restore. Unresolved conflicts remain available. Previous manifests are archived in undo/history before new runs.
8. Separate progress stages, discovered/checked totals, elapsed time, throughput, drive/worker counts; source and results tables have mouse/keyboard OPEN cells before paths, and log paths have an adjacent clickable [DIR] tag. Content scrolls at small window sizes. Removed forced Tk scaling.

## Dependencies and persistent storage
Pillow is required; pillow-heif and tifffile are optional decoders. Missing Python packages are installed using pip --target into the per-application dependencies folder, not global site-packages. winget is checked for availability; automatic missing-winget repair/installation remains incomplete. winget has no direct equivalent to the Python wheel packages.

Persistent directory: Documents\Karpuzikov Tools\Corrupt Image Verifier\
- dependencies\python\
- undo\last_run.json
- undo\history\*.json
- logs\startup-error.log

Resolve redirected Documents using the existing Windows registry method.

## Required regression test matrix
The following are required expected classifications; **v1.1.5 has NOT yet been executed against these real files**:
- GOOD: Баннеры на фасад_бок салатневый.tif; Баннеры на фасад_бок оранжевый.tif; Баннеры на фасад_лицо.tif. All are valid five-channel CMYK plus unassociated-alpha TIFFs, recognized by tifffile fallback. Historical v1.1.4 tests passed.
- CONFIRMED CORRUPT: p0080 (3).jpg with invalid JPEG start marker; zero-byte image. Historically v1.1.4 classified the former corrupt.
- WARNING - LEFT IN PLACE: fourteen visually intact but missing FF D9 JPEGs; huge/decompression-bomb images; ambiguous truncation.
- UNSUPPORTED - LEFT IN PLACE: missing HEIC decoder and unsupported TIFF compression.
- ERROR - LEFT IN PLACE: permissions/read failures.
- Successfully decoded valid image under a mismatched file extension remains GOOD.
- Scan must NEVER move files; move only candidates still confirmed corrupt at execution.
- Same-drive sources share worker pool, different-drive groups run concurrently.
- Move and Undo never overwrite an existing destination/original, even on interrupted operations; Undo restores exact bytes and retains conflicts.
- Check stopping scan, stopping move, concurrent drive reads, path controls, UI focus and keyboard traversal.

## Mandatory UI / rule review
- Full UXDT guidelines at https://www.uxdt.nic.in/guidelines/ are mandatory. Relevant navigation, visual accessibility, accessibility testing, implementation and UX audit pages were consulted 2026-10-09.
- Retain user-requested ASCII skin and dark theme.
- Every displayed filesystem path must have an adjacent open-location control, including source/result rows, logs, errors, Undo, moved paths, dialogs and diagnostics.
- Read and apply all current SOFTWARE_RULES.md; pre-existing violations are not grandfathered.
- Version must appear alongside Under construction ⚠️; maintain status until user confirms testing.

## Test status and known blockers
v1.1.5 implementation and README were committed to GitHub, but Windows tests and release certification remain **incomplete**:
- Remote source was inspected through GitHub. Python py_compile and direct Windows execution could not be performed in the available environment.
- Not verified: Tk GUI startup, 100/125/150/200% DPI, minimum-size layout, mouse/keyboard path open controls, all known real-image samples, collision/undo/interruption and worker scheduling regression tests.
- Whole-product/global UXDT and winget/bootstrap audit not yet complete; no claim of compliance.
- If final runtime testing exposes failures, fix them before removing Under construction ⚠️. Keep current state explicitly unfinished.

## Rejected approaches
- Pillow UnidentifiedImageError alone does not prove corruption, notably valid TIFFs.
- Do not move missing-EOI but visually intact JPEGs.
- Do not overwrite originals or existing quarantine destinations.
- Do not silently couple scan and file modification.
- Do not remove Undo or replace the ASCII UI without request.
- Do not hide software version behind its development status.

## Exact next action
1. Download current 1.1.5 file and run Python syntax compilation; fix any errors immediately.
2. Execute the listed image fixtures and all copy/Undo collision and partial-interruption tests.
3. Exercise Windows UI at 100/125/150/200% DPI, keyboard-only, window minimum, multi-drive workloads; complete missing-winget behavior.
4. Update source, README and this CONTINUITY.md together; mark stable only after user test confirmation.
