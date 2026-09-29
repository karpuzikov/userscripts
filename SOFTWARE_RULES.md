# Software Rules

These rules apply to all current and future software in this repository.

## Unified software design

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

## Userscript distribution and update integrity

This is a blocking rule. A userscript update is not considered published until every check below passes.

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
7. Run the repository userscript-distribution check and require success.
8. Before giving a direct link to the user, compare the known installed version with the target. Only call it **Update** when installed < target.

### Failure handling

- If Tampermonkey shows **Reinstall** and the installed version is lower than the intended target, distribution has failed: stop other work and repair the served source/version.
- If Tampermonkey shows **Reinstall** and installed version equals incoming version, do not reinstall. The user is already current.
- Never tell the user to click **Reinstall** as a workaround for an update problem.
- The repository userscript-distribution check must pass before a userscript update is considered complete.


## GitHub development status

- New or updated software must initially use `Under construction ⚠️` in the GitHub Version/status column.
- Keep `Under construction ⚠️` until the user confirms testing is complete; then replace it with the actual version.
