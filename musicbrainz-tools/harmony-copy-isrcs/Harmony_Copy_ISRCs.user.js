// ==UserScript==
// @name         Harmony - Copy ISRCs
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.2
// @description  Adds a one-click Copy ISRCs button to Harmony release tracklists.
// @author       karpuzikov
// @license      MIT
// @include      /^https:\/\/harmony\.pulsewidth\.org\.uk\/release\/?(?:\?[^#]*)?$/
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/harmony-copy-isrcs/Harmony_Copy_ISRCs.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/harmony-copy-isrcs/Harmony_Copy_ISRCs.user.js
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    if (!/^\/release\/?$/.test(location.pathname)) return;

    const BUTTON_CLASS = 'harmony-copy-isrcs';

    function getISRCs(tracklist) {
        return [...tracklist.querySelectorAll('code.isrc')]
            .map((element) => element.textContent.replace(/\s+/g, '').trim())
            .filter(Boolean);
    }

    function copyText(text) {
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text, 'text');
            return Promise.resolve();
        }

        return navigator.clipboard.writeText(text);
    }

    function setButtonText(button, text) {
        const original = button.dataset.originalText || 'Copy ISRCs';

        button.textContent = text;

        clearTimeout(button._restoreTimer);
        button._restoreTimer = setTimeout(() => {
            button.textContent = original;
        }, 1400);
    }

    function addButton(tracklist) {
        const caption = tracklist.querySelector(':scope > caption');

        if (!caption || caption.querySelector(`.${BUTTON_CLASS}`)) {
            return;
        }

        const button = document.createElement('button');

        button.type = 'button';
        button.className = BUTTON_CLASS;
        button.dataset.originalText = 'Copy ISRCs';
        button.textContent = 'Copy ISRCs';
        button.title = 'Copy all ISRCs from this tracklist';

        Object.assign(button.style, {
            marginLeft: '0.5rem',
            padding: '0.2rem 0.55rem',
            cursor: 'pointer',
            verticalAlign: 'middle'
        });

        button.addEventListener('click', async () => {
            const isrcs = getISRCs(tracklist);

            if (!isrcs.length) {
                setButtonText(button, 'No ISRCs');
                return;
            }

            try {
                await copyText(isrcs.join('\n'));
                setButtonText(button, `Copied ${isrcs.length}`);
            } catch (error) {
                console.error('Harmony - Copy ISRCs:', error);
                setButtonText(button, 'Copy failed');
            }
        });

        caption.appendChild(button);
    }

    function init() {
        document.querySelectorAll('table.tracklist').forEach(addButton);
    }

    init();

    new MutationObserver(init).observe(document.body, {
        childList: true,
        subtree: true
    });
})();
