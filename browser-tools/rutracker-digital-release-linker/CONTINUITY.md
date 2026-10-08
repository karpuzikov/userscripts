# RuTracker Digital Release Linker - Continuity

## Product
- Version: 1.1.20 - Under construction ⚠️ (needs user testing in Tampermonkey).
- Repository: `karpuzikov/userscripts`, branch `main`.
- Main file: `browser-tools/rutracker-digital-release-linker/RuTracker_Digital_Release_Linker.user.js`.
- Applicable rules: repository-root `SOFTWARE_RULES.md`. No project-specific `RULES.md` currently exists.
- Purpose: On RuTracker post editor `posting.php?mode=editpost`, find exact digital release links for discography BBCode and mark the header's country flag. Manual button; no automatic edits on page load.

## Design and dependencies
- Single Tampermonkey userscript, `@grant GM_xmlhttpRequest`, `@connect api.deezer.com` and `@connect musicbrainz.org`.
- Native Tampermonkey updates: clean main-branch `@updateURL` and `@downloadURL`; stable script identity; no custom update checker. Do not change or move the stable userscript source filename.
- No extra local persistent storage. Caches live in memory per page.
- Existing exact UPC/catalog lookups through Deezer and MusicBrainz, MusicBrainz page fallbacks to Deezer/Beatport, and country emoji support remain operational.
- MusicBrainz HTTP 503 must retry without an attempt limit, respecting `Retry-After` and waiting at least 5 seconds without one; rate limit MB requests and avoid unrelated network changes.

## Important contracts
- Recognize both old source BBCode formats and unfilled `CD/WEB|[url=ссылкаНаИсточник]Источник[/url]` placeholders.
- Convert confirmed matches to `WEB|[url=<exact page>]Deezer[/url]` or `WEB|[url=<exact page>]Beatport[/url]`. Unverified or unmatched releases retain their original data.
- For matched Deezer albums, fill an unfilled `[img=right]ссылка[/img]` cover with the Deezer API cover URL if available; never overwrite actual existing image links. Beatport-only cover lookup is not implemented; leave placeholders untouched rather than inventing an image.
- Preserve spoiler titles, tracklists, timestamps, existing concrete source URLs, unrelated BBCode and nested-spoiler boundaries.
- Rerunning either button must be idempotent. Report linked and artwork counts, and show unresolved release titles.
- Second button exactly `Force link all web releases` searches Deezer for every spoiler whose media label is `WEB` (plain or `[url=...]WEB[/url]`) or placeholder `CD/WEB`, including already linked releases. Exclude `CD`-only entries.
- In force mode, search UPC and catalog via the existing validated resolver; ignore Beatport-only resolutions. If there is no identifier, make a conservative Deezer album search using topic artist, release title, exact track count, year and first track; reject ambiguous matches. If no confirmed Deezer result, do not modify the source.
- For force-mode matches with `WEB|Deezer` or `WEB|[url=...]Deezer[/url]`, update the Deezer URL. For WEB entries with redacted/tracker or other existing source text, put the verified Deezer URL on the WEB media label as `[url=...]WEB[/url]` and retain the right-hand source untouched. For `CD/WEB|[url=...]Источник[/url]`, normalize to `WEB|[url=...]Deezer[/url]`.
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

## Release process
- Bump `@version` every change; keep `@name`, `@namespace`, `@updateURL` and `@downloadURL` stable.
- Commit updated script, fetch it at the resulting immutable commit SHA and verify content, update root README version/status and its commit-pinned install URL in a separate commit; do not use GitHub Actions.
- When installed version is unknown, direct users to Tampermonkey's native 'Check for userscript updates' rather than a reinstall-capable URL.

## Next QA
- In RuTracker editpost mode, test both 'Link digital release pages' and 'Force link all web releases' on the full Skrillex discography.
- Verify both requested placeholder entries, remaining placeholder entries, source/cover accuracy, and absence of unintended changes.
- Check one repeated click yields no new changes. Keep status Under construction until user confirms.
