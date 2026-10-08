# Karpuzikov Picard Scripts - Continuity

## Product and state
- Product: Karpuzikov Picard Scripts, a Picard 3.x Git-updatable MusicBrainz metadata plugin.
- Current version: 1.5.10 - Under construction ⚠️ (not yet verified inside user Picard).
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
- Manual `Add_EP_Single_Suffix_v1.0.1.txt`: trims and removes all repeated case-insensitive matching final suffixes before adding one canonical suffix. Runs must be idempotent.
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
- No user-environment runtime verification for 1.5.9 yet. Leave the product Under construction ⚠️ until Picard confirms behavior.
- The prior manual script version 1.0.0 did not write `albumartist`; the embedded copy had the same omission. Version 1.0.1/1.5.8 adds album-artist formatting.
- Next action: update Picard plugin to v1.5.10 and verify barcode icon/Tools > Plugins entry after a toolbar customization; then run `python -m unittest discover -s picard-tools/tests` in a Python 3.9+ environment, validate the embedded Picard ScriptParser output for suffixes, then test the four linked Skrillex releases in Picard 3. Verify results are stable after a second reload and that existing ETI removal remains unchanged. Test the earlier Format Multiple Artists scenarios separately.
