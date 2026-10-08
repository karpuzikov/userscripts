# Apple Music works credits -> MusicBrainz - CONTINUITY

## Project and status
- Purpose: Tampermonkey script for importing supported Apple Music song credits as MusicBrainz Recording, Work, and Release relationships in the MusicBrainz release relationship editor.
- Current version: **2.3.14 - Under construction ⚠️**. Runtime testing in the target browser is still required.
- Repository: `karpuzikov/userscripts`, default branch `main`.
- Canonical source: `musicbrainz-tools/apple-music-composition-lyrics-importer/MusicBrainz_Apple_Music_Composition_Lyrics_Importer.user.js`.
- Userscript metadata: `@version 2.3.14`, matching in-panel `SCRIPT_VERSION = '2.3.14'`.
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
6. Resolve existing linked Work and search for credited-author Works before staging new Works; when creating new Works use the MusicBrainz Work type Song with user-selected lyrics language.
7. Artist matching prioritizes release/track credited artists, aliases and related artists; global MusicBrainz artist search is fallback. Unique exact name/alias matches and unique preferred context results are selected automatically. **Unresolved or ambiguous artist names are skipped by default and never block other relationships.** A user may optionally map a skipped name with a candidate or valid manual MBID. Explicitly malformed manual MBIDs still fail validation. Preserve existing relationship edits/edit notes, append source/script attribution, and do not auto-submit the MusicBrainz edit.
8. Skip duplicates/already existing relationships. MusicBrainz HTTP 503 requests must retry indefinitely with applicable retry delays.

## UI and usability
- Inline panel above the existing MusicBrainz relationship editor form; dark theme, keyboard-focusable controls, explicit song URL label and help, ARIA live status.
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
