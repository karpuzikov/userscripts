// ==UserScript==
// @name         MusicBrainz - BOIU Cover Art Removal
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.1
// @description  Adds a BOIU button to MusicBrainz cover art. One click removes the image with the edit note "better one is uploaded".
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/release/*/cover-art
// @match        https://musicbrainz.org/release/*/remove-cover-art/*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/MusicBrainz_BOIU_Cover_Art_Removal.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/MusicBrainz_BOIU_Cover_Art_Removal.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/MusicBrainz_BOIU_Cover_Art_Removal.user.js';
    const EDIT_NOTE = `better one is uploaded\n\nScript: ${SCRIPT_URL}`;
    const STORAGE_KEY = 'mb_boiu_remove';

    if (/^\/release\/[^/]+\/cover-art\/?$/.test(location.pathname)) {
        document
            .querySelectorAll('.buttons a[href*="/remove-cover-art/"]')
            .forEach(removeLink => {
                const buttons = removeLink.parentElement;

                if (buttons.querySelector('.boiu-button')) {
                    return;
                }

                const boiu = document.createElement('a');
                boiu.className = 'boiu-button';
                boiu.href = removeLink.href;
                boiu.textContent = 'BOIU';
                boiu.title = 'Remove with note: ' + EDIT_NOTE;

                boiu.addEventListener('click', event => {
                    event.preventDefault();

                    const targetURL = new URL(removeLink.href);

                    sessionStorage.setItem(
                        STORAGE_KEY,
                        JSON.stringify({
                            pathname: targetURL.pathname,
                            timestamp: Date.now()
                        })
                    );

                    location.assign(removeLink.href);
                });

                buttons.appendChild(boiu);
            });

        return;
    }

    if (/^\/release\/[^/]+\/remove-cover-art\/[^/]+\/?$/.test(location.pathname)) {
        let data;

        try {
            data = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
        } catch {
            sessionStorage.removeItem(STORAGE_KEY);
            return;
        }

        if (!data || data.pathname !== location.pathname) {
            return;
        }

        if (
            typeof data.timestamp !== 'number' ||
            Date.now() - data.timestamp > 30000
        ) {
            sessionStorage.removeItem(STORAGE_KEY);
            return;
        }

        sessionStorage.removeItem(STORAGE_KEY);

        const textarea = document.querySelector(
            'textarea[name="confirm.edit_note"]'
        );

        const submitButton = document.querySelector(
            'button.submit.positive[type="submit"]'
        );

        const form =
            textarea?.closest('form') ||
            submitButton?.closest('form');

        if (!textarea || !submitButton || !form) {
            return;
        }

        textarea.value = EDIT_NOTE;

        textarea.dispatchEvent(
            new Event('input', {
                bubbles: true
            })
        );

        textarea.dispatchEvent(
            new Event('change', {
                bubbles: true
            })
        );

        if (typeof form.requestSubmit === 'function') {
            form.requestSubmit(submitButton);
        } else {
            submitButton.click();
        }
    }
})();
