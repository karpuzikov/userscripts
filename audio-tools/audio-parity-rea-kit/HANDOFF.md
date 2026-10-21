# TLDR - Handoff

Continue the combined Windows DROffline MkII 2.2.3 + AudioChecker 2.0 build 457
project. Canonical checkpoint: karpuzikov/userscripts, main,
audio-tools/audio-parity-rea-kit/. Read current SOFTWARE_RULES.md,
UI_UX_RULES.md, CONTINUITY.md, REA_TASK.md and docs/behavior-spec.md first.

Goal: independent implementation, full original functionality and identical
numerical/report output; broad audio formats; compact dark PySide6 UI, never
Tkinter; selectable workers, deterministic results and safe cancellation.

Status: research kit 0.1.1 - Under construction. Application NOT IMPLEMENTED;
no application version or executable exists. Exact parity is unverified.

Completed: original executable/DSP/detector identification and hashes, 64 DSP
exports, report presets, 29 unchanged verified fixtures, recovered raw 23-row
DROffline report and parsed golden strings. Preserve negative DR, true peaks
above zero, silence floors -100.00 dBTP / -128.00 LUFS, album count 23 / DR 1.
Six rejected fixtures are shorter than 10 seconds, including the short
192/384 kHz examples; this is not evidence of unsupported sample rates.

Blockers: native REA/Ghidra execution unavailable here; full 27-column/TXT/TSV
reference variants and AudioChecker golden reports are missing. Native Windows
UI and all replacement parity tests are NOT RUN. Do not substitute crest
factor or generic FFmpeg output and call it equivalent. No Actions changes.

The old 0.1.0 ZIP was later found truncated. The extracted files passed hash
verification; 0.1.1 is rebuilt and verified. Use the new versioned archive.

Exact next action: download/extract the 0.1.1 kit on Windows, open it in local
Codex with REA/Ghidra connected, and send: Read CONTINUITY.md and REA_TASK.md
and continue the investigation. Save findings/evidence and only missing
original reference reports under Findings/, then return them to this chat
or commit them to the canonical project folder before implementation.
