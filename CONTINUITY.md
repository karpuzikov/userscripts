# Karpuzikov Picard Scripts - Continuity

## Product and state
- Product: Karpuzikov Picard Scripts, a Picard 3.x Git-updatable MusicBrainz metadata plugin.
- Current version: 1.5.24 - Under construction ⚠️ (not yet verified inside user Picard).
- Git repository and active branch: `karpuzikov/userscripts`, `main`.
- There is no additional project-specific `RULES.md` currently; the canonical repository root `SOFTWARE_RULES.md` governs this project.

## Canonical files
- `MANIFEST.toml`: root Picard 3 plugin metadata and version.
- `__init__.py`: root plugin registration, embedded optional tagging scripts, Barcode/UPC lookup action and plugin options page.
- `current_artist_names.py` and `musicbrainz_title_capitalization.py`: companion metadata modules.
- `picard-tools/scripts/*.txt`: manual tagging-script sources; `Format_Multiple_Artists.txt` is the stable source counterpart to the embedded script.
- `picard-tools/scripts/Format_Multiple_Artists_v1.0.1.txt`: versioned standalone download; future revisions need new versioned filenames.
- `README.md`: Picard entries and installation instructions.

## Architecture and feature contracts
- The Picard 3 plugin loads from the repository root through the host-required `MANIFEST.toml` and `__init__.py`; do not rename host-required files to `.pyw`.
- Plugin settings enable individual tools/scripts without introducing a separate update checker; Picard's native Git plugin update mechanism is the update path.
- Existing Barcode/UPC lookup, current-artist normalization, and title-capitalization functionality must be preserved without regressions.
- The embedded `Format Multiple Artists` script and standalone `.txt` counterpart MUST be kept byte-for-byte equivalent apart from how the Python literal encodes line breaks/backslashes.
- Preserve existing `artist` behavior: use multi-value `artists`, retain only credited names present in `artist`, format one as `A`, two as `A & B`, three or more as `A, B & C`.
- In 1.5.8 / standalone 1.0.1: independently format `albumartist` using the Picard 3 multi-value `albumartists` tag with the same 1/2/3+ joining rules. If `albumartists` is missing or empty, do not overwrite `albumartist`. Never derive release artists from track `artists`.
- Keep both operations idempotent and preserve source artist order. Only explicit existing script logic changes names; other tags and identities are untouched.

## Title capitalization and suffix fixes (2026-10-08)

- Shared plugin `1.5.9 - Under construction ⚠️` fixes four real Skrillex release examples:
  1. Spanish La Noche: `La Noche - Single` -> `La noche - Single` (no repeated suffix).
  2. Beatport Extended Mix: after a separate existing ETI-removal step, `La Noche - Single` -> `La noche - Single` even if MusicBrainz release language is marked English.
  3. English Bun Up the Dance: `Bun Up the Dance - Single` stays unchanged; English "Bun Up" is recognized as a verb-particle expression.
  4. Portuguese Vai sentando: `Vai sentando - Single` stays unchanged even if MusicBrainz release language is marked English.
- The source MusicBrainz releases `27aba838-503f-4e29-bd8e-5e51a32f166e`, `bff6492e-8a52-4b05-9e7b-8fa1e5069e0b`, `2c73d5ea-bb84-4078-a6de-10f8a7f72c68`, `3f013c5b-89a0-472f-b672-da5cb66a07a7` are regression references; the second and fourth are marked English although the title text is non-English.
- Language detection applies conservative Spanish `la noche` and Portuguese `vai + gerund` evidence before honoring incorrect English release language metadata; do not globally force non-English titles to English title case.
- Release capitalization canonicalizes an existing trailing `- Single` or `- EP`, removes duplicate repetitions of the same suffix and preserves the suffix's canonical casing. It does not strip `(Extended Mix)`: that modification comes from a separate, not-yet-identified Picard script or setting.
- Manual `Add_EP_Single_Suffix_v1.0.2.txt`: strips repeated bare or hyphenated case-insensitive trailing EP/Single suffixes before adding one canonical suffix. Runs must be idempotent.
- Manual `English_Title_Capitalization_v1.1.2.txt`: English-only guard including obvious foreign-language title exceptions, plus "Bun Up" exception. It remains a legacy, English-only script; prefer the language-aware plugin for multilingual tags.
- Stable `picard-tools/scripts/Add_EP_Single_Suffix.txt` and `English_Title_Capitalization.txt` remain identical to their versioned downloads. Both are mirrored exactly as the embedded tagging scripts in root `__init__.py`.
- Automated regression source: `picard-tools/tests/test_album_title_regressions.py`, with seven tests covering all four user cases, suffix idempotence, ambiguous English titles and embedded/manual source parity. Tests are **added but not executed in this session**; no Picard runtime verification has been performed.
- Do not modify barcode matching, current artist-name normalization, Format Multiple Artists or other unrelated scripts. Do not enable both language-aware and legacy English capitalization simultaneously.

## Barcode / UPC Lookup toolbar restoration (2026-10-08)

- Picard 3 `MainWindow.create_action_toolbar()` clears and replaces `window.toolbar` when Actions toolbar customization changes. The previous plugin added a QAction once and retained a non-null global pointer, so it never inserted the button into the recreated toolbar. The Barcode/UPC batch matching code was NOT the cause and remains unchanged.
- v1.5.10 introduces an idempotent `_place_barcode_action`, checks membership in the CURRENT toolbar rather than trusting a global action pointer, and adds a `_BarcodeToolbarWatcher` that schedules reattachment on child-added/window-activation events and checks every 4 seconds for a toolbar cleared in place.
- Also registers `BarcodeLookupToolsAction` with Picard 3's supported `register_tools_menu_action` (top-level Plugin Tools menu). It uses the same `_barcode_only_lookup` selection handler.
- `disable()` must stop/disconnect the watcher, invalidate queued callbacks, remove the current toolbar action and delete the QAction exactly once. Plugin settings and all Barcode/UPC comparison and disc/track matching semantics remain unchanged.
- Added seven standard-library unit tests in `picard-tools/tests/test_barcode_toolbar_regressions.py`: placement, idempotence, toolbar re-creation, no native button, lifecycle, monitor/menu and untouched matching API.
- GitHub source-level checks performed; full Picard 3 UI/runtime validation still pending. Do not claim visual verification until the user confirms the button survives Options > User Interface > Toolbar changes and plugin updates.

## Barcode / UPC Lookup edge clipping fix (2026-10-08)

- User reported Barcode Lookup appearing beyond the Picard window edge. The exact window screenshot was not provided; clipping is the working diagnosis, not a visually confirmed Qt root cause.
- v1.5.11 pins Barcode Lookup into the first QAction position of Picard's native Actions QToolBar; the former behavior inserted it after the native Lookup action, which could leave it at the far right on narrow windows.
- Existing late-position actions are promoted without duplicates and Picard 3's toolbar-recreation watcher keeps the leading placement. If the native Actions toolbar is empty, the new action becomes the first item.
- Compact toolbar text `Barcode` reduces button width. The full tooltip and existing Tools > Plugins menu action remain available for accessibility and keyboard navigation.
- Native Qt QToolBar overflow is allowed to handle lower-priority actions; plugin must not create a detached/floating widget, force docking, or alter user toolbar configuration.
- Unit regression tests added/updated in `picard-tools/tests/test_barcode_toolbar_regressions.py` to cover first-item priority, late-action promotion, idempotence, recreated/empty toolbar and menu fallback.
- Pure Python placement simulation passed 5 tests in this session. Full Picard 3 visual QA is still pending: confirm narrow/maximized window, toolbar customization and normal barcode matching without user settings loss.
- Do not change barcode query/matching semantics, artist formatting or capitalization while adjusting toolbar placement.

## Gypsyhook EP suffix duplication (2026-10-09)

- Regression: user saw `Gypsyhook - EP` change to `Gypsyhook EP - EP` in `album`.
- MusicBrainz release `https://musicbrainz.org/release/a3f1838a-fbeb-4698-87e3-547230c744f5` is officially titled `Gypsyhook EP`, release type EP. Picard loads this bare suffix; previous Add EP/Single Suffix script recognized only ` - EP` and appended another ` - EP`.
- Fixed in plugin v1.5.12 and manual suffix script v1.0.2: strip all terminal ` - EP` **and** bare ` EP` occurrences for EP releases, or corresponding ` - Single` / ` Single` tokens for Single releases, before adding exactly one canonical suffix.
- Expected: `Gypsyhook EP`, `Gypsyhook - EP`, `Gypsyhook EP - EP`, `Gypsyhook - EP - EP` all normalize to `Gypsyhook - EP`. Subsequent processing must leave it unchanged.
- Never append when title consists of `EP` only (or `Single` only). Never change album title if primary release type does not match EP/Single. Do not strip internal words/tokens.
- Keep manual stable `picard-tools/scripts/Add_EP_Single_Suffix.txt`, versioned `picard-tools/scripts/Add_EP_Single_Suffix_v1.0.2.txt`, and embedded `SCRIPTS` string in root `__init__.py` identical in content.
- Added tests in `picard-tools/tests/test_album_title_regressions.py`: source assertions, standalone parity, and Picard ScriptParser execution tests (the latter skip automatically outside a Picard runtime).
- Existing v1.0.1 remains historical; README and download links reference v1.0.2.
- No modification to Barcode Lookup, artist-name normalization, language-aware capitalization, or other unrelated features.
- Runtime QA pending: update Picard native plugin to v1.5.12, reload Sonny's Gypsyhook release, confirm `album = Gypsyhook - EP` after first and second reload, and test Single-type counterpart.
- If duplicates persist, inspect additional user-enabled scripts in Options > Scripting; the plugin cannot control other scripts outside its own options.

## Dependencies and persistent data
- Requires MusicBrainz Picard 3.x, Python >=3.9 as embedded by Picard, and PyQt6 provided by Picard.
- No separately installed Python packages or filesystem persistent data owned by this plugin. Picard manages plugin configuration, source updates and tagging lifecycle.
- Continue honoring GitHub-wide requirements: actual version alongside `Under construction ⚠️`, version in user-downloadable filenames, preservation of settings, native UX conventions and UXDT guidelines where applicable.
- Existing plugin option labels and controls remain unchanged in this update.

## Verification and release
- Earlier version validated by source consistency checks: standalone script and embedded plugin text match; original `artist` logic is unchanged; `albumartists` guards, output assignment and joins are present.
- Source-level join checks include 1, 2, 3 artists. These checks do NOT constitute a full Picard runtime test.
- Next manual QA inside Picard 3 (include the title/suffix regressions above): 1 artist, 2 artists, >=3 artists, `albumartists` missing, track credits different from release credits, repeated refresh/reprocessing, settings preserved, and no duplicate application from Options > Scripting and the shared plugin.
- Recheck all final version strings, README URLs, syntax of the Python module, and the published versioned standalone download.

## Known limitations and next action
- Suffix duplication fix in v1.5.12 and toolbar placement in v1.5.11 are pending user-environment verification. Leave the product Under construction ⚠️ until Picard confirms behavior.
- The prior manual script version 1.0.0 did not write `albumartist`; the embedded copy had the same omission. Version 1.0.1/1.5.8 adds album-artist formatting.
- Next action: update Picard plugin to v1.5.12, verify Gypsyhook and repeated EP/Single suffix processing, then test Barcode toolbar placement at narrow and maximized window sizes and the Tools-menu fallback; then run `python -m unittest discover -s picard-tools/tests` in a Python 3.9+ environment, validate the embedded Picard ScriptParser output for suffixes, then test the four linked Skrillex releases in Picard 3. Verify results are stable after a second reload and that existing ETI removal remains unchanged. Test the earlier Format Multiple Artists scenarios separately.

## Standalone Picard script audit (2026-10-09; plugin v1.5.13)

- Manual `Unicode_to_ASCII.txt` and versioned `Unicode_to_ASCII_v1.0.1.txt`: former `$replace` incorrectly supplied dozens of search/replacement pairs even though Picard supports exactly 3 parameters. Replaced with valid, separate 3-argument functions for 31 grouped or individual transformations. In particular U+2010/U+2011/U+2012/U+2013/U+2014/U+2015/U+2212 become ASCII hyphen-minus U+002D; unchanged ASCII hyphens stay untouched.
- Unicode converter only edits present tags in the original scope (title, album, artist/albumartist, sort fields, composer/credit and other previously listed fields); preserves multi-valued tags via `$map` and `$setmulti` instead of collapsing them with `$set`. It normalizes punctuation, not accented Latin or other writing systems. WARNING: Picard's map/setmulti string transport might split a literal '; ' inside a multi-value element; validate on rare multi-value tags with embedded semicolons before considering runtime QA complete.
- Manual `English_Title_Capitalization.txt` and versioned `English_Title_Capitalization_v1.1.3.txt`: replaced ten invalid many-pair `$replace` expressions with 169 valid ordered `$replace(text,search,replace)` calls. Existing linguistic rules, fallback behavior, and guard against obvious Spanish/Portuguese titles were retained; do NOT enable the legacy capitalization together with the language-aware plugin capitalization.
- Updated identical embedded script sources in root `__init__.py`, plugin manifest to 1.5.13, README versions/download links, and related regression tests. Version 1.0.0 Unicode and 1.1.2 English should be regarded as historical and defective.
- Inspected `Add_EP_Single_Suffix.txt`, `Format_Multiple_Artists.txt`, `Move_Featured_Artists_to_Title.txt` against Picard's scripting function signatures. No equivalent multi-pair `$replace` defect found; current behavior remains unchanged to avoid unverified artist-credit corruption. Known concern: `Format Multiple Artists` uses substring presence rather than token-safe membership when filtering source artist names; a full solution must preserve legitimate punctuation in artist names and nonstandard MB join phrases. Featured-artist parser should be tested with parenthesized and nonparenthesized feat. credits.
- Static checks are not equivalent to Picard 3 interactive runtime validation. Manual QA must cover G‐DRAGON -> G-DRAGON, proper Unicode quote/punctuation conversion, repeated runs/idempotence, preservation of non-ASCII letters, multi-artist/composer tagging, original format and suffix regression samples, and embedded/standalone script parity. Keep 1.5.13 - Under construction ⚠️ until confirmed.

## Artist processing order regression (2026-10-09; plugin v1.5.14)

- Confirmed cross-script hazard: Unicode normalization changes `artist`/`albumartist`, but `Format Multiple Artists` compares those fields to MusicBrainz's original multi-valued `artists`/`albumartists`. If Unicode conversion happens first, e.g. `G‐DRAGON` becomes `G-DRAGON` only on one side and Format can incorrectly remove the artist.
- Fixed embedded `SCRIPTS` execution order (and matching options order) to: Move Featured Artists -> Format Multiple Artists -> Unicode to ASCII -> Add EP/Single Suffix -> English Title Capitalization. When using standalone scripts in Picard's Options > Scripting, the user must arrange Format above Unicode; embedded plugin order is enforced automatically. Reordered README rows to reflect this dependency.
- `Format Multiple Artists` itself was not redesigned; original artist/albumartist eligibility and 1/2/3+ joining logic remain unchanged to protect nonstandard join phrases. Known partial-name false-match risk remains documented. New order regression test added; plugin 1.5.14 remains Under construction ⚠️ pending Picard 3 runtime validation.

## Move Featured Artists duplicate-title prevention (2026-10-09; plugin v1.5.15)

- The existing Move Featured Artists script appended `(ft. Guest)` even if `title` already contained `(feat. Guest)` or `(ft. Guest)` and `artist` still carried the featured credit. Fixed by normalizing only the title-inspection copy from `feat.` to `ft.`, then appending only when the equivalent credit is absent. Existing artist/albumartist removal regex and captured credit spelling/casing are preserved. Temporary `_feat_title` is unset at end.
- Published `picard-tools/scripts/Move_Featured_Artists_to_Title_v1.0.1.txt`, mirrored to stable .txt and embedded plugin source. Added versioned README link and runtime regression cases covering no credit, already-`ft.`, and already-`feat.` titles. Tests requiring Picard are pending execution inside Picard 3; keep v1.5.15 - Under construction ⚠️.

## Format Multiple Artists source parity (2026-10-09; plugin v1.5.16)

- Whole-script parity audit found the embedded Format Multiple Artists code was missing the stable source's final newline. Regenerated the embedded literal from the canonical `Format_Multiple_Artists.txt` exactly (no behavior change); added it to the source-parity test. All five current standalone Picard scripts must have byte-identical embedded decoded script sources and matching latest versioned standalone downloads.
- v1.5.16 - Under construction ⚠️. No change to Format Multiple Artists selection/join semantics. Interactive Picard runtime validation and potential partial-name false-match investigation remain outstanding; do not mark stable without the applicable tests.

## Single-artist exact-credit filtering (2026-10-09; plugin v1.5.17)

- Confirmed partial-name issue: when MB provides artists [A, AB] but an earlier step reduces `artist` to the exact credited name AB, the old `$in(AB,A)` would wrongly keep A and synthesize `A & AB`.
- Standalone Format Multiple Artists v1.0.2 and embedded plugin script now use `$inmulti(%artists%,%artist%)` / `$inmulti(%albumartists%,%albumartist%)` to recognize when the display credit is exactly an entry in the original multi-valued list. For this exact-one-artist case only, selection uses `$eq` instead of substring `$in`. For all other multi-artist credits, preserve existing substring matching and join behavior (no loss of custom MB joinphrase handling).
- Added Picard runtime regression covering both track and album artist A/AB-style collisions and repeated runs. Fixed script is distributed as `Format_Multiple_Artists_v1.0.2.txt`; older v1.0.1 remains historical. Full general substring ambiguity involving composite credits remains a documented limitation; Picard interactive QA is outstanding. v1.5.17 - Under construction ⚠️.

## Barcode toolbar shutdown and XE-to-EU display preference (2026-10-09; v1.5.18)

- User reports a small taskbar window labeled Barcode left behind when closing Picard. Likely native QToolBar made floating by Qt during main-window close; not yet confirmed by in-app screenshot/runtime test.
- Stop the 4-second barcode toolbar watcher immediately on the main window Close event, detach its QAction from **every** relevant toolbar (current, replaced child toolbars, floating top-level toolbars), and hide floating toolbars containing that action. Handle main-window Hide and QApplication.aboutToQuit as additional shutdown opportunities, and guard queued refreshes against reattaching the action while closing.
- If Picard rejects Close (e.g. unsaved user changes), restart watcher and restore the button on the still-visible main window. On normal plugin disable, remove QAction from all toolbars and disconnect the aboutToQuit signal; do not arbitrarily hide unrelated toolbars while Picard remains open.
- New Qt-independent regression checks cover detached/obsolete floating toolbar action cleanup, other toolbars unaffected, and static verification of close/cancel/quit guards. Windows taskbar exit test in Picard 3 remains pending.
- User explicitly wants `releasecountry=XE` stored as `EU` when a capitalization tool is enabled. MusicBrainz XE is Europe (not identical to EU political membership); the mapping is user-preferred output only. The *language-aware Python* capitalization handlers normalize exact XE in the releasecountry tag (scalar or multi-value) without touching unrelated region codes and tags; the *English Title Capitalization* standalone/embedded script appends an equivalent $if/$map mapping outside its English-only title branch, so even non-English release titles preserve country preferences.
- Published `picard-tools/scripts/English_Title_Capitalization_v1.1.4.txt` and synced stable manual script and embedded source; bumped plugin to `1.5.18 - Under construction ⚠️`; README and test parity updated. Verify auto-update in Picard, Close/Cancel Close, and XE/EU/idempotence in Picard's actual ScriptParser before marking tested.

## Cancelled Picard shutdown visibility recovery (2026-10-09; v1.5.19)

- During exit, record exactly which floating Barcode-containing Qt toolbars were visible and hidden by the plugin. On a rejected/cancelled main window Close event, restore visibility only for those specific toolbars, then reactivate the 4s watcher and reinstall the Barcode QAction. Toolbars that were hidden before Close remain hidden; docked native toolbars are never arbitrarily shown. Added pure-Python regression test for float-only hide/restore and static watcher check. Qt interactive Windows 11 runtime QA still pending. v1.5.19 - Under construction ⚠️.

## Digital-media releasecountry removal (2026-10-09; plugin v1.5.20)

- User rule: remove the `releasecountry` audio tag on MusicBrainz Digital Media releases; preserve the previous `XE` -> `EU` mapping on other releases. Do not infer digital release from MP3/FLAC/ALAC file codec, online purchase, or release title.
- Language-aware capitalization plugin: `normalize_europe_release_country(metadata, release_node)` now checks the source MusicBrainz `release_node['media']` when available, requiring *every* medium's format to be explicitly Digital Media. If missing, uses Picard's `media` tag and supports literal `Digital Media`, optional `2x`/`2×` count prefixes. Unknown or mixed physical/digital formats preserve releasecountry. Calls Picard `Metadata.delete('releasecountry')` to remove even a previously existing tag when saving; the fallback `dict.pop` exists only for non-Picard test dictionaries.
- Standalone/embedded English Title Capitalization v1.1.5: adds `$if($rsearch($lower(%media%),^[0-9]*[x×]?[ ]*digital media$),$delete(releasecountry),...)` *outside* the English-only title capitalization guard. This retains the XE->EU transformation on non-digital releases and removes the actual saved audio tag using `$delete` rather than `$unset`. Per-medium standalone scripts cannot inspect all formats of a mixed release; when a single track's media is Digital Media within a hybrid release, the standalone script treats it as digital. The language-aware plugin prefers the full release node to avoid this ambiguity.
- Regression test coverage: Digital Media (single, case insensitive, 2× count), CD, vinyl, unknown, hybrid release nodes, missing media formats, idempotence, and actual deletion marking. The script and its embedded counterpart must remain identical. Updated README and versioned standalone script download `English_Title_Capitalization_v1.1.5.txt`.
- Existing Barcode/UPC toolbar and all other scripts unchanged. Picard 3 interactive QA remains mandatory, especially verifying that the tag is actually removed from previously tagged MP3/FLAC/MP4 files after Save, and that physical CD/vinyl release countries remain intact. Keep v1.5.20 - Under construction ⚠️ until verified.

## Lowercase vs. abbreviation everywhere in capitalization (2026-10-09; plugin 1.5.21)

- User regression: capitalization erroneously transformed `Gypsyhook vs. Dmndays` to `Gypsyhook Vs. Dmndays`. Correct output is **always lowercase `vs.`** as an independent word, including title start, parenthetical ETI, and all language modes; do not rewrite unrelated `V.S.`, `Vsauce`, or undotted `vs`.
- Language-aware Python title capitalization now applies final `_lowercase_vs_abbreviation` using word-boundary/case-insensitive detection after all stylistic transforms. This is enforced both in `musicbrainz_english_title_case` and the general `standardize_title_case`, and is idempotent.
- Legacy standalone English Title Capitalization v1.1.6 (stable source, versioned source and plugin embedded source) adds final `$rreplace` rule `\\b[Vv][Ss]\\.` -> `vs.` immediately before assigning output to title/album, preventing a later rewrite in the same script from capitalizing it again.
- Additional audit of 1.5.20 detected a mistakenly double-escaped Python raw-regex whitespace atom (`\\s` rather than `\s`) in the `2x Digital Media` medium-format classifier. Corrected and added digital count-prefix tests; the existing country-removal rules remain unchanged otherwise.
- Tests cover example Gypsyhook title, uppercase `VS.`, title-start/ETI contexts, multiple language modes, idempotence, unrelated abbreviations, embedded/download parity, optional Picard ScriptParser runtime tests, and Digital Media count prefixes.
- The installed Windows Picard/PyQt6 environment was not accessible from this chat. Until interactive validation, keep 1.5.21 - Under construction ⚠️. Do not mark tested/stable.

- Final regex review corrected the new Python `vs.` normalization to use single regex escapes in the raw Python string (`\\b` and `\\.` represent *one* backslash in source regex syntax), so matching uses a word boundary and a literal full stop instead of escaped-backslash text. Preserve this distinction from the double escapes required in the Picard `$rreplace` scripting language.

## Persistent Barcode taskbar window after closing Picard (2026-10-09; v1.5.22)

- User provided screenshot of a separate tiny Picard taskbar window containing the Barcode QAction that remains after the main window closes, despite the old shutdown cleanup in v1.5.18-v1.5.19.
- Root-cause investigation: current upstream Picard `MainWindow.create_action_toolbar()` calls `self.toolbar.clear()` then `self.removeToolBar(self.toolbar)` and creates a new parentless `QtWidgets.QToolBar("Actions")` with object name `main_toolbar`. The removed QToolBar is not explicitly destroyed in that code path and may survive as a detached top-level window. Our former helper `_detach_barcode_action` only detected toolbars **still holding the Barcode QAction**, missing old toolbars after Picard clears their actions; and QApplication.aboutToQuit may never fire if that orphaned top-level window keeps the event loop alive.
- v1.5.22 adds `_retire_obsolete_picard_toolbars(window)` to identify QToolBar objects with `objectName()=="main_toolbar"` but different from the live `window.toolbar`, using the existing current/child/app-top-level widget enumeration. Detaches Barcode QAction when present, hides the obsolete toolbar immediately, and schedules `deleteLater()`. Never touches the current toolbar, Search/player toolbars, or unrelated plugin toolbars. Handles RuntimeError when Qt has already deleted a toolbar.
- Execute orphan retirement on watcher refresh (normal Picard toolbar customization; every 4s fallback), ChildRemoved events, main-window Close *before* checking actions, QApplication.aboutToQuit, and plugin disable. The older close-cancel restore logic for *current* floating toolbar remains intact, and stays separate from obsolete toolbar disposal.
- Tests cover an orphan without any QAction (key v1.5.19 regression), an orphan with the action, unrelated floating toolbar safety, replacement timing, and close/quit/disable hook coverage. No change to barcode lookup/matching, other tagging scripts, user toolbar configuration, or file paths.
- **Under construction ⚠️** until Picard on user's Windows PC is tested: update plugin, customize Options > User Interface > Toolbar several times, close/reopen Picard, verify *no* extra taskbar window and Barcode button still works at both normal and narrow widths; test canceling Exit while unsaved changes exist. Keep root GitHub rules, standard MANIFEST/plugin version, and user settings unchanged.

## User validation checkpoint - EP/Single suffix (2026-10-09)

- User replied "done" after being asked to test plugin v1.5.12 against `Gypsyhook EP` and the `album` suffix duplication; treat this as confirmation of that fix's successful test.
- Standalone `Add_EP_Single_Suffix_v1.0.2.txt` is marked tested (README Version/status: `1.0.2`, with construction label removed).
- Do **not** extrapolate this test to the currently published plugin `1.5.22`; changes from v1.5.13 through v1.5.22 (Unicode conversion, capitalization, artist handling and persistent Barcode taskbar-window fixes) remain separately unverified and the plugin must retain `1.5.22 - Under construction ⚠️` until the latest code receives user testing.
- The previously requested extra Barcode taskbar-window verification is still pending. Keep other standalone scripts' construction labels unchanged.
- No version increment or plugin-code changes were performed for this documentation-only confirmation.

## Barcode leading-zero equivalence regression (2026-10-09; v1.5.23)

- User-reported failure: file tag `barcode=602478746901` (UPC-A / GTIN-12) was not linked to MusicBrainz release `7045707b-621d-408c-9e97-3fc0c652ee24` with stored `barcode=0602478746901` (EAN-13 / GTIN-13). Those codes represent the same GTIN when normalized to zero-padded 14-digit GS1 representation.
- Prior `_barcodes_match` already recognized leading-zero equivalence, but the response handler in `_start_barcode_batch_lookup` required `form_targets.get(release_barcode)` exact textual equality. MusicBrainz can return a zero-padded barcode for a raw UPC query, causing a valid response to be silently discarded. Searching equivalent representations only in a later fallback pass was also fragile.
- v1.5.23 constructs queries for all supported `_barcode_forms` in the initial search; the handler now accepts a returned release only when its actual barcode passes `_barcodes_match` against the original file barcode. The same comparison applies to disc-count resolution; disc-count query variants include padded and unpadded forms.
- Preserve false-positive prevention: never select a result with a different GTIN, even if Lucene search returns it. The existing release-choice rule for multiple genuine barcode matches (disc-count filter, otherwise first result) is unchanged. File-to-track assignment remains by disc/track index as before.
- Added `picard-tools/tests/test_barcode_lookup_regressions.py` with five Qt-independent tests: equivalence, first-pass UPC/EAN search, padded response from raw query, different-barcode rejection and duplicate release/disc-count choice. The tests use AST-extracted repository functions and mocked asynchronous MusicBrainz responses; run locally with `python -m unittest discover -s picard-tools/tests -p "test_*.py"`. They are authored but not executed in this chat, and a Windows/Picard runtime test is still required.
- The MusicBrainz release itself could not be fetched live from this environment; the specific release/barcode mapping is user-supplied, whereas GS1's leading-zero equivalence is independently standardized.
- Manual QA: update Git-updatable Picard 3 plugin to v1.5.23, select a file containing the 12-digit UPC, click Barcode, verify it links to release `7045707b-621d-408c-9e97-3fc0c652ee24` and is matched by disc/track number. Check inverse EAN-13 file case, nonmatching last digit, batch lookup, and multiple releases. If a valid release is found but no track is assigned, investigate the separate disc/track-number matching logic rather than loosening GTIN comparison.
- Existing Picard toolbar/taskbar issues remain independently pending user runtime verification. Keep v1.5.23 - Under construction ⚠️; do not infer complete testing from the previous EP suffix `done` confirmation.


## All-caps THE OUTSIDE capitalization fix (2026-10-09; standalone 1.1.7 / plugin 1.5.24)

- User reproduction: MusicBrainz release `a0a74e7e-227c-4abc-ad09-bfd59bdf25af`. Original `album` and `title` are `THE OUTSIDE (OUTSIDERS VERSION)`. Existing standalone 1.1.6 left `album` uppercase before Add EP/Single Suffix appended ` - Single`; combined capitalization fallback could turn the track into `The outside (Outsiders Version)`. Required: `album=The Outside (Outsiders Version) - Single`; `title=The Outside (Outsiders Version)`.
- Root cause 1: Picard `$title()` only uppercase-initializes words and deliberately does NOT lowercase trailing all-capital letters; e.g. `$title(THIS TEXT)` remains `THIS TEXT`. Correct approach for typographic all-caps is `$title($lower(...))`. Detection must ignore a terminal ` - Single` or ` - EP` suffix (which is mixed-case), so running capitalization before or after Add EP/Single Suffix is idempotent.
- Standalone `picard-tools/scripts/English_Title_Capitalization_v1.1.7.txt`: chooses `$title($lower(...))` when the complete main title is uppercase; otherwise retains previous `$title(...)` to protect ordinary mixed-case input. Accepts obvious `THE ...` English releases when MB language is undetermined/multiple, while preserving Spanish `la noche` and Portuguese `vai sentando` exceptions. Reconstitutes ` - EP` uppercase if needed; protects common DJ/VIP/EDM/BBC/UK/USA/EP/LP acronyms when an all-caps title is normalized. Keeps existing final lowercase `vs.` and Digital Media releasecountry deletion / XE->EU. Manually noted acronym coverage is not exhaustive; review other uppercase stylized identifiers in runtime testing.
- Language-aware Python plugin: for unknown-language releases, `_english_all_caps_title()` identifies conservative leading-`THE ` English headline even with a trailing canonical release-type suffix and dispatches to English title case, not the generic unknown-language sentence-case fallback. Explicit French/Spanish/Portuguese language choices and the Spanish/Portuguese overriding heuristics remain unchanged.
- Added static and Picard-runtime regression methods for both fields, unknown/English language codes, either script order, existing/missing suffixes, repeated processing, preservation of country codes and lowercase vs., and earlier phrasal-verb regressions. Keep embedded script byte-identical to standalone and versioned source; follow main plugin update with the user's own Picard 3 runtime test. v1.5.24 - Under construction ⚠️.
