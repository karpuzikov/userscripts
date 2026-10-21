# Combined audio app: UI acceptance

Checkpoint: 2026-10-21. Application NOT IMPLEMENTED; no rendered UI exists.

The proposed control contract is in docs/behavior-spec.md. It is a design for
the requested compact dark Windows app, not visual acceptance evidence.

| Required gate | Status |
| --- | --- |
| User requirements and proposed control contract | Documented; full original feature inventory remains open |
| Actual PySide6 application rendering | NOT RUN - no application implementation |
| Hover, click, keyboard, selection, scroll, resize and DPI | NOT RUN |
| Error, cancellation, restart and settings persistence | NOT RUN |
| Original/replacement numerical and report parity | NOT RUN |
| Native Windows end-to-end workflow and visual acceptance | NOT RUN |
| Complete applicable UXDT page review | NOT RUN - index retrieval unavailable |

Sources read: current canonical UI_UX_RULES.md and SOFTWARE_RULES.md;
Microsoft Fluent 2 layout and accessibility pages. No screenshot or
interface-completion claim has been made. Retain Under construction status.

## Audio Analysis Suite v0.01.00 - 2026-10-21

- Implemented controls: Add files, Add folder, DR/Loudness, Authenticity, Workers, Analyze/Stop, Export, results table, double-click reveal, status counter.
- Python syntax and headless audio processing tests: PASS.
- Actual Windows startup/double-click and missing-package bootstrap: NOT RUN.
- Actual PySide6 native GUI screenshot inspection at representative resolutions/scale: NOT RUN.
- Hover/click/drag-drop/resize/scroll/keyboard/cancel/restart/settings in Windows GUI: NOT RUN.
- 100% original workflow parity/metric output: NOT RUN; known square-wave loudness mismatch.
- No Windows exe built. Status **Under construction ⚠️**; visual QA is release-blocking.

## v0.01.01 report-workflow QA (2026-10-21)

- Primary action now writes adjacent original-style output files automatically. No Export click required.
- Linux headless end-to-end on real audio and controlled rerun: PASS.
- Preserved existing `<folder>_log.txt` and `audiochecker.log` originals through collision fallback: PASS.
- Default 23-row original DR report table formatting (from captured original values): PASS.
- Windows desktop GUI: **NOT RUN** (the current test host has no PySide6/Windows).
- Entire app and original output content numerical parity: **NOT RUN / UNVERIFIED**; preserve Under construction ⚠️.
