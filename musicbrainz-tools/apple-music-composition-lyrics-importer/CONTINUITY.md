# Apple Music works credits -> MusicBrainz - CONTINUITY

## Project and status
- Purpose: Tampermonkey script for importing supported Apple Music song credits as MusicBrainz Recording, Work, and Release relationships in the MusicBrainz release relationship editor.
- Current version: **2.3.18 - Under construction ⚠️**. Runtime testing in the target browser is still required.
- Repository: `karpuzikov/userscripts`, default branch `main`.
- Canonical source: `musicbrainz-tools/apple-music-composition-lyrics-importer/MusicBrainz_Apple_Music_Composition_Lyrics_Importer.user.js`.
- Userscript metadata: `@version 2.3.18`, matching in-panel `SCRIPT_VERSION = '2.3.18'`.
- Read the root `SOFTWARE_RULES.md` and current relevant UXDT guidance before modifying the UI. No separate project RULES.md was present at the 2026-10-08 preflight.

## Host, architecture, dependencies
- Runs in Tampermonkey on `https://musicbrainz.org/release/*/edit-relationships` and the beta equivalent.
- Single `.user.js` script; no build system or separate runtime dependencies.
- Uses `unsafeWindow.MB.relationshipEditor` state and dispatch, MusicBrainz Web Service, `GM_xmlhttpRequest`, Apple HTML `#serialized-server-data`, and Apple catalog API fallback.
- Script handles MusicBrainz HTTP 503 retries centrally. Respect the mandatory unlimited 503 retry rule when changing its network code.
- No separately managed persistent files or credentials. Apple API bearer token is retrieved dynamically as needed, in memory.

## Supported workflows
1. **Automatic album import (original functionality):** Leave the song URL empty, select **Load Apple Music credits**. Determine the correct Apple Music album from MusicBrainz Apple links and barcode verification, or look up the MusicBrainz barcode in Apple Music. Read album tracks and their corresponding Apple song pages. Keep strict position + normalized-title matching.
2. **Manual single-song import (introduced v2.3.13):** Paste a URL such as `https://music.apple.com/us/song/vai-sentando-feat-skrillex-duki/1685732274` into **Apple Music song URL (optional - import this song only)** on the MusicBrainz release relationship editor, then choose **Load Apple Music credits**. Only the specified Apple song is read and matched to a MusicBrainz track. No barcode match is required in this mode.
3. Manual song URL validation accepts only `https://music.apple.com/<two-letter-storefront>/song/<slug>/<numeric-id>`. Resolve the exact song ID from Apple HTML; if track metadata is absent, use the Apple songs-by-ID catalog API. Reject redirect to a different song ID.
4. Match a song to the currently open MusicBrainz release by normalized title, ignoring trailing featured-artist suffixes. If more than one title match exists, use disc and track position **only** if exactly one match shares the position. Block ambiguous or mismatched songs; never import to a guessed recording.
5. Convert supported Apple Music credits to MusicBrainz relation types. Songwriter/composer/lyricist credits target Work; performer/producer/mixer/etc. target Recording; mastering targets Release. Unsupported roles are shown but skipped.
6. Existing linked Works are reused. Search credited authors for exact-title Works; link a single unambiguous Work automatically through MusicBrainz's recording-of relationship type 278 rather than creating a duplicate. If none is found and all authors are resolved, stage a new Work. If some authors are unresolved, additionally perform a complete MusicBrainz exact-title Work search: create only when that search returns no matches. If multiple/ambiguous/partial Work matches exist, block automatic Work creation. Use Work type Song, with user-selected lyrics language. Matched writer/lyricist credits are staged when the user clicks Apply matched credits; unmatched artists remain skipped.
7. Artist matching prioritizes release/track credited artists, aliases and related artists; global MusicBrainz artist search is fallback. Unique exact name/alias matches and unique preferred context results are selected automatically. **Unresolved or ambiguous artist names are skipped by default and never block other relationships.** A user may optionally map a skipped name with a candidate or valid manual MBID. Explicitly malformed manual MBIDs still fail validation. Preserve existing relationship edits/edit notes, append source/script attribution, and do not auto-submit the MusicBrainz edit.
8. Skip duplicates/already existing relationships. MusicBrainz HTTP 503 requests must retry indefinitely with applicable retry delays.

## UI and usability
- Inline panel above the existing MusicBrainz relationship editor form; dark theme, keyboard-focusable controls, explicit song URL label and help, ARIA live status. The Apple Music song URL label is on its own full-width row, input and button reflow/wrap, and hints have positive margins; **do not restore the former -4px negative-margin overlap**.
- Both song and album workflows share tracks/credits, optional artist mapping and the **Apply matched credits** button. The artist-mapping table is collapsed inside a keyboard-operable `<details>` element by default, with auto-matched/skipped artist counts. Default option on every artist row is **Skip this credit (no verified artist)**. Unresolved people never require a choice; skipped relationship counts appear after applying.
- Status shows current network/lookup stage and final counts. Show mismatches visibly and block unsafe writes.
- Preserve role mapping, work-resolution review and the existing user-facing wording unless needed for clarity.
- UXDT full guideline tree is mandatory; relevant sections reviewed on 2026-10-08 included task orientation, forms/data entry, accessibility/feedback, and learnability.

## Distribution and version policy
- Publish as a version-bumped userscript; Tampermonkey updates via the script's @downloadURL and @updateURL. Do not add a custom updater.
- After changing the source, update README's version label and this document. Keep the actual numeric version alongside **Under construction ⚠️**.
- Installed-version state is not known; prefer Tampermonkey's native **Check for userscript updates** to avoid a same-version Reinstall prompt.
- Do not share commit URLs or direct installer URLs when installed version is unknown.

## Validation at v2.3.14 checkpoint
- Static JavaScript syntax parsing passed for v2.3.14; new `@version` and visible `SCRIPT_VERSION` agree.
- Isolated tests passed for the user's direct song URL, spoofed host rejection, album-URL rejection, featured-artist title normalization, correct unique MusicBrainz song match, wrong-song rejection, repeated-title ambiguity rejection, and exact disc/track disambiguation.
- Confirmed the edit-note invocation remains in load/apply workflow.
- v2.3.14 isolated matching tests passed: missing artist (including Apple's `Fast & Furious: The Fast Saga` example) skipped; unique exact artist automatically selected; ambiguous and fuzzy-only matches skipped. Isolated mocked Apply integration successfully staged a matched Skrillex credit without attempting to map the unresolved Fast & Furious name; final result counted skipped credits. Explicit invalid manual MBID produced a validation error. No live Tampermonkey browser end-to-end test is available.

## Open testing / next steps
1. In Tampermonkey, run the native update check, reload MusicBrainz release editor for `3f013c5b-89a0-472f-b672-da5cb66a07a7`, paste `https://music.apple.com/us/song/vai-sentando-feat-skrillex-duki/1685732274`, and click **Load Apple Music credits**.
2. Verify only "Vai sentando" is in the preview; **Fast & Furious: The Fast Saga** should be skipped without any required user action if it is not uniquely resolved. Applying stages all verified mapped credits and counts omitted credits; it must never auto-submit.
3. Re-test the blank-URL full-album path for backward compatibility, duplicates, missing Work cases, keyboard/focus behavior, zoom/reflow and MusicBrainz 503 retries.
4. If Apple removes or alters `#serialized-server-data`, adapt song-credit extraction with a verified new source. Never fabricate credits or silently change the target recording.

## 2026-10-08 - v2.3.14 issue and resolution
- User reported `Choose a MusicBrainz artist for "Fast & Furious: The Fast Saga".` when importing credits from the user's direct Apple Music song URL.
- Source: Apple Music visibly lists the franchise name among the song's associated artists, but it must not force manual MusicBrainz artist selection.
- Previous `applyCredits` rejected every empty artist selector before processing relationships, aborting all otherwise valid mappings.
- Current approach: automatically skip unselected artist names, report people and skipped credit counts, do not stage aliases for skipped people, continue staging matched credits. If no people are mapped, clearly report that zero credits were staged.
- Keep the automatically selected mapping policy limited to preferred context choices or exactly one precise name/alias match; ambiguous/fuzzy candidates remain unselected.
- Repository distribution uses immutable commit-pinned README link and clean main-branch `@updateURL`/`@downloadURL`. Users should update via Tampermonkey rather than click an installer link when installed version is unknown.
- Follow-up browser regression: verify optional mapping table, Apply button while all artists unmatched, accessibility and narrow viewport; check artist alias edits remain correct and do not become mandatory.

## 2026-10-08 - v2.3.15 Work resolution and UI checkpoint
- User asked why Works were not created with credits after reporting overlapping controls.
- Root causes in v2.3.14: unresolved songwriter blocked `ensureWorkForRow`; any author-matched Work candidate blocked both reuse and creation; created Works obtained author relationships only later when Apply matched credits ran. Screenshot showed load at track 13/21, before Work resolution starts.
- v2.3.15 links a uniquely author-matched existing Work to the recording (type 278) and reuses it for writer credits. No duplicate Work is staged for ambiguous matches.
- If authors are unresolved and no author-matched Works are found, use `searchExistingWorksByExactTitle` via MusicBrainz work search; stage a new Song Work only on an exhaustive empty exact-title result. If the title search has matching Works or incomplete result pagination, do not create a duplicate.
- `getTrackWorks` recognizes Work relationships pointing to either the source or target endpoint.
- Work creation remains part of the **Load Apple Music credits** phase (after all track credits have loaded). Writer/lyricist relationships are staged on the subsequent **Apply matched credits** action for artists with verified mapping; names without verified MusicBrainz artists are intentionally skipped, not fabricated.
- UI: song-URL label takes a full flex row, input/button can wrap, help text margin is nonnegative.
- Validation: syntax parse passed; mocked tests passed for 8 Work scenarios (existing, unique Work, new Work, unresolved author with no matching title, title duplicate, ambiguous, partial authors, incomplete query). Additional isolated tests passed for actual unique candidate linking and exact-title response filtering. Immutable pinned script verified with metadata version 2.3.15 and README install link updated.
- NOT verified in a live MusicBrainz relationship editor; browser test required for a full release: selected Work dialog, relationships applied/staged, correct author credits, page zoom/reflow.
- Next action: In Tampermonkey, Check for userscript updates, reload a release edit-relationships page, import Apple Music credits, observe Work-status text in the track list, and verify the resulting staged Works and author relationships after Apply matched credits before submitting.

## 2026-10-08 - v2.3.16 browser-bridge diagnosis and optimization
- User provided v0.1.0 Browser Debug Bridge capture for MusicBrainz release `598011bd-7dc8-493a-9ece-0d465752137b` (FAST X soundtrack). At 15:02:22Z the process was **still checking existing Works for "The End of the Road Begins (intro)"**, with "Load Apple Music credits" disabled, no Work result rows yet, and seven HTTP 503 responses since monitoring began. This was an incomplete run, not proof of 0 new Works.
- MusicBrainz official API docs: Web Service clients should stay at <=1 request/s; 503 can mean per-IP or global rate limits. WorkSearch supports `arid` (related artist MBID) and `work` (title) fields; combine them for targeted lookup.
- v2.3.15 fetched *all* Works for every resolved credited author and filtered by track title locally, which scales poorly for prolific authors. v2.3.16 uses `work:"<escaped title>" AND arid:<artist MBID>`, pages all matches, filters exact normalized titles, caches by artist/title, and aborts creation if WorkSearch result coverage is incomplete. Preserve author-first matching, strict unambiguous reuse, no guessing or duplicate staging.
- Increase MusicBrainz Web Service minimum request interval from 1200ms to 1700ms; retain centralized queue and 503 retry forever. On repeated 503 use 5s, 10s, 20s, 40s, then 60s backoff (or a longer Retry-After response), displaying the attempt number, delay, and recovery in the script status area and consequently Browser Debug Bridge diagnostics.
- Version/source: `MusicBrainz_Apple_Music_Composition_Lyrics_Importer.user.js` now `@version 2.3.16` and matching `SCRIPT_VERSION`. Keep full-album/single-track, mappings, relationship staging, no autosubmit, and native Tampermonkey update URLs unchanged.
- Source parse passed. Isolated tests passed for exact author/title query, cached result, genuine empty result, incomplete search blocking, pagination + exact filtering, two sequential 503 retries/recovery, and Retry-After precedence. Tests used mocks, not live MusicBrainz requests.
- Known unknown: the uploaded capture was taken mid-import. It cannot establish whether work creation finishes later; need a *final-state* capture on v2.3.16 (success/error, tracks Work statuses, staged relationships), and a real Chrome browser run. Keep **Under construction ⚠️**.
- Next action: Tampermonkey -> Check for userscript updates; reload the MusicBrainz edit-relationships page, start Browser Debug Bridge, click Load Apple Music credits, wait for a final result, then export a new report and screenshot. If Work search has incomplete results or unresolved authors, report the precise per-track reason rather than guessing.

## 2026-10-08 - v2.3.17/2.3.18 browser bridge follow-up

- v2.3.16 test on `https://musicbrainz.org/release/598011bd-7dc8-493a-9ece-0d465752137b/edit-relationships` still showed the Load button disabled, no track-result rows, and the status `MusicBrainz artist context lookup 04cfda88-7f8d-4f2b-9582-565d5f774bdb: HTTP 503; retry 1 in 5s...` at 15:12:31Z (five HTTP 503s were recorded). This capture was *mid-run*; no final Work count is proven. Screenshot showed MusicBrainz native relationships, but no newly staged Works.
- Root cause: even v2.3.16's title-scoped artist WorkSearch still first called `findContextArtistCandidates` for each Apple songwriter, loading many /ws/2/artist/:id documents, which may repeatedly 503 on MusicBrainz; meanwhile the Work-result table was withheld until all tracks finished.
- Work resolution **now starts with a complete global MusicBrainz Work title search**, before any artist lookup. On a complete *empty* exact-title result and actual Work author credits, stage a Song Work using the existing editor flow (first Work prompts for lyrics language); unmapped songwriter names do not block this stage. Where exact-title Works already exist, look at those candidates' `/ws/2/work/:id?inc=artist-rels` to verify exact credited author names: reuse the unique author-matched existing Work, never auto-create a duplicate or guess which Work to attach if ambiguous. If more than eight existing same-title Works, require manual review rather than issuing many requests.
- Preserve MusicBrainz HTTP 503 unlimited retries and 1.7s Web Service spacing. `searchExistingWorksByExactTitle` now pages all results; incomplete or invalid result sets block automatic Work creation. On another title in the same album, reuse the search cache; clear its cache along with central WS cache at the start of a new Load.
- v2.3.18 additionally prevents creating a *second staged Work of the same title* on one editor page/run. If a staged Work already exists, annotate the track for manual review of its recording relationship rather than inventing an automatic match. Clear in-memory `stagedWorkTitles` on a new import, but also check existing MusicBrainz temporary Work state to prevent repeats.
- Track table renders before Work resolution begins and updates after each completed Work check, so the Browser Debug Bridge can capture partial results. Its status message reports Works checked, staged new Works, and existing Works linked. Artist-credit mapping is performed afterward; failed name mapping remains skippable and does not control Work creation. `Apply matched credits` still stages mapped writer/producer credits and does **not** auto-submit.
- v2.3.17 tested eight isolated mock scenarios: no-title-match with unresolved writer -> new Work, unique verified author -> reuse, ambiguous same-title -> blocked, linked Work -> reused, search failure -> no creation, cached title search, author relationship verification, >8 candidates -> manual. v2.3.18 parsed successfully and passed additional guard checks for staged same-title repeat and cache reset. These are *mocked/source tests*, not end-to-end Chrome tests.
- Distribution target version: **2.3.18 - Under construction ⚠️**; preserve @name, @namespace, @updateURL, @downloadURL and grants. Update the README immutable pinned version link to this source revision. No custom updater.
- Next test: Tampermonkey -> Check for userscript updates. On the same FAST X MusicBrainz edit-relationships page, start the Browser Debug Bridge, trigger Load Apple Music credits, wait for a final state (or capture partial status after 3 minutes), and export JSON/screenshot. Inspect all 21 track rows, staged Song Works, Work author-credit relationships after Apply, and remaining 503 errors. Do **not** claim the issue fixed until this live test completes. Keep v2.3.18 Under construction.
