# MusicBrainz - Beatport Catalog Number Finder - Continuity

## Product and current checkpoint

- Version: **0.1.1 - Under construction ⚠️** (2026-10-14).
- Repository: `karpuzikov/userscripts`, branch `main`. Separate Tampermonkey script; **do not merge Beatport functionality into MusicBrainz ToolBox** or modify the existing Beatport -> MusicBrainz Importer.
- Canonical source: `musicbrainz-tools/beatport-catalog-number-finder/Beatport_Catalog_Number_Finder.user.js`.
- Tampermonkey update metadata: `musicbrainz-tools/beatport-catalog-number-finder/Beatport_Catalog_Number_Finder.meta.js`; versioned manual artifact: `musicbrainz-tools/beatport-catalog-number-finder/Beatport_Catalog_Number_Finder_v0.1.1.user.js`.
- Identity `MusicBrainz - Beatport Catalog Number Finder` / namespace `https://github.com/karpuzikov/userscripts`. Native Tampermonkey update only; immutable commit-pinned versioned README installer; no custom update notices.
- Mandatory rules: repository root `SOFTWARE_RULES.md`, `UI_UX_RULES.md`, `UI_UX_ACCEPTANCE.md`; UXDT guidelines. No project-specific RULES.md. Do not add GitHub Actions.
- Dependencies: Tampermonkey, MusicBrainz Web Service, public Beatport pages. No local files, build system, settings folder or credentials. Temporary cross-tab proposals use `GM_setValue`, key `karpuzikov:beatport-catno:pending:v1`, expire after 2 hours; scan caches are in memory.

## User-approved matching contract

1. On a MusicBrainz artist page, a manual `Scan artist releases` action paginates **all** release browse results at `/ws/2/release?artist=<MBID>&inc=labels+media+url-rels&fmt=json&limit=100&offset=<N>`. Page offset increases by the **actual** returned release count (MusicBrainz browse can cap a page at 500 tracks).
2. Filter to releases whose every medium is `Digital Media`. Collect existing catalog numbers across **all** digital editions before filtering the candidates.
3. Candidates must have **no** catalog number and at least one UPC/barcode or release-level Beatport URL. An explicit `[none]` is populated metadata and must not be overwritten.
4. With a barcode, search Beatport by barcode (and normalized form; title can be discovery fallback). A linked Beatport release is usable only when its actual UPC matches. Each discovered candidate is independently opened; accept only verified `__NEXT_DATA__.props.pageProps.release.upc` and `release.catalog_number` evidence. UPC-12 and EAN-13 leading-zero equivalence up to three zeros; no guess by title. Multiple UPC-verified matches are ambiguous, not auto-picked.
5. Without a barcode, require release-level Beatport links. Read linked pages directly and skip conflicting/missing catalog numbers.
6. Normalize catalog numbers by removing separator punctuation and comparing case-insensitively. If already present on another digital release of the scanned artist **or already queued in the current scan**, skip. This stricter rule is intentional even if distinct editions might legitimately share a catalog number.
7. Otherwise display a review item with release, catalog, Beatport evidence URL, UPC and label. `Review edit` stores a pending proposal and opens the MusicBrainz release editor; **never auto-submit** an edit.
8. On the editor, fill **only** one unique currently empty catalog field; do not overwrite other fields or change the label. Because the tool modifies an edit form, automatically preserve/append a concise Beatport evidence note and the **exact GitHub script URL** when a unique editable edit-note field is found. If the note field is missing or ambiguous, decline auto-fill and allow manual `Copy catalog` and `Copy edit note`. Preserve any existing note text. A user must review label/metadata and submit manually.

## UI/control contract and failure handling

- Artist-page floating dark panel: `Scan artist releases` (starts network work, disabled during scan), `Stop scan` (cancels Beatport request, preserves findings), `×` (hides without deleting progress), `♪ Beatport catnos` (reopens), progress/processed count, per-result `Review edit`, `Copy catalog`, evidence URLs, expandable Errors / limitations.
- Release-edit review: `Fill sole empty catalog field` (only unambiguous fields + edit-note), `Copy catalog`, `Copy edit note`, `×` Dismiss. All actions are explicit; only `Review edit` opens a new tab; no MusicBrainz edit is submitted.
- Buttons and links support keyboard and focus states; responsive dark layout; live status; malformed Beatport URLs rejected and text injected only with textContent. Real keyboard/focus/zoom/screenshot acceptance is **NOT RUN**.
- MusicBrainz requests are sequential and at least ~1150 ms apart; HTTP 503 retries indefinitely with Retry-After, >=5s otherwise; non-503 errors fail normally. Beatport metadata uses cross-origin GM_xmlhttpRequest, search and public `__NEXT_DATA__`; do not use authenticated/private APIs, invent UPC/catalog or auto-remove links. Network errors yield unverified results.

## Verification / known limitations (2026-10-14)

- Node.js syntax checks: **PASS** on 0.1.1 script and metadata.
- Local JS fixture/regression tests: **16 PASS**, covering UPC leading-zero equivalence and false positives, catalog normalization, URL sanitizing, Beatport JSON extraction, wrong-ID guard, duplicate releases, `[none]`, digital-format detection and edit-note source attribution.
- **NOT RUN:** Real Chrome + Tampermonkey artist scan, Beatport search/UPC search success, MusicBrainz browse inclusion of media/url-rels, real release editor DOM/edit-note mutation, screenshots, keyboard/focus/Escape, 200% zoom, persistence/restart, native updater/install experience. Source can be published for **testing only**, not called stable or UX-verified.
- Risks: Beatport public HTML search may not expose UPC-indexed releases; site hydration/field names can change or return bot-protection pages. Release Edit may have more than one catalog input or edit-note field; fail closed rather than modify an ambiguous form. Remote fetch does not prove actual user-browser compatibility.
- Testing to perform: barcode-only verified hit; linked Beatport + correct UPC; link/no UPC; wrong UPC; duplicate catalog; missing catalog; conflicting Beatport links; `[none]`; Stop; single/multiple label edit; existing edit note preserved and source link included; keyboard, zoom, UI screenshots. Document PASS/FAIL/NOT RUN and keep Under construction until user tests.
- **Next action:** Install/update via Tampermonkey native workflow, open a real artist on MusicBrainz, press `Scan artist releases`, and report screenshot + result/network errors. Fix observed blockers with a version bump; verify script/meta/README distribution after any change.
