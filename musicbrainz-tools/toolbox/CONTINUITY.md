# MusicBrainz ToolBox - Continuity

Last reviewed: 2026-10-08
Current version: 1.0.57 - Under construction ⚠️ (pending browser verification)
Repository: `karpuzikov/userscripts`, branch `main`
Global rules: `/SOFTWARE_RULES.md`; no separate ToolBox `RULES.md` exists.

## Product, source, and distribution
- A single Tampermonkey userscript combining MusicBrainz editing helpers. Canonical executable source: `musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js`. Native update manifest: adjacent `MusicBrainz_ToolBox.meta.js`. Root `README.md` contains the current pinned installer reference.
- Keep userscript `@name`, `@namespace`, `@downloadURL`, `@updateURL`, and grants stable. Bump `@version` for every code change; mirror version to `.meta.js`, and repin README to a verified script-containing commit. Use Tampermonkey's native update check; no custom update checker.
- Preserve all merged modules: Disc ID auto-selection, cover-art removal, external-link removal, fill dates/worldwide release events, barcode/catalog search, tracklist-versus-recording, recording data to tracks, duplicate edit checking, barcode-versus-linked-release checking, safe recording matcher, linked-provider indicators and associated editing helpers. Never merge Beatport/BPTopTracker importer features into ToolBox.
- A global MusicBrainz request retry layer handles HTTP 503 indefinitely (honor Retry-After; >=5 seconds fallback). Do not bypass it in new requests.
- Browser dependencies: MusicBrainz release/editor UI and web service, Harmony, and Apple Music/Deezer/other public linked providers for applicable lookups. No separate build/install process besides Tampermonkey.
- Persistent state: Tampermonkey GM values (existing modules) and browser localStorage entries under `mb-barcode-link-checker:` for pending release edit tasks (temporary, 1-hour expiry). No local filesystem paths.

## Barcode vs linked releases checker
- Visible on MusicBrainz release-group pages by the Barcode column as "Check barcodes against links"; checks eligible Digital Media releases with barcodes and displays reviewable findings.
- Only treat provider GTIN/UPC as evidence when actually obtained from the linked provider or verified through Harmony; use `equalGtin` normalization. Reverse lookup results must confirm the barcode exactly.
- Do not silently remove unreadable/dead links; manual review is required. A lone provider mismatch may be ambiguous (possibly wrong MusicBrainz barcode) and must not force a change.
- Corrective actions: `replace-wrong-link`, `remove-duplicate-wrong-link`, `move-out`, and `move-in`. Reconcile linked URLs across releases in the same group and preserve the correct target before moving/removing a URL. Open prefilled MusicBrainz release edits for user review; do not submit edits automatically.
- Edit note contract (2026-10-08): the **cause** of removing a mismatched provider URL is the verified barcode difference, *not* the URL also existing on a different MusicBrainz release. For Deezer and any other supported provider, use `Barcode mismatch with <Provider> (MusicBrainz: <old>; <Provider>: <linked GTIN>).` with actual values from linked-page checks. Deduplicate repeated messages. Do not invent GTINs for unreadable providers. Keep other notes concise and include only the ToolBox script link as attribution; drop unrelated Harmony and Apple Music-method citations from the generated edit note. Do not add duplicate "added links" text when a replacement/move-in already accounts for them.
- User-reported regression before 1.0.56: v1.0.55 emitted "Removed a wrongly linked Deezer release URL. The same URL is already correctly linked to: ..." followed by three source URLs; this wrongly presented duplicate linkage as the justification. Fix specifically in `makeEditNote` within the checker module.

## UI, QA, and next steps
- Follow the entire UXDT guidelines tree relevant to clear content, accessible actions, errors, and feedback. Preserve existing group-page button, results panel, editable review flow and MusicBrainz-native status styling.
- Validate that both `.user.js` and `.meta.js` have identical version/identity/update URLs, that the README immutable installer points to that version, and that other ToolBox modules remain unchanged.
- Source-level regression tests: mismatched Deezer duplicate removal; matching provider replacement; move-out/move-in; no GTIN evidence fallback; barcode correction; no duplicate attribution/add lines; non-destructive behavior for ambiguous links.
- Browser validation is still needed on real MusicBrainz release-group and release-editor pages, including multi-release and barcode mismatch cases. User should run Tampermonkey **Check for userscript updates**, test notes, and report results. Keep `Under construction ⚠️` until confirmed.

## 2026-10-08 - v1.0.57 Recording data visibility fix
- User requests that the "Recording data" panel, including "Copy recording titles to tracks" and "Copy recording artist credits to tracks", **never appears** on `https://musicbrainz.org/release/*/edit-relationships` or the beta equivalent. This is a page-visibility issue, not a request to remove either function from release creation/editing.
- Root cause in v1.0.56: the Recording Data to Tracks module used the wide `/release/*/edit*` URL gate, which also matches `/edit-relationships`. The block inserted into an unrelated `#tracklist` element.
- v1.0.57 adds explicit exclusion URL patterns for standard and beta `/release/*/edit-relationships*` to **only the Recording Data to Tracks module gate**. Existing regular release `/edit` and `/add` page behavior remains unchanged. Avoid touching the adjacent Duplicate Edit Checker and all other ToolBox modules.
- The source version and `.meta.js` manifest are both 1.0.57. Native `@updateURL` and `@downloadURL` are unchanged. README needs an immutable pinned raw link containing this update.
- Automated validation: 10 mocked URL-routing cases passed (normal/beta relationship page, relationship query, normal/beta regular release edit, edit query, normal/beta add, unrelated release/release-group). JavaScript syntax passed; adjacent modules and userscript identity/update URLs remained unchanged. Browser runtime/UI still needs user verification.
- Next: Tampermonkey > Check for userscript updates. Refresh the relationship edit page and confirm no "Recording data" panel or copy buttons. Confirm both buttons still show on a normal `/release/<MBID>/edit` page. Retain "Under construction ⚠️" until tested.
