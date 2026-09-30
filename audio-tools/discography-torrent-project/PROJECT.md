# Discography Torrent Project

Last updated: 2026-09-30

## Repository source-of-truth rule

The GitHub directory `audio-tools/discography-torrent-project/` is the canonical source of truth for the entire project.

- Every current project-owned script must be stored here.
- Every current workflow asset used by this project must be stored here.
- Documentation and code must be updated together when behavior changes.
- New versions must be committed to GitHub when they are produced, not left only as chat/download artifacts.
- Third-party applications/binaries are dependencies and are not vendored unless redistribution is explicitly appropriate.

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

## Duplicate / Edition Analyzer UX\n\n- Startup failures are never silent: the analyzer shows the exception when possible and writes `Documents\\Karpuzikov Tools\\Duplicate Edition Analyzer - Crash.log`.\n\n- Release discovery is recursive: organizational folders such as Albums/Other/Singles and per-single grouping folders are traversed, while CD1/CD2/Disc subfolders remain grouped as one release.

- Remix exclusion exception: remixes with newly added featured performers remain included; if no matching non-remix base is present, an explicitly featured remix is kept conservatively.\n\n- Analyzer UI uses a unified dark theme by default, including dark Windows title bars when supported.

- Release discovery is recursive through organizational folders. Internal CD1/CD2 folders and sibling `... CD 1` / `... CD 2` folders are treated as one logical release and kept/moved together.

- Existing discography is optional: when blank, the analyzer optimizes Recycle against itself; when supplied, it compares Existing + Recycle together.

- Source detection: `.cue` + any `.log` except `audiochecker.log` = CD. Equivalent existing ALAC content wins over equivalent recycle content unless recycle is objectively better by current active rules (for example CD vs WEB) or adds unique included audio.

- Do not show a per-release review/results table as the normal workflow.
- The software performs the track-by-track duplicate/version analysis and release optimization itself.
- Uncertain equivalence is resolved conservatively by keeping both tracks/releases.
- After scanning, show one global confirmation containing summary counts only.
- On confirmation, automatically move redundant release folders as-is into `<artist>_duplicates`; never rename the release folders.
- Create `<artist>_duplicates` as a sibling of the selected artist folder, e.g. `...\!recycle\3OH!3_duplicates`.
- Redundant folders containing remix material go under `<artist>_duplicates/!Remixes/`.
- `Save Remixes` and `Save Live recordings` are persistent affirmative checkboxes, unchecked by default; checked categories count as included coverage.
- Before Chromaprint comparison, show an unusual-pattern review only for non-standard non-remix/non-live descriptors that normal rules do not already understand. Standard families are recognized structurally, not by exact phrases: arbitrary prefixes must not make ordinary Radio Edit/Mix, Instrumental, Acoustic, Demo, Session, Remaster, Edit/Re-Edit, Extended/VIP/Vocal Mix, 7-inch/12-inch forms, common Version/Edition labels, etc. appear. Named/ambiguous plain mixes such as `The Matrix Mix` / `Tom Lord-Alge Mix` may remain review candidates. Similar callout labels are grouped. Remix/live remain controlled only by their existing checkboxes.
- `Mix` alone is not a remix marker: Original/Extended/12-inch/7-inch mixes and Instrumental/A-Capella versions stay included unless redundant for other reasons; Club Mix is remix material.
- Version/language labels never create duplicate identity, but strong conflicts may conservatively veto an otherwise-valid audio match.
- Track duplicate identity still requires strict Chromaprint similarity; metadata can never create a match. A post-audio safety gate now blocks merges when strong contradictory evidence indicates a distinct recording/version (for example different recording MBIDs, semantic version/language conflicts, or different ISRCs combined with conflicting titles/credits).
- Candidate discovery may use exact identifiers and same-base-title + duration only as hints; every final duplicate still requires the audio matcher.
- Large fingerprint offsets are allowed so long silence/hidden-track padding can be ignored; substantial non-silent extra audio remains a distinct version.
- Remix tracks are excluded from included coverage, but a release containing remixes is not automatically ignored. For equivalent included album content, CD/physical media wins over WEB before file-count minimization. Explicit/clean is deferred until a reliable detector exists.
- Leave required recycle releases in the recycle folder for the next processing stage.
- Final UI should only show a short completion summary plus Open filtered recycle / Open duplicates / Undo.
- Technical diagnostics are optional and must not be required for normal use.
- Every analysis run writes a detailed JSONL comparison log outside the scanned artist folder, normally under `<artist>_analysis_logs`. Each compared pair records candidate-discovery route, track paths/titles/IDs/credits/version descriptors, durations, every Chromaprint metric, strict/mastering threshold state, metadata-safety result, final MATCH/REJECT decision, and run summary. The log also reports possible-pair vs candidate-pair counts so prefilter efficiency can be audited.

## AudioChecker automation

Current stage after duplicate filtering.

Required behavior:

1. Use the filtered recycle/update artist folder from the appropriate per-program persistent settings when available.
2. Recursively find folders containing AudioChecker-supported lossless audio.
3. Treat a folder as a CD release when it contains both:
   - at least one `.cue`; and
   - at least one `.log` other than `audiochecker.log`.
4. Skip those CD folders.
5. Skip folders that already contain a valid `audiochecker.log` covering all supported audio files in that folder.
6. Run the existing Dester AudioChecker (`achkgui.exe`) automatically for the remaining folders.
7. Reuse AudioChecker's own generated `audiochecker.log`; do not fabricate/rewrite the protected log format.
8. Remember the selected `achkgui.exe` path across launches and versions in that program's own `Documents\\Karpuzikov Tools\\<Program Name>\\settings.json`.
9. If an existing `audiochecker.log` is stale/invalid, preserve it temporarily outside the release folder while regenerating it; restore it if generation fails.
10. Normal UI is automatic: one folder, progress, final counts. No per-release review.

## ALAC conversion automation

Current stage after AudioChecker.

Required behavior:

1. Reuse the filtered recycle/update artist folder from the appropriate per-program persistent settings.
2. Convert supported lossless audio to ALAC in place.
3. Use refalac for the ALAC encode.
4. For normal track-based releases, preserve metadata/artwork and verify decoded PCM before removing the source file.
5. For CD releases identified by `.cue` + real rip `.log`, use the CUE as the authoritative split input so image rips and file-per-track CUEs are handled correctly.
6. Preserve CUE, LOG, artwork, and all other non-audio files.
7. Skip files already encoded as ALAC.
8. Refuse lossy/unknown codecs instead of wrapping them in ALAC.
9. Remove/replace source audio only after verified output exists.
10. Use up to four simultaneous conversion jobs.
11. Reuse that program's own `Documents\\Karpuzikov Tools\\<Program Name>\\settings.json` and remember all repeatable paths.
12. Bootstrap required dependencies automatically: check/install winget first when needed, install FFmpeg through winget, and obtain refalac automatically when missing.
13. Normal UI is automatic: choose/reuse one root folder, convert, then show only summary counts/errors.

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

Duplicate / Edition Analyzer and AudioChecker automation are complete enough for now.

Active implementation focus: ALAC conversion automation.

Current target:

1. reuse the filtered recycle/update folder automatically;
2. convert lossless sources to ALAC in place with refalac;
3. use CUE-aware conversion for CD releases;
4. preserve tags/artwork and non-audio release files;
5. verify output before deleting source audio;
6. skip existing ALAC;
7. refuse lossy sources;
8. process up to four jobs concurrently;
9. remember all repeatable paths/settings and bootstrap dependencies.

Next stage after this: metadata/tag normalization using the shared Picard rules.

## Important principles

- Never silently delete a release during duplicate analysis.
- Never silently choose a MusicBrainz edition from a DiscID match.
- Preserve source CUE structure where possible.
- Back up a CUE before destructive modification.
- CUE and embedded file tags must agree.
- Existing user rules/scripts are the source of truth.
- Prefer one `.pyw` application and minimal file count for the final tool.

- Chromaprint generation auto-scales parallel fpcalc workers to logical CPU count (up to 32) instead of a fixed 4, and skips tracks already excluded from included coverage by the remix/live options.

- Post-fingerprint matching now shows explicit Indexing/Finding candidates/Comparing audio/Optimizing stages. Candidate discovery uses an inverted fingerprint-token index and similarity checks use multi-process CPU parallelism instead of silently running on one Python thread.

- UI labels must explain the effect of each option to a first-time user; ambiguous labels such as `Exclude remixes` are replaced by explicit behavior such as `Ignore remix tracks when deciding which releases must be kept`, with concise inline explanations.

- UI uses concise affirmative controls (`Save Remixes`, `Save Live recordings`) and a visible progress/activity area with current stage, counts, percentage, elapsed time, and move progress. Detailed explanations belong in tooltips rather than permanent paragraphs.

- Duplicate moves preserve the source-relative hierarchy under `<artist>_duplicates`; remix-bucket moves preserve it under `<artist>_duplicates/!Remixes`.
- Empty organizational folders left after successful moves are removed.
- Album editions are clustered by strong ordered overlap of audio-derived fingerprint groups rather than edition/folder naming.
- Chromaprint candidate discovery uses strong token overlap, a weaker token+duration fallback, exact MBID/ISRC candidate indexes, and same-base-title + close-duration fallback. Pure duration-only all-pairs comparison is prohibited because it caused near-quadratic comparison volume.
- Audio matching always evaluates zero/near-zero fingerprint alignment as well as histogram-derived offsets, preventing mastering differences from hiding the correct alignment.
- A second mastering/pressing-tolerant Chromaprint threshold handles near-identical-duration copies of the same recording without using filenames/titles.
- A final redundancy-prune pass removes selected singles/EPs that add no included audio when equal-or-better retained sources already cover them.
- Named person/DJ/producer/act `Mix` labels (for example `Ferry Corsten Mix`, `Tom Lord-Alge Mix`, `Madlib's Mix`) are remix material and are controlled by `Save Remixes`; they must not appear in the unusual-pattern review.

- v0.9.8 classifier refinement: hide standard suffix families regardless of prefix (12-inch, Extended Version, Full Version, style Mixes such as Ambient/Chillout/Downtempo/Garage/House/Trance, instrument versions, etc.); ignore year-only parser fragments; group bare `hook` with Call Out/Callout Hook; treat `Mix by <name>` and handle-style named mixes as remixes; repair mojibake in displayed examples.

- v0.9.9 classifier refinement: hide remaining standard forms including 7-inch/12-inch Version, Big/New/Smooth/Low Gain Mix, OG Version, Single Version + year compounds, Chillout/genre versions, Special DJ Version, regional abbreviations such as US Version, and normal Pop Version suffixes.

- Intra-release duplicate cleanup: after release selection, retained non-CUE releases are checked for multiple files representing the same logical track. A file is redundant only when it shares the same high-confidence audio group, same normalized title, same track position, and same physical disc/folder. Keep the technically better copy and move the redundant file under `!Duplicate Files`; never delete it. CUE-based releases are excluded from this cleanup to avoid breaking CUE references. `Rmx` is treated as `Remix`.

- Logging checkbox: detailed JSONL comparison logging is optional from the main UI and persists with the other analyzer settings. Unchecked means no comparison log is created; checked means the existing detailed comparison log is written for that run.

- ITUNESADVISORY final preference: `ITUNESADVISORY=0` is clean and `ITUNESADVISORY=1` is explicit. Clean/explicit remains neutral during fingerprint comparison, coverage, album/source optimization, and track-count minimization. At the absolute final selection stage only, if clean and explicit copies are the same release with identical source class, track count, included track order, and exact audio-group multiset, retain explicit and move clean. If the audio differs (for example a genuinely censored edit), both remain distinct.

- v0.10.3 intra-release dedupe fix: fingerprint all tracks, including tracks excluded from included coverage, so retained releases can still be deduplicated safely. Same-track safety now accepts agreement from either embedded title or normalized filename while still requiring the same physical folder, same track position, and the same high-confidence audio group. This fixes missed pairs such as `01 - Mask Off (Marshmello Remix)` vs `01 Mask Off (Marshmello Remix)` when tags differ.

- hey-bro-check-log CD rip quality: integrate `ligh7s/hey-bro-check-log` v1.3.2 as an auto-installed runtime dependency. Score every non-`audiochecker.log` EAC/XLD rip log. A multi-disc release is compared by worst-disc score first, then average, then flagged status. Unrecognized/unsupported logs remain neutral. Log quality is used only after audio/content/source equivalence is proven, so it cannot create duplicate identity or remove a different edition. A higher-scoring exact-equivalent CD rip may replace an existing lower-scoring CD rip; existing wins when log quality ties or is unavailable. ITUNESADVISORY explicit-over-clean remains the absolute final tie-break.

- v0.11.1 absolute exclusion semantics: unchecked `Save Remixes` / `Save Live recordings` makes those tracks invisible to all release-selection logic, not just fingerprint coverage. They do not contribute to included counts, album/EP/single heuristic type, edition equivalence, CD-log tie-break eligibility, clean/explicit equivalence, minimum-file scoring, or later tie-breaks. Removed the remix featured-artist exception. `Session`/`Sessions` and `Unplugged` are treated as live-performance material for this option. Ignored files remain physically inside a retained mixed release but can never make that release win.

- v0.11.2 checkbox semantics: use direct checkbox inclusion semantics. `Save Remixes` and `Save Live recordings` are direct inclusion switches. Checked means that category participates normally in release comparison, coverage, counts, optimization, and tie-breaks. Unchecked means that category is skipped completely by those stages. Mixed releases may still physically contain skipped tracks, but skipped tracks have zero influence on which release is kept.

- v0.11.3 collection-wide track minimization: remove the pairwise rule that automatically preferred an album superset over a smaller edition. Extra tracks on a larger edition do not justify it when those same recording groups are already supplied elsewhere in the retained collection. After the full selection is assembled, iteratively replace a selected album with a smaller related edition when source class is not worse, every included recording group remains covered globally, and total included track count strictly decreases. Re-run redundancy pruning afterward. This is intended to prefer the 25-track `All This Bad Blood` US edition over the 26-included-track `[4710 084-7]` edition when `bad_news` is already supplied by retained `VS.`.

- v0.11.4 tempo/effect remix classification: treat `Sped Up`/`Speed Up`, `Slowed`/`Slowed Down`, and `Reverb`/`Reverbed` variants as remix material. They follow `Save Remixes` exactly: checked means included normally; unchecked means skipped completely. Release/package routing also recognizes these labels so redundant releases are archived under `!Remixes`.

- v0.11.5 Redux remix classification: treat `Redux` as remix material. This covers titles such as `Overjoyed (Detour City Redux)`. Redux follows `Save Remixes` exactly, is stripped by remix base-title normalization, is treated as a semantic version descriptor for match safety, and redundant Redux releases route under `!Remixes`.

- v0.11.6 Personal Picks: add a persistent `Personal Picks...` rule editor beside the remix/live options. Phrase rules are case/punctuation-insensitive substring matches, intended for families such as `Live From Capitol Studios`; exact-title rules match only a normalized complete track title/filename. Personal Picks only override an otherwise skipped remix/live track. The restored recording then participates normally in global collection optimization, so the analyzer still chooses the minimum-track release set and does not force a specific release. Rules are stored in the shared settings file under `personal_keep_rules_v1`, and matched rules are written into comparison JSONL as `personal_keep_rule`.

- v0.11.7 Personal Picks phrase detector: add `Detect phrases...` inside Personal Picks. It scans audio filenames from the currently selected Existing and New/update roots, extracts parenthetical/bracket and named Mix descriptors, filters to live/remix-classified phrases, strips year/punctuation noise, groups recurring `Live From`/`Live At` venue families, shows occurrence counts/examples, and lets the user multi-select phrases to add as persistent Personal Picks. Existing rules are omitted from detector results.

- v0.11.8 automatic phrase review: after pressing Analyze and completing the metadata scan, detect remix/live phrase families from the already-scanned tracks for categories currently disabled by `Save Remixes` / `Save Live recordings`. Show a dark review window with phrase, category, occurrence count, examples, and a per-row `Add to keep list` button. Existing Personal Picks show `In keep list`. `Continue` persists newly added phrases and proceeds to the existing unusual-pattern review and fingerprint optimization. `Personal Picks...` remains for manual add/remove management.

- v0.11.8 storage layout was the older shared-root design and is superseded by v0.12.1. Legacy analyzer settings/logs/state from that layout are migrated forward automatically.

- v0.11.9 unusual-pattern false-positive fix: trailing `Artist - Title` / `Artist: Title` text is no longer treated as a version descriptor merely because the song title contains a descriptor word such as `Club`. The trailing segment must itself end in a recognizable version/edit/mix/live/remix/etc. descriptor shape. This prevents clean titles such as `INNA - I Am The Club Rocker` from appearing in Unusual track pattern review while preserving real suffixes such as `Song - Radio Edit`, `Song - Ferry Corsten Mix`, and `Song - Special Version`.

- v0.12.0 CD image rip support: recognize CUE sheets where multiple AUDIO tracks reference the same physical lossless audio file (FLAC/APE/WavPack/WAV) as a CD image rip. Build virtual per-track entries from CUE `TRACK`, `TITLE`, `PERFORMER`, `ISRC`, and `INDEX 01` data; use the next `INDEX 01` as the segment end. Probe technical quality from the underlying image, extract each virtual segment temporarily with FFmpeg, fingerprint it with fpcalc, then delete the temporary segment. Virtual tracks participate in all normal duplicate grouping, edition comparison, Personal Picks, remix/live filtering, minimum-track optimization, and CD rip-quality rules. A redundant image release is moved only as its complete physical folder/image+CUE+LOG set; image tracks are never individually removed. Split-file CUE sheets remain normal split tracks.

- v0.12.0 CUETools integration: use an existing CUETools installation when available and locate `CUETools.ARCUE.exe`/legacy `ArCueDotNet.exe`; install CUETools through winget package `gchudov.CUETools` only when missing. For album families containing a CD image rip, run the console verifier on every CUE-based candidate in that family so image and split rips are compared fairly. Positive AccurateRip/CTDB verification is quality evidence only and is applied only after exact audio equivalence is already proven. Database absence, no-match output, CUETools failure, or unavailable CUETools is neutral, never evidence that a rip is bad. CUETools verification outranks log-settings score when choosing between otherwise exact-equivalent CD rips; EAC/XLD log score remains the next tie-break. Temporary track-segment extraction still uses FFmpeg because the documented `CUETools.exe /convert` profile mode is interactive/non-terminating and is unsuitable for unattended analyzer loops.

- v0.12.1 mandatory development-standards pass: apply the newest global software rules before further feature work. `Duplicate Edition Analyzer` now owns `Documents\\Karpuzikov Tools\\Duplicate Edition Analyzer\\` with `settings.json` plus isolated `dependencies`, `logs`, `temp`, `cache`, and `state` subfolders. Older shared-root settings, comparison logs, crash log, and undo state migrate forward automatically. Analyzer-managed hey-bro-check-log and downloaded Chromaprint files use the program's `dependencies` folder; CUE segment work files use its `temp` folder; comparison/crash logs use `logs`; undo state uses `state`; dependency-check timestamps use `cache`. WinGet is bootstrapped before dependency work, FFmpeg and CUETools are installed when missing and checked for updates periodically, and the hey-bro-check-log source archive is commit-pinned instead of tracking mutable `master`. The tool remains one double-clickable `.pyw`, dark-theme by default, and `Under construction ⚠️` until confirmed complete.

## Mandatory software-development preflight

Before any program/script change in this project, apply the newest stored software-development rules first. Newer explicit rules override older conflicts. Current requirements include: dark UI by default for GUI tools; one `.pyw`/minimal file count where practical; dynamically resolve Windows Documents; isolate each program under `Documents\\Karpuzikov Tools\\<Program Name>\\`; keep that program's dependencies/logs/temp/cache/settings/state inside its folder; migrate older data instead of losing it; bootstrap WinGet first and install/update dependencies automatically; publish changes as in-place updates for existing installations; use `Under construction ⚠️` while unfinished; pin externally downloaded source archives to immutable versions/commits where practical; and update code/documentation together.

- v0.13.0 Decision Map: replace the final yes/no-only analysis confirmation with a searchable visual decision explorer. Every release receives a persistent explanation snapshot. The left side lists all releases with RETAINED/DUPLICATE and KEEP/ADD/REPLACE/SKIP/REMOVE status; filters show All/Retained/Duplicates and search matches release/path/reason/source. The right side draws a mind-map-style graph from release -> outcome -> main decision -> supporting branches. Branches include optimizer factors, unique/essential recordings, Personal Picks, retained releases covering each duplicate's fingerprint groups (with counts/examples), skipped remix/live/pattern counts, source/CUETools/rip-log context, direct replacement/preferred-existing relationships, and same-coverage alternatives. The Decision Map opens before move confirmation, so the user can investigate any release before allowing filesystem changes. The latest map can be reopened from the main window and from the completion dialog, and its compact structured snapshot is stored in the analyzer's own `state\last_decision_map.json`, not in the optional comparison log.

- v0.14.0 interactive re-optimization: make the Decision Map a clickable release dependency web. Each release snapshot includes the full track list plus all other releases sharing included fingerprint groups. Connected release nodes navigate directly to those releases. While the current analysis remains in memory, `Remove selected release and re-optimize` adds that release ID to a reversible blocked set and re-runs only the collection optimizer against the existing recording groups; no rescan, FFprobe, Chromaprint generation, or pairwise audio comparison is repeated. The new plan marks release actions changed from the initial solution, automatically promotes alternate carriers when available, and supports multiple manual removals. If a blocked release contains an included recording group with no non-blocked carrier anywhere in the analyzed collection, the affected track is highlighted red in the track list and the release graph shows the orphaned audio. Applying a plan with orphaned manual-removal tracks requires a second explicit confirmation. Manual removal can be undone before Apply. Saved Decision Map snapshots remain reopenable read-only after the live analysis context is gone.


- v0.15.0 Release Map redesign: remove the side release list and all always-visible factor/reason nodes from the graph. The graph itself now contains releases only; selecting a release redraws a spider-web of releases sharing current included fingerprint groups, and every connected release node is navigable. The selected release opens a separate details area below the map with a draggable vertical sash, a large dark high-contrast track table, exact current-plan reason, selectable/copyable folder path, Open folder, and a collapsed More details section for optimizer/source factors. Unique retained tracks are highlighted for research. The window is a standard non-transient/non-grab Toplevel so Windows/FancyZones can manage it normally, and it exposes Fit map, Maximize, Apply plan, Analyze again, and Close.
- v0.15.0 persistent per-track skip: a live-analysis track can be selected and skipped directly. The analyzer saves a rule in its own state folder, records exact Chromaprint fingerprint hashes plus available MBID/ISRC/base-title evidence for the current audio group, reapplies it after grouping on later analyses, and excludes the whole proven-equivalent recording group from optimization. Restore removes the saved rule and recomputes the plan. Normal remix/live/pattern exclusions remain separate.
- v0.15.0 explanation accuracy: the main ADD reason now describes why that specific release is selected in the final set (unique recording(s), required album representation, replacement, or global minimum-file selection) rather than merely saying its tracks were absent from the pre-analysis Existing folder. Track rows explain same-title distinct groups using credited artist/feature differences, ISRC, duration, and an explicit Chromaprint mismatch when no visible metadata difference explains it.
- v0.15.0 metadata-veto correction based on the 2026-09-30 comparison log: a strict audio match is no longer rejected merely because one title omits a semantic descriptor or because two descriptors are wording aliases in the same family (for example Radio Edit vs Play & Win Radio Version). Strong metadata vetoes remain for genuinely incompatible stated families and credited-artist/identifier conflicts.


- v0.15.1 validation fixes: saved-track-skip application is no longer reported as an error/note; the release network centers on the selected release; already option-skipped tracks cannot create redundant manual skip rules; the collapsed More details panel inserts correctly above the track table; and the summary counts persistent skip rules rather than duplicate copies carrying the same rule.


- v0.15.2 startup hotfix: restored the complete GUI class tail after the v0.15 Release Map refactor accidentally removed `App` and the support dialogs. The published build again contains ToolTip, phrase/pattern/personal-picks dialogs, App, startup/crash handling, and the normal analysis workflow while retaining the v0.15 Release Map and persistent track-skip features.
