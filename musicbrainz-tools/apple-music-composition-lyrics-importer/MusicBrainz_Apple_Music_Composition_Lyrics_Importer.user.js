// ==UserScript==
// @name         Apple Music Credits -> MusicBrainz
// @namespace    https://github.com/karpuzikov/userscripts
// @version      2.3.5
// @description  Resolve the correct Apple Music release and import supported Apple Music credits to the proper MusicBrainz Recording, Work, or Release relationships.
// @author       karpuzikov
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/tampermonkey-apple-music-credits-v2.3.4/musicbrainz-tools/apple-music-composition-lyrics-importer/MusicBrainz_Apple_Music_Composition_Lyrics_Importer.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/refs/heads/main/musicbrainz-tools/apple-music-composition-lyrics-importer/MusicBrainz_Apple_Music_Composition_Lyrics_Importer.user.js
// @supportURL   https://github.com/karpuzikov/userscripts
// @match        https://musicbrainz.org/release/*/edit-relationships
// @match        https://beta.musicbrainz.org/release/*/edit-relationships
// @connect      music.apple.com
// @connect      itunes.apple.com
// @connect      geo.itunes.apple.com
// @connect      amp-api.music.apple.com
// @connect      *.mzstatic.com
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(() => {
    'use strict';

    const PAGE = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    let MB = PAGE.MB;
    const APPLE_API_BASE = 'https://amp-api.music.apple.com/v1';
    const APPLE_TOKEN_BOOTSTRAP_URL = 'https://music.apple.com/us/browse';
    const RECORDING_OF_LINK_TYPE_ID = 278;
    const WORK_TYPE_SONG_ID = 17;
    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/apple-music-composition-lyrics-importer/MusicBrainz_Apple_Music_Composition_Lyrics_Importer.user.js';
    const FALLBACK_STOREFRONTS = ['us', 'gb', 'de', 'fr', 'ca', 'au', 'jp', 'ua'];
    let appleToken = '';

    const MB_WS_MIN_INTERVAL = 1200;
    const MB_WS_MAX_RETRIES = 5;
    let mbWsLastRequestAt = 0;
    let mbWsQueue = Promise.resolve();
    const mbWsCache = new Map();

    const ROLE_TYPES = {
        // Work-level authorship. These describe the composition itself.
        songwriter: { target: 'work', id: 167, label: 'writer' },
        writer: { target: 'work', id: 167, label: 'writer' },
        composer: { target: 'work', id: 168, label: 'composer' },
        lyrics: { target: 'work', id: 165, label: 'lyricist' },
        lyricist: { target: 'work', id: 165, label: 'lyricist' },
        librettist: { target: 'work', id: 169, label: 'librettist' },
        translator: { target: 'work', id: 872, label: 'translator' },

        // Recording-level performance / production.
        programming: { target: 'recording', id: 132, label: 'programming' },
        programmer: { target: 'recording', id: 132, label: 'programming' },
        producer: { target: 'recording', id: 141, label: 'producer' },
        engineer: { target: 'recording', id: 138, label: 'engineer' },
        'audio engineer': { target: 'recording', id: 140, label: 'audio engineer' },
        'sound engineer': { target: 'recording', id: 133, label: 'sound engineer' },
        mixer: { target: 'recording', id: 143, label: 'mixer' },
        'mix engineer': { target: 'recording', id: 143, label: 'mixer' },
        'mixing engineer': { target: 'recording', id: 143, label: 'mixer' },
        'recording engineer': { target: 'recording', id: 128, label: 'recording engineer' },
        editor: { target: 'recording', id: 144, label: 'editor' },
        remixer: { target: 'recording', id: 153, label: 'remixer' },
        'dj mixer': { target: 'recording', id: 155, label: 'DJ-mixer' },
        performer: { target: 'recording', id: 156, label: 'performer' },
        vocal: { target: 'recording', id: 149, label: 'vocal' },
        vocals: { target: 'recording', id: 149, label: 'vocal' },
        conductor: { target: 'recording', id: 151, label: 'conductor' },
        orchestra: { target: 'recording', id: 150, label: 'performing orchestra' },
        arranger: { target: 'recording', id: 297, label: 'arranger' },
        'vocal arranger': { target: 'recording', id: 298, label: 'vocal arranger' },
        orchestrator: { target: 'recording', id: 300, label: 'orchestrator' },
        'balance engineer': { target: 'recording', id: 726, label: 'balance engineer' },
        'field recordist': { target: 'recording', id: 1011, label: 'field recordist' },

        // MusicBrainz explicitly keeps mastering at release level.
        mastering: { target: 'release', id: 42, label: 'mastering' },
        'mastering engineer': { target: 'release', id: 42, label: 'mastering' },
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
        mbBarcode: '',
        appleBarcode: '',
        sourceMode: '',
        appleTracks: [],
        rows: [],
        people: new Map(),
        creditedArtists: [],
        workLanguages: null,
        aliasEdits: 0,
        applied: false,
    };

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function ensureMusicBrainzEditorReady(timeout = 30000) {
        const started = Date.now();

        while (Date.now() - started < timeout) {
            const liveMb = PAGE.MB;
            if (
                liveMb?.relationshipEditor?.state?.entity &&
                typeof liveMb.relationshipEditor.dispatch === 'function'
            ) {
                MB = liveMb;
                return MB;
            }

            setStatus('Waiting for MusicBrainz relationship editor...');
            await wait(250);
        }

        throw new Error(
            'MusicBrainz relationship editor did not become ready within 30 seconds. Reload the page and try again.'
        );
    }

    function musicBrainzRetryDelay(response, attempt) {
        const retryAfter = response?.headers?.get?.('Retry-After') || '';
        if (/^\d+$/.test(retryAfter)) {
            return Math.max(1000, Number(retryAfter) * 1000);
        }

        const retryDate = Date.parse(retryAfter);
        if (Number.isFinite(retryDate)) {
            return Math.max(1000, retryDate - Date.now());
        }

        return Math.min(16000, 1500 * (2 ** (attempt - 1)));
    }

    async function runMusicBrainzWsRequest(url, label) {
        let lastError = null;

        for (let attempt = 1; attempt <= MB_WS_MAX_RETRIES; attempt++) {
            const spacing = MB_WS_MIN_INTERVAL - (Date.now() - mbWsLastRequestAt);
            if (spacing > 0) await wait(spacing);

            let response;
            try {
                mbWsLastRequestAt = Date.now();
                response = await fetch(url, {
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json' },
                });
            } catch (error) {
                lastError = error;
                if (attempt === MB_WS_MAX_RETRIES) break;

                const delay = Math.min(16000, 1500 * (2 ** (attempt - 1)));
                setStatus(`${label}: network error. Retrying in ${Math.ceil(delay / 1000)}s...`, 'warn');
                await wait(delay);
                continue;
            }

            if (response.ok) {
                try {
                    return await response.json();
                } catch {
                    throw new Error(`${label}: MusicBrainz returned invalid JSON.`);
                }
            }

            const retryable = [429, 502, 503, 504].includes(response.status);
            if (!retryable || attempt === MB_WS_MAX_RETRIES) {
                throw new Error(`${label} failed: HTTP ${response.status}`);
            }

            const delay = musicBrainzRetryDelay(response, attempt);
            setStatus(
                `${label}: MusicBrainz returned HTTP ${response.status}. Retrying ${attempt}/${MB_WS_MAX_RETRIES} in ${Math.ceil(delay / 1000)}s...`,
                'warn'
            );
            await wait(delay);
        }

        throw new Error(
            `${label} failed after ${MB_WS_MAX_RETRIES} attempts${lastError ? `: ${lastError.message}` : ''}.`
        );
    }

    function musicBrainzWsJson(url, label, cacheKey = '') {
        if (cacheKey && mbWsCache.has(cacheKey)) {
            return Promise.resolve(mbWsCache.get(cacheKey));
        }

        const task = async () => {
            const json = await runMusicBrainzWsRequest(url, label);
            if (cacheKey) mbWsCache.set(cacheKey, json);
            return json;
        };

        const queued = mbWsQueue.then(task, task);
        mbWsQueue = queued.catch(() => {});
        return queued;
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

    function normalizeTrackTitleForMatch(value) {
        let title = String(value || '').trim();

        // Apple Music commonly appends featured artists to the displayed track
        // title, while MusicBrainz stores them in the artist credit instead.
        // Ignore only terminal featured-artist suffixes for comparison.
        let previous;
        do {
            previous = title;
            title = title
                .replace(/\s*\(\s*(?:feat(?:uring)?|ft)\.?\s+[^)]*\)\s*$/i, '')
                .replace(/\s*\[\s*(?:feat(?:uring)?|ft)\.?\s+[^\]]*\]\s*$/i, '')
                .trim();
        } while (title !== previous);

        return normalizeText(title);
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

    function getAppleCredits(serverData) {
        const credits = [];
        const seen = new Set();

        walk(serverData, object => {
            if (!Array.isArray(object?.items)) return;

            const section = String(object.title || object.id || '').trim();
            for (const item of object.items) {
                const name = String(item?.name || '').trim();
                const roles = Array.isArray(item?.roleNames)
                    ? item.roleNames.map(role => String(role).trim()).filter(Boolean)
                    : [];
                if (!name || !roles.length) continue;

                for (const role of roles) {
                    const key = [
                        normalizeText(name),
                        normalizeText(role),
                    ].join('|');
                    if (seen.has(key)) continue;
                    seen.add(key);

                    credits.push({
                        name,
                        role,
                        section,
                    });
                }
            }
        });

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

    function normalizeBarcode(value) {
        return String(value || '').replace(/\D+/g, '');
    }

    function barcodeVariants(value) {
        const barcode = normalizeBarcode(value);
        const variants = new Set();
        if (!barcode) return variants;
        variants.add(barcode);
        if (barcode.length === 13 && barcode.startsWith('0')) variants.add(barcode.slice(1));
        if (barcode.length === 12) variants.add(`0${barcode}`);
        return variants;
    }

    function barcodesEqual(a, b) {
        const left = barcodeVariants(a);
        const right = barcodeVariants(b);
        for (const value of left) {
            if (right.has(value)) return true;
        }
        return false;
    }

    function releaseMbidFromLocation() {
        const match = location.pathname.match(/^\/release\/([0-9a-f-]{36})\/edit-relationships/i);
        return match ? match[1].toLowerCase() : '';
    }

    function isAppleReleaseUrl(value) {
        try {
            const url = new URL(value);
            const host = url.hostname.toLowerCase();
            const appleHost =
                host === 'music.apple.com' ||
                host === 'itunes.apple.com' ||
                host === 'geo.itunes.apple.com' ||
                host.endsWith('.itunes.apple.com');
            return appleHost && url.pathname.toLowerCase().includes('/album/');
        } catch {
            return false;
        }
    }

    function appleStorefrontFromUrl(value) {
        try {
            const url = new URL(value);
            const first = url.pathname.split('/').filter(Boolean)[0] || '';
            return /^[a-z]{2}$/i.test(first) ? first.toLowerCase() : '';
        } catch {
            return '';
        }
    }

    function appleAlbumIdFromUrl(value) {
        try {
            const url = new URL(value);
            const parts = url.pathname.split('/').filter(Boolean);
            const albumIndex = parts.findIndex(part => part.toLowerCase() === 'album');
            if (albumIndex < 0) return '';
            for (let index = parts.length - 1; index > albumIndex; index--) {
                const match = parts[index].match(/^(?:id)?(\d+)$/i);
                if (match) return match[1];
            }
            return '';
        } catch {
            return '';
        }
    }

    function canonicalAppleAlbumUrl(value) {
        try {
            const url = new URL(value);
            url.searchParams.delete('i');
            return url.href;
        } catch {
            return value;
        }
    }

    function getReleaseCountries(release) {
        const countries = [];
        for (const event of release?.['release-events'] || []) {
            const code = String(event?.area?.['iso-3166-1-codes']?.[0] || '').toLowerCase();
            if (/^[a-z]{2}$/.test(code) && !countries.includes(code)) countries.push(code);
        }
        return countries;
    }

    function collectCreditedArtists(release) {
        const artists = new Map();

        const addCredit = (credit, scope) => {
            for (const entry of credit || []) {
                const artist = entry?.artist;
                if (!artist?.id) continue;

                let item = artists.get(artist.id);
                if (!item) {
                    item = {
                        id: artist.id,
                        name: artist.name || '',
                        sortName: artist['sort-name'] || '',
                        creditedNames: new Set(),
                        scopes: new Set(),
                    };
                    artists.set(artist.id, item);
                }

                if (entry?.name) item.creditedNames.add(String(entry.name));
                if (artist?.name) item.creditedNames.add(String(artist.name));
                item.scopes.add(scope);
            }
        };

        addCredit(release?.['artist-credit'], 'release');

        for (const medium of release?.media || []) {
            for (const track of medium?.tracks || []) {
                addCredit(track?.['artist-credit'], 'track');
                addCredit(track?.recording?.['artist-credit'], 'recording');
            }
        }

        return [...artists.values()];
    }

    async function getMusicBrainzReleaseSourceData() {
        const mbid = releaseMbidFromLocation();
        if (!mbid) throw new Error('Cannot determine the MusicBrainz release MBID.');

        const releaseUrl = `/ws/2/release/${encodeURIComponent(mbid)}?inc=url-rels+artist-credits+recordings&fmt=json`;
        const release = await musicBrainzWsJson(
            releaseUrl,
            'MusicBrainz release lookup',
            `release:${mbid}:url-rels+artist-credits+recordings`
        );

        state.creditedArtists = collectCreditedArtists(release);

        const barcode = normalizeBarcode(release.barcode);
        const links = [...new Set(
            (release.relations || [])
                .map(relation => relation?.url?.resource || '')
                .filter(isAppleReleaseUrl)
        )];

        return {
            mbid,
            release,
            barcode,
            links,
            countries: getReleaseCountries(release),
        };
    }

    function gmRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url,
                headers: options.headers || {},
                timeout: options.timeout || 60000,
                onload(response) {
                    if (response.status >= 200 && response.status < 400) {
                        resolve(response);
                    } else {
                        const error = new Error(`HTTP ${response.status} for ${url}`);
                        error.status = response.status;
                        reject(error);
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

    async function gmGet(url) {
        const response = await gmRequest(url, {
            headers: { Accept: 'text/html,application/xhtml+xml' },
        });
        return response.responseText;
    }

    async function getAppleTokenFromHtml(html, pageUrl) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const scripts = [...doc.querySelectorAll('script[src][crossorigin], script[src]')]
            .map(node => {
                try {
                    return new URL(node.getAttribute('src'), pageUrl).href;
                } catch {
                    return '';
                }
            })
            .filter(Boolean);

        const prioritized = [
            ...scripts.filter(url => /music|index|config|app/i.test(url)),
            ...scripts.filter(url => !/music|index|config|app/i.test(url)),
        ];

        for (const scriptUrl of [...new Set(prioritized)]) {
            try {
                const script = await gmRequest(scriptUrl, {
                    headers: { Accept: '*/*' },
                    timeout: 30000,
                });
                const match = script.responseText.match(/["'](eyJ[A-Za-z0-9._-]+)["']/) ||
                    script.responseText.match(/(["'])(ey[^"']+)\1/);
                if (match) return match[2] || match[1];
            } catch {
                // Try the next script asset.
            }
        }
        return '';
    }

    async function ensureAppleToken(pageHtml = '', pageUrl = '') {
        if (appleToken) return appleToken;

        if (pageHtml && pageUrl) {
            appleToken = await getAppleTokenFromHtml(pageHtml, pageUrl);
            if (appleToken) return appleToken;
        }

        const bootstrap = await gmRequest(APPLE_TOKEN_BOOTSTRAP_URL, {
            headers: { Accept: 'text/html,application/xhtml+xml' },
        });
        const bootstrapUrl = bootstrap.finalUrl || APPLE_TOKEN_BOOTSTRAP_URL;
        appleToken = await getAppleTokenFromHtml(bootstrap.responseText, bootstrapUrl);
        if (!appleToken) {
            throw new Error('Could not obtain the current Apple Music API token.');
        }
        return appleToken;
    }

    async function appleApiGet(path, token) {
        const response = await gmRequest(`${APPLE_API_BASE}${path}`, {
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
                Origin: 'https://music.apple.com',
            },
        });
        try {
            return JSON.parse(response.responseText);
        } catch {
            throw new Error('Apple Music API returned invalid JSON.');
        }
    }

    async function getAppleAlbumById(albumId, storefront, token) {
        const json = await appleApiGet(
            `/catalog/${encodeURIComponent(storefront)}/albums/${encodeURIComponent(albumId)}`,
            token
        );
        return json?.data?.find(item => item?.type === 'albums') || null;
    }

    async function inspectAppleReleaseLink(link) {
        const page = await gmRequest(link, {
            headers: { Accept: 'text/html,application/xhtml+xml' },
        });
        const finalUrl = page.finalUrl || link;
        const albumId = appleAlbumIdFromUrl(finalUrl) || appleAlbumIdFromUrl(link);
        const storefront = appleStorefrontFromUrl(finalUrl) || appleStorefrontFromUrl(link) || 'us';
        if (!albumId) throw new Error('The Apple/iTunes URL does not identify an album.');

        const token = await ensureAppleToken(page.responseText, finalUrl);
        const album = await getAppleAlbumById(albumId, storefront, token);
        if (!album) throw new Error('Apple Music album is unavailable.');

        const upc = normalizeBarcode(album?.attributes?.upc);
        const albumUrl = canonicalAppleAlbumUrl(album?.attributes?.url || finalUrl);
        if (!isAppleReleaseUrl(albumUrl)) {
            throw new Error('Apple Music API did not return a usable album URL.');
        }

        return {
            url: albumUrl,
            upc,
            storefront,
            albumId,
        };
    }

    function storefrontCandidates(sourceData) {
        const list = [];
        for (const link of sourceData.links) {
            const storefront = appleStorefrontFromUrl(link);
            if (storefront && !list.includes(storefront)) list.push(storefront);
        }
        for (const country of sourceData.countries || []) {
            if (country && !list.includes(country)) list.push(country);
        }
        for (const storefront of FALLBACK_STOREFRONTS) {
            if (!list.includes(storefront)) list.push(storefront);
        }
        return list;
    }

    async function findAppleReleaseByBarcode(barcode, sourceData) {
        const token = await ensureAppleToken();
        const wanted = normalizeBarcode(barcode);
        if (!wanted) return null;

        for (const storefront of storefrontCandidates(sourceData)) {
            setStatus(`Searching Apple Music by barcode ${wanted} in ${storefront.toUpperCase()}...`);
            try {
                const json = await appleApiGet(
                    `/catalog/${encodeURIComponent(storefront)}/albums?filter%5Bupc%5D=${encodeURIComponent(wanted)}&limit=25`,
                    token
                );
                const albums = (json?.data || []).filter(item => item?.type === 'albums');
                const match = albums.find(album => barcodesEqual(album?.attributes?.upc, wanted));
                if (!match) continue;

                const url = canonicalAppleAlbumUrl(match?.attributes?.url || '');
                if (!isAppleReleaseUrl(url)) continue;

                return {
                    url,
                    upc: normalizeBarcode(match?.attributes?.upc),
                    storefront,
                    albumId: String(match?.id || ''),
                };
            } catch (error) {
                console.warn(`[Apple Music UPC lookup] ${storefront}:`, error);
            }
        }
        return null;
    }

    async function resolveAppleRelease() {
        setStatus('Checking MusicBrainz barcode and Apple/iTunes links...');
        const sourceData = await getMusicBrainzReleaseSourceData();
        state.mbBarcode = sourceData.barcode;

        if (!sourceData.barcode && !sourceData.links.length) {
            throw new Error('No barcode and no Apple Music/iTunes link are present on this MusicBrainz release.');
        }

        if (sourceData.links.length) {
            for (let index = 0; index < sourceData.links.length; index++) {
                const link = sourceData.links[index];
                setStatus(`Checking Apple/iTunes link ${index + 1}/${sourceData.links.length}...`);
                try {
                    const candidate = await inspectAppleReleaseLink(link);
                    if (!sourceData.barcode || barcodesEqual(sourceData.barcode, candidate.upc)) {
                        state.appleBarcode = candidate.upc;
                        state.sourceMode = sourceData.barcode
                            ? 'verified existing Apple Music/iTunes link'
                            : 'existing Apple Music/iTunes link (MusicBrainz has no barcode)';
                        return candidate;
                    }
                    console.warn(
                        `[Apple Music source] Barcode mismatch: MusicBrainz ${sourceData.barcode}, Apple ${candidate.upc || '(none)'}`
                    );
                } catch (error) {
                    console.warn(`[Apple Music source] Dead/unusable link: ${link}`, error);
                }
            }
        }

        if (sourceData.barcode) {
            const found = await findAppleReleaseByBarcode(sourceData.barcode, sourceData);
            if (found) {
                state.appleBarcode = found.upc;
                state.sourceMode = 'barcode search fallback';
                return found;
            }
            throw new Error(`No Apple Music release was found for MusicBrainz barcode ${sourceData.barcode}.`);
        }

        throw new Error('The Apple Music/iTunes link is dead or unusable, and this MusicBrainz release has no barcode for fallback search.');
    }

    function setSourceInfo(resolved) {
        const target = document.getElementById('am2mb-source');
        if (!target) return;
        target.innerHTML = '';

        const parts = [];
        if (state.mbBarcode) parts.push(`MusicBrainz barcode: ${state.mbBarcode}`);
        if (state.appleBarcode) parts.push(`Apple UPC: ${state.appleBarcode}`);
        if (state.sourceMode) parts.push(`Source: ${state.sourceMode}`);
        target.append(document.createTextNode(parts.join(' | ')));

        if (resolved?.url) {
            target.append(document.createTextNode(' | '));
            const link = document.createElement('a');
            link.href = resolved.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'Apple Music';
            target.append(link);
        }
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
        MB = PAGE.MB || MB;
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
        return ROLE_TYPES[normalized] || null;
    }

    function flattenSupportedCredits(credits) {
        const output = [];

        for (const credit of credits) {
            const link = classifyRole(credit.role);
            if (!link) continue;

            output.push({
                appleName: credit.name,
                appleRole: credit.role,
                appleSection: credit.section,
                target: link.target,
                linkTypeID: link.id,
                mbRole: link.label,
            });
        }

        return output;
    }

    function targetEntityForCredit(row, credit) {
        if (credit.target === 'recording') {
            return row.mbTrack?.recording || null;
        }
        if (credit.target === 'work') {
            return row.works.length === 1 ? row.works[0] : null;
        }
        if (credit.target === 'release') {
            return MB?.relationshipEditor?.state?.entity || null;
        }
        return null;
    }

    function existingRelationship(sourceEntity, artist, linkTypeID) {
        const relationships = sourceEntity?.relationships || [];
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

    function addRelationship(sourceEntity, artist, linkTypeID, creditedAs) {
        const backward =
            sourceEntity.entityType === artist.entityType
                ? false
                : sourceEntity.entityType > artist.entityType;

        const entity0 = backward ? artist : sourceEntity;
        const entity1 = backward ? sourceEntity : artist;

        MB.relationshipEditor.dispatch({
            type: 'update-relationship-state',
            sourceEntity,
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

    async function addEditNote() {
        if (state.applied) return;

        await ensureMusicBrainzEditorReady();

        const editorState = MB?.relationshipEditor?.state;
        const dispatch = MB?.relationshipEditor?.dispatch;

        if (!editorState?.editNoteField || typeof dispatch !== 'function') {
            throw new Error('MusicBrainz relationship editor Edit Note state is unavailable.');
        }

        const sourceLine = `Apple Music credits: ${state.appleUrl}`;
        const scriptLine =
            'Imported with Apple Music Credits -> MusicBrainz; missing Works were searched first, and newly created Works use Work type Song with a user-selected lyrics language.' +
            `\nScript: ${SCRIPT_URL}`;
        const current = String(editorState.editNoteField.value || '').trimEnd();
        const addition = `${sourceLine}\n${scriptLine}`;
        const nextValue = current ? `${current}\n\n${addition}` : addition;

        dispatch({
            editNote: nextValue,
            type: 'update-edit-note',
        });

        const started = Date.now();
        while (Date.now() - started < 3000) {
            MB = PAGE.MB || MB;
            const stored = String(
                MB?.relationshipEditor?.state?.editNoteField?.value || ''
            );

            if (stored === nextValue && stored.includes(SCRIPT_URL)) {
                state.applied = true;
                return;
            }

            await wait(50);
        }

        throw new Error(
            'MusicBrainz did not store the required Edit Note in relationship-editor state.'
        );
    }

    async function searchArtists(name) {
        const query = `artist:"${escapeLucene(name)}" OR alias:"${escapeLucene(name)}"`;
        const url = `/ws/2/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
        const json = await musicBrainzWsJson(
            url,
            `MusicBrainz artist search for "${name}"`,
            `artist-search:${normalizeText(name)}`
        );
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


    const artistDetailsCache = new Map();

    function candidateFromArtistData(artist, contextReason = '') {
        return {
            mbid: artist.id || artist.mbid || '',
            name: artist.name || '',
            disambiguation: artist.disambiguation || '',
            country: artist.country || '',
            type: artist.type || '',
            score: Number(artist.score ?? 100),
            aliases: (artist.aliases || []).map(alias =>
                typeof alias === 'string' ? alias : alias?.name
            ).filter(Boolean),
            contextReason,
        };
    }

    function sameArtistName(left, right) {
        return normalizeText(left) === normalizeText(right);
    }

    function artistCanonicalNameMatches(creditName, artist) {
        return [
            artist?.name,
            artist?.['sort-name'],
            artist?.sortName,
        ].filter(Boolean).some(value => sameArtistName(creditName, value));
    }

    function artistAliasMatches(creditName, artist) {
        return (artist?.aliases || []).some(alias =>
            sameArtistName(
                creditName,
                typeof alias === 'string' ? alias : alias?.name
            )
        );
    }

    function artistNameMatches(creditName, artist) {
        return artistCanonicalNameMatches(creditName, artist) ||
            artistAliasMatches(creditName, artist);
    }

    async function getArtistDetails(mbid) {
        if (artistDetailsCache.has(mbid)) return artistDetailsCache.get(mbid);

        const url = `/ws/2/artist/${encodeURIComponent(mbid)}?inc=aliases+artist-rels&fmt=json`;
        const json = await musicBrainzWsJson(
            url,
            `MusicBrainz artist context lookup ${mbid}`,
            `artist-context:${mbid}`
        );
        artistDetailsCache.set(mbid, json);
        return json;
    }

    function mergeCandidates(...groups) {
        const merged = new Map();
        for (const group of groups) {
            for (const candidate of group || []) {
                if (!candidate?.mbid) continue;
                const current = merged.get(candidate.mbid);
                if (!current || (!current.contextReason && candidate.contextReason)) {
                    merged.set(candidate.mbid, candidate);
                }
            }
        }
        return [...merged.values()];
    }

    function dedupeContextCandidates(candidates) {
        return [...new Map(
            candidates
                .filter(candidate => candidate?.mbid)
                .map(candidate => [candidate.mbid, candidate])
        ).values()];
    }

    async function relatedArtistsForCreditedArtist(creditedArtist) {
        const details = await getArtistDetails(creditedArtist.id);
        const output = [];

        for (const relation of details.relations || []) {
            const related = relation?.artist;
            if (!related?.id) continue;

            output.push({
                root: details,
                relation,
                related,
            });
        }

        return output;
    }

    async function findContextArtistCandidates(creditName) {
        const creditedArtists = state.creditedArtists || [];

        // Circle 1: artists directly credited on this release/recording/track.
        const circle1 = [];
        for (const artist of creditedArtists) {
            const creditedNameMatch = [...(artist.creditedNames || [])]
                .some(name => sameArtistName(creditName, name));

            if (creditedNameMatch || artistCanonicalNameMatches(creditName, artist)) {
                const details = await getArtistDetails(artist.id);
                circle1.push(candidateFromArtistData(
                    details,
                    'Circle 1: artist directly credited on this release/recording'
                ));
            }
        }
        if (circle1.length) {
            return { circle: 1, candidates: dedupeContextCandidates(circle1) };
        }

        // Circle 2: aliases of the directly credited artists.
        const circle2 = [];
        for (const artist of creditedArtists) {
            const details = await getArtistDetails(artist.id);
            if (artistAliasMatches(creditName, details)) {
                circle2.push(candidateFromArtistData(
                    details,
                    'Circle 2: alias of an artist directly credited on this release/recording'
                ));
            }
        }
        if (circle2.length) {
            return { circle: 2, candidates: dedupeContextCandidates(circle2) };
        }

        // Build the relationship neighborhood only after direct artists/aliases fail.
        const relatedContexts = [];
        for (const artist of creditedArtists) {
            relatedContexts.push(...await relatedArtistsForCreditedArtist(artist));
        }

        // Circle 3: artists connected through artist-to-artist relationships.
        // Relationship credits are treated as names for that related artist too.
        const circle3 = [];
        for (const context of relatedContexts) {
            const relationshipCredits = [
                context.relation?.['source-credit'],
                context.relation?.['target-credit'],
            ].filter(Boolean);

            const relationCreditMatch = relationshipCredits
                .some(value => sameArtistName(creditName, value));

            if (
                artistCanonicalNameMatches(creditName, context.related) ||
                relationCreditMatch
            ) {
                const full = await getArtistDetails(context.related.id);
                circle3.push(candidateFromArtistData(
                    full,
                    `Circle 3: ${context.relation?.type || 'artist relationship'} with ${context.root?.name || 'credited artist'}`
                ));
            }
        }
        if (circle3.length) {
            return { circle: 3, candidates: dedupeContextCandidates(circle3) };
        }

        // Circle 4: aliases of artists found through those relationships.
        const circle4 = [];
        for (const context of relatedContexts) {
            const full = await getArtistDetails(context.related.id);
            if (artistAliasMatches(creditName, full)) {
                circle4.push(candidateFromArtistData(
                    full,
                    `Circle 4: alias of artist connected by ${context.relation?.type || 'artist relationship'} to ${context.root?.name || 'credited artist'}`
                ));
            }
        }
        if (circle4.length) {
            return { circle: 4, candidates: dedupeContextCandidates(circle4) };
        }

        return { circle: 0, candidates: [] };
    }

    function aliasAlreadyPresent(creditName, artist) {
        return artistNameMatches(creditName, artist);
    }

    async function submitArtistAliasEdit(mbid, aliasName, artistName) {
        const addAliasUrl = `/artist/${encodeURIComponent(mbid)}/add-alias`;
        const page = await fetch(addAliasUrl, {
            credentials: 'same-origin',
            headers: { Accept: 'text/html,application/xhtml+xml' },
        });
        if (!page.ok) {
            throw new Error(`Cannot open MusicBrainz alias editor for "${artistName}": HTTP ${page.status}`);
        }

        const doc = new DOMParser().parseFromString(await page.text(), 'text/html');
        const form = [...doc.forms].find(item =>
            item.querySelector('[name="edit-alias.name"]')
        );
        if (!form) {
            throw new Error(`Cannot find the MusicBrainz add-alias form for "${artistName}".`);
        }

        const params = new URLSearchParams();
        for (const [key, value] of new FormData(form).entries()) {
            if (typeof value === 'string') params.append(key, value);
        }

        params.set('edit-alias.name', aliasName);
        params.set('edit-alias.sort_name', aliasName);
        params.set('edit-alias.type_id', '1');

        const noteField = form.querySelector(
            'textarea[name*="edit_note"], textarea[name*="edit-note"], textarea[name*="editnote"]'
        );
        if (!noteField?.name) {
            throw new Error(`Required MusicBrainz Edit Note field was not found for alias "${aliasName}".`);
        }

        params.set(
            noteField.name,
            `Apple Music credits list "${aliasName}" for ${artistName}. Adding the alias so this credit resolves correctly in future imports.\nSource: ${state.appleUrl}\nScript: ${SCRIPT_URL}`
        );

        const action = new URL(form.getAttribute('action') || addAliasUrl, location.origin).href;
        const response = await fetch(action, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            body: params,
        });

        if (!response.ok) {
            throw new Error(`Adding alias "${aliasName}" failed: HTTP ${response.status}`);
        }

        const finalPath = new URL(response.url).pathname;
        if (finalPath.endsWith('/add-alias')) {
            throw new Error(`MusicBrainz did not accept alias "${aliasName}" for ${artistName}.`);
        }

        const cached = artistDetailsCache.get(mbid);
        if (cached) {
            cached.aliases = [...(cached.aliases || []), { name: aliasName }];
        }
        state.aliasEdits++;
    }

    async function ensureCreditAlias(person, mbid) {
        const artist = await getArtistDetails(mbid);
        if (aliasAlreadyPresent(person.name, artist)) return false;

        setStatus(`Adding MusicBrainz alias "${person.name}" to ${artist.name}...`);
        await submitArtistAliasEdit(mbid, person.name, artist.name || mbid);
        return true;
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

    async function fetchMbEntity(mbid, fallbackEntityType = 'artist') {
        const response = await fetch(`/ws/js/entity/${encodeURIComponent(mbid)}`, {
            credentials: 'same-origin',
        });

        if (!response.ok) {
            throw new Error(`Cannot load MusicBrainz ${fallbackEntityType} ${mbid}: HTTP ${response.status}`);
        }

        const entity = await response.json();
        if (!entity.entityType) entity.entityType = fallbackEntityType;
        return entity;
    }

    async function searchWorks(title) {
        const query = `work:"${escapeLucene(title)}"`;
        const url = `/ws/2/work/?query=${encodeURIComponent(query)}&fmt=json&limit=25`;
        const json = await musicBrainzWsJson(
            url,
            `MusicBrainz Work search for "${title}"`,
            `work-search:${normalizeText(title)}`
        );
        return (json.works || []).map(work => ({
            mbid: work.id,
            title: work.title || '',
            type: work.type || '',
            disambiguation: work.disambiguation || '',
            score: Number(work.score ?? 0),
        }));
    }

    function findTemporaryCreatedWork(title) {
        let found = null;
        walk(MB?.relationshipEditor?.state, object => {
            if (
                !found &&
                object?.entityType === 'work' &&
                object?._fromBatchCreateWorksDialog === true &&
                normalizeText(object?.name) === normalizeText(title)
            ) {
                found = object;
            }
        });
        return found;
    }

    function selectedRecordingsSnapshot() {
        const selected = [];
        const seen = new Set();

        walk(MB?.relationshipEditor?.state?.selectedRecordings, object => {
            if (object?.entityType !== 'recording') return;
            const key = object.gid || object.id;
            if (!key || seen.has(key)) return;
            seen.add(key);
            selected.push(object);
        });

        return selected;
    }

    async function waitForDom(selector, timeout = 10000) {
        const started = Date.now();
        while (Date.now() - started < timeout) {
            const element = document.querySelector(selector);
            if (element) return element;
            await wait(100);
        }
        throw new Error(`Timed out waiting for MusicBrainz UI: ${selector}`);
    }

    function setNativeSelectValue(select, value) {
        const descriptor = Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype,
            'value'
        );
        descriptor.set.call(select, String(value));
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function restoreRecordingSelection(recording, previousSelection) {
        MB.relationshipEditor.dispatch({
            isSelected: false,
            recording,
            type: 'toggle-select-recording',
        });

        for (const oldRecording of previousSelection) {
            MB.relationshipEditor.dispatch({
                isSelected: true,
                recording: oldRecording,
                type: 'toggle-select-recording',
            });
        }

        await wait(50);
    }

    async function createWorkWithSavedLanguage(recording) {
        const previousSelection = selectedRecordingsSnapshot();

        MB.relationshipEditor.dispatch({
            isSelected: false,
            type: 'toggle-select-all-recordings',
        });

        MB.relationshipEditor.dispatch({
            isSelected: true,
            recording,
            type: 'toggle-select-recording',
        });

        try {
            MB.relationshipEditor.dispatch({
                attributes: null,
                begin_date: null,
                end_date: null,
                ended: false,
                languages: state.workLanguages,
                linkType: null,
                type: 'accept-batch-create-works-dialog',
                workType: WORK_TYPE_SONG_ID,
            });

            await wait(100);

            const created = findTemporaryCreatedWork(recording.name);
            if (!created) {
                throw new Error(
                    `MusicBrainz did not stage a new Work for "${recording.name}".`
                );
            }

            return created;
        } finally {
            await restoreRecordingSelection(recording, previousSelection);
        }
    }

    async function createWorkForRecording(recording) {
        if (Array.isArray(state.workLanguages) && state.workLanguages.length) {
            return createWorkWithSavedLanguage(recording);
        }

        const previousSelection = selectedRecordingsSnapshot();

        MB.relationshipEditor.dispatch({
            isSelected: false,
            type: 'toggle-select-all-recordings',
        });

        MB.relationshipEditor.dispatch({
            isSelected: true,
            recording,
            type: 'toggle-select-recording',
        });

        try {
            let button = null;
            const started = Date.now();

            while (Date.now() - started < 10000) {
                button = document.querySelector('button.batch-create-works');
                if (button && !button.disabled) break;
                await wait(100);
            }

            if (!button || button.disabled) {
                throw new Error(
                    'MusicBrainz "Batch-add new works" button did not become available.'
                );
            }

            button.click();

            const dialog = await waitForDom('#batch-create-works-dialog', 10000);
            const workType = await waitForDom(
                '#batch-create-works-dialog #work-type',
                10000
            );

            setNativeSelectValue(workType, WORK_TYPE_SONG_ID);

            setStatus(
                'Choose the lyrics language once for this album, then click Done. The same language will be reused for all new Works.',
                'warn'
            );

            const dialogStarted = Date.now();
            while (Date.now() - dialogStarted < 10 * 60 * 1000) {
                if (!document.body.contains(dialog)) break;
                await wait(200);
            }

            if (document.body.contains(dialog)) {
                throw new Error(
                    'Timed out waiting for the album lyrics language selection.'
                );
            }

            await wait(100);

            const created = findTemporaryCreatedWork(recording.name);
            if (!created) {
                throw new Error(
                    `Work creation for "${recording.name}" was cancelled or not accepted.`
                );
            }

            if (Number(created.typeID) !== WORK_TYPE_SONG_ID) {
                throw new Error(
                    `The new Work "${recording.name}" was not created with Work type Song.`
                );
            }

            const chosenLanguages = (created.languages || [])
                .map(item => item?.language)
                .filter(Boolean);

            if (!chosenLanguages.length) {
                throw new Error(
                    'No lyrics language was selected for the album.'
                );
            }

            state.workLanguages = chosenLanguages;
            return created;
        } finally {
            await restoreRecordingSelection(recording, previousSelection);
        }
    }

    async function ensureWorkForRow(row) {
        const workCredits = row.supportedCredits.filter(credit => credit.target === 'work');
        if (!workCredits.length) return;

        if (row.works.length === 1) {
            row.workResolution = 'Existing linked Work';
            return;
        }

        if (row.works.length > 1) {
            row.workResolution = `Multiple Works already linked (${row.works.length}) - manual review`;
            return;
        }

        const title = row.mbTitle || row.appleTrack.title;
        setStatus(`Searching MusicBrainz Work: ${title}`);

        const candidates = await searchWorks(title);
        const exact = candidates.filter(candidate =>
            normalizeText(candidate.title) === normalizeText(title)
        );

        if (exact.length === 1) {
            const work = await fetchMbEntity(exact[0].mbid, 'work');
            addRelationship(
                row.mbTrack.recording,
                work,
                RECORDING_OF_LINK_TYPE_ID,
                ''
            );
            row.works = [work];
            row.workResolution = `Linked existing Work: ${work.name || title}`;
            return;
        }

        if (exact.length > 1) {
            row.workResolution = `Multiple exact Work matches found (${exact.length}) - manual review`;
            return;
        }

        setStatus(`No matching Work found. Creating Work: ${title}`);
        const work = await createWorkForRecording(row.mbTrack.recording);
        row.works = [work];
        row.workResolution = `New Work staged: ${work.name || title}`;
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
            const importable = row.supportedCredits.filter(credit => targetEntityForCredit(row, credit));
            const unsupported = row.credits.filter(credit => !classifyRole(credit.role));
            const blockedWork = row.supportedCredits.filter(
                credit => credit.target === 'work' && !targetEntityForCredit(row, credit)
            );

            const creditsText = row.supportedCredits.length
                ? row.supportedCredits
                    .map(item =>
                        `${item.appleName} (${item.appleRole} -> ${item.target}: ${item.mbRole})`
                    )
                    .join(', ')
                : row.credits.length
                    ? row.credits.map(item => `${item.name} (${item.role})`).join(', ')
                    : 'No Apple Music credits found';

            let status = `${importable.length} importable`;
            let css = importable.length ? 'ok' : 'warn';

            if (row.error) {
                status = row.error;
                css = 'bad';
            } else if (!row.mbTrack) {
                status = 'No matching MusicBrainz track';
                css = 'bad';
            } else if (!row.titleMatch) {
                status = `Title mismatch: MusicBrainz "${row.mbTitle}"`;
                css = 'bad';
            } else {
                const details = [];
                if (row.workResolution) {
                    details.push(row.workResolution);
                }
                if (blockedWork.length) {
                    details.push(
                        row.works.length === 0
                            ? `${blockedWork.length} Work credit(s) blocked - no unambiguous Work could be resolved`
                            : `${blockedWork.length} Work credit(s) blocked - multiple Works linked`
                    );
                }
                if (unsupported.length) {
                    const roles = [...new Set(unsupported.map(item => item.role))];
                    details.push(`unsupported: ${roles.join(', ')}`);
                }
                if (details.length) status += `; ${details.join('; ')}`;
            }

            return `
                <tr>
                    <td>${row.appleTrack.discNumber}.${row.appleTrack.trackNumber}</td>
                    <td>${escapeHtml(row.appleTrack.title)}</td>
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
                            <th>Apple Music track</th>
                            <th>Credits -> MusicBrainz target</th>
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
                        candidate.contextReason,
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
            const preferredIndex = person.preferredMbid
                ? person.candidates.findIndex(candidate => candidate.mbid === person.preferredMbid)
                : -1;
            const autoIndex = preferredIndex >= 0
                ? preferredIndex
                : (exact.length === 1 ? exact[0] : -1);
            const autoLabel = preferredIndex >= 0
                ? `Auto: ${person.preferredReason}`
                : (autoIndex >= 0 ? 'Exact name/alias match' : 'Review required');

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
                        ${escapeHtml(autoLabel)}
                    </td>
                </tr>
            `;
        }).join('');

        container.innerHTML = `
            <h3>Artist mapping</h3>
            <p class="am2mb-hint">
                Artist matching uses four priority circles: credited artists, their aliases, their artist relationships, then aliases of those related artists. Global search is only a fallback.
                Recording credits go to Recordings, songwriting/composition to Works, and mastering to the Release.
                When you manually map a different Apple credit name, a MusicBrainz artist alias is added for future matching.
            </p>
            <div class="am2mb-scroll">
                <table class="tbl">
                    <thead>
                        <tr>
                            <th>Apple Music credit</th>
                            <th>Role(s) -> target</th>
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
                    Apply supported credits
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
        const button = document.getElementById('am2mb-load');

        try {
            await ensureMusicBrainzEditorReady();

            state.appleUrl = '';
            state.mbBarcode = '';
            state.appleBarcode = '';
            state.sourceMode = '';
            state.appleTracks = [];
            state.rows = [];
            state.people.clear();
            state.creditedArtists = [];
            state.workLanguages = null;
            state.aliasEdits = 0;
            state.applied = false;

            button.disabled = true;
            document.getElementById('am2mb-tracks').innerHTML = '';
            document.getElementById('am2mb-people').innerHTML = '';
            document.getElementById('am2mb-source').innerHTML = '';

            const resolved = await resolveAppleRelease();
            state.appleUrl = resolved.url;
            setSourceInfo(resolved);

            // Populate the required source/script edit note as soon as the
            // Apple Music source has been verified.
            await addEditNote();

            setStatus('Loading resolved Apple Music release...');
            const albumHtml = await gmGet(state.appleUrl);
            const albumData = parseAppleServerData(albumHtml);
            const appleTracks = getAppleTracks(albumData);

            if (!appleTracks.length) {
                throw new Error('No Apple Music tracks were found on the resolved release page.');
            }

            state.appleTracks = appleTracks;
            setStatus(`Found ${appleTracks.length} tracks. Loading all Apple Music credits...`);

            const creditResults = await mapPool(appleTracks, 4, async (track, index) => {
                setStatus(
                    `Loading Apple Music credits ${index + 1}/${appleTracks.length}: ${track.title}`
                );
                const creditsUrl = songCreditsUrl(track, state.appleUrl);
                const html = await gmGet(creditsUrl);
                const data = parseAppleServerData(html);
                return {
                    creditsUrl,
                    credits: getAppleCredits(data),
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
                    workResolution: '',
                    titleMatch: !!mbTrack && normalizeTrackTitleForMatch(appleTrack.title) === normalizeTrackTitleForMatch(mbTitle),
                    error: result?.error ? result.error.message : '',
                };
            });

            for (let index = 0; index < state.rows.length; index++) {
                const row = state.rows[index];
                if (row.error || !row.mbTrack || !row.titleMatch) continue;

                const hasWorkCredits = row.supportedCredits.some(credit => credit.target === 'work');
                if (hasWorkCredits && row.works.length === 0) {
                    setStatus(
                        `Resolving Work ${index + 1}/${state.rows.length}: ${row.appleTrack.title}`
                    );
                    try {
                        await ensureWorkForRow(row);
                    } catch (error) {
                        row.workResolution = error.message;
                        console.warn('[Apple Music -> MusicBrainz] Work resolution failed:', error);
                    }
                } else if (hasWorkCredits) {
                    await ensureWorkForRow(row);
                }
            }

            for (const row of state.rows) {
                if (row.error || !row.mbTrack || !row.titleMatch) continue;

                for (const credit of row.supportedCredits) {
                    if (!targetEntityForCredit(row, credit)) continue;

                    const key = normalizeText(credit.appleName);
                    if (!state.people.has(key)) {
                        state.people.set(key, {
                            key,
                            name: credit.appleName,
                            roles: new Set(),
                            candidates: [],
                        });
                    }
                    state.people.get(key).roles.add(
                        `${credit.appleRole} -> ${credit.target}`
                    );
                }
            }

            renderTracks();

            if (!state.people.size) {
                const allRoles = [...new Set(
                    state.rows.flatMap(row => row.credits.map(credit => credit.role))
                )];
                throw new Error(
                    allRoles.length
                        ? `Apple Music credits were found, but none are currently importable. Check unresolved Work matches or unsupported roles: ${allRoles.join(', ')}`
                        : 'No Apple Music credits were found.'
                );
            }

            const people = [...state.people.values()];
            for (let index = 0; index < people.length; index++) {
                const person = people[index];

                setStatus(
                    `Checking artist context circles ${index + 1}/${people.length}: ${person.name}`
                );
                const context = await findContextArtistCandidates(person.name);
                const contextCandidates = context.candidates;

                if (contextCandidates.length) {
                    // Stop at the first circle which has matches. Lower-priority
                    // circles and global search must not override a local match.
                    person.candidates = contextCandidates;
                    if (contextCandidates.length === 1) {
                        person.preferredMbid = contextCandidates[0].mbid;
                        person.preferredReason = contextCandidates[0].contextReason;
                    } else {
                        person.preferredMbid = '';
                        person.preferredReason = `Circle ${context.circle} has multiple matching artists`;
                    }
                    continue;
                }

                setStatus(
                    `Searching all MusicBrainz artists ${index + 1}/${people.length}: ${person.name}`
                );
                person.candidates = await searchArtists(person.name);
            }

            renderPeople();

            const importableCount = state.rows.reduce(
                (sum, row) => sum + row.supportedCredits.filter(
                    credit =>
                        row.mbTrack &&
                        row.titleMatch &&
                        targetEntityForCredit(row, credit)
                ).length,
                0
            );

            setStatus(
                `Loaded ${appleTracks.length} Apple Music tracks. ${importableCount} relationship credit(s) are ready for review.`,
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
            await ensureMusicBrainzEditorReady();

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

            for (const person of state.people.values()) {
                const mbid = selectedMbid(person);
                if (!mbid) continue;
                await ensureCreditAlias(person, mbid);
            }

            // Edit Note is mandatory. Populate MusicBrainz's internal React
            // relationship-editor state before staging any relationship edits.
            await addEditNote();

            let added = 0;
            let addedRecording = 0;
            let addedWork = 0;
            let addedRelease = 0;
            let skippedExisting = 0;
            let skippedUnavailable = 0;
            const created = new Set();

            for (const row of state.rows) {
                if (row.error || !row.mbTrack || !row.titleMatch || !row.supportedCredits.length) {
                    continue;
                }

                for (const credit of row.supportedCredits) {
                    const sourceEntity = targetEntityForCredit(row, credit);
                    if (!sourceEntity) {
                        skippedUnavailable++;
                        continue;
                    }

                    const artist = mapping.get(normalizeText(credit.appleName));
                    if (!artist) continue;

                    const sourceId = sourceEntity.gid || sourceEntity.id || sourceEntity.name;
                    const artistId = artist.gid || artist.id || artist.name;
                    const key = [sourceId, artistId, credit.linkTypeID].join('|');

                    if (
                        created.has(key) ||
                        existingRelationship(sourceEntity, artist, credit.linkTypeID)
                    ) {
                        skippedExisting++;
                        continue;
                    }

                    addRelationship(
                        sourceEntity,
                        artist,
                        credit.linkTypeID,
                        credit.appleName
                    );
                    created.add(key);
                    added++;

                    if (credit.target === 'recording') addedRecording++;
                    else if (credit.target === 'work') addedWork++;
                    else if (credit.target === 'release') addedRelease++;
                }
            }

            setStatus(
                `Applied ${added} relationship(s): ${addedRecording} Recording, ${addedWork} Work, ${addedRelease} Release. ` +
                `${skippedExisting} existing/duplicate relationship(s) skipped, ${skippedUnavailable} unavailable target(s) skipped. ` +
                `${state.aliasEdits} artist alias edit(s) entered. Review the green relationship edits, then submit normally.`,
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

        const form =
            document.getElementById('relationship-editor-form') ||
            document.querySelector('form[action*="/edit-relationships"]') ||
            document.getElementById('edit-note-text')?.closest('form') ||
            document.querySelector('textarea[name="edit_note"]')?.closest('form');

        if (!form) {
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

            <h2>Apple Music Credits -> MusicBrainz</h2>
            <div class="am2mb-controls">
                <button type="button" id="am2mb-load">Find Apple Music & Load Credits</button>
            </div>
            <p id="am2mb-status">
                Ready to verify the MusicBrainz barcode and Apple/iTunes links.
            </p>
            <p id="am2mb-source"></p>
            <div id="am2mb-tracks"></div>
            <div id="am2mb-people"></div>
        `;

        form.insertAdjacentElement('beforebegin', panel);
        document.getElementById('am2mb-load').addEventListener('click', loadAppleCredits);
    }

    injectUi();
})();