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

## Userscript cache busting

- Every userscript install URL, raw download URL, `@downloadURL`, and `@updateURL` must be cache-busted.
- Use a versioned query string such as `?v=1.2.3` that matches the userscript's current `@version`.
- Every userscript version bump must update the cache-buster at the same time.
- Never publish or provide a non-cache-busted raw userscript URL when a cache-busted URL can be used.
