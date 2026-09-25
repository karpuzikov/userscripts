// ==UserScript==
// @name         Harmony - Link External IDs in One Click
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.1.0
// @description  Adds all-in-one and per-type one-click submission of Harmony MusicBrainz external-ID edits for artists, labels, and recordings.
// @author       karpuzikov
// @license      MIT
// @match        https://harmony.pulsewidth.org.uk/release/actions*
// @match        https://musicbrainz.org/artist/*
// @match        https://musicbrainz.org/label/*
// @match        https://musicbrainz.org/recording/*
// @match        https://musicbrainz.org/login*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/harmony-link-external-ids-one-click/Harmony_Link_External_IDs_in_One_Click.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/harmony-link-external-ids-one-click/Harmony_Link_External_IDs_in_One_Click.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const QUEUE_KEY = 'harmony-link-external-ids-one-click.queue.v1';
    const WORKER_KEY = 'harmony-link-external-ids-one-click.worker.v1';
    const WORKER_HASH = 'harmony-link-external-ids-one-click';
    const NEXT_EDIT_DELAY_MS = 1200;
    const FORM_WAIT_TIMEOUT_MS = 15000;
    const ALLOWED_ENTITY_TYPES = new Set(['artist', 'label', 'recording']);
    const SCRIPT_GITHUB_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/harmony-link-external-ids-one-click/Harmony_Link_External_IDs_in_One_Click.user.js';

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function readQueue() {
        return GM_getValue(QUEUE_KEY, null);
    }

    function writeQueue(queue) {
        GM_setValue(QUEUE_KEY, queue);
    }

    function classifyMusicBrainzEditUrl(rawUrl) {
        try {
            const url = new URL(rawUrl, location.href);
            if (url.origin !== 'https://musicbrainz.org') return null;

            const match = url.pathname.match(/^\/(artist|label|recording)\/([0-9a-f-]{36})\/edit$/i);
            if (!match) return null;

            const type = match[1].toLowerCase();
            if (!ALLOWED_ENTITY_TYPES.has(type)) return null;

            const editNoteKey = [...url.searchParams.keys()]
                .find((key) => key.endsWith('.edit_note'));
            if (editNoteKey) {
                const currentNote = url.searchParams.get(editNoteKey) || '';
                if (!currentNote.includes(SCRIPT_GITHUB_URL)) {
                    const suffix = `Harmony one-click script: ${SCRIPT_GITHUB_URL}`;
                    url.searchParams.set(editNoteKey, currentNote ? `${currentNote}\n\n${suffix}` : suffix);
                }
            }

            return { url: url.href, type, mbid: match[2] };
        } catch {
            return null;
        }
    }

    function getHarmonyLinks() {
        const seen = new Set();
        const items = [];

        for (const anchor of document.querySelectorAll('a[href]')) {
            if (anchor.textContent.trim() !== 'Link external IDs') continue;

            const parsed = classifyMusicBrainzEditUrl(anchor.href);
            if (!parsed || seen.has(parsed.url)) continue;

            seen.add(parsed.url);
            items.push(parsed);
        }

        return items;
    }

    function summarizeItems(items) {
        const counts = { artist: 0, label: 0, recording: 0 };
        for (const item of items) counts[item.type] += 1;

        const parts = [];
        if (counts.artist) parts.push(`${counts.artist} artist${counts.artist === 1 ? '' : 's'}`);
        if (counts.label) parts.push(`${counts.label} label${counts.label === 1 ? '' : 's'}`);
        if (counts.recording) parts.push(`${counts.recording} song${counts.recording === 1 ? '' : 's'}`);
        return parts.join(', ');
    }

    function makeWorkerUrl(rawUrl, jobId) {
        const url = new URL(rawUrl);
        url.hash = `${WORKER_HASH}=${encodeURIComponent(jobId)}`;
        return url.href;
    }

    function renderHarmonyControls() {
        if (document.getElementById('harmony-link-external-ids-one-click')) return;

        const allItems = getHarmonyLinks();
        if (!allItems.length) return;

        const heading = [...document.querySelectorAll('h2')]
            .find((element) => element.textContent.trim() === 'Release Actions');
        if (!heading) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'harmony-link-external-ids-one-click';
        wrapper.className = 'action';
        wrapper.style.alignItems = 'flex-start';
        wrapper.style.gap = '0.75rem';

        const panel = document.createElement('div');
        panel.style.display = 'flex';
        panel.style.flexDirection = 'column';
        panel.style.gap = '0.5rem';

        const buttonRow = document.createElement('div');
        buttonRow.style.display = 'flex';
        buttonRow.style.flexWrap = 'wrap';
        buttonRow.style.gap = '0.5rem';

        const status = document.createElement('div');
        status.style.fontSize = '0.9em';
        status.style.opacity = '0.85';
        status.textContent = summarizeItems(allItems);

        const buttonConfigs = [
            {
                label: 'Link external IDs in one click',
                scope: 'all',
                filter: () => true
            },
            {
                label: 'Link artist external IDs in one click',
                scope: 'artist',
                filter: (item) => item.type === 'artist'
            },
            {
                label: 'Link label external IDs in one click',
                scope: 'label',
                filter: (item) => item.type === 'label'
            },
            {
                label: 'Link song external IDs in one click',
                scope: 'recording',
                filter: (item) => item.type === 'recording'
            }
        ];

        const buttons = [];

        function currentItemsFor(config) {
            return getHarmonyLinks().filter(config.filter);
        }

        function setButtonsDisabled(disabled) {
            for (const button of buttons) {
                if (disabled) {
                    button.disabled = true;
                    continue;
                }

                const config = buttonConfigs.find((entry) => entry.scope === button.dataset.scope);
                button.disabled = !config || currentItemsFor(config).length === 0;
            }
        }

        function startQueue(config) {
            const items = currentItemsFor(config);
            if (!items.length) {
                status.textContent = `No ${config.scope === 'recording' ? 'song' : config.scope === 'all' ? 'supported' : config.scope} external-ID edits found.`;
                return;
            }

            const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            const queue = {
                id: jobId,
                status: 'running',
                phase: 'loading',
                scope: config.scope,
                items,
                index: 0,
                completed: 0,
                sourcePage: `${location.origin}${location.pathname}${location.search}`,
                startedAt: Date.now(),
                updatedAt: Date.now(),
                error: ''
            };

            writeQueue(queue);
            setButtonsDisabled(true);
            status.textContent = `0/${items.length} submitted - ${config.scope === 'all' ? 'all' : config.scope === 'recording' ? 'songs' : config.scope + 's'}...`;

            GM_openInTab(makeWorkerUrl(items[0].url, jobId), {
                active: false,
                insert: true,
                setParent: true
            });
        }

        for (const config of buttonConfigs) {
            const items = allItems.filter(config.filter);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'open-all-links';
            button.dataset.scope = config.scope;
            button.textContent = config.label;
            button.title = items.length ? summarizeItems(items) : 'No matching external-ID edits found.';
            button.disabled = items.length === 0;
            button.addEventListener('click', () => startQueue(config));
            buttons.push(button);
            buttonRow.appendChild(button);
        }

        panel.append(buttonRow, status);
        wrapper.appendChild(panel);
        heading.insertAdjacentElement('afterend', wrapper);

        setInterval(() => {
            const queue = readQueue();
            if (!queue || !queue.items) return;

            const sourcePage = `${location.origin}${location.pathname}${location.search}`;
            if (queue.sourcePage !== sourcePage) return;

            const total = queue.items.length;
            const scopeName = queue.scope === 'recording'
                ? 'songs'
                : queue.scope === 'all'
                    ? 'all'
                    : `${queue.scope}s`;

            if (queue.status === 'running') {
                setButtonsDisabled(true);
                status.textContent = `${queue.completed}/${total} submitted - ${scopeName}...`;
            } else if (queue.status === 'complete') {
                setButtonsDisabled(false);
                status.textContent = `Done: ${queue.completed}/${total} submitted - ${scopeName}.`;
            } else if (queue.status === 'failed') {
                setButtonsDisabled(false);
                status.textContent = `Stopped at ${queue.completed}/${total}: ${queue.error || 'unknown error'}`;
            }
        }, 500);
    }

    function getSubmitButton(root = document) {
        const candidates = root.querySelectorAll('button[type="submit"], input[type="submit"]');
        return [...candidates].find((element) => {
            const text = element.tagName === 'INPUT' ? element.value : element.textContent;
            return String(text || '').trim().toLowerCase() === 'enter edit';
        }) || null;
    }

    function visibleFormError(root = document) {
        const selectors = [
            '.error',
            '.errors',
            '.error-message',
            '.field-error',
            '.message.error'
        ];

        for (const selector of selectors) {
            for (const element of root.querySelectorAll(selector)) {
                const text = element.textContent.trim();
                if (text && element.getClientRects().length) return text.replace(/\s+/g, ' ');
            }
        }
        return '';
    }

    async function waitForEnterEditButton(timeoutMs = FORM_WAIT_TIMEOUT_MS) {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            const button = getSubmitButton();
            if (button) return button;
            await sleep(200);
        }
        return null;
    }

    function failQueue(queue, message) {
        queue.status = 'failed';
        queue.error = message;
        queue.updatedAt = Date.now();
        writeQueue(queue);

        let box = document.getElementById('harmony-one-click-worker-status');
        if (!box) {
            box = document.createElement('div');
            box.id = 'harmony-one-click-worker-status';
            box.style.cssText = [
                'position:fixed',
                'top:12px',
                'right:12px',
                'z-index:2147483647',
                'max-width:520px',
                'padding:12px 14px',
                'background:#fff3cd',
                'color:#332701',
                'border:1px solid #d6b656',
                'border-radius:6px',
                'font:14px/1.4 sans-serif',
                'box-shadow:0 2px 12px rgba(0,0,0,.25)'
            ].join(';');
            document.documentElement.appendChild(box);
        }
        box.textContent = `Harmony one-click linking stopped: ${message}`;
    }

    function installWorkerMarker() {
        const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
        const prefix = `${WORKER_HASH}=`;
        if (!hash.startsWith(prefix)) return;

        const jobId = decodeURIComponent(hash.slice(prefix.length));
        if (!jobId) return;

        sessionStorage.setItem(WORKER_KEY, jobId);
        history.replaceState(null, '', `${location.pathname}${location.search}`);
    }

    function isCurrentEditPage(item) {
        try {
            const target = new URL(item.url);
            return location.origin === target.origin && location.pathname === target.pathname;
        } catch {
            return false;
        }
    }

    async function runMusicBrainzWorker() {
        installWorkerMarker();

        const workerId = sessionStorage.getItem(WORKER_KEY);
        if (!workerId) return;

        let queue = readQueue();
        if (!queue || queue.id !== workerId) {
            sessionStorage.removeItem(WORKER_KEY);
            return;
        }

        if (queue.status !== 'running') {
            sessionStorage.removeItem(WORKER_KEY);
            return;
        }

        if (location.pathname.startsWith('/login')) {
            failQueue(queue, 'MusicBrainz login is required. Log in, then run the Harmony button again.');
            return;
        }

        const item = queue.items[queue.index];
        if (!item) {
            queue.status = 'complete';
            queue.phase = 'done';
            queue.updatedAt = Date.now();
            writeQueue(queue);
            sessionStorage.removeItem(WORKER_KEY);
            setTimeout(() => window.close(), 600);
            return;
        }

        if (queue.phase === 'submitted') {
            if (isCurrentEditPage(item)) {
                await sleep(500);
                const formStillPresent = getSubmitButton();
                const error = visibleFormError();
                if (formStillPresent) {
                    failQueue(queue, error || `MusicBrainz did not accept the ${item.type} edit.`);
                    return;
                }
            }

            queue.completed += 1;
            queue.index += 1;
            queue.phase = 'loading';
            queue.updatedAt = Date.now();
            queue.error = '';
            writeQueue(queue);

            const nextItem = queue.items[queue.index];
            if (!nextItem) {
                queue.status = 'complete';
                queue.phase = 'done';
                queue.updatedAt = Date.now();
                writeQueue(queue);
                sessionStorage.removeItem(WORKER_KEY);
                setTimeout(() => window.close(), 600);
                return;
            }

            await sleep(NEXT_EDIT_DELAY_MS);
            location.replace(nextItem.url);
            return;
        }

        if (!isCurrentEditPage(item)) {
            location.replace(item.url);
            return;
        }

        const enterEditButton = await waitForEnterEditButton();
        if (!enterEditButton) {
            failQueue(queue, `Could not find MusicBrainz's "Enter edit" button for the ${item.type} edit.`);
            return;
        }

        const form = enterEditButton.closest('form');
        if (!form) {
            failQueue(queue, `Could not find the MusicBrainz edit form for the ${item.type} edit.`);
            return;
        }

        const pageError = visibleFormError();
        if (pageError) {
            failQueue(queue, pageError);
            return;
        }

        queue.phase = 'submitted';
        queue.updatedAt = Date.now();
        writeQueue(queue);

        await sleep(250);
        enterEditButton.click();
    }

    if (location.hostname === 'harmony.pulsewidth.org.uk') {
        renderHarmonyControls();
        const observer = new MutationObserver(renderHarmonyControls);
        observer.observe(document.documentElement, { childList: true, subtree: true });
    } else if (location.hostname === 'musicbrainz.org') {
        runMusicBrainzWorker().catch((error) => {
            const queue = readQueue();
            if (queue) failQueue(queue, error?.message || String(error));
        });
    }
})();
