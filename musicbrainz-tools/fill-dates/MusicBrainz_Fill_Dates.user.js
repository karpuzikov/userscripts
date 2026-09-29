// ==UserScript==
// @name         MusicBrainz - Fill Dates
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Copy the first release-event date to every release event below it.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/release/add*
// @match        https://musicbrainz.org/release/*/edit*
// @match        https://beta.musicbrainz.org/release/add*
// @match        https://beta.musicbrainz.org/release/*/edit*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/fill-dates/MusicBrainz_Fill_Dates.user.js?v=1.0.0
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/fill-dates/MusicBrainz_Fill_Dates.user.js?v=1.0.0
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const BUTTON_ID = 'mb-fill-dates-button';
    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/fill-dates/MusicBrainz_Fill_Dates.user.js';

    function fire(element, type) {
        element.dispatchEvent(new Event(type, { bubbles: true }));
    }

    function getReleaseEventFieldset() {
        return [...document.querySelectorAll('fieldset')].find(fieldset => {
            const legend = fieldset.querySelector(':scope > legend');
            return legend && legend.textContent.trim() === 'Release event';
        }) || null;
    }

    function getDateRows(fieldset) {
        if (!fieldset) return [];

        return [...fieldset.querySelectorAll('tr')]
            .map(row => ({
                row,
                year: row.querySelector('input.partial-date-year'),
                month: row.querySelector('input.partial-date-month'),
                day: row.querySelector('input.partial-date-day'),
            }))
            .filter(date => date.year && date.month && date.day);
    }

    function setInputValue(input, value) {
        const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        )?.set;

        if (setter) {
            setter.call(input, value);
        } else {
            input.value = value;
        }

        fire(input, 'input');
        fire(input, 'change');
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

    function fillDates(button) {
        const fieldset = getReleaseEventFieldset();
        const dates = getDateRows(fieldset);
        if (dates.length < 2) return;

        const source = {
            year: dates[0].year.value,
            month: dates[0].month.value,
            day: dates[0].day.value,
        };

        for (const date of dates.slice(1)) {
            setInputValue(date.year, source.year);
            setInputValue(date.month, source.month);
            setInputValue(date.day, source.day);
        }

        appendScriptLinkToEditNote();

        const originalText = button.textContent;
        button.textContent = `Filled ${dates.length - 1}`;
        window.setTimeout(() => {
            if (button.isConnected) button.textContent = originalText;
        }, 1000);
    }

    function syncButton() {
        const fieldset = getReleaseEventFieldset();
        const dates = getDateRows(fieldset);
        if (!dates.length) return;

        const firstDateCell = dates[0].year.closest('td.partial-date');
        const firstDate = firstDateCell?.querySelector('span.partial-date');
        if (!firstDateCell || !firstDate) return;

        let button = document.getElementById(BUTTON_ID);

        if (!button) {
            button = document.createElement('button');
            button.id = BUTTON_ID;
            button.type = 'button';
            button.textContent = 'Fill Dates';
            button.style.display = 'block';
            button.style.margin = '0 0 6px 0';
            button.addEventListener('click', () => fillDates(button));
        }

        if (button.parentElement !== firstDateCell || button.nextElementSibling !== firstDate) {
            firstDateCell.insertBefore(button, firstDate);
        }
    }

    syncButton();

    new MutationObserver(syncButton).observe(document.body, {
        childList: true,
        subtree: true,
    });
})();
