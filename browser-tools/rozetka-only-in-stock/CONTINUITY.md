# Rozetka - Only in stock - Continuity

## Product
- Version: 1.1.2 - Under construction ⚠️ (needs user testing in Tampermonkey).
- Repository/branch: `karpuzikov/userscripts`, `main`.
- Script: `browser-tools/rozetka-only-in-stock/Rozetka_Only_in_Stock.user.js`. Tests: `node --test browser-tools/rozetka-only-in-stock/rozetka-only-in-stock.test.cjs`.
- Rules: root `SOFTWARE_RULES.md`, `UI_UX_RULES.md`. No project-specific rules file.
- Purpose: adds an `Only in stock` toggle above Rozetka's catalog filters. When on, it hides unavailable product tiles and auto-loads the remaining result pages (up to 1200 tiles) through Rozetka's own `Показати ще` button.

## Design
- Single userscript, `@grant none`, `@run-at document-idle`, no dependencies. Tampermonkey-native updates via the clean `main` raw `@updateURL`/`@downloadURL`.
- Persistent data: `localStorage['rz-only-in-stock-enabled']` (`'1'`/`'0'`), per Rozetka subdomain.
- Unavailable = `rz-product-tile.tile-disabled`, or sell-status text matching немає в наявності / нет в наличии / out of stock / закінчився.
- One MutationObserver (childList + `class`/`ngh` attributes) triggers an rAF-coalesced refresh: mount button, hide tiles, load next page.

## Contracts (do not regress)
- Rozetka is Angular 20 SSR with incremental hydration and event replay. Never insert DOM into server-rendered Angular markup before it hydrates: the button mounts only after `rz-filter-stack` loses its `ngh` attribute. v1.1.0 inserted the button at document-idle; Angular then hydrated the filter-stack component into the script's button and Rozetka's own filters stopped working.
- Rozetka filters, sorting and `Показати ще` are Angular router navigations; a newer navigation cancels a pending one. Auto-loading never clicks `Показати ще` within 10 s of trusted user input (`pointerdown`/`keydown`/`change`, except on the toggle) unless the URL changed since; after the user's URL change it waits 1.5 s for the new listing to render.
- The 1200-tile limit is checked live, never latched: the previous listing's tiles linger ~0.5 s after a filter navigation commits.
- The button stays outside `rz-filter-stack` (Angular owns its children).
- 1.1.2: the next `Показати ще` waits for BOTH the URL commit and the appended tiles (they arrive in either order); our own page=N URL change no longer resets loading. Clicking in between made Rozetka append a page twice (seen: 132 tiles for a 96-product listing on `/ua/polki/c4629192/price=1-555;seller=rozetka_eu,rozetka_only/`, 1260 for 1200 on videocards).
- On that polki URL a native filter click (DC) does nothing with v1.1.0 and works with v1.1.1+ (live, injected at DOMContentLoaded).

## Tests and acceptance (2026-11-14)
- Unit: 9/9 pass (1.1.2); earlier 8/8 on Node 22; the 3 new regression tests fail on v1.1.0.
- Live, Claude built-in browser (Chromium), `hard.rozetka.com.ua/ua/videocards/c80087/`, 1400x1000, script injected by page eval (not Tampermonkey):
  - PASS hydration: injected at DOMContentLoaded; button appeared after hydration (~1.9 s); clicking MSI applied `producer=msi`. Same setup with v1.1.0: filter stack never hydrated, MSI click did nothing, whole filter stack rendered inside the script's button.
  - PASS loading race: real click on `Rozetka +` while auto-loading was at page 18 applied `seller=rozetka`; loading resumed on the new listing ~2 s later. v1.1.0 lost a brand click made at page 5.
  - PASS tile limit: a filter click after reaching 1200 tiles loads the new listing (v1.1.0 stayed `partial`).
  - PASS toggle: real click turns it on and loading starts immediately; button look unchanged.
  - NOT RUN: Tampermonkey on the user's Windows browser; hiding a real out-of-stock tile live (none rendered in the tested category that day; hiding code unchanged); keyboard, zoom, mobile layout.

## Known limits
- Each auto-loaded page pushes a history entry (native `Показати ще` behavior), so Back steps through `page=N`.
- Off-screen tiles are lazy placeholders: hidden only once rendered, and the label count covers rendered tiles only.
- Refresh relies on `requestAnimationFrame`; in a background tab loading advances only via the 15 s fallback timer.

## Next
- User updates via Tampermonkey `Check for userscript updates` and tests native filters with the toggle on and off; then drop `Under construction ⚠️`.
