# Software Rules

These rules apply to all current and future software in this repository.

## Unified software design

### Dark-theme UI

- All new and updated GUI software uses a dark theme by default unless the user explicitly requests otherwise.
- Related GUI tools must reuse the established visual language of the closest existing tool, including palette, font family, font sizes, spacing, control sizing, progress/status presentation, and activity/log styling.
- When a specific existing tool is named as the UI reference, match its typography hierarchy as well as its colors. For the Duplicate Edition Analyzer family, use Segoe UI 9 for normal text, Segoe UI 10 bold for section headings, Segoe UI 15 bold for major headings, and Cascadia Mono 9 for activity/log text where monospaced text is appropriate.

### Self-explanatory UI

A first-time user must be able to understand every core UI element without prior chat context, a README, or remembering how the tool works.

- Avoid ambiguous labels such as `Exclude X`, `Filter`, `Process`, or `Apply` when the effect is not obvious.
- Inputs must state what the user should select and what that input is used for.
- Checkboxes/options must state exactly what changes when they are enabled.
- Buttons must describe the action they trigger.
- If analysis and file modification are separate stages, the UI must say so.
- Move/delete/replace operations must identify what will happen and where affected files go.
- Progress/status text must identify the current operation instead of leaving the UI apparently frozen.
- Core behavior must be explained inline where needed, using concise technical wording rather than patronizing reassurance.
- UI wording and behavior should remain consistent across related tools.

## Self-explanatory UI and visible progress

- A first-time user must understand every control without needing prior chat context or a README.
- Prefer short, affirmative labels that describe the effect directly. Avoid inverted or ambiguous controls such as "Exclude ..." when a clearer "Save ..." / "Keep ..." label exists.
- Do not solve clarity problems by filling the window with explanatory paragraphs. Keep the main UI concise; use clear labels, layout, and tooltips for secondary detail.
- Every long-running operation must visibly prove that it is active: show the current stage, a progress bar where measurable, processed/total counts, elapsed time, and a compact activity/log area when multiple stages are involved.
- Software must not appear frozen while doing background work.

## MusicBrainz request reliability

This is a mandatory global rule for **all current and future MusicBrainz-related software**, including userscripts, desktop tools, importers, matchers, lookup utilities, and any other software that sends requests to MusicBrainz.

- Any MusicBrainz HTTP request that receives **HTTP 503 Service Unavailable** must automatically retry.
- 503 retries are **unlimited**. Do not stop after a fixed attempt count.
- Continue retrying until MusicBrainz returns a response whose status is not 503.
- Respect the `Retry-After` response header when MusicBrainz provides one.
- When `Retry-After` is absent or invalid, wait at least 5 seconds before retrying to avoid hammering the service.
- Once a non-503 response is received, resume the software's normal handling for that status. Do not turn permanent 404/400/etc. responses into infinite retry loops.
- A timeout, network failure, 429, or other status may use its own existing policy, but **503 must never fail permanently because an attempt limit was reached**.
- This rule applies to every MusicBrainz request path, not only primary API calls. It includes Web Service requests, same-origin MusicBrainz helper endpoints, edit-preview/data requests, URL lookups, artist/recording/release lookups, and MusicBrainz requests made through `fetch`, XHR, `GM_xmlhttpRequest`, or equivalent clients.
- New MusicBrainz-related code must use a shared 503-retry helper or equivalent centralized mechanism wherever practical so individual features cannot silently omit this behavior.

## Userscript distribution and update integrity

This is a blocking rule. A userscript update is not considered published until every check below passes.

### Hard post-update delivery gate

This gate exists specifically to prevent a same-version Tampermonkey **Reinstall** screen and to enforce the user's rule: **never provide commit links**.

- Never give the user a GitHub commit link.
- Never give the user a GitHub commit-page URL as a substitute for an installer/update link.
- After publishing or modifying an already-installed userscript, do not provide any installer-capable URL unless it is explicitly safe at that moment.
- A direct userscript installer URL is allowed only when one of these is true:
  1. the user explicitly wants a first install and the script is not installed; or
  2. the user's installed version is explicitly known to be lower than the verified target version.
- If the installed version is equal to the target, unknown, may already have auto-updated, or cannot be re-verified, do not provide a direct `.user.js` installer URL. Tell the user to use Tampermonkey's native **Check for userscript updates** instead.
- Never use a GitHub `blob/.../*.user.js` page as a supposedly safe fallback. Tampermonkey can intercept userscript file pages and open them as raw installers.
- If a safe non-installer repository reference is genuinely useful, use a normal repository or directory page, never a commit page.
- Never use wording such as `Download / Install`, `Update here`, or `Install latest` when the user's installed version may already equal the target.
- This gate overrides any earlier preference to provide a link after every update when providing such a link could trigger **Reinstall** or would require a commit link.
- Before sending every post-update reply, perform this exact final check:
  - Does the reply contain a GitHub commit link? If yes, remove it.
  - Does the reply contain a direct `.user.js` installer or another installer-capable userscript URL?
  - If yes, is the installed version explicitly known **right now** to be lower than the target, or is this explicitly a first install?
  - If not, remove that installer link and tell the user to use Tampermonkey's native update check.
- Failure of this gate is a production-stop condition. Do not continue unrelated publishing until the delivery mistake is corrected.

### Tampermonkey UPDATE vs REINSTALL

- A direct `.user.js` install URL is **not** an update button. If its `@version` equals the installed version, Tampermonkey correctly shows **Reinstall**, which can reset script settings.
- Never label, present, or describe a direct `.user.js` link as **UPDATE** unless the user's installed version is explicitly known and is lower than the linked script's verified `@version`.
- If the installed version is equal to the target version, never tell the user to open the direct userscript URL. State that the current version is already installed.
- If the installed version is unknown, call the direct link **Install latest** only; do not call it **Update**.
- For already-installed scripts, the normal update path is Tampermonkey's native update mechanism using an increased `@version` plus `@updateURL`/`@downloadURL`.
- Never manufacture a version bump solely to turn a same-version Reinstall screen into an Update screen.

### Distribution URLs

- Never use query-string cache busting on GitHub Raw userscript URLs. Parameters such as `?v=1.2.3` are forbidden because GitHub Raw/CDN caching has repeatedly served stale script bodies even when the query string changed.
- Every README/manual install link for a userscript in this repository must use an immutable `raw.githubusercontent.com` URL pinned to a full 40-character Git commit SHA that contains the exact current script.
- `@updateURL` and `@downloadURL`, when present, must use the clean mutable `main` raw URL for the script path, with no query parameters and no commit pin. These URLs are for Tampermonkey native update discovery/download, not for a manual "Update" button.
- Never provide a mutable `main` raw URL as a manual install link when a commit-pinned URL can be provided.

### Identity and version integrity

- Preserve userscript identity across normal updates. Existing `@name` and `@namespace` values must not change.
- Every behavior/code change must increase `@version`.
- A changed userscript must never be committed with the same or a lower `@version` than its previous repository version.
- Versions must move forward monotonically.
- Do not add/remove/change grants, sandboxing, or execution context without checking whether page globals such as `window.MB` remain accessible. Privileged Tampermonkey grants can move a script into a sandbox.

### Required publish order

1. Update the script and increase `@version`.
2. Preserve `@name` and `@namespace`; verify any grant/sandbox changes.
3. Keep `@updateURL`/`@downloadURL` on the clean `main` raw URL.
4. Commit the script.
5. Fetch the immutable commit-pinned raw URL and verify its `@version` and body.
6. Update the README **Install** link to that immutable URL in a separate commit.
7. Verify the userscript metadata, version, raw source, and README link directly during the publish operation. Do not create or run a GitHub Actions workflow for this validation.
8. Before giving a direct link to the user, compare the known installed version with the target. Only call it **Update** when installed < target.

### Failure handling

- If Tampermonkey shows **Reinstall** and the installed version is lower than the intended target, distribution has failed: stop other work and repair the served source/version.
- If Tampermonkey shows **Reinstall** and installed version equals incoming version, do not reinstall. The user is already current.
- Never tell the user to click **Reinstall** as a workaround for an update problem.
- Userscript publishing must not depend on GitHub Actions. Perform required validation directly as part of the publish operation.



## GitHub Actions policy

This is a blocking repository rule.

- Do **not** create, restore, replace, or enable a GitHub Actions workflow for userscript publishing, userscript distribution, userscript version checks, README install-link checks, cache-busting checks, metadata checks, or routine repository validation.
- Do **not** create or modify any file under `.github/workflows/` unless the user explicitly requests that exact GitHub Actions workflow or explicitly asks to modify an existing workflow.
- Routine software/userscript publishing and updates must be performed by direct repository commits and direct verification, without GitHub Actions.
- Never restore the deleted `.github/workflows/userscript-distribution-check.yml` workflow or an equivalent workflow under another name.
- Existing workflows must remain narrowly path-scoped to the specific tool they were created for. They must not run on `README.md`, `SOFTWARE_RULES.md`, unrelated scripts, or ordinary repository-wide pushes unless the user explicitly requests that behavior.
- A normal userscript update, README update, rule update, or unrelated software update must not trigger GitHub Actions.
- If a validation can be done during the current publish operation, do it directly instead of creating CI.

## GitHub development status

- New or updated software must initially use `Under construction ⚠️` in the GitHub Version/status column.
- Keep `Under construction ⚠️` until the user confirms testing is complete; then replace it with the actual version.
