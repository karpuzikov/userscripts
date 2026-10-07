# Duplicate Edition Analyzer Lightweight

Version: **0.1.1 - Under construction ⚠️**

Branch: `dea-lightweight-modern`

This is the new lightweight/fast DEA implementation. It starts from the full production DEA 0.22.12 code so analysis and optimization behavior are preserved instead of being independently reimplemented.

## Architecture

- Production DEA Python analysis/optimization core.
- Modern HTML/CSS/JavaScript main UI and full Release Map.
- pywebview 6.2.1 host on Windows.
- Microsoft Edge WebView2 Evergreen runtime instead of PySide6/Qt WebEngine.
- Full regular Release Map HTML/JS retained, including SVG relationship links/connections, search, cross-release highlighting, Versions/Remixes/Live panels, ignore/restore, Re-Analyze, replacement-source details and Apply gating.
- WebView2 runtime is detected through Microsoft's documented registry keys and automatically installed through WinGet when missing.
- pywebview is isolated under `Documents\\Karpuzikov Tools\\Duplicate Edition Analyzer\\dependencies` in source/development mode.
- FFmpeg/FFprobe and Chromaprint/fpcalc are external WinGet/app-local dependencies instead of being bundled into the lightweight EXE.
- WebView2 profile/cache is isolated under `Documents\\Karpuzikov Tools\\Duplicate Edition Analyzer\\cache`.
- Production DEA settings/data directory is reused.

## Functional rule

No production feature may be removed to reduce size or increase speed. The reference is:

`tools/Duplicate Edition Analyzer v0.22.12.pyw`

The failed `native-light` prototype is not the reference.

## Status

The source-level lightweight host has been created and the legacy Qt/PySide6 host code has been removed. It is **not yet parity-approved** and must remain `Under construction ⚠️` until the parity checklist in `../CONTINUITY.md` passes and the user confirms testing.

No GitHub Actions workflow was added or modified for this build.
