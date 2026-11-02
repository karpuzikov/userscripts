# Instagram Force Full Quality Media - UI/UX Acceptance

## Pre-implementation control contract (v4.4.5)

### Workflow
Target: the userscript's media overlay controls and native image context menu on Instagram post pages, including the modal permalink route. Keep the interface compact and preserve the existing popup.

| Control | Purpose/action | Pointer behavior | Keyboard behavior | Side effect / feedback | Geometry/icon |
| --- | --- | --- | --- | --- | --- |
| Image Viewer | Opens the current image in the internal viewer. | Single click. | Must be a native focusable button; Enter/Space activates. | Opens an in-page viewer; no file or tab created. | 26x26 CSS px; 18px maximize SVG. |
| Open in new tab | Opens the currently displayed direct media URL. | Single click. | Native button; Enter/Space activates. | Creates one foreground browser tab. | 26x26 CSS px; 18px external-link SVG. |
| Download | Opens the existing picker/download flow for the current post. | Single click. | Native button; Enter/Space activates. | Picker selection or downloads files according to existing settings; errors must be actionable. | 26x26 CSS px; 18px download SVG. |
| Video Thumbnail | Opens/downloads the currently displayed video's poster. | Single click; present only for video. | Native button; Enter/Space activates. | Opens or downloads a JPG thumbnail; no change to original video. | 26x26 CSS px; 18px image SVG. |
| Native image context menu | Allows browser Copy image / Save image actions on the media. | Right-click on the displayed image. | Browser-native context menu. | Copies URL or saves image; no script-side persistent state. | No added control. |
| Picker controls | Existing Download selected, Download all, item checkbox, per-item new tab and thumbnail actions. | Existing clicks and checkbox changes. | Existing keyboard interaction/focus behavior must remain. | Downloads selected resources or opens one tab/thumbnail action. | Preserve existing compact picker layout. |

### Visual and accessibility requirements
- Keep the existing dark popup, compact spacing, icon order, preview sizing, and no IG Helper branding/donate controls.
- Use native `button` elements for injected click actions, localized accessible labels and visible `:focus-visible` outline.
- The exact decorative overlay `._aa20 > .xtijo5x` must be click-through. Never use broad `display:none` on media wrappers; that previously blackened carousel posts.
- If the click-through layer contains actual media or the userscript controls, explicitly preserve pointer targeting for media and controls.
- No new modal, menu, or confirmation step for direct Open in new tab/Download actions.

## Acceptance results (pending implementation)
- Source-level and automated tests: NOT RUN.
- Real Instagram browser testing: NOT RUN.
- Target browser/device: user's Windows 11 desktop Chrome/Tampermonkey; browser integration was not available from this ChatGPT session.
- Required user test: open `https://www.instagram.com/p/DT5angriDSP/?img_index=1`; right-click image and Copy image; click Open in new tab; click Download; then check carousel posts remain visible and test a video post.
- Status remains `Under construction ⚠️` until native browser interaction and visual acceptance pass.

## UXDT references rechecked 2026-11-02
- [UXDT Accessibility](https://www.uxdt.nic.in/guidelines/understanding-ux/accessibility/): operable input methods, keyboard navigation, visible focus, simple predictable behavior.
- [UXDT Accessibility Testing Checklist](https://www.uxdt.nic.in/guidelines/ux-design-guidelines/accessibility-testing-checklist/): keyboard operability, focus, manual browser/device validation.
- [UXDT WCAG](https://www.uxdt.nic.in/guidelines/technical-considerations/wcag-web-content-accessibility-guidelines/): semantic controls and keyboard accessibility.
