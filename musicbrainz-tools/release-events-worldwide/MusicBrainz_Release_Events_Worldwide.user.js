// ==UserScript==
// @name         MusicBrainz - Release Events to Worldwide
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.1.0
// @description  Replace all release events with one Worldwide event while keeping the existing date.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/release/*/edit*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/release-events-worldwide/MusicBrainz_Release_Events_Worldwide.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/release-events-worldwide/MusicBrainz_Release_Events_Worldwide.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const WORLDWIDE_ID = '240';
    const BUTTON_ID = 'mb-replace-release-events-worldwide';
    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/release-events-worldwide/MusicBrainz_Release_Events_Worldwide.user.js';

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function fire(element, type) {
        element.dispatchEvent(new Event(type, { bubbles: true }));
    }

    function appendScriptLinkToEditNote() {
        const textarea = document.querySelector('#edit-note-text, textarea.edit-note');
        if (!textarea || textarea.value.includes(SCRIPT_URL)) return;

        const currentNote = textarea.value.trimEnd();
        const newNote = currentNote
            ? `${currentNote}\n\nScript: ${SCRIPT_URL}`
            : `Script: ${SCRIPT_URL}`;

        const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value'
        )?.set;

        if (setter) {
            setter.call(textarea, newNote);
        } else {
            textarea.value = newNote;
        }

        fire(textarea, 'input');
        fire(textarea, 'change');
    }

    function getFieldset() {
        return [...document.querySelectorAll('fieldset')].find(fieldset => {
            const legend = fieldset.querySelector(':scope > legend');
            return legend && legend.textContent.trim() === 'Release event';
        });
    }

    function getRows(fieldset) {
        if (!fieldset) return [];
        return [...fieldset.querySelectorAll('button.remove-release-event')]
            .map(button => button.closest('tr, .release-event'))
            .filter(Boolean);
    }

    function readDate(row) {
        if (!row) return { year: '', month: '', day: '' };
        return {
            year: row.querySelector('.partial-date-year')?.value || '',
            month: row.querySelector('.partial-date-month')?.value || '',
            day: row.querySelector('.partial-date-day')?.value || ''
        };
    }

    function writeValue(input, value) {
        if (!input) return;
        input.value = value;
        fire(input, 'input');
        fire(input, 'change');
    }

    async function removeAllEvents(fieldset) {
        while (true) {
            const buttons = [...fieldset.querySelectorAll('button.remove-release-event')];
            if (!buttons.length) return;

            const before = buttons.length;
            buttons[buttons.length - 1].click();

            for (let i = 0; i < 50; i++) {
                await wait(20);
                const after = fieldset.querySelectorAll('button.remove-release-event').length;
                if (after < before) break;
            }
        }
    }

    async function replaceEvents(button) {
        const fieldset = getFieldset();
        if (!fieldset) return;

        const existingRows = getRows(fieldset);
        const date = readDate(existingRows[0]);

        button.disabled = true;
        const oldText = button.textContent;
        button.textContent = 'Working...';

        try {
            await removeAllEvents(fieldset);

            const addButton = fieldset.querySelector('button[data-click="addReleaseEvent"]');
            if (!addButton) throw new Error('MusicBrainz Add Release Event button was not found.');

            addButton.click();

            let row = null;
            for (let i = 0; i < 100; i++) {
                await wait(20);
                const rows = getRows(fieldset);
                if (rows.length) {
                    row = rows[rows.length - 1];
                    break;
                }
            }
            if (!row) throw new Error('The new release event did not appear.');

            writeValue(row.querySelector('.partial-date-year'), date.year);
            writeValue(row.querySelector('.partial-date-month'), date.month);
            writeValue(row.querySelector('.partial-date-day'), date.day);

            const country = row.querySelector('select');
            if (!country) throw new Error('Country selector was not found.');
            country.value = WORLDWIDE_ID;
            fire(country, 'change');

            appendScriptLinkToEditNote();

            button.textContent = 'Done';
            await wait(900);
        } catch (error) {
            console.error('[Release Events to Worldwide]', error);
            alert(error.message || String(error));
        } finally {
            button.disabled = false;
            button.textContent = oldText;
        }
    }

    function addButton() {
        if (document.getElementById(BUTTON_ID)) return;

        const fieldset = getFieldset();
        if (!fieldset) return;

        const addReleaseEvent = fieldset.querySelector('button[data-click="addReleaseEvent"]');
        if (!addReleaseEvent) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.id = BUTTON_ID;
        button.textContent = 'Replace with [Worldwide]';
        button.style.marginLeft = '0.5em';
        button.addEventListener('click', () => replaceEvents(button));

        addReleaseEvent.insertAdjacentElement('afterend', button);
    }

    addButton();
    new MutationObserver(addButton).observe(document.body, { childList: true, subtree: true });
})();