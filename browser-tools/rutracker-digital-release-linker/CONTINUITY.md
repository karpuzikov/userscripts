# RuTracker Digital Release Linker - Continuity

## Product
- Version: 1.1.19 - Under construction ⚠️ (needs user testing in Tampermonkey).
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
- Rerunning the button must be idempotent. Report linked and artwork counts, and show unresolved release titles.
- RuTracker native UI integration and visible progress; no extra files or dependencies for the browser script.
- Preserve exact UPC normalization, exact catalog-number verification and conservative MusicBrainz release association. Do not insert guessed search matches.

## Regression coverage in v1.1.19
- Mocked `GM_xmlhttpRequest` tested catalog `Lick It [UL3388]` via exact MusicBrainz release relation; barcode `Make It Bun Dem [075679961136]` via exact UPC; both filled cover placeholders with validated Deezer CDN URLs.
- Checked existing release source syntax, preservation of a linked entry, tracklist preservation and idempotent second run. Automated mock tests passed at publication, but live Deezer/MusicBrainz and RuTracker UI have NOT been verified.
- Actual two releases may resolve differently depending on provider data; any unresolved source stays in the Not found list. Do not assume the mock release IDs are real.

## Release process
- Bump `@version` every change; keep `@name`, `@namespace`, `@updateURL` and `@downloadURL` stable.
- Commit updated script, fetch it at the resulting immutable commit SHA and verify content, update root README version/status and its commit-pinned install URL in a separate commit; do not use GitHub Actions.
- When installed version is unknown, direct users to Tampermonkey's native 'Check for userscript updates' rather than a reinstall-capable URL.

## Next QA
- In RuTracker editpost mode, press 'Link digital release pages' on the full Skrillex discography.
- Verify both requested placeholder entries, remaining placeholder entries, source/cover accuracy, and absence of unintended changes.
- Check one repeated click yields no new changes. Keep status Under construction until user confirms.
