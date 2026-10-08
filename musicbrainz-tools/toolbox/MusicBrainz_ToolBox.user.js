// ==UserScript==
// @name         MusicBrainz ToolBox
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.59
// @description  Combined MusicBrainz release-editor, recording, barcode, Spotify/Apple Music linking, search, cover-art, Disc ID, and duplicate-edit tools.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/*
// @match        https://beta.musicbrainz.org/*
// @match        https://open.spotify.com/*
// @match        https://music.apple.com/*
// @match        https://www.metal-archives.com/albums/*
// @match        https://listen.tidal.com/album/*
// @match        https://tidal.com/album/*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.meta.js
// @supportURL   https://github.com/karpuzikov/userscripts
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @grant        GM_removeValueChangeListener
// @grant        GM_addValueChangeListener
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_info
// @connect      api.github.com
// @connect      musicbrainz.org
// @connect      harmony.pulsewidth.org.uk
// @connect      music.apple.com
// @connect      amp-api.music.apple.com
// @connect      tidal.com
// @connect      music.youtube.com
// @connect      www.metal-archives.com
// @connect      www.deezer.com
// @connect      deezer.com
// @connect      www.qobuz.com
// @connect      qobuz.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    // Toolbox is the single owner of Apple Music importing when installed.
    // Standalone legacy copies yield; keep an already-running import intact.
    if (/^\/release\/[0-9a-f-]{36}\/edit-relationships\/?$/i.test(location.pathname)) {
        const root = document.documentElement;
        root.setAttribute('data-karpuzikov-apple-import-owner', 'toolbox');
        const legacyPanel = document.getElementById('am2mb-panel');
        if (legacyPanel && !document.getElementById('am2mb-load')?.disabled &&
            !document.getElementById('am2mb-tracks')?.textContent?.trim()) {
            legacyPanel.remove();
        }
    }

    const __mbToolBoxMusicBrainzIconSvg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 28" aria-hidden="true">' +
        '<polygon fill="#ba478f" points="12 0 0 7 0 21 12 28 12 0"/>' +
        '<polygon fill="#eb743b" points="13 0 25 7 25 21 13 28 13 0"/>' +
        '</svg>';

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


    function __mbToolBoxHarmonyReleaseUrl(providerUrl, musicBrainzId = '') {
        const base =
            'https://harmony.pulsewidth.org.uk/release?url=' +
            encodeURIComponent(String(providerUrl || '')) +
            '&gtin=&region=&deezer=&spotify=&tidal=&qobuz=';

        return musicBrainzId
            ? base + '&musicbrainz=' +
                encodeURIComponent(String(musicBrainzId))
            : base;
    }

    function __mbToolBoxComparableBarcode(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (!digits) return '';
        return digits.replace(/^0+/, '') || '0';
    }

    function __mbToolBoxBarcodeVariants(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (!digits) return [];

        const base = __mbToolBoxComparableBarcode(digits);
        const variants = new Set([digits, base]);
        for (let zeros = 1; zeros <= 3; zeros += 1) {
            variants.add('0'.repeat(zeros) + base);
        }

        return [...variants].filter(item => /^\d{8,14}$/.test(item));
    }

    function __mbToolBoxTextRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            __mbToolBoxGmXmlhttpRequest({
                method: options.method || 'GET',
                url,
                headers: options.headers || {},
                data: options.body,
                responseType: 'text',
                timeout: options.timeout || 15000,
                onload(response) {
                    if (
                        response.status === 0 ||
                        (response.status >= 200 && response.status < 300)
                    ) {
                        resolve(
                            response.responseText ??
                            response.response ??
                            ''
                        );
                        return;
                    }
                    reject(
                        new Error(
                            'HTTP ' +
                            response.status +
                            (response.statusText ? ' ' + response.statusText : '')
                        )
                    );
                },
                onerror(response) {
                    reject(
                        new Error(
                            response?.error ||
                            response?.statusText ||
                            'Network request failed'
                        )
                    );
                },
                ontimeout() {
                    reject(new Error('Request timed out'));
                },
            });
        });
    }

    let __mbToolBoxAppleTokenPromise = null;

    async function __mbToolBoxGetAppleMusicToken(seedUrl = '') {
        if (__mbToolBoxAppleTokenPromise) {
            return __mbToolBoxAppleTokenPromise;
        }

        __mbToolBoxAppleTokenPromise = (async () => {
            let scripts = [];

            if (location.hostname === 'music.apple.com') {
                scripts = [
                    ...document.querySelectorAll('script[src][crossorigin]')
                ].map(script => script.src).filter(Boolean);
            }

            if (!scripts.length && seedUrl) {
                const pageHtml = await __mbToolBoxTextRequest(seedUrl);
                const doc = new DOMParser().parseFromString(
                    pageHtml,
                    'text/html'
                );
                scripts = [
                    ...doc.querySelectorAll('script[src][crossorigin]')
                ].map(script =>
                    new URL(script.getAttribute('src'), seedUrl).href
                );
            }

            if (!scripts.length) {
                throw new Error(
                    'Could not find Apple Music configuration script'
                );
            }

            const tokenRegex =
                /["'](eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)["']/;
            let lastError = null;

            for (const scriptUrl of [...new Set(scripts)]) {
                try {
                    const source = await __mbToolBoxTextRequest(scriptUrl);
                    const token = source.match(tokenRegex)?.[1];
                    if (token) return token;
                } catch (error) {
                    lastError = error;
                }
            }

            throw lastError ||
                new Error('Could not find Apple Music bearer token');
        })();

        try {
            return await __mbToolBoxAppleTokenPromise;
        } catch (error) {
            __mbToolBoxAppleTokenPromise = null;
            throw error;
        }
    }

    async function __mbToolBoxAppleAlbumBarcode(info) {
        if (!info?.id) return '';

        const seedUrl =
            info.harmonyResource ||
            info.harmonyUrl ||
            info.musicBrainzResource ||
            info.resource ||
            location.href;
        const token = await __mbToolBoxGetAppleMusicToken(seedUrl);
        const storefronts = [...new Set([
            info.storefront,
            'us',
        ].filter(Boolean))];

        let lastError = null;

        for (const storefront of storefronts) {
            const apiUrl =
                'https://amp-api.music.apple.com/v1/catalog/' +
                encodeURIComponent(storefront) +
                '/albums/' +
                encodeURIComponent(info.id);

            try {
                const text = await __mbToolBoxTextRequest(apiUrl, {
                    headers: {
                        Accept: 'application/json',
                        Authorization: 'Bearer ' + token,
                        Origin: 'https://amp-api.music.apple.com',
                    },
                });
                const data = JSON.parse(text);
                const album = (data.data || []).find(
                    item => item?.type === 'albums'
                ) || data.data?.[0];
                const barcode = String(
                    album?.attributes?.upc || ''
                ).replace(/\D/g, '');

                if (barcode) return barcode;
            } catch (error) {
                lastError = error;
            }
        }

        if (lastError) throw lastError;
        return '';
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
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/release/add*","https://musicbrainz.org/release/*/edit*","https://beta.musicbrainz.org/release/add*","https://beta.musicbrainz.org/release/*/edit*"], ["https://musicbrainz.org/release/*/edit-relationships*","https://beta.musicbrainz.org/release/*/edit-relationships*"])) {
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
    if (__mbToolBoxShouldRun(["https://musicbrainz.org/release-group/*","https://beta.musicbrainz.org/release-group/*","https://musicbrainz.org/release/*/edit*","https://beta.musicbrainz.org/release/*/edit*"], ["https://musicbrainz.org/release-group/*/*","https://beta.musicbrainz.org/release-group/*/*"])) {
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
                    const album = albums.find(
                        item => equalGtin(item.attributes?.upc, barcode)
                    );
                    if (!album) {
                        // Apple can return non-matching albums for filter[upc].
                        // Never trust the first result unless its UPC exactly
                        // matches the requested MusicBrainz barcode.
                        continue;
                    }
    
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
    
        async function validateExactBarcodeLinks(links, barcode) {
            const candidates = dedupeExternalLinks(links || []);
            if (!candidates.length) return [];

            const validated = await mapPool(candidates, 3, async link => {
                const check = await lookupLinkedUrl(link.url);
                if (!check?.gtin || !equalGtin(check.gtin, barcode)) {
                    console.warn(
                        '[MusicBrainz ToolBox] Rejected provider link from barcode lookup because the provider barcode does not exactly match:',
                        {
                            provider: providerLabel(link.url),
                            requestedBarcode: barcode,
                            returnedBarcode: check?.gtin || '',
                            url: link.url,
                        },
                    );
                    return null;
                }
                return link;
            });

            return validated.filter(Boolean);
        }

        async function lookupByBarcode(barcode, appleSeedUrl) {
            const harmony = await lookupHarmonyByBarcode(barcode);
            const harmonyCandidates = (harmony.externalLinks || [])
                .filter(link => providerFamily(link.url) !== 'apple');
            const harmonyLinks = await validateExactBarcodeLinks(
                harmonyCandidates,
                barcode
            );
    
            const apple = await lookupAppleByBarcode(barcode, appleSeedUrl);
            const appleLinks = (
                apple.gtin &&
                equalGtin(apple.gtin, barcode)
            )
                ? (apple.externalLinks || [])
                : [];
    
            return {
                found: Boolean(harmonyLinks.length || appleLinks.length),
                gtin: harmonyLinks.length
                    ? barcode
                    : (appleLinks.length ? apple.gtin : ''),
                externalLinks: dedupeExternalLinks([
                    ...harmonyLinks,
                    ...appleLinks,
                ]),
                providers: [...new Set([
                    ...harmonyLinks.map(link => providerLabel(link.url)),
                    ...appleLinks.map(link => providerLabel(link.url)),
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

                // A reverse lookup is usable only when Harmony itself confirms
                // the requested barcode. Never accept "close", fallback, or
                // otherwise mismatching results.
                if (!parsed.gtin || !equalGtin(parsed.gtin, barcode)) {
                    return {
                        ...parsed,
                        found: false,
                        externalLinks: [],
                        errors: [
                            ...(parsed.errors || []),
                            parsed.gtin
                                ? `Harmony returned barcode ${parsed.gtin} for requested barcode ${barcode}`
                                : `Harmony did not confirm requested barcode ${barcode}`,
                        ],
                    };
                }

                parsed.externalLinks = parsed.externalLinks.filter(
                    link => providerFamily(link.url)
                );
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
            const actions = correction.linkActions || [];
            const evidence = correction.evidence || [];
    
            for (const action of actions) {
                if (['replace-wrong-link', 'remove-duplicate-wrong-link', 'move-out'].includes(action.type)) {
                    // Cite the provider barcode that was actually read for THIS linked URL.
                    // The fact that another MusicBrainz release also has the URL is not
                    // the reason for removing the mismatching relationship.
                    const check = evidence.find(item =>
                        item.gtin && item.sourceUrl &&
                        providerEntityKey(item.sourceUrl) === providerEntityKey(action.url)
                    );
                    if (check && correction.oldBarcode && !equalGtin(check.gtin, correction.oldBarcode)) {
                        lines.push(
                            `Barcode mismatch with ${action.provider} (MusicBrainz: ${correction.oldBarcode}; ${action.provider}: ${check.gtin}).`
                        );
                    } else {
                        // Never claim a barcode mismatch without readable provider evidence.
                        lines.push(`Removed ${action.provider} release link (provider barcode evidence unavailable).`);
                    }
                } else if (action.type === 'move-in') {
                    lines.push(`Added ${action.provider} release link matching barcode ${correction.oldBarcode}.`);
                }
            }
    
            if (correction.newBarcode) {
                lines.push(`MusicBrainz barcode corrected: ${correction.oldBarcode} -> ${correction.newBarcode}.`);
            }
    
            if (correction.addLinks.length && !actions.some(action =>
                action.type === 'replace-wrong-link' || action.type === 'move-in'
            )) {
                lines.push(`Added ${correction.addLinks.length} provider release link(s) for barcode ${correction.oldBarcode}.`);
            }
    
            const distinct = [...new Set(lines)];
            if (!distinct.length) {
                distinct.push('Checked the Digital Media release barcode against linked provider release pages.');
            }
    
            return [...distinct, '', `Script: ${SCRIPT_URL}`].join('\n');
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
                    svg: __mbToolBoxMusicBrainzIconSvg,
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

            const hasUnlinked = item.releases.some(
                release => release?.linkState === 'unlinked'
            );
            const ttl =
                item.releases.length && !hasUnlinked
                    ? FOUND_TTL
                    : MISSING_TTL;
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


        async function searchMusicBrainzReleasesByBarcode(barcode) {
            const variants = __mbToolBoxBarcodeVariants(barcode);
            if (!variants.length) return [];

            await throttleMusicBrainz();

            const query = variants
                .map(value => 'barcode:' + value)
                .join(' OR ');
            const endpoint =
                'https://musicbrainz.org/ws/2/release/?query=' +
                encodeURIComponent(query) +
                '&limit=100&fmt=json';

            const data = await requestJson(endpoint);
            const wanted = __mbToolBoxComparableBarcode(barcode);
            const unique = new Map();

            for (const release of data?.releases || []) {
                if (
                    __mbToolBoxComparableBarcode(release?.barcode) !==
                    wanted
                ) {
                    continue;
                }

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
                        barcode: String(release?.barcode || barcode),
                        linkState: 'unlinked',
                    });
                }
            }

            return [...unique.values()];
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

                if (!releases.length) {
                    const barcode =
                        await __mbToolBoxAppleAlbumBarcode(info);
                    if (barcode) {
                        releases =
                            await searchMusicBrainzReleasesByBarcode(
                                barcode
                            );
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
                .${LINK_CLASS}.mb-toolbox-provider-link-missing {
                    position: relative;
                    overflow: visible;
                }
                .${LINK_CLASS} .mb-toolbox-broken-chain-badge {
                    position: absolute;
                    right: 0;
                    bottom: 0;
                    z-index: 2;
                    width: 10px;
                    height: 10px;
                    overflow: visible;
                    font-size: 9px;
                    line-height: 10px;
                    text-align: center;
                    pointer-events: none;
                    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .9));
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
                ? currentReleases.map(release => {
                    const unlinked =
                        release.linkState === 'unlinked';
                    const releaseLabel = release.disambiguation
                        ? `${release.title || release.id} (${release.disambiguation})`
                        : (release.title || release.id);

                    return {
                        key:
                            (unlinked ? 'mb-unlinked:' : 'mb:') +
                            release.id,
                        mbid: release.id,
                        href: unlinked
                            ? __mbToolBoxHarmonyReleaseUrl(
                                info.harmonyResource,
                                release.id
                            )
                            : 'https://musicbrainz.org/release/' +
                                release.id,
                        svg: __mbToolBoxMusicBrainzIconSvg,
                        alt: 'MusicBrainz',
                        brokenLink: unlinked,
                        title: unlinked
                            ? `MusicBrainz release found by barcode ${release.barcode || ''}, but this Apple Music release is not linked: ${releaseLabel}`
                            : `Open MusicBrainz release: ${releaseLabel}`,
                    };
                })
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
                link.className =
                    LINK_CLASS +
                    (item.brokenLink
                        ? ' mb-toolbox-provider-link-missing'
                        : '');
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
                    if (item.brokenLink) {
                        const badge = document.createElement('span');
                        badge.className =
                            'mb-toolbox-broken-chain-badge';
                        badge.textContent = '⛓️‍💥';
                        badge.setAttribute('aria-hidden', 'true');
                        link.appendChild(badge);
                    }
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
                (
                    currentReleases.length === 0 ||
                    currentReleases.some(
                        release =>
                            release?.linkState === 'unlinked'
                    )
                )
            ) {
                refreshCurrentAlbum(true);
            }
        });

        document.addEventListener('visibilitychange', () => {
            if (
                document.visibilityState === 'visible' &&
                currentAlbumKey &&
                Array.isArray(currentReleases) &&
                (
                    currentReleases.length === 0 ||
                    currentReleases.some(
                        release =>
                            release?.linkState === 'unlinked'
                    )
                )
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

            const hasUnlinked = item.releases.some(
                release => release?.linkState === 'unlinked'
            );
            const ttl =
                item.releases.length && !hasUnlinked
                    ? FOUND_TTL
                    : MISSING_TTL;
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


        async function searchReleasesByBarcode(barcode) {
            const variants = __mbToolBoxBarcodeVariants(barcode);
            if (!variants.length) return [];

            const query = variants
                .map(value => 'barcode:' + value)
                .join(' OR ');
            const endpoint =
                'https://musicbrainz.org/ws/2/release/?query=' +
                encodeURIComponent(query) +
                '&limit=100&fmt=json';

            const data = await queueMusicBrainzRequest(
                () => requestJson(endpoint)
            );
            const wanted = __mbToolBoxComparableBarcode(barcode);
            const unique = new Map();

            for (const release of data?.releases || []) {
                if (
                    __mbToolBoxComparableBarcode(release?.barcode) !==
                    wanted
                ) {
                    continue;
                }

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
                        barcode: String(release?.barcode || barcode),
                        linkState: 'unlinked',
                    });
                }
            }

            return [...unique.values()];
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

                    if (!releases.length) {
                        const barcode =
                            await __mbToolBoxAppleAlbumBarcode(info);
                        if (barcode) {
                            releases =
                                await searchReleasesByBarcode(
                                    barcode
                                );
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
                '.' + INDICATOR_CLASS + '.mb-toolbox-provider-link-missing {',
                'position: relative !important;',
                'overflow: visible !important;',
                '}',
                '.' + INDICATOR_CLASS + ' .mb-toolbox-broken-chain-badge {',
                'position: absolute !important;',
                'right: 0 !important;',
                'bottom: 0 !important;',
                'z-index: 2 !important;',
                'width: 8px !important;',
                'height: 8px !important;',
                'overflow: visible !important;',
                'font-size: 7px !important;',
                'line-height: 8px !important;',
                'text-align: center !important;',
                'pointer-events: none !important;',
                'filter: drop-shadow(0 1px 1px rgba(0,0,0,.9));',
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
            const holder = document.createElement('span');
            holder.innerHTML = __mbToolBoxMusicBrainzIconSvg;
            const icon = holder.firstElementChild;
            icon.setAttribute('role', 'img');
            icon.setAttribute('aria-label', 'MusicBrainz');
            return icon;
        }

        function createIndicator(info, releases) {
            if (releases.length) {
                const release = releases[0];
                const unlinked =
                    release.linkState === 'unlinked';
                const link = document.createElement('a');
                link.className =
                    INDICATOR_CLASS +
                    (unlinked
                        ? ' mb-toolbox-provider-link-missing'
                        : '');
                link.dataset.mbtbKey = encodeURIComponent(info.key);
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.href = unlinked
                    ? __mbToolBoxHarmonyReleaseUrl(
                        info.harmonyUrl,
                        release.id
                    )
                    : 'https://musicbrainz.org/release/' + release.id;

                const releaseLabel = release.disambiguation
                    ? (release.title || release.id) +
                        ' (' + release.disambiguation + ')'
                    : (release.title || release.id);
                link.title = unlinked
                    ? 'MusicBrainz release found by barcode ' +
                        (release.barcode || '') +
                        ', but this Apple Music release is not linked: ' +
                        releaseLabel
                    : 'Open MusicBrainz release: ' + releaseLabel;
                link.setAttribute('aria-label', link.title);
                link.appendChild(makeMusicBrainzImage());

                if (unlinked) {
                    const badge = document.createElement('span');
                    badge.className =
                        'mb-toolbox-broken-chain-badge';
                    badge.textContent = '⛓️‍💥';
                    badge.setAttribute('aria-hidden', 'true');
                    link.appendChild(badge);
                }

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
                        (
                            cached.length === 0 ||
                            cached.some(
                                release =>
                                    release?.linkState ===
                                    'unlinked'
                            )
                        );
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



    // ============================================================================
    // Credit Hoarder provider import/review system (MIT).
    // Copyright: majkinetor and contributors.
    // Upstream: https://github.com/majkinetor/musicbrainz-userscripts/tree/main/userscripts/credit_hoarder
    // Upstream blob: 3609da1f25cc3ce5c6d4c054c087eafda4dc2134; integrated by Karpuzikov Tools.
    // Modifications: single-script integration and global duplicate-Work check.
    // ============================================================================
    if (new Set(['musicbrainz.org', 'beta.musicbrainz.org',
        'tidal.com', 'listen.tidal.com', 'www.metal-archives.com']
        ).has(location.hostname.toLowerCase())) {
(() => {
// one copy per page: with String Theory and a standalone install both on, the newer one runs (#653)
function mbuClaimVer(v) {
    return String(v || '').split('.').map(function (n) { return parseInt(n, 10) || 0; });
}
function mbuClaimCmp(a, b) {
    var x = mbuClaimVer(a), y = mbuClaimVer(b);
    for (var i = 0; i < Math.max(x.length, y.length); i++) { var d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
    return 0;
}
function mbuClaim(key, label) {
    var info = (typeof GM_info !== 'undefined' && GM_info && GM_info.script) || {};
    var name = String(info.name || label || key), ver = String(info.version || '0');
    var mine = (name.slice(-1) === '*' ? 'String Theory' : 'standalone') + ' v' + ver;
    var root = document.documentElement, attr = 'data-mbu-run-' + key, ev = 'mbu-claim-' + key, noteKey = 'mbu-newer-' + key;
    var log = function (msg) { try { if (typeof mbuLog !== 'undefined' && mbuLog.active) mbuLog.active.info(msg); else if (typeof mbuToast !== 'undefined' && typeof mbuToast.log === 'function') mbuToast.log('info', msg); else console.info('[' + (label || key) + '] ' + msg); } catch (e) { /* no log */ } };
    var note = null;
    try { note = JSON.parse(localStorage.getItem(noteKey) || 'null'); } catch (e) { /* storage blocked */ }
    // A note older than this copy is spent. This copy's own note stays: it is what keeps the
    // older copy aside on every later load, not only the next one (#671).
    var noteCmp = note ? mbuClaimCmp(note.ver, ver) : 1;
    if (noteCmp < 0) { try { localStorage.removeItem(noteKey); } catch (e) { /* storage blocked */ } }
    if (noteCmp <= 0) note = null;
    var held = root && root.getAttribute(attr);
    var off = function (why) {
        // tell the running copy (any sandbox hears a DOM event), or the copy that runs after
        // this one (it reads the attribute), and stay quiet
        try { if (root) root.setAttribute(attr + '-off', JSON.stringify({ mine: mine, why: why })); } catch (e) { /* no attribute */ }
        try { document.dispatchEvent(new CustomEvent(ev, { detail: JSON.stringify({ mine: mine, ver: ver, why: why }) })); } catch (e) { /* no event */ }
        return false;
    };
    if (held) {
        var heldVer = (root.getAttribute(attr + '-ver') || '0');
        if (mbuClaimCmp(ver, heldVer) > 0) {
            try { localStorage.setItem(noteKey, JSON.stringify({ ver: ver, mine: mine, at: Date.now() })); } catch (e) { /* storage blocked */ }
            return off('newer, from the next page load');
        }
        return off('older or the same');
    }
    if (note) {
        // a newer copy said it is installed: leave the page to it, unless it never shows up
        var watch = function () {
            setTimeout(function () {
                if (root.getAttribute(attr)) return;
                try { localStorage.removeItem(noteKey); } catch (e) { /* storage blocked */ }
                try { console.info('[' + (label || key) + '] the newer copy (' + note.mine + ') did not start: this copy runs again from the next page load'); } catch (e) { /* no console */ }
            }, 3000);
        };
        if (document.readyState === 'complete') watch(); else window.addEventListener('load', watch, { once: true });
        return off('older: a newer copy runs');
    }
    if (root) { root.setAttribute(attr, mine); root.setAttribute(attr + '-ver', ver); }
    var told = function (o) {
        log((label || key) + ' is installed twice: ' + mine + ' runs, ' + (o.mine || 'another copy') + ' is switched off'
            + (o.why === 'newer, from the next page load' ? ' for this page (it is newer and runs from the next page load)' : '') + '.');
    };
    document.addEventListener(ev, function (e) { var o = {}; try { o = JSON.parse(e.detail); } catch (x) { /* not ours */ } told(o); });
    // a copy that stepped aside before this one started (it found a note): log it once the script's log is up
    var before = root && root.getAttribute(attr + '-off');
    if (before) setTimeout(function () { var o = {}; try { o = JSON.parse(before); } catch (x) { /* not ours */ } told(o); }, 0);
    return true;
}
if (!mbuClaim('credit_hoarder', 'Credit Hoarder')) return;
  // src/constants.js
  var REL_TEMPLATE = {
    _lineage: [],
    _original: null,
    _status: 1,
    attributes: null,
    begin_date: null,
    editsPending: false,
    end_date: null,
    ended: false,
    entity0_credit: "",
    entity1_credit: "",
    id: null,
    linkOrder: 0,
    linkTypeID: null
  };
  var SELECTORS = {
    MediumsInput: ".multiselect-input",
    MediumsInputOptions: ".multiselect-input + .menu a",
    InstrumentsInput: "#add-relationship-dialog .multiselect.instrument input[aria-autocomplete]",
    VocalsTypeInput: "#add-relationship-dialog .multiselect.vocal input[aria-autocomplete]",
    AddRelationshipsDialogEntityType: "#add-relationship-dialog .entity-type",
    AddRelationshipsDialogRelationshipType: "#add-relationship-dialog input.relationship-type",
    AddRelationshipsDialogRelationshipTarget: "#add-relationship-dialog input.relationship-target",
    AddRelationshipsDialogEntityCredit: "#add-relationship-dialog input.entity-credit",
    AddRelationshipsDialogDoneButton: "#add-relationship-dialog .buttons button.positive",
    AddRelationshipsDialogError: "#add-relationship-dialog .error",
    AddRelationshipsDialogCancelButton: "#add-relationship-dialog .buttons button.negative",
    AddReleaseRelationshipButton: "#release-rels button.add-relationship",
    EditNote: "#edit-note-text",
    TaskInput: "#add-relationship-dialog .attribute-container.task input"
  };
  var EQUIVALENCE_SETS = [
    ["writer", "composer"]
  ];
  var MB = typeof location !== "undefined" && /(^|\.)musicbrainz\.org$/.test(location.hostname) ? "//" + location.hostname : "//musicbrainz.org";
  var DISCOGS_CHANNEL = new BroadcastChannel("discogs-importer-artist");
  DISCOGS_CHANNEL.unref?.();
  var pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis;

  // src/log.js
  var _logs = null;
  var _warn = 0;
  var _err = 0;
  var _countListener = null;
  function onLogCounts(fn) {
    _countListener = fn;
  }
  function resetLogCounts() {
    _warn = 0;
    _err = 0;
    _notifyCounts();
  }
  function _notifyCounts() {
    if (_countListener) {
      try {
        _countListener(_warn, _err);
      } catch (e) {
      }
    }
  }
  function setLogContainer(el) {
    _logs = el;
    const pending = _pending.splice(0, _pending.length);
    pending.forEach((a) => _emit(...a));
  }
  function getLogContainer() {
    return _logs;
  }
  var _review = null;
  function setReviewContainer(el) {
    _review = el;
  }
  function getReviewContainer() {
    return _review || _logs;
  }
  var _pending = [];
  var PENDING_MAX = 200;
  function _console(plainText, sev) {
    try {
      const line = "[credit_hoarder] " + String(plainText).replace(/<[^>]*>/g, "").trim();
      if (sev === "error") console.error(line);
      else if (sev === "warn") console.warn(line);
      else console.log(line);
    } catch (e) {
    }
  }
  function _emit(html, plainText, sev) {
    _console(plainText, sev);
    if (!_logs) {
      if (_pending.length < PENDING_MAX) _pending.push([html, plainText, sev]);
      return;
    }
    const li = document.createElement("li");
    if (sev) li.dataset.sev = sev;
    if (sev === "warn") {
      _warn++;
      _notifyCounts();
    } else if (sev === "error") {
      _err++;
      _notifyCounts();
    }
    const d = /* @__PURE__ */ new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    li.innerHTML = `<span style="color:var(--mbu-text-weak);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.82em;">${stamp}</span> ${html}`;
    _logs.insertAdjacentElement("beforeend", li);
    const bar = document.querySelector(".discogs-bar");
    if (bar?._setProgress) {
      bar._setProgress(null, plainText.replace(/<[^>]*>/g, "").trim().substring(0, 120));
    }
  }
  var log = {
    info: (msg) => _emit(msg, msg),
    warn: (msg) => _emit(`<span style="color:orange">WARN ${msg}</span>`, `WARN ${msg}`, "warn"),
    error: (msg) => _emit(`<span style="color:red">ERR ${msg}</span>`, `ERR ${msg}`, "error"),
    // Entity skipped because it wasn't matched on MB in the review (#118). Kept
    // OUT of the WARN tally — these are surfaced by the separate "N unresolved"
    // badge, and the maintainer asked not to lump them with real warnings. Still
    // rendered (muted amber) so the log shows exactly which roles were dropped.
    skip: (msg) => _emit(`<span style="color:var(--mbu-warn)">SKIP ${msg}</span>`, `SKIP ${msg}`, "skip")
  };
  var _debugUl = null;
  var _debugStartT = null;
  function _ensureDebugUl() {
    if (_debugUl) return _debugUl;
    if (!_logs) return null;
    const details = document.createElement("details");
    details.style.cssText = "margin:0.3rem 0;";
    const summary = document.createElement("summary");
    summary.textContent = "Preflight diagnostics";
    summary.style.cssText = "cursor:pointer;font-size:0.8rem;color:var(--mbu-text-weak);user-select:none;";
    details.appendChild(summary);
    const ul = document.createElement("ul");
    ul.style.cssText = "list-style:none;margin:0.3rem 0;padding:0.4rem 0.6rem;background:var(--mbu-bg-raised);border-radius:0.25rem;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.72rem;color:var(--mbu-text);max-height:24rem;overflow-y:auto;";
    details.appendChild(ul);
    const li = document.createElement("li");
    li.style.listStyle = "none";
    li.appendChild(details);
    _logs.appendChild(li);
    _debugUl = ul;
    _debugStartT = performance.now();
    return _debugUl;
  }
  function logDebug(line) {
    const ul = _ensureDebugUl();
    if (!ul) return;
    const t = Math.round(performance.now() - _debugStartT);
    const row = document.createElement("div");
    row.textContent = `[+${t}ms] ${line}`;
    ul.appendChild(row);
  }

  // ../../dev/net/mb-gate.mjs
  var MBN_GAP = 1e3;
  var MBN_BURST = 3;
  var MBN_KEY = "mbu:mb-gate";
  var MBN_LOCK = "mbu-mb-gate";
  var MBN_MAX_HOLD = 6e4;
  function mbnGated(url) {
    const s = String(url || "");
    return /^\/ws\/2\//.test(s) || /^https?:\/\/([a-z0-9-]+\.)*musicbrainz\.org\/ws\/2\//i.test(s);
  }
  async function mbnState(fn) {
    const rw = () => {
      let s = null, stored = true;
      try {
        s = JSON.parse(localStorage.getItem(MBN_KEY) || "null");
      } catch (e) {
        stored = false;
      }
      const g = globalThis.__mbnGate || (globalThis.__mbnGate = { tat: 0, cool: 0, hot: 0 });
      if (!stored) s = g;
      else if (!s || typeof s !== "object") s = { tat: 0, cool: 0, hot: 0 };
      const out = fn(s);
      Object.assign(g, s);
      try {
        localStorage.setItem(MBN_KEY, JSON.stringify({ tat: s.tat || 0, cool: s.cool || 0, hot: s.hot || 0 }));
      } catch (e) {
      }
      return out;
    };
    let timer = 0;
    try {
      if (typeof navigator !== "undefined" && navigator.locks && navigator.locks.request) {
        const ctrl = typeof AbortController === "function" ? new AbortController() : null;
        if (ctrl) timer = setTimeout(() => ctrl.abort(), 3e3);
        return await navigator.locks.request(MBN_LOCK, ctrl ? { signal: ctrl.signal } : {}, rw);
      }
    } catch (e) {
    } finally {
      clearTimeout(timer);
    }
    return rw();
  }
  async function mbnSlot(o) {
    o = o || {};
    const t0 = Date.now(), background = o.background !== false;
    const booked = await mbnState((s) => {
      const now = Date.now(), cool = s.cool || 0, tat = s.tat || 0;
      let at = background ? Math.max(now, tat - (MBN_BURST - 1) * MBN_GAP) : now;
      at = Math.max(at, cool);
      s.tat = Math.max(tat, at) + MBN_GAP;
      return { at, why: cool > now && cool >= at ? "MusicBrainz asked everyone to wait" : "pacing, one request a second" };
    });
    let told = false;
    for (; ; ) {
      if (o.cancelled && o.cancelled()) return { ok: false, waited: Date.now() - t0 };
      let cool = 0;
      try {
        cool = (JSON.parse(localStorage.getItem(MBN_KEY) || "null") || {}).cool || 0;
      } catch (e) {
        cool = (globalThis.__mbnGate || {}).cool || 0;
      }
      const until = Math.max(booked.at, cool), left = until - Date.now();
      if (left <= 0) break;
      if (!told && until - t0 > 1e3 && o.log) {
        told = true;
        o.log("info", "MusicBrainz gate: " + (o.label || "request") + " waits " + Math.round((until - t0) / 100) / 10 + "s (" + (cool > booked.at ? "MusicBrainz asked everyone to wait" : booked.why) + ")");
      }
      await new Promise((r) => setTimeout(r, Math.min(left, 250)));
    }
    return { ok: true, waited: Date.now() - t0 };
  }
  async function mbnAnswer(status, header, o) {
    o = o || {};
    if (status === 429 || status === 503) {
      const raw = header ? header("Retry-After") : null;
      const secs = Number(raw), date = raw ? Date.parse(raw) : NaN;
      const ra = Number.isFinite(secs) ? secs * 1e3 : Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
      const hold = await mbnState((s) => {
        const now = Date.now();
        if (now > (s.cool || 0) + 3e4) s.hot = 0;
        if (now >= (s.cool || 0)) s.hot = Math.min((s.hot || 0) + 1, 6);
        const ms = Math.min(Math.max(1e3, ra) * Math.max(1, s.hot), MBN_MAX_HOLD);
        s.cool = Math.max(s.cool || 0, Date.now() + ms);
        return s.cool - Date.now();
      });
      if (o.log) o.log("warn", "MusicBrainz gate: HTTP " + status + (raw != null ? " (Retry-After: " + raw + ")" : "") + " \u2014 every script holds " + Math.round(hold / 100) / 10 + "s");
      return { throttled: true, hold };
    }
    if (status >= 200 && status < 500) await mbnState((s) => {
      if (s.hot) s.hot = Date.now() > (s.cool || 0) + 3e4 ? 0 : s.hot - 1;
    });
    return { throttled: false, hold: 0 };
  }
  async function mbnFetch(url, init, o) {
    o = o || {};
    if (!mbnGated(url)) return fetch(url, init);
    const tries = o.tries || 4;
    for (let attempt = 1; ; attempt++) {
      const slot = await mbnSlot(o);
      if (!slot.ok) return null;
      const r = await fetch(url, init);
      const a = await mbnAnswer(r.status, (n) => r.headers.get(n), o);
      if (!a.throttled || attempt >= tries) return r;
    }
  }

  // src/api-mb.js
  async function fetchMBEntity(mbid) {
    const res = await fetch(`/ws/js/entity/${mbid}`);
    if (!res.ok) throw new Error(`/ws/js/entity/${mbid} \u2192 ${res.status}`);
    return res.json();
  }
  var mbThrottle = /* @__PURE__ */ (() => {
    const MAX_CONCURRENT = 4;
    let _running = 0;
    let _pauseUntil = 0;
    const _queue = [];
    let _totalRequests = 0;
    let _rateLimited = 0;
    async function _waitForPause() {
      let wait = _pauseUntil - Date.now();
      if (wait <= 0) return;
      logDebug(`throttle: waiting ${wait}ms for shared pause`);
      while ((wait = _pauseUntil - Date.now()) > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    function _drain() {
      while (_running < MAX_CONCURRENT && _queue.length > 0) {
        _running++;
        const item = _queue.shift();
        _run(item).finally(() => {
          _running--;
          _drain();
        });
      }
    }
    let _diagReqSeq = 0;
    const REQUEST_TIMEOUT_MS = 1e4;
    async function _run(item) {
      const tag = `req#${++_diagReqSeq}`;
      const shortUrl = item.url.replace(MB, "").replace(/^https:/, "");
      const gated = mbnGated(item.url);
      const gateLog = (lv, m) => lv === "warn" ? log.warn(m) : logDebug(m);
      for (let attempt = 0; attempt <= item.retries; attempt++) {
        await _waitForPause();
        if (gated) await mbnSlot({ label: shortUrl, log: gateLog });
        _totalRequests++;
        const attemptTag = attempt === 0 ? "" : ` (retry ${attempt})`;
        logDebug(`${tag} [running=${_running} queued=${_queue.length}] GET ${shortUrl}${attemptTag}`);
        const t0 = Date.now();
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
        try {
          const res = await fetch(item.url, { signal: ctrl.signal });
          const elapsed = Date.now() - t0;
          if (gated) {
            const a = await mbnAnswer(res.status, (n) => res.headers.get(n), { log: gateLog });
            if (a.throttled) {
              _rateLimited++;
              logDebug(`${tag} <- ${res.status} in ${elapsed}ms; the shared gate holds ${a.hold}ms`);
              continue;
            }
          }
          if (res.status === 429 || res.status === 503) {
            _rateLimited++;
            const ra = parseInt(res.headers.get("Retry-After"), 10);
            const waitMs = ra > 0 ? ra * 1e3 : Math.min(1e3 * Math.pow(2, attempt), 3e4);
            _pauseUntil = Math.max(_pauseUntil, Date.now() + waitMs);
            logDebug(`${tag} <- ${res.status} in ${elapsed}ms; shared pause pushed to +${waitMs}ms`);
            continue;
          }
          if (!res.ok) {
            logDebug(`${tag} <- ${res.status} (give up) in ${elapsed}ms`);
            item.resolve(item.nf && res.status === 404 ? { notFound: true } : null);
            return;
          }
          const data = item.wantJson ? await res.json() : res;
          logDebug(`${tag} <- ${res.status} in ${elapsed}ms`);
          item.resolve(data);
          return;
        } catch (e) {
          const elapsed = Date.now() - t0;
          const isTimeout = e?.name === "AbortError";
          const reason = isTimeout ? `timed out after ${REQUEST_TIMEOUT_MS}ms` : `${e?.message || e}`;
          if (isTimeout) {
            _rateLimited++;
            const waitMs = Math.min(1e3 * Math.pow(2, attempt), 8e3);
            _pauseUntil = Math.max(_pauseUntil, Date.now() + waitMs);
            logDebug(`${tag} threw in ${elapsed}ms: ${reason}; shared pause pushed to +${waitMs}ms`);
          } else {
            logDebug(`${tag} threw in ${elapsed}ms: ${reason}`);
          }
          if (attempt === item.retries) {
            item.resolve(null);
            return;
          }
          await new Promise((r) => setTimeout(r, 500));
        } finally {
          clearTimeout(timer);
        }
      }
      item.resolve(null);
    }
    function _enqueue(url, retries, wantJson, nf = false) {
      return new Promise((resolve) => {
        _queue.push({ url, retries, wantJson, nf, resolve });
        _drain();
      });
    }
    return {
      fetchJson: (url, retries = 3) => _enqueue(url, retries, true),
      // Like fetchJson, but a 404 resolves `{ notFound: true }` instead of
      // null — so null unambiguously means "lookup FAILED" (#193 chip bug).
      fetchJson404: (url, retries = 3) => _enqueue(url, retries, true, true),
      fetchRaw: (url, retries = 3) => _enqueue(url, retries, false),
      stats: () => ({
        total: _totalRequests,
        rateLimited: _rateLimited,
        inFlight: _running,
        queued: _queue.length
      })
    };
  })();
  async function fetchWithRetry(url, retries = 4) {
    return mbThrottle.fetchJson(url, retries);
  }
  var _relTypeCache = /* @__PURE__ */ new Map();
  async function fetchArtistRelTypes(mbid) {
    if (!mbid) return null;
    if (_relTypeCache.has(mbid)) return _relTypeCache.get(mbid);
    const json = await mbThrottle.fetchJson(
      `${MB}/ws/2/artist/${mbid}?inc=recording-rels+release-rels+release-group-rels+work-rels&fmt=json&limit=100`
    );
    if (!json) return null;
    const types = relRoleLabels(json.relations);
    _relTypeCache.set(mbid, types);
    return types;
  }
  var MODIFIER_ATTRS = /* @__PURE__ */ new Set(["additional", "guest", "solo", "minor", "bonus"]);
  function relRoleLabels(relations) {
    const labels = /* @__PURE__ */ new Set();
    for (const r of relations || []) {
      if (!r.type) continue;
      const attrs = (Array.isArray(r.attributes) ? r.attributes : []).filter((a) => a && !MODIFIER_ATTRS.has(String(a).toLowerCase()));
      if ((r.type === "instrument" || r.type === "vocal") && attrs.length) {
        attrs.forEach((a) => labels.add(a));
      } else {
        labels.add(r.type);
      }
    }
    return [...labels].sort();
  }
  async function getSourceUrlsForRelease(mbid) {
    const url = `/ws/js/release/${mbid}?fmt=json&inc=rels`;
    let json = null;
    for (let attempt = 1; ; attempt++) {
      let res = null;
      try {
        res = await fetch(url, { headers: { Accept: "application/json" } });
      } catch (e) {
        if (attempt >= 4) throw e;
      }
      if (res && res.ok) {
        json = await res.json();
        if (attempt > 1) log.info(`Sources: MusicBrainz answered on attempt ${attempt}`);
        break;
      }
      if (res && res.status === 404) {
        log.warn(`Sources: MusicBrainz says this release does not exist (404)`);
        return {};
      }
      if (attempt >= 4) throw new Error(`MB /ws/js/release returned ${res ? res.status : "no response"} after ${attempt} attempts`);
      const wait = Number(res && res.headers.get("Retry-After")) * 1e3 || 400 * attempt + Math.floor(Math.random() * 300);
      log.warn(`Sources: MusicBrainz returned ${res ? res.status : "no response"} \u2014 retrying (${attempt}/3) in ${Math.round(wait)}ms`);
      await new Promise((r) => setTimeout(r, Math.min(wait, 8e3)));
    }
    {
      const rels = json.relationships || [];
      const urlRels = rels.filter((r) => r.target?.href_url);
      log.info(`Sources: MusicBrainz returned ${rels.length} relationship(s) for this release, ${urlRels.length} of them url(s)`);
      _lastLinkCount = urlRels.length;
      const abs = (u) => u && u.startsWith("//") ? "https:" + u : u;
      const href = (pred) => abs(rels.find(pred)?.target?.href_url || null);
      return {
        discogs: href((rel) => rel.target?.sidebar_name === "Discogs"),
        tidal: href((rel) => /(^|\/\/)(www\.|listen\.)?tidal\.com\/(browse\/)?album\/\d+/i.test(rel.target?.href_url || "")),
        qobuz: href((rel) => /(^|\/\/)(www\.|play\.|open\.)?qobuz\.com\/([a-z]{2}-[a-z]{2}\/)?album\//i.test(rel.target?.href_url || "")),
        deezer: href((rel) => /(^|\/\/)(www\.)?deezer\.com\/([a-z]{2}\/)?album\/\d+/i.test(rel.target?.href_url || "")),
        apple: href((rel) => /(^|\/\/)(?:music|itunes)\.apple\.com\/(?:[a-z]{2}\/)?album\/(?:[^/?#]+\/)?(?:id)?\d+/i.test(rel.target?.href_url || "")),
        // #435; iTunes URLs #436
        metalArchives: href((rel) => /(^|\/\/)(www\.)?metal-archives\.com\/albums\/[^/]+\/[^/]+\/\d+/i.test(rel.target?.href_url || "")),
        // #453
        ytmusic: href((rel) => /(^|\/\/)((music|www|m)\.)?youtube\.com\/(?:playlist\?(?:[^#]*&)?list=OLAK5uy_|browse\/MPREb_)/i.test(rel.target?.href_url || ""))
        // #648; www.youtube.com #679
      };
    }
  }
  var _lastLinkCount = 0;
  function logSourceProbe(sources, urlCount) {
    const found = Object.entries(sources || {}).filter(([, v]) => v);
    const n = urlCount == null ? _lastLinkCount : urlCount;
    log.info(`Sources: ${found.length} import source(s) from ${n} link(s)` + (found.length ? " \u2014 " + found.map(([k]) => k).join(", ") : " \u2014 none of the links is a supported source"));
    found.forEach(([k, v]) => logDebug(`  source ${k}: ${v}`));
  }
  function resolveLinkTypeId(name, type0, type1) {
    const lt = pageWindow.MB?.linkedEntities?.link_type;
    if (!lt) {
      log.error("MB.linkedEntities.link_type not available");
      return null;
    }
    const needle = name.toLowerCase().trim();
    const stripAttrs = (s) => (s || "").toLowerCase().replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
    const candidates = Object.values(lt).filter(
      (v) => v.type0 === type0 && v.type1 === type1 && !v.deprecated
    );
    for (const v of candidates) {
      if ((v.name || "").toLowerCase() === needle) return v.id;
    }
    for (const v of candidates) {
      if (stripAttrs(v.link_phrase) === needle) return v.id;
      if (stripAttrs(v.reverse_link_phrase) === needle) return v.id;
    }
    const contains = candidates.filter((v) => {
      const blobs = [v.name, stripAttrs(v.link_phrase), stripAttrs(v.reverse_link_phrase)].filter(Boolean);
      return blobs.some((b) => b.includes(needle) || needle.includes(b));
    });
    if (contains.length > 0) {
      contains.sort((a, b) => ((a.name || "").length || 999) - ((b.name || "").length || 999));
      const best = contains[0];
      if ((best.name || "").toLowerCase() !== needle) {
        log.info(`Fuzzy match: "${name}" \u2192 "${best.name}" (${type0}\u2192${type1})`);
      }
      return best.id;
    }
    const availableNames = candidates.map((v) => v.name).filter(Boolean).sort().join(", ");
    const allByName = Object.values(lt).filter(
      (v) => (v.name || "").toLowerCase() === needle || stripAttrs(v.link_phrase) === needle || stripAttrs(v.reverse_link_phrase) === needle
    );
    const deprecatedHit = allByName.find((v) => v.type0 === type0 && v.type1 === type1 && v.deprecated);
    const wrongPairHits = allByName.filter((v) => !(v.type0 === type0 && v.type1 === type1));
    if (deprecatedHit) {
      const altPairs = [...new Set(allByName.filter((v) => !v.deprecated).map((v) => `${v.type0}\u2192${v.type1}`))].join(", ");
      log.error(`"${name}" (${type0}\u2192${type1}) is deprecated by MB and would block the commit \u2014 skipping${altPairs ? `. Valid alternative(s): ${altPairs}` : ""}.`);
    } else if (wrongPairHits.length > 0) {
      const hitDesc = wrongPairHits.map((v) => `${v.name}(${v.type0}\u2192${v.type1})`).join(", ");
      log.warn(`No "${name}" link type for (${type0}\u2192${type1}) \u2014 exists for other entity pairs: ${hitDesc} \u2014 skipping`);
    } else {
      log.warn(`Unknown link type "${name}" (${type0}\u2192${type1}). Available for this pair: ${availableNames || "none"}`);
    }
    return null;
  }

  // src/storage.js
  var DB_NAME = "mblink";
  var DB_VERSION = 2;
  var STORE = "entity_cache";
  var db = null;
  var _request = indexedDB.open(DB_NAME, DB_VERSION);
  _request.onerror = function() {
    console.error("Why didn't you allow my web app to use IndexedDB?!");
  };
  _request.onsuccess = function(event) {
    db = event.target.result;
  };
  _request.onupgradeneeded = function(event) {
    const upgradeDb = event.target.result;
    if (!upgradeDb.objectStoreNames.contains(STORE)) {
      upgradeDb.createObjectStore(STORE, { keyPath: "discogs_id" });
    }
  };
  function mbUrlOf(entityType, mbid) {
    return `${MB}/${entityType}/${mbid}`;
  }
  function readIdbRecord(key) {
    return new Promise((resolve) => {
      if (!key || !db) return resolve(null);
      try {
        const tx = db.transaction([STORE], "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }
  function writeIdbRecord(key, partial) {
    return new Promise((resolve) => {
      if (!key || !db) return resolve(null);
      try {
        const tx = db.transaction([STORE], "readwrite");
        const store = tx.objectStore(STORE);
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          const existing = getReq.result || {};
          const merged = { ...existing, ...partial, discogs_id: key, resolvedAt: (/* @__PURE__ */ new Date()).toISOString() };
          if (merged.mbid && merged.entityType && !partial.mbUrl) {
            merged.mbUrl = mbUrlOf(merged.entityType, merged.mbid);
          }
          const putReq = store.put(merged);
          putReq.onsuccess = () => resolve(merged);
          putReq.onerror = () => resolve(null);
        };
        getReq.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }
  function deleteIdbRecord(key) {
    return new Promise((resolve) => {
      if (!key || !db) return resolve(false);
      try {
        const tx = db.transaction([STORE], "readwrite");
        const store = tx.objectStore(STORE);
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }

  // src/progress-bar.js
  var _pInterval = null;
  var _pPos = -40;
  function _showBar() {
    const row1 = document.querySelector(".discogs-bar-row1");
    const row2 = document.querySelector(".discogs-bar-row2");
    const r1h = row1 ? row1.getBoundingClientRect().height : 42;
    let pb = document.getElementById("discogs-pb");
    if (!pb) {
      pb = document.createElement("div");
      pb.id = "discogs-pb";
      pb.style.cssText = "position:fixed;left:0;right:0;height:5px;z-index:99999;background:var(--mbu-bg-sunken);overflow:hidden;";
      const fill = document.createElement("div");
      fill.id = "discogs-pb-fill";
      fill.style.cssText = "position:absolute;top:0;height:100%;width:40%;background:var(--mbu-warn);transition:width 0.2s linear;";
      pb.appendChild(fill);
      document.body.appendChild(pb);
    }
    pb.style.top = r1h + "px";
    pb.style.display = "block";
    if (row2) row2.style.marginTop = r1h + 5 + "px";
    _startMarquee();
  }
  function _startMarquee() {
    clearInterval(_pInterval);
    const fill = document.getElementById("discogs-pb-fill");
    if (fill) {
      fill.style.width = "40%";
      fill.style.left = _pPos + "%";
      fill.style.transition = "";
    }
    _pPos = -40;
    _pInterval = setInterval(() => {
      _pPos += 1.5;
      if (_pPos > 100) _pPos = -40;
      const f = document.getElementById("discogs-pb-fill");
      if (f) f.style.left = _pPos + "%";
    }, 16);
  }
  function _setProgressPct(pct) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    clearInterval(_pInterval);
    _pInterval = null;
    const pctEl = document.getElementById("discogs-progress-pct");
    if (pctEl) pctEl.textContent = Math.round(p) + "%";
    const fill = document.getElementById("discogs-pb-fill");
    if (!fill) return;
    fill.style.left = "0";
    fill.style.transition = "width 0.2s linear";
    fill.style.width = p + "%";
  }
  function _hideBar() {
    clearInterval(_pInterval);
    _pInterval = null;
    const pb = document.getElementById("discogs-pb");
    if (pb) pb.style.display = "none";
    const row2 = document.querySelector(".discogs-bar-row2");
    if (row2) row2.style.marginTop = "";
  }

  // src/api-discogs.js
  var DISCOGS_URL_RE = /^https?:\/\/(?:www|api)\.discogs\.com\/(?:(?:(?!sell).+|sell.+)\/)?(master|release|artist|label)s?\/(\d+)(?:[^?#]*)(?:\?noanv=1|\?anv=[^=]+)?$/i;
  function parseDiscogsUrl(url) {
    const m = DISCOGS_URL_RE.exec(url);
    if (!m) return null;
    const type = m[1];
    const id = m[2];
    return {
      type,
      id,
      key: `${type}/${id}`,
      cleanUrl: `https://www.discogs.com/${type}/${id}`
    };
  }
  var _releaseDataCache = /* @__PURE__ */ new Map();
  function stripCompanyNums(json) {
    for (const list of [json.companies, json.labels]) {
      if (!Array.isArray(list)) continue;
      for (const c of list) {
        if (c && typeof c.name === "string") c.name = c.name.replace(/\s+\(\d+\)$/, "");
      }
    }
    return json;
  }
  function getDiscogsReleaseData(url) {
    if (_releaseDataCache.has(url)) return Promise.resolve(_releaseDataCache.get(url));
    return fetch(
      `${url.replace(
        "https://www.discogs.com/release/",
        "https://api.discogs.com/releases/"
      )}?token=gYAnSAmIoXiHezHBmHoqcBCuJRyQLJBYSjurbGTZ`
    ).then((body) => body.json()).then((json) => {
      _releaseDataCache.set(url, stripCompanyNums(json));
      return json;
    });
  }
  var _entityDataCache = /* @__PURE__ */ new Map();
  function getDiscogsEntityData(resourceUrl) {
    if (!resourceUrl) return Promise.resolve(null);
    if (_entityDataCache.has(resourceUrl)) return Promise.resolve(_entityDataCache.get(resourceUrl));
    return fetch(`${resourceUrl}?token=gYAnSAmIoXiHezHBmHoqcBCuJRyQLJBYSjurbGTZ`).then((r) => r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error("HTTP " + r.status))).then((json) => {
      if (!json) {
        _entityDataCache.set(resourceUrl, null);
        return null;
      }
      const slim = {
        profile: json.profile || "",
        name: json.name || "",
        namevariations: json.namevariations || [],
        realname: json.realname || ""
      };
      _entityDataCache.set(resourceUrl, slim);
      return slim;
    }).catch(() => null);
  }

  // src/data/entity-map.js
  var ENTITY_TYPE_MAP = {
    // Places
    "Arranged At": {
      entityType: "place",
      linkType: "arranged at"
    },
    "Engineered At": {
      entityType: "place",
      linkType: "engineered at"
    },
    "Recorded At": {
      entityType: "place",
      linkType: "recorded at"
    },
    "Mixed At": {
      entityType: "place",
      linkType: "mixed at"
    },
    "Mastered At": {
      entityType: "place",
      linkType: "mastered at"
    },
    "Lacquer Cut At": {
      entityType: "place",
      linkType: "lacquer cut at"
    },
    "edited At": {
      entityType: "place",
      linkType: "edited at"
    },
    "Remixed At": {
      entityType: "place",
      linkType: "remixed at"
    },
    "Produced At": {
      entityType: "place",
      linkType: "produced at"
    },
    "Overdubbed At": null,
    "manufactured At": {
      entityType: "place",
      linkType: "manufactured at"
    },
    "Glass Mastered At": {
      entityType: "place",
      linkType: "glass mastered at"
    },
    "Pressed At": {
      entityType: "place",
      linkType: "pressed at"
    },
    "Designed At": null,
    "Filmed At": null,
    "Exclusive Retailer": null,
    // labels
    "Copyright (c)": {
      entityType: "label",
      linkType: "copyright"
    },
    "Phonographic Copyright (p)": {
      entityType: "label",
      linkType: "phonographic copyright"
    },
    "Copyright \xA9": {
      entityType: "label",
      linkType: "copyright"
    },
    "Phonographic Copyright \u2117": {
      entityType: "label",
      linkType: "phonographic copyright"
    },
    "Licensed From": {
      entityType: "label",
      linkType: "licensor"
    },
    "Licensed To": {
      entityType: "label",
      linkType: "licensee"
    },
    "Licensed Through": null,
    "Distributed By": {
      entityType: "label",
      linkType: "distributed"
    },
    "Made By": {
      entityType: "label",
      linkType: "manufactured"
    },
    "Manufactured By": {
      entityType: "label",
      linkType: "manufactured"
    },
    "Glass Mastered By": {
      entityType: "label",
      linkType: "glass mastered"
    },
    "Pressed By": {
      entityType: "label",
      linkType: "pressed"
    },
    "Marketed By": {
      entityType: "label",
      linkType: "marketed"
    },
    "Printed By": {
      entityType: "label",
      linkType: "printed"
    },
    "Promoted By": {
      entityType: "label",
      linkType: "promoted"
    },
    "Published By": {
      entityType: "label",
      linkType: "published"
    },
    "Rights Society": {
      entityType: "label",
      linkType: "rights society"
    },
    "Arranged For": {
      entityType: "label",
      linkType: "arranged for"
    },
    "Manufactured For": {
      entityType: "label",
      linkType: "manufactured for"
    },
    "Mixed For": {
      entityType: "label",
      linkType: "mixed for"
    },
    "Produced For": {
      entityType: "label",
      linkType: "produced for"
    },
    "Miscellaneous Support": {
      entityType: "label",
      linkType: "misc"
    },
    "Exported By": null,
    // Artists
    Performer: {
      entityType: "artist",
      linkType: "performer"
    },
    // Discogs "Ensemble" — a group/ensemble credited as performing (e.g. a
    // vocal quartet or jazz ensemble). MB has no dedicated "ensemble" link
    // type, so the conventional fit is the generic `performer` relationship
    // (same as Discogs "Performer"). Without this it fell through to the
    // INSTRUMENTS table (`Ensemble: null`) and was dropped as unmapped.
    Ensemble: {
      entityType: "artist",
      linkType: "performer"
    },
    // Discogs role "Accompanied By" → MB has no dedicated link type or
    // attribute for this. Closest semantic fit is `performer` with the
    // `additional` attribute (used elsewhere in MB for non-primary
    // contributions). Previously this fell through to the INSTRUMENTS map
    // and was dispatched as a bare `instrument` rel with the bogus
    // attribute value "accompanied by" — which MB silently drops, leaving
    // a junk instrument rel with no instrument named.
    "Accompanied By": {
      entityType: "artist",
      linkType: "performer",
      attributes: ["additional"]
    },
    Instruments: {
      entityType: "artist",
      linkType: "instrument"
    },
    Vocals: {
      entityType: "artist",
      linkType: "vocal"
    },
    // Discogs "Voice [Humming]" and the like: a vocal (it was dropped, unmapped)
    Voice: {
      entityType: "artist",
      linkType: "vocal"
    },
    "Backing Vocals": {
      entityType: "artist",
      linkType: "vocal",
      attributes: [{ _type: "vocal", value: "background vocals" }]
    },
    Choir: {
      entityType: "artist",
      linkType: "vocal",
      attributes: [{ _type: "vocal", value: "choir vocals" }]
    },
    Chorus: {
      entityType: "artist",
      linkType: "vocal",
      attributes: [{ _type: "vocal", value: "choir vocals" }]
    },
    "Choir Vocals": {
      entityType: "artist",
      linkType: "vocal",
      attributes: [{ _type: "vocal", value: "choir vocals" }]
    },
    "Lead Vocals": {
      entityType: "artist",
      linkType: "vocal",
      attributes: [{ _type: "vocal", value: "lead vocals" }]
    },
    // #427: voice-type vocals — MB carries each of these as a vocal attribute (verified
    // against the live link_attribute_type table). Hyphenated ones get both Discogs
    // casing variants, since the role lookup is exact-case.
    "Soprano Vocals": { entityType: "artist", linkType: "vocal", attributes: [{ _type: "vocal", value: "soprano vocals" }] },
    "Mezzo-soprano Vocals": { entityType: "artist", linkType: "vocal", attributes: [{ _type: "vocal", value: "mezzo-soprano vocals" }] },
    "Mezzo-Soprano Vocals": { entityType: "artist", linkType: "vocal", attributes: [{ _type: "vocal", value: "mezzo-soprano vocals" }] },
    "Alto Vocals": { entityType: "artist", linkType: "vocal", attributes: [{ _type: "vocal", value: "alto vocals" }] },
    "Contralto Vocals": { entityType: "artist", linkType: "vocal", attributes: [{ _type: "vocal", value: "contralto vocals" }] },
    "Countertenor Vocals": { entityType: "artist", linkType: "vocal", attributes: [{ _type: "vocal", value: "countertenor vocals" }] },
    "Tenor Vocals": { entityType: "artist", linkType: "vocal", attributes: [{ _type: "vocal", value: "tenor vocals" }] },
    "Baritone Vocals": { entityType: "artist", linkType: "vocal", attributes: [{ _type: "vocal", value: "baritone vocals" }] },
    "Bass-baritone Vocals": { entityType: "artist", linkType: "vocal", attributes: [{ _type: "vocal", value: "bass-baritone vocals" }] },
    "Bass-Baritone Vocals": { entityType: "artist", linkType: "vocal", attributes: [{ _type: "vocal", value: "bass-baritone vocals" }] },
    "Bass Vocals": { entityType: "artist", linkType: "vocal", attributes: [{ _type: "vocal", value: "bass vocals" }] },
    "Treble Vocals": { entityType: "artist", linkType: "vocal", attributes: [{ _type: "vocal", value: "treble vocals" }] },
    Orchestra: {
      entityType: "artist",
      linkType: "orchestra"
    },
    Conductor: {
      entityType: "artist",
      linkType: "conductor"
    },
    "Chorus Master": {
      entityType: "artist",
      linkType: "chorus master"
    },
    Concertmaster: {
      entityType: "artist",
      linkType: "concertmaster"
    },
    Concertmistress: {
      entityType: "artist",
      linkType: "concertmaster"
    },
    "Compiled By": {
      entityType: "artist",
      linkType: "compiler"
    },
    "DJ Mix": {
      entityType: "artist",
      linkType: "DJ-mixer"
    },
    Remix: {
      entityType: "artist",
      linkType: "remixer"
    },
    "contains samples by": {
      entityType: "artist",
      linkType: "contains samples by"
    },
    "Written-By": {
      entityType: "artist",
      linkType: "writer"
    },
    "Written By": {
      entityType: "artist",
      linkType: "writer"
    },
    "Composed By": {
      entityType: "artist",
      linkType: "composer"
    },
    // #233: author of the source text (e.g. the novel a Hörspiel adapts). MB
    // 'writer' is a work-level rel, so this lands on the work CH creates.
    Author: {
      entityType: "artist",
      linkType: "writer"
    },
    // #233: spoken-word performer (audio play / Hörspiel cast). MB convention is
    // the 'vocal' relationship with the 'spoken vocals' attribute; the character
    // in the Discogs bracket becomes the credited-as (handled in mappers.js).
    "Voice Actor": {
      entityType: "artist",
      linkType: "vocal",
      attributes: [{ _type: "vocal", value: "spoken vocals" }]
    },
    "Words By": {
      entityType: "artist",
      linkType: "lyricist"
    },
    "Lyrics By": {
      entityType: "artist",
      linkType: "lyricist"
    },
    "Libretto By": {
      entityType: "artist",
      linkType: "librettist"
    },
    "Translated By": {
      entityType: "artist",
      linkType: "translator"
    },
    "Arranged By": {
      entityType: "artist",
      linkType: "arranger"
    },
    "Instrumentation By": {
      entityType: "artist",
      linkType: "instruments arranger"
    },
    "Orchestrated By": {
      entityType: "artist",
      linkType: "orchestrator"
    },
    "vocals arranger": {
      entityType: "artist",
      linkType: "vocals arranger"
    },
    Producer: {
      entityType: "artist",
      linkType: "producer"
    },
    "Co-producer": {
      entityType: "artist",
      linkType: "producer",
      // MB has no `co` attribute. The convention for "Co-X" is `additional`
      // on the base role (issue #3). See also the matching remap in
      // `getArtistRoles` for the regex /Co /.
      attributes: ["additional"]
    },
    "Executive-Producer": {
      entityType: "artist",
      linkType: "producer",
      attributes: ["executive"]
    },
    "Post Production": {
      entityType: "artist",
      linkType: "producer"
    },
    Engineer: {
      entityType: "artist",
      linkType: "engineer"
    },
    "Audio Engineer": {
      entityType: "artist",
      linkType: "audio engineer"
    },
    "Mastered By": {
      entityType: "artist",
      linkType: "mastering"
    },
    "Remastered By": {
      entityType: "artist",
      linkType: "mastering",
      attributes: ["re"]
    },
    "Lacquer Cut By": {
      entityType: "artist",
      linkType: "lacquer cut"
    },
    "sound engineer": {
      entityType: "artist",
      linkType: "sound engineer"
    },
    "Mixed By": {
      entityType: "artist",
      linkType: "mix"
    },
    "Recorded By": {
      entityType: "artist",
      linkType: "recording"
    },
    "Recording Engineer": {
      entityType: "artist",
      linkType: "recording"
    },
    "Programmed By": {
      entityType: "artist",
      linkType: "programming"
    },
    Editor: {
      entityType: "artist",
      linkType: "editor"
    },
    "Edited By": {
      entityType: "artist",
      linkType: "editor"
    },
    "balance engineer": {
      entityType: "artist",
      linkType: "engineer"
    },
    "copyrighted by": {
      entityType: "artist",
      linkType: "copyright"
    },
    "phonographic copyright by": {
      entityType: "artist",
      linkType: "phonographic copyright"
    },
    Legal: {
      entityType: "artist",
      linkType: "legal representation"
    },
    Booking: {
      entityType: "artist",
      linkType: "booking"
    },
    "Art Direction": {
      entityType: "artist",
      linkType: "art direction"
    },
    Artwork: {
      entityType: "artist",
      linkType: "artwork"
    },
    "Artwork By": {
      entityType: "artist",
      linkType: "artwork"
    },
    Cover: {
      entityType: "artist",
      linkType: "artwork"
    },
    Design: {
      entityType: "artist",
      linkType: "design"
    },
    "Graphic Design": {
      entityType: "artist",
      linkType: "graphic design"
    },
    Illustration: {
      entityType: "artist",
      linkType: "illustration"
    },
    "Booklet Editor": {
      entityType: "artist",
      linkType: "booklet editor"
    },
    Photography: {
      entityType: "artist",
      linkType: "photography"
    },
    "Photography By": {
      entityType: "artist",
      linkType: "photography"
    },
    Technician: {
      entityType: "artist",
      // MB's link type is singular ("instrument technician"). The plural
      // form here missed the exact-name match in resolveLinkTypeId, so the
      // fuzzy contains-match collapsed "instruments technician" down to the
      // bare "instrument" performance link type — turning a piano tuner /
      // tech credit into an instrument performer. #155
      linkType: "instrument technician"
    },
    publisher: {
      entityType: "artist",
      linkType: "published"
    },
    "Liner Notes": {
      entityType: "artist",
      linkType: "liner notes"
    },
    "A&R": {
      entityType: "artist",
      linkType: "misc"
    },
    // #291: no dedicated MB rel — the generic "misc" relationship carries the
    // role name as its `task` attribute (mappers.js), so this lands as misc + task "research".
    Research: {
      entityType: "artist",
      linkType: "misc"
    },
    Advisor: {
      entityType: "artist",
      linkType: "misc"
    },
    "Concept By": {
      entityType: "artist",
      linkType: "misc"
    },
    Contractor: {
      entityType: "artist",
      linkType: "misc"
    },
    Coordinator: {
      entityType: "artist",
      linkType: "misc"
    },
    Management: {
      entityType: "artist",
      linkType: "misc"
    },
    "Musical Assistance": {
      entityType: "artist",
      linkType: "misc"
    },
    "Tour Manager": {
      entityType: "artist",
      linkType: "misc"
    },
    Other: {
      entityType: "artist",
      linkType: "misc"
    },
    "Public Relations": {
      entityType: "artist",
      linkType: "misc"
    },
    Promotion: {
      entityType: "artist",
      linkType: "misc"
    },
    Crew: {
      entityType: "artist",
      linkType: "misc"
    },
    "Supervised By": {
      entityType: "artist",
      linkType: "misc"
    },
    "Director Of Photography": {
      entityType: "artist",
      linkType: "photography",
      attributes: [{ _type: "task", value: "director of photography" }]
    }
  };

  // src/data/instruments.js
  var INSTRUMENTS = {
    Afox\u00E9: "afox\xE9",
    Agog\u00F4: "agog\xF4",
    Ashiko: "ashiko",
    Atabal: null,
    Bapang: "bhapang",
    "Clarinet": "clarinet",
    "Percussion": "percussion",
    "Congas": "congas",
    "Conga": "congas",
    "Conga Drum": "congas",
    "Bongos": "bongos",
    "Bongo": "bongos",
    "Tambourine": "tambourine",
    "Cuica": "cu\xEDca",
    "Guiro": "g\xFCiro",
    "G\xFCiro": "g\xFCiro",
    "Udu": "udu",
    "La\xFAd": "la\xFAd",
    "Laud": "la\xFAd",
    "Mbira": "mbira",
    "Kalimba": "mbira",
    "Slide Guitar": "slide guitar",
    "Acoustic Guitar": "acoustic guitar",
    "Double Bass": "double bass",
    "Goblet Drum": "goblet drum",
    "Darbouka": "darbuka",
    // #392 goblet drum (Discogs spelling; MB instrument is "darbuka")
    "Darbuka": "darbuka",
    "Maracas": "maracas",
    "Steel Drum": "steelpan",
    "Steelpan": "steelpan",
    "Electronics": "electronics",
    "Electronic": "electronics",
    "Synth Bass": "bass synthesizer",
    "Vocoder": "vocoder",
    "Xylophone": "xylophone",
    "Bells": "bells",
    "Chimes": "chimes",
    // #392 MB has no "wind chimes" instrument; the generic MB name is "chimes"
    "Glockenspiel": "glockenspiel",
    "Shakers": "shaker",
    "Shaker": "shaker",
    "Cowbell": "cowbell",
    "Claves": "claves",
    "Timbales": "timbales",
    "Baritone Guitar": "baritone guitar",
    "Synth": "synthesizer",
    "Synthesizer": "synthesizer",
    "Synths": "synthesizer",
    "Keyboards": "keyboard",
    "Keyboard": "keyboard",
    "Organ": "organ",
    "Harmonium": "harmonium",
    "Piano": "piano",
    "Electric Piano": "electric piano",
    "Harpsichord": "harpsichord",
    "Celesta": "celesta",
    "Strings": "string instruments",
    "Flute": "flute",
    "Saxophone": "saxophone",
    "Vibraphone": "vibraphone",
    "Trumpet": "trumpet",
    "Trombone": "trombone",
    "Violin": "violin",
    "Cello": "cello",
    "Viola": "viola",
    "Harp": "harp",
    "Banjo": "banjo",
    "Mandolin": "mandolin",
    "Ukulele": "ukulele",
    "Harmonica": "harmonica",
    "Accordion": "accordion",
    "Oboe": "oboe",
    "Bassoon": "bassoon",
    "Tuba": "tuba",
    "French Horn": "French horn",
    "Marimba": "marimba",
    "Melodica": "melodica",
    "Sitar": "sitar",
    "Oud": "oud",
    "Kora": "kora",
    "Tabla": "tabla",
    "Didgeridoo": "didgeridoo",
    "Theremin": "theremin",
    "Flugelhorn": "flugelhorn",
    "Cornet": "cornet",
    "Alto Saxophone": "alto saxophone",
    "Tenor Saxophone": "tenor saxophone",
    "Soprano Saxophone": "soprano saxophone",
    "Baritone Saxophone": "baritone saxophone",
    "Bass Clarinet": "bass clarinet",
    "Bass Flute": "bass flute",
    "Piccolo": "piccolo",
    "Bass Drum": "bass drum",
    Bata: "bat\xE1 drum",
    "Bell Tree": "bell tree",
    Bendir: "bendir",
    Bodhr\u00E1n: "bodhr\xE1n",
    "Body Percussion": "body percussion",
    Bombo: null,
    Bones: "bones",
    Buhay: null,
    Buk: "buk",
    Cabasa: "cabasa",
    Caixa: "caixa",
    "Caja Vallenata": null,
    Caj\u00F3n: "caj\xF3n",
    Calabash: "calabash",
    Castanets: "castanets",
    Caxixi: "caxixi",
    "Chak'chas": null,
    Chinch\u00EDn: null,
    Ching: "ching",
    Cymbal: "cymbal",
    Daf: "daf",
    Davul: "davul",
    Dhol: "dhol",
    Dholak: "dholak",
    Djembe: "djembe",
    Doira: null,
    Doli: null,
    Drum: "drum set",
    "Drum Programming": null,
    Drums: "drum set",
    Dunun: "dunun",
    "Electronic Drums": null,
    "Finger Cymbals": "finger cymbals",
    "Finger Snaps": "finger snaps",
    "Frame Drum": "frame drum",
    "Friction Drum": "friction drum",
    Frottoir: "frottoir",
    Ganz\u00E1: "ganz\xE1",
    Ghatam: "ghatam",
    Ghungroo: null,
    Gong: "gong",
    Guacharaca: null,
    Handbell: "handbell",
    Handclaps: "handclaps",
    "Hang Drum": "handpan",
    Hihat: "hi-hat",
    Hosho: null,
    Hyoshigi: "hyoshigi",
    Idiophone: "idiophone",
    Jaggo: null,
    Janggu: "janggu",
    Jing: "jing",
    "K'kwaengwari": null,
    Ka: null,
    "Kagura Suzu": null,
    Kanjira: "kanjira",
    Karkabas: null,
    Khartal: null,
    Khurdak: "duggi",
    Kynggari: null,
    Lagerphone: "monkey stick",
    "Lion's Roar": null,
    Madal: "madal",
    Mallets: null,
    "Monkey stick": "monkey stick",
    Mridangam: "mridangam",
    Pakhavaj: "pakhawaj",
    Pandeiro: null,
    Rainstick: "rainstick",
    Ratchet: "ratchet",
    Rattle: "shaken idiophone",
    "Reco-reco": "reco-reco",
    Repinique: "repinique",
    Rototoms: null,
    Scraper: null,
    Shakubyoshi: null,
    Shekere: "shekere",
    Shuitar: null,
    "Singing Bowls": null,
    Skratjie: null,
    Slapstick: "slapstick",
    "Slit Drum": "slit drum",
    Snare: null,
    Spoons: "spoons",
    "Stomp Box": null,
    Surdo: "surdo",
    Surigane: "atarigane",
    Taiko: "taiko",
    "Talking Drum": "talking drum",
    "Tam-tam": "chau gong",
    Tambora: null,
    Tamboril: "tabor",
    Tamborim: "tamborim",
    "Tan-Tan": null,
    "Tap Dance": "tap dance",
    "Tar (Drum)": null,
    "Temple Bells": null,
    "Temple Block": null,
    Thavil: "thavil",
    Timpani: "timpani",
    "Tom Tom": "tom-tom",
    Triangle: "triangle",
    T\u00FCng\u00FCr: null,
    Vibraslap: "vibraslap",
    Washboard: "washboard",
    Waterphone: "waterphone",
    "Wood Block": "wood block",
    Zabumba: "zabumba",
    Amadinda: "amadinda",
    Angklung: "angklung",
    Balafon: "balafon",
    Boomwhacker: "boomwhacker",
    Carillon: null,
    Crotales: "crotales",
    Guitaret: "guitaret",
    Lamellophone: "lamellaphone",
    Marimbula: "mar\xEDmbula",
    Metallophone: "metallophone",
    "Musical Box": "musical box",
    Prempensua: null,
    Slagbordun: null,
    "Steel Drums": "steelpan",
    "Thumb Piano": "mbira",
    Tubaphone: null,
    "Tubular Bells": "tubular bells",
    Tun: null,
    Txalaparta: "txalaparta",
    "Baby Grand Piano": null,
    Chamberlin: "chamberlin",
    Claviorgan: "claviorganum",
    "Concert Grand Piano": null,
    Dulcitone: "dulcitone",
    "Electric Harmonium": null,
    "Electric Harpsichord": null,
    "Electric Organ": "electronic organ",
    Fortepiano: null,
    "Grand Piano": "grand piano",
    Mellotron: "mellotron",
    Omnichord: "omnichord",
    "Ondes Martenot": "ondes martenot",
    "Parlour Grand Piano": null,
    Pedalboard: null,
    "Player Piano": null,
    Regal: "regal",
    Stylophone: null,
    "Tangent Piano": "tangent piano",
    "Toy Piano": "toy piano",
    "Upright Piano": "upright piano",
    Virginal: "virginal",
    "12-String Acoustic Guitar": null,
    "12-String Bass": null,
    "5-String Banjo": null,
    "6-String Banjo": null,
    "6-String Bass": null,
    "Acoustic Bass": "acoustic bass guitar",
    // #209 — Discogs separates this from "Double Bass", which maps to upright
    "Arco Bass": null,
    Arpa: null,
    Autoharp: "autoharp",
    Baglama: null,
    "Bajo Quinto": null,
    "Bajo Sexto": "bajo sexto",
    Balalaika: "balalaika",
    Bandola: null,
    Bandura: "bandura",
    Bandurria: "bandurria",
    Banhu: "banhu",
    Banjolin: "banjolin",
    "Baroque Guitar": "baroque guitar",
    Baryton: "baryton",
    "Bass Guitar": "bass guitar",
    Berimbau: "berimbau",
    Bhapang: "bhapang",
    Biwa: "biwa",
    "Blaster Beam": "blaster beam",
    Bolon: "bolon",
    Bouzouki: "bouzouki",
    "Bulbul Tarang": "bulbul tarang",
    Byzaanchi: null,
    Cavaquinho: "cavaquinho",
    "Cello Banjo": null,
    Changi: null,
    Chanzy: "chanzy",
    "Chapman Stick": "chapman stick",
    Charango: "charango",
    Chitarrone: null,
    Chonguri: null,
    Chuniri: null,
    Cimbalom: "cimbalom",
    Citole: "citole",
    Cittern: "cittern",
    Cl\u00E0rsach: null,
    "Classical Guitar": "classical guitar",
    Clavichord: "clavichord",
    Clavinet: "clavinet",
    Cobza: null,
    Contrabass: "double bass",
    Cuatro: "cuatro",
    C\u00FCmb\u00FC\u015F: "c\xFCmb\xFC\u015F",
    Cura: null,
    Deaejeng: null,
    "Diddley Bow": "diddley bow",
    Dilruba: "dilruba",
    Dobro: "resonator guitar",
    Dojo: null,
    Dombra: "dombra",
    Domra: "domra",
    Doshpuluur: "doshpuluur",
    Dulcimer: null,
    Dutar: "dutar",
    "\u0110\xE0n b\u1EA7u": "\u0111\xE0n b\u1EA7u",
    Ektare: null,
    "Electric Bass": "bass guitar",
    // MB's "bass guitar" IS the electric bass (was falling through to generic "instrument")
    "Electric Bass Guitar": "electric bass guitar",
    // MB's specific instrument (distinct from generic "bass guitar"); metal default, OP #453
    "Electric Guitar": "electric guitar",
    "Electric Upright Bass": "electric upright bass",
    "Electric Violin": "electric violin",
    "Epinette des Vosges": null,
    Erhu: "erhu",
    Esraj: "esraj",
    Fiddle: "fiddle",
    "Flamenco Guitar": "flamenco guitar",
    "Fretless Bass": "fretless bass",
    "Fretless Guitar": null,
    Gadulka: "gadulka",
    Gaohu: "gaohu",
    Gayageum: "gayageum",
    Geomungo: "geomungo",
    Giga: "\u0123\u012Bga",
    Gittern: "gittern",
    Gottuv\u00E2dyam: null,
    Guimbri: "gumbri",
    Guitalele: "guitalele",
    Guitar: "guitar",
    "Guitar Banjo": "banjitar",
    "Guitar Synthesizer": "guitar synthesizer",
    Guitarr\u00F3n: null,
    GuitarViol: null,
    Guqin: "guqin",
    Gusli: "gusli",
    Guzheng: "guzheng",
    Haegum: "haegeum",
    Halldorophone: null,
    Hardingfele: "hardingfele",
    "Harp Guitar": "harp guitar",
    Hummel: "hummel",
    Huqin: "huqin",
    "Hurdy Gurdy": "hurdy gurdy",
    Igil: "igil",
    Jarana: null,
    Jinghu: "jinghu",
    Jouhikko: "jouhikko",
    Kabosy: null,
    Kamancha: "kamancheh",
    Kankl\u0117s: "kankl\u0117s",
    Kantele: "kantele",
    Kanun: "kanun",
    Kemenche: "kemenche",
    Kirar: null,
    Kobyz: null,
    Kokyu: "kokyu",
    Koto: "koto",
    Krar: "krar",
    Langeleik: "langeleik",
    Laouto: "laouto",
    "Lap Steel Guitar": "lap steel guitar",
    Lavta: "lavta",
    "Lead Guitar": "guitar",
    // #209 — MB has no lead/rhythm-guitar instrument; both are just "guitar"
    Lira: null,
    "Lira da Braccio": "lira da braccio",
    Lirone: "lirone",
    Liuqin: "liuqin",
    Lute: "lute",
    Lyre: "lyre",
    Mandobass: null,
    Mandocello: "mandocello",
    Mandoguitar: "mandoguitar",
    Mandola: "mandola",
    "Mandolin Banjo": null,
    Mandolincello: null,
    Marxophone: "marxophone",
    Masinko: null,
    Monochord: null,
    Morinhoor: null,
    "Mountain Dulcimer": null,
    "Musical Bow": "musical bow",
    Ngoni: "ng\u0254ni",
    Nyckelharpa: "nyckelharpa",
    "Open-Back Banjo": null,
    Outi: "oud",
    Panduri: null,
    "Pedal Steel Guitar": "pedal steel guitar",
    "Piccolo Banjo": null,
    Pipa: "pipa",
    "Plectrum Banjo": null,
    "Portuguese Guitar": "portuguese guitar",
    Psalmodicon: null,
    Psaltery: "psaltery",
    Rabab: "rebab",
    Rabeca: "rebec",
    Rebab: "rebab",
    Rebec: "rebec",
    Reikin: null,
    "Requinto Guitar": null,
    "Resonator Banjo": null,
    "Resonator Guitar": "resonator guitar",
    "Rhythm Guitar": "guitar",
    // #209 — see Lead Guitar
    Ronroco: "ronroco",
    Ruan: "ruan",
    Sanshin: "sanshin",
    Santoor: "santoor",
    Sanxian: "sanxian",
    Sarangi: "sarangi",
    Sarod: "sarod",
    "Selmer-Maccaferri Guitar": null,
    "Semi-Acoustic Guitar": null,
    Seperewa: null,
    "Shahi Baaja": "bulbul tarang",
    Shamisen: "shamisen",
    Sintir: "gumbri",
    Spinet: "spinet",
    "Steel Guitar": "steel guitar",
    "Stroh Violin": "stroh violin",
    Strumstick: null,
    Surbahar: "surbahar",
    "Svara Mandala": null,
    Swarmandel: null,
    Sympitar: null,
    SynthAxe: null,
    Taish\u014Dgoto: "taishogoto",
    Talharpa: "talharpa",
    Tambura: "tambura",
    Tamburitza: null,
    Tapboard: null,
    "Tar (lute)": null,
    "Tenor Banjo": "tenor banjo",
    "Tenor Guitar": "tenor guitar",
    Theorbo: "theorbo",
    Timple: "tiple",
    Tiple: "tiple",
    Tipple: "tiple",
    Tonkori: "tonkori",
    Tres: "tres",
    "Tromba Marina": "tromba marina",
    "Twelve-String Guitar": null,
    Tzouras: "tzoura",
    "Ukulele Banjo": "banjo-ukulele",
    \u00DCt\u0151gardon: "\xFCt\u0151gardon",
    Valiha: "valiha",
    Veena: "saraswati veena",
    Vielle: "vielle",
    Vihuela: "vihuela",
    Viol: "viola da gamba",
    "Viola Caipira": "viola caipira",
    "Viola d'Amore": "viola d'amore",
    "Viola da Gamba": "viola da gamba",
    "Viola de Cocho": null,
    "Viola Kontra": null,
    "Viola Nordestina": null,
    "Violino Piccolo": "violino piccolo",
    Violoncello: "cello",
    Violone: "violone",
    "Washtub Bass": "washtub bass",
    Xalam: "xalam",
    "Yang T'Chin": "yangqin",
    Yanggeum: null,
    Zither: "zither",
    Zongora: null,
    Algoza: "algozey",
    Alphorn: "alphorn",
    "Alto Clarinet": "alto clarinet",
    "Alto Flute": "alto flute",
    "Alto Horn": null,
    "Alto Recorder": "treble recorder / alto recorder",
    Apito: null,
    Bagpipes: "bagpipe",
    Bandoneon: "bandone\xF3n",
    Bansuri: "bansuri",
    "Baritone Horn": "baritone horn",
    "Barrel Organ": "barrel organ",
    "Bass Harmonica": "bass harmonica",
    "Bass Saxophone": "bass saxophone",
    "Bass Trombone": "bass trombone",
    "Bass Trumpet": "bass trumpet",
    "Bass Tuba": null,
    "Basset Horn": "basset horn",
    Bawu: "bawu",
    Bayan: "bayan",
    Bellowphone: null,
    Beresta: null,
    "Blues Harp": "harmonica",
    "Bolivian Flute": null,
    Bombarde: "bombarde",
    Brass: "brass",
    "Brass Bass": null,
    Bucium: null,
    Bugle: null,
    Chalumeau: "chalumeau",
    Chanter: null,
    Charamel: null,
    Chirimia: "chirim\xEDa",
    Clarion: null,
    Claviola: "claviola",
    Comb: null,
    "Concert Flute": "concert flute",
    Concertina: null,
    Conch: "conch",
    "Contra-Alto Clarinet": null,
    "Contrabass Clarinet": "contrabass clarinet",
    "Contrabass Saxophone": "contrabass saxophone",
    Contrabassoon: "contrabassoon",
    "Cor Anglais": "cor anglais",
    Cornett: "cornett",
    Cromorne: "crumhorn",
    Crumhorn: "crumhorn",
    Daegeum: "daegeum",
    Danso: "danso",
    "Dili Tuiduk": null,
    Dizi: "dizi",
    Drone: null,
    Duduk: "duduk",
    Dulcian: "dulcian",
    Dulzaina: "dulzaina",
    "Electronic Valve Instrument": null,
    "Electronic Wind Instrument": "wind synthesizer",
    "English Horn": "cor anglais",
    Euphonium: "euphonium",
    Fife: "fife",
    Flageolet: "flageolet",
    Flugabone: null,
    Fluier: null,
    Flumpet: "flumpet",
    "Flute D'Amour": "fl\xFBte d'amour",
    Friscaletto: null,
    Fujara: "fujara",
    Galoubet: "three-hole pipe",
    Gemshorn: "gemshorn",
    Gudastviri: null,
    Harmet: null,
    Heckelphone: "heckelphone",
    Helicon: "helicon",
    Hichiriki: "hichiriki",
    "Highland Pipes": null,
    Horagai: null,
    Horn: "horn",
    Horns: null,
    Hotchiku: "hotchiku",
    "Hunting Horn": null,
    Jug: "jug",
    Kagurabue: "kagurabue",
    Kaval: "kaval",
    Kazoo: "kazoo",
    Khene: "khene",
    Kortholt: "kortholt",
    Launeddas: "launeddas",
    Limbe: "limbe",
    Liru: null,
    "Low Whistle": "low whistle",
    Lur: null,
    Lyricon: "lyricon",
    M\u00E4nkeri: null,
    Mellophone: "mellophone",
    Melodeon: null,
    Mey: null,
    Mizmar: null,
    Mizwad: "mezwed",
    Moce\u00F1o: null,
    "Mouth Organ": "mouth organ",
    Murli: null,
    Musette: null,
    Nadaswaram: "nadaswaram",
    Ney: "ney",
    "Northumbrian Pipes": "northumbrian pipes",
    "Nose Flute": "nose flute",
    "Oboe d'Amore": "oboe d'amore",
    "Oboe Da Caccia": "oboe da caccia",
    Ocarina: "ocarina",
    Ophicleide: "ophicleide",
    "Overtone Flute": null,
    Panpipes: "pan flute",
    "Piano Accordion": "piano accordion",
    "Piccolo Flute": null,
    "Piccolo Trumpet": "piccolo trumpet",
    Pipe: null,
    Piri: "piri",
    Pito: "three-hole pipe",
    Pixiephone: null,
    Quena: "quena",
    Quenacho: null,
    Quray: null,
    Rauschpfeife: "rauschpfeife",
    Recorder: "recorder",
    Reeds: "reeds",
    Rhaita: null,
    Rondador: "rondador",
    Rozhok: null,
    Ryuteki: "ryuteki",
    Sackbut: "sackbut",
    Salamuri: null,
    Sampona: "siku",
    Sarrusophone: "sarrusophone",
    Saxello: null,
    Saxhorn: null,
    Schwyzer\u00F6rgeli: "schwyzer\xF6rgeli",
    Serpent: "serpent",
    Shakuhachi: "shakuhachi",
    Shanai: "shehnai",
    Shawm: "shawm",
    Shenai: "shehnai",
    Sheng: "sheng",
    Shinobue: "shinobue",
    Sho: "sho",
    "Shruti Box": "shruti box",
    "Slide Whistle": "slide whistle",
    Smallpipes: null,
    Sodina: null,
    Sopilka: "sopilka",
    "Sopranino Saxophone": "sopranino saxophone",
    "Soprano Clarinet": "soprano clarinet",
    "Soprano Cornet": null,
    "Soprano Flute": "soprano flute",
    "Soprano Trombone": null,
    Souna: null,
    Sousaphone: "sousaphone",
    "Subcontrabass Saxophone": null,
    Suling: "suling",
    Suona: "suona",
    Taepyungso: null,
    T\u00E1rogat\u00F3: "taragot",
    "Tenor Horn": null,
    "Tenor Trombone": "tenor trombone",
    "Ti-tse": null,
    "Tin Whistle": "tin whistle",
    Tonette: "tonette",
    Txirula: "three-hole pipe",
    Txistu: "three-hole pipe",
    "Uilleann Pipes": "uilleann pipes",
    "Valve Trombone": "valve trombone",
    "Valve Trumpet": null,
    "Wagner Tuba": "wagner tuba",
    Whistle: "whistle",
    "Whistling Water Jar": "jug",
    Wind: null,
    Woodwind: "woodwind",
    Xiao: "xiao",
    Yorgaphone: null,
    Zhaleika: "zhaleika",
    Zukra: null,
    Zurna: "zurna",
    "Automatic Orchestra": null,
    Computer: null,
    "Drum Machine": "drum machine",
    "Rhythm Box": "drum machine",
    // #223 — Discogs "[Rhythm Box]" preset drum unit
    Effects: "effects",
    Groovebox: null,
    Loops: null,
    "MIDI Controller": null,
    Noises: null,
    Sampler: "sampler",
    Scratches: "turntable",
    Sequencer: null,
    "Software Instrument": null,
    Talkbox: "talkbox",
    // not a Discogs role; a bracket names it ("Soloist [Moog Solo]") and MB has it
    Moog: "Moog",
    Tannerin: null,
    Tape: "tape",
    Turntables: "turntable",
    // 'Accompanied By' deliberately NOT in INSTRUMENTS — it's a meta role,
    // not an instrument. Mapped in ENTITY_TYPE_MAP to performer + additional.
    "Audio Generator": null,
    "Backing Band": null,
    Band: null,
    // Discogs "Bass" is generic (could be bass guitar, double bass, …) but MB
    // has a generic "bass" instrument for exactly that case. Leaving it null
    // dispatched a bare instrument rel with no instrument → "Missing instrument"
    // on commit (#133). Map to MB's generic "bass".
    Bass: "bass",
    "Brass Band": null,
    Bullroarer: "bullroarer",
    "Concert Band": null,
    "E-Bow": "ebow",
    Ensemble: null,
    Gamelan: "gamelan",
    "Glass Harmonica": "glass harmonica",
    Guest: null,
    Homus: null,
    Instruments: null,
    "Jew's Harp": "mouth harp",
    Morchang: null,
    Musician: null,
    Orchestra: null,
    Performer: null,
    "Rhythm Section": null,
    Saw: null,
    Siren: null,
    Soloist: null,
    Sounds: null,
    Toy: null,
    Trautonium: "trautonium",
    "Wind Chimes": null,
    "Wobble Board": null
  };

  // ../../dev/match/artist-match.mjs
  var MBM_EXACT_LIMIT = 100;
  var MBM_SPECIAL_PURPOSE = [
    "125ec42a-7229-4250-afc5-e057484327fe",
    // [unknown]
    "f731ccc4-e22a-43af-a747-64213329e088",
    // [anonymous]
    "33cf029c-63b0-41a0-9855-be2a3665fb3b",
    // [data]
    "314e1c25-dde7-4e4d-b2f4-0a7b9f7c56dc",
    // [dialogue]
    "eec63d3c-3b81-4ad4-b1e4-7c147d4d2b61",
    // [no artist]
    "9be7f096-97ec-4615-8957-8d40b5dcbc41",
    // [traditional]
    "89ad4ac3-39f7-470e-963a-56509c546377",
    // Various Artists
    "7e84f845-ac16-41fe-9ff8-df12eb32af55",
    // MusicBrainz Test Artist
    "66ea0139-149f-4a0c-8fbf-5ea9ec4a6e49",
    // [Disney]
    "a0ef7e1d-44ff-4039-9435-7d5fefdeecc9",
    // [theatre]
    "90068d37-bae7-4292-be4a-704c145bd616",
    // [church chimes]
    "80a8851f-444c-4539-892b-ad2a49292aa9"
    // [language instruction]
  ];
  function mbmFold(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/[‐‑‒–—―−]/g, "-").toLowerCase().replace(/\s+/g, " ").trim();
  }
  function mbmFoldKeepCase(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/[‐‑‒–—―−]/g, "-").replace(/\s+/g, " ").trim();
  }
  function mbmSameName(a, b) {
    return mbmFold(a) === mbmFold(b) && mbmFold(a) !== "";
  }
  function mbmSameNameCase(a, b) {
    return mbmFoldKeepCase(a) === mbmFoldKeepCase(b) && mbmFoldKeepCase(a) !== "";
  }
  function mbmHolds(entity, name, caseExact) {
    if (!entity) return null;
    const same = caseExact ? mbmSameNameCase : mbmSameName;
    if (same(entity.name, name)) return "name";
    if ((entity.aliases || []).some((al) => same(al && (al.name != null ? al.name : al), name))) return "alias";
    return null;
  }
  function mbmIdentityQuery(name, field) {
    const q = String(name == null ? "" : name).replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
    return q ? 'alias:"' + q + '" OR ' + (field || "artist") + ':"' + q + '"' : "";
  }
  function mbmExactIdentity(json, name, opts) {
    const o = opts || {};
    if (!json || typeof json !== "object") return { status: "failed", exact: [] };
    const list = json.artists || json.labels || json.places || [];
    let exact = list.filter((e) => mbmHolds(e, name));
    if (exact.length > 1) {
      const caseExact = exact.filter((e) => mbmHolds(e, name, true));
      if (caseExact.length === 1) exact = caseExact;
      else if (o.scoreGap) {
        const scored = exact.filter((e) => typeof e.score === "number").sort((a, b) => b.score - a.score);
        if (scored.length >= 2 && scored[0].score - scored[1].score >= o.scoreGap) exact = [scored[0]];
      }
    }
    const offset = typeof json.offset === "number" ? json.offset : 0;
    const complete = typeof json.count === "number" && json.count <= offset + list.length;
    if (exact.length === 1 && complete) return { status: "unique", hit: exact[0], via: mbmHolds(exact[0], name) === "name" ? "name" : "alias", exact, complete };
    if (exact.length > 1) return { status: "ambiguous", exact, complete };
    if (!complete) return { status: "incomplete", exact, complete };
    return { status: "none", exact, complete };
  }
  function mbmRelatedArtists(artistJson) {
    if (!artistJson || !artistJson.id) return [];
    const out = [{ gid: artistJson.id, name: artistJson.name || "", aliases: (artistJson.aliases || []).map((a) => a && a.name).filter(Boolean), rel: "self" }];
    for (const r of artistJson.relations || []) {
      const a = r && r.artist;
      if (!a || !a.id || out.some((x) => x.gid === a.id)) continue;
      out.push({ gid: a.id, name: a.name || "", aliases: [], rel: r.type || "" });
    }
    return out;
  }
  function mbmContextHolders(related, name, candidates) {
    const cand = new Map((candidates || []).map((c) => [c.id || c.gid, c]));
    const out = [];
    for (const r of related || []) {
      let via = mbmSameName(r.name, name) ? "name" : (r.aliases || []).some((a) => mbmSameName(a, name)) ? "alias" : null;
      if (!via) {
        const c = cand.get(r.gid);
        if (c && mbmHolds(c, name)) via = mbmHolds(c, name);
      }
      if (via && !out.some((x) => x.gid === r.gid)) out.push({ gid: r.gid, name: r.name, via, rel: r.rel });
    }
    return out;
  }
  function mbmCoCreditHits(recordingsJson, ctxGid, name) {
    const out = [];
    for (const rec of recordingsJson && recordingsJson.recordings || []) {
      for (const c of rec["artist-credit"] || []) {
        const a = c && c.artist;
        if (!a || !a.id || a.id === ctxGid) continue;
        if ((mbmSameName(c.name, name) || mbmSameName(a.name, name)) && !out.some((x) => x.gid === a.id)) out.push({ gid: a.id, name: a.name });
      }
    }
    return out;
  }
  function mbmGuessSortName(name) {
    if (!name || !name.trim()) return name;
    name = name.trim().replace(/\s+/g, " ");
    if (/[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(name)) return name;
    const words = name.split(" ");
    if (words.length === 1) return name;
    const article = name.match(/^(the|a|an)\s+(.+)$/i);
    if (article) return article[2] + ", " + article[1].charAt(0).toUpperCase() + article[1].slice(1).toLowerCase();
    let base = name, suffix = "";
    const sfx = name.match(/^(.*?),?\s+(jr\.?|sr\.?|ii|iii|iv|v|esq\.?)$/i);
    if (sfx) {
      base = sfx[1].trim();
      suffix = " " + sfx[2];
    }
    const parts = base.split(" ");
    if (parts.length === 1) return name;
    return parts[parts.length - 1] + ", " + parts.slice(0, -1).join(" ") + suffix;
  }

  // src/mappers.js
  var INSTRUMENTS_CI = Object.fromEntries(
    Object.entries(INSTRUMENTS).map(([k, v]) => [k.toLowerCase(), v])
  );
  var BRACKET_REFINES = [
    [/^(electronic organ|organ)$/, /\b(b-?3|hammond)\b/i, "Hammond organ"],
    [/^electric piano$/, /\brhodes\b/i, "Rhodes piano"],
    [/^(guitar|acoustic guitar)$/, /\b(12|twelve)[- ]string\b/i, "12 string guitar"],
    [/^(guitar|acoustic guitar)$/, /\bnylon\b/i, "classical guitar"],
    [/^lute$/, /\b(tanpura|tambura)\b/i, "tambura"],
    [/^synthesizer$/, /\bmoog\b/i, "Moog"]
  ];
  var isBareInstrument = (r) => r.linkType === "instrument" && !(r.attributes || []).some((a) => a && a._type === "instrument");
  function flattenTracklist(tracklist) {
    if (!Array.isArray(tracklist)) return [];
    return tracklist.flatMap((t) => {
      if (t?.type_ === "index" && Array.isArray(t.sub_tracks)) {
        const parentExtra = Array.isArray(t.extraartists) ? t.extraartists : [];
        if (!parentExtra.length) return t.sub_tracks;
        return t.sub_tracks.map((st) => Object.assign({}, st, {
          extraartists: [...Array.isArray(st.extraartists) ? st.extraartists : [], ...parentExtra]
        }));
      }
      return [t];
    });
  }
  function getAllArtistTracks(tracklist, artistTracks) {
    tracklist = flattenTracklist(tracklist);
    return artistTracks.split(",").reduce((trackArray, trackNumber) => {
      if (/ to /.test(trackNumber)) {
        const parts = trackNumber.split(" to ");
        const startTrack = parts[0].trim().replace(".", "-");
        const lastTrack = parts[1].trim().replace(".", "-");
        let hasFoundStart = false, hasFoundEnd = false;
        tracklist.forEach((track) => {
          const resolvedTrackPosition = track.position.replace(".", "-");
          if (!hasFoundStart && resolvedTrackPosition === startTrack) {
            hasFoundStart = true;
            trackArray.push(track);
          } else if (hasFoundStart && !hasFoundEnd) {
            if (resolvedTrackPosition === lastTrack) {
              hasFoundEnd = true;
              trackArray.push(track);
            } else if (track.position === "") {
              hasFoundEnd = true;
            } else {
              trackArray.push(track);
            }
          }
        });
      } else {
        const track = tracklist.find((track2) => {
          return track2.position === trackNumber.trim();
        });
        if (track) {
          trackArray.push(track);
        }
      }
      return trackArray;
    }, []);
  }
  function convertPotentialDJMixers(json) {
    const all = flattenTracklist(json.tracklist || []).filter((t) => t.type_ === "track");
    const djmixers = (json.extraartists || []).filter((artist) => artist.role === "DJ Mix" && artist.tracks).map((artist) => {
      const covered = new Set(getAllArtistTracks(json.tracklist, artist.tracks).map((t) => t.position));
      if (!all.length || !all.every((t) => covered.has(t.position))) return null;
      json.extraartists = json.extraartists.filter((a) => a !== artist);
      return Object.assign({}, ENTITY_TYPE_MAP["DJ Mix"], { artist });
    }).filter((role) => role !== null);
    return djmixers;
  }
  function getArtistRoles(artist) {
    const roleStr = artist.role;
    const rawRoles = roleStr.split(",");
    if (/\([0-9]+\)/.test(artist.anv)) {
      artist.anv = artist.anv.replace(/\([0-9]+\)/, "").trim();
    }
    if (/\([0-9]+\)/.test(artist.name)) {
      artist.name = artist.name.replace(/\([0-9]+\)/, "").trim();
    }
    return rawRoles.map((role) => {
      let additionalAttributes = [];
      let creditedAs = null;
      let rolePart = role.trim().split("[");
      const actualRole = rolePart[0].trim();
      if (/Recording Engineer/.test(rolePart[1]) && actualRole === "Engineer") {
        return Object.assign({}, ENTITY_TYPE_MAP["Recording Engineer"], {
          artist
        });
      }
      if (/Mastering Engineer/.test(rolePart[1]) && actualRole === "Engineer") {
        return Object.assign({}, ENTITY_TYPE_MAP["Mastered By"], {
          artist
        });
      }
      if (/Cover Design/.test(rolePart[1]) && actualRole === "Artwork") {
        return Object.assign({}, ENTITY_TYPE_MAP["Design"], {
          artist
        });
      }
      if (/Design/.test(rolePart[1]) && actualRole === "Cover") {
        return Object.assign({}, ENTITY_TYPE_MAP["Design"], {
          artist
        });
      }
      if (/Art/.test(rolePart[1]) && actualRole === "Cover") {
        return Object.assign({}, ENTITY_TYPE_MAP["Artwork"], {
          artist
        });
      }
      if (/Additional/.test(rolePart[1])) {
        additionalAttributes.push("additional");
      }
      if (/Assistant/.test(rolePart[1])) {
        additionalAttributes.push("assistant");
      }
      if (/Co /.test(rolePart[1])) {
        additionalAttributes.push("additional");
      }
      if (/Executive/.test(rolePart[1])) {
        additionalAttributes.push("executive");
      }
      if (/Associate/.test(rolePart[1])) {
        additionalAttributes.push("associate");
      }
      if (/Guest/.test(rolePart[1])) {
        additionalAttributes.push("guest");
      }
      if (/Solo/.test(rolePart[1])) {
        additionalAttributes.push("solo");
      }
      const mapping = ENTITY_TYPE_MAP[actualRole];
      if (mapping && mapping.linkType == "misc") {
        const taskValue = rolePart[1] ? rolePart[1].replace("]", "").trim().toLowerCase() : actualRole.trim().toLowerCase();
        additionalAttributes.push({ _type: "task", value: taskValue });
      }
      if (mapping && mapping.linkType == "engineer" && rolePart[1]) {
        additionalAttributes.push({ _type: "task", value: rolePart[1].replace("]", "").trim().toLowerCase() });
      }
      if (mapping && mapping.linkType == "mix" && rolePart[1]) {
        additionalAttributes.push({ _type: "task", value: rolePart[1].replace("]", "").trim().toLowerCase() });
      }
      if (mapping && mapping.linkType == "photography" && rolePart[1]) {
        additionalAttributes.push({ _type: "task", value: rolePart[1].replace("]", "").trim().toLowerCase() });
      }
      if (mapping && mapping.linkType == "artwork" && rolePart[1]) {
        additionalAttributes.push({ _type: "task", value: rolePart[1].replace("]", "").trim().toLowerCase() });
      }
      if (mapping && mapping.linkType == "vocal" && rolePart[1]) {
        creditedAs = rolePart[1].replace(/]/g, "").trim() || null;
      }
      const actualRoleLc = actualRole.toLowerCase();
      if (!mapping && Object.prototype.hasOwnProperty.call(INSTRUMENTS_CI, actualRoleLc)) {
        let instrumentName = INSTRUMENTS_CI[actualRoleLc];
        let role2 = ENTITY_TYPE_MAP.Instruments;
        if (actualRoleLc === "drum programming") {
          role2 = ENTITY_TYPE_MAP["Programmed By"];
          instrumentName = INSTRUMENTS_CI["drum machine"];
        }
        const bracket = rolePart[1] ? rolePart[1].replace(/]/g, "").trim() : "";
        if (instrumentName && bracket) {
          const ref = BRACKET_REFINES.find(([base, re]) => base.test(instrumentName.toLowerCase()) && re.test(bracket));
          if (ref) instrumentName = ref[2];
        }
        if (!instrumentName && bracket) {
          const noSolo = bracket.replace(/\s*\bsolos?\b\s*/ig, " ").trim();
          for (const candidate of [bracket, bracket.split(",")[0].trim(), noSolo]) {
            const lc = candidate.toLowerCase();
            if (lc && Object.prototype.hasOwnProperty.call(INSTRUMENTS_CI, lc) && INSTRUMENTS_CI[lc]) {
              instrumentName = INSTRUMENTS_CI[lc];
              break;
            }
          }
        }
        const extra = additionalAttributes.filter((a) => a === "solo" || a === "guest" || a === "additional");
        return Object.assign({}, role2, {
          artist,
          attributes: (instrumentName ? [{ _type: "instrument", value: instrumentName.toLowerCase() }] : []).concat(extra)
        });
      }
      if (!mapping) {
        return null;
      }
      if (Array.isArray(mapping.attributes)) {
        let mapped = mapping.attributes;
        if (creditedAs && mapping.linkType === "vocal") {
          mapped = mapped.map((a) => a && a._type === "vocal" ? Object.assign({}, a, { creditedAs }) : a);
        }
        additionalAttributes = additionalAttributes.concat(mapped);
      }
      return Object.assign({}, mapping, {
        artist,
        attributes: additionalAttributes
      });
    }).filter((resolvedRole) => {
      return !!resolvedRole;
    }).filter((r, i, all) => !isBareInstrument(r) || !all.some((o) => o.linkType === "vocal" || o.linkType === "instrument" && !isBareInstrument(o)));
  }
  var ARTWORK_LINK_TYPES = /* @__PURE__ */ new Set(["artwork", "design", "photography", "illustration", "graphic design"]);
  function hoistFullSpanArtworkRels(artistRoles, tracklistRels, tracklist) {
    const allPos = new Set((tracklist || []).map((t) => String(t && t.position != null ? t.position : "")).filter(Boolean));
    if (!allPos.size) return { artistRoles, tracklistRels, hoisted: [] };
    const keyOf = (r) => [
      r.artist && (r.artist.resource_url || r.artist.name) || "",
      r.linkType,
      JSON.stringify((r.attributes || []).map((a) => a && typeof a === "object" && a._type ? a._type + ":" + a.value : String(a)).sort())
    ].join("|");
    const groups = /* @__PURE__ */ new Map();
    for (const r of tracklistRels) {
      if (!ARTWORK_LINK_TYPES.has(r.linkType) || !r.artist) continue;
      const k = keyOf(r);
      if (!groups.has(k)) groups.set(k, { rels: [], pos: /* @__PURE__ */ new Set() });
      const g = groups.get(k);
      g.rels.push(r);
      if (r.track && r.track.position != null) g.pos.add(String(r.track.position));
    }
    const drop = /* @__PURE__ */ new Set(), hoisted = [];
    for (const g of groups.values()) {
      if (g.pos.size !== allPos.size || ![...allPos].every((p) => g.pos.has(p))) continue;
      g.rels.forEach((r) => drop.add(r));
      const rel = Object.assign({}, g.rels[0]);
      delete rel.track;
      hoisted.push(rel);
    }
    if (!hoisted.length) return { artistRoles, tracklistRels, hoisted };
    return { artistRoles: artistRoles.concat(hoisted), tracklistRels: tracklistRels.filter((r) => !drop.has(r)), hoisted };
  }
  function rolesFromDiscogsArtists(artists) {
    return artists?.reduce((rolesArr, artist) => {
      const roles = getArtistRoles(artist);
      if (Array.isArray(roles) && roles.length > 0) {
        return rolesArr.concat(roles);
      }
      return rolesArr;
    }, []) || [];
  }

  // src/sources/split-names.js
  function splitCombinedNames(name) {
    if (!name || !/[,&]/.test(name)) return [name];
    const parts = name.split(/\s*,\s*|\s*&\s*/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2 || !parts.every((p) => /\s/.test(p))) return [name];
    return parts;
  }

  // src/util.js
  function assignVolumePositions(items, getNum) {
    const nums = items.map((it) => String(getNum(it) || "").trim());
    const multiVolume = nums.some((n, i) => n && nums.indexOf(n) < i);
    let vol = 1;
    const seenInVol = /* @__PURE__ */ new Set();
    const positions = nums.map((num) => {
      if (multiVolume && num && seenInVol.has(num)) {
        vol++;
        seenInVol.clear();
      }
      if (num) seenInVol.add(num);
      return multiVolume ? `${vol}-${num}` : num;
    });
    return { positions, multiVolume };
  }
  function noPasswordManagers(el) {
    if (!el) return el;
    el.autocomplete = "off";
    el.setAttribute("data-lpignore", "true");
    el.setAttribute("data-1p-ignore", "true");
    el.setAttribute("data-bwignore", "true");
    el.setAttribute("data-form-type", "other");
    if (el.tagName === "INPUT" && (!el.type || el.type === "text")) el.type = "search";
    el.classList.add("ch-nopw");
    return el;
  }
  function hashKey(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  // src/sources/tidal.js
  var TIDAL_PERTRACK_BRIDGE = {
    "Vocal": "Vocals",
    "Background Vocal": "Backing Vocals",
    "Performance Arranger": "Arranged By"
  };
  var TIDAL_PERTRACK_SKIP = /* @__PURE__ */ new Set(["Mastering Engineer", "Associated Performer", "Studio Personnel"]);
  var TIDAL_ROLE_MAP = {
    "Producer": { target: "recording", rel: "producer" },
    "Remixer": { target: "recording", rel: "remixer" },
    // #257 artist→recording remixer (was unrecognized → dropped)
    "Mixing Engineer": { target: "recording", rel: "mix" },
    "Recording Engineer": { target: "recording", rel: "recording" },
    "Sound Engineer": { target: "recording", rel: "sound engineer" },
    "Lead Vocalist": { target: "recording", rel: "vocal", attributes: [{ _type: "vocal", value: "lead vocals" }] },
    // #257
    // #266 Tidal's per-track background-vocal roles → recording vocal[background vocals]
    // (same MB attribute as the release-level "Backing Vocals", see entity-map.js).
    "Group Background Vocalists": { target: "recording", rel: "vocal", attributes: [{ _type: "vocal", value: "background vocals" }] },
    "Background Vocalist": { target: "recording", rel: "vocal", attributes: [{ _type: "vocal", value: "background vocals" }] },
    "Background Vocalists": { target: "recording", rel: "vocal", attributes: [{ _type: "vocal", value: "background vocals" }] },
    "Composer": { target: "work", rel: "composer" },
    "Lyricist": { target: "work", rel: "lyricist" },
    "Writer": { target: "work", rel: "writer" },
    "Orchestrator": { target: "work", rel: "orchestrator" },
    "Music Publisher": { target: "work", rel: "publisher" },
    "Publisher": { target: "work", rel: "publisher" }
    // Not mapped (reported, not imported): Mastering Engineer (artist→recording mastering
    // is deprecated in MB — it's release-level), Sound Editor, the Assistant * Engineer
    // variants (need an MB "assistant" attribute), and Studio Personnel (too generic).
  };
  var TIDAL_COPYRIGHT_CONTROL_ID = "15780";
  var isCopyrightControl = (n) => n?.tidalId === TIDAL_COPYRIGHT_CONTROL_ID || /^copyright control$/i.test(n?.name || "");
  var TIDAL_RELEASE_ROLE_MAP = {
    "Mixing": "Mixed By",
    "Mixing Engineer": "Mixed By",
    "Recording": "Recorded By",
    "Recording Engineer": "Recorded By",
    "Sound Engineer": "sound engineer",
    "Mastering": "Mastered By",
    "Mastering Engineer": "Mastered By",
    "Vocals (Background)": "Backing Vocals",
    "Background Vocals": "Backing Vocals",
    "Composer": "Composed By",
    "Lyricist": "Lyrics By",
    "Writer": "Written-By",
    "Orchestrator": "Orchestrated By",
    // #325 instrument-name variants Tidal uses that the INSTRUMENTS table doesn't
    // match verbatim (plurals / qualified forms) → canonical Discogs instrument names.
    "Guitars": "Guitar",
    "Bass Instrument": "Bass",
    "Bass Guitars": "Bass Guitar",
    "Sax (Alto)": "Alto Saxophone",
    "Sax (Tenor)": "Tenor Saxophone",
    "Sax (Baritone)": "Baritone Saxophone",
    "Sax (Soprano)": "Soprano Saxophone",
    "Keyboard": "Keyboards"
  };
  var TIDAL_RELEASE_COMPANY_MAP = {
    "Current Distributor": "Distributed By",
    "Distributor": "Distributed By"
  };
  var TIDAL_RELEASE_ROLE_SKIP = /* @__PURE__ */ new Set([
    "Primary Artist",
    "Featured Artist",
    "Main Artist",
    "Artist",
    "Record Label",
    "Manufacturer",
    "Copyright",
    "Phonographic Copyright"
  ]);
  var TIDAL_ALBUM_RE = /^(?:https?:)?\/\/(?:www\.|listen\.)?tidal\.com\/(?:browse\/)?album\/(\d+)/i;
  function parseTidalAlbumUrl(url) {
    const m = TIDAL_ALBUM_RE.exec(url || "");
    if (!m) return null;
    return { id: m[1], creditsUrl: `https://tidal.com/album/${m[1]}/credits` };
  }
  function extractTidalCreditsDom(doc) {
    const out = [];
    for (const item of doc.querySelectorAll('[data-test="album-info-item"]')) {
      const num = item.querySelector('[class*="_trackNumber"]')?.textContent?.trim() || "";
      const titleEl = item.querySelector('[class*="_title_"]');
      const credits = [];
      for (const cell of item.querySelectorAll('[class*="_creditsCell"]')) {
        const role = cell.querySelector("[data-uppercase]")?.textContent?.trim();
        if (!role) continue;
        const names = [...cell.querySelectorAll('[data-test="grid-item-detail-text-title-artist"]')].map((el) => ({
          name: el.getAttribute("title") || el.textContent.trim(),
          tidalId: (el.getAttribute("href") || "").match(/\/artist\/(\d+)/)?.[1] || null
        })).filter((n) => n.name);
        credits.push({ role, names });
      }
      out.push({
        num,
        title: titleEl?.getAttribute("title") || titleEl?.textContent?.trim() || "",
        tidalTrackId: titleEl?.getAttribute("data-test-id") || null,
        credits
      });
    }
    return out;
  }
  function extractTidalReleaseCreditsDom(doc) {
    const out = [];
    for (const cell of doc.querySelectorAll('[class*="_creditsCell"]')) {
      if (cell.closest('[data-test="album-info-item"]')) continue;
      const role = cell.querySelector("[data-uppercase]")?.textContent?.trim();
      if (!role) continue;
      const names = [];
      const seen = /* @__PURE__ */ new Set();
      const textBox = cell.querySelector('[class*="_creditsCellText"]') || cell;
      for (const el of textBox.querySelectorAll("a, [title]")) {
        const name = (el.getAttribute("title") || el.textContent || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push({ name, tidalId: (el.getAttribute("href") || "").match(/\/artist\/(\d+)/)?.[1] || null });
      }
      if (!names.length) {
        (textBox.textContent || "").split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean).forEach((name) => {
          if (!seen.has(name)) {
            seen.add(name);
            names.push({ name, tidalId: null });
          }
        });
      }
      if (names.length) out.push({ role, names });
    }
    return out;
  }
  var ASSISTANT_RE = /^Assistant\s+(.+)$/i;
  function tidalRoleBase(role) {
    const m = ASSISTANT_RE.exec(role || "");
    return m ? m[1] : role;
  }
  function filterTidalCredits(tracks) {
    return tracks.map((t) => ({
      ...t,
      credits: t.credits.map((c) => ({
        ...c,
        names: c.names.filter((n) => !(/^(?:Music )?Publisher$/.test(c.role) && isCopyrightControl(n)))
      })).filter((c) => c.names.length)
    }));
  }
  var TIDAL_ARTIST_RE = /^(?:https?:)?\/\/(?:www\.|listen\.)?tidal\.com\/(?:browse\/)?artist\/(\d+)/i;
  function parseTidalArtistUrl(url) {
    const m = TIDAL_ARTIST_RE.exec(url || "");
    if (!m) return null;
    return { id: m[1], key: `tidal-artist/${m[1]}`, cleanUrl: `https://tidal.com/artist/${m[1]}` };
  }
  function tidalPublisherRole(name, track) {
    const role = {
      linkType: "publishing",
      entityType: "label",
      attributes: [],
      artist: { name, anv: "", entityType: "label", resource_url: "https://tidal.com/_publisher/" + encodeURIComponent(name) }
    };
    if (track) role.track = track;
    return role;
  }
  function tidalCompany(name, entityTypeName) {
    return {
      entity_type_name: entityTypeName,
      name,
      resource_url: "https://tidal.com/_company/" + encodeURIComponent(entityTypeName) + "/" + encodeURIComponent(name)
    };
  }
  function tidalToEngine(tracks) {
    const tracklistRels = [];
    const tracklist = [];
    const skipped = [];
    const filtered = filterTidalCredits(tracks);
    const { positions, multiVolume } = assignVolumePositions(filtered, (t) => t.num);
    filtered.forEach((t, i) => {
      const track = { position: positions[i], title: t.title || "", type_: "track" };
      tracklist.push(track);
      for (const c of t.credits) {
        const base = tidalRoleBase(c.role);
        const assistant = base !== c.role;
        if (base === "Music Publisher" || base === "Publisher") {
          for (const n of c.names) {
            if (isCopyrightControl(n)) continue;
            tracklistRels.push(tidalPublisherRole(n.name, track));
          }
          continue;
        }
        const names = c.names.flatMap((n) => {
          const parts = splitCombinedNames(n.name);
          return parts.length > 1 ? parts.map((nm) => ({ name: nm, tidalId: null })) : [n];
        });
        const mapping = TIDAL_ROLE_MAP[base];
        if (mapping) {
          for (const n of names) {
            tracklistRels.push({
              linkType: mapping.rel,
              entityType: "artist",
              attributes: [...mapping.attributes || [], ...assistant ? ["assistant"] : []],
              artist: {
                id: n.tidalId ? `tidal-${n.tidalId}` : void 0,
                name: n.name,
                anv: "",
                resource_url: n.tidalId ? `https://tidal.com/artist/${n.tidalId}` : ""
              },
              track
            });
          }
          continue;
        }
        if (TIDAL_PERTRACK_SKIP.has(base)) {
          for (const n of names) skipped.push(`track ${track.position} "${t.title}": ${c.role} \u2014 ${n.name}`);
          continue;
        }
        const discogsRole = TIDAL_PERTRACK_BRIDGE[base] || base;
        for (const n of names) {
          const artist = {
            id: n.tidalId ? `tidal-${n.tidalId}` : void 0,
            name: n.name,
            anv: "",
            role: discogsRole,
            resource_url: n.tidalId ? `https://tidal.com/artist/${n.tidalId}` : ""
          };
          const rels = getArtistRoles(artist);
          if (!rels.length) {
            skipped.push(`track ${track.position} "${t.title}": ${c.role} \u2014 ${n.name}`);
            continue;
          }
          for (const r of rels) {
            tracklistRels.push({
              linkType: r.linkType,
              entityType: "artist",
              attributes: [...r.attributes || [], ...assistant ? ["assistant"] : []],
              artist: r.artist,
              track
            });
          }
        }
      }
    });
    return { tracklistRels, tracklist, skipped, multiVolume };
  }
  function tidalReleaseArtists(releaseCredits) {
    const artists = [];
    const publishers = [];
    const companies = [];
    const skipped = [];
    for (const c of releaseCredits || []) {
      const baseRole = tidalRoleBase(c.role);
      if (baseRole === "Music Publisher" || baseRole === "Publisher") {
        for (const n of c.names || []) {
          if (isCopyrightControl(n)) continue;
          publishers.push(tidalPublisherRole(n.name));
        }
        continue;
      }
      if (TIDAL_RELEASE_COMPANY_MAP[c.role]) {
        for (const n of c.names || []) companies.push(tidalCompany(n.name, TIDAL_RELEASE_COMPANY_MAP[c.role]));
        continue;
      }
      if (TIDAL_RELEASE_ROLE_SKIP.has(c.role)) {
        (c.names || []).forEach((n) => skipped.push(`release: ${c.role} \u2014 ${n.name}`));
        continue;
      }
      const base = tidalRoleBase(c.role);
      const assistant = base !== c.role;
      const discogsRole = TIDAL_RELEASE_ROLE_MAP[base] || base;
      const relNames = (c.names || []).flatMap((n) => {
        const parts = splitCombinedNames(n.name);
        return parts.length > 1 ? parts.map((nm) => ({ name: nm, tidalId: null })) : [n];
      });
      for (const n of relNames) {
        artists.push({
          id: n.tidalId ? `tidal-${n.tidalId}` : void 0,
          name: n.name,
          anv: "",
          role: discogsRole,
          assistant,
          tidalRole: c.role,
          // for "not imported" reporting at the call site
          resource_url: n.tidalId ? `https://tidal.com/artist/${n.tidalId}` : ""
        });
      }
    }
    return { artists, publishers, companies, skipped };
  }
  var HARVEST_KEY = (reqId) => `ch-tidal-result:${reqId}`;
  var HARVEST_TIMEOUT_MS = 45e3;
  function runTidalHarvestPage() {
    const m = location.hash.match(/ch-req=([a-z0-9.-]+)/i);
    if (!m) return;
    const reqId = m[1];
    const albumId = (location.pathname.match(/\/album\/(\d+)/) || [])[1] || null;
    const post = (payload) => {
      try {
        GM_setValue(HARVEST_KEY(reqId), { albumId, ts: Date.now(), ...payload });
      } catch (e) {
      }
    };
    const started = Date.now();
    let lastCount = -1, stableSince = 0;
    const timer = setInterval(() => {
      const items = document.querySelectorAll('[data-test="album-info-item"]');
      if (items.length > 0) {
        if (items.length !== lastCount) {
          lastCount = items.length;
          stableSince = Date.now();
        } else if (Date.now() - stableSince > 1200) {
          clearInterval(timer);
          const tracks = extractTidalCreditsDom(document);
          harvestReleaseThenPost(tracks, post);
          return;
        }
      }
      if (Date.now() - started > HARVEST_TIMEOUT_MS - 5e3) {
        clearInterval(timer);
        post({ ok: false, error: lastCount > 0 ? "render never stabilised" : "credits never rendered (login wall? geo block?)" });
        setTimeout(() => window.close(), 250);
      }
    }, 300);
  }
  function harvestReleaseThenPost(tracks, post) {
    const finish = (releaseCredits) => {
      post({ ok: true, tracks, releaseCredits });
      setTimeout(() => window.close(), 250);
    };
    const infoTab = document.querySelector('[data-test="album-info-tab-info"]');
    if (!infoTab) {
      finish([]);
      return;
    }
    try {
      infoTab.click();
    } catch (e) {
      finish([]);
      return;
    }
    const start = Date.now();
    const t = setInterval(() => {
      const cells = [...document.querySelectorAll('[class*="_creditsCell"]')].filter((c) => !c.closest('[data-test="album-info-item"]'));
      if (cells.length > 0) {
        clearInterval(t);
        setTimeout(() => finish(extractTidalReleaseCreditsDom(document)), 600);
      } else if (Date.now() - start > 6e3) {
        clearInterval(t);
        finish([]);
      }
    }, 250);
  }
  function harvestTidalAlbum(albumUrl) {
    const parsed = parseTidalAlbumUrl(albumUrl);
    if (!parsed) return Promise.reject(new Error(`Not a Tidal album URL: ${albumUrl}`));
    const reqId = `${parsed.id}.${Date.now().toString(36)}`;
    const key = HARVEST_KEY(reqId);
    const harvestUrl = `${parsed.creditsUrl}#ch-req=${reqId}`;
    if (typeof GM_openInTab === "function") {
      GM_openInTab(harvestUrl, { active: false, insert: true, setParent: true });
    } else {
      const tab = window.open(harvestUrl, "_blank");
      if (!tab) return Promise.reject(new Error("Popup blocked \u2014 allow popups for musicbrainz.org and retry"));
    }
    return new Promise((resolve, reject) => {
      let listenerId = null;
      let pollTimer = null;
      const done = (fn, arg) => {
        if (pollTimer) clearInterval(pollTimer);
        clearTimeout(deadline);
        try {
          if (listenerId !== null && typeof GM_removeValueChangeListener === "function") GM_removeValueChangeListener(listenerId);
        } catch (e) {
        }
        try {
          GM_deleteValue(key);
        } catch (e) {
        }
        fn(arg);
      };
      const check = (value) => {
        if (value && typeof value === "object") done(resolve, value);
      };
      if (typeof GM_addValueChangeListener === "function") {
        listenerId = GM_addValueChangeListener(key, (_n, _o, value) => check(value));
      }
      pollTimer = setInterval(() => {
        try {
          check(GM_getValue(key));
        } catch (e) {
        }
      }, 700);
      const deadline = setTimeout(() => done(reject, new Error("Tidal harvest timed out \u2014 is the credits tab open and loading?")), HARVEST_TIMEOUT_MS);
    });
  }

  // src/sources/qobuz.js
  var QOBUZ_ROLE_MAP = {
    "Composer": { target: "work", rel: "composer" },
    "Lyricist": { target: "work", rel: "lyricist" },
    "Author": { target: "work", rel: "lyricist" },
    "ComposerLyricist": { target: "work", rel: "writer" },
    "Writer": { target: "work", rel: "writer" },
    "Arranger": { target: "work", rel: "arranger" },
    "Performance Arranger": { target: "recording", rel: "arranger" },
    "Producer": { target: "recording", rel: "producer" },
    "Co-Producer": { target: "recording", rel: "producer" },
    "Assistant Producer": { target: "recording", rel: "producer", attributes: ["assistant"] },
    "Mixer": { target: "recording", rel: "mix" },
    "MixingEngineer": { target: "recording", rel: "mix" },
    "Mixing Engineer": { target: "recording", rel: "mix" },
    "Engineer": { target: "recording", rel: "engineer" },
    "Assistant Engineer": { target: "recording", rel: "engineer", attributes: ["assistant"] },
    "RecordingEngineer": { target: "recording", rel: "recording" },
    "Recording Engineer": { target: "recording", rel: "recording" },
    "MasteringEngineer": { target: "release", rel: "mastering" },
    "Mastering Engineer": { target: "release", rel: "mastering" },
    "Editor": { target: "recording", rel: "editor" },
    "Remixer": { target: "recording", rel: "remixer" },
    "Conductor": { target: "recording", rel: "conductor" },
    "Vocals": { target: "recording", rel: "vocal" },
    "Vocal": { target: "recording", rel: "vocal" },
    "Background Vocal": { target: "recording", rel: "vocal", attributes: [{ _type: "vocal", value: "background vocals" }] },
    "Background Vocals": { target: "recording", rel: "vocal", attributes: [{ _type: "vocal", value: "background vocals" }] },
    "MusicPublisher": { target: "work", rel: "publisher" },
    "Music Publisher": { target: "work", rel: "publisher" },
    "MainArtist": null,
    "Main Artist": null,
    "FeaturedArtist": null,
    "Featured Artist": null,
    "AssociatedPerformer": null,
    "Associated Performer": null,
    "StudioPersonnel": null,
    "Studio Personnel": null
  };
  var QOBUZ_INSTRUMENTS_CI = new Set(Object.keys(INSTRUMENTS).map((k) => k.toLowerCase()));
  function isQobuzRole(token) {
    return Object.prototype.hasOwnProperty.call(QOBUZ_ROLE_MAP, token) || QOBUZ_INSTRUMENTS_CI.has(token.toLowerCase());
  }
  var QOBUZ_ALBUM_RE = /^(?:https?:)?\/\/(?:www\.|play\.|open\.)?qobuz\.com\/(?:[a-z]{2}-[a-z]{2}\/)?album\/(?:[^/]+\/)?([a-z0-9]+)\/?(?:[?#]|$)/i;
  function parseQobuzAlbumUrl(url) {
    const m = QOBUZ_ALBUM_RE.exec(url || "");
    if (!m) return null;
    const original = String(url).replace(/^\/\//, "https://");
    const isStore = /^https?:\/\/(www\.)?qobuz\.com\/[a-z]{2}-[a-z]{2}\/album\//i.test(original);
    return { id: m[1], pageUrl: isStore ? original.split(/[?#]/)[0] : `https://www.qobuz.com/us-en/album/x/${m[1]}` };
  }
  function decodeEntities(s) {
    return String(s).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
  }
  var QOBUZ_NOTICE_RE = /^\s*[(℗©]|\bcopyright\b/i;
  function parseQobuzCreditLine(line) {
    const out = [];
    for (const seg of String(line).split(" - ")) {
      const raw = seg.trim();
      if (!raw || QOBUZ_NOTICE_RE.test(raw)) continue;
      const tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
      const firstRole = tokens.findIndex(isQobuzRole);
      if (firstRole === -1) {
        out.push({ name: tokens.join(", "), roles: [] });
        continue;
      }
      const name = tokens.slice(0, firstRole).join(", ");
      const roles = tokens.slice(firstRole).filter(isQobuzRole);
      if (name) out.push({ name, roles });
      else if (out.length) out[out.length - 1].roles.push(...roles);
    }
    return out;
  }
  function extractQobuzCredits(html) {
    const out = [];
    const re = /id="popinAddToCartBtnPlayerTrack(\d+)"|<p[^>]*class="[^"]*\btrack__info\b[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
    let m, current = 0, capturedFor = null;
    while ((m = re.exec(html)) !== null) {
      if (m[1] !== void 0) {
        current = parseInt(m[1], 10);
        capturedFor = null;
        continue;
      }
      const text = decodeEntities((m[2] || "").replace(/<[^>]+>/g, "").trim());
      if (!text || !current || capturedFor === current) continue;
      out.push({ index: current, credits: parseQobuzCreditLine(text) });
      capturedFor = current;
    }
    return out;
  }
  function extractQobuzAlbumInfo(html) {
    const og = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] || "";
    return decodeEntities(og.replace(/ - Qobuz$/, ""));
  }
  function qobuzToEngine(parsedTracks) {
    const tracklistRels = [];
    const artistRoles = [];
    const tracklist = [];
    const skipped = [];
    const { positions, multiVolume } = assignVolumePositions(parsedTracks, (t) => t.index);
    parsedTracks.forEach((t, i) => {
      const track = { position: positions[i], title: "", type_: "track" };
      tracklist.push(track);
      for (const credit of t.credits) {
        if (!credit.roles.length) {
          if (credit.name && !/^copyright control$/i.test(credit.name)) skipped.push(`track ${track.position}: (no role) \u2014 ${credit.name}`);
          continue;
        }
        const names = splitCombinedNames(credit.name);
        for (const role of credit.roles) {
          if (role === "MusicPublisher" || role === "Music Publisher") {
            if (!/^copyright control$/i.test(credit.name)) skipped.push(`track ${track.position}: Music Publisher \u2014 ${credit.name}`);
            continue;
          }
          for (const nm of names) {
            const url = names.length > 1 ? "" : credit.resource_url || "";
            if (Object.prototype.hasOwnProperty.call(QOBUZ_ROLE_MAP, role)) {
              const plan = QOBUZ_ROLE_MAP[role];
              if (!plan) continue;
              const rel = {
                linkType: plan.rel,
                entityType: "artist",
                attributes: [...plan.attributes || []],
                artist: { name: nm, anv: "", resource_url: url }
                // #353 Qobuz artist id (composer/performer) → exact link
              };
              if (plan.target === "release") artistRoles.push(rel);
              else tracklistRels.push({ ...rel, track });
              continue;
            }
            const rels = getArtistRoles({ name: nm, anv: "", role, resource_url: url });
            if (!rels.length) {
              skipped.push(`track ${track.position}: ${role} \u2014 ${nm}`);
              continue;
            }
            for (const r of rels) {
              tracklistRels.push({
                linkType: r.linkType,
                entityType: "artist",
                attributes: r.attributes || [],
                artist: r.artist,
                track
              });
            }
          }
        }
      }
    });
    return { tracklistRels, artistRoles, tracklist, skipped, multiVolume };
  }
  function fetchQobuzAlbumPage(pageUrl) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest unavailable"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url: pageUrl,
        headers: { "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.8" },
        timeout: 2e4,
        onload: (r) => r.status >= 200 && r.status < 400 && r.responseText ? resolve(r.responseText) : reject(new Error(`Qobuz page returned ${r.status}`)),
        onerror: () => reject(new Error("Qobuz page fetch failed (network)")),
        ontimeout: () => reject(new Error("Qobuz page fetch timed out"))
      });
    });
  }
  var QOBUZ_API = "https://www.qobuz.com/api.json/0.2";
  var QOBUZ_APP_ID = "712109809";
  var QOBUZ_LS_KEY = "mbtools:qobuz";
  function qobuzToken() {
    try {
      const t = JSON.parse(localStorage.getItem(QOBUZ_LS_KEY) || "null");
      return t && t.token || null;
    } catch (e) {
      return null;
    }
  }
  function qobuzArtistUrl(id) {
    return `https://open.qobuz.com/artist/${id}`;
  }
  var QOBUZ_ARTIST_RE = /(?:https?:)?\/\/(?:www\.|play\.|open\.)?qobuz\.com\/(?:[a-z]{2}-[a-z]{2}\/)?(?:interpreter\/[^/]+\/|artist\/)(\d+)/i;
  function parseQobuzArtistUrl(url) {
    const m = QOBUZ_ARTIST_RE.exec(url || "");
    return m ? { key: `qobuz-artist/${m[1]}`, cleanUrl: qobuzArtistUrl(m[1]), id: m[1] } : null;
  }
  function parseQobuzApiTracks(json) {
    const items = json && json.tracks && json.tracks.items || [];
    return items.map((t, i) => {
      const credits = t.performers ? parseQobuzCreditLine(decodeEntities(t.performers)) : [];
      const idByName = {};
      if (t.composer && t.composer.id) idByName[t.composer.name] = t.composer.id;
      if (t.performer && t.performer.id) idByName[t.performer.name] = t.performer.id;
      for (const c of credits) {
        const id = idByName[c.name];
        if (id) c.resource_url = qobuzArtistUrl(id);
      }
      return { index: t.track_number || i + 1, credits };
    }).filter((t) => t.credits.length);
  }
  function qobuzApiAlbumInfo(json) {
    if (!json) return "";
    return [json.title, json.artist && json.artist.name].filter(Boolean).join(", ");
  }
  function fetchQobuzApiAlbum(albumId, token) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest unavailable"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url: `${QOBUZ_API}/album/get?album_id=${encodeURIComponent(albumId)}&app_id=${QOBUZ_APP_ID}`,
        headers: { "X-App-Id": QOBUZ_APP_ID, "X-User-Auth-Token": token, "Accept": "application/json" },
        timeout: 2e4,
        onload: (r) => {
          if (r.status === 401) {
            reject(new Error("Qobuz session expired \u2014 re-login in Platform Check"));
            return;
          }
          if (r.status < 200 || r.status >= 300) {
            reject(new Error(`Qobuz album/get returned ${r.status}`));
            return;
          }
          try {
            resolve(JSON.parse(r.responseText));
          } catch (e) {
            reject(new Error("Qobuz album/get: malformed JSON"));
          }
        },
        onerror: () => reject(new Error("Qobuz album/get failed (network)")),
        ontimeout: () => reject(new Error("Qobuz album/get timed out"))
      });
    });
  }

  // src/sources/metal_archives.js
  var MA_ARTIST_RE = /^https?:\/\/(?:www\.)?metal-archives\.com\/artists\/([^/?#]+)\/(\d+)/i;
  function parseMetalArchivesArtistUrl(url) {
    const m = MA_ARTIST_RE.exec(url || "");
    if (!m) return null;
    return { id: m[2], key: `metal-archives-artist/${m[2]}`, cleanUrl: `https://www.metal-archives.com/artists/${m[1]}/${m[2]}` };
  }
  var MA_ALBUM_RE = /^https?:\/\/(?:www\.)?metal-archives\.com\/albums\/([^/?#]+)\/([^/?#]+)\/(\d+)/i;
  function parseMetalArchivesAlbumUrl(url) {
    const m = MA_ALBUM_RE.exec(url || "");
    if (!m) return null;
    return { id: m[3], albumUrl: `https://www.metal-archives.com/albums/${m[1]}/${m[2]}/${m[3]}` };
  }
  var MA_INSTRUMENT_MAP = {
    // Guitars / Bass are special-cased in bridgeToken (electric by default in metal, #453).
    "Drums": "Drums",
    "Drum programming": "Drum Programming",
    "Drum Programming": "Drum Programming",
    "Keyboards": "Keyboard",
    "Keyboard": "Keyboard",
    "Synthesizers": "Synthesizer",
    "Synthesizer": "Synthesizer",
    "Synth": "Synthesizer",
    "Synths": "Synthesizer",
    "Piano": "Piano",
    "Percussion": "Percussion",
    "Classical Percussion": "Percussion",
    "Bagpipes": "Bagpipe",
    "Bells": "Bell",
    "Round Bells": "Bell",
    "Kettledrums": "Kettledrum",
    "Contrabass": "Double Bass",
    "Citern": "Cittern",
    "Jew's Harp": "Mouth Harp",
    "Oak Stick": "Rhythm Sticks",
    "Western Concert Flute": "Concert Flute",
    "Woodchimes": "Chimes",
    "Wind instruments": "Wind Instruments",
    "Saxophone (alto)": "Alto Saxophone",
    "Saxophone (baritone)": "Baritone Saxophone",
    "Saxophone (tenor)": "Tenor Saxophone"
    // pass-through-friendly names (already in INSTRUMENTS): Accordion, Banjo, Bassoon, Bouzouki, Cello,
    // Clarinet, Concertina, Cowbell, Crumhorn, Domra, Fiddle, Flute, French Horn, Harp, Harpsichord,
    // Hurdy Gurdy, Mandolin, Oboe, Ocarina, Organ, Pan Flute, Saxophone, Shakuhachi, Sopilka, Strings,
    // Tambourine, Timpani, Tin Whistle, Trombone, Trumpet, Viola, Violin, Xylophone, Sitar, Ebow, Samples.
  };
  var MA_VOCAL_SUBTYPE = {
    "lead": "Lead Vocals",
    "backing": "Backing Vocals",
    "back": "Backing Vocals",
    "additional": "Backing Vocals",
    "baritone": "Baritone Vocals",
    "soprano": "Soprano Vocals",
    "tenor": "Tenor Vocals",
    "alto": "Alto Vocals",
    "choirs": "Choir Vocals",
    "choir": "Choir Vocals",
    "spoken": "Spoken Vocals",
    "spoken word": "Spoken Vocals"
  };
  var MA_STAFF_MAP = {
    "Songwriting": "Composed By",
    "Composition": "Composed By",
    "Lyrics": "Lyrics By",
    "Arrangements": "Arranged By",
    "Arrangement": "Arranged By",
    "Recording": "Recording Engineer",
    "Engineering": "Engineer",
    "Mixing": "Mixed By",
    "Remixing": "Remixer",
    "Mastering": "Mastered By",
    "Remastering": "Remastered By",
    "Producer": "Producer",
    "Executive Producer": "Executive-Producer",
    "Co-producer": "Co-producer",
    "Editing": "Edited By",
    "Technician": "Instruments",
    "Conductor": "Conductor",
    "Choirmaster": "Chorus Master",
    "Artwork": "Artwork By",
    "Illustrations": "Illustration",
    "Illustration": "Illustration",
    "Cover Art": "Artwork By",
    "Interior art": "Artwork By",
    "Art Direction": "Art Direction",
    "Photography": "Photography By",
    "Design": "Graphic Design",
    "Liner Notes": "Liner Notes",
    "Director": "Director"
    // design-with-a-task (#453): base rel + a `task` attribute (getArtistRoles doesn't add
    // it for the graphic-design link type, so bridgeToken attaches it explicitly).
  };
  var MA_DESIGN_TASK = { "Layout": "layout", "Logo": "logo", "Photo manipulation": "photo manipulation" };
  var MA_SKIP = /* @__PURE__ */ new Set([
    "All Instruments",
    "Everything",
    "Unknown",
    "Production assistance",
    "Producer (pre-production)",
    "Authoring",
    "Orchestra leader",
    "Menu"
  ]);
  var MA_SPECIAL_SKIP = /* @__PURE__ */ new Set(["Ambience"]);
  function splitTopLevelCommas(str) {
    const out = [];
    let depth = 0, cur = "";
    for (const ch of String(str || "")) {
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function parseTrackGroup(inner) {
    if (!/^tracks?\b/i.test(inner)) return null;
    const nums = [];
    inner.replace(/^tracks?\s*/i, "").split(",").forEach((part) => {
      const range = part.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (range) {
        for (let n = +range[1]; n <= +range[2]; n++) nums.push(n);
      } else {
        const one = part.trim().match(/^\d+$/);
        if (one) nums.push(+part.trim());
      }
    });
    return nums.length ? nums : null;
  }
  function parseMaRoleCell(cell) {
    return splitTopLevelCommas(cell).map((token) => {
      const details = [];
      let tracks = null;
      const base = token.replace(/\(([^()]*)\)/g, (_, inner) => {
        const tg = parseTrackGroup(inner.trim());
        if (tg) tracks = (tracks || []).concat(tg);
        else if (inner.trim()) details.push(inner.trim());
        return "";
      }).replace(/\s+/g, " ").trim();
      return { base, details, tracks };
    }).filter((t) => t.base);
  }
  function bridgeToken(tok) {
    const base = tok.base;
    if (MA_SKIP.has(base) || MA_SPECIAL_SKIP.has(base)) return null;
    const detail = tok.details.map((d) => d.toLowerCase()).join(" ");
    if (/^guitars?$/i.test(base)) {
      const role = /\belectric\b/.test(detail) ? "Electric Guitar" : /\bacoustic\b/.test(detail) ? "Acoustic Guitar" : /\b(classical|nylon)\b/.test(detail) ? "Classical Guitar" : "Electric Guitar";
      return { role, attrs: [] };
    }
    if (/^bass(\s*guitar)?$/i.test(base)) {
      const role = /\bacoustic\b/.test(detail) ? "Acoustic Bass" : /\b(double|upright|contrabass)\b/.test(detail) ? "Double Bass" : /\bfretless\b/.test(detail) ? "Fretless Bass" : "Electric Bass Guitar";
      return { role, attrs: [] };
    }
    if (/^vocals?$/i.test(base) || /^voice$/i.test(base) || /^narration$/i.test(base)) {
      if (/^narration$/i.test(base)) return { role: "Spoken Vocals", attrs: [] };
      const sub = tok.details.map((d) => d.toLowerCase()).find((d) => MA_VOCAL_SUBTYPE[d]);
      return { role: sub ? MA_VOCAL_SUBTYPE[sub] : "Vocals", attrs: [] };
    }
    if (MA_DESIGN_TASK[base]) return { role: "Graphic Design", attrs: [{ _type: "task", value: MA_DESIGN_TASK[base] }] };
    return { role: MA_INSTRUMENT_MAP[base] || MA_STAFF_MAP[base] || base, attrs: [] };
  }
  function extractLineupTable(doc, id) {
    const table = doc.getElementById(id);
    const rows = [];
    if (!table) return rows;
    let band = null;
    for (const tr of table.querySelectorAll("tr")) {
      const a = tr.querySelector('a[href*="/artists/"]');
      const tds = [...tr.querySelectorAll("td")];
      if (!a) {
        const label = tds.map((td) => td.textContent.trim()).join(" ").replace(/^\[|\]$/g, "").trim();
        if (label) band = label;
        continue;
      }
      const url = a.href;
      const nameText = a.textContent.trim();
      const roleTd = tds.find((td) => !td.querySelector('a[href*="/artists/"]'));
      const roleCell = roleTd ? roleTd.textContent.trim().replace(/\s+/g, " ") : "";
      rows.push({ name: nameText, url, roleCell, band });
    }
    return rows;
  }
  function extractTracklist(doc) {
    const table = doc.querySelector("#album_tabs_tracklist table.table_lyrics, .album_tabs_tracklist table, table.table_lyrics");
    const tracks = [];
    let disc = 0;
    if (!table) return { tracks, multiDisc: false };
    const multiDisc = /\b(?:Disc|CD)\s*\d/i.test(table.textContent);
    for (const tr of table.querySelectorAll("tr")) {
      const tds = [...tr.querySelectorAll("td")];
      if (/^(disc|cd|side)\s*\w+/i.test(tr.textContent.trim()) && !tr.querySelector("td.wrapWords")) {
        disc++;
        continue;
      }
      const m = tds[0] && tds[0].textContent.trim().match(/^(\d+)\.?$/);
      if (!m) continue;
      const n = +m[1];
      const titleCell = tr.querySelector("td.wrapWords") || tds[1];
      const title = titleCell ? titleCell.textContent.trim().replace(/\s+/g, " ") : "";
      tracks.push({ position: multiDisc ? `${disc || 1}-${n}` : String(n), title, type_: "track" });
    }
    return { tracks, multiDisc };
  }
  function extractMaLineupDom(doc) {
    const typeEl = [...doc.querySelectorAll("#album_info dt, dl.float_left dt")].find((d) => /^type\b/i.test(d.textContent.trim()));
    const type = typeEl && typeEl.nextElementSibling ? typeEl.nextElementSibling.textContent.trim() : "";
    const band = extractLineupTable(doc, "album_members_lineup");
    const guest = extractLineupTable(doc, "album_members_guest");
    const misc = extractLineupTable(doc, "album_members_misc");
    const { tracks, multiDisc } = extractTracklist(doc);
    const multiBand = /split|collaboration/i.test(type) || [...band, ...guest].some((r) => r.band);
    if (/split/i.test(type)) {
      const bandNames = [...new Set([...band, ...guest, ...misc].map((r) => r.band).filter(Boolean))];
      for (const t of tracks) {
        const b = bandNames.find((bn) => new RegExp("^" + bn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[-\u2013]\\s*", "i").test(t.title));
        if (b) {
          t.band = b;
          t.title = t.title.replace(new RegExp("^" + b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[-\u2013]\\s*", "i"), "");
        }
      }
    }
    return { type, multiBand, multiDisc, tracks, band, guest, misc };
  }
  var HARVEST_KEY2 = (reqId) => `ch-ma-result:${reqId}`;
  var HARVEST_TIMEOUT_MS2 = 45e3;
  function runMetalArchivesHarvestPage() {
    const m = location.hash.match(/ch-req=([a-z0-9.-]+)/i);
    if (!m) return;
    const reqId = m[1];
    const albumId = (location.pathname.match(/\/albums\/[^/]+\/[^/]+\/(\d+)/) || [])[1] || null;
    const post = (payload) => {
      try {
        GM_setValue(HARVEST_KEY2(reqId), { albumId, ts: Date.now(), ...payload });
      } catch (e) {
      }
    };
    const started = Date.now();
    const timer = setInterval(() => {
      const challenged = /just a moment|attention required|checking your browser/i.test(document.title);
      const ready = document.querySelector("#album_info, .album_name, #album_tabs_tracklist, table.table_lyrics");
      if (ready && !challenged) {
        clearInterval(timer);
        try {
          post({ ok: true, ...extractMaLineupDom(document) });
        } catch (e) {
          post({ ok: false, error: "extract failed: " + (e && e.message) });
        }
        setTimeout(() => window.close(), 250);
        return;
      }
      if (Date.now() - started > HARVEST_TIMEOUT_MS2 - 3e3) {
        clearInterval(timer);
        post({ ok: false, error: challenged ? "Cloudflare challenge did not clear in the tab" : "album page never rendered" });
        setTimeout(() => window.close(), 250);
      }
    }, 300);
  }
  function harvestMetalArchivesAlbum(albumUrl) {
    const parsed = parseMetalArchivesAlbumUrl(albumUrl);
    if (!parsed) return Promise.reject(new Error(`Not a Metal Archives album URL: ${albumUrl}`));
    const reqId = `${parsed.id}.${Date.now().toString(36)}`;
    const key = HARVEST_KEY2(reqId);
    const harvestUrl = `${parsed.albumUrl}#ch-req=${reqId}`;
    if (typeof GM_openInTab === "function") {
      GM_openInTab(harvestUrl, { active: false, insert: true, setParent: true });
    } else {
      const tab = window.open(harvestUrl, "_blank");
      if (!tab) return Promise.reject(new Error("Popup blocked \u2014 allow popups for musicbrainz.org and retry"));
    }
    return new Promise((resolve, reject) => {
      let listenerId = null, pollTimer = null;
      const done = (fn, arg) => {
        if (pollTimer) clearInterval(pollTimer);
        clearTimeout(deadline);
        try {
          if (listenerId !== null && typeof GM_removeValueChangeListener === "function") GM_removeValueChangeListener(listenerId);
        } catch (e) {
        }
        try {
          GM_deleteValue(key);
        } catch (e) {
        }
        fn(arg);
      };
      const check = (value) => {
        if (value && typeof value === "object") done(resolve, value);
      };
      if (typeof GM_addValueChangeListener === "function") listenerId = GM_addValueChangeListener(key, (_n, _o, value) => check(value));
      pollTimer = setInterval(() => {
        try {
          check(GM_getValue(key));
        } catch (e) {
        }
      }, 700);
      const deadline = setTimeout(() => done(reject, new Error("Metal Archives harvest timed out \u2014 is the album tab open and loading?")), HARVEST_TIMEOUT_MS2);
    });
  }
  function maArtist(row, discogsRole) {
    const parsed = parseMetalArchivesArtistUrl(row.url);
    return {
      id: parsed ? `metal-archives-${parsed.id}` : void 0,
      name: row.name,
      anv: "",
      role: discogsRole,
      resource_url: parsed ? parsed.cleanUrl : ""
    };
  }
  function rowToTrackRels(row, allTracks, byPosition, guest, skipped, sectionLabel, onlyQualified) {
    const rels = [];
    for (const tok of parseMaRoleCell(row.roleCell)) {
      if (onlyQualified && !tok.tracks) continue;
      const bridged = bridgeToken(tok);
      if (!bridged) {
        skipped.push(`${sectionLabel}: ${tok.base} \u2014 ${row.name}`);
        continue;
      }
      let resolved = getArtistRoles(maArtist(row, bridged.role));
      if (!resolved.length && /s$/i.test(bridged.role)) resolved = getArtistRoles(maArtist(row, bridged.role.replace(/s$/i, "")));
      if (!resolved.length) {
        skipped.push(`${sectionLabel}: ${tok.base} \u2014 ${row.name}`);
        continue;
      }
      const targets = tok.tracks ? tok.tracks.map((n) => byPosition.get(String(n))).filter(Boolean) : allTracks;
      for (const track of targets) {
        for (const r of resolved) {
          rels.push({
            linkType: r.linkType,
            entityType: "artist",
            attributes: [...r.attributes || [], ...bridged.attrs, ...guest ? ["guest"] : []],
            artist: r.artist,
            track
          });
        }
      }
    }
    return rels;
  }
  function metalArchivesToEngine(harvest) {
    const tracklist = (harvest.tracks || []).map((t) => ({ position: t.position, title: t.title, type_: "track", band: t.band }));
    const byPosition = new Map(tracklist.map((t) => [String(t.position).replace(/^\d+-/, ""), t]));
    tracklist.forEach((t) => byPosition.set(String(t.position), t));
    const skipped = [];
    const tracklistRels = [];
    const isSplit = /split/i.test(harvest.type || "");
    for (const [rows, guest, label] of [[harvest.band || [], false, "band"], [harvest.guest || [], true, "guest"]]) {
      for (const row of rows) {
        let scope = tracklist;
        if (isSplit && row.band) {
          scope = tracklist.filter((t) => t.band === row.band);
          if (!scope.length) {
            skipped.push(`${label} (split \u2014 no tracks matched band "${row.band}"): ${row.roleCell} \u2014 ${row.name}`);
            continue;
          }
        }
        tracklistRels.push(...rowToTrackRels(row, scope, byPosition, guest, skipped, label));
      }
    }
    for (const row of harvest.misc || []) {
      tracklistRels.push(...rowToTrackRels(row, tracklist, byPosition, false, skipped, "misc", true));
    }
    return { tracklistRels, tracklist, skipped, multiVolume: !!harvest.multiDisc };
  }
  function metalArchivesReleaseArtists(harvest) {
    const artists = [], skipped = [];
    for (const row of harvest.misc || []) {
      for (const tok of parseMaRoleCell(row.roleCell)) {
        if (tok.tracks) continue;
        const bridged = bridgeToken(tok);
        if (!bridged) {
          skipped.push(`release: ${tok.base} \u2014 ${row.name}`);
          continue;
        }
        const a = maArtist(row, bridged.role);
        a.maRole = tok.base;
        a.maAttrs = bridged.attrs;
        artists.push(a);
      }
    }
    return { artists, publishers: [], companies: [], skipped };
  }

  // src/sources/registry.js
  function parseSourceEntityUrl(url) {
    if (!url) return null;
    return parseDiscogsUrl(url) || parseTidalArtistUrl(url) || parseQobuzArtistUrl(url) || parseMetalArchivesArtistUrl(url);
  }
  function idbKeyForEntity(entity) {
    if (!entity) return null;
    return parseSourceEntityUrl(entity.resource_url)?.key || entity._cacheKey || null;
  }
  function sourceNameForUrl(url) {
    if (/tidal\.com\//i.test(url || "")) return "Tidal";
    if (/qobuz\.com\//i.test(url || "")) return "Qobuz";
    if (/deezer\.com\//i.test(url || "")) return "Deezer";
    if (/(?:music|itunes)\.apple\.com\//i.test(url || "")) return "Apple";
    if (/metal-archives\.com\//i.test(url || "")) return "Metal Archives";
    if (/music\.youtube\.com\/|youtube\.com\/playlist\?(?:[^#]*&)?list=OLAK5uy_/i.test(url || "")) return "YouTube Music";
    return "Discogs";
  }
  var isSyntheticProviderUrl = (url) => /tidal\.com\/_(?:publisher|company)\//i.test(String(url || ""));
  function sourceUrlLinkTypeId(url, entityType) {
    if (isSyntheticProviderUrl(url)) return null;
    const src = sourceNameForUrl(url);
    if (src === "Tidal") return entityType === "artist" ? "978" : null;
    if (src === "Qobuz") return entityType === "artist" ? "978" : null;
    if (src === "Metal Archives") return entityType === "artist" ? "188" : null;
    return entityType === "label" ? "217" : entityType === "place" ? "705" : "180";
  }

  // src/preflight.js
  var KIND_TABLE = {
    artist: { searchLimit: 100, resultKey: "artists", incRels: "artist-rels" },
    label: { searchLimit: 8, resultKey: "labels", incRels: "label-rels" },
    // Places also accept label-rels because MB editors often file a
    // facility as a label rather than a place (issue we've worked around
    // since the original company resolver).
    place: { searchLimit: 8, resultKey: "places", incRels: "place-rels+label-rels" }
  };
  var toCandidate = (a) => ({
    id: a.id,
    name: a.name,
    disambiguation: a.disambiguation || a["disambiguation-comment"] || "",
    score: a.score || 0,
    aliases: (a.aliases || []).map((al) => al && al.name).filter(Boolean)
  });
  function contextHit(context, name, candidates) {
    if (!context || !context.related || !context.related.length) return null;
    const holders = mbmContextHolders(context.related, name, (candidates || []).map((c) => ({ id: c.id, name: c.name, aliases: (c.aliases || []).map((n) => ({ name: n })) })));
    if (holders.length === 1) return holders[0];
    if (holders.length > 1) logDebug(`context: "${name}" is carried by ${holders.length} related artists (${holders.map((h) => h.name).join(", ")}) \u2014 left to review`);
    return null;
  }
  async function coCreditHit(context, name) {
    if (!context || !context.coCredit || !context.seeds || !context.seeds.length) return null;
    const tally = /* @__PURE__ */ new Map();
    for (const seed of context.seeds.slice(0, 4)) {
      const q = `arid:${seed} AND artistname:"${String(name).replace(/["\\]/g, " ")}"`;
      const json = await mbThrottle.fetchJson(`${MB}/ws/2/recording?query=${encodeURIComponent(q)}&inc=artist-credits&limit=25&fmt=json`);
      if (!json) continue;
      for (const h of mbmCoCreditHits(json, seed, name)) {
        const t = tally.get(h.gid) || { n: 0, name: h.name };
        t.n++;
        tally.set(h.gid, t);
      }
    }
    const ranked = [...tally.entries()].sort((a, b) => b[1].n - a[1].n);
    if (ranked.length === 1 || ranked.length > 1 && ranked[0][1].n > ranked[1][1].n) return { gid: ranked[0][0], name: ranked[0][1].name };
    if (ranked.length) logDebug(`co-credit: "${name}" \u2192 ${ranked.length} tied candidates \u2014 left to review`);
    return null;
  }
  async function resolveEntity(entity, kind, opts) {
    const { bypassIdb } = opts;
    const context = kind === "artist" ? opts.context || null : null;
    const { searchLimit, resultKey, incRels } = KIND_TABLE[kind];
    const parsed = parseSourceEntityUrl(entity.resource_url);
    const key = parsed?.key || entity._cacheKey || null;
    const searchName = entity.name;
    const displayName = kind === "artist" ? entity.anv && entity.anv.trim() || entity.name : entity.name;
    const discogsHref = entity.resource_url.replace(/https:\/\/api\.discogs\.com\/(\w+?)s\/(\d+)/, "https://www.discogs.com/$1/$2");
    function buildResolved(mbUrl, mbName, mbDisambig, via2, actualKind = kind, fromCache = false, urlLinkedIds2, creditOverride) {
      return {
        type: "resolved",
        entityType: actualKind,
        entity,
        displayName,
        discogsHref,
        mbUrl,
        mbName,
        mbDisambig,
        // User's saved "Credited as" override from a prior session
        // (IDB `creditOverride` field). Review-table reads this in
        // `pickPrefill` to populate the field. Undefined when no
        // prior override exists. #105.
        creditOverride,
        // `urlLinkedIds` — MBIDs that have a relation to this Discogs URL,
        //                  harvested from the URL lookup done during
        //                  preflight. The review-table uses this to render
        //                  the "Add Discogs link" / "already linked" / "linked
        //                  to different MB <type>" badge without issuing
        //                  another `/ws/2/url?…` query per row. `undefined`
        //                  means "preflight didn't ask MB" (IDB hit on a
        //                  legacy record that predates this field), in which
        //                  case review-table falls back to its own per-row
        //                  fetch. `[]` means "asked MB, got no relations" —
        //                  no fallback needed.
        urlLinkedIds: urlLinkedIds2,
        // `via`      — the resolution mechanism (`name` / `url` / `both` / `user`,
        //              or `cache` only when a legacy IDB record predates the
        //              `resolvedVia` field and we genuinely can't recover it).
        // `fromCache`— whether THIS resolution came from IDB rather than a fresh
        //              MB lookup. The two are orthogonal: a name-resolved entity
        //              loaded from cache is `via='name'` + `fromCache=true`, and
        //              the UI surfaces both as `name (cache)`.
        logEntry: { displayName, discogsHref, mbUrl, mbName, mbDisambig, via: via2, fromCache }
      };
    }
    function buildAttention(nameMatches2, nameSearchFailed2, ambiguityReason, urlLinkedIds2, creditOverride) {
      return {
        type: "attention",
        entityType: kind,
        entity,
        displayName,
        discogsHref,
        nameMatches: nameMatches2 || [],
        // Saved "Credited as" override — see buildResolved. #105.
        creditOverride,
        // Same `urlLinkedIds` contract as on the resolved shape — review-table
        // uses it to skip the per-row URL fetch even for attention rows once
        // the user picks an MBID from the candidate list.
        urlLinkedIds: urlLinkedIds2,
        // Only artists track this — used by the review table to badge
        // entries that failed because of a rate-limited name search vs
        // entries that genuinely don't exist in MB.
        rateLimited: kind === "artist" && nameSearchFailed2 && !nameMatches2?.length,
        ambiguityReason: ambiguityReason || null
      };
    }
    async function fetchMbEntityInfo(et, mbid) {
      const json = await mbThrottle.fetchJson(`${MB}/ws/2/${et}/${mbid}?fmt=json`);
      return json ? { name: json.name || null, disambiguation: json.disambiguation || "" } : { name: null, disambiguation: "" };
    }
    if (bypassIdb && key) {
      await deleteIdbRecord(key);
    }
    if (!bypassIdb && key) {
      const cachedRec = await readIdbRecord(key);
      if (cachedRec?.mbid && cachedRec?.entityType) {
        const via2 = cachedRec.resolvedVia || "cache";
        let cachedLinkedIds = cachedRec.urlLinkedIds;
        if (cachedLinkedIds === void 0 && (via2 === "url" || via2 === "both" || via2 === "both-alias")) {
          cachedLinkedIds = [cachedRec.mbid];
        }
        if (Array.isArray(cachedLinkedIds) && cachedLinkedIds.length === 0) cachedLinkedIds = void 0;
        if (cachedRec.name) {
          return buildResolved(
            cachedRec.mbUrl,
            cachedRec.name,
            cachedRec.disambiguation || "",
            via2,
            cachedRec.entityType,
            true,
            cachedLinkedIds,
            cachedRec.creditOverride
          );
        }
        const info = await fetchMbEntityInfo(cachedRec.entityType, cachedRec.mbid);
        if (info.name) {
          await writeIdbRecord(key, {
            name: info.name,
            disambiguation: info.disambiguation
          });
        }
        return buildResolved(
          cachedRec.mbUrl,
          info.name,
          info.disambiguation,
          via2,
          cachedRec.entityType,
          true,
          cachedLinkedIds,
          cachedRec.creditOverride
        );
      }
      if (cachedRec && Array.isArray(cachedRec.nameMatches)) {
        const attnLinkedIds = Array.isArray(cachedRec.urlLinkedIds) && cachedRec.urlLinkedIds.length === 0 ? void 0 : cachedRec.urlLinkedIds;
        const ctx = contextHit(context, searchName, cachedRec.nameMatches);
        if (ctx) {
          log.info(`Match: ${displayName} \u2192 ${ctx.name} \u2014 via release context (${ctx.rel || "related"}, ${ctx.via})`);
          const mbUrl = `${MB}/artist/${ctx.gid}`;
          await writeIdbRecord(key, { mbid: ctx.gid, entityType: "artist", name: ctx.name, disambiguation: "", resolvedVia: "ctx", nameMatches: null, mbUrl });
          return buildResolved(mbUrl, ctx.name, "", "ctx", "artist", false, attnLinkedIds, cachedRec.creditOverride);
        }
        return buildAttention(cachedRec.nameMatches, false, null, attnLinkedIds, cachedRec.creditOverride);
      }
    }
    const [nameJson, urlJson] = await Promise.all([
      mbThrottle.fetchJson(
        `${MB}/ws/2/${kind}?query=${encodeURIComponent(searchName)}&fmt=json&limit=${searchLimit}`
      ),
      parsed ? mbThrottle.fetchJson404(
        `${MB}/ws/2/url?resource=${encodeURIComponent(parsed.cleanUrl)}&inc=${incRels}&fmt=json`
      ) : Promise.resolve({ notFound: true })
    ]);
    const nameSearchFailed = nameJson === null;
    const normalized = searchName.toLowerCase().trim();
    const isArtist = kind === "artist";
    const holdsName = (a) => isArtist ? !!mbmHolds(a, searchName) : a.name.toLowerCase().trim() === normalized;
    const found = nameJson?.[resultKey] || [];
    const nameMatches = [
      ...found.filter((a) => holdsName(a)),
      ...found.filter((a) => !holdsName(a) && a.score != null && a.score >= 70).slice(0, 10)
    ].map(toCandidate);
    const exactNameMatches = nameMatches.filter(holdsName);
    const nameHit = exactNameMatches.length === 1 ? {
      kind,
      mbid: exactNameMatches[0].id,
      name: exactNameMatches[0].name,
      disambiguation: exactNameMatches[0].disambiguation || "",
      via: isArtist && !(exactNameMatches[0].name.toLowerCase().trim() === normalized) ? "alias" : "name"
    } : null;
    let urlHit = null;
    const urlLinkedIds = urlJson === null ? void 0 : (urlJson.relations || []).map((r) => kind === "place" ? r.place?.id || r.label?.id || null : r[kind]?.id || null).filter(Boolean);
    if (urlJson?.relations?.length > 0) {
      const rel = kind === "place" ? urlJson.relations.find((r) => r.place || r.label) : urlJson.relations.find((r) => r[kind]);
      if (rel) {
        const actualKind = rel[kind] ? kind : rel.label ? "label" : "place";
        const a = rel[actualKind];
        urlHit = {
          kind: actualKind,
          mbid: a.id,
          name: a.name || null,
          disambiguation: a.disambiguation || ""
        };
      }
    }
    async function cacheAttention(matches) {
      if (key && !nameSearchFailed) {
        await writeIdbRecord(key, {
          mbid: null,
          entityType: null,
          name: null,
          mbUrl: null,
          disambiguation: "",
          resolvedVia: null,
          nameMatches: matches,
          // Omit when unknown (lookup failed) — never persist a guess.
          ...urlLinkedIds !== void 0 && { urlLinkedIds }
        });
      }
    }
    let resolved = null;
    let via = null;
    const heldBy = (a) => isArtist ? mbmHolds(a, displayName) || mbmHolds(a, searchName) : holdsName(a) ? "name" : null;
    const urlHolder = urlHit && urlHit.kind === kind && !(nameHit && nameHit.mbid === urlHit.mbid) ? (nameJson?.[resultKey] || []).find((a) => a.id === urlHit.mbid && heldBy(a)) : null;
    if (urlHolder) {
      resolved = urlHit;
      via = heldBy(urlHolder) === "alias" ? "both-alias" : "both";
      logDebug(`Match: ${displayName} \u2192 ${urlHolder.name} \u2014 the URL's artist holds the name${via === "both-alias" ? " as an alias" : ""} (${exactNameMatches.length} exact holder(s) in all)`);
    } else if (nameHit && urlHit) {
      if (nameHit.mbid === urlHit.mbid && nameHit.kind === urlHit.kind) {
        resolved = urlHit;
        via = nameHit.via === "alias" ? "both-alias" : "both";
      } else {
        await cacheAttention(nameMatches);
        return buildAttention(
          nameMatches,
          false,
          `name \u2192 ${nameHit.kind}/${nameHit.mbid}, URL \u2192 ${urlHit.kind}/${urlHit.mbid}`,
          urlLinkedIds
        );
      }
    } else if (urlHit) {
      resolved = urlHit;
      via = "url";
    } else if (isArtist) {
      let reviewReason = null;
      const ctx = contextHit(context, searchName, nameMatches);
      if (ctx) {
        resolved = { kind: "artist", mbid: ctx.gid, name: ctx.name, disambiguation: "" };
        via = "ctx";
        log.info(`Match: ${displayName} \u2192 ${ctx.name} \u2014 via release context (${ctx.rel || "related"}, ${ctx.via})`);
      } else if (nameHit) {
        const idJson = await mbThrottle.fetchJson(`${MB}/ws/2/artist?query=${encodeURIComponent(mbmIdentityQuery(searchName, "artist"))}&fmt=json&limit=${MBM_EXACT_LIMIT}`);
        const idn = mbmExactIdentity(idJson, searchName);
        logDebug(`exact identity "${searchName}": ${idn.status} (${idJson ? (idJson.artists || []).length + " of " + idJson.count : "no response"})`);
        if (idn.status === "unique" && idn.hit.id === nameHit.mbid) {
          resolved = nameHit;
          via = idn.via;
        } else if (idn.status === "failed") {
          return buildAttention(nameMatches, true, null, urlLinkedIds);
        } else {
          reviewReason = idn.status === "incomplete" ? `not provably unique (${idJson.count} artists match)` : idn.status === "ambiguous" ? `${idn.exact.length} artists carry the name` : "the exact holder did not verify";
          logDebug(`"${searchName}" not resolved by name \u2014 ${reviewReason}`);
        }
      } else if (exactNameMatches.length > 1) {
        reviewReason = `${exactNameMatches.length} artists carry the name`;
        logDebug(`"${searchName}" not resolved by name \u2014 ${reviewReason}`);
      }
      if (!resolved) {
        const cc = await coCreditHit(context, searchName);
        if (cc) {
          resolved = { kind: "artist", mbid: cc.gid, name: cc.name, disambiguation: "" };
          via = "cred";
          log.info(`Match: ${displayName} \u2192 ${cc.name} \u2014 via existing artist credits (co-credit search)`);
        }
      }
      if (!resolved && reviewReason) {
        logDebug(`"${searchName}" left to review \u2014 ${reviewReason}`);
        await cacheAttention(nameMatches);
        return buildAttention(nameMatches, false, reviewReason, urlLinkedIds);
      }
    } else if (nameHit) {
      resolved = nameHit;
      via = "name";
    }
    if (resolved) {
      const mbUrl = `${MB}/${resolved.kind}/${resolved.mbid}`;
      let finalName = resolved.name;
      let finalDisam = resolved.disambiguation;
      let liveAliases = null;
      if (via === "url" && resolved.kind === "artist" && isArtist) {
        const live = await mbThrottle.fetchJson(`${MB}/ws/2/artist/${resolved.mbid}?inc=aliases&fmt=json`);
        if (live && live.id === resolved.mbid) {
          liveAliases = (live.aliases || []).map((al) => al && al.name).filter(Boolean);
          if (!finalName) {
            finalName = live.name || null;
            finalDisam = live.disambiguation || "";
          }
          const held = heldBy({ name: live.name, aliases: live.aliases || [] });
          if (held) via = held === "alias" ? "both-alias" : "both";
          logDebug(`"${displayName}" \u2192 ${live.name}: found by URL; the artist ${held ? `holds the name as its ${held} \u2192 ${via}` : `doesn't carry the name (${liveAliases.length} alias(es))`}`);
        } else logDebug(`"${displayName}": the URL's artist ${resolved.mbid} couldn't be read \u2014 stays "url"`);
      }
      if (!finalName) {
        const info = await fetchMbEntityInfo(resolved.kind, resolved.mbid);
        finalName = info.name || null;
        finalDisam = info.disambiguation || "";
      }
      if (key) {
        await writeIdbRecord(key, {
          mbid: resolved.mbid,
          entityType: resolved.kind,
          name: finalName,
          disambiguation: finalDisam || "",
          resolvedVia: via,
          // Omit when unknown (lookup failed) — never persist a guess.
          ...urlLinkedIds !== void 0 && { urlLinkedIds }
        });
      }
      const out = buildResolved(mbUrl, finalName, finalDisam || "", via, resolved.kind, false, urlLinkedIds);
      if (resolved.kind === "artist") {
        const cand = nameMatches.find((c) => c.id === resolved.mbid);
        const self = !cand && via === "ctx" && context && context.related ? context.related.find((x) => x.gid === resolved.mbid && x.rel === "self") : null;
        if (cand && Array.isArray(cand.aliases)) out.mbAliases = cand.aliases;
        else if (liveAliases) out.mbAliases = liveAliases;
        else if (self && Array.isArray(self.aliases)) out.mbAliases = self.aliases;
        logDebug(`"${displayName}" \u2192 ${finalName}: aliases ${out.mbAliases ? `known (${out.mbAliases.length})` : "unknown"} for the "+ alias" check`);
      }
      return out;
    }
    await cacheAttention(nameMatches);
    return buildAttention(nameMatches, nameSearchFailed, null, urlLinkedIds);
  }
  async function resolveAll(entities, opts) {
    const { kindOf, progressLi, bypassIdb, progressLabel, context } = opts;
    const CONCURRENCY = 5;
    const MIN_GAP_MS = 50;
    let done = 0;
    const inFlightNames = /* @__PURE__ */ new Set();
    function setProgress() {
      if (entities.length > 0) {
        try {
          _setProgressPct(done / entities.length * 100);
        } catch (_) {
        }
      }
      if (!progressLi) return;
      const remaining = entities.length - done;
      const checking = inFlightNames.size ? ` \u2014 checking <em>${[...inFlightNames].join(", ")}</em>` : "";
      progressLi.innerHTML = `${progressLabel}\u2026 <strong>${done}/${entities.length}</strong> done${checking}` + (remaining === 0 ? " \u2714" : ` (${remaining} remaining)`);
      try {
        const plain = `${progressLabel}\u2026 ${done}/${entities.length} done` + (inFlightNames.size ? ` \u2014 checking ${[...inFlightNames].join(", ")}` : "") + (remaining === 0 ? " \u2714" : ` (${remaining} remaining)`);
        document.querySelector(".discogs-bar")?._setProgress?.(null, plain);
      } catch (_) {
      }
    }
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const queue = entities.map((e, i) => ({ entity: e, index: i }));
    const results = new Array(entities.length);
    setProgress();
    async function worker(slotIndex) {
      const tag = `worker#${slotIndex}`;
      logDebug(`${tag} starting (stagger ${slotIndex * MIN_GAP_MS}ms)`);
      await delay(slotIndex * MIN_GAP_MS);
      let processed = 0;
      while (queue.length > 0) {
        const { entity, index } = queue.shift();
        const kind = kindOf(entity);
        if (!kind) {
          logDebug(`${tag} skip "${entity?.name || "?"}" \u2014 no resolvable kind`);
          done++;
          setProgress();
          continue;
        }
        const displayName = kind === "artist" ? entity.anv && entity.anv.trim() || entity.name : entity.name;
        inFlightNames.add(displayName);
        setProgress();
        const t0 = Date.now();
        logDebug(`${tag} resolving "${displayName}" (${kind})`);
        results[index] = await resolveEntity(entity, kind, { bypassIdb, context });
        const elapsed = Date.now() - t0;
        const r = results[index];
        const outcome = r?.type === "resolved" ? `resolved via ${r.logEntry?.via || "?"}${r.logEntry?.fromCache ? " (cache)" : ""}` : r?.type === "attention" ? `unresolved (${r.nameMatches?.length || 0} candidates)` : "skipped";
        logDebug(`${tag} "${displayName}" -> ${outcome} in ${elapsed}ms`);
        inFlightNames.delete(displayName);
        done++;
        processed++;
        setProgress();
      }
      logDebug(`${tag} finished (${processed} entit${processed === 1 ? "y" : "ies"})`);
    }
    const slots = Math.min(CONCURRENCY, entities.length);
    logDebug(`resolveAll: ${entities.length} entit${entities.length === 1 ? "y" : "ies"}, ${slots} worker slot(s)`);
    if (slots > 0) await Promise.all(Array.from({ length: slots }, (_, i) => worker(i)));
    logDebug(`resolveAll: done`);
    return { allResults: results.filter(Boolean) };
  }
  var ARTIST_KIND = () => "artist";
  var ENTITY_KIND = (e) => e?.entityType || "artist";
  var COMPANY_KIND = (c) => ENTITY_TYPE_MAP[c.entity_type_name]?.entityType ?? null;

  // src/derive/remix.js
  var STRONG = /* @__PURE__ */ new Set([
    "extended",
    "original",
    "radio",
    "instrumental",
    "acapella",
    "acappella",
    "acoustic",
    "album",
    "single",
    "main",
    "long",
    "short",
    "full",
    "special",
    "bonus",
    "alternative",
    "alternate",
    "vip",
    "rmx",
    "redux",
    "dancefloor",
    "unplugged",
    "demo",
    "remastered",
    // remix-family words, in case a lead carries a second one
    // ("Extended Remix Edit"): strip them off the trailing edge too.
    "dub",
    "edit",
    "mix",
    "remix",
    "rework",
    "remodel",
    "reshuffle",
    "reprise",
    "version",
    "re-edit",
    "reedit"
  ]);
  var WEAK = /* @__PURE__ */ new Set([
    "club",
    "deep",
    "tech",
    "soulful",
    "disco",
    "electro",
    "house",
    "techno",
    "progressive",
    "tribal",
    "vocal",
    "classic",
    "clean",
    "dirty",
    "censored",
    "uncensored",
    "studio",
    "live",
    "the",
    "a",
    "an"
  ]);
  var SEP_RE = /\s*(?:&|\+|,|\/|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/i;
  var isVinyl = (t) => /^\d+(?:"|''|”|inch|in)?$/.test(t);
  var norm = (t) => t.toLowerCase().replace(/[.''`]+$/, "");
  var isStrong = (t) => {
    const l = norm(t);
    return STRONG.has(l) || isVinyl(l);
  };
  var isDecorator = (t) => {
    const l = norm(t);
    return STRONG.has(l) || WEAK.has(l) || isVinyl(l);
  };
  var TRAILING_RE = /^(.+?)\s+((?:re[-_ ]?)?(?:remix|rework|remodel|reshuffle|reprise|edit|dub|mix))(?:es|ed|s|d)?$/i;
  var BY_RE = /^(?:re[-_ ]?)?(?:remix|rework|remodel|reshuffle|rerub)(?:es|ed|s|d)?\s+by\s+(.+)$/i;
  function cleanName(raw) {
    let s = String(raw || "").replace(/\s*[([].*$/, "").replace(/[)\]]+\s*$/, "");
    let tokens = s.trim().split(/\s+/).filter(Boolean);
    const pIdx = tokens.findIndex((t) => /['']s$/i.test(t));
    if (pIdx !== -1) {
      tokens = tokens.slice(0, pIdx + 1);
      tokens[pIdx] = tokens[pIdx].replace(/['']s$/i, "");
    }
    while (tokens.length && isStrong(tokens[tokens.length - 1])) tokens.pop();
    if (!tokens.length) return null;
    if (tokens.every(isDecorator)) return null;
    const name = tokens.join(" ").replace(/['']s$/i, "").trim();
    if (!/[A-Za-z0-9]/.test(name)) return null;
    return name;
  }
  function parseRemixTitle(title) {
    const result = { base: title || "", remixers: [], kind: null };
    if (!title || typeof title !== "string") return result;
    const groups = title.match(/[([][^)\]]*[)\]]/g);
    if (!groups) return result;
    for (const g of groups) {
      const inner = g.slice(1, -1).trim();
      let captured = null, kind = null;
      let m = BY_RE.exec(inner);
      if (m) {
        captured = m[1];
        kind = "remix";
      } else {
        m = TRAILING_RE.exec(inner);
        if (m) {
          captured = m[1];
          kind = /mix$/i.test(m[2]) && !/remix$/i.test(m[2]) ? "mix" : /edit$/i.test(m[2]) ? "edit" : /dub$/i.test(m[2]) ? "dub" : "remix";
        }
      }
      if (!captured) continue;
      const names = captured.split(SEP_RE).map(cleanName).filter(Boolean);
      if (!names.length) continue;
      result.kind = result.kind || kind;
      for (const n of names) if (!result.remixers.includes(n)) result.remixers.push(n);
      result.base = result.base.replace(g, "").replace(/\s{2,}/g, " ").trim();
    }
    return result;
  }
  function deriveRemixRoles(tracklist, releaseMbid) {
    if (!Array.isArray(tracklist)) return [];
    const roles = [];
    for (const track of tracklist) {
      if (!track || track.type_ && track.type_ !== "track") continue;
      if (!track.title) continue;
      const { remixers } = parseRemixTitle(track.title);
      for (const name of remixers) {
        const artist = { name, anv: "", resource_url: "", _derived: true };
        if (releaseMbid) artist._cacheKey = `titles-remix/${releaseMbid}/${name.toLowerCase().trim()}`;
        roles.push({
          linkType: "remixer",
          artist,
          track,
          creditedAs: name,
          attributes: [],
          entityType: "artist"
        });
      }
    }
    return roles;
  }

  // src/data/special-purpose.js
  var SPECIAL_PURPOSE_ARTISTS = /* @__PURE__ */ new Set([
    "125ec42a-7229-4250-afc5-e057484327fe",
    // [unknown]
    "f731ccc4-e22a-43af-a747-64213329e088",
    // [anonymous]
    "33cf029c-63b0-41a0-9855-be2a3665fb3b",
    // [data]
    "314e1c25-dde7-4e4d-b2f4-0a7b9f7c56dc",
    // [dialogue]
    "eec63d3c-3b81-4ad4-b1e4-7c147d4d2b61",
    // [no artist]
    "9be7f096-97ec-4615-8957-8d40b5dcbc41",
    // [traditional]
    "89ad4ac3-39f7-470e-963a-56509c546377",
    // Various Artists
    "7e84f845-ac16-41fe-9ff8-df12eb32af55",
    // MusicBrainz Test Artist
    "66ea0139-149f-4a0c-8fbf-5ea9ec4a6e49",
    // [Disney]
    "a0ef7e1d-44ff-4039-9435-7d5fefdeecc9",
    // [theatre]
    "90068d37-bae7-4292-be4a-704c145bd616",
    // [church chimes]
    "80a8851f-444c-4539-892b-ad2a49292aa9"
    // [language instruction]
  ]);

  // src/edit-note.js
  function buildEditNote(sourceUrl, opts, extraLines, sourceLabel) {
    const s = GM_info.script;
    const mbUrl = location.href.split(/[?#]/)[0].replace(/\/edit-relationships$/, "");
    const homepage = s.homepageURL || s.homepage || "https://github.com/majkinetor/musicbrainz-userscripts/blob/main/userscripts/credit_hoarder/README.md";
    const header = s.name + " v" + s.version + " by " + s.author + " - " + homepage;
    const raw = String(sourceUrl || "");
    const sourceName = sourceNameForUrl(raw);
    const cleanSource = sourceName === "YouTube Music" ? raw.split("#")[0] : raw.split(/[?#]/)[0];
    const lines = [
      header,
      "",
      "Release URL: " + mbUrl,
      // #408: a consolidated "Import all" run passes an explicit source label (it has no single
      // URL). Otherwise: the source URL's provider, or the title-derived "Titles" source (#271).
      sourceLabel ? "Source: " + sourceLabel : cleanSource ? sourceName + " URL: " + cleanSource : "Source: track titles"
    ];
    if (opts) lines.push("Options: " + opts);
    if (extraLines) lines.push(...Array.isArray(extraLines) ? extraLines : [extraLines]);
    return lines.join("\n");
  }
  function buildCreateNote(action = "Created the entity") {
    const s = GM_info.script;
    const homepage = s.homepageURL || s.homepage || "https://github.com/majkinetor/musicbrainz-userscripts/blob/main/userscripts/credit_hoarder/README.md";
    const header = s.name + " v" + s.version + " by " + s.author + " - " + homepage;
    const mbUrl = location.href.split(/[?#]/)[0].replace(/\/edit(-relationships)?$/, "");
    return header + "\n\n" + action + " while importing credits onto " + mbUrl;
  }
  function splitOurNote(note) {
    const headerPrefix = GM_info.script.name + " v";
    const lines = String(note || "").split("\n");
    const idx = lines.findIndex((l) => l.startsWith(headerPrefix));
    if (idx === -1) return null;
    const pre = lines.slice(0, idx).join("\n").replace(/\s+$/, "");
    const our = lines.slice(idx);
    const relIdx = our.findIndex((l) => /^Release URL:/i.test(l));
    return {
      pre,
      header: our[0],
      releaseLine: relIdx !== -1 ? our[relIdx] : "",
      body: (relIdx !== -1 ? our.slice(relIdx + 1) : our.slice(1)).join("\n").trim()
    };
  }
  function blockSourceKey(block) {
    const first = (String(block).split("\n")[0] || "").trim();
    const m = first.match(/^([A-Za-z][A-Za-z ]*?)\s+URL:/);
    if (m) return m[1].trim().toLowerCase();
    if (/^Source:\s*track titles/i.test(first)) return "titles";
    return first.toLowerCase();
  }
  function combineEditNote(existingNote, ourNote) {
    const fresh = splitOurNote(ourNote);
    if (!fresh) return ourNote;
    const newKey = blockSourceKey(fresh.body);
    const prev = splitOurNote(existingNote);
    const keptBlocks = prev ? prev.body.split(/\n\n+/).map((b) => b.trim()).filter(Boolean).filter((b) => blockSourceKey(b) !== newKey) : [];
    const stacked = [fresh.body, ...keptBlocks].join("\n\n");
    const ourBlock = `${fresh.header}

${fresh.releaseLine}
${stacked}`;
    const pre = prev ? prev.pre : String(existingNote || "").replace(/\s+$/, "");
    return pre ? `${pre}

${ourBlock}` : ourBlock;
  }

  // src/alias-add.js
  var SPECIAL = new Set(MBM_SPECIAL_PURPOSE);
  function aliasHeldBy(artist, credit) {
    if (!artist || !credit) return true;
    const aliases = (artist.aliases || []).map((a) => typeof a === "string" ? { name: a } : a).filter(Boolean);
    return !!mbmHolds({ name: artist.name, aliases }, credit);
  }
  function wantsAliasButton(entityType, artist, credit) {
    if (entityType !== "artist" || !artist || !artist.id || SPECIAL.has(artist.id)) return false;
    if (!Array.isArray(artist.aliases)) return !aliasHeldBy({ name: artist.name, aliases: [] }, credit);
    return !aliasHeldBy(artist, credit);
  }
  var aliasFormUrl = (mbid) => `${location.origin}/artist/${mbid}/add-alias`;
  async function liveHolds(mbid, name) {
    const t0 = Date.now();
    logDebug(`+ alias: checking ${mbid}'s live aliases for "${name}"`);
    let why = "";
    const live = await Promise.race([
      mbnFetch(`${location.origin}/ws/2/artist/${mbid}?inc=aliases&fmt=json`, { headers: { Accept: "application/json" } }, { background: false }).then((r) => {
        if (!r) {
          why = "cancelled";
          return null;
        }
        if (!r.ok) {
          why = "HTTP " + r.status;
          return null;
        }
        return r.json();
      }).catch((e) => {
        why = e && e.message || String(e);
        return null;
      }),
      new Promise((res) => setTimeout(() => {
        why = `no answer in ${LIVE_TIMEOUT / 1e3}s`;
        res(null);
      }, LIVE_TIMEOUT))
    ]);
    const out = live && live.id ? { held: aliasHeldBy({ name: live.name, aliases: live.aliases || [] }, name), artistName: live.name } : null;
    if (out) logDebug(`+ alias: ${out.artistName} ${out.held ? "already carries" : "doesn't carry"} "${name}" (${Date.now() - t0} ms)`);
    else log.warn(`+ alias: couldn't read ${mbid}'s live aliases (${why || "no artist in the answer"}, ${Date.now() - t0} ms) \u2014 going ahead without the check`);
    return out;
  }
  var LIVE_TIMEOUT = 8e3;
  async function aliasNowHeld(mbid, name) {
    const live = await liveHolds(mbid, name);
    return live ? live.held : null;
  }
  async function openAddAliasForm(mbid, name, note) {
    const q = new URLSearchParams({ "edit-alias.name": name, "edit-alias.sort_name": name });
    if (note) q.set("edit-alias.edit_note", note);
    const url = aliasFormUrl(mbid) + "?" + q.toString();
    const tab = window.open("about:blank", "_blank");
    const live = await liveHolds(mbid, name);
    if (live && live.held) {
      try {
        if (tab) tab.close();
      } catch (e) {
      }
      log.info(`+ alias: "${name}" is already a name/alias of ${live.artistName} \u2014 form not opened`);
      return { already: true };
    }
    log.info(`+ alias: opening MusicBrainz's add-alias form for "${name}" \u2014 ${url.split("?")[0]}`);
    let how = "the blank tab";
    try {
      if (!tab || tab.closed) throw new Error(tab ? "the blank tab was closed" : "no tab handle (popup blocked?)");
      tab.location.href = url;
    } catch (e) {
      how = "a new tab \u2014 " + (e && e.message || e);
      try {
        if (tab) tab.close();
      } catch (e2) {
      }
      window.open(url, "_blank");
    }
    logDebug(`+ alias: form opened in ${how}`);
    return { already: false };
  }
  async function submitAliasBackground(mbid, name, note) {
    const url = aliasFormUrl(mbid);
    const live = await liveHolds(mbid, name);
    if (live && live.held) {
      log.info(`+ alias: "${name}" is already a name/alias of ${live.artistName} \u2014 nothing submitted`);
      return { already: true };
    }
    const html = await fetch(url, { credentials: "same-origin" }).then((r) => {
      if (!r.ok) throw new Error(`GET add-alias HTTP ${r.status}`);
      return r.text();
    });
    const form = new DOMParser().parseFromString(html, "text/html").querySelector("form.edit-alias");
    if (!form) throw new Error("MusicBrainz did not serve an alias form (still logged in?)");
    const p = new URLSearchParams();
    form.querySelectorAll("input, select, textarea").forEach((el) => {
      if (!el.name) return;
      if (el.type === "checkbox" || el.type === "radio") {
        if (el.checked) p.set(el.name, el.value || "1");
        return;
      }
      p.set(el.name, el.value || "");
    });
    p.set("edit-alias.name", name);
    p.set("edit-alias.sort_name", name);
    p.set("edit-alias.type_id", "");
    p.set("edit-alias.locale", "");
    p.delete("edit-alias.primary_for_locale");
    if (note) p.set("edit-alias.edit_note", note);
    log.info(`+ alias: submitting "${name}" as an alias of ${url.split("/artist/")[1].split("/")[0]} in the background (no type)`);
    const res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: p.toString() });
    if (!res.ok) throw new Error(`add-alias submit HTTP ${res.status}`);
    if (!/\/add-alias\b/.test(res.url)) return res.url;
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const msg = [...doc.querySelectorAll(".error, .errors li, p.error")].map((n) => (n.textContent || "").trim()).filter(Boolean)[0];
    throw new Error(msg || "MusicBrainz rejected the alias without saying why");
  }

  // src/split-credit.js
  var SEP_RE2 = /\s*(\bfeat\.?|\bft\.?|\bfeaturing|&|\band\b|\bvs\.?|\bwith\b|×|・|,|;)\s*/gi;
  var stripDiscogsNum = (s) => String(s || "").replace(/\s+\(\d+\)$/, "");
  function splitCreditName(name) {
    const parts = stripDiscogsNum(name).split(SEP_RE2).filter((_, i) => i % 2 === 0).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return [];
    const words = (p) => p.split(/\s+/);
    const last = words(parts[parts.length - 1]);
    if (last.length > 1 && parts.slice(0, -1).every((p) => words(p).length === 1)) {
      const surname = last[last.length - 1];
      return parts.map((p, i) => i === parts.length - 1 ? p : `${p} ${surname}`);
    }
    return parts;
  }
  var splitKey = (origKey, i) => `${origKey}#split${i}`;
  function expandSplitRoles(roles, splits, keyOfEntity) {
    if (!splits || !splits.size || !roles) return roles;
    const out = [];
    for (const role of roles) {
      const parts = role?.artist ? splits.get(keyOfEntity(role.artist)) : null;
      if (!parts) {
        out.push(role);
        continue;
      }
      for (const p of parts) {
        out.push({ ...role, creditedAs: "", artist: { name: p.name, anv: "", _syntheticKey: p.key, _splitOf: keyOfEntity(role.artist) } });
      }
    }
    return out;
  }

  // src/review-table.js
  var _urlCheckSessionCache = /* @__PURE__ */ new Map();
  function ensureCreatingStyle() {
    if (document.getElementById("ch-creating-style")) return;
    const st = document.createElement("style");
    st.id = "ch-creating-style";
    st.textContent = "@keyframes ch-creating-spin { to { transform: rotate(360deg); } }";
    document.head.appendChild(st);
  }
  async function showReviewTable(allResults, rolesMap, companiesRolesMap, opts) {
    rolesMap = rolesMap || /* @__PURE__ */ new Map();
    companiesRolesMap = companiesRolesMap || /* @__PURE__ */ new Map();
    const onRefresh = opts?.onRefresh || null;
    const headerSlot = opts?.headerSlot || null;
    const importSourceName = opts?.sourceName || "Discogs";
    const sourceIcon = opts?.sourceIcon || "";
    const entitySources = opts?.entitySources || null;
    const sourceBadgeIcon = opts?.sourceBadgeIcon || (() => "");
    const _preloadedNames = /* @__PURE__ */ new Map();
    const _nullNames = allResults.filter((r) => r.type === "resolved" && r.mbUrl && !r.mbName);
    for (const r of _nullNames) {
      const rUrl = r.entity?.resource_url;
      try {
        const idbKey = idbKeyForEntity(r.entity);
        const rec = await readIdbRecord(idbKey);
        if (rec?.name) {
          _preloadedNames.set(rUrl, { name: rec.name, dis: rec.disambiguation || "" });
          continue;
        }
        const mbid = (r.mbUrl || "").split("/").pop().replace(/[^a-f0-9-]/g, "").substring(0, 36);
        if (!mbid) continue;
        const et = r.entityType || "artist";
        const data = await mbThrottle.fetchJson(`https:${MB}/ws/2/${et}/${mbid}?fmt=json`);
        if (data?.name) {
          _preloadedNames.set(rUrl, { name: data.name, dis: data.disambiguation || "" });
          if (idbKey) {
            await writeIdbRecord(idbKey, {
              mbid,
              entityType: et,
              name: data.name,
              disambiguation: data.disambiguation || ""
              // No resolvedVia change — this is just a name-display
              // populate; whatever set the cached mbid stays the
              // source of truth for `resolvedVia`.
            });
          }
        }
      } catch (e) {
      }
    }
    return new Promise((resolve) => {
      opts?.registerAbort?.(() => resolve(null));
      const rowState = /* @__PURE__ */ new Map();
      const rowSearchInputs = /* @__PURE__ */ new Map();
      const linkState = /* @__PURE__ */ new Map();
      const rowLinkChips = /* @__PURE__ */ new Map();
      let linksNote = null;
      const splits = /* @__PURE__ */ new Map();
      function updateLinksBadge() {
        if (!linksNote) return;
        const n = [...linkState.values()].filter((v) => v === "none").length;
        linksNote.textContent = n ? `\u{1F517} ${n} link${n === 1 ? "" : "s"}` : "";
        linksNote.style.display = n ? "" : "none";
        linksNote.classList.toggle("clickable", n > 0);
      }
      const keyOf = (r) => r.entity?.resource_url || r.entity?._syntheticKey || `_nourl_${r.entity?.name || r.displayName}`;
      let _linkJumpIdx = -1;
      function jumpNextLink() {
        const n = allResults.length;
        let found = -1;
        for (let step = 1; step <= n; step++) {
          const i = (_linkJumpIdx + step) % n;
          if (linkState.get(keyOf(allResults[i])) === "none") {
            found = i;
            break;
          }
        }
        if (found === -1) return;
        _linkJumpIdx = found;
        const key = keyOf(allResults[found]);
        const chip = rowLinkChips.get(key);
        const target = chip || rowSearchInputs.get(key);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        if (chip) {
          const o = chip.style.boxShadow;
          chip.style.boxShadow = "0 0 0 3px rgba(232,119,29,0.6)";
          setTimeout(() => {
            chip.style.boxShadow = o;
          }, 1200);
        }
      }
      const attentionCount = allResults.filter((r) => r.type === "attention").length;
      const mismatchCount = allResults.filter((r) => {
        if (r.type !== "resolved") return false;
        const e = r.logEntry;
        return e && e.mbName && e.displayName && e.mbName.toLowerCase().trim() !== e.displayName.toLowerCase().trim();
      }).length;
      const URL_CHECK_CONCURRENCY = 5;
      const urlCheckPending = [];
      let urlCheckRunning = 0;
      let urlCheckStarted = false;
      function queuedUrlCheck(fn) {
        return new Promise((resolve2, reject) => {
          urlCheckPending.push({ fn, resolve: resolve2, reject });
          if (urlCheckRunning < URL_CHECK_CONCURRENCY) {
            runUrlCheckWorker();
          }
        });
      }
      async function runUrlCheckWorker() {
        urlCheckRunning++;
        while (urlCheckPending.length > 0) {
          const { fn, resolve: resolve2, reject } = urlCheckPending.shift();
          try {
            resolve2(await fn());
          } catch (e) {
            reject(e);
          }
        }
        urlCheckRunning--;
      }
      const VIA_STYLES = {
        both: { text: "name+url", color: "var(--mbu-ok)" },
        // high confidence
        "both-alias": { text: "alias+url", color: "var(--mbu-ok)" },
        // #613 URL and an exact ALIAS agree
        url: { text: "url", color: "var(--mbu-accent-text)" },
        name: { text: "name", color: "var(--mbu-accent-text)" },
        alias: { text: "alias", color: "var(--mbu-accent-text)" },
        // #613 exact alias of the MB artist (provably unique)
        ctx: { text: "context", color: "var(--mbu-ok)" },
        // #612 a related artist of the release artist
        cred: { text: "co-credit", color: "var(--mbu-accent-text)" },
        // #613 co-credit search (option)
        user: { text: "user", color: "var(--mbu-text-dim)" },
        cache: { text: "cache", color: "var(--mbu-text-dim)" }
        // legacy: original mechanism unknown
      };
      function viaCfg(via, fromCache) {
        const base = VIA_STYLES[via];
        if (!base) return null;
        if (fromCache && via !== "cache") {
          return { text: `${base.text} (cache)`, color: base.color };
        }
        return base;
      }
      function makeViaBadge(via, fromCache) {
        const cfg = viaCfg(via, fromCache);
        if (!cfg) return null;
        const span = document.createElement("span");
        span.textContent = cfg.text;
        span.title = fromCache && via !== "cache" ? `Resolved via ${via}, served from cache` : `Resolved via ${via}`;
        span.style.cssText = `font-size:0.68rem;background:var(--mbu-bg-raised);color:${cfg.color};padding:0 0.35rem;border-radius:8px;border:1px solid var(--mbu-border);flex-shrink:0;`;
        return span;
      }
      const creditOverrides = /* @__PURE__ */ new Map();
      const existingCreditByMbid = computeExistingCreditByMbid();
      function computeExistingCreditByMbid() {
        const counts = /* @__PURE__ */ new Map();
        const MB2 = pageWindow?.MB;
        const iterate = MB2?.tree?.iterate;
        if (!iterate) return counts;
        const valueOf = (yielded) => Array.isArray(yielded) ? yielded[1] : yielded;
        const isTree = (x) => x && typeof x === "object" && x.size != null && (x.left !== void 0 || x.right !== void 0 || x.value !== void 0);
        function tally(rel) {
          if (!rel || rel._status === 2) return;
          for (const side of [1, 0]) {
            const entity = rel[`entity${side}`];
            const tgt = entity?.gid;
            if (!tgt) continue;
            const credit = rel[`entity${side}_credit`] || entity.name;
            if (!credit) continue;
            if (!counts.has(tgt)) counts.set(tgt, /* @__PURE__ */ new Map());
            const m = counts.get(tgt);
            m.set(credit, (m.get(credit) || 0) + 1);
          }
        }
        function walkRels(rels) {
          if (!isTree(rels)) return;
          for (const e of iterate(rels)) tally(valueOf(e));
        }
        function walkPhraseGroups(phraseGroups) {
          if (!isTree(phraseGroups)) return;
          for (const e of iterate(phraseGroups)) {
            const pg = valueOf(e);
            if (pg?.relationships) walkRels(pg.relationships);
          }
        }
        function walkTypeGroups(byTypeId) {
          if (!isTree(byTypeId)) return;
          for (const e of iterate(byTypeId)) {
            const tg = valueOf(e);
            if (tg?.phraseGroups) walkPhraseGroups(tg.phraseGroups);
          }
        }
        function walkPerSource(perSource) {
          if (!isTree(perSource)) return;
          for (const e of iterate(perSource)) {
            walkTypeGroups(valueOf(e));
          }
        }
        function walkSource(root) {
          if (!isTree(root)) return;
          for (const e of iterate(root)) {
            walkPerSource(valueOf(e));
          }
        }
        try {
          walkSource(MB2.relationshipEditor?.state?.existingRelationshipsBySource);
        } catch (e) {
        }
        try {
          walkSource(MB2.relationshipEditor?.state?.relationshipsBySource);
        } catch (e) {
        }
        const out = /* @__PURE__ */ new Map();
        for (const [mbid, m] of counts) {
          let best = null, bestN = 0;
          for (const [credit, n] of m) {
            if (n > bestN) {
              best = credit;
              bestN = n;
            }
          }
          if (best) out.set(mbid, best);
        }
        return out;
      }
      const panel = document.createElement("div");
      panel.style.cssText = "border:2px solid var(--mbu-warn);border-radius:0.5rem;background:var(--mbu-bg);padding:1rem 1.5rem;margin:0.5rem 0;";
      {
        const _pb = document.getElementById("discogs-progress-bar");
        if (_pb) _pb.style.display = "none";
      }
      const _bar = document.querySelector(".discogs-bar");
      if (_bar) {
        _hideBar();
        const _r2 = _bar.querySelector(".discogs-bar-row2");
        if (_r2) _r2.style.marginTop = "";
      }
      const heading = document.createElement("div");
      heading.style.cssText = "display:flex;align-items:center;gap:0.6rem;margin:0 0 0.5rem;padding:0.4rem 0.6rem;border-radius:0.3rem;background:var(--mbu-warn-bg);border:1px solid var(--mbu-warn);";
      if (onRefresh) {
        const refreshBtn = document.createElement("button");
        refreshBtn.textContent = "\u{1F504} Refresh from MB";
        refreshBtn.title = "Re-resolve every entity via MusicBrainz API, ignoring the local IDB cache";
        refreshBtn.style.cssText = "font-size:0.8rem;cursor:pointer;padding:0.2rem 0.5rem;border:1px solid var(--mbu-warn);border-radius:3px;background:var(--mbu-bg);color:var(--mbu-warn);flex-shrink:0;";
        refreshBtn.addEventListener("click", () => {
          refreshBtn.disabled = true;
          refreshBtn.textContent = "\u{1F504} Refreshing\u2026";
          (panelLi || panel).remove();
          if (headerSlot) headerSlot.replaceChildren();
          onRefresh().then((freshResults) => {
            showReviewTable(freshResults, rolesMap, companiesRolesMap, opts).then((confirmedMap) => resolve(confirmedMap));
          });
        });
        heading.appendChild(refreshBtn);
      }
      const headingText = document.createElement("span");
      headingText.style.cssText = "font-weight:bold;font-size:1rem;color:var(--mbu-warn);flex:1;";
      headingText.textContent = `Review \u2014 ${allResults.length} entit${allResults.length === 1 ? "y" : "ies"}`;
      heading.appendChild(headingText);
      panel.appendChild(heading);
      const intro = document.createElement("p");
      intro.style.cssText = "margin:0 0 0.75rem;font-size:0.85rem;color:var(--mbu-text-dim);";
      intro.innerHTML = 'Review all artist matches before importing. <span style="background:var(--mbu-error-bg);color:var(--mbu-text);padding:0 0.3rem;border-radius:2px;">Red rows</span> need attention. <span style="background:var(--mbu-warn-bg);color:var(--mbu-text);padding:0 0.3rem;border-radius:2px;">Yellow rows</span> have a name mismatch \u2014 verify. Green rows are confirmed. Use the search or create buttons to resolve outstanding issues.';
      panel.appendChild(intro);
      const table = document.createElement("table");
      table.style.cssText = "border-collapse:collapse;width:100%;font-size:0.85rem;";
      const thead = document.createElement("thead");
      const hr = document.createElement("tr");
      hr.style.background = "var(--mbu-warn-bg)";
      [...entitySources ? ["Source"] : [], importSourceName + " entity", "MB match / search"].forEach((col) => {
        const th = document.createElement("th");
        th.style.cssText = "text-align:left;padding:0.3rem 0.5rem;border:1px solid var(--mbu-warn);white-space:nowrap;color:var(--mbu-text);";
        th.textContent = col;
        hr.appendChild(th);
      });
      thead.appendChild(hr);
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      async function splitRow(r, tr, parts, btn) {
        const origKey = keyOf(r);
        if (allResults.indexOf(r) < 0) return;
        btn.disabled = true;
        btn.textContent = "\u2026";
        log.info(`#605 split "${r.displayName}" \u2192 ${parts.join(" \xB7 ")}`);
        const norm2 = (s) => String(s || "").toLowerCase().trim();
        const subs = [];
        for (let i = 0; i < parts.length; i++) {
          const name = parts[i];
          const entity = { name, anv: "", _syntheticKey: splitKey(origKey, i), _splitOf: origKey, _splitFrom: r.displayName };
          let pool = (r.nameMatches || []).filter((a) => norm2(a.name) === norm2(name));
          let via = "candidates";
          if (!pool.length) {
            via = "search";
            try {
              const json = await mbThrottle.fetchJson(`${MB}/ws/2/artist?query=${encodeURIComponent(name)}&fmt=json&limit=8`);
              const all = json?.artists || [];
              const exact2 = all.filter((a) => norm2(a.name) === norm2(name));
              pool = exact2.length ? exact2 : all;
            } catch (e) {
              log.warn(`#605 split: search for "${name}" failed \u2014 ${e.message}`);
              pool = [];
            }
          }
          const exact = pool.filter((a) => norm2(a.name) === norm2(name));
          log.info(`#605 split part "${name}": ${pool.length} candidate(s) via ${via}, ${exact.length} exact`);
          const base = { entityType: "artist", entity, displayName: name, discogsHref: "", _roles: r._roles };
          if (exact.length === 1) {
            const a = exact[0], mbUrl = `${MB}/artist/${a.id}`;
            subs.push({
              ...base,
              type: "resolved",
              mbUrl,
              mbName: a.name,
              mbDisambig: a.disambiguation || "",
              logEntry: { displayName: name, discogsHref: "", mbUrl, mbName: a.name, mbDisambig: a.disambiguation || "", via: "name", fromCache: false }
            });
          } else {
            subs.push({ ...base, type: "attention", nameMatches: pool });
          }
        }
        const idx = allResults.indexOf(r);
        if (idx < 0 || !tr.isConnected) return;
        if (r._credInput?._activeMbUrl) creditOverrides.delete(r._credInput._activeMbUrl);
        rowState.delete(origKey);
        rowSearchInputs.delete(origKey);
        linkState.delete(origKey);
        if (entitySources?.has(origKey)) subs.forEach((s) => entitySources.set(keyOf(s), entitySources.get(origKey)));
        allResults.splice(idx, 1, ...subs);
        subs.forEach((s) => buildRow(s, tr));
        tr.remove();
        splits.set(origKey, subs.map((s) => ({ key: keyOf(s), name: s.displayName })));
        headingText.textContent = `Review \u2014 ${allResults.length} entit${allResults.length === 1 ? "y" : "ies"}`;
        updateLinksBadge();
        updateImportBtn();
      }
      allResults.forEach((r) => buildRow(r));
      function buildRow(r, beforeEl) {
        const entityType = r.entityType || "artist";
        const displayName = r.displayName || r.entity?.name || "";
        const discogsHref = r.discogsHref || "";
        const srcName = discogsHref ? sourceNameForUrl(discogsHref) : importSourceName;
        const e = r.logEntry || null;
        const artist = r.entity;
        const isResolved = r.type === "resolved";
        const initMbUrl = isResolved ? r.mbUrl : null;
        const _entityKey = r.entity?.resource_url || r.entity?._syntheticKey || `_nourl_${r.entity?.name || r.displayName}`;
        const _pl = _preloadedNames.get(_entityKey) || _preloadedNames.get(r.entity?.resource_url);
        const initMbName = e && e.mbName ? e.mbName : _pl?.name || (isResolved ? r.mbName : null) || null;
        const initMbDisam = e && e.mbDisambig ? e.mbDisambig : _pl?.dis || r.mbDisambig || "";
        const nameMismatch = isResolved && initMbName && initMbName.toLowerCase().trim() !== displayName.toLowerCase().trim();
        const needsAttention = r.type === "attention";
        const rowBg = needsAttention ? "var(--mbu-error-bg)" : nameMismatch ? "var(--mbu-warn-bg)" : "var(--mbu-bg)";
        const borderColor = needsAttention ? "#cc6666" : "#d4d4d4";
        const tr = document.createElement("tr");
        tr.style.cssText = `vertical-align:top;background:${rowBg};`;
        tr.dataset.entityKey = _entityKey;
        rowState.set(_entityKey, {
          mbUrl: initMbUrl,
          mbName: initMbName,
          mbDisambig: initMbDisam,
          confirmed: isResolved && !needsAttention,
          via: isResolved ? r.logEntry?.via || null : null,
          fromCache: isResolved ? r.logEntry?.fromCache || false : false
        });
        if (entitySources) {
          const tdSrc = document.createElement("td");
          tdSrc.style.cssText = `padding:0.3rem 0.5rem;border:1px solid ${borderColor};white-space:nowrap;text-align:center;`;
          const names = entitySources.get(_entityKey) || [];
          const srcUrls = (r._mergeUrls || (discogsHref ? [discogsHref] : [])).filter((u) => !isSyntheticProviderUrl(u));
          if (!names.length) {
            tdSrc.innerHTML = '<span style="color:var(--mbu-text-weak);">\u2014</span>';
          } else names.forEach((nm) => {
            const url = srcUrls.find((u) => sourceNameForUrl(u) === nm) || null;
            const span = document.createElement("span");
            span.className = "discogs-src-badge";
            span.style.cssText = "display:inline-flex;vertical-align:middle;margin:0 2px;" + (url ? "cursor:pointer;" : "filter:grayscale(1);opacity:0.45;");
            span.title = url ? `${nm} \u2014 click to open ${url}` : `${nm} \u2014 name-only credit (no link)`;
            span.innerHTML = sourceBadgeIcon(nm);
            if (url) span.addEventListener("click", () => window.open(url, "_blank", "noopener,noreferrer"));
            tdSrc.appendChild(span);
          });
          tr.appendChild(tdSrc);
        }
        const tdDiscogs = document.createElement("td");
        tdDiscogs.style.cssText = `padding:0.3rem 0.5rem;border:1px solid ${borderColor};white-space:nowrap;`;
        const nameRow = document.createElement("div");
        nameRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:0.6rem;";
        const nameWrap = document.createElement("span");
        nameWrap.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;";
        if (entityType !== "artist") {
          const badge = document.createElement("span");
          badge.textContent = entityType;
          badge.style.cssText = "font-size:0.7rem;background:var(--mbu-bg-sunken);border-radius:3px;padding:0 0.3rem;margin-right:0.3rem;color:var(--mbu-text-dim);vertical-align:middle;";
          nameWrap.appendChild(badge);
        }
        const placeholderUrl = /\/_company\//.test(discogsHref) || /\/_company\//.test(r.entity?.resource_url || "");
        const hasDiscogsUrl = !!r.entity?.resource_url && !placeholderUrl;
        const dlA = document.createElement(hasDiscogsUrl ? "a" : "span");
        dlA.href = discogsHref;
        dlA.target = "_blank";
        dlA.rel = "noopener noreferrer nofollow";
        dlA.textContent = displayName;
        if (!hasDiscogsUrl) {
          dlA.className = "discogs-entity-name";
          dlA.style.color = "var(--mbu-text)";
        }
        const _srcTitles = [...new Set((r._roles || []).map((x) => x.trackTitle).filter(Boolean))];
        if (_srcTitles.length) dlA.title = _srcTitles.join("\n");
        nameWrap.appendChild(dlA);
        const splitParts = entityType === "artist" && !r.entity?._splitOf ? splitCreditName(displayName || r.entity?.name) : [];
        if (splitParts.length) {
          const sp = document.createElement("button");
          sp.type = "button";
          sp.className = "discogs-split-btn";
          sp.textContent = "\u22D4";
          sp.title = `Split into separate artists: ${splitParts.join(" \xB7 ")}
Each gets this row's roles.`;
          sp.style.cssText = "margin-left:0.35rem;padding:0 0.35rem;min-width:1.4rem;cursor:pointer;border:1px solid var(--mbu-accent);border-radius:3px;background:var(--mbu-bg-raised);color:var(--mbu-accent-text);font-size:16px;font-weight:bold;line-height:1.2;vertical-align:middle;";
          sp.addEventListener("click", () => splitRow(r, tr, splitParts, sp));
          nameWrap.appendChild(sp);
        }
        if (r.entity?._splitOf) {
          const sb = document.createElement("span");
          sb.textContent = "split";
          sb.title = `Split from "${r.entity._splitFrom}" \u2014 gets that credit's roles`;
          sb.style.cssText = "display:inline-flex;align-items:center;margin-left:0.35rem;padding:0.05rem 0.4rem;font-size:0.65rem;font-weight:600;border-radius:0.7rem;line-height:1.4;cursor:help;background:var(--mbu-bg-sunken);color:var(--mbu-text-dim);border:1px solid var(--mbu-border);";
          nameWrap.appendChild(sb);
        }
        const BADGE_BASE = "display:inline-flex;align-items:center;margin-left:0.35rem;padding:0.05rem 0.4rem;font-size:0.65rem;font-weight:600;border-radius:0.7rem;letter-spacing:0.01em;cursor:help;text-transform:lowercase;line-height:1.4;";
        if (!hasDiscogsUrl && !placeholderUrl && srcName !== "Titles" && !r.entity?._splitOf) {
          const noUrl = document.createElement("span");
          noUrl.textContent = "no profile";
          noUrl.title = `No ${srcName} artist page \u2014 name lookup unavailable, search MB manually`;
          noUrl.style.cssText = BADGE_BASE + "background:var(--mbu-error-bg);color:var(--mbu-error);border:1px solid var(--mbu-error);";
          nameWrap.appendChild(noUrl);
        }
        if (nameMismatch) {
          const w = document.createElement("span");
          w.textContent = "name differs";
          w.title = "MB entity name differs from the Discogs display name \u2014 double-check this is the right match";
          w.style.cssText = BADGE_BASE + "background:var(--mbu-warn-bg);color:var(--mbu-warn);border:1px solid var(--mbu-warn);";
          nameWrap.appendChild(w);
        }
        nameRow.appendChild(nameWrap);
        const actionsLine = document.createElement("span");
        actionsLine.style.cssText = "display:inline-flex;align-items:center;gap:0.3rem;flex-shrink:0;";
        nameRow.appendChild(actionsLine);
        tdDiscogs.appendChild(nameRow);
        tr.appendChild(tdDiscogs);
        const rolesList = r._roles || [];
        if (rolesList.length > 0) {
          const byRole = /* @__PURE__ */ new Map();
          rolesList.forEach(({ displayLabel, linkType, trackPos }) => {
            const key = displayLabel || linkType;
            if (!key) return;
            if (!byRole.has(key)) byRole.set(key, /* @__PURE__ */ new Set());
            if (trackPos) byRole.get(key).add(String(trackPos));
          });
          const compressPositions = (posSet) => {
            const all = [...posSet];
            if (!all.length) return "";
            if (!all.every((p) => /^\d+$/.test(p))) return "[" + all.join(",") + "]";
            const nums = all.map(Number).sort((a, b) => a - b);
            const parts = [];
            for (let i = 0; i < nums.length; ) {
              let j = i;
              while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
              parts.push(j > i ? nums[i] + "-" + nums[j] : String(nums[i]));
              i = j + 1;
            }
            return "[" + parts.join(",") + "]";
          };
          const chips = [...byRole.entries()].map(([roleKey, posSet]) => {
            const pos = compressPositions(posSet);
            return { roleKey, displayText: roleKey + (pos ? " " + pos : "") };
          });
          const rolesLine = document.createElement("div");
          rolesLine.style.cssText = "font-size:0.75rem;color:var(--mbu-text-weak);margin-top:0.15rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;";
          rolesLine.title = chips.map((c) => c.displayText).join(", ");
          chips.forEach((chip, i) => {
            if (i > 0) rolesLine.appendChild(document.createTextNode(", "));
            const span = document.createElement("span");
            span.className = "discogs-role-chip";
            span.dataset.roleKey = chip.roleKey;
            span.textContent = chip.displayText;
            rolesLine.appendChild(span);
          });
          tdDiscogs.appendChild(rolesLine);
        }
        const credLine = document.createElement("div");
        credLine.style.cssText = "display:flex;align-items:center;gap:0.3rem;margin-top:1rem;padding-top:0.25rem;max-width:280px;";
        const credLabel = document.createElement("label");
        credLabel.textContent = "Credited as:";
        credLabel.style.cssText = "font-size:0.72rem;color:var(--mbu-text-weak);flex-shrink:0;";
        const credInput = noPasswordManagers(document.createElement("input"));
        const CRED_BG_SAME = "var(--mbu-bg-sunken)";
        const CRED_BG_DIFFERENT = "var(--mbu-warn-bg)";
        credInput.style.cssText = "flex:1;padding:0.15rem 0.35rem;font-size:0.78rem;border:1px solid var(--mbu-border);border-radius:3px;background:" + CRED_BG_SAME + ";";
        credInput.placeholder = displayName;
        credInput.title = `Override the credited name dispatched with every rel for this entity.
Leave empty to use the default (${srcName} name, or MB's most-frequent existing credit when known).`;
        function refreshCredBg() {
          const value = (credInput.value || "").trim();
          const same = value === "" || value === displayName;
          credInput.style.background = same ? CRED_BG_SAME : CRED_BG_DIFFERENT;
        }
        function pickPrefill(mbUrl) {
          if (r.creditOverride !== void 0 && r.creditOverride !== null && r.creditOverride !== "") {
            return r.creditOverride;
          }
          if (mbUrl) {
            const mbid = (String(mbUrl).split("/").pop() || "").replace(/[^a-f0-9-]/gi, "").slice(0, 36);
            if (mbid && existingCreditByMbid.has(mbid)) return existingCreditByMbid.get(mbid);
          }
          if (srcName === "Titles") {
            const mbName = rowState.get(_entityKey)?.mbName || r.mbName;
            if (mbName) return mbName;
          }
          return displayName;
        }
        credInput.value = pickPrefill(r.mbUrl);
        credInput._userTouched = false;
        refreshCredBg();
        let _credSaveTimer;
        credInput.addEventListener("input", () => {
          credInput._userTouched = true;
          const url = credInput._activeMbUrl;
          if (url) creditOverrides.set(url, credInput.value);
          refreshCredBg();
          clearTimeout(_credSaveTimer);
          _credSaveTimer = setTimeout(() => {
            const idbKey = idbKeyForEntity(r.entity);
            if (idbKey) writeIdbRecord(idbKey, { creditOverride: credInput.value });
          }, 500);
        });
        credInput._activeMbUrl = r.mbUrl;
        if (r.mbUrl) creditOverrides.set(r.mbUrl, credInput.value);
        const CRED_BTN_STYLE = "flex-shrink:0;padding:0.05rem 0.35rem;font-size:0.7rem;line-height:1;cursor:pointer;border:1px solid var(--mbu-warn);border-radius:3px;background:var(--mbu-bg-raised);color:var(--mbu-warn);";
        const mbBtn = document.createElement("button");
        mbBtn.type = "button";
        mbBtn.textContent = "MB";
        mbBtn.title = "Set Credited as to the MB entity name";
        mbBtn.style.cssText = CRED_BTN_STYLE;
        const dBtn = document.createElement("button");
        dBtn.type = "button";
        dBtn.textContent = srcName.charAt(0);
        dBtn.title = `Set Credited as to the ${srcName} name`;
        dBtn.style.cssText = CRED_BTN_STYLE;
        function currentMbName() {
          return rowState.get(_entityKey)?.mbName || r.mbName || null;
        }
        function refreshCredBtns() {
          const val = credInput.value;
          const mbName = currentMbName();
          mbBtn.style.display = !mbName || val === mbName ? "none" : "";
          dBtn.style.display = val === displayName ? "none" : "";
        }
        function setCredViaButton(value) {
          credInput.value = value;
          credInput._userTouched = true;
          credInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        mbBtn.addEventListener("click", () => {
          const mbName = currentMbName();
          if (mbName) setCredViaButton(mbName);
        });
        dBtn.addEventListener("click", () => setCredViaButton(displayName));
        credInput.addEventListener("input", refreshCredBtns);
        refreshCredBtns();
        credLine.appendChild(credLabel);
        credLine.appendChild(credInput);
        credLine.appendChild(mbBtn);
        credLine.appendChild(dBtn);
        tdDiscogs.appendChild(credLine);
        r._credInput = credInput;
        r._refreshCredBtns = refreshCredBtns;
        const tdMb = document.createElement("td");
        tdMb.style.cssText = `padding:0.3rem 0.5rem;border:1px solid ${borderColor};min-width:240px;`;
        const candidateList = document.createElement("div");
        candidateList.style.cssText = "display:flex;flex-direction:column;gap:0.2rem;margin-bottom:0.3rem;";
        const searchRow = document.createElement("div");
        searchRow.style.cssText = "display:flex;gap:0.3rem;";
        const searchInput = noPasswordManagers(document.createElement("input"));
        searchInput.value = displayName;
        searchInput.style.cssText = "flex:1;padding:0.15rem 0.35rem;font-size:0.82rem;border:1px solid var(--mbu-border);border-radius:3px;";
        rowSearchInputs.set(_entityKey, searchInput);
        const searchBtn = document.createElement("button");
        searchBtn.type = "button";
        searchBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.65" y2="16.65"/></svg>';
        searchBtn.title = "Search MusicBrainz";
        searchBtn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;padding:0 0.45rem;cursor:pointer;color:var(--mbu-text-dim);background:var(--mbu-bg);border:1px solid var(--mbu-border);border-radius:3px;";
        searchRow.appendChild(searchBtn);
        searchRow.appendChild(searchInput);
        tdMb.appendChild(candidateList);
        tdMb.appendChild(searchRow);
        tr.appendChild(tdMb);
        const tdAction = actionsLine;
        tbody.insertBefore(tr, beforeEl || null);
        function buildMbRolesEl(explicitMbid) {
          if (entityType !== "artist") return null;
          const wrap = document.createElement("span");
          wrap.style.cssText = "display:inline-flex;align-items:center;gap:0.25rem;margin-left:0.5rem;min-width:0;overflow:hidden;font-size:0.72rem;";
          const trigger = document.createElement("a");
          trigger.href = "#";
          trigger.textContent = "MB roles \u25BE";
          trigger.style.cssText = "color:var(--mbu-info);text-decoration:none;cursor:pointer;white-space:nowrap;";
          trigger.title = "Fetch this artist's existing MB relationship types to compare with the Discogs role";
          trigger.addEventListener("click", async (ev) => {
            ev.preventDefault();
            let mbid = (String(explicitMbid || "").match(/[a-f0-9-]{36}/i) || [])[0];
            if (!mbid) {
              const st = rowState.get(_entityKey);
              const curUrl = st?.mbUrl || r.mbUrl;
              mbid = (String(curUrl || "").split("/").pop() || "").replace(/[^a-f0-9-]/gi, "").slice(0, 36);
            }
            if (!mbid) {
              trigger.textContent = "MB roles: (none selected)";
              return;
            }
            trigger.textContent = "MB roles\u2026";
            const types = await fetchArtistRelTypes(mbid);
            wrap.innerHTML = "";
            const label = document.createElement("span");
            label.style.color = "var(--mbu-text-dim)";
            if (!types) {
              label.textContent = "MB roles: fetch failed";
              label.style.color = "var(--mbu-error)";
              wrap.appendChild(label);
              return;
            }
            if (!types.length) {
              label.textContent = "MB roles: none";
              wrap.appendChild(label);
              return;
            }
            label.textContent = "MB roles: ";
            label.style.whiteSpace = "nowrap";
            label.style.flex = "0 0 auto";
            wrap.style.alignItems = "flex-start";
            wrap.style.overflow = "visible";
            wrap.appendChild(label);
            wrap.title = types.join(", ");
            const chipsBox = document.createElement("span");
            chipsBox.style.cssText = "display:flex;flex-wrap:wrap;gap:0.25rem;min-width:0;";
            wrap.appendChild(chipsBox);
            types.forEach((t) => {
              const c = document.createElement("span");
              c.textContent = t;
              c.style.cssText = "background:var(--mbu-info-bg);border:1px solid var(--mbu-border);border-radius:0.7rem;padding:0 0.4rem;color:var(--mbu-info);white-space:nowrap;";
              chipsBox.appendChild(c);
            });
          });
          wrap.appendChild(trigger);
          return wrap;
        }
        let _creatingEl = null;
        let _creatingTimer = null;
        let _creatingCancel = null;
        function setRowCreating(name, onCancel) {
          ensureCreatingStyle();
          if (_creatingTimer) {
            clearTimeout(_creatingTimer);
            _creatingTimer = null;
          }
          if (_creatingEl) _creatingEl.remove();
          _creatingCancel = onCancel || null;
          candidateList.style.display = "none";
          tdAction.innerHTML = "";
          searchInput.disabled = true;
          searchBtn.disabled = true;
          const ph = document.createElement("div");
          ph.className = "ch-creating";
          ph.style.cssText = "padding:0.15rem 0.4rem;border:1px dashed var(--mbu-info);border-radius:3px;background:var(--mbu-bg);display:flex;align-items:center;gap:0.4rem;font-size:0.85rem;color:var(--mbu-info);font-style:italic;margin-bottom:0.3rem;";
          const spin = document.createElement("span");
          spin.textContent = "\u27F3";
          spin.style.cssText = "display:inline-block;animation:ch-creating-spin 0.9s linear infinite;";
          ph.appendChild(spin);
          const txt = document.createElement("span");
          txt.textContent = `Creating ${name} in the background\u2026`;
          ph.appendChild(txt);
          const x = document.createElement("button");
          x.textContent = "\u2715";
          x.title = "Cancel \u2014 stop waiting and restore the row";
          x.style.cssText = "margin-left:auto;font-size:0.75rem;line-height:1;cursor:pointer;border:none;background:none;color:var(--mbu-info);padding:0 0.2rem;";
          x.addEventListener("click", () => cancelCreating());
          ph.appendChild(x);
          tdMb.insertBefore(ph, candidateList);
          _creatingEl = ph;
          tr.style.background = "var(--mbu-info-bg)";
          _creatingTimer = setTimeout(() => {
            _creatingTimer = null;
            cancelCreating();
          }, 9e4);
        }
        function cancelCreating() {
          if (_creatingCancel) {
            try {
              _creatingCancel();
            } catch (e2) {
            }
          }
          clearRowCreating(true);
        }
        function clearRowCreating(restore) {
          if (_creatingTimer) {
            clearTimeout(_creatingTimer);
            _creatingTimer = null;
          }
          _creatingCancel = null;
          if (_creatingEl) {
            _creatingEl.remove();
            _creatingEl = null;
          }
          candidateList.style.display = "";
          if (restore) {
            searchInput.disabled = false;
            searchBtn.disabled = false;
            tr.style.background = "";
            renderActions(null);
          }
        }
        let aliasPick = null;
        let rowViaBadge = null, rowMatchId = null;
        function aliasLanded(a) {
          if (r.logEntry?.via !== "url" || !rowViaBadge || rowMatchId !== a.id) return;
          const nb = makeViaBadge("both-alias", false);
          if (nb) {
            rowViaBadge.replaceWith(nb);
            rowViaBadge = nb;
          }
          r.logEntry.via = "both-alias";
          r.logEntry.fromCache = false;
          const st = rowState.get(_entityKey);
          if (st) {
            st.via = "both-alias";
            st.fromCache = false;
          }
          const k = idbKeyForEntity(r.entity);
          if (k) writeIdbRecord(k, { resolvedVia: "both-alias" });
          log.info(`+ alias: "${displayName}" \u2192 ${a.name} is now an alias+url match (was url)${k ? ", cached" : ""}`);
        }
        function makeAddAliasBtn(a) {
          if (!wantsAliasButton(entityType, a, displayName)) return null;
          const ab = document.createElement("button");
          ab.type = "button";
          ab.className = "discogs-add-alias";
          ab.textContent = "+ alias";
          ab.title = `Add "${displayName}" as an alias of ${a.name}
\u2022 click: open MusicBrainz's add-alias form, pre-filled (you submit it)
\u2022 right-click: submit it in the background (no alias type)`;
          ab.style.cssText = "font-size:0.72rem;cursor:pointer;padding:0 0.4rem;border:1px solid var(--mbu-accent);border-radius:3px;background:var(--mbu-bg);color:var(--mbu-accent-text);white-space:nowrap;flex:0 0 auto;";
          const note = buildCreateNote(`Added "${displayName}" as an alias \u2014 the ${srcName} credit${discogsHref ? " (" + discogsHref + ")" : ""} \u2014`);
          ab.addEventListener("click", async (ev) => {
            ev.preventDefault();
            logDebug(`+ alias: click on "${displayName}" \u2192 ${a.name} (${a.id})`);
            let res;
            try {
              res = await openAddAliasForm(a.id, displayName, note);
            } catch (e2) {
              log.warn(`+ alias: opening the form for "${displayName}" failed \u2014 ${e2 && e2.message || e2}`);
              return;
            }
            if (res && res.already) {
              ab.textContent = "\u2713 has alias";
              ab.disabled = true;
              ab.title = `${a.name} already carries "${displayName}" \u2014 nothing to add`;
              ab.style.color = "var(--mbu-ok)";
              ab.style.borderColor = "var(--mbu-ok)";
              aliasLanded(a);
              return;
            }
            if (ab._aliasWatch) return;
            let checking = false;
            const onReturn = async () => {
              if (document.visibilityState !== "visible" || checking || ab.disabled) return;
              checking = true;
              const held = await aliasNowHeld(a.id, displayName);
              checking = false;
              if (held !== true) {
                log.info(`+ alias: "${displayName}" isn't on ${a.name} yet${held === null ? " (lookup failed)" : ""} \u2014 checked on return to this tab`);
                return;
              }
              document.removeEventListener("visibilitychange", onReturn);
              window.removeEventListener("focus", onReturn);
              ab._aliasWatch = null;
              ab.textContent = "\u2713 alias";
              ab.disabled = true;
              ab.title = `"${displayName}" is now an alias of ${a.name}`;
              ab.style.color = "var(--mbu-ok)";
              ab.style.borderColor = "var(--mbu-ok)";
              a.aliases = [...a.aliases || [], displayName];
              log.info(`+ alias: "${displayName}" is now an alias of ${a.name} (added through the form)`);
              aliasLanded(a);
            };
            ab._aliasWatch = onReturn;
            setTimeout(() => {
              document.addEventListener("visibilitychange", onReturn);
              window.addEventListener("focus", onReturn);
            }, 600);
          });
          ab.addEventListener("contextmenu", async (ev) => {
            ev.preventDefault();
            logDebug(`+ alias: right-click on "${displayName}" \u2192 ${a.name} (${a.id})${ab.disabled ? " \u2014 ignored, the button is busy or done" : ""}`);
            if (ab.disabled) return;
            ab.disabled = true;
            ab.textContent = "\u23F3 alias";
            try {
              const res = await submitAliasBackground(a.id, displayName, note);
              ab.textContent = res && res.already ? "\u2713 has alias" : "\u2713 alias";
              ab.title = res && res.already ? `${a.name} already carries "${displayName}" \u2014 nothing submitted` : `"${displayName}" submitted as an alias of ${a.name}`;
              ab.style.color = "var(--mbu-ok)";
              ab.style.borderColor = "var(--mbu-ok)";
              a.aliases = [...a.aliases || [], displayName];
              aliasLanded(a);
              if (!(res && res.already)) log.info(`+ alias: "${displayName}" submitted as an alias of <a href="${location.origin}/artist/${a.id}/aliases" target="_blank" rel="noopener noreferrer nofollow">${a.name}</a>`);
            } catch (e2) {
              ab.disabled = false;
              ab.textContent = "\u2717 alias";
              ab.title = `Adding the alias failed: ${e2.message} \u2014 right-click to retry, click to open the form`;
              ab.style.color = "var(--mbu-error)";
              ab.style.borderColor = "var(--mbu-error)";
              log.warn(`+ alias: "${displayName}" \u2192 ${a.name} failed \u2014 ${e2.message}`);
            }
          });
          return ab;
        }
        function setRowResolved(a) {
          aliasPick = a;
          clearRowCreating();
          const mbUrl = `${MB}/${entityType}/${a.id}`;
          rowState.set(_entityKey, { mbUrl, mbName: a.name, mbDisambig: a.disambiguation || "", confirmed: true, via: "user", fromCache: false });
          if (r._credInput) {
            const oldUrl = r._credInput._activeMbUrl;
            if (oldUrl && oldUrl !== mbUrl) creditOverrides.delete(oldUrl);
            r._credInput._activeMbUrl = mbUrl;
            if (!r._credInput._userTouched) {
              const fresh = pickPrefill(mbUrl);
              r._credInput.value = fresh;
            }
            creditOverrides.set(mbUrl, r._credInput.value);
            refreshCredBg();
            if (r._refreshCredBtns) r._refreshCredBtns();
          }
          const _idbKey = idbKeyForEntity(r.entity);
          if (_idbKey) {
            writeIdbRecord(_idbKey, {
              mbid: a.id,
              entityType,
              name: a.name,
              disambiguation: a.disambiguation || "",
              resolvedVia: "user"
              // user picked this in the review table
            });
          }
          tr.style.background = "var(--mbu-ok-bg)";
          searchInput.disabled = true;
          searchBtn.disabled = true;
          candidateList.innerHTML = "";
          const selRow = document.createElement("div");
          selRow.style.cssText = "padding:0.15rem 0.4rem;border:1px solid var(--mbu-ok);border-radius:3px;background:var(--mbu-ok-bg);display:flex;flex-wrap:wrap;align-items:center;gap:0.4rem;font-size:0.85rem;";
          const selA = document.createElement("a");
          selA.href = "https:" + mbUrl;
          selA.target = "_blank";
          selA.rel = "noopener noreferrer nofollow";
          selA.textContent = "\u2713 " + a.name + (a.disambiguation ? ` (${a.disambiguation})` : "");
          selA.style.fontWeight = "bold";
          selA.style.whiteSpace = "nowrap";
          selA.style.flex = "0 0 auto";
          const undoBtn = document.createElement("button");
          undoBtn.textContent = "\u2715";
          undoBtn.title = "Clear selection";
          undoBtn.style.cssText = "font-size:0.75rem;cursor:pointer;padding:0 0.3rem;margin-left:auto;";
          undoBtn.addEventListener("click", () => setRowUnresolved());
          selRow.appendChild(selA);
          const viaBadge = makeViaBadge("user", false);
          if (viaBadge) selRow.appendChild(viaBadge);
          const mbRolesEl = buildMbRolesEl();
          if (mbRolesEl) selRow.appendChild(mbRolesEl);
          selRow.appendChild(undoBtn);
          candidateList.appendChild(selRow);
          renderActions(a);
          updateImportBtn();
        }
        function setRowUnresolved() {
          aliasPick = null;
          clearRowCreating();
          rowState.set(_entityKey, { mbUrl: null, mbName: null, mbDisambig: "", confirmed: false, via: null, fromCache: false });
          if (r._credInput && r._credInput._activeMbUrl) {
            creditOverrides.delete(r._credInput._activeMbUrl);
            r._credInput._activeMbUrl = null;
          }
          tr.style.background = "var(--mbu-error-bg)";
          searchInput.disabled = false;
          searchBtn.disabled = false;
          candidateList.innerHTML = "";
          const none = document.createElement("div");
          none.style.cssText = "font-size:0.82rem;color:var(--mbu-text-weak);";
          none.textContent = "No selection \u2014 search or create";
          candidateList.appendChild(none);
          renderActions(null);
          updateImportBtn();
        }
        const ACTION_CHIP_STYLE = "display:inline-flex;align-items:center;justify-content:center;min-width:1.6rem;height:1.6rem;padding:0 0.35rem;font-size:0.95rem;line-height:1;cursor:pointer;border:1px solid var(--mbu-border);border-radius:0.3rem;background:var(--mbu-bg-raised);";
        function renderActions(selected) {
          tdAction.innerHTML = "";
          if (!selected) {
            linkState.delete(_entityKey);
            rowLinkChips.delete(_entityKey);
            updateLinksBadge();
          }
          const noLinkUi = selected && (isSyntheticProviderUrl(discogsHref) || SPECIAL_PURPOSE_ARTISTS.has(selected.id));
          if (noLinkUi) {
            linkState.delete(_entityKey);
            rowLinkChips.delete(_entityKey);
            updateLinksBadge();
          }
          if (selected && !noLinkUi) {
            let recheckUrlBypassCache = function() {
              _urlCheckSessionCache.delete(urlCheckCacheKey);
              try {
                localStorage.removeItem(urlCheckLsKey);
              } catch (e2) {
              }
              queuedUrlCheck(
                () => fetchWithRetry(`${MB}/ws/2/url?resource=${encodeURIComponent(discogsHref)}&inc=${entityType}-rels&fmt=json`).then((json) => {
                  const linkedIds = (json.relations || []).filter((r2) => r2[entityType]).map((r2) => r2[entityType].id);
                  const result = linkedIds.includes(selected.id) ? "linked" : linkedIds.length > 0 ? "other" : "none";
                  _urlCheckSessionCache.set(urlCheckCacheKey, result);
                  try {
                    localStorage.setItem(urlCheckLsKey, JSON.stringify({ date: urlCheckToday, result }));
                  } catch (e2) {
                  }
                  const healKey = parseSourceEntityUrl(r.entity?.resource_url)?.key;
                  if (healKey) writeIdbRecord(healKey, { urlLinkedIds: linkedIds });
                  applyUrlCheckResult(result);
                }).catch(() => applyUrlCheckResult("none"))
              );
            }, applyUrlCheckResult = function(result) {
              linkState.set(_entityKey, result);
              if (result !== "none") rowLinkChips.delete(_entityKey);
              updateLinksBadge();
              if (result === "linked") {
                linkSlot.textContent = "\u2713";
                linkSlot.title = srcName + " URL already linked to this MB " + entityType;
                linkSlot.style.color = "var(--mbu-ok)";
                linkSlot.style.fontWeight = "bold";
              } else if (result === "other") {
                linkSlot.textContent = "\u26A0\uFE0F";
                linkSlot.title = `${srcName} URL is linked to a DIFFERENT MB ${entityType}`;
                linkSlot.style.color = "var(--mbu-warn)";
              } else {
                linkSlot.textContent = "";
                linkSlot.style.color = "";
                const addLinkBtn = document.createElement("button");
                const _addCount = r._mergeUrls && r._mergeUrls.length ? r._mergeUrls.filter((u) => sourceUrlLinkTypeId(u, entityType)).length : 0;
                addLinkBtn.textContent = "\u{1F517}" + (_addCount > 1 ? " " + _addCount : "");
                addLinkBtn.title = (_addCount > 1 ? `Add ${_addCount} source links to MB ${entityType}` : `Add ${srcName} link to MB ${entityType}`) + `  \xB7  right-click: add ${_addCount > 1 ? "them" : "it"} silently in the background`;
                addLinkBtn.style.cssText = ACTION_CHIP_STYLE + "color:var(--mbu-warn);";
                const openLinkEdit = (background) => {
                  const urls = r._mergeUrls && r._mergeUrls.length ? r._mergeUrls : [discogsHref];
                  const p = new URLSearchParams();
                  let n = 0;
                  for (const u of urls) {
                    const lt = sourceUrlLinkTypeId(u, entityType);
                    if (!lt) continue;
                    p.set(`edit-${entityType}.url.${n}.text`, u);
                    p.set(`edit-${entityType}.url.${n}.link_type_id`, lt);
                    n++;
                  }
                  if (!n) return;
                  p.set(`edit-${entityType}.edit_note`, buildCreateNote(n > 1 ? `Added ${n} source links` : `Added ${srcName} link`));
                  const mbid = selected.id.replace(/.*\//, "").replace(/[^a-f0-9-]/gi, "").substring(0, 36);
                  const editUrl = `https:${MB}/${entityType}/${mbid}/edit?${p}`;
                  if (background && typeof GM_openInTab === "function") {
                    const editTab = GM_openInTab(`${editUrl}#ch-autocommit`, { active: false, insert: true });
                    const onCommitted = (evt) => {
                      if (evt.data?.type !== "edit-committed" || evt.data.id !== mbid) return;
                      DISCOGS_CHANNEL.removeEventListener("message", onCommitted);
                      try {
                        if (editTab && typeof editTab.close === "function") editTab.close();
                      } catch (e2) {
                      }
                      recheckUrlBypassCache();
                    };
                    DISCOGS_CHANNEL.addEventListener("message", onCommitted);
                    linkSlot.innerHTML = "";
                    linkSlot.textContent = "\u2026";
                    linkSlot.title = `Adding ${srcName} link in the background\u2026`;
                    linkSlot.style.color = "var(--mbu-text-dim)";
                    linkSlot.style.fontStyle = "italic";
                    return;
                  }
                  const linkTab = window.open(editUrl, "_blank");
                  if (linkTab) {
                    const trySet = () => {
                      try {
                        linkTab.sessionStorage.setItem("discogs-importer-close-after-edit", "1");
                      } catch (e2) {
                        setTimeout(trySet, 50);
                      }
                    };
                    trySet();
                  }
                  linkSlot.innerHTML = "";
                  linkSlot.textContent = "\u2026";
                  linkSlot.title = `Verifying ${srcName} link on return to this tab\u2026`;
                  linkSlot.style.color = "var(--mbu-text-dim)";
                  linkSlot.style.fontStyle = "italic";
                  const onReturn = () => {
                    if (document.visibilityState !== "visible") return;
                    document.removeEventListener("visibilitychange", onReturn);
                    window.removeEventListener("focus", onReturn);
                    recheckUrlBypassCache();
                  };
                  document.addEventListener("visibilitychange", onReturn);
                  window.addEventListener("focus", onReturn);
                };
                addLinkBtn.addEventListener("click", () => openLinkEdit(false));
                addLinkBtn.addEventListener("contextmenu", (e2) => {
                  e2.preventDefault();
                  openLinkEdit(true);
                });
                linkSlot.appendChild(addLinkBtn);
                rowLinkChips.set(_entityKey, addLinkBtn);
              }
            };
            const linkSlot = document.createElement("span");
            linkSlot.style.cssText = "display:inline-flex;align-items:center;font-size:0.8rem;color:var(--mbu-text-weak);";
            linkSlot.textContent = "\u2026";
            linkSlot.title = `Checking whether MB already has this ${srcName} URL linked`;
            tdAction.appendChild(linkSlot);
            const urlCheckCacheKey = `${selected.id}|${discogsHref}`;
            const urlCheckLsKey = `discogs-urlcheck-${selected.id}-${hashKey(discogsHref)}`;
            const urlCheckToday = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
            const urlCheckExpiry = /* @__PURE__ */ new Date();
            urlCheckExpiry.setDate(urlCheckExpiry.getDate() - 7);
            const urlCheckExpiryStr = urlCheckExpiry.toISOString().slice(0, 10);
            let urlCheckCached = _urlCheckSessionCache.get(urlCheckCacheKey) ?? null;
            if (urlCheckCached === null) {
              try {
                const s = JSON.parse(localStorage.getItem(urlCheckLsKey) || "null");
                if (s?.date >= urlCheckExpiryStr) urlCheckCached = s.result;
              } catch (e2) {
              }
              if (urlCheckCached !== null) _urlCheckSessionCache.set(urlCheckCacheKey, urlCheckCached);
            }
            if (!discogsHref || placeholderUrl) {
              linkState.set(_entityKey, "na");
              rowLinkChips.delete(_entityKey);
              updateLinksBadge();
              if (srcName === "Titles" || placeholderUrl || r.entity?._splitOf) {
                linkSlot.remove();
              } else {
                linkSlot.textContent = `\u26A0 No ${srcName} page`;
                linkSlot.style.color = "var(--mbu-warn)";
              }
            } else if (urlCheckCached !== null) {
              applyUrlCheckResult(urlCheckCached);
            } else if (Array.isArray(r.urlLinkedIds)) {
              const result = r.urlLinkedIds.includes(selected.id) ? "linked" : r.urlLinkedIds.length > 0 ? "other" : "none";
              _urlCheckSessionCache.set(urlCheckCacheKey, result);
              try {
                localStorage.setItem(urlCheckLsKey, JSON.stringify({ date: urlCheckToday, result }));
              } catch (e2) {
              }
              applyUrlCheckResult(result);
            } else {
              queuedUrlCheck(
                () => fetchWithRetry(`${MB}/ws/2/url?resource=${encodeURIComponent(discogsHref)}&inc=${entityType}-rels&fmt=json`).then((json) => {
                  const linkedIds = (json.relations || []).filter((r2) => r2[entityType]).map((r2) => r2[entityType].id);
                  const result = linkedIds.includes(selected.id) ? "linked" : linkedIds.length > 0 ? "other" : "none";
                  _urlCheckSessionCache.set(urlCheckCacheKey, result);
                  try {
                    localStorage.setItem(urlCheckLsKey, JSON.stringify({ date: urlCheckToday, result }));
                  } catch (e2) {
                  }
                  const healKey = parseSourceEntityUrl(r.entity?.resource_url)?.key;
                  if (healKey) writeIdbRecord(healKey, { urlLinkedIds: linkedIds });
                  applyUrlCheckResult(result);
                }).catch(() => applyUrlCheckResult("none"))
              );
            }
          }
          function openCreateTab({ name, disambiguation, background } = {}) {
            const finalName = (name || displayName).trim();
            const seedUrls = (params, et) => {
              const urls = r._mergeUrls && r._mergeUrls.length ? r._mergeUrls : [discogsHref];
              let n = 0;
              for (const u of urls) {
                if (!u) continue;
                const lt = sourceUrlLinkTypeId(u, et);
                if (!lt) continue;
                params[`edit-${et}.url.${n}.text`] = u;
                params[`edit-${et}.url.${n}.link_type_id`] = lt;
                n++;
              }
            };
            let createUrl;
            let createParams;
            if (entityType === "artist") {
              createParams = {
                "edit-artist.name": finalName,
                "edit-artist.sort_name": mbmGuessSortName(finalName),
                "edit-artist.type_id": "1"
              };
              seedUrls(createParams, "artist");
              if (disambiguation) createParams["edit-artist.comment"] = disambiguation;
              createParams["edit-artist.edit_note"] = buildCreateNote();
              createUrl = `https:${MB}/artist/create`;
            } else {
              createParams = {
                [`edit-${entityType}.name`]: finalName
              };
              seedUrls(createParams, entityType);
              if (disambiguation) createParams[`edit-${entityType}.comment`] = disambiguation;
              createParams[`edit-${entityType}.edit_note`] = buildCreateNote();
              createUrl = `https:${MB}/${entityType}/create`;
            }
            const p = new URLSearchParams(createParams);
            const pendingKey = r.entity?.resource_url || r.entity?._syntheticKey || `_nourl_${r.entity?.name || displayName}`;
            let bgTab = null;
            if (background && typeof GM_openInTab === "function") {
              const url = `${createUrl}?${p}#ch-autocommit=${encodeURIComponent(pendingKey)}`;
              bgTab = GM_openInTab(url, { active: false, insert: true });
            } else {
              const newTab = window.open(`${createUrl}?${p}`, "_blank");
              if (newTab) {
                const trySet = () => {
                  try {
                    newTab.sessionStorage.setItem("discogs-importer-pending-artist", pendingKey);
                  } catch (e2) {
                    setTimeout(trySet, 50);
                  }
                };
                trySet();
              }
            }
            const onCreated = (evt) => {
              if (evt.data?.type !== "artist-created") return;
              if (evt.data.resourceUrl !== pendingKey) return;
              DISCOGS_CHANNEL.removeEventListener("message", onCreated);
              try {
                if (bgTab && typeof bgTab.close === "function") bgTab.close();
              } catch (e2) {
              }
              _urlCheckSessionCache.set(`${evt.data.id}|${discogsHref}`, "linked");
              if (evt.data.name) {
                setRowResolved({ id: evt.data.id, name: evt.data.name, disambiguation: evt.data.disambiguation });
              } else {
                setRowResolved({ id: evt.data.id, name: finalName || displayName || "", disambiguation: "" });
                fetchWithRetry(`${MB}/ws/2/${entityType}/${evt.data.id}?fmt=json`).then((json) => {
                  if (json && json.name) setRowResolved({ id: evt.data.id, name: json.name, disambiguation: json.disambiguation || "" });
                }).catch(() => {
                });
              }
            };
            DISCOGS_CHANNEL.addEventListener("message", onCreated);
            if (background && typeof GM_openInTab === "function") {
              setRowCreating(finalName, () => {
                DISCOGS_CHANNEL.removeEventListener("message", onCreated);
                try {
                  if (bgTab && typeof bgTab.close === "function") bgTab.close();
                } catch (e2) {
                }
              });
            }
          }
          const createBtn = document.createElement("button");
          createBtn.textContent = "+";
          createBtn.title = (discogsHref ? `Create in MB with default ${srcName} name + URL` : "Create in MB with the credited name") + "  \xB7  right-click: create silently in a background tab (auto-submitted)";
          createBtn.style.cssText = ACTION_CHIP_STYLE + "color:var(--mbu-ok);font-size:1.15rem;font-weight:600;";
          createBtn.addEventListener("click", () => openCreateTab());
          createBtn.addEventListener("contextmenu", (e2) => {
            e2.preventDefault();
            openCreateTab({ background: true });
          });
          const createAdvBtn = document.createElement("button");
          createAdvBtn.textContent = "\u25BE";
          createAdvBtn.title = "Create in MB with editable name + disambiguation" + (srcName === "Discogs" && discogsHref ? ", pre-filled from the Discogs profile" : "");
          createAdvBtn.style.cssText = ACTION_CHIP_STYLE + "color:var(--mbu-text-dim);";
          createAdvBtn.addEventListener("click", () => openAdvancedCreatePopup());
          tdAction.appendChild(createBtn);
          tdAction.appendChild(createAdvBtn);
          async function openAdvancedCreatePopup() {
            const distinctRoles = [];
            const seen = /* @__PURE__ */ new Set();
            for (const role of r._roles || []) {
              const label = (role.displayLabel || role.linkType || "").trim();
              if (!label || seen.has(label)) continue;
              seen.add(label);
              distinctRoles.push(label);
              if (distinctRoles.length === 3) break;
            }
            const defaultDis = distinctRoles.join(", ");
            const overlay = document.createElement("div");
            overlay.className = "mbu-ui";
            overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center;";
            const modal = document.createElement("div");
            modal.style.cssText = "background:var(--mbu-bg);border-radius:0.5rem;padding:1.1rem 1.35rem 1rem;max-width:600px;width:92%;max-height:82vh;display:flex;flex-direction:column;gap:0.55rem;box-shadow:0 12px 32px rgba(0,0,0,0.32);font-family:inherit;";
            const heading2 = document.createElement("div");
            heading2.style.cssText = "font-weight:bold;font-size:1.02rem;color:var(--mbu-text);margin-bottom:0.15rem;";
            heading2.textContent = `Create ${entityType} in MusicBrainz`;
            modal.appendChild(heading2);
            const FIELD_LABEL = "font-size:0.78rem;color:var(--mbu-text-dim);font-weight:600;letter-spacing:0.02em;text-transform:uppercase;margin-top:0.25rem;";
            const FIELD_INPUT = "padding:0.45rem 0.55rem;border:1px solid var(--mbu-border);border-radius:0.3rem;font-size:0.93rem;font-family:inherit;";
            const nameLabel = document.createElement("label");
            nameLabel.style.cssText = FIELD_LABEL;
            nameLabel.textContent = "Name";
            modal.appendChild(nameLabel);
            const nameInput = noPasswordManagers(document.createElement("input"));
            nameInput.value = displayName;
            nameInput.style.cssText = FIELD_INPUT;
            modal.appendChild(nameInput);
            let nameUserTouched = false;
            nameInput.addEventListener("input", () => {
              nameUserTouched = true;
            });
            const disLabel = document.createElement("label");
            disLabel.style.cssText = FIELD_LABEL;
            disLabel.textContent = "Disambiguation";
            modal.appendChild(disLabel);
            const disInput = noPasswordManagers(document.createElement("input"));
            disInput.value = defaultDis;
            disInput.style.cssText = FIELD_INPUT;
            modal.appendChild(disInput);
            let disUserTouched = false;
            disInput.addEventListener("input", () => {
              disUserTouched = true;
            });
            const showProfile = srcName === "Discogs" && !!discogsHref;
            let profileBox = null;
            if (showProfile) {
              const profileLabel = document.createElement("div");
              profileLabel.style.cssText = "font-size:0.78rem;color:var(--mbu-text-weak);margin-top:0.55rem;";
              profileLabel.textContent = "Discogs profile \u2014 select text to copy into Disambiguation";
              modal.appendChild(profileLabel);
              profileBox = document.createElement("div");
              profileBox.style.cssText = "border:1px solid var(--mbu-border);border-radius:0.3rem;padding:0.5rem 0.6rem;background:var(--mbu-bg-raised);font-size:0.85rem;line-height:1.5;white-space:pre-wrap;overflow:auto;min-height:5rem;max-height:18rem;flex:1;color:var(--mbu-text);";
              profileBox.textContent = "Loading profile from Discogs\u2026";
              modal.appendChild(profileBox);
              const captureSelection = () => {
                const sel = window.getSelection();
                if (!sel || sel.isCollapsed) return;
                if (!profileBox.contains(sel.anchorNode)) return;
                const text = sel.toString().trim();
                if (!text) return;
                disInput.value = text;
                disUserTouched = true;
              };
              profileBox.addEventListener("mouseup", captureSelection);
              profileBox.addEventListener("keyup", captureSelection);
            }
            const btnRow2 = document.createElement("div");
            btnRow2.style.cssText = "display:flex;gap:0.5rem;justify-content:flex-end;margin-top:0.55rem;";
            const cancelBtn = document.createElement("button");
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = "padding:0.4rem 1rem;cursor:pointer;border:1px solid var(--mbu-border);border-radius:0.25rem;background:var(--mbu-bg-raised);color:var(--mbu-text);font-size:0.88rem;";
            const submitBtn = document.createElement("button");
            submitBtn.textContent = "Create \u2197";
            submitBtn.title = "Open the create page, for you to review  \xB7  right-click: create silently in a background tab (auto-submitted)";
            submitBtn.style.cssText = "padding:0.4rem 1.1rem;cursor:pointer;font-weight:bold;background:var(--mbu-ok);color:var(--mbu-text-on-accent);border:none;border-radius:0.25rem;font-size:0.9rem;";
            btnRow2.appendChild(cancelBtn);
            btnRow2.appendChild(submitBtn);
            modal.appendChild(btnRow2);
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            const close = () => {
              document.removeEventListener("keydown", onKey);
              overlay.remove();
            };
            const submit = (background) => {
              const name = nameInput.value.trim();
              const dis = disInput.value.trim();
              close();
              openCreateTab({ name: name || displayName, disambiguation: dis || null, background: !!background });
            };
            const onKey = (ev) => {
              if (ev.key === "Escape") {
                close();
              } else if (ev.key === "Enter" && (ev.target === disInput || ev.target === nameInput)) submit(false);
            };
            document.addEventListener("keydown", onKey);
            overlay.addEventListener("click", (ev) => {
              if (ev.target === overlay) close();
            });
            cancelBtn.addEventListener("click", close);
            submitBtn.addEventListener("click", () => submit(false));
            submitBtn.addEventListener("contextmenu", (ev) => {
              ev.preventDefault();
              submit(true);
            });
            disInput.focus();
            disInput.select();
            if (showProfile) try {
              const data = await getDiscogsEntityData(r.entity?.resource_url);
              if (data?.realname && !nameUserTouched && data.realname.trim() !== displayName.trim()) {
                nameInput.value = data.realname.trim();
              }
              const lines = [];
              if (data?.namevariations?.length) lines.push(`Also known as: ${data.namevariations.slice(0, 6).join(", ")}`);
              if (data?.profile) {
                if (lines.length) lines.push("");
                lines.push(data.profile);
              }
              profileBox.textContent = lines.length ? lines.join("\n") : "(no Discogs profile)";
            } catch (e2) {
              profileBox.textContent = "(failed to load Discogs profile)";
            }
          }
          if (selected && aliasPick && aliasPick.id === selected.id) {
            const ab = makeAddAliasBtn(aliasPick);
            if (ab) tdAction.insertBefore(ab, tdAction.firstChild);
          }
        }
        function makeCandidateRow(a) {
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:0.35rem;padding:0.2rem 0.35rem;border:1px solid var(--mbu-border);border-radius:3px;background:var(--mbu-bg);font-size:0.82rem;";
          const selBtn = document.createElement("button");
          selBtn.textContent = "\u2713";
          selBtn.title = "Select this candidate as the MB match";
          selBtn.style.cssText = "font-size:0.95rem;line-height:1;cursor:pointer;padding:0.1rem 0.45rem;white-space:nowrap;border:1px solid var(--mbu-border);border-radius:0.25rem;background:var(--mbu-ok-bg);color:var(--mbu-ok);font-weight:600;flex-shrink:0;";
          selBtn.addEventListener("click", () => setRowResolved(a));
          row.appendChild(selBtn);
          const info = document.createElement("span");
          info.style.flex = "1";
          const nameA = document.createElement("a");
          nameA.href = `https:${MB}/${entityType}/${a.id}`;
          nameA.target = "_blank";
          nameA.rel = "noopener noreferrer nofollow";
          nameA.style.fontWeight = "bold";
          nameA.textContent = a.name;
          info.appendChild(nameA);
          if (a.disambiguation) {
            const d = document.createElement("span");
            d.style.cssText = "color:var(--mbu-text-dim);margin-left:0.25rem;";
            d.textContent = `(${a.disambiguation})`;
            info.appendChild(d);
          }
          row.appendChild(info);
          const rolesEl = buildMbRolesEl(a.id);
          if (rolesEl) {
            rolesEl.style.marginLeft = "auto";
            row.appendChild(rolesEl);
          }
          return row;
        }
        function extractMbid(q) {
          const m = q.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
          return m ? m[0] : null;
        }
        function doSearch(q) {
          if (!q) return;
          const mbid = extractMbid(q);
          if (mbid) {
            candidateList.innerHTML = '<div style="font-size:0.82rem;color:var(--mbu-text-weak);">Looking up MBID\u2026</div>';
            mbThrottle.fetchJson(`${MB}/ws/2/${entityType}/${mbid}?inc=aliases&fmt=json`).then((json) => {
              if (!json) return;
              candidateList.innerHTML = "";
              if (json.id) {
                candidateList.appendChild(makeCandidateRow({
                  id: json.id,
                  name: json.name,
                  disambiguation: json.disambiguation || "",
                  aliases: json.aliases || []
                }));
              } else {
                candidateList.innerHTML = '<div style="font-size:0.82rem;color:var(--mbu-text-weak);">Not found</div>';
              }
            }).catch(() => {
              candidateList.innerHTML = `<div style="font-size:0.82rem;color:var(--mbu-error);">MBID not found or wrong entity type</div>`;
            });
            return;
          }
          candidateList.innerHTML = '<div style="font-size:0.82rem;color:var(--mbu-text-weak);font-style:italic;">Searching\u2026</div>';
          mbThrottle.fetchJson(`${MB}/ws/2/${entityType}?query=${encodeURIComponent(q)}&fmt=json&limit=8`).then((json) => {
            if (!json) {
              candidateList.innerHTML = '<div style="font-size:0.82rem;color:var(--mbu-error);">Search failed \u2014 MB unavailable</div>';
              return;
            }
            candidateList.innerHTML = "";
            const resultKey = entityType === "label" ? "labels" : entityType === "place" ? "places" : "artists";
            if (!json[resultKey] || json[resultKey].length === 0) {
              const none = document.createElement("div");
              none.style.cssText = "font-size:0.82rem;color:var(--mbu-text-weak);";
              none.textContent = "No results";
              candidateList.appendChild(none);
            } else {
              json[resultKey].forEach((a) => candidateList.appendChild(makeCandidateRow(a)));
            }
          }).catch(() => {
            candidateList.innerHTML = '<div style="font-size:0.82rem;color:var(--mbu-error);">Search failed</div>';
          });
        }
        let searchTimer;
        searchInput.addEventListener("input", () => {
          clearTimeout(searchTimer);
          searchTimer = setTimeout(() => doSearch(searchInput.value.trim()), 300);
        });
        searchInput.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            doSearch(searchInput.value.trim());
          }
        });
        searchBtn.addEventListener("click", () => doSearch(searchInput.value.trim()));
        if (isResolved && initMbUrl) {
          const mbid = initMbUrl.replace(/.*\//, "").replace(/[^a-f0-9-]/gi, "").substring(0, 36);
          const correctedMbUrl = `${MB}/${entityType}/${mbid}`;
          const displayName2 = initMbName || mbid;
          if (!initMbName) {
            rowState.set(_entityKey, { mbUrl: initMbUrl, mbName: null, mbDisambig: "", confirmed: true, via: r.logEntry?.via || null, fromCache: r.logEntry?.fromCache || false });
            tr.style.background = "var(--mbu-warn-bg)";
          }
          const fakeA = { id: mbid, name: displayName2, disambiguation: initMbDisam };
          if (entityType === "artist" && initMbName && Array.isArray(r.mbAliases)) {
            fakeA.aliases = r.mbAliases;
            aliasPick = fakeA;
            if (wantsAliasButton(entityType, fakeA, displayName)) logDebug(`+ alias: offered on the automatic match "${displayName}" \u2192 ${initMbName} (not among its ${r.mbAliases.length} alias(es))`);
          }
          candidateList.innerHTML = "";
          const selRow = document.createElement("div");
          selRow.style.cssText = "padding:0.15rem 0.4rem;border:1px solid var(--mbu-ok);border-radius:3px;background:var(--mbu-ok-bg);display:flex;flex-wrap:wrap;align-items:center;gap:0.4rem;font-size:0.85rem;";
          const selA = document.createElement("a");
          selA.href = "https:" + correctedMbUrl;
          selA.target = "_blank";
          selA.rel = "noopener noreferrer nofollow";
          selA.textContent = "\u2713 " + displayName2 + (initMbDisam ? ` (${initMbDisam})` : "") + (!initMbName ? " \u26A0 name unknown" : "");
          selA.style.fontWeight = "bold";
          selA.style.whiteSpace = "nowrap";
          selA.style.flex = "0 0 auto";
          const undoBtn = document.createElement("button");
          undoBtn.textContent = "\u2715";
          undoBtn.title = "Clear selection";
          undoBtn.style.cssText = "font-size:0.75rem;cursor:pointer;padding:0 0.3rem;margin-left:auto;";
          undoBtn.addEventListener("click", () => setRowUnresolved());
          selRow.appendChild(selA);
          const viaBadge = makeViaBadge(r.logEntry?.via, r.logEntry?.fromCache);
          if (viaBadge) selRow.appendChild(viaBadge);
          rowViaBadge = viaBadge;
          rowMatchId = mbid;
          const mbRolesEl = buildMbRolesEl();
          if (mbRolesEl) selRow.appendChild(mbRolesEl);
          selRow.appendChild(undoBtn);
          candidateList.appendChild(selRow);
          renderActions(fakeA);
        } else if (r.nameMatches && r.nameMatches.length > 0) {
          r.nameMatches.forEach((a) => candidateList.appendChild(makeCandidateRow(a)));
          renderActions(null);
        } else {
          const none = document.createElement("div");
          none.style.cssText = "font-size:0.82rem;color:var(--mbu-text-weak);";
          none.textContent = needsAttention ? "No suggestions \u2014 search or create" : "";
          if (needsAttention) candidateList.appendChild(none);
          renderActions(null);
        }
      }
      table.appendChild(tbody);
      panel.appendChild(table);
      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:0.75rem;align-items:center;margin-top:0.75rem;flex-wrap:wrap;";
      const importBtn = document.createElement("button");
      importBtn.style.cssText = "border:none;padding:0.4rem 1.1rem;border-radius:0.3rem;cursor:pointer;font-weight:bold;font-size:0.95rem;display:inline-flex;align-items:center;gap:5px;";
      const issueNote = document.createElement("span");
      issueNote.className = "discogs-issue-note";
      issueNote.style.cssText = "font-size:0.85rem;color:var(--mbu-warn);";
      linksNote = document.createElement("span");
      linksNote.className = "discogs-issue-note discogs-links-note";
      linksNote.style.cssText = "font-size:0.85rem;color:var(--mbu-warn);display:none;";
      linksNote.title = `Confirmed matches whose ${importSourceName} URL isn't linked in MB yet \u2014 click to jump to the next one; use its \u{1F517} chip to add the link`;
      linksNote.addEventListener("click", jumpNextLink);
      updateLinksBadge();
      let _jumpIdx = -1;
      function jumpNextUnresolved() {
        const n = allResults.length;
        let found = -1;
        for (let step = 1; step <= n; step++) {
          const i = (_jumpIdx + step) % n;
          if (!rowState.get(keyOf(allResults[i]))?.confirmed) {
            found = i;
            break;
          }
        }
        if (found === -1) return;
        _jumpIdx = found;
        const input = rowSearchInputs.get(keyOf(allResults[found]));
        if (!input) return;
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        try {
          input.focus({ preventScroll: true });
        } catch {
          input.focus();
        }
        input.select?.();
      }
      issueNote.addEventListener("click", jumpNextUnresolved);
      function recSelectionCounts() {
        try {
          let total = 0, checked = 0;
          for (const tr of document.querySelectorAll("tr")) {
            if (!tr.querySelector('a[href*="/recording/"]')) continue;
            const cb = tr.querySelector('input[type="checkbox"]');
            if (!cb) continue;
            total++;
            if (cb.checked) checked++;
          }
          return total ? { checked, total } : null;
        } catch (e) {
          return null;
        }
      }
      function updateImportBtn() {
        const unresolved = [...rowState.values()].filter((s) => !s.confirmed).length;
        const sel = recSelectionCounts();
        const selLabel = sel && sel.checked > 0 && sel.checked < sel.total ? ` (${sel.checked}/${sel.total})` : "";
        if (unresolved === 0) {
          importBtn.innerHTML = `Start import${selLabel} \u2192`;
          importBtn.style.background = "var(--mbu-ok)";
          importBtn.style.color = "var(--mbu-text-on-accent)";
          issueNote.textContent = "";
          issueNote.classList.remove("clickable");
          issueNote.removeAttribute("title");
        } else {
          importBtn.innerHTML = `Start import anyway${selLabel} \u2192`;
          importBtn.style.background = "var(--mbu-warn)";
          importBtn.style.color = "var(--mbu-text-on-accent)";
          issueNote.textContent = `\u26A0 ${unresolved} unresolved`;
          issueNote.classList.add("clickable");
          issueNote.title = "Jump to the next unresolved entity \u2014 click again to cycle through them; these will be skipped on import";
        }
      }
      updateImportBtn();
      let _lastSelKey = "";
      const _recSelPoll = setInterval(() => {
        if (!importBtn.isConnected) {
          clearInterval(_recSelPoll);
          return;
        }
        const s = recSelectionCounts();
        const k = s ? `${s.checked}/${s.total}` : "";
        if (k !== _lastSelKey) {
          _lastSelKey = k;
          updateImportBtn();
        }
      }, 1e3);
      function buildStaticTableLi() {
        const tbl = document.createElement("table");
        tbl.style.cssText = "border-collapse:collapse;width:100%;font-size:0.78rem;margin:0.4rem 0;";
        const thRow = document.createElement("tr");
        thRow.style.background = "var(--mbu-bg-raised)";
        [importSourceName + " entity", "Roles / Tracks", "MB match", "MBID", "Resolved via"].forEach((h) => {
          const th = document.createElement("th");
          th.style.cssText = "text-align:left;padding:0.2rem 0.4rem;border:1px solid var(--mbu-border);white-space:nowrap;";
          th.textContent = h;
          thRow.appendChild(th);
        });
        tbl.appendChild(thRow);
        allResults.forEach((r) => {
          const _rKey = r.entity?.resource_url || r.entity?._syntheticKey || `_nourl_${r.entity?.name || r.displayName}`;
          const state = rowState.get(_rKey) || {};
          const tr2 = document.createElement("tr");
          const url = r.entity?.resource_url || r.entity?._syntheticKey || "";
          const rolesList2 = url ? rolesMap.get(url) || companiesRolesMap.get(url) || [] : [];
          const grouped2 = /* @__PURE__ */ new Map();
          rolesList2.forEach(({ displayLabel, linkType, trackPos }) => {
            const key = displayLabel || linkType;
            if (!grouped2.has(key)) grouped2.set(key, /* @__PURE__ */ new Set());
            if (trackPos) grouped2.get(key).add(trackPos);
          });
          const rolesText = [...grouped2.entries()].map(([label, tr]) => label + (tr.size ? " [" + [...tr].join(",") + "]" : "")).join("; ");
          const mbid = state.mbUrl ? state.mbUrl.replace(/.*\//, "").replace(/[^a-f0-9-]/gi, "").substring(0, 36) : "";
          const matchText = state.mbName || (state.mbUrl ? mbid : "");
          const vCfg = state.via ? viaCfg(state.via, state.fromCache) : null;
          const viaText = vCfg ? vCfg.text : state.mbUrl ? "\u2014" : "";
          [r.displayName || r.entity?.name, rolesText, matchText, mbid, viaText].forEach((val, ci) => {
            const td = document.createElement("td");
            td.style.cssText = "padding:0.15rem 0.4rem;border:1px solid var(--mbu-border);" + (ci === 2 && !val ? "color:var(--mbu-text-weak);" : ci === 2 ? "color:var(--mbu-ok);" : ci === 4 && vCfg ? `color:${vCfg.color};` : "");
            if (ci === 2 && mbid) {
              const a = document.createElement("a");
              a.href = "https:" + state.mbUrl;
              a.target = "_blank";
              a.rel = "noopener noreferrer nofollow";
              a.textContent = val || mbid;
              td.appendChild(a);
            } else {
              td.textContent = val || (ci === 1 ? "" : ci === 2 ? "\u2014" : "");
            }
            tr2.appendChild(td);
          });
          tbl.appendChild(tr2);
        });
        const tblLi = document.createElement("li");
        tblLi.style.cssText = "list-style:none;margin:0;padding:0;";
        tblLi.appendChild(tbl);
        return tblLi;
      }
      importBtn.addEventListener("click", () => {
        clearInterval(_recSelPoll);
        const confirmedMap = /* @__PURE__ */ new Map();
        rowState.forEach((s, key) => {
          if (s.mbUrl) confirmedMap.set(key, s.mbUrl);
        });
        getLogContainer().appendChild(buildStaticTableLi());
        const unresolvedCount = allResults.filter((r) => {
          const _k = r.entity?.resource_url || r.entity?._syntheticKey || `_nourl_${r.entity?.name || r.displayName}`;
          return !rowState.get(_k)?.confirmed;
        }).length;
        if (unresolvedCount > 0) {
          const unresolvedLi = document.createElement("li");
          unresolvedLi.style.cssText = "list-style:none;margin:0.2rem 0;font-size:0.82rem;color:var(--mbu-warn);";
          unresolvedLi.textContent = `\u26A0 ${unresolvedCount} entity/entities unresolved \u2014 will be skipped`;
          getLogContainer().appendChild(unresolvedLi);
        }
        confirmedMap.unresolvedCount = unresolvedCount;
        confirmedMap.totalEntities = allResults.length;
        confirmedMap.creditOverrides = creditOverrides;
        confirmedMap.splits = splits;
        (panelLi || panel).remove();
        if (headerSlot) headerSlot.replaceChildren();
        resolve(confirmedMap);
      });
      if (headerSlot) {
        headerSlot.replaceChildren(importBtn, issueNote, linksNote);
      } else {
        btnRow.appendChild(importBtn);
        btnRow.appendChild(issueNote);
        btnRow.appendChild(linksNote);
        panel.appendChild(btnRow);
      }
      updateLinksBadge();
      const panelLi = document.createElement("li");
      panelLi.style.cssText = "list-style:none;margin:0;padding:0;";
      panelLi.classList.add("discogs-review-panel-li");
      panelLi._buildStaticTableLi = buildStaticTableLi;
      panelLi.appendChild(panel);
      getReviewContainer().appendChild(panelLi);
      panelLi.scrollIntoView({ behavior: "smooth", block: "nearest" });
      _hideBar();
    });
  }

  // src/match-context.js
  var SPECIAL2 = new Set(MBM_SPECIAL_PURPOSE);
  var _relatedCache = /* @__PURE__ */ new Map();
  function releaseArtistMbids() {
    try {
      const names = pageWindow.MB?.relationshipEditor?.state?.entity?.artistCredit?.names || [];
      return [...new Set(names.map((n) => n?.artist?.gid).filter(Boolean))];
    } catch (e) {
      return [];
    }
  }
  async function buildReleaseContext({ coCredit = false } = {}) {
    const all = releaseArtistMbids();
    const seeds = all.filter((g) => !SPECIAL2.has(g));
    if (all.length && !seeds.length) log.info("Matching context: the release artist is special-purpose (e.g. Various Artists) \u2014 no context lookup (#612)");
    const related = [];
    for (const gid of seeds.slice(0, 4)) {
      let list = _relatedCache.get(gid);
      if (!list) {
        const json = await mbThrottle.fetchJson(`${MB}/ws/2/artist/${gid}?inc=aliases+artist-rels&fmt=json`);
        if (!json) {
          log.warn(`Matching context: could not load release artist ${gid} \u2014 continuing without it`);
          continue;
        }
        list = mbmRelatedArtists(json);
        _relatedCache.set(gid, list);
      }
      for (const r of list) if (!related.some((x) => x.gid === r.gid)) related.push(r);
    }
    if (seeds.length) {
      const kinds = related.filter((r) => r.rel !== "self").reduce((m, r) => (m[r.rel] = (m[r.rel] || 0) + 1, m), {});
      log.info(`Matching context: ${seeds.length} release artist(s) \u2192 ${related.length - seeds.length} related artist(s)` + (Object.keys(kinds).length ? ` (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")})` : "") + (coCredit ? " \xB7 co-credit search on" : ""));
      logDebug(`context related: ${related.map((r) => `${r.name}[${r.rel}]`).join(", ")}`);
    }
    return { seeds, related, coCredit: !!coCredit };
  }

  // src/editor-state.js
  async function waitForMBEditor(timeoutMs = 15e3) {
    log.info("Waiting for MB relationship editor\u2026");
    let waited = 0;
    while (waited < timeoutMs) {
      const MB2 = pageWindow.MB;
      const re = MB2?.relationshipEditor;
      const st = re?.state;
      if (st?.entity) {
        log.info(`Editor ready (${waited}ms). Release: "${st.entity.name}"`);
        return re;
      }
      if (waited % 2e3 === 0 && waited > 0) {
        const mbKeys = MB2 ? Object.keys(MB2).join(", ") : "undefined";
        const reKeys = re ? Object.keys(re).join(", ") : "undefined";
        const stKeys = st ? Object.keys(st).join(", ") : "undefined";
        log.info(`[${waited}ms] MB={${mbKeys}} re={${reKeys}} state={${stKeys}}`);
      }
      await new Promise((r) => setTimeout(r, 200));
      waited += 200;
    }
    log.error("MB editor not ready after 15s \u2014 aborting");
    return null;
  }
  function dispatchRelationship(re, sourceEntity, targetEntity, linkTypeID, credit, attributes, trackPos) {
    if (credit && credit === (targetEntity.name || "")) credit = "";
    const swapped = sourceEntity.entityType > targetEntity.entityType;
    const e0 = swapped ? targetEntity : sourceEntity;
    const e1 = swapped ? sourceEntity : targetEntity;
    const ltEntry = pageWindow.MB?.linkedEntities?.link_type?.[linkTypeID];
    const ltName = ltEntry ? ltEntry.name : linkTypeID;
    let attrDesc = "";
    if (attributes) {
      try {
        const parts = [];
        for (const a of pageWindow.MB.tree.iterate(attributes)) {
          const n = a.type?.name || a.typeID;
          const v = a.text_value ? `=${a.text_value}` : "";
          if (n) parts.push(n + v);
        }
        if (parts.length) attrDesc = ` [${parts.join(", ")}]`;
      } catch (e) {
      }
    }
    const posLabel = trackPos != null && trackPos !== "" ? ` <span style="color:var(--mbu-text-weak);font-size:0.85em">#${trackPos}</span>` : "";
    log.info(`\u2192 <strong>${ltName}</strong>${attrDesc}${posLabel}: ${sourceEntity.name || sourceEntity.gid} \u2194 ${targetEntity.name || targetEntity.gid}${credit && credit !== (targetEntity.name || targetEntity.gid) ? ` (credited: ${credit})` : ""}`);
    re.dispatch({
      type: "update-relationship-state",
      sourceEntity,
      batchSelectionCount: null,
      creditsToChangeForSource: "",
      creditsToChangeForTarget: "",
      oldRelationshipState: null,
      newRelationshipState: {
        ...REL_TEMPLATE,
        entity0: e0,
        entity0_credit: swapped ? credit || "" : "",
        entity1: e1,
        entity1_credit: swapped ? "" : credit || "",
        id: re.getRelationshipStateId(),
        linkTypeID,
        attributes: attributes || null
      }
    });
  }
  function buildAttributes(rawAttributes, linkTypeID) {
    if (!rawAttributes || rawAttributes.length === 0) return null;
    const MB2 = pageWindow.MB;
    const tree = MB2?.tree;
    const lat = MB2?.linkedEntities?.link_attribute_type;
    if (!tree || !lat) return null;
    const linkType = linkTypeID != null ? MB2?.linkedEntities?.link_type?.[linkTypeID] : null;
    const supportedRoots = linkType && linkType.attributes ? new Set(Object.keys(linkType.attributes)) : null;
    const attrSupported = (found) => {
      if (!supportedRoots) return true;
      const rootId = found.root_id != null ? found.root_id : found.id;
      return supportedRoots.has(String(rootId));
    };
    function findAttrByName(name) {
      const lower = name.toLowerCase().trim();
      for (const v of Object.values(lat)) {
        if (v.name?.toLowerCase() === lower) return v;
      }
      if (lower.length >= 4) {
        for (const v of Object.values(lat)) {
          const vl = v.name?.toLowerCase() || "";
          if (vl.length < 4) continue;
          if (vl.includes(lower) || lower.includes(vl)) return v;
        }
      }
      log.warn(`Attribute "${name}" not found in MB \u2014 dropping attribute but keeping the rel`);
      return null;
    }
    const attrObjs = [];
    const seen = /* @__PURE__ */ new Set();
    for (const attr of rawAttributes) {
      let attrName = null;
      let textValue = "";
      let creditedAs = "";
      if (typeof attr === "string") {
        attrName = attr;
      } else if (attr && typeof attr === "object" && attr._type) {
        if (attr._type === "task") {
          attrName = "task";
          textValue = attr.value;
        } else {
          attrName = attr.value;
        }
        if (attr.creditedAs) creditedAs = attr.creditedAs;
      }
      if (!attrName) continue;
      const found = findAttrByName(attrName);
      if (!found || seen.has(found.id)) continue;
      if (!attrSupported(found)) {
        log.warn(`Attribute "${found.name}" isn't supported by link type "${linkType.name || linkTypeID}" \u2014 dropping it (keeping the rel)`);
        continue;
      }
      seen.add(found.id);
      attrObjs.push({ type: found, typeID: found.id, credited_as: creditedAs, text_value: textValue });
    }
    if (attrObjs.length === 0) return null;
    attrObjs.sort((a, b) => a.typeID - b.typeID);
    try {
      return tree.fromDistinctAscArray(attrObjs);
    } catch (e) {
      log.warn(`Attribute tree build failed (${e.message}) \u2014 importing without attributes`);
      return null;
    }
  }

  // src/data/work-only-rels.js
  var WORK_ONLY_ARTIST_RELS = [
    "writer",
    "composer",
    "lyricist",
    "librettist",
    "revised by",
    // NOT 'translator' — a translator credit (liner notes / lyrics / libretto) is a
    // release-wide credit, so it dispatches at RELEASE level (artist↔release
    // "translator"), not duplicated onto every work. (MB has the artist-release rel.)
    "reconstructed by",
    // 'arranger',
    // 'instruments arranger',
    "orchestrator",
    // 'vocals arranger',
    "previously attributed to",
    "miscellaneous support",
    "dedicated to",
    "premiered by",
    "was commissioned by",
    "publisher",
    // MB's actual link-type name for the music-publisher rel (label→work).
    // Tidal/Qobuz "Music Publisher" credits resolve to a label and attach here.
    "publishing",
    "inspired the name of"
  ];

  // src/dispatch.js
  var stripDiscogsNum2 = (s) => String(s || "").replace(/\s+\(\d+\)$/, "");
  function makeIdentifyingClassifier(lat) {
    const identifyingRoots = /* @__PURE__ */ new Set();
    if (lat) {
      for (const v of Object.values(lat)) {
        const isRoot = v.parent_id == null || v.parent_id === v.id;
        if (isRoot && /^(instrument|vocal)$/i.test(v.name || "")) identifyingRoots.add(v.id);
      }
    }
    const rootCache = /* @__PURE__ */ new Map();
    const rootIdOf = (typeID) => {
      if (rootCache.has(typeID)) return rootCache.get(typeID);
      let node = lat ? lat[typeID] : null;
      let guard = 0;
      while (node && node.parent_id != null && node.parent_id !== node.id && lat[node.parent_id] && guard++ < 64) {
        node = lat[node.parent_id];
      }
      const rootId = node ? node.id : typeID;
      rootCache.set(typeID, rootId);
      return rootId;
    };
    return (typeID) => identifyingRoots.has(rootIdOf(typeID));
  }
  async function dispatchAllRelationships(companies, artistRoles, tracklistRels, applyToTracks, createWorksMode, discogsTracklist, processTracklist, resolvedEntityTypes, confirmedMap, discogsUrl, dedupOpts) {
    resolvedEntityTypes = resolvedEntityTypes || /* @__PURE__ */ new Map();
    confirmedMap = confirmedMap || /* @__PURE__ */ new Map();
    dedupOpts = dedupOpts || {};
    if (confirmedMap.splits?.size) {
      const keyOfEntity = (e) => e.resource_url || e._syntheticKey || `_nourl_${e.name}`;
      const before = (artistRoles?.length || 0) + (tracklistRels?.length || 0);
      artistRoles = expandSplitRoles(artistRoles, confirmedMap.splits, keyOfEntity);
      tracklistRels = expandSplitRoles(tracklistRels, confirmedMap.splits, keyOfEntity);
      const after = (artistRoles?.length || 0) + (tracklistRels?.length || 0);
      confirmedMap.splits.forEach((parts, k) => log.info(`#605 split ${k} \u2192 ${parts.map((p) => `${p.name} [${confirmedMap.get(p.key) || "unresolved"}]`).join(" \xB7 ")}`));
      log.info(`#605 split: ${before} role(s) \u2192 ${after} after fan-out`);
    }
    const dedupeEquivalenceSets = dedupOpts.dedupeEquivalenceSets !== false;
    const dedupeDuplicateRoles = dedupOpts.dedupeDuplicateRoles !== false;
    const creditOverrides = dedupOpts.creditOverrides || /* @__PURE__ */ new Map();
    const re = await waitForMBEditor();
    if (!re) return;
    const MB2 = pageWindow.MB;
    const isIdentifyingAttr = makeIdentifyingClassifier(MB2?.linkedEntities?.link_attribute_type);
    const equivalenceLookup = (() => {
      const m = /* @__PURE__ */ new Map();
      if (!dedupeEquivalenceSets || !MB2?.linkedEntities?.link_type) return m;
      for (const set of EQUIVALENCE_SETS) {
        const byPair = /* @__PURE__ */ new Map();
        for (const [id, lt] of Object.entries(MB2.linkedEntities.link_type)) {
          if (!lt?.name) continue;
          if (!set.includes(String(lt.name).toLowerCase())) continue;
          const key = `${lt.type0}|${lt.type1}`;
          if (!byPair.has(key)) byPair.set(key, []);
          byPair.get(key).push(Number(id));
        }
        for (const ids of byPair.values()) {
          if (ids.length < 2) continue;
          const sibSet = new Set(ids);
          for (const id of ids) m.set(id, sibSet);
        }
      }
      return m;
    })();
    const releaseEntity = re.state.entity;
    let added = 0, existedInMb = 0, existedStaged = 0, dedupedThisSession = 0, skipped = 0, failed = 0;
    const dispatchedThisSession = /* @__PURE__ */ new Set();
    const RECORDING_LINK_TYPES = /* @__PURE__ */ new Set([
      "performer",
      "instrument",
      "vocal",
      "vocals",
      "orchestra",
      "conductor",
      "concertmaster",
      "chorus master",
      "producer",
      "engineer",
      "mix",
      "recording",
      "remixer",
      "DJ-mixer",
      "additional",
      "guest",
      "programming"
      // NOT 'mastering' — MB deprecated artist→recording mastering (link type 136).
    ]);
    const isExecProducer = (role) => role.linkType === "producer" && (role.attributes || []).some((a) => a === "executive" || a && a.value === "executive");
    log.info(`Starting instant fill: ${companies.length} companies, ${artistRoles.length} release artist roles, ${tracklistRels.length} tracklist roles`);
    try {
      _showBar();
    } catch (_) {
    }
    const bar = document.querySelector(".discogs-bar");
    function tickProgress() {
      const done = added + skipped + failed;
      const est = Math.max(done + 1, companies.length + artistRoles.length + tracklistRels.length);
      const pct = Math.min(Math.round(done / est * 99), 99);
      try {
        _setProgressPct(pct);
      } catch (_) {
      }
    }
    const recordingByGid = /* @__PURE__ */ new Map();
    const recordingByPosition = /* @__PURE__ */ new Map();
    const editorWorkByRecGid = /* @__PURE__ */ new Map();
    const positionByGid = /* @__PURE__ */ new Map();
    let trackCount = 0;
    try {
      let mediumIndex = 0;
      for (const [mediumKey, medium] of MB2.tree.iterate(re.state.mediums)) {
        mediumIndex++;
        const tracks = medium?.tracks ?? medium;
        let trackIndex = 0;
        for (const rawTrack of MB2.tree.iterate(tracks)) {
          const trackObj = Array.isArray(rawTrack) ? rawTrack[1] : rawTrack;
          const trackKey = Array.isArray(rawTrack) ? rawTrack[0] : null;
          const rec = trackObj?.recording ?? trackObj;
          if (!rec) continue;
          trackCount++;
          if (rec.gid) {
            recordingByGid.set(rec.gid, rec);
            positionByGid.set(rec.gid, `${mediumIndex}-${trackIndex + 1}`);
            const rw = trackObj?.relatedWorks;
            if (rw && rw.size > 0) {
              try {
                for (const entry of MB2.tree.iterate(rw)) {
                  const raw = Array.isArray(entry) ? entry[1] : entry;
                  const work = raw?.work ?? raw;
                  if (work?.gid || work?.id) {
                    editorWorkByRecGid.set(rec.gid, work);
                    break;
                  }
                }
              } catch (e) {
              }
            }
          }
          const positions = new Set([
            trackObj?.position,
            trackObj?.number,
            rec?.position,
            rec?.number,
            trackKey,
            trackIndex + 1,
            // Compound keys: "mediumIndex-trackPosition"
            `${mediumIndex}-${trackIndex + 1}`,
            trackObj?.position != null ? `${mediumIndex}-${trackObj.position}` : null,
            trackObj?.number != null ? `${mediumIndex}-${trackObj.number}` : null
          ].filter((x) => x != null).map(String));
          for (const p of positions) recordingByPosition.set(p, rec);
          trackIndex++;
        }
      }
      log.info(`Found ${trackCount} track(s) in editor state (${recordingByGid.size} with GID, ${recordingByPosition.size} position entries: ${[...recordingByPosition.keys()].join(",")}). relatedWorks: ${editorWorkByRecGid.size} pre-linked`);
    } catch (e) {
      log.warn(`Iterating MB state: ${e.message}`);
    }
    const checkedRecGids = /* @__PURE__ */ new Set();
    try {
      for (const raw of MB2.tree.iterate(re.state.selectedRecordings)) {
        const rec = Array.isArray(raw) ? raw[1] : raw;
        if (rec?.gid) checkedRecGids.add(rec.gid);
      }
    } catch (e) {
    }
    const recSelectionActive = checkedRecGids.size > 0 && checkedRecGids.size < recordingByGid.size;
    const applyToRec = (gid) => !recSelectionActive || checkedRecGids.has(gid);
    if (recSelectionActive) log.info(`Recording selection: applying only to ${checkedRecGids.size}/${recordingByGid.size} checked recording(s).`);
    const positionToGid = /* @__PURE__ */ new Map();
    try {
      const relMbid = releaseEntity.gid;
      log.info(`WS2: fetching recordings for release ${relMbid}\u2026`);
      const wsJson = await fetchWithRetry(`/ws/2/release/${relMbid}?inc=recordings&fmt=json`);
      log.info(`WS2: response received`);
      if (wsJson) {
        const mediaCount = wsJson.media?.length ?? 0;
        log.info(`WS2: ${mediaCount} medium/media in response`);
        const mediaArr = wsJson.media || [];
        const isMultiMedium2 = mediaArr.length > 1;
        for (const medium of mediaArr) {
          const medPos = medium.position;
          for (const track of medium.tracks || []) {
            const gid = track.recording?.id;
            if (!gid) continue;
            if (medPos != null && track.position != null) {
              positionToGid.set(`${medPos}-${track.position}`, gid);
            }
            if (medPos != null && track.number != null) {
              positionToGid.set(`${medPos}-${track.number}`, gid);
            }
            if (!isMultiMedium2) {
              if (track.position != null) positionToGid.set(String(track.position), gid);
              if (track.number != null) positionToGid.set(String(track.number), gid);
            }
          }
        }
        log.info(`WS2 position map: ${positionToGid.size} entries (${[...positionToGid.keys()].sort().join(", ")})`);
      }
    } catch (e) {
      log.warn(`WS2 recording fetch failed: ${e.message} \u2014 using editor state positions only`);
    }
    const isMultiMedium = positionToGid.size > 0 && [...positionToGid.keys()].some((k) => /^[2-9]-/.test(k));
    function inferDiscFromVinylSide(pos) {
      const m = String(pos || "").match(/^([A-Z])\d+$/i);
      if (!m) return null;
      return Math.floor((m[1].toUpperCase().charCodeAt(0) - 65) / 2) + 1;
    }
    function getRecordingEntity(track) {
      const stripPad = (s) => String(s).replace(/-0+(\d)/g, "-$1");
      const pos = track.position != null ? String(track.position) : "";
      const num = track.number != null ? String(track.number) : "";
      const compounds = /* @__PURE__ */ new Set();
      const plain = /* @__PURE__ */ new Set();
      if (/^\d+-/.test(pos)) {
        compounds.add(pos);
        const unpadded = stripPad(pos);
        if (unpadded !== pos) compounds.add(unpadded);
      } else if (pos) {
        plain.add(pos);
        const inferredDisc = inferDiscFromVinylSide(pos);
        if (inferredDisc != null) compounds.add(`${inferredDisc}-${pos}`);
        for (let m = 1; m <= 10; m++) compounds.add(`${m}-${pos}`);
      }
      if (num && num !== pos) {
        plain.add(num);
        for (let m = 1; m <= 10; m++) compounds.add(`${m}-${num}`);
      }
      const tryKeys = isMultiMedium ? [...compounds] : [...plain, ...compounds];
      for (const c of tryKeys) {
        const gid = positionToGid.get(c);
        if (gid) {
          const rec = recordingByGid.get(gid);
          if (rec) return rec;
          log.warn(`Recording ${gid} for track ${track.position} not in editor state`);
          return null;
        }
      }
      for (const c of tryKeys) {
        const rec = recordingByPosition.get(c);
        if (rec) return rec;
      }
      if (trackCount > 0) {
        const ws2Keys = positionToGid.size ? [...positionToGid.keys()].join(", ") : "(empty)";
        const stateKeys = recordingByPosition.size ? [...recordingByPosition.keys()].join(", ") : "(empty)";
        log.warn(`No recording for track ${track.position} "${track.title}". WS2 keys: ${ws2Keys} | State keys: ${stateKeys}`);
      }
      return null;
    }
    function confirmedMbUrl(entity) {
      if (!entity) return null;
      const direct = confirmedMap.get(entity.resource_url) || confirmedMap.get(entity._syntheticKey) || null;
      if (direct) return direct;
      if (entity.name) {
        return confirmedMap.get(`_nourl_${entity.name}`) || null;
      }
      return null;
    }
    function relAlreadyExists(sourceEntity, linkTypeID, targetGid, attrTree) {
      const rels = sourceEntity?.relationships;
      if (!Array.isArray(rels) || rels.length === 0) return null;
      const acceptableLinkTypes = equivalenceLookup.get(linkTypeID) || /* @__PURE__ */ new Set([linkTypeID]);
      const sigOf = (attrs) => attrs.map((a) => `${a.typeID}:${a.text_value || ""}:${a.credited_as || ""}`).sort().join(",");
      const idSigOf = (attrs) => attrs.filter((a) => isIdentifyingAttr(a.typeID)).map((a) => `${a.typeID}:${a.text_value || ""}:${a.credited_as || ""}`).sort().join(",");
      const candAttrs = (() => {
        if (!attrTree) return [];
        try {
          return [...pageWindow.MB.tree.iterate(attrTree)].map((a) => ({ typeID: a.typeID, text_value: a.text_value || "", credited_as: a.credited_as || "" }));
        } catch (e) {
          return [];
        }
      })();
      const candSig = sigOf(candAttrs);
      const candIdSig = idSigOf(candAttrs);
      const lookupName = (id) => {
        try {
          return pageWindow.MB.linkedEntities.link_type[id]?.name || `#${id}`;
        } catch (e) {
          return `#${id}`;
        }
      };
      let dupMatch = null;
      for (const r of rels) {
        if (!acceptableLinkTypes.has(r.linkTypeID)) continue;
        const tgt = r.target?.gid || r.entity0?.gid || r.entity1?.gid;
        if (tgt !== targetGid) continue;
        const isEquivalent = r.linkTypeID !== linkTypeID;
        const existingAttrs = (r.attributes || []).map((a) => ({ typeID: a.typeID, text_value: a.text_value || "", credited_as: a.credited_as || "" }));
        const exactMatch = sigOf(existingAttrs) === candSig;
        if (exactMatch) {
          return { kind: isEquivalent ? "equivalence" : "exact", existingLinkName: lookupName(r.linkTypeID), status: r._status };
        }
        if (dedupeDuplicateRoles && !dupMatch && idSigOf(existingAttrs) === candIdSig) {
          dupMatch = { kind: isEquivalent ? "equivalence" : "duplicate-role", existingLinkName: lookupName(r.linkTypeID), status: r._status };
        }
      }
      return dupMatch;
    }
    async function processOne(sourceEntity, entityType0, entityType1, linkTypeName, mbUrl, rawAttributes, credit, trackPos) {
      const overrideCredit = creditOverrides.get(mbUrl);
      if (overrideCredit && String(overrideCredit).trim()) {
        credit = String(overrideCredit).trim();
      }
      const mbid = mbUrl.replace(/.*\//, "").replace(/[^a-f0-9-]/gi, "").substring(0, 36);
      if (!mbid) {
        log.error(`Bad MBID URL: ${mbUrl}`);
        failed++;
        return;
      }
      const linkTypeID = resolveLinkTypeId(linkTypeName, entityType0, entityType1);
      if (!linkTypeID) {
        failed++;
        return;
      }
      const attrTree = buildAttributes(rawAttributes, linkTypeID);
      const attrSig = attrTree ? (() => {
        try {
          return [...pageWindow.MB.tree.iterate(attrTree)].map((a) => (a.typeID || "") + (a.credited_as ? "~" + a.credited_as : "")).join(",");
        } catch (e) {
          return "";
        }
      })() : "";
      const sessionKey = `${sourceEntity.gid}|${linkTypeID}|${mbid}|${attrSig}`;
      if (dispatchedThisSession.has(sessionKey)) {
        log.info(`Skipped duplicate dispatch of <strong>${linkTypeName}</strong>: ${sourceEntity.name} \u2194 ${credit || ""} \u2014 already queued earlier this run`);
        dedupedThisSession++;
        return;
      }
      dispatchedThisSession.add(sessionKey);
      let targetEntity;
      try {
        targetEntity = await fetchMBEntity(mbid);
      } catch (e) {
        log.error(`Entity fetch failed for ${mbid}: ${e.message}`);
        failed++;
        return;
      }
      const PLACE_TO_LABEL_LINK = {
        "glass mastered at": "glass mastered",
        "mastered at": "mastering",
        "pressed at": "pressed",
        "manufactured at": "manufactured",
        "recorded at": "engineer",
        "mixed at": "mix"
      };
      const LABEL_TO_PLACE_LINK = Object.fromEntries(
        Object.entries(PLACE_TO_LABEL_LINK).map(([k, v]) => [v, k])
      );
      let resolvedLinkTypeID = linkTypeID;
      if (targetEntity.entityType !== entityType1 && targetEntity.entityType !== entityType0) {
        const at = targetEntity.entityType;
        const [rt0, rt1] = at < sourceEntity.entityType ? [at, sourceEntity.entityType] : [sourceEntity.entityType, at];
        let reResolved = resolveLinkTypeId(linkTypeName, rt0, rt1);
        if (!reResolved) {
          const altName = at === "label" ? PLACE_TO_LABEL_LINK[linkTypeName] : LABEL_TO_PLACE_LINK[linkTypeName];
          if (altName) reResolved = resolveLinkTypeId(altName, rt0, rt1);
        }
        if (reResolved) {
          resolvedLinkTypeID = reResolved;
        } else {
          log.warn(`Entity "${targetEntity.name}" is a ${targetEntity.entityType} but expected ${entityType0}/${entityType1} \u2014 link type "${linkTypeName}" may not apply`);
        }
      }
      const dedupHit = relAlreadyExists(sourceEntity, resolvedLinkTypeID, targetEntity.gid, attrTree);
      if (dedupHit) {
        const pair = `${sourceEntity.name} \u2194 ${targetEntity.name}${credit && credit !== targetEntity.name ? ` (credited: ${credit})` : ""}`;
        const existing = dedupHit.existingLinkName;
        const staged = dedupHit.status === 1;
        const where = staged ? "already added this session" : "already in MB";
        if (dedupHit.kind === "equivalence") {
          log.info(`Deduplication (equivalence sets): <strong>${linkTypeName}</strong> not added \u2014 equivalent <strong>${existing}</strong> ${where} on ${pair}`);
        } else if (dedupHit.kind === "duplicate-role") {
          log.info(`Deduplication (duplicate roles): <strong>${linkTypeName}</strong> not added \u2014 same role ${where} with different attributes on ${pair}`);
        } else {
          log.info(`${staged ? "Already added this session" : "Already in MB"}: <strong>${linkTypeName}</strong>: ${pair}`);
        }
        if (staged) existedStaged++;
        else existedInMb++;
        return;
      }
      dispatchRelationship(re, sourceEntity, targetEntity, resolvedLinkTypeID, credit, attrTree, trackPos);
      added++;
    }
    async function dispatchCompanies() {
      for (const company of companies) {
        const details = ENTITY_TYPE_MAP[company.entity_type_name];
        if (!details) continue;
        const resolvedEt = resolvedEntityTypes.get(company.resource_url) || details.entityType;
        if (resolvedEt !== details.entityType) {
          if (details.entityType === "place" && resolvedEt === "label") {
            log.warn(`Skipped ${company.name}: MB has no "${details.linkType}" relationship for labels (only places). Add manually if needed.`);
            skipped++;
            tickProgress();
            continue;
          }
        }
        const mbUrl = confirmedMbUrl(company);
        if (!mbUrl) {
          log.skip(`Skipped ${company.name} \u2014 not resolved in review`);
          skipped++;
          tickProgress();
          continue;
        }
        const et = resolvedEt;
        const [t0, t1] = et <= "release" ? [et, "release"] : ["release", et];
        await processOne(releaseEntity, t0, t1, details.linkType, mbUrl, [], "");
        tickProgress();
      }
    }
    async function dispatchReleaseArtists() {
      for (const role of artistRoles) {
        if (applyToTracks && RECORDING_LINK_TYPES.has(role.linkType) && !isExecProducer(role)) continue;
        if (WORK_ONLY_ARTIST_RELS.includes(role.linkType)) continue;
        const mbUrl = confirmedMbUrl(role.artist);
        if (!mbUrl) {
          log.skip(`Skipped ${role.artist.name} (${role.linkType}) \u2014 not resolved in review`);
          skipped++;
          tickProgress();
          continue;
        }
        const credit = role.creditedAs || stripDiscogsNum2(role.artist.anv?.trim() || role.artist.name);
        await processOne(releaseEntity, "artist", "release", role.linkType, mbUrl, role.attributes || [], credit);
        tickProgress();
      }
    }
    async function dispatchTracklist() {
      if (applyToTracks && recordingByGid.size > 0) {
        const applicable = artistRoles.filter((role) => RECORDING_LINK_TYPES.has(role.linkType) && !WORK_ONLY_ARTIST_RELS.includes(role.linkType) && !isExecProducer(role));
        if (applicable.length > 0) {
          log.info(`Applying ${applicable.length} release credit(s) to ${recordingByGid.size} recording(s)\u2026`);
          for (const role of applicable) {
            const mbUrl = confirmedMbUrl(role.artist);
            if (!mbUrl) {
              log.skip(`Skipped ${role.artist.name} (${role.linkType}) in applyToTracks \u2014 not resolved in review`);
              continue;
            }
            const credit = role.creditedAs || stripDiscogsNum2(role.artist.anv?.trim() || role.artist.name);
            for (const recEntity of recordingByGid.values()) {
              if (!applyToRec(recEntity.gid)) continue;
              await processOne(recEntity, "artist", "recording", role.linkType, mbUrl, role.attributes || [], credit, positionByGid.get(recEntity.gid) || "*");
            }
          }
        }
      }
    }
    async function dispatchWorks() {

      // Toolbox policy: a new Work may only be staged after a full and
      // successful title search. Other recordings may already use that Work.

      let toolboxWorkRequestAt = 0;
      const toolboxStagedTitles = new Set();
      const toolboxWorkQueryCache = new Map();
      const toolboxNormalizeTitle = x => String(x || "").normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const toolboxLucene = x => String(x).replace(/([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)/g, "\\$1");
      async function toolboxWorkJson(url) {
        const waitMs = Math.max(0, 1700 - (Date.now() - toolboxWorkRequestAt));
        if (waitMs) await __mbToolBoxSleep(waitMs);
        toolboxWorkRequestAt = Date.now();
        const response = await __mbToolBoxFetch(url, {
          credentials: "same-origin", headers: {Accept: "application/json"}
        });
        if (!response.ok) throw Error("MusicBrainz Work search HTTP " + response.status);
        return response.json();
      }
      async function toolboxSearchAllWorks(query, label) {
        const matches = [];
        const limit = 100;
        let offset = 0;
        for (;;) {
          const url = "/ws/2/work?query=" + encodeURIComponent(query) +
            "&fmt=json&limit=" + limit + "&offset=" + offset;
          const json = await toolboxWorkJson(url);
          const count = Number(json?.["work-count"]);
          if (!Number.isSafeInteger(count) || count < 0 || !Array.isArray(json.works)) {
            throw Error("Invalid Work search result for " + label);
          }
          matches.push(...json.works);
          offset += json.works.length;
          if (offset >= count) return matches;
          if (!json.works.length || json.works.length < limit) {
            throw Error("Incomplete Work search for " + label + " (" + offset + "/" + count + ")");
          }
        }
      }
      async function toolboxResolveWork(workTitle, creditedNames) {
        const title = String(workTitle || "").trim();
        if (!title) return {status:"review", reason:"Missing Work title"};
        const key = toolboxNormalizeTitle(title);
        if (toolboxStagedTitles.has(key)) {
          return {status:"review", reason:"A Work with this title is already staged"};
        }
        const names = [...new Map((creditedNames || []).map(x => String(x || "").trim())
          .filter(Boolean).map(x => [toolboxNormalizeTitle(x), x])).values()];
        try {
          let works = toolboxWorkQueryCache.get(key);
          if (!works) {
            works = (await toolboxSearchAllWorks('work:"' + toolboxLucene(title) + '"', title))
              .filter(w => w.id && toolboxNormalizeTitle(w.title) === key);
            toolboxWorkQueryCache.set(key,works);
          }
          if (!works.length) return {status:"new"};
          if (!names.length) return {
            status:"review",reason: works.length+" same-title Works; no credited author names to verify"
          };
          let candidates = works;
          if (works.length > 8) {
            const query = 'work:"' + toolboxLucene(title) + '" AND (' +
              names.map(name => 'artist:"' + toolboxLucene(name) + '"').join(" OR ") + ')';
            const found = await toolboxSearchAllWorks(query,title+" + authors");
            const allowed = new Set(works.map(w => w.id));
            const matched = new Set(found.filter(w => allowed.has(w.id) &&
              toolboxNormalizeTitle(w.title) === key).map(w => w.id));
            candidates = works.filter(w => matched.has(w.id));
          }
          if (!candidates.length || candidates.length > 8) {
            return {status:"review",reason:works.length+" same-title Works; authors ambiguous"};
          }
          const possible = [];
          const known = new Set(names.map(toolboxNormalizeTitle));
          for (const candidate of candidates) {
            const details = await toolboxWorkJson("/ws/2/work/" + encodeURIComponent(candidate.id) +
              "?inc=artist-rels&fmt=json");
            const matches = (details.relations || []).some(rel =>
              rel.artist && ["writer","composer","lyricist","librettist"].includes(
                toolboxNormalizeTitle(rel.type)
              ) && [rel.artist.name,rel["target-credit"],rel["source-credit"]]
                .some(name => name && known.has(toolboxNormalizeTitle(name)))
            );
            if (matches) possible.push(candidate);
          }
          if (possible.length === 1) {
            return {status:"existing", mbid:possible[0].id, title:possible[0].title};
          }
          return {status:"review",reason:works.length+
            " same-title Works; "+possible.length+" have matching author credits"};
        } catch(error) {
          return {status:"review",reason:"MusicBrainz Work verification failed: "+error.message};
        }
      }
      if (createWorksMode === "off") {
        const workOnly = [...tracklistRels || [], ...artistRoles || []].filter((r) => WORK_ONLY_ARTIST_RELS.includes(r.linkType));
        if (workOnly.length) log.skip(`"Use works" is off \u2014 skipped ${workOnly.length} work-level credit(s) (${[...new Set(workOnly.map((r) => r.linkType))].join(", ")})`);
        return;
      }
      const recordingOfLinkTypeId = resolveLinkTypeId("performance", "recording", "work");
      const includeOnlyResolved = createWorksMode === "when-needed";
      const workOnlyByGid = /* @__PURE__ */ new Map();
      for (const role of tracklistRels) {
        if (!WORK_ONLY_ARTIST_RELS.includes(role.linkType)) continue;
        if (includeOnlyResolved && !confirmedMbUrl(role.artist)) continue;
        const recEntity = getRecordingEntity(role.track);
        if (!recEntity) {
          log.error(`Work-only rel for track ${role.track.position} "${role.track.title}" \u2014 no recording found, skipped`);
          failed++;
          continue;
        }
        if (!applyToRec(recEntity.gid)) continue;
        if (!workOnlyByGid.has(recEntity.gid)) workOnlyByGid.set(recEntity.gid, []);
        workOnlyByGid.get(recEntity.gid).push({ role, recEntity });
      }
      for (const role of artistRoles) {
        if (!WORK_ONLY_ARTIST_RELS.includes(role.linkType)) continue;
        if (includeOnlyResolved && !confirmedMbUrl(role.artist)) continue;
        for (const recEntity of recordingByGid.values()) {
          if (!applyToRec(recEntity.gid)) continue;
          const syntheticRole = { ...role, track: { position: "", title: recEntity.name || "" } };
          if (!workOnlyByGid.has(recEntity.gid)) workOnlyByGid.set(recEntity.gid, []);
          workOnlyByGid.get(recEntity.gid).push({ role: syntheticRole, recEntity });
        }
      }
      if (createWorksMode === "when-missing" && recordingOfLinkTypeId) {
        for (const recEntity of recordingByGid.values()) {
          if (!applyToRec(recEntity.gid)) continue;
          if (!workOnlyByGid.has(recEntity.gid)) {
            workOnlyByGid.set(recEntity.gid, []);
          }
        }
      }
      if (workOnlyByGid.size === 0) return;
      if (!recordingOfLinkTypeId) {
        log.error('Could not resolve "performance" link type \u2014 work processing skipped');
        return;
      }
      log.info(`Processing work relationships for ${workOnlyByGid.size} recording(s)\u2026`);
      const existingWorkByRecGid = editorWorkByRecGid;
      log.info(`Editor state: ${existingWorkByRecGid.size} recording(s) already have a linked work`);
      function getWorkFromEditorState(recEntity) {
        try {
          for (const rel of MB2.tree.iterate(recEntity.relationships)) {
            if (rel._status === 1 && rel.linkTypeID === recordingOfLinkTypeId) {
              return rel.entity0?.entityType === "work" ? rel.entity0 : rel.entity1;
            }
          }
        } catch (e) {
        }
        return null;
      }
      const createdWorkRecGids = /* @__PURE__ */ new Set();
      for (const [recGid, entries] of workOnlyByGid) {
        const recEntity = entries[0]?.recEntity ?? recordingByGid.get(recGid);
        const trackTitle = recEntity?.name || entries[0]?.role.track.title || recGid;
        const trackPos = entries[0]?.role.track.position ?? "";
        if (!recEntity) continue;
        const hasExistingWork = editorWorkByRecGid.has(recGid);
        let workEntity = null;
        if (hasExistingWork) {
          workEntity = editorWorkByRecGid.get(recGid);
          const wid = workEntity.gid || workEntity.id;
          log.info(`Track ${trackPos} "${trackTitle}": work already linked (${workEntity.name || wid || "existing"}) \u2014 skipping creation`);
          if (!workEntity.gid && !workEntity.id) continue;
        }
        if (!workEntity) workEntity = getWorkFromEditorState(recEntity);
        if (!workEntity && createWorksMode === "never") {
          for (const { role } of entries) {
            log.error(`Track ${trackPos} "${trackTitle}": no work exists for ${role.linkType} (${role.artist.name}) \u2014 "Create works" is set to "never". Add the work manually or change the mode.`);
            failed++;
          }
          continue;
        }
        if (!workEntity) {
          const writerNames = entries.filter(e => ["writer", "composer", "lyricist", "librettist"].some(
            type => String(e.role.linkType || "").toLowerCase().includes(type)
          )).map(e => e.role.artist?.name).filter(Boolean);
          const resolution = await toolboxResolveWork(trackTitle, writerNames);
          if (resolution.status === "review") {
            log.warn('Track ' + trackPos + ' "' + trackTitle + '": ' +
              resolution.reason + '. No duplicate Work staged.');
            continue;
          }
          if (resolution.status === "existing") {
            try {
              workEntity = await fetchMBEntity(resolution.mbid);
              if (workEntity?.entityType !== "work") throw Error("Expected a Work entity");
              dispatchRelationship(re, recEntity, workEntity, recordingOfLinkTypeId, "", null, trackPos);
              log.info('Track ' + trackPos + ': linked existing Work "' + resolution.title + '".');
            } catch(error) {
              log.warn('Track ' + trackPos + ': could not stage verified existing Work: ' + error.message);
              continue;
            }
          }
          if (!workEntity && createdWorkRecGids.has(recGid)) {
            log.error(`Track ${trackPos} "${trackTitle}": a work was already created for this recording in this run \u2014 skipping to avoid a duplicate work`);
            failed++;
            continue;
          }
          if (!workEntity) {
          const newWorkId = re.getRelationshipStateId();
          workEntity = {
            _fromBatchCreateWorksDialog: true,
            attributes: [],
            comment: "",
            editsPending: false,
            entityType: "work",
            gid: null,
            id: newWorkId,
            iswcs: [],
            languages: [],
            name: trackTitle,
            typeID: 17
          };
          if (MB2.mergeLinkedEntities) {
            MB2.mergeLinkedEntities({ work: { [newWorkId]: workEntity } });
          }
          re.dispatch({
            type: "update-relationship-state",
            sourceEntity: recEntity,
            batchSelectionCount: null,
            creditsToChangeForSource: "",
            creditsToChangeForTarget: "",
            oldRelationshipState: null,
            newRelationshipState: {
              _lineage: ["batch-created work"],
              _original: null,
              _status: 1,
              attributes: null,
              begin_date: null,
              editsPending: false,
              end_date: null,
              ended: false,
              entity0: recEntity,
              entity0_credit: "",
              entity1: workEntity,
              entity1_credit: "",
              id: re.getRelationshipStateId(),
              linkOrder: 0,
              linkTypeID: recordingOfLinkTypeId
            }
          });
          createdWorkRecGids.add(recGid);
          log.info(`Track ${trackPos} "${trackTitle}": created new work "${trackTitle}"`);
          added++;
          tickProgress();
          workEntity = getWorkFromEditorState(recEntity) || workEntity;
          toolboxStagedTitles.add(toolboxNormalizeTitle(trackTitle));
          }
        }
        for (const { role } of entries) {
          const mbUrl = confirmedMbUrl(role.artist);
          if (!mbUrl) {
            log.skip(`Skipped ${role.artist.name} \u2014 not resolved in review (${role.linkType})`);
            continue;
          }
          const credit = role.creditedAs || stripDiscogsNum2(role.artist.anv?.trim() || role.artist.name);
          const srcType = role.entityType || "artist";
          const urlType = (mbUrl.match(/musicbrainz\.org\/(artist|label|place)\//i) || [])[1];
          if (urlType && urlType !== srcType) {
            log.skip(`Skipped ${role.linkType} for "${credit}" \u2014 resolved to an MB ${urlType}, but this relationship needs a ${srcType} (#417)`);
            continue;
          }
          if (workEntity.gid) {
            await processOne(workEntity, srcType, "work", role.linkType, mbUrl, role.attributes || [], credit, trackPos || entries[0]?.role?.track?.position);
          } else {
            const linkTypeID = resolveLinkTypeId(role.linkType, srcType, "work");
            if (linkTypeID) {
              const mbid = mbUrl.replace(/.*\//, "").replace(/[^a-f0-9-]/gi, "").substring(0, 36);
              try {
                const artistEntity = await fetchMBEntity(mbid);
                dispatchRelationship(re, workEntity, artistEntity, linkTypeID, credit, buildAttributes(role.attributes || [], linkTypeID));
                added++;
              } catch (e) {
                log.error(`Failed to add ${role.linkType} for new work: ${e.message}`);
              }
            }
          }
        }
      }
    }
    async function dispatchTracklistArtists() {
      const seenTrackRels = /* @__PURE__ */ new Set();
      for (const role of tracklistRels) {
        if (WORK_ONLY_ARTIST_RELS.includes(role.linkType)) continue;
        const mbUrl = confirmedMbUrl(role.artist);
        if (!mbUrl) {
          log.skip(`Skipped ${role.artist.name} on track ${role.track.position} \u2014 not resolved in review`);
          continue;
        }
        const recEntity = getRecordingEntity(role.track);
        if (!recEntity) {
          log.warn(`No recording found for track ${role.track.position} "${role.track.title}" \u2014 skipped`);
          failed++;
          continue;
        }
        if (!applyToRec(recEntity.gid)) continue;
        const credit = role.creditedAs || stripDiscogsNum2(role.artist.anv?.trim() || role.artist.name);
        const attrKey = (role.attributes || []).map((a) => typeof a === "string" ? a : a.value || a._type || "").join(",");
        const trackRelKey = `${role.track.position}|${role.linkType}|${mbUrl}|${attrKey}`;
        if (seenTrackRels.has(trackRelKey)) continue;
        seenTrackRels.add(trackRelKey);
        log.info(`Track ${role.track.position} "${role.track.title}": adding <strong>${role.linkType}</strong> \u2014 ${credit}`);
        await processOne(recEntity, "artist", "recording", role.linkType, mbUrl, role.attributes || [], credit, role.track.position);
        tickProgress();
      }
    }
    await dispatchCompanies();
    await dispatchReleaseArtists();
    await dispatchTracklist();
    await dispatchWorks();
    await dispatchTracklistArtists();
    try {
      const opts = [
        processTracklist !== void 0 ? `per-track:${processTracklist ? "on" : "off"}` : null,
        applyToTracks !== void 0 ? `move-to-tracks:${applyToTracks ? "on" : "off"}` : null,
        createWorksMode !== void 0 ? `create-works:${createWorksMode}` : null
      ].filter(Boolean).join(", ");
      const trackCount2 = Array.isArray(discogsTracklist) ? discogsTracklist.length : 0;
      const inputStats = `Input: ${companies?.length || 0} companies, ${artistRoles?.length || 0} release credits, ${tracklistRels?.length || 0} tracklist credits on ${trackCount2} track${trackCount2 === 1 ? "" : "s"}`;
      const unresolvedCount = confirmedMap?.unresolvedCount || 0;
      const totalEntities = confirmedMap?.totalEntities || 0;
      const unresolvedLine = unresolvedCount > 0 ? `Unresolved: ${unresolvedCount} of ${totalEntities} entit${totalEntities === 1 ? "y" : "ies"} skipped in review` : null;
      const editNoteDedupPart = dedupedThisSession > 0 ? `, ${dedupedThisSession} dispatch duplicate${dedupedThisSession === 1 ? "" : "s"}` : "";
      const editNoteStagedPart = existedStaged > 0 ? `, ${existedStaged} already added this session` : "";
      const resultStats = `Result: ${added} added, ${existedInMb} already in MB${editNoteStagedPart}${editNoteDedupPart}, ${skipped} skipped, ${failed} failed${recSelectionActive ? ` (applied to ${checkedRecGids.size} of ${recordingByGid.size} selected recordings)` : ""}`;
      const ourNote = buildEditNote(discogsUrl, opts, [inputStats, unresolvedLine, resultStats].filter(Boolean), dedupOpts.sourceLabel);
      const existingNote = document.querySelector(SELECTORS.EditNote)?.value || "";
      const note = combineEditNote(existingNote, ourNote);
      re.dispatch({ type: "update-edit-note", editNote: note });
    } catch (e) {
    }
    const dedupPart = dedupedThisSession > 0 ? `, ${dedupedThisSession} dispatch duplicate${dedupedThisSession === 1 ? "" : "s"}` : "";
    const stagedPart = existedStaged > 0 ? `, ${existedStaged} already added this session` : "";
    const selNote = recSelectionActive ? ` \u2014 applied to ${checkedRecGids.size} of ${recordingByGid.size} selected recording(s)` : "";
    log.info(`<strong>Done: ${added} added, ${existedInMb} already in MB${stagedPart}${dedupPart}, ${skipped} skipped, ${failed} failed${selNote}</strong>`);
  }

  // src/sources/apple.js
  var APPLE_AMP = "https://amp-api.music.apple.com/v1/catalog";
  var APPLE_ALBUM_RE = /(?:music|itunes)\.apple\.com\/(?:([a-z]{2})\/)?album\/(?:[^/?#]+\/)?(?:id)?(\d+)/i;
  function parseAppleAlbumUrl(url) {
    const m = APPLE_ALBUM_RE.exec(url || "");
    return m ? { storefront: (m[1] || "us").toLowerCase(), id: m[2] } : null;
  }
  var APPLE_ROLE_BRIDGE = {
    "Songwriter": "Written-By",
    "Writer": "Written-By",
    "Composer": "Composed By",
    "Lyricist": "Lyrics By",
    "Producer": "Producer",
    "Mixing Engineer": "Mixed By",
    "Mixer": "Mixed By",
    "Recording Engineer": "Recording Engineer",
    "Engineer": "Engineer",
    "Arranger": "Arranged By",
    "Vocalist": "Vocals",
    "Vocal": "Vocals",
    "Background Vocals": "Backing Vocals",
    "Background Vocal": "Backing Vocals"
  };
  var APPLE_SKIP = /* @__PURE__ */ new Set(["Performer", "Mastering Engineer", "Studio Personnel"]);
  function appleToEngine(parsedTracks) {
    const tracklistRels = [];
    const tracklist = [];
    const skipped = [];
    const tracks = parsedTracks || [];
    const { positions, multiVolume } = assignVolumePositions(tracks, (t) => t.index);
    tracks.forEach((t, i) => {
      const track = { position: positions[i], title: t.title || "", type_: "track" };
      tracklist.push(track);
      for (const c of t.credits || []) {
        const role = String(c.role || "").trim();
        const name = String(c.name || "").trim();
        if (!role || !name) continue;
        if (APPLE_SKIP.has(role)) {
          skipped.push(`track ${track.position}: ${role} \u2014 ${name}`);
          continue;
        }
        const discogsRole = APPLE_ROLE_BRIDGE[role] || role;
        const rels = getArtistRoles({ name, anv: "", role: discogsRole, resource_url: "" });
        if (!rels || !rels.length) {
          skipped.push(`track ${track.position}: ${role} \u2014 ${name} (unmapped)`);
          continue;
        }
        for (const rel of rels) tracklistRels.push({ ...rel, artist: rel.artist || { name, anv: "", resource_url: "" }, track });
      }
    });
    return { tracklistRels, tracklist, skipped, multiVolume };
  }
  function appleGet(url, headers) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest unavailable"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: headers || {},
        timeout: 2e4,
        onload: (r) => resolve({ status: r.status, text: r.responseText || "" }),
        onerror: () => reject(new Error("Apple request failed (network)")),
        ontimeout: () => reject(new Error("Apple request timed out"))
      });
    });
  }
  var _appleToken = null;
  var APPLE_TOKEN_LS = "ch:apple-token";
  async function appleToken() {
    if (_appleToken) return _appleToken;
    try {
      const raw = JSON.parse(localStorage.getItem(APPLE_TOKEN_LS) || "null");
      if (raw && raw.t && raw.at && Date.now() - raw.at < 12 * 36e5) {
        _appleToken = raw.t;
        return _appleToken;
      }
    } catch (e) {
    }
    const home = await appleGet("https://music.apple.com/us/browse", { "Accept": "text/html" });
    const asset = (home.text.match(/\/assets\/index-legacy~[a-z0-9]+\.js/i) || home.text.match(/\/assets\/index~[a-z0-9]+\.js/i) || [])[0];
    if (!asset) throw new Error("Apple: could not locate the web-player JS asset");
    const js = await appleGet("https://music.apple.com" + asset, {});
    const tok = (js.text.match(/eyJ[A-Za-z0-9._\-]{80,}/) || [])[0];
    if (!tok) throw new Error("Apple: no bearer token in the web-player JS");
    _appleToken = tok;
    try {
      localStorage.setItem(APPLE_TOKEN_LS, JSON.stringify({ t: tok, at: Date.now() }));
    } catch (e) {
    }
    return tok;
  }
  function ampHeaders(tok) {
    return { Authorization: "Bearer " + tok, Origin: "https://music.apple.com", Accept: "application/json" };
  }
  async function fetchAppleCredits(storefront, albumId, onProgress) {
    const sf = storefront || "us";
    const tok = await appleToken();
    const albRes = await appleGet(`${APPLE_AMP}/${sf}/albums/${encodeURIComponent(albumId)}?l=en-US`, ampHeaders(tok));
    if (albRes.status !== 200) throw new Error(`Apple album ${albumId} \u2192 HTTP ${albRes.status}`);
    let albJson;
    try {
      albJson = JSON.parse(albRes.text);
    } catch (e) {
      throw new Error("Apple: malformed album JSON");
    }
    const album = albJson.data && albJson.data[0];
    const albumName = album && album.attributes && album.attributes.name || "";
    let songs = album && album.relationships && album.relationships.tracks && album.relationships.tracks.data || [];
    let next = album && album.relationships && album.relationships.tracks && album.relationships.tracks.next;
    while (next) {
      const pg = await appleGet("https://amp-api.music.apple.com" + next + (next.includes("?") ? "&" : "?") + "l=en-US", ampHeaders(tok));
      let pj;
      try {
        pj = JSON.parse(pg.text);
      } catch (e) {
        break;
      }
      songs = songs.concat(pj.data || []);
      next = pj.next;
    }
    const tracks = [];
    let done = 0;
    for (const s of songs) {
      const sid = s.id;
      const num = s.attributes && s.attributes.trackNumber || done + 1;
      const title = s.attributes && s.attributes.name || "";
      const credits = [];
      try {
        const cr = await appleGet(`${APPLE_AMP}/${sf}/songs/${encodeURIComponent(sid)}/credits?l=en-US`, ampHeaders(tok));
        if (cr.status === 200) {
          let cj;
          try {
            cj = JSON.parse(cr.text);
          } catch (e) {
            cj = null;
          }
          for (const grp of cj && cj.data || []) {
            const arts = grp.relationships && grp.relationships["credit-artists"] && grp.relationships["credit-artists"].data || [];
            for (const a of arts) {
              const name = a.attributes && a.attributes.name;
              for (const role of a.attributes && a.attributes.roleNames || []) {
                if (name && role) credits.push({ name, role });
              }
            }
          }
        }
      } catch (e) {
      }
      if (credits.length) tracks.push({ index: +num, title, credits });
      done++;
      if (onProgress) {
        try {
          onProgress(done, songs.length);
        } catch (e) {
        }
      }
    }
    return { album: albumName, tracks };
  }

  // src/sources/ytmusic.js
  var YTM_API = "https://music.youtube.com/youtubei/v1/";
  var YTM_CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20250101.01.00", hl: "en", gl: "US" };
  var YTM_ALBUM_RE = /(?:^|\/\/)(?:(?:music|www|m)\.)?youtube\.com\/(?:playlist\?(?:[^#]*&)?list=(OLAK5uy_[\w-]+)|browse\/(MPREb_[\w-]+))/i;
  function parseYtmAlbumUrl(url) {
    const m = YTM_ALBUM_RE.exec(url || "");
    return m ? m[1] ? { list: m[1] } : { album: m[2] } : null;
  }
  var YTM_ROLE_BRIDGE = {
    "Written by": "Written-By",
    "Produced by": "Producer"
  };
  var YTM_SKIP = {
    "Performed by": "the track artist credit",
    "Music metadata provided by": "the label or distributor"
  };
  function ytmPositions(count, mediumSizes) {
    const sizes = (mediumSizes || []).filter((n) => n > 0);
    const plain = Array.from({ length: count }, (_, i) => String(i + 1));
    if (sizes.length <= 1) return { positions: plain, multiMedium: false, mismatch: false };
    const total = sizes.reduce((a, b) => a + b, 0);
    if (total !== count) return { positions: plain, multiMedium: true, mismatch: true };
    const positions = [];
    sizes.forEach((n, m) => {
      for (let t = 1; t <= n; t++) positions.push(`${m + 1}-${t}`);
    });
    return { positions, multiMedium: true, mismatch: false };
  }
  function ytmToEngine(songs, mediumSizes) {
    const tracklistRels = [];
    const tracklist = [];
    const skipped = [];
    const list = songs || [];
    const { positions, multiMedium, mismatch } = ytmPositions(list.length, mediumSizes);
    list.forEach((s, i) => {
      const track = { position: positions[i], title: s.title || "", type_: "track" };
      tracklist.push(track);
      for (const [section, names] of Object.entries(s.sections || {})) {
        const named = (names || []).map((n) => String(n || "").trim()).filter(Boolean);
        if (!named.length) continue;
        if (YTM_SKIP[section]) {
          skipped.push(`track ${track.position}: ${section} \u2014 ${named.join(", ")} (${YTM_SKIP[section]})`);
          continue;
        }
        const role = YTM_ROLE_BRIDGE[section];
        if (!role) {
          skipped.push(`track ${track.position}: ${section} \u2014 ${named.join(", ")} (unmapped section)`);
          continue;
        }
        for (const name of named) {
          const rels = getArtistRoles({ name, anv: "", role, resource_url: "" });
          if (!rels || !rels.length) {
            skipped.push(`track ${track.position}: ${section} \u2014 ${name} (unmapped)`);
            continue;
          }
          for (const rel of rels) tracklistRels.push({ ...rel, artist: rel.artist || { name, anv: "", resource_url: "" }, track });
        }
      }
    });
    return { tracklistRels, tracklist, skipped, multiMedium, mismatch };
  }
  function ytmPost(endpoint, body) {
    const what = body.browseId || endpoint;
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest unavailable"));
        return;
      }
      const t0 = Date.now();
      GM_xmlhttpRequest({
        method: "POST",
        url: `${YTM_API}${endpoint}?prettyPrint=false`,
        anonymous: true,
        timeout: 2e4,
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ context: { client: YTM_CLIENT }, ...body }),
        onload: (r) => {
          const text = r.responseText || "";
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (e) {
          }
          logDebug(`YouTube Music: ${endpoint} ${what} \u2192 HTTP ${r.status}, ${text.length}b in ${Date.now() - t0}ms`);
          if (r.status !== 200 || !json) {
            reject(new Error(`YouTube Music ${endpoint} ${what} \u2192 HTTP ${r.status}${r.status === 200 ? ", not JSON" : ""} \u2014 YouTube Music's API may have changed`));
            return;
          }
          resolve(json);
        },
        onerror: () => reject(new Error(`YouTube Music ${endpoint} ${what}: network error`)),
        ontimeout: () => reject(new Error(`YouTube Music ${endpoint} ${what}: timed out`))
      });
    });
  }
  var ytmText = (t) => t && t.runs ? t.runs.map((x) => x.text).join("") : t && t.simpleText || "";
  function ytmWalk(o, fn) {
    if (!o || typeof o !== "object") return;
    fn(o);
    for (const k in o) ytmWalk(o[k], fn);
  }
  var videoType = (w) => w && w.watchEndpointMusicSupportedConfigs && w.watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig && w.watchEndpointMusicSupportedConfigs.watchEndpointMusicConfig.musicVideoType;
  function ytmRows(json) {
    const rows = [];
    ytmWalk(json, (o) => {
      const r = o.musicResponsiveListItemRenderer;
      if (!r) return;
      let w = null;
      ytmWalk(r, (x) => {
        if (!w && x.watchEndpoint && x.watchEndpoint.videoId) w = x.watchEndpoint;
      });
      const id = r.playlistItemData && r.playlistItemData.videoId || w && w.videoId;
      if (!id) return;
      const col = r.flexColumns && r.flexColumns[0] && r.flexColumns[0].musicResponsiveListItemFlexColumnRenderer;
      rows.push({ title: ytmText(col && col.text), videoId: id, type: videoType(w) || null });
    });
    return rows;
  }
  function ytmCreditSections(json) {
    const out = {};
    ytmWalk(json, (o) => {
      const s = o.dismissableDialogContentSectionRenderer;
      if (s) out[ytmText(s.title)] = (s.subtitle && s.subtitle.runs || []).map((r) => r.text.trim()).filter(Boolean);
    });
    return out;
  }
  async function fetchYtmCredits(url, onProgress) {
    const parsed = parseYtmAlbumUrl(url);
    if (!parsed) throw new Error(`Not a YouTube Music album link: ${url}`);
    let list = parsed.list, album = "";
    if (!list) {
      const a = await ytmPost("browse", { browseId: parsed.album });
      const canon = a.microformat && a.microformat.microformatDataRenderer && a.microformat.microformatDataRenderer.urlCanonical || "";
      list = (canon.match(/[?&]list=(OLAK5uy_[\w-]+)/) || JSON.stringify(a).match(/"(OLAK5uy_[\w-]+)"/) || [])[1];
      let h = null;
      ytmWalk(a, (o) => {
        if (!h && o.musicResponsiveHeaderRenderer) h = o.musicResponsiveHeaderRenderer;
      });
      album = h ? ytmText(h.title) : "";
      log.info(`YouTube Music: album ${parsed.album} "${album}" \u2192 playlist ${list || "(none found)"}`);
      if (!list) throw new Error(`YouTube Music: album ${parsed.album} names no playlist \u2014 its page may have changed`);
    }
    const pl = await ytmPost("browse", { browseId: "VL" + list });
    if (!album) {
      let h = null;
      ytmWalk(pl, (o) => {
        if (!h && (o.musicResponsiveHeaderRenderer || o.musicDetailHeaderRenderer)) h = o.musicResponsiveHeaderRenderer || o.musicDetailHeaderRenderer;
      });
      album = h ? ytmText(h.title) : "";
    }
    if (/"continuations?"|"continuationItemRenderer"/.test(JSON.stringify(pl))) log.warn(`YouTube Music: playlist ${list} has more songs than its first page \u2014 only those are read`);
    const rows = ytmRows(pl);
    const types = rows.reduce((m, r) => {
      const k = (r.type || "?").replace("MUSIC_VIDEO_TYPE_", "");
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});
    log.info(`YouTube Music: playlist ${list} "${album}" \u2014 ${rows.length} row(s) (${Object.entries(types).map(([k, n]) => `${n} ${k}`).join(", ") || "none"})`);
    const songs = [];
    let done = 0;
    for (const r of rows) {
      let sections = {};
      if (r.type && r.type !== "MUSIC_VIDEO_TYPE_ATV") logDebug(`YouTube Music: row ${done + 1} "${r.title}" is a ${r.type}, not a song \u2014 it has no credits`);
      else {
        try {
          sections = ytmCreditSections(await ytmPost("browse", { browseId: "MPTC" + r.videoId }));
        } catch (e) {
          log.warn(`YouTube Music: credits of "${r.title}" (${r.videoId}) failed \u2014 ${e.message}`);
        }
      }
      logDebug(`YouTube Music: ${done + 1}. "${r.title}" (${r.videoId}) \u2014 ${Object.keys(sections).map((k) => `${k}: ${sections[k].join(", ")}`).join(" \xB7 ") || "no credits"}`);
      songs.push({ title: r.title, videoId: r.videoId, sections });
      done++;
      if (onProgress) {
        try {
          onProgress(done, rows.length);
        } catch (e) {
        }
      }
    }
    return { album, list, songs };
  }

  // src/sources/deezer.js
  function decodeEntities2(s) {
    return String(s).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#039;/g, "'").replace(/&apos;/g, "'");
  }
  var DEEZER_LABEL_MAP = {
    "Composers": { rel: "composer" },
    "Composer": { rel: "composer" },
    "Authors": { rel: "lyricist" },
    "Author": { rel: "lyricist" },
    "Writers": { rel: "writer" },
    "Writer": { rel: "writer" },
    "Producers": { rel: "producer" },
    "Producer": { rel: "producer" }
  };
  var DEEZER_ALBUM_RE = /^(?:https?:)?\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?album\/(\d+)/i;
  function parseDeezerAlbumUrl(url) {
    const m = DEEZER_ALBUM_RE.exec(url || "");
    return m ? { id: m[1], pageUrl: `https://www.deezer.com/us/album/${m[1]}` } : null;
  }
  var DEEZER_NO_INFO_RE = /^\s*no\s*info\s*$/i;
  function parseDeezerCreditLine(line) {
    const text = decodeEntities2(String(line)).trim();
    const byName = /* @__PURE__ */ new Map();
    for (const group of text.split(" / ")) {
      const m = /^([^:]+):\s*(.*)$/.exec(group.trim());
      if (!m) continue;
      const plan = DEEZER_LABEL_MAP[m[1].trim()];
      if (!plan) continue;
      for (const raw of m[2].split(/\s*,\s*|\s+-\s+/)) {
        const name = raw.trim();
        if (!name || DEEZER_NO_INFO_RE.test(name)) continue;
        if (!byName.has(name)) byName.set(name, []);
        const roles = byName.get(name);
        if (!roles.includes(plan.rel)) roles.push(plan.rel);
      }
    }
    return [...byName].map(([name, roles]) => ({ name, roles }));
  }
  function extractDeezerCredits(html) {
    const posByTrack = /* @__PURE__ */ new Map();
    const posRe = /itemid="\/[a-z]{2}\/track\/(\d+)"[\s\S]{0,600}?data-target="position">\s*(\d+)/gi;
    let pm;
    while ((pm = posRe.exec(html)) !== null) {
      const id = pm[1];
      if (!posByTrack.has(id)) posByTrack.set(id, parseInt(pm[2], 10));
    }
    const out = [];
    const credRe = /naboo_datagrid_contributors_(\d+)"[\s\S]{0,400}?data-target="contributors">([^<]*)</gi;
    let cm;
    while ((cm = credRe.exec(html)) !== null) {
      const id = cm[1];
      const pos = posByTrack.get(id);
      if (!pos) continue;
      const credits = parseDeezerCreditLine(cm[2]);
      if (credits.length) out.push({ index: pos, credits });
    }
    return out;
  }
  function extractDeezerAlbumInfo(html) {
    const og = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] || "";
    return decodeEntities2(og);
  }
  function deezerToEngine(parsedTracks) {
    const tracklistRels = [];
    const tracklist = [];
    const skipped = [];
    const { positions, multiVolume } = assignVolumePositions(parsedTracks, (t) => t.index);
    parsedTracks.forEach((t, i) => {
      const track = { position: positions[i], title: "", type_: "track" };
      tracklist.push(track);
      for (const credit of t.credits) {
        for (const rel of credit.roles) {
          tracklistRels.push({
            linkType: rel,
            entityType: "artist",
            attributes: [],
            artist: { name: credit.name, anv: "", resource_url: "" },
            track
          });
        }
      }
    });
    return { tracklistRels, tracklist, skipped, multiVolume };
  }
  function fetchDeezerAlbumPage(pageUrl) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest unavailable"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url: pageUrl,
        headers: { "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.8" },
        timeout: 2e4,
        onload: (r) => r.status >= 200 && r.status < 400 && r.responseText ? resolve(r.responseText) : reject(new Error(`Deezer page returned ${r.status}`)),
        onerror: () => reject(new Error("Deezer page fetch failed (network)")),
        ontimeout: () => reject(new Error("Deezer page fetch timed out"))
      });
    });
  }

  // src/consolidate.js
  var fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  var entityKeyOf = (a) => a && a.resource_url ? a.resource_url : `_nourl_${a && (a.name || a.id) || ""}`;
  var attrsSig = (rel) => JSON.stringify(
    (rel.attributes || []).map((x) => x && typeof x === "object" && x._type ? `${x._type}:${x.value}` : String(x)).sort()
  );
  var relKeyOf = (rel) => [
    entityKeyOf(rel.artist),
    rel.linkType || "",
    attrsSig(rel),
    rel.track ? String(rel.track.position != null ? rel.track.position : "") : ""
  ].join("\x01");
  function mergeHarvests(harvests) {
    const mkDedup = () => {
      const seen = /* @__PURE__ */ new Map(), order = [];
      return {
        add(rel, source) {
          const k = relKeyOf(rel);
          if (!seen.has(k)) {
            seen.set(k, { rel, sources: /* @__PURE__ */ new Set() });
            order.push(k);
          }
          seen.get(k).sources.add(source);
        },
        drain(relSrc2, entitySrc2) {
          const arr = [];
          for (const k of order) {
            const e = seen.get(k);
            arr.push(e.rel);
            relSrc2.set(k, [...e.sources]);
            const ek = entityKeyOf(e.rel.artist);
            if (!entitySrc2.has(ek)) entitySrc2.set(ek, /* @__PURE__ */ new Set());
            e.sources.forEach((s) => entitySrc2.get(ek).add(s));
          }
          return arr;
        }
      };
    };
    const relSrc = /* @__PURE__ */ new Map(), entitySrc = /* @__PURE__ */ new Map();
    const arD = mkDedup(), trD = mkDedup();
    const companies = [], seenCo = /* @__PURE__ */ new Set();
    const tracklist = [], seenPos = /* @__PURE__ */ new Set();
    let processTracklist = false;
    for (const h of harvests || []) {
      if (!h) continue;
      const src = h.sourceName || "Source";
      if (h.processTracklist) processTracklist = true;
      (h.artistRoles || []).forEach((r) => arD.add(r, src));
      (h.tracklistRels || []).forEach((r) => trD.add(r, src));
      (h.companies || []).forEach((c) => {
        const ck = c.resource_url || `co:${fold(c.entity_type_name)}|${fold(c.name)}`;
        if (ck && !seenCo.has(ck)) {
          seenCo.add(ck);
          companies.push(c);
        }
        const ek = entityKeyOf(c);
        if (!entitySrc.has(ek)) entitySrc.set(ek, /* @__PURE__ */ new Set());
        entitySrc.get(ek).add(src);
      });
      (h.tracklist || []).forEach((t) => {
        const pos = String(t && t.position != null ? t.position : "");
        const key = pos || `#${tracklist.length}`;
        if (!seenPos.has(key)) {
          seenPos.add(key);
          tracklist.push(t);
        }
      });
    }
    const artistRoles = arD.drain(relSrc, entitySrc);
    const tracklistRels = trD.drain(relSrc, entitySrc);
    const entitySources = /* @__PURE__ */ new Map();
    entitySrc.forEach((set, k) => entitySources.set(k, [...set]));
    return { companies, artistRoles, tracklistRels, tracklist, processTracklist, relSrc, entitySources };
  }
  var _resultKey = (r) => r && r.entity && (r.entity.resource_url || r.entity._syntheticKey) || `_nourl_${r && (r.entity && r.entity.name || r.displayName) || ""}`;
  var _resultName = (r) => r && (r.entity && r.entity.name || r.displayName) || "";
  var _resultKind = (r) => r && (r.entityType || r.entity && r.entity.entityType) || "artist";
  var _roleKey = (ro) => [ro.linkType, ro.displayLabel, ro.trackPos, ro.trackTitle].join("");
  var boundedLev = (a, b, max) => {
    if (Math.abs(a.length - b.length) > max) return -1;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
    for (let j = 1; j <= b.length; j++) {
      let prev = dp[0];
      dp[0] = j;
      let rowMin = dp[0];
      for (let i = 1; i <= a.length; i++) {
        const tmp = dp[i];
        dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
        if (dp[i] < rowMin) rowMin = dp[i];
      }
      if (rowMin > max) return -1;
    }
    return dp[a.length] <= max ? dp[a.length] : -1;
  };
  var fuzzyMax = (len) => len <= 6 ? 0 : len <= 12 ? 1 : 2;
  var stripInitials = (fn) => fn.split(" ").filter((t) => !/^[a-z]\.?$/.test(t)).join(" ");
  function mergeResolvedResults(allResults, entitySources) {
    const rows = (allResults || []).filter(Boolean);
    const nameMbids = /* @__PURE__ */ new Map();
    const nameMbidsStripped = /* @__PURE__ */ new Map();
    for (const r of rows) {
      if (r.type !== "resolved" || !r.mbUrl) continue;
      const fn = fold(_resultName(r));
      if (!fn) continue;
      const kn = _resultKind(r) + "|" + fn;
      if (!nameMbids.has(kn)) nameMbids.set(kn, /* @__PURE__ */ new Set());
      nameMbids.get(kn).add(r.mbUrl);
      const sn = _resultKind(r) + "|" + stripInitials(fn);
      if (!nameMbidsStripped.has(sn)) nameMbidsStripped.set(sn, /* @__PURE__ */ new Set());
      nameMbidsStripped.get(sn).add(r.mbUrl);
    }
    const conflictNames = /* @__PURE__ */ new Set();
    nameMbids.forEach((set, kn) => {
      if (set.size > 1) conflictNames.add(kn);
    });
    const uniqResolved = [];
    nameMbids.forEach((set, kn) => {
      if (set.size === 1) uniqResolved.push([kn, [...set][0]]);
    });
    const fuzzyResolvedMatch = (kfn) => {
      const [kind, fn] = [kfn.slice(0, kfn.indexOf("|")), kfn.slice(kfn.indexOf("|") + 1)];
      let hit = null;
      for (const [kn, url] of uniqResolved) {
        if (!kn.startsWith(kind + "|")) continue;
        const nm = kn.slice(kind.length + 1);
        if (boundedLev(fn, nm, fuzzyMax(Math.max(fn.length, nm.length))) < 0) continue;
        if (hit && hit !== url) return null;
        hit = url;
      }
      return hit;
    };
    const keyFor = (r) => {
      const fn = fold(_resultName(r));
      const kn = fn ? _resultKind(r) + "|" + fn : "";
      if (kn && conflictNames.has(kn)) return "cf:" + kn;
      if (r.type === "resolved" && r.mbUrl) return "mb:" + r.mbUrl;
      if (!fn) return null;
      const set = nameMbids.get(kn);
      if (set && set.size === 1) return "mb:" + [...set][0];
      if (!set) {
        const stripped = nameMbidsStripped.get(_resultKind(r) + "|" + stripInitials(fn));
        if (stripped && stripped.size === 1) return "mb:" + [...stripped][0];
      }
      const fuzzy = fuzzyResolvedMatch(kn);
      if (fuzzy) return "mb:" + fuzzy;
      return "nm:" + kn;
    };
    const byKey = /* @__PURE__ */ new Map(), mergeMap = /* @__PURE__ */ new Map(), out = [];
    for (const r of rows) {
      const gk = keyFor(r), rk = _resultKey(r);
      if (!gk || !byKey.has(gk)) {
        if (gk) {
          byKey.set(gk, r);
          mergeMap.set(rk, [rk]);
          if (gk.startsWith("cf:")) r._conflicts = [r.mbUrl ? { mbUrl: r.mbUrl, mbName: r.mbName, mbDisambig: r.mbDisambig } : null];
        }
        out.push(r);
        continue;
      }
      const rep = byKey.get(gk), repKey = _resultKey(rep);
      if (gk.startsWith("cf:")) {
        if (r.mbUrl) (rep._conflicts = rep._conflicts || []).push({ mbUrl: r.mbUrl, mbName: r.mbName, mbDisambig: r.mbDisambig });
      } else if ((rep.type !== "resolved" || !rep.mbUrl) && r.type === "resolved" && r.mbUrl) {
        rep.type = "resolved";
        rep.mbUrl = r.mbUrl;
        rep.mbName = r.mbName;
        rep.mbDisambig = r.mbDisambig;
        rep.entityType = r.entityType || rep.entityType;
        rep.logEntry = r.logEntry || rep.logEntry;
      }
      const seen = new Set((rep._roles || []).map(_roleKey));
      rep._roles = (rep._roles || []).concat((r._roles || []).filter((ro) => {
        const k = _roleKey(ro);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }));
      if (entitySources) {
        const u = new Set(entitySources.get(repKey) || []);
        (entitySources.get(rk) || []).forEach((s) => u.add(s));
        entitySources.set(repKey, [...u]);
      }
      mergeMap.get(repKey).push(rk);
    }
    byKey.forEach((rep, gk) => {
      if (!gk.startsWith("cf:")) return;
      const cands = [], seenIds = /* @__PURE__ */ new Set();
      for (const c of rep._conflicts || []) {
        const m = c && c.mbUrl && c.mbUrl.match(/\/(?:artist|label|place)\/([^/?#]+)/i);
        if (!m || seenIds.has(m[1])) continue;
        seenIds.add(m[1]);
        cands.push({ id: m[1], name: c.mbName || _resultName(rep), disambiguation: c.mbDisambig || "" });
      }
      rep.nameMatches = cands.concat((rep.nameMatches || []).filter((nm) => nm && nm.id && !seenIds.has(nm.id)));
      rep.type = "attention";
      rep.mbUrl = null;
      rep.mbName = null;
      rep.mbDisambig = "";
      rep.ambiguityReason = "sources link this name to different MB artists";
      delete rep._conflicts;
    });
    for (const rep of out) {
      const keys = mergeMap.get(_resultKey(rep));
      rep._mergeUrls = [...new Set((keys || []).filter((k) => /^https?:\/\//i.test(k) && !/tidal\.com\/_(?:publisher|company)\//i.test(k)).map((k) => k.replace(/^https?:\/\/api\.discogs\.com\/(\w+?)s\/(\d+).*$/i, "https://www.discogs.com/$1/$2")))];
    }
    return { results: out, mergeMap };
  }

  // src/ui-bar.js
  var _logs2;
  var _summary;
  var _discogsJson = null;
  var _tidalJson = null;
  var _maJson = null;
  var _qobuzJson = null;
  var _deezerJson = null;
  var _appleJson = null;
  var _ytmJson = null;
  var _consolidatedJson = null;
  var ST_ICONS = { "musicbrainz": { "color": "#eb743b", "svg": '<svg viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><g transform="translate(1.5)"><path d="m13 1-12 7v14l12 7z" fill="#ba478f"/><path d="m14 1 12 7v14l-12 7z" fill="#eb743b"/></g></svg>' }, "discogs": { "color": "#333333", "svg": '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg"><g transform="translate(512 512) scale(0.86) translate(-512 -512)"><circle cx="512" cy="512" r="496" fill="#333" stroke="#9a9a9a" stroke-width="32"/><path fill="#fff" d="M439.84 511.58A72.58 72.58 0 0 1 512.41 439 72.54 72.54 0 0 1 585 511.58a72.56 72.56 0 0 1-72.57 72.56 72.56 72.56 0 0 1-72.57-72.56zm3.18 0A69.48 69.48 0 0 0 512.41 581a69.4 69.4 0 0 0 69.4-69.38 69.49 69.49 0 0 0-69.4-69.43A69.44 69.44 0 0 0 443 511.58zm69.42-11.44a11.43 11.43 0 1 0 11.47 11.45 11.45 11.45 0 0 0-11.48-11.45zm-131.08 11.43a130.68 130.68 0 0 0 40.3 94.43l24.68-26.69.33.3a94.59 94.59 0 0 1 113.08-149.95l17.51-31.95a130.23 130.23 0 0 0-64.82-17.22c-72.27.01-131.08 58.81-131.08 131.08zm225.73 0a94.6 94.6 0 0 1-138.64 83.79l-17.83 31.74a130.26 130.26 0 0 0 61.82 15.53c72.28 0 131.08-58.8 131.08-131.08a130.63 130.63 0 0 0-37.73-91.9L581 446.39a94.3 94.3 0 0 1 26.1 65.2zm-267.34 0a172.17 172.17 0 0 0 53.68 125l25-27.07a135.38 135.38 0 0 1-41.82-97.89c0-74.88 60.92-135.8 135.8-135.8a134.92 134.92 0 0 1 67.08 17.8l17.73-32.34a171.57 171.57 0 0 0-84.81-22.35c-95.19-.03-172.66 77.43-172.66 172.65zm308.49 0c0 74.88-60.92 135.8-135.8 135.8a135 135 0 0 1-64.14-16.14l-18.07 32.17a171.62 171.62 0 0 0 82.21 20.86c95.22 0 172.69-77.47 172.69-172.69a172.15 172.15 0 0 0-51-122.4l-25.12 27a135.35 135.35 0 0 1 39.23 95.4zm41.61 0c0 97.83-79.58 177.43-177.41 177.43a176.32 176.32 0 0 1-84.52-21.46l-18.18 32.36a213.21 213.21 0 0 0 102.7 26.23C630.74 726.11 727 629.87 727 511.57a213.87 213.87 0 0 0-64.38-153l-25.26 27.18a176.85 176.85 0 0 1 52.49 125.82zm-392 0A213.9 213.9 0 0 0 365 667.24L390.23 640A176.88 176.88 0 0 1 335 511.57c0-97.82 79.59-177.41 177.41-177.41a176.26 176.26 0 0 1 87.08 22.93l17.84-32.55A213.14 213.14 0 0 0 512.44 297c-118.3 0-214.54 96.28-214.54 214.57zm392.55-183-24.64 26.49a218.57 218.57 0 0 1 65.94 156.51c0 120.9-98.36 219.26-219.26 219.26a217.9 217.9 0 0 1-105-26.84l-18.24 32.47A255.43 255.43 0 0 0 512 768c141.39 0 256-114.64 256-256a255.23 255.23 0 0 0-77.55-183.41zm-397.27 183c0-120.9 98.36-219.26 219.26-219.26a217.84 217.84 0 0 1 107.19 28.09L637 288.65A254.46 254.46 0 0 0 516.12 256H512c-140.54.22-254.42 113.26-256 253.5v2.5a255.69 255.69 0 0 0 80.51 186.08l25.31-27.36a218.61 218.61 0 0 1-68.64-159.15z"/></g></svg>' }, "spotify": { "color": "#1DB954", "svg": '<svg viewBox="0 0 24 24" fill="#1DB954"><path transform="translate(12 12) scale(.875) translate(-12 -12)" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/></svg>' }, "apple": { "color": "#FA243C", "svg": '<svg viewBox="0 0 24 24" fill="#FA243C"><path d="M17.05 12.04c-.03-2.5 2.04-3.7 2.13-3.76-1.16-1.7-2.97-1.93-3.61-1.96-1.54-.16-3 .9-3.78.9-.78 0-1.97-.88-3.24-.86-1.67.03-3.21.97-4.07 2.46-1.73 3.01-.44 7.47 1.24 9.92.82 1.2 1.8 2.54 3.08 2.49 1.24-.05 1.71-.8 3.21-.8 1.5 0 1.92.8 3.23.77 1.33-.02 2.18-1.22 3-2.42.94-1.39 1.33-2.73 1.35-2.8-.03-.01-2.59-.99-2.62-3.93zM14.6 4.59c.68-.83 1.14-1.97 1.01-3.11-.98.04-2.17.65-2.87 1.47-.63.73-1.18 1.9-1.03 3.02 1.09.08 2.21-.55 2.89-1.38z"/></svg>' }, "deezer": { "color": "#A238FF", "svg": '<svg viewBox="0 0 24 24"><path transform="translate(12 12) scale(.74) translate(-12 -12)" d="M4 2h6v2h-6zM14 2h6v2h-6zM2 4h20v2h-20zM0 6h24v2h-24zM0 8h24v2h-24zM0 10h24v2h-24zM2 12h20v2h-20zM4 14h16v2h-16zM6 16h12v2h-12zM8 18h8v2h-8zM10 20h4v2h-4z" fill="#A238FF"/></svg>' }, "tidal": { "color": "#000000", "svg": '<svg viewBox="0 0 24 24"><path d="M6 6l3 3-3 3-3-3zM12 6l3 3-3 3-3-3zM18 6l3 3-3 3-3-3zM12 12l3 3-3 3-3-3z" style="fill:var(--mbu-text,currentColor)"/></svg>' }, "qobuz": { "color": "#0070ef", "svg": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#0070ef"/><circle cx="12" cy="12" r="5" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M14.5 14.5 19 19" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>' }, "beatport": { "color": "#01FF95", "svg": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#000"/><g transform="translate(12 12) scale(0.84) translate(-12 -12)" fill="none" stroke="#01FF95" stroke-width="2.5"><path d="M10.9 3V8.3c0 1.2-.4 1.9-1.1 2.6L5.6 15.1"/><circle cx="13.9" cy="15.8" r="4.05" stroke-width="2.35"/></g></svg>' }, "bandcamp": { "color": "#629AA9", "svg": '<svg viewBox="0 0 24 24" fill="#629AA9"><path transform="translate(12 12) scale(.8) translate(-12 -12)" d="M0 18.75l7.437-13.5H24l-7.438 13.5z"/></svg>' }, "volumo": { "color": "#7c4dff", "svg": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#7c4dff"/><path d="M7 8h2.2l2.8 6 2.8-6H17l-4 9h-2z" fill="#fff"/></svg>' }, "hdtracks": { "color": "#e63329", "svg": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#e63329"/><path d="M5 7.5h1.7v3.1h2.6V7.5H11v8H9.3v-3.2H6.7v3.2H5zm7.2 0h2.9c2 0 3.4 1.6 3.4 4s-1.4 4-3.4 4h-2.9zm1.7 1.5v5h1.1c1.1 0 1.8-1 1.8-2.5s-.7-2.5-1.8-2.5z" fill="#fff"/></svg>' }, "soundcloud": { "color": "#ff5500", "svg": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ff5500"/><g fill="#fff"><rect x="6" y="12" width="1.4" height="4" rx=".6"/><rect x="8.5" y="10" width="1.4" height="6" rx=".6"/><rect x="11" y="8.5" width="1.4" height="7.5" rx=".6"/><rect x="13.5" y="10.5" width="1.4" height="5.5" rx=".6"/><rect x="16" y="11.5" width="1.4" height="4.5" rx=".6"/></g></svg>' }, "audiomack": { "color": "#FFA200", "svg": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#FFA200"/><path d="M5 13.5l2-2 1.6 2.4 2.2-5.4 2.4 6.6 2.2-4 1.6 2.4H19" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>' }, "sevendigital": { "color": "#07606E", "svg": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#07606E"/><path d="M7.8 6.8h8.4v1.9l-4.5 8.9H9.4l4.4-8.7h-6z" fill="#fff"/></svg>' }, "ytmusic": { "color": "#FF0000", "svg": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#FF0000"/><circle cx="12" cy="12" r="5.6" fill="none" stroke="#fff" stroke-width="1.4"/><path d="M10.4 9.5v5l4.2-2.5z" fill="#fff"/></svg>' }, "amazonmusic": { "color": "#25D1DA", "svg": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#25D1DA"/><path d="M5.8 11.2c3.5 3.2 8.9 3.5 12.4.9" fill="none" stroke="#0F1111" stroke-width="1.9" stroke-linecap="round"/><path d="M15.5 10.7l3 1.3-.9 3.1" fill="none" stroke="#0F1111" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>' }, "soundexchange": { "color": "#6f42c1", "svg": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#6f42c1"/><path d="M6.5 12h1.3l1-3 1.6 6 1.6-9 1.6 12 1.4-6h1.5" fill="none" stroke="#fff" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>' }, "globe": { "color": "#6f7d75", "svg": '<svg viewBox="0 0 24 24" fill="none" stroke="#6f7d75" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>' } };
  function stIcon(name, size) {
    var i = ST_ICONS[name];
    if (!i) return "";
    size = size || 16;
    return i.svg.replace(/<svg\b([^>]*)>/, function(m, a) {
      a = a.replace(/\s(?:width|height)="[^"]*"/g, "");
      var ns = /\bxmlns=/.test(a) ? "" : ' xmlns="http://www.w3.org/2000/svg"';
      return "<svg" + a + ns + ' width="' + size + '" height="' + size + '">';
    });
  }
  var SRC_ICON = {
    Discogs: stIcon("discogs", 16),
    Tidal: stIcon("tidal", 16),
    Qobuz: stIcon("qobuz", 16),
    Deezer: stIcon("deezer", 16),
    Apple: stIcon("apple", 16),
    "YouTube Music": stIcon("ytmusic", 16),
    // #648 — the All review's per-entity source badge
    "Metal Archives": '<img src="data:image/x-icon;base64,AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAQAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADw+ODwAAbmwAAGe3AAByzAAAfswQEI+9DAyKeBgYlxUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB2ZgAAeO0AAG3/AAAk/wAAAP8AAAD/AAAk/yUlpP8AADH7AAAA/wAAAP8AAACWAAAAAAAAAAAAAAAAAAB+jQAAaP8AAHH/AABr/wAAAP9wfpf/cH6X/wAAAP8AAHr/AAAA/3B+l/9wfpf/AAAA/wAAAAAAAAAAAAB+ZgAAWP8BAYD/DAyK/wAAev8AAAD/fYyo/32MqP8AAAD/AAAA/wAAAP99jKj/fYyo/wAAAP8AAAAAAQGAEhMTku0AAGz/AABk/wMDgv8AAGv/AAAt/wAAAP+LnLv/i5y7/4ucu/+LnLv/i5y7/4ucu/8AAAD/AAB/JAAAZWkICIf/BgaF/wAAef8AAEz/AABx/wEBgP8EBDj/AAAA/5qt0P8AAAD/AAAA/5qt0P+ardD/AAAA/wAAbocAAHKxAABe/wAAc/8REZD/AABl/wwMiv8VFZT/AABv/wAALf8AAAD/qL3j/wAAAP+oveP/qL3j/wAAAP8AAHHPAAAe7AAAAP8AAAD/AAAy/wAAev8NDUH/AAAA/wAAAP8BATb/AAAh/wAAAP+1y/T/tcv0/7XL9P8AAAD/AQGA+QAAAP9ygJr/coCa/wAAAP8CAoH/AAAA/3KAmv9ygJr/AAAA/wAAfP8GBjr/AAAA/73U//+91P//AAAA/wAAcvYAAAD/gZGu/4GRrv8AAAD/AAAA/wAAAP+Bka7/gZGu/wAAAP8AAHj/AABu/wAAM/8AAAD/AAAA/wEBNv8AAHPYAAAA/5Olxv+Tpcb/AAAA/5Olxv8AAAD/k6XG/5Olxv8AAAD/Dw+O/wAAaP8AAHn/AABe/wAAWv8AAGv/AAB0lgAAAP+kuN3/pLjd/wAAAP+kuN3/AAAA/6S43f+kuN3/AAAA/wAAW/8AAHL/AAB//wICgf8AAHH/AABy/AAAbTAAAAD/s8nx/7PJ8f+zyfH/AAAA/7PJ8f+zyfH/s8nx/wAAAP8AAH7/AAB//wAAe/8AAGv/AAB7/wAAepwAAAAAAAAA/73U//+91P//AAAA/wAAMP8AAAD/vdT//73U//8AAAD/BweG/wkJiP8AAHX/AABt/wAAfMMcHJsGAAAAAAAAAJYAAAD/AAAA/wAAFbsWFpXwAAAs/wAAAP8AAAD/CAg8/xcXlv8AAF7/AAB49gAAZHUREZADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABhGw8PjoQAAGrJAQGA+QkJiP8TE5LMAAB2jQ0NjCcAAAAAAAAAAAAAAAAAAAAA8A8AAOABAADAAQAAgAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAABAAAAAwAA8A8AAA==" width="16" height="16" alt="Metal Archives" style="display:inline-block;vertical-align:middle">',
    // #453 real MA favicon
    Titles: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 11h16M4 16h10"/></svg>'
  };
  var srcIconByUrl = (url) => SRC_ICON[sourceNameForUrl(url)] || "";
  function insertDiscogsBar(discogsUrl, sources = {}, meta = {}) {
    const MBU_TOKENS = ':root{--mbu-bg:var(--background, #fff);--mbu-bg-raised:#faf9fe;--mbu-bg-raised:color-mix(in srgb, var(--mbu-bg) 96%, var(--mbu-accent));--mbu-bg-sunken:#f4f2f9;--mbu-bg-sunken:color-mix(in srgb, var(--mbu-bg) 94%, var(--mbu-text));--mbu-bg-hover:#f3eefe;--mbu-bg-hover:color-mix(in srgb, var(--mbu-bg) 91%, var(--mbu-accent));--mbu-text:var(--text, #222);--mbu-text-dim:#555;--mbu-text-dim:color-mix(in srgb, var(--mbu-text) 78%, var(--mbu-bg));--mbu-text-weak:#999;--mbu-text-weak:color-mix(in srgb, var(--mbu-text) 52%, var(--mbu-bg));--mbu-text-on-accent:#fff;--mbu-border:var(--border, #cfc6e6);--mbu-border-soft:#e2dcef;--mbu-border-strong:#9a8ccb;--mbu-border-strong:color-mix(in srgb, var(--mbu-border) 70%, var(--mbu-text));--mbu-divider:#eee;--mbu-divider:color-mix(in srgb, var(--mbu-bg) 92%, var(--mbu-text));--mbu-accent:#5f3ec0;--mbu-accent-hover:#4e329f;--mbu-accent-deep:#3b2c70;--mbu-accent-soft:#ece4ff;--mbu-accent-soft:color-mix(in srgb, var(--mbu-bg) 86%, var(--mbu-accent));--mbu-accent-fg:#fff;--mbu-accent-text:#5f3ec0;--mbu-accent-deep-text:#3b2c70;--mbu-ok:#1f9d6b;--mbu-ok:color-mix(in srgb, #1f9d6b 78%, var(--mbu-text));--mbu-ok-bg:#eef7f1;--mbu-ok-bg:color-mix(in srgb, var(--mbu-bg) 88%, var(--mbu-ok));--mbu-ok-border:#9bd3b6;--mbu-warn:#a05a00;--mbu-warn:color-mix(in srgb, #b4791f 78%, var(--mbu-text));--mbu-warn-bg:#fff7e6;--mbu-warn-bg:color-mix(in srgb, var(--mbu-bg) 88%, var(--mbu-warn));--mbu-warn-border:#f0c877;--mbu-error:#c0392b;--mbu-error:color-mix(in srgb, #d0473a 78%, var(--mbu-text));--mbu-error-bg:#fdecec;--mbu-error-bg:color-mix(in srgb, var(--mbu-bg) 90%, var(--mbu-error));--mbu-error-border:#e2a1a1;--mbu-info:#2f7fbf;--mbu-info:color-mix(in srgb, #3f8fd0 78%, var(--mbu-text));--mbu-info-bg:#eef4fb;--mbu-info-bg:color-mix(in srgb, var(--mbu-bg) 90%, var(--mbu-info));--mbu-info-border:#a9c8e6;--mbu-font:-apple-system,Segoe UI,Roboto,Arial,sans-serif;--mbu-font-mono:ui-monospace,SFMono-Regular,Consolas,Menlo,monospace;--mbu-fs:14px;--mbu-fs-sm:12px;--mbu-fs-xs:11px;--mbu-radius:6px;--mbu-radius-lg:10px;--mbu-shadow:0 1px 5px rgba(60,40,110,.07);--mbu-shadow-lg:0 8px 30px rgba(40,20,80,.3);--mbu-z-panel:30;--mbu-z-pop:99998;--mbu-z-modal:2147483000;--mbu-z-modal-panel:2147483001}:root[data-mbu-theme="dark"]{--mbu-bg:#1e1b24;--mbu-text:#e9e5f2;--mbu-border:#3b3548;--mbu-accent-text:#b9a7f0;--mbu-accent-deep-text:#a493e0}:root[data-mbu-theme="dark"][data-mbu-seed="theme"]{--mbu-bg:var(--background, #1e1b24);--mbu-text:var(--text, #e9e5f2);--mbu-border:var(--border, #3b3548)}';
    const MBU_UI_CSS = '.mbu-help{font-size:12px;color:var(--mbu-accent-text);text-decoration:none;border:1px solid var(--mbu-border);border-radius:var(--mbu-radius);padding:1px 8px;white-space:nowrap;line-height:1.6;background:none}.mbu-help:hover{background:var(--mbu-bg-hover);border-color:var(--mbu-accent);text-decoration:none}h4>.mbu-help,.mbu-cfg-h>.mbu-help{margin-left:8px;flex:0 0 auto;font-weight:normal}#mbu-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:var(--mbu-z-pop);background:var(--mbu-accent-deep);color:var(--mbu-text-on-accent);padding:10px 16px;border-radius:9px;font:13px/1.35 var(--mbu-font);box-shadow:var(--mbu-shadow-lg);opacity:0;transition:opacity .2s;pointer-events:none;max-width:80vw;text-align:center;white-space:pre-wrap}#mbu-toast.mbu-toast-on{opacity:1}#mbu-toast.mbu-toast-act{pointer-events:auto}#mbu-toast .mbu-toast-btn{margin-left:10px;padding:2px 9px;border:1px solid currentColor;border-radius:5px;background:transparent;color:inherit;font:inherit;cursor:pointer}#mbu-toast .mbu-toast-btn:hover{background:rgba(255,255,255,.18)}#mbu-toast.mbu-toast-ok{background:var(--mbu-ok)}#mbu-toast.mbu-toast-warn{background:var(--mbu-warn)}#mbu-toast.mbu-toast-error{background:var(--mbu-error)}.mbu-cfg-h{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding:0 0 9px;border-bottom:1px solid var(--mbu-border-soft);font:600 15px/1.3 var(--mbu-font);color:var(--mbu-text)}.mbu-cfg-ic{flex:0 0 auto;display:inline-flex;align-items:center;width:22px;height:22px}.mbu-cfg-ic img,.mbu-cfg-ic svg{width:22px;height:22px;object-fit:contain;display:block}.mbu-cfg-name{flex:0 0 auto;font-weight:700;color:var(--mbu-accent-text)}.mbu-cfg-ver{flex:0 0 auto;font:400 11px var(--mbu-font);color:var(--mbu-text-weak);white-space:nowrap}.mbu-cfg-sp{flex:1 1 auto;min-width:8px}.mbu-cfg-log{flex:0 0 auto;font:400 12px var(--mbu-font);color:var(--mbu-accent-text);cursor:pointer;background:none;border:1px solid transparent;border-radius:var(--mbu-radius);padding:1px 8px;line-height:1.6}.mbu-cfg-log:hover{background:var(--mbu-bg-hover);border-color:var(--mbu-border)}#mbu-logpop{position:fixed;top:74px;left:50%;transform:translateX(-50%);z-index:var(--mbu-z-modal);display:flex;flex-direction:column;width:min(720px,94vw);max-height:72vh;background:var(--mbu-bg);border:1px solid var(--mbu-border);border-radius:11px;box-shadow:var(--mbu-shadow-lg);font:13px var(--mbu-font);color:var(--mbu-text);overflow:hidden}.mbu-logpop-h{display:flex;align-items:center;gap:8px;padding:10px 13px;border-bottom:1px solid var(--mbu-border-soft);color:var(--mbu-accent-text);cursor:move;user-select:none}.mbu-logpop-sp{margin-left:auto}.mbu-logpop-clear,.mbu-logpop-copy,.mbu-logpop-x,.mbu-logpop-min{font-size:12px;color:var(--mbu-accent-text);background:var(--mbu-bg-hover);border:1px solid var(--mbu-border);border-radius:5px;padding:2px 9px;cursor:pointer;font-family:inherit}.mbu-logpop-clear:hover,.mbu-logpop-copy:hover,.mbu-logpop-x:hover,.mbu-logpop-min:hover{background:var(--mbu-accent-soft)}#mbu-logpop.min .mbu-log-list,#mbu-logpop.min .mbu-logpop-clear,#mbu-logpop.min .mbu-logpop-copy,#mbu-logpop.min .mbu-logpop-x{display:none}#mbu-logpop.min{max-height:none;width:auto}#mbu-logpop.min .mbu-logpop-sp{display:none}.mbu-log-badge{color:var(--mbu-border-strong);font-size:11px}.mbu-log-list{flex:1 1 auto;overflow:auto;overscroll-behavior:contain;padding:9px 13px;display:flex;flex-direction:column;gap:3px}.mbu-log-li{display:flex;gap:9px;white-space:pre-wrap;word-break:break-word}.mbu-log-t{color:var(--mbu-text-weak);flex:0 0 auto;font-variant-numeric:tabular-nums}.mbu-log-m{flex:1 1 auto;color:var(--mbu-text-dim)}#mbu-logpop .mbu-log-m a{color:var(--mbu-accent-text)}.mbu-log-ok .mbu-log-m{color:var(--mbu-ok)}.mbu-log-warn .mbu-log-m{color:var(--mbu-warn)}.mbu-log-error .mbu-log-m{color:var(--mbu-error)}.mbu-log-debug{opacity:.85}.mbu-log-debug .mbu-log-m{color:var(--mbu-text-weak)}.mbu-log-empty{color:var(--mbu-text-weak)}.mbu-ov{position:fixed;inset:0;z-index:var(--mbu-z-modal);background:rgba(15,12,28,.45);display:flex;align-items:center;justify-content:center;padding:24px}.mbu-ov-panel{background:var(--mbu-bg);color:var(--mbu-text);border-radius:var(--mbu-radius-lg);box-shadow:var(--mbu-shadow-lg);max-width:94vw;max-height:88vh;display:flex;flex-direction:column;overflow:hidden}.mbu-ov-h{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--mbu-border-soft);font-weight:700}.mbu-ov-h .mbu-ov-title{flex:1 1 auto;min-width:0}.mbu-ov-x{flex:0 0 auto;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;font-size:15px;line-height:1;cursor:pointer;color:var(--mbu-text-dim);background:none;border:none;border-radius:var(--mbu-radius)}.mbu-ov-x:hover{background:var(--mbu-bg-hover);color:var(--mbu-text)}.mbu-ov-body{flex:1 1 auto;overflow:auto;padding:14px 16px}:where(.mbu-ov,.mbu-ui,#mbu-logpop,.discogs-bar,.discogs-review-panel-li,#as-root,#as-setup,.as-pop,#as-switch-wrap,#ii-btn,.fs-launch,#tc-bar,#tc-nav-bar,#tc-settings,#tc-anno-wrap,.tc-panel,.tc-toolcfg,.tc-acpop,.tc-recpop,.tc-lppop,.tc-tpppop,.tc-tpp-mpop,.tc-anno-help-pop,.tc-mirror,.tc-addrow,.tc-medopts,.tc-tools,#tc-recwrap,#tc-ri-toolbar,.tc-fmt-flat,.gt-toolbar,.gt-cons,.gt-menu,.gt-pop,.gt-cfg-pop,.gt-wm-pop,#ii-modal,#ii-sxpanel,#mb-pc-panel,#mb-provider-modal-card,.fs-cons,#fs-settings,.fs-overlay,.mmth-pop,.mmth-cfg,.mmth-side,.mmth-pinbar,.mmthf-pop,.mmthf-bar,#falcon-panel,#falcon-launcher,#falcon-item-popup,#falcon-add-page,.falcon-bar,.falcon-addmenu) ::placeholder{color:var(--mbu-text-weak);opacity:1;font-style:italic}:where(.mbu-ov,.mbu-ui,#mbu-logpop,.discogs-bar,.discogs-review-panel-li,#as-root,#as-setup,.as-pop,#as-switch-wrap,#ii-btn,.fs-launch,#tc-bar,#tc-nav-bar,#tc-settings,#tc-anno-wrap,.tc-panel,.tc-toolcfg,.tc-acpop,.tc-recpop,.tc-lppop,.tc-tpppop,.tc-tpp-mpop,.tc-anno-help-pop,.tc-mirror,.tc-addrow,.tc-medopts,.tc-tools,#tc-recwrap,#tc-ri-toolbar,.tc-fmt-flat,.gt-toolbar,.gt-cons,.gt-menu,.gt-pop,.gt-cfg-pop,.gt-wm-pop,#ii-modal,#ii-sxpanel,#mb-pc-panel,#mb-provider-modal-card,.fs-cons,#fs-settings,.fs-overlay,.mmth-pop,.mmth-cfg,.mmth-side,.mmth-pinbar,.mmthf-pop,.mmthf-bar,#falcon-panel,#falcon-launcher,#falcon-item-popup,#falcon-add-page,.falcon-bar,.falcon-addmenu){color:var(--mbu-text)}:where(.mbu-ov,.mbu-ui,#mbu-logpop,.discogs-bar,.discogs-review-panel-li,#as-root,#as-setup,.as-pop,#as-switch-wrap,#ii-btn,.fs-launch,#tc-bar,#tc-nav-bar,#tc-settings,#tc-anno-wrap,.tc-panel,.tc-toolcfg,.tc-acpop,.tc-recpop,.tc-lppop,.tc-tpppop,.tc-tpp-mpop,.tc-anno-help-pop,.tc-mirror,.tc-addrow,.tc-medopts,.tc-tools,#tc-recwrap,#tc-ri-toolbar,.tc-fmt-flat,.gt-toolbar,.gt-cons,.gt-menu,.gt-pop,.gt-cfg-pop,.gt-wm-pop,#ii-modal,#ii-sxpanel,#mb-pc-panel,#mb-provider-modal-card,.fs-cons,#fs-settings,.fs-overlay,.mmth-pop,.mmth-cfg,.mmth-side,.mmth-pinbar,.mmthf-pop,.mmthf-bar,#falcon-panel,#falcon-launcher,#falcon-item-popup,#falcon-add-page,.falcon-bar,.falcon-addmenu) :is(table,td,th,div,span,label)[style*=background]{color:var(--mbu-text)}:where(.mbu-ov,.mbu-ui,#mbu-logpop,.discogs-bar,.discogs-review-panel-li,#as-root,#as-setup,.as-pop,#as-switch-wrap,#ii-btn,.fs-launch,#tc-bar,#tc-nav-bar,#tc-settings,#tc-anno-wrap,.tc-panel,.tc-toolcfg,.tc-acpop,.tc-recpop,.tc-lppop,.tc-tpppop,.tc-tpp-mpop,.tc-anno-help-pop,.tc-mirror,.tc-addrow,.tc-medopts,.tc-tools,#tc-recwrap,#tc-ri-toolbar,.tc-fmt-flat,.gt-toolbar,.gt-cons,.gt-menu,.gt-pop,.gt-cfg-pop,.gt-wm-pop,#ii-modal,#ii-sxpanel,#mb-pc-panel,#mb-provider-modal-card,.fs-cons,#fs-settings,.fs-overlay,.mmth-pop,.mmth-cfg,.mmth-side,.mmth-pinbar,.mmthf-pop,.mmthf-bar,#falcon-panel,#falcon-launcher,#falcon-item-popup,#falcon-add-page,.falcon-bar,.falcon-addmenu) input:not(:where([type=checkbox],[type=radio],[type=range],[type=color],[type=file])),:where(.mbu-ov,.mbu-ui,#mbu-logpop,.discogs-bar,.discogs-review-panel-li,#as-root,#as-setup,.as-pop,#as-switch-wrap,#ii-btn,.fs-launch,#tc-bar,#tc-nav-bar,#tc-settings,#tc-anno-wrap,.tc-panel,.tc-toolcfg,.tc-acpop,.tc-recpop,.tc-lppop,.tc-tpppop,.tc-tpp-mpop,.tc-anno-help-pop,.tc-mirror,.tc-addrow,.tc-medopts,.tc-tools,#tc-recwrap,#tc-ri-toolbar,.tc-fmt-flat,.gt-toolbar,.gt-cons,.gt-menu,.gt-pop,.gt-cfg-pop,.gt-wm-pop,#ii-modal,#ii-sxpanel,#mb-pc-panel,#mb-provider-modal-card,.fs-cons,#fs-settings,.fs-overlay,.mmth-pop,.mmth-cfg,.mmth-side,.mmth-pinbar,.mmthf-pop,.mmthf-bar,#falcon-panel,#falcon-launcher,#falcon-item-popup,#falcon-add-page,.falcon-bar,.falcon-addmenu) textarea,:where(.mbu-ov,.mbu-ui,#mbu-logpop,.discogs-bar,.discogs-review-panel-li,#as-root,#as-setup,.as-pop,#as-switch-wrap,#ii-btn,.fs-launch,#tc-bar,#tc-nav-bar,#tc-settings,#tc-anno-wrap,.tc-panel,.tc-toolcfg,.tc-acpop,.tc-recpop,.tc-lppop,.tc-tpppop,.tc-tpp-mpop,.tc-anno-help-pop,.tc-mirror,.tc-addrow,.tc-medopts,.tc-tools,#tc-recwrap,#tc-ri-toolbar,.tc-fmt-flat,.gt-toolbar,.gt-cons,.gt-menu,.gt-pop,.gt-cfg-pop,.gt-wm-pop,#ii-modal,#ii-sxpanel,#mb-pc-panel,#mb-provider-modal-card,.fs-cons,#fs-settings,.fs-overlay,.mmth-pop,.mmth-cfg,.mmth-side,.mmth-pinbar,.mmthf-pop,.mmthf-bar,#falcon-panel,#falcon-launcher,#falcon-item-popup,#falcon-add-page,.falcon-bar,.falcon-addmenu) select{background:var(--mbu-bg-sunken);color:var(--mbu-text);border-color:var(--mbu-border)}:where(.mbu-ov,.mbu-ui,#mbu-logpop,.discogs-bar,.discogs-review-panel-li,#as-root,#as-setup,.as-pop,#as-switch-wrap,#ii-btn,.fs-launch,#tc-bar,#tc-nav-bar,#tc-settings,#tc-anno-wrap,.tc-panel,.tc-toolcfg,.tc-acpop,.tc-recpop,.tc-lppop,.tc-tpppop,.tc-tpp-mpop,.tc-anno-help-pop,.tc-mirror,.tc-addrow,.tc-medopts,.tc-tools,#tc-recwrap,#tc-ri-toolbar,.tc-fmt-flat,.gt-toolbar,.gt-cons,.gt-menu,.gt-pop,.gt-cfg-pop,.gt-wm-pop,#ii-modal,#ii-sxpanel,#mb-pc-panel,#mb-provider-modal-card,.fs-cons,#fs-settings,.fs-overlay,.mmth-pop,.mmth-cfg,.mmth-side,.mmth-pinbar,.mmthf-pop,.mmthf-bar,#falcon-panel,#falcon-launcher,#falcon-item-popup,#falcon-add-page,.falcon-bar,.falcon-addmenu) input:focus-visible,:where(.mbu-ov,.mbu-ui,#mbu-logpop,.discogs-bar,.discogs-review-panel-li,#as-root,#as-setup,.as-pop,#as-switch-wrap,#ii-btn,.fs-launch,#tc-bar,#tc-nav-bar,#tc-settings,#tc-anno-wrap,.tc-panel,.tc-toolcfg,.tc-acpop,.tc-recpop,.tc-lppop,.tc-tpppop,.tc-tpp-mpop,.tc-anno-help-pop,.tc-mirror,.tc-addrow,.tc-medopts,.tc-tools,#tc-recwrap,#tc-ri-toolbar,.tc-fmt-flat,.gt-toolbar,.gt-cons,.gt-menu,.gt-pop,.gt-cfg-pop,.gt-wm-pop,#ii-modal,#ii-sxpanel,#mb-pc-panel,#mb-provider-modal-card,.fs-cons,#fs-settings,.fs-overlay,.mmth-pop,.mmth-cfg,.mmth-side,.mmth-pinbar,.mmthf-pop,.mmthf-bar,#falcon-panel,#falcon-launcher,#falcon-item-popup,#falcon-add-page,.falcon-bar,.falcon-addmenu) textarea:focus-visible,:where(.mbu-ov,.mbu-ui,#mbu-logpop,.discogs-bar,.discogs-review-panel-li,#as-root,#as-setup,.as-pop,#as-switch-wrap,#ii-btn,.fs-launch,#tc-bar,#tc-nav-bar,#tc-settings,#tc-anno-wrap,.tc-panel,.tc-toolcfg,.tc-acpop,.tc-recpop,.tc-lppop,.tc-tpppop,.tc-tpp-mpop,.tc-anno-help-pop,.tc-mirror,.tc-addrow,.tc-medopts,.tc-tools,#tc-recwrap,#tc-ri-toolbar,.tc-fmt-flat,.gt-toolbar,.gt-cons,.gt-menu,.gt-pop,.gt-cfg-pop,.gt-wm-pop,#ii-modal,#ii-sxpanel,#mb-pc-panel,#mb-provider-modal-card,.fs-cons,#fs-settings,.fs-overlay,.mmth-pop,.mmth-cfg,.mmth-side,.mmth-pinbar,.mmthf-pop,.mmthf-bar,#falcon-panel,#falcon-launcher,#falcon-item-popup,#falcon-add-page,.falcon-bar,.falcon-addmenu) select:focus-visible{outline:2px solid var(--mbu-accent);outline-offset:1px}:where(.mbu-ov,.mbu-ui,#mbu-logpop,.discogs-bar,.discogs-review-panel-li,#as-root,#as-setup,.as-pop,#as-switch-wrap,#ii-btn,.fs-launch,#tc-bar,#tc-nav-bar,#tc-settings,#tc-anno-wrap,.tc-panel,.tc-toolcfg,.tc-acpop,.tc-recpop,.tc-lppop,.tc-tpppop,.tc-tpp-mpop,.tc-anno-help-pop,.tc-mirror,.tc-addrow,.tc-medopts,.tc-tools,#tc-recwrap,#tc-ri-toolbar,.tc-fmt-flat,.gt-toolbar,.gt-cons,.gt-menu,.gt-pop,.gt-cfg-pop,.gt-wm-pop,#ii-modal,#ii-sxpanel,#mb-pc-panel,#mb-provider-modal-card,.fs-cons,#fs-settings,.fs-overlay,.mmth-pop,.mmth-cfg,.mmth-side,.mmth-pinbar,.mmthf-pop,.mmthf-bar,#falcon-panel,#falcon-launcher,#falcon-item-popup,#falcon-add-page,.falcon-bar,.falcon-addmenu) :where(input[type=checkbox],input[type=radio],input[type=range]){accent-color:var(--mbu-accent)}:root[data-mbu-theme=dark] :where(.mbu-ov,.mbu-ui,#mbu-logpop,.discogs-bar,.discogs-review-panel-li,#as-root,#as-setup,.as-pop,#as-switch-wrap,#ii-btn,.fs-launch,#tc-bar,#tc-nav-bar,#tc-settings,#tc-anno-wrap,.tc-panel,.tc-toolcfg,.tc-acpop,.tc-recpop,.tc-lppop,.tc-tpppop,.tc-tpp-mpop,.tc-anno-help-pop,.tc-mirror,.tc-addrow,.tc-medopts,.tc-tools,#tc-recwrap,#tc-ri-toolbar,.tc-fmt-flat,.gt-toolbar,.gt-cons,.gt-menu,.gt-pop,.gt-cfg-pop,.gt-wm-pop,#ii-modal,#ii-sxpanel,#mb-pc-panel,#mb-provider-modal-card,.fs-cons,#fs-settings,.fs-overlay,.mmth-pop,.mmth-cfg,.mmth-side,.mmth-pinbar,.mmthf-pop,.mmthf-bar,#falcon-panel,#falcon-launcher,#falcon-item-popup,#falcon-add-page,.falcon-bar,.falcon-addmenu){color-scheme:dark;--invert-value:none;--invert:none}:where(.mbu-ov,.mbu-ui,#mbu-logpop,.discogs-bar,.discogs-review-panel-li,#as-root,#as-setup,.as-pop,#as-switch-wrap,#ii-btn,.fs-launch,#tc-bar,#tc-nav-bar,#tc-settings,#tc-anno-wrap,.tc-panel,.tc-toolcfg,.tc-acpop,.tc-recpop,.tc-lppop,.tc-tpppop,.tc-tpp-mpop,.tc-anno-help-pop,.tc-mirror,.tc-addrow,.tc-medopts,.tc-tools,#tc-recwrap,#tc-ri-toolbar,.tc-fmt-flat,.gt-toolbar,.gt-cons,.gt-menu,.gt-pop,.gt-cfg-pop,.gt-wm-pop,#ii-modal,#ii-sxpanel,#mb-pc-panel,#mb-provider-modal-card,.fs-cons,#fs-settings,.fs-overlay,.mmth-pop,.mmth-cfg,.mmth-side,.mmth-pinbar,.mmthf-pop,.mmthf-bar,#falcon-panel,#falcon-launcher,#falcon-item-popup,#falcon-add-page,.falcon-bar,.falcon-addmenu) button{background-color:var(--mbu-bg-raised);color:var(--mbu-text);border-color:var(--mbu-border)}.mbu-compact .mbu-bt{display:none}:is(.mbu-video,body.tc-ri-on #external-links-editor tr.relationship-item .attribute-container input){-webkit-appearance:none;-moz-appearance:none;appearance:none;width:18px;height:18px;margin:0;border:none;border-radius:3px;cursor:pointer;background:transparent url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2016%2016%27%20fill=%27%23888%27%3E%3Crect%20x=%271%27%20y=%273.5%27%20width=%2710%27%20height=%279%27%20rx=%271.5%27/%3E%3Cpath%20d=%27M11.5%207L15%204.8v6.4L11.5%209z%27/%3E%3C/svg%3E") center/13px no-repeat;opacity:.45;box-shadow:none;flex:0 0 auto;vertical-align:middle}:is(.mbu-video,body.tc-ri-on #external-links-editor tr.relationship-item .attribute-container input):hover{opacity:1}:is(.mbu-video,body.tc-ri-on #external-links-editor tr.relationship-item .attribute-container input):checked{opacity:1;background-color:var(--mbu-accent);background-image:url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2016%2016%27%20fill=%27%23fff%27%3E%3Crect%20x=%271%27%20y=%273.5%27%20width=%2710%27%20height=%279%27%20rx=%271.5%27/%3E%3Cpath%20d=%27M11.5%207L15%204.8v6.4L11.5%209z%27/%3E%3C/svg%3E")}:is(.mbu-video,body.tc-ri-on #external-links-editor tr.relationship-item .attribute-container input):focus-visible{outline:1px solid var(--mbu-accent);outline-offset:1px}:is(.mbu-video,body.tc-ri-on #external-links-editor tr.relationship-item .attribute-container input):disabled{cursor:default;opacity:.3}';
    function mbuHelpHref(name) {
      return "https://github.com/majkinetor/musicbrainz-userscripts/blob/main/userscripts/" + name + "/README.md";
    }
    function mbuHelpHtml(name, label) {
      return '<a class="mbu-help" href="' + mbuHelpHref(name) + '" target="_blank" rel="noopener" title="open the README in a new tab">' + (label || "? Help") + "</a>";
    }
    function mbuHelpEl(name, label) {
      var a = document.createElement("a");
      a.className = "mbu-help";
      a.href = mbuHelpHref(name);
      a.target = "_blank";
      a.rel = "noopener";
      a.title = "open the README in a new tab";
      a.textContent = label || "? Help";
      return a;
    }
    var MBU_CFG_ICON = "\u2699\uFE0E";
    var _mbuTT;
    function mbuHtml(s) {
      if (_mbuTT === void 0) {
        _mbuTT = null;
        try {
          var tt = typeof window !== "undefined" && window.trustedTypes || null;
          if (tt && tt.createPolicy) _mbuTT = tt.createPolicy("mbu-" + Math.random().toString(36).slice(2, 8), { createHTML: function(x) {
            return x;
          } });
        } catch (e) {
        }
      }
      return _mbuTT ? _mbuTT.createHTML(String(s)) : String(s);
    }
    function mbuStartupInfo(name) {
      var g = null;
      try {
        g = typeof GM_info !== "undefined" && GM_info || null;
      } catch (e) {
      }
      var s = g && g.script || {}, p = g && g.platform || {};
      var host = String(s.name || "").replace(/\*$/, ""), ver = s.version || "?";
      var line = !name ? (host || "Script") + " v" + ver : host && host !== name ? name + " (" + host + " v" + ver + ")" : name + " v" + ver;
      if (g) line += " \xB7 " + (g.scriptHandler || "unknown manager") + (g.version ? " " + g.version : "");
      if (p.browserName) line += " \xB7 " + p.browserName + (p.browserVersion ? " " + p.browserVersion : "") + (p.os ? " (" + p.os + ")" : "");
      else {
        try {
          line += " \xB7 " + navigator.userAgent;
        } catch (e) {
        }
      }
      return line;
    }
    function mbuClaimVer(v) {
      return String(v || "").split(".").map(function(n) {
        return parseInt(n, 10) || 0;
      });
    }
    function mbuClaimCmp(a, b) {
      var x = mbuClaimVer(a), y = mbuClaimVer(b);
      for (var i = 0; i < Math.max(x.length, y.length); i++) {
        var d = (x[i] || 0) - (y[i] || 0);
        if (d) return d < 0 ? -1 : 1;
      }
      return 0;
    }
    function mbuClaim(key, label) {
      var info = typeof GM_info !== "undefined" && GM_info && GM_info.script || {};
      var name = String(info.name || label || key), ver = String(info.version || "0");
      var mine = (name.slice(-1) === "*" ? "String Theory" : "standalone") + " v" + ver;
      var root = document.documentElement, attr = "data-mbu-run-" + key, ev = "mbu-claim-" + key, noteKey = "mbu-newer-" + key;
      var log2 = function(msg) {
        try {
          if (typeof mbuLog !== "undefined" && mbuLog.active) mbuLog.active.info(msg);
          else if (typeof mbuToast !== "undefined" && typeof mbuToast.log === "function") mbuToast.log("info", msg);
          else console.info("[" + (label || key) + "] " + msg);
        } catch (e) {
        }
      };
      var note = null;
      try {
        note = JSON.parse(localStorage.getItem(noteKey) || "null");
      } catch (e) {
      }
      var noteCmp = note ? mbuClaimCmp(note.ver, ver) : 1;
      if (noteCmp < 0) {
        try {
          localStorage.removeItem(noteKey);
        } catch (e) {
        }
      }
      if (noteCmp <= 0) note = null;
      var held = root && root.getAttribute(attr);
      var off = function(why) {
        try {
          if (root) root.setAttribute(attr + "-off", JSON.stringify({ mine, why }));
        } catch (e) {
        }
        try {
          document.dispatchEvent(new CustomEvent(ev, { detail: JSON.stringify({ mine, ver, why }) }));
        } catch (e) {
        }
        return false;
      };
      if (held) {
        var heldVer = root.getAttribute(attr + "-ver") || "0";
        if (mbuClaimCmp(ver, heldVer) > 0) {
          try {
            localStorage.setItem(noteKey, JSON.stringify({ ver, mine, at: Date.now() }));
          } catch (e) {
          }
          return off("newer, from the next page load");
        }
        return off("older or the same");
      }
      if (note) {
        var watch = function() {
          setTimeout(function() {
            if (root.getAttribute(attr)) return;
            try {
              localStorage.removeItem(noteKey);
            } catch (e) {
            }
            try {
              console.info("[" + (label || key) + "] the newer copy (" + note.mine + ") did not start: this copy runs again from the next page load");
            } catch (e) {
            }
          }, 3e3);
        };
        if (document.readyState === "complete") watch();
        else window.addEventListener("load", watch, { once: true });
        return off("older: a newer copy runs");
      }
      if (root) {
        root.setAttribute(attr, mine);
        root.setAttribute(attr + "-ver", ver);
      }
      var told = function(o) {
        log2((label || key) + " is installed twice: " + mine + " runs, " + (o.mine || "another copy") + " is switched off" + (o.why === "newer, from the next page load" ? " for this page (it is newer and runs from the next page load)" : "") + ".");
      };
      document.addEventListener(ev, function(e) {
        var o = {};
        try {
          o = JSON.parse(e.detail);
        } catch (x) {
        }
        told(o);
      });
      var before = root && root.getAttribute(attr + "-off");
      if (before) setTimeout(function() {
        var o = {};
        try {
          o = JSON.parse(before);
        } catch (x) {
        }
        told(o);
      }, 0);
      return true;
    }
    var _mbuToastT = null;
    function mbuToast(msg, opts) {
      opts = opts || {};
      var s = String(msg);
      var kind = opts.kind || (/^\s*[⚠✗×]/.test(s) ? "warn" : /[✓✅]/.test(s) ? "ok" : "info");
      try {
        if (typeof mbuToast.log === "function") mbuToast.log(kind, s.replace(/^\s*[⚠✗×✓✅]\s*/, ""));
      } catch (e) {
      }
      var el = document.getElementById("mbu-toast");
      if (!el) {
        el = document.createElement("div");
        el.id = "mbu-toast";
        (document.body || document.documentElement).appendChild(el);
      }
      el.className = "mbu-toast-on" + (kind !== "info" ? " mbu-toast-" + kind : "") + (opts.action ? " mbu-toast-act" : "");
      el.textContent = s;
      if (opts.action) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "mbu-toast-btn";
        b.textContent = opts.action.label || "OK";
        b.onclick = function() {
          try {
            if (opts.action.onClick) opts.action.onClick(b);
          } catch (e) {
          }
          clearTimeout(_mbuToastT);
          _mbuToastT = setTimeout(function() {
            el.className = "";
          }, 900);
        };
        el.appendChild(b);
      }
      if (opts.at) {
        var w = el.offsetWidth, h = el.offsetHeight;
        el.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, opts.at.x - w / 2)) + "px";
        el.style.top = Math.max(6, Math.min(window.innerHeight - h - 6, opts.at.y - h - 10)) + "px";
        el.style.bottom = "auto";
        el.style.transform = "none";
      } else {
        el.style.left = "";
        el.style.top = "";
        el.style.bottom = "";
        el.style.transform = "";
      }
      clearTimeout(_mbuToastT);
      _mbuToastT = setTimeout(function() {
        el.className = "";
      }, opts.ms || (opts.action ? 12e3 : 2600));
      return el;
    }
    function mbuCfgHeader(o) {
      o = o || {};
      var esc = function(s) {
        return String(s == null ? "" : s).replace(/[&<>"]/g, function(c) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
      };
      var html = '<div class="mbu-cfg-h">';
      if (o.icon) html += '<span class="mbu-cfg-ic">' + o.icon + "</span>";
      html += '<span class="mbu-cfg-name">' + esc(o.name) + "</span>";
      if (o.version) html += '<span class="mbu-cfg-ver" title="installed script version">v' + esc(o.version) + "</span>";
      html += '<span class="mbu-cfg-sp"></span>';
      if (o.log) {
        html += '<button type="button" class="mbu-cfg-log' + (o.logClass ? " " + esc(o.logClass) : "") + '"' + (o.logId ? ' id="' + esc(o.logId) + '"' : "") + ' title="Open the activity log">Log</button>';
      }
      html += mbuHelpHtml(o.script);
      return html + "</div>";
    }
    function mbuTestHooks() {
      try {
        return typeof window !== "undefined" && window.__mbuTest === true;
      } catch (e) {
        return false;
      }
    }
    function mbRestackCorner(corner) {
      var bottom = corner[0] === "b", right = corner[1] === "r";
      var els = Array.prototype.slice.call(document.querySelectorAll('[data-mb-corner="' + corner + '"]')).filter(function(el) {
        return getComputedStyle(el).display !== "none";
      }).sort(function(a, b) {
        return (Number(a.dataset.mbCornerOrder) || 0) - (Number(b.dataset.mbCornerOrder) || 0);
      });
      var pos = 14;
      els.forEach(function(el) {
        el.style[bottom ? "bottom" : "top"] = pos + "px";
        el.style[right ? "right" : "left"] = "14px";
        pos += el.getBoundingClientRect().height + 8;
      });
    }
    function mbuLog(o) {
      o = o || {};
      var max = o.max || 2e4, buf = [], dropped = 0, warn = 0, error = 0, win = null;
      var pad = function(n, w) {
        return String(n).padStart(w || 2, "0");
      };
      var ts = function(d) {
        return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + "." + pad(d.getMilliseconds(), 3);
      };
      var str = function(v) {
        if (typeof v === "string") return v;
        if (v instanceof Error) return v.message || String(v);
        if (v && v.nodeType) return "<" + (v.tagName || "node").toLowerCase() + ">";
        try {
          return typeof v === "object" ? JSON.stringify(v) : String(v);
        } catch (e) {
          return String(v);
        }
      };
      var esc = function(s) {
        return String(s).replace(/[&<>"]/g, function(c) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
        });
      };
      var linkify = function(s) {
        return esc(s).replace(/(https?:\/\/[^\s<]+)/g, function(m) {
          var t = (m.match(/[.,;:!?)\]]+$/) || [""])[0];
          var url = m.slice(0, m.length - t.length);
          return '<a href="' + url + '" target="_blank" rel="noopener">' + url + "</a>" + t;
        });
      };
      var load = o.load || function(k) {
        try {
          return GM_getValue(k, void 0);
        } catch (e) {
          return void 0;
        }
      };
      var save = o.save || function(k, v) {
        try {
          GM_setValue(k, v);
        } catch (e) {
        }
      };
      var state = function() {
        try {
          return JSON.parse(load(o.key) || "{}") || {};
        } catch (e) {
          return {};
        }
      };
      var remember = function(patch) {
        try {
          save(o.key, JSON.stringify(Object.assign(state(), patch)));
        } catch (e) {
        }
      };
      var tally = function(e, d) {
        if (e.sev === "warn") warn += d;
        else if (e.sev === "error") error += d;
      };
      var PRE = { info: "", ok: "OK   ", warn: "WARN ", error: "ERR  ", debug: "DBG  " };
      var line = function(e) {
        return ts(e.t) + "  " + (PRE[e.sev] || "") + e.msg;
      };
      function add(sev, args) {
        var msg = Array.prototype.map.call(args, str).join(" ").replace(/\s+/g, " ").trim();
        if (!msg) return;
        var e = { t: /* @__PURE__ */ new Date(), sev: sev === "err" ? "error" : sev, msg };
        buf.push(e);
        tally(e, 1);
        if (buf.length > max + Math.ceil(max / 10)) {
          var gone = buf.splice(0, buf.length - max);
          gone.forEach(function(g) {
            tally(g, -1);
          });
          dropped += gone.length;
        }
        if (win) win.append(e);
      }
      function title() {
        var v = typeof o.version === "function" ? (function() {
          try {
            return o.version();
          } catch (e) {
            return "";
          }
        })() : o.version;
        var t = (o.name || "Log") + (v ? " v" + v : "");
        try {
          var s = o.subtitle && o.subtitle();
          if (s) t += " \u2014 " + s;
        } catch (e) {
        }
        return t;
      }
      function markdown() {
        var body = buf.length ? buf.map(line).join("\n") : "(no activity logged)";
        if (dropped) body = "(" + dropped + " earlier line" + (dropped === 1 ? "" : "s") + " not kept)\n" + body;
        var n = warn || error ? " (" + warn + " warning" + (warn === 1 ? "" : "s") + ", " + error + " error" + (error === 1 ? "" : "s") + ")" : "";
        var fence = String.fromCharCode(96, 96, 96);
        return "<details><summary>" + title() + " \u2014 session log" + n + "</summary>\n\n" + fence + "log\n" + body + "\n" + fence + "\n\n</details>";
      }
      function copy(btn) {
        var md = markdown();
        var done = function(ok) {
          if (!btn) return;
          var was = btn.dataset.lbl || btn.textContent;
          btn.dataset.lbl = was;
          btn.textContent = ok ? "Copied \u2713" : "Copy failed";
          setTimeout(function() {
            btn.textContent = was;
          }, 1500);
        };
        var fallback = function() {
          var ok = false;
          try {
            var ta = document.createElement("textarea");
            ta.value = md;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            ok = document.execCommand("copy");
            ta.remove();
          } catch (x) {
          }
          done(ok);
        };
        try {
          navigator.clipboard.writeText(md).then(function() {
            done(true);
          }, fallback);
        } catch (e) {
          fallback();
        }
      }
      function open() {
        close(true);
        if (typeof o.before === "function") {
          try {
            o.before();
          } catch (e) {
          }
        }
        remember({ open: true });
        var st = state();
        var pop = document.createElement("div");
        pop.id = "mbu-logpop";
        pop.className = "mbu-logpop";
        pop.innerHTML = mbuHtml('<div class="mbu-logpop-h"><b>' + esc(o.header || "Activity log") + '</b> <span class="mbu-log-badge"></span><span class="mbu-logpop-sp"></span><button class="mbu-logpop-clear" type="button" title="Clear the log (the lines so far are gone)">Clear</button><button class="mbu-logpop-copy" type="button" title="Copy as Markdown (paste into a GitHub issue)">\u29C9 Copy</button><button class="mbu-logpop-min" type="button" title="Minimize">\u2013</button><button class="mbu-logpop-x" type="button" title="Close">\u2715</button></div><div class="mbu-log-list"></div>');
        document.body.appendChild(pop);
        if (st.left != null) {
          pop.style.left = st.left;
          pop.style.top = st.top;
          pop.style.right = "auto";
          pop.style.transform = "none";
        }
        var restore = { left: pop.style.left, top: pop.style.top, right: pop.style.right, bottom: pop.style.bottom, transform: pop.style.transform };
        var list = pop.querySelector(".mbu-log-list"), badge = pop.querySelector(".mbu-log-badge");
        var row = function(e) {
          var d = document.createElement("div");
          d.className = "mbu-log-li mbu-log-" + e.sev;
          d.innerHTML = mbuHtml('<span class="mbu-log-t">' + ts(e.t) + '</span><span class="mbu-log-m">' + linkify(e.msg) + "</span>");
          return d;
        };
        var showBadge = function() {
          badge.textContent = "(" + buf.length + ")" + (warn || error ? " \xB7 " + warn + "\u26A0 " + error + "\u2716" : "");
        };
        var frag = document.createDocumentFragment();
        buf.forEach(function(e) {
          frag.appendChild(row(e));
        });
        if (buf.length) list.appendChild(frag);
        else list.innerHTML = mbuHtml('<div class="mbu-log-empty">No activity yet.</div>');
        showBadge();
        list.scrollTop = list.scrollHeight;
        var queued = false, follow = true;
        list.addEventListener("scroll", function() {
          follow = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
        });
        var paint = function() {
          queued = false;
          showBadge();
          if (follow) list.scrollTop = list.scrollHeight;
        };
        var onKey = function(e) {
          if (e.key === "Escape") close();
        };
        win = {
          el: pop,
          append: function(e) {
            var empty = list.querySelector(".mbu-log-empty");
            if (empty) empty.remove();
            list.appendChild(row(e));
            while (list.childElementCount > buf.length) list.firstElementChild.remove();
            if (!queued) {
              queued = true;
              requestAnimationFrame(paint);
            }
          },
          off: function() {
            document.removeEventListener("keydown", onKey);
          },
          cleared: function() {
            list.innerHTML = mbuHtml('<div class="mbu-log-empty">No activity yet.</div>');
            showBadge();
          }
        };
        pop.querySelector(".mbu-logpop-clear").onclick = function() {
          clear();
        };
        pop.querySelector(".mbu-logpop-copy").onclick = function() {
          copy(pop.querySelector(".mbu-logpop-copy"));
        };
        var minBtn = pop.querySelector(".mbu-logpop-min");
        var setMin = function(m) {
          minBtn.textContent = m ? "\u25A2" : "\u2013";
          minBtn.title = m ? "Restore" : "Minimize";
          if (m) {
            pop.style.left = "14px";
            pop.style.bottom = "14px";
            pop.style.top = "auto";
            pop.style.right = "auto";
            pop.style.transform = "none";
          } else Object.assign(pop.style, restore);
        };
        minBtn.onclick = function() {
          var m = pop.classList.toggle("min");
          setMin(m);
          remember({ min: m });
        };
        if (st.min) {
          pop.classList.add("min");
          setMin(true);
        }
        pop.querySelector(".mbu-logpop-x").onclick = function() {
          close();
        };
        pop.querySelector(".mbu-logpop-h").addEventListener("mousedown", function(e) {
          if (e.target.closest("button")) return;
          e.preventDefault();
          var r = pop.getBoundingClientRect();
          pop.style.left = r.left + "px";
          pop.style.top = r.top + "px";
          pop.style.right = "auto";
          pop.style.transform = "none";
          var ox = e.clientX - r.left, oy = e.clientY - r.top;
          var mv = function(ev) {
            pop.style.left = Math.max(0, Math.min(window.innerWidth - pop.offsetWidth, ev.clientX - ox)) + "px";
            pop.style.top = Math.max(0, Math.min(window.innerHeight - 36, ev.clientY - oy)) + "px";
          };
          var up = function() {
            document.removeEventListener("mousemove", mv);
            document.removeEventListener("mouseup", up);
            if (!pop.classList.contains("min")) {
              restore = { left: pop.style.left, top: pop.style.top, right: "auto", bottom: "", transform: "none" };
              remember({ left: pop.style.left, top: pop.style.top });
            }
          };
          document.addEventListener("mousemove", mv);
          document.addEventListener("mouseup", up);
        });
        document.addEventListener("keydown", onKey);
        return pop;
      }
      function clear() {
        buf = [];
        dropped = 0;
        warn = 0;
        error = 0;
        if (win) win.cleared();
      }
      function close(quiet) {
        var stray = document.getElementById("mbu-logpop");
        if (win) {
          win.off();
          win.el.remove();
          win = null;
          if (!quiet) remember({ open: false });
        }
        if (stray) stray.remove();
      }
      var api = {
        info: function() {
          add("info", arguments);
        },
        warn: function() {
          add("warn", arguments);
        },
        err: function() {
          add("error", arguments);
        },
        error: function() {
          add("error", arguments);
        },
        ok: function() {
          add("ok", arguments);
        },
        debug: function() {
          add("debug", arguments);
        },
        add: function(sev) {
          add(sev, Array.prototype.slice.call(arguments, 1));
        },
        open,
        close: function() {
          close();
        },
        reopen: function() {
          if (state().open) open();
        },
        isOpen: function() {
          return !!win;
        },
        markdown,
        copy,
        clear,
        lines: function() {
          return buf.map(line);
        },
        messages: function() {
          return buf.map(function(e) {
            return e.msg;
          });
        },
        counts: function() {
          return { warn, error };
        }
      };
      mbuLog.active = api;
      return api;
    }
    function mbuDismissOn(el, close, opts) {
      opts = opts || {};
      var closed = false;
      var onDown = function(e) {
        if (closed || !el || el.contains(e.target)) return;
        if (opts.ignore && e.target.closest && e.target.closest(opts.ignore)) return;
        finish();
        var eat = function(ev) {
          ev.stopPropagation();
          ev.preventDefault();
          document.removeEventListener("click", eat, true);
        };
        document.addEventListener("click", eat, true);
        setTimeout(function() {
          document.removeEventListener("click", eat, true);
        }, 400);
      };
      var onKey = function(e) {
        if (closed || e.key !== "Escape") return;
        e.stopPropagation();
        finish();
      };
      function finish() {
        if (closed) return;
        closed = true;
        document.removeEventListener("mousedown", onDown, true);
        document.removeEventListener("keydown", onKey, true);
        try {
          close();
        } catch (err) {
        }
      }
      document.addEventListener("mousedown", onDown, true);
      document.addEventListener("keydown", onKey, true);
      return finish;
    }
    function mbuFitToolbar(bar2, opts) {
      if (!bar2) return false;
      opts = opts || {};
      var gap = opts.gap == null ? 11 : opts.gap;
      var pad = opts.pad == null ? 24 : opts.pad;
      var spacer = opts.spacer || ".mbu-sp";
      bar2.classList.remove("mbu-compact");
      var kids = [].slice.call(bar2.children);
      var need = gap * Math.max(0, kids.length - 1);
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].matches && kids[i].matches(spacer)) continue;
        need += kids[i].offsetWidth;
      }
      var compact = need > bar2.clientWidth - pad;
      bar2.classList.toggle("mbu-compact", compact);
      return compact;
    }
    function mbuThemeOf(bg) {
      var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(bg || "");
      if (!m) return null;
      if (m[4] !== void 0 && +m[4] < 0.5) return null;
      var f = function(v) {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      var L = 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]);
      return L < 0.35 ? "dark" : "light";
    }
    function mbuCls(el, token, on) {
      if (!el || !el.classList) return;
      if (el.classList.contains(token) !== !!on) el.classList.toggle(token, !!on);
    }
    function mbuAttr(el, name, value) {
      if (!el) return;
      if (value === null || value === void 0 || value === false) {
        if (el.hasAttribute(name)) el.removeAttribute(name);
      } else if (el.getAttribute(name) !== String(value)) {
        el.setAttribute(name, String(value));
      }
    }
    function mbuProp(obj, prop, value) {
      if (!obj) return;
      if (obj[prop] !== value) obj[prop] = value;
    }
    function mbuProbe() {
      var p = document.getElementById("mbu-theme-probe");
      if (p) return p;
      if (!document.body) return null;
      p = document.createElement("span");
      p.id = "mbu-theme-probe";
      p.setAttribute("aria-hidden", "true");
      p.style.cssText = "position:absolute;left:-9999px;top:0;width:1px;height:1px;pointer-events:none;background:var(--background)";
      document.body.appendChild(p);
      return p;
    }
    function mbuTheme() {
      var root = document.documentElement;
      try {
        var cs = getComputedStyle(root);
        var forced = (cs.getPropertyValue("--mbu-theme") || "").trim();
        var t = forced === "dark" || forced === "light" ? forced : mbuThemeOf(getComputedStyle(document.body).backgroundColor) || mbuThemeOf(cs.backgroundColor) || mbuThemeOf(cs.getPropertyValue("--mbu-bg")) || "light";
        if (root.getAttribute("data-mbu-theme") !== t) root.setAttribute("data-mbu-theme", t);
        var seed = null;
        var raw = (cs.getPropertyValue("--background") || "").trim();
        if (raw) {
          var probe = mbuProbe();
          var got = null;
          if (probe) {
            got = mbuThemeOf(getComputedStyle(probe).backgroundColor);
          } else {
            var tmp = document.createElement("span");
            tmp.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;background:var(--background)";
            document.documentElement.appendChild(tmp);
            got = mbuThemeOf(getComputedStyle(tmp).backgroundColor);
            tmp.remove();
          }
          if (got === t) seed = "theme";
        }
        if (seed) {
          if (root.getAttribute("data-mbu-seed") !== seed) root.setAttribute("data-mbu-seed", seed);
        } else if (root.hasAttribute("data-mbu-seed")) root.removeAttribute("data-mbu-seed");
        return t;
      } catch (e) {
        return "light";
      }
    }
    function mbuThemeStart() {
      try {
        mbuTheme();
        var _mbuThemeT = 0;
        var _mbuThemeSoon = function() {
          clearTimeout(_mbuThemeT);
          _mbuThemeT = setTimeout(mbuTheme, 150);
        };
        var _mbuThemeObs = new MutationObserver(_mbuThemeSoon);
        _mbuThemeObs.observe(document.documentElement, { attributeFilter: ["style", "class"] });
        if (document.head) _mbuThemeObs.observe(document.head, { childList: true, subtree: true, characterData: true });
        if (document.body) _mbuThemeObs.observe(document.body, { attributeFilter: ["style", "class"] });
        try {
          var _mbuMq = matchMedia("(prefers-color-scheme: dark)");
          if (_mbuMq.addEventListener) _mbuMq.addEventListener("change", _mbuThemeSoon);
          else if (_mbuMq.addListener) _mbuMq.addListener(_mbuThemeSoon);
        } catch (e) {
        }
        setTimeout(mbuTheme, 400);
        setTimeout(mbuTheme, 2e3);
      } catch (e) {
      }
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mbuThemeStart, { once: true });
    else mbuThemeStart();
    try {
      var _mbuNs = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
      if (!_mbuNs.MBU) _mbuNs.MBU = {};
      if (!_mbuNs.MBU.theme) _mbuNs.MBU.theme = mbuTheme;
      if (!_mbuNs.MBU.helpHref) _mbuNs.MBU.helpHref = mbuHelpHref;
      if (!_mbuNs.MBU.helpHtml) _mbuNs.MBU.helpHtml = mbuHelpHtml;
      if (!_mbuNs.MBU.helpEl) _mbuNs.MBU.helpEl = mbuHelpEl;
      if (!_mbuNs.MBU.toast) _mbuNs.MBU.toast = mbuToast;
      if (!_mbuNs.MBU.cfgHeader) _mbuNs.MBU.cfgHeader = mbuCfgHeader;
      if (!_mbuNs.MBU.dismissOn) _mbuNs.MBU.dismissOn = mbuDismissOn;
      if (!_mbuNs.MBU.fitToolbar) _mbuNs.MBU.fitToolbar = mbuFitToolbar;
    } catch (e) {
    }
    log.info(mbuStartupInfo("Credit Hoarder"));
    const style = document.createElement("style");
    style.innerText = MBU_TOKENS + MBU_UI_CSS + `
        .discogs-bar {
            font-family: inherit;
            background: var(--mbu-bg);
            border: 1px solid var(--mbu-warn);
            border-left: 4px solid var(--mbu-warn);
            border-radius: 0.35rem;
            margin-bottom: 1rem;
            overflow: hidden;
        }
        .discogs-bar-row1 {
            display: flex;
            align-items: center;
            gap: 0.6rem;
            row-gap: 0.4rem;
            flex-wrap: wrap;
            padding: 0.5rem 0.75rem;
            background: var(--mbu-bg-raised);
            border-bottom: 1px solid var(--mbu-warn);
        }
        /* inline options strip in the single bar (#139) */
        .discogs-bar-opts { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin-left: 0.9rem; }
        .discogs-bar-opts .discogs-opts-label { font-size: 0.75rem; color: var(--mbu-text-weak); text-transform: uppercase; letter-spacing: 0.05em; flex-shrink: 0; }
        .discogs-opts-btn { font-size: 0.8rem; color: var(--mbu-text-dim); background: var(--mbu-bg); border: 1px solid var(--mbu-warn); border-radius: 2rem; padding: 0.15rem 0.6rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem; }
        .discogs-opts-btn:hover { border-color: var(--mbu-warn); color: var(--mbu-text); }
        .discogs-opts-caret { color: var(--mbu-text-weak); font-size: 0.7rem; }
        /* "Options \u25BE" popover (Dedup toggles) */
        .discogs-opts-panel { position: fixed; z-index: 100002; display: none; flex-direction: column; gap: 0.4rem; background: var(--mbu-bg); border: 1px solid var(--mbu-warn); border-radius: 0.4rem; box-shadow: 0 6px 22px rgba(40,20,80,0.18); padding: 0.55rem 0.6rem; font-family: inherit; }
        .discogs-opts-panel.open { display: flex; }
        .discogs-opts-panel .discogs-opts-panel-hd { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--mbu-text-weak); font-weight: 600; }
        /* "Log" header toggle \u2014 a split button (#142, #217): "Log" toggles, the
           \u25BE half (its own clickable target) opens the copy menu. */
        .discogs-log-split { display: inline-flex; align-items: stretch; }
        .discogs-logtoggle-btn { font-size: 0.78rem; color: var(--mbu-text-dim); background: var(--mbu-bg); border: 1px solid var(--mbu-border); border-radius: 0.25rem 0 0 0.25rem; border-right: none; padding: 0.15rem 0.55rem; cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap; }
        .discogs-log-caret-btn { font-size: 0.78rem; color: var(--mbu-text-dim); background: var(--mbu-bg); border: 1px solid var(--mbu-border); border-radius: 0 0.25rem 0.25rem 0; padding: 0.15rem 0.45rem; cursor: pointer; display: inline-flex; align-items: center; }
        .discogs-logtoggle-btn:hover, .discogs-log-caret-btn:hover { border-color: var(--mbu-border); }
        .discogs-log-caret-btn:hover { background: var(--mbu-bg-raised); }
        .discogs-log-split.active .discogs-logtoggle-btn, .discogs-log-split.active .discogs-log-caret-btn { background: var(--mbu-bg-hover); border-color: var(--mbu-accent); color: var(--mbu-accent-deep-text); }
        /* "Log \u25BE" dropdown menu (#118): show/hide + the three copy actions. */
        .discogs-log-menu { position: fixed; z-index: 100002; display: none; flex-direction: column; min-width: 11rem; background: var(--mbu-bg); border: 1px solid var(--mbu-border); border-radius: 0.4rem; box-shadow: 0 6px 22px rgba(40,20,80,0.18); padding: 0.3rem; font-family: inherit; }
        .discogs-log-menu.open { display: flex; }
        .discogs-log-menu button { text-align: left; font-size: 0.82rem; color: var(--mbu-text); background: none; border: none; border-radius: 0.25rem; padding: 0.3rem 0.5rem; cursor: pointer; white-space: nowrap; }
        .discogs-log-menu button:hover { background: var(--mbu-bg-hover); color: var(--mbu-text); }
        /* log panel toolbar: severity filter + copy buttons */
        .discogs-log-toolbar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.3rem 0 0.45rem; }
        .discogs-log-filter { display: inline-flex; border: 1px solid var(--mbu-border); border-radius: 0.3rem; overflow: hidden; }
        .discogs-log-filterbtn { font-size: 0.75rem; color: var(--mbu-text-dim); background: var(--mbu-bg); border: none; border-right: 1px solid var(--mbu-divider); padding: 0.15rem 0.55rem; cursor: pointer; }
        .discogs-log-filterbtn:last-child { border-right: none; }
        .discogs-log-filterbtn:hover { background: var(--mbu-bg-raised); }
        .discogs-log-filterbtn.active { background: var(--mbu-accent); color: var(--mbu-text-on-accent); }
        .discogs-log-copyslot { display: inline-flex; gap: 0.4rem; margin-left: auto; }
        .discogs-log-copybtn { font-size: 0.78rem; color: var(--mbu-text-dim); background: var(--mbu-bg); border: 1px solid var(--mbu-border); border-radius: 0.25rem; padding: 0.15rem 0.5rem; cursor: pointer; white-space: nowrap; }
        .discogs-log-copybtn:hover { border-color: var(--mbu-border); }
        .discogs-bar img.discogs-logo {
            height: 20px;
            width: auto;
            flex-shrink: 0;
            opacity: 0.85;
        }
        .discogs-bar .discogs-source-icon { display: inline-flex; align-items: center; flex-shrink: 0; }
        .discogs-bar .discogs-source-icon:hover .discogs-logo { opacity: 1; }
        .discogs-bar .discogs-source {
            flex: 0 1 auto;
            max-width: 20rem;
            font-size: 0.82rem;
            color: var(--mbu-text-dim);
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        /* Slot in the always-visible header that hosts the review "Start import"
           button + unresolved message (#139). Content-sized; the right cluster's
           margin-left:auto does the pushing so the link/help stay right even when
           this slot is empty (initial state). */
        .discogs-bar-action {
            flex: 0 1 auto;
            min-width: 0;
            display: flex;
            align-items: center;
            gap: 0.6rem;
        }
        .discogs-bar-action:empty { display: none; }
        /* Reserved message area (#118): badge + transient status, right-aligned
           just left of the Discogs/Help/Log cluster. margin-left:auto pushes
           it (and the right cluster after it) to the edge, leaving the gap up to
           the "Options" button free for these messages. Collapses to nothing
           when empty (hidden children don't count as flex items, so the gap
           contributes no width). */
        /* #139: grow to fill the gap between "Options" and the right cluster so the
           status message can use that whole width (right-aligned next to the cluster).
           flex:1 also keeps the right cluster pinned to the edge whether this is empty
           or not \u2014 replacing the old margin-left:auto. Basis 0 (not auto) is essential:
           with an auto basis a very long message's content width is used for row1's
           wrap calculation and bumps the whole slot to a second row; basis 0 keeps it
           on the line and the status just ellipsises inside it. */
        .discogs-bar-msgs {
            flex: 1 1 0;
            justify-content: flex-end;
            display: flex;
            align-items: center;
            gap: 0.4rem;
            min-width: 0;
        }
        /* #139: no fixed cap \u2014 the message takes the available space up to "Options"
           and only ellipsises when it genuinely doesn't fit (flex-shrink + min-width:0). */
        .discogs-bar-status {
            font-size: 0.8rem;
            color: var(--mbu-text-weak);
            flex: 0 1 auto;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0;
        }
        /* #216: persistent end-of-run message (e.g. "No importable credits found") */
        .discogs-bar-status-final {
            color: var(--mbu-warn);
            font-weight: 600;
        }
        /* Count badges. Buttons so they can focus/open the log; styled as pills.
           Borderless + a touch larger per #139; the (deepened) fill carries them. */
        .discogs-badge {
            flex-shrink: 0;
            font-size: 0.9rem;
            font-weight: 600;
            line-height: 1.2;
            padding: 0.2rem 0.7rem;
            border-radius: 2rem;
            border: none;
            cursor: pointer;
            white-space: nowrap;
        }
        .discogs-badge-warn      { color: var(--mbu-warn); background: var(--mbu-warn-bg); }
        .discogs-badge-warn:hover{ background: var(--mbu-warn-bg); }
        .discogs-badge-err       { color: var(--mbu-error); background: var(--mbu-error-bg); }
        .discogs-badge-err:hover { background: var(--mbu-error-bg); }
        .discogs-badge-unresolved{ color: var(--mbu-accent-deep-text); background: var(--mbu-bg-hover); }
        .discogs-badge-unresolved:hover { background: var(--mbu-bg-hover); }
        /* Discogs logo + Help + Log \u2014 pinned to the right edge (the msgs slot's
           margin-left:auto does the pushing). */
        .discogs-bar-right {
            flex-shrink: 0;
            display: flex;
            align-items: center;
            gap: 0.6rem;
            min-width: 0;
        }
        /* During the review wait the import isn't running, so the "Importing\u2026"
           button + percentage are redundant \u2014 hide them; they reappear while a
           real import phase (preflight / dispatch) is active (#139). */
        .discogs-bar.is-reviewing .discogs-import-btn,
        .discogs-bar.is-reviewing #discogs-progress-pct { display: none !important; }   /* !important: the % span carries an inline display set by JS */
        .discogs-bar-action .discogs-issue-note {
            font-size: 0.85rem;
            color: var(--mbu-warn);
            min-width: 7.5rem;   /* reserve space so the bar doesn't reflow as the count appears / changes (#139) */
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .discogs-bar-action .discogs-issue-note.clickable {
            cursor: pointer;
            text-decoration: underline dotted;
        }
        .discogs-bar-action .discogs-issue-note.clickable:hover { color: var(--mbu-warn); }
        /* "N links" badge \u2014 orange, short, clickable to cycle through the rows
           whose source URL still needs linking. No wide min-width reservation. */
        .discogs-bar-action .discogs-links-note { min-width: 0; color: var(--mbu-warn); }
        .discogs-bar-action .discogs-links-note.clickable:hover { color: var(--mbu-warn); }
        .discogs-bar .discogs-source a {
            color: var(--mbu-warn);
            text-decoration: none;
            font-weight: bold;
        }
        .discogs-bar .discogs-source a:hover { text-decoration: underline; }
        /* #272: "Import credits:" label + a row of clickable source icons */
        .discogs-import-label { flex-shrink: 0; font-size: 0.88rem; font-weight: bold; color: var(--mbu-text); letter-spacing: 0.01em; }
        /* #272: drop the "Import credits:" label once a run is underway \u2014 only the
           active source icon + progress/Start-import matter then. */
        .discogs-bar.is-importing .discogs-import-label,
        .discogs-bar.is-reviewing .discogs-import-label { display: none; }
        .discogs-src-icons { flex-shrink: 0; display: inline-flex; align-items: center; gap: 0.3rem; }
        .discogs-src-ico {
            display: inline-flex; align-items: center; justify-content: center;
            width: 2rem; height: 2rem; padding: 0; cursor: pointer;
            border: 1px solid var(--mbu-border); border-radius: 0.3rem; background: var(--mbu-bg); color: var(--mbu-text-dim);
        }
        .discogs-src-ico:hover { background: var(--mbu-bg-raised); border-color: var(--mbu-warn); color: var(--mbu-warn); }
        .discogs-src-ico:disabled { opacity: 0.5; cursor: default; }
        .discogs-src-ico svg { width: 18px; height: 18px; }
        .discogs-src-ico img.discogs-logo { height: 18px; width: auto; opacity: 1; }
        .discogs-src-ico.importing { background: var(--mbu-bg-raised); border-color: var(--mbu-warn); animation: discogs-ico-pulse 1s ease-in-out infinite; }
        @keyframes discogs-ico-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(232,119,29,.5); } 50% { box-shadow: 0 0 0 4px rgba(232,119,29,0); } }
        /* #412: while MusicBrainz is submitting the staged edits (can be slow for hundreds),
           pulse the toolbar blue. Target ROW1 \u2014 that's the strip pinned (position:fixed) at
           the top of the viewport while the page is scrolled down to the submit button, i.e.
           the part actually on screen. The outer container is usually scrolled out of view. */
        .discogs-bar.is-saving { border-left-color: var(--mbu-info); }
        .discogs-bar.is-saving .discogs-bar-row1 { animation: discogs-bar-saving 1.1s ease-in-out infinite; border-bottom-color: var(--mbu-info); }
        @keyframes discogs-bar-saving { 0%,100% { background: var(--mbu-bg-raised); } 50% { background: var(--mbu-info-bg); } }
        .discogs-bar.is-saving .discogs-bar-status-final { color: var(--mbu-info); font-weight: 600; }
        /* #412: a toolbar "Enter edit" that fires MB's native submit, so you don't have to
           scroll to the bottom after an import. Shown once an import finishes, removed on
           return-to-source. Green to read as the positive/submit action (matches MB). */
        .discogs-enter-edit {
            flex-shrink: 0; font-size: 0.82rem; font-weight: 600; cursor: pointer; white-space: nowrap;
            color: var(--mbu-text-on-accent); background: #4b8f29; border: 1px solid var(--mbu-ok); border-radius: 0.25rem;
            padding: 0.14rem 0.6rem;
        }
        .discogs-enter-edit:hover { background: #57a230; }
        .discogs-bar.is-saving .discogs-enter-edit { opacity: 0.6; pointer-events: none; }
        /* #408 "Import all" \u2014 wider pill with a glyph + label, brand-orange so it reads as the primary action */
        .discogs-src-all { width: auto; gap: 0.3rem; padding: 0 0.6rem; border-color: var(--mbu-warn); color: var(--mbu-warn); font-weight: 600; font-size: 0.85rem; margin-left: 0.35rem; }
        .discogs-src-all:hover { background: #e8771d; color: var(--mbu-text-on-accent); border-color: var(--mbu-warn); }
        .discogs-src-all .discogs-all-glyph { font-size: 1rem; line-height: 1; }
        .discogs-bar-badge, .discogs-src-badge svg { width: 15px; height: 15px; }
        .discogs-log-menu button svg { vertical-align: -2px; margin-right: 4px; }
        .discogs-bar-row2 {
            display: flex;
            align-items: center;
            gap: 0.4rem;
            padding: 0.35rem 0.75rem;
            flex-wrap: wrap;
        }
        .discogs-bar-row2 .discogs-opts-label {
            font-size: 0.75rem;
            color: var(--mbu-text-weak);
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-right: 0.2rem;
            flex-shrink: 0;
        }
        /* Borderless toggles (#118): no pill outline/background \u2014 the dot alone
           signals on/off, matching the maintainer's mockup. */
        .discogs-toggle {
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            padding: 0.15rem 0.4rem 0.15rem 0.2rem;
            border: none;
            border-radius: 2rem;
            background: transparent;
            cursor: pointer;
            font-size: 0.8rem;
            color: var(--mbu-text-dim);
            user-select: none;
            transition: color 0.12s;
        }
        .discogs-toggle:hover { color: var(--mbu-text); }
        .discogs-toggle input[type=checkbox] { display: none; }
        .discogs-toggle .discogs-toggle-dot {
            width: 14px; height: 14px;
            border-radius: 50%;
            border: 2px solid var(--mbu-border);
            background: var(--mbu-bg);
            flex-shrink: 0;
            transition: border-color 0.12s, background 0.12s;
        }
        .discogs-toggle.active {
            color: var(--mbu-text);
        }
        .discogs-toggle.active .discogs-toggle-dot {
            border-color: var(--mbu-warn);
            background: #e8771d;
        }
        .discogs-output { padding: 0.5rem 0.75rem 0.25rem; }
        .discogs-output.empty { display: none; }   /* no log yet \u2192 hide the whole section (#142) */
        .discogs-output .summary { margin: 0 0 0.25rem; font-size: 0.88rem; color: var(--mbu-text-dim); }
        .discogs-output .logs { margin: 0; padding-left: 1.2rem; font-size: 0.83rem; }
        /* log panel hides behind the header "Log \u25BE" button (#142); the review
           panel sits in .discogs-review-slot OUTSIDE the panel, always visible. */
        .discogs-log-panel { display: none; }
        .discogs-output.log-open .discogs-log-panel { display: block; }
        .discogs-review-slot:not(:empty) { margin: 0.2rem 0; }
        /* severity filter: Warnings shows only warn lines, Errors only error
           lines \u2014 each view matches its header badge count. "skip" lines
           (unresolved-entity skips, #118) and info lines show only under
           "All"; errors are NOT lumped into the Warnings view. */
        .discogs-output[data-logfilter="warn"] .discogs-log-body .logs > li:not([data-sev="warn"]) { display: none; }
        .discogs-output[data-logfilter="error"] .discogs-log-body .logs > li:not([data-sev="error"]) { display: none; }
        /* \u2500\u2500 Progress / sticky bar \u2500\u2500 */
        /* Pinned during import (is-importing) AND kept pinned afterwards
           (is-pinned, #118) so the WARN/ERR badge stays visible on top while the
           user scrolls the staged edits below. overflow:hidden on .discogs-bar
           rules out position:sticky, so we use fixed + an in-flow spacer that
           reserves row1's height (see .discogs-sticky-spacer). */
        .discogs-bar.is-importing .discogs-bar-row1,
        .discogs-bar.is-pinned .discogs-bar-row1 {
            position: fixed;
            top: 0; left: 0; right: 0;
            z-index: 9000;
            background: var(--mbu-bg-raised);
            border-bottom: 1px solid var(--mbu-warn);
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        /* Occupies row1's height in the flow while row1 is fixed, so the page
           content below the bar doesn't jump up under it. Height set by JS. */
        .discogs-sticky-spacer { display: none; }
        .discogs-bar.is-importing .discogs-sticky-spacer,
        .discogs-bar.is-pinned .discogs-sticky-spacer { display: block; }
        .discogs-progress-track {
            height: 5px;
            background: var(--mbu-warn-bg);
            border-radius: 3px;
            overflow: hidden;
        }
        .discogs-progress-fill {
            height: 100%;
            width: 0%;
            background: #e8771d;
            border-radius: 3px;
            transition: width 0.3s ease;
        }
        .discogs-progress-fill.indeterminate {
            width: 40%;
            animation: discogs-slide 1.4s ease-in-out infinite;
        }
        @keyframes discogs-slide {
            0%   { margin-left: -40%; }
            100% { margin-left: 100%; }
        }
        .discogs-progress-status {
            font-size: 0.8rem;
            color: var(--mbu-warn);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .discogs-recent-logs {
            font-size: 0.78rem;
            color: var(--mbu-text-weak);
            max-height: 3.2rem;
            overflow: hidden;
            line-height: 1.4;
        }
        .discogs-recent-logs span {
            display: block;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .discogs-toggle { position: relative; }
        /* position:fixed so the tooltip escapes .discogs-bar's
           overflow:hidden (needed there to clip child backgrounds to
           the bar's rounded corners). Per-hover JS in makeCheckbox
           sets top/left from the toggle's viewport rect, so the
           tooltip renders outside any overflow-clipping ancestor.
           Issue #89. */
        .discogs-tooltip {
            display: none;
            position: fixed;
            background: #333;
            color: var(--mbu-text-on-accent);
            font-size: 0.78rem;
            line-height: 1.45;
            padding: 0.45rem 0.65rem;
            border-radius: 0.3rem;
            white-space: normal;
            width: 220px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
            pointer-events: none;
            z-index: 9999;
            text-align: left;
        }
        .discogs-tooltip::after {
            content: '';
            position: absolute;
            top: 100%;
            left: var(--arrow-x, 50%);
            transform: translateX(-50%);
            border: 5px solid transparent;
            border-top-color: #333;
        }
        /* When the tooltip flipped below the toggle (no room above),
           flip the arrow to point up from the tooltip's top edge. */
        .discogs-tooltip.below::after {
            top: auto;
            bottom: 100%;
            border-top-color: transparent;
            border-bottom-color: #333;
        }
        /* Tooltip shown by JS adding .discogs-tooltip-visible after a
           hover-intent delay (see makeCheckbox). Native browser title=
           tooltips have a ~1s delay by convention; the custom tooltips
           used to fire instantly and felt jumpy when sweeping across
           toggles. */
        .discogs-tooltip.discogs-tooltip-visible { display: block; }
        /* An input that password managers leave alone is typed "search"; these
           rules put back the look of a plain text box (Chrome draws a clear
           button and its own inner spacing otherwise). See noPasswordManagers.
           No backticks in here: this whole block is a JS template literal. */
        input.ch-nopw { -webkit-appearance: textfield; appearance: textfield; }
        input.ch-nopw::-webkit-search-decoration,
        input.ch-nopw::-webkit-search-cancel-button,
        input.ch-nopw::-webkit-search-results-button,
        input.ch-nopw::-webkit-search-results-decoration { display: none; -webkit-appearance: none; }
    `;
    document.head.appendChild(style);
    const bar = document.createElement("div");
    bar.className = "discogs-bar";
    bar._runToken = 0;
    const row1 = document.createElement("div");
    row1.className = "discogs-bar-row1";
    const importSources = [];
    if (discogsUrl) importSources.push({ name: "Discogs", url: discogsUrl, run: (g, c, collect) => runImport(discogsUrl, g, c, collect) });
    if (sources.tidal) importSources.push({ name: "Tidal", url: sources.tidal, run: (g, c, collect) => runTidalImport(sources.tidal, g, c, collect) });
    if (sources.qobuz) importSources.push({ name: "Qobuz", url: sources.qobuz, run: (g, c, collect) => runQobuzImport(sources.qobuz, g, c, collect) });
    if (sources.deezer) importSources.push({ name: "Deezer", url: sources.deezer, run: (g, c, collect) => runDeezerImport(sources.deezer, g, c, collect) });
    importSources.push({ name: "Apple", url: sources.apple || "", run: (g, c, collect) => runAppleImport(sources.apple || "", g, c, collect) });
    if (sources.metalArchives) importSources.push({ name: "Metal Archives", url: sources.metalArchives, run: (g, c, collect) => runMetalArchivesImport(sources.metalArchives, g, c, collect) });
    if (sources.ytmusic) importSources.push({ name: "YouTube Music", url: sources.ytmusic, run: (g, c, collect) => runYtmImport(sources.ytmusic, g, c, collect) });
    if ((meta.titlesRemixCount || 0) > 0) {
      importSources.push({ name: "Titles", url: "", run: (g, c, collect) => runTitlesImport(g, c, collect) });
    }
    const importLabel = document.createElement("span");
    importLabel.className = "discogs-import-label";
    importLabel.textContent = "Import credits:";
    const srcIcons = document.createElement("span");
    srcIcons.className = "discogs-src-icons";
    const ORIG_ICON = {
      Discogs: stIcon("discogs", 16),
      Tidal: stIcon("tidal", 16),
      Qobuz: stIcon("qobuz", 16),
      Deezer: stIcon("deezer", 16),
      Apple: stIcon("apple", 16),
      "YouTube Music": stIcon("ytmusic", 16),
      // #648
      Titles: SRC_ICON.Titles
    };
    const srcButtons = [];
    let importing = false;
    const makeSrcButton = (s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "discogs-src-ico";
      b._icon = ORIG_ICON[s.name] || SRC_ICON[s.name] || s.name;
      b.innerHTML = b._icon;
      b.dataset.src = s.name;
      b.title = s.url ? `Import credits from ${s.name}  \xB7  right-click to open the ${s.name} page` : "Import remixer credits derived from the track titles";
      b.addEventListener("click", () => {
        if (importing) {
          if (b.classList.contains("importing")) cancelRun();
          return;
        }
        startImport(b, s.url, s.run);
      });
      if (s.url) b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        window.open(s.url, "_blank", "noopener,noreferrer");
      });
      srcButtons.push(b);
      srcIcons.appendChild(b);
      return b;
    };
    importSources.forEach(makeSrcButton);
    const toolboxSongLabel = document.createElement("label");
    toolboxSongLabel.htmlFor = "toolbox-apple-song-url";
    toolboxSongLabel.textContent = "Apple song URL (optional)";
    toolboxSongLabel.style.cssText = "font-size:0.8rem;white-space:nowrap;";
    const toolboxSongInput = document.createElement("input");
    toolboxSongInput.id = "toolbox-apple-song-url";
    toolboxSongInput.type = "url";
    toolboxSongInput.inputMode = "url";
    toolboxSongInput.autocomplete = "off";
    toolboxSongInput.placeholder = "https://music.apple.com/us/song/title/1685732274";
    toolboxSongInput.title = "Paste a song URL and select the Apple icon to import only that song. Leave blank for an album.";
    toolboxSongInput.style.cssText = "flex:1 1 220px;max-width:350px;min-width:160px;padding:6px;border:1px solid var(--mbu-border);border-radius:4px;background:var(--mbu-bg);color:inherit;";
    toolboxSongInput.addEventListener("input", () => toolboxSongInput.setCustomValidity(""));
    toolboxSongInput.addEventListener("change", () => {
      if (!toolboxSongInput.value.trim()) return;
      try {
        const url = new URL(toolboxSongInput.value);
        if (url.hostname !== "music.apple.com" || !/\/song\//.test(url.pathname)) throw Error("Invalid song URL");
      } catch {
        toolboxSongInput.setCustomValidity("Enter a valid music.apple.com song URL.");
      }
    });
    if (meta.sourceProbeFailed && !importSources.length) {
      const warn = document.createElement("span");
      warn.className = "discogs-src-probe-failed";
      warn.style.cssText = "font-size:0.8rem;color:var(--mbu-warn);";
      warn.textContent = "could not read this release\u2019s links from MusicBrainz \u2014 reload to retry";
      warn.title = "The /ws/js/release lookup failed (MusicBrainz was busy or unreachable), so the linked import sources are unknown.";
      srcIcons.appendChild(warn);
    }
    const makeAllButton = () => {
      if (importSources.length <= 1 || srcIcons.querySelector(".discogs-src-all")) return;
      const allBtn = document.createElement("button");
      allBtn.type = "button";
      allBtn.className = "discogs-src-ico discogs-src-all";
      allBtn._icon = '<span class="discogs-all-glyph">\u269B</span><span class="discogs-all-lbl">All</span>';
      allBtn.innerHTML = allBtn._icon;
      allBtn.dataset.src = "All";
      allBtn.title = `Import from all ${importSources.length} sources at once \u2014 merged & de-duplicated into one review`;
      allBtn.addEventListener("click", () => {
        if (importing) {
          if (allBtn.classList.contains("importing")) cancelRun();
          return;
        }
        startImport(allBtn, "", (g, c) => runConsolidatedImport(importSources, g, c), `Import all (${importSources.map((s) => s.name).join(", ")})`);
      });
      srcButtons.push(allBtn);
      srcIcons.appendChild(allBtn);
    };
    makeAllButton();
    const addTitlesSource = (count) => {
      if (!(count > 0)) return "none";
      if (importSources.some((x) => x.name === "Titles")) return "already";
      const src = { name: "Titles", url: "", run: (g, c, collect) => runTitlesImport(g, c, collect) };
      importSources.push(src);
      makeSrcButton(src);
      makeAllButton();
      return "added";
    };
    bar._addTitlesSource = addTitlesSource;
    const progressPct = document.createElement("span");
    progressPct.id = "discogs-progress-pct";
    progressPct.style.cssText = "display:none; margin-left:0.5rem; font-size:0.85rem; color:var(--mbu-warn); font-weight:bold; min-width:3.5rem;";
    row1.appendChild(importLabel);
    row1.appendChild(srcIcons);
    row1.appendChild(toolboxSongLabel);
    row1.appendChild(toolboxSongInput);
    row1.appendChild(progressPct);
    const actionSlot = document.createElement("div");
    actionSlot.className = "discogs-bar-action";
    row1.appendChild(actionSlot);
    const optsWrap = document.createElement("div");
    optsWrap.className = "discogs-bar-opts";
    row1.appendChild(optsWrap);
    let _optsHost = optsWrap;
    const msgSlot = document.createElement("div");
    msgSlot.className = "discogs-bar-msgs";
    const statusEl = document.createElement("span");
    statusEl.className = "discogs-bar-status";
    statusEl.style.display = "none";
    const warnPill = document.createElement("button");
    warnPill.type = "button";
    warnPill.className = "discogs-badge discogs-badge-warn";
    warnPill.style.display = "none";
    warnPill.title = "Show warnings in the log";
    const errPill = document.createElement("button");
    errPill.type = "button";
    errPill.className = "discogs-badge discogs-badge-err";
    errPill.style.display = "none";
    errPill.title = "Show errors in the log";
    const unresolvedPill = document.createElement("button");
    unresolvedPill.type = "button";
    unresolvedPill.className = "discogs-badge discogs-badge-unresolved";
    unresolvedPill.style.display = "none";
    unresolvedPill.title = "Entities not matched on MusicBrainz \u2014 skipped on import";
    msgSlot.append(statusEl, warnPill, errPill, unresolvedPill);
    row1.appendChild(msgSlot);
    const rightGroup = document.createElement("div");
    rightGroup.className = "discogs-bar-right";
    const logSplit = document.createElement("span");
    logSplit.className = "discogs-log-split";
    logSplit.style.display = "none";
    const logToggleBtn = document.createElement("button");
    logToggleBtn.type = "button";
    logToggleBtn.className = "discogs-logtoggle-btn";
    logToggleBtn.textContent = "Log";
    logToggleBtn.title = "Show / hide the import log";
    const logCaretBtn = document.createElement("button");
    logCaretBtn.type = "button";
    logCaretBtn.className = "discogs-log-caret-btn";
    logCaretBtn.textContent = "\u25BE";
    logCaretBtn.title = "More log actions (copy)";
    logSplit.append(logToggleBtn, logCaretBtn);
    const docsHref = typeof GM_info !== "undefined" && (GM_info?.script?.homepageURL || GM_info?.script?.homepage) || "https://github.com/majkinetor/musicbrainz-userscripts/blob/main/userscripts/credit_hoarder/README.md";
    const docsLink = document.createElement("a");
    docsLink.href = docsHref;
    docsLink.target = "_blank";
    docsLink.rel = "noopener noreferrer nofollow";
    docsLink.textContent = "? Help";
    docsLink.title = "Open the script's README in a new tab";
    docsLink.style.cssText = "flex-shrink:0;font-size:0.82rem;color:var(--mbu-warn);text-decoration:none;padding:0.1rem 0.45rem;border:1px solid var(--mbu-warn);border-radius:0.25rem;background:var(--mbu-bg-raised);";
    const enterEditBtn = document.createElement("button");
    enterEditBtn.type = "button";
    enterEditBtn.className = "discogs-enter-edit";
    enterEditBtn.textContent = "Enter edit";
    enterEditBtn.title = 'Submit the staged edits to MusicBrainz \u2014 clicks the native "Enter edit" button at the bottom of the page';
    enterEditBtn.style.display = "none";
    const findNativeSubmit = () => document.querySelector("button.submit.positive") || [...document.querySelectorAll('button[type="submit"], button.submit')].find((b) => /enter edit/i.test(b.textContent || ""));
    enterEditBtn.addEventListener("click", () => {
      const submit = findNativeSubmit();
      if (!submit) {
        bar._setStopMessage(`Could not find MusicBrainz's "Enter edit" button \u2014 scroll down and submit manually.`);
        return;
      }
      submit.scrollIntoView({ behavior: "smooth", block: "center" });
      submit.click();
    });
    bar._showEnterEdit = () => {
      if (findNativeSubmit()) enterEditBtn.style.display = "";
    };
    bar._hideEnterEdit = () => {
      enterEditBtn.style.display = "none";
    };
    rightGroup.append(enterEditBtn, logSplit, docsLink);
    row1.appendChild(rightGroup);
    bar.appendChild(row1);
    const stickySpacer = document.createElement("div");
    stickySpacer.className = "discogs-sticky-spacer";
    bar.appendChild(stickySpacer);
    bar._pin = () => {
      const h = row1.getBoundingClientRect().height;
      if (h) stickySpacer.style.height = h + "px";
    };
    window.addEventListener("resize", () => {
      if (bar.classList.contains("is-pinned")) bar._pin();
    });
    function makeCheckbox(labelText, checkedByDefault, tooltipText) {
      const lbl = document.createElement("label");
      lbl.className = "discogs-toggle" + (checkedByDefault ? " active" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checkedByDefault;
      const dot = document.createElement("span");
      dot.className = "discogs-toggle-dot";
      lbl.appendChild(cb);
      lbl.appendChild(dot);
      lbl.appendChild(document.createTextNode(labelText));
      if (tooltipText) {
        const tip = document.createElement("span");
        tip.className = "discogs-tooltip";
        tip.textContent = tooltipText;
        lbl.appendChild(tip);
        const TIP_W = 220, TIP_MARGIN = 6, EDGE_PAD = 8;
        const HOVER_DELAY_MS = 1e3;
        let _showTimer, _hideTimer;
        lbl.addEventListener("mouseenter", () => {
          clearTimeout(_showTimer);
          _showTimer = setTimeout(() => {
            const r = lbl.getBoundingClientRect();
            const centerX = r.left + r.width / 2;
            let x = centerX - TIP_W / 2;
            x = Math.max(EDGE_PAD, Math.min(x, window.innerWidth - TIP_W - EDGE_PAD));
            tip.style.left = `${x}px`;
            tip.style.top = "-9999px";
            tip.classList.add("discogs-tooltip-visible");
            const h = tip.offsetHeight;
            const above = r.top - TIP_MARGIN - h;
            const fitsAbove = above >= EDGE_PAD;
            tip.style.top = fitsAbove ? `${above}px` : `${r.bottom + TIP_MARGIN}px`;
            tip.classList.toggle("below", !fitsAbove);
            tip.style.setProperty("--arrow-x", `${centerX - x}px`);
            clearTimeout(_hideTimer);
            _hideTimer = setTimeout(() => tip.classList.remove("discogs-tooltip-visible"), 4e3);
          }, HOVER_DELAY_MS);
        });
        lbl.addEventListener("mouseleave", () => {
          clearTimeout(_showTimer);
          clearTimeout(_hideTimer);
          tip.classList.remove("discogs-tooltip-visible");
        });
      }
      lbl.addEventListener("click", (e) => {
        e.preventDefault();
        cb.checked = !cb.checked;
        lbl.classList.toggle("active", cb.checked);
        document.querySelectorAll(".discogs-tooltip-visible").forEach((t) => t.classList.remove("discogs-tooltip-visible"));
      });
      _optsHost.appendChild(lbl);
      return cb;
    }
    function makeSelect(labelText, initialValue, options, tooltipText) {
      const wrap = document.createElement("span");
      wrap.className = "discogs-select-wrap";
      wrap.style.cssText = "display:inline-flex;align-items:center;gap:0.3rem;font-size:0.8rem;color:var(--mbu-text-dim);padding:0.15rem 0.2rem;border:none;background:transparent;";
      const lbl = document.createElement("span");
      lbl.textContent = labelText + ":";
      wrap.appendChild(lbl);
      const sel = document.createElement("select");
      sel.style.cssText = "font-size:0.8rem;padding:0.05rem 0.2rem;border:none;background:transparent;cursor:pointer;color:var(--mbu-text);font-weight:600;";
      options.forEach((opt) => {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === initialValue) o.selected = true;
        sel.appendChild(o);
      });
      if (tooltipText) wrap.title = tooltipText;
      wrap.appendChild(sel);
      _optsHost.appendChild(wrap);
      return sel;
    }
    const gmLoad = (key) => {
      try {
        return GM_getValue(key, void 0);
      } catch (e) {
        return void 0;
      }
    };
    const gmSave = (key, raw) => {
      try {
        GM_setValue(key, raw);
      } catch (e) {
      }
    };
    const OPTS_KEY = "discogs-importer-opts";
    let savedOpts = {};
    try {
      savedOpts = JSON.parse(gmLoad(OPTS_KEY) || "{}");
    } catch (e) {
    }
    if (!savedOpts.createWorksReset421) {
      savedOpts.createWorksMode = "never";
      savedOpts.createWorksReset421 = true;
      delete savedOpts.createWorks;
      try {
        gmSave(OPTS_KEY, JSON.stringify(savedOpts));
      } catch (e) {
      }
    }
    if (!savedOpts.coCreditDefaultOn613) {
      savedOpts.coCredit = true;
      savedOpts.coCreditDefaultOn613 = true;
      try {
        gmSave(OPTS_KEY, JSON.stringify(savedOpts));
      } catch (e) {
      }
    }
    const bv = (k, d) => k in savedOpts ? savedOpts[k] : d;
    const tracklistCb = makeCheckbox(
      "Per-track credits",
      bv("tracklist", true),
      "Import per-track artist credits."
    );
    const applyTracksCb = makeCheckbox(
      "Move release credits to tracks",
      bv("applyTracks", false),
      "Move performance credits from the release down to every recording."
    );
    const useWorksCb = makeCheckbox(
      "Use",
      bv("useWorks", true),
      "Import work-level credits (composer / lyricist / writer \u2026). Off: no work relationship is touched at all \u2014 nothing created, nothing attached to existing works."
    );
    const _initialCreateWorksMode = bv("createWorksMode", "never") === "when-needed" ? "when-needed" : "never";
    const createWorksMode = makeSelect("works", _initialCreateWorksMode, [
      { value: "never", label: "create none" },
      { value: "when-needed", label: "create needed" }
    ], "create none: use only existing works \u2014 work-only credits with no work are logged and skipped. create needed: also create a work when a composer/lyricist/writer credit needs one \u2014 match recordings to EXISTING works first (Group Therapy) or you will create duplicates.");
    const syncWorksUi = () => {
      createWorksMode.disabled = !useWorksCb.checked;
      const w = createWorksMode.closest(".discogs-select-wrap");
      if (w) w.style.opacity = useWorksCb.checked ? "" : ".45";
    };
    syncWorksUi();
    useWorksCb.closest("label").style.paddingRight = "0";
    {
      const w = createWorksMode.closest(".discogs-select-wrap");
      if (w) {
        w.style.paddingLeft = "0";
        w.style.marginLeft = "-0.2rem";
      }
    }
    function showCreateWorksWarning() {
      const ov = document.createElement("div");
      ov.className = "discogs-cw-warn-ov mbu-ui";
      ov.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(20,10,10,.45);display:flex;align-items:center;justify-content:center;";
      const box = document.createElement("div");
      box.style.cssText = "max-width:460px;margin:16px;background:var(--mbu-bg);border-radius:8px;border-top:4px solid var(--mbu-error);padding:16px 20px 14px;box-shadow:0 14px 44px rgba(0,0,0,.4);font-size:13px;line-height:1.55;color:var(--mbu-text);";
      box.innerHTML = '<div style="font-weight:800;color:var(--mbu-error);font-size:15px;margin-bottom:8px;">\u26A0\uFE0F WARNING: Avoid creating work duplicates!</div><p style="margin:0 0 8px;">Make sure that you <strong>matched works</strong> prior to using this option. You are responsible for matching recordings to existing works.</p><p style="margin:0 0 12px;"><a href="https://github.com/majkinetor/musicbrainz-userscripts/blob/main/userscripts/group_therapy/README.md" target="_blank" rel="noopener noreferrer">Group Therapy</a> userscript makes work matching faster and can start it as soon as you enter the relationship editor so you don\u2019t forget.</p><div style="text-align:right;"><button type="button" style="padding:5px 18px;font-size:13px;font-weight:600;color:#fff;background:#c0392b;border:none;border-radius:5px;cursor:pointer;">I understand</button></div>';
      const close = () => ov.remove();
      box.querySelector("button").addEventListener("click", close);
      ov.addEventListener("mousedown", (e) => {
        if (e.target === ov) close();
      });
      ov.appendChild(box);
      document.body.appendChild(ov);
      box.querySelector("button").focus();
    }
    createWorksMode.addEventListener("change", () => {
      if (createWorksMode.value === "when-needed") showCreateWorksWarning();
    });
    useWorksCb.closest("label").addEventListener("click", () => setTimeout(() => {
      syncWorksUi();
      if (useWorksCb.checked && createWorksMode.value === "when-needed") showCreateWorksWarning();
    }, 0));
    const optsBtn = document.createElement("button");
    optsBtn.type = "button";
    optsBtn.className = "discogs-opts-btn";
    optsBtn.innerHTML = 'Options <span class="discogs-opts-caret">\u25BE</span>';
    optsBtn.title = "Deduplication and matching options";
    const optsPanel = document.createElement("div");
    optsPanel.className = "discogs-opts-panel mbu-ui";
    const dedupHd = document.createElement("div");
    dedupHd.className = "discogs-opts-panel-hd";
    dedupHd.textContent = "Deduplication";
    optsPanel.appendChild(dedupHd);
    _optsHost = optsPanel;
    const dedupeEqCb = makeCheckbox(
      "Equivalence sets",
      bv("dedupeEquivalenceSets", true),
      "Skip a role when an equivalent role already exists on the target (writer \u2261 composer)."
    );
    const dedupeDupCb = makeCheckbox(
      "Duplicate roles",
      bv("dedupeDuplicateRoles", true),
      "Skip adding a role when the target already has the same role (regardless of task / dates / attributes)."
    );
    const matchHd = document.createElement("div");
    matchHd.className = "discogs-opts-panel-hd";
    matchHd.textContent = "Matching";
    optsPanel.appendChild(matchHd);
    const coCreditCb = makeCheckbox(
      "Co-credit search",
      bv("coCredit", true),
      "For a name still ambiguous after name, alias and release-context matching, search MusicBrainz for a recording that credits it ALONGSIDE the release artist (one extra request per ambiguous name and release artist; none on Various Artists releases). On by default."
    );
    _optsHost = optsWrap;
    optsWrap.appendChild(optsBtn);
    document.body.appendChild(optsPanel);
    optsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = optsPanel.classList.toggle("open");
      if (!open) return;
      const r = optsBtn.getBoundingClientRect();
      optsPanel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - optsPanel.offsetWidth - 8)) + "px";
      optsPanel.style.top = r.bottom + 4 + "px";
      const off = (ev) => {
        if (!optsPanel.contains(ev.target) && ev.target !== optsBtn && !optsBtn.contains(ev.target)) {
          optsPanel.classList.remove("open");
          document.removeEventListener("mousedown", off);
        }
      };
      setTimeout(() => document.addEventListener("mousedown", off), 0);
    });
    const saveOpts = () => {
      try {
        gmSave(OPTS_KEY, JSON.stringify({
          tracklist: tracklistCb.checked,
          applyTracks: applyTracksCb.checked,
          useWorks: useWorksCb.checked,
          // #424 master toggle
          createWorksMode: createWorksMode.value,
          createWorksReset421: true,
          // #421 one-time reset already applied — must survive every save
          dedupeEquivalenceSets: dedupeEqCb.checked,
          dedupeDuplicateRoles: dedupeDupCb.checked,
          coCredit: coCreditCb.checked,
          // #613
          coCreditDefaultOn613: true
          // #613 one-time default-on already applied — must survive every save
        }));
      } catch (e) {
      }
    };
    [tracklistCb, applyTracksCb, useWorksCb, dedupeEqCb, dedupeDupCb, coCreditCb].forEach((cb) => cb.closest("label").addEventListener("click", () => setTimeout(saveOpts, 0)));
    createWorksMode.addEventListener("change", saveOpts);
    const outputDiv = document.createElement("div");
    outputDiv.className = "discogs-output empty";
    const LOG_OPEN_KEY = "discogs-importer-log-open";
    const reviewSlot = document.createElement("div");
    reviewSlot.className = "discogs-review-slot";
    setReviewContainer(reviewSlot);
    const logPanel = document.createElement("div");
    logPanel.className = "discogs-log-panel";
    const logToolbar = document.createElement("div");
    logToolbar.className = "discogs-log-toolbar";
    const logFilter = document.createElement("div");
    logFilter.className = "discogs-log-filter";
    [["all", "All"], ["warn", "\u26A0 Warnings"], ["error", "\u26D4 Errors"]].forEach(([f, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "discogs-log-filterbtn" + (f === "all" ? " active" : "");
      b.dataset.f = f;
      b.textContent = label;
      b.addEventListener("click", () => {
        outputDiv.dataset.logfilter = f;
        logFilter.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.f === f));
      });
      logFilter.appendChild(b);
    });
    logToolbar.append(logFilter);
    const logBody = document.createElement("div");
    logBody.className = "discogs-log-body";
    logPanel.append(logToolbar, logBody);
    outputDiv.append(reviewSlot, logPanel);
    outputDiv.dataset.logfilter = "all";
    if (!_logs2) {
      _logs2 = document.createElement("ul");
      _logs2.className = "logs";
      logBody.appendChild(_logs2);
      setLogContainer(_logs2);
      if (_logs2.children.length) outputDiv.classList.remove("empty");
    }
    const applyLogOpen = () => {
      const open = gmLoad(LOG_OPEN_KEY) === "1";
      outputDiv.classList.toggle("log-open", open);
      logSplit.classList.toggle("active", open);
    };
    try {
      applyLogOpen();
    } catch (e) {
    }
    const setLogOpen = (open) => {
      outputDiv.classList.toggle("log-open", open);
      logSplit.classList.toggle("active", open);
      try {
        gmSave(LOG_OPEN_KEY, open ? "1" : "0");
      } catch (e) {
      }
    };
    const logMenu = document.createElement("div");
    logMenu.className = "discogs-log-menu mbu-ui";
    const mkMenuItem = (label, title, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", () => fn(b, label));
      return b;
    };
    const copyLogItem = mkMenuItem("Copy log", "Copy the full import log (incl. the raw source data)", (b, l) => bar._copy?.log(b, l));
    const copyNoJsonItem = mkMenuItem("Copy without JSON", "Copy the log without the raw source-data block \u2014 fits in a GitHub issue", (b, l) => bar._copy?.noJson(b, l));
    logMenu.append(copyLogItem, copyNoJsonItem);
    if (discogsUrl) logMenu.appendChild(mkMenuItem("Copy Discogs", "Copy the raw Discogs JSON for this release", (b, l) => bar._copy?.discogs(b, l)));
    if (sources.tidal) logMenu.appendChild(mkMenuItem("Copy Tidal", "Copy the raw Tidal credits harvest for this release", (b, l) => bar._copy?.tidal(b, l)));
    if (sources.qobuz) logMenu.appendChild(mkMenuItem("Copy Qobuz", "Copy the parsed Qobuz credits for this release", (b, l) => bar._copy?.qobuz(b, l)));
    if (sources.deezer) logMenu.appendChild(mkMenuItem("Copy Deezer", "Copy the parsed Deezer credits for this release", (b, l) => bar._copy?.deezer(b, l)));
    if (sources.apple) logMenu.appendChild(mkMenuItem("Copy Apple", "Copy the parsed Apple credits for this release", (b, l) => bar._copy?.apple(b, l)));
    if (sources.ytmusic) logMenu.appendChild(mkMenuItem("Copy YouTube Music", "Copy the fetched YouTube Music credits for this release", (b, l) => bar._copy?.ytmusic(b, l)));
    if (importSources.length > 1) logMenu.appendChild(mkMenuItem("Copy all", 'Copy the combined JSON of an "Import all" run \u2014 every source plus the merged, de-duplicated result (#408)', (b, l) => bar._copy?.all(b, l)));
    document.body.appendChild(logMenu);
    function openLogMenu() {
      const open = logMenu.classList.toggle("open");
      if (!open) return;
      const r = logSplit.getBoundingClientRect();
      logMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - logMenu.offsetWidth - 8)) + "px";
      logMenu.style.top = r.bottom + 4 + "px";
      const off = (ev) => {
        if (!logMenu.contains(ev.target) && !logSplit.contains(ev.target)) {
          logMenu.classList.remove("open");
          document.removeEventListener("mousedown", off);
        }
      };
      setTimeout(() => document.addEventListener("mousedown", off), 0);
    }
    logToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      logMenu.classList.remove("open");
      setLogOpen(!outputDiv.classList.contains("log-open"));
    });
    logCaretBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openLogMenu();
    });
    function openLog(filter, scrollSel) {
      const f = filter || "all";
      outputDiv.classList.add("log-open");
      logSplit.classList.add("active");
      outputDiv.dataset.logfilter = f;
      logFilter.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x.dataset.f === f));
      requestAnimationFrame(() => {
        const target = scrollSel && logBody.querySelector(scrollSel) || logPanel;
        const headerH = bar.classList.contains("is-pinned") ? row1.getBoundingClientRect().height + 6 : 0;
        const top = target.getBoundingClientRect().top + window.scrollY - headerH - 10;
        window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      });
    }
    warnPill.addEventListener("click", () => openLog("warn", 'li[data-sev="warn"]'));
    errPill.addEventListener("click", () => openLog("error", 'li[data-sev="error"]'));
    unresolvedPill.addEventListener("click", () => openLog("all", 'li[data-sev="skip"]'));
    onLogCounts((w, e) => {
      warnPill.textContent = `\u26A0 ${w}`;
      warnPill.style.display = w > 0 ? "" : "none";
      errPill.textContent = `\u26D4 ${e}`;
      errPill.style.display = e > 0 ? "" : "none";
    });
    bar._setUnresolved = (n) => {
      unresolvedPill.textContent = `\u2298 ${n} unresolved`;
      unresolvedPill.style.display = n > 0 ? "" : "none";
    };
    bar._setStopMessage = (msg) => {
      bar._stopActive = !!msg;
      statusEl.textContent = msg || "";
      statusEl.style.display = msg ? "" : "none";
      statusEl.classList.toggle("discogs-bar-status-final", !!msg);
    };
    function cancelRun() {
      bar._runToken++;
      importing = false;
      if (typeof bar._reviewAbort === "function") {
        const abort = bar._reviewAbort;
        bar._reviewAbort = null;
        abort();
      }
      srcButtons.forEach((b) => {
        b.classList.remove("importing");
        b.style.display = "";
        b.title = b._restoreTitle || b.title;
      });
      progressPct.style.display = "none";
      progressPct.textContent = "0%";
      bar.classList.remove("is-importing", "is-reviewing", "is-pinned");
      _hideBar();
      reviewSlot.replaceChildren();
      actionSlot.replaceChildren();
      setReviewContainer(reviewSlot);
      bar._hideEnterEdit();
      bar._setStopMessage("Import cancelled \u2014 pick a source to start again.");
      bar._pin();
      delete bar._setProgress;
    }
    function startImport(srcBtn, sourceUrl, runner, sourceLabel) {
      const myToken = ++bar._runToken;
      const cancelled = () => bar._runToken !== myToken;
      importing = true;
      srcButtons.forEach((b) => {
        const active = b === srcBtn;
        b.classList.toggle("importing", active);
        b.style.display = active ? "" : "none";
        if (active) {
          b._restoreTitle = b.title;
          b.title = `Cancel this ${srcBtn.dataset.src} import and return to the source picker`;
        }
      });
      progressPct.style.display = "inline";
      progressPct.textContent = "0%";
      bar._hideEnterEdit();
      bar.classList.add("is-importing", "is-pinned");
      bar._pin();
      _showBar();
      bar.scrollIntoView({ behavior: "smooth", block: "start" });
      bar._showProgress = () => {
        _showBar();
      };
      requestAnimationFrame(bar._showProgress);
      resetLogCounts();
      bar._setUnresolved(0);
      bar._setStopMessage("");
      _logs2 = document.createElement("ul");
      _logs2.className = "logs";
      setLogContainer(_logs2);
      _summary = document.createElement("p");
      _summary.className = "summary";
      logBody.innerHTML = "";
      logBody.appendChild(_summary);
      logBody.appendChild(_logs2);
      outputDiv.classList.remove("empty");
      logSplit.style.display = "";
      try {
        applyLogOpen();
      } catch (e) {
      }
      function buildCopyText({ skipDiscogsJson }) {
        function htmlToMd(el) {
          function nodeToMd(node) {
            if (node.nodeType === Node.TEXT_NODE) return node.textContent;
            const tag = node.tagName?.toLowerCase();
            const inner = [...node.childNodes].map(nodeToMd).join("");
            if (tag === "strong" || tag === "b") return `**${inner}**`;
            if (tag === "em" || tag === "i") return `_${inner}_`;
            if (tag === "a") return `[${inner}](${node.href})`;
            if (tag === "br") return "\n";
            if (tag === "pre") {
              return "\n```json\n" + node.textContent + "\n```\n";
            }
            if (tag === "details") {
              const sum = node.querySelector("summary");
              const sumText = sum ? [...sum.childNodes].map((n) => {
                if (n.nodeType === Node.TEXT_NODE) return n.textContent;
                const t = n.tagName?.toLowerCase();
                if (t === "button" || t === "input") return "";
                return n.textContent;
              }).join("").trim() : "";
              if (skipDiscogsJson && /raw Discogs JSON/i.test(sumText)) {
                return "";
              }
              const body = [...node.childNodes].filter((n) => n !== sum).map(nodeToMd).join("");
              return "\n\n<details><summary>" + sumText + "</summary>\n\n" + body + "\n</details>\n\n";
            }
            if (tag === "summary") return "";
            if (tag === "span") return inner;
            if (tag === "div") return inner + "\n";
            if (tag === "ul") return inner;
            if (tag === "li" && el !== node) return "- " + inner + "\n";
            if (tag === "table") {
              const rows = [...node.querySelectorAll("tr")];
              if (!rows.length) return "";
              const cells = rows.map((r) => [...r.querySelectorAll("th,td")].map((c) => c.innerText.trim().replace(/\|/g, "\\|")));
              const widths = cells[0]?.map((_, i) => Math.max(...cells.map((r) => (r[i] || "").length), 3));
              const pad = (s, w) => s + " ".repeat(Math.max(0, w - s.length));
              const mdRows = cells.map((row) => "| " + row.map((c, i) => pad(c, widths[i])).join(" | ") + " |");
              if (mdRows.length > 1) mdRows.splice(1, 0, "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |");
              return "\n\n" + mdRows.join("\n") + "\n\n";
            }
            return inner;
          }
          const _md = nodeToMd(el);
          return _md.startsWith("\n\n") || _md.endsWith("\n\n") ? _md : _md.replace(/^\n/, "").replace(/\n$/, "");
        }
        const _panel = document.querySelector(".discogs-review-slot .discogs-review-panel-li");
        const lines = [..._panel ? [_panel] : [], ..._logs2.querySelectorAll("li")].map((li) => {
          if (li.classList?.contains("discogs-review-panel-li") && typeof li._buildStaticTableLi === "function") {
            return htmlToMd(li._buildStaticTableLi());
          }
          const md = htmlToMd(li);
          if (!md) return "";
          if (md.startsWith("\n\n|") || md.startsWith("<details>")) return md;
          return md + "  ";
        }).filter(Boolean).join("\n");
        const releaseName = pageWindow?.MB?.relationshipEditor?.state?.entity?.name || document.title.replace(/ - MusicBrainz.*/, "").trim() || "Import log";
        return `<details><summary>${releaseName}</summary>

${lines}

</details>`;
      }
      function copyToClipboard(text, btn, restoreText) {
        const restore = () => {
          btn.textContent = "Copied!";
          setTimeout(() => {
            btn.textContent = restoreText;
          }, 1500);
        };
        const fallback = () => {
          const ta = Object.assign(document.createElement("textarea"), { value: text });
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          restore();
        };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(restore, fallback);
        } else {
          fallback();
        }
      }
      bar._copy = {
        log: (item, label) => copyToClipboard(buildCopyText({ skipDiscogsJson: false }), item, label),
        noJson: (item, label) => copyToClipboard(buildCopyText({ skipDiscogsJson: true }), item, label),
        discogs: (item, label) => {
          if (_discogsJson) copyToClipboard(JSON.stringify(_discogsJson, null, 2), item, label);
        },
        tidal: (item, label) => {
          if (_tidalJson) copyToClipboard(JSON.stringify(_tidalJson, null, 2), item, label);
        },
        qobuz: (item, label) => {
          if (_qobuzJson) copyToClipboard(JSON.stringify(_qobuzJson, null, 2), item, label);
        },
        deezer: (item, label) => {
          if (_deezerJson) copyToClipboard(JSON.stringify(_deezerJson, null, 2), item, label);
        },
        apple: (item, label) => {
          if (_appleJson) copyToClipboard(JSON.stringify(_appleJson, null, 2), item, label);
        },
        // #435
        ytmusic: (item, label) => {
          if (_ytmJson) copyToClipboard(JSON.stringify(_ytmJson, null, 2), item, label);
        },
        // #648
        all: (item, label) => {
          if (_consolidatedJson) copyToClipboard(JSON.stringify(_consolidatedJson, null, 2), item, label);
        }
        // #408
      };
      bar._setProgress = (pct, text) => {
        if (pct !== null && pct >= 100) _hideBar();
        if (text && bar.classList.contains("is-importing") && !bar._stopActive) {
          statusEl.textContent = text;
          statusEl.style.display = "";
        }
      };
      requestAnimationFrame(_showBar);
      const getOpts = () => ({
        processTracklist: tracklistCb.checked,
        applyToTracks: applyTracksCb.checked,
        // #424: "Use works" off → dispatch sees mode 'off' and touches no work rels
        createWorksMode: useWorksCb.checked ? createWorksMode.value : "off",
        dedupeEquivalenceSets: dedupeEqCb.checked,
        dedupeDuplicateRoles: dedupeDupCb.checked,
        coCredit: coCreditCb.checked
        // #613 co-credit search (on by default)
      });
      const _click = getOpts();
      const opts = `per-track:${_click.processTracklist ? "on" : "off"}, move-to-tracks:${_click.applyToTracks ? "on" : "off"}, create-works:${_click.createWorksMode}`;
      const editNote = buildEditNote(sourceUrl, opts, void 0, sourceLabel);
      editNote.split("\n").forEach((line) => {
        if (!line.trim()) return;
        const html = line.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer nofollow">$1</a>');
        log.info(html);
      });
      runner(getOpts, cancelled).finally(() => {
        if (cancelled()) {
          delete bar._setProgress;
          return;
        }
        importing = false;
        srcButtons.forEach((b) => {
          b.classList.remove("importing");
          b.style.display = "";
          b.title = b._restoreTitle || b.title;
        });
        progressPct.textContent = "100%";
        setTimeout(() => {
          progressPct.style.display = "none";
        }, 2e3);
        bar.classList.remove("is-reviewing");
        setTimeout(() => {
          bar.classList.remove("is-importing");
          _hideBar();
          bar._showEnterEdit();
          bar._pin();
        }, 2e3);
        delete bar._setProgress;
      });
    }
    bar.appendChild(outputDiv);
    function insertBar() {
      const anchor = document.querySelector(".release-rel-editor") || // MB React wrapper
      document.querySelector("#content > div") || // generic first content div
      document.querySelector("#content");
      if (!anchor) return setTimeout(insertBar, 300);
      anchor.insertBefore(bar, anchor.firstChild);
    }
    insertBar();
    (function watchSubmit() {
      const findMsg = () => [...document.querySelectorAll(".loading-message, .submitting")].find((el) => /submit/i.test(el.textContent || ""));
      const set = (on) => {
        if (!!bar._saving === on) return;
        bar._saving = on;
        bar.classList.toggle("is-saving", on);
        if (on) {
          bar.classList.add("is-pinned");
          bar._pin?.();
          _showBar();
          bar._setStopMessage("\u23F3 Submitting edits to MusicBrainz\u2026");
        } else bar._setStopMessage("");
      };
      const obs = new MutationObserver(() => set(!!findMsg()));
      obs.observe(document.body, { childList: true, subtree: true });
      set(!!findMsg());
    })();
  }
  (function pruneLocalStorage() {
    try {
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      if (localStorage.getItem("ch:ls-pruned") === today) return;
      localStorage.setItem("ch:ls-pruned", today);
      const cutoff = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.startsWith("discogs-release-")) drop.push(k);
        else if (k.startsWith("discogs-urlcheck-")) {
          let date = null;
          try {
            date = JSON.parse(localStorage.getItem(k)).date;
          } catch (e) {
          }
          if (!date || date < cutoff) drop.push(k);
        }
      }
      drop.forEach((k) => localStorage.removeItem(k));
      if (drop.length) logDebug(`localStorage prune: removed ${drop.length} expired URL-check entr${drop.length === 1 ? "y" : "ies"}`);
    } catch (e) {
    }
  })();
  function runImport(discogsUrl, getOpts, cancelled, collect) {
    const initial = getOpts();
    const { processTracklist } = initial;
    return getDiscogsReleaseData(discogsUrl).then((json) => {
      _discogsJson = json;
      let artistRoles = rolesFromDiscogsArtists(json.extraartists?.filter((artist) => !artist.tracks));
      if (!_logs2._releaseInfoAdded) {
        _logs2._releaseInfoAdded = true;
        const trackCount = flattenTracklist(json.tracklist).filter((t) => t.type_ === "track").length;
        const summary = `${json.title || ""}${json.year ? " \xB7 " + json.year : ""} \xB7 ${trackCount} tracks`;
        const li = document.createElement("li");
        const pre = document.createElement("pre");
        pre.style.cssText = "max-height:400px;overflow:auto;font-size:0.72rem;background:var(--mbu-bg-raised);padding:0.5rem;border:1px solid var(--mbu-border);border-radius:3px;margin:0.3rem 0 0 0;white-space:pre-wrap;word-break:break-all;";
        pre.textContent = JSON.stringify(json, null, 2);
        li.innerHTML = `<details><summary style="cursor:pointer;user-select:none;"><strong>${summary} \u2014 raw Discogs JSON</strong></summary></details>`;
        li.querySelector("details").appendChild(pre);
        _logs2.appendChild(li);
      }
      log.info(`Found ${json.companies.length + artistRoles.length} release relationships`);
      artistRoles = artistRoles.concat(convertPotentialDJMixers(json));
      let tracklistRels = [];
      if (processTracklist) {
        tracklistRels = flattenTracklist(json.tracklist).filter((track) => track.type_ === "track").reduce((map, track) => {
          if (!track.extraartists || !Array.isArray(track.extraartists)) {
            return map;
          }
          return map.concat(
            rolesFromDiscogsArtists(track.extraartists).map((rel) => {
              return Object.assign({}, rel, {
                track
              });
            })
          );
        }, []);
        const releaseLevelTracklistRels = json.extraartists?.filter((artist) => artist.tracks && artist.tracks !== "") || [];
        if (releaseLevelTracklistRels.length > 0) {
          tracklistRels = tracklistRels.concat(
            releaseLevelTracklistRels.reduce((array, artist) => {
              return array.concat(
                getAllArtistTracks(json.tracklist, artist.tracks).reduce((array2, track) => {
                  return array2.concat(
                    getArtistRoles(artist).map((rel) => {
                      return Object.assign({}, rel, {
                        artist,
                        track
                      });
                    })
                  );
                }, [])
              );
            }, [])
          );
        }
        log.info(`Found ${tracklistRels.length} tracklist relationships`);
      }
      const parts = { companies: json.companies, artistRoles, tracklistRels, tracklist: json.tracklist, sourceUrl: discogsUrl, processTracklist };
      return collect ? parts : runSourcePipeline({ ...parts, getOpts, cancelled });
    });
  }
  function runTidalImport(tidalUrl, getOpts, cancelled, collect) {
    log.info(`Opening the Tidal credits tab \u2014 it closes itself once harvested (a few seconds)\u2026`);
    return harvestTidalAlbum(tidalUrl).then((harvest) => {
      _tidalJson = harvest;
      if (!harvest.ok) throw new Error(`Tidal harvest failed: ${harvest.error || "unknown error"}`);
      const li = document.createElement("li");
      const pre = document.createElement("pre");
      pre.style.cssText = "max-height:400px;overflow:auto;font-size:0.72rem;background:var(--mbu-bg-raised);padding:0.5rem;border:1px solid var(--mbu-border);border-radius:3px;margin:0.3rem 0 0 0;white-space:pre-wrap;word-break:break-all;";
      pre.textContent = JSON.stringify(harvest, null, 2);
      li.innerHTML = `<details><summary style="cursor:pointer;user-select:none;"><strong>${harvest.tracks.length} tracks \u2014 raw Tidal harvest</strong></summary></details>`;
      li.querySelector("details").appendChild(pre);
      _logs2.appendChild(li);
      const processTracklist = !!getOpts().processTracklist;
      const { tracklistRels: ptRels, tracklist, skipped, multiVolume } = tidalToEngine(harvest.tracks);
      const tracklistRels = processTracklist ? ptRels : [];
      const { artists: relArtists, publishers: relPublishers, companies: relCompanies, skipped: relSkipped } = tidalReleaseArtists(harvest.releaseCredits);
      const artistRoles = [...relPublishers];
      for (const a of relArtists) {
        const roles = getArtistRoles(a);
        if (!roles.length) {
          relSkipped.push(`release: ${a.tidalRole} \u2014 ${a.name}`);
          continue;
        }
        if (a.assistant) roles.forEach((r) => {
          r.attributes = (r.attributes || []).concat("assistant");
        });
        artistRoles.push(...roles);
      }
      const companies = relCompanies || [];
      log.info(`Tidal credits: ${tracklistRels.length} per-track + ${artistRoles.length} release-level relationship(s)${companies.length ? ` + ${companies.length} label/company` : ""} across ${tracklist.length} track(s)`);
      if (!processTracklist) log.info(`Per-track credits disabled \u2014 importing release-level credits only${getOpts().applyToTracks ? " (applied to tracks)" : ""}.`);
      (processTracklist ? skipped.concat(relSkipped) : relSkipped).forEach((s) => log.info(`Not imported (v1 scope): ${s}`));
      if (multiVolume) log.warn(`Multi-volume Tidal album \u2014 track numbers repeat per volume; positions may not all match this release's mediums. Review carefully.`);
      if (!tracklistRels.length && !artistRoles.length && !companies.length) {
        log.warn("No importable credits found on the Tidal credits page.");
        stopMsg(collect, "No importable credits found");
        return;
      }
      const parts = { companies, artistRoles, tracklistRels, tracklist, sourceUrl: tidalUrl, processTracklist };
      return collect ? parts : runSourcePipeline({ ...parts, getOpts, cancelled });
    }).catch((err) => {
      log.error(err.message || String(err));
    });
  }
  function runMetalArchivesImport(maUrl, getOpts, cancelled, collect) {
    log.info(`Opening the Metal Archives tab \u2014 it closes itself once harvested (a few seconds)\u2026`);
    return harvestMetalArchivesAlbum(maUrl).then((harvest) => {
      _maJson = harvest;
      if (!harvest.ok) throw new Error(`Metal Archives harvest failed: ${harvest.error || "unknown error"}`);
      const li = document.createElement("li");
      const pre = document.createElement("pre");
      pre.style.cssText = "max-height:400px;overflow:auto;font-size:0.72rem;background:var(--mbu-bg-raised);padding:0.5rem;border:1px solid var(--mbu-border);border-radius:3px;margin:0.3rem 0 0 0;white-space:pre-wrap;word-break:break-all;";
      pre.textContent = JSON.stringify(harvest, null, 2);
      const nCredited = (harvest.band?.length || 0) + (harvest.guest?.length || 0) + (harvest.misc?.length || 0);
      li.innerHTML = `<details><summary style="cursor:pointer;user-select:none;"><strong>${(harvest.tracks || []).length} tracks, ${nCredited} credited \u2014 raw Metal Archives harvest</strong></summary></details>`;
      li.querySelector("details").appendChild(pre);
      _logs2.appendChild(li);
      const processTracklist = !!getOpts().processTracklist;
      const { tracklistRels: ptRels, tracklist, skipped, multiVolume } = metalArchivesToEngine(harvest);
      const tracklistRels = processTracklist ? ptRels : [];
      const { artists: relArtists, skipped: relSkipped } = metalArchivesReleaseArtists(harvest);
      const artistRoles = [];
      for (const a of relArtists) {
        const roles = getArtistRoles(a);
        if (!roles.length) {
          relSkipped.push(`release: ${a.maRole} \u2014 ${a.name}`);
          continue;
        }
        if (a.maAttrs && a.maAttrs.length) roles.forEach((r) => {
          r.attributes = (r.attributes || []).concat(a.maAttrs);
        });
        artistRoles.push(...roles);
      }
      const companies = [];
      log.info(`Metal Archives: ${tracklistRels.length} per-track + ${artistRoles.length} release-level relationship(s) across ${tracklist.length} track(s)`);
      if (!processTracklist) log.info(`Per-track credits disabled \u2014 importing release-level credits only${getOpts().applyToTracks ? " (applied to tracks)" : ""}.`);
      (processTracklist ? skipped.concat(relSkipped) : relSkipped).forEach((s) => log.info(`Not imported: ${s}`));
      if (harvest.multiBand) log.warn(`Multi-artist release (${harvest.type}) \u2014 split/collaboration credits may need per-band track scoping; review carefully.`);
      if (multiVolume) log.warn(`Multi-disc release \u2014 positions are "disc-track"; verify they line up with this release's mediums.`);
      if (!tracklistRels.length && !artistRoles.length) {
        log.warn("No importable credits found on the Metal Archives page.");
        stopMsg(collect, "No importable credits found");
        return;
      }
      const parts = { companies, artistRoles, tracklistRels, tracklist, sourceUrl: maUrl, processTracklist };
      return collect ? parts : runSourcePipeline({ ...parts, getOpts, cancelled });
    }).catch((err) => {
      log.error(err.message || String(err));
    });
  }
  function runQobuzImport(qobuzUrl, getOpts, cancelled, collect) {
    const parsed = parseQobuzAlbumUrl(qobuzUrl);
    if (!parsed) {
      log.error(`Not a Qobuz album URL: ${qobuzUrl}`);
      return Promise.resolve();
    }
    const finish = (via, albumInfo, tracks) => {
      _qobuzJson = { via, source: via === "API" ? `album/get (${parsed.id})` : parsed.pageUrl, album: albumInfo, tracks };
      const li = document.createElement("li");
      const pre = document.createElement("pre");
      pre.style.cssText = "max-height:400px;overflow:auto;font-size:0.72rem;background:var(--mbu-bg-raised);padding:0.5rem;border:1px solid var(--mbu-border);border-radius:3px;margin:0.3rem 0 0 0;white-space:pre-wrap;word-break:break-all;";
      pre.textContent = JSON.stringify(_qobuzJson, null, 2);
      li.innerHTML = `<details><summary style="cursor:pointer;user-select:none;"><strong>${albumInfo || "Qobuz album"} \xB7 ${tracks.length} tracks \u2014 parsed Qobuz credits (${via === "API" ? "API" : "page"})</strong></summary></details>`;
      li.querySelector("details").appendChild(pre);
      _logs2.appendChild(li);
      if (!tracks.length) {
        log.warn("No Qobuz credits found \u2014 nothing to import.");
        stopMsg(collect, "No importable credits found");
        return;
      }
      const { tracklistRels, artistRoles, tracklist, skipped, multiVolume } = qobuzToEngine(tracks);
      log.info(`Qobuz credits: ${tracklistRels.length} per-track relationship(s)${artistRoles.length ? ` + ${artistRoles.length} release-level relationship(s)` : ""} across ${tracklist.length} track(s)`);
      skipped.forEach((s) => log.info(`Not imported (v1 scope): ${s}`));
      if (multiVolume) log.warn(`Multi-medium Qobuz album \u2014 track numbers repeat per medium; positions may not all match this release's mediums. Review carefully.`);
      if (!tracklistRels.length && !artistRoles.length) {
        log.warn("No importable Qobuz credits found.");
        stopMsg(collect, "No importable credits found");
        return;
      }
      const parts = { companies: [], artistRoles, tracklistRels, tracklist, sourceUrl: qobuzUrl, processTracklist: true };
      return collect ? parts : runSourcePipeline({ ...parts, getOpts, cancelled });
    };
    const scrape = () => {
      log.info(`Fetching Qobuz store page: ${parsed.pageUrl}`);
      return fetchQobuzAlbumPage(parsed.pageUrl).then((html) => finish("page", extractQobuzAlbumInfo(html), extractQobuzCredits(html))).catch((err) => {
        log.error(err.message || String(err));
      });
    };
    const token = qobuzToken();
    if (token) {
      log.info(`Fetching Qobuz credits via album/get (signed in): album ${parsed.id}`);
      return fetchQobuzApiAlbum(parsed.id, token).then((json) => finish("API", qobuzApiAlbumInfo(json), parseQobuzApiTracks(json))).catch((err) => {
        log.warn(`Qobuz API failed (${err.message || err}) \u2014 falling back to the store page`);
        return scrape();
      });
    }
    return scrape();
  }
  function runDeezerImport(deezerUrl, getOpts, cancelled, collect) {
    const parsed = parseDeezerAlbumUrl(deezerUrl);
    if (!parsed) {
      log.error(`Not a Deezer album URL: ${deezerUrl}`);
      return Promise.resolve();
    }
    log.info(`Fetching Deezer album page: ${parsed.pageUrl}`);
    return fetchDeezerAlbumPage(parsed.pageUrl).then((html) => {
      const albumInfo = extractDeezerAlbumInfo(html);
      const tracks = extractDeezerCredits(html);
      _deezerJson = { source: parsed.pageUrl, album: albumInfo, tracks };
      const li = document.createElement("li");
      const pre = document.createElement("pre");
      pre.style.cssText = "max-height:400px;overflow:auto;font-size:0.72rem;background:var(--mbu-bg-raised);padding:0.5rem;border:1px solid var(--mbu-border);border-radius:3px;margin:0.3rem 0 0 0;white-space:pre-wrap;word-break:break-all;";
      pre.textContent = JSON.stringify(_deezerJson, null, 2);
      li.innerHTML = `<details><summary style="cursor:pointer;user-select:none;"><strong>${albumInfo || "Deezer album"} \xB7 ${tracks.length} tracks \u2014 parsed Deezer credits (page)</strong></summary></details>`;
      li.querySelector("details").appendChild(pre);
      _logs2.appendChild(li);
      if (!tracks.length) {
        log.warn("No Deezer credits found \u2014 nothing to import.");
        stopMsg(collect, "No importable credits found");
        return;
      }
      const { tracklistRels, tracklist, skipped, multiVolume } = deezerToEngine(tracks);
      log.info(`Deezer credits: ${tracklistRels.length} per-track relationship(s) across ${tracklist.length} track(s)`);
      skipped.forEach((s) => log.info(`Not imported (v1 scope): ${s}`));
      if (multiVolume) log.warn(`Multi-medium Deezer album \u2014 track numbers repeat per medium; positions may not all match this release's mediums. Review carefully.`);
      if (!tracklistRels.length) {
        log.warn("No importable Deezer credits found.");
        stopMsg(collect, "No importable credits found");
        return;
      }
      const parts = { companies: [], artistRoles: [], tracklistRels, tracklist, sourceUrl: deezerUrl, processTracklist: true };
      return collect ? parts : runSourcePipeline({ ...parts, getOpts, cancelled });
    }).catch((err) => {
      log.error(err.message || String(err));
    });
  }

  function toolboxAppleNormalized(s) {
    return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
      .replace(/\s*[([]\s*(?:feat(?:uring)?|ft)\.?\s+[^\])]+[)\]]/gi,"")
      .toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
  }
  function toolboxAppleUpc(value) {
    return String(value || "").replace(/\D/g,"").replace(/^0+/,"") || "0";
  }
  async function toolboxAppleMbRelease() {
    const mbid = location.pathname.match(/\/release\/([a-f0-9-]{36})\/edit-relationships/i)?.[1];
    if (!mbid) throw Error("MusicBrainz release not found.");
    const response = await __mbToolBoxFetch("/ws/2/release/" + mbid + "?inc=recordings&fmt=json",
      {headers:{Accept:"application/json"}});
    if (!response.ok) throw Error("MusicBrainz release lookup failed: HTTP " + response.status);
    return response.json();
  }
  async function toolboxAppleAlbumFromBarcode(link,release) {
    const barcode = String(release.barcode || "").replace(/\D/g,"");
    if (link) {
      const parsed = parseAppleAlbumUrl(link);
      if (parsed) {
        try {
          const token = await appleToken();
          const r = await appleGet(APPLE_AMP + "/" + parsed.storefront + "/albums/" + parsed.id + "?l=en-US",ampHeaders(token));
          if (r.status === 200) {
            const album = JSON.parse(r.text).data?.[0];
            const upc = String(album?.attributes?.upc || "").replace(/\D/g,"");
            if (album && (!barcode || (upc && toolboxAppleUpc(upc) === toolboxAppleUpc(barcode)))) {
              return {url:link,...parsed};
            }
            log.warn("The linked Apple Music album UPC differs from MusicBrainz; searching by exact barcode.");
          }
        } catch(error) {log.warn("Apple Music linked album verification failed: "+error.message);}
      }
    }
    if (!barcode) throw Error("No verified Apple Music link or MusicBrainz barcode; enter a song URL.");
    const token = await appleToken();
    for (const sf of ["us","gb","de","fr","ua","jp"]) {
      try {
        const r = await appleGet(APPLE_AMP + "/" + sf +
          "/albums?filter%5Bupc%5D=" + encodeURIComponent(barcode) + "&limit=25",ampHeaders(token));
        if (r.status !== 200) continue;
        const albums = JSON.parse(r.text).data || [];
        const match = albums.find(a =>
          a.attributes?.upc && toolboxAppleUpc(a.attributes.upc) === toolboxAppleUpc(barcode));
        if (match) return {
          url:match.attributes?.url || ("https://music.apple.com/"+sf+"/album/id"+match.id),
          storefront:sf,id:String(match.id)
        };
      } catch(error) {log.warn("Apple "+sf+" UPC search: "+error.message);}
    }
    throw Error("No Apple Music album verified against MusicBrainz barcode "+barcode+".");
  }
  async function toolboxAppleOneSong(rawUrl,release) {
    let url;
    try {url = new URL(rawUrl);}catch {throw Error("Invalid Apple Music song URL.");}
    const match = url.pathname.match(/^\/(?:([a-z]{2})\/)?song\/(?:[^/]+\/)?(\d+)\/?$/i);
    if (url.hostname !== "music.apple.com" || !match) throw Error("Enter a music.apple.com song URL.");
    const sf = (match[1] || "us").toLowerCase(),sid = match[2];
    const token = await appleToken(), base = APPLE_AMP+"/"+sf+"/songs/"+sid;
    const r = await appleGet(base+"?l=en-US",ampHeaders(token));
    if (r.status !== 200) throw Error("Apple song metadata: HTTP "+r.status);
    const song = JSON.parse(r.text).data?.[0];
    if (!song?.attributes?.name || String(song.id) !== sid) throw Error("Apple song identity was not confirmed.");
    const title = song.attributes.name, matches = [];
    for (const medium of release.media || []) {
      for (const track of medium.tracks || []) {
        if (toolboxAppleNormalized(track.title) === toolboxAppleNormalized(title)) {
          matches.push({medium,track});
        }
      }
    }
    let selected = matches.length === 1 ? matches[0] : null;
    if (!selected && matches.length > 1) {
      const slot = matches.filter(m => Number(m.medium.position) === Number(song.attributes.discNumber || 1) &&
        Number(m.track.position) === Number(song.attributes.trackNumber || 1));
      if (slot.length === 1) selected = slot[0];
    }
    if (!selected) throw Error('Apple song "'+title+'" does not uniquely match a MusicBrainz track.');
    const cr = await appleGet(base+"/credits?l=en-US",ampHeaders(token));
    if (cr.status !== 200) throw Error("Apple song credits unavailable: HTTP "+cr.status);
    const credits = [];
    for (const group of JSON.parse(cr.text).data || []) {
      for (const person of group.relationships?.["credit-artists"]?.data || []) {
        for (const role of person.attributes?.roleNames || []) {
          if (person.attributes?.name) credits.push({name:person.attributes.name,role});
        }
      }
    }
    if (!credits.length) throw Error("No Apple credits were available for the selected song.");
    const position = release.media.length > 1
      ? selected.medium.position + "-" + selected.track.position : String(selected.track.position);
    return {album:title,tracks:[{index:Number(selected.track.position),title,credits}],
      sourceUrl:url.href,forcedPosition:position};
  }
  function runAppleImport(appleUrl, getOpts, cancelled, collect) {
    const songUrl = String(document.getElementById("toolbox-apple-song-url")?.value || "").trim();
    const request = (async () => {
      if (songUrl && !collect) {
        return toolboxAppleOneSong(songUrl,await toolboxAppleMbRelease());
      }
      if (songUrl && collect) log.warn("Import All uses the full Apple album; the song URL is Apple-only.");
      const release = await toolboxAppleMbRelease();
      const result = await toolboxAppleAlbumFromBarcode(appleUrl,release);
      log.info("Fetching verified Apple Music credits: "+result.url);
      const payload = await fetchAppleCredits(result.storefront,result.id,
        (d,n)=>document.querySelector(".discogs-bar")?._setProgress?.(null,"Apple "+d+"/"+n));
      return {...payload,sourceUrl:result.url};
    })();
    return request.then(({album,tracks,sourceUrl,forcedPosition}) => {
      _appleJson = {source:sourceUrl,album,tracks};
      const li = document.createElement("li"),pre = document.createElement("pre");
      pre.style.cssText = "max-height:400px;overflow:auto;font-size:0.72rem;white-space:pre-wrap;word-break:break-all;";
      pre.textContent = JSON.stringify(_appleJson,null,2);
      li.innerHTML = '<details><summary>Apple Music - '+tracks.length+' track(s) - raw credits</summary></details>';
      li.querySelector("details").appendChild(pre);
      _logs.appendChild(li);
      if (!tracks.length) {log.warn("No Apple credits found.");stopMsg(collect,"No Apple credits");return;}
      const converted = appleToEngine(tracks);
      if (forcedPosition) {
        for (const r of converted.tracklistRels) r.track.position = forcedPosition;
        for (const t of converted.tracklist) t.position = forcedPosition;
      }
      converted.skipped.forEach(x=>log.info("Unmapped Apple Music role: "+x));
      if (converted.multiVolume) log.warn("Apple multi-medium album: verify positions in review.");
      if (!converted.tracklistRels.length) {stopMsg(collect,"No importable credits");return;}
      const parts = {companies:[],artistRoles:[],tracklistRels:converted.tracklistRels,
        tracklist:converted.tracklist,sourceUrl,processTracklist:true};
      return collect ? parts : runSourcePipeline({...parts,getOpts,cancelled});
    }).catch(error=>{log.error("Apple Music importer: "+(error.message || String(error)));});
  }

  // YouTube Music import: retain the original provider pipeline.
  function editorMediumSizes() {
    try {
      const MB2 = pageWindow.MB, st = MB2?.relationshipEditor?.state;
      if (!st?.mediums || !MB2.tree?.iterate) return [];
      const sizes = [];
      for (const entry of MB2.tree.iterate(st.mediums)) {
        const medium = Array.isArray(entry) ? entry[1] : entry;
        const tracks = medium?.tracks ?? medium;
        let n = 0;
        for (const t of MB2.tree.iterate(tracks)) if (t) n++;
        sizes.push(n);
      }
      return sizes;
    } catch (e) {
      logDebug(`YouTube Music: couldn't read the release's mediums from the editor \u2014 ${e.message}`);
      return [];
    }
  }
  function runYtmImport(ytmUrl, getOpts, cancelled, collect) {
    log.info(`Fetching YouTube Music credits (anonymous): ${ytmUrl}`);
    return fetchYtmCredits(ytmUrl, (d, n) => document.querySelector(".discogs-bar")?._setProgress?.(null, `YouTube Music ${d}/${n}`)).then(({ album, list, songs }) => {
      _ytmJson = { source: ytmUrl, album, list, songs };
      const credited = songs.filter((s) => Object.keys(s.sections || {}).length).length;
      const li = document.createElement("li");
      const pre = document.createElement("pre");
      pre.style.cssText = "max-height:400px;overflow:auto;font-size:0.72rem;background:var(--mbu-bg-raised);padding:0.5rem;border:1px solid var(--mbu-border);border-radius:3px;margin:0.3rem 0 0 0;white-space:pre-wrap;word-break:break-all;";
      pre.textContent = JSON.stringify(_ytmJson, null, 2);
      li.innerHTML = `<details><summary style="cursor:pointer;user-select:none;"><strong>${album || "YouTube Music album"} \xB7 ${songs.length} songs, ${credited} with credits \u2014 YouTube Music credits (API)</strong></summary></details>`;
      li.querySelector("details").appendChild(pre);
      _logs2.appendChild(li);
      if (!credited) {
        log.warn("No YouTube Music credits found (the label sent none for this album) \u2014 nothing to import.");
        stopMsg(collect, "No importable credits found");
        return;
      }
      const sizes = editorMediumSizes();
      const { tracklistRels, tracklist, skipped, multiMedium, mismatch } = ytmToEngine(songs, sizes);
      log.info(`YouTube Music credits: ${tracklistRels.length} per-track relationship(s) across ${tracklist.length} song(s); release mediums: ${sizes.length ? sizes.join(" + ") : "unknown"}`);
      skipped.forEach((s) => log.info(`Not imported: ${s}`));
      if (mismatch) log.warn(`Multi-medium release: YouTube Music has ${songs.length} songs, the release ${sizes.reduce((a, b) => a + b, 0)} tracks (${sizes.join(" + ")}) \u2014 songs can't be placed on the right mediums. Review carefully.`);
      else if (multiMedium) log.info(`Multi-medium release: YouTube Music's straight-through numbering mapped onto ${sizes.length} mediums (${sizes.join(" + ")}).`);
      if (!tracklistRels.length) {
        log.warn("No importable YouTube Music credits found.");
        stopMsg(collect, "No importable credits found");
        return;
      }
      const parts = { companies: [], artistRoles: [], tracklistRels, tracklist, sourceUrl: ytmUrl, processTracklist: true };
      return collect ? parts : runSourcePipeline({ ...parts, getOpts, cancelled });
    }).catch((err) => {
      log.error(err.message || String(err));
    });
  }
  function buildTitlesTracklist(mbid) {
    return fetchWithRetry(`/ws/2/release/${mbid}?inc=recordings&fmt=json`).then((json) => {
      const media = json?.media || [];
      const multiMedium = media.length > 1;
      const tracklist = [];
      for (const medium of media) {
        const medPos = medium.position;
        for (const t of medium.tracks || []) {
          const pos = t.position != null ? t.position : t.number;
          tracklist.push({
            position: multiMedium && medPos != null && pos != null ? `${medPos}-${pos}` : String(pos != null ? pos : ""),
            title: t.title || t.recording?.title || "",
            type_: "track"
          });
        }
      }
      return tracklist;
    });
  }
  function probeTitleRemixes(mbid) {
    if (!mbid) return Promise.resolve({ count: 0, tracklist: [] });
    return buildTitlesTracklist(mbid).then((tracklist) => ({ count: deriveRemixRoles(tracklist).length, tracklist })).catch(() => ({ count: 0, tracklist: [] }));
  }
  function runTitlesImport(getOpts, cancelled, collect) {
    const m = location.pathname.match(/release\/([0-9a-f-]{36})/i);
    if (!m) {
      log.error("Not on a release page \u2014 cannot read track titles.");
      return Promise.resolve();
    }
    log.info("Reading track titles from MusicBrainz to derive remixer credits\u2026");
    return buildTitlesTracklist(m[1]).then((tracklist) => {
      const tracklistRels = deriveRemixRoles(tracklist, m[1]);
      log.info(`Derived <strong>${tracklistRels.length}</strong> remixer credit(s) from ${tracklist.length} track title(s)`);
      if (!tracklistRels.length) {
        log.warn("No named remixes found in the track titles \u2014 nothing to import.");
        stopMsg(collect, "No remixes found in titles");
        return;
      }
      const parts = { companies: [], artistRoles: [], tracklistRels, tracklist, sourceUrl: "", processTracklist: true };
      return collect ? parts : runSourcePipeline({ ...parts, getOpts, cancelled });
    }).catch((err) => {
      log.error(err.message || String(err));
    });
  }
  var stopMsg = (collect, msg) => {
    if (!collect) document.querySelector(".discogs-bar")?._setStopMessage?.(msg);
  };
  async function runConsolidatedImport(importSources, getOpts, cancelled) {
    const isCancelled = () => typeof cancelled === "function" && cancelled();
    log.info(`Import all: harvesting ${importSources.length} sources\u2026`);
    const harvests = [];
    for (const s of importSources) {
      if (isCancelled()) return;
      try {
        const parts = await s.run(getOpts, cancelled, true);
        const n = (parts?.artistRoles?.length || 0) + (parts?.tracklistRels?.length || 0) + (parts?.companies?.length || 0);
        if (parts && n) {
          harvests.push({ ...parts, sourceName: s.name });
          log.info(`${s.name}: ${n} credit(s) collected`);
        } else log.info(`${s.name}: no importable credits`);
      } catch (e) {
        log.warn(`${s.name} failed: ${e.message || e}`);
      }
    }
    if (isCancelled()) return;
    if (!harvests.length) {
      log.warn("Import all: no credits from any source.");
      document.querySelector(".discogs-bar")?._setStopMessage?.("No importable credits found");
      return;
    }
    const merged = mergeHarvests(harvests);
    const total = merged.artistRoles.length + merged.tracklistRels.length;
    log.info(`Import all: <strong>${total}</strong> unique credit(s) from ${harvests.length} source(s) after de-duplication.`);
    _consolidatedJson = {
      via: "consolidated",
      sources: harvests.map((h) => h.sourceName),
      discogs: _discogsJson,
      tidal: _tidalJson,
      qobuz: _qobuzJson,
      deezer: _deezerJson,
      apple: _appleJson,
      ytmusic: _ytmJson,
      merged: { companies: merged.companies, artistRoles: merged.artistRoles, tracklistRels: merged.tracklistRels }
    };
    return runSourcePipeline({
      companies: merged.companies,
      artistRoles: merged.artistRoles,
      tracklistRels: merged.tracklistRels,
      tracklist: merged.tracklist,
      sourceUrl: "",
      processTracklist: merged.tracklistRels.length > 0 || merged.processTracklist,
      getOpts,
      cancelled,
      entitySources: merged.entitySources,
      sourceLabel: `Import all (${harvests.map((h) => h.sourceName).join(", ")})`
      // #408: edit note names the real sources
    });
  }
  function runSourcePipeline({ companies, artistRoles, tracklistRels, tracklist, sourceUrl, processTracklist, getOpts, cancelled, entitySources, sourceLabel }) {
    const isCancelled = () => typeof cancelled === "function" && cancelled();
    {
      const h = hoistFullSpanArtworkRels(artistRoles, tracklistRels, tracklist);
      if (h.hoisted.length) {
        artistRoles = h.artistRoles;
        tracklistRels = h.tracklistRels;
        h.hoisted.forEach((r) => log.info(`Moved to release level (#433): ${r.linkType} \u2014 ${r.artist.name} (was on every track; artist\u2013recording artwork is for videos)`));
      }
    }
    const allArtistRoles = artistRoles.concat(tracklistRels);
    const uniqueArtists = [];
    const seenResourceUrls = /* @__PURE__ */ new Set();
    const rolesMap = /* @__PURE__ */ new Map();
    allArtistRoles.forEach((role) => {
      const url = role.artist?.resource_url || `_nourl_${role.artist?.name || role.artist?.id}`;
      if (!rolesMap.has(url)) rolesMap.set(url, []);
      let displayLabel = role.linkType;
      if (role.attributes && role.attributes.length > 0) {
        const attr = role.attributes[0];
        if (attr._type === "instrument" && attr.value) displayLabel = attr.value;
        else if (attr._type === "vocal" && attr.value) displayLabel = attr.value;
        else if (typeof attr === "string") displayLabel = `${role.linkType} [${attr}]`;
      }
      rolesMap.get(url).push({
        linkType: role.linkType,
        displayLabel,
        trackPos: role.track?.position || "",
        trackTitle: role.track?.title || ""
      });
      if (!seenResourceUrls.has(url)) {
        seenResourceUrls.add(url);
        if (!role.artist?.resource_url && role.artist) role.artist._syntheticKey = url;
        uniqueArtists.push(role.artist);
      }
    });
    const _relMbid = (location.pathname.match(/release\/([0-9a-f-]{36})/i) || [])[1];
    if (_relMbid) {
      for (const a of uniqueArtists) {
        if (a && !a.resource_url && !a._cacheKey && a.name) {
          a._cacheKey = `nameonly/${_relMbid}/${a.name.toLowerCase().trim()}`;
        }
      }
    }
    const companiesRolesMap = /* @__PURE__ */ new Map();
    companies.forEach((c) => {
      if (!c.resource_url) return;
      if (!companiesRolesMap.has(c.resource_url)) companiesRolesMap.set(c.resource_url, []);
      companiesRolesMap.get(c.resource_url).push({ linkType: c.entity_type_name || "" });
    });
    const uniqueCompanies = [];
    const seenCompanyUrls = /* @__PURE__ */ new Set();
    companies.forEach((c) => {
      if (c.resource_url && !seenCompanyUrls.has(c.resource_url) && ENTITY_TYPE_MAP[c.entity_type_name]) {
        seenCompanyUrls.add(c.resource_url);
        uniqueCompanies.push(c);
      }
    });
    function runPreflight(bypassIdb = false) {
      log.info(`Starting preflight: ${uniqueArtists.length} artist(s), ${uniqueCompanies.length} label(s)/place(s).`);
      const artistProgressLi = document.createElement("li");
      artistProgressLi.textContent = `Checking ${uniqueArtists.length} artist(s) against MusicBrainz\u2026`;
      _logs2.appendChild(artistProgressLi);
      const companyProgressLi = document.createElement("li");
      companyProgressLi.textContent = `Checking ${uniqueCompanies.length} label(s)/place(s) against MusicBrainz\u2026`;
      _logs2.appendChild(companyProgressLi);
      const t0 = performance.now();
      return (async () => {
        let context = null;
        try {
          context = await buildReleaseContext({ coCredit: !!(getOpts && getOpts().coCredit) });
        } catch (e) {
          log.warn(`Matching context unavailable: ${e.message}`);
        }
        const artistResults = await resolveAll(uniqueArtists, {
          progressLi: artistProgressLi,
          progressLabel: "Checking artists against MusicBrainz",
          kindOf: ENTITY_KIND,
          bypassIdb,
          context
        });
        const companyResults = await resolveAll(uniqueCompanies, {
          progressLi: companyProgressLi,
          progressLabel: "Checking labels/places against MusicBrainz",
          kindOf: COMPANY_KIND,
          bypassIdb
        });
        const elapsed = (performance.now() - t0) / 1e3;
        log.info(`Preflight done in ${elapsed.toFixed(1)}s.`);
        return [...artistResults.allResults, ...companyResults.allResults].filter(Boolean);
      })();
    }
    function annotateRoles(allResults) {
      allResults.forEach((r) => {
        if (!r) return;
        const url = r.entity?.resource_url || r.entity?._syntheticKey;
        if (url) r._roles = rolesMap.get(url) || companiesRolesMap.get(url) || [];
      });
    }
    let capturedResults = null;
    let capturedConfirmedMap = null;
    let _reviewMergeMap = null;
    const mergeForReview = (results) => {
      if (!entitySources) return results;
      const m = mergeResolvedResults(results, entitySources);
      _reviewMergeMap = m.mergeMap;
      return m.results;
    };
    return runPreflight().then((allResults) => {
      if (isCancelled()) return;
      annotateRoles(allResults);
      capturedResults = allResults;
      if (!allResults.length) {
        log.warn("Nothing to import \u2014 no entities to review.");
        document.querySelector(".discogs-bar")?._setStopMessage?.("Nothing to import \u2014 no entities to review");
        return;
      }
      document.querySelector(".discogs-bar")?.classList.add("is-reviewing");
      return showReviewTable(mergeForReview(capturedResults), rolesMap, companiesRolesMap, {
        // Mount the Start-import button + unresolved message in the
        // always-visible header rather than below the table (#139).
        // Resolved via the DOM (there's one bar) — `runImport` is a
        // separate function from the bar builder that owns the slot.
        headerSlot: document.querySelector(".discogs-bar-action"),
        // Label fallback for URL-less credits (#193): a Qobuz row
        // must say "No Qobuz page", not "No Discogs page". The
        // URL-less Titles source (#271) reports as 'Titles' so the
        // review table drops Discogs-specific wording/elements.
        sourceName: entitySources ? "multiple sources" : sourceUrl ? sourceNameForUrl(sourceUrl) : "Titles",
        sourceIcon: sourceUrl ? srcIconByUrl(sourceUrl) : SRC_ICON.Titles || "",
        // #193 — shown on the "Start import" button
        // #408: per-entity source provenance → the review table renders a Source column
        // (brand-icon badges). Present only on an "Import all" run.
        entitySources,
        sourceBadgeIcon: (name) => SRC_ICON[name] || "",
        // "🔄 Refresh from MB" — bypass the IDB cache and re-resolve
        // every entity via MB API. Used when a cached MBID is stale.
        onRefresh: () => runPreflight(true).then((freshResults) => {
          annotateRoles(freshResults);
          capturedResults = freshResults;
          return mergeForReview(freshResults);
        }),
        // Let `cancelRun` unblock this review promise (resolve → null)
        // so the chain unwinds cleanly instead of leaking a pending
        // promise when the user cancels mid-review.
        registerAbort: (fn) => {
          const b = document.querySelector(".discogs-bar");
          if (b) b._reviewAbort = fn;
        }
      });
    }).then((confirmedMap) => {
      const _bar = document.querySelector(".discogs-bar");
      if (_bar) _bar._reviewAbort = null;
      if (isCancelled()) return;
      if (!confirmedMap) return;
      if (_reviewMergeMap) _reviewMergeMap.forEach((members, repKey) => {
        const mb = confirmedMap.get(repKey);
        if (!mb) return;
        members.forEach((k) => {
          if (!confirmedMap.has(k)) confirmedMap.set(k, mb);
        });
      });
      if (_reviewMergeMap && confirmedMap.splits?.size) _reviewMergeMap.forEach((members, repKey) => {
        const parts = confirmedMap.splits.get(repKey);
        if (!parts) return;
        members.forEach((k) => {
          if (!confirmedMap.splits.has(k)) confirmedMap.splits.set(k, parts);
        });
      });
      capturedConfirmedMap = confirmedMap;
      document.querySelector(".discogs-bar")?.classList.remove("is-reviewing");
      document.querySelector(".discogs-bar")?._setUnresolved?.(confirmedMap.unresolvedCount || 0);
      const cachePromises = [];
      confirmedMap.forEach((mbUrl, resourceUrl) => {
        const key = parseSourceEntityUrl(resourceUrl)?.key;
        if (!key) return;
        const m = mbUrl.match(/\/(artist|label|place)\/([a-f0-9-]+)/);
        if (!m) return;
        cachePromises.push(writeIdbRecord(key, {
          mbid: m[2],
          entityType: m[1]
          // No resolvedVia change — the inline write owns it.
        }));
      });
      return Promise.all(cachePromises);
    }).then(() => {
      if (!capturedConfirmedMap) return;
      const resolvedEntityTypes = /* @__PURE__ */ new Map();
      (capturedResults || []).forEach((r) => {
        if (r.entity?.resource_url && r.mbUrl && r.entityType) {
          resolvedEntityTypes.set(r.entity.resource_url, r.entityType);
        }
      });
      const live = getOpts();
      if (live.processTracklist !== processTracklist) {
        log.warn(`"Per-track credits" toggled during review (preflight ran with "${processTracklist ? "on" : "off"}", import will follow preflight). To change, restart the import.`);
      }
      const dedupOpts = {
        dedupeEquivalenceSets: live.dedupeEquivalenceSets,
        dedupeDuplicateRoles: live.dedupeDuplicateRoles,
        creditOverrides: capturedConfirmedMap?.creditOverrides,
        sourceLabel
        // #408: consolidated runs label the edit note "Import all (…)"
      };
      return dispatchAllRelationships(companies, artistRoles, tracklistRels, live.applyToTracks, live.createWorksMode, tracklist, processTracklist, resolvedEntityTypes, capturedConfirmedMap, sourceUrl, dedupOpts);
    });
  }

  // src/credit_hoarder.user.js
  try {
    pageWindow.__creditHoarder = { resolveAll, ARTIST_KIND, buildReleaseContext, releaseArtistMbids, wantsAliasButton, submitAliasBackground, openAddAliasForm };
  } catch (e) {
  }
  if (/(^|\.)tidal\.com$/i.test(location.hostname)) {
    runTidalHarvestPage();
  }
  if (/(^|\.)metal-archives\.com$/i.test(location.hostname)) {
    runMetalArchivesHarvestPage();
  }
  (function handleCreatePageAutoCommit() {
    const onCreate = /\/(artist|label|place)\/create\b/i.test(location.pathname);
    const onEdit = /\/(artist|label|place)\/[a-f0-9-]{36}\/edit\b/i.test(location.pathname);
    if (!onCreate && !onEdit) return;
    const m = location.hash.match(/ch-autocommit(?:=([^&]+))?/);
    if (!m) return;
    if (onCreate) {
      let identity = "";
      try {
        identity = decodeURIComponent(m[1] || "");
      } catch (e) {
        identity = m[1] || "";
      }
      try {
        sessionStorage.setItem("discogs-importer-pending-artist", identity);
      } catch (e) {
      }
    } else {
      try {
        sessionStorage.setItem("discogs-importer-close-after-edit", "1");
      } catch (e) {
      }
    }
    const et = (location.pathname.match(/\/(artist|label|place)\//) || [])[1] || "artist";
    const seedUrl = new URLSearchParams(location.search).get(`edit-${et}.url.0.text`) || "";
    const seedKey = seedUrl ? seedUrl.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").toLowerCase() : "";
    let tries = 0;
    const submit = () => {
      const seedReady = !seedKey || document.body.innerHTML.toLowerCase().includes(seedKey);
      const btn = document.querySelector("button.submit.positive") || [...document.querySelectorAll('button[type="submit"]')].find((b) => /enter edit/i.test(b.textContent || ""));
      if (seedReady && btn && !btn.disabled) {
        btn.click();
        return;
      }
      if (tries++ < 100) setTimeout(submit, 200);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", submit);
    else submit();
  })();
  (function handleEntityPageIfNeeded() {
    const entityMatch = location.href.match(
      /musicbrainz\.org\/(artist|label|place)\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:[^/]|$)/i
    );
    if (!entityMatch) return;
    const entityType = entityMatch[1];
    const mbid = entityMatch[2];
    try {
      if (sessionStorage.getItem("discogs-importer-close-after-edit")) {
        sessionStorage.removeItem("discogs-importer-close-after-edit");
        try {
          DISCOGS_CHANNEL.postMessage({ type: "edit-committed", id: mbid });
        } catch (e) {
        }
        setTimeout(() => window.close(), 50);
        return;
      }
    } catch (e) {
    }
    const pendingKey = "discogs-importer-pending-artist";
    const pending = sessionStorage.getItem(pendingKey);
    if (!pending) return;
    sessionStorage.removeItem(pendingKey);
    const NAME_FETCH_TIMEOUT_MS = 1e3;
    const CLOSE_DELAY_MS = 50;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), NAME_FETCH_TIMEOUT_MS);
    mbnFetch(`${MB}/ws/2/${entityType}/${mbid}?fmt=json`, { signal: ctrl.signal }, { background: false }).then((r) => r.json()).then((json) => ({ name: json.name || "", disambiguation: json.disambiguation || "" })).catch(() => ({ name: "", disambiguation: "" })).then(({ name, disambiguation }) => {
      clearTimeout(timer);
      DISCOGS_CHANNEL.postMessage({
        type: "artist-created",
        // keep same message type for compatibility
        id: mbid,
        name,
        disambiguation,
        resourceUrl: pending
      });
      setTimeout(() => window.close(), CLOSE_DELAY_MS);
    });
  })();
  var T0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  var since = () => Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - T0);
  if (/musicbrainz\.org$/i.test(location.hostname)) (function() {
    const re = /musicbrainz\.org\/release\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/edit-relationships/i;
    const m = window.location.href.match(re);
    if (!m) return;
    log.info(`Boot: script running (document.readyState=${document.readyState}, ${Math.round(performance.now())}ms into the page)`);
    const tProbe = since();
    const sourceProbe = getSourceUrlsForRelease(m[1]).then((s) => {
      log.info(`Boot: source probe done (+${since() - tProbe}ms)`);
      return { sources: s, failed: false };
    }).catch((e) => {
      log.error(`Sources: could not read this release's links from MusicBrainz \u2014 ${e.message}. Showing the toolbar anyway; reload to retry.`);
      console.warn("[credit_hoarder] could not read release sources:", e);
      return { sources: {}, failed: true };
    });
    const remixProbe = probeTitleRemixes(m[1]).then((r) => {
      log.info(`Boot: title-remix probe done (+${since() - tProbe}ms)`);
      return r;
    }).catch((e) => {
      log.warn(`Titles: remix probe failed \u2014 ${e.message}`);
      return null;
    });
    const domReady = new Promise((resolve) => {
      if (document.readyState === "interactive" || document.readyState === "complete") return resolve();
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    }).then(() => log.info(`Boot: DOM ready (+${since()}ms)`));
    Promise.all([sourceProbe, domReady]).then(([probe]) => {
      const known = !!(probe.sources.discogs || probe.sources.tidal || probe.sources.qobuz || probe.sources.deezer || probe.sources.apple || probe.sources.metalArchives || probe.sources.ytmusic);
      if (known || probe.failed) {
        bootstrapBar(probe, null, m[1]);
        remixProbe.then((remix) => {
          const n = remix?.count || 0;
          if (!n) return;
          const bar = document.querySelector(".discogs-bar");
          const outcome = bar?._addTitlesSource ? bar._addTitlesSource(n) : "no bar";
          log.info(`Titles: ${n} remixer(s) derivable from the track titles \u2014 ${outcome} (+${since()}ms)`);
        });
        return;
      }
      log.info("Boot: no linked source \u2014 waiting for the title-remix probe before deciding whether to show anything");
      remixProbe.then((remix) => bootstrapBar(probe, remix, m[1]));
    });
  })();
  function bootstrapBar(probe, remix, releaseMbid) {
    {
      const sources = probe.sources;
      const hasProvider = !!(sources.discogs || sources.tidal || sources.qobuz || sources.deezer || sources.apple || sources.metalArchives || sources.ytmusic);
      const remixCount = remix?.count || 0;
      if (!probe.failed) logSourceProbe(sources);
      log.info(`Toolbar: ${probe.failed ? "source probe FAILED" : hasProvider ? "linked source(s) found" : "no linked sources"}, ${remixCount} title-derived remixer(s) \u2014 ${probe.failed || hasProvider || remixCount ? "mounting" : "not mounting (nothing to import)"}`);
      // Apple album barcode discovery and direct-song import remain available without linked providers.
      insertDiscogsBar(sources.discogs, sources, { titlesRemixCount: remixCount, sourceProbeFailed: probe.failed });
      log.info(`Boot: toolbar mounted (+${since()}ms from script start)`);
    }
  }
})();
    }
})();
