// ==UserScript==
// @name         Harmony - Link External IDs in One Click
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.2.3
// @description  Adds all-in-one and per-type fast submission of Harmony MusicBrainz external-ID edits without opening one edit tab per entity.
// @author       karpuzikov
// @license      MIT
// @match        https://harmony.pulsewidth.org.uk/release/actions*
// @match        https://musicbrainz.org/*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/harmony-link-external-ids-one-click/Harmony_Link_External_IDs_in_One_Click.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/harmony-link-external-ids-one-click/Harmony_Link_External_IDs_in_One_Click.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const QUEUE_KEY = 'harmony-link-external-ids-one-click.queue.v2';
    const BRIDGE_PARAM = 'harmony_external_id_bridge';
    const MAX_CONCURRENT_SUBMISSIONS = 4;
    const ALLOWED_ENTITY_TYPES = new Set(['artist', 'label', 'recording']);
    const SCRIPT_GITHUB_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/harmony-link-external-ids-one-click/Harmony_Link_External_IDs_in_One_Click.user.js';

    function readQueue() {
        return GM_getValue(QUEUE_KEY, null);
    }

    function writeQueue(queue) {
        queue.updatedAt = Date.now();
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
                    url.searchParams.set(
                        editNoteKey,
                        currentNote ? `${currentNote}\n\n${suffix}` : suffix
                    );
                }
            }

            return {
                url: url.href,
                type,
                mbid: match[2],
                state: 'pending',
                error: ''
            };
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
            if (!parsed) continue;

            const dedupeKey = `${parsed.type}:${parsed.mbid}:${parsed.url}`;
            if (seen.has(dedupeKey)) continue;

            seen.add(dedupeKey);
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

    function bridgeUrl(jobId) {
        const url = new URL('https://musicbrainz.org/');
        url.searchParams.set(BRIDGE_PARAM, jobId);
        return url.href;
    }

    function findHarmonyLinkAnchor(type) {
        for (const anchor of document.querySelectorAll('a[href]')) {
            if (anchor.textContent.trim() !== 'Link external IDs') continue;
            const parsed = classifyMusicBrainzEditUrl(anchor.href);
            if (parsed?.type === type) return anchor;
        }
        return null;
    }

    function makeActionControl(id, button, status, referenceAction) {
        const wrapper = document.createElement('div');
        wrapper.id = id;
        wrapper.className = 'action';

        const sourceIcon = referenceAction?.querySelector(':scope > svg.icon');
        if (sourceIcon) {
            wrapper.appendChild(sourceIcon.cloneNode(true));
        }

        const body = document.createElement('div');
        const paragraph = document.createElement('p');
        paragraph.appendChild(button);
        body.appendChild(paragraph);

        if (status) {
            status.style.fontSize = '0.9em';
            status.style.opacity = '0.85';
            status.style.marginTop = '0.35rem';
            body.appendChild(status);
        }

        wrapper.appendChild(body);
        return wrapper;
    }

    function renderHarmonyControls() {
        if (document.getElementById('harmony-link-external-ids-one-click')) return;

        const allItems = getHarmonyLinks();
        if (!allItems.length) return;

        const heading = [...document.querySelectorAll('h2')]
            .find((element) => element.textContent.trim() === 'Release Actions');
        if (!heading) return;

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
        const status = document.createElement('div');
        status.textContent = summarizeItems(allItems);

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
                const typeName = config.scope === 'recording'
                    ? 'song'
                    : config.scope === 'all'
                        ? 'supported'
                        : config.scope;
                status.textContent = `No ${typeName} external-ID edits found.`;
                return;
            }

            const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            const queue = {
                id: jobId,
                status: 'running',
                scope: config.scope,
                items,
                completed: 0,
                succeeded: 0,
                failed: 0,
                sourcePage: `${location.origin}${location.pathname}${location.search}`,
                startedAt: Date.now(),
                updatedAt: Date.now(),
                fatalError: ''
            };

            writeQueue(queue);
            setButtonsDisabled(true);
            status.textContent = `0/${items.length} submitted - using fast MusicBrainz background submission...`;

            GM_openInTab(bridgeUrl(jobId), {
                active: false,
                insert: true,
                setParent: true
            });
        }

        function makeButton(config, items) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'open-all-links';
            button.dataset.scope = config.scope;
            button.textContent = config.label;
            button.title = summarizeItems(items);
            button.addEventListener('click', () => startQueue(config));
            buttons.push(button);
            return button;
        }

        const allConfig = buttonConfigs[0];
        const firstLinkAnchor = [...document.querySelectorAll('a[href]')]
            .find((anchor) => {
                if (anchor.textContent.trim() !== 'Link external IDs') return false;
                return Boolean(classifyMusicBrainzEditUrl(anchor.href));
            });
        const firstLinkAction = firstLinkAnchor?.closest('.action') || null;
        if (!firstLinkAction) return;

        const allButton = makeButton(allConfig, allItems);
        const allControl = makeActionControl(
            'harmony-link-external-ids-one-click',
            allButton,
            status,
            firstLinkAction
        );

        // The global button belongs with the external-ID actions themselves,
        // not directly after the Release Actions heading. This keeps it
        // visible in Harmony's action layout and places it immediately before
        // the first available external-ID section.
        const firstActionGroup = firstLinkAction.closest('.action-group');
        if (firstActionGroup) {
            firstActionGroup.insertBefore(allControl, firstLinkAction);
        } else {
            firstLinkAction.insertAdjacentElement('beforebegin', allControl);
        }

        for (const config of buttonConfigs.slice(1)) {
            const items = allItems.filter(config.filter);

            // Do not show a type-specific button unless Harmony actually has
            // at least one "Link external IDs" edit of that type on this page.
            if (!items.length) continue;

            const anchor = findHarmonyLinkAnchor(config.scope);
            const referenceAction = anchor?.closest('.action');
            if (!referenceAction) continue;

            const button = makeButton(config, items);
            const control = makeActionControl(
                `harmony-link-external-ids-${config.scope}`,
                button,
                null,
                referenceAction
            );

            // Keep the aggregate button under "Release Actions", while each
            // type-specific button lives inside its own Harmony section,
            // directly before that section's first existing link action.
            const actionGroup = referenceAction.closest('.action-group');
            if (actionGroup) {
                actionGroup.insertBefore(control, referenceAction);
            } else {
                referenceAction.insertAdjacentElement('beforebegin', control);
            }
        }

        setInterval(() => {
            const queue = readQueue();
            if (!queue || queue.sourcePage !== `${location.origin}${location.pathname}${location.search}`) {
                return;
            }

            const total = queue.items?.length || 0;

            if (queue.status === 'running') {
                setButtonsDisabled(true);
                status.textContent = `${queue.completed}/${total} processed - ${queue.succeeded} submitted, ${queue.failed} failed...`;
            } else if (queue.status === 'complete') {
                setButtonsDisabled(false);
                status.textContent = queue.failed
                    ? `Done: ${queue.succeeded}/${total} submitted, ${queue.failed} failed.`
                    : `Done: ${queue.succeeded}/${total} submitted.`;
            } else if (queue.status === 'failed') {
                setButtonsDisabled(false);
                status.textContent = `Stopped: ${queue.fatalError || 'MusicBrainz submission failed.'}`;
            }
        }, 350);
    }

    function getBridgeJobId() {
        return new URL(location.href).searchParams.get(BRIDGE_PARAM) || '';
    }

    function setBridgeStatus(text, isError = false) {
        document.title = `Harmony External IDs - ${text}`;

        let box = document.getElementById('harmony-external-id-bridge-status');
        if (!box) {
            box = document.createElement('div');
            box.id = 'harmony-external-id-bridge-status';
            box.style.cssText = [
                'position:fixed',
                'top:12px',
                'right:12px',
                'z-index:2147483647',
                'max-width:620px',
                'padding:12px 14px',
                'border-radius:6px',
                'font:14px/1.45 sans-serif',
                'box-shadow:0 2px 12px rgba(0,0,0,.25)',
                'white-space:pre-wrap'
            ].join(';');
            document.documentElement.appendChild(box);
        }

        box.style.background = isError ? '#f8d7da' : '#d1e7dd';
        box.style.color = isError ? '#58151c' : '#0a3622';
        box.style.border = `1px solid ${isError ? '#f1aeb5' : '#a3cfbb'}`;
        box.textContent = text;
    }

    function findEditForm(doc, item) {
        const prefix = `edit-${item.type}.`;
        const forms = [...doc.querySelectorAll('form')];

        return forms.find((form) => {
            const method = (form.getAttribute('method') || 'get').toLowerCase();
            return method === 'post' && [...form.elements].some((element) =>
                typeof element.name === 'string' && element.name.startsWith(prefix)
            );
        }) || null;
    }

    function formToUrlEncoded(form, item) {
        const formData = new FormData(form);
        const params = new URLSearchParams();

        for (const [key, value] of formData.entries()) {
            if (typeof value === 'string') {
                params.append(key, value);
            }
        }

        // MusicBrainz's external-links editor is React-based. On a normal
        // browser submit it dynamically creates hidden edit-<type>.url.*
        // fields. A background fetch does not run that submit handler, so
        // copy Harmony's already-seeded URL relationship fields directly
        // from the edit URL into the POST body.
        const seededUrl = new URL(item.url);
        const prefix = `edit-${item.type}.url.`;
        for (const [key, value] of seededUrl.searchParams.entries()) {
            if (
                key.startsWith(prefix) &&
                (key.endsWith('.text') || key.endsWith('.link_type_id'))
            ) {
                params.set(key, value);
            }
        }

        return params;
    }

    function extractErrors(doc) {
        const selectors = [
            '.error',
            '.errors',
            '.error-message',
            '.field-error',
            '.field-error-message',
            '.message.error'
        ];

        const found = [];
        const seen = new Set();

        for (const selector of selectors) {
            for (const element of doc.querySelectorAll(selector)) {
                const text = element.textContent.replace(/\s+/g, ' ').trim();
                if (!text || seen.has(text)) continue;
                seen.add(text);
                found.push(text);
                if (found.length >= 4) return found.join(' | ');
            }
        }

        return found.join(' | ');
    }

    function loginRequired(response) {
        try {
            const url = new URL(response.url);
            return url.pathname.startsWith('/login');
        } catch {
            return false;
        }
    }

    async function submitItem(item) {
        const getResponse = await fetch(item.url, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            redirect: 'follow',
            headers: {
                'Accept': 'text/html,application/xhtml+xml'
            }
        });

        if (getResponse.status === 401 || getResponse.status === 403 || loginRequired(getResponse)) {
            const error = new Error('MusicBrainz login is required.');
            error.fatal = true;
            throw error;
        }

        if (!getResponse.ok) {
            throw new Error(`MusicBrainz GET failed with HTTP ${getResponse.status}.`);
        }

        const getHtml = await getResponse.text();
        const getDoc = new DOMParser().parseFromString(getHtml, 'text/html');
        const form = findEditForm(getDoc, item);

        if (!form) {
            const pageError = extractErrors(getDoc);
            throw new Error(pageError || `Could not find the MusicBrainz ${item.type} edit form.`);
        }

        const body = formToUrlEncoded(form, item);
        const urlPrefix = `edit-${item.type}.url.`;
        const seededTextFields = [...body.keys()].filter(
            (key) => key.startsWith(urlPrefix) && key.endsWith('.text')
        );
        const seededTypeFields = [...body.keys()].filter(
            (key) => key.startsWith(urlPrefix) && key.endsWith('.link_type_id')
        );

        if (!seededTextFields.length || seededTextFields.length !== seededTypeFields.length) {
            throw new Error(
                `Harmony did not provide a complete MusicBrainz ${item.type} external-link payload.`
            );
        }

        const action = new URL(form.getAttribute('action') || getResponse.url, getResponse.url);
        action.hash = '';

        const postResponse = await fetch(action.href, {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
            redirect: 'follow',
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: body.toString()
        });

        if (postResponse.status === 401 || postResponse.status === 403 || loginRequired(postResponse)) {
            const error = new Error('MusicBrainz login is required.');
            error.fatal = true;
            throw error;
        }

        const postHtml = await postResponse.text();
        const postDoc = new DOMParser().parseFromString(postHtml, 'text/html');
        const finalUrl = new URL(postResponse.url);
        const stillOnEditPage = /^\/(artist|label|recording)\/[0-9a-f-]{36}\/edit$/i.test(finalUrl.pathname);

        if (!postResponse.ok || stillOnEditPage || !postResponse.redirected) {
            const pageError = extractErrors(postDoc);
            throw new Error(
                pageError ||
                `MusicBrainz did not confirm the ${item.type} edit submission (HTTP ${postResponse.status}).`
            );
        }

        return true;
    }

    async function runBridge() {
        const jobId = getBridgeJobId();
        if (!jobId) return;

        const queue = readQueue();
        if (!queue || queue.id !== jobId || queue.status !== 'running') {
            setBridgeStatus('No active Harmony submission job was found.', true);
            return;
        }

        setBridgeStatus(`Starting: 0/${queue.items.length} processed`);

        let cursor = 0;
        let fatalError = null;

        const saveProgress = () => {
            queue.completed = queue.succeeded + queue.failed;
            writeQueue(queue);
            setBridgeStatus(
                `${queue.completed}/${queue.items.length} processed - ${queue.succeeded} submitted, ${queue.failed} failed`
            );
        };

        async function worker() {
            while (!fatalError) {
                const index = cursor++;
                if (index >= queue.items.length) return;

                const item = queue.items[index];
                item.state = 'submitting';
                writeQueue(queue);

                try {
                    await submitItem(item);
                    item.state = 'submitted';
                    item.error = '';
                    queue.succeeded += 1;
                } catch (error) {
                    item.state = 'failed';
                    item.error = error?.message || String(error);
                    queue.failed += 1;

                    if (error?.fatal) {
                        fatalError = item.error;
                    }
                }

                saveProgress();
            }
        }

        const workerCount = Math.min(MAX_CONCURRENT_SUBMISSIONS, queue.items.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));

        if (fatalError) {
            queue.status = 'failed';
            queue.fatalError = fatalError;
            writeQueue(queue);

            const failures = queue.items
                .filter((item) => item.state === 'failed')
                .map((item) => `${item.type} ${item.mbid}: ${item.error}`)
                .join('\n');

            setBridgeStatus(
                `Stopped: ${fatalError}${failures ? `\n\n${failures}` : ''}`,
                true
            );
            return;
        }

        queue.status = 'complete';
        writeQueue(queue);

        if (queue.failed) {
            const failures = queue.items
                .filter((item) => item.state === 'failed')
                .map((item) => `${item.type} ${item.mbid}: ${item.error}`)
                .join('\n');

            setBridgeStatus(
                `Finished: ${queue.succeeded}/${queue.items.length} submitted, ${queue.failed} failed.\n\n${failures}`,
                true
            );
            return;
        }

        setBridgeStatus(`Finished: ${queue.succeeded}/${queue.items.length} submitted.`);
        setTimeout(() => window.close(), 750);
    }

    if (location.hostname === 'harmony.pulsewidth.org.uk') {
        renderHarmonyControls();

        const observer = new MutationObserver(renderHarmonyControls);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    } else if (location.hostname === 'musicbrainz.org' && getBridgeJobId()) {
        runBridge().catch((error) => {
            const queue = readQueue();
            if (queue) {
                queue.status = 'failed';
                queue.fatalError = error?.message || String(error);
                writeQueue(queue);
            }
            setBridgeStatus(error?.message || String(error), true);
        });
    }
})();
