# OLX - Model Tags - Continuity

## Product
- Version: 0.2.1 - Under construction ⚠️ (needs user testing in Tampermonkey on live olx.ua).
- Repository/branch: `karpuzikov/userscripts`, `main`.
- Script: `browser-tools/olx-model-tags/OLX_Model_Tags.user.js`. Tests: `node --test browser-tools/olx-model-tags/olx-model-tags.test.cjs`.
- Rules: root `SOFTWARE_RULES.md`, `UI_UX_RULES.md`, `DESIGN.md` (Karpuzikov design system). No project-specific rules file.
- Purpose: on olx.ua search results and ad pages, show the user's own tags under each ad title, let them add tags/model in place, mark ads broken, and filter search results by tags.

## User requirements (do not regress)
- Model detection from the ad title against models already in the database (e.g. `P2012Ht` in "Продається монітор Dell P2012Ht"); every ad of that model shows that model's tags.
- `+` button on every card and on the ad page: set/replace the ad's model (also adds a new model to the DB) and add a tag. With a model the tag goes to the model (all its ads); without one it goes to that ad only.
- Ads without model/make info get per-ad data (per-ad model or per-ad tags), keyed by OLX numeric ad ID.
- Universal "Broken" button next to `+`: toggles the per-ad `broken` tag. Broken ads are hidden on every search page by default; panel has `Show broken (N)`.
- Filter by one or more tags (AND), model names are filterable too. Active filters and panel state persist across pages.
- Per-tag 3-way switch in the panel: Hide (pixel mesh over the ad card, ad stays clickable, tag bar stays usable above the mesh) / Do nothing / Highlight (lime 3 px frame). Applies to search cards; model names have it too. Synced in the data file.
- Data lives in GitHub; first run pulls from GitHub, then works from the local cache; changes are uploaded.
- **OLX is strict with automated requests: the script must never send requests to OLX.** It only reads the already-open page DOM. Only `api.github.com` is contacted.

## Design
- Single userscript, `@run-at document-idle`, grants `GM_getValue/GM_setValue/GM_xmlhttpRequest/GM_addStyle`, `@connect api.github.com`.
- Data file: `browser-tools/olx-model-tags/olx-model-tags-data.json` in this repo (created on first save). Shape: `{ models: { NORMALIZEDKEY: { name, tags[] } }, ads: { "<adId>": { model, tags[] } }, tagDisplayModes: { "<tag>": "hide"|"highlight" } }` (missing = Do nothing).
- Model key = uppercase, Cyrillic look-alikes (А В Е К М Н О Р С Т Х У І) mapped to Latin, only `[0-9A-Z]` kept. Title detection = longest known key (≥4 chars) contained in the normalized title. A per-ad `model` overrides detection.
- Local storage (Tampermonkey, shared across olx.ua tabs): `olxModelTagsCachedData`, `olxModelTagsCachedAt`, `olxModelTagsPendingOperations`, `olxModelTagsGithubToken`, `olxModelTagsActiveFilters`, `olxModelTagsShowBrokenAds`, `olxModelTagsPanelExpanded`.
- Sync = operation log: each edit is an idempotent operation (`setAdModel`, `addTag`, `removeTag`, `setTagDisplayMode`) stored as pending, applied locally at once; 2 s after the last edit the script downloads the GitHub file, replays pending operations, PUTs it with the downloaded `sha` (retries up to 3 times on 409/422), then clears the uploaded operations. Edits from other devices are never overwritten. Without pending edits nothing is uploaded; on page load GitHub is only contacted when there is no cache or there are pending edits. The panel's sync icon pulls on demand.
- Token: GitHub fine-grained token with Contents read/write on `karpuzikov/userscripts`, asked via the panel's `Set GitHub token` button when an upload needs it. Reading works without a token (public repo).
- DOM: cards `[data-cy="l-card"][id]` (id = ad ID), title `[data-testid="ad-card-title"] h4`; bar inserted after `[data-testid="ad-card-title"]`. Ad page: title `[data-testid="offer_title"]`, ID from `[data-testid="ad-footer-bar-section"]` text `ID: <n>`. MutationObserver re-adds bars when React re-renders cards.
- UI: Karpuzikov dark tokens; Atkinson Hyperlegible Next → Inter font stack (fonts not loaded, local if installed). Equal padding on all sides; icon buttons borderless, text buttons bordered. Bar has `z-index:2` (OLX's title link otherwise covers it).

## Control contract
- Model chip (accent, mono): shows model, tooltip says if set for this ad or found in title. Not clickable.
- Tag chip × (icon): removes tag from the model (tooltip names the model: affects all its ads) or from this ad (dashed outline = ad-only tag).
- Broken chip (red, ⚠ text): shown when marked.
- Broken icon button (⚠): toggles broken; red when active.
- `+` icon button (0.2.1: existing chips stay visible while editing, their × hidden; editor replaces only the ⚠/+ buttons and stays open after Save for the next tag; Esc/× closes and refocuses +): opens editor in place: Model input (datalist of known models), Tag input (datalist of known tags; placeholder says where the tag goes), `Save` (Enter), × Cancel (Esc).
- Per-tag mode switch (3 icon buttons, aria-pressed, tooltips `Hide/Do nothing/Highlight: ads tagged "x"`): eye-off / minus / square. Active Hide/Highlight = lime fill, active Do nothing = grey fill.
- Card effects: `.olx-model-tags-meshed-ad::after` checker mesh z-index 1 (bar z-index 2 above it); `.olx-model-tags-highlighted-ad::before` lime frame z-index 3, pointer-events none (outline was covered by card children).
- Panel (fixed bottom-right): `Tag filters (n)` toggles the list; `shown/total` count; sync status (role=status; red ⚠ text on error); `Set GitHub token` on token errors; sync icon. Filter chips with counts toggle AND filters (✓ + lime when active). `Show broken (N)`, `Clear filters`.

## Tests and acceptance (2026-11-18)
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
