# Combined DROffline and AudioChecker app - continuity

Checkpoint: 2026-10-21.
Application status: NOT IMPLEMENTED. No application version/repository/release created.
Investigation kit: 0.1.1 (filename v0.01.01), Under construction.

## User goal

Create one independent Windows application combining DROffline MkII v2.2.3 and AudioChecker with full feature parity and identical results/reports. Support broad audio formats, compact default-dark UI, multithreading and selectable worker count. Earlier DROffline work explicitly required independent/clean-room behavior compatibility. The user offered morluto/rea to help and selected the GitHub plugin.

Never substitute an approximate meter. Never silently cap/clamp measurements, drop original features, invent unsupported format claims, or call finite regression coverage universal proof.

## Work completed

- Read current canonical SOFTWARE_RULES.md, UI_UX_RULES.md and UI_UX_ACCEPTANCE.md using the GitHub connector. Root SOFTWARE_RULES.md and UI_UX_RULES.md in this kit retain those exact fetched contents.
- Inspected the two current uploads. AudioChecker GUI file version is 2.0.0.457, and its included auCDtect binary advertises 0.8.2.
- Extracted the original DROffline EXE/DSP DLL and the two useful report presets using innoextract 1.9.
- Verified both extracted component hashes against the official-component identities recorded in the earlier parity manifest. The earlier official download comparison is not represented as a fresh vendor-download verification.
- Inspected the DLL's 64 PE exports and selected function disassembly with GNU objdump. No replacement product code was written, no license/activation behavior was altered, and no successful runtime invocation of the DSP functions occurred.
- Recovered the existing DR-Parity-Reference-Pack-v0.01.00.zip and the actual user Audio Tests_log.txt. Preserve these exact inputs and outputs; do not repeat work merely because the earlier session could not materialize the TXT.
- Parsed 23 existing metric rows into droffline-golden.json. Preserved negative DR values, positive over-full-scale true peak and display strings.
- Identified that the six prior rejected files were under 10 seconds. The 192/384 kHz fixtures' short lengths must not be mistaken for evidence that the sample rates are unsupported.
- Confirmed the All In for Stats Nerds folder preset contains 27 visible columns, while the current user report has only seven displayed metadata/metric columns.
- Prepared a concrete local REA task and retained exact targets/references without unrelated historical user logs.

## Relevant files

- REA_TASK.md: exact local task, symbol targets, expected findings and acceptance.
- docs/behavior-spec.md: requested behavior, architecture options and proposed control contract.
- evidence/static-inspection.json: current hashes, native export inventory, CLI observations and execution limitations.
- Reference/Audio Tests/: 29 unchanged source fixtures.
- Reference/Audio Tests_log.txt: raw original 23-row report.
- Reference/droffline-golden.json: parsed display strings and rejection metadata.
- Reference/manifest-original.json: prior provenance/fixture hashes.
- Targets/: selected user-provided components for static local investigation.

Original Library identities retained for continuity:
- Current Audio Checker(1).zip: libfile_82e189a4cc1081919af98d3655adb69f.
- Current Setup DROffline MkII v2.2.3(2).exe: libfile_2955f2bd893c8191a817d13da24f6005.
- Existing Audio Tests_log.txt: libfile_3fecee38849c81919999f61bacc633f9.
- Existing DR-Parity-Reference-Pack-v0.01.00.zip: libfile_d927388454308191b784466110ae751e.

GitHub reads: karpuzikov/userscripts global rules, TRRNT-project tool inventory, morluto/rea README and native/CLI guides. Canonical checkpoint location: karpuzikov/userscripts, branch main, audio-tools/audio-parity-rea-kit/. This is an investigation checkpoint, not an application release. The requested GitHub upload is verified separately after the commit is published.

## Environment and failed attempts

Host: Linux; FFmpeg/ffprobe and GNU objdump available. No native Windows host, Wine, or Ghidra present.
- apt-get install --no-install-recommends wine64 failed: package unavailable. No sandbox change attempted.
- REA 6.7.0 was downloaded with npm and invoked via its providers command.
- Native provider readiness failed because the host's process inspection cannot run REA's required procps-compatible command: ps -axo pid=,ppid=,pgid=,uid=,stat=,command=; error: fatal library error, lookup self.
- Do not replace or spoof REA's process-ownership check. Use the user's actual Windows environment for native investigation.
- Earlier reference-pack continuity also recorded a Wine socket restriction. That old result is historical; this checkpoint did not execute Wine.
- UXDT index retrieval timed out/unavailable. Fluent 2 layout/accessibility guidance was read. Do not claim complete UXDT verification.

## Verification status

Kit/source/fixture identity checks: see evidence/verification.json.
Native original-program measurements in this environment: NOT RUN.
Independent replacement numerical parity: NOT RUN.
All-column/TXT/TSV report parity: NOT RUN.
AudioChecker classification/report parity: NOT RUN.
New application feature parity: NOT RUN.
New application native Windows visual/interaction acceptance: NOT RUN.

Do not label the new application complete, fixed, stable or accepted.

## Exact next action

On the user's Windows PC, open the extracted kit in local Codex with REA/Ghidra configured and direct it to read REA_TASK.md. Retain the already collected 23 measurements, trace complete pipelines/report writing, collect only missing reference fields/outcomes, and save findings plus evidence/raw reports under Findings/. Return that folder to the current conversation. Then implement the independent modules and dark worker-selectable GUI and run differential/native acceptance.

Do not ask the user to re-upload inputs already present in this kit. Do not create GitHub Actions. Preserve original audio and application settings.


## GitHub closeout and archive failure - 2026-10-21

The user reported Windows Explorer rejecting Audio_Parity_REA_Kit_v0.01.00.zip.
The screenshot was successfully read locally. Fresh inspection found the ZIP
was 6,364,623 bytes, SHA-256 3154bf45c3684e80881c1027489bdb440cea469285cabd82887d595578e5f397,
and had no ZIP end-of-central-directory record. The earlier generation check
recorded 6,633,377 bytes and SHA-256 c67dbddee6c1643048992f7b14b543976bb6c0ade36e1a0c2924bcd630b601f6.
The later copy is truncated. When/where its bytes changed has not been established.
Do not present this as a Windows filename or compression compatibility problem.

The extracted source folder passed its complete original 68-file hash check.
The user first stopped the repair, then explicitly asked to upload all work
to GitHub and produce a handoff. Archive 0.1.1 is rebuilt from these verified
source files using atomic finalization; only kit/docs/packaging are changed.
The combined application is still NOT IMPLEMENTED, with no application version.
Do not upload or offer the truncated 0.1.0 ZIP as a working download.

The repository folder includes browsable documents/reference metadata and a
complete versioned ZIP containing the static analysis targets and all fixtures.
No GitHub Actions workflow is created or changed. Root repository rules are
retained; project copies must match the current canonical rule sources.

Resume by reading this file, REA_TASK.md, SOFTWARE_RULES.md and UI_UX_RULES.md
from the canonical GitHub folder. Download/extract the 0.1.1 kit, verify it,
and perform native REA/Ghidra investigation on Windows. Reuse the 23 existing
reference measurements and collect only missing evidence before implementing.
