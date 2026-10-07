# Duplicate Edition Analyzer Lightweight

Version: **0.2.9 - Under construction ⚠️**

Branch: `dea-lightweight-modern`

This is the new lightweight/fast DEA implementation. It preserves the production DEA 0.22.12 analysis/optimization core and replaces the heavyweight Qt/PySide6 UI runtime with the Microsoft Edge WebView2 runtime already present on normal Windows 11 systems.

## Architecture

- Production DEA 0.22.12 analysis/optimization behavior retained.
- Modern HTML/CSS/JavaScript main UI.
- Full production Release Map retained, including SVG relationship links/connections.
- pywebview 6.2.1 + Microsoft Edge WebView2 Evergreen host.
- No PySide6 / Qt WebEngine.
- No Tk/Tcl UI runtime.
- WebView2 browser sessions are private/ephemeral; DEA settings, decisions and logs remain persistent in the normal program data directory.
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

## 0.2.9

- Fixed **[1995] BT - 今 Ima [0630-12345-2] CD** being marked as an EP.
- Root cause: fallback release-type detection used only track count. The release has **5 tracks**, which fell into the old 3-6-track EP heuristic, despite a total duration of about **76.49 minutes**.
- Heuristic classification now uses both track count and total included duration: releases of **30 minutes or longer** are treated as Albums unless explicit tag/name evidence says EP/Single.
- Explicit release-type metadata and explicit `EP` / `Single` naming still take precedence.
- Added regression tests for the exact Ima case, a short 5-track EP, and an explicitly named long EP.

## 0.2.8

- Fixed the root cause of album blocks being scattered around the Albums column.
- Release Map grouping now uses each audio file's embedded **ALBUM metadata** as its primary release-family identity instead of trying to reverse-engineer the album from arbitrary folder names.
- Multi-disc tags such as **These Hopeful Machines: CD1** / **CD2** normalize to **These Hopeful Machines**.
- Folder names remain only a fallback for files with missing ALBUM metadata.
- Added a regression test using all five **These Hopeful Machines** folder styles from the user's 2026-10-07 comparison run, including Deemix, RED/scene and rutracker naming.
- Analyzer/optimizer behavior is unchanged; this affects Release Map visual grouping only.

## 0.2.7

- Fixed the startup failure where the window could appear but `getState` never became available and Windows reported **Not Responding**.
- Removed the reflective `js_api=bridge` binding path entirely.
- Main UI now explicitly exposes each required Python method with pywebview's documented `window.expose(...)` API before the GUI loop starts.
- Release Map uses the same explicit method exposure.
- JavaScript still waits for the exact requested method, so a map window created during the running GUI loop is safe as well.
- Added an executable self-test that verifies the explicit bridge exposes `getState` and other methods by their correct names.
- v0.2.6's private WebView2 session / old-profile cleanup remains in place.

## 0.2.6

- Fixed the intermittent **second-launch / later-launch dead UI** where Browse and other buttons stopped responding and `getState` never appeared.
- Root cause was the persistent WebView2 browser profile introduced in 0.2.0. DEA does not need browser cookies/localStorage persistence because its real settings and state are stored separately.
- Returned pywebview/WebView2 to a clean private browser session on every application launch.
- Added best-effort cleanup of the obsolete `webview2-profile` cache left by 0.2.0-0.2.5.
- The restart fix does not clear DEA settings, Personal Picks, logs, decisions or other application data.
- Added a source self-test that fails if persistent WebView2 browser mode is accidentally re-enabled.

## 0.2.5

- Fixed the remaining Album grouping failures seen in the Avril Lavigne test run.
- Root cause: folder bookkeeping after the catalog block (for example `CD 1` and `-clean-`) prevented the old browser-side cleanup from reaching the actual album title.
- Release Map grouping is now prepared in Python before rendering, with explicit handling for year prefixes, catalog/source blocks, Clean/Explicit folder suffixes and CD/Disc/Disk suffixes.
- Arbitrary parenthetical variants such as **Let Go (Sketch Book)** and **Head Above Water (Instrumentals)** join the plain album only when that plain base title actually exists in the same column.
- Added executable regression tests using the exact Let Go, The Best Damn Thing, Avril Lavigne and Head Above Water folder patterns from the failing run.
- Analyzer/optimizer semantics are still untouched; this remains display-only grouping.

## 0.2.4

- Fixed Release Map grouping so editions such as **Let Go (Japan Tour Special Limited Version)**, **Let Go (Sketch Book)**, **Let Go (Special Bonus Edition)** and plain **Let Go** appear in one **Let Go** block.
- Fixed **Avril Lavigne (Exclusive Edition)** and plain **Avril Lavigne** appearing as separate groups.
- The visual grouping fix is UI-only and does not change DEA's analysis/optimizer album-family rules.
- Fixed the minimum-width toolbar so **Apply file changes** stays inside its button.
- Reworked Release Map connection rendering from one SVG DOM element per edge to a few batched SVG paths with cached row geometry.
- Redraws are requestAnimationFrame-throttled, greatly reducing first-open hangs, resize lag and selection lag while preserving all relationship links.

## 0.2.3

- Fixed the remaining WebView2 bridge race shown by `Desktop bridge method is unavailable: getState`.
- The bridge now waits for the **requested method itself** (for example `getState`), not merely for `window.pywebview.api` to exist.
- Calls made before pywebview finishes populating its method table stay queued for up to 30 seconds instead of failing immediately.
- Added a regression check that forbids the old API-object-only readiness test.

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
- WebView2 browser state is intentionally ephemeral; persistent DEA settings/state remain in the application data directory.
- Added a source-safe `--ui-self-test` parity gate.
- Kept the production analysis/optimization code and full Release Map instead of reimplementing them.

## Status

Source implementation is **Under construction ⚠️** until Windows runtime parity and real-folder output comparison pass. Static validation on 2026-10-07 passed Python compilation, undefined-name checking, and embedded Release Map JavaScript syntax validation for v0.2.1. No GitHub Actions workflow was added or modified for this build.
