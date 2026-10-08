# Duplicate Edition Analyzer Lightweight

Version: **0.3.6 - Under construction ⚠️**

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

## 0.3.6

- Fixed Release Map losing acoustic recording group ID **0** (the first valid group) in four backend conversions.
- `↔ Replaced` now requires a full wanted-recording coverage match from one NEW release in the same release family. Partial overlap stays an ordinary add/remove with coverage details.
- Cached replacement-pair indexing per map state; invalidate on state updates instead of rescanning all links for every row and filter.
- CD/physical source preservation and comparable 80+ log-score class are now encoded in each recording group's existing exact-cover requirement (no extra constraint graph), before minimizing retained tracks and releases. The old post-solve additive CD pass has been removed.
- Prevented early equivalent-edition dominance from discarding the better-source copy and prevented better-log CD swaps from increasing physical track count.
- Added final optimizer coverage/source/album-completeness assertions and regression checks for acoustic group 0 and minimal CD+WEB plans.
- **Verification:** Source static checks passed. Windows/WebView2 parity and exact Skrillex OLD/NEW dataset still require runtime retesting. No parity-complete EXE claim.

## 0.3.5

- Fixed a real optimizer/source-preference bug exposed by the Skrillex run: a lower-source WEB release can stay for unique material, but it can no longer make an available higher-source CD copy disappear for the recordings they share.
- Source quality is now preserved per shared recording after exact collection minimization. This can intentionally retain both a CD release and a WEB superset when the WEB release contributes a unique wanted bonus track.
- Relaxed exact-equivalent Existing preference so provider Album/EP/Single metadata disagreements do not create pointless replacements when the actual included audio/container shape is the same.
- Added a same-album + same-track-slot acoustic routing safety path. This specifically covers provider wording drift such as `Warped Tour '05 (ft. pete WENTZ)` vs `Warped Tour ’05 with pete WENTZ`; metadata only routes the pair and Chromaprint still decides identity.
- Changes view now pairs an OLD removal with its NEW covering release as one **↔ Replaced** change instead of showing a misleading independent **+ Added** plus a separate removal.
- **+ Added** reasons now name unique recordings when available.
- Fixed Changes/filter views retaining the old Full-map SVG scroll extent and allowing scrolling deep into empty space.
- Compressed Full map spacing: groups are separated by lines instead of padded cards, and releases inside a group are separated by compact row lines.
- Comparison logs now include optimizer-selected release IDs and a release source catalog (source medium/rank, CD-log class, track counts) for future source-preference debugging.
- Added regression tests for CD-vs-WEB superset preservation, provider Album/EP metadata churn, and Quest for Fire same-album track-slot routing.

## 0.3.4

- Reworked Release Map around a **Changes-first** default view so the user sees the actual discography delta instead of scanning the complete catalog.
- Added compact clickable change counters/filters: **All changes**, **+ Added**, **⬆️ Upgraded**, **- Removed**, and **🚫 Ignored**.
- New additions are explicitly marked with **+**.
- Changes view hides unchanged OLD releases and rejected NEW duplicates by default; those remain available in **Full map**.
- Added a compact change list with one-line explanations for why each release was added, upgraded, removed, or ignored.
- Search in Changes view can still find any analyzed release/track, including unchanged items.
- Track-carrier and alternative-version inspection automatically switches to Full map so cross-release navigation and SVG relationships remain available.
- Full map keeps Albums / EPs / Singles, but completely empty release-type columns are no longer reserved.
- Re-Analyze result drawer is denser and its added/removed release items are clickable.
- Added UI contract checks for the new Changes-first view and + addition marker.

## 0.3.3

- Fixed Unusual Track Pattern Review repeatedly asking about Pattern rules that are already saved in Personal Picks.
- A saved Personal Pick Pattern is now treated as a resolved persistent keep decision and is filtered out before the review dialog is shown.
- If every detected unusual pattern is already in Personal Picks, analysis continues automatically with no pattern-review popup.
- Only genuinely new/unresolved unusual patterns appear in the review; removing a Pattern from Personal Picks makes it eligible for review again if encountered.
- Added a regression self-test that fails if a saved Pattern is re-prompted or a new unresolved Pattern is accidentally filtered out.

## 0.3.2

- Simplified the Release Map to remove row-level visual clutter.
- Removed per-release OLD / NEW / KEEP / SKIP / DUP / unique-count / gem chips from map rows.
- Retained releases are now bright and visually dominant.
- Duplicate/discarded releases are heavily faded and slightly more compact; hover/selection/search restores readability.
- OLD vs NEW remains visible through subtle source-colored folder icons plus the top source legend.
- Release-family headers now summarize the result:
  - **✓** = current/OLD release stays.
  - **⬆️** = a real upgrade replaces it.
- New-only additions have no extra group symbol.

## 0.3.1

- Fixed false **UPGRADE WEB → WEB** decisions such as **2026-06-05 - SOMA [075679573001]**.
- The uploaded Skrillex comparison log proves the OLD and NEW SOMA copies have the same 13-track content and all 13 cross-source comparisons are acoustic MATCHes; same-content/same-source-quality now keeps the OLD existing release instead of creating pointless churn.
- Exact-equivalent release preference now preserves Existing before metadata-only Explicit/Unknown differences. A NEW copy can replace OLD only for an objective improvement such as higher source class, better comparable CD rip log, or a more-complete recording set.
- The UI now renders **UPGRADE** only when a real upgrade reason exists. A non-quality replacement is labeled **REPLACE**, never fake `WEB → WEB`.
- Fixed Release Map family grouping across provider naming conventions:
  - `More Monsters and Sprites - EP` = `More Monsters and Sprites EP`
  - `Bangarang - EP` = `Bangarang EP`
  - `Kora - EP` = `Kora`
  - `Burial - Single` = `Burial (feat. ...)`
  - and the same rule for Bun Up the Dance, Squad Out!, Working for It, No Chill, Purple Lamborghini, Slam Dunk, Waiting and Would You Ever.
- Grouping now strips only display-only release-type suffixes (EP/Single) and trailing featured-artist credits before comparison; it does not alter track identity or optimizer semantics.
- Added executable regression tests for every named split from the user's Skrillex run plus the SOMA false-upgrade case.

## 0.3.0

- Reworked Release Map around the actual project goal: improve an existing discography while keeping OLD and NEW origins obvious.
- Every release row now shows **OLD** (existing discography) or **NEW** (new/update folder).
- Plan badges clearly show **KEEP**, **ADD**, **UPGRADE**, **REMOVE**, or **SKIP**.
- Replacements show source-medium direction such as **UPGRADE WEB → CD** when available.
- Release details show source root, source medium, and which OLD release(s) a NEW upgrade replaces.
- Removed the visible destructive **Apply file changes** workflow.
- Added two explicit non-destructive export workflows:
  - **Copy old + new releases into:** final improved discography containing retained OLD releases plus NEW additions/upgrades.
  - **Copy new releases into:** only retained releases from the NEW/update source, including ADD and UPGRADE releases.
- Each export shows its destination path, Browse control, adjacent open-folder button, and explicit confirmation.
- Copying never moves, deletes, or modifies either source folder.
- Exports preserve relative release-folder structure and omit analyzer-detected duplicate files inside retained releases.
- Completion reports OLD/NEW counts, additions, upgrades, omitted duplicate files, and destination.
- The legacy move/Undo code remains internally only for compatibility with old manifests; the current map no longer invokes it.

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
