# Karpuzikov Picard Scripts - Continuity

## Product and state
- Product: Karpuzikov Picard Scripts, a Picard 3.x Git-updatable MusicBrainz metadata plugin.
- Current version: 1.5.8 - Under construction ⚠️ (not yet verified inside user Picard).
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
- New in 1.5.8 / standalone 1.0.1: independently format `albumartist` using the Picard 3 multi-value `albumartists` tag with the same 1/2/3+ joining rules. If `albumartists` is missing or empty, do not overwrite `albumartist`. Never derive release artists from track `artists`.
- Keep both operations idempotent and preserve source artist order. Only explicit existing script logic changes names; other tags and identities are untouched.

## Dependencies and persistent data
- Requires MusicBrainz Picard 3.x, Python >=3.9 as embedded by Picard, and PyQt6 provided by Picard.
- No separately installed Python packages or filesystem persistent data owned by this plugin. Picard manages plugin configuration, source updates and tagging lifecycle.
- Continue honoring GitHub-wide requirements: actual version alongside `Under construction ⚠️`, version in user-downloadable filenames, preservation of settings, native UX conventions and UXDT guidelines where applicable.
- Existing plugin option labels and controls remain unchanged in this update.

## Verification and release
- Validated by source consistency checks: standalone script and embedded plugin text match; original `artist` logic is unchanged; `albumartists` guards, output assignment and joins are present.
- Source-level join checks include 1, 2, 3 artists. These checks do NOT constitute a full Picard runtime test.
- Next manual QA inside Picard 3: 1 artist, 2 artists, >=3 artists, `albumartists` missing, track credits different from release credits, repeated refresh/reprocessing, settings preserved, and no duplicate application from Options > Scripting and the shared plugin.
- Recheck all final version strings, README URLs, syntax of the Python module, and the published versioned standalone download.

## Known limitations and next action
- No user-environment runtime verification yet. Leave the product Under construction ⚠️ until Picard confirms behavior.
- The prior manual script version 1.0.0 did not write `albumartist`; the embedded copy had the same omission. Version 1.0.1/1.5.8 adds album-artist formatting.
- Next action: test the new plugin through Picard's native update check or the versioned standalone `.txt` file, then collect actual before/after `artist` and `albumartist` metadata for any remaining defects.
