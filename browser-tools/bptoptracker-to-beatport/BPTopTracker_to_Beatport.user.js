// ==UserScript==
// @name         BPTopTracker 500 → Beatport
// @namespace    https://www.bptoptracker.com/
// @version      1.0
// @description  Redirect BPTopTracker 500 Server Error pages to the equivalent Beatport URL
// @match        https://www.bptoptracker.com/*
// @match        https://bptoptracker.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const title = document.title.trim().toLowerCase();
    const text = document.body?.innerText.trim().toLowerCase() || '';

    const is500Error =
        title === 'server error' &&
        /\b500\b/.test(text) &&
        text.includes('server error');

    if (!is500Error) return;

    const newURL =
        'https://www.beatport.com' +
        window.location.pathname +
        window.location.search +
        window.location.hash;

    window.location.replace(newURL);
})();