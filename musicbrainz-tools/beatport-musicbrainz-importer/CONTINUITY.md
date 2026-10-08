# Beatport - MusicBrainz Importer - Continuity

## Product / version / status
- Product: `Beatport - MusicBrainz Importer` Tampermonkey userscript.
- Repository: `karpuzikov/userscripts`, default branch `main`.
- Current development target: `1.2.17 - Under construction ⚠️` (requires live Beatport UI verification).
- Canonical source and Tampermonkey update endpoint: `musicbrainz-tools/beatport-musicbrainz-importer/Beatport_MusicBrainz_Importer.user.js`.
- Global rules: repository-root `SOFTWARE_RULES.md`. No separate project `RULES.md` exists.

## Purpose / behavior contracts
- Import release/track/label/artist data from Beatport and BPTopTracker to the MusicBrainz Add Release editor.
- Keep all existing release-source enrichment, ISRC recording matching, precise track ordering/verification, source URLs, barcode handling, shared ISRC-choice cache, related-entity links, and HTTP 503 unlimited retry behavior.
- On Beatport, offer three actions: Import to MusicBrainz, Search MusicBrainz, Submit ISRCs. Manual import alone may trigger costly lookups; do not autostart on page load.
- Preserve MusicBrainz release link/broken-chain indicators, exact-barcode matching, and Harmony missing-link destination. Preserve BPTopTracker 500 redirect, link indicators, and independent import controls.
- Do not change Beatport cover images, alter/remove artwork, or change art download/selection.
- Preserve `@name`, `@namespace`, grants and other Tampermonkey identity/permissions; rely on native @updateURL/@downloadURL, not a custom updater.
- All browser controls must remain keyboard-accessible and responsive and use Beatport-compatible dark styling.

## UI regression / repair - 2026-10-09
- User screenshot on Beatport's Kaskade/Skrillex `Lick It` release showed Import/Search buttons in the far-left gutter and Submit ISRCs isolated at the bottom of the page, with missing supplemental barcode/artist information.
- Cause in v1.2.16: UI anchor relied on obsoleted `ReleaseDetailCard-style__Controls/Info/Meta` class names, then fell back to `main.prepend(box)`, placing it in Beatport's outer page layout. Action buttons also copied CSS-module class hashes which may change.
- Repair target v1.2.17: position the compact self-styled action group relative to the release heading/details; no `main.prepend` fallback, no borrowed Beatport CSS-module button classes. Display barcode, release artists and status in the same anchored group; repair unmounted UI after Beatport SPA rerenders without duplicate controls.
- Keep the three actions together, visible without substantial empty space, at narrow viewports and zoom levels. Status must identify current work, and errors must be recoverable.
- No verified browser DOM access for the user's exact Beatport session; validate on the live release page after Tampermonkey native update.

## Architecture / dependencies / data
- Single userscript, no build step. The `www.beatport.com`, `musicbrainz.org/release/add`, and `bptoptracker.com` branches use location checks.
- Native browser JS and Tampermonkey `GM_getValue`, `GM_setValue`, `GM_xmlhttpRequest`; uses MusicBrainz, Beatport, Apple Music, Harmony, GitHub shared cache endpoints and MagicISRC.
- Durable choices and pending import state are in Tampermonkey storage, e.g. `mb-recording-matcher:isrc-choice:v1` and `beatport-mb-importer:pending:v1`. Never reset these on UI repair.
- Use global `SOFTWARE_RULES.md` as product rules, including UXDT, version/status, 503 retries, README pinned-install-link publishing workflow.

## Tests / release verification
- Validate JavaScript syntax and unchanged non-UI import functionality via diff/static checks.
- Manual browser tests required: Beatport release hero position, status and metadata, all three actions, CSS scoping, release navigation and SPA rerender, narrow viewport/zoom/keyboard, MB Add Release editor and BPTopTracker.
- Version remains `Under construction ⚠️` until user reports testing complete.
- Publish: commit changed userscript with increased @version; verify immutable raw file; then update README pinned install URL in a separate commit; do not provide direct install URL when installed version is unknown.
