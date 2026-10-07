# Duplicate Edition Analyzer Lightweight

Version: **0.2.2 - Under construction ⚠️**

Branch: `dea-lightweight-modern`

This is the new lightweight/fast DEA implementation. It preserves the production DEA 0.22.12 analysis/optimization core and replaces the heavyweight Qt/PySide6 UI runtime with the Microsoft Edge WebView2 runtime already present on normal Windows 11 systems.

## Architecture

- Production DEA 0.22.12 analysis/optimization behavior retained.
- Modern HTML/CSS/JavaScript main UI.
- Full production Release Map retained, including SVG relationship links/connections.
- pywebview 6.2.1 + Microsoft Edge WebView2 Evergreen host.
- No PySide6 / Qt WebEngine.
- No Tk/Tcl UI runtime.
- Stable WebView2 profile/cache under `Documents\\Karpuzikov Tools\\Duplicate Edition Analyzer\\cache` for faster warm starts.
- WebView2 is detected through the documented Windows runtime registry locations and installed through WinGet only when missing.
- FFmpeg/FFprobe and Chromaprint/fpcalc remain external WinGet/app-local dependencies instead of inflating the lightweight executable.
- Production DEA settings/state directory is reused.

## Functional parity contract

No production feature may be removed to reduce size or increase speed. The functional reference remains:

`tools/Duplicate Edition Analyzer v0.22.12.pyw`

The lightweight build preserves the regular DEA feature surface, including:

- Save Remixes / Save Live and their production exceptions;
- Personal Picks and unusual-pattern review;
- automatic Chromaprint identity behavior;
- full chronological Release Map;
- SVG relationship links/connections;
- search and cross-release track highlighting;
- Versions / Remixes / Live panels;
- exact-instance track Ignore/Restore;
- release Ignore/Restore;
- Re-Analyze and Apply gating;
- replacement-source explanations and result drawer;
- path openers, logging, settings and Undo.

The failed `native-light` prototype is not the reference.

## 0.2.2

- Fixed the WebView2 desktop bridge initialization that could leave every button dead.
- Main UI and Release Map now create their JS bridge immediately and wait/poll for `window.pywebview.api` instead of relying exclusively on the one-shot `pywebviewready` event.
- Bridge failures are surfaced in the UI instead of being swallowed only in the developer console.
- Added release-blocking bridge-initialization checks so this dead-button regression cannot silently return.

## 0.2.1

- Release Map is now divided into **Albums / EPs / Singles** columns.
- Editions of the same release family are grouped together inside each column.
- The three columns fill the available map width instead of creating fixed-width columns followed by a large horizontally scrollable blank area.
- SVG links still connect the real release rows across columns.
- Compilations remain visible and are marked inside the Albums column rather than being dropped.

## 0.2.0

- Removed the entire dormant Tk/Tcl UI implementation and Tk clipboard fallback.
- Startup crash reporting now uses the native Windows message box.
- WebView2 uses the persistent application profile for faster subsequent starts.
- Added a source-safe `--ui-self-test` parity gate.
- Kept the production analysis/optimization code and full Release Map instead of reimplementing them.

## Status

Source implementation is **Under construction ⚠️** until Windows runtime parity and real-folder output comparison pass. Static validation on 2026-10-07 passed Python compilation, undefined-name checking, and embedded Release Map JavaScript syntax validation for v0.2.1. No GitHub Actions workflow was added or modified for this build.
