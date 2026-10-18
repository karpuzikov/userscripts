# Discography Merge - Continuity

## Project and status
- Product: Discography Merge, a Tampermonkey helper for RuTracker discography posts.
- Repository: `karpuzikov/userscripts`, active branch `main`.
- Version: **0.1.1 - Under construction ⚠️** (not yet accepted in a real RuTracker + Tampermonkey browser session).
- Canonical stable source: `browser-tools/rutracker-discography-merge/Discography_Merge.user.js`.
- Metadata identity: `@name Discography Merge`; `@namespace https://github.com/karpuzikov/userscripts`.
- Required parent rules: repository-root `SOFTWARE_RULES.md`, `UI_UX_RULES.md`, and `UI_UX_ACCEPTANCE.md`.

## Purpose and behavioral contract
- Operate only on `https://rutracker.org/forum/posting.php?mode=editpost&...`, with the exact editor textarea `#post-textarea`.
- Read the current editor as the ORIGINAL BBCode; never replace entire releases with alternate versions.
- User pastes the UPDATED BBCode in the injected panel and provides one or more FastPic session URLs.
- Match incoming dated, top-level `[spoiler="YYYY-MM-DD - Title [catalog]"]` release blocks against existing ones using bracketed release/catalog identifiers; insert only genuinely NEW releases in chronological order.
- For a NEW block only, replace exactly `[img=right]ссылка[/img]` with its FastPic direct image URL if an unambiguous catalog match is available. Preserve all other BBCode verbatim, including `[url=...]` placeholders, Deezer and YouTube links, tracklists, spelling, and metadata.
- All ORIGINAL release blocks must remain byte-for-byte identical; perform a post-merge block-preservation safety check and refuse malformed/unsorted originals.
- FastPic cover mapping uses filename labels (catalog numbers), image hashes, and the direct-image URL text area; do not assign covers by gallery order alone. Reject conflicting mappings.
- Unknown covers keep their placeholder. Duplicate merges are idempotent (no additions on second run).
- Changes remain local to the edit textarea until the user submits the forum post. Undo restores the prior textarea only when it has not been manually changed since the merge.
- Scope and privileges: HTTPS RuTracker posting page; `GM_xmlhttpRequest` restricted by `@connect` to fastpic.org and www.fastpic.org; `GM_getValue/GM_setValue` remembers session URLs. No other storage, external analytics, or auto-posting.
- Current `@updateURL` and `@downloadURL` use the clean mutable `main` raw URL; README manual-install URLs must use a SHA-pinned raw URL. No GitHub Actions publishing workflow.

## UI controls (compact dark injected panel)
- **Discography updater** toggle: opens/closes panel; visible keyboard focus; focus moves to updated BBCode on expansion.
- **Updated BBCode** textarea: user's incoming new-release list, not persisted automatically.
- **FastPic session URLs** textarea: pasted URL list, defaults to the supplied examples and remembers changes.
- **Insert new releases** button: validates, fetches sessions, merges atomically into the editor; disabled while running; success/error summary in adjacent live status.
- **Undo merge** button: appears after an in-page successful merge; restores exact pre-merge textarea unless user subsequently edited it; otherwise warns and does nothing.
- UI should remain unobtrusive and avoid dialogs, automatic submission, or controls with duplicate actions. Keyboard accessibility, contrast, hover and focus states are required.

## Verification checkpoint
- **PASS:** Node.js syntax check (`node --check`) of v0.1.1 source.
- **PASS:** Offline regression with uploaded GIMS original/updated BBCode: 8 existing top-level blocks, 58 new, total 66; unchanged original block bodies, chronological insertion of Zoum Zoum after the 2015 album, preservation of existing YouTube/Deezer text; second run adds zero releases.
- **PASS:** Single-cover regression maps catalog `886445883039` to the expected FastPic direct image URL.
- **PASS:** GitHub v0.1.1 committed source and full text fetched back from the immutable commit.
- **NOT RUN:** Live RuTracker editor with Tampermonkey, click/hover/focus/undo/reload and viewport screenshots.
- **NOT RUN:** Live FastPic cross-origin fetching and both supplied session URLs in a real browser.
- **NOT RUN:** Actual UI screenshot/reference comparison, accessibility and error-state walk-through. Keep `Under construction ⚠️` until completed.
- Last attempted UXDT source fetch timed out; live UXDT visual/accessibility audit is outstanding.

## Limitations and next actions
1. On Windows, open a disposable RuTracker post edit page in Chrome + Tampermonkey and verify the UI attaches to `#post-textarea` only for `mode=editpost`.
2. Use the user's two FastPic sessions, verify cover/catalog mapping and insertion counts, and confirm that originals remain unchanged, including all existing source/music links.
3. Exercise Undo, deliberate manual editing after merge, duplicate second run, malformed spoilers, bad/empty FastPic URLs, network errors, keyboard navigation, and viewport resizing; capture and compare real screenshots.
4. Fix discrepancies with a new monotonically increased `@version`, commit script, validate pinned content, then update README link in a separate commit. Do not change GitHub Actions workflows.
