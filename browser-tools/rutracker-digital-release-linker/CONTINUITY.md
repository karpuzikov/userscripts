# RuTracker Digital Release Linker - Continuity

## Product
- Version: 1.1.26 - Under construction ⚠️ (needs user testing in Tampermonkey).
- Repository: `karpuzikov/userscripts`, branch `main`.
- Main file: `browser-tools/rutracker-digital-release-linker/RuTracker_Digital_Release_Linker.user.js`.
- Applicable rules: repository-root `SOFTWARE_RULES.md`. No project-specific `RULES.md` currently exists.
- Purpose: On RuTracker `posting.php?mode=editpost`, link verified digital release pages, optionally force Deezer links, add country flags, and insert genuinely new discography releases with catalog-matched FastPic cover artwork. Each operation is explicitly manual; no automatic edits on page load.

## Design and dependencies
- Single Tampermonkey userscript, `@grant GM_xmlhttpRequest`, `GM_getValue`, `GM_setValue`, `@connect api.deezer.com`, `musicbrainz.org`, `fastpic.org` and `www.fastpic.org`.
- Native Tampermonkey updates: clean main-branch `@updateURL` and `@downloadURL`; stable script identity; no custom update checker. Do not change or move the stable userscript source filename.
- Network caches live in memory per page. The combined script stores the last FastPic session URL list in Tampermonkey storage (`discography-merge:sessions`). The updated BBCode is not persisted.
- Existing exact UPC/catalog lookups through Deezer and MusicBrainz, MusicBrainz page fallbacks to Deezer/Beatport, and country emoji support remain operational.
- MusicBrainz HTTP 503 must retry without an attempt limit, respecting `Retry-After` and waiting at least 5 seconds without one; rate limit MB requests and avoid unrelated network changes.

## Important contracts
- Recognize both old source BBCode formats and unfilled `CD/WEB|[url=ссылкаНаИсточник]Источник[/url]` placeholders.
- Convert confirmed matches to `WEB|[url=<exact page>]Deezer[/url]` or `WEB|[url=<exact page>]Beatport[/url]`. Unverified or unmatched releases retain their original data.
- **Artwork separation:** Both original linking buttons (`Link digital release pages` and `Force link all web releases`) MUST NEVER alter `[img]...[/img]`, including placeholders. The user later explicitly requested integration of the separate Discography Merge function: only the manually triggered `Insert new releases` action may substitute catalog-matched FastPic URLs into `[img=right]ссылка[/img]` within **newly inserted** release blocks. Existing artwork, sources, tracklists and BBCode remain byte-for-byte unchanged; merge may update only an existing top-level spoiler title's numeric barcode when the incoming barcode differs exclusively by leading zeros. The previous rule against artwork changes still applies fully to the two source-linking modes.
- Preserve existing spoiler dates, names and other title text, tracklists, timestamps, existing concrete source URLs, unrelated BBCode and nested-spoiler boundaries.
- Rerunning either button must be idempotent. Report release-link counts and unresolved release titles; never report or manipulate artwork.
- Second button exactly `Force link all web releases` searches Deezer for every spoiler whose media label is `WEB` (plain or `[url=...]WEB[/url]`) or placeholder `CD/WEB`, including already linked releases. Exclude `CD`-only entries.
- **Mandatory permanent forced-mode search rule (user wording):** The script in forced mode should search Deezer for all WEB releases, even when they already have sources. Every WEB (including a Beatport-linked WEB, Deezer-linked WEB, tracker/redacted source, or unlinked WEB) must be included in the force scan. First try exact Deezer UPC/catalog/MusicBrainz resolution, and if no Deezer result, **always perform Deezer title-and-artist album search even when a barcode/catalog number exists**. Search candidates conservatively against title, primary artist, track count, date/year and first track; reject ambiguous results rather than guess. Never let an existing source or metadata identifier suppress the Deezer search. Force mode never substitutes Beatport for Deezer. CD-only items are excluded. On an unresolved match, leave the source unchanged.
- In force mode, replace the entire media/source portion of every resolved WEB entry with `WEB|[url=<verified Deezer album URL>]Deezer[/url]`; do not retain old redacted/tracker/source text or link the `WEB` label. This intentionally overrides the pre-1.1.21 forced source preservation rule; it does not change normal mode. For unresolved entries, keep the original entire source line untouched. CD-only entries remain excluded. For entries already linked to a Deezer album URL on `WEB`, if lookup returns no candidate, reuse that same validated Deezer album URL and normalize it to the source side without inventing a different album. Keep `[hr]` and all other BBCode.
- A hidden-by-default `Undo last link changes` button appears after changes, saving the exact previous textarea contents in memory, and restores it until another successful edit overwrites the snapshot. When a run makes no changes, preserve the previous undo snapshot.
- Both action buttons are disabled during an active scan; progress names the active mode and shows completed/total and final counts. The result text has screen-reader status semantics; both buttons are native keyboard-operable inputs.
- Discography topic-artist parsing now supports Russian `Дискография` in `[size=22]Skrillex | Дискография | Discography[/size]`, avoiding JavaScript ASCII `\\b` word boundary on Cyrillic. Parse `[none]`, `[n/a]`, `[unknown]` as absent catalog identifiers so their title and `- Single`/`- EP` suffix are stripped properly for a fallback search.
- RuTracker native UI integration and visible progress; no extra files or dependencies for the browser script.
- Preserve exact UPC normalization, exact catalog-number verification and conservative MusicBrainz release association. Do not insert guessed search matches.

## Regression coverage in v1.1.19
- v1.1.19 regression information retained below. See v1.1.20 section for the newer update.
- Mocked `GM_xmlhttpRequest` tested catalog `Lick It [UL3388]` via exact MusicBrainz release relation; barcode `Make It Bun Dem [075679961136]` via exact UPC; both filled cover placeholders with validated Deezer CDN URLs.
- Checked existing release source syntax, preservation of a linked entry, tracklist preservation and idempotent second run. Automated mock tests passed at publication, but live Deezer/MusicBrainz and RuTracker UI have NOT been verified.
- Actual two releases may resolve differently depending on provider data; any unresolved source stays in the Not found list. Do not assume the mock release IDs are real.

## Regression coverage in v1.1.20 (2026-10-08)
- Tested by dynamically compiling the entire updated userscript, then injecting mocks for the Deezer and MusicBrainz requests and RuTracker textarea UI.
- Seven WEB candidates plus one CD-only entry: plain WEB with redacted source; linked Beatport WEB with redacted source; linked Deezer on the source side with the wrong album ID; correct Deezer on the WEB label; CD-only skipped; catalog placeholder `Lick It [UL3388]`; metadata-only WEB release with `[none]`; unresolvable WEB release.
- Verified target UPC/catno API data was used to link, existing source credits preserved, wrong existing Deezer corrected, exactly two placeholder images filled, CD and unresolved content unchanged, country/topic-artist parsing, repeated force run idempotent, first button behavior unchanged, status totals, undo snapshot, accessible force button and live status.
- Mock test data (e.g. Deezer album IDs 123, 456 and 789) are synthetic, not claims about real release links. Browser/Tampermonkey and live external API verification remain pending.
- No separate userscript update checker; only Tampermonkey-native updates.

## Regression coverage in v1.1.21 (2026-10-08)
- Requested exact conversion tested: `[b]Носитель|Источник[/b]: [url=https://www.deezer.com/album/1345324]WEB[/url]|redacted.ch[hr]` becomes `[b]Носитель|Источник[/b]: WEB|[url=https://www.deezer.com/album/1345324]Deezer[/url][hr]` in forced mode.
- Additional mocked cases: fresh Deezer resolution replaces redacted/Beatport source, existing Deezer URL remains canonical on source side, missing-identifier existing Deezer URL is reformatted as fallback, CD-only and unresolved source untouched, regular button retains previous behavior, full BBCode tracklist preserved, progress and Undo retained, repeated forced run idempotent.
- Entire updated JavaScript successfully compiled and mocked regression checks passed. No browser-side user testing or live Deezer verification yet.
- Keep native Tampermonkey updates and version status. No added files, API permissions or UI elements.

## v1.1.22 - Unauthorized cover handling removed (2026-10-09)
- User expressly required immediate removal of all artwork features.
- Deleted `deezerCoverForReleaseUrl` (Deezer album cover lookup), `findCoverPlaceholder`, automatic cover lookup in the resolver, cover-source replacements in post BBCode, and cover-related counters/status labels.
- No changes to `@grant`/`@connect`, provider matching, force Deezer normalization, tracklist parsing, country flags, or Tampermonkey native update mechanism.
- Mocked both buttons with multiple releases including a real-looking image URL, `[img=right]ссылка[/img]`, existing Deezer WEB link, unresolved WEB, and CD-only. Both modes preserved every `[img]` tag byte-for-byte and still updated verified source links. Confirmed repeated-run idempotence, Undo availability and intact tracklist BBCode. Full script JavaScript compilation passed.
- All prior v1.1.19-1.1.21 cover-related test claims describe historical behavior ONLY, which is now explicitly prohibited. It must not be restored through other features/refactors.
- This update does not retroactively restore artwork already changed in a user's textarea by an earlier version. If a prior Undo snapshot is still available it may restore the previous text; otherwise original values require restoring from an earlier saved copy.
- Live RuTracker/Tampermonkey testing has not been performed. Status remains Under construction ⚠️.

## Regression coverage in v1.1.23 (2026-10-09)
- Fixed a branch that previously returned early when a release had a barcode or catalog but exact Deezer lookup failed. This prevented Deezer album-text searches for existing Beatport-linked WEB releases. Force-mode exact resolution now omits unnecessary Beatport fallback, and failure of the UPC/catalog path always proceeds to Deezer album metadata lookup.
- Verified with a fully compiled userscript and mocked Deezer responses: all 10 WEB releases (existing Beatport, existing Deezer, and existing tracker sources, all with catalog identifiers) triggered album searches, including unsuccessful ones. Two exact metadata matches linked to Deezer; unmatched existing sources retained; CD-only excluded; every BBCode image preserved byte-for-byte; original linking mode unchanged; UI displays WEB searched count; repeated runs idempotent; Undo retained.
- Do not generalize to all real Deezer catalog data: actual availability, result ranking, and live RuTracker UI still require user tests.
- The force button remains manual. Do not reintroduce image or cover operations.

## Release process
- Bump `@version` every change; keep `@name`, `@namespace`, `@updateURL` and `@downloadURL` stable.
- Commit updated script, fetch it at the resulting immutable commit SHA and verify content, update root README version/status and its commit-pinned install URL in a separate commit; do not use GitHub Actions.
- When installed version is unknown, direct users to Tampermonkey's native 'Check for userscript updates' rather than a reinstall-capable URL.

## Next QA
- In RuTracker editpost mode, test both 'Link digital release pages' and 'Force link all web releases' on the full Skrillex discography.
- Verify placeholder entries, Deezer/source accuracy, and absolutely no changes to any existing or placeholder artwork BBCode.
- Check one repeated click yields no new changes. Keep status Under construction until user confirms.


## v1.1.24 - Unified discography release workflow (2026-10-18)
- Absorbed the previous `browser-tools/rutracker-discography-merge/Discography_Merge.user.js` v0.1.1 functionality into this existing userscript while **preserving the RuTracker Digital Release Linker userscript identity**, stable source filename, `@updateURL` and `@downloadURL`.
- Unified into one compact dark toolbar on RuTracker's existing BBCode edit textarea: **Link digital release pages**, **Force link all web releases**, **Add new releases** (expands the only additional fields), and one context-sensitive **Undo**, plus a single live-status line and collapsible unresolved-items list. No new pages or nested menus.
- The third workflow accepts updated release BBCode and optional FastPic session URLs. It matches top-level dated release blocks by catalog number, inserts only catalog identifiers absent from the **original** post, sorts the additions chronologically, and preserves all existing release blocks, images, Deezer/YouTube URLs, typography, tracklists, source placeholders and unrelated BBCode byte-for-byte.
- Only new blocks may have `[img=right]ссылка[/img]` replaced by a direct FastPic cover URL. FastPic catalog names and direct image hashes must match; unresolved/missing covers retain their placeholders. No cover action in either linking mode.
- Shared Undo captures the exact before/after textarea strings, restores only the immediately preceding successful operation, and refuses if manual editing occurred since that operation. All long-running actions disable the action buttons and report progress/errors; editor-change guards prevent overwriting user edits during network requests.
- The former independent Discography Merge path was initially retained as v0.1.2 no-op, but **both files were deleted in v1.1.25 on explicit user request**, leaving one project folder. Installed old standalone Tampermonkey scripts must be manually disabled/removed because their former update URL now returns 404.
- Manual publishing: increment metadata `@version` for behavioral changes; commit and verify main source; README pinned install link must be updated in a separate commit. No GitHub Actions workflow changes.

### Unified UI control contract
| Control | Function, side effects, states and keyboard |
| --- | --- |
| Link digital release pages | Existing normal resolver; modifies verified source/flag fields, never artwork. Native button, hover/focus, disabled during work, click/Enter/Space. |
| Force link all web releases | Existing forced Deezer resolver, scanning all WEB even when sources exist; never artwork. Native button, focus, disabled during work. |
| Add new releases | Toggles two input fields; updates `aria-expanded`, focuses the updated BBCode on expansion. No post changes when toggled. |
| Updated BBCode textarea | Paste input for new release blocks; no persistence; disabled during a merge. |
| FastPic session URLs textarea | One or more HTTPS FastPic session links; optional when no artwork is available. Last text stored under userscript-specific Tampermonkey settings; invalid URLs show actionable error. |
| Insert new releases | Merges into the editor only after validation, matching, count and original-block preservation tests; error is non-destructive. Disabled while any active job runs. |
| Undo | Hidden until any operation changes the post; single cross-feature exact snapshot, refuses to overwrite manually edited text, then clears itself. |
| Live status / unresolved details | Accessible polite status with counts/errors; expandable list of not-found releases or missing covers. No invented matches. |

### Verification matrix
- **PASS - source/V8 parse:** v1.1.24 complete JS parsed with `new Function` after integrating the existing resolver and merge utility.
- **PASS - GIMS fixture regression:** user-provided original and updated BBCode yielded **58 newly added** releases, including `2016-04-29 - Zoum Zoum - Single [886445883039]` immediately following the 2015 album and carrying the exact catalog-matched FastPic URL. Every original spoiler body matched verbatim, including artwork and media links; second run inserted zero.
- **PASS - simulated RuTracker DOM:** toolbar injected once with all three actions; new-release field toggle showed correct `aria-expanded` and focused input; successful merge kept the existing block untouched; second operation was idempotent; shared Undo restored the original exactly; manual change after merge prevented unsafe Undo.
- **PASS - GitHub publication:** integrated source, metadata and immutable published contents fetched and verified.
- **NOT RUN - live browser:** Real Windows RuTracker edit page, Tampermonkey Chrome behavior, screenshots and side-by-side UI acceptance; hover/keyboard/resize with real browser; normal and force Deezer searches against live API.
- **NOT RUN - live FastPic:** Cross-origin fetch/captcha/hotlink response and real session-page parsing in Tampermonkey.
- **NOT RUN - independent userscript migration:** Confirm that an installed standalone v0.1.1 updates automatically to no-op v0.1.2. Advise manual disable if competing legacy control remains.
- Status stays **Under construction ⚠️** until the above native acceptance tests pass.

### Next action
Open a disposable RuTracker edit post in Chrome with Tampermonkey. Run all three actions, confirm source-only behavior and original-block integrity, inspect unified dark toolbar at small/large widths, test keyboard focus/Undo and native script updating, and compare actual screenshots against the previous RuTracker controls. Preserve provider resolution and MusicBrainz 503 retry behavior. 

## v1.1.25 - Duration sync, review highlights, one surviving project (2026-10-18)
- Source remains `browser-tools/rutracker-digital-release-linker/RuTracker_Digital_Release_Linker.user.js`. Version bumped from 1.1.24 to 1.1.25; original `@name`, `@namespace`, `@updateURL`, `@downloadURL` and linking functions remain unchanged. No GitHub Actions workflows changed.
- **Original post is base**. `Insert new releases` compares only dated top-level release spoiler identifiers, inserts missing dated releases chronologically, and changes only the original header's `[b]Общая продолжительность[/b]: HH:MM:SS` value when the pasted updated BBCode contains its own header value. The update is restricted to header content before the first spoiler; no individual track or release duration is changed. If an incoming header has a duration but the original header lacks the field, abort without editing. If the updated post has no total duration field, preserve the old value.
- When an original dated top-level release's catalog identifier is absent from the pasted updated post, list it as **Absent from updated post (kept)**. The original release is NEVER removed or rewritten. Such a warning indicates absence by identifier, not proven actual deletion (a changed identifier or incomplete incoming list may also cause it). Only user review resolves these differences.
- Within the same existing `Changes` disclosure render color-and-text-coded rows: `+` newly added release, `-` absent-from-updated original, `Duration old -> new`, and `?` missing cover. A warning-colored status and outlined expanded details emphasize absences. Nothing new appears on page load and no extra menu or destructive control was added. Text labels remain meaningful without color.
- A duration-only change is a successful edit and is Undoable via the same snapshot mechanism. Comparing identical content is idempotent. Old releases and their artwork, tracklists and Deezer/YouTube links remain byte-for-byte intact.
- **Repository consolidation:** Deleted `browser-tools/rutracker-discography-merge/Discography_Merge.user.js` and `browser-tools/rutracker-discography-merge/CONTINUITY.md`, thereby removing the empty old directory. This explicitly supersedes v1.1.24's earlier no-op updater-retention decision. Existing separate Tampermonkey installations cannot update from the now-removed old URL; users must disable/remove them manually. Do not recreate the directory.

### Control-contract delta and validation
- Existing **Insert new releases** action also synchronizes total duration and opens the existing Changes disclosure when a release is absent. Reuses existing labels, status, disclosure and shared Undo; **no added controls**.
- **PASS - GIMS regression:** 58 new releases; exact new FastPic cover for Zoum Zoum; existing eight top-level release blocks unchanged; header total changes `11:17:43 -> 13:24:31`; 4 original dated release identifiers absent from the updated BBCode flagged rather than deleted; rerunning inserts 0 and changes no text.
- **PASS - simulated editor UI:** one toolbar; three actions; expands and focuses input; duration+release merge; list highlights removed/absent titles; source artwork untouched; Undo restores exact previous text; duration-only edit and Undo; repeat idempotence.
- **PASS - repository:** confirmed old directory absent from `browser-tools`, current directory present; committed source read back; README entry updated with immutable SHA-pinned URL and verified.
- **NOT RUN - real host:** actual RuTracker/Chrome/Tampermonkey behavior, FastPic live fetching, Deezer and MusicBrainz live behavior, screenshots, resize/keyboard/hover and UX acceptance. Keep v1.1.25 Under construction ⚠️.

### Next step
Open a disposable RuTracker edit post with the new integrated userscript. Paste a full updated discography where one previous catalog is missing, verify warning row without deletion, verify the updated total duration, confirm original links/images unchanged, Undo, and test both original link actions. Disable/remove any previously installed standalone `Discography Merge` userscript to prevent competing injection. 

## v1.1.26 - Ignore numeric barcode padding in discography merge (2026-10-29)
- `Insert new releases` treats numeric identifiers with different leading-zero padding as the same barcode. Non-numeric catalog numbers still compare literally; e.g. `0ABC123` and `ABC123` remain distinct.
- When the existing and incoming numeric identifiers differ only by leading zeros, replace only the final `[barcode]` in the existing top-level spoiler title with the incoming spelling. Preserve the existing release date, title, artwork, source and tracklist. Do not insert a duplicate; do not falsely report the original as absent. Normal unrelated additions and total-duration updates still apply.
- User regression: `2006-05-05 - Impossible - Single [602498597736]` becomes `2006-05-05 - Impossible - Single [00602498597736]` in-place with one spoiler. Do not replace its original artwork or tracklist with placeholder data from the incoming BBCode.
- A barcode update is listed in the existing `Changes` disclosure and counted in the existing status line, with no new controls or clicks. Undo restores the entire original textarea.
- **PASS - Node 24 test runner:** `node browser-tools/rutracker-digital-release-linker/tests/merge-discography.test.cjs` - original-to-padded merge, preservation of existing release metadata, nonnumeric catalog exclusion, and different numeric barcode insertion. Red test reproduced the former duplicate before the change.
- **NOT RUN - target host:** real RuTracker editor, Tampermonkey/Chrome UI and Undo, actual FastPic, Deezer/MusicBrainz API, visual screenshots and native keyboard/resize acceptance. Status remains **Under construction ⚠️**.
- Next action: In a disposable RuTracker edit post, paste the provided Kanye West original and updated BBCode, run `Insert new releases`, confirm exactly one updated `Impossible` spoiler with the original image/source/tracklist, inspect the `Changes` disclosure and Undo, then test the two independent link actions.
