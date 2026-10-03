// ==UserScript==
// @name         MusicBrainz ToolBox
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.46
// @description  Combined MusicBrainz release-editor, recording, barcode, Spotify/Apple Music linking, search, cover-art, Disc ID, and duplicate-edit tools.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/*
// @match        https://beta.musicbrainz.org/*
// @match        https://open.spotify.com/*
// @match        https://music.apple.com/*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.meta.js
// @supportURL   https://github.com/karpuzikov/userscripts
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.github.com
// @connect      musicbrainz.org
// @connect      harmony.pulsewidth.org.uk
// @connect      music.apple.com
// @connect      amp-api.music.apple.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    function __mbToolBoxPattern(pattern) {
        const value = location.href;
        const parts = String(pattern).split('*');
        if (!value.startsWith(parts[0])) return false;
        let position = parts[0].length;
        for (let index = 1; index < parts.length; index++) {
            const part = parts[index];
            if (!part) continue;
            const found = value.indexOf(part, position);
            if (found === -1) return false;
            position = found + part.length;
        }
        return String(pattern).endsWith('*') || position === value.length;
    }

    function __mbToolBoxShouldRun(matches, excludes = []) {
        return matches.some(__mbToolBoxPattern) && !excludes.some(__mbToolBoxPattern);
    }

    const __mbToolBoxPageWindow =
        typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const __mbToolBoxNativeFetch =
        typeof __mbToolBoxPageWindow.fetch === 'function'
            ? __mbToolBoxPageWindow.fetch.bind(__mbToolBoxPageWindow)
            : window.fetch.bind(window);
    const __mbToolBoxNativeGmXmlhttpRequest = GM_xmlhttpRequest;

    function __mbToolBoxSleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function __mbToolBoxIsMusicBrainzUrl(value) {
        const raw =
            typeof value === 'string'
                ? value
                : (value?.url || String(value || ''));

        try {
            const url = new URL(raw, location.href);
            const host = url.hostname.toLowerCase();
            return host === 'musicbrainz.org' ||
                host.endsWith('.musicbrainz.org');
        } catch {
            return false;
        }
    }

    function __mbToolBoxRetryAfterMs(value) {
        const text = String(value || '').trim();
        if (!text) return 0;

        const seconds = Number(text);
        if (Number.isFinite(seconds) && seconds >= 0) {
            return seconds * 1000;
        }

        const date = Date.parse(text);
        if (Number.isFinite(date)) {
            return Math.max(0, date - Date.now());
        }

        return 0;
    }

    function __mbToolBoxRawHeader(rawHeaders, wantedName) {
        const wanted = String(wantedName || '').toLowerCase();
        for (const line of String(rawHeaders || '').split(/\r?\n/)) {
            const index = line.indexOf(':');
            if (index < 0) continue;
            if (line.slice(0, index).trim().toLowerCase() !== wanted) continue;
            return line.slice(index + 1).trim();
        }
        return '';
    }

    function __mbToolBox503Delay(retryAfterValue) {
        return Math.max(
            5000,
            __mbToolBoxRetryAfterMs(retryAfterValue)
        );
    }

    async function __mbToolBoxFetch(input, init) {
        if (!__mbToolBoxIsMusicBrainzUrl(input)) {
            return __mbToolBoxNativeFetch(input, init);
        }

        let requestInit = init;
        let saw503 = false;

        for (;;) {
            const response = await __mbToolBoxNativeFetch(
                input,
                requestInit
            );
            if (response.status !== 503) {
                return response;
            }

            const delay = __mbToolBox503Delay(
                response.headers?.get?.('Retry-After')
            );
            console.warn(
                '[MusicBrainz ToolBox] MusicBrainz HTTP 503; retrying in ' +
                Math.ceil(delay / 1000) +
                's.'
            );

            /*
             * Some older feature-local request code uses a short AbortController
             * timeout. Once MusicBrainz has explicitly returned 503, that
             * one-shot timeout must not terminate the required unlimited retry
             * cycle. Later retries therefore run without the old signal.
             */
            if (!saw503 && requestInit?.signal) {
                requestInit = {...requestInit};
                delete requestInit.signal;
            }
            saw503 = true;

            await __mbToolBoxSleep(delay);
        }
    }

    function __mbToolBoxGmXmlhttpRequest(details) {
        if (!__mbToolBoxIsMusicBrainzUrl(details?.url)) {
            return __mbToolBoxNativeGmXmlhttpRequest(details);
        }

        let currentRequest = null;
        let retryTimer = null;
        let aborted = false;

        const issue = () => {
            if (aborted) return;

            const originalOnload = details.onload;
            currentRequest = __mbToolBoxNativeGmXmlhttpRequest({
                ...details,
                onload(response) {
                    if (aborted) return;

                    if (response.status === 503) {
                        const delay = __mbToolBox503Delay(
                            __mbToolBoxRawHeader(
                                response.responseHeaders,
                                'Retry-After'
                            )
                        );
                        console.warn(
                            '[MusicBrainz ToolBox] MusicBrainz HTTP 503; retrying in ' +
                            Math.ceil(delay / 1000) +
                            's.'
                        );
                        retryTimer = setTimeout(issue, delay);
                        return;
                    }

                    if (typeof originalOnload === 'function') {
                        originalOnload(response);
                    }
                },
            });
        };

        issue();

        return {
            abort() {
                aborted = true;
                if (retryTimer !== null) {
                    clearTimeout(retryTimer);
                    retryTimer = null;
                }
                currentRequest?.abort?.();
            },
        };
    }

    function __mbToolBoxSetStatusKind(node, kind = '') {
        if (!node) return;
        node.classList.remove('error', 'success');
        if (kind === 'bad' || kind === 'error') node.classList.add('error');
        if (kind === 'ok' || kind === 'success') node.classList.add('success');
    }

    function __mbToolBoxInstallNativeUiStyles() {
        if (document.getElementById('mb-toolbox-native-ui-style')) return;

        const style = document.createElement('style');
        style.id = 'mb-toolbox-native-ui-style';
        style.textContent = `
            .mb-toolbox-native-panel { margin-bottom: 1em; }
            .mb-toolbox-native-actions { margin: .5em 0; }
            .mb-toolbox-native-status { display: block; margin: .5em 0; }
            .mb-tvr-diff { display: flex; align-items: center; gap: .4em; min-width: 0; }
            .mb-tvr-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .mb-tvr-replace.styled-button { min-width: 0; padding: 2px 6px; }
            #mb-safe-isrc-dialog { margin-top: 1em; }
            #mb-safe-isrc-dialog textarea { width: 100%; min-height: 12em; }
            #mb-safe-isrc-dialog .buttons { margin-top: .5em; }
            #mb-duplicate-edit-checker-modal,
            #mb-barcode-checker-results {
                position: fixed;
                inset: 0;
                z-index: 100000;
                display: flex;
                align-items: flex-start;
                justify-content: center;
                padding: 4vh 18px;
                overflow: auto;
                background: rgba(0, 0, 0, .55);
            }
            #mb-duplicate-edit-checker-modal .mb-dec-dialog,
            #mb-barcode-checker-results .mb-bc-dialog {
                box-sizing: border-box;
                width: min(760px, 96vw);
                max-height: 92vh;
                overflow: auto;
                padding: 12px;
                background: #fff;
                border: 1px solid #ccc;
                border-radius: 6px;
            }
            #mb-duplicate-edit-checker-modal .mb-dec-summary { width: 100%; margin: .75em 0; }
            #mb-duplicate-edit-checker-modal .mb-dec-summary th,
            #mb-duplicate-edit-checker-modal .mb-dec-summary td { text-align: center; }
            #mb-duplicate-edit-checker-modal .mb-dec-list { max-height: 260px; overflow: auto; }
            #mb-duplicate-edit-checker-modal .mb-dec-buttons,
            #mb-barcode-checker-results .mb-bc-actions,
            #mb-barcode-checker-results .mb-bc-header-actions { margin-top: .75em; }
            #mb-barcode-checker-results .mb-bc-release {
                margin: .75em 0;
                padding: .75em;
                border: 1px solid #ccc;
                border-radius: 6px;
            }
            #mb-barcode-checker-block { margin-bottom: 6px; box-sizing: border-box; }
            #mb-barcode-checker-block .styled-button {
                width: 100%;
                box-sizing: border-box;
                margin-bottom: 4px;
            }
            #mb-barcode-checker-status {
                margin-top: 5px;
                text-align: left;
                font-size: 90%;
                line-height: 1.3;
                overflow-wrap: anywhere;
            }
        `;
        document.head.appendChild(style);
    }

    __mbToolBoxInstallNativeUiStyles();

    // ============================================================================
    // Remember Release Language + Script by artist
    // Remembers the last submitted Language/Script pair for the primary release
    // artist and pre-fills only missing values on the next release add.
    // ============================================================================
    if (__mbToolBoxShouldRun([
        "https://musicbrainz.org/release/add*",
        "https://beta.musicbrainz.org/release/add*"
    ], [])) {
    (() => {
        'use strict';

        const PAGE_WINDOW =
            typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const STORAGE_KEY =
            'mb-toolbox-release-language-script-by-artist-v1';
        const MAX_ENTRIES = 1000;
        const VARIOUS_ARTISTS_GID =
            '89ad4ac3-39f7-470e-963a-56509c546377';

        let installed = false;
        let currentArtistGid = '';

        function unwrap(value) {
            return typeof value === 'function' ? value() : value;
        }

        function readStore() {
            try {
                const value = GM_getValue(STORAGE_KEY, {});
                return value && typeof value === 'object' ? value : {};
            } catch {
                return {};
            }
        }

        function writeStore(store) {
            try {
                const entries = Object.entries(store)
                    .sort(
                        (a, b) =>
                            Number(b[1]?.updatedAt || 0) -
                            Number(a[1]?.updatedAt || 0)
                    )
                    .slice(0, MAX_ENTRIES);

                GM_setValue(STORAGE_KEY, Object.fromEntries(entries));
            } catch {
                // Persistent memory failure must never break the release editor.
            }
        }

        function primaryArtistGid(release) {
            const credit = unwrap(release?.artistCredit);
            const names = Array.isArray(credit?.names) ? credit.names : [];

            for (const part of names) {
                const gid = String(part?.artist?.gid || '')
                    .trim()
                    .toLowerCase();

                if (
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                        gid
                    )
                ) {
                    return gid === VARIOUS_ARTISTS_GID ? '' : gid;
                }
            }

            return '';
        }

        function isUnset(value) {
            return value === null || value === undefined || value === '';
        }

        function applySavedValues(release, artistGid) {
            if (!artistGid) return;

            const saved = readStore()[artistGid];
            if (!saved || typeof saved !== 'object') return;

            const currentLanguage = unwrap(release.languageID);
            const currentScript = unwrap(release.scriptID);

            if (
                isUnset(currentLanguage) &&
                !isUnset(saved.languageID) &&
                typeof release.languageID === 'function'
            ) {
                release.languageID(saved.languageID);
            }

            if (
                isUnset(currentScript) &&
                !isUnset(saved.scriptID) &&
                typeof release.scriptID === 'function'
            ) {
                release.scriptID(saved.scriptID);
            }
        }

        function rememberCurrentValues(release) {
            const artistGid = primaryArtistGid(release);
            if (!artistGid) return;

            const languageID = unwrap(release.languageID);
            const scriptID = unwrap(release.scriptID);

            // Store a complete pair only. A half-filled editor should not
            // replace a previously useful artist default.
            if (isUnset(languageID) || isUnset(scriptID)) return;

            const store = readStore();
            store[artistGid] = {
                languageID,
                scriptID,
                updatedAt: Date.now(),
            };
            writeStore(store);
        }

        function handleArtistChange(release) {
            const artistGid = primaryArtistGid(release);
            if (artistGid === currentArtistGid) return;

            currentArtistGid = artistGid;
            applySavedValues(release, artistGid);
        }

        function install() {
            if (installed) return true;

            const release =
                PAGE_WINDOW.MB?.releaseEditor?.rootField?.release?.();

            if (
                !release ||
                typeof release.artistCredit?.subscribe !== 'function' ||
                typeof release.languageID !== 'function' ||
                typeof release.scriptID !== 'function'
            ) {
                return false;
            }

            installed = true;
            currentArtistGid = primaryArtistGid(release);
            applySavedValues(release, currentArtistGid);

            release.artistCredit.subscribe(() => {
                handleArtistChange(release);
            });

            document.addEventListener('click', event => {
                if (
                    event.target?.closest?.('#enter-edit') &&
                    !event.target?.closest?.('#enter-edit')?.disabled
                ) {
                    rememberCurrentValues(release);
                }
            }, true);

            return true;
        }

        if (!install()) {
            let attempts = 0;
            const timer = setInterval(() => {
                attempts += 1;
                if (install() || attempts >= 100) {
                    clearInterval(timer);
                }
            }, 100);
        }
    })();
    }

    // ============================================================================
    // Auto-Select Single Disc ID Artist
    // Source merged from: musicbrainz-tools/disc-id-auto-select-artist/MusicBrainz_Auto_Select_Single_Disc_ID_Artist.user.js
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/cdtoc/attach*","https://beta.musicbrainz.org/cdtoc/attach*"], [])) {
    (() => {
        'use strict';
    
        const url = new URL(location.href);
    
        if (!url.searchParams.has('filter-artist.query') || url.searchParams.has('artist')) {
            return;
        }
    
        const artistRadios = [
            ...document.querySelectorAll('input[type="radio"][name="artist"]')
        ];
    
        if (artistRadios.length !== 1) {
            return;
        }
    
        const radio = artistRadios[0];
        const form = radio.form;
    
        if (!form) {
            return;
        }
    
        radio.checked = true;
    
        if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
        } else {
            form.submit();
        }
    })();
    }

    // ============================================================================
    // BOIU Cover Art Removal
    // Source merged from: musicbrainz-tools/MusicBrainz_BOIU_Cover_Art_Removal.user.js
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/release/*/cover-art","https://musicbrainz.org/release/*/remove-cover-art/*"], [])) {
    (function () {
        'use strict';
    
        const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js';
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
    }

    // ============================================================================
    // Remove All External Links
    // Source merged from: musicbrainz-tools/remove-all-external-links/MusicBrainz_Remove_All_External_Links.user.js
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/*/*/edit","https://beta.musicbrainz.org/*/*/edit"], [])) {
    (function () {
        'use strict';
    
        const EDITOR_ID = 'external-links-editor';
        const BUTTON_ID = 'mb-remove-all-external-links';
        const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js';
    
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
    
        function getEditor() {
            return document.getElementById(EDITOR_ID);
        }
    
        function getActiveRemoveButtons() {
            const editor = getEditor();
            if (!editor) return [];
    
            return [...editor.querySelectorAll('tr.external-link-item')].flatMap(row => {
                const submittedUrl = row.querySelector('a.url');
                const removeButton = row.querySelector('button.remove-item');
    
                if (!submittedUrl || !removeButton || removeButton.disabled) return [];
                if (submittedUrl.classList.contains('rel-remove')) return [];
    
                return [removeButton];
            });
        }
    
        async function removeAllExternalLinks(button) {
            const oldText = button.textContent;
            const removeButtons = getActiveRemoveButtons();
    
            button.disabled = true;
    
            try {
                if (!removeButtons.length) {
                    button.textContent = 'No external links';
                    await wait(1000);
                    return;
                }
    
                button.textContent = `Removing ${removeButtons.length}...`;
    
                for (let i = 0; i < removeButtons.length; i++) {
                    const removeButton = removeButtons[i];
                    if (removeButton.isConnected && !removeButton.disabled) {
                        removeButton.click();
                        await wait(35);
                    }
                }
    
                appendScriptLinkToEditNote();
    
                button.textContent =
                    `Removed ${removeButtons.length} external link${removeButtons.length === 1 ? '' : 's'}`;
                await wait(1000);
            } catch (error) {
                console.error('[MusicBrainz - Remove All External Links]', error);
                alert(error.message || String(error));
            } finally {
                button.disabled = false;
                button.textContent = oldText;
            }
        }
    
        function addButton() {
            if (document.getElementById(BUTTON_ID)) return;
    
            const editor = getEditor();
            if (!editor) return;
    
            const container = editor.closest('.external-links-editor-container') || editor;
            const toolbar = document.createElement('div');
            toolbar.className = 'buttons mb-toolbox-native-actions';

            const button = document.createElement('button');
            button.type = 'button';
            button.id = BUTTON_ID;
            button.className = 'negative';
            button.textContent = 'Remove all external links';
            button.addEventListener('click', () => removeAllExternalLinks(button));
    
            toolbar.appendChild(button);
            container.insertAdjacentElement('beforebegin', toolbar);
        }
    
        addButton();
        new MutationObserver(addButton).observe(document.body, {
            childList: true,
            subtree: true
        });
    })();
    }

    // ============================================================================
    // Fill Dates
    // Source merged from: musicbrainz-tools/fill-dates/MusicBrainz_Fill_Dates.user.js
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/release/add*","https://musicbrainz.org/release/*/edit*","https://beta.musicbrainz.org/release/add*","https://beta.musicbrainz.org/release/*/edit*"], [])) {
    (() => {
        'use strict';
    
        const BUTTON_ID = 'mb-fill-dates-button';
        const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js';
    
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
                button.className = 'styled-button';
                button.textContent = 'Fill Dates';
                button.style.display = 'block';
                button.style.marginBottom = '6px';
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
    }

    // ============================================================================
    // Release Events to Worldwide
    // Source merged from: musicbrainz-tools/release-events-worldwide/MusicBrainz_Release_Events_Worldwide.user.js
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/release/*/edit","https://beta.musicbrainz.org/release/*/edit"], [])) {
    (function () {
        'use strict';
    
        if (!/^\/release\/[0-9a-f-]{36}\/edit\/?$/i.test(location.pathname)) return;
    
        const WORLDWIDE_ID = '240';
        const BUTTON_ID = 'mb-replace-release-events-worldwide';
        const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js';
    
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
            button.className = 'styled-button';
            button.textContent = 'Replace with [Worldwide]';
            button.style.marginLeft = '0.5em';
            button.addEventListener('click', () => replaceEvents(button));
    
            addReleaseEvent.insertAdjacentElement('afterend', button);
        }
    
        addButton();
        new MutationObserver(addButton).observe(document.body, { childList: true, subtree: true });
    })();
    }

    // ============================================================================
    // Barcode and Catalog Number Search
    // Source merged from: musicbrainz-tools/barcode-catalog-search/MusicBrainz_Barcode_Catalog_Search.user.js
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/*","https://beta.musicbrainz.org/*"], [])) {
    (() => {
        'use strict';
    
        const GROUP_ID = 'mb-quick-release-search';
    
        if (window.top !== window.self || document.getElementById(GROUP_ID)) {
            return;
        }
    
        const nativeInput = document.getElementById('headerid-query');
        const nativeForm = nativeInput?.closest('form[action="/search"]');
        const searchContainer = nativeForm?.parentElement;
        const nativeButton = nativeForm?.querySelector('button[type="submit"]');
    
        if (!nativeInput || !nativeForm || !searchContainer || !nativeButton) {
            return;
        }
    
        searchContainer.classList.add('mb-quick-release-search-enabled');
    
        const style = document.createElement('style');
        style.textContent = `
            .search-container.mb-quick-release-search-enabled {
                display: flex;
                align-items: flex-start;
            }
    
            #${GROUP_ID} {
                display: flex;
                align-items: flex-start;
                gap: 4px;
                margin-right: 6px;
            }
    
            #${GROUP_ID} form {
                width: 180px !important;
                height: 25px;
                margin-top: 5px !important;
                position: relative;
                flex: 0 0 180px;
            }
    
            #${GROUP_ID} input {
                width: 150px !important;
                height: 25px !important;
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
            }
    
            #${GROUP_ID} button {
                width: 30px !important;
                height: 25px !important;
                position: absolute !important;
                left: 149px !important;
                top: 0 !important;
            }
        `;
        document.head.appendChild(style);
    
        const visualProperties = [
            'boxSizing',
            'paddingTop',
            'paddingRight',
            'paddingBottom',
            'paddingLeft',
            'fontFamily',
            'fontSize',
            'fontWeight',
            'fontStyle',
            'lineHeight',
            'letterSpacing',
            'color',
            'backgroundColor',
            'backgroundImage',
            'backgroundPosition',
            'backgroundRepeat',
            'borderTopWidth',
            'borderRightWidth',
            'borderBottomWidth',
            'borderLeftWidth',
            'borderTopStyle',
            'borderRightStyle',
            'borderBottomStyle',
            'borderLeftStyle',
            'borderTopColor',
            'borderRightColor',
            'borderBottomColor',
            'borderLeftColor',
            'borderTopLeftRadius',
            'borderTopRightRadius',
            'borderBottomRightRadius',
            'borderBottomLeftRadius'
        ];
    
        const copyVisualStyle = (source, target) => {
            const computed = getComputedStyle(source);
            for (const property of visualProperties) {
                target.style[property] = computed[property];
            }
        };
    
        const group = document.createElement('div');
        group.id = GROUP_ID;
    
        const makeSearchForm = (type, placeholder, ariaLabel, numeric = false) => {
            const form = document.createElement('form');
            form.dataset.search = type;
            form.autocomplete = 'off';
    
            const input = nativeInput.cloneNode(false);
            input.removeAttribute('id');
            input.name = type;
            input.value = '';
            input.placeholder = placeholder;
            input.setAttribute('aria-label', ariaLabel);
            input.type = 'text';
            if (numeric) {
                input.inputMode = 'numeric';
            } else {
                input.removeAttribute('inputmode');
            }
            copyVisualStyle(nativeInput, input);
    
            const button = nativeButton.cloneNode(true);
            button.removeAttribute('id');
            button.type = 'submit';
    
            form.append(input, ' ', button);
            group.appendChild(form);
    
            return {form, input};
        };
    
        const barcodeSearch = makeSearchForm(
            'barcode',
            'Barcode',
            'Search MusicBrainz releases by barcode',
            true
        );
    
        const catnoSearch = makeSearchForm(
            'catno',
            'Catalog number',
            'Search MusicBrainz releases by catalog number'
        );
    
        searchContainer.insertBefore(group, nativeForm);
    
        const buildSearchUrl = (query) => {
            const url = new URL('/search', location.origin);
            url.searchParams.set('query', query);
            url.searchParams.set('type', 'release');
            url.searchParams.set('limit', '100');
            url.searchParams.set('method', 'advanced');
            return url;
        };
    
        const normalizeCatalogNumber = (value) => String(value ?? '')
            .normalize('NFKC')
            .toLocaleLowerCase('en-US')
            .replace(/[\p{P}\p{S}\s]+/gu, '');
    
        const openUniqueReleaseOrResults = async (query, catalogNumber = null) => {
            const resultsUrl = buildSearchUrl(query);
            const apiUrl = new URL('/ws/2/release/', location.origin);
            apiUrl.searchParams.set('query', query);
            apiUrl.searchParams.set('fmt', 'json');
            apiUrl.searchParams.set('limit', catalogNumber ? '100' : '2');
    
            try {
                const response = await __mbToolBoxFetch(apiUrl, {
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json'
                    }
                });
    
                if (response.ok) {
                    const data = await response.json();
                    const releases = Array.isArray(data.releases) ? data.releases : [];
    
                    if (catalogNumber) {
                        const wanted = normalizeCatalogNumber(catalogNumber);
                        const exactMatches = releases.filter((release) =>
                            Array.isArray(release['label-info']) &&
                            release['label-info'].some((labelInfo) =>
                                normalizeCatalogNumber(labelInfo?.['catalog-number']) === wanted
                            )
                        );
    
                        const uniqueExactMatches = [
                            ...new Map(
                                exactMatches
                                    .filter((release) => release?.id)
                                    .map((release) => [release.id, release])
                            ).values()
                        ];
    
                        if (uniqueExactMatches.length === 1) {
                            location.assign('/release/' + uniqueExactMatches[0].id);
                            return;
                        }
                    } else if (Number(data.count) === 1 && releases.length === 1 && releases[0]?.id) {
                        location.assign('/release/' + releases[0].id);
                        return;
                    }
                }
            } catch {
                // Fall back to the normal MusicBrainz results page.
            }
    
            location.assign(resultsUrl.toString());
        };
    
        barcodeSearch.form.addEventListener('submit', (event) => {
            event.preventDefault();
    
            const barcode = barcodeSearch.input.value.replace(/\D/g, '');
    
            if (!barcode) {
                barcodeSearch.input.focus();
                return;
            }
    
            openUniqueReleaseOrResults('barcode:' + barcode);
        });
    
        catnoSearch.form.addEventListener('submit', (event) => {
            event.preventDefault();
    
            const catalogNumber = catnoSearch.input.value.trim();
    
            if (!catalogNumber) {
                catnoSearch.input.focus();
                return;
            }
    
            const escapedCatalogNumber = catalogNumber
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"');
    
            openUniqueReleaseOrResults(
                'catno:"' + escapedCatalogNumber + '"',
                catalogNumber
            );
        });
    })();
    }

    // ============================================================================
    // Individual Artist Match Propagation
    // Extends MusicBrainz's "Change all artists..." Tracklist option so it
    // replaces matching individual artist-credit components, not only complete
    // artist-credit strings.
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/release/add*","https://musicbrainz.org/release/*/edit*","https://beta.musicbrainz.org/release/add*","https://beta.musicbrainz.org/release/*/edit*"], [])) {
    (() => {
        'use strict';

        const SCRIPT_URL =
            'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js';

        let activeSession = null;
        let reconcileQueued = false;

        function pageWindow() {
            try {
                return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            } catch {
                return window;
            }
        }

        function unwrap(value) {
            return typeof value === 'function' ? value() : value;
        }

        function releaseTracks() {
            const release =
                pageWindow().MB?.releaseEditor?.rootField?.release?.() ||
                pageWindow().MB?._releaseEditor?.rootField?.release?.();

            if (!release) return [];

            if (typeof release.allTracks === 'function') {
                return [...release.allTracks()];
            }

            const tracks = [];
            for (const medium of unwrap(release.mediums) || []) {
                for (const track of unwrap(medium.tracks) || []) {
                    tracks.push(track);
                }
            }
            return tracks;
        }

        function trackForOpenButton(button) {
            if (!button?.matches?.('button.open-ac[id^="open-ac-"]')) {
                return null;
            }

            // Artist-credit popovers are rendered through a FloatingPortal, so
            // the checkbox is not inside the track row. The native Edit button
            // carries the track's uniqueID: open-ac-<track.uniqueID>.
            const uniqueID = String(button.id || '').replace(/^open-ac-/, '');
            if (!uniqueID || uniqueID === 'source') return null;

            return releaseTracks().find(track =>
                String(track?.uniqueID || '') === uniqueID ||
                String(track?.elementID || '') === 'track-row-' + uniqueID
            ) || null;
        }

        function currentOpenTrack() {
            const button = document.querySelector(
                '#tracklist button.open-ac[aria-controls="artist-credit-bubble"]'
            );
            return trackForOpenButton(button);
        }

        function artistId(part) {
            const artist = unwrap(part?.artist) || {};
            return String(
                unwrap(artist.gid) ||
                unwrap(artist.id) ||
                ''
            ).trim().toLowerCase();
        }

        function creditedName(part) {
            const artist = unwrap(part?.artist) || {};
            return String(
                unwrap(part?.name) ??
                unwrap(artist.name) ??
                ''
            );
        }

        function snapshotArtistCredit(artistCredit) {
            return (unwrap(artistCredit)?.names || []).map(part => ({
                artistId: artistId(part),
                creditedName: creditedName(part),
            }));
        }

        function partChanged(oldPart, newPart) {
            return Boolean(oldPart && newPart) && (
                oldPart.artistId !== artistId(newPart) ||
                oldPart.creditedName !== creditedName(newPart)
            );
        }

        function partMatchesOriginal(part, original) {
            if (!part || !original) return false;

            const id = artistId(part);
            const name = creditedName(part);

            if (original.artistId && id) {
                return original.artistId === id &&
                    original.creditedName === name;
            }

            return original.creditedName === name;
        }

        function changedMappings(session) {
            const finalNames = unwrap(session.track?.artistCredit)?.names || [];
            const count = Math.min(session.originalNames.length, finalNames.length);
            const mappings = [];

            for (let index = 0; index < count; index++) {
                const original = session.originalNames[index];
                const replacement = finalNames[index];

                if (!partChanged(original, replacement)) continue;

                mappings.push({original, replacement});
            }

            return mappings;
        }

        function replaceMatchingParts(artistCredit, mappings) {
            const credit = unwrap(artistCredit);
            const names = credit?.names;

            if (!Array.isArray(names) || !mappings.length) {
                return {artistCredit: credit, replacements: 0};
            }

            let replacements = 0;

            const nextNames = names.map(part => {
                const mapping = mappings.find(item =>
                    partMatchesOriginal(part, item.original)
                );

                if (!mapping) return part;

                replacements++;

                return {
                    ...part,
                    artist: unwrap(mapping.replacement?.artist) || part.artist,
                    name: creditedName(mapping.replacement),
                    // Keep the target track's own syntax:
                    // "Maître Gims feat. Dadju" -> "GIMS feat. Dadju".
                    joinPhrase:
                        unwrap(part?.joinPhrase ?? part?.join_phrase) || '',
                };
            });

            if (!replacements) {
                return {artistCredit: credit, replacements: 0};
            }

            return {
                artistCredit: {
                    ...credit,
                    names: nextNames,
                },
                replacements,
            };
        }

        function appendScriptLinkToEditNote() {
            const ed =
                pageWindow().MB?.releaseEditor ||
                pageWindow().MB?._releaseEditor;
            const editNote = ed?.rootField?.editNote;

            if (typeof editNote === 'function') {
                const current = String(editNote() || '');
                if (!current.includes(SCRIPT_URL)) {
                    editNote(
                        current
                            ? current.trimEnd() + '\n\nScript: ' + SCRIPT_URL
                            : 'Script: ' + SCRIPT_URL
                    );
                }
                return;
            }

            const textarea = document.querySelector(
                '#edit-note-text, textarea.edit-note'
            );
            if (!textarea || textarea.value.includes(SCRIPT_URL)) return;

            const next = textarea.value.trimEnd()
                ? textarea.value.trimEnd() + '\n\nScript: ' + SCRIPT_URL
                : 'Script: ' + SCRIPT_URL;

            const setter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                'value'
            )?.set;

            if (setter) setter.call(textarea, next);
            else textarea.value = next;

            textarea.dispatchEvent(new Event('input', {bubbles: true}));
            textarea.dispatchEvent(new Event('change', {bubbles: true}));
        }

        function applySession(session) {
            if (!session?.checkboxChecked || session.applied) return;
            session.applied = true;

            const mappings = changedMappings(session);
            if (!mappings.length) return;

            let changedTracks = 0;
            let replacedParts = 0;

            for (const track of releaseTracks()) {
                if (
                    track === session.track ||
                    typeof track?.artistCredit !== 'function'
                ) {
                    continue;
                }

                const result = replaceMatchingParts(
                    track.artistCredit(),
                    mappings
                );

                if (!result.replacements) continue;

                track.artistCredit(result.artistCredit);
                changedTracks++;
                replacedParts += result.replacements;
            }

            if (replacedParts) {
                appendScriptLinkToEditNote();

                console.info(
                    '[MusicBrainz ToolBox] Changed ' +
                    replacedParts + ' matching individual artist credit part(s) ' +
                    'across ' + changedTracks + ' track(s).'
                );
            }
        }

        function startSession(track) {
            if (!track || typeof track.artistCredit !== 'function') return null;

            activeSession = {
                track,
                originalNames: snapshotArtistCredit(track.artistCredit()),
                checkboxChecked: false,
                sawDialog: false,
                applied: false,
            };

            return activeSession;
        }

        function finishSession(session) {
            if (!session || session.applied) return;

            // MusicBrainz performs its built-in whole-credit propagation in a
            // React effect when the popover closes. Run afterwards, then extend
            // it to partial/individual artist matches.
            setTimeout(() => applySession(session), 75);
        }

        function reconcileDialog() {
            reconcileQueued = false;

            const dialog = document.getElementById('artist-credit-bubble');
            const openTrack = dialog ? currentOpenTrack() : null;

            if (dialog && openTrack) {
                if (!activeSession) {
                    startSession(openTrack);
                } else if (activeSession.track !== openTrack) {
                    const previous = activeSession;
                    activeSession = null;
                    finishSession(previous);
                    startSession(openTrack);
                }

                activeSession.sawDialog = true;

                const checkbox = dialog.querySelector(
                    'input#change-matching-artists'
                );
                if (checkbox) {
                    activeSession.checkboxChecked = checkbox.checked;
                }

                return;
            }

            if (!dialog && activeSession?.sawDialog) {
                const finished = activeSession;
                activeSession = null;
                finishSession(finished);
            }
        }

        function queueReconcile() {
            if (reconcileQueued) return;
            reconcileQueued = true;
            queueMicrotask(reconcileDialog);
        }

        // Capture the original individual artist parts BEFORE React opens the
        // popover and the user can edit them.
        document.addEventListener('click', event => {
            const button = event.target?.closest?.(
                '#tracklist button.open-ac[id^="open-ac-"]'
            );

            if (button) {
                const alreadyOpen =
                    button.getAttribute('aria-controls') === 'artist-credit-bubble';

                if (!alreadyOpen) {
                    const track = trackForOpenButton(button);
                    if (track) startSession(track);
                }
            }

            const navigation = event.target?.closest?.(
                '#artist-credit-bubble #next-track-ac, ' +
                '#artist-credit-bubble #prev-track-ac'
            );

            if (navigation && activeSession) {
                const checkbox = document.querySelector(
                    '#artist-credit-bubble input#change-matching-artists'
                );
                if (checkbox) {
                    activeSession.checkboxChecked = checkbox.checked;
                }
            }
        }, true);

        document.addEventListener('change', event => {
            const checkbox = event.target;
            if (
                activeSession &&
                checkbox?.matches?.(
                    '#artist-credit-bubble input#change-matching-artists'
                )
            ) {
                activeSession.checkboxChecked = checkbox.checked;
            }
        }, true);

        // Done submits the native artist-credit form. Capture the checkbox
        // before MusicBrainz removes the FloatingPortal.
        document.addEventListener('submit', event => {
            if (
                !activeSession ||
                !event.target?.closest?.('#artist-credit-bubble')
            ) {
                return;
            }

            const checkbox = document.querySelector(
                '#artist-credit-bubble input#change-matching-artists'
            );
            if (checkbox) {
                activeSession.checkboxChecked = checkbox.checked;
            }

            const finished = activeSession;
            activeSession = null;
            finishSession(finished);
        }, true);

        // Handles closing by clicking outside, Escape, Next/Previous, and
        // programmatically-opened neighboring tracks.
        const observer = new MutationObserver(queueReconcile);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        reconcileDialog();
    })();
    }

    // ============================================================================
    // Remixer Artist-Credit Checker
    // Highlights tracks where a remixer named in the track title is also present
    // in the track artist credit, and offers one-click removal.
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/release/add*","https://musicbrainz.org/release/*/edit*","https://beta.musicbrainz.org/release/add*","https://beta.musicbrainz.org/release/*/edit*"], [])) {
    (() => {
        'use strict';

        const SCRIPT_URL =
            'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js';
        const STYLE_ID = 'mb-toolbox-remixer-credit-style';
        const PANEL_ID = 'mb-toolbox-remixer-credit-panel';
        const BUTTON_ID = 'mb-toolbox-remove-remixers';
        const STATUS_ID = 'mb-toolbox-remixer-credit-status';
        const ROW_CLASS = 'mb-toolbox-remixer-credit-row';
        const ALL_REMIXERS_CLASS = 'mb-toolbox-remixer-credit-all-remixers';
        const REMIX_WORD = /\b(?:remix(?:ed)?|rmx|mix|rework|bootleg)\b/i;

        let running = false;
        let scanning = false;
        let scanTimer = 0;
        let observerStarted = false;

        function pageWindow() {
            try {
                return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            } catch {
                return window;
            }
        }

        function unwrap(value) {
            return typeof value === 'function' ? value() : value;
        }

        function editor() {
            return pageWindow().MB?.releaseEditor ||
                pageWindow().MB?._releaseEditor ||
                null;
        }

        function releaseTracks() {
            const release = editor()?.rootField?.release?.();
            if (!release) return [];

            if (typeof release.allTracks === 'function') {
                return [...release.allTracks()];
            }

            const tracks = [];
            for (const medium of unwrap(release.mediums) || []) {
                for (const track of unwrap(medium.tracks) || []) {
                    tracks.push(track);
                }
            }
            return tracks;
        }

        function normalizeMatchText(value) {
            return String(value ?? '')
                .normalize('NFKD')
                .replace(/\p{M}+/gu, '')
                .toLocaleLowerCase()
                .replace(/&/g, ' and ')
                .replace(/[^\p{L}\p{N}]+/gu, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }

        function remixContexts(title) {
            const source = String(title || '');
            const contexts = [];

            const bracketPattern = /[\(\[\{]([^\)\]\}]{1,240})[\)\]\}]/g;
            for (const match of source.matchAll(bracketPattern)) {
                const value = String(match[1] || '').trim();
                if (REMIX_WORD.test(value)) contexts.push(value);
            }

            const suffixParts = source.split(/\s(?:-|–|—|:)\s/);
            if (suffixParts.length > 1) {
                for (let index = 1; index < suffixParts.length; index++) {
                    const value = suffixParts.slice(index).join(' - ').trim();
                    if (REMIX_WORD.test(value)) contexts.push(value);
                }
            }

            const remixedBy = source.match(/\bremixed\s+by\s+(.{1,180})$/i);
            if (remixedBy) contexts.push('remixed by ' + remixedBy[1]);

            return [...new Set(
                contexts.map(value => value.trim()).filter(Boolean)
            )];
        }

        function creditedNames(part) {
            const artist = unwrap(part?.artist) || {};
            return [
                unwrap(part?.name),
                unwrap(artist.name),
            ]
                .map(value => String(value || '').trim())
                .filter(Boolean);
        }

        function contextContainsArtist(context, artistName) {
            const haystack = normalizeMatchText(context);
            const needle = normalizeMatchText(artistName);
            if (needle.length < 2) return false;

            return (' ' + haystack + ' ').includes(' ' + needle + ' ');
        }

        function detectedRemixerIndexes(track) {
            const title = String(unwrap(track?.name) || '').trim();
            const contexts = remixContexts(title);
            if (!contexts.length) return [];

            const credit = unwrap(track?.artistCredit);
            const names = unwrap(credit?.names) || [];
            const indexes = [];

            if (!Array.isArray(names)) return indexes;

            names.forEach((part, index) => {
                const candidates = creditedNames(part);
                if (!candidates.length) return;

                const matched = contexts.some(context =>
                    candidates.some(name => contextContainsArtist(context, name))
                );

                if (matched) indexes.push(index);
            });

            return indexes;
        }

        function trackRow(track) {
            const id = String(track?.elementID || '').trim();
            return id ? document.getElementById(id) : null;
        }

        function issuesForTracks(tracks) {
            return tracks
                .map(track => {
                    const indexes = detectedRemixerIndexes(track);
                    const credit = unwrap(track?.artistCredit);
                    const names = unwrap(credit?.names) || [];
                    const total = Array.isArray(names) ? names.length : 0;

                    return {
                        track,
                        indexes,
                        total,
                        removable: indexes.length > 0 && indexes.length < total,
                    };
                })
                .filter(item => item.indexes.length > 0);
        }

        function currentIssues() {
            return issuesForTracks(releaseTracks());
        }

        function installStyles() {
            if (document.getElementById(STYLE_ID)) return;

            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = [
                '#tracklist tr.' + ROW_CLASS + ' > td {',
                '    background: #ffd7d7 !important;',
                '}',
                '#tracklist tr.' + ROW_CLASS + ' > td:first-child {',
                '    box-shadow: inset 4px 0 0 #c62828 !important;',
                '}',
                '#tracklist tr.' + ALL_REMIXERS_CLASS + ' > td {',
                '    background: #ffe8c2 !important;',
                '}',
                '#tracklist tr.' + ALL_REMIXERS_CLASS + ' > td:first-child {',
                '    box-shadow: inset 4px 0 0 #d97706 !important;',
                '}',
            ].join('\n');
            document.head.appendChild(style);
        }

        function setStatus(text, kind = '') {
            const status = document.getElementById(STATUS_ID);
            if (!status) return;

            if (status.textContent !== text) {
                status.textContent = text;
            }

            if (typeof __mbToolBoxSetStatusKind === 'function') {
                __mbToolBoxSetStatusKind(status, kind);
            }
        }

        function ensurePanel(issues) {
            const tracklist = document.getElementById('tracklist');
            if (!tracklist) return null;

            let panel = document.getElementById(PANEL_ID);

            if (!issues.length) {
                if (panel) panel.remove();
                return null;
            }

            if (!panel) {
                panel = document.createElement('fieldset');
                panel.id = PANEL_ID;
                panel.className = 'mb-toolbox-native-panel';

                const legend = document.createElement('legend');
                legend.textContent = 'Remixer credits';

                const actions = document.createElement('div');
                actions.className = 'buttons mb-toolbox-native-actions';

                const button = document.createElement('button');
                button.id = BUTTON_ID;
                button.type = 'button';
                button.textContent = 'Remove remixers';
                button.addEventListener('click', removeDetectedRemixers);

                const status = document.createElement('span');
                status.id = STATUS_ID;
                status.className = 'mb-toolbox-native-status';
                status.setAttribute('role', 'status');

                actions.append(button);
                panel.append(legend, actions, status);
                tracklist.insertBefore(panel, tracklist.firstChild);
            }

            const button = document.getElementById(BUTTON_ID);
            const removable = issues.filter(item => item.removable).length;
            const totalParts = issues.reduce(
                (sum, item) => sum + item.indexes.length,
                0
            );

            if (button) {
                button.disabled = running || removable === 0;
                button.title =
                    totalParts + ' remixer artist-credit part(s) detected across ' +
                    issues.length + ' track(s).';
            }

            if (!running) {
                const manual = issues.length - removable;
                setStatus(
                    totalParts + ' remixer credit(s) detected across ' +
                    issues.length + ' track(s)' +
                    (manual
                        ? ' | ' + manual + ' track(s) need manual review'
                        : '')
                );
            }

            return panel;
        }

        function observeTracklist() {
            const tracklist = document.getElementById('tracklist');
            if (!tracklist || !observerStarted) return;

            observer.observe(tracklist, {
                childList: true,
                subtree: true,
            });
        }

        function scan() {
            if (running || scanning) return [];

            scanning = true;
            if (observerStarted) observer.disconnect();

            try {
                installStyles();

                const tracks = releaseTracks();
                const issues = issuesForTracks(tracks);
                const issueByTrack = new Map(
                    issues.map(item => [item.track, item])
                );

                for (const track of tracks) {
                    const row = trackRow(track);
                    if (!row) continue;

                    const issue = issueByTrack.get(track);
                    row.classList.toggle(ROW_CLASS, Boolean(issue));
                    row.classList.toggle(
                        ALL_REMIXERS_CLASS,
                        Boolean(issue && !issue.removable)
                    );
                }

                ensurePanel(issues);
                return issues;
            } catch (error) {
                console.error(
                    '[MusicBrainz ToolBox] Remixer scan failed:',
                    error
                );
                return [];
            } finally {
                scanning = false;
                observeTracklist();
            }
        }

        function scheduleScan(delay = 120) {
            if (running) return;
            clearTimeout(scanTimer);
            scanTimer = setTimeout(() => {
                scanTimer = 0;
                scan();
            }, delay);
        }

        function joinPhrase(part) {
            return String(
                unwrap(part?.joinPhrase ?? part?.join_phrase) || ''
            );
        }

        function rebuildArtistCreditWithoutIndexes(
            artistCredit,
            removeIndexes
        ) {
            const source = unwrap(artistCredit);
            const names = unwrap(source?.names) || [];
            const remove = new Set(removeIndexes);

            if (!Array.isArray(names)) return null;

            const keptIndexes = names
                .map((_, index) => index)
                .filter(index => !remove.has(index));

            if (!keptIndexes.length) return null;

            const nextNames = keptIndexes.map(
                (originalIndex, keptPosition) => {
                    const part = names[originalIndex];
                    const copy = {...part};

                    if (keptPosition === keptIndexes.length - 1) {
                        copy.joinPhrase = '';
                        if ('join_phrase' in copy) copy.join_phrase = '';
                        return copy;
                    }

                    const nextOriginalIndex =
                        keptIndexes[keptPosition + 1];
                    let bridge = '';

                    for (
                        let index = originalIndex;
                        index < nextOriginalIndex;
                        index++
                    ) {
                        const value = joinPhrase(names[index]);
                        if (value) bridge = value;
                    }

                    copy.joinPhrase = bridge;
                    if ('join_phrase' in copy) {
                        copy.join_phrase = bridge;
                    }
                    return copy;
                }
            );

            return {
                ...source,
                names: nextNames,
            };
        }

        function appendEditNote() {
            const editNote = editor()?.rootField?.editNote;
            if (typeof editNote !== 'function') return;

            const current = String(editNote() || '');
            if (current.includes(SCRIPT_URL)) return;

            editNote(
                current.trimEnd()
                    ? current.trimEnd() + '\n\nScript: ' + SCRIPT_URL
                    : 'Script: ' + SCRIPT_URL
            );
        }

        function removeDetectedRemixers() {
            if (running) return;
            running = true;
            clearTimeout(scanTimer);
            scanTimer = 0;

            if (observerStarted) observer.disconnect();

            const button = document.getElementById(BUTTON_ID);
            if (button) button.disabled = true;
            setStatus('Removing detected remixer credits...');

            try {
                const issues = currentIssues();
                let changedTracks = 0;
                let removedParts = 0;
                let skippedTracks = 0;

                for (const issue of issues) {
                    if (!issue.removable) {
                        skippedTracks++;
                        continue;
                    }

                    if (
                        typeof issue.track.artistCredit !== 'function'
                    ) {
                        skippedTracks++;
                        continue;
                    }

                    const nextCredit =
                        rebuildArtistCreditWithoutIndexes(
                            issue.track.artistCredit,
                            issue.indexes
                        );

                    if (!nextCredit) {
                        skippedTracks++;
                        continue;
                    }

                    issue.track.artistCredit(nextCredit);
                    changedTracks++;
                    removedParts += issue.indexes.length;
                }

                if (changedTracks) appendEditNote();

                const parts = [];
                if (removedParts) {
                    parts.push(
                        removedParts +
                        ' remixer credit(s) removed from ' +
                        changedTracks +
                        ' track(s)'
                    );
                }
                if (skippedTracks) {
                    parts.push(
                        skippedTracks +
                        ' track(s) skipped because removing every artist would leave an empty credit'
                    );
                }

                setStatus(
                    parts.length
                        ? parts.join(' | ')
                        : 'No removable remixer credits found.',
                    removedParts ? 'ok' : ''
                );
            } catch (error) {
                console.error(
                    '[MusicBrainz ToolBox] Remove remixers failed:',
                    error
                );
                setStatus('Error: ' + error.message, 'bad');
            } finally {
                running = false;
                observeTracklist();
                scheduleScan(0);
            }
        }

        const observer = new MutationObserver(() => {
            scheduleScan();
        });

        function start() {
            const tracklist = document.getElementById('tracklist');
            if (!tracklist) return false;

            if (!observerStarted) {
                observerStarted = true;
                tracklist.addEventListener('input', () => scheduleScan(), true);
                tracklist.addEventListener('change', () => scheduleScan(), true);
            }

            observeTracklist();
            scan();
            return true;
        }

        if (!start()) {
            const bootstrapObserver = new MutationObserver(() => {
                if (start()) bootstrapObserver.disconnect();
            });

            bootstrapObserver.observe(document.documentElement, {
                childList: true,
                subtree: true,
            });
        }
    })();
    }

    // ============================================================================
    // Tracklist vs Recording
    // Source merged from: musicbrainz-tools/tracklist-vs-recording/MusicBrainz_Tracklist_vs_Recording.user.js
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/release/add*","https://musicbrainz.org/release/*/edit*","https://beta.musicbrainz.org/release/add*","https://beta.musicbrainz.org/release/*/edit*"], [])) {
    (() => {
        'use strict';
    
        const SCRIPT_NAME = 'MusicBrainz - Tracklist vs Recording';
        const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js';
        const STYLE_ID = 'mb-tracklist-vs-recording-style';
        const DIFF_ROW_CLASS = 'mb-tracklist-vs-recording-diff-row';
        const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const watchedTracks = new WeakSet();
        const artistEntityCache = new Map();
        let scanTimer = 0;

        function matcherActive() {
            return Boolean(pageWindow().__MB_RECORDING_MATCHER_ACTIVE__);
        }
    
        function pageWindow() {
            try {
                return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            } catch {
                return window;
            }
        }
    
        function editor() {
            return pageWindow().MB?._releaseEditor || null;
        }
    
        function unwrap(value) {
            return typeof value === 'function' ? value() : value;
        }
    
        function installStyle() {
            // Shared Toolbox CSS supplies layout only; visual styling is native MusicBrainz.
        }

        function appendScriptLinkToEditNote() {
            const ed = editor();
            const editNote = ed?.rootField?.editNote;
            if (typeof editNote === 'function') {
                const current = String(editNote() || '');
                if (!current.includes(SCRIPT_URL)) {
                    editNote(current
                        ? `${current.replace(/\s+$/, '')}\n\nScript: ${SCRIPT_URL}`
                        : `Script: ${SCRIPT_URL}`);
                }
                return;
            }
    
            const textarea = document.querySelector('#edit-note-text, textarea.edit-note');
            if (!textarea || textarea.value.includes(SCRIPT_URL)) return;
    
            const current = textarea.value.trimEnd();
            const next = current
                ? `${current}\n\nScript: ${SCRIPT_URL}`
                : `Script: ${SCRIPT_URL}`;
    
            const setter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                'value'
            )?.set;
    
            if (setter) setter.call(textarea, next);
            else textarea.value = next;
    
            textarea.dispatchEvent(new Event('input', {bubbles: true}));
            textarea.dispatchEvent(new Event('change', {bubbles: true}));
        }
    
        function hasExistingRecording(track) {
            try {
                if (typeof track?.hasExistingRecording === 'function') {
                    return Boolean(track.hasExistingRecording());
                }
            } catch {
                // Fall through to the recording GID check.
            }
    
            return Boolean(unwrap(track?.recording)?.gid);
        }
    
        function recordingTitle(recording) {
            return String(unwrap(recording?.name) || '').trim();
        }
    
        function trackTitle(track) {
            return String(unwrap(track?.name) || '').trim();
        }
    
        function artistMbid(artist) {
            const entity = unwrap(artist) || {};
            const gid = String(unwrap(entity.gid) || '').trim();
            if (UUID.test(gid)) return gid.toLowerCase();
    
            const id = String(unwrap(entity.id) || '').trim();
            return UUID.test(id) ? id.toLowerCase() : '';
        }
    
        function numericArtistId(artist) {
            const entity = unwrap(artist) || {};
            const id = unwrap(entity.id);
            if (Number.isInteger(id) && id > 0) return id;
            if (/^\d+$/.test(String(id || '')) && Number(id) > 0) return Number(id);
            return null;
        }
    
        function artistCreditNames(artistCredit) {
            return unwrap(artistCredit)?.names || [];
        }
    
        function artistCreditText(artistCredit) {
            return artistCreditNames(artistCredit)
                .map(credit => {
                    const artist = unwrap(credit?.artist) || {};
                    const creditedName = String(
                        unwrap(credit?.name) || unwrap(artist.name) || ''
                    );
                    const joinPhrase = String(
                        unwrap(credit?.joinPhrase ?? credit?.join_phrase ?? '') || ''
                    );
                    return creditedName + joinPhrase;
                })
                .join('')
                .trim();
        }
    
        function artistCreditSignature(artistCredit) {
            return JSON.stringify(artistCreditNames(artistCredit).map(credit => {
                const artist = unwrap(credit?.artist) || {};
                return {
                    artistId: numericArtistId(artist),
                    artistGid: artistMbid(artist),
                    artistName: String(unwrap(artist.name) || ''),
                    creditedName: String(unwrap(credit?.name) || ''),
                    joinPhrase: String(
                        unwrap(credit?.joinPhrase ?? credit?.join_phrase ?? '') || ''
                    ),
                };
            }));
        }
    
        function titleDiffers(track) {
            if (!hasExistingRecording(track)) return false;
    
            try {
                if (typeof track.titleDiffersFromRecording === 'function') {
                    return Boolean(track.titleDiffersFromRecording());
                }
            } catch {
                // Fall through to the exact comparison.
            }
    
            return trackTitle(track) !== recordingTitle(unwrap(track.recording));
        }
    
        function artistDiffers(track) {
            if (!hasExistingRecording(track)) return false;
    
            try {
                if (typeof track.artistDiffersFromRecording === 'function') {
                    return Boolean(track.artistDiffersFromRecording());
                }
            } catch {
                // Fall through to a structural comparison.
            }
    
            const recording = unwrap(track.recording);
            return artistCreditSignature(track.artistCredit) !==
                artistCreditSignature(recording?.artistCredit);
        }
    
        function writeTrackTitle(track, title, recording) {
            if (!title || typeof track?.name !== 'function') return false;
    
            /*
             * MusicBrainz may unlink a recording when a track title changes too
             * far from the title saved at association time. This replacement is
             * coming from the linked recording itself, so update the saved title
             * first and keep the association intact.
             */
            if (recording?.gid) {
                track.name.saved = title;
            }
    
            if (typeof track.inputName === 'function') {
                track.inputName(title);
            } else {
                track.name(title);
            }
    
            return true;
        }
    
        async function resolveArtistEntity(artist) {
            const source = unwrap(artist) || {};
            if (numericArtistId(source)) return source;
    
            const gid = artistMbid(source);
            if (!gid) return null;
    
            const mb = pageWindow().MB;
            const cachedMbEntity = mb?.entityCache?.[gid];
            if (cachedMbEntity && numericArtistId(cachedMbEntity)) {
                return cachedMbEntity;
            }
    
            if (artistEntityCache.has(gid)) {
                return artistEntityCache.get(gid);
            }
    
            const promise = (async () => {
                const response = await __mbToolBoxFetch('/ws/js/entity/' + encodeURIComponent(gid), {
                    credentials: 'same-origin',
                    headers: {Accept: 'application/json'},
                });
    
                if (!response.ok) {
                    throw new Error('Could not resolve artist ' + gid + ' (HTTP ' + response.status + ')');
                }
    
                const entity = await response.json();
                if (!entity || entity.entityType !== 'artist' || !numericArtistId(entity)) {
                    throw new Error('MusicBrainz did not return a linkable artist for ' + gid);
                }
    
                if (!entity.gid) entity.gid = gid;
                return entity;
            })();
    
            artistEntityCache.set(gid, promise);
    
            try {
                const entity = await promise;
                artistEntityCache.set(gid, entity);
                return entity;
            } catch (error) {
                artistEntityCache.delete(gid);
                throw error;
            }
        }
    
        async function cloneLinkedArtistCredit(artistCredit) {
            const source = unwrap(artistCredit);
            const sourceNames = source?.names || [];
            const names = [];
    
            for (const credit of sourceNames) {
                const sourceArtist = unwrap(credit?.artist);
                const artist = await resolveArtistEntity(sourceArtist);
    
                if (!artist) {
                    throw new Error(
                        'Could not resolve MusicBrainz artist for credit "' +
                        String(unwrap(credit?.name) || unwrap(sourceArtist?.name) || '').trim() +
                        '"'
                    );
                }
    
                names.push({
                    ...credit,
                    artist,
                    name: unwrap(credit?.name) || unwrap(artist.name) || '',
                    joinPhrase: unwrap(credit?.joinPhrase ?? credit?.join_phrase ?? '') || '',
                });
            }
    
            return {
                ...(source || {}),
                names,
            };
        }
    
        function removeDiffRow(track) {
            const row = document.querySelector(
                `tr.${DIFF_ROW_CLASS}[data-track-id="${CSS.escape(String(track?.elementID || ''))}"]`
            );
            row?.remove();
        }
    
        function createDiffRow(track, trackRow) {
            const diffRow = document.createElement('tr');
            diffRow.className = 'track ' + DIFF_ROW_CLASS;
            diffRow.dataset.trackId = String(track.elementID || '');

            const reorder = document.createElement('td');
            reorder.className = 'reorder';
            const position = document.createElement('td');
            position.className = 'position';
            const title = document.createElement('td');
            title.className = 'title mb-tvr-diff-cell mb-tvr-title-cell';
            const artist = document.createElement('td');
            artist.className = 'artist mb-tvr-diff-cell mb-tvr-artist-cell';
            const length = document.createElement('td');
            length.className = 'length';
            const icon = document.createElement('td');
            icon.className = 'icon';
    
            diffRow.append(reorder, position, title, artist, length, icon);
            trackRow.insertAdjacentElement('afterend', diffRow);
            return diffRow;
        }
    
        function valueSpan(text, className, title) {
            const span = document.createElement('span');
            span.className = `mb-tvr-value ${className}`;
            span.textContent = text || '[empty]';
            span.title = title;
            return span;
        }
    
        function replaceButton(title, onClick) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'styled-button mb-tvr-replace';
            button.textContent = '<';
            button.title = title;
            button.addEventListener('click', onClick);
            return button;
        }
    
        function renderTitleDiff(track, cell, recording) {
            cell.textContent = '';
            if (!titleDiffers(track)) return false;
    
            const currentTitle = trackTitle(track);
            const sourceTitle = recordingTitle(recording);
            const wrapper = document.createElement('div');
            wrapper.className = 'mb-tvr-diff';
    
            const current = valueSpan(
                currentTitle,
                'mb-tvr-track-value',
                'Current tracklist title: ' + (currentTitle || '[empty]')
            );
    
            const button = replaceButton(
                'Replace tracklist title with recording title',
                () => {
                    if (writeTrackTitle(track, sourceTitle, recording)) {
                        appendScriptLinkToEditNote();
                        renderTrack(track);
                    }
                }
            );
    
            const source = valueSpan(
                sourceTitle,
                'mb-tvr-recording-value',
                'Recording title: ' + (sourceTitle || '[empty]')
            );
    
            wrapper.append(current, button, source);
            cell.appendChild(wrapper);
            return true;
        }
    
        function renderArtistDiff(track, cell, recording) {
            cell.textContent = '';
            if (!artistDiffers(track)) return false;
    
            const currentText = artistCreditText(track.artistCredit);
            const sourceText = artistCreditText(recording?.artistCredit);
            const wrapper = document.createElement('div');
            wrapper.className = 'mb-tvr-diff';
    
            const current = valueSpan(
                currentText,
                'mb-tvr-track-value',
                'Current tracklist artist credit: ' + (currentText || '[empty]')
            );
    
            const button = replaceButton(
                'Replace tracklist artist credit with recording artist credit',
                async () => {
                    if (button.disabled) return;
                    button.disabled = true;
    
                    try {
                        if (typeof track.artistCredit !== 'function') {
                            throw new Error('Track artist credit is not editable.');
                        }
    
                        const linkedCredit = await cloneLinkedArtistCredit(recording?.artistCredit);
                        track.artistCredit(linkedCredit);
                        appendScriptLinkToEditNote();
                        renderTrack(track);
                    } catch (error) {
                        console.error(`[${SCRIPT_NAME}]`, error);
                        button.disabled = false;
                        button.title = 'Error: ' + error.message;
                    }
                }
            );
    
            const source = valueSpan(
                sourceText,
                'mb-tvr-recording-value',
                'Recording artist credit: ' + (sourceText || '[empty]')
            );
    
            wrapper.append(current, button, source);
            cell.appendChild(wrapper);
            return true;
        }
    
        function renderTrack(track) {
            if (matcherActive() || !track?.elementID) return;
    
            const trackRow = document.getElementById(track.elementID);
            if (!trackRow || !trackRow.matches('tr.track')) {
                removeDiffRow(track);
                return;
            }
    
            const recording = unwrap(track.recording);
            if (!hasExistingRecording(track) || !recording?.gid) {
                removeDiffRow(track);
                return;
            }
    
            const hasTitleDiff = titleDiffers(track);
            const hasArtistDiff = artistDiffers(track);
    
            if (!hasTitleDiff && !hasArtistDiff) {
                removeDiffRow(track);
                return;
            }
    
            let diffRow = document.querySelector(
                `tr.${DIFF_ROW_CLASS}[data-track-id="${CSS.escape(String(track.elementID))}"]`
            );
    
            if (!diffRow) {
                diffRow = createDiffRow(track, trackRow);
            } else if (diffRow.previousElementSibling !== trackRow) {
                trackRow.insertAdjacentElement('afterend', diffRow);
            }
    
            const titleCell = diffRow.querySelector('.mb-tvr-title-cell');
            const artistCell = diffRow.querySelector('.mb-tvr-artist-cell');
    
            renderTitleDiff(track, titleCell, recording);
            renderArtistDiff(track, artistCell, recording);
        }
    
        function watchObservable(observable, track) {
            if (typeof observable?.subscribe !== 'function') return;
            observable.subscribe(() => {
                if (matcherActive()) return;
                queueMicrotask(() => renderTrack(track));
            });
        }

        function watchTrack(track) {
            if (!track || watchedTracks.has(track)) return false;
            watchedTracks.add(track);

            watchObservable(track.name, track);
            watchObservable(track.artistCredit, track);
            watchObservable(track.recording, track);

            renderTrack(track);
            return true;
        }

        function releaseTracks() {
            const release = editor()?.rootField?.release?.();
            if (!release) return [];
    
            const tracks = [];
            for (const medium of unwrap(release.mediums) || []) {
                for (const track of unwrap(medium.tracks) || []) {
                    tracks.push(track);
                }
            }
            return tracks;
        }
    
        function removeOrphanRows(liveTrackIds) {
            for (const row of document.querySelectorAll(`tr.${DIFF_ROW_CLASS}`)) {
                if (!liveTrackIds.has(row.dataset.trackId || '')) {
                    row.remove();
                }
            }
        }
    
        function scan() {
            if (matcherActive()) return;

            const tracks = releaseTracks();
            const liveTrackIds = new Set();

            for (const track of tracks) {
                if (track?.elementID) liveTrackIds.add(String(track.elementID));

                const newlyWatched = watchTrack(track);
                if (newlyWatched || !track?.elementID) continue;

                const trackRow = document.getElementById(track.elementID);
                const diffRow = document.querySelector(
                    `tr.${DIFF_ROW_CLASS}[data-track-id="${CSS.escape(String(track.elementID))}"]`
                );

                // Restore only a missing discrepancy row after MusicBrainz rebuilt
                // the Tracklist DOM. Existing rows are never repainted on a timer.
                if (trackRow && !diffRow && (titleDiffers(track) || artistDiffers(track))) {
                    renderTrack(track);
                }
            }

            removeOrphanRows(liveTrackIds);
        }

        function start() {
            installStyle();
            scan();

            // Low-frequency model discovery only. Do not observe the Tracklist DOM:
            // this script inserts rows itself and a subtree observer self-triggers.
            if (!scanTimer) {
                scanTimer = window.setInterval(scan, 1500);
            }
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start, {once: true});
        } else {
            start();
        }
    })();
    }

    // ============================================================================
    // Recording Data to Tracks
    // Source merged from: musicbrainz-tools/recording-artist-credits-to-tracks/MusicBrainz_Recording_Artist_Credits_to_Tracks.user.js
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/release/add*","https://musicbrainz.org/release/*/edit*","https://beta.musicbrainz.org/release/add*","https://beta.musicbrainz.org/release/*/edit*"], [])) {
    (() => {
        'use strict';
    
        const SCRIPT_NAME = 'MusicBrainz - Recording Data to Tracks';
        const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js';
        const WRAPPER_ID = 'mb-recording-data-to-tracks';
        const TITLE_BUTTON_ID = 'mb-recording-title-to-tracks-button';
        const ARTIST_BUTTON_ID = 'mb-recording-ac-to-tracks-button';
        const STATUS_ID = 'mb-recording-data-to-tracks-status';
        const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const ISRC_CHOICE_CACHE_KEY = 'mb-recording-matcher:isrc-choice:v1';
        const LEGACY_ISRC_CHOICE_CACHE_KEY = 'mb-recording-data-to-tracks:isrc-choice-cache:v1';
        const watchedTracks = new WeakSet();
    
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    
        function normalizeIsrc(value) {
            const normalized = String(value || '')
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '');
            return normalized.length === 12 ? normalized : '';
        }
    
        function recordingGid(recording) {
            const gid = String(unwrap(recording?.gid) || '').trim().toLowerCase();
            return UUID.test(gid) ? gid : '';
        }
    
        function recordingIsrcs(recording) {
            const values = unwrap(recording?.isrcs);
            if (!Array.isArray(values)) return [];
    
            return [...new Set(values
                .map(item => normalizeIsrc(
                    typeof item === 'string' ? item : unwrap(item?.isrc)
                ))
                .filter(Boolean))];
        }
    
        function cacheRecordingId(value) {
            const id = String(
                typeof value === 'string'
                    ? value
                    : value?.recordingMbid || value?.recordingId || ''
            ).trim().toLowerCase();
            return UUID.test(id) ? id : '';
        }

        function loadIsrcChoiceCache() {
            const merged = {};

            for (const key of [LEGACY_ISRC_CHOICE_CACHE_KEY, ISRC_CHOICE_CACHE_KEY]) {
                try {
                    const parsed = JSON.parse(localStorage.getItem(key) || '{}');
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

                    for (const [rawIsrc, value] of Object.entries(parsed)) {
                        const isrc = normalizeIsrc(rawIsrc);
                        const recordingMbid = cacheRecordingId(value);
                        if (!isrc || !recordingMbid) continue;

                        merged[isrc] = {
                            recordingMbid,
                            updated: Number(
                                typeof value === 'object' && value
                                    ? value.updated || 0
                                    : 0
                            ),
                        };
                    }
                } catch {
                    // Ignore invalid legacy/local cache data.
                }
            }

            return merged;
        }

        let isrcChoiceCache = loadIsrcChoiceCache();

        function persistIsrcChoiceCache() {
            const serializable = {};

            for (const [isrc, value] of Object.entries(isrcChoiceCache)) {
                const normalized = normalizeIsrc(isrc);
                const recordingMbid = cacheRecordingId(value);
                if (normalized && recordingMbid) {
                    serializable[normalized] = recordingMbid;
                }
            }

            localStorage.setItem(
                ISRC_CHOICE_CACHE_KEY,
                JSON.stringify(serializable)
            );
        }

        function saveIsrcChoice(isrcs, recordingMbid) {
            const id = cacheRecordingId(recordingMbid);
            if (!id) return;

            const now = Date.now();
            let changed = false;

            for (const isrc of isrcs) {
                const normalized = normalizeIsrc(isrc);
                if (!normalized) continue;

                const current = isrcChoiceCache[normalized];
                if (cacheRecordingId(current) === id) continue;

                isrcChoiceCache[normalized] = {
                    recordingMbid: id,
                    updated: now,
                };
                changed = true;
            }

            if (changed) persistIsrcChoiceCache();
        }

        function cachedCandidateForTrack(track) {
            // The Recording Matcher can update the shared cache later on the same
            // page, so refresh from storage for every lookup instead of relying on
            // an initialization-time copy.
            isrcChoiceCache = loadIsrcChoiceCache();

            const candidates = unwrap(track?.suggestedRecordings) || [];
            if (candidates.length < 2) return null;

            const byIsrc = new Map();

            for (const candidate of candidates) {
                const gid = recordingGid(candidate);
                if (!gid) continue;

                for (const isrc of recordingIsrcs(candidate)) {
                    let group = byIsrc.get(isrc);
                    if (!group) {
                        group = new Map();
                        byIsrc.set(isrc, group);
                    }
                    group.set(gid, candidate);
                }
            }

            const matches = [];

            for (const [isrc, group] of byIsrc) {
                if (group.size < 2) continue;

                const cached = isrcChoiceCache[isrc];
                const cachedId = cacheRecordingId(cached);
                const candidate = cachedId ? group.get(cachedId) : null;

                if (candidate) {
                    matches.push({
                        candidate,
                        isrc,
                        updated: Number(cached?.updated || 0),
                    });
                }
            }

            if (!matches.length) return null;

            matches.sort((a, b) => b.updated - a.updated);
            return matches[0];
        }

        function applyCachedRecordingChoice(track) {
            if (pageWindow().__MB_RECORDING_MATCHER_ACTIVE__) return false;
            if (!track || typeof track.recording !== 'function') return false;
            if (typeof track.hasExistingRecording === 'function' && track.hasExistingRecording()) {
                return false;
            }
    
            const match = cachedCandidateForTrack(track);
            if (!match) return false;
    
            const gid = recordingGid(match.candidate);
            if (!gid) return false;
    
            track.recording(match.candidate);
    
            console.info(
                `[${SCRIPT_NAME}] Reused cached recording ${gid} for ISRC ${match.isrc}.`
            );
            return true;
        }
    
        function watchTrackForCachedRecordingChoice(track) {
            if (!track || watchedTracks.has(track)) return;
            watchedTracks.add(track);
    
            if (typeof track.suggestedRecordings?.subscribe === 'function') {
                track.suggestedRecordings.subscribe(() => {
                    applyCachedRecordingChoice(track);
                });
            }
    
            applyCachedRecordingChoice(track);
        }
    
        function watchReleaseTracksForCache() {
            const ed = editor();
            const release = ed?.rootField?.release?.();
            if (!release) return;
    
            for (const medium of unwrap(release.mediums) || []) {
                for (const track of unwrap(medium.tracks) || []) {
                    watchTrackForCachedRecordingChoice(track);
                }
            }
        }
    
        function installManualRecordingChoiceCache() {
            document.addEventListener('change', event => {
                if (!event.isTrusted) return;
    
                const input = event.target;
                if (!input || typeof input.matches !== 'function') return;
                if (!input.matches('#recording-assoc-bubble input[name="recording-selection"]')) {
                    return;
                }
    
                const selectedMbid = String(input.value || '').trim().toLowerCase();
                if (!UUID.test(selectedMbid)) return;
    
                setTimeout(() => {
                    const track = editor()?.recordingBubble?.currentTrack?.();
                    const recording = unwrap(track?.recording);
                    const chosenMbid = recordingGid(recording);
    
                    if (!track || chosenMbid !== selectedMbid) return;
    
                    const isrcs = recordingIsrcs(recording);
                    if (!isrcs.length) return;
    
                    saveIsrcChoice(isrcs, chosenMbid);
    
                    console.info(
                        `[${SCRIPT_NAME}] Cached recording ${chosenMbid} for ISRC(s): ${isrcs.join(', ')}.`
                    );
                }, 0);
            }, true);
    
            window.addEventListener('storage', event => {
                if (
                    event.key === ISRC_CHOICE_CACHE_KEY ||
                    event.key === LEGACY_ISRC_CHOICE_CACHE_KEY
                ) {
                    isrcChoiceCache = loadIsrcChoiceCache();
                }
            });
    
            watchReleaseTracksForCache();
            setInterval(watchReleaseTracksForCache, 1000);
        }
    
        function pageWindow() {
            try {
                return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            } catch {
                return window;
            }
        }
    
        function unwrap(value) {
            return typeof value === 'function' ? value() : value;
        }
    
        function editor() {
            return pageWindow().MB?._releaseEditor || null;
        }
    
        const artistEntityCache = new Map();
    
        function artistMbid(artist) {
            const entity = unwrap(artist) || {};
            const gid = String(unwrap(entity.gid) || '').trim();
            if (UUID.test(gid)) return gid.toLowerCase();
    
            const id = String(unwrap(entity.id) || '').trim();
            return UUID.test(id) ? id.toLowerCase() : '';
        }
    
        function hasLinkedArtistId(artist) {
            const entity = unwrap(artist) || {};
            const id = unwrap(entity.id);
            return Number.isInteger(id) ? id > 0 : /^\d+$/.test(String(id || '')) && Number(id) > 0;
        }
    
        async function resolveArtistEntity(artist) {
            const source = unwrap(artist) || {};
            if (hasLinkedArtistId(source)) return source;
    
            const gid = artistMbid(source);
            if (!gid) return null;
    
            const mb = pageWindow().MB;
            const cachedMbEntity = mb?.entityCache?.[gid];
            if (cachedMbEntity && hasLinkedArtistId(cachedMbEntity)) {
                return cachedMbEntity;
            }
    
            if (artistEntityCache.has(gid)) {
                return artistEntityCache.get(gid);
            }
    
            const promise = (async () => {
                const response = await __mbToolBoxFetch('/ws/js/entity/' + encodeURIComponent(gid), {
                    credentials: 'same-origin',
                    headers: {Accept: 'application/json'},
                });
                if (!response.ok) {
                    throw new Error('Could not resolve artist ' + gid + ' (HTTP ' + response.status + ')');
                }
    
                const entity = await response.json();
                if (!entity || entity.entityType !== 'artist' || !hasLinkedArtistId(entity)) {
                    throw new Error('MusicBrainz did not return a linkable artist for ' + gid);
                }
    
                if (!entity.gid) entity.gid = gid;
                return entity;
            })();
    
            artistEntityCache.set(gid, promise);
    
            try {
                const entity = await promise;
                artistEntityCache.set(gid, entity);
                return entity;
            } catch (error) {
                artistEntityCache.delete(gid);
                throw error;
            }
        }
    
        async function cloneLinkedArtistCredit(artistCredit) {
            const source = unwrap(artistCredit);
            const names = [];
    
            for (const credit of source?.names || []) {
                const artist = await resolveArtistEntity(credit.artist);
                if (!artist) {
                    throw new Error(
                        'Could not resolve MusicBrainz artist for credit "' +
                        String(unwrap(credit.name) || '').trim() + '"'
                    );
                }
    
                names.push({
                    ...credit,
                    artist,
                    name: unwrap(credit.name) || unwrap(artist.name) || '',
                    joinPhrase: unwrap(credit.joinPhrase ?? credit.join_phrase ?? '') || '',
                });
            }
    
            return {
                ...(source || {}),
                names,
            };
        }
    
        function artistCreditSignature(artistCredit) {
            const source = unwrap(artistCredit);
            return JSON.stringify((source?.names || []).map(credit => {
                const artist = unwrap(credit.artist) || {};
                return {
                    artistId: unwrap(artist.id) ?? null,
                    artistGid: unwrap(artist.gid) || '',
                    artistName: unwrap(artist.name) || '',
                    creditedName: unwrap(credit.name) || '',
                    joinPhrase: unwrap(credit.joinPhrase ?? credit.join_phrase ?? '') || '',
                };
            }));
        }
    
        function hasCompleteRecordingArtistCredit(track, recording) {
            const artistCredit = recording?.artistCredit;
            if (!artistCredit) return false;
    
            try {
                if (typeof track.isCompleteArtistCredit === 'function') {
                    return Boolean(track.isCompleteArtistCredit(artistCredit));
                }
            } catch {
                // Fall through to a conservative structural check.
            }
    
            const names = unwrap(artistCredit)?.names || [];
            return names.length > 0 && names.every(credit => {
                const artist = unwrap(credit.artist);
                return Boolean(artist && (unwrap(artist.gid) || unwrap(artist.id)));
            });
        }
    
        async function ensureMediumLoaded(medium) {
            if (unwrap(medium.loaded)) return true;
    
            if (!unwrap(medium.loading) && typeof medium.loadTracks === 'function') {
                medium.loadTracks();
            }
    
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
                if (unwrap(medium.loaded)) return true;
                await sleep(200);
            }
            return false;
        }
    
        function appendEditNote(ed) {
            const editNote = ed?.rootField?.editNote;
            if (typeof editNote !== 'function') return;
    
            const current = String(editNote() || '');
            if (current.includes(SCRIPT_URL)) return;
    
            editNote(current
                ? `${current.replace(/\s+$/, '')}\n\nScript: ${SCRIPT_URL}`
                : `Script: ${SCRIPT_URL}`);
        }
    
        function setStatus(message, kind = '') {
            const status = document.getElementById(STATUS_ID);
            if (!status) return;
            status.textContent = message;
            __mbToolBoxSetStatusKind(status, kind);
        }
    
        function setButtonsDisabled(disabled) {
            const titleButton = document.getElementById(TITLE_BUTTON_ID);
            const artistButton = document.getElementById(ARTIST_BUTTON_ID);
            if (titleButton) titleButton.disabled = disabled;
            if (artistButton) artistButton.disabled = disabled;
        }
    
        function recordingTitle(recording) {
            return String(unwrap(recording?.name) || '').trim();
        }
    
        function trackTitle(track) {
            return String(unwrap(track?.name) || '').trim();
        }
    
        function writeTrackTitle(track, title, recording) {
            if (!title || typeof track?.name !== 'function') return false;
    
            /*
             * MusicBrainz watches track-title changes and can unlink a recording
             * when the new title differs from the title saved at association time.
             * The new value here comes from that exact linked recording, so update
             * the saved comparison value first to preserve the association.
             */
            if (recording?.gid) {
                track.name.saved = title;
            }
    
            if (typeof track.inputName === 'function') {
                track.inputName(title);
            } else {
                track.name(title);
            }
            return true;
        }
    
        async function copyRecordingTitles() {
            const ed = editor();
            const release = ed?.rootField?.release?.();
    
            if (!release) {
                setStatus('MusicBrainz release editor is not ready.', 'bad');
                return;
            }
    
            setButtonsDisabled(true);
            setStatus('Loading linked recordings...');
    
            try {
                const mediums = unwrap(release.mediums) || [];
                let changed = 0;
                let unchanged = 0;
                let skipped = 0;
                let loadFailures = 0;
    
                for (const medium of mediums) {
                    if (!(await ensureMediumLoaded(medium))) {
                        loadFailures++;
                        continue;
                    }
    
                    const tracks = unwrap(medium.tracks) || [];
                    for (const track of tracks) {
                        const recording = unwrap(track.recording);
                        const sourceTitle = recordingTitle(recording);
    
                        if (!recording?.gid || !sourceTitle) {
                            skipped++;
                            continue;
                        }
    
                        if (trackTitle(track) === sourceTitle) {
                            unchanged++;
                            continue;
                        }
    
                        if (writeTrackTitle(track, sourceTitle, recording)) {
                            changed++;
                        } else {
                            skipped++;
                        }
                    }
                }
    
                if (changed) appendEditNote(ed);
    
                const parts = [];
                if (changed) parts.push(`${changed} title(s) copied`);
                if (unchanged) parts.push(`${unchanged} already identical`);
                if (skipped) parts.push(`${skipped} skipped`);
                if (loadFailures) parts.push(`${loadFailures} medium(s) failed to load`);
    
                setStatus(
                    parts.length ? parts.join(' | ') : 'No tracks found.',
                    changed ? 'ok' : (loadFailures ? 'bad' : '')
                );
            } catch (error) {
                console.error(`[${SCRIPT_NAME}]`, error);
                setStatus(`Error: ${error.message}`, 'bad');
            } finally {
                setButtonsDisabled(false);
            }
        }
    
        async function copyRecordingArtistCredits() {
            const ed = editor();
            const release = ed?.rootField?.release?.();
    
            if (!release) {
                setStatus('MusicBrainz release editor is not ready.', 'bad');
                return;
            }
    
            setButtonsDisabled(true);
            setStatus('Loading linked recordings...');
    
            try {
                const mediums = unwrap(release.mediums) || [];
                let changed = 0;
                let unchanged = 0;
                let skipped = 0;
                let loadFailures = 0;
    
                for (const medium of mediums) {
                    if (!(await ensureMediumLoaded(medium))) {
                        loadFailures++;
                        continue;
                    }
    
                    const tracks = unwrap(medium.tracks) || [];
                    for (const track of tracks) {
                        const recording = unwrap(track.recording);
    
                        if (!recording?.gid || !hasCompleteRecordingArtistCredit(track, recording)) {
                            skipped++;
                            continue;
                        }
    
                        const sourceCredit = recording.artistCredit;
                        const before = artistCreditSignature(track.artistCredit);
                        const after = artistCreditSignature(sourceCredit);
    
                        if (before === after) {
                            unchanged++;
                            continue;
                        }
    
                        const linkedCredit = await cloneLinkedArtistCredit(sourceCredit);
                        track.artistCredit(linkedCredit);
                        changed++;
                    }
                }
    
                if (changed) appendEditNote(ed);
    
                const parts = [];
                if (changed) parts.push(`${changed} artist credit(s) copied`);
                if (unchanged) parts.push(`${unchanged} already identical`);
                if (skipped) parts.push(`${skipped} skipped`);
                if (loadFailures) parts.push(`${loadFailures} medium(s) failed to load`);
    
                setStatus(
                    parts.length ? parts.join(' | ') : 'No tracks found.',
                    changed ? 'ok' : (loadFailures ? 'bad' : '')
                );
            } catch (error) {
                console.error(`[${SCRIPT_NAME}]`, error);
                setStatus(`Error: ${error.message}`, 'bad');
            } finally {
                setButtonsDisabled(false);
            }
        }
    
        function insertButtons() {
            if (document.getElementById(WRAPPER_ID)) return true;

            const tracklist = document.getElementById('tracklist');
            if (!tracklist) return false;

            const wrapper = document.createElement('fieldset');
            wrapper.id = WRAPPER_ID;
            wrapper.className = 'mb-toolbox-native-panel';

            const legend = document.createElement('legend');
            legend.textContent = 'Recording data';

            const actions = document.createElement('div');
            actions.className = 'buttons mb-toolbox-native-actions';

            const titleButton = document.createElement('button');
            titleButton.id = TITLE_BUTTON_ID;
            titleButton.type = 'button';
            titleButton.textContent = 'Copy recording titles to tracks';
            titleButton.title = 'Replace track titles with the titles of their linked MusicBrainz recordings';
            titleButton.addEventListener('click', copyRecordingTitles);

            const artistButton = document.createElement('button');
            artistButton.id = ARTIST_BUTTON_ID;
            artistButton.type = 'button';
            artistButton.textContent = 'Copy recording artist credits to tracks';
            artistButton.title = 'Replace track artist credits with the exact artist credits of their linked MusicBrainz recordings';
            artistButton.addEventListener('click', copyRecordingArtistCredits);

            const status = document.createElement('span');
            status.id = STATUS_ID;
            status.className = 'mb-toolbox-native-status';
            status.setAttribute('role', 'status');

            actions.append(titleButton, artistButton);
            wrapper.append(legend, actions, status);
            tracklist.insertBefore(wrapper, tracklist.firstChild);

            return true;
        }

        installManualRecordingChoiceCache();
    
        if (!insertButtons()) {
            const observer = new MutationObserver(() => {
                if (insertButtons()) observer.disconnect();
            });
            observer.observe(document.documentElement, { childList: true, subtree: true });
        }
    })();
    }

    // ============================================================================
    // Duplicate Edit Checker
    // Source merged from: musicbrainz-tools/duplicate-edit-checker/MusicBrainz_Duplicate_Edit_Checker.user.js
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/release/add*","https://musicbrainz.org/release/*/edit*","https://beta.musicbrainz.org/release/add*","https://beta.musicbrainz.org/release/*/edit*"], [])) {
    (() => {
        'use strict';
    
        const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js';
        const STATUS_ID = 'mb-duplicate-edit-checker-status';
        const MODAL_ID = 'mb-duplicate-edit-checker-modal';
        const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const OPEN_STATUS = 1;
        const PREVIEW_WAIT_MS = 5000;
        const EDITOR_WAIT_MS = 20000;
        const MAX_CONCURRENT_DATA_REQUESTS = 6;
    
        const runtime = {
            active: false,
            checking: false,
            pendingHashes: new Set(),
            seenSubmissionHashes: new Set(),
            skipRepeatedInSubmission: true,
        };
    
        function pageWindow() {
            try {
                return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
            } catch {
                return window;
            }
        }
    
        function unwrap(value) {
            return typeof value === 'function' ? value() : value;
        }
    
        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    
        function getEditor() {
            return pageWindow().MB?._releaseEditor || null;
        }
    
        async function waitForEditor() {
            const deadline = Date.now() + EDITOR_WAIT_MS;
            while (Date.now() < deadline) {
                const ed = getEditor();
                if (
                    ed &&
                    typeof ed.submitEdits === 'function' &&
                    typeof ed.allEdits === 'function' &&
                    Array.isArray(ed.orderedEditSubmissions)
                ) {
                    return ed;
                }
                await sleep(100);
            }
            return null;
        }
    
        function currentEdits(ed) {
            const edits = unwrap(ed?.allEdits);
            return Array.isArray(edits) ? edits.filter(Boolean) : [];
        }
    
        function snapshotKey(edits) {
            return edits.map((edit, index) => String(edit?.hash || `no-hash-${index}`)).join('\u0000');
        }
    
        function appendEditNote(ed) {
            const editNote = ed?.rootField?.editNote;
            if (typeof editNote !== 'function') return;
    
            const current = String(editNote() || '');
            if (current.includes(SCRIPT_URL)) return;
    
            editNote(current
                ? `${current.replace(/\s+$/, '')}\n\nScript: ${SCRIPT_URL}`
                : `Script: ${SCRIPT_URL}`);
        }
    
        function ensureStatusElement() {
            let status = document.getElementById(STATUS_ID);
            if (status) return status;
    
            const submit = document.getElementById('enter-edit');
            if (!submit?.parentElement) return null;
    
            status = document.createElement('span');
            status.id = STATUS_ID;
            status.className = 'mb-toolbox-native-status';
            status.setAttribute('role', 'status');
            status.hidden = true;
            status.style.display = 'inline-block';
            status.style.marginRight = '0.75em';
            submit.parentElement.insertBefore(status, submit);
            return status;
        }
    
        function setStatus(message, kind = '') {
            const status = ensureStatusElement();
            if (!status) return;
    
            status.textContent = message || '';
            status.hidden = !message;
            __mbToolBoxSetStatusKind(status, kind);
        }
    
        function setSubmitButtonBusy(busy) {
            const button = document.getElementById('enter-edit');
            if (!button) return;
            button.dataset.mbDuplicateCheckerBusy = busy ? '1' : '0';
            button.setAttribute('aria-busy', busy ? 'true' : 'false');
            button.style.cursor = busy ? 'progress' : '';
        }
    
        function normalizeText(value) {
            return String(value ?? '')
                .normalize('NFKC')
                .replace(/[\u200B-\u200D\uFEFF]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }
    
        function getDirectRows(table) {
            const rows = [];
            for (const child of table?.children || []) {
                const tag = child.tagName?.toUpperCase();
                if (tag === 'TR') {
                    rows.push(child);
                } else if (tag === 'TBODY' || tag === 'THEAD' || tag === 'TFOOT') {
                    for (const row of child.children || []) {
                        if (row.tagName?.toUpperCase() === 'TR') rows.push(row);
                    }
                }
            }
            return rows;
        }
    
        function rowText(row) {
            const clone = row.cloneNode(true);
            clone.querySelectorAll('script, style, noscript').forEach(node => node.remove());
            return normalizeText(clone.textContent);
        }
    
        function fingerprintFromRoot(root) {
            const table = root?.matches?.('table.details')
                ? root
                : root?.querySelector?.('table.details');
            if (!table) return null;
    
            const classKey = [...table.classList].sort().join(' ');
            const rows = getDirectRows(table).map(rowText).filter(Boolean);
            return rows.length ? {classKey, rows} : null;
        }
    
        function fingerprintFromHtml(html) {
            if (!html) return null;
            const doc = new DOMParser().parseFromString(String(html), 'text/html');
            return fingerprintFromRoot(doc.body);
        }
    
        function arraysEqual(a, b) {
            return a.length === b.length && a.every((value, index) => value === b[index]);
        }
    
        function fingerprintsEqual(proposed, open) {
            if (!proposed || !open) return false;
            if (proposed.classKey !== open.classKey) return false;
    
            if (arraysEqual(proposed.rows, open.rows)) return true;
    
            // Several MusicBrainz preview components intentionally hide only the
            // entity-context row (usually "Release:") while the open-edit view
            // includes it. Allow exactly that one leading-row difference, but no
            // other superset/subset matching.
            return (
                open.rows.length === proposed.rows.length + 1 &&
                arraysEqual(proposed.rows, open.rows.slice(1))
            );
        }
    
        function existingPreviewMap(ed) {
            const map = new Map();
            const previews = unwrap(ed?.editPreviews);
            if (!Array.isArray(previews)) return map;
    
            for (const preview of previews) {
                if (preview?.editHash) map.set(String(preview.editHash), preview);
            }
            return map;
        }
    
        function stripHash(edit) {
            const copy = {...edit};
            delete copy.hash;
            return copy;
        }
    
        async function requestMissingPreviews(edits) {
            if (!edits.length) return [];
    
            const response = await __mbToolBoxFetch('/ws/js/edit/preview', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json; charset=utf-8',
                },
                body: JSON.stringify({
                    edits: edits.map(stripHash),
                    makeVotable: false,
                }),
            });
    
            if (!response.ok) {
                throw new Error(`MusicBrainz preview request failed: HTTP ${response.status}`);
            }
    
            const data = await response.json();
            if (!Array.isArray(data?.previews) || data.previews.length !== edits.length) {
                throw new Error('MusicBrainz returned an incomplete edit preview response.');
            }
            return data.previews;
        }
    
        async function ensurePreviews(ed, edits) {
            const deadline = Date.now() + PREVIEW_WAIT_MS;
            while (Date.now() < deadline && unwrap(ed?.loadingEditPreviews)) {
                setStatus('Waiting for MusicBrainz edit previews...');
                await sleep(100);
            }
    
            const map = existingPreviewMap(ed);
            const missing = edits.filter(edit => !map.has(String(edit.hash || '')));
    
            if (missing.length) {
                setStatus(`Building ${missing.length} missing edit preview${missing.length === 1 ? '' : 's'}...`);
                const previews = await requestMissingPreviews(missing);
                previews.forEach((preview, index) => {
                    map.set(String(missing[index].hash || ''), {
                        ...preview,
                        editHash: missing[index].hash,
                    });
                });
            }
    
            return map;
        }
    
        function getReleaseInfo(ed) {
            const release = unwrap(ed?.rootField?.release) || null;
            const releaseGid = normalizeText(unwrap(release?.gid));
            const releaseGroup = unwrap(release?.releaseGroup) || null;
            const releaseGroupGid = normalizeText(unwrap(releaseGroup?.gid));
            return {release, releaseGid, releaseGroupGid};
        }
    
        function scopeForEdit(edit, releaseInfo) {
            const enteredFrom = edit?.enteredFrom || edit?.entered_from || null;
            const enteredFromType = String(enteredFrom?.entity_type || enteredFrom?.entityType || '');
            const toEdit = normalizeText(edit?.to_edit);
            const gid = normalizeText(edit?.gid);
    
            if (enteredFromType === 'release' && UUID.test(toEdit)) {
                return `recording/${toEdit}`;
            }
    
            if (enteredFromType === 'release' && UUID.test(gid)) {
                return `release-group/${gid}`;
            }
    
            if (UUID.test(releaseInfo.releaseGid)) {
                return `release/${releaseInfo.releaseGid}`;
            }
    
            // A brand-new release has no entity page and therefore cannot already
            // have release-level open edits. Recording / release-group edits above
            // are still checked because those entities already exist.
            return null;
        }
    
        function buildProposals(edits, previewMap, releaseInfo) {
            return edits.map((edit, index) => {
                const preview = previewMap.get(String(edit.hash || '')) || null;
                const fingerprint = fingerprintFromHtml(preview?.preview);
                if (!fingerprint) {
                    throw new Error(`Could not read MusicBrainz preview for edit ${index + 1}.`);
                }
                return {
                    index,
                    edit,
                    hash: String(edit.hash || ''),
                    editType: Number(edit.edit_type),
                    editName: normalizeText(preview?.editName) || `Edit ${index + 1}`,
                    fingerprint,
                    scope: scopeForEdit(edit, releaseInfo),
                };
            });
        }
    
        function parsePageNumber(url, expectedPath) {
            try {
                const parsed = new URL(url, location.href);
                if (parsed.pathname !== expectedPath) return null;
                const page = Number(parsed.searchParams.get('page'));
                return Number.isInteger(page) && page > 0 ? page : null;
            } catch {
                return null;
            }
        }
    
        async function fetchDocument(url) {
            const response = await __mbToolBoxFetch(url, {
                credentials: 'same-origin',
                headers: {Accept: 'text/html'},
            });
            if (!response.ok) {
                throw new Error(`Could not load ${url}: HTTP ${response.status}`);
            }
            const html = await response.text();
            return new DOMParser().parseFromString(html, 'text/html');
        }
    
        function extractOpenEditBlocks(doc) {
            const result = [];
            for (const block of doc.querySelectorAll('.edit-list')) {
                const idInput = block.querySelector('input[type="hidden"][name$=".edit_id"]');
                const id = Number(idInput?.value);
                const details = block.querySelector('.edit-details');
                const fingerprint = fingerprintFromRoot(details);
                if (Number.isInteger(id) && id > 0 && fingerprint) {
                    result.push({id, fingerprint});
                }
            }
            return result;
        }
    
        async function fetchOpenEditBlocks(scope, progress) {
            const baseUrl = new URL(`/${scope}/open_edits`, location.origin);
            const firstDoc = await fetchDocument(baseUrl.href);
            progress.pagesDone += 1;
            setStatus(`Checking open edits... ${progress.pagesDone} page${progress.pagesDone === 1 ? '' : 's'} loaded`);
    
            let maxPage = 1;
            for (const link of firstDoc.querySelectorAll('a[href]')) {
                const page = parsePageNumber(link.getAttribute('href'), baseUrl.pathname);
                if (page) maxPage = Math.max(maxPage, page);
            }
    
            const blocks = extractOpenEditBlocks(firstDoc);
            for (let page = 2; page <= maxPage; page += 1) {
                const pageUrl = new URL(baseUrl.href);
                pageUrl.searchParams.set('page', String(page));
                const doc = await fetchDocument(pageUrl.href);
                blocks.push(...extractOpenEditBlocks(doc));
                progress.pagesDone += 1;
                setStatus(`Checking open edits... ${progress.pagesDone} pages loaded`);
            }
            return blocks;
        }
    
        async function mapLimit(items, limit, worker) {
            const results = new Array(items.length);
            let cursor = 0;
    
            async function run() {
                while (true) {
                    const index = cursor;
                    cursor += 1;
                    if (index >= items.length) return;
                    results[index] = await worker(items[index], index);
                }
            }
    
            const count = Math.min(Math.max(1, limit), Math.max(1, items.length));
            await Promise.all(Array.from({length: count}, run));
            return results;
        }
    
        async function fetchEditData(id) {
            const response = await __mbToolBoxFetch(`/edit/${id}/data`, {
                credentials: 'same-origin',
                headers: {Accept: 'application/json'},
            });
            if (!response.ok) {
                throw new Error(`Could not inspect MusicBrainz edit #${id}: HTTP ${response.status}`);
            }
            return response.json();
        }
    
        function groupByScope(proposals) {
            const groups = new Map();
            for (const proposal of proposals) {
                if (!proposal.scope) continue;
                if (!groups.has(proposal.scope)) groups.set(proposal.scope, []);
                groups.get(proposal.scope).push(proposal);
            }
            return groups;
        }
    
        function buildInSubmissionDuplicateInfo(proposals, pendingHashes) {
            const seen = new Set();
            const repeated = [];
            for (const proposal of proposals) {
                if (pendingHashes.has(proposal.hash)) continue;
                if (proposal.hash && seen.has(proposal.hash)) {
                    repeated.push(proposal);
                } else if (proposal.hash) {
                    seen.add(proposal.hash);
                }
            }
            return repeated;
        }
    
        async function analyzeDuplicates(ed, edits) {
            setStatus(`Preparing duplicate check for ${edits.length} edit${edits.length === 1 ? '' : 's'}...`);
            const previewMap = await ensurePreviews(ed, edits);
            const proposals = buildProposals(edits, previewMap, getReleaseInfo(ed));
            const groups = groupByScope(proposals);
            const pendingHashes = new Set();
            const matchesByHash = new Map();
            const progress = {pagesDone: 0};
    
            let groupIndex = 0;
            for (const [scope, scopedProposals] of groups) {
                groupIndex += 1;
                setStatus(`Checking pending edits... entity ${groupIndex}/${groups.size}`);
                const blocks = await fetchOpenEditBlocks(scope, progress);
    
                const candidatePairs = [];
                for (const block of blocks) {
                    for (const proposal of scopedProposals) {
                        if (fingerprintsEqual(proposal.fingerprint, block.fingerprint)) {
                            candidatePairs.push({block, proposal});
                        }
                    }
                }
    
                if (!candidatePairs.length) continue;
    
                const uniqueIds = [...new Set(candidatePairs.map(pair => pair.block.id))];
                setStatus(`Verifying ${uniqueIds.length} possible duplicate${uniqueIds.length === 1 ? '' : 's'}...`);
                const dataList = await mapLimit(
                    uniqueIds,
                    MAX_CONCURRENT_DATA_REQUESTS,
                    id => fetchEditData(id),
                );
                const dataById = new Map(uniqueIds.map((id, index) => [id, dataList[index]]));
    
                for (const {block, proposal} of candidatePairs) {
                    const data = dataById.get(block.id);
                    if (
                        Number(data?.status) === OPEN_STATUS &&
                        Number(data?.type) === proposal.editType
                    ) {
                        pendingHashes.add(proposal.hash);
                        if (!matchesByHash.has(proposal.hash)) matchesByHash.set(proposal.hash, new Set());
                        matchesByHash.get(proposal.hash).add(block.id);
                    }
                }
            }
    
            const repeated = buildInSubmissionDuplicateInfo(proposals, pendingHashes);
            const repeatedIndexes = new Set(repeated.map(proposal => proposal.index));
            const pendingCount = proposals.filter(proposal => pendingHashes.has(proposal.hash)).length;
            const repeatedCount = repeated.length;
            const newCount = proposals.length - pendingCount - repeatedCount;
    
            return {
                proposals,
                pendingHashes,
                matchesByHash,
                repeatedIndexes,
                pendingCount,
                repeatedCount,
                newCount,
                total: proposals.length,
            };
        }
    
        function addModalStyles() {
            // Shared Toolbox native-UI CSS handles the dialog layout.
        }

        function closeModal() {
            document.getElementById(MODAL_ID)?.remove();
        }

        function makeButton(label, className, value, resolve) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            if (className) button.className = className;
            button.addEventListener('click', () => {
                closeModal();
                resolve(value);
            });
            return button;
        }

        function openEditLink(id) {
            const link = document.createElement('a');
            link.href = `/edit/${id}`;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = `Edit #${id}`;
            return link;
        }

        function appendDialog(root) {
            (document.getElementById('release-editor') || document.body).appendChild(root);
        }

        function createDialogShell(title) {
            const overlay = document.createElement('div');
            overlay.id = MODAL_ID;
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');

            const dialog = document.createElement('fieldset');
            dialog.className = 'mb-dec-dialog';

            const legend = document.createElement('legend');
            legend.textContent = title;
            dialog.appendChild(legend);
            overlay.appendChild(dialog);

            return {overlay, dialog};
        }

        function buildSummaryTable(result) {
            const table = document.createElement('table');
            table.className = 'tbl mb-dec-summary';

            const head = document.createElement('thead');
            const headRow = document.createElement('tr');
            const body = document.createElement('tbody');
            const valueRow = document.createElement('tr');

            const stats = [
                ['Proposed', result.total],
                ['Already pending', result.pendingCount],
                ['Repeated here', result.repeatedCount],
                ['New', result.newCount],
            ];

            for (const [label, value] of stats) {
                const th = document.createElement('th');
                th.textContent = label;
                headRow.appendChild(th);

                const td = document.createElement('td');
                td.textContent = String(value);
                valueRow.appendChild(td);
            }

            head.appendChild(headRow);
            body.appendChild(valueRow);
            table.append(head, body);
            return table;
        }

        function showDuplicateDialog(result) {
            closeModal();

            return new Promise(resolve => {
                const {overlay, dialog} = createDialogShell(
                    result.newCount
                        ? 'Duplicate pending edits found'
                        : 'All proposed edits are duplicates'
                );

                const intro = document.createElement('p');
                intro.textContent = result.newCount
                    ? 'Exact duplicates will be skipped as one batch. No existing MusicBrainz edits are cancelled or changed.'
                    : 'Nothing new needs to be submitted. No existing MusicBrainz edits are cancelled or changed.';
                dialog.appendChild(intro);
                dialog.appendChild(buildSummaryTable(result));

                if (result.pendingCount) {
                    const details = document.createElement('details');
                    const summaryNode = document.createElement('summary');
                    summaryNode.textContent = `Show pending duplicates (${result.pendingCount})`;
                    details.appendChild(summaryNode);

                    const list = document.createElement('ol');
                    list.className = 'mb-dec-list';
                    const shown = new Set();

                    for (const proposal of result.proposals) {
                        if (!result.pendingHashes.has(proposal.hash) || shown.has(proposal.hash)) continue;
                        shown.add(proposal.hash);

                        const item = document.createElement('li');
                        item.append(document.createTextNode(`${proposal.editName} - `));
                        const ids = [...(result.matchesByHash.get(proposal.hash) || [])];
                        ids.forEach((id, index) => {
                            if (index) item.append(document.createTextNode(', '));
                            item.appendChild(openEditLink(id));
                        });
                        list.appendChild(item);
                    }

                    details.appendChild(list);
                    dialog.appendChild(details);
                }

                if (result.repeatedCount) {
                    const note = document.createElement('p');
                    note.textContent = `${result.repeatedCount} duplicate edit${result.repeatedCount === 1 ? '' : 's'} also appear more than once in this same submission; only the first copy will be kept.`;
                    dialog.appendChild(note);
                }

                const buttons = document.createElement('div');
                buttons.className = 'buttons mb-dec-buttons';

                if (result.newCount > 0) {
                    buttons.appendChild(makeButton(
                        `Submit ${result.newCount} new edit${result.newCount === 1 ? '' : 's'}`,
                        'positive',
                        'submit-new',
                        resolve,
                    ));
                } else {
                    buttons.appendChild(makeButton('Close', 'positive', 'cancel', resolve));
                }

                buttons.appendChild(makeButton(
                    `Submit all ${result.total} anyway`,
                    '',
                    'submit-all',
                    resolve,
                ));
                buttons.appendChild(makeButton('Cancel', 'negative', 'cancel', resolve));

                dialog.appendChild(buttons);
                appendDialog(overlay);
                dialog.querySelector('button')?.focus();
            });
        }

        function showErrorDialog(error) {
            closeModal();

            return new Promise(resolve => {
                const {overlay, dialog} = createDialogShell('Duplicate check failed');

                const message = document.createElement('p');
                message.className = 'error';
                message.textContent = String(error?.message || error || 'Unknown error');
                dialog.appendChild(message);

                const explanation = document.createElement('p');
                explanation.textContent = 'No edits have been submitted. Retry the check, submit everything without filtering, or cancel.';
                dialog.appendChild(explanation);

                const buttons = document.createElement('div');
                buttons.className = 'buttons mb-dec-buttons';
                buttons.appendChild(makeButton('Retry duplicate check', 'positive', 'retry', resolve));
                buttons.appendChild(makeButton('Submit all anyway', '', 'submit-all', resolve));
                buttons.appendChild(makeButton('Cancel', 'negative', 'cancel', resolve));
                dialog.appendChild(buttons);

                appendDialog(overlay);
                dialog.querySelector('button')?.focus();
            });
        }

        function installSubmissionFilters(ed) {
            if (ed.__mbDuplicateEditCheckerFiltersInstalled) return;
    
            for (const submission of ed.orderedEditSubmissions) {
                if (!submission || typeof submission.edits !== 'function') continue;
                const original = submission.edits;
                submission.edits = function (...args) {
                    const edits = original.apply(this, args);
                    if (!runtime.active || !Array.isArray(edits)) return edits;
    
                    return edits.filter(edit => {
                        const hash = String(edit?.hash || '');
                        if (!hash) return true;
                        if (runtime.pendingHashes.has(hash)) return false;
                        if (runtime.skipRepeatedInSubmission && runtime.seenSubmissionHashes.has(hash)) return false;
                        runtime.seenSubmissionHashes.add(hash);
                        return true;
                    });
                };
            }
    
            ed.__mbDuplicateEditCheckerFiltersInstalled = true;
        }
    
        function prepareFilteredSubmission(result) {
            runtime.pendingHashes = new Set(result.pendingHashes);
            runtime.seenSubmissionHashes = new Set();
            runtime.skipRepeatedInSubmission = true;
            runtime.active = true;
        }
    
        function prepareUnfilteredSubmission() {
            runtime.pendingHashes = new Set();
            runtime.seenSubmissionHashes = new Set();
            runtime.skipRepeatedInSubmission = false;
            runtime.active = false;
        }
    
        async function install() {
            const ed = await waitForEditor();
            if (!ed || ed.__mbDuplicateEditCheckerInstalled) return;
    
            ed.__mbDuplicateEditCheckerInstalled = true;
            installSubmissionFilters(ed);
            ensureStatusElement();
    
            const originalSubmit = ed.submitEdits;
    
            ed.submitEdits = async function (...args) {
                if (runtime.checking) return;
                if (typeof ed.allowsSubmission === 'function' && !ed.allowsSubmission()) return;
    
                runtime.checking = true;
                runtime.active = false;
                runtime.pendingHashes = new Set();
                runtime.seenSubmissionHashes = new Set();
                setSubmitButtonBusy(true);
    
                try {
                    while (true) {
                        const edits = currentEdits(ed);
                        if (!edits.length) return;
                        const before = snapshotKey(edits);
    
                        let result;
                        try {
                            result = await analyzeDuplicates(ed, edits);
                        } catch (error) {
                            setStatus('Duplicate check failed.', 'error');
                            const choice = await showErrorDialog(error);
                            if (choice === 'retry') continue;
                            if (choice === 'submit-all') {
                                prepareUnfilteredSubmission();
                                appendEditNote(ed);
                                setStatus(`Submitting all ${edits.length} edits without duplicate filtering...`);
                                originalSubmit.apply(ed, args);
                            } else {
                                setStatus('Submission cancelled.');
                            }
                            return;
                        }
    
                        const afterEdits = currentEdits(ed);
                        if (snapshotKey(afterEdits) !== before) {
                            setStatus('Edits changed during the check. Checking the updated submission...');
                            continue;
                        }
    
                        const skippedCount = result.pendingCount + result.repeatedCount;
                        if (!skippedCount) {
                            prepareUnfilteredSubmission();
                            appendEditNote(ed);
                            setStatus(`No pending duplicates found. Submitting ${result.total} edit${result.total === 1 ? '' : 's'}...`, 'success');
                            originalSubmit.apply(ed, args);
                            return;
                        }
    
                        const choice = await showDuplicateDialog(result);
                        if (choice === 'submit-new') {
                            if (snapshotKey(currentEdits(ed)) !== before) {
                                setStatus('Edits changed. Rechecking before submission...');
                                continue;
                            }
                            prepareFilteredSubmission(result);
                            appendEditNote(ed);
                            setStatus(`Submitting ${result.newCount} new edit${result.newCount === 1 ? '' : 's'}; skipping ${skippedCount} duplicate${skippedCount === 1 ? '' : 's'}...`, 'success');
                            originalSubmit.apply(ed, args);
                        } else if (choice === 'submit-all') {
                            prepareUnfilteredSubmission();
                            appendEditNote(ed);
                            setStatus(`Submitting all ${result.total} edits...`);
                            originalSubmit.apply(ed, args);
                        } else {
                            setStatus('Submission cancelled.');
                        }
                        return;
                    }
                } finally {
                    runtime.checking = false;
                    setSubmitButtonBusy(false);
                }
            };
        }
    
        install().catch(error => {
            console.error('[MusicBrainz - Duplicate Edit Checker]', error);
            setStatus(`Duplicate Edit Checker failed to initialize: ${error?.message || error}`, 'error');
        });
    })();
    }

    // ============================================================================
    // Barcode vs Linked Releases Checker
    // Source merged from: musicbrainz-tools/barcode-linked-release-checker/MusicBrainz_Barcode_Linked_Release_Checker.user.js
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/release-group/*","https://beta.musicbrainz.org/release-group/*","https://musicbrainz.org/release/*/edit","https://beta.musicbrainz.org/release/*/edit"], ["https://musicbrainz.org/release-group/*/*","https://beta.musicbrainz.org/release-group/*/*"])) {
    (() => {
        'use strict';
    
        const SCRIPT_NAME = 'MusicBrainz - Barcode vs Linked Releases Checker';
        const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js';
        const HARMONY_URL = 'https://harmony.pulsewidth.org.uk/';
        const APPLE_API_BASE = 'https://amp-api.music.apple.com/v1';
        const TASK_PREFIX = 'mb-barcode-link-checker:';
        let appleTokenPromise = null;
    
        const RELEASE_LINK_TYPE_IDS = new Map([
            ['free streaming', 85],
            ['streaming', 980],
            ['paid streaming', 980],
            ['purchase for download', 74],
            ['paid download', 74],
            ['download for free', 75],
            ['free download', 75],
            ['purchase for mail-order', 79],
            ['mail order', 79],
            ['discography entry', 288],
            ['license', 301],
            ['get the music', 73],
            ['production', 72],
            ['crowdfunding page', 906],
            ['show notes', 729],
            ['other databases', 82],
            ['discogs', 76],
            ['vgmdb', 86],
            ['secondhandsongs', 308],
            ['allmusic', 755],
            ['bookbrainz', 850],
        ]);
    
        const PROVIDER_LABELS = {
            spotify: 'Spotify',
            deezer: 'Deezer',
            tidal: 'TIDAL',
            apple: 'Apple Music/iTunes',
            qobuz: 'Qobuz',
            beatport: 'Beatport',
            bandcamp: 'Bandcamp',
            discogs: 'Discogs',
            mora: 'Mora',
            ototoy: 'OTOTOY',
            bugs: 'Bugs!',
            melon: 'Melon',
        };
    
        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    
        function normalizeSpace(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        }
    
        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }
    
        function extractMbid(value) {
            return String(value || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0]?.toLowerCase() || '';
        }
    
        function gtinNumber(value) {
            const cleaned = String(value || '').replace(/^0+/, '') || '0';
            try {
                return BigInt(cleaned);
            } catch {
                return null;
            }
        }
    
        function equalGtin(a, b) {
            const left = gtinNumber(a);
            const right = gtinNumber(b);
            return left !== null && right !== null && left === right;
        }
    
        function gtinChecksum(value) {
            const digits = String(value).split('').map(Number);
            const length = digits.length;
            return digits.reduce(
                (sum, digit, index) => sum + digit * ((length - index) % 2 ? 1 : 3),
                0,
            );
        }
    
        function isValidGtin(value) {
            const gtin = String(value || '');
            return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin) &&
                gtinChecksum(gtin) % 10 === 0;
        }
    
        function qobuzNormalizedGtin(value) {
            const gtin = String(value || '');
            if (isValidGtin(gtin)) return gtin;
    
            // Harmony/Qobuz compatibility: some older 13-digit Qobuz IDs omit
            // the GTIN-14 check digit. Append it only when that produces a valid GTIN.
            if (/^\d{13}$/.test(gtin)) {
                const provisional = `${gtin}0`;
                const checkDigit = (10 - (gtinChecksum(provisional) % 10)) % 10;
                const normalized = `${gtin}${checkDigit}`;
                if (isValidGtin(normalized)) return normalized;
            }
    
            return '';
        }
    
        function extractGtinFromProviderUrl(value) {
            let url;
            try {
                url = value instanceof URL ? value : new URL(value);
            } catch {
                return '';
            }
    
            const family = providerFamily(url);
            const parts = url.pathname.split('/').filter(Boolean);
    
            if (family === 'mora') {
                // Example:
                // /package/43000174/093624949107_48/
                // 093624949107 = UPC, _48 = Mora Hi-Res package suffix.
                const packageId = parts.at(-1) || '';
                const candidate = packageId.match(/^(\d{8}|\d{12}|\d{13}|\d{14})(?:_[^/]+)?$/)?.[1] || '';
                return isValidGtin(candidate) ? candidate : '';
            }
    
            if (family === 'qobuz') {
                // Many Qobuz album URLs use the barcode itself as the final album ID.
                // Example: /album/.../0093624447061
                const candidate = parts.at(-1) || '';
                if (!/^\d{8,14}$/.test(candidate)) return '';
                return qobuzNormalizedGtin(candidate);
            }
    
            return '';
        }
    
        function lookupUrlEmbeddedGtin(url) {
            const gtin = extractGtinFromProviderUrl(url);
            if (!gtin) return null;
    
            return {
                sourceUrl: url,
                provider: providerFamily(url),
                found: true,
                gtin,
                externalLinks: [{
                    url,
                    types: providerFamily(url) === 'mora'
                        ? ['paid download']
                        : ['paid streaming', 'paid download'],
                }],
                providers: [providerLabel(url)],
                errors: [],
                lookupUrl: url,
                state: 'ok',
                method: 'url-embedded-gtin',
            };
        }
    
        function providerFamily(value) {
            let url;
            try {
                url = value instanceof URL ? value : new URL(value);
            } catch {
                return '';
            }
    
            const host = url.hostname.toLowerCase().replace(/^www\./, '');
            if (host === 'open.spotify.com') return 'spotify';
            if (host === 'deezer.com') return 'deezer';
            if (host === 'tidal.com' || host === 'listen.tidal.com') return 'tidal';
            if (host === 'music.apple.com' || host === 'itunes.apple.com' || host === 'geo.music.apple.com' || host === 'geo.itunes.apple.com') return 'apple';
            if (host === 'qobuz.com' || host.endsWith('.qobuz.com')) return 'qobuz';
            if (host === 'beatport.com') return 'beatport';
            if (host === 'bandcamp.com' || host.endsWith('.bandcamp.com')) return 'bandcamp';
            if (host === 'discogs.com') return 'discogs';
            if (host === 'mora.jp') return 'mora';
            if (host === 'ototoy.jp') return 'ototoy';
            if (host === 'bugs.co.kr' || host.endsWith('.bugs.co.kr')) return 'bugs';
            if (host === 'melon.com' || host.endsWith('.melon.com')) return 'melon';
            return '';
        }
    
        function providerLabel(url) {
            const family = providerFamily(url);
            return PROVIDER_LABELS[family] || family || 'Provider';
        }
    
        function providerEntityKey(value) {
            let url;
            try {
                url = value instanceof URL ? value : new URL(value);
            } catch {
                return String(value || '');
            }
    
            const family = providerFamily(url);
            const path = url.pathname.replace(/\/+$/, '');
            let match;
    
            switch (family) {
                case 'spotify':
                    match = path.match(/\/(?:intl-[a-z-]+\/)?album\/([A-Za-z0-9]+)/i);
                    break;
                case 'deezer':
                    match = path.match(/\/(?:[a-z]{2}\/)?album\/(\d+)/i);
                    break;
                case 'tidal':
                    match = path.match(/\/album\/(\d+)/i);
                    break;
                case 'apple':
                    match = path.match(/\/album(?:\/[^/]+)?\/(\d+)/i);
                    break;
                case 'qobuz':
                    match = path.match(/\/album\/[^/]+\/([^/]+)$/i) || path.match(/\/album\/([^/]+)$/i);
                    break;
                case 'beatport':
                    match = path.match(/\/release\/[^/]+\/(\d+)/i) || path.match(/\/release\/(\d+)/i);
                    break;
                case 'discogs':
                    match = path.match(/\/release\/(\d+)/i);
                    break;
                default:
                    break;
            }
    
            if (match) return `${family}:${match[1].toLowerCase()}`;
    
            const clean = new URL(url.href);
            clean.hash = '';
            clean.search = '';
            clean.hostname = clean.hostname.toLowerCase().replace(/^www\./, '');
            clean.pathname = clean.pathname.replace(/\/+$/, '');
            return `${family || clean.hostname}:${clean.href.toLowerCase()}`;
        }
    
        function isDigitalRelease(release) {
            return Array.isArray(release.media) &&
                release.media.length > 0 &&
                release.media.every(medium => medium?.format === 'Digital Media');
        }
    
        function releaseRelations(release) {
            return (release.relations || [])
                .filter(rel => rel?.['target-type'] === 'url' && !rel?.ended && rel?.url?.resource)
                .map(rel => rel.url.resource);
        }
    
        function gmTextRequest(url, { headers = {}, timeout = 60000 } = {}) {
            return new Promise((resolve, reject) => {
                __mbToolBoxGmXmlhttpRequest({
                    method: 'GET',
                    url,
                    headers,
                    timeout,
                    onload(response) {
                        if (response.status >= 200 && response.status < 400) {
                            resolve({
                                text: response.responseText,
                                finalUrl: response.finalUrl || url,
                                status: response.status,
                            });
                        } else {
                            reject(new Error(`HTTP ${response.status}: ${url}`));
                        }
                    },
                    ontimeout() {
                        reject(new Error(`Request timed out: ${url}`));
                    },
                    onerror() {
                        reject(new Error(`Request failed: ${url}`));
                    },
                });
            });
        }
    
        function parseAppleAlbumUrl(value) {
            let url;
            try {
                url = new URL(value);
            } catch {
                return null;
            }
    
            if (providerFamily(url) !== 'apple') return null;
    
            // Always use the regular music.apple.com host for token extraction.
            url.hostname = 'music.apple.com';
    
            const parts = url.pathname.split('/').filter(Boolean);
            const albumIndex = parts.findIndex(part => part === 'album');
            if (albumIndex < 0) return null;
    
            const id = parts.slice(albumIndex + 1).reverse().find(part => /^\d+$/.test(part));
            if (!id) return null;
    
            return {
                id,
                storefront: (parts[0] || 'us').toLowerCase(),
                pageUrl: url.href,
            };
        }
    
        async function getAppleMusicToken(seedUrl) {
            if (appleTokenPromise) return appleTokenPromise;
    
            appleTokenPromise = (async () => {
                const pages = [
                    parseAppleAlbumUrl(seedUrl)?.pageUrl,
                    'https://music.apple.com/us/browse',
                ].filter(Boolean);
    
                let lastError = null;
                for (const pageUrl of [...new Set(pages)]) {
                    try {
                        const page = await gmTextRequest(pageUrl);
                        const doc = new DOMParser().parseFromString(page.text, 'text/html');
                        const scripts = [...doc.querySelectorAll('script[crossorigin][src]')];
    
                        for (const script of scripts) {
                            const scriptUrl = new URL(script.getAttribute('src'), pageUrl).href;
                            const source = await gmTextRequest(scriptUrl);
                            const token = source.text.match(/["'](eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["']/)?.[1];
                            if (token) return token;
                        }
                    } catch (error) {
                        lastError = error;
                    }
                }
    
                throw lastError || new Error('Could not extract the Apple Music bearer token.');
            })();
    
            try {
                return await appleTokenPromise;
            } catch (error) {
                appleTokenPromise = null;
                throw error;
            }
        }
    
        async function appleApiRequest(apiUrl, seedUrl) {
            const token = await getAppleMusicToken(seedUrl);
            const response = await gmTextRequest(apiUrl, {
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${token}`,
                    Origin: new URL(APPLE_API_BASE).origin,
                },
            });
            return JSON.parse(response.text);
        }
    
        async function lookupAppleByUrl(url) {
            const parsedUrl = parseAppleAlbumUrl(url);
            const lookupUrl = parsedUrl
                ? `${APPLE_API_BASE}/catalog/${parsedUrl.storefront}/albums/${parsedUrl.id}`
                : '';
    
            if (!parsedUrl) {
                return {
                    sourceUrl: url,
                    provider: 'apple',
                    found: false,
                    gtin: '',
                    externalLinks: [],
                    providers: ['Apple Music'],
                    errors: ['Unsupported Apple Music album URL'],
                    lookupUrl,
                    state: 'failed',
                };
            }
    
            try {
                const json = await appleApiRequest(lookupUrl, parsedUrl.pageUrl);
                const album = (json.data || []).find(item => item.type === 'albums') || json.data?.[0];
                const gtin = album?.attributes?.upc || '';
                const releaseUrl = album?.attributes?.url || parsedUrl.pageUrl;
    
                return {
                    sourceUrl: url,
                    provider: 'apple',
                    found: Boolean(album),
                    gtin,
                    externalLinks: album ? [{ url: releaseUrl, types: ['paid streaming'] }] : [],
                    providers: ['Apple Music'],
                    errors: [],
                    lookupUrl,
                    state: gtin ? 'ok' : (album ? 'no-gtin' : 'failed'),
                };
            } catch (error) {
                return {
                    sourceUrl: url,
                    provider: 'apple',
                    found: false,
                    gtin: '',
                    externalLinks: [],
                    providers: ['Apple Music'],
                    errors: [error.message],
                    lookupUrl,
                    state: 'failed',
                };
            }
        }
    
        async function lookupAppleByBarcode(barcode, seedUrl = 'https://music.apple.com/us/browse') {
            const seed = parseAppleAlbumUrl(seedUrl);
            const storefronts = [...new Set([
                seed?.storefront,
                'us',
                'gb',
                'de',
                'jp',
            ].filter(Boolean))];
    
            const lookupUrls = [];
            let lastError = null;
    
            for (const storefront of storefronts) {
                const url = new URL(`${APPLE_API_BASE}/catalog/${storefront}/albums`);
                url.searchParams.set('filter[upc]', barcode);
                lookupUrls.push(url.href);
    
                try {
                    const json = await appleApiRequest(url.href, seed?.pageUrl || seedUrl);
                    const albums = (json.data || []).filter(item => item.type === 'albums');
                    const album = albums.find(item => equalGtin(item.attributes?.upc, barcode)) || albums[0];
                    if (!album) continue;
    
                    return {
                        found: true,
                        gtin: album.attributes?.upc || barcode,
                        externalLinks: album.attributes?.url
                            ? [{ url: album.attributes.url, types: ['paid streaming'] }]
                            : [],
                        providers: ['Apple Music'],
                        errors: [],
                        lookupUrl: url.href,
                        lookupUrls,
                    };
                } catch (error) {
                    lastError = error;
                }
            }
    
            return {
                found: false,
                gtin: '',
                externalLinks: [],
                providers: ['Apple Music'],
                errors: lastError ? [lastError.message] : [],
                lookupUrl: lookupUrls[0] || '',
                lookupUrls,
            };
        }
    
        async function lookupLinkedUrl(url) {
            const embedded = lookupUrlEmbeddedGtin(url);
            if (embedded) return embedded;
    
            return providerFamily(url) === 'apple'
                ? lookupAppleByUrl(url)
                : lookupHarmonyByUrl(url);
        }
    
        async function lookupByBarcode(barcode, appleSeedUrl) {
            const harmony = await lookupHarmonyByBarcode(barcode);
            harmony.externalLinks = (harmony.externalLinks || [])
                .filter(link => providerFamily(link.url) !== 'apple');
    
            const apple = await lookupAppleByBarcode(barcode, appleSeedUrl);
    
            return {
                found: Boolean(harmony.found || apple.found),
                gtin: harmony.gtin || apple.gtin || '',
                externalLinks: dedupeExternalLinks([
                    ...(harmony.externalLinks || []),
                    ...(apple.externalLinks || []),
                ]),
                providers: [...new Set([
                    ...(harmony.providers || []),
                    ...(apple.providers || []),
                ])],
                errors: [...(harmony.errors || []), ...(apple.errors || [])],
                lookupUrl: [harmony.lookupUrl, apple.lookupUrl].filter(Boolean).join(' | '),
                lookupUrls: [
                    harmony.lookupUrl,
                    ...(apple.lookupUrls || [apple.lookupUrl]),
                ].filter(Boolean),
            };
        }
    
        function harmonyRequest(url) {
            return new Promise((resolve, reject) => {
                __mbToolBoxGmXmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: { Accept: 'text/html,application/xhtml+xml' },
                    timeout: 60000,
                    onload(response) {
                        if (response.status >= 200 && response.status < 400) {
                            resolve({ html: response.responseText, finalUrl: response.finalUrl || url });
                        } else {
                            reject(new Error(`Harmony HTTP ${response.status}`));
                        }
                    },
                    ontimeout() {
                        reject(new Error('Harmony request timed out'));
                    },
                    onerror() {
                        reject(new Error('Harmony request failed'));
                    },
                });
            });
        }
    
        function findReleaseInfoRow(doc, label) {
            const wanted = label.toLowerCase();
            return [...doc.querySelectorAll('table.release-info tr')].find(row => {
                const th = row.querySelector('th');
                return th && normalizeSpace(th.textContent).toLowerCase() === wanted;
            });
        }
    
        function parseHarmony(html, lookupUrl) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const release = doc.querySelector('.release');
            const gtinRow = findReleaseInfoRow(doc, 'GTIN');
            const linksRow = findReleaseInfoRow(doc, 'External links');
            const errors = [...doc.querySelectorAll('.message-box.error, .error-message, .page-error')]
                .map(node => normalizeSpace(node.textContent))
                .filter(Boolean);
    
            let gtin = '';
            if (gtinRow) {
                const text = normalizeSpace(gtinRow.querySelector('td')?.textContent || '');
                gtin = text.match(/\b(?:\d{14}|\d{13}|\d{12}|\d{8})\b/)?.[0] || '';
            }
    
            const externalLinks = [];
            if (linksRow) {
                for (const item of linksRow.querySelectorAll('li')) {
                    const anchor = item.querySelector('a[href]');
                    if (!anchor) continue;
                    const labels = [...item.querySelectorAll('.label')]
                        .map(node => normalizeSpace(node.textContent).toLowerCase())
                        .filter(Boolean);
                    externalLinks.push({
                        url: anchor.href,
                        types: labels,
                    });
                }
            }
    
            const providers = [...doc.querySelectorAll('.provider-list li[data-provider]')]
                .map(node => node.dataset.provider || normalizeSpace(node.textContent).split(':')[0])
                .filter(Boolean);
    
            return {
                found: Boolean(release || gtinRow || linksRow),
                gtin,
                externalLinks,
                providers,
                errors,
                lookupUrl,
            };
        }
    
        async function lookupHarmonyByUrl(url) {
            const lookupUrl = `${HARMONY_URL}release?url=${encodeURIComponent(url)}&gtin=&region=&deezer=&spotify=&tidal=&qobuz=`;
            try {
                const response = await harmonyRequest(lookupUrl);
                const parsed = parseHarmony(response.html, lookupUrl);
                return {
                    sourceUrl: url,
                    provider: providerFamily(url),
                    ...parsed,
                    state: parsed.gtin ? 'ok' : (parsed.found ? 'no-gtin' : 'failed'),
                };
            } catch (error) {
                return {
                    sourceUrl: url,
                    provider: providerFamily(url),
                    found: false,
                    gtin: '',
                    externalLinks: [],
                    providers: [],
                    errors: [error.message],
                    lookupUrl,
                    state: 'failed',
                };
            }
        }
    
        async function lookupHarmonyByBarcode(barcode) {
            const lookupUrl = `${HARMONY_URL}release?gtin=${encodeURIComponent(barcode)}&category=digital`;
            try {
                const response = await harmonyRequest(lookupUrl);
                const parsed = parseHarmony(response.html, lookupUrl);
                parsed.externalLinks = parsed.externalLinks.filter(link => providerFamily(link.url));
                return parsed;
            } catch (error) {
                return {
                    found: false,
                    gtin: '',
                    externalLinks: [],
                    providers: [],
                    errors: [error.message],
                    lookupUrl,
                };
            }
        }
    
        async function mapPool(items, concurrency, worker) {
            const results = new Array(items.length);
            let next = 0;
    
            async function run() {
                while (true) {
                    const index = next++;
                    if (index >= items.length) return;
                    results[index] = await worker(items[index], index);
                }
            }
    
            await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, run));
            return results;
        }
    
        async function fetchReleaseGroupReleases(releaseGroupMbid) {
            const releases = [];
            let offset = 0;
            const limit = 100;
    
            while (true) {
                const url = `/ws/2/release?release-group=${encodeURIComponent(releaseGroupMbid)}` +
                    `&inc=media+url-rels&fmt=json&limit=${limit}&offset=${offset}`;
                const response = await __mbToolBoxFetch(url, {
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json' },
                });
                if (!response.ok) throw new Error(`MusicBrainz API HTTP ${response.status}`);
    
                const data = await response.json();
                const page = data.releases || [];
                releases.push(...page);
    
                if (releases.length >= Number(data['release-count'] || releases.length) || page.length < limit) break;
                offset += limit;
                await sleep(1100);
            }
    
            return releases;
        }
    
        function dedupeExternalLinks(links) {
            const map = new Map();
            for (const link of links || []) {
                if (!providerFamily(link.url)) continue;
                const key = providerEntityKey(link.url);
                if (!map.has(key)) {
                    map.set(key, { url: link.url, types: [...new Set(link.types || [])] });
                } else {
                    const existing = map.get(key);
                    existing.types = [...new Set([...existing.types, ...(link.types || [])])];
                }
            }
            return [...map.values()];
        }
    
        function selectReverseLinks(reverse, existingUrls, wantedFamilies = null) {
            const existingKeys = new Set(existingUrls.map(providerEntityKey));
            return dedupeExternalLinks(reverse?.externalLinks || []).filter(link => {
                if (existingKeys.has(providerEntityKey(link.url))) return false;
                if (wantedFamilies && !wantedFamilies.has(providerFamily(link.url))) return false;
                return true;
            });
        }
    
        function uniqueGtinGroups(checks) {
            const groups = [];
            for (const check of checks.filter(item => item.gtin)) {
                let group = groups.find(item => equalGtin(item.gtin, check.gtin));
                if (!group) {
                    group = { gtin: check.gtin, checks: [] };
                    groups.push(group);
                }
                group.checks.push(check);
            }
            return groups;
        }
    
        function stageBarcodeMatchedReplacements(correction, mismatches, reverseLinks, existingUrls) {
            const existingKeys = new Set(existingUrls.map(providerEntityKey));
            let staged = 0;
    
            for (const check of mismatches) {
                const family = check.provider || providerFamily(check.sourceUrl);
                if (!family) continue;
    
                const replacement = reverseLinks.find(link =>
                    providerFamily(link.url) === family &&
                    providerEntityKey(link.url) !== providerEntityKey(check.sourceUrl)
                );
                if (!replacement) continue;
    
                const wrongKey = providerEntityKey(check.sourceUrl);
    
                if (!correction.removeUrls.some(url => providerEntityKey(url) === wrongKey)) {
                    correction.removeUrls.push(check.sourceUrl);
                }
    
                const replacementKey = providerEntityKey(replacement.url);
                if (
                    !existingKeys.has(replacementKey) &&
                    !correction.addLinks.some(link => providerEntityKey(link.url) === replacementKey)
                ) {
                    correction.addLinks.push(replacement);
                }
    
                correction.linkActions.push({
                    type: 'replace-wrong-link',
                    provider: providerLabel(check.sourceUrl),
                    url: check.sourceUrl,
                    replacementUrl: replacement.url,
                });
                staged++;
            }
    
            return staged;
        }
    
        function buildCorrection(release, checks, reverse) {
            const mbBarcode = release.barcode;
            const existingUrls = releaseRelations(release);
            const successful = checks.filter(check => check.gtin);
            const matches = successful.filter(check => equalGtin(check.gtin, mbBarcode));
            const mismatches = successful.filter(check => !equalGtin(check.gtin, mbBarcode));
            const unreadable = checks.filter(check => !check.gtin);
            const gtinGroups = uniqueGtinGroups(successful);
            const reverseLinks = dedupeExternalLinks(reverse?.externalLinks || []);
            const correction = {
                mbid: release.id,
                title: release.title,
                oldBarcode: mbBarcode,
                newBarcode: '',
                addLinks: [],
                removeUrls: [],
                reasons: [],
                notes: [],
                linkActions: [],
                evidence: checks,
                reverse,
                ambiguous: false,
            };
    
            if (!checks.length) {
                correction.addLinks = selectReverseLinks(reverse, existingUrls);
                if (correction.addLinks.length) {
                    correction.reasons.push(`No supported linked release pages were present; found ${correction.addLinks.length} link(s) by barcode ${mbBarcode}.`);
                } else {
                    correction.notes.push('No supported linked release pages were present, and no provider links were found by barcode.');
                }
                return correction;
            }
    
            if (!successful.length) {
                correction.addLinks = selectReverseLinks(reverse, existingUrls);
                if (correction.addLinks.length) {
                    correction.reasons.push(`Linked pages did not return a usable GTIN; found ${correction.addLinks.length} replacement/additional link(s) by barcode ${mbBarcode}.`);
                } else {
                    correction.notes.push('Linked pages did not return a usable GTIN, and no provider links were found by barcode.');
                }
                if (unreadable.length) {
                    correction.notes.push('Unreadable/dead links are not removed automatically; MusicBrainz guidance generally prefers ending a formerly-correct dead URL relationship.');
                }
                return correction;
            }
    
            if (!mismatches.length) {
                if (unreadable.length) {
                    const deadFamilies = new Set(unreadable.map(check => check.provider).filter(Boolean));
                    correction.addLinks = selectReverseLinks(reverse, existingUrls, deadFamilies);
                    if (correction.addLinks.length) {
                        correction.reasons.push(`Some linked pages were unreadable; found ${correction.addLinks.length} same-provider replacement link(s) by barcode.`);
                    }
                    correction.notes.push('Unreadable/dead links are left in place for manual review/end-date handling.');
                }
                return correction;
            }
    
            if (matches.length) {
                const mismatchFamilies = new Set(mismatches.map(check => check.provider).filter(Boolean));
                correction.addLinks = selectReverseLinks(reverse, existingUrls, mismatchFamilies);
    
                const replaced = stageBarcodeMatchedReplacements(
                    correction,
                    mismatches,
                    reverseLinks,
                    existingUrls
                );
    
                if (replaced) {
                    correction.reasons.push(
                        `Replaced ${replaced} wrongly linked provider release URL(s) with barcode-matched URL(s).`
                    );
                }
    
                const unresolved = mismatches.length - replaced;
                if (unresolved) {
                    correction.notes.push(
                        `${unresolved} mismatching linked page(s) had no same-provider barcode-matched replacement and were left for manual review.`
                    );
                }
                return correction;
            }
    
            if (gtinGroups.length === 1) {
                const externalGtin = gtinGroups[0].gtin;
                const distinctProviders = new Set(successful.map(check => check.provider).filter(Boolean));
    
                if (reverseLinks.length) {
                    correction.addLinks = selectReverseLinks(reverse, existingUrls);
    
                    const replaced = stageBarcodeMatchedReplacements(
                        correction,
                        mismatches,
                        reverseLinks,
                        existingUrls
                    );
    
                    if (replaced) {
                        correction.reasons.push(
                            `Replaced ${replaced} wrongly linked provider release URL(s) with barcode-matched URL(s).`
                        );
                    }
    
                    const unresolved = mismatches.length - replaced;
                    if (unresolved) {
                        correction.notes.push(
                            `${unresolved} mismatching linked page(s) had no same-provider barcode-matched replacement and were left for manual review.`
                        );
                    }
                    return correction;
                }
    
                if (distinctProviders.size >= 2) {
                    correction.newBarcode = externalGtin;
                    correction.reasons.push(
                        `${distinctProviders.size} independent linked providers agree on GTIN ${externalGtin}, while the barcode lookup found no provider pages for MusicBrainz barcode ${mbBarcode}; barcode ${externalGtin} is staged.`,
                    );
                    return correction;
                }
    
                correction.ambiguous = true;
                correction.notes.push(
                    `The only readable linked provider reports GTIN ${externalGtin}, not ${mbBarcode}. One provider is not enough to choose automatically between a wrong barcode and a wrong link.`,
                );
                return correction;
            }
    
            correction.ambiguous = true;
            correction.notes.push(
                `Linked providers disagree with each other (${gtinGroups.map(group => group.gtin).join(', ')}) and none confirms MusicBrainz barcode ${mbBarcode}; no automatic edit was prepared.`,
            );
            return correction;
        }
    
        function reconcileAcrossReleaseGroup(results) {
            const byBarcode = results.filter(result => result.release.barcode);
            const safeRemovalKeys = new Map();
    
            const safeSetFor = mbid => {
                let set = safeRemovalKeys.get(mbid);
                if (!set) {
                    set = new Set();
                    safeRemovalKeys.set(mbid, set);
                }
                return set;
            };
    
            // A same-provider URL found by reverse lookup of this release's barcode
            // is sufficient evidence to replace a linked URL whose own GTIN differs.
            // Preserve those removals during release-group reconciliation.
            for (const result of results) {
                for (const action of result.correction.linkActions || []) {
                    if (action.type === 'replace-wrong-link') {
                        safeSetFor(result.release.id).add(providerEntityKey(action.url));
                    }
                }
            }
    
            const findByGtin = gtin =>
                byBarcode.find(result => equalGtin(result.release.barcode, gtin));
    
            for (const source of results) {
                for (const check of source.checks || []) {
                    if (!check.gtin || equalGtin(check.gtin, source.release.barcode)) continue;
    
                    const target = findByGtin(check.gtin);
                    if (!target || target.release.id === source.release.id) continue;
    
                    const sourceCorrection = source.correction;
                    const targetCorrection = target.correction;
                    const sourceKey = providerEntityKey(check.sourceUrl);
                    const targetReleaseUrl = `https://musicbrainz.org/release/${target.release.id}`;
                    const sourceReleaseUrl = `https://musicbrainz.org/release/${source.release.id}`;
                    const provider = providerLabel(check.sourceUrl);
    
                    const alreadyOnTarget = releaseRelations(target.release)
                        .some(url => providerEntityKey(url) === sourceKey);
    
                    if (alreadyOnTarget) {
                        safeSetFor(source.release.id).add(sourceKey);
    
                        if (!sourceCorrection.removeUrls.some(url => providerEntityKey(url) === sourceKey)) {
                            sourceCorrection.removeUrls.push(check.sourceUrl);
                        }
    
                        sourceCorrection.linkActions.push({
                            type: 'remove-duplicate-wrong-link',
                            provider,
                            url: check.sourceUrl,
                            targetMbid: target.release.id,
                            targetReleaseUrl,
                        });
                        continue;
                    }
    
                    // Preserve the information by staging the same URL on the correct release
                    // before allowing it to be removed from the wrong one.
                    const alreadyStagedOnTarget = targetCorrection.addLinks
                        .some(link => providerEntityKey(link.url) === sourceKey);
    
                    if (!alreadyStagedOnTarget) {
                        const providerLink = (check.externalLinks || []).find(
                            link => providerEntityKey(link.url) === sourceKey
                        );
                        targetCorrection.addLinks.push({
                            url: check.sourceUrl,
                            types: providerLink?.types || [],
                        });
                    }
    
                    const preservedOnTarget = releaseRelations(target.release)
                        .some(url => providerEntityKey(url) === sourceKey) ||
                        targetCorrection.addLinks
                            .some(link => providerEntityKey(link.url) === sourceKey);
    
                    if (!preservedOnTarget) continue;
    
                    safeSetFor(source.release.id).add(sourceKey);
    
                    if (!sourceCorrection.removeUrls.some(url => providerEntityKey(url) === sourceKey)) {
                        sourceCorrection.removeUrls.push(check.sourceUrl);
                    }
    
                    sourceCorrection.linkActions.push({
                        type: 'move-out',
                        provider,
                        url: check.sourceUrl,
                        targetMbid: target.release.id,
                        targetReleaseUrl,
                    });
    
                    targetCorrection.linkActions.push({
                        type: 'move-in',
                        provider,
                        url: check.sourceUrl,
                        sourceMbid: source.release.id,
                        sourceReleaseUrl,
                    });
                }
            }
    
            for (const result of results) {
                const safeKeys = safeRemovalKeys.get(result.release.id) || new Set();
    
                // Keep removals that are proven either by a same-provider
                // barcode-matched replacement or by preserving/moving the URL to
                // another MusicBrainz release in this release group.
                result.correction.removeUrls = [...new Map(
                    result.correction.removeUrls
                        .filter(url => safeKeys.has(providerEntityKey(url)))
                        .map(url => [providerEntityKey(url), url])
                ).values()];
    
                result.correction.addLinks = dedupeExternalLinks(result.correction.addLinks);
                result.correction.linkActions = [...new Map(
                    result.correction.linkActions.map(action => [
                        [action.type, providerEntityKey(action.url), action.targetMbid || action.sourceMbid || ''].join('|'),
                        action,
                    ])
                ).values()];
            }
        }
    
        function hasCorrection(correction) {
            return Boolean(correction.newBarcode || correction.addLinks.length || correction.removeUrls.length);
        }
    
        async function checkRelease(release, progress) {
            const allUrls = releaseRelations(release);
            const supportedUrls = [...new Map(
                allUrls
                    .filter(providerFamily)
                    .map(url => [providerEntityKey(url), url])
            ).values()];
    
            const checks = await mapPool(supportedUrls, 3, async (url, index) => {
                progress(`Checking ${release.title}: ${index + 1}/${supportedUrls.length} ${providerLabel(url)}`);
                return lookupLinkedUrl(url);
            });
    
            const successful = checks.filter(check => check.gtin);
            const mismatches = successful.filter(check => !equalGtin(check.gtin, release.barcode));
            const unreadable = checks.filter(check => !check.gtin);
            const needsReverse = supportedUrls.length === 0 || successful.length === 0 || mismatches.length > 0 || unreadable.length > 0;
    
            let reverse = null;
            if (needsReverse) {
                progress(`Looking up barcode ${release.barcode} across providers...`);
                const appleSeedUrl = supportedUrls.find(url => providerFamily(url) === 'apple');
                reverse = await lookupByBarcode(release.barcode, appleSeedUrl);
            }
    
            return {
                release,
                allUrls,
                supportedUrls,
                checks,
                correction: buildCorrection(release, checks, reverse),
            };
        }
    
        function makeEditNote(correction) {
            const lines = [];
    
            for (const action of correction.linkActions || []) {
                if (action.type === 'replace-wrong-link') {
                    lines.push(
                        `Removed a wrongly linked ${action.provider} release URL and added the barcode-matched replacement: ${action.replacementUrl}`
                    );
                } else if (action.type === 'remove-duplicate-wrong-link') {
                    lines.push(
                        `Removed a wrongly linked ${action.provider} release URL. The same URL is already correctly linked to: ${action.targetReleaseUrl}`
                    );
                } else if (action.type === 'move-out') {
                    lines.push(
                        `Moved a wrongly linked ${action.provider} release URL to the correct MusicBrainz release: ${action.targetReleaseUrl}`
                    );
                } else if (action.type === 'move-in') {
                    lines.push(
                        `Added a ${action.provider} release URL that was wrongly linked to another MusicBrainz release: ${action.sourceReleaseUrl}`
                    );
                }
            }
    
            if (correction.newBarcode) {
                lines.push(
                    `Corrected barcode from ${correction.oldBarcode} to ${correction.newBarcode} based on matching linked release metadata.`
                );
            }
    
            if (correction.addLinks.length && !(correction.linkActions || []).some(action => action.type === 'move-in')) {
                lines.push(
                    `Added ${correction.addLinks.length} provider release link(s) found from barcode ${correction.oldBarcode}.`
                );
            }
    
            if (!lines.length) {
                lines.push('Checked the Digital Media release barcode against linked provider release pages.');
            }
    
            lines.push(
                '',
                `Script: ${SCRIPT_URL}`,
                'Harmony: https://github.com/kellnerd/harmony',
                'Apple Music barcode method: https://github.com/ToadKing/apple-music-barcode-isrc',
            );
    
            return lines.join('\n');
        }
    
        function flattenSeedLinks(links) {
            const output = [];
            for (const link of links) {
                const typeIds = [...new Set((link.types || []).map(type => RELEASE_LINK_TYPE_IDS.get(type)).filter(Boolean))];
                if (!typeIds.length) {
                    output.push({ url: link.url, linkTypeId: '' });
                } else {
                    for (const linkTypeId of typeIds) output.push({ url: link.url, linkTypeId });
                }
            }
            return output;
        }
    
        function pendingTaskKey(mbid) {
            return `${TASK_PREFIX}pending:${mbid}`;
        }
    
        function storeTask(correction) {
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            const task = {
                created: Date.now(),
                mbid: correction.mbid,
                removeUrls: correction.removeUrls,
                newBarcode: correction.newBarcode,
                addLinks: correction.addLinks,
                summary: correction.reasons,
            };
            localStorage.setItem(`${TASK_PREFIX}${id}`, JSON.stringify(task));
            localStorage.setItem(pendingTaskKey(correction.mbid), id);
            return id;
        }
    
        function openCorrection(correction) {
            if (!hasCorrection(correction)) return;
    
            const taskId = storeTask(correction);
            const targetName = `mb-barcode-link-check-${taskId}`;
            const form = document.createElement('form');
            form.method = 'post';
            form.target = targetName;
            form.action = `/release/${encodeURIComponent(correction.mbid)}/edit?barcode-link-checker=${encodeURIComponent(taskId)}`;
            form.style.display = 'none';
    
            const addField = (name, value) => {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = name;
                input.value = String(value);
                form.appendChild(input);
            };
    
            if (correction.newBarcode) addField('barcode', correction.newBarcode);
    
            const seedLinks = flattenSeedLinks(correction.addLinks);
            seedLinks.forEach((link, index) => {
                addField(`urls.${index}.url`, link.url);
                if (link.linkTypeId) addField(`urls.${index}.link_type`, link.linkTypeId);
            });
    
            addField('edit_note', makeEditNote(correction));
            document.body.appendChild(form);
            form.submit();
            form.remove();
        }
    
        function cleanupExpiredTasks() {
            const maxAge = 60 * 60 * 1000;
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const key = localStorage.key(i);
                if (!key?.startsWith(TASK_PREFIX)) continue;
                if (key.startsWith(`${TASK_PREFIX}pending:`)) continue;
                try {
                    const task = JSON.parse(localStorage.getItem(key));
                    if (!task?.created || Date.now() - task.created > maxAge) {
                        localStorage.removeItem(key);
                        if (task?.mbid) {
                            const pendingKey = pendingTaskKey(task.mbid);
                            if (localStorage.getItem(pendingKey) === key.slice(TASK_PREFIX.length)) {
                                localStorage.removeItem(pendingKey);
                            }
                        }
                    }
                } catch {
                    localStorage.removeItem(key);
                }
            }
        }
    
        function resolvePendingTaskId() {
            const fromQuery = new URL(location.href).searchParams.get('barcode-link-checker');
            if (fromQuery) return fromQuery;
    
            const nameMatch = String(window.name || '').match(/^mb-barcode-link-check-(.+)$/);
            if (nameMatch?.[1]) return nameMatch[1];
    
            const mbid = extractMbid(location.pathname);
            if (!mbid) return '';
    
            const pendingId = localStorage.getItem(pendingTaskKey(mbid)) || '';
            if (!pendingId) return '';
    
            try {
                const task = JSON.parse(localStorage.getItem(`${TASK_PREFIX}${pendingId}`));
                if (
                    task?.mbid === mbid &&
                    task?.created &&
                    Date.now() - task.created <= 60 * 60 * 1000
                ) {
                    return pendingId;
                }
            } catch {
                // Ignore corrupt pending pointers below.
            }
    
            localStorage.removeItem(pendingTaskKey(mbid));
            return '';
        }
    
        function findExistingUrlRow(url) {
            const wantedKey = providerEntityKey(url);
            const rows = [...document.querySelectorAll('#external-links-editor tr.external-link-item')];
    
            return rows.find(row => {
                const candidates = [
                    ...[...row.querySelectorAll('a[href]')].map(anchor => anchor.href),
                    ...[...row.querySelectorAll('input[type="url"]')].map(input => input.value),
                ].filter(Boolean);
    
                return candidates.some(candidate => {
                    try {
                        return providerEntityKey(candidate) === wantedKey;
                    } catch {
                        return false;
                    }
                });
            }) || null;
        }
    
        function rowIsMarkedForRemoval(row) {
            return Boolean(row?.querySelector('a.url.rel-remove, .rel-remove'));
        }
    
        function getPageMusicBrainz() {
            try {
                const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
                return pageWindow.MB || null;
            } catch {
                return null;
            }
        }
    
        function releaseEditorStateHasRemoval(url) {
            const MB = getPageMusicBrainz();
            const editor = MB?._releaseEditor;
            const treeApi = MB?.tree;
            const linksTree = editor?.externalLinksData?.();
            if (!editor || !treeApi || !linksTree?.size) return false;
    
            const wantedKey = providerEntityKey(url);
            for (const link of treeApi.iterate(linksTree)) {
                if (link.isNew || providerEntityKey(link.url) !== wantedKey) continue;
                return Boolean(link.relationships?.length) &&
                    link.relationships.every(relationship => relationship.removed);
            }
            return false;
        }
    
        function forceReleaseEditorRemoval(url) {
            const MB = getPageMusicBrainz();
            const editor = MB?._releaseEditor;
            const treeApi = MB?.tree;
            const linksTree = editor?.externalLinksData?.();
            if (!editor || !treeApi || !linksTree?.size) return false;
    
            const wantedKey = providerEntityKey(url);
            const links = [];
            let found = false;
            let changed = false;
    
            for (const link of treeApi.iterate(linksTree)) {
                if (!link.isNew && providerEntityKey(link.url) === wantedKey) {
                    found = true;
                    const relationships = (link.relationships || []).map(relationship => {
                        if (relationship.removed) return relationship;
                        changed = true;
                        return { ...relationship, removed: true };
                    });
    
                    links.push({
                        ...link,
                        url: link.originalUrlEntity?.name || link.url,
                        rawUrl: link.originalUrlEntity?.name || link.rawUrl,
                        relationships,
                    });
                } else {
                    links.push(link);
                }
            }
    
            if (!found) return false;
    
            if (changed) {
                editor.externalLinksData(treeApi.fromDistinctAscArray(links));
            }
    
            return releaseEditorStateHasRemoval(url);
        }
    
        async function ensureUrlRemoval(url, timeout = 10000) {
            const started = Date.now();
    
            while (Date.now() - started < timeout) {
                if (releaseEditorStateHasRemoval(url)) return true;
    
                const row = findExistingUrlRow(url);
                const button = row?.querySelector('button.remove-item');
    
                if (button && !button.disabled && !rowIsMarkedForRemoval(row)) {
                    button.click();
                    await sleep(150);
                }
    
                // The MusicBrainz release editor generates edits from
                // MB._releaseEditor.externalLinksData, not from the DOM/form.
                // Write the removal into that authoritative state directly.
                if (forceReleaseEditorRemoval(url)) return true;
    
                await sleep(250);
            }
    
            return false;
        }
    
        async function ensureTaskRemovals(task) {
            let removed = 0;
            const missing = [];
    
            for (const url of task.removeUrls || []) {
                if (await ensureUrlRemoval(url)) removed++;
                else missing.push(url);
            }
    
            return { removed, missing };
        }
    
        function installRemovalStateGuard(task) {
            if (!(task.removeUrls || []).length) return;
    
            const enforce = () => {
                for (const url of task.removeUrls || []) {
                    forceReleaseEditorRemoval(url);
                }
            };
    
            enforce();
            const timer = setInterval(enforce, 500);
    
            window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
        }
    
        async function waitFor(predicate, timeout = 20000, interval = 250) {
            const started = Date.now();
            while (Date.now() - started < timeout) {
                const value = predicate();
                if (value) return value;
                await sleep(interval);
            }
            return null;
        }
    
        function showEditBanner(task, removed, missing) {
            document.getElementById('mb-barcode-link-checker-edit-banner')?.remove();

            const banner = document.createElement('div');
            banner.id = 'mb-barcode-link-checker-edit-banner';
            banner.className = 'warning';

            const paragraph = document.createElement('p');
            const label = document.createElement('strong');
            label.textContent = 'Note: ';
            paragraph.appendChild(label);

            const parts = ['Barcode/link checker staged this correction. Review every change before submitting.'];
            if (task.newBarcode) parts.push(`Barcode staged: ${task.newBarcode}.`);
            if (task.addLinks?.length) parts.push(`Added link seeds: ${task.addLinks.length}.`);
            if (task.removeUrls?.length) parts.push(`Wrong links removed from editor: ${removed}/${task.removeUrls.length}.`);
            if (missing.length) parts.push(`Could not locate for automatic removal: ${missing.join(', ')}.`);

            paragraph.appendChild(document.createTextNode(parts.join(' ')));
            banner.appendChild(paragraph);

            const editor = document.getElementById('release-editor');
            if (editor?.parentElement) editor.parentElement.insertBefore(banner, editor);
            else document.body.prepend(banner);
        }

        async function applyPendingEditTask() {
            cleanupExpiredTasks();
            const taskId = resolvePendingTaskId();
            if (!taskId) return false;
    
            const key = `${TASK_PREFIX}${taskId}`;
            let task;
            try {
                task = JSON.parse(localStorage.getItem(key));
            } catch {
                task = null;
            }
            if (!task) return false;
    
            const currentMbid = extractMbid(location.pathname);
            if (!currentMbid || task.mbid !== currentMbid) return false;
    
            // The pending pointer is only for locating the task after MusicBrainz
            // handles the seeded POST. Keep the task itself until submission.
            if (localStorage.getItem(pendingTaskKey(task.mbid)) === taskId) {
                localStorage.removeItem(pendingTaskKey(task.mbid));
            }
    
            await waitFor(() => document.querySelector('#external-links-editor'));
            await waitFor(
                () => document.querySelectorAll('#external-links-editor tr.external-link-item').length > 0,
                20000
            );
    
            const result = await ensureTaskRemovals(task);
            showEditBanner(task, result.removed, result.missing);
    
            // MusicBrainz can re-render the external-links React component after
            // this task runs. Keep the authoritative release-editor observable in
            // the removed state until the page is submitted or closed.
            installRemovalStateGuard(task);
    
            return true;
        }
    
        function resultStatus(result) {
            const correction = result.correction;
            if (hasCorrection(correction)) return 'Correction prepared';
            if (correction.ambiguous) return 'Manual review required';
    
            const readable = result.checks.filter(check => check.gtin);
            const allReadableMatch = readable.length &&
                readable.every(check => equalGtin(check.gtin, result.release.barcode));
            const hasUnreadable = result.checks.some(check => !check.gtin);
    
            if (allReadableMatch && !hasUnreadable) return 'OK';
            return correction.notes[0] || 'Manual review required';
        }
    
        function problemSummary(result) {
            const c = result.correction;
            const action = c.linkActions?.[0];
    
            if (action?.type === 'remove-duplicate-wrong-link') {
                return `${action.provider} URL is linked to the wrong release; it already exists on the correct release.`;
            }
            if (action?.type === 'move-out') {
                return `${action.provider} URL is linked to the wrong release and will be moved to the correct release.`;
            }
            if (action?.type === 'move-in') {
                return `${action.provider} URL will be added here because it belongs to this barcode.`;
            }
            if (c.newBarcode) {
                return `Barcode should be ${c.newBarcode} instead of ${c.oldBarcode}.`;
            }
            if (c.addLinks.length) {
                return `${c.addLinks.length} missing provider link(s) found by barcode.`;
            }
            if (c.ambiguous) {
                return c.notes[0] || 'Barcode/link mismatch needs manual review.';
            }
            return c.notes[0] || c.reasons[0] || 'Needs manual review.';
        }
    
        function showResults(results) {
            document.getElementById('mb-barcode-checker-results')?.remove();

            const problematic = results
                .map((result, index) => ({result, index}))
                .filter(({result}) => resultStatus(result) !== 'OK');
            const corrections = problematic
                .filter(({result}) => hasCorrection(result.correction));

            const overlay = document.createElement('div');
            overlay.id = 'mb-barcode-checker-results';

            const dialog = document.createElement('fieldset');
            dialog.className = 'mb-bc-dialog';

            const legend = document.createElement('legend');
            legend.textContent = 'Barcode/link problems';
            dialog.appendChild(legend);

            const headerActions = document.createElement('div');
            headerActions.className = 'buttons mb-bc-header-actions';
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'mb-bc-close';
            close.textContent = 'Close';
            headerActions.appendChild(close);
            dialog.appendChild(headerActions);

            if (problematic.length) {
                for (const {result, index} of problematic) {
                    const release = document.createElement('fieldset');
                    release.className = 'mb-bc-release';

                    const releaseLegend = document.createElement('legend');
                    const link = document.createElement('a');
                    link.href = '/release/' + result.release.id;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = result.release.title;
                    releaseLegend.appendChild(link);
                    release.appendChild(releaseLegend);

                    const summary = document.createElement('p');
                    summary.textContent = problemSummary(result);
                    release.appendChild(summary);

                    if (hasCorrection(result.correction)) {
                        const actions = document.createElement('div');
                        actions.className = 'buttons';
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.className = 'positive mb-bc-open-one';
                        button.dataset.resultIndex = String(index);
                        button.textContent = 'Open correcting edit';
                        actions.appendChild(button);
                        release.appendChild(actions);
                    }

                    dialog.appendChild(release);
                }
            } else {
                const success = document.createElement('p');
                success.className = 'success';
                success.textContent = 'No problems found.';
                dialog.appendChild(success);
            }

            if (corrections.length) {
                const actions = document.createElement('div');
                actions.className = 'buttons mb-bc-actions';
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'positive mb-bc-open-all';
                button.textContent = `Open correcting edits (${corrections.length})`;
                actions.appendChild(button);
                dialog.appendChild(actions);
            }

            overlay.appendChild(dialog);
            (document.getElementById('content') || document.body).appendChild(overlay);

            close.addEventListener('click', () => overlay.remove());
            overlay.addEventListener('click', event => {
                if (event.target === overlay) overlay.remove();
            });

            for (const button of overlay.querySelectorAll('.mb-bc-open-one')) {
                button.addEventListener('click', () => {
                    const result = results[Number(button.dataset.resultIndex)];
                    openCorrection(result.correction);
                });
            }

            overlay.querySelector('.mb-bc-open-all')?.addEventListener('click', () => {
                for (const {result} of corrections) openCorrection(result.correction);
            });
        }

        function setSidebarStatus(text, kind = '') {
            const node = document.getElementById('mb-barcode-checker-status');
            if (!node) return;
            node.textContent = text;
            __mbToolBoxSetStatusKind(
                node,
                kind === 'bad' ? 'error' : kind === 'ok' ? 'success' : ''
            );
        }
    
        let lastCheckResults = null;
    
        function updateResultsButton(results) {
            const resultButton = document.getElementById('mb-barcode-checker-results-button');
            if (!resultButton) return;
    
            lastCheckResults = results;
            const hasProblems = results.some(result =>
                hasCorrection(result.correction) || result.correction.ambiguous
            );
    
            resultButton.textContent = hasProblems ? '⚠️' : '✅';
            resultButton.title = hasProblems ? 'Open barcode/link check results - review needed' : 'Open barcode/link check results - all passed';
            resultButton.style.display = '';
            resultButton.onclick = () => {
                if (lastCheckResults) showResults(lastCheckResults);
            };
        }
    
        async function runCheck() {
            const button = document.getElementById('mb-barcode-checker-button');
            const resultButton = document.getElementById('mb-barcode-checker-results-button');
            if (!button) return;
            button.disabled = true;
            if (resultButton) resultButton.style.display = 'none';
    
            try {
                const rgid = extractMbid(location.pathname);
                if (!rgid) throw new Error('Could not determine release-group MBID.');
    
                setSidebarStatus('Loading MusicBrainz releases...');
                const releases = await fetchReleaseGroupReleases(rgid);
                const eligible = releases.filter(release => isDigitalRelease(release) && release.barcode);
    
                if (!eligible.length) {
                    setSidebarStatus('No Digital Media releases with barcodes found.', 'ok');
                    updateResultsButton([]);
                    return;
                }
    
                const results = [];
                for (let i = 0; i < eligible.length; i++) {
                    const release = eligible[i];
                    setSidebarStatus(`Checking release ${i + 1}/${eligible.length}: ${release.title}`);
                    results.push(await checkRelease(release, message => setSidebarStatus(message)));
                }
    
                reconcileAcrossReleaseGroup(results);
    
                const corrections = results.filter(result => hasCorrection(result.correction)).length;
                const ambiguous = results.filter(result => result.correction.ambiguous).length;
                setSidebarStatus(
                    `Checked ${eligible.length} Digital Media release(s): ${corrections} correction(s), ${ambiguous} manual review.`,
                    corrections || ambiguous ? 'warn' : 'ok',
                );
                updateResultsButton(results);
            } catch (error) {
                console.error(`[${SCRIPT_NAME}]`, error);
                setSidebarStatus(error.message, 'bad');
            } finally {
                button.disabled = false;
            }
        }
    
        function makeReleaseTableBlock(releaseTable, barcodeHeader) {
            const block = document.createElement('div');
            block.id = 'mb-barcode-checker-block';
            block.innerHTML = `
                <button type="button" class="styled-button" id="mb-barcode-checker-button">Check barcodes against links</button>
                <button type="button" class="styled-button" id="mb-barcode-checker-results-button" title="Open check results" style="display:none">✅</button>
                <div id="mb-barcode-checker-status" class="mb-toolbox-native-status"></div>
            `;
    
            const alignToBarcodeColumn = () => {
                if (!block.isConnected || !releaseTable.isConnected || !barcodeHeader.isConnected) return;
                const headerRect = barcodeHeader.getBoundingClientRect();
                const parentRect = releaseTable.parentElement.getBoundingClientRect();
                block.style.width = `${headerRect.width}px`;
                block.style.marginLeft = `${headerRect.left - parentRect.left}px`;
            };
    
            block.querySelector('#mb-barcode-checker-button').addEventListener('click', runCheck);
            requestAnimationFrame(alignToBarcodeColumn);
            window.addEventListener('resize', alignToBarcodeColumn, { passive: true });
            if (typeof ResizeObserver !== 'undefined') {
                new ResizeObserver(alignToBarcodeColumn).observe(releaseTable);
            }
    
            return block;
        }
    
        function insertReleaseGroupButton() {
            if (document.getElementById('mb-barcode-checker-block')) return;
    
            const releaseTable = [...document.querySelectorAll('table.tbl.mergeable-table')].find(table =>
                [...table.querySelectorAll('thead th')].some(th => /^barcode$/i.test(normalizeSpace(th.textContent)))
            );
            if (!releaseTable) {
                setTimeout(insertReleaseGroupButton, 500);
                return;
            }
    
            const barcodeHeader = [...releaseTable.querySelectorAll('thead th')]
                .find(th => /^barcode$/i.test(normalizeSpace(th.textContent)));
            if (!barcodeHeader) {
                setTimeout(insertReleaseGroupButton, 500);
                return;
            }
    
            releaseTable.insertAdjacentElement('beforebegin', makeReleaseTableBlock(releaseTable, barcodeHeader));
        }
    
        cleanupExpiredTasks();
    
        if (/^\/release-group\/[0-9a-f-]{36}\/?$/i.test(location.pathname)) {
            insertReleaseGroupButton();
        } else if (/^\/release\/[0-9a-f-]+\/edit\/?$/i.test(location.pathname)) {
            applyPendingEditTask().catch(error => console.error(`[${SCRIPT_NAME}]`, error));
        }
    })();
    }

    // ============================================================================
    // Recording Matcher
    // Source merged from: musicbrainz-tools/safe-recording-matcher/MusicBrainz_Safe_Recording_Matcher.user.js
    // ============================================================================
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/release/*","https://beta.musicbrainz.org/release/*"], [])) {
    (function () {
        'use strict';
    
        const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js';
        const PAGE_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const MAX_DIFFERENCE_MS = 7000;
        const REQUEST_GAP_MS = 1000;
        const ISRC_CHOICE_CACHE_KEY = 'mb-recording-matcher:isrc-choice:v1';
        const LEGACY_ISRC_CHOICE_CACHE_KEY = 'mb-recording-data-to-tracks:isrc-choice-cache:v1';
        const GITHUB_TOKEN_KEY = 'mb-recording-matcher:github-token';
        const GITHUB_CACHE_REPO = 'karpuzikov/userscripts';
        const GITHUB_CACHE_PATH = 'musicbrainz-tools/safe-recording-matcher/isrc-choice-cache.json';
        const GITHUB_API_BASE = 'https://api.github.com';
    
        function parseLength(value) {
            const text = String(value ?? '').trim().replace(/^\(|\)$/g, '');
            const match = /^(?:(\d+):)?(\d{1,2}):([0-5]\d)$/.exec(text);
            if (!match || (match[1] && Number(match[2]) > 59)) return null;
            return ((Number(match[1] || 0) * 3600) + (Number(match[2]) * 60) + Number(match[3])) * 1000;
        }
    
        function normalize(value) {
            return String(value ?? '')
                .normalize('NFKC')
                .replace(/[\u2018\u2019\u02bc]/g, "'")
                .replace(/[\u2010-\u2015\u2212]/g, '-')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
        }
    
        function normalizeTitle(value) {
            return normalize(value)
                .replace(/\bremixed\s+by\b/gi, 'remix')
                .replace(/\b(?:remix|rmx|mix)\b/gi, 'remix')
                .replace(/ремикс/giu, 'remix')
                .replace(/\b(?:featuring|feat|ft)\.?\b/gi, 'feat')
                .replace(/\b(?:instrumental|inst)\.?\b/gi, 'instrumental')
                .replace(/\b(?:a\s+cappella|acappella|acapella)\b/gi, 'acapella')
                .replace(/\b(?:radio\s+version|radio\s+edit)\b/gi, 'radio')
                .replace(/\b(?:acoustic\s+version|acoustic)\b/gi, 'acoustic')
                .replace(/\b(?:live\s+version|live)\b/gi, 'live')
                .replace(/[.'`´]/g, '')
                .replace(/[^\p{L}\p{N}]+/gu, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        }
    
        function escapeLucene(value) {
            return String(value ?? '').replace(/[+\-!(){}\[\]^"~*?:\\/|&]/g, char => '\\' + char);
        }
    
        function buildArtistIdQuery(track, artistIds) {
            const ids = [...new Set((artistIds || []).filter(id => UUID.test(id)))];
            if (!ids.length) return null;
            const artist = ids.length === 1
                ? 'arid:' + ids[0]
                : '(' + ids.map(id => 'arid:' + id).join(' OR ') + ')';
            return 'recording:"' + escapeLucene(track.title) + '" AND ' + artist;
        }
    
        function buildArtistNameQuery(track, names) {
            const values = [...new Set((names || []).map(name => String(name ?? '').trim()).filter(Boolean))];
            if (!values.length) return null;
            const artist = values.length === 1
                ? 'artist:"' + escapeLucene(values[0]) + '"'
                : '(' + values.map(name => 'artist:"' + escapeLucene(name) + '"').join(' OR ') + ')';
            return 'recording:"' + escapeLucene(track.title) + '" AND ' + artist;
        }
    
        function buildQuery(track) {
            return buildArtistIdQuery(track, [track.artistIds[0]]);
        }
    
        function candidateCredit(candidate) {
            if (Array.isArray(candidate.artistIds)) {
                return {ids: candidate.artistIds, text: candidate.credit};
            }
            const parts = candidate['artist-credit'];
            if (!Array.isArray(parts)) return {ids: [], text: ''};
            return {
                ids: parts.map(part => part?.artist?.id),
                text: parts.map(part => (part?.name ?? part?.artist?.name ?? '') + (part?.joinphrase ?? '')).join(''),
            };
        }
    
        function evaluateCandidate(track, candidate) {
            if (!UUID.test(candidate?.id || '')) return {ok: false, reason: 'Missing recording ID'};
            if (candidate.video) return {ok: false, reason: 'Video recording'};
            if (!track.title || normalizeTitle(track.title) !== normalizeTitle(candidate.title ?? candidate.name)) {
                return {ok: false, reason: 'Different title'};
            }
            const credit = candidateCredit(candidate);
            if (!track.artistIds?.length || !credit.ids.length ||
                track.artistIds.length !== credit.ids.length ||
                track.artistIds.some((id, index) => !UUID.test(id) || id.toLowerCase() !== credit.ids[index]?.toLowerCase())) {
                return {ok: false, reason: 'Different or unresolved artist credit'};
            }
            if (!Number.isInteger(track.length) || track.length <= 0 ||
                !Number.isInteger(candidate.length) || candidate.length <= 0) {
                return {ok: false, reason: 'Missing length'};
            }
            const difference = Math.abs(track.length - candidate.length);
            if (difference > MAX_DIFFERENCE_MS) {
                return {ok: false, reason: 'Length differs by more than 7 seconds'};
            }
            return {ok: true, difference};
        }
    
        function chooseRecording(track, candidates) {
            const eligible = new Map();
            for (const candidate of candidates) {
                const result = evaluateCandidate(track, candidate);
                if (!result.ok) continue;
                const id = candidate.id.toLowerCase();
                if (!eligible.has(id) || result.difference < eligible.get(id).difference) {
                    eligible.set(id, {candidate, difference: result.difference});
                }
            }
            const ranked = [...eligible.values()].sort((a, b) => a.difference - b.difference);
            if (!ranked.length) return {reason: 'No safe recording found'};
            if (ranked.length > 1 && ranked[0].difference === ranked[1].difference) {
                return {reason: 'Two recordings are equally close; review manually'};
            }
            return {id: ranked[0].candidate.id, candidate: ranked[0].candidate};
        }
    
        function parseIsrcInput(text, expectedCount) {
            if (!Number.isInteger(expectedCount) || expectedCount < 1) {
                throw new Error('Load the release tracks before matching ISRCs.');
            }
            const lines = String(text ?? '').split(/\r\n|\n|\r/);
            const pattern = /(?:^|[^A-Z0-9])([A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5})(?![A-Z0-9])/gi;
            const parsed = lines.map((line, index) => {
                const visible = line.replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/[^\s|<>]+/gi, '');
                const found = [...visible.matchAll(pattern)].map(match => match[1].replace(/-/g, '').toUpperCase());
                if (found.length > 1) throw new Error(`Line ${index + 1} has more than one ISRC.`);
                const table = line.includes('|');
                const cells = table ? line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|') : [];
                return {
                    code: found[0],
                    number: Number(/^\s*\|?\s*(\d+)\s*\|/.exec(line)?.[1] ?? NaN),
                    table,
                    separator: cells.length > 0 && cells.every(cell => /^:?-+:?$/.test(cell.trim())),
                };
            });
            let codes;
            if (parsed.some(line => line.table)) {
                const slots = [];
                const numbered = parsed.some(line => Number.isInteger(line.number));
                let previousNumber = null;
                for (const [index, line] of parsed.entries()) {
                    const header = !line.code && !Number.isInteger(line.number) && parsed[index + 1]?.separator;
                    if (line.separator || header) continue;
                    if (!line.table) {
                        if (line.code) throw new Error(`ISRC on line ${index + 1} is outside the table.`);
                        continue;
                    }
                    if (numbered) {
                        if (Number.isInteger(line.number)) {
                            if ((previousNumber === null && line.number > 1) ||
                                (previousNumber !== null && line.number !== previousNumber + 1 && line.number !== 1)) {
                                throw new Error(`Unexpected track number ${line.number} on line ${index + 1}; check table order.`);
                            }
                            previousNumber = line.number;
                            slots.push(line.code || null);
                        } else if (line.code) {
                            if (!slots.length) throw new Error(`ISRC on line ${index + 1} is outside a numbered table row.`);
                            if (slots.at(-1)) throw new Error(`Table row ${slots.length} has more than one ISRC.`);
                            slots[slots.length - 1] = line.code;
                        }
                    } else {
                        slots.push(line.code || null);
                    }
                }
                const missing = slots.indexOf(null);
                if (missing !== -1) throw new Error(`Table row ${missing + 1} has no ISRC.`);
                codes = slots;
            } else {
                codes = parsed.flatMap(line => line.code ? [line.code] : []);
            }
            if (codes.length !== expectedCount) {
                throw new Error(`Expected ${expectedCount} ISRCs for ${expectedCount} tracks; found ${codes.length} ISRCs.`);
            }
            return codes;
        }
    
        function normalizeIsrcCode(value) {
            return String(value ?? '').replace(/-/g, '').trim().toUpperCase();
        }
    
        function cacheRecordingId(value) {
            const id = String(
                typeof value === 'string'
                    ? value
                    : value?.recordingMbid || value?.recordingId || ''
            ).trim().toLowerCase();
            return UUID.test(id) ? id : '';
        }

        function normalizeChoiceMap(value) {
            const result = {};
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return result;
            }

            for (const [rawIsrc, rawRecording] of Object.entries(value)) {
                const isrc = normalizeIsrcCode(rawIsrc);
                const recordingId = cacheRecordingId(rawRecording);
                if (isrc && recordingId) result[isrc] = recordingId;
            }

            return result;
        }

        function readIsrcChoiceCache() {
            const legacy = (() => {
                try {
                    return normalizeChoiceMap(
                        JSON.parse(localStorage.getItem(LEGACY_ISRC_CHOICE_CACHE_KEY) || '{}')
                    );
                } catch {
                    return {};
                }
            })();

            const current = (() => {
                try {
                    return normalizeChoiceMap(
                        JSON.parse(localStorage.getItem(ISRC_CHOICE_CACHE_KEY) || '{}')
                    );
                } catch {
                    return {};
                }
            })();

            // Canonical Matcher choices win if both caches contain the same ISRC.
            return {...legacy, ...current};
        }

        function writeIsrcChoiceCache(cache) {
            try {
                localStorage.setItem(
                    ISRC_CHOICE_CACHE_KEY,
                    JSON.stringify(normalizeChoiceMap(cache))
                );
            } catch {
                // Matching still works without persistence if storage is unavailable.
            }
        }

        function cachedIsrcRecording(isrc, candidates) {
            const code = normalizeIsrcCode(isrc);
            if (!code) return null;

            const cache = readIsrcChoiceCache();
            const cachedId = cacheRecordingId(cache[code]);
            if (!cachedId) return null;

            const candidate = (candidates || []).find(item =>
                String(item?.id || '').toLowerCase() === cachedId
            );

            if (candidate) return candidate;

            delete cache[code];
            writeIsrcChoiceCache(cache);
            return null;
        }

        function rememberIsrcChoice(isrc, recordingId) {
            const code = normalizeIsrcCode(isrc);
            const id = cacheRecordingId(recordingId);
            if (!code || !id) return false;

            const cache = readIsrcChoiceCache();
            cache[code] = id;
            writeIsrcChoiceCache(cache);
            return true;
        }

        function githubToken() {
            try {
                return String(GM_getValue(GITHUB_TOKEN_KEY, '') || '').trim();
            } catch {
                return '';
            }
        }
    
        function encodeBase64Utf8(text) {
            const bytes = new TextEncoder().encode(String(text));
            let binary = '';
            for (const byte of bytes) binary += String.fromCharCode(byte);
            return btoa(binary);
        }
    
        function decodeBase64Utf8(text) {
            const binary = atob(String(text || '').replace(/\s+/g, ''));
            const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
            return new TextDecoder().decode(bytes);
        }
    
        function githubApi(method, url, body = null, token = githubToken()) {
            return new Promise((resolve, reject) => {
                if (!token) {
                    reject(new Error('GitHub cache is not connected'));
                    return;
                }
    
                __mbToolBoxGmXmlhttpRequest({
                    method,
                    url,
                    headers: {
                        Accept: 'application/vnd.github+json',
                        Authorization: 'Bearer ' + token,
                        'X-GitHub-Api-Version': '2022-11-28',
                        ...(body ? {'Content-Type': 'application/json'} : {}),
                    },
                    data: body ? JSON.stringify(body) : undefined,
                    timeout: 15000,
                    onload: response => {
                        let data = null;
                        try {
                            data = response.responseText ? JSON.parse(response.responseText) : null;
                        } catch {
                            data = null;
                        }
    
                        if (response.status >= 200 && response.status < 300) {
                            resolve({status: response.status, data});
                        } else {
                            reject(new Error(
                                'GitHub API HTTP ' + response.status +
                                (data?.message ? ': ' + data.message : '')
                            ));
                        }
                    },
                    ontimeout: () => reject(new Error('GitHub cache request timed out')),
                    onerror: () => reject(new Error('GitHub cache request failed')),
                });
            });
        }
    
        async function fetchGithubChoiceFile() {
            const url = GITHUB_API_BASE + '/repos/' + GITHUB_CACHE_REPO +
                '/contents/' + GITHUB_CACHE_PATH;
            const response = await githubApi('GET', url);
            const data = response.data || {};
            let parsed = {version: 1, choices: {}};
    
            if (data.content) {
                try {
                    const decoded = JSON.parse(decodeBase64Utf8(data.content));
                    if (decoded && typeof decoded === 'object') {
                        parsed = {
                            version: 1,
                            choices: normalizeChoiceMap(decoded.choices),
                        };
                    }
                } catch {
                    throw new Error('GitHub cache JSON is invalid');
                }
            }
    
            return {
                sha: String(data.sha || ''),
                choices: parsed.choices,
            };
        }
    
        async function pullGithubChoices() {
            if (!githubToken()) return {connected: false, count: 0};
    
            const remote = await fetchGithubChoiceFile();
            const local = readIsrcChoiceCache();
            const merged = {...local, ...remote.choices};
            writeIsrcChoiceCache(merged);
            return {connected: true, count: Object.keys(remote.choices).length};
        }
    
        async function pushGithubChoices() {
            const token = githubToken();
            if (!token) return {connected: false, count: 0};
    
            const url = GITHUB_API_BASE + '/repos/' + GITHUB_CACHE_REPO +
                '/contents/' + GITHUB_CACHE_PATH;
    
            for (let attempt = 0; attempt < 2; attempt++) {
                const remote = await fetchGithubChoiceFile();
                const local = readIsrcChoiceCache();
                const merged = {...remote.choices, ...local};
                const content = JSON.stringify({version: 1, choices: merged}, null, 2) + '\n';
    
                try {
                    await githubApi('PUT', url, {
                        message: 'Update Recording Matcher ISRC cache',
                        content: encodeBase64Utf8(content),
                        sha: remote.sha,
                    }, token);
                    writeIsrcChoiceCache(merged);
                    return {connected: true, count: Object.keys(merged).length};
                } catch (error) {
                    if (attempt === 0 && /HTTP (409|422)/.test(error.message)) {
                        continue;
                    }
                    throw error;
                }
            }
    
            throw new Error('GitHub cache update conflicted twice');
        }
    
        async function configureGithubCache(panel) {
            const current = githubToken();
            const token = prompt(
                'GitHub fine-grained token for Recording Matcher cache.\n\n' +
                'Repository: ' + GITHUB_CACHE_REPO + '\n' +
                'Required repository permission: Contents - Read and write.\n\n' +
                'The token is stored only in Tampermonkey.',
                current
            );
    
            if (token === null) return;
            const trimmed = token.trim();
            if (!trimmed) {
                GM_setValue(GITHUB_TOKEN_KEY, '');
                panel.querySelector('.mb-safe-status').textContent =
                    'GitHub cache disconnected. Local cache is still active.';
                updateGithubCacheButton(panel);
                return;
            }
    
            GM_setValue(GITHUB_TOKEN_KEY, trimmed);
            const status = panel.querySelector('.mb-safe-status');
            status.textContent = 'Connecting GitHub cache...';
    
            try {
                await pullGithubChoices();
                const pushed = await pushGithubChoices();
                status.textContent =
                    'GitHub cache connected and synced: ' + pushed.count + ' saved ISRC choice(s).';
            } catch (error) {
                status.textContent = 'GitHub cache error: ' + error.message;
            }
    
            updateGithubCacheButton(panel);
        }
    
        function updateGithubCacheButton(panel) {
            const button = panel?.querySelector('.mb-safe-github-cache');
            if (!button) return;
            button.textContent = githubToken() ? 'GitHub cache: connected' : 'Connect GitHub cache';
        }
    
        let githubSyncChain = Promise.resolve();

        async function syncGithubCacheQuietly(panel) {
            if (!githubToken()) {
                updateGithubCacheButton(panel);
                return;
            }
    
            try {
                await pullGithubChoices();
            } catch (error) {
                console.warn('[MusicBrainz Recording Matcher] GitHub cache sync failed:', error);
            }
            updateGithubCacheButton(panel);
        }
    
        function syncChoiceToGithub(panel) {
            if (!githubToken()) {
                if (panel) {
                    panel.querySelector('.mb-safe-status').textContent =
                        'Choice remembered locally. Connect GitHub cache to sync it across devices.';
                }
                return;
            }

            githubSyncChain = githubSyncChain
                .catch(() => undefined)
                .then(() => pushGithubChoices())
                .then(result => {
                    if (panel) {
                        panel.querySelector('.mb-safe-status').textContent =
                            'Choice saved locally and synced to GitHub (' +
                            result.count + ' cached ISRC choice(s)).';
                    }
                    return result;
                })
                .catch(error => {
                    console.warn('[MusicBrainz Recording Matcher] GitHub cache push failed:', error);
                    if (panel) {
                        panel.querySelector('.mb-safe-status').textContent =
                            'Choice saved locally; GitHub sync failed: ' + error.message;
                    }
                });
        }

        function chooseByIsrc(track, candidates, isrc = '') {
            const unique = new Map();
            for (const candidate of candidates || []) {
                if (!UUID.test(candidate?.id || '') || candidate.video) continue;
                unique.set(candidate.id.toLowerCase(), candidate);
            }
    
            const all = [...unique.values()];
            if (!all.length) return {reason: 'No recording is linked to this ISRC'};
            if (all.length === 1) {
                return {id: all[0].id, candidate: all[0]};
            }
    
            const cached = cachedIsrcRecording(isrc, all);
            if (cached) {
                return {id: cached.id, candidate: cached, cached: true};
            }
    
            return {
                reason: 'ISRC is linked to ' + all.length + ' recordings; choose one manually once and it will be remembered',
                ambiguousCandidates: all,
            };
        }
    
        function appendAttribution(note, url) {
            if (note.includes(url)) return note;
            return (note.trimEnd() ? note.trimEnd() + '\n\n' : '') + 'Script: ' + url;
        }
    
        function bubbleTargetsRow(bubble, row) {
            if (bubble?.visible?.() !== true || !row?.isConnected) return false;
            return bubble.control?.closest?.('tr.track') === row;
        }
    
        function readExactLength(bubble, button) {
            if (bubble?.visible?.() !== true) return null;
            if (button) {
                const expectedRow = button.closest?.('tr.track');
                const activeRow = bubble.control?.closest?.('tr.track');
                if (expectedRow && activeRow && expectedRow !== activeRow) return null;
            }
            const length = bubble.currentTrack?.()?.length?.();
            return Number.isInteger(length) && length > 0 ? length : null;
        }
    
        function readAvailableTrackLength(row, bubble, button) {
            return readExactLength(bubble, button) || readTrack(row).length;
        }
    
        if (typeof document === 'undefined' && typeof module !== 'undefined' && module.exports) {
            module.exports = {parseLength, buildQuery, evaluateCandidate, chooseRecording, parseIsrcInput, chooseByIsrc, appendAttribution, readExactLength, maySelectUnlinkedRow};
            return;
        }
    
        const IS_RELEASE_PAGE = /^\/release\/[0-9a-f-]{36}\/?$/i.test(location.pathname);
        const IS_RELEASE_EDITOR = /^\/release\/(?:add|[0-9a-f-]{36}\/edit)\/?$/i.test(location.pathname);
        const DUPLICATE_CLASS = 'mb-duplicate-recording';
        const UNLINKED_CLASS = 'mb-unlinked-recording';
    
        if (!IS_RELEASE_PAGE && !IS_RELEASE_EDITOR) return;
    
        const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
        const resultCache = new Map();
        const artistCache = new Map();
        const pendingIsrcChoices = new Map();
        let nextRequestAt = 0;
        let running = false;
        let stopRequested = false;
        let needsAttribution = false;
    
        function artistCreditFromCell(cell) {
            const span = cell?.querySelector('span');
            if (!span) return {artistIds: [], credit: ''};
            const artistIds = [...span.querySelectorAll('a[href]')].map(link => {
                const path = new URL(link.href, location.href).pathname;
                return /^\/artist\/([0-9a-f-]{36})(?:\/|$)/i.exec(path)?.[1] || null;
            });
            return {artistIds, credit: span.textContent.trim()};
        }
    
        function artistCells(row) {
            const artistRow = row.nextElementSibling;
            return artistRow?.matches('tr.artist')
                ? artistRow.querySelectorAll(':scope > td[colspan="2"]')
                : [];
        }
    
        function readTrack(row) {
            const names = row.querySelectorAll('td.name');
            const lengths = row.querySelectorAll('td.length');
            const creditCells = artistCells(row);
            return {
                title: names[0]?.querySelector('bdi')?.textContent.trim() || '',
                length: parseLength(lengths[0]?.textContent),
                ...artistCreditFromCell(creditCells[0]),
            };
        }
    
        function recordingIdFromCell(cell, baseUrl) {
            for (const link of cell?.querySelectorAll('a[href]') || []) {
                const path = new URL(link.href, baseUrl || location.href).pathname;
                const id = /^\/recording\/([0-9a-f-]{36})(?:\/|$)/i.exec(path)?.[1];
                if (id && UUID.test(id)) return id;
            }
            return null;
        }
    
        function maySelectUnlinkedRow(row, baseUrl) {
            return !recordingIdFromCell(row.querySelectorAll('td.name')[1], baseUrl);
        }
    
        function readLinkedRecording(row) {
            const names = row.querySelectorAll('td.name');
            const lengths = row.querySelectorAll('td.length');
            const id = recordingIdFromCell(names[1]);
            return {
                id,
                title: names[1]?.querySelector('bdi')?.textContent.trim() || names[1]?.querySelector('a')?.textContent.trim() || '',
                length: parseLength(lengths[1]?.textContent),
                ...artistCreditFromCell(artistCells(row)[1]),
            };
        }
    
        function recordingIdFromTrackModel(trackModel) {
            const recording = typeof trackModel?.recording === 'function'
                ? trackModel.recording()
                : trackModel?.recording;
            return cacheRecordingId(recording?.gid || recording?.id);
        }

        function finishPendingIsrcChoice(trackModel, pending) {
            const linkedId = recordingIdFromTrackModel(trackModel);
            if (!linkedId || !pending?.candidateIds?.has(linkedId)) return false;

            rememberIsrcChoice(pending.code, linkedId);
            pending.subscription?.dispose?.();
            pendingIsrcChoices.delete(trackModel);

            const panel = document.getElementById('mb-safe-recording-matcher');
            const status = panel?.querySelector('.mb-safe-status');
            if (status) {
                status.textContent =
                    'Remembered ISRC choice: ' + pending.code + ' -> ' + linkedId;
            }

            syncChoiceToGithub(panel);
            return true;
        }

        function watchManualIsrcChoice(trackModel, isrc, candidates) {
            const code = normalizeIsrcCode(isrc);
            const candidateIds = new Set(
                (candidates || [])
                    .map(candidate => cacheRecordingId(candidate?.id))
                    .filter(Boolean)
            );

            if (
                !trackModel ||
                typeof trackModel.recording !== 'function' ||
                !code ||
                candidateIds.size < 2
            ) {
                return;
            }

            const previous = pendingIsrcChoices.get(trackModel);
            previous?.subscription?.dispose?.();

            const pending = {
                code,
                candidateIds,
                subscription: null,
            };

            if (typeof trackModel.recording.subscribe === 'function') {
                pending.subscription = trackModel.recording.subscribe(() => {
                    finishPendingIsrcChoice(trackModel, pending);
                });
            }

            pendingIsrcChoices.set(trackModel, pending);
            finishPendingIsrcChoice(trackModel, pending);
        }

        function captureManualIsrcChoices() {
            for (const [trackModel, pending] of pendingIsrcChoices) {
                finishPendingIsrcChoice(trackModel, pending);
            }
        }

        function duplicateEntries() {
            if (IS_RELEASE_EDITOR) {
                return [...document.querySelectorAll('#recordings tr.track')]
                    .map(row => ({
                        row,
                        recordingId: recordingIdFromCell(row.querySelectorAll('td.name')[1]),
                    }))
                    .filter(entry => entry.recordingId);
            }
    
            return [...document.querySelectorAll('table.medium tbody > tr')]
                .filter(row => row.querySelector(':scope > td.pos.t'))
                .map(row => {
                    const titleCell = row.querySelector(':scope > td.wrap-anywhere, :scope > td:nth-child(2)');
                    return {
                        row,
                        recordingId: recordingIdFromCell(titleCell),
                    };
                })
                .filter(entry => entry.recordingId);
        }
    
        function highlightedEditorRows() {
            return [...document.querySelectorAll('#recordings tr.track.' + DUPLICATE_CLASS)];
        }

        function updateUnlinkedHighlights() {
            let highlighted = 0;

            for (const row of document.querySelectorAll('#recordings tr.track')) {
                const nameCells = row.querySelectorAll('td.name');
                const recordingCell = nameCells[1];
                const text = String(recordingCell?.textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();
                const hasRecording = Boolean(
                    recordingCell?.querySelector('a[href*="/recording/"]')
                );
                const unlinked = Boolean(recordingCell) &&
                    !hasRecording &&
                    (
                        text.includes('add new recording') ||
                        row.querySelector('button.edit-track-recording')
                    );

                row.classList.toggle(UNLINKED_CLASS, unlinked);
                if (unlinked) highlighted++;
            }

            return highlighted;
        }
    
        function updateDuplicateHighlights() {
            document.querySelectorAll('.' + DUPLICATE_CLASS).forEach(row => {
                row.classList.remove(DUPLICATE_CLASS);
                row.removeAttribute('data-mb-duplicate-recording-count');
            });
    
            const groups = new Map();
            for (const entry of duplicateEntries()) {
                const id = entry.recordingId.toLowerCase();
                if (!groups.has(id)) groups.set(id, []);
                groups.get(id).push(entry.row);
            }
    
            let highlighted = 0;
            for (const rows of groups.values()) {
                const uniqueRows = [...new Set(rows)];
                if (uniqueRows.length < 2) continue;
                highlighted += uniqueRows.length;
                for (const row of uniqueRows) {
                    row.classList.add(DUPLICATE_CLASS);
                    row.dataset.mbDuplicateRecordingCount = String(uniqueRows.length);
                }
            }
    
            const button = document.querySelector('.mb-safe-highlighted');
            if (button) button.disabled = running || highlighted === 0;
            return highlighted;
        }
    
        const duplicateStyle = document.createElement('style');
        duplicateStyle.textContent = `
            .${DUPLICATE_CLASS} > td {
                background: #ff1616 !important;
                color: #fff !important;
            }
            .${DUPLICATE_CLASS} > td a,
            .${DUPLICATE_CLASS} > td a:visited {
                color: #fff !important;
                font-weight: 700 !important;
                text-decoration: underline !important;
            }
            .${DUPLICATE_CLASS} > td:first-child {
                box-shadow: inset 4px 0 0 #7a0000 !important;
            }

            #recordings tr.${UNLINKED_CLASS} > td {
                background: #ffb300 !important;
                color: #111 !important;
                font-weight: 600;
            }
            #recordings tr.${UNLINKED_CLASS} > td a,
            #recordings tr.${UNLINKED_CLASS} > td button {
                color: #111 !important;
            }
            #recordings tr.${UNLINKED_CLASS} > td:first-child {
                box-shadow: inset 4px 0 0 #a85b00 !important;
            }
    
            #mb-safe-recording-matcher {
                margin: 1em 0 1.2em;
                padding: .75em 1em 1em;
            }
    
            #mb-safe-recording-matcher legend {
                padding: 0 .35em;
            }
    
            #mb-safe-recording-matcher .mb-safe-actions {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: .5em;
            }
    
            #mb-safe-recording-matcher .mb-safe-actions button {
                margin: 0;
                white-space: nowrap;
            }
    
            #mb-safe-recording-matcher .mb-safe-status {
                display: block;
                margin-top: .75em;
                padding-top: .65em;
                border-top: 1px solid rgba(128, 128, 128, .35);
                line-height: 1.4;
            }
    
            #mb-safe-recording-matcher .mb-safe-results {
                margin: .75em 0 0 1.6em;
            }
        `;
        document.head.appendChild(duplicateStyle);
    
        let duplicateUpdateTimer = null;
        const duplicateObserver = new MutationObserver(() => {
            clearTimeout(duplicateUpdateTimer);
            duplicateUpdateTimer = setTimeout(() => {
                updateDuplicateHighlights();
                updateUnlinkedHighlights();
                captureManualIsrcChoices();
            }, 40);
        });
        duplicateObserver.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['href'],
        });
        updateDuplicateHighlights();
        updateUnlinkedHighlights();
    
        if (!IS_RELEASE_EDITOR) return;
    
        async function waitFor(predicate, timeoutMs) {
            const deadline = Date.now() + timeoutMs;
            do {
                const value = predicate();
                if (value) return value;
                await sleep(80);
            } while (Date.now() < deadline);
            return null;
        }
    
        async function throttle() {
            await sleep(Math.max(0, nextRequestAt - Date.now()));
            nextRequestAt = Date.now() + REQUEST_GAP_MS;
        }
    
        async function searchQuery(query) {
            if (resultCache.has(query)) return resultCache.get(query);
    
            const url = '/ws/2/recording?fmt=json&limit=100&query=' + encodeURIComponent(query);
            for (let attempt = 0; attempt < 3; attempt++) {
                await throttle();
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 12000);
                let response;
                try {
                    response = await __mbToolBoxFetch(url, {
                        credentials: 'same-origin',
                        headers: {Accept: 'application/json'},
                        signal: controller.signal,
                    });
                } finally {
                    clearTimeout(timeout);
                }
                if (response.status === 503 || response.status === 429) {
                    const retrySeconds = Number(response.headers.get('Retry-After'));
                    if (attempt === 2) throw new Error('MusicBrainz is rate limiting requests');
                    await sleep(Math.max(5000 * (attempt + 1), Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 0));
                    continue;
                }
                if (!response.ok) throw new Error('MusicBrainz search returned HTTP ' + response.status);
                const data = await response.json();
                if (!Array.isArray(data.recordings) || !Number.isInteger(data.count)) {
                    throw new Error('MusicBrainz returned an unexpected search response');
                }
                const result = data.count > 100
                    ? {reason: 'Search has over 100 results; review manually'}
                    : {recordings: data.recordings};
                resultCache.set(query, result);
                return result;
            }
            throw new Error('MusicBrainz search did not complete');
        }
    
        function releaseArtistIds() {
            const release = PAGE_WINDOW.MB?.releaseEditor?.rootField?.release?.();
            const names = release?.artistCredit?.()?.names;
            if (!Array.isArray(names)) return [];
            return [...new Set(names.map(part => part?.artist?.gid).filter(id => UUID.test(id)))];
        }
    
        async function artistInfo(id) {
            const key = String(id ?? '').toLowerCase();
            if (!UUID.test(key)) return null;
            if (artistCache.has(key)) return artistCache.get(key);
    
            await throttle();
            const response = await __mbToolBoxFetch('/ws/2/artist/' + key + '?fmt=json&inc=aliases', {
                credentials: 'same-origin',
                headers: {Accept: 'application/json'},
            });
            if (!response.ok) throw new Error('Artist lookup returned HTTP ' + response.status);
            const data = await response.json();
            const result = {
                id: data.id,
                name: String(data.name ?? '').trim(),
                aliases: [...new Set((data.aliases || [])
                    .map(alias => String(alias?.name ?? '').trim())
                    .filter(Boolean))],
            };
            artistCache.set(key, result);
            return result;
        }
    
        async function searchCircle(track, query, circle) {
            if (!query) return null;
            const search = await searchQuery(query);
            if (search.reason) return {reason: search.reason, circle};
            const chosen = chooseRecording(track, search.recordings);
            return chosen.id ? {...chosen, circle} : {...chosen, circle};
        }
    
        async function searchRecordings(track) {
            const mainIds = releaseArtistIds();
            const effectiveMainIds = mainIds.length ? mainIds : track.artistIds.slice(0, 1);
            const mainSet = new Set(effectiveMainIds.map(id => id.toLowerCase()));
            const featuredIds = track.artistIds.filter(id => !mainSet.has(id.toLowerCase()));
    
            const c1 = await searchCircle(
                track,
                buildArtistIdQuery(track, effectiveMainIds),
                'C1 main release artist',
            );
            if (c1?.id || (c1?.reason && c1.reason.startsWith('Two recordings'))) return c1;
    
            if (featuredIds.length) {
                const c2 = await searchCircle(
                    track,
                    buildArtistIdQuery(track, featuredIds),
                    'C2 featured artist',
                );
                if (c2?.id || (c2?.reason && c2.reason.startsWith('Two recordings'))) return c2;
            }
    
            const relevantIds = [...new Set([...track.artistIds, ...effectiveMainIds])];
            const info = (await Promise.all(relevantIds.map(artistInfo))).filter(Boolean);
            const names = info.map(item => item.name).filter(Boolean);
            const c3 = await searchCircle(
                track,
                buildArtistNameQuery(track, names),
                'C3 exact artist name',
            );
            if (c3?.id || (c3?.reason && c3.reason.startsWith('Two recordings'))) return c3;
    
            const aliases = [...new Set(info.flatMap(item => item.aliases))]
                .filter(alias => !names.some(name => normalize(name) === normalize(alias)));
            const c4 = await searchCircle(
                track,
                buildArtistNameQuery(track, aliases),
                'C4 artist alias',
            );
            if (c4?.id || (c4?.reason && c4.reason.startsWith('Two recordings'))) return c4;
    
            return {reason: 'No recording found in C1-C4'};
        }
    
        async function searchByIsrc(code) {
            const normalized = String(code ?? '').replace(/-/g, '').toUpperCase();
            const cacheKey = 'isrc-lookup:' + normalized;
            if (resultCache.has(cacheKey)) return resultCache.get(cacheKey);
    
            const url = '/ws/2/isrc/' + encodeURIComponent(normalized) + '?fmt=json&inc=artist-credits';
            for (let attempt = 0; attempt < 3; attempt++) {
                await throttle();
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 12000);
                let response;
                try {
                    response = await __mbToolBoxFetch(url, {
                        credentials: 'same-origin',
                        headers: {Accept: 'application/json'},
                        signal: controller.signal,
                    });
                } finally {
                    clearTimeout(timeout);
                }
    
                if (response.status === 503 || response.status === 429) {
                    const retrySeconds = Number(response.headers.get('Retry-After'));
                    if (attempt === 2) throw new Error('MusicBrainz is rate limiting requests');
                    await sleep(Math.max(
                        5000 * (attempt + 1),
                        Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 0,
                    ));
                    continue;
                }
    
                if (response.status === 404) {
                    const result = {recordings: []};
                    resultCache.set(cacheKey, result);
                    return result;
                }
                if (!response.ok) throw new Error('MusicBrainz ISRC lookup returned HTTP ' + response.status);
    
                const data = await response.json();
                if (!Array.isArray(data.recordings)) {
                    throw new Error('MusicBrainz returned an unexpected ISRC response');
                }
    
                const result = {recordings: data.recordings};
                resultCache.set(cacheKey, result);
                return result;
            }
    
            throw new Error('MusicBrainz ISRC lookup did not complete');
        }
    
        async function verifyRecordingHasIsrc(recordingId, expectedIsrc) {
            const id = String(recordingId || '').toLowerCase();
            const isrc = String(expectedIsrc || '').replace(/-/g, '').toUpperCase();
            if (!UUID.test(id) || !isrc) return false;
    
            const cacheKey = 'recording-isrc-check:' + id;
            let data = resultCache.get(cacheKey);
    
            if (!data) {
                for (let attempt = 0; attempt < 3; attempt++) {
                    await throttle();
    
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 12000);
                    let response;
    
                    try {
                        response = await __mbToolBoxFetch(
                            '/ws/2/recording/' + encodeURIComponent(id) + '?fmt=json&inc=isrcs',
                            {
                                credentials: 'same-origin',
                                headers: {Accept: 'application/json'},
                                signal: controller.signal,
                            },
                        );
                    } catch (error) {
                        if (error?.name === 'AbortError') {
                            if (attempt === 2) {
                                throw new Error('Recording ISRC verification timed out');
                            }
                            continue;
                        }
                        throw error;
                    } finally {
                        clearTimeout(timeout);
                    }
    
                    if (response.status === 503 || response.status === 429) {
                        const retrySeconds = Number(response.headers.get('Retry-After'));
                        if (attempt === 2) {
                            throw new Error('MusicBrainz is rate limiting ISRC verification requests');
                        }
                        await sleep(Math.max(
                            5000 * (attempt + 1),
                            Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 0,
                        ));
                        continue;
                    }
    
                    if (!response.ok) {
                        throw new Error('Recording ISRC verification returned HTTP ' + response.status);
                    }
    
                    data = await response.json();
                    resultCache.set(cacheKey, data);
                    break;
                }
            }
    
            return Array.isArray(data?.isrcs) &&
                data.isrcs.some(code => String(code).replace(/-/g, '').toUpperCase() === isrc);
        }
    
        function releaseTrackModels() {
            const release = PAGE_WINDOW.MB?.releaseEditor?.rootField?.release?.();
            return release && typeof release.allTracks === 'function'
                ? [...release.allTracks()]
                : [];
        }
    
        function keepRecordingAssociationLocked(trackModel, recordingEntity) {
            if (
                !trackModel ||
                trackModel.__mbToolBoxManualRecordingEdit ||
                typeof trackModel.recording !== 'function' ||
                !recordingEntity?.gid
            ) {
                return;
            }

            const expectedGid = String(recordingEntity.gid).toLowerCase();
            const previous =
                trackModel.__mbToolBoxRecordingLock ||
                trackModel.__mbToolBoxExactIsrcGuard;

            if (
                previous?.expectedGid === expectedGid &&
                previous?.recordingEntity
            ) {
                return;
            }

            previous?.dispose?.();

            const guard = {
                expectedGid,
                recordingEntity,
                subscriptions: [],
                restoring: false,
                dispose: null,
            };

            trackModel.__mbToolBoxRecordingLock = guard;
            delete trackModel.__mbToolBoxExactIsrcGuard;

            const disposeGuard = () => {
                if (trackModel.__mbToolBoxRecordingLock !== guard) return;
                for (const subscription of guard.subscriptions) {
                    subscription?.dispose?.();
                }
                delete trackModel.__mbToolBoxRecordingLock;
            };
            guard.dispose = disposeGuard;

            const readObservable = observable => {
                if (typeof observable !== 'function') return undefined;
                return typeof observable.peek === 'function'
                    ? observable.peek()
                    : observable();
            };

            const refreshSavedComparisonState = () => {
                if (trackModel.__mbToolBoxRecordingLock !== guard) return;

                if (typeof trackModel.name === 'function') {
                    trackModel.name.saved = readObservable(trackModel.name);
                }

                if (typeof trackModel.length === 'function') {
                    trackModel.length.saved = readObservable(trackModel.length);
                }

                /*
                 * MusicBrainz's native recording-association watcher uses this
                 * saved recording when Tracklist metadata changes. Once a track
                 * is linked, that association is authoritative until the user
                 * explicitly removes it.
                 */
                if (trackModel.recording) {
                    trackModel.recording.saved = recordingEntity;
                }
            };

            const restoreLockedRecording = () => {
                if (
                    guard.restoring ||
                    trackModel.__mbToolBoxRecordingLock !== guard
                ) {
                    return;
                }

                const current = readObservable(trackModel.recording);
                const currentGid = String(current?.gid || '').toLowerCase();
                if (currentGid === expectedGid) return;

                guard.restoring = true;
                try {
                    refreshSavedComparisonState();
                    trackModel.recording(recordingEntity);

                    if (typeof trackModel.hasNewRecording === 'function') {
                        trackModel.hasNewRecording(false);
                    }

                    refreshSavedComparisonState();
                } finally {
                    guard.restoring = false;
                }
            };

            refreshSavedComparisonState();

            /*
             * Tracklist edits must never change a recording association. Keep
             * MusicBrainz's title/length comparison baseline synchronized, then
             * verify again after its native debounced watcher has run.
             */
            const tracklistObservables = [
                trackModel.name,
                trackModel.length,
                trackModel.formattedLength,
                trackModel.artistCredit,
                trackModel.number,
                trackModel.position,
                trackModel.isDataTrack,
            ];

            for (const observable of tracklistObservables) {
                if (typeof observable?.subscribe !== 'function') continue;

                guard.subscriptions.push(observable.subscribe(() => {
                    refreshSavedComparisonState();
                    setTimeout(restoreLockedRecording, 0);
                    setTimeout(restoreLockedRecording, 650);
                    setTimeout(restoreLockedRecording, 1200);
                }));
            }

            /*
             * Watch the underlying observable so any automatic MusicBrainz
             * unlink/relink is reversed immediately. Manual unlink is handled
             * separately by disposing this lock before MusicBrainz processes
             * the user's explicit "Add a new recording" choice.
             */
            const recordingObservable =
                typeof trackModel.recordingValue?.subscribe === 'function'
                    ? trackModel.recordingValue
                    : trackModel.recording;

            if (typeof recordingObservable?.subscribe === 'function') {
                guard.subscriptions.push(recordingObservable.subscribe(() => {
                    if (!guard.restoring) {
                        setTimeout(restoreLockedRecording, 0);
                    }
                }));
            }

            if (typeof trackModel.hasNewRecording?.subscribe === 'function') {
                guard.subscriptions.push(trackModel.hasNewRecording.subscribe(value => {
                    if (value && !guard.restoring) {
                        setTimeout(restoreLockedRecording, 0);
                    }
                }));
            }
        }

        function installRecordingLockWatcher(trackModel) {
            if (
                !trackModel ||
                trackModel.__mbToolBoxRecordingLockWatcher ||
                typeof trackModel.recordingValue?.subscribe !== 'function'
            ) {
                return;
            }

            const subscription = trackModel.recordingValue.subscribe(value => {
                if (
                    value?.gid &&
                    !trackModel.__mbToolBoxRecordingLock &&
                    !trackModel.__mbToolBoxManualRecordingEdit
                ) {
                    keepRecordingAssociationLocked(trackModel, value);
                }
            });

            trackModel.__mbToolBoxRecordingLockWatcher = subscription;
        }

        function protectAllLinkedRecordings() {
            for (const trackModel of releaseTrackModels()) {
                installRecordingLockWatcher(trackModel);

                if (trackModel?.__mbToolBoxManualRecordingEdit) {
                    continue;
                }

                const recording =
                    typeof trackModel.recording === 'function'
                        ? (
                            typeof trackModel.recording.peek === 'function'
                                ? trackModel.recording.peek()
                                : trackModel.recording()
                        )
                        : null;

                if (recording?.gid && !trackModel.__mbToolBoxRecordingLock) {
                    keepRecordingAssociationLocked(trackModel, recording);
                }
            }
        }

        let manualRecordingEditTrack = null;
        let manualRecordingEditToken = 0;
        let manualRecordingOpenRequested = false;

        function currentRecordingForTrack(trackModel) {
            if (typeof trackModel?.recording !== 'function') return null;
            return typeof trackModel.recording.peek === 'function'
                ? trackModel.recording.peek()
                : trackModel.recording();
        }

        function finishManualRecordingEdit(trackModel, token) {
            if (
                !trackModel ||
                trackModel.__mbToolBoxManualRecordingEdit !== token
            ) {
                return;
            }

            delete trackModel.__mbToolBoxManualRecordingEdit;

            if (manualRecordingEditTrack === trackModel) {
                manualRecordingEditTrack = null;
            }

            const recording = currentRecordingForTrack(trackModel);
            if (recording?.gid) {
                keepRecordingAssociationLocked(trackModel, recording);
            }
        }

        function beginManualRecordingEdit(trackModel) {
            if (!trackModel) return;

            if (
                manualRecordingEditTrack &&
                manualRecordingEditTrack !== trackModel
            ) {
                const previousTrack = manualRecordingEditTrack;
                const previousToken =
                    previousTrack.__mbToolBoxManualRecordingEdit;
                finishManualRecordingEdit(previousTrack, previousToken);
            }

            const token = ++manualRecordingEditToken;
            trackModel.__mbToolBoxManualRecordingEdit = token;
            manualRecordingEditTrack = trackModel;

            /*
             * The lock exists only to prevent MusicBrainz from automatically
             * dropping a recording because track metadata changed. Once the
             * user explicitly opens the native Recording editor, every manual
             * recording choice must be allowed.
             */
            trackModel.__mbToolBoxRecordingLock?.dispose?.();
            trackModel.__mbToolBoxExactIsrcGuard?.dispose?.();
        }

        function installManualRecordingEditSupport() {
            const bubble = PAGE_WINDOW.MB?.releaseEditor?.recordingBubble;
            if (!bubble || bubble.__mbToolBoxManualEditSupport) return;

            bubble.__mbToolBoxManualEditSupport = true;

            if (typeof bubble.visible?.subscribe === 'function') {
                bubble.visible.subscribe(visible => {
                    if (visible) {
                        if (manualRecordingOpenRequested) {
                            const trackModel =
                                typeof bubble.currentTrack === 'function'
                                    ? bubble.currentTrack()
                                    : (
                                        typeof bubble.target === 'function'
                                            ? bubble.target()
                                            : null
                                    );
                            beginManualRecordingEdit(trackModel);
                        }

                        manualRecordingOpenRequested = false;
                        return;
                    }

                    manualRecordingOpenRequested = false;

                    if (manualRecordingEditTrack) {
                        const trackModel = manualRecordingEditTrack;
                        const token =
                            trackModel.__mbToolBoxManualRecordingEdit;

                        setTimeout(
                            () => finishManualRecordingEdit(trackModel, token),
                            0
                        );
                    }
                });
            }

            /*
             * The native Recording bubble can move to the previous/next track
             * without closing. Transfer the manual-edit session with it.
             */
            if (typeof bubble.target?.subscribe === 'function') {
                bubble.target.subscribe(trackModel => {
                    if (
                        !manualRecordingEditTrack ||
                        !bubble.visible?.() ||
                        !trackModel ||
                        trackModel === manualRecordingEditTrack
                    ) {
                        return;
                    }

                    const previousTrack = manualRecordingEditTrack;
                    const previousToken =
                        previousTrack.__mbToolBoxManualRecordingEdit;

                    finishManualRecordingEdit(
                        previousTrack,
                        previousToken
                    );
                    beginManualRecordingEdit(trackModel);
                });
            }

            const currentBubbleTrack = () => (
                typeof bubble.currentTrack === 'function'
                    ? bubble.currentTrack()
                    : (
                        typeof bubble.target === 'function'
                            ? bubble.target()
                            : null
                    )
            );

            const beginFromTrustedBubbleInteraction = event => {
                if (!event.isTrusted) return;

                const target = event.target;
                if (!target || typeof target.closest !== 'function') return;
                if (!target.closest('#recording-assoc-bubble')) return;

                /*
                 * Auto Match can leave the native recording bubble open.
                 * A user may then type/paste an ISRC, click a search result,
                 * or choose a radio without clicking Edit again. Any real user
                 * interaction inside the native bubble means the recording
                 * choice is now manual and must take priority over the lock.
                 */
                beginManualRecordingEdit(currentBubbleTrack());
            };

            for (const type of [
                'pointerdown',
                'click',
                'keydown',
                'input',
                'change',
                'paste',
            ]) {
                document.addEventListener(
                    type,
                    beginFromTrustedBubbleInteraction,
                    true
                );
            }

            document.addEventListener('click', event => {
                if (!event.isTrusted) return;

                const editButton = event.target?.closest?.(
                    'button.edit-track-recording'
                );

                if (!editButton) return;

                manualRecordingOpenRequested = true;

                // Clear a stale request if MusicBrainz does not open the
                // bubble for any reason.
                setTimeout(() => {
                    manualRecordingOpenRequested = false;
                }, 1000);
            }, true);
        }

        async function linkExactIsrcRecording(row, trackModel, candidate, expectedIsrc) {
            if (!trackModel || typeof trackModel.recording !== 'function') {
                throw new Error('MusicBrainz track model is unavailable');
            }
    
            const verified = await verifyRecordingHasIsrc(candidate.id, expectedIsrc);
            if (!verified) {
                throw new Error(
                    'Safety check failed: recording ' + candidate.id +
                    ' does not contain ISRC ' + expectedIsrc
                );
            }
    
            const entity = recordingEntityFromWs(candidate);

            // This is an explicit ToolBox replacement chosen from the user's
            // supplied ISRC. The old association lock must not fight it.
            trackModel.__mbToolBoxRecordingLock?.dispose?.();
            trackModel.__mbToolBoxExactIsrcGuard?.dispose?.();

            trackModel.recording(entity);
            if (typeof trackModel.hasNewRecording === 'function') {
                trackModel.hasNewRecording(false);
            }
            keepRecordingAssociationLocked(trackModel, entity);
    
            const linked = await waitFor(() => {
                const current = readLinkedRecording(row);
                return current.id?.toLowerCase() === candidate.id.toLowerCase() ? current : null;
            }, 8000);
    
            if (!linked) {
                throw new Error('MusicBrainz did not confirm the exact ISRC recording link');
            }
    
            return linked;
        }
    
        function appendNoteIfPossible() {
            if (!needsAttribution) return;
            const textarea = document.querySelector('#edit-note-text, #edit-note textarea.edit-note');
            if (!textarea) return;
            const value = appendAttribution(textarea.value, SCRIPT_URL);
            if (value === textarea.value) return;
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
            if (setter) setter.call(textarea, value);
            else textarea.value = value;
            textarea.dispatchEvent(new Event('input', {bubbles: true}));
            textarea.dispatchEvent(new Event('change', {bubbles: true}));
        }
    
        async function openEditor(row, options = {}) {
            const {allowLinked = false, expectedRecordingId = null} = options;
            const button = row.querySelector('button.edit-track-recording');
            const element = document.querySelector('#recording-assoc-bubble');
            const model = PAGE_WINDOW.MB?.releaseEditor?.recordingBubble;
            if (!button || !element || !model || !row.isConnected) {
                throw new Error('The MusicBrainz recording editor is unavailable');
            }
            if (model.control !== button || !model.visible()) {
                await throttle();
                const currentId = readLinkedRecording(row).id;
                const invalidState = allowLinked
                    ? !currentId || (expectedRecordingId && currentId.toLowerCase() !== expectedRecordingId.toLowerCase())
                    : !maySelectUnlinkedRow(row);
                if (!row.isConnected || invalidState) {
                    throw new Error('The track or recording link changed while opening the editor');
                }
                button.click();
                // Opening the bubble can also start a native MusicBrainz suggestion request.
                nextRequestAt = Math.max(nextRequestAt, Date.now() + REQUEST_GAP_MS);
            }
            const trackLength = await waitFor(() => {
                if (!bubbleTargetsRow(model, row)) return null;
                return readAvailableTrackLength(row, model, button);
            }, 3000);
            if (!trackLength) throw new Error('Track length is unavailable');
            const input = element.querySelector('input.name');
            const suggestionsIdle = await waitFor(() => !element.querySelector('tr.loading-message'), 8000);
            if (!suggestionsIdle) throw new Error('MusicBrainz suggestions are still loading');
            return {button, element, model, input, trackLength};
        }
    
        function recordingEntityFromWs(candidate) {
            const MB = PAGE_WINDOW.MB;
            if (!MB?.entity || !UUID.test(candidate?.id || '')) {
                throw new Error('MusicBrainz recording entity API is unavailable');
            }
    
            const parts = Array.isArray(candidate['artist-credit'])
                ? candidate['artist-credit']
                : [];
    
            const artistCredit = {
                names: parts.map(part => ({
                    artist: {
                        gid: part?.artist?.id || '',
                        name: part?.artist?.name || '',
                        sort_name: part?.artist?.['sort-name'] || '',
                        entityType: 'artist',
                    },
                    name: part?.name || part?.artist?.name || '',
                    joinPhrase: part?.joinphrase || '',
                })),
            };
    
            return MB.entity({
                gid: candidate.id,
                name: candidate.title ?? candidate.name ?? '',
                length: candidate.length ?? null,
                artistCredit,
                video: Boolean(candidate.video),
                entityType: 'recording',
            }, 'recording');
        }
    
        async function selectInEditor(row, track, candidate, editor, options = {}) {
            const {allowLinked = false, expectedRecordingId = null, isrcMatch = false} = options;
            const {button, element, model, input} = editor;
            const assertCurrentTarget = () => {
                const current = readTrack(row);
                const currentRecordingId = readLinkedRecording(row).id;
                const invalidLinkState = allowLinked
                    ? !currentRecordingId || (expectedRecordingId && currentRecordingId.toLowerCase() !== expectedRecordingId.toLowerCase())
                    : !maySelectUnlinkedRow(row);
                if (!row.isConnected || invalidLinkState || !bubbleTargetsRow(model, row) ||
                    normalize(current.title) !== normalize(track.title) ||
                    normalize(current.credit) !== normalize(track.credit) ||
                    JSON.stringify(current.artistIds) !== JSON.stringify(track.artistIds)) {
                    throw new Error('The track or recording selector changed during matching');
                }
            };
            assertCurrentTarget();
    
            const suggestionsIdle = await waitFor(() => !element.querySelector('tr.loading-message'), 8000);
            if (!suggestionsIdle) throw new Error('MusicBrainz suggestions are still loading');
            assertCurrentTarget();
    
            if (isrcMatch) {
                /*
                 * Exact ISRC lookup already resolved the recording MBID. Do not rely
                 * on MusicBrainz's native suggestion list or autocomplete to contain
                 * that recording: track artist credits can differ only by join phrase
                 * (for example "GIMS & Leto" vs "GIMS feat. Leto"), which can hide the
                 * correct recording from native suggestions.
                 */
                const targetTrack = model.currentTrack?.();
                if (!targetTrack || typeof targetTrack.recording !== 'function') {
                    throw new Error('MusicBrainz recording model is unavailable');
                }
                const entity = recordingEntityFromWs(candidate);
                targetTrack.recording(entity);
                if (typeof targetTrack.hasNewRecording === 'function') {
                    targetTrack.hasNewRecording(false);
                }
                keepExactIsrcAssociationAcrossTracklistEdits(targetTrack, entity);
            } else {
                const suggested = [...element.querySelectorAll('input[data-change="recording"]')]
                    .find(radio => radio.value.toLowerCase() === candidate.id.toLowerCase());
                if (suggested) {
                    assertCurrentTarget();
                    suggested.click();
                } else {
                    if (!input) throw new Error('The recording search field is unavailable');
                    await throttle();
                    assertCurrentTarget();
                    input.value = candidate.id;
                    input.dispatchEvent(new Event('input', {bubbles: true}));
                }
            }
    
            const linked = await waitFor(() => {
                const current = readLinkedRecording(row);
                return current.id?.toLowerCase() === candidate.id.toLowerCase() ? current : null;
            }, 12000);
            if (!linked) throw new Error('MusicBrainz did not confirm the recording lookup');
    
            if (!isrcMatch) {
                // Metadata matching remains strict. Exact ISRC matching is verified by
                // the recording MBID above and must not be undone by credit/length drift.
                const verified = evaluateCandidate(track, {...linked, length: candidate.length});
                if (!verified.ok || linked.length === null || Math.abs(linked.length - candidate.length) > 500) {
                    if (bubbleTargetsRow(model, row) &&
                        readLinkedRecording(row).id?.toLowerCase() === candidate.id.toLowerCase()) {
                        if (allowLinked && expectedRecordingId) {
                            const original = [...element.querySelectorAll('input[data-change="recording"]')]
                                .find(radio => radio.value.toLowerCase() === expectedRecordingId.toLowerCase());
                            if (original) {
                                original.click();
                            } else if (input) {
                                await throttle();
                                input.value = expectedRecordingId;
                                input.dispatchEvent(new Event('input', {bubbles: true}));
                            }
                            await waitFor(
                                () => readLinkedRecording(row).id?.toLowerCase() === expectedRecordingId.toLowerCase(),
                                8000,
                            );
                        } else {
                            element.querySelector('#add-new-recording')?.click();
                        }
                    }
                    throw new Error('Editor linked a recording with different metadata');
                }
            }
            return linked;
        }
    
        function showResult(list, row, label, detail, linkId) {
            const item = document.createElement('li');
            const position = row.querySelector('td.position')?.textContent.trim() || '?';
            item.append(document.createTextNode(position + '. ' + label + ': ' + detail));
            if (linkId) {
                const link = document.createElement('a');
                link.href = '/recording/' + linkId;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = ' [recording]';
                item.append(link);
            }
            list.append(item);
        }
    
        function trackRowsUnchanged(rows) {
            const current = document.querySelectorAll('#recordings tr.track');
            return current.length === rows.length && rows.every((row, index) => row === current[index]);
        }
    
        function switchRecordingToAddNew(track) {
            // Explicit ToolBox replacement is allowed to release recording locks.
            track?.__mbToolBoxRecordingLock?.dispose?.();
            track?.__mbToolBoxExactIsrcGuard?.dispose?.();

            /*
             * Use MusicBrainz's native state transition. Track.hasNewRecording(true)
             * invokes the release editor's own hasNewRecordingChanged() handler,
             * which clears the existing recording association through
             * Track#setRecordingValue and leaves the track explicitly marked as
             * "Add a new recording".
             */
            if (typeof track?.hasNewRecording !== 'function') {
                throw new Error(
                    'MusicBrainz Add a new recording state is unavailable.'
                );
            }

            track.hasNewRecording(true);
        }

        async function removeAllLinks(panel) {
            if (running) return;

            const release = PAGE_WINDOW.MB?.releaseEditor?.rootField?.release?.();
            const status = panel.querySelector('.mb-safe-status');
            const list = panel.querySelector('.mb-safe-results');
            const toggle = panel.querySelector('.mb-safe-toggle');

            if (!release || typeof release.allTracks !== 'function') {
                status.textContent = 'MusicBrainz release recording model is unavailable.';
                return;
            }

            // Only inspect recording associations. Do not inspect or mutate any
            // Tracklist metadata fields.
            const linked = [...release.allTracks()].filter(track =>
                typeof track?.hasExistingRecording === 'function' &&
                track.hasExistingRecording()
            );

            if (!linked.length) {
                const visibleLinked = [...document.querySelectorAll('#recordings tr.track')]
                    .filter(row => Boolean(recordingIdFromCell(row.querySelectorAll('td.name')[1])));

                status.textContent = visibleLinked.length
                    ? `Error: MusicBrainz shows ${visibleLinked.length} linked recording(s), but the recording model returned none. No recordings were changed.`
                    : 'No linked recordings to switch to Add a new recording.';
                return;
            }

            if (!confirm(`Switch all ${linked.length} linked recordings to Add a new recording?`)) return;

            let switched = 0;
            for (const track of linked) {
                switchRecordingToAddNew(track);

                if (
                    typeof track?.hasExistingRecording === 'function' &&
                    !track.hasExistingRecording() &&
                    typeof track?.hasNewRecording === 'function' &&
                    track.hasNewRecording()
                ) {
                    switched++;
                }
            }

            list.replaceChildren();
            list.hidden = true;
            toggle.hidden = true;
            toggle.textContent = 'Show results';

            if (switched !== linked.length) {
                status.textContent =
                    `Switched ${switched}/${linked.length} tracks to Add a new recording.`;
                return;
            }

            needsAttribution = true;
            appendNoteIfPossible();
            status.textContent =
                `Switched all ${linked.length} linked tracks to Add a new recording.`;
            updateDuplicateHighlights();
        }

        async function runMatcher(panel, isrcs = null, targetRows = null, options = {}) {
            if (running) return;
    
            const allRows = [...document.querySelectorAll('#recordings tr.track')];
            const rows = Array.isArray(targetRows)
                ? targetRows.filter(row => row?.isConnected)
                : allRows;
            const allowLinked = Boolean(options.allowLinked);
            const requireLinked = Boolean(options.requireLinked);
            const highlightedMode = Boolean(options.highlighted);
            const allTrackModels = isrcs ? releaseTrackModels() : [];
    
            const button = panel.querySelector('.mb-safe-start');
            const highlightedButton = panel.querySelector('.mb-safe-highlighted');
            const isrcButton = panel.querySelector('.mb-safe-isrc');
            const removeButton = panel.querySelector('.mb-safe-remove-links');
            const stop = panel.querySelector('.mb-safe-stop');
            const toggle = panel.querySelector('.mb-safe-toggle');
            const status = panel.querySelector('.mb-safe-status');
            const list = panel.querySelector('.mb-safe-results');
    
            list.replaceChildren();
            list.hidden = true;
            toggle.hidden = true;
            toggle.textContent = 'Show results';
    
            if (!rows.length) {
                status.textContent = highlightedMode
                    ? 'No duplicate recording links are highlighted.'
                    : 'No loaded tracks. Open the Recordings tab and load the medium first.';
                return;
            }
    
            if (isrcs && (
                isrcs.length !== allRows.length ||
                allTrackModels.length !== allRows.length ||
                document.querySelector('#recordings .edit-recording')
            )) {
                status.textContent = 'The loaded track/model count changed or a medium is not loaded. Open all media and paste the ISRCs again.';
                return;
            }
    
            running = true;
            PAGE_WINDOW.__MB_RECORDING_MATCHER_ACTIVE__ = true;
            stopRequested = false;
            button.disabled = true;
            highlightedButton.disabled = true;
            isrcButton.disabled = true;
            removeButton.disabled = true;
            stop.hidden = false;
    
            let matched = 0;
            let unchanged = 0;
            let review = 0;
            let processed = 0;
    
            try {
                for (const row of rows) {
                    if (stopRequested) break;
    
                    if (isrcs && !trackRowsUnchanged(allRows)) {
                        status.textContent = `Stopped: The track order changed. ${matched} matched, ${review} need review.`;
                        break;
                    }
    
                    processed++;
                    const track = readTrack(row);
                    const isrc = isrcs?.[allRows.indexOf(row)];
                    const display = `${track.title || '(untitled)'}${isrc ? ' (' + isrc + ')' : ''}`;
                    status.textContent = `Checking ${processed}/${rows.length}: ${track.title || '(untitled)'}${isrc ? ' (' + isrc + ')' : ''}`;
    
                    const existing = readLinkedRecording(row);
    
                    if (!allowLinked && existing.id) {
                        showResult(list, row, 'Already linked', display, existing.id);
                        continue;
                    }
    
                    if (requireLinked && !existing.id) {
                        review++;
                        showResult(list, row, 'Review', `${display} - highlighted recording link is no longer present`);
                        continue;
                    }
    
                    let editor = null;
    
                    if (!isrc) {
                        if (!track.title || !track.artistIds.length || track.artistIds.some(id => !UUID.test(id)) || !track.credit) {
                            review++;
                            showResult(list, row, 'Review', `${display} - missing title or artist ID`);
                            continue;
                        }
    
                        try {
                            editor = await openEditor(row, {
                                allowLinked,
                                expectedRecordingId: existing.id,
                            });
                            track.length = editor.trackLength;
                        } catch (error) {
                            review++;
                            showResult(list, row, 'Review', `${display} - ${error.message}`);
                            continue;
                        }
                    }
    
                    let chosen;
                    try {
                        if (isrc) {
                            const search = await searchByIsrc(isrc);
                            chosen = search.reason ? {reason: search.reason} : chooseByIsrc(track, search.recordings, isrc);
                        } else {
                            chosen = await searchRecordings(track);
                        }
                    } catch (error) {
                        review++;
                        showResult(list, row, 'Review', `${display} - ${error.message}`);
                        continue;
                    }
    
                    if (isrcs && !trackRowsUnchanged(allRows)) {
                        status.textContent = `Stopped: The track order changed. ${matched} matched, ${review} need review.`;
                        break;
                    }
    
                    if (!chosen.id) {
                        if (isrc && Array.isArray(chosen.ambiguousCandidates)) {
                            const index = allRows.indexOf(row);
                            watchManualIsrcChoice(
                                allTrackModels[index],
                                isrc,
                                chosen.ambiguousCandidates
                            );
                        }
                        review++;
                        showResult(list, row, 'Review', `${display} - ${chosen.reason}`);
                        continue;
                    }
    
                    if (allowLinked && existing.id?.toLowerCase() === chosen.id.toLowerCase()) {
                        unchanged++;
                        showResult(
                            list,
                            row,
                            'Already correct',
                            display + (chosen.circle ? ' - ' + chosen.circle : ''),
                            chosen.id,
                        );
                        continue;
                    }
    
                    try {
                        if (isrc) {
                            const index = allRows.indexOf(row);
                            await linkExactIsrcRecording(
                                row,
                                allTrackModels[index],
                                chosen.candidate,
                                isrc,
                            );
                        } else {
                            await selectInEditor(row, track, chosen.candidate, editor, {
                                allowLinked,
                                expectedRecordingId: existing.id,
                                isrcMatch: false,
                            });
                        }
    
                        matched++;
                        needsAttribution = true;
                        appendNoteIfPossible();
                        showResult(
                            list,
                            row,
                            chosen.cached ? 'Matched (cached ISRC choice)' : 'Matched',
                            display + (chosen.circle ? ' - ' + chosen.circle : ''),
                            chosen.id,
                        );
                    } catch (error) {
                        review++;
                        showResult(list, row, 'Review', `${display} - ${error.message}`);
                    }
                }
    
                if (!status.textContent.startsWith('Stopped:')) {
                    const unchangedText = allowLinked && unchanged
                        ? `, ${unchanged} already correct`
                        : '';
                    status.textContent = `${stopRequested ? 'Stopped' : 'Finished'}: ${matched} matched${unchangedText}, ${review} need review, ${processed}/${rows.length} checked. Review all associations before submitting.`;
                }
            } finally {
                PAGE_WINDOW.__MB_RECORDING_MATCHER_ACTIVE__ = false;
                running = false;
                button.disabled = false;
                isrcButton.disabled = false;
                removeButton.disabled = false;
                stop.hidden = true;
                toggle.hidden = list.children.length === 0;
                appendNoteIfPossible();
                updateDuplicateHighlights();
            }
        }
    
        function runHighlightedMatcher(panel) {
            const rows = highlightedEditorRows();
            runMatcher(panel, null, rows, {
                allowLinked: true,
                requireLinked: true,
                highlighted: true,
            });
        }
    
        function openIsrcDialog(panel) {
            if (running || document.getElementById('mb-safe-isrc-dialog')) return;

            const rows = [...document.querySelectorAll('#recordings tr.track')];
            const trigger = panel.querySelector('.mb-safe-isrc');

            const editorBox = document.createElement('div');
            editorBox.id = 'mb-safe-isrc-dialog';
            editorBox.className = 'form';

            const description = document.createElement('p');
            description.textContent =
                'Paste one ISRC per track in release order. A plain list or table works. Include tracks already linked.';

            const label = document.createElement('label');
            label.htmlFor = 'mb-safe-isrc-input';
            label.textContent = 'ISRCs:';

            const input = document.createElement('textarea');
            input.id = 'mb-safe-isrc-input';
            input.rows = 12;
            input.spellcheck = false;
            input.placeholder = 'NLA321400132\nNLA321400141\nNLA321400142';

            const error = document.createElement('p');
            error.className = 'error mb-safe-isrc-error';
            error.setAttribute('role', 'alert');

            const buttons = document.createElement('div');
            buttons.className = 'buttons';

            const confirm = document.createElement('button');
            confirm.type = 'button';
            confirm.className = 'mb-safe-isrc-confirm';
            confirm.textContent = 'Match tracks';

            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'negative mb-safe-isrc-cancel';
            cancel.textContent = 'Cancel';

            buttons.append(confirm, cancel);
            editorBox.append(description, label, document.createElement('br'), input, error, buttons);
            panel.appendChild(editorBox);

            const close = () => {
                editorBox.remove();
                trigger?.focus();
            };

            const unavailable =
                !rows.length || Boolean(document.querySelector('#recordings .edit-recording'));

            if (unavailable) {
                error.textContent = 'Open the Recordings tab and load every medium before matching ISRCs.';
                confirm.disabled = true;
            } else {
                description.textContent += ` ${rows.length} tracks are loaded.`;
            }

            confirm.addEventListener('click', () => {
                try {
                    if (
                        document.querySelector('#recordings .edit-recording') ||
                        !trackRowsUnchanged(rows)
                    ) {
                        throw new Error(
                            'The track list changed. Close this section and paste the ISRCs again.'
                        );
                    }

                    const codes = parseIsrcInput(input.value, rows.length);
                    close();
                    runMatcher(panel, codes, null, {
                        allowLinked: true,
                    });
                } catch (cause) {
                    error.textContent = cause.message;
                }
            });

            cancel.addEventListener('click', close);
            input.focus();
        }

        function migrateLocalIsrcChoices() {
            const merged = readIsrcChoiceCache();
            if (Object.keys(merged).length) writeIsrcChoiceCache(merged);
            return Object.keys(merged).length;
        }

        function addControls() {
            if (document.getElementById('mb-safe-recording-matcher')) return true;
            const container = document.querySelector('#recordings .changes');
            if (!container) return false;
            const panel = document.createElement('fieldset');
            panel.id = 'mb-safe-recording-matcher';
            panel.innerHTML = '<legend>Recording matcher</legend>' +
                '<div class="buttons mb-safe-actions mb-toolbox-native-actions">' +
                    '<button type="button" class="mb-safe-start">Match unlinked recordings</button>' +
                    '<button type="button" class="mb-safe-highlighted">Auto-match highlighted</button>' +
                    '<button type="button" class="mb-safe-isrc">Match by ISRC</button>' +
                    '<button type="button" class="mb-safe-github-cache">Connect GitHub cache</button>' +
                    '<button type="button" class="negative mb-safe-remove-links">Remove all links</button>' +
                    '<button type="button" class="mb-safe-stop" hidden>Stop after current track</button>' +
                    '<button type="button" class="mb-safe-toggle" hidden>Show results</button>' +
                '</div>' +
                '<p class="mb-safe-status mb-toolbox-native-status" role="status">Duplicate links are bright red. Metadata match: artist circles + title + max 7s. ISRC match: exact ISRC only.</p>' +
                '<ol class="mb-safe-results" hidden></ol>';
            panel.querySelector('.mb-safe-start').addEventListener('click', () => runMatcher(panel));
            panel.querySelector('.mb-safe-highlighted').addEventListener('click', () => runHighlightedMatcher(panel));
            panel.querySelector('.mb-safe-isrc').addEventListener('click', () => openIsrcDialog(panel));
            panel.querySelector('.mb-safe-github-cache').addEventListener('click', () => configureGithubCache(panel));
            panel.querySelector('.mb-safe-remove-links').addEventListener('click', () => removeAllLinks(panel));
            panel.querySelector('.mb-safe-stop').addEventListener('click', () => { stopRequested = true; });
            panel.querySelector('.mb-safe-toggle').addEventListener('click', event => {
                const list = panel.querySelector('.mb-safe-results');
                list.hidden = !list.hidden;
                event.currentTarget.textContent = list.hidden ? 'Show results' : 'Hide results';
            });
            container.prepend(panel);
            updateDuplicateHighlights();
            migrateLocalIsrcChoices();
            updateGithubCacheButton(panel);
            syncGithubCacheQuietly(panel);
            installManualRecordingEditSupport();
            protectAllLinkedRecordings();
            return true;
        }
    
        const noteRoot = document.getElementById('edit-note');
        if (noteRoot) new MutationObserver(appendNoteIfPossible).observe(noteRoot, {childList: true, subtree: true});
        document.getElementById('enter-edit')?.addEventListener('click', appendNoteIfPossible, true);
        if (!addControls()) {
            const observer = new MutationObserver(() => {
                if (addControls()) {
                    observer.disconnect();
                    protectAllLinkedRecordings();
                }
            });
            observer.observe(document.body, {childList: true, subtree: true});
        }

        const recordingsRoot = document.getElementById('recordings');
        if (recordingsRoot) {
            let lockScanQueued = false;
            new MutationObserver(() => {
                if (lockScanQueued) return;
                lockScanQueued = true;
                setTimeout(() => {
                    lockScanQueued = false;
                    protectAllLinkedRecordings();
                }, 0);
            }).observe(recordingsRoot, {childList: true, subtree: true});
        }
    })();
    }

    // ============================================================================
    // Spotify -> linked MusicBrainz release
    // Shows a MusicBrainz icon beside the Spotify album title when the exact
    // Spotify album URL is linked to one or more MusicBrainz releases.
    // ============================================================================
    if (location.hostname === 'open.spotify.com') {
    (() => {
        'use strict';

        const LINK_CLASS = 'mb-toolbox-spotify-release-link';
        const TITLE_ROW_CLASS = 'mb-toolbox-spotify-title-row';
        const STYLE_ID = 'mb-toolbox-spotify-release-link-style';
        const CACHE_KEY = 'mb-toolbox-spotify-release-links-v2';
        const FOUND_TTL = 30 * 24 * 60 * 60 * 1000;
        const MISSING_TTL = 15 * 1000;
        const MAX_CACHE_ENTRIES = 500;
        const REQUEST_INTERVAL = 1100;
        const TRANSIENT_RETRY_MS = 5000;
        const HARMONY_URL = 'https://harmony.pulsewidth.org.uk/';
        const HARMONY_LOGO_SVG = "<svg viewBox=\"0 0 200 200\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><defs><linearGradient id=\"mbtb-harmony-gradient\" x1=\"-51.64\" y1=\"190.18\" x2=\"287.01\" y2=\"-2.23\" gradientUnits=\"userSpaceOnUse\"><stop offset=\".29\" stop-color=\"#ffb92c\"/><stop offset=\"1\" stop-color=\"#c45555\"/></linearGradient></defs><path fill=\"#c45555\" d=\"M68.08 122.59c4.17 2.66 9.11 4.23 14.42 4.23 14.82 0 26.84-12.02 26.84-26.84S97.32 73.14 82.5 73.14c-5.35 0-10.31 1.58-14.5 4.28-.31.02-.63.02-.94.02-2.42 0-4.85-.49-6.9-1.86-2.99-1.99-4.29-6.45-4.77-11.01V21.54L7.74 48.87v102.25l47.64 27.34v-43.03c.49-4.57 1.78-9.02 4.77-11.01 2.06-1.37 4.48-1.86 6.9-1.86.34 0 .68 0 1.02.03Z\"/><path fill=\"url(#mbtb-harmony-gradient)\" d=\"M63.67 175.1v-39.19c.38-3.11 1.04-4.35 1.25-4.68.26-.13.6-.23 1-.29 5.1 2.74 10.78 4.18 16.58 4.18 19.37 0 35.13-15.76 35.13-35.13S101.87 64.86 82.5 64.86c-5.83 0-11.53 1.45-16.64 4.21-.38-.06-.69-.16-.94-.28-.21-.33-.87-1.57-1.25-4.68V24.9L107.08 0l85.18 48.87v102.25L107.08 200l-43.4-24.9Z\"/></svg>";

        let currentAlbumId = '';
        let currentReleases = null;
        let currentLookupAt = 0;
        let lookupInFlight = false;
        let lookupRetryTimer = null;
        let currentLookupError = '';
        let requestGeneration = 0;
        let lastRequestAt = 0;
        let scanQueued = false;

        function albumIdFromLocation() {
            const match = location.pathname.match(
                /^\/(?:intl-[^/]+\/)?album\/([A-Za-z0-9]+)(?:\/|$)/
            );
            return match ? match[1] : '';
        }

        function canonicalSpotifyAlbumUrl(albumId) {
            return `https://open.spotify.com/album/${albumId}`;
        }

        function readCache() {
            try {
                const value = GM_getValue(CACHE_KEY, {});
                return value && typeof value === 'object' ? value : {};
            } catch {
                return {};
            }
        }

        function writeCache(cache) {
            try {
                const entries = Object.entries(cache)
                    .sort((a, b) => Number(b[1]?.checkedAt || 0) - Number(a[1]?.checkedAt || 0))
                    .slice(0, MAX_CACHE_ENTRIES);
                GM_setValue(CACHE_KEY, Object.fromEntries(entries));
            } catch {
                // Cache failure must never break the Spotify page.
            }
        }

        function cachedReleases(albumId) {
            const cache = readCache();
            const item = cache[albumId];
            if (!item?.checkedAt || !Array.isArray(item.releases)) return null;

            const ttl = item.releases.length ? FOUND_TTL : MISSING_TTL;
            if (Date.now() - item.checkedAt > ttl) return null;

            return item.releases;
        }

        function storeCachedReleases(albumId, releases) {
            const cache = readCache();
            cache[albumId] = {
                checkedAt: Date.now(),
                releases,
            };
            writeCache(cache);
        }

        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        async function throttleMusicBrainz() {
            const wait = Math.max(
                0,
                REQUEST_INTERVAL - (Date.now() - lastRequestAt)
            );
            if (wait) await sleep(wait);
            lastRequestAt = Date.now();
        }

        function requestJson(url) {
            return new Promise((resolve, reject) => {
                __mbToolBoxGmXmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: {
                        Accept: 'application/json',
                    },
                    timeout: 15000,
                    onload(response) {
                        if (response.status === 404) {
                            resolve(null);
                            return;
                        }
                        if (response.status < 200 || response.status >= 300) {
                            reject(new Error(`MusicBrainz HTTP ${response.status}`));
                            return;
                        }
                        try {
                            resolve(JSON.parse(response.responseText));
                        } catch (error) {
                            reject(error);
                        }
                    },
                    onerror() {
                        reject(new Error('MusicBrainz request failed'));
                    },
                    ontimeout() {
                        reject(new Error('MusicBrainz request timed out'));
                    },
                });
            });
        }

        function parseReleaseRelations(data) {
            const relations = Array.isArray(data?.relations)
                ? data.relations
                : [];
            const unique = new Map();

            for (const relation of relations) {
                const release = relation?.release;
                const id = String(release?.id || '').trim().toLowerCase();
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
                    continue;
                }

                if (!unique.has(id)) {
                    unique.set(id, {
                        id,
                        title: String(release?.title || '').trim(),
                        disambiguation: String(release?.disambiguation || '').trim(),
                    });
                }
            }

            return [...unique.values()];
        }

        async function lookupMusicBrainzReleases(albumId, force = false) {
            const cached = force ? null : cachedReleases(albumId);
            if (cached) return cached;

            await throttleMusicBrainz();

            const resource = canonicalSpotifyAlbumUrl(albumId);
            const endpoint =
                'https://musicbrainz.org/ws/2/url' +
                '?resource=' + encodeURIComponent(resource) +
                '&inc=release-rels&fmt=json';

            const data = await requestJson(endpoint);
            const releases = parseReleaseRelations(data);
            storeCachedReleases(albumId, releases);
            return releases;
        }

        function installStyles() {
            if (document.getElementById(STYLE_ID)) return;

            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = `
                .${TITLE_ROW_CLASS} {
                    display: flex !important;
                    align-items: center !important;
                    gap: 10px !important;
                    min-width: 0;
                }
                .${LINK_CLASS} {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    flex: 0 0 auto;
                    width: 30px;
                    height: 30px;
                    border-radius: 4px;
                    text-decoration: none !important;
                    opacity: .92;
                    transition: transform .12s ease, opacity .12s ease;
                }
                .${LINK_CLASS}:hover {
                    opacity: 1;
                    transform: scale(1.08);
                }
                .${LINK_CLASS} img,
                .${LINK_CLASS} svg {
                    display: block;
                    width: 28px;
                    height: 28px;
                    border: 0;
                }
                .${LINK_CLASS}.mb-toolbox-spotify-loading {
                    cursor: wait;
                    pointer-events: none;
                    opacity: 1;
                    transform: none !important;
                }
                .mb-toolbox-spotify-spinner {
                    box-sizing: border-box;
                    width: 22px;
                    height: 22px;
                    border: 3px solid rgba(255, 255, 255, .28);
                    border-top-color: #fff;
                    border-radius: 50%;
                    animation: mb-toolbox-spotify-spin .8s linear infinite;
                }
                @keyframes mb-toolbox-spotify-spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        function spotifyTitleRow() {
            const title = document.querySelector(
                '[data-testid="album-page"] [data-testid="entityTitle"], ' +
                'h1[data-testid="entityTitle"], ' +
                '[data-testid="entityTitle"]'
            );
            return title?.parentElement || null;
        }

        function removeLinks() {
            if (lookupRetryTimer !== null) {
                clearTimeout(lookupRetryTimer);
                lookupRetryTimer = null;
            }
            document.querySelectorAll('.' + LINK_CLASS).forEach(node => node.remove());
            document.querySelectorAll('.' + TITLE_ROW_CLASS).forEach(node => {
                node.classList.remove(TITLE_ROW_CLASS);
            });
        }

        function renderLoading(message = 'Checking MusicBrainz...') {
            if (!currentAlbumId) return false;

            const row = spotifyTitleRow();
            if (!row) return false;

            installStyles();
            row.classList.add(TITLE_ROW_CLASS);

            row.querySelectorAll('.' + LINK_CLASS).forEach(node => node.remove());

            const loading = document.createElement('span');
            loading.className = LINK_CLASS + ' mb-toolbox-spotify-loading';
            loading.dataset.linkKey = 'loading';
            loading.title = message;
            loading.setAttribute('role', 'status');
            loading.setAttribute('aria-label', message);

            const spinner = document.createElement('span');
            spinner.className = 'mb-toolbox-spotify-spinner';
            spinner.setAttribute('aria-hidden', 'true');
            loading.appendChild(spinner);

            row.appendChild(loading);
            return true;
        }

        function renderLinks() {
            if (!currentAlbumId || !Array.isArray(currentReleases)) return false;

            const row = spotifyTitleRow();
            if (!row) return false;

            installStyles();
            row.classList.add(TITLE_ROW_CLASS);

            const desired = currentReleases.length
                ? currentReleases.map(release => ({
                    key: 'mb:' + release.id,
                    mbid: release.id,
                    href: 'https://musicbrainz.org/release/' + release.id,
                    image: 'https://musicbrainz.org/favicon.ico',
                    alt: 'MusicBrainz',
                    title: release.disambiguation
                        ? `Open MusicBrainz release: ${release.title || release.id} (${release.disambiguation})`
                        : `Open MusicBrainz release: ${release.title || release.id}`,
                }))
                : [{
                    key: 'harmony',
                    mbid: '',
                    href:
                        HARMONY_URL +
                        'release?url=' +
                        encodeURIComponent(canonicalSpotifyAlbumUrl(currentAlbumId)) +
                        '&gtin=&region=&deezer=&spotify=&tidal=&qobuz=',
                    svg: HARMONY_LOGO_SVG,
                    alt: 'Harmony',
                    title: 'Search this Spotify release in Harmony',
                }];

            const wantedKeys = new Set(desired.map(item => item.key));
            row.querySelectorAll('.' + LINK_CLASS).forEach(link => {
                if (!wantedKeys.has(link.dataset.linkKey || '')) link.remove();
            });

            for (const item of desired) {
                if (row.querySelector(
                    `.${LINK_CLASS}[data-link-key="${CSS.escape(item.key)}"]`
                )) {
                    continue;
                }

                const link = document.createElement('a');
                link.className = LINK_CLASS;
                link.dataset.linkKey = item.key;
                if (item.mbid) link.dataset.mbid = item.mbid;
                link.href = item.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.title = item.title;
                link.setAttribute('aria-label', item.title);

                if (item.svg) {
                    const icon = document.createElement('span');
                    icon.setAttribute('aria-hidden', 'true');
                    icon.innerHTML = item.svg;
                    link.appendChild(icon.firstElementChild);
                } else {
                    const image = document.createElement('img');
                    image.src = item.image;
                    image.alt = item.alt;
                    image.width = 28;
                    image.height = 28;
                    link.appendChild(image);
                }

                row.appendChild(link);
            }

            return true;
        }

        function scheduleLookupRetry(albumId, generation, error) {
            if (
                generation !== requestGeneration ||
                albumId !== currentAlbumId ||
                albumId !== albumIdFromLocation()
            ) {
                return;
            }

            currentLookupError = String(error?.message || error || 'lookup failed');
            renderLoading('MusicBrainz lookup failed - retrying...');

            if (lookupRetryTimer !== null) return;
            lookupRetryTimer = setTimeout(() => {
                lookupRetryTimer = null;
                if (
                    generation === requestGeneration &&
                    albumId === currentAlbumId &&
                    albumId === albumIdFromLocation()
                ) {
                    refreshCurrentAlbum(true);
                }
            }, TRANSIENT_RETRY_MS);
        }

        async function refreshCurrentAlbum(force = false) {
            const albumId = albumIdFromLocation();
            if (!albumId || lookupInFlight) return;

            if (lookupRetryTimer !== null) {
                clearTimeout(lookupRetryTimer);
                lookupRetryTimer = null;
            }

            lookupInFlight = true;
            currentLookupError = '';
            const generation = requestGeneration;
            renderLoading('Checking MusicBrainz...');

            try {
                const releases = await lookupMusicBrainzReleases(albumId, force);

                if (
                    generation !== requestGeneration ||
                    albumId !== currentAlbumId ||
                    albumId !== albumIdFromLocation()
                ) {
                    return;
                }

                currentLookupAt = Date.now();
                currentReleases = releases;
                currentLookupError = '';
                renderLinks();
            } catch (error) {
                console.warn(
                    '[MusicBrainz ToolBox] Spotify MusicBrainz lookup failed:',
                    error
                );
                currentReleases = null;
                scheduleLookupRetry(albumId, generation, error);
            } finally {
                lookupInFlight = false;
            }
        }

        async function handleRouteChange() {
            const albumId = albumIdFromLocation();

            if (albumId === currentAlbumId) {
                if (lookupInFlight) {
                    renderLoading('Checking MusicBrainz...');
                } else if (lookupRetryTimer !== null || currentLookupError) {
                    renderLoading('MusicBrainz lookup failed - retrying...');
                } else if (Array.isArray(currentReleases)) {
                    renderLinks();

                    // "Not found" is deliberately short-lived. This lets a
                    // newly-added MusicBrainz relationship replace the Harmony
                    // fallback without requiring a browser restart.
                    if (
                        currentReleases.length === 0 &&
                        Date.now() - currentLookupAt >= MISSING_TTL
                    ) {
                        refreshCurrentAlbum(true);
                    }
                }
                return;
            }

            currentAlbumId = albumId;
            currentReleases = null;
            currentLookupAt = 0;
            currentLookupError = '';
            ++requestGeneration;
            removeLinks();

            if (!albumId) return;

            refreshCurrentAlbum(false);
        }

        function queueScan() {
            if (scanQueued) return;
            scanQueued = true;
            setTimeout(() => {
                scanQueued = false;
                handleRouteChange();
            }, 50);
        }

        const observer = new MutationObserver(queueScan);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });

        // Returning from MusicBrainz after adding the Spotify relationship
        // forces an immediate recheck instead of trusting a previous miss.
        window.addEventListener('focus', () => {
            if (currentAlbumId && Array.isArray(currentReleases) && currentReleases.length === 0) {
                refreshCurrentAlbum(true);
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (
                document.visibilityState === 'visible' &&
                currentAlbumId &&
                Array.isArray(currentReleases) &&
                currentReleases.length === 0
            ) {
                refreshCurrentAlbum(true);
            }
        });

        setInterval(handleRouteChange, 500);
        handleRouteChange();
    })();
    }

    // ============================================================================
    // Apple Music -> linked MusicBrainz release
    // MusicBrainz cleans Apple Music album URLs to:
    // https://music.apple.com/<storefront>/album/<catalog-id>
    // Shows MusicBrainz when linked, otherwise Harmony as the lookup fallback.
    // ============================================================================
    if (location.hostname === 'music.apple.com') {
    (() => {
        'use strict';

        const LINK_CLASS = 'mb-toolbox-apple-release-link';
        const TITLE_ROW_CLASS = 'mb-toolbox-apple-title-row';
        const STYLE_ID = 'mb-toolbox-apple-release-link-style';
        const CACHE_KEY = 'mb-toolbox-apple-release-links-v2';
        const FOUND_TTL = 30 * 24 * 60 * 60 * 1000;
        const MISSING_TTL = 15 * 1000;
        const MAX_CACHE_ENTRIES = 500;
        const REQUEST_INTERVAL = 1100;
        const HARMONY_URL = 'https://harmony.pulsewidth.org.uk/';
        const HARMONY_LOGO_SVG = "<svg viewBox=\"0 0 200 200\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><defs><linearGradient id=\"mbtb-harmony-gradient\" x1=\"-51.64\" y1=\"190.18\" x2=\"287.01\" y2=\"-2.23\" gradientUnits=\"userSpaceOnUse\"><stop offset=\".29\" stop-color=\"#ffb92c\"/><stop offset=\"1\" stop-color=\"#c45555\"/></linearGradient></defs><path fill=\"#c45555\" d=\"M68.08 122.59c4.17 2.66 9.11 4.23 14.42 4.23 14.82 0 26.84-12.02 26.84-26.84S97.32 73.14 82.5 73.14c-5.35 0-10.31 1.58-14.5 4.28-.31.02-.63.02-.94.02-2.42 0-4.85-.49-6.9-1.86-2.99-1.99-4.29-6.45-4.77-11.01V21.54L7.74 48.87v102.25l47.64 27.34v-43.03c.49-4.57 1.78-9.02 4.77-11.01 2.06-1.37 4.48-1.86 6.9-1.86.34 0 .68 0 1.02.03Z\"/><path fill=\"url(#mbtb-harmony-gradient)\" d=\"M63.67 175.1v-39.19c.38-3.11 1.04-4.35 1.25-4.68.26-.13.6-.23 1-.29 5.1 2.74 10.78 4.18 16.58 4.18 19.37 0 35.13-15.76 35.13-35.13S101.87 64.86 82.5 64.86c-5.83 0-11.53 1.45-16.64 4.21-.38-.06-.69-.16-.94-.28-.21-.33-.87-1.57-1.25-4.68V24.9L107.08 0l85.18 48.87v102.25L107.08 200l-43.4-24.9Z\"/></svg>";

        let currentAlbumKey = '';
        let currentReleases = null;
        let currentLookupAt = 0;
        let lookupInFlight = false;
        let requestGeneration = 0;
        let lastRequestAt = 0;
        let scanQueued = false;

        function appleAlbumInfoFromLocation() {
            const parts = location.pathname.split('/').filter(Boolean);
            const albumIndex = parts.findIndex(part => part.toLowerCase() === 'album');
            if (albumIndex < 0) return null;

            const id = parts
                .slice(albumIndex + 1)
                .reverse()
                .find(part => /^\d+$/.test(part));
            if (!id) return null;

            const storefront =
                albumIndex > 0 && /^[a-z]{2}$/i.test(parts[albumIndex - 1])
                    ? parts[albumIndex - 1].toLowerCase()
                    : 'us';

            const cleanPageUrl = new URL(location.href);
            cleanPageUrl.hash = '';
            cleanPageUrl.search = '';

            return {
                id,
                storefront,
                key: 'apple:' + id,
                // The Apple catalog ID is the identity. Storefront is only a URL variant.
                musicBrainzResource:
                    `https://music.apple.com/${storefront}/album/${id}`,
                // Preserve the human-facing Apple page for Harmony.
                harmonyResource: cleanPageUrl.href,
            };
        }

        function readCache() {
            try {
                const value = GM_getValue(CACHE_KEY, {});
                return value && typeof value === 'object' ? value : {};
            } catch {
                return {};
            }
        }

        function writeCache(cache) {
            try {
                const entries = Object.entries(cache)
                    .sort((a, b) => Number(b[1]?.checkedAt || 0) - Number(a[1]?.checkedAt || 0))
                    .slice(0, MAX_CACHE_ENTRIES);
                GM_setValue(CACHE_KEY, Object.fromEntries(entries));
            } catch {
                // Cache failure must never break Apple Music.
            }
        }

        function cachedReleases(albumKey) {
            const cache = readCache();
            const item = cache[albumKey];
            if (!item?.checkedAt || !Array.isArray(item.releases)) return null;

            const ttl = item.releases.length ? FOUND_TTL : MISSING_TTL;
            if (Date.now() - item.checkedAt > ttl) return null;

            return item.releases;
        }

        function storeCachedReleases(albumKey, releases) {
            const cache = readCache();
            cache[albumKey] = {
                checkedAt: Date.now(),
                releases,
            };
            writeCache(cache);
        }

        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        async function throttleMusicBrainz() {
            const wait = Math.max(0, REQUEST_INTERVAL - (Date.now() - lastRequestAt));
            if (wait) await sleep(wait);
            lastRequestAt = Date.now();
        }

        function requestJson(url) {
            return new Promise((resolve, reject) => {
                __mbToolBoxGmXmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: { Accept: 'application/json' },
                    timeout: 15000,
                    onload(response) {
                        if (response.status === 404) {
                            resolve(null);
                            return;
                        }
                        if (response.status < 200 || response.status >= 300) {
                            reject(new Error(`MusicBrainz HTTP ${response.status}`));
                            return;
                        }

                        try {
                            resolve(JSON.parse(response.responseText));
                        } catch (error) {
                            reject(error);
                        }
                    },
                    onerror() {
                        reject(new Error('MusicBrainz request failed'));
                    },
                    ontimeout() {
                        reject(new Error('MusicBrainz request timed out'));
                    },
                });
            });
        }

        function parseReleaseRelations(data) {
            const sources = Array.isArray(data?.urls) ? data.urls : [data];
            const unique = new Map();

            for (const source of sources) {
                const relations = Array.isArray(source?.relations)
                    ? source.relations
                    : [];

                for (const relation of relations) {
                    const release = relation?.release;
                    const id = String(release?.id || '').trim().toLowerCase();
                    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
                        continue;
                    }

                    if (!unique.has(id)) {
                        unique.set(id, {
                            id,
                            title: String(release?.title || '').trim(),
                            disambiguation: String(release?.disambiguation || '').trim(),
                        });
                    }
                }
            }

            return [...unique.values()];
        }

        function appleAlbumIdFromResource(value) {
            let url;
            try {
                url = new URL(value);
            } catch {
                return '';
            }

            if (url.hostname.toLowerCase() !== 'music.apple.com') return '';

            const parts = url.pathname.split('/').filter(Boolean);
            const albumIndex = parts.findIndex(
                part => part.toLowerCase() === 'album'
            );
            if (albumIndex < 0) return '';

            return parts
                .slice(albumIndex + 1)
                .reverse()
                .find(part => /^\d+$/.test(part)) || '';
        }

        function appleWildcardQueries(albumId) {
            const base = 'https\\:\\/\\/music.apple.com\\/';
            return [
                'url:' + base + '*\\/album\\/*\\/' + albumId +
                    ' AND targettype:release',
                'url:' + base + '*\\/album\\/' + albumId +
                    ' AND targettype:release',
            ];
        }

        async function lookupMusicBrainzResources(resources) {
            const uniqueResources = [...new Set(
                (resources || []).filter(Boolean)
            )];
            if (!uniqueResources.length) return [];

            await throttleMusicBrainz();

            const endpoint =
                'https://musicbrainz.org/ws/2/url?' +
                uniqueResources
                    .map(resource => 'resource=' + encodeURIComponent(resource))
                    .join('&') +
                '&inc=release-rels&fmt=json';

            const data = await requestJson(endpoint);
            return parseReleaseRelations(data);
        }

        async function searchAppleMusicResourcesByAlbumId(albumId) {
            for (const query of appleWildcardQueries(albumId)) {
                await throttleMusicBrainz();

                const endpoint =
                    'https://musicbrainz.org/ws/2/url/?query=' +
                    encodeURIComponent(query) +
                    '&limit=100&fmt=json';

                const data = await requestJson(endpoint);
                const resources = [...new Set(
                    (Array.isArray(data?.urls) ? data.urls : [])
                        .map(item => String(item?.resource || '').trim())
                        .filter(resource =>
                            appleAlbumIdFromResource(resource) === albumId
                        )
                )];

                if (resources.length) return resources;
            }

            return [];
        }

        async function lookupMusicBrainzReleases(info, force = false) {
            const cached = force ? null : cachedReleases(info.key);
            if (cached) return cached;

            try {
                // Fast path: exact URL for the storefront currently being viewed.
                let releases = await lookupMusicBrainzResources([
                    info.musicBrainzResource,
                ]);

                if (!releases.length) {
                    // Storefront-independent lookup:
                    // https://music.apple.com/*/album/*/<catalog-id>
                    // https://music.apple.com/*/album/<catalog-id>
                    const resources =
                        await searchAppleMusicResourcesByAlbumId(info.id);
                    if (resources.length) {
                        releases = await lookupMusicBrainzResources(resources);
                    }
                }

                storeCachedReleases(info.key, releases);
                return releases;
            } catch (error) {
                console.warn('[MusicBrainz ToolBox] Apple Music -> MusicBrainz lookup failed:', error);
                return null;
            }
        }

        function installStyles() {
            if (document.getElementById(STYLE_ID)) return;

            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = `
                .${TITLE_ROW_CLASS} {
                    display: flex !important;
                    align-items: center !important;
                    gap: 8px !important;
                    flex-wrap: wrap;
                    min-width: 0;
                }
                .${LINK_CLASS} {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    flex: 0 0 auto;
                    width: 28px;
                    height: 28px;
                    border-radius: 4px;
                    text-decoration: none !important;
                    opacity: .92;
                    transition: transform .12s ease, opacity .12s ease;
                }
                .${LINK_CLASS}:hover {
                    opacity: 1;
                    transform: scale(1.08);
                }
                .${LINK_CLASS} img,
                .${LINK_CLASS} svg {
                    display: block;
                    width: 26px;
                    height: 26px;
                    border: 0;
                }
            `;
            document.head.appendChild(style);
        }

        function removeLinks() {
            document.querySelectorAll('.' + LINK_CLASS).forEach(node => node.remove());
            document.querySelectorAll('.' + TITLE_ROW_CLASS).forEach(node => {
                node.classList.remove(TITLE_ROW_CLASS);
            });
        }

        function renderLinks() {
            const info = appleAlbumInfoFromLocation();
            if (!info || info.key !== currentAlbumKey || !Array.isArray(currentReleases)) {
                return false;
            }

            const title = document.querySelector(
                'h1[data-testid="non-editable-product-title"]'
            );
            if (!title) return false;

            installStyles();
            title.classList.add(TITLE_ROW_CLASS);

            const desired = currentReleases.length
                ? currentReleases.map(release => ({
                    key: 'mb:' + release.id,
                    mbid: release.id,
                    href: 'https://musicbrainz.org/release/' + release.id,
                    image: 'https://musicbrainz.org/favicon.ico',
                    alt: 'MusicBrainz',
                    title: release.disambiguation
                        ? `Open MusicBrainz release: ${release.title || release.id} (${release.disambiguation})`
                        : `Open MusicBrainz release: ${release.title || release.id}`,
                }))
                : [{
                    key: 'harmony',
                    mbid: '',
                    href:
                        HARMONY_URL +
                        'release?url=' +
                        encodeURIComponent(info.harmonyResource) +
                        '&gtin=&region=&deezer=&spotify=&tidal=&qobuz=',
                    svg: HARMONY_LOGO_SVG,
                    alt: 'Harmony',
                    title: 'Search this Apple Music release in Harmony',
                }];

            const wantedKeys = new Set(desired.map(item => item.key));
            title.querySelectorAll('.' + LINK_CLASS).forEach(link => {
                if (!wantedKeys.has(link.dataset.linkKey || '')) link.remove();
            });

            for (const item of desired) {
                if (title.querySelector(
                    `.${LINK_CLASS}[data-link-key="${CSS.escape(item.key)}"]`
                )) {
                    continue;
                }

                const link = document.createElement('a');
                link.className = LINK_CLASS;
                link.dataset.linkKey = item.key;
                if (item.mbid) link.dataset.mbid = item.mbid;
                link.href = item.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.title = item.title;
                link.setAttribute('aria-label', item.title);

                if (item.svg) {
                    const icon = document.createElement('span');
                    icon.setAttribute('aria-hidden', 'true');
                    icon.innerHTML = item.svg;
                    link.appendChild(icon.firstElementChild);
                } else {
                    const image = document.createElement('img');
                    image.src = item.image;
                    image.alt = item.alt;
                    image.width = 26;
                    image.height = 26;
                    link.appendChild(image);
                }

                title.appendChild(link);
            }

            return true;
        }

        async function refreshCurrentAlbum(force = false) {
            const info = appleAlbumInfoFromLocation();
            if (!info || info.key !== currentAlbumKey || lookupInFlight) return;

            lookupInFlight = true;
            const generation = requestGeneration;

            try {
                const releases = await lookupMusicBrainzReleases(info, force);

                const latest = appleAlbumInfoFromLocation();
                if (
                    generation !== requestGeneration ||
                    !latest ||
                    latest.key !== currentAlbumKey ||
                    latest.key !== info.key
                ) {
                    return;
                }

                currentLookupAt = Date.now();
                currentReleases = releases;
                renderLinks();
            } finally {
                lookupInFlight = false;
            }
        }

        function handleRouteChange() {
            const info = appleAlbumInfoFromLocation();
            const albumKey = info?.key || '';

            if (albumKey === currentAlbumKey) {
                if (Array.isArray(currentReleases)) {
                    renderLinks();

                    if (
                        currentReleases.length === 0 &&
                        Date.now() - currentLookupAt >= MISSING_TTL
                    ) {
                        refreshCurrentAlbum(true);
                    }
                }
                return;
            }

            currentAlbumKey = albumKey;
            currentReleases = null;
            currentLookupAt = 0;
            ++requestGeneration;
            removeLinks();

            if (!info) return;
            refreshCurrentAlbum(false);
        }

        function queueScan() {
            if (scanQueued) return;
            scanQueued = true;
            setTimeout(() => {
                scanQueued = false;
                handleRouteChange();
            }, 50);
        }

        const observer = new MutationObserver(queueScan);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });

        window.addEventListener('focus', () => {
            if (
                currentAlbumKey &&
                Array.isArray(currentReleases) &&
                currentReleases.length === 0
            ) {
                refreshCurrentAlbum(true);
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (
                document.visibilityState === 'visible' &&
                currentAlbumKey &&
                Array.isArray(currentReleases) &&
                currentReleases.length === 0
            ) {
                refreshCurrentAlbum(true);
            }
        });

        setInterval(handleRouteChange, 500);
        handleRouteChange();
    })();
    }


    // ============================================================================
    // Apple Music release-list indicators
    // Exact Apple Music album URLs are resolved through MusicBrainz URL relations.
    // Found -> MusicBrainz icon. Missing -> Harmony fallback.
    // ============================================================================
    if (location.hostname === 'music.apple.com') {
    (() => {
        'use strict';

        const INDICATOR_CLASS = 'mb-toolbox-release-list-indicator';
        const STYLE_ID = 'mb-toolbox-release-list-indicator-style';
        const CACHE_KEY = 'mb-toolbox-release-list-links-v2';
        const FOUND_TTL = 30 * 24 * 60 * 60 * 1000;
        const MISSING_TTL = 15 * 1000;
        const MAX_CACHE_ENTRIES = 1000;
        const REQUEST_INTERVAL = 1100;
        const HARMONY_URL = 'https://harmony.pulsewidth.org.uk/';
        const HARMONY_LOGO_SVG = "<svg viewBox=\"0 0 200 200\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\"><defs><linearGradient id=\"mbtb-harmony-list-gradient\" x1=\"-51.64\" y1=\"190.18\" x2=\"287.01\" y2=\"-2.23\" gradientUnits=\"userSpaceOnUse\"><stop offset=\".29\" stop-color=\"#ffb92c\"/><stop offset=\"1\" stop-color=\"#c45555\"/></linearGradient></defs><path fill=\"#c45555\" d=\"M68.08 122.59c4.17 2.66 9.11 4.23 14.42 4.23 14.82 0 26.84-12.02 26.84-26.84S97.32 73.14 82.5 73.14c-5.35 0-10.31 1.58-14.5 4.28-.31.02-.63.02-.94.02-2.42 0-4.85-.49-6.9-1.86-2.99-1.99-4.29-6.45-4.77-11.01V21.54L7.74 48.87v102.25l47.64 27.34v-43.03c.49-4.57 1.78-9.02 4.77-11.01 2.06-1.37 4.48-1.86 6.9-1.86.34 0 .68 0 1.02.03Z\"/><path fill=\"url(#mbtb-harmony-list-gradient)\" d=\"M63.67 175.1v-39.19c.38-3.11 1.04-4.35 1.25-4.68.26-.13.6-.23 1-.29 5.1 2.74 10.78 4.18 16.58 4.18 19.37 0 35.13-15.76 35.13-35.13S101.87 64.86 82.5 64.86c-5.83 0-11.53 1.45-16.64 4.21-.38-.06-.69-.16-.94-.28-.21-.33-.87-1.57-1.25-4.68V24.9L107.08 0l85.18 48.87v102.25L107.08 200l-43.4-24.9Z\"/></svg>";

        const pendingLookups = new Map();
        const targetLookupGeneration = new WeakMap();
        let requestQueue = Promise.resolve();
        let lastRequestAt = 0;
        let scanQueued = false;

        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        function queueMusicBrainzRequest(task) {
            const run = requestQueue.then(async () => {
                const wait = Math.max(
                    0,
                    REQUEST_INTERVAL - (Date.now() - lastRequestAt)
                );
                if (wait) await sleep(wait);
                lastRequestAt = Date.now();
                return task();
            });

            requestQueue = run.catch(() => {});
            return run;
        }

        function readCache() {
            try {
                const value = GM_getValue(CACHE_KEY, {});
                return value && typeof value === 'object' ? value : {};
            } catch {
                return {};
            }
        }

        function writeCache(cache) {
            try {
                const entries = Object.entries(cache)
                    .sort(
                        (a, b) =>
                            Number(b[1]?.checkedAt || 0) -
                            Number(a[1]?.checkedAt || 0)
                    )
                    .slice(0, MAX_CACHE_ENTRIES);
                GM_setValue(CACHE_KEY, Object.fromEntries(entries));
            } catch {
                // Cache failure must never break Apple Music.
            }
        }

        function cachedResult(resource, force = false) {
            if (force) return null;

            const item = readCache()[resource];
            if (!item?.checkedAt || !Array.isArray(item.releases)) {
                return null;
            }

            const ttl = item.releases.length ? FOUND_TTL : MISSING_TTL;
            if (Date.now() - Number(item.checkedAt) > ttl) return null;

            return item.releases;
        }

        function storeResult(resource, releases) {
            const cache = readCache();
            cache[resource] = {
                checkedAt: Date.now(),
                releases,
            };
            writeCache(cache);
        }

        function requestJson(url) {
            return new Promise((resolve, reject) => {
                __mbToolBoxGmXmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: {Accept: 'application/json'},
                    timeout: 15000,
                    onload(response) {
                        if (response.status === 404) {
                            resolve(null);
                            return;
                        }
                        if (
                            response.status < 200 ||
                            response.status >= 300
                        ) {
                            reject(
                                new Error(
                                    'MusicBrainz HTTP ' + response.status
                                )
                            );
                            return;
                        }

                        try {
                            resolve(JSON.parse(response.responseText));
                        } catch (error) {
                            reject(error);
                        }
                    },
                    onerror() {
                        reject(new Error('MusicBrainz request failed'));
                    },
                    ontimeout() {
                        reject(new Error('MusicBrainz request timed out'));
                    },
                });
            });
        }

        function parseReleaseRelations(data) {
            const sources = Array.isArray(data?.urls) ? data.urls : [data];
            const unique = new Map();

            for (const source of sources) {
                const relations = Array.isArray(source?.relations)
                    ? source.relations
                    : [];

                for (const relation of relations) {
                    const release = relation?.release;
                    const id = String(release?.id || '')
                        .trim()
                        .toLowerCase();

                    if (
                        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                            id
                        )
                    ) {
                        continue;
                    }

                    if (!unique.has(id)) {
                        unique.set(id, {
                            id,
                            title: String(release?.title || '').trim(),
                            disambiguation: String(
                                release?.disambiguation || ''
                            ).trim(),
                        });
                    }
                }
            }

            return [...unique.values()];
        }

        function appleAlbumIdFromResource(value) {
            let url;
            try {
                url = new URL(value);
            } catch {
                return '';
            }

            if (url.hostname.toLowerCase() !== 'music.apple.com') return '';

            const parts = url.pathname.split('/').filter(Boolean);
            const albumIndex = parts.findIndex(
                part => part.toLowerCase() === 'album'
            );
            if (albumIndex < 0) return '';

            return parts
                .slice(albumIndex + 1)
                .reverse()
                .find(part => /^\d+$/.test(part)) || '';
        }

        async function lookupResources(resources) {
            const uniqueResources = [...new Set(
                (resources || []).filter(Boolean)
            )];
            if (!uniqueResources.length) return [];

            const endpoint =
                'https://musicbrainz.org/ws/2/url?' +
                uniqueResources
                    .map(resource => 'resource=' + encodeURIComponent(resource))
                    .join('&') +
                '&inc=release-rels&fmt=json';

            const data = await queueMusicBrainzRequest(
                () => requestJson(endpoint)
            );
            return parseReleaseRelations(data);
        }

        async function searchAppleResourcesByAlbumId(albumId) {
            const base = 'https\\:\\/\\/music.apple.com\\/';
            const searchQueries = [
                'url:' + base + '*\\/album\\/*\\/' + albumId +
                    ' AND targettype:release',
                'url:' + base + '*\\/album\\/' + albumId +
                    ' AND targettype:release',
            ];

            for (const query of searchQueries) {
                const endpoint =
                    'https://musicbrainz.org/ws/2/url/?query=' +
                    encodeURIComponent(query) +
                    '&limit=100&fmt=json';

                const data = await queueMusicBrainzRequest(
                    () => requestJson(endpoint)
                );

                const resources = [...new Set(
                    (Array.isArray(data?.urls) ? data.urls : [])
                        .map(item => String(item?.resource || '').trim())
                        .filter(resource =>
                            appleAlbumIdFromResource(resource) === albumId
                        )
                )];

                if (resources.length) return resources;
            }

            return [];
        }

        async function lookupResource(info, force = false) {
            const cached = cachedResult(info.key, force);
            if (cached !== null) return cached;

            const pendingKey = info.key + (force ? ':force' : '');
            if (pendingLookups.has(pendingKey)) {
                return pendingLookups.get(pendingKey);
            }

            const promise = (async () => {
                try {
                    let releases = await lookupResources([
                        info.resource,
                    ]);

                    if (!releases.length) {
                        const resources =
                            await searchAppleResourcesByAlbumId(info.id);
                        if (resources.length) {
                            releases = await lookupResources(resources);
                        }
                    }

                    storeResult(info.key, releases);
                    return releases;
                } catch (error) {
                    console.warn(
                        '[MusicBrainz ToolBox] Apple Music release-list lookup failed:',
                        info.key,
                        error
                    );
                    return null;
                } finally {
                    pendingLookups.delete(pendingKey);
                }
            })();

            pendingLookups.set(pendingKey, promise);
            return promise;
        }

        function appleAlbumInfo(value) {
            let url;
            try {
                url = new URL(value, location.href);
            } catch {
                return null;
            }

            if (url.hostname !== 'music.apple.com') return null;

            const parts = url.pathname.split('/').filter(Boolean);
            const albumIndex = parts.findIndex(
                part => part.toLowerCase() === 'album'
            );
            if (albumIndex < 0) return null;

            const id = parts
                .slice(albumIndex + 1)
                .reverse()
                .find(part => /^\d+$/.test(part));
            if (!id) return null;

            const storefront =
                albumIndex > 0 &&
                /^[a-z]{2}$/i.test(parts[albumIndex - 1])
                    ? parts[albumIndex - 1].toLowerCase()
                    : 'us';

            const harmonyUrl = new URL(url.href);
            harmonyUrl.hash = '';
            harmonyUrl.search = '';

            return {
                id,
                storefront,
                key: 'apple:' + id,
                resource:
                    'https://music.apple.com/' +
                    storefront +
                    '/album/' +
                    id,
                harmonyUrl: harmonyUrl.href,
            };
        }

        function installStyles() {
            if (document.getElementById(STYLE_ID)) return;

            const style = document.createElement('style');
            style.id = STYLE_ID;
            style.textContent = [
                '.' + INDICATOR_CLASS + ' {',
                'display: inline-flex !important;',
                'align-items: center !important;',
                'justify-content: center !important;',
                'width: 18px !important;',
                'height: 18px !important;',
                'margin-left: 6px !important;',
                'vertical-align: -3px !important;',
                'flex: 0 0 auto !important;',
                'text-decoration: none !important;',
                'opacity: .94 !important;',
                '}',
                '.' + INDICATOR_CLASS + ':hover {',
                'opacity: 1 !important;',
                'transform: scale(1.12) !important;',
                '}',
                '.' + INDICATOR_CLASS + ' img,',
                '.' + INDICATOR_CLASS + ' svg {',
                'display: block !important;',
                'width: 18px !important;',
                'height: 18px !important;',
                'max-width: none !important;',
                'border: 0 !important;',
                '}',
            ].join('\n');

            document.head.appendChild(style);
        }

        function ensureTargetId(target) {
            if (!target.dataset.mbtbIndicatorTarget) {
                target.dataset.mbtbIndicatorTarget =
                    Math.random().toString(36).slice(2);
            }
            return target.dataset.mbtbIndicatorTarget;
        }

        function indicatorsForTarget(target) {
            const parent = target.parentElement;
            if (!parent) return [];

            const targetId = ensureTargetId(target);
            return [...parent.querySelectorAll('.' + INDICATOR_CLASS)]
                .filter(
                    node =>
                        node.dataset.mbtbTarget === targetId
                );
        }

        function makeMusicBrainzImage() {
            const image = document.createElement('img');
            image.src = 'https://musicbrainz.org/favicon.ico';
            image.alt = 'MusicBrainz';
            image.width = 18;
            image.height = 18;
            return image;
        }

        function createIndicator(info, releases) {
            if (releases.length) {
                const release = releases[0];
                const link = document.createElement('a');
                link.className = INDICATOR_CLASS;
                link.dataset.mbtbKey = encodeURIComponent(info.key);
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.href =
                    'https://musicbrainz.org/release/' + release.id;

                const label = release.title
                    ? 'Open MusicBrainz release: ' + release.title
                    : 'Open MusicBrainz release';
                link.title = release.disambiguation
                    ? label + ' (' + release.disambiguation + ')'
                    : label;
                link.setAttribute('aria-label', link.title);
                link.appendChild(makeMusicBrainzImage());
                return link;
            }

            const link = document.createElement('a');
            link.className = INDICATOR_CLASS;
            link.dataset.mbtbKey = encodeURIComponent(info.key);
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.href =
                HARMONY_URL +
                'release?url=' +
                encodeURIComponent(info.harmonyUrl) +
                '&gtin=&region=&deezer=&spotify=&tidal=&qobuz=';
            link.title = 'Search this Apple Music release in Harmony';
            link.setAttribute('aria-label', link.title);

            const holder = document.createElement('span');
            holder.setAttribute('aria-hidden', 'true');
            holder.innerHTML = HARMONY_LOGO_SVG;
            if (holder.firstElementChild) {
                link.appendChild(holder.firstElementChild);
            }

            return link;
        }

        async function decorateTarget(target, info, force = false) {
            if (!target || !info) return;

            const key = encodeURIComponent(info.key);
            const existing = indicatorsForTarget(target)[0];

            if (
                existing &&
                existing.dataset.mbtbKey === key &&
                !force &&
                cachedResult(info.key) !== null
            ) {
                return;
            }

            const generation =
                (targetLookupGeneration.get(target) || 0) + 1;
            targetLookupGeneration.set(target, generation);

            const releases = await lookupResource(
                info,
                force
            );
            if (
                !Array.isArray(releases) ||
                !target.isConnected ||
                targetLookupGeneration.get(target) !== generation
            ) {
                return;
            }

            installStyles();

            indicatorsForTarget(target).forEach(
                node => node.remove()
            );

            const indicator = createIndicator(info, releases);
            indicator.dataset.mbtbTarget = ensureTargetId(target);
            target.insertAdjacentElement('afterend', indicator);
        }

        function appleTargets() {
            const selectors = [
                'a[data-testid="product-lockup-title"][href*="/album/"]',
                '[data-testid="artist-featured-release-title"] > a[href*="/album/"]',
            ];

            return [...document.querySelectorAll(selectors.join(','))]
                .map(target => ({
                    target,
                    info: appleAlbumInfo(target.href),
                }))
                .filter(item => item.info);
        }

        function scan(forceMissing = false) {
            const tasks = appleTargets().map(async item => {
                let force = false;

                if (forceMissing) {
                    const cached = cachedResult(item.info.key);
                    force =
                        Array.isArray(cached) &&
                        cached.length === 0;
                }

                await decorateTarget(
                    item.target,
                    item.info,
                    force
                );
            });

            return Promise.allSettled(tasks);
        }

        function queueScan() {
            if (scanQueued) return;
            scanQueued = true;

            setTimeout(() => {
                scanQueued = false;
                scan(false);
            }, 80);
        }

        const observer = new MutationObserver(queueScan);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });

        window.addEventListener('focus', () => {
            scan(true);
        });

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                scan(true);
            }
        });

        setInterval(() => scan(false), 5000);
        scan(false);
    })();
    }



    // Relationship shortcuts for MusicBrainz entity lists.
    if (__mbToolBoxShouldRun([
        "https://musicbrainz.org/*",
        "https://beta.musicbrainz.org/*"
    ], [])) {
        (() => {
            'use strict';

            const STYLE_ID = 'mbtb-relationship-shortcuts-style';
            const CELL_CLASS = 'mbtb-relationship-shortcuts';
            const HEAD_CLASS = 'mbtb-relationship-shortcuts-head';
            const LABEL_COMMENT_CLASS = 'mbtb-label-disambiguation';
            const LABEL_TOGGLE_CLASS = 'mbtb-label-disambiguation-toggle';
            const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

            function pageContext() {
                if (!/(^|\.)musicbrainz\.org$/i.test(location.hostname)) return null;

                let match = location.pathname.match(new RegExp('^/artist/(' + UUID + ')/?$','i'));
                if (match) {
                    return {
                        parentType: 'artist',
                        parentMbid: match[1],
                        childType: 'release-group',
                    };
                }

                match = location.pathname.match(new RegExp('^/(release-group|label)/(' + UUID + ')/?$','i'));
                if (match) {
                    return {
                        parentType: match[1],
                        parentMbid: match[2],
                        childType: 'release',
                    };
                }

                match = location.pathname.match(new RegExp('^/artist/(' + UUID + ')/(releases|works)/?$','i'));
                if (match) {
                    return {
                        parentType: 'artist',
                        parentMbid: match[1],
                        childType: match[2].replace(/s$/, ''),
                    };
                }

                return null;
            }

            function installStyle() {
                if (document.getElementById(STYLE_ID)) return;
                const style = document.createElement('style');
                style.id = STYLE_ID;
                style.textContent = [
                    'th.' + HEAD_CLASS + ' { white-space: nowrap; }',
                    'td.' + CELL_CLASS + ' { white-space: normal; min-width: 20px; }',
                    'td.' + CELL_CLASS + ' a { display: inline-block; margin: 2px; vertical-align: middle; }',
                    'td.' + CELL_CLASS + ' span.favicon { display: inline-block; width: 16px; height: 16px; vertical-align: middle; }',
                    'td.' + CELL_CLASS + ' .mbtb-rel-ended { opacity: .28; }',
                    'td.' + CELL_CLASS + ' .mbtb-rel-generic {',
                    'display: inline-flex; align-items: center; justify-content: center;',
                    'width: 16px; height: 16px; box-sizing: border-box;',
                    'font-size: 12px; line-height: 16px; font-weight: 700;',
                    'border: 1px solid #999; border-radius: 3px; text-decoration: none;',
                    '}',
                    'td.' + CELL_CLASS + ' .mbtb-rel-mb img { width: 16px; height: 16px; display: block; border: 0; }',
                    '.' + LABEL_TOGGLE_CLASS + ' {',
                    'appearance: none; -webkit-appearance: none; background: none; border: 0;',
                    'padding: 0 2px; margin: 0; color: inherit; font: inherit; cursor: pointer;',
                    'text-decoration: underline; text-decoration-style: dotted;',
                    '}',
                    '.' + LABEL_TOGGLE_CLASS + ':hover { text-decoration-style: solid; }',
                ].join('\n');
                document.head.appendChild(style);
            }

            function relationIconClass(relation, targetUrl) {
                const type = String(relation?.type || '').toLowerCase();

                if (type === 'official homepage' || type === 'discography entry') return 'home';
                if (type === 'allmusic') return 'allmusic';
                if (type === 'amazon asin') return 'amazon';
                if (type === 'discogs') return 'discogs';
                if (type === 'imdb') return 'imdb';
                if (type === 'lyrics') return 'lyrics';
                if (type === 'secondhandsongs') return 'secondhandsongs';
                if (type === 'vgmdb') return 'vgmdb';
                if (type === 'wikidata') return 'wikidata';
                if (type === 'wikipedia') return 'wikipedia';

                let url;
                try {
                    url = new URL(targetUrl);
                } catch {
                    return '';
                }

                const host = url.hostname.toLowerCase();
                const path = url.pathname.toLowerCase();

                if (host === 'open.spotify.com') return 'spotify';
                if (host === 'music.apple.com') return 'applemusic';
                if (host === 'itunes.apple.com') return 'itunes';
                if (host === 'www.deezer.com' || host === 'deezer.com') return 'deezer';
                if (host === 'tidal.com' || host.endsWith('.tidal.com')) return 'tidal';
                if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) return 'soundcloud';
                if (host === 'bandcamp.com' || host.endsWith('.bandcamp.com')) return 'bandcamp';
                if (host === 'www.qobuz.com' || host === 'qobuz.com' || host.endsWith('.qobuz.com')) return 'qobuz';
                if (host === 'music.youtube.com') return 'youtubemusic';
                if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'youtu.be') return 'youtube';
                if (host === 'beatport.com' || host === 'www.beatport.com') return 'beatport';
                if (host === 'mora.jp' || host.endsWith('.mora.jp')) return 'mora';
                if (host === '7digital.com' || host.endsWith('.7digital.com')) return 'sevendigital';
                if (host === 'audiomack.com' || host.endsWith('.audiomack.com')) return 'audiomack';
                if (host.startsWith('music.amazon.')) return 'amazonmusic';
                if (host.includes('amazon.') && path.includes('/dp/')) return 'amazon';
                if (host === 'discogs.com' || host.endsWith('.discogs.com')) return 'discogs';
                if (host === 'allmusic.com' || host.endsWith('.allmusic.com')) return 'allmusic';
                if (host === 'genius.com' || host.endsWith('.genius.com')) return 'genius';
                if (host === 'www.wikidata.org' || host === 'wikidata.org') return 'wikidata';
                if (host.endsWith('wikipedia.org')) return 'wikipedia';
                if (host === 'rateyourmusic.com' || host.endsWith('.rateyourmusic.com')) return 'rateyourmusic';
                if (host === 'www.worldcat.org' || host === 'worldcat.org') return 'worldcat';
                if (host === 'archive.org' || host.endsWith('.archive.org')) return 'archive';
                if (host === 'store.steampowered.com') return 'steam';
                return '';
            }

            function collapseLabelDisambiguations() {
                for (const labelLink of document.querySelectorAll('table.tbl a[href^="/label/"]')) {
                    if (labelLink.dataset.mbtbLabelCommentHandled) continue;

                    let comment = null;
                    let node = labelLink.nextSibling;

                    while (
                        node &&
                        node.nodeType === Node.TEXT_NODE &&
                        !node.textContent.trim()
                    ) {
                        node = node.nextSibling;
                    }

                    if (
                        node?.nodeType === Node.ELEMENT_NODE &&
                        node.matches('.comment')
                    ) {
                        comment = node;
                    } else if (node?.nodeType === Node.TEXT_NODE) {
                        const match = node.data.match(/^\s*(\([^)]*\))/);
                        if (match) {
                            comment = document.createElement('span');
                            comment.className = 'comment';
                            comment.textContent = match[1];
                            node.data = node.data.slice(match[0].length);
                            node.parentNode.insertBefore(comment, node);
                        }
                    }

                    labelLink.dataset.mbtbLabelCommentHandled = '1';
                    if (!comment || !comment.textContent.trim()) continue;
                    if (comment.classList.contains(LABEL_COMMENT_CLASS)) continue;

                    comment.classList.add(LABEL_COMMENT_CLASS);
                    const fullText = comment.textContent.trim();
                    comment.hidden = true;

                    const toggle = document.createElement('button');
                    toggle.type = 'button';
                    toggle.className = LABEL_TOGGLE_CLASS;
                    toggle.textContent = '...';
                    toggle.title = 'Show label disambiguation: ' + fullText;
                    toggle.setAttribute('aria-label', toggle.title);
                    toggle.setAttribute('aria-expanded', 'false');

                    toggle.addEventListener('click', event => {
                        event.preventDefault();
                        event.stopPropagation();

                        const expanded = comment.hidden;
                        comment.hidden = !expanded;
                        toggle.setAttribute('aria-expanded', String(expanded));
                        toggle.title =
                            (expanded ? 'Hide' : 'Show') +
                            ' label disambiguation: ' + fullText;
                        toggle.setAttribute('aria-label', toggle.title);
                    });

                    comment.parentNode.insertBefore(toggle, comment);
                }
            }

            function entityFromRow(row, childType) {
                const re = new RegExp('^/' + childType + '/(' + UUID + ')(?:[/?#]|$)', 'i');
                const cells = [...row.children];

                for (let index = 0; index < cells.length; index++) {
                    for (const link of cells[index].querySelectorAll('a[href]')) {
                        let pathname;
                        try {
                            pathname = new URL(link.href, location.href).pathname;
                        } catch {
                            continue;
                        }
                        const match = pathname.match(re);
                        if (match) {
                            return {mbid: match[1].toLowerCase(), index};
                        }
                    }
                }

                return null;
            }

            function prepareTables(childType) {
                const cellsByMbid = new Map();

                for (const table of document.querySelectorAll('table.tbl')) {
                    const rows = [...table.querySelectorAll('tr')];
                    const firstData = rows
                        .map(row => ({row, entity: entityFromRow(row, childType)}))
                        .find(item => item.entity);

                    if (!firstData) continue;
                    const entityIndex = firstData.entity.index;

                    const header =
                        table.querySelector('thead tr:last-child') ||
                        rows.find(row => row.querySelectorAll(':scope > th').length > entityIndex);
                    const headerCell = header?.children?.[entityIndex];
                    if (headerCell && !header.querySelector('.' + HEAD_CLASS)) {
                        const th = document.createElement('th');
                        th.className = HEAD_CLASS;
                        th.textContent = 'Relationships';
                        headerCell.insertAdjacentElement('afterend', th);
                    }

                    for (const row of rows) {
                        if (row === header) continue;

                        if (row.classList.contains('subh')) {
                            const spanning = row.querySelector(':scope > th[colspan], :scope > td[colspan]');
                            if (spanning && !row.dataset.mbtbRelationshipColspanAdjusted) {
                                spanning.colSpan += 1;
                                row.dataset.mbtbRelationshipColspanAdjusted = '1';
                            }
                            continue;
                        }

                        const tdCells = [...row.querySelectorAll(':scope > td')];
                        if (!tdCells.length || tdCells.length <= entityIndex) continue;
                        if (row.querySelector(':scope > td.' + CELL_CLASS)) continue;

                        const entity = entityFromRow(row, childType);
                        const td = document.createElement('td');
                        td.className = CELL_CLASS;
                        tdCells[entityIndex].insertAdjacentElement('afterend', td);

                        if (!entity) continue;
                        if (!cellsByMbid.has(entity.mbid)) cellsByMbid.set(entity.mbid, []);
                        cellsByMbid.get(entity.mbid).push(td);
                    }
                }

                return cellsByMbid;
            }

            function addUrlRelationship(cell, relation) {
                const targetUrl = relation?.url?.resource;
                if (!targetUrl) return;

                const link = document.createElement('a');
                link.href = targetUrl;
                link.title =
                    String(relation.type || 'URL relationship') +
                    (relation.ended ? ' (ended)' : '') +
                    ': ' + targetUrl;
                link.setAttribute('aria-label', link.title);

                const iconClass = relationIconClass(relation, targetUrl);
                if (iconClass) {
                    const icon = document.createElement('span');
                    icon.className =
                        'favicon ' + iconClass + '-favicon' +
                        (relation.ended ? ' mbtb-rel-ended' : '');
                    link.appendChild(icon);
                } else {
                    link.className = 'mbtb-rel-generic' + (relation.ended ? ' mbtb-rel-ended' : '');
                    link.textContent = '↗';
                }

                cell.appendChild(link);
            }

            function addMusicBrainzRelationship(cell, relation) {
                const targetType = String(relation?.['target-type'] || '');
                const normalizedType = targetType.replace('_', '-');
                const allowed =
                    (targetType === 'release_group' && relation.type === 'single from') ||
                    (targetType === 'release' && relation.type === 'remaster');
                if (!allowed) return;

                const target = relation[targetType];
                if (!target?.id) return;

                const link = document.createElement('a');
                link.className = 'mbtb-rel-mb' + (relation.ended ? ' mbtb-rel-ended' : '');
                link.href = '/' + normalizedType + '/' + target.id;
                link.title =
                    String(relation.type || 'MusicBrainz relationship') +
                    (relation.ended ? ' (ended)' : '');
                link.setAttribute('aria-label', link.title);

                const image = document.createElement('img');
                image.src = 'https://musicbrainz.org/favicon.ico';
                image.alt = '';
                link.appendChild(image);
                cell.appendChild(link);
            }

            function renderEntity(entity, cells) {
                for (const cell of cells) {
                    cell.textContent = '';
                    for (const relation of entity.relations || []) {
                        if (relation?.ended) continue;

                        if (relation?.['target-type'] === 'url') {
                            // Intentionally do not deduplicate by provider or icon class:
                            // every attached URL relationship gets its own shortcut icon.
                            addUrlRelationship(cell, relation);
                        } else {
                            addMusicBrainzRelationship(cell, relation);
                        }
                    }
                }
            }

            async function init() {
                const context = pageContext();
                if (!context) return;

                installStyle();
                collapseLabelDisambiguations();
                const cellsByMbid = prepareTables(context.childType);
                if (!cellsByMbid.size) return;

                const includes = {
                    'release-group': ['release-group-rels', 'url-rels'],
                    release: ['release-rels', 'url-rels', 'discids'],
                    recording: ['work-rels', 'url-rels'],
                    work: ['url-rels'],
                }[context.childType] || ['url-rels'];

                const page = Math.max(1, Number(new URL(location.href).searchParams.get('page')) || 1);
                const api = new URL('/ws/2/' + context.childType, location.origin);
                api.searchParams.set(context.parentType, context.parentMbid);
                api.searchParams.set('inc', includes.join(' '));
                api.searchParams.set('limit', '100');
                api.searchParams.set('offset', String((page - 1) * 100));
                api.searchParams.set('fmt', 'json');

                try {
                    const response = await __mbToolBoxFetch(api.toString(), {
                        headers: {Accept: 'application/json'},
                    });
                    if (!response.ok) {
                        throw new Error('HTTP ' + response.status);
                    }

                    const data = await response.json();
                    const listKey = {
                        'release-group': 'release-groups',
                        release: 'releases',
                        recording: 'recordings',
                        work: 'works',
                    }[context.childType];

                    for (const entity of data[listKey] || []) {
                        const cells = cellsByMbid.get(String(entity.id || '').toLowerCase());
                        if (cells?.length) renderEntity(entity, cells);
                    }
                } catch (error) {
                    console.error('[MusicBrainz ToolBox] Relationship shortcuts failed:', error);
                }
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init, {once: true});
            } else {
                init();
            }
        })();
    }


})();
,'i'));
                if (match) {
                    return {
                        parentType: 'artist',
                        parentMbid: match[1],
                        childType: match[2].replace(/s$/, ''),
                    };
                }

                return null;
            }

            function installStyle() {
                if (document.getElementById(STYLE_ID)) return;
                const style = document.createElement('style');
                style.id = STYLE_ID;
                style.textContent = [
                    'th.' + HEAD_CLASS + ' { white-space: nowrap; }',
                    'td.' + CELL_CLASS + ' { white-space: normal; min-width: 20px; }',
                    'td.' + CELL_CLASS + ' a { display: inline-block; margin: 2px; vertical-align: middle; }',
                    'td.' + CELL_CLASS + ' span.favicon { display: inline-block; width: 16px; height: 16px; vertical-align: middle; }',
                    'td.' + CELL_CLASS + ' .mbtb-rel-ended { opacity: .28; }',
                    'td.' + CELL_CLASS + ' .mbtb-rel-generic {',
                    'display: inline-flex; align-items: center; justify-content: center;',
                    'width: 16px; height: 16px; box-sizing: border-box;',
                    'font-size: 12px; line-height: 16px; font-weight: 700;',
                    'border: 1px solid #999; border-radius: 3px; text-decoration: none;',
                    '}',
                    'td.' + CELL_CLASS + ' .mbtb-rel-mb img { width: 16px; height: 16px; display: block; border: 0; }',
                    '.' + LABEL_TOGGLE_CLASS + ' {',
                    'appearance: none; -webkit-appearance: none; background: none; border: 0;',
                    'padding: 0 2px; margin: 0; color: inherit; font: inherit; cursor: pointer;',
                    'text-decoration: underline; text-decoration-style: dotted;',
                    '}',
                    '.' + LABEL_TOGGLE_CLASS + ':hover { text-decoration-style: solid; }',
                ].join('\n');
                document.head.appendChild(style);
            }

            function relationIconClass(relation, targetUrl) {
                const type = String(relation?.type || '').toLowerCase();

                if (type === 'official homepage' || type === 'discography entry') return 'home';
                if (type === 'allmusic') return 'allmusic';
                if (type === 'amazon asin') return 'amazon';
                if (type === 'discogs') return 'discogs';
                if (type === 'imdb') return 'imdb';
                if (type === 'lyrics') return 'lyrics';
                if (type === 'secondhandsongs') return 'secondhandsongs';
                if (type === 'vgmdb') return 'vgmdb';
                if (type === 'wikidata') return 'wikidata';
                if (type === 'wikipedia') return 'wikipedia';

                let url;
                try {
                    url = new URL(targetUrl);
                } catch {
                    return '';
                }

                const host = url.hostname.toLowerCase();
                const path = url.pathname.toLowerCase();

                if (host === 'open.spotify.com') return 'spotify';
                if (host === 'music.apple.com') return 'applemusic';
                if (host === 'itunes.apple.com') return 'itunes';
                if (host === 'www.deezer.com' || host === 'deezer.com') return 'deezer';
                if (host === 'tidal.com' || host.endsWith('.tidal.com')) return 'tidal';
                if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) return 'soundcloud';
                if (host === 'bandcamp.com' || host.endsWith('.bandcamp.com')) return 'bandcamp';
                if (host === 'www.qobuz.com' || host === 'qobuz.com' || host.endsWith('.qobuz.com')) return 'qobuz';
                if (host === 'music.youtube.com') return 'youtubemusic';
                if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'youtu.be') return 'youtube';
                if (host === 'beatport.com' || host === 'www.beatport.com') return 'beatport';
                if (host === 'mora.jp' || host.endsWith('.mora.jp')) return 'mora';
                if (host === '7digital.com' || host.endsWith('.7digital.com')) return 'sevendigital';
                if (host === 'audiomack.com' || host.endsWith('.audiomack.com')) return 'audiomack';
                if (host.startsWith('music.amazon.')) return 'amazonmusic';
                if (host.includes('amazon.') && path.includes('/dp/')) return 'amazon';
                if (host === 'discogs.com' || host.endsWith('.discogs.com')) return 'discogs';
                if (host === 'allmusic.com' || host.endsWith('.allmusic.com')) return 'allmusic';
                if (host === 'genius.com' || host.endsWith('.genius.com')) return 'genius';
                if (host === 'www.wikidata.org' || host === 'wikidata.org') return 'wikidata';
                if (host.endsWith('wikipedia.org')) return 'wikipedia';
                if (host === 'rateyourmusic.com' || host.endsWith('.rateyourmusic.com')) return 'rateyourmusic';
                if (host === 'www.worldcat.org' || host === 'worldcat.org') return 'worldcat';
                if (host === 'archive.org' || host.endsWith('.archive.org')) return 'archive';
                if (host === 'store.steampowered.com') return 'steam';
                return '';
            }

            function collapseLabelDisambiguations() {
                for (const labelLink of document.querySelectorAll('table.tbl a[href^="/label/"]')) {
                    if (labelLink.dataset.mbtbLabelCommentHandled) continue;

                    let comment = null;
                    let node = labelLink.nextSibling;

                    while (
                        node &&
                        node.nodeType === Node.TEXT_NODE &&
                        !node.textContent.trim()
                    ) {
                        node = node.nextSibling;
                    }

                    if (
                        node?.nodeType === Node.ELEMENT_NODE &&
                        node.matches('.comment')
                    ) {
                        comment = node;
                    } else if (node?.nodeType === Node.TEXT_NODE) {
                        const match = node.data.match(/^\s*(\([^)]*\))/);
                        if (match) {
                            comment = document.createElement('span');
                            comment.className = 'comment';
                            comment.textContent = match[1];
                            node.data = node.data.slice(match[0].length);
                            node.parentNode.insertBefore(comment, node);
                        }
                    }

                    labelLink.dataset.mbtbLabelCommentHandled = '1';
                    if (!comment || !comment.textContent.trim()) continue;
                    if (comment.classList.contains(LABEL_COMMENT_CLASS)) continue;

                    comment.classList.add(LABEL_COMMENT_CLASS);
                    const fullText = comment.textContent.trim();
                    comment.hidden = true;

                    const toggle = document.createElement('button');
                    toggle.type = 'button';
                    toggle.className = LABEL_TOGGLE_CLASS;
                    toggle.textContent = '...';
                    toggle.title = 'Show label disambiguation: ' + fullText;
                    toggle.setAttribute('aria-label', toggle.title);
                    toggle.setAttribute('aria-expanded', 'false');

                    toggle.addEventListener('click', event => {
                        event.preventDefault();
                        event.stopPropagation();

                        const expanded = comment.hidden;
                        comment.hidden = !expanded;
                        toggle.setAttribute('aria-expanded', String(expanded));
                        toggle.title =
                            (expanded ? 'Hide' : 'Show') +
                            ' label disambiguation: ' + fullText;
                        toggle.setAttribute('aria-label', toggle.title);
                    });

                    comment.parentNode.insertBefore(toggle, comment);
                }
            }

            function entityFromRow(row, childType) {
                const re = new RegExp('^/' + childType + '/(' + UUID + ')(?:[/?#]|$)', 'i');
                const cells = [...row.children];

                for (let index = 0; index < cells.length; index++) {
                    for (const link of cells[index].querySelectorAll('a[href]')) {
                        let pathname;
                        try {
                            pathname = new URL(link.href, location.href).pathname;
                        } catch {
                            continue;
                        }
                        const match = pathname.match(re);
                        if (match) {
                            return {mbid: match[1].toLowerCase(), index};
                        }
                    }
                }

                return null;
            }

            function prepareTables(childType) {
                const cellsByMbid = new Map();

                for (const table of document.querySelectorAll('table.tbl')) {
                    const rows = [...table.querySelectorAll('tr')];
                    const firstData = rows
                        .map(row => ({row, entity: entityFromRow(row, childType)}))
                        .find(item => item.entity);

                    if (!firstData) continue;
                    const entityIndex = firstData.entity.index;

                    const header =
                        table.querySelector('thead tr:last-child') ||
                        rows.find(row => row.querySelectorAll(':scope > th').length > entityIndex);
                    const headerCell = header?.children?.[entityIndex];
                    if (headerCell && !header.querySelector('.' + HEAD_CLASS)) {
                        const th = document.createElement('th');
                        th.className = HEAD_CLASS;
                        th.textContent = 'Relationships';
                        headerCell.insertAdjacentElement('afterend', th);
                    }

                    for (const row of rows) {
                        if (row === header) continue;

                        if (row.classList.contains('subh')) {
                            const spanning = row.querySelector(':scope > th[colspan], :scope > td[colspan]');
                            if (spanning && !row.dataset.mbtbRelationshipColspanAdjusted) {
                                spanning.colSpan += 1;
                                row.dataset.mbtbRelationshipColspanAdjusted = '1';
                            }
                            continue;
                        }

                        const tdCells = [...row.querySelectorAll(':scope > td')];
                        if (!tdCells.length || tdCells.length <= entityIndex) continue;
                        if (row.querySelector(':scope > td.' + CELL_CLASS)) continue;

                        const entity = entityFromRow(row, childType);
                        const td = document.createElement('td');
                        td.className = CELL_CLASS;
                        tdCells[entityIndex].insertAdjacentElement('afterend', td);

                        if (!entity) continue;
                        if (!cellsByMbid.has(entity.mbid)) cellsByMbid.set(entity.mbid, []);
                        cellsByMbid.get(entity.mbid).push(td);
                    }
                }

                return cellsByMbid;
            }

            function addUrlRelationship(cell, relation) {
                const targetUrl = relation?.url?.resource;
                if (!targetUrl) return;

                const link = document.createElement('a');
                link.href = targetUrl;
                link.title =
                    String(relation.type || 'URL relationship') +
                    (relation.ended ? ' (ended)' : '') +
                    ': ' + targetUrl;
                link.setAttribute('aria-label', link.title);

                const iconClass = relationIconClass(relation, targetUrl);
                if (iconClass) {
                    const icon = document.createElement('span');
                    icon.className =
                        'favicon ' + iconClass + '-favicon' +
                        (relation.ended ? ' mbtb-rel-ended' : '');
                    link.appendChild(icon);
                } else {
                    link.className = 'mbtb-rel-generic' + (relation.ended ? ' mbtb-rel-ended' : '');
                    link.textContent = '↗';
                }

                cell.appendChild(link);
            }

            function addMusicBrainzRelationship(cell, relation) {
                const targetType = String(relation?.['target-type'] || '');
                const normalizedType = targetType.replace('_', '-');
                const allowed =
                    (targetType === 'release_group' && relation.type === 'single from') ||
                    (targetType === 'release' && relation.type === 'remaster');
                if (!allowed) return;

                const target = relation[targetType];
                if (!target?.id) return;

                const link = document.createElement('a');
                link.className = 'mbtb-rel-mb' + (relation.ended ? ' mbtb-rel-ended' : '');
                link.href = '/' + normalizedType + '/' + target.id;
                link.title =
                    String(relation.type || 'MusicBrainz relationship') +
                    (relation.ended ? ' (ended)' : '');
                link.setAttribute('aria-label', link.title);

                const image = document.createElement('img');
                image.src = 'https://musicbrainz.org/favicon.ico';
                image.alt = '';
                link.appendChild(image);
                cell.appendChild(link);
            }

            function renderEntity(entity, cells) {
                for (const cell of cells) {
                    cell.textContent = '';
                    for (const relation of entity.relations || []) {
                        if (relation?.ended) continue;

                        if (relation?.['target-type'] === 'url') {
                            // Intentionally do not deduplicate by provider or icon class:
                            // every attached URL relationship gets its own shortcut icon.
                            addUrlRelationship(cell, relation);
                        } else {
                            addMusicBrainzRelationship(cell, relation);
                        }
                    }
                }
            }

            async function init() {
                const context = pageContext();
                if (!context) return;

                installStyle();
                collapseLabelDisambiguations();
                const cellsByMbid = prepareTables(context.childType);
                if (!cellsByMbid.size) return;

                const includes = {
                    'release-group': ['release-group-rels', 'url-rels'],
                    release: ['release-rels', 'url-rels', 'discids'],
                    recording: ['work-rels', 'url-rels'],
                    work: ['url-rels'],
                }[context.childType] || ['url-rels'];

                const page = Math.max(1, Number(new URL(location.href).searchParams.get('page')) || 1);
                const api = new URL('/ws/2/' + context.childType, location.origin);
                api.searchParams.set(context.parentType, context.parentMbid);
                api.searchParams.set('inc', includes.join(' '));
                api.searchParams.set('limit', '100');
                api.searchParams.set('offset', String((page - 1) * 100));
                api.searchParams.set('fmt', 'json');

                try {
                    const response = await __mbToolBoxFetch(api.toString(), {
                        headers: {Accept: 'application/json'},
                    });
                    if (!response.ok) {
                        throw new Error('HTTP ' + response.status);
                    }

                    const data = await response.json();
                    const listKey = {
                        'release-group': 'release-groups',
                        release: 'releases',
                        recording: 'recordings',
                        work: 'works',
                    }[context.childType];

                    for (const entity of data[listKey] || []) {
                        const cells = cellsByMbid.get(String(entity.id || '').toLowerCase());
                        if (cells?.length) renderEntity(entity, cells);
                    }
                } catch (error) {
                    console.error('[MusicBrainz ToolBox] Relationship shortcuts failed:', error);
                }
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', init, {once: true});
            } else {
                init();
            }
        })();
    }


})();
