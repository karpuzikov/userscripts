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

- Never use query-string cache busting on GitHub Raw userscript URLs. Parameters such as `?v=1.2.3` are forbidden because GitHub Raw/CDN caching has repeatedly served stale script bodies even when the query string changed.
- Every README/manual/chat install or update link for a userscript in this repository must use an immutable `raw.githubusercontent.com` URL pinned to a full 40-character Git commit SHA that contains the exact current script.
- `@updateURL` and `@downloadURL`, when present, must use the clean mutable `main` raw URL for the script path, with no query parameters and no commit pin. These URLs exist for Tampermonkey automatic update discovery; they are not the manual install/update link.
- Preserve userscript identity: do not change `@name` or `@namespace` during normal updates.
- Every behavior/code change must increase `@version`. Versions must move forward monotonically.
- Required publish order:
  1. Update the script, `@version`, and clean `@updateURL`/`@downloadURL`.
  2. Commit the script.
  3. Build the manual install/update URL from that exact commit SHA.
  4. Fetch that immutable URL and verify its `@version` and script body match the intended release.
  5. Update the README install link to that immutable URL in a separate commit.
  6. Fetch the README-linked immutable URL again and verify the expected `@version` before giving the link to the user.
- Never provide a mutable `main` raw URL as the manual update link when a commit-pinned URL can be provided.
- If Tampermonkey shows **Reinstall** when the repository contains a newer version, treat distribution as failed: stop other work, do not tell the user to reinstall, diagnose the served source, and repair the immutable install/update link first.
- The repository userscript-distribution check must pass before a userscript update is considered complete.
