# Discography Torrent Project - Rules

Last updated: 2026-09-27

This file is the canonical rulebook for the Discography Builder and Duplicate / Edition Analyzer.
When implementation behavior conflicts with this file, this file wins.

## 1. Core objective

Build the most complete practical discography while minimizing redundant audio files.

Priority order:

1. Preserve ideally every unique song/recording/version that is available.
2. Keep every album represented.
3. Ignore unwanted remix tracks when comparing release coverage.
4. Prefer explicit over equivalent clean material.
5. Prefer CD / physical-media sources over equivalent WEB sources.
6. Then minimize duplicated wanted tracks, total wanted audio files, and retained release count.
7. Never automatically discard material when the match is uncertain.

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

Remixes are unwanted discography content and must not count toward unique-song coverage.

Rules:

- remix/mix/dub tracks do not count toward wanted coverage;
- the presence of remix tracks does NOT make the entire release unwanted;
- compare the release again after removing remix tracks from the coverage calculation;
- if the remaining wanted tracks are equivalent to another release, choose between the releases using explicit/source-medium rules;
- releases explicitly identified as remix/remixes packages are treated as remix material as a whole, including instrumental/a-capella tracks inside those remix packages;
- a mixed release can still be retained when it contains wanted non-remix material;
- if a redundant release contains any remix material, move the whole redundant release folder under `<artist>_duplicates/!Remixes/`;
- do not delete remix releases permanently; archive them in `!Remixes`.


### Equivalent album-source tie-break

When two editions provide equivalent wanted non-remix album content:

1. ignore remix tracks;
2. compare the remaining wanted recording coverage;
3. prefer explicit over clean;
4. prefer CD / physical media over WEB;
5. only then use duplicated wanted-track/file count as the tie-break.

A CD edition must not lose to a WEB edition merely because the CD contains extra unwanted remix tracks.

Example:

- `Want (Deluxe Edition)` - CD + LOG/CUE, core album tracks plus remix extras
- `WANT` - WEB, same wanted core album tracks

After remix tracks are ignored, if wanted coverage is equivalent, keep the CD edition and move the WEB edition to duplicates.

## 5. Explicit vs clean

Explicit is always preferred over clean when both represent the same recording/version.

Rules:

- if explicit and clean versions are otherwise equivalent, keep explicit and mark clean redundant;
- a clean version is acceptable only when no explicit equivalent is available;
- if clean and explicit are genuinely different recordings/edits beyond censorship, treat them as distinct and retain both unless another rule makes one redundant.

## 6. Unique recording/version definition

Do not decide uniqueness from filename/title alone.

Use as many signals as available.

Primary identity signal:
1. AcoustID/Chromaprint fingerprint, together with compatible duration/version metadata.

Supporting signals:
2. MusicBrainz recording ID;
3. ISRC;
4. normalized title/version text;
5. duration;
6. artist credit;
7. release/track metadata.

Decoded PCM hash is NOT the primary duplicate detector. It is useful only as a secondary confirmation that two files contain effectively identical decoded PCM audio. Different mastering/remastering can change PCM while the underlying song/recording is still the one we want to treat as duplicate coverage.

Different versions must remain distinct, including when applicable:

- remix
- live
- acoustic
- radio edit
- extended version
- instrumental
- a cappella
- dub
- demo
- alternate mix
- remaster/master difference when intentionally distinct
- explicit vs clean, with explicit preferred when equivalent

Near-title matches must not be collapsed automatically.

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

The existing ALAC discography is already processed material and is preferred over an equivalent recycle/update copy when wanted content, explicit/clean state, and source class are equal.

A recycle release should replace an existing release only when it is objectively better by the project rules, for example:

- it preserves wanted unique material the existing release does not;
- it is explicit while the existing equivalent is clean;
- it is CD/physical while the existing equivalent is WEB.

For equivalent WEB vs WEB content, keep the existing ALAC release and move/skip the recycle copy.

For equivalent CD vs WEB content, keep the CD release regardless of whether it is in Existing or Recycle.

Release-level equivalence must not depend only on internal fingerprint-group IDs. For related album editions, compare wanted non-remix tracks directly using Chromaprint/MBID/ISRC and, when needed, normalized title + compatible duration as a fallback.

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



### Release-structure matching

For related album editions, folder/file structure is an independent identity signal and must not be overridden by missing or inconsistent embedded tags.

Rules:

- strip ordinary numeric track prefixes from filenames, including forms such as `01 Title`, `01 - Title`, `01. Title`, `01_Title`, and `01) Title`;
- compare both embedded track titles and normalized filename titles;
- exact folder barcode matches remain valid even when audio tags omit or disagree on barcode;
- album-family matching must also use the normalized release folder name, not only the embedded ALBUM tag;
- for related album editions only, tolerate a single-character metadata typo in an otherwise matching normalized track title, e.g. `PunkBtch` vs `PUNKBITCH`;
- do not use this typo tolerance across unrelated releases.

This structural pass exists so equivalent ALAC/FLAC editions cannot fail comparison merely because one copy has missing/different tags.


### Final existing-vs-recycle safeguard

The final action plan must independently enforce existing-vs-recycle precedence and must not rely only on optimizer/group IDs.

Before a recycle release can be kept over an existing release:

- compare folder-derived release identity;
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

There is no normal manual REVIEW state. The software must perform the track-by-track comparison itself. If equivalence cannot be established with enough confidence, treat the tracks as different and keep both.

Every REDUNDANT/REPLACE decision must explain what retained release/track covers it.

## 11. Confidence

Automatic decisions are allowed only for high-confidence equivalence.

Examples of high confidence:

- same AcoustID/Chromaprint match with compatible duration and no conflicting version markers;
- same MusicBrainz recording ID plus compatible duration/version metadata;
- identical decoded PCM hash can confirm identical audio, but must not be required for duplicate coverage.

When confidence is insufficient:

- do not ask the user to review track-by-track;
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
