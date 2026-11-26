# Rozetka - Price per unit - Continuity

## Product
- Version: 0.1.0 - Under construction ⚠️ (needs user testing in Tampermonkey).
- Repository/branch: `karpuzikov/userscripts`, `main`.
- Script: `browser-tools/rozetka-price-per-unit/Rozetka_Price_per_Unit.user.js`. Tests: `node --test browser-tools/rozetka-price-per-unit/rozetka-price-per-unit.test.cjs`.
- Rules: root `SOFTWARE_RULES.md`, `UI_UX_RULES.md`, `DESIGN.md`. No project-specific rules file.
- Purpose: a `Price per [unit]` field above Rozetka's catalog filters. The user types the unit (GB, ТБ, л, мл, кг, г, м, mAh, шт, or any counted word such as `рулон`, `банка`); every product tile gets a badge under its price: `<price per 1 unit> ₴/<unit> · <parsed quantity> <unit>`.

## Design
- Single userscript, `@grant none`, `@run-at document-idle`, no dependencies. Tampermonkey-native updates via clean `main` raw `@updateURL`/`@downloadURL`.
- Persistent data: `localStorage['rozetka-price-per-unit:<category id>']` (typed unit, per Rozetka subdomain; non-category pages share key `other`). Empty field removes the key and all badges.
- Unit families (converted to the typed unit): storage MB/GB/TB (decimal, 1 TB = 1000 GB, as sellers label drives), volume мл/л, mass г/кг, length мм/см/м, battery mAh, pieces шт/pcs. Unknown word = counted word: `<number> <word>…` (`рулон` matches `8 рулонів`).
- Quantity = first `<number><unit>` in the tile title × multipack multiplier (`6 шт х 1,5 л`, `1.5 л x 6 шт`, `2x16GB`).
- Price = tile `.price` (current price, not `.old-price` or the Rozetka-card `.red-price`).
- Badge is a `data-rozetka-price-per-unit` attribute on `.price`, rendered by CSS `::after`. No DOM nodes are inserted into product tiles (Angular hydration contract, see Rozetka - Only in stock).
- The field mounts before `rz-filter-stack` only after it loses `ngh` (same hydration rule as Only in stock). Coexists with Only in stock.
- Karpuzikov design system colors: dark field card, lime mono badge.

## Tests and acceptance (2026-11-26)
- Unit: 1/1 pass (10 title cases).
- Live, Claude built-in browser (Chromium), `hard.rozetka.com.ua/ua/ssd/c80109/`, script injected by page eval (not Tampermonkey): PASS typing `GB` badges all 60 tiles (e.g. Kingston NV3 1TB 7 259 ₴ → 7,26 ₴/GB · 1 000 GB); PASS field mounted after hydration, typed by real clicks/keys.
- NOT RUN: Tampermonkey on the user's Windows browser; categories other than SSD live; keyboard-only, zoom, mobile layout; Rozetka filters with the field present (hydration rule reused, not re-tested).

## Known limits
- Only titles are parsed; a quantity missing from the title gives no badge.
- No sorting by price per unit (not requested).
- Off-screen lazy tiles get badges once rendered.

## Next
- User installs, tests a few categories (SSD, water, toilet paper); then drop `Under construction ⚠️`.
