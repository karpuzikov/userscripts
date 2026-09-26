// ==UserScript==
// @name         MusicBrainz - Safe Recording Matcher
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.2.0
// @description  Match recordings by title/artist or pasted ISRCs, with a strict seven-second duration limit.
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

    function chooseByIsrc(track, candidates) {
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
        if (!ranked.length) return {reason: 'No recording with matching title, artist and length within 7 seconds'};
        if (ranked.length > 1 && ranked[0].difference === ranked[1].difference) {
            return {reason: 'Two recordings are equally close; review manually'};
        }
        return {id: ranked[0].candidate.id, candidate: ranked[0].candidate};
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

    if (!/^\/release\/(?:add|[0-9a-f-]{36}\/edit)\/?$/i.test(location.pathname)) return;

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const resultCache = new Map();
    const artistCache = new Map();
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

    async function searchQuery(query) {
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

    function releaseArtistIds() {
        const release = window.MB?.releaseEditor?.rootField?.release?.();
        const names = release?.artistCredit?.()?.names;
        if (!Array.isArray(names)) return [];
        return [...new Set(names.map(part => part?.artist?.gid).filter(id => UUID.test(id)))];
    }

    async function artistInfo(id) {
        const key = String(id ?? '').toLowerCase();
        if (!UUID.test(key)) return null;
        if (artistCache.has(key)) return artistCache.get(key);

        await throttle();
        const response = await fetch('/ws/2/artist/' + key + '?fmt=json&inc=aliases', {
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

        return {reason: 'No safe recording found in C1-C4'};
    }

    function searchByIsrc(code) {
        return searchQuery('isrc:' + code);
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
            if (!row.isConnected || !maySelectUnlinkedRow(row)) {
                throw new Error('The track changed or was linked while opening the editor');
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

    async function selectInEditor(row, track, candidate, editor) {
        const {button, element, model, input} = editor;
        const assertCurrentTarget = () => {
            const current = readTrack(row);
            if (!row.isConnected || !maySelectUnlinkedRow(row) || !bubbleTargetsRow(model, row) ||
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
        const linked = await waitFor(() => {
            const current = readLinkedRecording(row);
            return current.id?.toLowerCase() === candidate.id.toLowerCase() ? current : null;
        }, 12000);
        if (!linked) throw new Error('MusicBrainz did not confirm the recording lookup');

        // The rendered recording length is rounded; the API length is exact.
        const verified = evaluateCandidate(track, {...linked, length: candidate.length});
        if (!verified.ok || linked.length === null || Math.abs(linked.length - candidate.length) > 500) {
            if (bubbleTargetsRow(model, row) &&
                readLinkedRecording(row).id?.toLowerCase() === candidate.id.toLowerCase()) {
                element.querySelector('#add-new-recording')?.click();
            }
            throw new Error('Editor linked a recording with different metadata');
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

    async function runMatcher(panel, isrcs = null) {
        if (running) return;
        const rows = [...document.querySelectorAll('#recordings tr.track')];
        const button = panel.querySelector('.mb-safe-start');
        const isrcButton = panel.querySelector('.mb-safe-isrc');
        const stop = panel.querySelector('.mb-safe-stop');
        const status = panel.querySelector('.mb-safe-status');
        const list = panel.querySelector('.mb-safe-results');
        list.replaceChildren();
        if (!rows.length) {
            status.textContent = 'No loaded tracks. Open the Recordings tab and load the medium first.';
            return;
        }
        if (isrcs && (isrcs.length !== rows.length || document.querySelector('#recordings .edit-recording'))) {
            status.textContent = 'The loaded track count changed or a medium is not loaded. Open all media and paste the ISRCs again.';
            return;
        }

        running = true;
        stopRequested = false;
        button.disabled = true;
        isrcButton.disabled = true;
        stop.hidden = false;
        let matched = 0;
        let review = 0;
        let processed = 0;
        try {
            for (const row of rows) {
                if (stopRequested) break;
                if (isrcs && !trackRowsUnchanged(rows)) {
                    status.textContent = `Stopped: The track order changed. ${matched} matched, ${review} need review.`;
                    break;
                }
                processed++;
                const track = readTrack(row);
                const isrc = isrcs?.[processed - 1];
                const display = `${track.title || '(untitled)'}${isrc ? ' (' + isrc + ')' : ''}`;
                status.textContent = `Checking ${processed}/${rows.length}: ${track.title || '(untitled)'}${isrc ? ' (' + isrc + ')' : ''}`;

                if (!maySelectUnlinkedRow(row)) {
                    showResult(list, row, 'Already linked', display);
                    continue;
                }
                if (!track.title || !track.artistIds.length || track.artistIds.some(id => !UUID.test(id)) || !track.credit) {
                    review++;
                    showResult(list, row, 'Review', `${display} - missing title or artist ID`);
                    continue;
                }

                let editor;
                try {
                    editor = await openEditor(row);
                    track.length = editor.trackLength;
                } catch (error) {
                    review++;
                    showResult(list, row, 'Review', `${display} - ${error.message}`);
                    continue;
                }

                let chosen;
                try {
                    if (isrc) {
                        const search = await searchByIsrc(isrc);
                        chosen = search.reason ? {reason: search.reason} : chooseByIsrc(track, search.recordings);
                    } else {
                        chosen = await searchRecordings(track);
                    }
                } catch (error) {
                    review++;
                    showResult(list, row, 'Review', `${display} - ${error.message}`);
                    continue;
                }
                if (isrcs && !trackRowsUnchanged(rows)) {
                    status.textContent = `Stopped: The track order changed. ${matched} matched, ${review} need review.`;
                    break;
                }
                if (!chosen.id) {
                    review++;
                    showResult(list, row, 'Review', `${display} - ${chosen.reason}`);
                    continue;
                }

                try {
                    await selectInEditor(row, track, chosen.candidate, editor);
                    matched++;
                    needsAttribution = true;
                    appendNoteIfPossible();
                    showResult(list, row, 'Matched', display + (chosen.circle ? ' - ' + chosen.circle : ''), chosen.id);
                } catch (error) {
                    review++;
                    showResult(list, row, 'Review', `${display} - ${error.message}`);
                    continue;
                }
            }
            if (!status.textContent.startsWith('Stopped:')) {
                status.textContent = `${stopRequested ? 'Stopped' : 'Finished'}: ${matched} matched, ${review} need review, ${processed}/${rows.length} checked. Review all associations before submitting.`;
            }
        } finally {
            running = false;
            button.disabled = false;
            isrcButton.disabled = false;
            stop.hidden = true;
            appendNoteIfPossible();
        }
    }

    function openIsrcDialog(panel) {
        if (running || document.getElementById('mb-safe-isrc-dialog')) return;
        const rows = [...document.querySelectorAll('#recordings tr.track')];
        const trigger = panel.querySelector('.mb-safe-isrc');
        const backdrop = document.createElement('div');
        backdrop.id = 'mb-safe-isrc-dialog';
        backdrop.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:1rem';
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'mb-safe-isrc-title');
        dialog.style.cssText = 'box-sizing:border-box;width:min(42rem,100%);max-height:90vh;overflow:auto;background:Canvas;color:CanvasText;padding:1.25rem;border:1px solid GrayText;border-radius:.4rem;box-shadow:0 .5rem 2rem #0008';
        dialog.innerHTML = '<h2 id="mb-safe-isrc-title">Match by ISRC</h2>' +
            '<p>Paste one ISRC per track in release order. A plain list or table works. Include tracks already linked.</p>' +
            '<label for="mb-safe-isrc-input">ISRCs</label><br>' +
            '<textarea id="mb-safe-isrc-input" rows="12" style="box-sizing:border-box;width:100%" spellcheck="false" placeholder="NLA321400132\nNLA321400141\nNLA321400142"></textarea>' +
            '<p class="mb-safe-isrc-error" role="alert"></p>' +
            '<button type="button" class="mb-safe-isrc-confirm">Match tracks</button> ' +
            '<button type="button" class="mb-safe-isrc-cancel">Cancel</button>';
        backdrop.append(dialog);
        document.body.append(backdrop);
        const input = dialog.querySelector('textarea');
        const error = dialog.querySelector('.mb-safe-isrc-error');
        const confirm = dialog.querySelector('.mb-safe-isrc-confirm');
        const cancel = dialog.querySelector('.mb-safe-isrc-cancel');
        const close = () => {
            backdrop.remove();
            trigger.focus();
        };
        const unavailable = !rows.length || Boolean(document.querySelector('#recordings .edit-recording'));
        if (unavailable) {
            error.textContent = 'Open the Recordings tab and load every medium before matching ISRCs.';
            confirm.disabled = true;
        } else {
            dialog.querySelector('p').textContent += ` ${rows.length} tracks are loaded.`;
        }
        confirm.addEventListener('click', () => {
            try {
                if (document.querySelector('#recordings .edit-recording') || !trackRowsUnchanged(rows)) {
                    throw new Error('The track list changed. Close this window and paste the ISRCs again.');
                }
                const codes = parseIsrcInput(input.value, rows.length);
                close();
                runMatcher(panel, codes);
            } catch (cause) {
                error.textContent = cause.message;
            }
        });
        cancel.addEventListener('click', close);
        backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
        backdrop.addEventListener('keydown', event => {
            if (event.key === 'Escape') close();
            if (event.key === 'Tab') {
                const focusables = [input, confirm, cancel].filter(element => !element.disabled);
                if (event.shiftKey && document.activeElement === focusables[0]) {
                    event.preventDefault();
                    focusables.at(-1).focus();
                } else if (!event.shiftKey && document.activeElement === focusables.at(-1)) {
                    event.preventDefault();
                    focusables[0].focus();
                }
            }
        });
        input.focus();
    }

    function addControls() {
        if (document.getElementById('mb-safe-recording-matcher')) return true;
        const container = document.querySelector('#recordings .changes');
        if (!container) return false;
        const panel = document.createElement('fieldset');
        panel.id = 'mb-safe-recording-matcher';
        panel.innerHTML = '<legend>Safe recording matcher</legend>' +
            '<button type="button" class="mb-safe-start">Match unlinked recordings</button> ' +
            '<button type="button" class="mb-safe-isrc">Match by ISRC</button> ' +
            '<button type="button" class="mb-safe-stop" hidden>Stop after current track</button> ' +
            '<span class="mb-safe-status" role="status">Artist-circle search; equivalent title wording; maximum 7 seconds. Unsafe ties need manual review.</span>' +
            '<ol class="mb-safe-results"></ol>';
        panel.querySelector('.mb-safe-start').addEventListener('click', () => runMatcher(panel));
        panel.querySelector('.mb-safe-isrc').addEventListener('click', () => openIsrcDialog(panel));
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
