// ==UserScript==
// @name         BPTopTracker 500 redirect to Beatport
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.1.0
// @description  Redirect BPTopTracker HTTP 500/Internal Server Error pages to the equivalent Beatport URL.
// @author       karpuzikov
// @license      MIT
// @match        *://www.bptoptracker.com/*
// @match        *://bptoptracker.com/*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/bptoptracker-to-beatport/BPTopTracker_to_Beatport.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/bptoptracker-to-beatport/BPTopTracker_to_Beatport.user.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    let redirected = false;

    function redirectToBeatport() {
        if (redirected) return;
        redirected = true;

        const target =
            'https://www.beatport.com' +
            window.location.pathname +
            window.location.search +
            window.location.hash;

        window.location.replace(target);
    }

    function getNavigationStatus() {
        try {
            const navigation = performance.getEntriesByType('navigation')[0];
            const status = Number(navigation?.responseStatus);
            return Number.isFinite(status) ? status : 0;
        } catch {
            return 0;
        }
    }

    function looksLike500Page() {
        const status = getNavigationStatus();

        if (status === 500) {
            return true;
        }

        const title = (document.title || '').replace(/\s+/g, ' ').trim();
        const body = (document.body?.innerText || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 10000);

        const combined = `${title} ${body}`.toLowerCase();

        if (/\b500\b/.test(combined) &&
            /(internal server error|server error|http error)/i.test(combined)) {
            return true;
        }

        return /\binternal server error\b/i.test(title);
    }

    function check() {
        if (redirected) return;

        if (looksLike500Page()) {
            redirectToBeatport();
        }
    }

    // Modern Chromium exposes the actual HTTP response status through
    // PerformanceNavigationTiming, so this can redirect before the error page
    // is fully rendered.
    check();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', check, { once: true });
    } else {
        check();
    }

    window.addEventListener('load', check, { once: true });

    // Fallback for error templates whose title/body are filled after initial
    // document creation.
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
    });

    setTimeout(() => observer.disconnect(), 10000);
})();
