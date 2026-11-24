// ==UserScript==
// @name         Bleep - Show Catalogue Number
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Restore catalogue numbers hidden by Bleep's stylesheet.
// @match        https://bleep.com/*
// @match        https://www.bleep.com/*
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/bleep-catalogue-number/Bleep_Catalogue_Number.user.js
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/bleep-catalogue-number/Bleep_Catalogue_Number.user.js
// ==/UserScript==

(() => {
    'use strict';

    const style = document.createElement('style');
    style.textContent = '.product-info .catalogue-number { display: block !important; }';
    document.head.appendChild(style);
})();
