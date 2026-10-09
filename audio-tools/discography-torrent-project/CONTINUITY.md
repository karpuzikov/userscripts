# Duplicate Edition Analyzer - Continuity Handoff

Last updated: 2026-10-07
Status: Under construction ⚠️

## Purpose

Duplicate Edition Analyzer (DEA) compares an existing discography with incoming/new releases, identifies exact acoustic duplicates and distinct versions, optimizes which releases should be retained, lets the user inspect and override the proposed plan in Release Map, and only changes files after explicit Apply. Undo must remain available after applying changes.

This file is the authoritative handoff for DEA development. Read it before changing DEA. Update it whenever implementation state, versions, behavior, architecture, build flow, known issues, or next steps change.

## Canonical implementations and versions

- Production/reference implementation:
  - Source: `audio-tools/discography-torrent-project/tools/Duplicate Edition Analyzer v0.22.12.pyw`
  - Version: `0.22.12 - Under construction ⚠️`
  - GitHub release asset: `Duplicate.Edition.Analyzer.0.22.12.exe`
  - This is the current functional specification for all replacement/rewrite work.
- Failed native prototype:
  - Branch: `dea-native-light-test`
  - Source root: `audio-tools/discography-torrent-project/native-light/`
  - Last prototype version: `0.1.2`
  - User tested it and rejected it because it did not preserve 100% of regular DEA functionality.
  - Do not use the native prototype as the functional specification.
- New lightweight/fast/modern rewrite:
  - Branch: `dea-lightweight-modern`
  - Source: `audio-tools/discography-torrent-project/lightweight/Duplicate Edition Analyzer Lightweight v0.4.0.pyw`
  - Version: `0.4.0 - Under construction ⚠️`
  - Separate from the failed native prototype.
  - Functional baseline is production/reference DEA 0.22.12.
  - No production feature may disappear merely to reduce EXE size or complexity.

## Non-negotiable rewrite contract

The new lightweight implementation must provide 100% user-visible and behavioral functionality of the regular DEA before it can replace or be presented as equivalent to the regular version.

Parity means:
- same analysis behavior and selection rules;
- same pre-analysis unusual-pattern review behavior;
- same Personal Picks behavior;
- same Save Remixes / Save Live behavior and exceptions;
- same acoustic duplicate identity behavior;
- same Release Map information, links/connections and interaction model;
- same track/release ignore, restore and Re-Analyze behavior;
- same Apply/Undo behavior;
- same search, track highlighting and cross-release navigation;
- same Versions/Remixes/Live family inspection;
- same replacement-source explanations;
- same result/change summary behavior;
- same filesystem path open controls;
- same logging, crash reporting and persistent settings behavior;
- same dependency behavior or a stricter compatible implementation;
- same versioned-download and GitHub status rules.

No feature may be removed, stubbed, hidden, or replaced with a simplified approximation unless the user explicitly approves that exact change.

## Why the old native prototype failed

The Win32/C++ prototype was small and fast, but it simplified the product and therefore violated the parity requirement. Specific missing/incomplete areas included:
- Release Map was a simplified list/details window rather than the full graph-style chronological release board.
- Missing/insufficient visual relationship links/connections on the map.
- Missing full cross-release track highlighting/navigation.
- Missing full Versions / Remixes / Live alternative-family panels and navigation.
- Missing full replacement-source and retained-copy detail behavior.
- Missing the complete regular Release Map search/navigation behavior.
- Missing or simplified result drawer / IF -> THEN re-analysis explanation flow.
- Missing the full regular UI/interaction richness and several parity behaviors around ignore/restore/re-analysis.
- Its engine also diverged from the production Python behavior instead of sharing the exact production logic.

Do not repeat this approach by implementing a smaller subset first and calling it equivalent.

## Target architecture for the new lightweight implementation

Preferred direction as of 2026-10-07:
- Preserve the production Python analysis/optimization logic as the behavioral authority rather than manually reimplementing the algorithms in C++.
- Remove the heavyweight PySide6 + Qt WebEngine runtime from the application UI.
- Use the Microsoft Edge WebView2 runtime for the modern HTML/CSS/JavaScript UI. Microsoft documents the Evergreen WebView2 runtime as preinstalled on Windows 11 and automatically updated; the program must still detect/runtime-check it and bootstrap/install it when unavailable.
- Keep the existing modern DEA HTML/CSS/JavaScript interaction design as the starting point, especially the full Release Map, and adapt the host bridge rather than rewriting/reducing the map.
- Keep long-running analysis off the UI thread.
- Prefer one user-facing EXE; runtime dependencies may live under the program-owned dependency directory if required by the global software rules.
- Do not bundle a 100-250+ MB fixed WebView2 runtime when the Evergreen runtime is available.
- Do not bundle Qt/PySide6 in the lightweight build.
- External audio helpers follow the global dependency rules and live under the program-owned data/dependencies path when app-local copies are required. The lightweight frozen build resolves FFmpeg/FFprobe and fpcalc externally at runtime instead of requiring them inside the EXE.

Reason for this architecture: it preserves the exact proven Python decision engine while removing the largest UI/runtime weight source and retaining a modern web-rendered Release Map.

## Current production UI behavior that must be preserved

### Main window
- Modern dark UI.
- Existing discography path is optional.
- New / update releases path is required.
- Folder/open-location button immediately before every displayed path.
- Save Remixes.
- Save Live recordings.
- Personal Picks.
- Logging and logs-folder opener.
- Match label: Chromaprint (audio only).
- Current stage, progress percent/bar, processed/total count and elapsed time.
- Activity/log panel.
- Analyze.
- Undo last run.
- Release Map.
- Close.
- Analysis and export are separate; analysis never modifies either source folder. Copy actions in Release Map create curated output copies only.

### Unusual track pattern review
- Only genuinely unknown/non-standard version-like patterns are reviewed.
- Ordinary known Remix/Live/Radio/Extended/Acoustic/Instrumental/Acapella/etc. structures do not appear as unusual patterns.
- Callout aliases are one semantic pattern:
  - Suggested Callout Hook
  - Call Out Hook
  - Suggested Call Out Research Hook
  - all resolve to the stable key `suggested callout` and one UI row, currently labeled `Callout hook`.
- Only unresolved unusual patterns appear in this review. A Pattern already saved in Personal Picks is a resolved persistent keep decision and must not be shown or re-confirmed on later analyses.
- Checked unusual pattern is kept and saved to Personal Picks.
- Unchecked pattern is skipped for that run.
- Removing a Pattern from Personal Picks makes it eligible for review again if that pattern is encountered later.
- Check all / Uncheck all / Cancel / Continue behavior is preserved.

### Personal Picks
- Supports Phrase, Exact title and Pattern entries.
- Pattern entries remain persistent until removed.
- Pattern rules are not treated as normal phrase matching.
- Personal Picks must never resurrect a globally disabled Remix or Live category.
- UI supports add/remove, clear, copy all, save/cancel.

### Acoustic identity and classification
- Chromaprint acoustic evidence is the duplicate-identity authority.
- External database identifiers are not duplicate-identity authority.
- Duration is candidate routing/diagnostic evidence, not identity authority.
- Definitive exact acoustic match is automatic; no manual identity choice for the proven same recording case.
- Weak/near-threshold non-match stays separate automatically.
- Fingerprint failures remain conservative singleton/unique recordings.
- CUE image rips are recognized as virtual tracks.
- Explicit supersedes corresponding Clean before fingerprint grouping.
- Remix, Live, Extended, Instrumental, Acapella/A Cappella and Acoustic root/version semantics must retain the production rules.
- Radio/Edit-style variants remain acoustically comparable where the production semantic gate allows it.
- Featured-artist Remix exception behavior from 0.22.x must be preserved exactly.
- Compilation duplicate policy must be preserved.

### Optimization
- Strict same-album wanted-content supersets dominate subsets before global optimization.
- Every album family is represented by a maximum-completeness edition.
- Outside singles/EPs cannot rescue a less-complete album edition.
- After wanted/album coverage:
  1. minimize total retained tracks;
  2. then minimize retained release count;
  3. then source/rip-quality / Existing-vs-Incoming tie-breakers;
  4. DR/mastering analysis only for final interchangeable ties.
- CD rip quality threshold behavior must remain compatible with production.

### Release Map - full parity required
The regular 0.22.12 Release Map is the UI/behavioral reference. Preserve:
- chronological release board;
- release columns/rows;
- SVG relationship curves/links/connections;
- Initial and Result release/track counters;
- signed deltas;
- pending Re-Analyze state;
- release search and Enter cycling;
- current-release selection;
- right-side details pane;
- keyboard activation and visible focus;
- release path opener + copy path;
- release Ignore / Restore;
- exact-instance track Ignore / Restore;
- ignored release remains visible and inspectable;
- pending ignore/restore visual and textual states;
- Re-Analyze required before Copy after pending changes;
- Copy actions disabled while dirty;
- Copy actions require destination + explicit confirmation;
- result drawer with causes, THEN added/removed changes and replacement sources;
- replacement source and alternate retained-copy details;
- per-track statuses;
- exact audio-group cross-release highlighting;
- relationship connections for active track carriers;
- Versions button/panel;
- Remixes button/panel;
- Live button/panel;
- alternative-version highlighting/navigation to its carrier release;
- no loss of track status wording or distinction explanations;
- responsive/reflow behavior;
- Escape closes details without losing map state.

### Copy output and legacy Undo
- File changes occur only after explicit Apply from Release Map.
- Destructive/move plan is confirmed before execution.
- Undo last run restores the previous applied move set where possible.
- Existing filesystem conflict handling must remain conservative and visible.

## Persistent data and paths

Global path rule applies everywhere: every displayed filesystem path has an adjacent open-location control.

Production program data root:
`Documents\Karpuzikov Tools\Duplicate Edition Analyzer\`

Keep program data isolated under the program's own directory. Dependencies, logs, temp, settings, caches, decision snapshots and manifests belong under that product directory, not directly under `Documents\Karpuzikov Tools`.

Do not create a second incompatible settings universe for the lightweight rewrite without migration/compatibility. The goal is to reuse production DEA settings and state when safe.

## UI/UX contract

Mandatory global UXDT baseline applies. Relevant current guidance rechecked on 2026-10-07:
- clear hierarchy and logically organized content;
- descriptive labels and validation;
- full keyboard operation where applicable;
- visible focus states;
- high contrast;
- no reliance on color alone for state;
- responsive/reflow-safe layout;
- clear system feedback and progress;
- efficient task flow and search;
- predictable reusable interaction patterns.

DEA family typography:
- Segoe UI 9 normal text;
- Segoe UI 10 bold section headings;
- Segoe UI 15 bold major headings;
- Cascadia Mono 9 for activity/log text.

Modern UI may improve visual polish, spacing, hierarchy, responsiveness and animation, but must not remove information or controls.

## Dependency rules

- WinGet-first where applicable; check/install/update dependencies rather than asking the user to reinstall the app.
- Check/repair WinGet if missing before relying on it.
- FFmpeg/FFprobe and Chromaprint/fpcalc must be located/installed/updated through the shared dependency strategy.
- hey-bro-check-log integration must remain compatible with production behavior.
- Lightweight UI target must not require PySide6/Qt WebEngine.
- WebView2 runtime must be detected at startup; use Evergreen/shared runtime instead of bundling a fixed Chromium runtime unless a future explicit requirement changes this.
- Long-running dependency setup must show progress/activity.

## Version/status rules

- Every new or updated test build shows its real version plus `Under construction ⚠️`.
- Status never replaces the version.
- Keep `Under construction ⚠️` until the user explicitly confirms testing is complete.
- Every downloadable build must include its version in the physical filename.
- Do not present unversioned current downloads.

## Build/release rules

- Do not modify or add files under `.github/workflows/` unless the user explicitly asks for that exact workflow or explicitly asks to modify an existing workflow.
- Do not give commit links to the user.
- Verify build/output before offering a download.
- Keep production/reference DEA intact while the new lightweight implementation is under construction unless the user explicitly requests replacement.
- New lightweight builds must not overwrite the production release tag/assets until parity is proven.

## Validation gates for lightweight rewrite

A lightweight build is not parity-complete until all of these pass:
1. Production 0.22.12 self-tests/behavioral regression tests pass unchanged or through a shared core.
2. Callout alias grouping regression passes.
3. Main UI feature checklist matches production.
4. Release Map feature checklist matches production, including visible SVG links/connections.
5. Ignore/restore exact-instance track behavior matches production.
6. Ignore/restore release + Re-Analyze + Copy gating works with both non-destructive export modes.
7. Version/Remix/Live panels and navigation match production.
8. Replacement-source/result-drawer behavior matches production.
9. Filesystem-path opener invariant passes on every visible path.
10. Keyboard/focus/accessibility/reflow checks pass.
11. Dependency/bootstrap and persistent-data rules pass.
12. No PySide6/Qt WebEngine dependency is present in the lightweight build.
13. Performance and package size are measured against production; lightweight must be materially smaller/faster without dropping functionality.
14. Real-folder comparison against production produces equivalent analysis/release-selection output before user testing.

## Current work state

- User rejected Native Test 0.1.2 for missing functionality.
- Production/reference DEA 0.22.12 remains the authority.
- New request: create a separate lightweight, fast implementation with a modern UI and zero functional loss from production.
- Architecture implemented at source level: production Python core + pywebview 6.2.1 + Microsoft Edge WebView2 host, with the production main HTML UI and full Release Map HTML/JS retained. Legacy Qt/PySide6 and dormant Tk/Tcl UI code have been removed from the lightweight source.
- WebView2 detection uses Microsoft-documented runtime registry keys and WinGet package `Microsoft.EdgeWebView2Runtime` when installation is required.
- Latest source version is 0.4.0 on branch `dea-lightweight-modern`. The Skrillex comparison log exposed both UI and optimizer bugs. CD/source quality is now preserved for shared recordings even when a lower-source WEB superset must remain for a unique bonus track; provider release-type metadata cannot cause churn for otherwise exact-equivalent containers; and same album + same track slot is an acoustic-routing safety path for provider naming drift such as Quest for Fire `Warped Tour '05 (ft. pete WENTZ)` vs `Warped Tour ’05 with pete WENTZ`. Changes view now has `↔ Replaced`, pairs OLD->NEW replacements, names unique recordings for real additions, resets stale SVG scroll extent, and uses line-separated compact Full-map groups/rows.
- v0.3.6 fixes acoustic group 0 disappearance in the Release Map, narrows ↔ Replaced to verified whole-release wanted coverage in one same-family NEW release, and caches replacement-pair calculation per state.
- Source preservation (best CD/WEB source class and comparable CD 80+ threshold class per wanted recording) is now encoded directly in one exact-cover provider requirement per wanted recording group, without doubling group constraints. The former post-optimization source-addition pass is removed; equivalent CD replacements cannot increase physical track count; final source/album/wanted-coverage invariants fail closed if violated.
- v0.3.6 has GitHub source-level patch/static checks, with additional `--ui-self-test` regressions for acoustic group 0 and source-safe minimum-release selection. The Python self-test, actual Windows/WebView2 UI and exact Skrillex folder test have **not been run** here. Do not claim they passed.
- Current source: `audio-tools/discography-torrent-project/lightweight/Duplicate Edition Analyzer Lightweight v0.4.0.pyw`.
- Real Skrillex v0.3.6 run (2026-10-08; user's screenshot and `Duplicate Edition Analyzer Comparison 2026-10-08-04-13-13.jsonl`) reached all 66 exact optimization components, then failed with `Optimizer lost a most-complete album edition after quality tie-breaks.` Log includes 470 track rows, 360 eligible tracks, 191 acoustic groups, and a final DR pass with zero tie groups. OLD Scary Monsters (11 physical tracks, 7 wanted) was EP-tagged, while the otherwise audio-identical NEW release was Album-tagged; 7 wanted OLD/NEW matches were acoustically verified.
- v0.3.7 introduces `_album_requirement_provider_ids`, permitting an otherwise truly identical EP/Single/Album physical edition of the same title and audio sequence to satisfy maximum-completeness album representation. This also fixes short 2-track album editions split by the broader album clustering heuristic. An incomplete single/EP never qualifies. The exact solver, Existing-copy late-substitution veto and final album audit now use the same eligibility contract.
- If a subsequent CD/Existing/DR tie-break unexpectedly breaks a solver requirement, v0.3.7 falls back to the proven exact selection with an explicit error diagnostic; the exact plan is revalidated before use.
- CI validation passed for v0.3.7: Python compilation, `--ui-self-test` (including Skrillex-shaped 11-track EP/Album no-churn and short-album regressions), undefined-name checks, embedded JS validation and bridge contract. Workflow run: https://github.com/karpuzikov/userscripts/actions/runs/37712322914.
- User's uploaded **`Duplicate Edition Analyzer Comparison 2026-10-08-04-21-58.jsonl`** (analyzed with 0.3.7) shows OLD Dirty Vibe (Remixes) release ID 12 (barcode 075679931368) selected, NEW ID 74 not selected. Both have three tracks correctly marked Remix/excluded and third track **Jack Beats Re-work** incorrectly marked `is_remix=false`, `excluded_from_coverage=false`. Save Remixes OFF was active.
- v0.3.8 recognizes Re-work/Rework/Reworked as bracketed/parenthesized or trailing delimited remix descriptors in `is_remix_text`, adds the descriptor to remix-base-title handling and remix-added-feature recognition. Ordinary titles containing "rework" are not inherently remixes.
- Added a v0.3.8 `--ui-self-test` covering the two real Dirty Vibe title shapes, Save Remixes OFF/ON, Personal Picks not overriding excluded remixes, remix-only releases not selected, added-feature exception, and negative unrelated-song controls.
- GitHub Actions workflow [37812280044](https://github.com/karpuzikov/userscripts/actions/runs/37812280044) passed on the v0.3.8 source (compile, built-in UI regression tests, undefined-name checks, embedded JavaScript checks and bridge contract).
- **Pending:** rerun the same Skrillex folders on v0.3.8. Check both Dirty Vibe (Remixes) releases are excluded/removed, verify unrelated releases are unaffected, inspect Release Map and logs. Do not claim a real-folder test has passed.
- User's v0.3.8 screenshot and `Duplicate Edition Analyzer Comparison 2026-10-08-19-57-51.jsonl` confirm all four tracks of OLD `2014-07-07 - Recess (Remixes) [075679936790]` and OLD `2014-12-14 - Dirty Vibe (Remixes) [075679931368]` excluded with Save Remixes OFF. Decision engine correctly assigned REMOVE, but Release Map `_release_map_state_for_ui()` hid them because it only included releases with wanted acoustic groups or manual removals. Hence Removed initially showed only two other releases.
- v0.3.9 map state includes every analyzed snapshot. OLD excluded-only `REMOVE` is shown under Changes > Removed and in Full Map; NEW `SKIP` remains visible in Full Map but does not count as a Change. The decision reason now identifies the excluded track count and explicit Save Remixes OFF / Save Live OFF causes for applicable pure-category exclusions.
- Added end-to-end v0.3.9 regression across `build_release_decisions`, `build_decision_snapshot`, `_release_map_state_for_ui`, and Changes routing, using paired OLD/NEW four-track Dirty Vibe releases, with no retained material and correct plan counts.
- GitHub Actions validation PASSED on v0.3.9 source: [workflow 37814161743](https://github.com/karpuzikov/userscripts/actions/runs/37814161743). Real user Windows/WebView2 rerun has not been completed.
- Actual Windows rerun on v0.3.7 and Release Map inspection remain unfinished.
- v0.4.0 (2026-10-09) is the graphical WebView2 successor to 0.3.9 on `dea-lightweight-modern`, not the separate abandoned ASCII v0.4.0 prototype. Changed only Full Map release dividers (2 px `#303947`) and thicker SVG relationship connection paths (idle duplicate 1.65 px, active duplicate 2.8 px, Versions 3.0 px, Remixes/Live 2.65 px, selected carrier 3.6 px). Added static regression checks for line legibility; core acoustic matching/optimizer/release decisions/file copying are unchanged.
- The `dea-lightweight-ascii-ui-test` branch is historical/rejected; DO NOT merge its terminal/Textual work into graphical DEA.
- v0.4.0 GitHub CI PASSED on the graphical source: [workflow 37871448332](https://github.com/karpuzikov/userscripts/actions/runs/37871448332), covering Python compilation, `--ui-self-test`, Ruff F821, embedded JavaScript and bridge regression contracts. Real Windows WebView2 rendering and full Skrillex rerun still need verification.
- Current graphical v0.4.0 download: `https://raw.githubusercontent.com/karpuzikov/userscripts/dea-lightweight-modern/audio-tools/discography-torrent-project/lightweight/Duplicate%20Edition%20Analyzer%20Lightweight%20v0.4.0.pyw`.
- No new lightweight build has yet been declared parity-complete.
- Do not send another "native/light" test merely because it launches. Complete the parity checklist first.

## Exact next steps

1. Re-run the user's exact Skrillex OLD/NEW test on 0.4.0. Verify: Scary Monsters exact-equivalent Existing no longer churns; the Bangarang CD remains retained while the WEB 8-track release may remain only for its unique wanted bonus track; Make It Bun Dem is shown as one `↔ Replaced` OLD->NEW change; Quest for Fire provider wording routes the 11th track acoustically and does not create a false WEB addition if the audio matches; Changes filters cannot scroll into Full-map-sized empty space; Full map uses line-separated compact groups/rows.
2. Run syntax/static checks and source-mode launch checks.
3. Compare main-window controls and behaviors against production 0.22.12.
4. Compare full Release Map behavior against production 0.22.12, especially SVG links, cross-release highlighting, alternative-family panels, ignore/restore, Re-Analyze and result drawer.
5. Verify the implemented bridge API used by the current Release Map:
   - getState
   - toggleTrack
   - toggleRelease
   - reanalyze
   - openFolder
   - copyPath
   - apply
   - closeMap
   plus the main-window bridge API.
6. Preserve the exact Release Map SVG connection rendering and all details/alternative panels.
7. Keep the production application untouched and independently runnable.
8. Add/update direct regression checks for parity-critical bridge actions and UI contracts.
9. Measure executable/dependency footprint and startup time.
10. Only after parity validation, publish a versioned `Under construction ⚠️` test build for user verification.

## Rejected approaches

- Raw Win32/C++ lightweight rewrite that independently reimplements/simplifies the production engine: rejected by user after Native Test 0.1.2 because functionality was lost.
- Simplified Release Map list/detail view: rejected; full visual map links and interactions are mandatory.
- Calling a build equivalent before feature parity has been audited: forbidden.

## Rule sources to read before work

- Repository global rules: `/SOFTWARE_RULES.md`
- This file: `audio-tools/discography-torrent-project/CONTINUITY.md`
- DEA project history/specification: `audio-tools/discography-torrent-project/PROJECT.md`
- Current functional source: `audio-tools/discography-torrent-project/tools/Duplicate Edition Analyzer v0.22.12.pyw`
