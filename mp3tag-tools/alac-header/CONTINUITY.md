# ALAC + header (Mp3tag export) - Continuity

## Product and status
- Product: ALAC + header - a native Mp3tag .mte text export for RuTracker ALAC discography BBCode.
- Version: 9.0.0 (v9) - Under construction ⚠️. The user visually confirmed correct parent/CD spoiler nesting for the beginning of the GIMS discography on RuTracker on 2026-10-18; the complete full-discography render and native Mp3tag test cannot be independently executed here.
- Repository: `karpuzikov/userscripts`, branch `main`.
- Canonical downloadable source: `mp3tag-tools/alac-header/ALAC + header v9.00.00.mte`. This is byte-identical to the user-tested `ALAC_Parent_Spoilers_v9_FRESH.mte` (including its output filename).

## Scope and invariants
- Keep the original export header, image/source lines, album/track text formatting, per-folder durations and discography total.
- Ordinary single-folder releases have one spoiler and no nested CD spoiler.
- Releases containing subfolders `CD 1`, `CD 2`, etc. have ONE parent album spoiler named after the enclosing release folder; inside are individual CD spoilers, durations and tracklists.
- Every CD must close before the next CD, and each parent release must close before the next release. Never nest one release under another.
- Avoid any unrelated changes to the original `ALAC + header.mte` formatting or data.
- Export uses Mp3tag's `$loop($regexp(%_folderpath%,'\\\\CD [^\\\\]+\\\\$',''),1)` grouping expression, with a nested folder and track loop. Note the exact escaping in the .mte file is two backslash characters in each regex position.
- Only folders with a leading literal `CD ` are treated as nested discs. Other nested naming schemes have not been tested; do not imply support.
- Template output filename: `ALAC_Parent_Spoilers_v9_FRESH.txt`; do not append new content to older exports.
- This is a native Mp3tag export configuration file: no custom UI, separate runtime, dependencies, logs or persistent application state. It reads selected audio metadata; it does not modify audio files.

## Regression examples
- `2013-05-13 - Subliminal - La Face Cachée [EU - 88883792232]`: two CDs (Subliminal, La Face cachée).
- `2015-08-28 - Mon Cœur Avait Raison [EU - 88875127872]`: two CDs (Pilule bleue, Pilule rouge).
- `2018-03-23 - Ceinture Noire (Décennie) [EU - 19439710432 - 2019]`: three CDs.
- Single-folder example: `2016-04-29 - Zoum Zoum - Single [886445883039]` must remain a separate top-level spoiler.
- User-supplied inventory showed 65 releases / 7 CD subfolders. Prior broken versions v1-v8 either omitted outer parents or incorrectly nested consecutive releases, in some cases triggering RuTracker's maximum post size warning. Do not revive that parent-closure approach.

## Verification
- 2026-10-18: User uploaded a screenshot of the RuTracker BBCode preview after running v9. It showed the Subliminal album containing CD 1 and CD 2, then a correctly separate Mon Cœur Avait Raison album containing its two CDs, followed by a separate single. User said "omg, looks like you did it!"
- Target-platform end-to-end check of the entire output: NOT RUN here. Do not claim verified for all 65 releases.
- Future test: select entire artist folder recursively in Mp3tag, export with the current .mte, ensure Append data is OFF, preview in RuTracker, expand all three multi-disc albums, and verify all other releases are at top level. Confirm total duration and absence of duplicates.

## Update/release procedure
- Read root `SOFTWARE_RULES.md`, `UI_UX_RULES.md` (if interface work occurs), `UI_UX_ACCEPTANCE.md`, and this continuity file first.
- Keep the exact working v9 source as a historical checkpoint; make any future changes in a newly versioned `.mte` file with sorting-safe version name, update the repository README/download link and this document together.
- No GitHub Actions changes. Manual inspection of the real rendered RuTracker preview is the acceptance gate.
