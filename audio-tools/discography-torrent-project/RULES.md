# Discography Torrent Project - Rules

Last updated: 2026-09-27

This file is the canonical rulebook for the Discography Builder and Duplicate / Edition Analyzer.
When implementation behavior conflicts with this file, this file wins.

## 1. Core objective

Build the most complete practical discography while minimizing redundant audio files.

Priority order:

1. Preserve ideally every unique song/recording/version that is available.
2. Keep every album represented.
3. Ignore excluded remix/live tracks when comparing release coverage when those options are enabled.
4. Prefer CD / physical-media sources over equivalent WEB sources.
5. Prefer the existing processed copy when source class and wanted audio are otherwise equivalent.
6. Then minimize duplicated wanted tracks, total wanted audio files, and retained release count.
7. Never automatically discard material when the audio match is uncertain.

The analyzer must optimize the collection as a whole, not judge each release independently.

## 2. Albums and editions

Every album must remain represented, but not every edition of an album must be kept.

When multiple editions of the same album exist:

- choose the edition or combination of releases that preserves all unique material with the fewest duplicated audio files;
- a larger track count does not automatically make an edition preferable;
- unique bonus tracks are a reason to keep an edition only when those tracks cannot be preserved more efficiently elsewhere;
- remixes/live tracks do not automatically make one album edition superior;
- standard/deluxe/limited/special/regional editions must be compared by actual recording coverage.

### Example

Edition A:
- 10 common album tracks
- bonus A
- bonus B

Edition B:
- same 10 common album tracks
- bonus C

If A/B/C exist nowhere else, both editions may need to be kept.

If bonus C also exists on a single, prefer:
- Edition A
- the single containing bonus C

instead of:
- Edition A
- Edition B

because this preserves the same unique material with fewer duplicated album tracks.

## 3. Singles and EPs

Singles/EPs are not automatically kept.

A single/EP can be removed when every recording/version it contains is already preserved elsewhere.

A single/EP should be kept when it contains at least one unique recording/version that would otherwise be lost.

When several singles/EPs overlap:

- prefer the smallest combination of releases that covers all unique recordings;
- if one release is a complete superset of another, the subset release is redundant unless it has a meaningful release-specific reason to keep;
- if a 3-track release contains the unique song plus two songs also issued as separate one-track singles, prefer the 3-track release and remove the redundant one-track singles when the recordings are the same.

## 4. Remixes

- When `Save Remixes` is unchecked, ordinary remixes are ignored for wanted coverage. A remix that adds featured performer(s) not present on the matching non-remix version remains wanted. If no matching non-remix version is present, a remix with an explicit featured credit is kept conservatively.

`Save Remixes` and `Save Live recordings` are user-selectable analyzer options. Unchecked categories do not count toward wanted coverage.

Before fingerprint comparison, the analyzer may show only unusual/non-standard non-remix/non-live descriptor families that normal rules do not already classify. Examples include `The Matrix Mix`, `Tom Lord-Alge Mix`, and the grouped callout family (`Suggested Call Out Research Hook`, `Suggested Callout Hook`, etc.). Ordinary known patterns such as `Acoustic`, `Instrumental`, `Instrumental Excerpt`, language versions (`German Version`, `Japanese Version`, `Mandarin Version`, etc.), `Radio Edit`, any `Extended Mix` including named forms, `Original Mix`, any `VIP Mix` including named forms, `Clean Edition`, `Single Version`, and similar standard variants must not appear. Remix/live remain controlled only by `Save Remixes` and `Save Live recordings`. Pattern choices affect wanted coverage only and never duplicate identity.

Rules:

- only an explicit `Remix`, `Remixes`, `Remixed`, or `Dub` marker classifies a track as remix material;
- the word `Mix` by itself is NOT a remix marker;
- `Original Mix`, `Extended Mix`, `12" Mix`, `7" Mix`, and similar non-club mix labels are wanted versions, not remixes;
- `Club Mix` / `Club Mixes` are remix material;
- `Instrumental` and `A Capella` / `Acapella` are wanted distinct versions, not remixes;
- a release named `Remixes` does NOT automatically make every track inside it unwanted; classify the tracks individually;
- the presence of remix tracks does NOT make the entire release unwanted;
- compare the release again after removing only explicitly identified remix tracks from wanted coverage;
- a mixed release can still be retained when it contains wanted non-remix material;
- if a redundant release contains explicit remix material, or is itself explicitly titled as a remix package, move the whole redundant release folder under `<artist>_duplicates/!Remixes/`;
- do not delete remix releases permanently; archive them in `!Remixes`.

### Equivalent album-source tie-break

When two editions provide equivalent wanted non-remix album content:

1. ignore explicitly identified remix tracks;
2. compare the remaining wanted recording/version coverage;
3. prefer CD / physical media over WEB;
4. prefer the existing processed ALAC copy when source class is otherwise equivalent;
5. only then use duplicated wanted-track/file count as the tie-break.

A CD edition must not lose to a WEB edition merely because the CD contains extra unwanted remix tracks.

Example:

- `Want (Deluxe Edition)` - CD + LOG/CUE, core album tracks plus remix extras
- `WANT` - WEB, same wanted core album tracks

After remix tracks are ignored, if wanted coverage is equivalent, keep the CD edition and move the WEB edition to duplicates.

### Analyzer exclusion checkboxes

The analyzer provides two persistent affirmative checkboxes:

- `Save Remixes`
- `Save Live recordings`

Both are unchecked by default. Checked categories count as wanted content and may keep a release. Unchecked categories are ignored for coverage/optimization. These options never participate in duplicate identity; track identity remains audio-only.

## 5. Explicit vs clean - future implementation

Explicit/clean preference is a future rule, not an active analyzer criterion yet.

Current behavior:
- do not detect or rank releases by explicit/clean status;
- do not let explicit/clean metadata influence KEEP/SKIP/REPLACE decisions;
- compare using wanted content, source medium, existing-vs-recycle precedence, and duplication minimization.

Future behavior, once a reliable detector exists:
- explicit/clean state may be used as a preference only after reliable detection is implemented;
- genuinely different censored/edited recordings remain distinct when the audio analysis shows they are different.

## 6. Unique recording/version definition

Track duplicate identity is audio-only.

Primary and decisive identity signal:
1. Chromaprint fingerprint similarity calculated from the decoded audio itself.

Rules:

- filenames and track titles do not create a duplicate match;
- filenames and track titles do not block a duplicate match;
- MusicBrainz recording IDs, ISRCs, artist credits, album names, and other tags do not create or block a duplicate match;
- use strict fingerprint thresholds; uncertain audio remains distinct and is retained;
- fingerprint alignment may compensate for leading/trailing silence or padding;
- if durations differ substantially, the unmatched fingerprint region must behave like silence/padding before the tracks may be merged;
- substantial unmatched non-silent audio means a distinct version;
- release-level coverage is computed from these audio-derived track groups, not filename/title similarity.

Decoded PCM hash is not the primary detector because mastering/remastering can change PCM while the underlying recording remains equivalent for coverage.

- Chromaprint matching has two audio-only confidence tiers: a strict match, plus a mastering/pressing-tolerant match that requires near-identical duration and strong full-track fingerprint similarity. This exists specifically so different CD pressings/masterings of the same recording are not retained as separate recordings merely because their fingerprints are not bit-identical.

Different performances/versions should remain distinct when their audio is materially different, including live, acoustic, radio edit, extended, instrumental, a cappella, remix/dub, demo, alternate mix, language performances, and similar variants.

Titles may describe those variants, but titles themselves are not evidence for or against duplicate identity.

## 7. Source preference

When the same wanted recording/version exists in multiple sources, preference is:

1. CD rip with valid LOG + CUE
2. other verified lossless physical-media source
3. WEB lossless

CD detection rule:
- if a release folder contains at least one `.cue` file AND at least one `.log` file other than `audiochecker.log`, treat that release as CD;
- `audiochecker.log` by itself does NOT make a release CD.

A WEB copy can be removed when the same wanted recording is already preserved from a preferred CD source.

Do not replace a unique WEB recording merely because another release is on CD if the actual recording/version is different.


## Existing discography precedence

The existing ALAC discography is already processed material and is preferred over an equivalent recycle/update copy when wanted content/version and source class are equal.

A recycle release should replace an existing release only when it is objectively better by the project rules, for example:

- it preserves wanted unique material the existing release does not;
- it is CD/physical while the existing equivalent is WEB.

For equivalent WEB vs WEB content, keep the existing ALAC release and move/skip the recycle copy.

For equivalent CD vs WEB content, keep the CD release regardless of whether it is in Existing or Recycle.

Release-level equivalence is based on audio-derived track groups and direct Chromaprint comparison. MBIDs, ISRCs, normalized titles, and filenames are not fallback identity tests.


### Optional existing-discography mode

The Existing discography folder is optional.

- If Existing is provided, compare Existing + Recycle together using all normal source/preference rules.
- If Existing is blank, analyze and optimize Recycle against itself only.
- Recycle-only mode must still remove redundant editions/singles/remix-only releases according to the same rules.
- An empty Existing path is valid and must not trigger a folder-selection error.
- The saved Existing path can be cleared and must remain cleared across launches until the user selects one again.

## 8. Existing discography vs recycle/update

The existing ALAC discography is the current collection.

The recycle/update folder contains candidates to add or use as replacements.

The analyzer must compare both together.

For each recycle release/track, determine whether it:

- adds unique material;
- duplicates material already in the discography;
- can replace an inferior source;
- makes another recycle release redundant;
- changes which album edition is optimal.

Do not assume the existing discography is already optimal.



### Release-level audio matching

Release folders and filenames are containers/labels only. They must not establish track identity.

Rules:

- release discovery is recursive through organizational folders such as `Albums`, `Other`, `Singles`, and per-title grouping folders;
- internal `CD1` / `CD2` / `Disc 1` subfolders remain one release;
- sibling folders with the same release base plus `CD 1`, `CD 2`, etc. are also one logical multi-disc release and must be kept/moved together;
- wanted track coverage is compared using audio-derived fingerprint groups;
- a release covers another only when every wanted target track has a high-confidence audio match;
- folder names, file names, title text, barcode text in folder names, MBIDs, ISRCs, and metadata typo tolerance must not override the audio result;
- uncertain audio remains distinct and therefore keeps the material.

### Final existing-vs-recycle safeguard

The final action plan must independently enforce existing-vs-recycle precedence and must not rely only on optimizer/group IDs.

Before a recycle release can be kept over an existing release:

- compare release-container context;
- compare normalized track filenames directly;
- ignore unwanted remix tracks;
- if the existing release covers all wanted recycle tracks and is equal or better on explicit/source quality, force:
  - existing -> KEEP;
  - recycle -> SKIP.

This final safeguard must run even if fingerprint grouping or the global optimizer reached a different intermediate selection.

### Pre-optimization dominance

Resolve obvious same-album duplicates before running the global set-cover optimizer.

For related album releases:

- if both releases cover the same wanted non-remix content, choose by:
  1. explicit over clean;
  2. CD/physical over WEB;
  3. existing ALAC over recycle when otherwise tied;
- if one release is a wanted-content superset of the other, the superset makes the subset redundant when its explicit/source class is not worse;
- remix tracks are ignored when determining this coverage;
- dominated releases are excluded from the optimizer's wanted-group universe so stricter fingerprint grouping cannot force an inferior duplicate back into the retained set.

Examples:
- existing WEB Omens vs identical recycle WEB Omens -> keep existing, skip recycle;
- existing CD Want Deluxe vs recycle WEB WANT subset -> keep existing CD, skip recycle WEB.

## 9. Optimization model

Think of each release as a set of recordings.

Required coverage:

- every unique recording/version should ideally be covered at least once;
- every album must have at least one retained edition.

Optimization target:

1. maximize unique recording/version coverage;
2. minimize total retained audio-file count;
3. among equivalent solutions, minimize number of retained releases;
4. among equivalent sources, prefer explicit;
5. among equivalent sources, prefer CD + LOG/CUE over WEB.

This is effectively a constrained set-cover problem with mandatory album coverage and source-quality tie-breakers.

## 10. Decision states

The analyzer must never silently delete files.

Use:

- KEEP - required by current rules.
- REDUNDANT - all useful content is preserved elsewhere by a preferred solution.
- REPLACE - another source should replace the currently retained copy.
- NEW - candidate adds material not currently represented.

There is no normal manual REVIEW state for duplicate identity. The software must perform the track-by-track audio comparison itself. If equivalence cannot be established with enough confidence, treat the tracks as different and keep both. A grouped pre-analysis track-pattern review is allowed only to decide which descriptor families count as wanted coverage; it must never create, block, or override an audio duplicate match.

Every REDUNDANT/REPLACE decision must explain what retained release/track covers it.

## 11. Confidence

Automatic decisions are allowed only for high-confidence equivalence.

Examples of high confidence:

- same AcoustID/Chromaprint match with compatible duration and no conflicting version markers;
- same MusicBrainz recording ID plus compatible duration/version metadata;
- identical decoded PCM hash can confirm identical audio, but must not be required for duplicate coverage.

When confidence is insufficient:

- do not ask the user to review duplicate identity track-by-track; a single grouped pattern-family wanted-content review is allowed before fingerprint comparison;
- treat the tracks as distinct;
- keep both so unique material cannot be lost;
- record the uncertainty only in optional diagnostics.

Strong Chromaprint evidence can override filename/title differences because audio identity is the primary signal. Material duration differences or clearly incompatible fingerprints keep tracks separate.

## 12. Title normalization for comparison

Comparison may use normalized titles, but normalization must never erase version meaning.

Use the shared Picard rules in:
`picard-tools/scripts/`

Relevant rules include:

- English_Title_Capitalization
- Move_Featured_Artists_to_Title
- Format_Multiple_Artists
- Unicode_to_ASCII

Normalization can standardize spelling/case/punctuation/featured-artist placement.

It must preserve semantic qualifiers such as:
`Remix`, `Live`, `Acoustic`, `Radio Edit`, `Extended`, `Instrumental`, `A Capella`, `Dub`, etc.

## 13. Album example: Queen of Time

Given:

- `2018 - Queen of Time (Limited Edition) [EU - NB 4126-0]`
  - common album tracks
  - unique bonus `As Mountains Crumble`
  - unique bonus `Brother and Sister`

- `2018 - Queen of Time [JP - GQCS-90570]`
  - same common album tracks
  - unique bonus `Honeyflow (ft. Akira Takasaki)`

If `Honeyflow` exists nowhere else, both editions may be required.

If the same `Honeyflow` exists on a single, prefer keeping:
- the Limited Edition album
- the single containing `Honeyflow`

and remove the Japanese album edition, because the album remains represented and all unique songs remain covered with fewer duplicated files.


### Release container and move integrity\n\n- Release folders may be nested under organizational folders such as `Albums`, `Other`, `Singles`, or per-title grouping folders. Discovery must recurse through those containers and identify the actual release folders. Multi-disc subfolders such as `CD1`, `CD 2`, `Disc 1`, etc. belong to one parent release and must not be treated as separate releases.

- Each direct child folder of the selected artist/recycle root is one release container.
- Audio may be stored recursively inside that release container, including `CD1`, `CD2`, `Disc 1`, etc.; those disc subfolders are not separate releases.
- Automatic filtering moves the complete top-level release container, never only an internal disc subfolder.
- A planned move may never be silently skipped.
- Every move must be verified: source gone, destination present.
- If any move fails, report the exact source/target and roll back moves already completed in that run.

## 14. Automatic filtering / safety

The analyzer must do the filtering itself. It must not require the user to inspect release rows or make line-by-line duplicate decisions.

Normal flow:

1. Scan both folders.
2. Compare tracks automatically.
3. Optimize the retained release set automatically.
4. Show one global confirmation with only summary counts.
5. Move redundant release folders automatically.
6. Leave required recycle releases in place for the next workflow stage.
7. Show only a short completion summary.

Safety rules:

- Do not permanently delete release folders.
- Move redundant folders as-is; never rename release folders while archiving them.
- The archive folder is named `<original recycle artist folder>_duplicates`, e.g. `3OH!3_duplicates`.
- Create `<artist>_duplicates` as a sibling of the selected artist folder. Example: `...\!recycle\3OH!3` -> `...\!recycle\3OH!3_duplicates`.
- Redundant releases containing remix material go under `<artist>_duplicates/!Remixes/`.
- Non-remix redundant releases go directly under `<artist>_duplicates/`.
- Reuse the same duplicates folder across runs; do not create timestamped archive folder names.
- Provide Undo for the last run.
- A single global confirmation before moving folders is sufficient; do not require per-release approval.
- If equivalence is uncertain, retain the material automatically.
- If an archive destination already exists, abort instead of renaming or overwriting folders.
- If folder structure makes an automatic move unsafe, abort the apply operation without changing anything.

## 15. Current 3OH!3-specific test case

The current test dataset consists of:

- existing ALAC discography;
- recycle/update folder containing WEB FLAC releases;
- no CD rips in recycle for this test.

For this dataset:

- compare recycle WEB releases against existing ALAC and against each other;
- eliminate complete subsets when recordings are equivalent;
- keep releases that contribute unique wanted non-remix songs/versions;
- prefer explicit over clean;
- keep all albums represented;
- minimize duplicated audio files across album editions/singles/EPs.

This dataset is the first validation case for the Duplicate / Edition Analyzer.


## Persistent user data

This project follows the general software persistence rule:

- Any repeatable user-supplied data should be saved and reused automatically across launches and versions.
- This includes credentials/tokens, paths and folders, last-used locations, selected options, preferences, and other recurring inputs.
- Use one common application-data location under the user's dynamically resolved Windows Documents library so redirected/moved Documents folders are handled correctly.
- Updates must reuse the same stored data rather than making the user enter it again.
- Sensitive values such as credentials/tokens must be protected appropriately, e.g. Windows DPAPI.
- Ordinary non-sensitive settings such as folder paths can be stored as normal settings data.
- For Duplicate / Edition Analyzer specifically, remember at minimum:
  - Existing discography (ALAC)
  - Recycle / update folder


## English capitalization and label naming

These are the canonical English capitalization rules for album titles, track titles, artist/band names, and label names.

### Title capitalization

Use standard mixed case.

Capitalize:
- nouns;
- verbs, including `be`, `been`, `am`, `are`, `is`, `was`, `were`;
- adverbs;
- subordinating conjunctions;
- adjectives;
- pronouns;
- the first and last word of every title or major title segment.

Normally lowercase internal:
- articles: `a`, `an`, `the`;
- coordinating conjunctions: `and`, `but`, `or`, `nor`, `for`, `yet`, `so`;
- short prepositions: `as`, `at`, `by`, `for`, `in`, `of`, `on`, `to`, `from`;
- `versus`, `vs.`, `v.`;
- `etc.` when meaning "and so on/and so forth";
- `to` when forming an infinitive.

Grammar exceptions:
- capitalize `but` when it functions as an adverb ("Life Is But a Dream");
- capitalize `so` when adjectival ("You Are So Beautiful");
- capitalize `as` when functioning as a subordinating conjunction;
- capitalize a preposition when it is part of a phrasal verb ("Get Out of This Country").

Major punctuation starts a new title segment. After a colon, question mark, exclamation mark, dash used as a major separator, parentheses, or quotes, capitalize the first and last word of the segment.

For hyphenated compounds, capitalize each component according to the same title rules.

Only preserve all-caps where common usage is genuinely acronym/abbreviation capitalization. All-uppercase/all-lowercase artwork styling alone is not an artistic-capitalization exception.

Contractions and slang follow the same rules. Keep forms such as internal `o'` ("Will o' the Wisp") and `'n'` ("Rock 'n' Roll") lowercase where they stand for lowercase words.

Proper nouns keep their proper capitalization.

### Artistic-intent exceptions

Preserve genuinely intentional nonstandard capitalization used by the artist/release, e.g. `k.d. lang`, `Yellow mY skYcaptain`, or intentional lowercase `tourette's`.

Do not infer artistic intent merely because cover art prints an entire artist/title/tracklist in uppercase or lowercase.

The Picard capitalization script must not blindly title-case artist names. Artist/album-artist capitalization should come from the authoritative metadata/current artist name unless an explicit normalization rule says otherwise.

### Picard implementation

Source of truth:
- `picard-tools/scripts/English_Title_Capitalization.txt`

The script applies the deterministic title rules to both track `title` and `album`, including:
- articles/conjunctions/prepositions;
- first/last-word behavior;
- major punctuation divisions;
- common phrasal-verb exceptions;
- `vs.` / `v.` / `etc.`;
- slang forms such as `o'` and `'n'`.

Grammar-dependent and artistic-intent exceptions remain governed by this rulebook if a simple Picard script cannot infer them perfectly.

### Record label capitalization

Preferred forms:

- A&M Records
- Atlantic
- Arista Records
- ATO Records
- Below Par Records (or Below Par where source usage supports it)
- Brightside
- Casablanca Music
- Central Station Records
- Dance Pool
- Data Records
- Decaydance Records
- Decca
- DGC
- Dreamworks
- Eleven: A Music Company
- EMI
- EPIC
- Griffen Records
- Hussle Recordings
- Interscope Records
- Jive Records
- Lava Records
- Mercury Records
- Nettwerk
- Octone Records
- Rhino Records
- Radioactive Records
- Roadrunner Records
- Shock Records
- Sony
- Universal
- Virgin Records
- Wah Wah Music
- Walt Disney Records
- Warner
- WEA
- Wind Up
- Zoomba Recordings

Specific preferred forms:
- `EPIC`, not `Epic` or `EPIC recordings`;
- `Roadrunner Records`, not `roadrunner records pty. ltd.`;
- `Sony`, not `Sony Music`;
- `Universal`, not `Universal Music`;
- `Warner`, not `Warner Music`;
- `WEA`, not `Warner Elektra Atlantic`;
- `Wind Up`, not `Wind Up Records`.

Where a label officially ends in `Records`, keep `Records` except for the explicit preferred-form exceptions above.

Multiple-label formatting is not fully standardized yet; keep the source labels rather than inventing a destructive normalization.

## CD rip log quality hierarchy - future implementation

This is for comparing otherwise identical CD rips and selecting the best rip based on the ripping log.

Use `doujincafe/hbcl` as the scoring basis. H.B.C.L. is a CD rip log analyzer/scorer and starts from a 100-point score with deductions.

Hierarchy:

1. `100% - Log + CUE`
2. `100% - Log`
3. `Log with non-audio deductions`
4. `Log with audio deductions`
5. `FLAC` / lossless source without a qualifying rip log

Meaning of `100%`: the log completes the H.B.C.L.-style check with a full 100 score.

Implementation goal for later:
- first establish that two releases are the same CD rip/content candidate;
- score every qualifying rip log;
- prefer the highest-scoring log;
- if scores tie, prefer the rip with CUE;
- distinguish non-audio deductions from audio-affecting deductions when ranking sub-100 logs;
- only fall back to unlogged lossless when no better logged rip exists.

Do not implement this hierarchy as filename guessing. Parse/score the actual log contents.


- `Original Mix` is an original-version label and must NOT be classified as a remix merely because it contains the word `Mix`.


### Album-edition clustering

Alternate album editions are grouped primarily from audio-derived wanted-track overlap and track order, not edition/folder names. Strong ordered overlap between fingerprint groups identifies related editions even when labels such as Limited, Special Bonus, Sketch Book, regional names, or other edition wording differ.

### Duplicate archive structure

Redundant folders must preserve their source-relative hierarchy under `<artist>_duplicates`. Example: `Singles/Title/Edition` moves to `<artist>_duplicates/Singles/Title/Edition`. Remix-bucket moves preserve the same hierarchy under `<artist>_duplicates/!Remixes/`.

Do not flatten release folders into the duplicate root. After successful moves, remove organizational directories that became empty.

- After the main optimizer, run a final selected-set redundancy prune. A non-album release that contributes no wanted audio beyond other retained releases must be removed when equal-or-better source copies remain. Album releases may be pruned only when another retained release still represents the same audio-derived album cluster.

- When the unusual-pattern classifier changes materially, stale review choices from older classifier generations must not be reused; start the new classifier generation with clean defaults while preserving new choices thereafter.

### Structural standard-pattern recognition

- The unusual-pattern review must classify ordinary version families structurally rather than by exact full-label whitelist. Artist/remixer/source prefixes do not make a standard family unusual (for example `BT Radio Edit`, `Adam Beyer Instrumental`, `Dan's Bedroom Demo`, `Deezer Session`, `Junkie XL Vocal Mix`, or `Eric Kupper 12\" Mix`).
- Named/ambiguous plain `Mix` labels remain review candidates when they do not match a known standard family, e.g. `The Matrix Mix` and `Tom Lord-Alge Mix`.
- Normalize common mojibake in displayed/tag-derived pattern text before classification.
