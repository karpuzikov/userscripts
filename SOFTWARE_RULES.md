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

