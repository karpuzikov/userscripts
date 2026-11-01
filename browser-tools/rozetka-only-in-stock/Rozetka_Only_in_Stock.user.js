// ==UserScript==
// @name         Rozetka - Only in stock
// @namespace    https://rozetka.com.ua/
// @version      1.0.0
// @description  Add an Only in stock toggle to Rozetka's catalog filters.
// @match        https://*.rozetka.com.ua/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const BUTTON_ID = 'rz-only-in-stock';
    const STORAGE_KEY = 'rz-only-in-stock-enabled';
    const HIDDEN_CLASS = 'rz-stock-hidden';
    let enabled = false;

    try {
        enabled = localStorage.getItem(STORAGE_KEY) === '1';
    } catch { /* Storage may be disabled. */ }

    const style = document.createElement('style');
    style.id = 'rz-stock-filter-style';
    style.textContent = `
        .${HIDDEN_CLASS} { display: none !important; }
        #${BUTTON_ID} {
            display: flex;
            align-items: center;
            gap: 10px;
            width: 100%;
            padding: 12px 2px;
            background: transparent;
            border: 0;
            border-bottom: 1px solid var(--global-black-10, #e5e5e5);
            color: inherit;
            font: inherit;
            font-weight: 600;
            text-align: left;
            cursor: pointer;
        }
        #${BUTTON_ID}::before {
            content: '';
            box-sizing: border-box;
            width: 19px;
            height: 19px;
            flex: none;
            border: 2px solid #999;
            border-radius: 4px;
        }
        #${BUTTON_ID}[aria-pressed="true"]::before {
            content: '✓';
            background: var(--global-green, #00a046);
            border-color: var(--global-green, #00a046);
            color: white;
            font-size: 14px;
            line-height: 15px;
            text-align: center;
        }
        #${BUTTON_ID}:hover { color: var(--global-green, #00a046); }
        #${BUTTON_ID}:focus-visible { outline: 2px solid var(--global-green, #00a046); }
    `;
    (document.head || document.documentElement).append(style);

    function isUnavailable(tile) {
        const product = tile.querySelector('rz-product-tile');
        if (product?.classList.contains('tile-disabled')) return true;

        const status = tile.querySelector('rz-tile-sell-status')?.textContent || '';
        return /немає\s+в\s+наявності|нет\s+в\s+наличии|out\s+of\s+stock/i.test(status);
    }

    function updateProducts() {
        for (const tile of document.querySelectorAll('rz-catalog-tile-placeholder')) {
            tile.classList.toggle(HIDDEN_CLASS, enabled && isUnavailable(tile));
        }
    }

    function setEnabled(value) {
        enabled = value;
        const button = document.getElementById(BUTTON_ID);
        if (button) button.setAttribute('aria-pressed', String(enabled));
        try {
            localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
        } catch { /* Storage may be disabled. */ }
        updateProducts();
    }

    function mountButton() {
        const filters = document.querySelector('nav[data-testid="catalog_sidebar"] rz-filter-stack');
        if (!filters || document.getElementById(BUTTON_ID)) return;

        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = 'Only in stock';
        button.setAttribute('aria-pressed', String(enabled));
        button.addEventListener('click', () => setEnabled(!enabled));
        filters.prepend(button);
    }

    function refresh() {
        mountButton();
        updateProducts();
    }

    refresh();
    let pending = false;
    new MutationObserver((changes) => {
        if (!changes.some((change) => change.type === 'childList' ||
            (change.type === 'attributes' && change.target.matches('rz-product-tile')))) return;
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            refresh();
        });
    }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
    });
})();
