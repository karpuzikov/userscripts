// ==UserScript==
// @name         Rozetka - Price per unit
// @namespace    https://rozetka.com.ua/
// @version      0.1.1
// @description  Shows the price per unit you choose (GB, л, кг, шт, рулон...) under every Rozetka catalog price.
// @match        https://*.rozetka.com.ua/*
// @match        https://rozetka.com.ua/*
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/rozetka-price-per-unit/Rozetka_Price_per_Unit.user.js
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/rozetka-price-per-unit/Rozetka_Price_per_Unit.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    // Each family converts to its base unit; the typed unit picks the family and the result scale.
    const PRICE_PER_UNIT_FAMILIES = {
        storage: { mb: 0.001, мб: 0.001, gb: 1, гб: 1, tb: 1000, тб: 1000 },
        volume: { ml: 0.001, мл: 0.001, l: 1, л: 1 },
        mass: { g: 0.001, г: 0.001, гр: 0.001, kg: 1, кг: 1 },
        length: { mm: 0.001, мм: 0.001, cm: 0.01, см: 0.01, m: 1, м: 1 },
        battery: { mah: 1, мач: 1, маг: 1 },
        pieces: { шт: 1, pcs: 1, pc: 1, штук: 1 },
    };
    const NUMBER_PATTERN = '(\\d+(?:[.,]\\d+)?)';
    const NOT_PART_OF_WORD_BEFORE = '(?<![\\p{L}\\d.,])';
    const NOT_PART_OF_WORD_AFTER = '(?![\\p{L}])';
    const MULTIPLIER_BEFORE_PATTERN = /(\d+)\s*(?:шт\.?|pcs)?\s*(?:[xх×*]|шт\.?\s*по)\s*$/iu;
    const MULTIPLIER_AFTER_PATTERN = /^\s*(?:[xх×*]\s*(\d+)|(\d+)\s*(?:шт|pcs))/iu;
    // "Набір пива 12 банок ... 0,5 л": a pack count elsewhere in the title.
    const PACK_COUNT_ANYWHERE_PATTERN = /(?<![\p{L}\d.,])(\d+)\s*(?:шт|pcs|бан\p{L}*|пляш\p{L}*|пач\p{L}*|рул\p{L}*)/iu;

    function escapeForRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function normalizeTypedUnit(typedUnit) {
        return typedUnit.trim().toLowerCase().replace(/[.\s·]/g, '');
    }

    function findUnitFamily(normalizedUnit) {
        for (const aliases of Object.values(PRICE_PER_UNIT_FAMILIES)) {
            if (normalizedUnit in aliases) return { aliases, typedFactor: aliases[normalizedUnit] };
        }
        return null;
    }

    function parseLocalizedNumber(text) {
        return Number.parseFloat(text.replace(',', '.'));
    }

    function readMultiplierAround(title, matchStart, matchEnd) {
        const before = title.slice(0, matchStart).match(MULTIPLIER_BEFORE_PATTERN);
        if (before) return Number(before[1]);
        const after = title.slice(matchEnd).match(MULTIPLIER_AFTER_PATTERN);
        if (after) return Number(after[1] || after[2]);
        const packCount = title.match(PACK_COUNT_ANYWHERE_PATTERN);
        return packCount ? Number(packCount[1]) : 1;
    }

    // Returns how many typed units the title describes, or null when it names none.
    function findQuantityInTitleForTypedUnit(title, typedUnit) {
        const normalizedUnit = normalizeTypedUnit(typedUnit);
        if (!normalizedUnit) return null;
        const family = findUnitFamily(normalizedUnit);
        // Unknown units (рулон, банка, пакет...) are counted words: "8 рулонів" matches "рулон".
        const aliasPattern = family
            ? Object.keys(family.aliases).sort((a, b) => b.length - a.length).map(escapeForRegExp).join('|')
            : `${escapeForRegExp(normalizedUnit)}\\p{L}*`;
        const unitAfterPattern = family ? NOT_PART_OF_WORD_AFTER : '';
        const quantityPattern = new RegExp(
            `${NOT_PART_OF_WORD_BEFORE}${NUMBER_PATTERN}\\s*(${aliasPattern})${unitAfterPattern}`, 'iu');
        const match = title.match(quantityPattern);
        if (!match) return null;
        const aliasFactor = family ? family.aliases[match[2].toLowerCase()] : 1;
        const typedFactor = family ? family.typedFactor : 1;
        const unitIsCounted = !family || family.aliases === PRICE_PER_UNIT_FAMILIES.pieces;
        const multiplier = unitIsCounted ? 1 : readMultiplierAround(title, match.index, match.index + match[0].length);
        const quantity = parseLocalizedNumber(match[1]) * multiplier * aliasFactor / typedFactor;
        return quantity > 0 ? quantity : null;
    }

    function formatNumberForBadge(value) {
        if (value >= 100) return Math.round(value).toLocaleString('uk-UA');
        if (value >= 1) return value.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
        return value.toLocaleString('uk-UA', { maximumSignificantDigits: 3 });
    }

    if (typeof module !== 'undefined') {
        module.exports = { findQuantityInTitleForTypedUnit, formatNumberForBadge };
        return;
    }

    const PRICE_PER_UNIT_INPUT_ID = 'rozetka-price-per-unit-input';
    const PRICE_PER_UNIT_BADGE_ATTRIBUTE = 'data-rozetka-price-per-unit';
    const PRICE_PER_UNIT_STORAGE_PREFIX = 'rozetka-price-per-unit:';
    let typedUnit = '';
    let storageKeyForCurrentCategory = '';

    // shortcut: unit is remembered per category id (/c80109/); search pages share one key. Upgrade if search needs its own.
    function readStorageKeyForCurrentCategory() {
        return PRICE_PER_UNIT_STORAGE_PREFIX + (location.pathname.match(/\/c(\d+)\//)?.[1] || 'other');
    }

    function loadTypedUnitForCurrentCategory() {
        storageKeyForCurrentCategory = readStorageKeyForCurrentCategory();
        try {
            typedUnit = localStorage.getItem(storageKeyForCurrentCategory) || '';
        } catch { typedUnit = ''; }
        const input = document.getElementById(PRICE_PER_UNIT_INPUT_ID);
        if (input && input.value !== typedUnit) input.value = typedUnit;
    }

    function saveTypedUnit(value) {
        typedUnit = value;
        try {
            if (value.trim()) localStorage.setItem(storageKeyForCurrentCategory, value);
            else localStorage.removeItem(storageKeyForCurrentCategory);
        } catch { /* Storage may be disabled; the unit still applies until reload. */ }
        updatePricePerUnitBadges();
    }

    const style = document.createElement('style');
    style.textContent = `
        #${PRICE_PER_UNIT_INPUT_ID}-row {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 8px 0;
            padding: 8px;
            background: #1E2329;
            border-radius: 8px;
            font-family: Inter, -apple-system, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
            font-weight: 600;
            color: #FFFFFF;
        }
        #${PRICE_PER_UNIT_INPUT_ID} {
            flex: 1;
            min-width: 0;
            height: 32px;
            padding: 0 8px;
            background: #2B3139;
            border: 1px solid #474D57;
            border-radius: 6px;
            color: #EAECEF;
            font: inherit;
            font-weight: 400;
        }
        #${PRICE_PER_UNIT_INPUT_ID}::placeholder { color: #848E9C; }
        #${PRICE_PER_UNIT_INPUT_ID}:focus { outline: none; box-shadow: 0 0 0 2px rgba(59,130,246,.5); }
        [${PRICE_PER_UNIT_BADGE_ATTRIBUTE}]::after {
            content: attr(${PRICE_PER_UNIT_BADGE_ATTRIBUTE});
            display: table;
            margin-top: 4px;
            padding: 4px 6px;
            background: #1E2329;
            border-radius: 4px;
            color: #C6F432;
            font-family: "JetBrains Mono", ui-monospace, Consolas, monospace;
            font-size: 12px;
            font-weight: 500;
            line-height: 1.2;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }
    `;
    document.head.append(style);

    function mountPricePerUnitInput() {
        const filters = document.querySelector('nav[data-testid="catalog_sidebar"] rz-filter-stack');
        // Same rule as Rozetka - Only in stock: never insert DOM before Angular hydrates the filters.
        if (!filters || filters.hasAttribute('ngh') || document.getElementById(PRICE_PER_UNIT_INPUT_ID)) return;

        const row = document.createElement('label');
        row.id = `${PRICE_PER_UNIT_INPUT_ID}-row`;
        row.textContent = 'Price per';
        const input = document.createElement('input');
        input.id = PRICE_PER_UNIT_INPUT_ID;
        input.type = 'search';
        input.placeholder = 'GB, л, кг, шт, рулон';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.value = typedUnit;
        input.addEventListener('input', () => saveTypedUnit(input.value));
        row.append(input);
        // Stay outside Angular's own filter stack, which it controls on updates.
        filters.before(row);
    }

    // Writes only an attribute on the price (shown via CSS ::after): extra child nodes would break Angular hydration.
    function updatePricePerUnitBadges() {
        for (const tile of document.querySelectorAll('rz-product-tile')) {
            const priceElement = tile.querySelector('.price');
            if (!priceElement) continue;
            const title = tile.querySelector('a.tile-title')?.textContent || '';
            const price = Number(priceElement.textContent.replace(/\D/g, ''));
            const quantity = typedUnit.trim() ? findQuantityInTitleForTypedUnit(title, typedUnit) : null;
            const badge = quantity && price
                ? `${formatNumberForBadge(price / quantity)} ₴/${typedUnit.trim()} · ${formatNumberForBadge(quantity)} ${typedUnit.trim()}`
                : '';
            if (badge) {
                if (priceElement.getAttribute(PRICE_PER_UNIT_BADGE_ATTRIBUTE) !== badge) {
                    priceElement.setAttribute(PRICE_PER_UNIT_BADGE_ATTRIBUTE, badge);
                }
            } else if (priceElement.hasAttribute(PRICE_PER_UNIT_BADGE_ATTRIBUTE)) {
                priceElement.removeAttribute(PRICE_PER_UNIT_BADGE_ATTRIBUTE);
            }
        }
    }

    function refreshPricePerUnit() {
        if (readStorageKeyForCurrentCategory() !== storageKeyForCurrentCategory) loadTypedUnitForCurrentCategory();
        mountPricePerUnitInput();
        updatePricePerUnitBadges();
    }

    loadTypedUnitForCurrentCategory();
    refreshPricePerUnit();
    let refreshIsPending = false;
    new MutationObserver((changes) => {
        if (!changes.some((change) => change.type === 'childList' || change.attributeName === 'ngh')) return;
        if (refreshIsPending) return;
        refreshIsPending = true;
        requestAnimationFrame(() => {
            refreshIsPending = false;
            refreshPricePerUnit();
        });
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['ngh'] });
})();
