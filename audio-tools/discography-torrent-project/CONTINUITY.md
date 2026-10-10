# Duplicate Edition Analyzer - Continuity Handoff

Last updated: 2026-10-09
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
  - Source: `audio-tools/discography-torrent-project/lightweight/Duplicate Edition Analyzer Lightweight v0.4.7.pyw`
  - Version: `0.4.7 - Under construction ⚠️`
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
- Outside singles/EPs cannot generally rescue a less-complete album edition; since v0.4.5, the narrow exception is a same-family equal-or-better-source full core with *only* independently issued added-featured-remix bonuses.
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
- The v0.4.1 core on branch `dea-lightweight-modern` retains the established optimizer and Release Map. The Skrillex comparison log exposed both UI and optimizer bugs. CD/source quality is now preserved for shared recordings even when a lower-source WEB superset must remain for a unique bonus track; provider release-type metadata cannot cause churn for otherwise exact-equivalent containers; and same album + same track slot is an acoustic-routing safety path for provider naming drift such as Quest for Fire `Warped Tour '05 (ft. pete WENTZ)` vs `Warped Tour ’05 with pete WENTZ`. Changes view now has `↔ Replaced`, pairs OLD->NEW replacements, names unique recordings for real additions, resets stale SVG scroll extent, and uses line-separated compact Full-map groups/rows.
- v0.3.6 fixes acoustic group 0 disappearance in the Release Map, narrows ↔ Replaced to verified whole-release wanted coverage in one same-family NEW release, and caches replacement-pair calculation per state.
- Source preservation (best CD/WEB source class and comparable CD 80+ threshold class per wanted recording) is now encoded directly in one exact-cover provider requirement per wanted recording group, without doubling group constraints. The former post-optimization source-addition pass is removed; equivalent CD replacements cannot increase physical track count; final source/album/wanted-coverage invariants fail closed if violated.
- v0.3.6 has GitHub source-level patch/static checks, with additional `--ui-self-test` regressions for acoustic group 0 and source-safe minimum-release selection. The Python self-test, actual Windows/WebView2 UI and exact Skrillex folder test have **not been run** here. Do not claim they passed.
- Current source: `audio-tools/discography-torrent-project/lightweight/Duplicate Edition Analyzer Lightweight v0.4.7.pyw`.
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
- Superseded graphical v0.4.0 was followed by v0.4.1. Current versioned download is on the branch below; do not use an outdated v0.4.0 source.
- v0.4.1 adds automatic `<recycle root> - UPDATED` sibling destination to both Release Map export actions (shown by default; Browse remains optional). Example NEW `C:\!deemix Music\Metro Boomin` => `C:\!deemix Music\Metro Boomin - UPDATED`.
- The former NEW-only copy button is **replaced** with **Move old + new releases into** and **Move old + new** action. It now physically moves retained OLD and NEW release folders after an explicit destructive confirmation, leaves SKIP/REMOVE source releases untouched, forbids destination collisions and nesting within input trees, journals each folder move for Undo, and preserves previous Undo journal backups.
- Retained cross-device folder moves use checked copy with per-file SHA-256 before source deletion. Same-device moves use direct rename. Reverse-order rollback is attempted on failure. Successful move invalidates cached Release Map snapshots and offers an Undo button in its completion dialog. Unmodified Copy old + new remains non-destructive.
- `--ui-self-test` now includes temporary filesystem tests: both OLD+NEW copy, both OLD+NEW move, excluded NEW unchanged, existing destination refusal, full Undo, and simulated cross-volume copy verification.
- **2026-10-09 previous checkpoint:** v0.4.1 graphical WebView2 source is available as a versioned branch file: `https://raw.githubusercontent.com/karpuzikov/userscripts/dea-lightweight-modern/audio-tools/discography-torrent-project/lightweight/Duplicate%20Edition%20Analyzer%20Lightweight%20v0.4.1.pyw`. Repository audio-tools menu and lightweight README display `0.4.1 - Under construction ⚠️`; no ASCII/Textual code was merged.
- **CI validation succeeded** on v0.4.1: [GitHub Actions run 37872841539](https://github.com/karpuzikov/userscripts/actions/runs/37872841539) (source compile, `--ui-self-test` including temporary-folder Copy/Move/Undo and simulated cross-volume verification, Ruff F821, embedded JavaScript syntax, bridge/UI contracts). Earlier intermediate CI failure [37872411545](https://github.com/karpuzikov/userscripts/actions/runs/37872411545) was superseded by passing follow-up runs. Automated tests **do not** confirm real Windows WebView2 behavior, real mass-storage transfer performance, actual user folders or full parity with production v0.22.12.
- **Distribution scope:** v0.4.1 is published as a downloadable GitHub branch `.pyw`, **not** as a formally created GitHub Releases entry/asset: `duplicate-edition-analyzer-lightweight-v0.4.1` returned 404 at handoff. Do not tell the user that a formal GitHub Release exists.
- **Next test for new behavior:** with NEW root `C:\!deemix Music\Metro Boomin`, both actions should propose `C:\!deemix Music\Metro Boomin - UPDATED` before Browse. **Copy old + new** should preserve both original trees; **Move old + new** requires confirmation, transfers only retained OLD+NEW folders, leaves skipped/removed folders in place, and enables Undo to restore original paths. Repeat with a preexisting destination and invalid nesting to verify refusal; test multi-disc, collision and cross-volume cases using sacrificial data, never irreplaceable originals. A successful move invalidates cached map/selection and requires rescanning.
- **Remaining release/parity blockers:** complete end-to-end Windows/Skrillex run and copy/move/undo UI walkthrough; verify details, focus, keyboard/reflow, default destination paths, Copy vs Move wording, retained/removed release counts, and safe rollback. Keep status `0.4.1 - Under construction ⚠️`; do not claim parity, final release or Windows testing passed.
- **2026-10-09 v0.4.2 safety checkpoint:** A source-only audit of the v0.4.1 export/Undo path found (1) missing nested destination-target collision preflight, (2) same-volume permission errors taking the cross-device copy/delete path, (3) partially copied final-named release folders on Copy failure, (4) silent removal of Undo journal when moved and original paths were both missing, and (5) default UPDATED destination open-location buttons ignoring their fallback displayed path. v0.4.2 fixes those cases while preserving WebView2 and the original optimizer. New Python self-tests cover nested OLD/NEW targets, PermissionError, missing Undo data, and default opener markup. The source is `audio-tools/discography-torrent-project/lightweight/Duplicate Edition Analyzer Lightweight v0.4.2.pyw`. Existing v0.4.1 remains available for rollback reference; do not label v0.4.2 Windows-tested.
- **CI validation PASSED for v0.4.2:** [GitHub Actions run 37906576608](https://github.com/karpuzikov/userscripts/actions/runs/37906576608), with Python compilation, `--ui-self-test` (including nested destinations, rejected permission fallback and missing-folder Undo), Ruff F821, embedded Main UI + Release Map JS syntax, and bridge contract. CI used Linux and is not real Windows/WebView2/Skrillex validation.
- **Unresolved recovery risk:** if checked cross-volume copy successfully publishes a destination but source deletion fails partway (for example, a locked file), manual recovery may be needed; full transactional handling and Windows fault injection remain a blocker before moving valuable real folders. Do not run Move on the real Skrillex originals until this is closed and tested.
- **2026-10-09 v0.4.3 concurrency/process-lifetime checkpoint:** User Task Manager screenshot shows many `fpcalc.exe` processes surviving closure of v0.4.2; user observed 14 concurrent reads overwhelmed their HDD. The cause is `run_hidden` launching unowned subprocesses using `subprocess.run` and I/O worker counts derived entirely from logical CPU count (up to 32). Fixed with the Windows application-scoped Job Object (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`) covering `run_hidden` children: close button, X/window closed callback, and `atexit` close the Job Object. Replaced default ffprobe/fpcalc I/O limits with `_io_worker_plan` for both source roots: HDD/network/unknown 2, SSD up to 8; manual override 1-32 in preserved graphical WebView2 UI. Windows `StorageDeviceSeekPenaltyProperty` via `DeviceIoControl` classifies fixed disks without requiring administrator privileges; unknown classification defaults conservatively. Setting is persistent and Activity shows count and storage type. Acoustic comparison CPU worker count stays separate. Front-page text no longer falsely says Release Map always copies only.
- **v0.4.3 automated validation PASSED on final source:** [GitHub Actions run 37936414635](https://github.com/karpuzikov/userscripts/actions/runs/37936414635) (compile, built-in self-test including worker selection and subprocess probe, Ruff F821, embedded JS syntax and WebView2 bridge contract). This also covers the subsequent UI wording change. CI runs Linux and does not verify real Windows Job Object or seek-penalty behavior.
- **Immediate Windows verification:** First close all remaining orphan `fpcalc.exe` from the former version (the new app intentionally only owns its own children). Use a disposable HDD test tree with new v0.4.3, select Auto, verify Activity logs 2 (HDD), confirm no excess `fpcalc.exe` read load, close during fingerprinting and verify child exit. Then manual limits 1 and 4; verify selection persists after reopening. Repeat on SSD / mixed HDD+SSD and WebView2 focus/keyboard if possible. Report the auto media label shown in Activity: if unknown, investigate Windows IOCTL seek penalty on the user's storage stack.
- **2026-10-10 Weeknd findings and v0.4.4 fixes:** Two user-uploaded comparison logs `Duplicate Edition Analyzer Comparison 2026-10-10-03-15-13.jsonl` and `(1).jsonl` have identical SHA-256 `cd4ceacf5c948499a6958524e1a0531c661cc183066bfcc7e838396dd75c3fe8`. Therefore there is no uploaded post-Re-Analyze log. Initial run v0.4.3 has 659 tracks, 566 fingerprints, 93 early excluded, 265 recording groups; optimizer selected 52 releases. OLD CD 30-track `Trilogy [US - B0017732-02]` source was declared compilation but every track was permanently eliminated from included coverage via `apply_compilation_policy`; NEW 30-track WEB Trilogy was declared Album and selected alongside three original mixtapes. 36-track `The Highlights (Deluxe)` was also erroneously tagged Album and forced selected, although many examples are acoustically matched (I Was Never There and Pray for Me are MATCH, not missed). `Call Out My Name` on multiple releases was excluded through the too-broad `CALLOUT_PATTERN_RE` matching the ordinary words 'call out'. Artist tags on the four remix examples contain secondary performer but no literal feat. marker: `Maluma & The Weeknd`, `The Weeknd with ROSALÍA`, `The Weeknd & Ariana Grande`. K-POP (Chopped & Screwed) was considered normal. Open Hearts (Single Version) was *included* but acoustic matched to base 23.79-second-longer Open Hearts via `unmatched_is_silence=True`, despite non-identical fingerprints.
- **v0.4.4 implementation:** Stop permanently setting compilation tracks excluded. Exact group-provider selection prefers available/unblocked non-compilation sources, then falls back to compilation if no regular source exists; quality-floor verification uses the identical provider contract. The previously blocked CD Trilogy can return on Re-Analyze when the three original mixtapes and WEB Trilogy are manually blocked. Provider Album label is overridden for 25+ track Trilogy and The Highlights (Deluxe) 12+ track anthologies. ARTIST-tag secondary collaborators recognized in featured-remix policy, with a conservative fallback for exactly one secondary artist if no baseline exists (protecting Skrillex Dirty Vibe 3+ act regression). Callout regex requires explicit Suggested/Research/Hook markers. Version descriptor Chopped & Screwed is a remix; ordinary song wording isn't. Significantly shorter explicit Single Version with non-identical fingerprints stays separate; exact fingerprints still merge.
- **v0.4.4 CI:** GitHub Actions `https://github.com/karpuzikov/userscripts/actions/runs/38010097527` PASS after narrowing an initial permissive remix-tag regression (earlier failures are superseded). Includes Python source compilation, `--ui-self-test` with synthetic Weeknd-shaped cases and all existing regressions, Ruff F821, embedded WebView2 JavaScript syntax and bridge checks. This does NOT reproduce the full 659-track Weeknd scan or test Windows actual data changes.
- **2026-10-10 v0.4.5 Starboy album exception (implemented, CI passed):** The uploaded `Duplicate Edition Analyzer Comparison 2026-10-10-05-54-42.jsonl` is version 0.4.4, has 660 tracks (589 fingerprinted) and selected CD `2016-11-28 - Starboy [US - B0026150-02]` (19 physical/18 included groups), WEB `2016-11-24 - Starboy (Deluxe) [602455499851]` (21 physical/20 included groups), existing `2023-02-24 - Die for You (Remix) - Single [602455483133]` (4 physical), while removing existing `2017-08-01 - Reminder (Remix) - Single [00602557936223]` (1 physical). A union of the log's accepted acoustic matches shows **exactly 18 shared wanted groups**, and only two Deluxe extras: Reminder (Remix), acoustically MATCH to the standalone 1-file single, and Die for You (Remix), MATCH to the standalone 4-file single. `_album_requirement_provider_ids` formerly restricted the album family to maximum wanted-group edition regardless of separately published bonus remixes, forcing the unneeded WEB Deluxe. v0.4.5 adds `_album_core_with_separate_remix_bonuses`, which permits the CD full core as an album representative ONLY when every missing Deluxe group is a wanted newly featured remix, present on an eligible separate Single/EP, the family title/audio overlaps, the edition is a fully contained core, and the source rank is no weaker. The method is used by album provider selection, superset prepruning (so CD or equal-source core remains eligible), exact solver and late validation. Regular album bonus tracks, absent/blocked independent singles and weaker-source core albums do NOT qualify. Synthetic real-log-shaped regression expects {CD 19 + Reminder 1 + Die for You Single 4} = **24 physical files**, not {CD 19 + WEB Deluxe 21 + Die for You Single 4} = 44. Every wanted group and CD source floor remains mandatory. [GitHub Actions run 38020343636](https://github.com/karpuzikov/userscripts/actions/runs/38020343636) passed all compile, self-test, Ruff F821, embedded JS and bridge checks. No real Windows execution or full actual optimizer replay has yet validated v0.4.5 outcomes.
- **2026-10-10 v0.4.6 Privilege fingerprint completeness fix:** Uploaded real Weeknd `Duplicate Edition Analyzer Comparison 2026-10-10-06-42-27.jsonl` from **v0.4.5** reveals two editions of `My Dear Melancholy,`: OLD 2018-04-13 EP (track index 127; source `06 Privilege.m4a`) and NEW 2018-03-30 WEB (index 422; source `06 Privilege.flac`). Both report identical 170.573333-second duration, normalized title `privilege`, same artist/album/track number. Their actual comparison at pair_index 610 is REJECT, even though score=0, good=1, excellent=1, overlap=1, shift=0, strict_pass=True and mastering_pass=True, **because acoustic_coverage=0.108407 and unmatched non-silence**. Candidate was routed with same title + same album/slot + weighted tokens, so routing was NOT the cause. The root cause is an implausibly short fpcalc vector from one source despite reported full duration (and fpcalc command `-length 0`). Neither file may be asserted an acoustic duplicate until complete fingerprints exist; the rejection threshold must not be relaxed. New `_chromaprint_fingerprint_incomplete` catches obvious under-length vectors for >=30s durations; `_recover_short_chromaprint` decodes only suspicious files to temporary mono 11025Hz PCM via FFmpeg then reruns fpcalc in the existing subprocess-owned I/O-limited stage. If restoration fails/incomplete, a user-visible error is recorded and conservative singleton treatment remains. Temporary WAV lives in the tool's `temp/fingerprint_recovery` subfolder and is deleted. The Track comparison JSONL now includes `fingerprint_frames`, `fingerprint_repaired`, `fingerprint_incomplete`, allowing actual diagnosis. Built-in UI regression tests include mocked truncate/recover/cleanup/fail-closed subprocess cases and source immutability. **CI PASSED** https://github.com/karpuzikov/userscripts/actions/runs/38021833055 (compile, --ui-self-test, Ruff F821, embedded JS, bridge). No real Windows decode has been executed, nor has the exact original ALAC audio been available in this environment.
- **2026-10-10 v0.4.7 follow-up (IMPLEMENTED; CI PASSED):** User confirmed earlier v0.4.5 `Privilege` acoustic REJECT was correct, because the incoming WEB `2018-03-30 - My Dear Melancholy, [602577858994]\\06 Privilege.flac` is **corrupt**. Do not reinterpret partial perfect similarity as whole-file identity or overrule the original reject. Implemented full decode verification of every distinct physical file (including entire shared CUE image once) via `FFmpeg -v error -xerror -err_detect explode -map 0:a:0 -f null -` during preflight with the existing drive-aware read-worker limit and progress UI. `Track.integrity_error` records exact decoder problem/path; corrupt tracks are not submitted to fpcalc and remain conservative singleton wanted groups. `Release.validation_issues` records album completion and metadata discrepancies. Full file decode is not the same as the old v0.4.6 short-fingerprint PCM recovery; recovery is still used only for truncated fingerprints on healthy files.
- **Release completeness rules added:** `validate_release_track_totals` inspects `TRACKTOTAL`, `TOTALTRACKS`, `TRACKNUMBER=n/total`, `DISCNUMBER`, and disc folder names; audits separate discs; reports missing numbers, duplicate numbers, conflicting declared totals, and out-of-range indices. No tagged total means UNKNOWN, never infer incomplete solely from incomplete filesystem cardinality.
- **Standalone Release Map fix:** The user's uploaded `Duplicate Edition Analyzer Comparison 2026-10-10-07-34-33.jsonl` is **v0.4.5**, with 1,211 tracks total, 1,208 fingerprinted and optimizer 46 proposed retained releases. User provided *only* New/update; former Release Map incorrectly showed `+ Added 46`, though no Existing baseline and no actual file modifications. v0.4.7 state has `standaloneMode` and full scanned count. JS defaults to Full map, labels `Scanned`, `Proposed retained`, `RETAIN`, ✓; shows zero initial Adds/Upgrades/Removes; only manual Ignore appears as a change. Dual-folder Existing+New behavior unchanged.
- **Safety/UI:** Map shows global `auditBanner` and per-release ⚠️ icon/details for corrupt/unreadable/incomplete releases, and server-side Copy/Move operations are blocked while any validation issues remain. Re-Analyze and UI patches cannot override the blocker. Preflight notes explain affected paths and still allow viewing the provisional plan; user must correct files and rescan. No auto-repair/delete/move.
- **Tests/CI:** Added `--ui-self-test` for missing track 2/3, unknown totals, valid `TRACKNUMBER=1/2`, contradictory `TRACKTOTAL`/`TOTALTRACKS`, multi-disc completeness, mocked full FFmpeg decoder errors, standalone map baseline/issue count and changed labels; old regressions remain. Two initial CI failures fixed: group-icon static check needed standalone alternative; track-total regex was double-backslash escaped and therefore invalid. Final source commit `9b4cb207b575e0047aa45fb2b61bfad11050bdfc` validated **PASS** GitHub Actions `https://github.com/karpuzikov/userscripts/actions/runs/38025032743`. No user-owned actual Windows 1,211-track media data was decoded or file moved here; status **Under construction ⚠️**.
- **New immediate Windows test:** Start v0.4.7 on the same single New/update folder. Confirm Full map initially shows 46 *proposed retained* not +46 additions, and there are zero changes until explicit manual operations. Confirm corrupt `06 Privilege.flac` is flagged as an affected release, source remains untouched, Copy/Move blocked until fixed; verify absence/presence of TRACKTOTAL/TOTALTRACKS for any reported incomplete disc by inspecting actual tags. Then test against OLD+NEW and validate that actual additions/replacements remain meaningful. Do not use Move/Apply on the primary collection until every warning is resolved and disposable Undo is verified.
- **Next v0.4.7 verification:** Analyze the unchanged two Weeknd folders with logging enabled and inspect `Privilege` in both releases and `fingerprint_frames`/`fingerprint_repaired` in the new comparison JSONL. If repaired successfully and acoustically identical, only one release should be credited with exclusive coverage; if not, the error must state why. Verify all other grouping and retained releases, particularly Starboy, before any Move/Apply on actual data.
- **Immediate user verification:** Run v0.4.7 Analyze on unchanged Weeknd OLD/NEW folders. Verify CD Starboy and standalone Reminder and Die for You singles are retained; WEB Deluxe should be omitted unless some other independently verified wanted or album-completeness exception requires it. Review all other album decisions (especially Let Go, Trilogy, Highlights) to detect regression. Do not Move/Apply important originals before comparing the complete plan and validating Undo on disposable folders.
- **Next direct test:** Open v0.4.7 on the exact same The Weeknd OLD/NEW roots, rerun analysis with Save Remixes OFF, inspect CD Trilogy vs both WEB Trilogy/original mixtapes and compilation priorities, then manually Ignore all three mixtapes plus WEB Trilogy and Re-Analyze. Verify CD Trilogy returns KEEP, no wanted group is orphaned, Highlights Deluxe is not retained absent a genuine unique recording; verify Call Out My Name, four artist-tag remix tracks, Chopped & Screwed, and the shorter Open Hearts Single Version. Upload both initial and **new post-Re-Analyze** logs/decision snapshots if any discrepancy. Keep Move/Apply disabled as a user procedure for important originals until real outcome and cross-device Undo safety checked.
- **Windows-specific validation not done here:** Windows kernel Job Object creation/assignment, HDD/SSD detection, abrupt-kill cleanup, actual live Skrillex analysis, and Move/Undo have not been tested on user's PC. Do not declare stable. Existing cross-volume source-cleanup recovery risk from v0.4.2 remains open. Keep `0.4.3 - Under construction ⚠️` until user tests and confirms.
- No new lightweight build has yet been declared parity-complete.
- Do not send another "native/light" test merely because it launches. Complete the parity checklist first.

## Exact next steps

1. On Windows, first verify v0.4.7 The Weeknd analysis/Re-Analyze and source preservation, then HDD/SSD I/O limits, process cleanup on Close and X, then test the default UPDATED destination and both Copy/Move actions on disposable OLD/NEW folders, including confirmation, collision refusal, Undo and rescan; then rerun the user's exact Skrillex OLD/NEW comparison on 0.4.7. Verify: Scary Monsters exact-equivalent Existing no longer churns; the Bangarang CD remains retained while the WEB 8-track release may remain only for its unique wanted bonus track; Make It Bun Dem is shown as one `↔ Replaced` OLD->NEW change; Quest for Fire provider wording routes the 11th track acoustically and does not create a false WEB addition if the audio matches; Changes filters cannot scroll into Full-map-sized empty space; Full map uses line-separated compact groups/rows.
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
