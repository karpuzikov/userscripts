# Corrupt Image Verifier - Continuity

## Product purpose

Windows GUI utility that recursively verifies image files and moves files classified as confirmed corrupt into a sibling `<source>_CORRUPTED` folder while preserving relative paths. The current UI is an ASCII/terminal-style dark GUI requested by the user.

## Current version and status

- Current development version: **1.1.4**
- Internal build label: `1.1.4-ASCII-TEST`
- GitHub status: **1.1.4 - Under construction ⚠️**
- Canonical downloadable source: `image-tools/corrupt-image-verifier/Corrupt Image Verifier v1.1.4 ASCII TEST.pyw`
- Active branch: `main`
- Older `v1.0.2` source is retained for history; README download must point to the current versioned file.

## Architecture

- Single-file Python `.pyw` Windows desktop application.
- Tkinter GUI.
- Background work uses `ThreadPoolExecutor` and a UI queue so verification does not run on the Tk event loop.
- Multiple source folders are supported.
- Source folders are grouped by detected physical disk; folders on one disk share a worker plan while different disks can process concurrently.
- Corrupt files are moved with original relative directory structure preserved.
- Undo state is persisted after every successful move so recovery survives app restarts.

## Dependencies

Current implementation uses Python, Pillow, pillow-heif and tifffile.

The application currently attempts dependency installation through `python -m pip`.

Known compliance blocker: the global software rules require the dependency/bootstrap flow to check/use winget where applicable and keep dependencies isolated for this application. That work is not yet complete.

## Persistent data

Application-owned persistent data belongs under:

`Documents\Karpuzikov Tools\Corrupt Image Verifier\`

Current uses include:

- `undo\last_run.json`
- `logs\startup-error.log`

Do not place application state directly under the shared `Karpuzikov Tools` root.

## Important behavior contracts

- Never delete corrupt files as the normal verification action; move them to `<source>_CORRUPTED`.
- Preserve relative folder structure.
- Never overwrite an existing original during Undo.
- Multiple paths may be scanned in one run.
- Worker allocation is drive-aware.
- A file must not be moved merely because one decoder does not support a valid image layout.
- TIFF fallback validation uses `tifffile` for TIFF layouts Pillow cannot identify.
- The user's valid 5-channel CMYK + unassociated-alpha TIFF files must classify as GOOD when full tifffile decoding succeeds.
- A file such as `p0080 (3).jpg` with an invalid JPEG signature must remain classifiable as corrupt.
- Unsupported decoder cases and ordinary access/I/O failures should remain in place rather than be moved as corruption.

## v1.1.4 TIFF fix

v1.1.4 adds an independent TIFF verification fallback. When Pillow raises `UnidentifiedImageError` for a TIFF with a valid TIFF signature, `tifffile` validates the TIFF structure and fully decodes every strip/tile. A successful fallback decode returns GOOD.

Regression samples verified before this GitHub upload:

- `Баннеры на фасад_бок салатневый.tif` -> GOOD
- `Баннеры на фасад_бок оранжевый.tif` -> GOOD
- `Баннеры на фасад_лицо.tif` -> GOOD
- `p0080 (3).jpg` -> CORRUPT, invalid JPEG signature

## UI/UX requirements

Global UI/UX rules come from the repository-root `SOFTWARE_RULES.md` and the complete current UXDT guideline tree.

Project-specific requirements:

- Keep the requested ASCII/terminal visual language unless the user asks to replace it.
- Dark theme by default.
- Status must be written exactly as `Under construction ⚠️`, separate from the version.
- Long operations must visibly show stage/activity/progress.
- Undo must remain available.
- Every displayed filesystem path must eventually use the repository-mandated adjacent open-location control.

## Known blockers / unfinished compliance work

v1.1.4 is intentionally still **Under construction ⚠️**. Known blockers include:

1. The corruption classifier is still too aggressive for some malformed-but-visually-decodable images, especially JPEGs missing only the EOI marker. Planned behavior is WARNING / LEFT IN PLACE unless corruption is confidently destructive.
2. Scan and move are currently coupled. Planned safer architecture is Scan -> Review -> Move Confirmed Corrupt.
3. Filesystem paths shown in source/results/log/dialog surfaces do not yet all have the mandatory adjacent open-location control.
4. Dependency bootstrap still uses direct pip installation rather than the required standardized dependency flow.
5. Accessibility/DPI/focus behavior still needs the planned compliance pass.
6. Full whole-product UXDT/global-rule release audit is not complete.

Do not remove `Under construction ⚠️` until these blockers are resolved and the user confirms testing.

## Rejected / failed approaches

- Do not classify every Pillow `UnidentifiedImageError` as corruption. This produced false positives for valid TIFFs.
- Do not use JPEG extension/signature checks alone to decide that every technically malformed but visually complete JPEG must be moved; tolerant-decode cases require a warning-safe policy.
- Do not remove the Undo mechanism or overwrite an existing original during restore.
- Do not collapse `Under construction ⚠️` into the version or use it instead of the version.

## Validation gates

Before a future build is treated as complete:

- Syntax-check the `.pyw`.
- Re-run known TIFF regression files.
- Re-run the known invalid-header JPEG.
- Add regression coverage for missing-EOI but fully decodable JPEGs, huge images, extension mismatches, permission errors, unsupported HEIC/HEIF decoder cases, zero-byte files and heavily truncated files.
- Test multi-source same-drive grouping and different-drive concurrency.
- Test Undo, including conflict/no-overwrite behavior.
- Audit every displayed filesystem path for the mandatory open-location control.
- Test keyboard-only operation, visible focus, DPI/text scaling and minimum-window resizing.
- Re-check current global rules and relevant current UXDT guidance.

## Current checkpoint

v1.1.4 is published to GitHub as the current test build. The TIFF false-positive bug reported by the user is fixed and regression-checked. The broader compliance/safety overhaul planned for the next update remains unfinished.

## Exact next action

Continue from v1.1.4 and implement the planned safety/compliance update: conservative warning classification, Scan -> Review -> Move Confirmed Corrupt, global path-display/open controls, standardized dependency handling, progress/accessibility/DPI fixes, then run the full regression/compliance gate.
