# OLX - Model Tags - Continuity

## Product
- Version: 0.5.1 - Under construction ⚠️ (needs user testing in Tampermonkey on live olx.ua).
- Repository/branch: `karpuzikov/userscripts`, `main`.
- Script: `browser-tools/olx-model-tags/OLX_Model_Tags.user.js`. Tests: `node --test browser-tools/olx-model-tags/olx-model-tags.test.cjs`.
- Rules: root `SOFTWARE_RULES.md`, `UI_UX_RULES.md`, `DESIGN.md` (Karpuzikov design system). No project-specific rules file.
- Purpose: on olx.ua search results and ad pages, show the user's own tags under each ad title, let them add tags/model in place, mark ads broken, and filter search results by tags.

## User requirements (do not regress)
- Model detection from the ad title against models already in the database (e.g. `P2012Ht` in "Продається монітор Dell P2012Ht"); every ad of that model shows that model's tags.
- `+` button on every card and on the ad page: set/replace the ad's model (also adds a new model to the DB) and add a tag. With a model the tag goes to the model (all its ads); without one it goes to that ad only.
- Ads without model/make info get per-ad data (per-ad model or per-ad tags), keyed by OLX numeric ad ID.
- Universal "Broken" button next to `+`: toggles the per-ad `broken` tag. Broken ads are hidden on every search page by default; panel has `Show broken (N)`.
- 0.4.0 Stop phrases: editable list (panel → `Stop phrases (N)` → chips with ×, input + Enter adds). Case-insensitive substring of the card title (search page) or title + description `[data-cy="ad_description"]` (ad page, open page only). A match = treated as broken (hidden unless `Show broken`, counted in it) and shows a red chip `⚠ «phrase»` on the ad. Synced as `data.stopPhrases` (lowercased); until first edit `DEFAULT_STOP_PHRASES` (UA + RU repair/parts/not-working words) apply. Ops `addStopPhrase` / `removeStopPhrase`.
- 0.5.1: a stop phrase found on the ad page (description/parameters - search cards only have the title) saves the ad's `broken` tag (synced), so search results hide it. Once per ad (local `olxModelTagsAutoBrokenAdIds`), so un-marking by hand sticks. Broken chip tooltip names the phrase.
- 0.5.0 Disliked brands: same editor as stop phrases (`Disliked brands (N)` button beside `Stop phrases (N)`; one list open at a time). Whole-word case-insensitive match (`\P{L}` boundaries: `lg` ≠ `LGA`, `hp` = `HP2035`) on the card title, or on the ad page title + parameters + description. Matched ads are hidden unless `Show disliked brands (N)`; red chip `⊘ brand`. Synced as `data.dislikedBrands` (default empty). Generic ops `addPhrase`/`removePhrase` with `listName` (`stopPhrases` | `dislikedBrands`); 0.4.0 `addStopPhrase`/`removeStopPhrase` still applied. Stop phrases now also match ad-page parameters.
- Filter by one or more tags (AND), model names are filterable too. Active filters and panel state persist across pages.
- Per-tag 3-way switch in the panel: Hide (pixel mesh over the ad card, ad stays clickable, tag bar stays usable above the mesh) / Do nothing / Highlight (lime 3 px frame). Applies to search cards; model names have it too. Synced in the data file.
- Data lives in GitHub; first run pulls from GitHub, then works from the local cache; changes are uploaded.
- **OLX is strict with automated requests: the script must never send requests to OLX.** It only reads the already-open page DOM. Only `api.github.com` is contacted.

## Design
- Single userscript, `@run-at document-idle`, grants `GM_getValue/GM_setValue/GM_xmlhttpRequest/GM_addStyle`, `@connect api.github.com`.
- Data file: `browser-tools/olx-model-tags/olx-model-tags-data.json` in this repo (created on first save). Shape: `{ models: { NORMALIZEDKEY: { name, tags[] } }, ads: { "<adId>": { model, tags[] } }, tagDisplayModes: { "<tag>": "hide"|"highlight" } }` (missing = Do nothing).
- Model key = uppercase, Cyrillic look-alikes (А В Е К М Н О Р С Т Х У І) mapped to Latin, only `[0-9A-Z]` kept. Title detection = longest known key (≥4 chars) contained in the normalized title. A per-ad `model` overrides detection.
- Local storage (Tampermonkey, shared across olx.ua tabs): `olxModelTagsCachedData`, `olxModelTagsCachedAt`, `olxModelTagsPendingOperations`, `olxModelTagsGithubToken`, `olxModelTagsActiveFilters`, `olxModelTagsShowBrokenAds`. Panel open state is in memory only (always starts collapsed).
- Sync = operation log: each edit is an idempotent operation (`setAdModel`, `addTag`, `removeTag`, `setTagDisplayMode`) stored as pending, applied locally at once; 2 s after the last edit the script downloads the GitHub file, replays pending operations, PUTs it with the downloaded `sha` (retries up to 3 times on 409/422), then clears the uploaded operations. Edits from other devices are never overwritten. Without pending edits nothing is uploaded; on page load GitHub is only contacted when there is no cache or there are pending edits. The panel's sync icon pulls on demand.
- Token: GitHub fine-grained token with Contents read/write on `karpuzikov/userscripts`, asked via the panel's `Set GitHub token` button when an upload needs it. Reading works without a token (public repo).
- DOM: cards `[data-cy="l-card"][id]` (id = ad ID), title = text of `[data-testid="card-title-link"]` (fallback its aria-label, then h4/h6; 0.3.3: user saw tags for ~0.5 s then 0 chips on 60 bars on `/monitory/q-1600-1200/` - suspected client re-render without `<h4>`, so title-detected models vanished; not confirmed live); bar inserted after `[data-testid="ad-card-title"]`. Ad page: title `[data-testid="offer_title"]`, ID from `[data-testid="ad-footer-bar-section"]` text `ID: <n>`. MutationObserver re-renders an ad when its bar is missing or the title it was rendered for (`bar.dataset.renderedTitle`) changed. 0.3.3: a 404 on the data file after a previous sync is an error, never an empty-data overwrite of the cache.
- UI: Karpuzikov dark tokens; Atkinson Hyperlegible Next → Inter font stack (fonts not loaded, local if installed). Equal padding on all sides; icon buttons borderless, text buttons bordered. Bar has `z-index:2` (OLX's title link otherwise covers it).

## Control contract
- Model chip (accent, mono): shows model, tooltip says if set for this ad or found in title. 0.3.1: × on a per-ad model removes it from the ad (title detection applies again); `setAdModel` deletes the previous model if it has no tags and no other ad uses it.
- Tag chip × (icon): removes tag from the model (tooltip names the model: affects all its ads) or from this ad (dashed outline = ad-only tag).
- Broken chip (red, ⚠ text): shown when marked.
- Broken icon button (⚠): toggles broken; red when active.
- `+` icon button (0.2.1: existing chips stay visible while editing, their × hidden; editor replaces only the ⚠/+ buttons and stays open after Save for the next tag; Esc/× closes and refocuses +): opens editor in place (0.3.1: Tag input first and focused, then `Model (optional)` - user typed a tag into the focused Model field on an ad without a model): Tag input (datalist of known tags; placeholder says where the tag goes), ✓ icon = save and close (0.3.2: replaced a `Save` text button the user found confusing because the editor stayed open after it), Enter = save and keep editor open for the next tag, × / Esc = discard and close. Inputs 140 px.
- Per-tag mode switch (3 icon buttons, aria-pressed, tooltips `Hide/Do nothing/Highlight: ads tagged "x"`): eye-off / minus / square. Active Hide/Highlight = lime fill, active Do nothing = grey fill.
- Card effects: `.olx-model-tags-meshed-ad::after` checker mesh z-index 1 (bar z-index 2 above it); `.olx-model-tags-highlighted-ad::before` lime frame z-index 3, pointer-events none (outline was covered by card children).
- Panel (fixed bottom-right), 0.3.0: collapsed by default to one 34 px tag icon button (user: panel must not sit on screen all the time); badge shows active filter count and ⚠ on sync error; click opens; × / Esc / click outside panel and tag bars closes. Open panel: `shown/total` count; sync status (role=status; red ⚠ text on error); `Set GitHub token` on token errors; sync icon. Filter chips with counts toggle AND filters (✓ + lime when active). `Show broken (N)`, `Clear filters`.

## Tests and acceptance (2026-11-18)
- 0.5.1: Playwright: ad page with description "…на запчастини…" → pending op addTag broken, chip `⚠ Broken`; unmark → stays unmarked, shows `⚠ «на запчастини»`. NOT RUN: live Tampermonkey.
- 0.5.0: unit 8/8; Playwright: adding `Samsung`, `LG` hides 1 more saved-page ad, chip `⊘ samsung`, `Show disliked brands (1)` reveals it (`qa-screenshots/brands.png`). NOT RUN: live Tampermonkey.
- 0.4.0: unit 7/7; Playwright: 5/40 saved-page ads hidden by default phrases, editor adds a phrase, matched ad shows `⚠ «под ремонт»` (`qa-screenshots/stop.png`). NOT RUN: live Tampermonkey.
- 0.3.5 ROOT CAUSE of "tags show ~0.5 s then vanish" (user: Dark Reader, uBlock Origin Lite, Stylus etc.): the script ran before OLX's React hydration; React adopted our `<div class=olx-model-tags-bar>` as its own badge `<div>` (user console: bar's innerHTML = OLX `Вживане` badge, 0 chips, class still ours). Fix: the bar is a custom element `<olx-model-tags-bar>`, which React never adopts. Do not go back to `<div>` for anything inserted inside OLX cards.
- 0.3.4: live olx.ua `/monitory/q-1600-1200/` in Claude built-in browser with the real GitHub data: 60 bars, 25 chips, stable for 3.5 s - script and data are fine there, while the user's browser shows 0 chips after ~0.5 s. Main suspect: two installed copies (separate GM storage, one empty, both render the same bars). Added guard: `<html data-olx-model-tags-running>`; a second copy dispatches `olx-model-tags-duplicate-install`, logs an error and stops; the first shows ⚠ `Installed twice in Tampermonkey: delete one copy`. Playwright: second injection keeps 14 chips and shows the error. NOT RUN: user confirmation.
- 0.3.3: Playwright: replacing every card `<h4>` with `<h6>` keeps model chips (2→2); changing a title re-renders its bar with the new model. User console on live page before fix: bars 60, chips 0, cards 61. NOT RUN: confirmation on the user's browser.
- 0.3.2: Playwright: Enter adds `A` and keeps editor open, ✓ adds `B` and closes (`qa-screenshots/editor2.png`).
- 0.3.1: unit 6/6. Data fix by hand: ad 940112664 had model `VGA` (meant as a tag) → model cleared, `VGA` added as ad tag, empty `VGA` model deleted.
- 0.3.0: live olx.ua check (Claude built-in browser, script injected by page eval with GM stubs, one page load): 40/40 bars rendered and survive React. Playwright: collapsed 34x34, opens, VGA filter → badge 1 after outside click closes (`qa-screenshots/panel-open.png`, `panel-collapsed-active.png`).
- 0.2.1: Playwright: 3 tags typed in a row (Enter, Enter, Esc) stay visible while editing (`qa-screenshots/chain.png`).
- 0.2.0: unit 5/5 pass; Playwright: Hide on `lot` meshes 1 card, Highlight on `P2012Ht` frames 2 cards (`qa-screenshots/modes.png`).
- Unit (0.1.0): 4/4 pass (Node 22): normalization, detection, idempotent operations/override, broken/filter matching, UTF-8 base64.
- Playwright Chromium, saved OLX pages (view-source copies the user uploaded, OLX external CSS missing, network blocked, GM_* stubbed, GitHub stubbed 404): 40/40 bars on the search page, broken ad hidden, editor typing + Enter saves, filter `1600x900` leaves 2 of 40, ad page bar shows model tags. Screenshots: `qa-screenshots/` (search, editor, filtered, ad2, search-narrow at 800 px).
- NOT RUN: Tampermonkey on live olx.ua; real GitHub upload/conflict; keyboard-only pass and zoom; mobile site (`m.olx.ua` not matched).

## Known limits
- Contents API inlines files ≤1 MB; past that the script reports an error (switch to the blob API).
- Substring model detection may mis-hit when a known model is a substring of another title token; the per-ad model fixes individual ads.
- Each upload is one commit on `main` of this repo.

## Next
- User installs, sets token, tests on live search and ad pages; then drop `Under construction ⚠️`.
