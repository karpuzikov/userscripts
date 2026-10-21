# Task for a local Codex session with REA

Build one Windows app combining the functionality of MAAT DROffline MkII 2.2.3 and AudioChecker 2.0 build 457. The user's requirement is full feature parity and identical numerical/report output, broad audio-format support, a compact dark theme, and selectable concurrent workers. Preserve the earlier request for an independent implementation: do not quietly substitute a generic meter or a dependency on the original paid app as the completed product.

Start by reading CONTINUITY.md, SOFTWARE_RULES.md, UI_UX_RULES.md and docs/behavior-spec.md. Follow the user's explicit scope and work autonomously. Do not create GitHub Actions. Do not change the source audio, installed app settings, activation files, or licensing behavior.

## Inputs already present

- `Targets/DROffline/DROffline MkII.exe`, PE x64, file version 2.2.3.0.
- `Targets/DROffline/libMAATDROffline2.dll`, PE x64, file version 2.2.3.0.
- `Targets/AudioChecker/achkgui.exe`, PE x86, file version 2.0.0.457.
- `Targets/AudioChecker/Codecs/Analyzer/aucdtect.exe`, PE x86, embedded version text 0.8.2.
- Original report presets under `Targets/DROffline/Presets/`.
- `Reference/Audio Tests/`: 29 unchanged generated fixtures.
- `Reference/Audio Tests_log.txt`: the user's original 23-row default-column report, retained byte for byte.
- `Reference/droffline-golden.json`: display strings parsed from that report.
- `Reference/manifest-original.json`: original fixture generation and identity metadata.
- `evidence/static-inspection.json`: hashes, exported symbols and observed command-line strings.

Verify hashes first. The two DROffline hashes match the official-component hashes recorded by the previous investigation. This session has not redownloaded the vendor package.

## REA readiness

Use a working local native provider, preferably Ghidra. The official Windows guide currently requires a full supported JDK and Ghidra installation; confirm current requirements from the linked guide. REA 6.7.0 was downloaded in the cloud investigation, but its process-ownership probe failed before provider analysis. No successful REA decompilation is included.

The documented CLI entry points are:

```powershell
rea doctor --provider ghidra --json
rea analyze ".\Targets\DROffline\libMAATDROffline2.dll" --provider ghidra --json
rea analyze ".\Targets\DROffline\DROffline MkII.exe" --provider ghidra --json
```

Use the connected REA MCP for adaptive queries rather than repeatedly importing the binaries. Save evidence and snapshots so work can resume without repeating the import.

## Investigation priorities

1. Trace the original EXE's complete per-file pipeline and report writer, not merely the DR formula. Recover the input float/integer scaling, channel interpretation, block sizes, treatment of the final incomplete block, decoder behavior, minimum duration, rounding, floors, signs, and per-album aggregation.
2. In the DLL inspect these exact exported entry points and their callers:
   - `?prepare@DynamicRangeValuesOffline@DSP@@QEAAXHN@Z`
   - `?getBlockSize@DynamicRangeValuesOffline@DSP@@QEBAHXZ`
   - `?processBlock@DynamicRangeValuesOffline@DSP@@QEAAXPEAPEBMH@Z`
   - `?getDR@DynamicRangeValuesOffline@DSP@@QEBANH@Z`
   - `?getCompositDR@DynamicRangeValuesOffline@DSP@@QEBANXZ`
   - `?getAlbumDR@DynamicRangeValuesOffline@DSP@@SANAEBV?$vector@NV?$allocator@N@std@@@std@@@Z`
   - `?getAvgRMS_dB@DynamicRangeValuesOffline@DSP@@QEBANH@Z`
   - `?getMaxPeak_dB@DynamicRangeValuesOffline@DSP@@QEBANH@Z`
   - `?prepareForOffline@LUFSProcessor@DSP@@QEAAXNHH@Z`
   - `?processOfflineAudio@LUFSProcessor@DSP@@QEAAXAEBV?$AudioBuffer@M@juce@@@Z`
   - `?processOfflineIntegration@LUFSProcessor@DSP@@QEAAXXZ`
   - `?getChannelLUFSValue@LUFSProcessor@DSP@@QEBAMW4LoudnessType@12@_K@Z`
   - `?getCombinedMinPeakToLoudnessRatioValue@LUFSProcessor@DSP@@QEAAMW4LoudnessType@12@_N@Z`
   - The BitsUsed constructors, resetAndPrepare, process and getNumBitsUsed exports.
3. Establish how the EXE calculates true peak and whether any metering remains in the EXE outside those exports. The DLL alone has not been established as the entire engine.
4. Map all 27 columns in the All In for Stats Nerds folder preset to exact labels, metrics, units, order and formatting. Determine main/folder TXT and TSV layouts, project/engineer/studio metadata, destination behavior, ordering and rejection reporting. Preserve all meaningful original features.
5. In AudioChecker, trace the process-creation call that launches auCDtect: exact detection mode, flags, decoding, temporary PCM format, mono/stereo handling, timeout/error interpretation, authenticity percentages, unknown outcomes, batch/album conclusion, and generated report bytes. The engine supports `-mS` with S=0..40 and its own default 8, `-v`, `-d`, and `--` stdin. Do not infer that the GUI uses the CLI default. Album conclusion is an engine operation, not an assumed arithmetic average of percentages.
6. Inventory and preserve AudioChecker's file/folder/Audio CD workflows, supported codecs, result selection, cancellation, logs and any material settings. Observe the actual interface; the current inventory is not a full feature-parity audit.
7. Produce a behavior specification from observations and tests. Do not copy proprietary implementation code into the new app or alter licensing. If a genuinely independent replacement for auCDtect cannot yet match, report that blocker; original-engine reuse must be explicit and must not be called an independent implementation.

## Existing measurements and missing evidence

- Exactly 23 rows of max true peak, integrated loudness, and integer DR are already available.
- Silence: max TPL -100.00, LUFSi -128.00, DR 0.
- Noise: DR 2; isolated peaks: DR 28; square wave and DC: DR -3.
- The intersample-peak fixture is +1.93 dBTP and DR -1. Do not cap true peak at zero or clamp DR to nonnegative values.
- Album count 23; displayed album DR 1. Do not assume this one case proves the aggregation formula.
- Six rejected cases (12-15 and 18-19) were reported as shorter than 10 seconds. Cases 18/19 are short because of their frame counts; these rejections do not establish lack of 192/384 kHz support.
- Existing report has only the default subset. Additional per-channel, LRA, momentary, short-term, PSR, bits-used and metadata fields, plus exact TSV and AudioChecker outputs, remain unverified.
- Collect missing outputs using the installed original, preserving the existing report. Generate additional >10-second fixtures where needed. Save the settings, input hashes, raw bytes and rejection details together.
- Include genuine music with different dynamics and lossy/transcoded sources for AudioChecker. Synthetic fixtures alone do not validate authenticity detection.

## Implementation and acceptance

Implement the independently specified processing/report components before claiming equivalence. Build the Windows GUI with PySide6 by default, never Tkinter. One versioned .pyw entry point or a compact packaged executable; no unrelated features. The toolbar needs source selection/drag-drop, analysis selection, a worker count, and one Analyze/Stop action. Keep advanced parity settings available without crowding the main view.

Use bounded parallel work, one isolated temporary workspace per worker, deterministic output ordering, safe cancellation and remembered worker count. Do not impose the old unrelated four-worker limit. Avoid uncontrolled nested FFmpeg threads.

Support audio that the selected decoders can actually read; publish a tested format/encoding matrix. Preserve native input semantics for parity. Extended formats that the originals do not accept need an explicit canonical-PCM comparison protocol; do not silently resample/downmix and then claim original-input parity. Encrypted/protected/corrupt inputs must produce clear unsupported/error outcomes.

Validate every available metric, rounding rule and report byte against original outputs in the same context. A finite test corpus supports regression evidence, not a mathematical guarantee over every possible file. Record PASS/FAIL/NOT RUN separately. Native Windows rendering, keyboard/pointer actions, resize/scaling, cancellation, restart and settings persistence must be tested. Keep version plus Under construction status until the requirements pass and the user accepts.

## Return to this conversation

Save `REA_FINDINGS.md`, `behavior-contract.json`, target hashes, relevant REA evidence/snapshots, raw reference reports/settings, and exact parity results under `Findings/`. Include unresolved fields and any failed attempts. If app implementation is also completed locally, include source, build procedure and honest validation status. Zip the Findings folder for the user to upload back here.

