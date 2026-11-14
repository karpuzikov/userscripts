// ==UserScript==
// @name         Rozetka - Only in stock
// @namespace    https://rozetka.com.ua/
// @version      1.1.2
// @description  Add an Only in stock toggle to Rozetka's catalog filters.
// @match        https://*.rozetka.com.ua/*
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/rozetka-only-in-stock/Rozetka_Only_in_Stock.user.js
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/rozetka-only-in-stock/Rozetka_Only_in_Stock.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const BUTTON_ID = 'rz-only-in-stock';
    const STORAGE_KEY = 'rz-only-in-stock-enabled';
    const HIDDEN_CLASS = 'rz-stock-hidden';
    const PAGER_HIDDEN_CLASS = 'rz-stock-paginator-hidden';
    const MAX_LOADED_TILES = 1200;
    const USER_NAVIGATION_COMMIT_TIMEOUT_MS = 10000;
    const NEW_LISTING_RENDER_SETTLE_MS = 1500;
    let enabled = false;
    let loading = false;
    let previousCount = 0;
    let stopped = false;
    let requestNumber = 0;
    let route = location.href;
    let urlBeforeShowMoreClick = '';
    let lastUserActionTime = 0;
    let urlAtLastUserAction = '';
    let urlChangeAfterUserActionSeenTime = 0;
    let resumeAfterUserNavigationTimer = 0;

    try {
        enabled = localStorage.getItem(STORAGE_KEY) === '1';
    } catch { /* Storage may be disabled. */ }

    // Rozetka's filters, sorting and "show more" are all Angular router navigations,
    // and a newer navigation cancels a pending one. Remember real user input so our
    // automatic "show more" click never cancels the filter the user just picked.
    function rememberUserAction(event) {
        if (!event.isTrusted || event.target.closest?.(`#${BUTTON_ID}`)) return;
        lastUserActionTime = Date.now();
        urlAtLastUserAction = location.href;
        urlChangeAfterUserActionSeenTime = 0;
    }
    for (const eventType of ['pointerdown', 'keydown', 'change']) {
        document.addEventListener(eventType, rememberUserAction, true);
    }

    function getMillisecondsUntilUserNavigationSettles() {
        if (!lastUserActionTime) return 0;
        const now = Date.now();
        let settleTime;
        if (location.href === urlAtLastUserAction) {
            // shortcut: a click that never navigates pauses loading for the full timeout; fine for a background loader.
            settleTime = lastUserActionTime + USER_NAVIGATION_COMMIT_TIMEOUT_MS;
        } else {
            // The URL commits ~0.5 s before Angular renders the new listing.
            urlChangeAfterUserActionSeenTime ||= now;
            settleTime = urlChangeAfterUserActionSeenTime + NEW_LISTING_RENDER_SETTLE_MS;
        }
        if (now < settleTime) return settleTime - now;
        lastUserActionTime = 0;
        return 0;
    }

    const style = document.createElement('style');
    style.id = 'rz-stock-filter-style';
    style.textContent = `
        .${HIDDEN_CLASS} { display: none !important; }
        .${PAGER_HIDDEN_CLASS} { display: none !important; }
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
            font-size: 14px;
            line-height: 20px;
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
        return /немає\s+в\s+наявності|нет\s+в\s+наличии|out\s+of\s+stock|закінчився/i.test(status);
    }

    function updateProducts() {
        let availableCount = 0;
        for (const tile of document.querySelectorAll('rz-catalog-tile-placeholder')) {
            const unavailable = isUnavailable(tile);
            tile.classList.toggle(HIDDEN_CLASS, enabled && unavailable);
            if (tile.querySelector('rz-product-tile') && !unavailable) availableCount++;
        }
        return availableCount;
    }

    function resetLoading() {
        loading = false;
        stopped = false;
        requestNumber++;
    }

    function setEnabled(value) {
        enabled = value;
        resetLoading();
        const button = document.getElementById(BUTTON_ID);
        if (button) button.setAttribute('aria-pressed', String(enabled));
        try {
            localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
        } catch { /* Storage may be disabled. */ }
        refresh();
    }

    function mountButton() {
        const filters = document.querySelector('nav[data-testid="catalog_sidebar"] rz-filter-stack');
        // Angular drops ngh once it has hydrated the server-rendered filters. Inserting a node
        // before that misaligns hydration and leaves Rozetka's own filters dead or misrouted.
        if (!filters || filters.hasAttribute('ngh') || document.getElementById(BUTTON_ID)) return;

        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = 'Only in stock';
        button.setAttribute('aria-pressed', String(enabled));
        button.addEventListener('click', () => setEnabled(!enabled));
        // Stay outside Angular's own filter stack, which it controls on updates.
        filters.before(button);
    }

    function loadRemainingPages(count) {
        if (route !== location.href) {
            route = location.href;
            // Our own "show more" also changes the URL (page=N); only other navigations start a new listing.
            if (!loading || lastUserActionTime) resetLoading();
        }

        const paginator = document.querySelector('rz-paginator');
        const more = paginator?.querySelector('[data-testid="show_more_btn"]');
        if (!enabled) {
            paginator?.classList.remove(PAGER_HIDDEN_CLASS);
            const button = document.getElementById(BUTTON_ID);
            if (button) button.textContent = 'Only in stock';
            return;
        }

        const total = document.querySelectorAll('rz-catalog-tile-placeholder').length;
        // "Show more" is done only after both the URL commit and the new tiles, which arrive in
        // either order; clicking again in between makes Rozetka append the same page twice.
        if (loading && total > previousCount && location.href !== urlBeforeShowMoreClick) loading = false;
        // Checked live, not latched: the previous listing's tiles linger briefly after a filter change.
        const partial = stopped || total >= MAX_LOADED_TILES;
        paginator?.classList.toggle(PAGER_HIDDEN_CLASS, !more && !partial);

        const button = document.getElementById(BUTTON_ID);
        if (button) {
            button.textContent = partial ? `Only in stock (${count}, partial)` :
                more || loading ? 'Only in stock (loading...)' : `Only in stock (${count})`;
        }

        if (!more || more.disabled || loading || partial) return;
        const userNavigationWaitMs = getMillisecondsUntilUserNavigationSettles();
        if (userNavigationWaitMs) {
            clearTimeout(resumeAfterUserNavigationTimer);
            resumeAfterUserNavigationTimer = setTimeout(refresh, userNavigationWaitMs);
            return;
        }
        loading = true;
        previousCount = total;
        urlBeforeShowMoreClick = location.href;
        const currentRequest = ++requestNumber;
        more.click(); // Use Rozetka's own pagination, preserving its product controls.
        setTimeout(() => {
            if (!enabled || currentRequest !== requestNumber || !loading) return;
            if (document.querySelectorAll('rz-catalog-tile-placeholder').length > previousCount) {
                loading = false;
            } else {
                stopped = true; // Do not retry indefinitely on a failed request.
                loading = false;
            }
            refresh();
        }, 15000);
    }

    function refresh() {
        mountButton();
        const count = updateProducts();
        loadRemainingPages(count);
    }

    refresh();
    let pending = false;
    new MutationObserver((changes) => {
        if (!changes.some((change) => change.type === 'childList' || change.attributeName === 'ngh' ||
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
        attributeFilter: ['class', 'ngh'],
    });
})();
