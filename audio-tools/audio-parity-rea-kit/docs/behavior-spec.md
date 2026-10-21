# Combined audio app: behavior specification, investigation checkpoint

Date: 2026-10-21. Status: application v0.01.01 experimental implementation (not accepted); remaining original parity remains research.

## Goal

One independent Windows application must perform the useful processing/reporting functions of DROffline MkII v2.2.3 and AudioChecker 2.0 build 457 with matching results. User requirements: full feature parity, identical outputs, broad audio-format support, dark UI, multithreading and a selectable worker count. Do not replace DR with crest factor or substitute generic FFmpeg metrics and call the result equivalent.

## Architecture under investigation

A shared input queue feeds two independent analysis modules and a deterministic report layer. The analysis implementation must follow measured original behavior. Input decoding must preserve native semantics; extended format adapters are a separate compatibility extension. The GUI is a compact PySide6 desktop window. Settings, dependencies, temporary work and operation logs are isolated under Documents/Karpuzikov Tools/Audio Analysis Suite.

Reusing the original engines could preserve their calculations, but that is a different product architecture from the earlier independent-implementation request. It must not be silently substituted. Native DLL export inspection establishes promising analysis entry points; it does not establish callable ABI correctness or complete-pipeline equivalence.

## Control contract for the proposed UI

| Control | Unique purpose and interaction | State, geometry and persistence |
| --- | --- | --- |
| Add sources | Add files/folders; drag/drop uses the same queue path; keyboard shortcut | Shared 32px-minimum target, visible focus; remembers browse location |
| DR / Authenticity toggles | Choose either or both requested analyses; Space toggles | Independent checked states; remembers selection; no duplicate mode selector |
| Workers spinbox | Bound parallel jobs from 1 to detected available CPU threads | Labeled accessible spinbox; saved value validated on next launch |
| Analyze / Stop | Explicitly starts work, then cancels active work and child processes | One changing action; disabled if queue empty/no analysis selected; cancellation retains completed results |
| Results table | Ordered per-file metrics, detection, stage and errors | Multi-select, keyboard navigation, stable sort, long-name ellipsis; no color-only state |
| Open location before displayed paths | Reveal exact source or containing directory | Shared adjacent icon/control with accessible label, 32px minimum target |
| Export | Write requested original-compatible TXT/TSV reports | Enabled when appropriate; explicit destination and collision recovery |
| Settings | Original compatibility parameters and report column/preset selection | Compact accessible panel; no speculative settings or repeated prompts |
| Status/progress | Completed/total files, active work and failures | Necessary feedback, not duplicated percentages or tutorials |

Exact controls and dimensions must be reconciled with the original full feature inventory before implementation. This contract is proposed, not a rendered/accepted UI.

## Required original features

DROffline: per-file/folder/recursive analysis, all documented measurements including channel values, original presets and column selection, text/TSV reports, main/folder report behavior, project/artist/engineer/studio metadata, destination control, cancellation, rejected-input behavior, album/file counts and aggregate DR.

AudioChecker: same classification/confidence/unknown outcomes and detector settings, decoder and PCM preparation rules, batch/album conclusion, supported file/folder and optical CD workflows where present, logs, selection and cancellation. The full GUI inventory still needs native observation.

Do not silently omit an original feature because it is difficult. Record remaining gaps.

## Exact-output acceptance

Numerical display strings and report bytes must match under the same inputs, settings, path and run context. No timestamps, headers, signs, Unicode text, whitespace, line endings or fields are implicitly normalized or ignored. Broader testing must include real audio, not only the 29 synthetic inputs.

The recovered raw report is UTF-8 without BOM with 30 CRLF line endings, 23 metric rows, a file count of 23 and album DR 1. This describes that file only; it does not establish every report variant's encoding or metadata.

## Open blockers

Missing complete original report variants/fields and AudioChecker golden outputs; no successful native reference execution in this environment; no working REA native provider here; experimental DR/BS.1770/spectral modules now exist in Audio_Analysis_Suite_v0.01.00.pyw, but exact original algorithms and reporting remain unimplemented; PySide6 GUI exists as source but native Windows UI acceptance is NOT RUN. The earlier Audio File Metrics 0.1.0 is not a completed replacement.


## v0.01.01 automatic output contract

On Analyze/Stop completion, the program now writes reports **without an Export click** in every analyzed album's source folder, one DR `<folder>_log.txt` and/or one `audiochecker.log`, according to the analysis toggles. Input-order stable under concurrency. Existing unowned report files are preserved, with a recognizable fallback basename. UTF-8 no BOM and CRLF. Failures are surfaced in the GUI/CLI. Reports are not numerically guaranteed to match originals; experimental status is printed. Original per-folder output layout for the default seven DR columns has regression evidence; full original report variants and authenticity probability are NOT IMPLEMENTED.

## Current compatibility status (2026-10-21)

auCDtect engine 0.8.2 is reused and explicitly disclosed. It is not an independent replacement for AudioChecker's detector. AudioChecker GUI flags/PCM conversion and final numeric signed report verification value are unknown. Authenticity output now uses actual detector text and original-style compact report, but native Windows results are not yet verified. See docs/vultures-2-parity.md for the user's reference dataset. DR TPL and one SKY CITY DR differ on previous application; original full-output parity remains blocked.
