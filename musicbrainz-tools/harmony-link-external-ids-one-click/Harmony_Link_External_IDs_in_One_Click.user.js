// ==UserScript==
// @name         Harmony - Link External IDs in One Click
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.2.7
// @description  Adds all-in-one and per-type fast submission of Harmony MusicBrainz external-ID edits without opening one edit tab per entity.
// @author       karpuzikov
// @license      MIT
// @match        https://harmony.pulsewidth.org.uk/release/actions*
// @match        https://musicbrainz.org/release-group/*
// @exclude      https://musicbrainz.org/release-group/*/*
// @connect      musicbrainz.org
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/harmony-link-external-ids-one-click/Harmony_Link_External_IDs_in_One_Click.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/harmony-link-external-ids-one-click/Harmony_Link_External_IDs_in_One_Click.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const QUEUE_KEY = 'harmony-link-external-ids-one-click.queue.v2';
    const BRIDGE_PARAM = 'harmony_external_id_bridge';
    const MAX_CONCURRENT_SUBMISSIONS = 4;
    const RUNNER_STALE_AFTER_MS = 8000;
    const RUNNER_HEARTBEAT_MS = 2000;
    const ALLOWED_ENTITY_TYPES = new Set(['artist', 'label', 'recording']);
    const SCRIPT_GITHUB_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/harmony-link-external-ids-one-click/Harmony_Link_External_IDs_in_One_Click.user.js';

    function readQueue() {
        return GM_getValue(QUEUE_KEY, null);
    }

    function writeQueue(queue) {
        queue.updatedAt = Date.now();
        GM_setValue(QUEUE_KEY, queue);
    }

    function currentSourcePage() {
        return `${location.origin}${location.pathname}${location.search}`;
    }

    function queueBelongsToCurrentPage(queue) {
        return Boolean(queue && queue.sourcePage === currentSourcePage());
    }

    function recountQueue(queue) {
        queue.succeeded = queue.items.filter((item) => item.state === 'submitted').length;
        queue.failed = queue.items.filter((item) => item.state === 'failed').length;
        queue.completed = queue.succeeded + queue.failed;
    }

    function runnerIsActive(queue) {
        return Boolean(
            queue?.status === 'running' &&
            queue.runnerId &&
            Number.isFinite(queue.runnerHeartbeatAt) &&
            Date.now() - queue.runnerHeartbeatAt < RUNNER_STALE_AFTER_MS
        );
    }

    function prepareQueueForResume(queue, retryFailed = false) {
        for (const item of queue.items || []) {
            if (item.state === 'submitting') {
                item.state = 'pending';
                item.error = '';
            } else if (retryFailed && item.state === 'failed') {
                item.state = 'pending';
                item.error = '';
            } else if (!['pending', 'submitted', 'failed'].includes(item.state)) {
                item.state = 'pending';
                item.error = '';
            }
        }

        recountQueue(queue);
        queue.status = 'running';
        queue.fatalError = '';
        queue.runnerId = '';
        queue.runnerHeartbeatAt = 0;
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

    function bridgeUrl(jobId, releaseGroupMbid) {
        const url = new URL(
            `https://musicbrainz.org/release-group/${encodeURIComponent(releaseGroupMbid)}`
        );
        url.searchParams.set(BRIDGE_PARAM, jobId);
        return url.href;
    }

    function extractMbid(value) {
        return String(value || '').match(
            /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
        )?.[0]?.toLowerCase() || '';
    }

    function gmJson(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: { Accept: 'application/json' },
                timeout: 30000,
                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error(`MusicBrainz lookup failed with HTTP ${response.status}.`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch {
                        reject(new Error('MusicBrainz lookup returned invalid JSON.'));
                    }
                },
                ontimeout() {
                    reject(new Error('MusicBrainz release-group lookup timed out.'));
                },
                onerror() {
                    reject(new Error('MusicBrainz release-group lookup failed.'));
                }
            });
        });
    }

    async function resolveReleaseGroupMbid() {
        const releaseMbid = extractMbid(
            new URL(location.href).searchParams.get('release_mbid')
        );
        if (!releaseMbid) {
            throw new Error('Harmony page does not contain a MusicBrainz release MBID.');
        }

        const data = await gmJson(
            `https://musicbrainz.org/ws/2/release/${encodeURIComponent(releaseMbid)}?inc=release-groups&fmt=json`
        );
        const releaseGroupMbid = extractMbid(data?.['release-group']?.id);
        if (!releaseGroupMbid) {
            throw new Error('Could not determine the MusicBrainz release group.');
        }
        return releaseGroupMbid;
    }

    function findHarmonyLinkAnchor(type) {
        for (const anchor of document.querySelectorAll('a[href]')) {
            if (anchor.textContent.trim() !== 'Link external IDs') continue;
            const parsed = classifyMusicBrainzEditUrl(anchor.href);
            if (parsed?.type === type) return anchor;
        }
        return null;
    }

    function makeActionControl(id, button, status, referenceAction, alignment = 'left') {
        const wrapper = document.createElement('div');
        wrapper.id = id;
        wrapper.className = 'action';

        const sourceIcon = referenceAction?.querySelector(':scope > svg.icon');
        if (sourceIcon) {
            wrapper.appendChild(sourceIcon.cloneNode(true));
        }

        const body = document.createElement('div');
        const paragraph = document.createElement('p');
        body.style.flex = '1 1 auto';
        paragraph.style.display = 'flex';
        paragraph.style.justifyContent = alignment === 'center'
            ? 'center'
            : alignment === 'right'
                ? 'flex-end'
                : 'flex-start';
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

        async function startQueue(config) {
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

            setButtonsDisabled(true);
            status.textContent = 'Resolving MusicBrainz release group...';

            let releaseGroupMbid;
            try {
                releaseGroupMbid = await resolveReleaseGroupMbid();
            } catch (error) {
                setButtonsDisabled(false);
                status.textContent = error?.message || String(error);
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
                sourcePage: currentSourcePage(),
                releaseGroupMbid,
                startedAt: Date.now(),
                updatedAt: Date.now(),
                fatalError: '',
                runnerId: '',
                runnerHeartbeatAt: 0
            };

            writeQueue(queue);
            status.textContent = `0/${items.length} submitted - using fast MusicBrainz background submission...`;

            GM_openInTab(bridgeUrl(jobId, releaseGroupMbid), {
                active: false,
                insert: true,
                setParent: true
            });
        }

        function resumeQueue(queue) {
            if (!queue?.releaseGroupMbid || !queue?.id) {
                status.textContent = 'Saved Harmony job is incomplete and cannot be resumed.';
                return;
            }

            if (runnerIsActive(queue)) {
                status.textContent = `${queue.completed}/${queue.items.length} processed - job is already running...`;
                return;
            }

            const retryFailed = queue.status === 'failed';
            prepareQueueForResume(queue, retryFailed);
            writeQueue(queue);

            status.textContent = `Resuming: ${queue.completed}/${queue.items.length} already processed...`;

            GM_openInTab(bridgeUrl(queue.id, queue.releaseGroupMbid), {
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
            button.addEventListener('click', () => {
                const queue = readQueue();
                if (
                    config.scope === 'all' &&
                    queueBelongsToCurrentPage(queue) &&
                    (queue.status === 'running' || queue.status === 'failed')
                ) {
                    resumeQueue(queue);
                    return;
                }

                void startQueue(config);
            });
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
            firstLinkAction,
            'center'
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
                referenceAction,
                'right'
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
            if (!queueBelongsToCurrentPage(queue)) {
                allButton.textContent = allConfig.label;
                return;
            }

            const total = queue.items?.length || 0;

            if (queue.status === 'running') {
                setButtonsDisabled(true);

                if (runnerIsActive(queue)) {
                    allButton.textContent = allConfig.label;
                    status.textContent = `${queue.completed}/${total} processed - ${queue.succeeded} submitted, ${queue.failed} failed...`;
                } else {
                    allButton.disabled = false;
                    allButton.textContent = 'Resume external IDs in one click';
                    status.textContent = `Interrupted at ${queue.completed}/${total} processed - click Resume to continue.`;
                }
            } else if (queue.status === 'complete') {
                allButton.textContent = allConfig.label;
                setButtonsDisabled(false);
                status.textContent = queue.failed
                    ? `Done: ${queue.succeeded}/${total} submitted, ${queue.failed} failed.`
                    : `Done: ${queue.succeeded}/${total} submitted.`;
            } else if (queue.status === 'failed') {
                setButtonsDisabled(true);
                allButton.disabled = false;
                allButton.textContent = 'Resume external IDs in one click';
                status.textContent = `Stopped: ${queue.fatalError || 'MusicBrainz submission failed.'} Click Resume to retry unfinished work.`;
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

    function canonicalizeLinkText(value) {
        const text = String(value || '').trim();
        try {
            const url = new URL(text);
            url.hash = '';
            url.hostname = url.hostname.toLowerCase();
            if (url.pathname !== '/') {
                url.pathname = url.pathname.replace(/\/+$/, '');
            }
            return url.href.replace(/\/$/, '');
        } catch {
            return text;
        }
    }

    function linkPairsFromParams(params, item) {
        const prefix = `edit-${item.type}.url.`;
        const buckets = new Map();

        for (const [key, value] of params.entries()) {
            if (!key.startsWith(prefix)) continue;

            const rest = key.slice(prefix.length);
            const dot = rest.lastIndexOf('.');
            if (dot <= 0) continue;

            const index = rest.slice(0, dot);
            const field = rest.slice(dot + 1);
            if (field !== 'text' && field !== 'link_type_id') continue;

            const entry = buckets.get(index) || { text: '', linkTypeId: '' };
            if (field === 'text') entry.text = canonicalizeLinkText(value);
            if (field === 'link_type_id') entry.linkTypeId = String(value).trim();
            buckets.set(index, entry);
        }

        return [...buckets.values()].filter((entry) => entry.text && entry.linkTypeId);
    }

    function formAlreadyContainsSeededLinks(form, item) {
        const intended = linkPairsFromParams(new URL(item.url).searchParams, item);
        if (!intended.length) return false;

        const existingParams = new URLSearchParams();
        for (const [key, value] of new FormData(form).entries()) {
            if (typeof value === 'string') existingParams.append(key, value);
        }

        const existing = linkPairsFromParams(existingParams, item);
        return intended.every((wanted) =>
            existing.some((current) =>
                current.linkTypeId === wanted.linkTypeId &&
                current.text === wanted.text
            )
        );
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

        // A browser can be closed after MusicBrainz accepted a POST but before
        // the userscript persisted "submitted". On resume, first inspect the
        // current form and skip the POST if Harmony's exact relationship is
        // already present. This makes interrupted retries idempotent whenever
        // MusicBrainz has already applied the submitted relationship.
        if (formAlreadyContainsSeededLinks(form, item)) {
            return { alreadyPresent: true };
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

        return { alreadyPresent: false };
    }

    async function runBridge() {
        const jobId = getBridgeJobId();
        if (!jobId) return;

        const queue = readQueue();
        if (!queue || queue.id !== jobId || queue.status !== 'running') {
            setBridgeStatus('No active Harmony submission job was found.', true);
            return;
        }

        if (runnerIsActive(queue)) {
            setBridgeStatus('This Harmony submission job is already running in another tab.', true);
            return;
        }

        const runnerId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        prepareQueueForResume(queue, false);
        queue.runnerId = runnerId;
        queue.runnerHeartbeatAt = Date.now();
        writeQueue(queue);

        const claimedQueue = readQueue();
        if (claimedQueue?.runnerId !== runnerId) {
            setBridgeStatus('Another tab claimed this Harmony submission job.', true);
            return;
        }

        const heartbeatTimer = setInterval(() => {
            const latest = readQueue();
            if (
                !latest ||
                latest.id !== jobId ||
                latest.status !== 'running' ||
                latest.runnerId !== runnerId
            ) {
                return;
            }

            latest.runnerHeartbeatAt = Date.now();
            writeQueue(latest);
        }, RUNNER_HEARTBEAT_MS);

        const workIndexes = queue.items
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => item.state === 'pending')
            .map(({ index }) => index);

        setBridgeStatus(`Starting: ${queue.completed}/${queue.items.length} processed`);

        let cursor = 0;
        let fatalError = null;

        const saveProgress = () => {
            recountQueue(queue);
            queue.runnerHeartbeatAt = Date.now();
            writeQueue(queue);
            setBridgeStatus(
                `${queue.completed}/${queue.items.length} processed - ${queue.succeeded} submitted, ${queue.failed} failed`
            );
        };

        async function worker() {
            while (!fatalError) {
                const workIndex = cursor++;
                if (workIndex >= workIndexes.length) return;

                const index = workIndexes[workIndex];
                const item = queue.items[index];
                item.state = 'submitting';
                queue.runnerHeartbeatAt = Date.now();
                writeQueue(queue);

                try {
                    await submitItem(item);
                    item.state = 'submitted';
                    item.error = '';
                } catch (error) {
                    item.state = 'failed';
                    item.error = error?.message || String(error);

                    if (error?.fatal) {
                        fatalError = item.error;
                    }
                }

                saveProgress();
            }
        }

        try {
            const workerCount = Math.min(MAX_CONCURRENT_SUBMISSIONS, workIndexes.length);
            await Promise.all(Array.from({ length: workerCount }, () => worker()));

            if (fatalError) {
                queue.status = 'failed';
                queue.fatalError = fatalError;
                queue.runnerId = '';
                queue.runnerHeartbeatAt = 0;
                recountQueue(queue);
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
            queue.runnerId = '';
            queue.runnerHeartbeatAt = 0;
            recountQueue(queue);
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
        } finally {
            clearInterval(heartbeatTimer);
        }
    }

    if (
        location.hostname === 'harmony.pulsewidth.org.uk' &&
        /^\/release\/actions\/?$/.test(location.pathname)
    ) {
        renderHarmonyControls();

        const observer = new MutationObserver(renderHarmonyControls);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    } else if (
        location.hostname === 'musicbrainz.org' &&
        /^\/release-group\/[0-9a-f-]{36}\/?$/i.test(location.pathname) &&
        getBridgeJobId()
    ) {
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
