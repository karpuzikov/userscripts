// ==UserScript==
// @name         MusicBrainz - Import Apple Music Composition & Lyrics
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Import Apple Music Composition & Lyrics credits into MusicBrainz work relationships.
// @author       karpuzikov
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/apple-music-composition-lyrics-importer/MusicBrainz_Apple_Music_Composition_Lyrics_Importer.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/apple-music-composition-lyrics-importer/MusicBrainz_Apple_Music_Composition_Lyrics_Importer.user.js
// @supportURL   https://github.com/karpuzikov/userscripts
// @match        https://musicbrainz.org/release/*/edit-relationships
// @match        https://beta.musicbrainz.org/release/*/edit-relationships
// @connect      music.apple.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(() => {
    'use strict';

    const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const MB = PAGE.MB;

    const LINK_TYPES = {
        songwriter: { id: 167, label: 'writer' },
        writer: { id: 167, label: 'writer' },
        composer: { id: 168, label: 'composer' },
        lyrics: { id: 165, label: 'lyricist' },
        lyricist: { id: 165, label: 'lyricist' },
        librettist: { id: 169, label: 'librettist' },
        translator: { id: 872, label: 'translator' },
        arranger: { id: 293, label: 'arranger' },
        'instrument arranger': { id: 282, label: 'instrument arranger' },
        orchestrator: { id: 164, label: 'orchestrator' },
        'vocal arranger': { id: 294, label: 'vocal arranger' },
    };

    const REL_DEFAULTS = {
        _lineage: [],
        _original: null,
        _status: 1,
        attributes: null,
        begin_date: null,
        editsPending: false,
        end_date: null,
        ended: false,
        entity0_credit: '',
        entity1_credit: '',
        id: null,
        linkOrder: 0,
        linkTypeID: null,
    };

    const state = {
        appleUrl: '',
        appleTracks: [],
        rows: [],
        people: new Map(),
        applied: false,
    };

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function normalizeText(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeLucene(value) {
        return String(value).replace(/([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1');
    }

    function isMbid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    }

    function extractMbid(value) {
        const match = String(value || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
        return match ? match[0].toLowerCase() : '';
    }

    function walk(value, callback, seen = new Set()) {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);
        callback(value);
        if (Array.isArray(value)) {
            for (const item of value) walk(item, callback, seen);
        } else {
            for (const item of Object.values(value)) walk(item, callback, seen);
        }
    }

    function parseAppleServerData(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const node = doc.querySelector('#serialized-server-data');
        if (!node) {
            throw new Error('Apple Music page does not contain serialized-server-data.');
        }
        try {
            return JSON.parse(node.textContent);
        } catch (error) {
            throw new Error(`Apple Music data could not be parsed: ${error.message}`);
        }
    }

    function getAppleTracks(serverData) {
        const tracks = new Map();

        walk(serverData, object => {
            const id = object?.contentDescriptor?.identifiers?.storeAdamID;
            if (
                object?.contentDescriptor?.kind === 'song' &&
                id &&
                Number.isFinite(object.trackNumber) &&
                object.title
            ) {
                const key = String(id);
                if (!tracks.has(key)) {
                    tracks.set(key, {
                        id: key,
                        title: String(object.title),
                        trackNumber: Number(object.trackNumber),
                        discNumber: Number(object.discNumber || 1),
                        url: object.contentDescriptor.url || '',
                    });
                }
            }
        });

        return [...tracks.values()].sort(
            (a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber
        );
    }

    function getCompositionLyrics(serverData) {
        let section = null;

        walk(serverData, object => {
            if (
                !section &&
                Array.isArray(object?.items) &&
                (object.id === 'composer-and-lyrics' || object.title === 'Composition & Lyrics')
            ) {
                section = object;
            }
        });

        if (!section) return [];

        const credits = [];
        for (const item of section.items || []) {
            const name = String(item?.name || '').trim();
            const roles = Array.isArray(item?.roleNames)
                ? item.roleNames.map(role => String(role).trim()).filter(Boolean)
                : [];
            if (name && roles.length) credits.push({ name, roles });
        }
        return credits;
    }

    function songCreditsUrl(track, fallbackAlbumUrl) {
        const source = new URL(track.url || fallbackAlbumUrl);
        const parts = source.pathname.split('/').filter(Boolean);
        const albumIndex = parts.indexOf('album');
        const storefront = parts[0] || 'us';
        const slug = albumIndex >= 0 && parts[albumIndex + 1]
            ? parts[albumIndex + 1]
            : encodeURIComponent(track.title.toLowerCase().replace(/\s+/g, '-'));
        return `${source.origin}/${storefront}/song/${slug}/${encodeURIComponent(track.id)}`;
    }

    function gmGet(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: {
                    Accept: 'text/html,application/xhtml+xml',
                },
                timeout: 60000,
                onload(response) {
                    if (response.status >= 200 && response.status < 400) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error(`HTTP ${response.status} for ${url}`));
                    }
                },
                ontimeout() {
                    reject(new Error(`Timed out while loading ${url}`));
                },
                onerror() {
                    reject(new Error(`Failed to load ${url}`));
                },
            });
        });
    }

    async function mapPool(items, concurrency, worker) {
        const results = new Array(items.length);
        let nextIndex = 0;

        async function run() {
            while (true) {
                const index = nextIndex++;
                if (index >= items.length) return;
                try {
                    results[index] = await worker(items[index], index);
                } catch (error) {
                    results[index] = { error };
                }
            }
        }

        await Promise.all(
            Array.from({ length: Math.min(concurrency, items.length) }, run)
        );
        return results;
    }

    function getMbTrack(discNumber, trackNumber) {
        const mediums = MB?.relationshipEditor?.state?.entity?.mediums || [];
        const medium =
            mediums.find(item => Number(item.position) === Number(discNumber)) ||
            mediums[Number(discNumber) - 1];

        if (!medium) return null;

        const tracks = medium.tracks || [];
        return (
            tracks.find(item => Number(item.position) === Number(trackNumber)) ||
            tracks[Number(trackNumber) - 1] ||
            null
        );
    }

    function getTrackWorks(track) {
        const recording = track?.recording;
        if (!recording) return [];

        const relationships = recording.relationships || [];
        const works = [];
        const seen = new Set();

        for (const relationship of relationships) {
            const target = relationship?.target;
            const isWork =
                relationship?.target_type === 'work' ||
                target?.entityType === 'work';

            if (!isWork || !target) continue;

            const key = target.gid || target.id || target.name;
            if (seen.has(key)) continue;
            seen.add(key);
            works.push(target);
        }

        return works;
    }

    function classifyRole(role) {
        const normalized = normalizeText(role);
        return LINK_TYPES[normalized] || null;
    }

    function flattenSupportedCredits(credits) {
        const output = [];

        for (const credit of credits) {
            for (const role of credit.roles) {
                const link = classifyRole(role);
                if (link) {
                    output.push({
                        appleName: credit.name,
                        appleRole: role,
                        linkTypeID: link.id,
                        mbRole: link.label,
                    });
                }
            }
        }

        return output;
    }

    function existingRelationship(work, artist, linkTypeID) {
        const relationships = work?.relationships || [];
        const artistGid = artist?.gid;

        return relationships.some(rel => {
            const target = rel?.target;
            const source = rel?.source;
            const sameArtist =
                target?.gid === artistGid ||
                source?.gid === artistGid ||
                rel?.entity0?.gid === artistGid ||
                rel?.entity1?.gid === artistGid;

            return sameArtist && Number(rel?.linkTypeID) === Number(linkTypeID);
        });
    }

    function addRelationship(work, artist, linkTypeID, creditedAs) {
        const backward =
            work.entityType === artist.entityType
                ? false
                : work.entityType > artist.entityType;

        const entity0 = backward ? artist : work;
        const entity1 = backward ? work : artist;

        MB.relationshipEditor.dispatch({
            type: 'update-relationship-state',
            sourceEntity: work,
            batchSelectionCount: null,
            creditsToChangeForSource: '',
            creditsToChangeForTarget: '',
            newRelationshipState: {
                ...REL_DEFAULTS,
                entity0,
                entity1,
                entity0_credit: entity0.entityType === 'artist' ? creditedAs : '',
                entity1_credit: entity1.entityType === 'artist' ? creditedAs : '',
                id: MB.relationshipEditor.getRelationshipStateId(),
                linkTypeID,
            },
            oldRelationshipState: null,
        });
    }

    function setReactTextareaValue(input, value) {
        const descriptor = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value'
        );
        descriptor.set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function addEditNote() {
        const note = document.getElementById('edit-note-text');
        if (!note || state.applied) return;

        const sourceLine = `Apple Music Composition & Lyrics: ${state.appleUrl}`;
        const scriptLine = 'Imported with MusicBrainz - Import Apple Music Composition & Lyrics\nScript: https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/apple-music-composition-lyrics-importer/MusicBrainz_Apple_Music_Composition_Lyrics_Importer.user.js';
        const current = note.value.trimEnd();
        const addition = `${sourceLine}\n${scriptLine}`;

        setReactTextareaValue(note, current ? `${current}\n\n${addition}` : addition);
        state.applied = true;
    }

    async function searchArtists(name) {
        const query = `artist:"${escapeLucene(name)}" OR alias:"${escapeLucene(name)}"`;
        const url = `/ws/2/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
        const response = await fetch(url, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
            throw new Error(`MusicBrainz artist search failed: HTTP ${response.status}`);
        }

        const json = await response.json();
        return (json.artists || []).map(artist => ({
            mbid: artist.id,
            name: artist.name || '',
            disambiguation: artist.disambiguation || '',
            country: artist.country || '',
            type: artist.type || '',
            score: Number(artist.score ?? 0),
            aliases: (artist.aliases || []).map(alias => alias.name).filter(Boolean),
        }));
    }

    function exactCandidateIndexes(name, candidates) {
        const wanted = normalizeText(name);
        const indexes = [];

        candidates.forEach((candidate, index) => {
            const names = [candidate.name, ...candidate.aliases].map(normalizeText);
            if (names.includes(wanted)) indexes.push(index);
        });

        return indexes;
    }

    async function fetchMbEntity(mbid) {
        const response = await fetch(`/ws/js/entity/${encodeURIComponent(mbid)}`, {
            credentials: 'same-origin',
        });

        if (!response.ok) {
            throw new Error(`Cannot load MusicBrainz artist ${mbid}: HTTP ${response.status}`);
        }

        const entity = await response.json();
        if (!entity.entityType) entity.entityType = 'artist';
        return entity;
    }

    function selectedMbid(person) {
        const row = document.querySelector(`[data-person-key="${CSS.escape(person.key)}"]`);
        if (!row) return '';

        const manual = extractMbid(row.querySelector('.am2mb-manual')?.value || '');
        if (manual) return manual;

        return row.querySelector('.am2mb-candidate')?.value || '';
    }

    function setStatus(message, kind = '') {
        const status = document.getElementById('am2mb-status');
        if (!status) return;
        status.textContent = message;
        status.dataset.kind = kind;
    }

    function renderTracks() {
        const container = document.getElementById('am2mb-tracks');
        if (!container) return;

        const rows = state.rows.map(row => {
            const creditsText = row.supportedCredits.length
                ? row.supportedCredits
                    .map(item => `${item.appleName} (${item.appleRole} -> ${item.mbRole})`)
                    .join(', ')
                : row.credits.length
                    ? row.credits
                        .map(item => `${item.name} (${item.roles.join(', ')})`)
                        .join(', ')
                    : 'No Composition & Lyrics credits';

            let status = 'Ready';
            let css = 'ok';

            if (row.error) {
                status = row.error;
                css = 'bad';
            } else if (!row.mbTrack) {
                status = 'No matching MusicBrainz track';
                css = 'bad';
            } else if (!row.titleMatch) {
                status = `Title mismatch: MusicBrainz "${row.mbTitle}"`;
                css = 'bad';
            } else if (row.works.length === 0) {
                status = 'No Work linked to this recording';
                css = 'bad';
            } else if (row.works.length > 1) {
                status = `Multiple Works linked (${row.works.length}) - skipped`;
                css = 'bad';
            } else if (!row.supportedCredits.length) {
                status = 'No supported Composition & Lyrics roles';
                css = 'warn';
            }

            return `
                <tr>
                    <td>${row.appleTrack.discNumber}.${row.appleTrack.trackNumber}</td>
                    <td>${escapeHtml(row.appleTrack.title)}</td>
                    <td>${escapeHtml(row.works[0]?.name || '')}</td>
                    <td>${escapeHtml(creditsText)}</td>
                    <td class="${css}">${escapeHtml(status)}</td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <h3>Tracks</h3>
            <div class="am2mb-scroll">
                <table class="tbl">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Apple Music</th>
                            <th>MusicBrainz Work</th>
                            <th>Composition & Lyrics</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    function renderPeople() {
        const container = document.getElementById('am2mb-people');
        if (!container) return;

        const rows = [...state.people.values()].map(person => {
            const candidateOptions = [
                '<option value="">-- choose MusicBrainz artist --</option>',
                ...person.candidates.map(candidate => {
                    const details = [
                        candidate.disambiguation,
                        candidate.type,
                        candidate.country,
                        candidate.score ? `score ${candidate.score}` : '',
                    ].filter(Boolean).join(' | ');
                    const label = details
                        ? `${candidate.name} - ${details}`
                        : candidate.name;
                    return `<option value="${escapeHtml(candidate.mbid)}">${escapeHtml(label)}</option>`;
                }),
            ];

            const exact = exactCandidateIndexes(person.name, person.candidates);
            const autoIndex = exact.length === 1 ? exact[0] : -1;

            return `
                <tr data-person-key="${escapeHtml(person.key)}">
                    <td><strong>${escapeHtml(person.name)}</strong></td>
                    <td>${escapeHtml([...person.roles].join(', '))}</td>
                    <td>
                        <select class="am2mb-candidate">
                            ${candidateOptions.join('')}
                        </select>
                    </td>
                    <td>
                        <input class="am2mb-manual" type="text"
                            placeholder="Artist MBID or MusicBrainz artist URL">
                    </td>
                    <td class="am2mb-auto"
                        data-auto-index="${autoIndex}">
                        ${autoIndex >= 0 ? 'Exact name/alias match' : 'Review required'}
                    </td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <h3>Artist mapping</h3>
            <p class="am2mb-hint">
                Exact unique MusicBrainz name/alias matches are selected automatically.
                Review every mapping before applying.
            </p>
            <div class="am2mb-scroll">
                <table class="tbl">
                    <thead>
                        <tr>
                            <th>Apple Music credit</th>
                            <th>Role(s)</th>
                            <th>MusicBrainz candidate</th>
                            <th>Manual MBID / URL</th>
                            <th>Match</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <p>
                <button type="button" id="am2mb-apply" class="positive">
                    Apply credits to Works
                </button>
            </p>
        `;

        for (const row of container.querySelectorAll('tr[data-person-key]')) {
            const autoIndex = Number(row.querySelector('.am2mb-auto')?.dataset.autoIndex ?? -1);
            if (autoIndex >= 0) {
                row.querySelector('.am2mb-candidate').selectedIndex = autoIndex + 1;
            }
        }

        document.getElementById('am2mb-apply').addEventListener('click', applyCredits);
    }

    async function loadAppleCredits() {
        const input = document.getElementById('am2mb-url');
        const button = document.getElementById('am2mb-load');
        const urlText = input.value.trim();

        try {
            const url = new URL(urlText);
            if (url.hostname !== 'music.apple.com' || !url.pathname.includes('/album/')) {
                throw new Error('Paste an Apple Music album/release URL.');
            }

            if (!MB?.relationshipEditor?.state?.entity) {
                throw new Error('MusicBrainz relationship editor is not ready.');
            }

            state.appleUrl = url.href;
            state.appleTracks = [];
            state.rows = [];
            state.people.clear();
            state.applied = false;

            button.disabled = true;
            document.getElementById('am2mb-tracks').innerHTML = '';
            document.getElementById('am2mb-people').innerHTML = '';

            setStatus('Loading Apple Music release...');
            const albumHtml = await gmGet(state.appleUrl);
            const albumData = parseAppleServerData(albumHtml);
            const appleTracks = getAppleTracks(albumData);

            if (!appleTracks.length) {
                throw new Error('No Apple Music tracks were found on this page.');
            }

            state.appleTracks = appleTracks;
            setStatus(`Found ${appleTracks.length} tracks. Loading Composition & Lyrics credits...`);

            const creditResults = await mapPool(appleTracks, 4, async (track, index) => {
                setStatus(
                    `Loading Apple Music credits ${index + 1}/${appleTracks.length}: ${track.title}`
                );
                const creditsUrl = songCreditsUrl(track, state.appleUrl);
                const html = await gmGet(creditsUrl);
                const data = parseAppleServerData(html);
                return {
                    creditsUrl,
                    credits: getCompositionLyrics(data),
                };
            });

            state.rows = appleTracks.map((appleTrack, index) => {
                const result = creditResults[index];
                const mbTrack = getMbTrack(appleTrack.discNumber, appleTrack.trackNumber);
                const mbTitle = mbTrack?.name || '';
                const works = getTrackWorks(mbTrack);
                const credits = result?.credits || [];
                const supportedCredits = flattenSupportedCredits(credits);

                return {
                    appleTrack,
                    creditsUrl: result?.creditsUrl || '',
                    credits,
                    supportedCredits,
                    mbTrack,
                    mbTitle,
                    works,
                    titleMatch: !!mbTrack && normalizeText(appleTrack.title) === normalizeText(mbTitle),
                    error: result?.error ? result.error.message : '',
                };
            });

            for (const row of state.rows) {
                if (
                    row.error ||
                    !row.mbTrack ||
                    !row.titleMatch ||
                    row.works.length !== 1
                ) {
                    continue;
                }

                for (const credit of row.supportedCredits) {
                    const key = normalizeText(credit.appleName);
                    if (!state.people.has(key)) {
                        state.people.set(key, {
                            key,
                            name: credit.appleName,
                            roles: new Set(),
                            candidates: [],
                        });
                    }
                    state.people.get(key).roles.add(credit.appleRole);
                }
            }

            renderTracks();

            if (!state.people.size) {
                throw new Error('No importable Apple Music Composition & Lyrics credits were found.');
            }

            const people = [...state.people.values()];
            for (let index = 0; index < people.length; index++) {
                const person = people[index];
                setStatus(
                    `Searching MusicBrainz artists ${index + 1}/${people.length}: ${person.name}`
                );
                person.candidates = await searchArtists(person.name);
                if (index < people.length - 1) await wait(1100);
            }

            renderPeople();

            const readyTracks = state.rows.filter(row =>
                !row.error &&
                row.mbTrack &&
                row.titleMatch &&
                row.works.length === 1 &&
                row.supportedCredits.length
            ).length;

            setStatus(
                `Loaded ${appleTracks.length} Apple Music tracks. ${readyTracks} track(s) are ready for review.`,
                'ok'
            );
        } catch (error) {
            console.error('[Apple Music -> MusicBrainz]', error);
            setStatus(error.message, 'bad');
        } finally {
            button.disabled = false;
        }
    }

    async function applyCredits() {
        const button = document.getElementById('am2mb-apply');
        if (!button) return;

        try {
            button.disabled = true;

            const entityCache = new Map();
            const mapping = new Map();

            for (const person of state.people.values()) {
                const mbid = selectedMbid(person);
                if (!mbid) {
                    throw new Error(`Choose a MusicBrainz artist for "${person.name}".`);
                }
                if (!isMbid(mbid)) {
                    throw new Error(`Invalid MusicBrainz artist MBID for "${person.name}".`);
                }

                if (!entityCache.has(mbid)) {
                    setStatus(`Loading MusicBrainz artist: ${person.name}`);
                    const entity = await fetchMbEntity(mbid);
                    entityCache.set(mbid, entity);
                }

                mapping.set(person.key, entityCache.get(mbid));
            }

            let added = 0;
            let skippedExisting = 0;
            let skippedTracks = 0;

            for (const row of state.rows) {
                if (
                    row.error ||
                    !row.mbTrack ||
                    !row.titleMatch ||
                    row.works.length !== 1 ||
                    !row.supportedCredits.length
                ) {
                    skippedTracks++;
                    continue;
                }

                const work = row.works[0];

                for (const credit of row.supportedCredits) {
                    const artist = mapping.get(normalizeText(credit.appleName));
                    if (!artist) continue;

                    if (existingRelationship(work, artist, credit.linkTypeID)) {
                        skippedExisting++;
                        continue;
                    }

                    addRelationship(
                        work,
                        artist,
                        credit.linkTypeID,
                        credit.appleName
                    );
                    added++;
                }
            }

            addEditNote();

            setStatus(
                `Applied ${added} Work relationship(s). ` +
                `${skippedExisting} existing relationship(s) skipped. ` +
                `${skippedTracks} track(s) skipped. Review the green edits, then submit normally.`,
                'ok'
            );
        } catch (error) {
            console.error('[Apple Music -> MusicBrainz]', error);
            setStatus(error.message, 'bad');
        } finally {
            button.disabled = false;
        }
    }

    function injectUi() {
        if (document.getElementById('am2mb-panel')) return;

        const tabs = document.querySelector('div.tabs');
        const form = document.getElementById('relationship-editor-form');
        if (!tabs || !form) {
            setTimeout(injectUi, 500);
            return;
        }

        const panel = document.createElement('div');
        panel.id = 'am2mb-panel';
        panel.innerHTML = `
            <style>
                #am2mb-panel {
                    margin: 1em 0;
                    padding: 12px;
                    border: 1px solid #aaa;
                    border-radius: 6px;
                    background: var(--background, #fff);
                }
                #am2mb-panel h2,
                #am2mb-panel h3 {
                    margin-top: 0;
                }
                #am2mb-panel .am2mb-controls {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                    flex-wrap: wrap;
                }
                #am2mb-panel #am2mb-url {
                    flex: 1 1 620px;
                    min-width: 260px;
                }
                #am2mb-panel #am2mb-status {
                    margin: 10px 0 0;
                    font-weight: 600;
                }
                #am2mb-panel #am2mb-status[data-kind="bad"],
                #am2mb-panel td.bad {
                    color: #b00020;
                }
                #am2mb-panel #am2mb-status[data-kind="ok"],
                #am2mb-panel td.ok {
                    color: #087a28;
                }
                #am2mb-panel td.warn {
                    color: #9b6500;
                }
                #am2mb-panel .am2mb-scroll {
                    overflow-x: auto;
                    margin-bottom: 14px;
                }
                #am2mb-panel table.tbl {
                    width: 100%;
                    border-collapse: collapse;
                }
                #am2mb-panel table.tbl th,
                #am2mb-panel table.tbl td {
                    padding: 5px 7px;
                    vertical-align: top;
                }
                #am2mb-panel .am2mb-candidate {
                    min-width: 290px;
                    max-width: 420px;
                }
                #am2mb-panel .am2mb-manual {
                    min-width: 285px;
                }
                #am2mb-panel .am2mb-hint {
                    margin-top: -4px;
                }
            </style>

            <h2>Import Apple Music Composition & Lyrics</h2>
            <div class="am2mb-controls">
                <input id="am2mb-url" type="url"
                    placeholder="https://music.apple.com/.../album/...">
                <button type="button" id="am2mb-load">Load credits</button>
            </div>
            <p id="am2mb-status">
                Paste the Apple Music release URL for this MusicBrainz release.
            </p>
            <div id="am2mb-tracks"></div>
            <div id="am2mb-people"></div>
        `;

        tabs.insertAdjacentElement('afterend', panel);
        document.getElementById('am2mb-load').addEventListener('click', loadAppleCredits);
    }

    injectUi();
})();