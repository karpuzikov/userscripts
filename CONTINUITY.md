# Karpuzikov Picard Scripts - Continuity

## Product and state
- Product: Karpuzikov Picard Scripts, a Picard 3.x Git-updatable MusicBrainz metadata plugin.
- Current version: 1.5.17 - Under construction ⚠️ (not yet verified inside user Picard).
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
