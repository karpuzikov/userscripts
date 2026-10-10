# Discography Torrent Project - Rules

Last updated: 2026-10-05

This file is the project-specific rulebook for the Discography Builder and Duplicate / Edition Analyzer.
The account-wide `SOFTWARE_RULES.md` baseline always applies. This file may add stricter project-specific requirements but must never weaken or override a newer global rule or a newer explicit user instruction. When project rules conflict with the global baseline, the stricter/newer requirement wins.

## 1. Core objective

Build the most complete practical discography while minimizing unnecessary retained tracks.

Current priority order:

1. Preserve every wanted unique song/recording/version.
2. Keep every album represented.
3. Apply Save Remixes / Save Live at the first classification stage. Unchecked material leaves the analysis pipeline immediately. The sole Save-Remixes exception is a featured performer genuinely added by the remix; a vocalist already present on the normal version of the same song is not a remix exception.
4. Explicit supersedes the corresponding Clean track before fingerprint analysis.
5. Explicitly incompatible stated Version families are unique. A hard semantic skip is allowed only when both sides explicitly state disjoint version families (for example Radio Edit vs Extended Mix). An unlabeled title is not evidence of a base/different version and must remain eligible for acoustic comparison. Exact identical Chromaprint fingerprints always override semantic wording.
6. Prefer CD/physical over equivalent WEB.
7. For CD alternatives, hey-bro-check-log is the rip-quality authority. 80 is the acceptable-score threshold; a better comparable log is preferred for otherwise equivalent CD choices.
8. Minimize total retained track count. Every track physically carried by a retained release counts, including Remix/Live tracks excluded from analysis.
9. Prefer the already processed Existing copy over Recycle/update when every earlier non-DR criterion is tied.
10. DR/mastering is the final unresolved quality tie-break only: measure it only when every non-DR criterion is already equal, then any measurable better score wins.
11. Compilations are below regular Album/EP/Single releases and are retained only for wanted song/version coverage unavailable on regular releases.
12. Duplicate identity is fully automatic: accepted acoustic matches merge automatically regardless of title/artist naming differences; non-accepted matches stay separate automatically. No acoustic manual review.

## 2. Albums and editions

Every album must remain represented, but not every edition of an album must be kept.

Album-family selection order is absolute:

1. Group editions of the same album by proven included-audio overlap/order.
2. Count the distinct included wanted recording groups carried by each edition.
3. At least one edition with the **highest unique wanted-track count** must represent that album family, except when a no-weaker-source full core edition differs only by independently available, acoustically matched, added-featured-artist remixes issued as Singles/EPs (v0.4.5).
4. A strict superset normally dominates an equivalent- or weaker-source subset; preserve an otherwise full core album if its entire missing delta qualifies for the independent featured-remix single/EP exception.
5. Outside singles/EPs do not generally rescue an incomplete album edition. The only exception is **independently issued featured-remix bonus tracks**, already present on the eligible Singles/EPs and absent from the otherwise full, equal-or-better-source core album.
6. After every album has a valid full-edition representative (or qualified full core plus standalone featured remixes), minimize the **total retained physical track count** across the collection.
7. If total retained track count ties, minimize the **total retained release count**.
8. Source/rip quality, Existing/Recycle preference, and DR/mastering are later tie-breaks only.

"Most complete" means the greatest number of distinct currently included wanted recording groups, not the largest raw folder/file count. Tracks excluded by active Remix/Live/manual rules do not make an edition more complete.

### Example - Let Go

If `Let Go (Limited Edition)` contains every wanted track from `Let Go (Sketch Book)` plus `Get Over It` and `Why`, the Limited Edition represents the album and Sketch Book is dominated immediately.

It does not matter that `Get Over It` or `Why` also exist on singles/EPs. They are ordinary album bonus songs, not independently issued featured-remix bonuses. Outside singles/EPs may still be removed or retained by the later global optimizer, but they cannot make the less-complete Sketch Book edition represent `Let Go`.

If two maximum-completeness editions contain different wanted material but the same number of unique groups, either can satisfy the album-representation requirement; the global minimum-track/minimum-release solution then decides while still preserving every wanted group.

## 3. Singles and EPs

Singles/EPs are not automatically kept.

A single/EP can be removed when every recording/version it contains is already preserved elsewhere.

A single/EP should be kept when it contains at least one unique recording/version that would otherwise be lost.

When several singles/EPs overlap:

- prefer the smallest combination of releases that covers all unique recordings;
- if one release is a complete superset of another, the subset release is redundant unless it has a meaningful release-specific reason to keep;
- if a 3-track release contains the unique song plus two songs also issued as separate one-track singles, prefer the 3-track release and remove the redundant one-track singles when the recordings are the same.

## 4. Remixes

- `Save Remixes` is a direct inclusion switch. Checked: remixes participate normally. Unchecked: remixes are skipped completely by release comparison, coverage, counting, optimization, and tie-breaks.
- `Save Live recordings` follows the same rule for live-performance material.
- The only exception to an unchecked `Save Remixes` option is a featured performer genuinely added by that remix. A feature already present on a normal non-remix version of the same song does not rescue the remix.

Before fingerprint comparison, the analyzer may show only unusual/non-standard non-remix/non-live descriptor families that normal rules do not already classify. Examples include `The Matrix Mix`, `Tom Lord-Alge Mix`, and the grouped callout family (`Suggested Call Out Research Hook`, `Suggested Callout Hook`, etc.). Ordinary known patterns such as `Acoustic`, `Instrumental`, `Instrumental Excerpt`, language versions (`German Version`, `Japanese Version`, `Mandarin Version`, etc.), `Radio Edit`, any `Extended Mix` including named forms, `Original Mix`, any `VIP Mix` including named forms, `Clean Edition`, `Single Version`, and similar standard variants must not appear. Remix/live remain controlled only by `Save Remixes` and `Save Live recordings`. Pattern choices affect included coverage only and never duplicate identity.

Rules:

- explicit `Remix`, `Remixes`, `Remixed`, `Rmx`, or `Dub` markers classify remix material;
- a named/credited person, DJ, producer, or act `Mix` also classifies remix material;
- a child variant such as `<Remixer> Radio Edit`, `<Remixer> Edit`, or another named variant inherits Remix status when a sibling of the same base song explicitly establishes that remixer credit;
- the word `Mix` by itself is NOT enough;
- functional/original labels such as `Original Mix`, ordinary `Extended Mix`, `12" Mix`, `7" Mix`, and similar non-credited version labels remain included versions unless remixer context proves otherwise;
- `Club Mix` / `Club Mixes` are remix material;
- `Instrumental` and `A Capella` / `Acapella` are included distinct unique recording roots, not replaceable Versions and not remixes;
- a release named `Remixes` does NOT automatically make every track inside it ignored; classify the tracks individually;
- the presence of remix tracks does NOT make the entire release ignored;
- compare the release again after removing only explicitly identified remix tracks from included coverage;
- a mixed release can still be retained when it contains included non-remix material;
- if a redundant release contains explicit remix material, or is itself explicitly titled as a remix package, move the whole redundant release folder under `<artist>_duplicates/!Remixes/`;
- do not delete remix releases permanently; archive them in `!Remixes`.

### Equivalent album-source tie-break

When two editions provide equivalent included non-remix album content:

1. ignore explicitly identified remix tracks;
2. compare the remaining included recording/version coverage;
3. prefer CD / physical media over WEB;
4. prefer the existing processed ALAC copy when source class is otherwise equivalent;
5. only then use duplicated included-track/file count as the tie-break.

A CD edition must not lose to a WEB edition merely because the CD contains extra ignored remix tracks.

Example:

- `Want (Deluxe Edition)` - CD + LOG/CUE, core album tracks plus remix extras
- `WANT` - WEB, same included core album tracks

After remix tracks are ignored, if included coverage is equivalent, keep the CD edition and move the WEB edition to duplicates.

### Analyzer exclusion checkboxes

The analyzer provides two persistent affirmative checkboxes:

- `Save Remixes`
- `Save Live recordings`

Both are unchecked by default. Checked means the category participates normally in release comparison and selection. Unchecked means the category is skipped completely by comparison, coverage, counting, optimization, source/log tie-breaks, and clean/explicit tie-breaks. These options never create duplicate identity; track identity still requires a high-confidence audio match.

## 5. Explicit vs clean - active absolute preference

Explicit > Clean.

If an Explicit counterpart for the same normalized title/version/artist identity exists, the corresponding Clean track is excluded before fingerprint analysis.

- The Clean file does not need to fingerprint-match the Explicit file.
- The Clean track creates no coverage obligation when its Explicit counterpart exists.
- If only Clean exists, keep it normally.
- Explicit/Clean wording itself does not create a separate Version family.

## 6. Unique recording/version definition

A **Version** is a replaceable variation of the same underlying recording root. The word `Version`, `Edit`, or `Mix` by itself does not decide this.

Examples:
- `Girlfriend` and `Girlfriend (Radio Edit)` are eligible to be treated as the same replaceable recording family after acoustic comparison.
- `Girlfriend (Extended Version)` is a **new unique recording root**, not a replaceable Version of the base recording.
- `Girlfriend (Instrumental)` is a new unique recording root.
- `Girlfriend (Acapella)` is a new unique recording root.
- `Push` and `Push (Acoustic)` are separate unique recording roots.
- `Girlfriend (MTV Unplugged)` is a separate unique Live recording root.
- `Girlfriend (MTV Unplugged) [Edit]` is a Version of that Live recording root.
- `Girlfriend (Dr. Luke Remix) [ft. Lil Mama]` is a separate unique Remix recording root.
- `Girlfriend (Dr. Luke Remix) [ft. Lil Mama] (Extended Version)` is a Version of that Remix recording root.

### Parent-root rule

The unique parent recording category wins over a later edit/version suffix:

- Remix + Radio/Edit/Extended -> still the same Remix root.
- Live/Unplugged + Edit/Extended -> still the same Live root.
- Acoustic + Edit/Extended -> still the same Acoustic root.
- Instrumental/Acapella + Edit/Extended -> still that Instrumental/Acapella root.
- Base recording + Extended -> Extended is its own unique root.

### Acoustic identity

Acoustic fingerprinting remains the duplicate authority for tracks that are eligible to be compared.

- Exact identical Chromaprint fingerprints always override conflicting wording.
- Radio/Edit/Main/Single/Album-style variants of the same base root may reach acoustic comparison and merge when accepted.
- Base vs Extended, Instrumental, Acapella, Acoustic, Live/Unplugged, or Remix is semantically protected as different recording roots and is not merged merely because the audio overlaps.
- Tracks inside the same unique parent root still use acoustic comparison to determine whether they are replaceable variants or genuinely different recordings.
- External database recording identifiers are not required for duplicate identity.
- Reported duration is routing/diagnostic only.
- Alignment may compensate for leading/trailing silence or padding.
- Substantial unmatched non-silent content remains distinct.
- No acoustic identity decision is delegated to the user.

## 7. Source preference

For equivalent wanted content:

1. CD/physical beats WEB.
2. For CD alternatives, hey-bro-check-log is the rip-quality authority.
3. Comparable score 80 is the acceptable threshold.
4. A below-80 CD choice loses to a compliant at/above-80 alternative when both preserve the required coverage.
5. Between otherwise equivalent CD rips, prefer the better comparable log.
6. No external rip-database confidence is used.

CD detection:
- CUE + real rip LOG is CD evidence;
- a real EAC/XLD rip LOG can also establish a track-based CD rip without CUE;
- audiochecker.log alone does not make a release CD;
- explicit medium metadata may also establish CD.

Source preference never removes a unique wanted recording/version.

## Existing discography precedence

Existing is a late tie-break, not a hard quality floor.

For otherwise interchangeable choices:
- source class decides first;
- CD-log quality decides next where applicable;
- lower total retained track count decides before Existing precedence;
- the already processed Existing copy wins an otherwise complete non-DR tie;
- DR/mastering is measured only if Existing/Recycle status and every other non-DR criterion are also tied;
- DR therefore never causes a Recycle copy to replace an otherwise-equivalent Existing copy merely because its measured dynamics are higher.

### Optional existing-discography mode

The Existing discography folder is optional.

- If Existing is provided, compare Existing + Recycle together using all normal source/preference rules.
- If Existing is blank, analyze and optimize Recycle against itself only.
- Recycle-only mode must still remove redundant editions/singles/remix-only releases according to the same rules.
- An empty Existing path is valid and must not trigger a folder-selection error.
- The saved Existing path can be cleared and must remain cleared across launches until the user selects one again.

## 8. Existing discography vs recycle/update

Existing and Recycle are analyzed together when Existing is supplied.

- Existing is not presumed optimal.
- Recycle may add unique material, replace inferior equivalent material, or become redundant.
- Release/container names never prove duplicate identity.
- Included coverage is based on confirmed acoustic recording groups.
- Existing preference is applied after source, CD-log quality and total-track-count rules tie, and before DR/mastering.
- DR/mastering is only consulted when the alternatives are still exactly tied after Existing/Recycle preference and every other non-DR rule.
- Multi-disc folders belonging to one release remain one logical release.
- Remix-only/Live-only releases eliminated at step 1 never participate in later comparison or optimization; they remain only for final Apply bookkeeping.

## 9. Optimization model

Hard requirements:

1. Preserve every active wanted recording root/group.
2. Keep every active album family represented.
3. The album representative must carry the **maximum number of distinct included wanted groups** in that family, unless it is an equal-or-better-source full core edition whose only additional Deluxe groups are featured remixes each separately covered by an eligible Single/EP.
4. A strict same-album superset normally dominates an equivalent-or-worse-source subset, except when the subset qualifies for the narrow independently issued featured-remix bonus exception.
5. Ignored releases cannot provide coverage.
6. Ignored tracks and step-1 excluded Remix/Live/Clean material create no coverage obligation.

Global objective after those hard requirements:

1. Minimize **total retained track count**.
2. Minimize **total retained release count**.
3. Prefer better source/CD-rip quality when the first two totals tie.
4. Prefer Existing over Recycle/update when otherwise tied.
5. Use stable deterministic ordering.
6. Use DR/mastering only for the final exact tie.

Singles/EPs/compilations may satisfy wanted recording coverage, but they cannot substitute an incomplete core album for its required album representative. The full-core featured-remix exception permits standalone Singles/EPs to cover only the omitted *added-featured-remix* recordings; all regular core songs and ordinary bonus songs still require the complete edition.

CUE image layout receives no special one-file optimization bonus. Logical track count is what matters.

After the exact solve, an exact-equivalent better CD rip may replace the chosen copy only when doing so does not violate the higher-priority album/track/release rules.

## 10. Decision states

Final filesystem-plan states:
- KEEP
- REDUNDANT
- REPLACE
- NEW

There is no acoustic REVIEW state.

Duplicate identity is automatic:
- accepted acoustic evidence merges the pair;
- anything below automatic acceptance remains separate;
- different naming never turns an accepted acoustic match into a user choice.

Every REDUNDANT/REPLACE result must explain which retained release/track covers it.

## 11. Confidence

Automatic duplicate identity requires high-confidence acoustic evidence.

- same-title eligible tracks can merge only after passing active acoustic thresholds;
- alignment may compensate for silence/padding;
- substantial unmatched non-silent content blocks a merge;
- only two explicitly stated, disjoint Version families may be filtered before expensive cross-version matching; unlabeled-vs-labeled pairs remain eligible, and exact identical Chromaprint always overrides wording;
- different-title strong matches merge automatically when the acoustic matcher accepts them;
- narrow near-threshold non-matches remain separate automatically;
- everything outside automatic acceptance remains separate without asking the user.

External database recording identifiers are not part of this analyzer.

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

and remove the Japanese album edition, because the album remains represented and all unique songs remain covered with fewer retained tracks.


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

The historical 3OH!3 dataset remains a regression dataset, but current v0.22.2 rules apply:

- preserve unique wanted non-remix songs/versions;
- remove unchecked Remix/Live material at step 1;
- Explicit supersedes corresponding Clean before fingerprinting;
- keep all albums represented;
- CD/WEB, CD-log threshold/quality, total retained track count, then Existing precedence apply before any DR/mastering tie-break;
- acoustic duplicate identity requires zero manual input: accepted matches merge automatically; all others remain separate.

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

## CD rip log quality hierarchy - implemented

Duplicate Edition Analyzer uses `ligh7s/hey-bro-check-log` v1.3.2 (Apache-2.0) as an automatically managed runtime dependency for supported EAC/XLD rip logs.

Rules:
- ignore `audiochecker.log` for rip-quality scoring;
- rip-log score is never duplicate evidence;
- compare log quality only after two CD releases are proven exact-equivalent in release/content/source structure;
- require all relevant rip logs for a release to be recognized before assigning a comparable quality key;
- unsupported or unrecognized logs remain neutral;
- multi-disc comparison uses worst-disc score first, then average score, then flagged status;
- a higher-scoring exact-equivalent CD rip may replace an Existing lower-scoring rip;
- when log quality ties or is unavailable, Existing-copy precedence remains;
- Explicit/Clean remains the absolute final tie-break after CD rip-log quality.

Do not rank CD rips by filenames or guessed ripper text; parse and score the actual log contents.

- `Original Mix` is an original-version label and must NOT be classified as a remix merely because it contains the word `Mix`.

### Album-edition clustering

Alternate album editions are grouped primarily from audio-derived included-track overlap and track order, not edition/folder names. Strong ordered overlap between fingerprint groups identifies related editions even when labels such as Limited, Special Bonus, Sketch Book, regional names, or other edition wording differ.

### Duplicate archive structure

Redundant folders must preserve their source-relative hierarchy under `<artist>_duplicates`. Example: `Singles/Title/Edition` moves to `<artist>_duplicates/Singles/Title/Edition`. Remix-bucket moves preserve the same hierarchy under `<artist>_duplicates/!Remixes/`.

Do not flatten release folders into the duplicate root. After successful moves, remove organizational directories that became empty.

- After the main optimizer, run a final selected-set redundancy prune. A non-album release that contributes no included audio beyond other retained releases must be removed when equal-or-better source copies remain. Album releases may be pruned only when another retained release still represents the same audio-derived album cluster.

- When the unusual-pattern classifier changes materially, stale review choices from older classifier generations must not be reused; start the new classifier generation with clean defaults while preserving new choices thereafter.

### Structural standard-pattern recognition

- The unusual-pattern review must classify ordinary version families structurally rather than by exact full-label whitelist. Artist/remixer/source prefixes do not make a standard family unusual (for example `BT Radio Edit`, `Adam Beyer Instrumental`, `Dan's Bedroom Demo`, `Deezer Session`, `Junkie XL Vocal Mix`, or `Eric Kupper 12\" Mix`).
- Named/ambiguous plain `Mix` labels remain review candidates when they do not match a known standard family, e.g. `The Matrix Mix` and `Tom Lord-Alge Mix`.
- Normalize common mojibake in displayed/tag-derived pattern text before classification.

### Named `Mix` remix rule

- A `Mix` credited/named after a person, DJ, producer, or act is remix material even when the literal word `Remix` is absent. Examples: `Ferry Corsten Mix`, `Tom Lord-Alge Mix`, `Madlib's Mix`, `Timo Maas Mix`.
- Ordinary functional/style labels such as `Original Mix`, `Extended Mix`, `VIP Mix`, `Radio Mix`, `Vocal Mix`, `Instrumental Mix`, `12\" Mix`, etc. remain normal version labels unless another remix rule applies.
- Named-person `Mix` tracks are controlled by `Save Remixes` and must not appear in the unusual-pattern review.

### Pattern-review refinement

- Standard suffix/type recognition must work regardless of any artist/remixer/source prefix.
- Year-only fragments extracted from compound labels are not review patterns.
- Bare `hook` belongs to the same review family as Suggested Call Out / Callout Hook.
- `Mix by <name>` and handle-style credited mixes such as `only4Erol Mix` are remix material and follow `Save Remixes`.
- UI examples should repair common UTF-8/Windows mojibake before display.

### Remaining standard-form normalization

- Treat Big Mix, New Mix, Smooth Mix, Low Gain Mix, OG Version, Chillout/genre Version, Special DJ Version, regional code Version labels (US/UK/etc.), and 7-inch/12-inch Version forms as ordinary patterns.
- Slash compounds consisting only of ordinary components, such as `Single Version / 2008`, must produce no unusual-pattern entry.
- A style/genre suffix such as `Pop Version` remains ordinary even when preceded by an artist/act credit.

### Intra-release duplicate-file rule

- Retained releases may contain redundant audio files. Clean them conservatively only when duplicate identity is already proven by the high-confidence audio group after the metadata safety gate and the files also represent the same logical track position/title within the same physical disc/folder.
- The title/track-position check is a safety gate only; it must never create duplicate identity by itself.
- Prefer the technically better survivor (lossless over lossy, then sample rate/bit depth/channels, then deterministic codec/container preference). Move redundant files to `!Duplicate Files`; never delete them.
- Do not automatically remove files from CUE-based releases because exact filenames can be referenced by the CUE sheet.
- Treat `Rmx` as a remix alias equivalent to `Remix` for Save Remixes handling and `!Remixes` routing.

### ITUNESADVISORY clean/explicit rule

- `ITUNESADVISORY=0` means clean; `ITUNESADVISORY=1` means explicit.
- Advisory state must not create or block duplicate identity and must not affect normal coverage, source selection, or track-count minimization.
- Apply advisory preference only as the absolute final release-selection tie-break.
- A clean release may be replaced by an explicit release only when they are otherwise exact equivalents: same release identity after advisory wording is stripped, same release type, same source class, same total/included track count, same included track order, and the same audio-group multiset.
- When that exact-equivalence test passes, retain explicit and move clean.
- If clean and explicit audio differs, preserve both as distinct material.

### Intra-release dedupe tag-fallback rule

- Fingerprint all audio files even when they are excluded from included coverage; exclusions affect optimization, not the ability to prove duplicate files inside a retained release.
- For intra-release cleanup, duplicate identity still requires the same high-confidence audio group.
- Same-track safety requires the same physical folder and compatible track position, but title agreement may come from either the embedded title or normalized filename. A bad TITLE tag must not block cleanup when the filename and audio identity agree.

### CD rip log quality rule

- Use `ligh7s/hey-bro-check-log` (Apache-2.0) to score supported EAC/XLD rip logs; ignore `audiochecker.log` for this purpose.
- Rip-log score is never duplicate evidence and must never merge recordings/releases by itself.
- Apply log quality only between otherwise exact-equivalent CD rips: same release identity/type/source class, same total/included track count, same included audio-group order, and the same included audio-group multiset.
- Require all non-AudioChecker rip logs belonging to a release to be recognized before that release receives a comparable log-quality key. Unsupported/unrecognized logs are neutral, not automatically bad.
- For multi-disc releases compare worst-disc score first, then average score; unflagged wins an otherwise equal tie.
- A higher log score may replace an already-processed existing CD rip when the rips are exact equivalents. If log quality ties or is unavailable, existing-copy precedence remains.
- Clean/explicit preference remains the absolute final tie-break after CD-rip log quality.

### Absolute Save Remixes / Save Live rule

- When `Save Remixes` is unchecked, every remix is completely invisible to release selection and track counting except a remix that genuinely adds a featured performer not already credited on a normal version of the same song.
- When `Save Live recordings` is unchecked, live-performance material is completely invisible to release selection and track counting. Treat explicit `Live`, `Session`/`Sessions`, and `Unplugged` labels as live-performance material.
- Excluded tracks must not affect included track count, release-type heuristics, edition/superset comparison, minimum-track optimization, source/existing tie-breaks, CD-rip-log exact-equivalence checks, or clean/explicit exact-equivalence checks.
- Excluded tracks may remain physically in a retained mixed release; they simply cannot help or hurt that release during selection.

### Direct checkbox inclusion rule

- Use direct include/skip checkbox semantics only.
- `Save Remixes` checked: remixes participate normally in all release-selection logic. Unchecked: remixes are skipped completely.
- `Save Live recordings` checked: live recordings participate normally in all release-selection logic. Unchecked: live recordings are skipped completely.
- A skipped track contributes nothing to release coverage, counts, edition comparison, optimization, CD-log quality comparison, existing-vs-recycle precedence, or clean/explicit tie-breaks.
- Skipped tracks may physically remain inside a mixed release that is retained for other included tracks.

### Exact global minimum-track rule

- Preserve all active wanted groups and album obligations first.
- Preserve source class and CD-log quality requirements.
- Minimize total retained track count, counting excluded extras carried inside kept releases.
- Then minimize retained release count.
- Then minimize Recycle/update release count; Existing therefore wins only a complete later tie.
- CUE image layout receives no special physical-file discount.
- Re-Analyze after Ignore/Restore reuses existing fingerprints/groups.

### Tempo/effect remix rule

- Treat `Sped Up` / `Speed Up`, `Slowed` / `Slowed Down`, and `Reverb` / `Reverbed` variants as remix material.
- These variants follow `Save Remixes` exactly: checked means they participate normally; unchecked means they are skipped completely.
- Redundant releases/packages identified by these labels route under `!Remixes` just like explicit remix releases.

### Personal Picks rule

- Personal Picks are the single persistent home for explicit user keep choices created by phrase/title rules and by **Unusual track pattern review**.
- Phrase/exact-title Personal Picks do not override an unchecked `Save Remixes` or `Save Live recordings` switch.
- An unusual track pattern explicitly checked in **Unusual track pattern review** is kept for that run and immediately added to Personal Picks as a persistent Pattern rule.
- New unusual patterns start unchecked. A Pattern already saved in **Personal Picks** is a resolved persistent keep decision and must not appear in **Unusual track pattern review** again. It remains active until removed from **Personal Picks**; after removal, the pattern becomes eligible for review again if encountered.
- Unchecked unusual patterns are skipped for the current run and are not stored as separate negative preferences. The legacy hidden `unusual_pattern_preferences_v5` map is obsolete; positive legacy choices migrate into Personal Picks.
- The only exception to early remix elimination is a featured performer genuinely added by the remix. An ordinary song vocalist repeated in remix metadata is not an exception.
- Personal Picks never create duplicate identity. Duplicate identity remains acoustic-fingerprint based.
- Phrase rules match normalized track title/filename text case- and punctuation-insensitively; exact-title rules require normalized full-title equality. Pattern rules match the analyzer's canonical unusual-pattern key.

### Automatic review model - current

Duplicate Edition Analyzer has exactly one automatic naming-review stage: **Unusual track pattern review**.

An **Unusual track pattern** is a title/filename descriptor that appears to describe a version/edition/performance form, but the analyzer cannot confidently classify it using its known semantic rules.

Known descriptors are classified automatically and must **not** enter this review. Examples include:

- Remix / named Mix / Dub / Redux;
- Radio Edit / Radio Version / Single Edit / Album Edit / Main Version;
- Extended Version / Extended Mix;
- Live / Unplugged;
- Acoustic;
- Instrumental;
- Acapella / A Cappella;
- Sped Up / Slowed / Reverb;
- ordinary `Artist - Title` or `Artist: Title` separators.

Examples that may enter the review are genuinely unknown version-like descriptors such as `Suggested Callout`, `Special Performance 2007`, or another recurring descriptor shape whose meaning is not yet known.

Rule:

> Known meaning -> classify automatically. Unknown version-like descriptor -> Unusual track pattern review.

There is **no automatic Live/Remix phrase review, phrase detector review, or category reconfirmation stage**. Save Remixes and Save Live recordings are the authoritative global category switches. Personal Picks remain the persistent home for explicit user choices and Unusual-pattern choices.

### Per-program persistent-data rule

- Every program must own its own folder under the dynamically resolved Windows Documents library: `Documents\\Karpuzikov Tools\\<Program Name>\\`.
- Duplicate Edition Analyzer uses `Documents\\Karpuzikov Tools\\Duplicate Edition Analyzer\\`.
- Keep `settings.json`, dependencies, logs, temporary working files, caches, comparison data, undo/state data, and every other analyzer-owned persistent/working file inside that program folder.
- Use the standard subfolders `dependencies`, `logs`, `temp`, `cache`, and `state` when those categories exist.
- Do not place analyzer-owned files directly in the shared `Documents\\Karpuzikov Tools` root.
- Preserve and migrate older shared-root/LocalAppData state automatically where practical instead of making the user recreate it.
- System-wide dependencies installed by Windows/WinGet may remain in their normal system locations; any dependency files downloaded and owned by this program must live under its own `dependencies` folder.

### Unusual-track-pattern rule

- An Unusual track pattern is **unknown version-like naming**, not a second Remix/Live review.
- If the analyzer already understands the descriptor, classify it automatically and do not ask the user.
- Only genuinely unknown/ambiguous descriptor shapes may enter **Unusual track pattern review**.
- Never treat an ordinary `Artist - Title` or `Artist: Title` separator as a pattern boundary merely because the song title contains words such as `Club`, `Live`, `Edit`, or `Mix`.
- A trailing separator segment may enter review only when it itself looks like a version/performance descriptor whose semantic meaning is not already known.
- Clear song titles with no actual version/performance descriptor must never appear.

### CD image rip rule

- Support lossless CD rips stored as one audio image plus CUE, including FLAC, APE, WavPack and WAV images.
- Detect image mode only when multiple `TRACK ... AUDIO` entries in a CUE reference the same physical audio file. A normal split-file CUE must remain a split-file release.
- Fingerprint the actual CUE audio segment, not the whole image file, so image rips can match split-track rips track-by-track.
- Temporary extracted segments are working files only and must be deleted after fingerprinting; they are never part of the collection.
- The physical CD image, CUE, LOG and companion files remain one indivisible release for move/rollback purposes. Never move or delete individual tracks from a CUE image.
- CD image tracks participate in the same Save Remixes, Save Live recordings, Personal Picks, collection-wide minimum-track, source-preference, and CD-quality rules as ordinary tracks.



### Mandatory software-development rule

- Apply the user's newest stored software-development standards as a required preflight before every software/program/script change. They are requirements, not optional defaults.
- Newer explicit rules override older conflicting rules.
- GUI software is dark-theme by default unless explicitly overridden.
- Prefer one complete double-clickable `.pyw` file and the minimum practical file count.
- Bootstrap/check WinGet before dependency setup. Install missing dependencies automatically and check installed dependencies for updates without requiring manual setup.
- App-managed dependencies must use the program's own `dependencies` folder.
- Keep update behavior and documentation framed as an in-place update for existing installations.
- New/unfinished GitHub software uses the status label `Under construction ⚠️`.
- Preserve existing settings and migrate legacy storage when paths/layouts change.
- Prefer immutable version/commit-pinned external download sources over mutable branch archives.
- Update implementation and documentation together in the same version.
- Cache-busting rules apply to web/userscript delivery; they are not applicable to this native `.pyw` tool.
- Credential rules are not currently applicable because Duplicate Edition Analyzer stores no authentication secrets.

### Decision explanation rule

- Every analyzed release must have a user-visible explanation of why it is retained or marked duplicate.
- The explanation must be available visually in the application; the user must not be required to inspect a text/JSONL comparison log.
- Show the Decision Map before proposed filesystem moves are applied so the user can inspect the reasoning first.
- The Decision Map must support every release in the run, including KEEP, ADD, REPLACE, SKIP, REMOVE, conservative fallback, and excluded-only outcomes.
- For retained releases, show the direct reason and, when applicable, unique/essential recording versions, required album representation, Personal Picks, source/rip-quality context, and releases it replaces.
- For duplicate releases, show which retained releases cover its included fingerprint groups, how many groups each covers, representative track titles, and any preferred-existing relationship.
- Show remix/live/pattern exclusions separately so skipped material is visibly distinguished from duplicate audio coverage.
- Same-coverage/related-release metadata is explanatory context only; it must never be presented as the evidence that created duplicate identity. Duplicate identity remains audio-based.
- Persist the latest compact Decision Map snapshot as program state under the analyzer's own `state` folder so it can be reopened without enabling detailed comparison logging.
- During the live post-analysis Decision Map, every release must expose the other releases that share its included audio groups, and those release nodes must be directly navigable.
- A retained release may be manually excluded from the current plan. This is a reversible planning constraint only until Apply; it must not move/delete files immediately.
- Manual exclusion must re-run only collection optimization against the already-computed fingerprint groups. Do not rescan folders, re-probe files, regenerate Chromaprint fingerprints, or repeat pairwise audio comparison.
- Re-optimization must apply the same album/source/existing/minimum-track rules to the remaining eligible releases and automatically select alternate carriers where available.
- The selected release must expose its full track list. If a manually excluded release contains an included recording group with no non-blocked carrier anywhere else in the analyzed collection, highlight that track clearly in red as unique/unavailable elsewhere.
- Applying a plan that would lose such manually orphaned included audio requires an explicit second confirmation that identifies the affected recordings. Never hide or silently accept this loss.
- Manual exclusions may be undone before Apply. Saved Decision Map snapshots may be reopened read-only when the in-memory analysis objects are no longer available.
- The visual graph is release-only. Do not place Factor, Reason, Track, or other non-release nodes in the network. Detailed reasoning belongs in the selected-release details panel and is collapsed by default.
- Do not pair a permanent side list with the graph. Navigation is by release nodes plus a compact search/jump control.
- The release details area must contain a large high-contrast track table and use a draggable pane/sash so the user can increase or decrease track-list height.
- The selected release path must be selectable/copyable and have an Open folder action.
- The Release Map must be a normal resizable/maximizable top-level window without transient/modal grab behavior so Windows window managers such as FancyZones can position it.
- A live Release Map must expose obvious Apply plan, Analyze again, and Close actions. Do not show disabled/confusing text such as "Re-optimization available only immediately after Analyze"; when editing context is unavailable, simply omit edit controls and present the saved map read-only.
- Optimizer/source factors are secondary detail and must be hidden behind an expandable More details control by default.

### Persistent manual track skip

- In the live Release Map the user may select a track and choose Skip track. This is a preference to exclude that proven recording group from coverage/optimization, not a duplicate-identity assertion.
- Save track-skip preferences under the Duplicate Edition Analyzer program state folder, never in the shared Karpuzikov Tools root.
- Skipping a track must immediately re-run only collection optimization; do not rescan/re-probe/re-fingerprint audio.
- The user must be able to Restore track, which removes the saved preference and recomputes the plan.
- Manual track skips must remain visibly distinct from Save Remixes / Save Live / unusual-pattern exclusions.



### Release Map UI architecture

- **Full map** mode must show all analyzed releases at the same time in one graph. The default presentation may be a compact Changes-first delta view, but Full map must remain one direct action away and must preserve the complete release/relationship context. Never replace Full map with a selected-release subgraph, neighborhood-only view, drill-down graph, or other partial graph.
- The graph contains release nodes only. Selecting a release may highlight/dim relationships, but must not remove other release nodes from the map.
- **Duplicate releases appear on the Release Map only as secondary duplicate rows connected to the retained release(s) that cover them.** They must be visually distinct from retained releases and must never be mistaken for retained output.
- **Remix-only releases must not appear on the graph when Save Remixes is unchecked.** A release whose only relevant/included material is excluded by the remix setting is omitted from the graph.
- **Live-only releases must not appear on the graph when Save Live recordings is unchecked.** A release whose only relevant/included material is excluded by the live setting is omitted from the graph.
- These are visibility rules for the graph, not deletion rules. Hidden duplicate/remix/live releases remain part of the analyzed result/state where needed for re-optimization, explanations, undo, and future setting changes.
- A release that contains at least one currently included non-remix/non-live recording may still appear even if some of its tracks are excluded by Remix/Live settings. The node represents the release's currently included material only.

- No nested navigation: no release list + map pairing, no menus within menus, no sub-maps, and no multi-level drill-down navigation. A release click opens one direct details surface for that release while the full graph remains visible.
- The Release Map UI must no longer use Tkinter/ttk. Use a modern GPU/web-rendered UI stack suitable for a large interactive graph and normal Windows window management.
- Preferred architecture: **PySide6 / Qt 6** as the Windows desktop shell with **Qt WebEngine** rendering a custom HTML/CSS/SVG release board. Python remains the analyzer/backend and communicates with the UI through a direct Qt bridge. A force-directed node library is not required for the chronological board.
- The Release Map must support smooth scrolling, search-to-release, click selection, connected-line highlighting, and track-carrier highlighting while all currently relevant release rows remain loaded in the same board.
- Selecting a release must not navigate away from the graph. Show release/track details in a single flat side or bottom panel; closing/changing selection returns focus to the same full graph state.

### Release Map changes-first presentation - v0.3.4 authoritative

This section supersedes older wording that required the complete chronological board to be the default visible surface.

- Release Map opens in **Changes** view by default. Its primary purpose is to show what differs between the current OLD discography and the proposed improved result.
- The default Changes view is compact and must not reserve Albums/EPs/Singles columns or large blank regions.
- Provide direct, clickable filters for **All changes**, **+ Added**, **⬆️ Upgraded**, **- Removed**, and **🚫 Ignored**.
- A retained NEW release that is a genuine new addition uses the **+** symbol. This marker is mandatory and must not be replaced by color alone.
- Changes view hides unchanged retained OLD releases and rejected NEW duplicate candidates unless the user searches for them. Full map remains the complete inspection surface.
- Every change row gives an immediate short reason: new addition, replacement/upgrade source and reason, OLD release removal reason, or manual ignore state.
- Search must still find every analyzed release/track. Search is not restricted to the currently visible change set.
- Track-carrier mode and alternative Version/Remix/Live navigation may automatically switch to Full map when complete cross-release context is required.
- Full map keeps the chronological Albums/EPs/Singles organization and all SVG relationships. Entirely empty release-type columns must not consume width.
- Re-Analyze results use a compact result drawer. Added/removed release items in the drawer are directly clickable and navigate to the affected release.
- The changes-first presentation is a view/filter layer only. It must not alter optimizer decisions, retained coverage, ignore state, search data, Copy output, or analysis results.

### Release Map interaction workflow

- Release nodes must be rendered as compact **rectangular release cards**, not circles/bubbles. The release name is the primary visible content of the card.
- The red/yellow/green unique-track indicator is a **small badge attached to the release card**, never the entire release node.
- Release-card text must be high-contrast light text on a dark card. Black/dark text on the dark graph background is prohibited.
- Relationship edges between releases must remain visibly distinguishable on the dark background at the default fitted view. Use clear mid/high-contrast lines; selecting a release strengthens its connected edges while unrelated edges may dim but must not disappear completely.
- Layout spacing must account for card dimensions so release cards do not collapse into an unreadable pile at the default view.
- Do not overload release rows with permanent OLD/NEW/KEEP/SKIP/DUP/unique-count chip clutter. Keep release names primary and use compact semantic change symbols plus details-on-demand. Unique-track information remains available in release details.
- Clicking a release does not navigate away from the full graph. Its details panel unfolds in place while **all visible releases remain on the same map**.
- The details panel must show the full currently relevant track list. Tracks that are unique to the selected retained release are visually highlighted.
- Hovering a track exposes a compact **Ignore** action for that track. Do not permanently show Ignore buttons on every row.
- In a live editable map, the release-level **Ignore release** action must be a prominent high-contrast destructive button at the top of the selected release details panel. It must not be hidden inside secondary details or a nested menu.
- Track-row **Ignore** must become clearly visible on hover with destructive/high-contrast styling. It may be hidden when not hovering, but it must not be obscured by the status text.
- Closing and reopening the Release Map after analysis must preserve the live editable analysis context until Apply or a new Analyze starts. Reopening must not silently downgrade to a read-only snapshot and remove Ignore/Re-Analyze/Apply actions.

- Clicking **Ignore** on a track excludes only that exact physical track instance from optimization and adds only that instance to the persistent track-ignore list. It must never expand through acoustic group ID, fingerprint equality, base title, or another release carrying the same recording. The current graph does **not** silently mutate into a final state yet; instead, the global **Re-Analyze** button becomes visually highlighted/enabled to show there are unapplied analysis changes.
- Track Ignore means: only the clicked physical file/CUE track stops contributing coverage, uniqueness, or release-retention value during the next re-analysis. Other copies of the same recording and other tracks in the same release continue to follow normal rules.
- Clicking **Ignore** on a release is a separate operation from track Ignore. It excludes **only that exact release** as a source candidate for the next optimization pass. It does **not** ignore or blacklist the recordings inside that release; those recordings remain eligible to be supplied by any other release according to normal matching/selection rules.
- Any pending track-ignore or release-ignore change highlights/enables **Re-Analyze**. Re-Analyze must use the already-computed scan/probe/fingerprint/comparison data whenever possible and re-run the collection-selection logic with the new ignore constraints; do not unnecessarily rescan or re-fingerprint unchanged audio.
- Re-Analyze must reconsider releases that were previously classified as duplicate/hidden, because they may become necessary replacement sources after a track or release is ignored.
- After Re-Analyze, unfold one bottom **result drawer** showing the exact cause/effect delta from the previous plan. Keep the full release graph visible above it.
- Result-drawer wording must be concrete, for example:
  - `IF track: "Hot (Riffs & Rays Radio Edit)" ignored, THEN release: "2008 - Hot - Single [GB - none]" removed`.
  - `IF release: "2014-10-23 - Лучшие Хиты [191018022853]" ignored, THEN releases: "2013-12-05 - In Your Eyes [5948204031992]", "2014-04-15 - Cola Song (feat. J Balvin) [075679940926]" added`.
- The result drawer must list all release additions/removals caused by the pending ignore change, not only the first one.
- After a successful Re-Analyze that changes the plan, **Apply** becomes visually highlighted/enabled.
- **Apply** is the only action that commits the current proposed filesystem move plan. Ignore and Re-Analyze are planning operations only.
- If Re-Analyze produces no plan change, say so explicitly in the result drawer and do not falsely highlight Apply as if there were new filesystem actions.
- The graph after Re-Analyze still follows graph visibility rules: duplicate/redundant releases, remix-only releases when remixes are disabled, and live-only releases when live is disabled stay hidden unless they become retained/otherwise visible under the new plan.
- Unique-track badges, unique-track highlighting, release details, and result-drawer deltas must all refresh from the same newly computed plan so the UI never shows stale pre-analysis values.

### Chronological folder-board layout and connection semantics

- The Release Map is a chronological **folder-style release board**, not a force-directed bubble/circle graph.
- Sort all visible release rows by the date prefix in the release folder name (`YYYY-MM-DD`, then `YYYY-MM`, then `YYYY`; undated rows last). Preserve ascending chronological order across columns.
- Lay releases out in compact vertical columns resembling Windows Explorer folder rows. The release folder name is the primary text; do not use oversized cards or circular nodes.
- Retained releases use normal high-contrast rows. Duplicate/redundant releases use visually secondary rows marked `DUP`.
- The small red/yellow/green unique-track badge remains only on retained rows. Duplicate rows use a neutral duplicate marker instead.
- Default connection lines have exactly one meaning: **duplicate release -> retained release(s) that cover its included recording groups**. Do not draw generic connections merely because two retained releases share some audio.
- Duplicate connection lines must be clearly visible but visually secondary. Selecting a release strengthens only the duplicate relationships touching that release.
- Clicking a track in release details activates **track-carrier mode**. Every visible release containing that exact recording group is highlighted, all other release rows dim, and bright connection lines run from the selected release to every other visible carrier.
- Track-carrier mode includes duplicate releases, so the user can immediately see previously rejected/duplicate releases that contain the same recording.
- The UI must state how many visible releases contain the selected track and provide one direct `Clear track highlight` action.
- Clicking another release clears track-carrier mode unless the user selects a track again. The full chronological board remains present at all times; there is never a sub-map.

### Personal Picks phrase extraction and review

- Personal Picks phrase detection must extract the version/remixer descriptor, not the base song title. For `Club Rocker (Play & Win Remix)`, the reusable candidate is `Play & Win Remix`; the full title must not also appear as a phrase candidate.
- The same applies to `Gimme Gimme (Ness Remix)` and `Gimme, Gimme (Dirty Nano Remix)`: use the bracketed remix descriptor only.
- A full-title fallback is permitted only when the input is genuinely a descriptor string rather than a complete track title.
- Personal Picks Review must provide direct clipboard access: each detected candidate has a Copy action and the review has Copy all review text. The persistent Personal Picks list must support Ctrl+C for selected rows and a Copy all action.


### Permanent track-family taxonomy

This taxonomy is a standing rule for all future Duplicate Edition Analyzer work.

- **Version** means a replaceable edit/variation of an already-defined recording root, such as Radio Edit/Version, Single Edit/Version, Album Edit/Version, Main Version, or a comparable short/edit form.
- **Extended Version / Extended Mix of the base recording is a unique recording root**, not a replaceable Version of the base.
- **Instrumental**, **Acapella/A Cappella**, and **Acoustic** are unique recording roots, not replaceable Versions of the base.
- **Remix** is a unique recording root. A Radio/Edit/Extended form of that same Remix is a Version of the Remix root.
- **Live/Unplugged** is a unique recording root. An Edit/Extended form of that same Live recording is a Version of the Live root.
- Classification follows semantic parentage, not the literal presence of words such as `Version`, `Edit`, or `Mix`.
- **Parent-root precedence:** Remix, Live/Unplugged, Acoustic, Instrumental, and Acapella identity is established before a later Edit/Radio/Extended suffix is interpreted.
- Release Map alternative-family UI, connection logic, counts, and Gem calculations must respect unique roots independently.
- For Gem logic, "has another Version" means another replaceable variation of the same recording root only. A different unique root does not disqualify it.

### Initial vs Result plan counters

- Release Map must always show **Initial** and **Result** counters side-by-side for both retained releases and counted tracks.
- **Initial** is captured from the first completed Analyze plan and stays unchanged for the entire live analysis session, including repeated Ignore/Re-Analyze cycles and closing/reopening that live map.
- **Result** represents the latest completed Analyze/Re-Analyze plan and shows signed cumulative differences from Initial for both releases and tracks.
- When Ignore changes are pending but Re-Analyze has not run, do not predict counts. Keep the last computed Result and visibly mark it as pending Re-Analyze.
- A brand-new Analyze resets Initial and starts a new comparison baseline.
- Track count means tracks currently participating in coverage inside retained releases; tracks skipped by active options or the manual ignore list are not included in this counter.
- The Re-Analyze result drawer must repeat the cumulative Initial -> Result release/track totals so the impact remains visible alongside the concrete release additions/removals.
- The main window must provide a compact folder control immediately beside Logging that opens this program's isolated `Documents\\Karpuzikov Tools\\Duplicate Edition Analyzer\\logs` directory.


### Main UI technology

- The active Duplicate Edition Analyzer main window uses the same PySide6 + Qt WebEngine + HTML/CSS/JavaScript UI stack as Release Map.
- Keep the main window and Release Map visually unified: same dark palette, Segoe UI hierarchy, compact controls, border/radius language, status/progress treatment, and interaction density.
- Do not revert the active main window to Tkinter in future updates unless the user explicitly requests it.
- Keep long-running work off the WebEngine/UI thread; progress and activity must remain live through the Qt bridge.

### Ignored-release inspect and restore workflow

- A release ignored from Release Map must **never disappear from the map** merely because it is ignored. Keep it in its chronological position and visibly mark it `IGNORED BY YOU`.
- Before Re-Analyze, show explicit `PENDING IGNORE` / `PENDING RESTORE` states. Do not pretend replacement sourcing has already changed.
- After Re-Analyze, keep the ignored release selected/open when possible so the user can immediately inspect the consequence of the decision.
- Every included track in an ignored release must state where that exact recording is retained instead. Show a deterministic primary retained source and, when applicable, the number of additional retained copies.
- If an ignored release contains an included exact recording that no retained release supplies, show a prominent red `NO REPLACEMENT` warning for that track. Do not silently substitute an alternate Version, Remix, or Live recording.
- Re-Analyze result details must repeat the track-by-track replacement sourcing for ignored releases, not only the release-level added/removed list.
- An ignored release must always expose an obvious `Restore release` control. Restoring changes the planning constraint and requires Re-Analyze; it does not require a new full audio scan.
- Ignore/Restore/Re-Analyze remain planning operations. No files are moved until Apply.


## Dynamic-range/mastering-quality rule - current

Dynamic range is mastering-quality preference only, never duplicate evidence.

- Measure integrated LUFS, LRA, true peak, RMS/crest-style contrast and a derived dynamics score with bundled FFmpeg.
- Cache measurements.
- Do not measure DR merely because releases look like duplicate candidates.
- First finish coverage, source, CD-log quality, total-track-count/release-count, Existing/Recycle, Explicit/Clean and every other non-DR decision.
- Measure DR only for exact interchangeable releases that remain unresolved after all of those rules tie.
- Any measurable higher dynamics score wins inside that final tie; there is no material-difference threshold.
- If DR also ties, use the stable deterministic fallback.
- DR never causes different stated Versions to merge.

## UI filesystem-path rule - mandatory and release-blocking

The repository-wide filesystem-path invariant applies to Duplicate Edition Analyzer without exception.

Any local filesystem path shown in an interactive DEA UI must have a folder/open-location control immediately before it.

Behavior:

- directory path -> open that directory in Windows Explorer;
- file path -> open Explorer with that file selected when possible;
- the control belongs directly before the path it controls;
- apply the rule everywhere a path is visible, including main UI, Release Map, review screens, diagnostics, errors, logs, planned actions/results, dependency/status views, and future UI;
- do not require copying the path or navigating manually;
- use the shared path-opening helper/component rather than one-off implementations where practical;
- existing controls are not grandfathered;
- missing path controls are a release-blocking bug;
- if the target no longer exists, fail gracefully and keep the displayed path unchanged.

## Fingerprint comparison execution - v0.21.0

- Candidate identity rules and acoustic thresholds are unchanged.
- Expensive full fingerprint comparisons run in small bounded process batches instead of giant ordered chunks.
- Identical fingerprint vectors are accepted directly as definitive acoustic identity.
- Once two tracks are already in the same validated acoustic Union-Find component, another candidate comparison between them is skipped because it cannot alter the final grouping.
- These execution shortcuts must not weaken the existing metadata safety gate or introduce metadata-based duplicate identity.
- Progress must update continuously and expose comparisons/sec and ETA for long runs.


## Early remix/live elimination rule

When `Save Remixes` is OFF, tracks classified as remixes are eliminated at the first classification stage, **except when the remix genuinely adds a featured performer not already present on a normal non-remix version of the same song**. Repeating the song's ordinary vocalist in title/filename/ARTIST metadata does not preserve the remix.

When `Save Live recordings` is OFF, tracks classified as live recordings are eliminated at the first classification stage.

Eliminated remix/live tracks must not participate in any later analytical stage. In particular they must not be:

- fingerprinted;
- added to fingerprint-token indexes;
- acoustically compared;
- placed into recording groups;
- used for dynamic-range/mastering analysis;
- used for coverage calculations;
- used by the global optimizer;
- used for release-quality tie-breaks;
- used to influence keep/remove decisions for wanted audio.

The analyzer keeps only the filesystem/release bookkeeping needed so those excluded files or releases can be moved at the final Apply stage.

If the corresponding Save option is ON, those tracks remain in the normal analysis pipeline.

Featured-remix exception:
- applies only when the remix introduces at least one featured performer absent from the normal non-remix version of that same song/primary artist;
- such tracks are not early-discarded when `Save Remixes` is OFF;
- a featured vocalist already present on the normal song does not qualify;
- if no normal counterpart exists, artist-tag or filename-prefix feat./ft./featuring is not enough to preserve the remix; only a feature explicitly attached to the remix/version wording itself is an exception;
- they are fingerprinted, compared, grouped, coverage-counted, dynamically analyzed when otherwise eligible, and optimized like normal wanted audio;
- the exception does not apply to ordinary remixer naming such as `Artist Remix` or `Artist Mix`.


### v0.21.1 implementation note

- Early Remix/Live elimination is implemented in the executable pipeline.
- Eliminated tracks are not fingerprinted, indexed, acoustically compared, grouped, dynamically analyzed, or optimized.
- A remix with `feat.`/`ft.`/`featuring` is an exception only when the performer is proven new relative to a normal version of the same song/primary artist, or when the feature is explicitly attached to the remix/version wording itself. Artist-credit prefixes alone never prove a remix-added feature.
- A featured remix that is also Live still obeys `Save Live recordings`.
- Detailed comparison logs record eligible-track count, early-eliminated count, and featured-remix exception count.


## v0.22.0 authoritative corrections

This section supersedes older historical wording elsewhere in this file.

- External database recording IDs are not read or used.
- No external rip-database confidence/verifier is used.
- Version = unique song/version, but unlabeled metadata is not proof of a different/base version. Only explicitly incompatible disjoint Version families are hard-skipped; exact identical Chromaprint always wins over wording.
- Different-title accepted acoustic matches merge automatically; near-threshold non-matches remain separate automatically. No acoustic manual review.
- Explicit > Clean before fingerprinting.
- Compilations are lower than regular Album/EP/Single and survive only for wanted groups unavailable on regular releases.
- CD rip log threshold is 80, with hey-bro-check-log as the authority.
- Optimize total retained track count, not physical file count; CUE images receive no one-file discount.
- DR has no material threshold: when earlier rules tie, any measurable better DR score wins.
- Existing is only the later tie when source/log/track-count/DR all tie.

## v0.22.1 zero-manual-input acoustic identity

This section supersedes every older manual-acoustic-review rule.

- The analyzer must never ask the user whether two tracks are the same recording.
- If the acoustic matcher accepts a pair, the pair is the same recording automatically.
- Different title spelling, alternate title, typo, artist-credit difference, featured-credit difference, or release context must not downgrade an accepted acoustic match to REVIEW.
- If the acoustic matcher does not accept a pair, keep both recordings separate automatically.
- Near-threshold/ambiguous non-matches are preserved, not reviewed.
- Only strong, explicitly incompatible semantic families may pre-block comparison. Weak/named Edit/Mix wording such as `BT Edit`, `Album Edit`, `Single Mix`, or `American Radio Edit` must remain acoustically comparable unless another strong family conflict exists.
- The goal is zero manual duplicate-identity input while remaining conservative when audio evidence is insufficient.

Regression case:
- `Voigt Kampff Test - BT & Nick Phoenix` vs `Voigt Kamff Test - BT`;
- score about 0.1152, overlap 100%, good 100%, definitive acoustic identity true;
- required result: automatic MATCH and no user prompt.


## v0.22.2 candidate-routing, DR and logging corrections

This section supersedes older candidate-routing, DR-order and detailed-log wording.

- Expensive acoustic comparison must no longer approach all-pairs behavior merely because common Chromaprint tokens collide.
- Same-base-title pairs and identical fingerprint vectors remain safety routes and are acoustically resolved regardless of reported duration.
- Different-title candidates are routed with bounded duration neighborhoods plus normalized fingerprint-token containment; duration remains routing-only and never becomes identity evidence.
- Token evidence is weighted by rarity. Very common tokens are suppressed from far-distance candidate expansion.
- High-confidence candidates are processed before weak candidates so validated Union-Find components can eliminate redundant later work transitively.
- A deterministic shadow-validation sample is run against router rejects. A sampled acoustic false negative is recovered into the recording group and explicitly logged.
- Semantic Version detection includes named `... Mode` descriptors such as `Lunar Mode` and explicit release-level families such as `Extended Versions`.
- Common mojibake and harmless unmatched tag-edge quotation garbage are normalized before semantic routing; normalization must not strip legitimate leading/trailing apostrophes.
- Wanted tracks whose fingerprint generation fails remain conservative singleton recording groups; a fingerprint failure must never erase wanted coverage.
- Comparison logging uses normalized per-track catalog records plus compact pair references. Full pair details are kept for matches, content-gate cases, near-threshold cases, shadow recoveries and a deterministic reject sample; ordinary rejects are aggregated into funnel/route/duration counters.
- DR/mastering runs only after the normal optimizer and all non-DR preference passes. Only exact interchangeable releases that remain fully tied are measured.
- Existing/Recycle status is part of the pre-DR tie signature. DR cannot override Existing with an otherwise-equivalent Recycle copy.
- Re-Analyze uses the same final-tie-only DR rule without rescanning/re-fingerprinting unchanged audio.


## v0.22.4 semantic-version false-unique correction

This section supersedes every older rule that treated one labeled side and one unlabeled side as automatically different recordings.

- An unlabeled title does not mean "base/original version". It means the version is unspecified.
- Therefore pairs such as `Four (Original Mix)` vs `Four`, `Tomahawk (Original Mix Edit)` vs `Tomahawk`, `Always (Radio Edit)` vs `Always`, and equivalent cases must reach acoustic comparison when candidate evidence permits.
- Same-base-title routing remains a safety route for these pairs.
- Exact identical Chromaprint fingerprints bypass semantic-version conflict completely and merge automatically.
- If both sides explicitly state version families, a hard semantic skip is allowed only when their declared families are disjoint. Shared family/release context means audio gets the final say.
- Explicitly incompatible examples such as `Radio Edit` vs `Extended Mix` remain safely separated before expensive comparison unless their fingerprints are literally identical.


## v0.22.5 remix exclusion and weak-version-gate correction

This section supersedes older featured-remix, contextual-remix, and generic Edit/Mix conflict wording.

- The featured-remix exception is about a performer added by the remix, not the song's ordinary featured vocalist repeated in remix metadata.
- Determine ordinary featured performers from non-remix/non-live versions of the same base song and primary artist across the analyzed collection.
- If a remix carries only those ordinary feature credits, it is excluded when Save Remixes is OFF.
- If the remix adds a new explicit featured performer, it remains the sole Save-Remixes exception.
- If no normal counterpart exists, a feature in the artist credit or filename artist prefix is not preserved automatically; only remix-specific feature wording can create the exception.
- Parent-family Remix inheritance is release-title independent and collection-wide, scoped by base song + primary artist. Explicit remixer evidence on one release can classify the same remixer's child edit/version on another release.
- Examples that must classify as Remix when remixer evidence exists anywhere in the analyzed collection include `Mood II Swing Radio Edit`, `Mantronik Electrohippy Formula`, `Dave Aude Radio Edit`, `Loverush UK! Radio Edit`, `Lucid Mix Edit`, and comparable named child variants.
- A confident non-primary two-word possessive remixer descriptor such as `Simon Hale's Orchestrata` is Remix even without a literal Mix/Remix word.
- Weak labels such as `BT Edit`, `Album Edit`, `Single Mix`, and generic/named edits are not strong enough to veto acoustic comparison.
- Regression pairs that must reach the acoustic matcher include `Godspeed (Radio Edit)` vs `Godspeed (BT Edit)`, `Remember (American Radio Edit)` vs `Remember (Album Edit)`, and `Remember (Edit)` vs `Remember (Single Mix)`.
- Strong structural conflicts such as Radio vs Extended or Acoustic vs Instrumental remain eligible for semantic pre-blocking unless exact identical Chromaprint overrides the wording.


## v0.4.6 incomplete acoustic fingerprint detection and PCM recovery - authoritative

- `fpcalc` can produce misleadingly short fingerprint vectors while reporting the full media duration. Do not count a nonempty JSON fingerprint as complete by default. Example: v0.4.5 real `Privilege` ALAC vs FLAC, both 170.573333 seconds; comparison score 0, 100% overlap against the shorter fingerprint, but only 10.8407% of the longer fingerprint aligned. The 94% unmatched-content gate MUST reject this pair until a complete acoustic fingerprint has been recovered; never lower thresholds or merge by matching title/duration.
- Identify clearly truncated fingerprint frame counts using Chromaprint's approximate 11025/4096 frames/second and conservative startup/tolerance margin. On those files alone, re-decode via FFmpeg into app-local temporary 11025 Hz mono PCM WAV, then recalculate full Chromaprint and delete PCM after the attempt.
- If the regenerated fingerprint is still incomplete or decoding fails, record an explicit error and leave the track as a conservative unmatched singleton. Do not fabricate acoustic identity. Always preserve the source file. Temporary files belong inside the program-specific `Documents\\Karpuzikov Tools\\...\\temp` path.
- `fpcalc` and FFmpeg remain application-owned child subprocesses under the Windows kill-on-close Job Object. The recovery pipeline obeys the same HDD/SSD I/O worker count as the initial fingerprinting stage.
- The comparison JSONL must expose frame counts and whether automatic PCM repair occurred for each track. Include a synthetic root-cause reproduction, recovered-vs-unrecovered tests, validation of cleanup, and preserve full WebView2 GUI/previous matching rules. Hardware behavior must still be tested before stable release.

## v0.4.5 full CD core versus independently issued featured-remix bonuses - authoritative

- **User regression (The Weeknd 2026-10-10):** OLD 19-track CD `Starboy [US - B0026150-02]` provides 18 wanted core recording groups; NEW 21-track WEB `Starboy (Deluxe) [602455499851]` contains those same 18 plus `Reminder (Remix)` and `Die for You (Remix)` (with one excluded Kygo remix). Both included remix groups have proven acoustic MATCH to independently issued Singles. The 1-track `Reminder (Remix)` single and 4-track `Die for You (Remix)` single cover all the Deluxe-only wanted material.
- A full core Album edition may satisfy the family obligation rather than the highest-group-count Deluxe edition **only if all** of the following are true: it is in the same audio-derived album family and same normalized album title, its entire wanted acoustic-group multiset is contained in the Deluxe edition, its source rank is no worse than the Deluxe, every missing Deluxe group is an included remix with a genuinely newly featured performer, and every such group is independently carried by an **available/unblocked, included Single/EP** in the same optimization pool. Every wanted group and best eligible source remains a separate hard requirement. Missing one qualifying single revokes the exception and requires the Deluxe.
- The optimizer must not pre-prune the full core album as dominated when this exception applies, even for equal-source copies. It must evaluate both complete Deluxe and full-core-plus-Singles plans by physical retained track count and then release count, subject to source floor. This is NOT a blanket relaxation for ordinary songs, unique versions, Extended/Instrumental additions, compilations, or an incomplete core album.
- Target result in the real Starboy scenario: keep the 19-file CD core + 1-file Reminder Single + 4-file Die for You Single = **24 physical files**, not CD + 21-file Deluxe + existing 4-file Die for You Single = **44 files**, while keeping every wanted acoustic group and the CD source floor.
- The provider rule, equivalent-edition prepruning, exact-cover album constraint and late-plan validation must share this same exception logic. Automatic decisions must label the omitted WEB Deluxe as covered and keep the standalone Reminder single if it is the chosen carrier.
- Keep full GUI WebView2, never switch to the rejected ASCII prototype. Status remains Under construction ⚠️ until the actual Windows dataset and Move/Undo are tested.

## v0.4.4 compilation fallbacks and featured-remix correction - authoritative

- Compilation tracks must NEVER be permanently excluded merely because a regular release currently covers their acoustic groups. Group identity survives manual Ignore/Restore and Re-Analyze. The exact optimizer ranks regular releases ahead of compilations *per wanted group*, uses compilations for groups with no unblocked regular providers, and preserves the best CD/source class among eligible providers. Re-Analyze with all replacement sources manually removed must be able to bring the original compilation back rather than losing wanted material. Manual exclusions must be respected, never automatically undone.
- Recognize `The Highlights` anthology (including Deluxe) and 25+ track `Trilogy` collections as compilations even if tags report Album. Distinguish them from legitimate albums. Only keep a compilation if at least one wanted recording remains unavailable through eligible regular releases.
- Remixes with newly credited performers in ARTIST metadata (e.g. separated with `;`, `&`, `with`) must be preserved under Save Remixes OFF when the additional featured artist was not credited on the normal source. When no ordinary comparison source is available, two-person collabs can count as explicit new-artist evidence, but an ambiguous 3+ artist credit alone must not rescue established remix-only packages such as Dirty Vibe.
- `Call Out My Name` is a normal song title, not a Callout Hook review pattern. Match only explicit Suggested Callout / research / Hook descriptor forms. Old excluded phrase choices must not suppress the song.
- `Chopped & Screwed` inside a bracketed or trailing version descriptor is remix material. The ordinary title `Chopped and Screwed Dreams` must not be misclassified.
- An explicitly identified shortened Single Version with significant length difference and nonidentical acoustics must not be merged into its album recording simply because the comparison's unmatched-fingerprint segment is classified as silence. Identical fingerprint vectors remain definitive.
- Preserve the graphical WebView2 application and all previous parity requirements. Add realistic regression fixtures and keep Under construction until real-folder reruns, Move/Undo and Windows UI testing pass.

## v0.4.3 fingerprint worker ownership and storage-aware concurrency - authoritative

- `fpcalc.exe`, `ffprobe.exe`, CUE extraction `ffmpeg.exe` and other subprocesses launched through the common hidden-process runner must be owned by the application on Windows using a kill-on-close Job Object. Close, X and normal/abnormal process termination must not leave those spawned analysis subprocesses running. Never mass-kill unrelated `fpcalc.exe` processes.
- Auto audio I/O worker selection must inspect both OLD and NEW storage, choosing a conservative limit when either drive is rotating, network, or unidentifiable. Windows storage seek-penalty descriptor determines SSD versus HDD when accessible. HDD/network/unknown: 2; both SSD: up to 8. Do not equate CPU threads to safe disk concurrency.
- Expose a labeled, keyboard-accessible graphical WebView2 audio I/O worker selector with Auto and manual 1-32, persist it in program-local settings and report the actual I/O limit in Activity. Cap `ffprobe` and `fpcalc` concurrent invocations; acoustic comparison parallelism is independently CPU-bound.
- UI source-folders text must distinguish read-only analysis from destructive Move export. Never replace the graphical Release Map with the rejected ASCII prototype.
- Include regression tests for auto/mixed-media and manual count selection, bridge availability, and tracked subprocess behavior. Windows-specific Job Object / physical-media detection still require hands-on runtime verification. Keep status Under construction ⚠️.

## v0.4.2 copy/move collision and Undo safety - authoritative

- Both OLD+NEW export modes must preflight **nested/ancestor** destination targets in addition to exact collisions; reject overlapping release folder targets before any source/destination modifications.
- Copy must stage each retained release inside the destination volume and publish its output folder only when the copy completes; failed copies must not leave a partial final-named release folder.
- Same-volume rename permission/sharing violations are fatal and must never be treated as cross-volume errors. Only actual EXDEV / Windows ERROR_NOT_SAME_DEVICE may trigger checked copy-before-delete fallback.
- Undo must not silently drop entries when neither original nor moved-to path exists. Keep the manifest on conflicts, continue processing independently recoverable entries, and report the unresolved paths.
- Visible default export paths must have operative folder-opener controls before the user selects a custom location.
- v0.4.2 retains the full graphical WebView2/pywebview interface and all v0.4.1 Copy/Move/Undo behavior. Actual Windows and full Skrillex folder testing remain mandatory; no stable/parity claims.

## v0.4.1 default UPDATED destination and independent Copy/Move - authoritative

- Both export actions must default to a sibling `<New / update releases root> - UPDATED` folder. Example: `C:\!deemix Music\Metro Boomin` => `C:\!deemix Music\Metro Boomin - UPDATED`. Show the complete default next to a folder-opener immediately, and retain a Browse override per action.
- **Copy old + new releases into:** copies retained OLD + NEW source material non-destructively, never changes either scanned source.
- **Move old + new releases into:** replaces the old `Copy new releases into`; it is not a rename of a NEW-only copy! It must physically relocate retained OLD + NEW release folders, leave rejected/non-retained releases at source, and require a clear confirmation explicitly warning that selected originals leave their folders.
- Fail closed on destination collisions, overlapping paths or output trees within either source tree; never merge/overwrite release folders. Copy/move must preserve original folder structure and filenames.
- Cross-volume moves must verify copied release data before deleting originals, keep Undo/restoration journal, and roll back completed transfers if a later move fails. Do not silently overwrite previous Undo history. After Move, invalidate release decisions with obsolete source paths and request a fresh analysis.
- Both actions are disabled during pending manual Ignore/Restore decisions until Re-Analyze completes. Under construction remains until Windows runtime testing confirms behavior.

## v0.4.0 graphical Release Map line readability - authoritative

- This version continues the full-featured WebView2 + pywebview desktop interface. The isolated ASCII/Textual experiment is rejected and must not be merged or substituted for the graphical release.
- Full Map release-row separators must be clearly discernible at default Windows scale: 2 px solid `#303947`, while preserving compact rows, group headings, and normal hover/selection styles.
- Relationship paths must have visibly pronounced but differentiated stroke weight: idle duplicates 1.65 px, selected duplicates 2.8 px, Versions 3.0 px, Remixes/Live 2.65 px, active-track carriers 3.6 px. Preserve their opacity hierarchy and dash patterns.
- These are strictly presentation changes. Do not modify acoustic identity, recording groups, retained release selection, Release Map relationship membership, Apply, undo, file copying, or analysis performance to achieve thicker lines.
- Keep `0.4.0 - Under construction ⚠️` until the user's exact Skrillex rerun and Windows GUI inspection pass.

## v0.3.9 Release Map excluded-only visibility - authoritative

- **Every analyzed release** must remain inspectable in **Full Map**, including zero-wanted-track releases excluded at the first classification stage. Never use membership in an acoustic recording group as a prerequisite for showing an analyzed release.
- Existing-folder releases whose entire tracklist was excluded by Save Remixes OFF / Save Live OFF / Personal Picks pattern decisions retain backend `REMOVE` actions and MUST appear under Changes > `- Removed` with a clear count and cause. Example: `All 4 tracks excluded (Save Remixes OFF).`.
- NEW/update-folder excluded-only releases remain `SKIP`; keep them in Full Map for transparency but do NOT classify them as OLD removals or new additions in Changes.
- Rendering visibility must not alter coverage, the exact optimizer's selected set, Apply/Undo behavior, or retained release/track plan totals.
- End-to-end regression: four-track Recess (Remixes) and Dirty Vibe (Remixes) OLD sources are removed rather than silently hidden; the paired NEW remix-only releases remain skipped, and the OLD/NEW Dirty Vibe decisions/snapshots/UI nodes preserve their tracklists and exclusion reasons.

## v0.3.8 Re-work remix classification - authoritative

- A parenthesized, bracketed, or separated trailing remix descriptor written `Re-work`, `Rework`, `Reworked` (including a credited act such as `Jack Beats Re-work`) is Remix material, subject to **Save Remixes** in the very first classification stage. It must not reach the acoustic matcher or the optimizer when Save Remixes is OFF unless it has a genuinely remix-added featured artist.
- A word appearing in an unrelated standalone song title such as `Rework Your Life` must NOT automatically be deemed a remix; identify descriptor syntax.
- The only Save Remixes OFF exception continues to be a *feature added by the remix*, not an ordinary featured performer repeated on the normal song. Re-work credits use the same exception.
- Personal Picks cannot resurrect excluded remixes. An EP containing only excluded remixes must not be retained merely because its album/folder name says `Remixes`.
- Regression dataset: OLD `2014-12-14 - Dirty Vibe (Remixes) [075679931368]` (release 12) and NEW `2014-12-15 - Dirty Vibe (Remixes) [075679931351]` (release 74); their third tracks `Jack Beats re-work` were falsely classified as normal wanted audio in v0.3.7. With Save Remixes OFF and no remix-added feature, all four tracks of each must be excluded and neither release retained.
- Keep Save Remixes ON behavior, metadata-independent audio identity for wanted material, and genuine remix-added feature exceptions intact.

## v0.3.7 album completeness and provider-type aliases - authoritative

- Provider release-type labels (Album/EP/Single) are not proof that two physically identical, acoustically equivalent copies are different editions. An EP/Single-tagged OLD copy may fulfill a maximum-completeness Album obligation only when its release-family title matches and its entire physical track count, included acoustic group sequence and multiplicities match a maximum-completeness Album edition.
- This exception must never permit an incomplete EP, different release family, compilation, missing wanted recording, or larger/different physical container to substitute for a maximally complete Album.
- The exact solver must allow those truly equivalent providers BEFORE late Existing/NEW tie-breakers; source preference and Existing no-churn rules apply normally.
- Every late release substitution must preserve recording coverage, source quality, and at least one valid album representative. If a late tie-break somehow violates these invariants, restore the last valid exact optimizer selection with an explicit logged diagnostic; do not crash or silently degrade the plan.
- Regression: Skrillex Scary Monsters OLD tagged EP, NEW tagged Album, 11 physical tracks including seven wanted acoustically matched groups, must retain OLD without album-completeness failure when both are otherwise interchangeable.

## v0.3.6 source-safe optimization and Release Map correctness - authoritative

- For each included wanted acoustic recording group, the exact optimization model must select at least one best-source-class carrier (CD/physical above WEB; comparable CD-rip acceptability 80+ is evaluated in the source floor). Restrict the existing group-coverage requirement to best-class providers; do not double the solver's requirement graph. Numeric CD log quality differences within the same class remain late tie-breakers.
- Source preservation is a hard coverage constraint **before** minimizing total retained physical tracks and retained release count. Never add higher-source copies after exact minimization as an unoptimized repair pass.
- Equivalent-edition pre-pruning must not remove the only better-source carrier. CD-log/DR late substitutions must not increase physical track count or violate recording, source-floor or maximum-completeness album constraints.
- The Release Map must preserve valid acoustic group ID `0` in all visible nodes, relationship links and alternate-version catalogs.
- A coverage/duplicate link does not prove a replacement. Show `↔ Replaced` only if one NEW release completely covers the included wanted acoustic groups of a removed OLD release and both are recognized as the same release family; otherwise report separate add/remove with actual partial coverage.
- Cache Release Map replacement pairing per state and invalidate it after updates. Do not rebuild every pair for every displayed row or filter.
- v0.3.6 remains `Under construction ⚠️` until exact Skrillex and Windows/WebView2 runtime testing pass.

## v0.3.5 source preservation and Release Map delta correction - authoritative

This section supersedes older optimization wording wherever it allowed collection-size minimization to erase a better source for recordings that are already available at higher quality.

### CD / source quality preservation

- Source preference applies to the shared **recordings**, not only to whole-release exact-equivalence ties.
- A lower-source release (for example WEB) may be retained because it contributes a unique wanted recording/version, but it must **not** displace an available higher-source CD/physical copy of the recordings they share.
- If keeping the unique lower-source release and the higher-source release together is necessary to satisfy both unique coverage and CD>WEB preference, keep both. This source-preservation rule outranks the lower-total-track/lower-release-count objective.
- A strict album superset does not automatically dominate a higher-source subset when the superset's source quality is lower. The superset may still be required for album completeness/unique material, while the higher-source edition remains for its shared recordings.
- Among competing source-preservation candidates, prefer higher source rank, then better comparable CD-log quality, then Existing, then the smaller container/stable order.
- A below-threshold CD still follows the existing CD-log rules; this correction does not turn metadata into duplicate identity.
- Exact-equivalent Existing preference is based on proven included audio/container shape. Provider Album/EP/Single metadata disagreement alone must not create churn.

### Candidate-routing correction

- Same album + same track number/slot is a permitted **routing-only** safety path to acoustic comparison across releases.
- This is specifically intended for provider naming drift such as `Warped Tour '05 (ft. pete WENTZ)` vs `Warped Tour ’05 with pete WENTZ`.
- Album/slot metadata never proves identity. Chromaprint/audio acceptance remains mandatory.

### Changes view pairing and density

- When an OLD release is removed because one retained NEW release covers it, show that cause/effect as one **↔ Replaced** change whenever it is a replacement relationship. Do not force the user to correlate an unrelated-looking `+ Added` row with a separate `- Removed` row elsewhere.
- A true **+ Added** row must explain what new/unique wanted recording(s) it contributes when that information is available.
- Paired replacement-source OLD rows do not also count as independent Removed changes in the default Changes summary.
- Changes/Added/Replaced/Removed/Ignored views must size their scrollable content to their own visible rows. A stale Full-map SVG/board height must never create scrollable empty space.
- Full map uses compact line-separated release groups and compact line-separated rows; padded card-inside-card group containers are prohibited because they waste vertical space.

## v0.22.6 Release Map track-ignore and responsiveness correction

- Track-level `Ignore` / `Restore` is exact-instance only. It must affect only the clicked physical file or virtual CUE track.
- Acoustic-group identity, identical fingerprint, same base title, and same recording on another release must never cause a second track row to inherit the click.
- Legacy pre-v0.22.6 broad manual-skip rules based on fingerprint groups/base titles are not reapplied because their original physical target cannot be recovered safely.
- Ignore/Restore clicks update the visible row and dirty/Re-Analyze state immediately without rebuilding the complete Release Map or rerunning optimization.
- Expensive plan/map reconstruction happens on explicit `Re-Analyze`, not on every click.
- Full track titles in Release Map details wrap to multiple lines instead of permanent ellipsis truncation; the complete title is also available as a native hover tooltip.
