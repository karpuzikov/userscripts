// ==UserScript==
// @name         MusicBrainz - Safe Recording Matcher
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Select only unambiguous recording matches with the same title and artist credit within seven seconds.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/release/add*
// @match        https://musicbrainz.org/release/*/edit*
// @match        https://beta.musicbrainz.org/release/add*
// @match        https://beta.musicbrainz.org/release/*/edit*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/safe-recording-matcher/MusicBrainz_Safe_Recording_Matcher.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/safe-recording-matcher/MusicBrainz_Safe_Recording_Matcher.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/safe-recording-matcher/MusicBrainz_Safe_Recording_Matcher.user.js';
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const MAX_DIFFERENCE_MS = 7000;
    const REQUEST_GAP_MS = 1200;

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

    function buildQuery(track) {
        const title = track.title.replace(/[+\-!(){}\[\]^"~*?:\\/|&]/g, char => '\\' + char);
        return 'recording:"' + title + '" AND arid:' + track.artistIds[0];
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
        if (!track.title || normalize(track.title) !== normalize(candidate.title ?? candidate.name)) {
            return {ok: false, reason: 'Different title'};
        }
        const credit = candidateCredit(candidate);
        if (!track.artistIds?.length || !credit.ids.length ||
            track.artistIds.length !== credit.ids.length ||
            track.artistIds.some((id, index) => !UUID.test(id) || id.toLowerCase() !== credit.ids[index]?.toLowerCase()) ||
            !normalize(track.credit) || normalize(track.credit) !== normalize(credit.text)) {
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
            if (evaluateCandidate(track, candidate).ok) eligible.set(candidate.id.toLowerCase(), candidate);
        }
        if (eligible.size !== 1) {
            return {reason: eligible.size ? 'Several valid recordings; review manually' : 'No exact recording found'};
        }
        const candidate = eligible.values().next().value;
        return {id: candidate.id, candidate};
    }

    function appendAttribution(note, url) {
        if (note.includes(url)) return note;
        return (note.trimEnd() ? note.trimEnd() + '\n\n' : '') + 'Script: ' + url;
    }

    function readExactLength(bubble, button) {
        if (bubble?.control !== button || bubble?.visible?.() !== true) return null;
        const length = bubble.currentTrack?.()?.length?.();
        return Number.isInteger(length) && length > 0 ? length : null;
    }

    if (typeof document === 'undefined' && typeof module !== 'undefined' && module.exports) {
        module.exports = {parseLength, buildQuery, evaluateCandidate, chooseRecording, appendAttribution, readExactLength, maySelectUnlinkedRow};
        return;
    }

    if (!/^\/release\/(?:add|[0-9a-f-]{36}\/edit)\/?$/i.test(location.pathname)) return;

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const resultCache = new Map();
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

    async function searchRecordings(track) {
        const query = buildQuery(track);
        if (resultCache.has(query)) return resultCache.get(query);

        const url = '/ws/2/recording?fmt=json&limit=100&query=' + encodeURIComponent(query);
        for (let attempt = 0; attempt < 3; attempt++) {
            await throttle();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);
            let response;
            try {
                response = await fetch(url, {
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

    async function openEditor(row) {
        const button = row.querySelector('button.edit-track-recording');
        const element = document.querySelector('#recording-assoc-bubble');
        const model = window.MB?.releaseEditor?.recordingBubble;
        if (!button || !element || !model || !row.isConnected) {
            throw new Error('The MusicBrainz recording editor is unavailable');
        }
        if (model.control !== button || !model.visible()) {
            await throttle();
            button.click();
            // Opening the bubble can also start a native MusicBrainz suggestion request.
            nextRequestAt = Math.max(nextRequestAt, Date.now() + REQUEST_GAP_MS);
        }
        const exactLength = await waitFor(() => readExactLength(model, button), 3000);
        const input = element.querySelector('input.name');
        if (!exactLength || !input) throw new Error('The exact track length or recording selector is unavailable');
        const suggestionsIdle = await waitFor(() => !element.querySelector('tr.loading-message'), 8000);
        if (!suggestionsIdle) throw new Error('MusicBrainz suggestions are still loading');
        return {button, element, model, input, exactLength};
    }

    async function selectInEditor(row, track, candidate, editor) {
        const {button, element, model, input} = editor;
        const current = readTrack(row);
        if (!row.isConnected || !maySelectUnlinkedRow(row) || readExactLength(model, button) !== track.length ||
            normalize(current.title) !== normalize(track.title) ||
            normalize(current.credit) !== normalize(track.credit) ||
            JSON.stringify(current.artistIds) !== JSON.stringify(track.artistIds)) {
            throw new Error('The track changed or was linked during matching');
        }

        const suggestionsIdle = await waitFor(() => !element.querySelector('tr.loading-message'), 8000);
        if (!suggestionsIdle) throw new Error('MusicBrainz suggestions are still loading');
        const suggested = [...element.querySelectorAll('input[data-change="recording"]')]
            .find(radio => radio.value.toLowerCase() === candidate.id.toLowerCase());
        if (suggested) {
            if (!maySelectUnlinkedRow(row)) throw new Error('The track was linked during matching');
            suggested.click();
        } else {
            await throttle();
            if (!maySelectUnlinkedRow(row)) throw new Error('The track was linked during matching');
            input.value = candidate.id;
            input.dispatchEvent(new Event('input', {bubbles: true}));
        }
        const linked = await waitFor(() => {
            const current = readLinkedRecording(row);
            return current.id?.toLowerCase() === candidate.id.toLowerCase() ? current : null;
        }, 12000);
        if (!linked) throw new Error('MusicBrainz did not confirm the recording lookup; stopped');

        // The rendered recording length is rounded; the API length is exact.
        const verified = evaluateCandidate(track, {...linked, length: candidate.length});
        if (!verified.ok || linked.length === null || Math.abs(linked.length - candidate.length) > 500) {
            element.querySelector('#add-new-recording')?.click();
            throw new Error('Editor linked a recording with different metadata; stopped');
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

    async function runMatcher(panel) {
        if (running) return;
        const rows = [...document.querySelectorAll('#recordings tr.track')];
        const button = panel.querySelector('.mb-safe-start');
        const stop = panel.querySelector('.mb-safe-stop');
        const status = panel.querySelector('.mb-safe-status');
        const list = panel.querySelector('.mb-safe-results');
        list.replaceChildren();
        if (!rows.length) {
            status.textContent = 'No loaded tracks. Open the Recordings tab and load the medium first.';
            return;
        }

        running = true;
        stopRequested = false;
        button.disabled = true;
        stop.hidden = false;
        let matched = 0;
        let review = 0;
        let processed = 0;
        try {
            for (const row of rows) {
                if (stopRequested) break;
                processed++;
                const track = readTrack(row);
                status.textContent = `Checking ${processed}/${rows.length}: ${track.title || '(untitled)'}`;

                if (!maySelectUnlinkedRow(row)) {
                    showResult(list, row, 'Already linked', track.title);
                    continue;
                }
                if (!track.title || !track.artistIds.length || track.artistIds.some(id => !UUID.test(id)) || !track.credit) {
                    review++;
                    showResult(list, row, 'Review', `${track.title || '(untitled)'} - missing title or artist ID`);
                    continue;
                }

                let editor;
                try {
                    editor = await openEditor(row);
                    track.length = editor.exactLength;
                } catch (error) {
                    review++;
                    showResult(list, row, 'Review', `${track.title} - ${error.message}`);
                    status.textContent = `Stopped: ${error.message}. ${matched} matched, ${review} need review.`;
                    break;
                }

                let search;
                try {
                    search = await searchRecordings(track);
                } catch (error) {
                    review++;
                    showResult(list, row, 'Review', `${track.title} - ${error.message}`);
                    continue;
                }
                const chosen = search.reason ? {reason: search.reason} : chooseRecording(track, search.recordings);
                if (!chosen.id) {
                    review++;
                    showResult(list, row, 'Review', `${track.title} - ${chosen.reason}`);
                    continue;
                }

                try {
                    await selectInEditor(row, track, chosen.candidate, editor);
                    matched++;
                    needsAttribution = true;
                    appendNoteIfPossible();
                    showResult(list, row, 'Matched', track.title, chosen.id);
                } catch (error) {
                    review++;
                    showResult(list, row, 'Review', `${track.title} - ${error.message}`);
                    status.textContent = `Stopped: ${error.message}. ${matched} matched, ${review} need review.`;
                    break;
                }
            }
            if (!status.textContent.startsWith('Stopped:')) {
                status.textContent = `${stopRequested ? 'Stopped' : 'Finished'}: ${matched} matched, ${review} need review, ${processed}/${rows.length} checked. Review all associations before submitting.`;
            }
        } finally {
            running = false;
            button.disabled = false;
            stop.hidden = true;
            appendNoteIfPossible();
        }
    }

    function addControls() {
        if (document.getElementById('mb-safe-recording-matcher')) return true;
        const container = document.querySelector('#recordings .changes');
        if (!container) return false;
        const panel = document.createElement('fieldset');
        panel.id = 'mb-safe-recording-matcher';
        panel.innerHTML = '<legend>Safe recording matcher</legend>' +
            '<button type="button" class="mb-safe-start">Match unlinked recordings</button> ' +
            '<button type="button" class="mb-safe-stop" hidden>Stop after current track</button> ' +
            '<span class="mb-safe-status" role="status">Exact title and artist credit; maximum 7 seconds. Multiple matches need manual review.</span>' +
            '<ol class="mb-safe-results"></ol>';
        panel.querySelector('.mb-safe-start').addEventListener('click', () => runMatcher(panel));
        panel.querySelector('.mb-safe-stop').addEventListener('click', () => { stopRequested = true; });
        container.prepend(panel);
        return true;
    }

    const noteRoot = document.getElementById('edit-note');
    if (noteRoot) new MutationObserver(appendNoteIfPossible).observe(noteRoot, {childList: true, subtree: true});
    document.getElementById('enter-edit')?.addEventListener('click', appendNoteIfPossible, true);
    if (!addControls()) {
        const observer = new MutationObserver(() => { if (addControls()) observer.disconnect(); });
        observer.observe(document.body, {childList: true, subtree: true});
    }
})();
