# Discography Torrent Project

Last updated: 2026-09-27

## Goal

Reduce the manual work required to prepare complete discography torrents while preserving the user's existing quality-control decisions and preferred tools.

The long-term direction is one controller application that automates the glue between existing tools instead of replacing mature tools without a clear benefit.

Canonical decision rules: [`RULES.md`](RULES.md). All duplicate/edition/source-selection rules belong there and should be updated there rather than duplicated in project notes.

## Current workflow

1. Download every available release into a folder named `recycle`.
2. Remove redundant material:
   - singles/EPs already fully represented on albums can be removed;
   - keep different versions and bonus tracks not present elsewhere;
   - compare standard/special/limited editions;
   - priority is the greatest number of useful original recordings, not remixes/live recordings;
   - source preference: CD rip with LOG+CUE > WEB.
3. Run AudioChecker for releases without an appropriate rip log, including WEB releases as required.
4. Convert everything to ALAC using refalac through CUETools and/or xrecode2.
5. CUETools creates release folders using:
   `%artist%\\[%year% ]- %album%[ '('disc %discnumberandname%')'][' ['%releasedateandlabel%']'][' ('%unique%')']`
6. Fix and standardize tags with MusicBrainz Picard and/or Mp3tag.
7. Compare equivalent recordings/releases and standardize titles such as live/acoustic/MTV Unplugged naming.
8. Find the best available cover art.
9. Rename master covers to match the release folder name.
10. Run the Photoshop 500 PNG / 600 JPG processing script.
11. Put the 600 px JPG into the corresponding release folder.
12. Use MediaHuman Lyrics Finder to embed lyrics.
13. Run the Mp3tag `Мой стандарт.mta` normalization action.
14. Use CUE Corrector for DiscID/MusicBrainz matching, CUE metadata completion, and CUE FILE-name correction.
15. Use Mp3tag `ALAC + header.mte` to generate RuTracker BBCode.
16. Upload 500 px cover images to FastPic.
17. Insert each direct image URL into the matching release's `[img=right]...[/img]` BBCode.
18. Create the torrent with qBittorrent.
19. Post the torrent.
20. Run `CUE LOG 4.1.pyw` to collect LOG/CUE data and post it as a comment.

## Automation strategy

Do not replace CUETools, refalac, Picard, Mp3tag, MediaHuman, CUE Corrector behavior, Photoshop logic, qBittorrent, or CUE LOG logic unless replacement produces a clear benefit.

Primary automation targets:

- scan and classify everything under `recycle`;
- assist duplicate/edition comparison;
- detect releases that require AudioChecker;
- route sources to the correct ALAC conversion path;
- enforce tag/title consistency;
- automate cover renaming, processing, and placement;
- automate CUE DiscID review and MusicBrainz import;
- generate final RuTracker BBCode;
- map uploaded cover URLs back to the correct release;
- create the torrent;
- generate the CUE/LOG comment;
- maintain per-release state so unfinished items are obvious.

## Duplicate / edition comparison rules

See the canonical rulebook: [`RULES.md`](RULES.md).

The Duplicate / Edition Analyzer must implement those rules and report KEEP / REDUNDANT / REPLACE / NEW decisions with reasons. It must never silently delete material.

## CUE Corrector replacement subset

Original program supplied: CueCorrectorNET.

The useful subset is being recreated as a standalone `.pyw` tool.

Required behavior:

1. Select a release/CUE or batch folder.
2. Reconcile stale CUE `FILE` names in memory before DiscID calculation.
3. Calculate the MusicBrainz DiscID / TOC correctly, including pregap/HTOA cases.
4. Query MusicBrainz.
5. Never silently choose a concrete edition.
6. Show all DiscID matches with enough information to identify the physical release:
   - artist;
   - release title;
   - disambiguation;
   - date;
   - country;
   - label(s);
   - catalog number(s);
   - barcode;
   - medium format;
   - disc position;
   - track count;
   - packaging;
   - status;
   - release MBID.
7. Provide links to the MusicBrainz DiscID page and selected release.
8. User explicitly chooses the concrete release or skips it.
9. Populate the CUE from the selected MusicBrainz release.
10. Correct CUE `FILE` names.
11. Preserve indexes, pregaps, HTOA, and unrelated structural data.
12. Save only after explicit user action.

### MusicBrainz request lesson

Do not depend on unsupported DiscID `inc` combinations.

The reliable direction is:

- use the DiscID/TOC lookup only to obtain the associated release matches;
- fetch full release details separately by release MBID;
- retry transient 429/5xx responses with backoff.

## CUE metadata parity

Comparison was performed between:

- original CUE;
- original CUE Corrector output;
- standalone Python tool output.

Track-level MusicBrainz data and corrected filenames were effectively aligned.

Known header requirements:

- `REM COMMENT` must be cleared/removed.
- `REM DISCNUMBER` must come from MusicBrainz.
- `REM TOTALDISCS` must come from MusicBrainz.
- Disc numbering must count only CD media. Ignore DVD and other non-CD media in the release when determining CD disc position and total CD count.
- Preserve CUE Corrector-compatible quoting/formatting for fields such as label and catalog number.

Current MusicBrainz -> CUE mapping includes:

Album:
- `REM DATE`
- `CATALOG` = barcode
- `REM LABEL`
- `REM LABELNUMBER`
- `PERFORMER`
- `TITLE`
- `REM DISCNUMBER`
- `REM TOTALDISCS`

Track:
- `TITLE`
- `PERFORMER`
- `SONGWRITER`
- `REM COMPOSER`

## Shared title/tag normalization rules

The same normalization rules must be applied to:

1. titles/artist data written into the CUE; and
2. tags inside the actual audio files.

Source of truth:
`picard-tools/scripts/`

Current relevant scripts:

- `English_Title_Capitalization.txt`
- `Move_Featured_Artists_to_Title.txt`
- `Format_Multiple_Artists.txt`
- `Unicode_to_ASCII.txt`
- `Add_EP_Single_Suffix.txt`

### English title capitalization

Use Picard's titlecase behavior, not Python's naive `.title()`.

Then lowercase ordinary internal words such as:
`a, an, the, and, but, or, nor, as, at, for, of, to, cum, mid, per, qua, re, via, with, without`

Capitalize them again after `:`, `!`, or `?` where required by the existing Picard script.

### Featured artists

Match the current Picard behavior:

- remove featured-credit text from `artist` and `albumartist`;
- normalize `feat.` / `feat` form to `ft.`;
- append the featured credit to the title as `(ft. Artist)`.

CUE and file tags must stay synchronized.

### Multiple artists

Use the Picard rule already in the repo:

- 1 artist: `Artist A`
- 2 artists: `Artist A & Artist B`
- 3+: `Artist A, Artist B & Artist C`

### Unicode -> ASCII normalization

Use the existing Picard replacement table for:

- smart apostrophes/quotes;
- Unicode dashes;
- ellipsis;
- full-width punctuation;
- non-breaking/thin spaces;
- other mapped punctuation and symbols.

Do not invent additional replacements without adding them to the shared rule set.

## Cover workflow

Existing Photoshop script behavior to preserve:

- 600 px JPG on the longer side;
- target maximum around 170 KB using the highest JPEG quality that fits;
- 500 px PNG for upload, with JPG fallback when needed;
- 500 KB limit for the upload image.

Known bug in the old Photoshop helper:
if no JPEG quality 12..1 meets the 170 KB target, it falls back to quality 8. This can violate the size target and should be corrected.

Desired automated flow:

`choose master cover -> rename -> make 600 JPG -> make 500 upload image -> place 600 JPG in release -> put upload image in FastPic queue`

## BBCode / FastPic

Existing `ALAC + header.mte` generates deterministic RuTracker BBCode from tags and folders.

Desired flow:

`finished releases -> generate BBCode -> upload 500 px covers -> collect direct URLs -> map URL by release folder name -> insert into each [img=right] block`

If FastPic automation is unreliable, support a fallback where the user pastes upload results and the program maps URLs to releases automatically.

## CUE LOG

Existing `CUE LOG 4.1.pyw` behavior to preserve:

- recursively collects CUE/LOG data;
- prefers `audiochecker.log` over another LOG in the same folder;
- labels AudioChecker logs as quality-check logs;
- nests release data in BBCode spoilers;
- splits long output without breaking spoiler structure;
- writes UTF-8 output files.

Long-term integration:
run this logic automatically at the final torrent preparation stage and prepare/copy the comment text.

## Duplicate / Edition Analyzer UX

- Do not show a per-release review/results table as the normal workflow.
- The software performs the track-by-track duplicate/version analysis and release optimization itself.
- Uncertain equivalence is resolved conservatively by keeping both tracks/releases.
- After scanning, show one global confirmation containing summary counts only.
- On confirmation, automatically move redundant release folders into a reversible timestamped backup.
- Leave required recycle releases in the recycle folder for the next processing stage.
- Final UI should only show a short completion summary plus Open filtered recycle / Open backup / Undo.
- Technical diagnostics are optional and must not be required for normal use.

## Proposed controller

Working concept: `Discography Builder.pyw`

Per-release status columns:

- Source
- Duplicate review
- Audio check
- ALAC
- Tags
- CUE
- Lyrics
- Cover
- BBCode
- Ready

High-level stages:

1. Analyze Recycle
2. Compare Editions
3. Audio Verification
4. ALAC Conversion
5. Metadata
6. CUE DiscID / MusicBrainz
7. Lyrics
8. Covers
9. Final Validation
10. Generate RuTracker BBCode
11. Upload/insert cover links
12. Create torrent
13. Generate CUE/LOG comment
14. Open prepared RuTracker submission

## Current immediate work

Duplicate / Edition Analyzer is now the active implementation focus.

Canonical behavior is defined in [`RULES.md`](RULES.md).

Current analyzer requirements:

1. scan the existing ALAC discography and recycle/update folder together;
2. compare decoded audio hashes, MusicBrainz recording IDs, ISRCs, normalized titles and durations;
3. preserve all unique recordings/versions;
4. minimize retained audio-file count;
5. keep every album represented while allowing redundant editions to be removed;
6. prefer explicit over equivalent clean;
7. prefer CD + LOG/CUE over equivalent WEB;
8. treat album editions, singles and EPs as one collection-wide optimization problem;
9. output KEEP / REDUNDANT / REPLACE / REVIEW / NEW with reasons;
10. never delete automatically.

The 3OH!3 existing-ALAC + recycle-WEB dataset is the first validation case.

## Important principles

- Never silently delete a release during duplicate analysis.
- Never silently choose a MusicBrainz edition from a DiscID match.
- Preserve source CUE structure where possible.
- Back up a CUE before destructive modification.
- CUE and embedded file tags must agree.
- Existing user rules/scripts are the source of truth.
- Prefer one `.pyw` application and minimal file count for the final tool.
