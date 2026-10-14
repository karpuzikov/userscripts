# Archive Media Compressor - Continuity

## Purpose and current baseline
- Product: Archive Media Compressor, under `karpuzikov/userscripts/archive-media-compressor/`.
- Current working build: `ArchiveMedia v6.00.15.bat` (semantic version 6.0.15), **Under construction ⚠️**, published on the default `main` branch. Previous build: `ArchiveMedia v6.00.14.bat`.
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

## UI simplification preflight - 2026-10-14
- GitHub `SOFTWARE_RULES.md` and `UI_UX_RULES.md` now require radical simplicity, minimal clicks, smart defaults, remembered choices, short labels, direct actions, no repetitive instructional text, and preservation of safety/accessibility. The user's current personalization instructions impose the same constraints. The ChatGPT appearance setting is not used to override native Windows UI preferences.
- UI walkthrough for v6.0.15: mode selection requires a menu plus a numeric answer, then FolderBrowserDialog for source and (in Copy mode) another FolderBrowserDialog for destination; all pickers reopen without remembering the previous selection. Two explanatory mode paragraphs and repeated mode/path labels add clutter. Console is currently used for progress/output.
- Control contract: **Mode** is a single keyboard choice; default must be Copy on Enter, Replace must require explicit R, Cancel/invalid input must not cause replacement. **Source** is the existing Windows FolderBrowserDialog or keyboard fallback; preselect last used existing source, validate selected folder, cancellation aborts. **Destination** appears only in Copy, preselect last valid destination or source parent, validate distinct from source, cancellation aborts. **Status** remains compact and actionable; preserve stage/progress/errors and file-level results. Settings are stored only in `Documents\\Karpuzikov Tools\\ArchiveMedia\\settings.json` and must never be essential for startup. No new dialogs, settings windows or nested menus.
- Acceptance: compared with v6.0.15, Copy requires one fewer keyboard character and no menu-reading step; folder pickers start at familiar locations; Replace is never the default. Verify remembered paths, malformed JSON handling, unchanged file handling, and no accidental writes to source under Copy.
- Applicable UXDT principles: reduce redundant steps and text; preserve accessible/native folder picker and clear error recovery. **Open-location control before each console-printed path remains a known platform limitation** (ordinary console lines have no cross-host clickable controls). The existing console-based UI cannot claim full compliance with the repository's mandatory clickable-path rule without an intentional native GUI redesign.
- Target implementation v6.0.16 - Under construction; Windows native interaction/run tests must be recorded as NOT RUN until performed.

## Relevant standards and rules
- `SOFTWARE_RULES.md`, `UI_UX_RULES.md`, `UI_UX_ACCEPTANCE.md` at repository root; UXDT complete guideline tree. This product has an interactive Windows console UI, with prompt, progress and action status surfaces.
- Windows native runtime and interactive acceptance tests cannot be inferred from source inspection or static validation.

## Defect and correction (2026-10-14)
- Reported v6.0.13 `[REMUX]` AVI and MOV files increased in size; e.g. `CD1E.MOV` 93.71 MiB to 160.39 MiB, and multiple `Gogo` AVI files became roughly 8-14 MiB larger.
- Verified from embedded PowerShell: below-bitrate non-MP4 material is planned as `RemuxVideo`; remux tries stream copy, then AAC 128k fallback, then full transcode, but all retain `RemuxVideo` label. After writing the temp result, code unconditionally moves it to the output and in Replace mode deletes the original on a differently named path. There is no output-byte-size gate.
- Implemented v6.0.14 temporary-payload PowerShell patch with a pre-commit guard on `ConvertPhoto`, `RemuxVideo` and `EncodeVideo` results. If candidate length >= source length, immediately delete the candidate. In Replace mode return a successful `Skip` and preserve the original. In Copy mode copy source bytes into output using original relative path/extension with atomic `FileMode.CreateNew` so an existing file cannot be overwritten. Each outcome records accurate action/size in the success results and log. An output collision is treated as failure without destroying the source. This patch runs after v6.0.13's existing embedded-source integrity/worker corrections and runs a second PowerShell parser check before starting the main program.
- The v6.0.14 BAT retains the exact existing embedded ZIP/Base64 payload; new source behavior is inserted into its temporary extracted `ArchiveMedia.ps1` on launch. This is a safety hotfix pending a future cleanup/repackaging of the fragile runtime-patch architecture.

## Change: v6.0.15 concise SKIP log (2026-10-14)
- User confirmed skip-log output should be limited to `[SKIP] <source path>`. The previous redundant `[7.38 MiB] -> [7.38 MiB] 0 B saved` suffix is removed only for actual `Skip` actions. Other actions keep meaningful before/after sizes and saved-byte deltas.
- Retained the 6.0.14 embedded ZIP and existing size-growth safety gate unchanged. A new startup PowerShell patch injects an early `if ($Action -eq 'Skip')` branch into `Write-FileResultLine` immediately after the action label is calculated; it prints label and path and returns. The patch validates unique marker presence and PowerShell parse syntax before execution.
- Filename: `archive-media-compressor/ArchiveMedia v6.00.15.bat`. Repo README and project README updated.
- Source-level static checks: **PASS**, startup command max length 7,272 characters; original ZIP payload unchanged; new early SKIP branch retained; older no-growth guard retained. Actual Windows execution / log verification: **NOT RUN**.

## Validation
- Source, embedded PS1 analysis, README and applicable repository rules inspected through authenticated GitHub connector (2026-10-14).
- Static tests **PASS**: downloaded new 39,740-character BAT exists; the safety patch Base64 decodes to the intended source; the new command line is 7,272 characters before expansion (within the 8,191-character CMD line limit); guards verify size before source replacement, distinguish Copy/Replace modes, copy under original extension, and use `CreateNew` to prevent overwrites; original payload marker/base64 retained; Windows PowerShell syntax validation is built into startup (execution NOT RUN).
- WARNING: nonempty real-world files can be remuxed with unchanged streams but larger container/audio; the guard prevents retention, not the underlying FFmpeg muxing size increase. Some v6.0.13 outputs may already need manual review/cleanup.
- Windows .bat execution, PowerShell 7 parsing, FFmpeg end-to-end on the user's MOV/AVI, Replace-mode regression, disk-collision tests and interactive console acceptance: **NOT RUN**.
- Never describe an untested code checkpoint as stable.

## Next actions
1. On Windows run v6.0.15 with a separate empty output folder in **Copy** mode, using examples from the user's MOV/AVI list. Verify that files with unsuccessful remuxes are copied unchanged with `.MOV`/`.avi` extensions, without any larger `.mp4` candidate retained. Hash originals before/after. Verify output folder size does not exceed source folder size for successfully processed items (unless duplicate output and error-log metadata are included).
2. Test Replace mode only on expendable duplicate fixtures: oversized candidate => source hash unchanged; genuinely smaller candidate => new output retained and original removed only after success. Test collisions, reruns, interrupted FFmpeg/cancel, snapshots and errors.
3. Check actual PowerShell syntax validation and startup, user prompt/progress status, copy/replace summaries, source timestamps, Unicode names, and Windows UI interaction. Validate that `[SKIP]` omits all size text while actual conversion results still show saved bytes. Record genuine Windows PASS/FAIL for these tests. Do not mark stable without those results.
4. Consider replacing the accumulated runtime source string patches with a clean, separately testable embedded PowerShell source in a later version after parity validation. Do not revive broken parser or label-based BAT control flow.
