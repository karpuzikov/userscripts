// ==UserScript==
// @name         Beatport - MusicBrainz Importer
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.2.12
// @description  Import Beatport and BPTopTracker releases into MusicBrainz, with BPTopTracker 500-page redirect, Beatport enrichment, ISRC matching, and release-source handling.
// @author       karpuzikov
// @match        https://www.beatport.com/*
// @match        https://musicbrainz.org/release/add*
// @match        https://beta.musicbrainz.org/release/add*
// @match        *://www.bptoptracker.com/*
// @match        *://bptoptracker.com/*
// @connect      musicbrainz.org
// @connect      api.github.com
// @connect      music.apple.com
// @connect      amp-api.music.apple.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/beatport-musicbrainz-importer/Beatport_MusicBrainz_Importer.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/beatport-musicbrainz-importer/Beatport_MusicBrainz_Importer.user.js
// @run-at       document-idle
// ==/UserScript==

// BPTopTracker HTTP 500 fallback
(() => {
    'use strict';

    if (!/^(?:www\.)?bptoptracker\.com$/i.test(location.hostname)) return;

    let redirected = false;

    function redirectToBeatport() {
        if (redirected) return;
        redirected = true;
        window.__beatportMbRedirecting = true;

        const target =
            'https://www.beatport.com' +
            window.location.pathname +
            window.location.search +
            window.location.hash;

        window.location.replace(target);
    }

    function getNavigationStatus() {
        try {
            const navigation = performance.getEntriesByType('navigation')[0];
            const status = Number(navigation?.responseStatus);
            return Number.isFinite(status) ? status : 0;
        } catch {
            return 0;
        }
    }

    function looksLike500Page() {
        const status = getNavigationStatus();
        if (status === 500) return true;

        const title = (document.title || '').replace(/\s+/g, ' ').trim();
        const body = (document.body?.innerText || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 10000);

        const combined = (title + ' ' + body).toLowerCase();

        if (
            /\b500\b/.test(combined) &&
            /(internal server error|server error|http error)/i.test(combined)
        ) {
            return true;
        }

        return /\binternal server error\b/i.test(title);
    }

    function check() {
        if (!redirected && looksLike500Page()) {
            redirectToBeatport();
        }
    }

    check();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', check, {once: true});
    } else {
        check();
    }

    window.addEventListener('load', check, {once: true});

    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
    });

    setTimeout(() => observer.disconnect(), 10000);
})();

(() => {
    'use strict';

    if (location.hostname !== 'www.beatport.com') return;

    const MB_ADD_RELEASE = 'https://musicbrainz.org/release/add';
    const MB_WS = 'https://musicbrainz.org/ws/2';
    const MAGIC_ISRC = 'https://magicisrc.kepstin.ca/';
    const APPLE_API_BASE = 'https://amp-api.music.apple.com/v1';
    const PURCHASE_FOR_DOWNLOAD = 74;
    const PAID_STREAMING = 980;
    const VARIOUS_ARTISTS_MBID = '89ad4ac3-39f7-470e-963a-56509c546377';
    const UI_ID = 'beatport-musicbrainz-importer';
    const MB_RELEASE_INDICATOR_ID = 'beatport-mb-release-indicator';
    const MB_RELEASE_INDICATOR_STYLE_ID = 'beatport-mb-release-indicator-style';
    const MB_RELEASE_LINK_CACHE_KEY = 'beatport-mb-release-links:v1';
    const MB_RELEASE_FOUND_TTL = 30 * 24 * 60 * 60 * 1000;
    const MB_RELEASE_MISSING_TTL = 15 * 1000;
    const MAX_DIFFERENCE_MS = 7000;
    const MB_REQUEST_GAP_MS = 1100;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ISRC_CHOICE_CACHE_KEY = 'mb-recording-matcher:isrc-choice:v1';
    const LEGACY_ISRC_CHOICE_CACHE_KEY = 'mb-recording-data-to-tracks:isrc-choice-cache:v1';
    const GITHUB_CACHE_REPO = 'karpuzikov/userscripts';
    const GITHUB_CACHE_PATH = 'musicbrainz-tools/safe-recording-matcher/isrc-choice-cache.json';
    const GITHUB_API_BASE = 'https://api.github.com';
    const PENDING_IMPORT_KEY = 'beatport-mb-importer:pending:v1';
    const BEATPORT_REL_UUID = {
        artist: 'f8319a2f-f824-4617-81c8-be6560b3b203',
        label: 'dc1a65f4-6458-4f3d-bbb1-57e58668d6e7',
    };
    const GITHUB_SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/beatport-musicbrainz-importer/Beatport_MusicBrainz_Importer.user.js';

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

    let nextMbRequestAt = 0;
    let appleTokenPromise = null;
    let processSerial = 0;
    const mbReleaseLinkPending = new Map();
    let currentReleaseForIndicator = null;

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function normalizeSpace(value) {
        return String(value ?? '').replace(/\s+/g, ' ').trim();
    }

    function normalizeIsrc(value) {
        const code = String(value ?? '').replace(/-/g, '').trim().toUpperCase();
        return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code) ? code : '';
    }

    function normalizeTitle(value) {
        return String(value ?? '')
            .normalize('NFKC')
            .replace(/[\u2018\u2019\u02bc]/g, "'")
            .replace(/[\u2010-\u2015\u2212]/g, '-')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()
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

    function cleanBeatportUrl() {
        const match = location.href.match(/^https:\/\/www\.beatport\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?release\/[^?#]+\/\d+/i);
        return match ? match[0] : location.href.split(/[?#]/)[0];
    }

    function releasePathParts() {
        const match = location.pathname.match(/^\/(?:([a-z]{2}(?:-[a-z]{2})?)\/)?release\/([^/]+)\/(\d+)\/?$/i);
        if (!match) return null;
        return {
            locale: match[1] || 'en',
            slug: match[2],
            id: match[3],
        };
    }

    function parseNextData() {
        const node = document.getElementById('__NEXT_DATA__');
        if (!node?.textContent) return null;
        try {
            return JSON.parse(node.textContent);
        } catch (error) {
            console.error('[Beatport MB Importer] Failed to parse __NEXT_DATA__', error);
            return null;
        }
    }

    function findTracksQuery(pageProps, releaseId = pageProps?.release?.id, page = null) {
        const queries = pageProps?.dehydratedState?.queries || [];
        const wantedReleaseId = String(releaseId ?? '');

        const exact = queries.filter(query => {
            const key = query?.queryKey;
            if (!Array.isArray(key) || key[0] !== 'tracks') return false;

            const options = key[1] || {};
            const queryReleaseId = options.release_id ?? options.releaseId;
            if (wantedReleaseId && String(queryReleaseId ?? '') !== wantedReleaseId) return false;
            if (page != null && Number(options.page || 1) !== Number(page)) return false;
            return true;
        });

        if (exact.length) return exact[0];

        const trackQueries = queries.filter(query => {
            const key = query?.queryKey;
            return Array.isArray(key) && key[0] === 'tracks';
        });

        return trackQueries.length === 1 ? trackQueries[0] : null;
    }

    async function fetchPageProps(buildId, parts, page = 1) {
        let url = `https://www.beatport.com/_next/data/${encodeURIComponent(buildId)}/${encodeURIComponent(parts.locale)}/release/${encodeURIComponent(parts.slug)}/${encodeURIComponent(parts.id)}.json?id=${encodeURIComponent(parts.id)}`;
        if (page > 1) {
            url += `&per_page=100&page=${page}&description=${encodeURIComponent(parts.slug)}`;
        }
        const response = await fetch(url, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Beatport metadata request failed: HTTP ${response.status}`);
        const json = await response.json();
        return json.pageProps || json.props?.pageProps || null;
    }

    async function getCurrentPageProps() {
        const parts = releasePathParts();
        if (!parts) return null;

        const next = parseNextData();
        if (!next?.buildId) return null;

        let pageProps = next?.props?.pageProps || null;
        if (String(pageProps?.release?.id || '') !== parts.id) {
            pageProps = await fetchPageProps(next.buildId, parts, 1);
        }
        if (!pageProps?.release) return null;

        let query = findTracksQuery(pageProps, parts.id, 1);
        let currentResults = query?.state?.data?.results || [];
        let expected = Number(
            pageProps.release.track_count ||
            query?.state?.data?.count ||
            0
        );

        /*
         * Beatport's hydrated page state can contain stale/partial track data,
         * or more than one generic "tracks" query. Re-fetch the release payload
         * when the selected query is incomplete before doing anything else.
         */
        if (!query || (expected && currentResults.length < Math.min(expected, 100))) {
            const freshProps = await fetchPageProps(next.buildId, parts, 1);
            if (String(freshProps?.release?.id || '') === parts.id) {
                pageProps = freshProps;
                query = findTracksQuery(pageProps, parts.id, 1);
                currentResults = query?.state?.data?.results || [];
                expected = Number(
                    pageProps.release.track_count ||
                    query?.state?.data?.count ||
                    expected ||
                    0
                );
            }
        }

        if (!query) {
            throw new Error('Could not find the Beatport track query for this release');
        }

        if (expected > 100) {
            const pages = Math.ceil(expected / 100);
            const all = [];
            const seen = new Set();

            for (let page = 1; page <= pages; page++) {
                const props = page === 1 ? pageProps : await fetchPageProps(next.buildId, parts, page);
                const results = findTracksQuery(props, parts.id, page)?.state?.data?.results || [];
                for (const track of results) {
                    const key = track?.id ?? track?.url;
                    if (key == null || seen.has(String(key))) continue;
                    seen.add(String(key));
                    all.push(track);
                }
            }

            if (all.length) {
                query.state.data.results = all;
                currentResults = all;
            }
        }

        const releaseTracks = currentResults.filter(track =>
            String(track?.release?.id || parts.id) === parts.id
        );

        if (expected && releaseTracks.length !== expected) {
            throw new Error(
                `Beatport returned an incomplete tracklist (${releaseTracks.length}/${expected}). Reload the page and try again.`
            );
        }

        return pageProps;
    }

    function trackIdFromHref(value) {
        if (!value) return '';
        try {
            const url = new URL(value, location.href);
            return url.pathname.match(/\/track\/[^/]+\/(\d+)\/?$/i)?.[1] || '';
        } catch {
            return String(value).match(/\/tracks?\/(\d+)\/?$/i)?.[1] || '';
        }
    }

    function orderTracksFromDom(trackResults) {
        const byId = new Map(
            (trackResults || [])
                .filter(track => track?.id != null)
                .map(track => [String(track.id), track])
        );
        if (!byId.size) return null;

        const ids = [];
        const seen = new Set();
        for (const anchor of document.querySelectorAll('a[href*="/track/"]')) {
            const id = trackIdFromHref(anchor.href);
            if (!id || !byId.has(id) || seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
        }

        return ids.length === byId.size
            ? ids.map(id => byId.get(id))
            : null;
    }

    function orderTracks(release, trackResults) {
        const releaseId = String(release?.id || '');
        const results = (trackResults || []).filter(track =>
            String(track?.release?.id || releaseId) === releaseId
        );

        /*
         * Beatport's embedded/API track arrays are NOT guaranteed to be in the
         * same order as the numbered tracklist shown on the release page.
         * Use the rendered DOM order when it is complete. The fallback below is
         * only for non-destructive page metadata/UI; importing requires the DOM
         * order to be verified separately.
         */
        return orderTracksFromDom(results) || [...results];
    }

    async function requireRenderedTrackOrder(trackResults, timeoutMs = 15000) {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() <= deadline) {
            const ordered = orderTracksFromDom(trackResults);
            if (ordered) return ordered;
            await sleep(250);
        }

        throw new Error(
            'Could not verify the complete numbered Beatport tracklist. ' +
            'Wait for the full tracklist to finish loading, then try again.'
        );
    }

    function gmTextRequest(url, { headers = {}, timeout = 60000, allow404 = false } = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
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
                    } else if (allow404 && response.status === 404) {
                        resolve(null);
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

    function mbHttpGet(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: { Accept: 'application/json' },
                timeout: 20000,
                onload(response) {
                    resolve(response);
                },
                ontimeout() {
                    reject(new Error('MusicBrainz request timed out'));
                },
                onerror() {
                    reject(new Error('MusicBrainz request failed'));
                },
            });
        });
    }

    function retryAfterMs(response) {
        const headers = String(response?.responseHeaders || '');
        const match = headers.match(/^retry-after:\s*(\d+)/im);
        return match ? Number(match[1]) * 1000 : 0;
    }

    async function mbJson(path, { allow404 = false } = {}) {
        const url = path.startsWith('http') ? path : MB_WS + path;

        for (let attempt = 0; attempt < 3; attempt++) {
            const wait = Math.max(0, nextMbRequestAt - Date.now());
            if (wait) await sleep(wait);
            nextMbRequestAt = Date.now() + MB_REQUEST_GAP_MS;

            const response = await mbHttpGet(url);

            if (response.status === 429 || response.status === 503) {
                if (attempt === 2) {
                    throw new Error(`MusicBrainz is temporarily unavailable/rate limiting requests (HTTP ${response.status})`);
                }
                await sleep(Math.max(
                    5000 * (attempt + 1),
                    retryAfterMs(response),
                ));
                continue;
            }

            if (allow404 && response.status === 404) return null;
            if (response.status < 200 || response.status >= 400) {
                throw new Error(`MusicBrainz API HTTP ${response.status}: ${url}`);
            }

            return JSON.parse(response.responseText);
        }

        throw new Error('MusicBrainz request did not complete');
    }

    function artistKey(artist) {
        return artist?.id != null
            ? `id:${artist.id}`
            : `name:${normalizeSpace(artist?.name).toLocaleLowerCase()}`;
    }

    function makeCredits(artists) {
        return (artists || []).filter(a => a?.name).map((artist, index, list) => ({
            artist_name: artist.name,
            credited_name: artist.name,
            mbid: artist.mbid || null,
            join_phrase: index < list.length - 1 ? ', ' : '',
        }));
    }

    function determineReleaseArtists(release, tracks) {
        const releaseArtists = (release?.artists || []).filter(a => a?.name);
        const trackSets = tracks
            .filter(track => Array.isArray(track?.artists) && track.artists.length)
            .map(track => new Set(track.artists.map(artistKey)));

        if (trackSets.length) {
            const common = releaseArtists.filter(artist => trackSets.every(set => set.has(artistKey(artist))));
            if (common.length) return makeCredits(common);
        }

        if (releaseArtists.length === 1) return makeCredits(releaseArtists);
        if (releaseArtists.length > 1 && releaseArtists.length <= 4) return makeCredits(releaseArtists);

        return [{
            artist_name: 'Various Artists',
            credited_name: 'Various Artists',
            mbid: VARIOUS_ARTISTS_MBID,
            join_phrase: '',
        }];
    }

    function trackTitle(track) {
        const title = normalizeSpace(track?.name);
        const mix = normalizeSpace(track?.mix_name);
        if (!mix || /^original mix$/i.test(mix)) return title;
        const suffix = `(${mix})`;
        if (title.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())) return title;
        return `${title} ${suffix}`;
    }

    function mapReleaseType(typeName) {
        const type = normalizeSpace(typeName).toLocaleLowerCase();
        if (type === 'album') return 'Album';
        if (type === 'single') return 'Single';
        if (type === 'ep') return 'EP';
        if (type === 'broadcast') return 'Broadcast';
        if (type === 'other') return 'Other';
        return '';
    }

    function addArtistCreditParams(params, prefix, credits) {
        credits.forEach((credit, index) => {
            params.push([`${prefix}artist_credit.names.${index}.name`, credit.credited_name || credit.artist_name]);
            params.push([`${prefix}artist_credit.names.${index}.artist.name`, credit.artist_name]);
            if (credit.mbid) params.push([`${prefix}artist_credit.names.${index}.mbid`, credit.mbid]);
            if (credit.join_phrase) params.push([`${prefix}artist_credit.names.${index}.join_phrase`, credit.join_phrase]);
        });
    }

    function beatportEntityUrl(entity, type) {
        if (!entity) return '';

        const candidates = [
            entity.url,
            entity.href,
            entity.web_url,
        ].filter(Boolean);

        for (const candidate of candidates) {
            try {
                const url = new URL(candidate, 'https://www.beatport.com');
                if (url.hostname.endsWith('beatport.com')) {
                    url.protocol = 'https:';
                    url.hostname = 'www.beatport.com';
                    url.search = '';
                    url.hash = '';
                    return url.href.replace(/\/$/, '');
                }
            } catch {}
        }

        if (entity.id != null) {
            const links = [...document.querySelectorAll(`a[href*="/${type}/"]`)];
            const found = links.find(link => {
                try {
                    return new URL(link.href, location.href).pathname.match(new RegExp(`/${type}/[^/]+/${entity.id}/?$`, 'i'));
                } catch {
                    return false;
                }
            });
            if (found) {
                const url = new URL(found.href, location.href);
                url.hostname = 'www.beatport.com';
                url.search = '';
                url.hash = '';
                return url.href.replace(/\/$/, '');
            }
        }

        if (entity.slug && entity.id != null) {
            return `https://www.beatport.com/${type}/${entity.slug}/${entity.id}`;
        }

        return '';
    }

    function canonicalUrlKey(value) {
        let url;
        try {
            url = new URL(value);
        } catch {
            return String(value || '').trim().toLowerCase();
        }

        url.hash = '';
        url.search = '';
        url.protocol = 'https:';
        url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
        url.pathname = url.pathname.replace(/\/+$/, '');
        return url.href.toLowerCase();
    }

    function providerFamily(value) {
        let url;
        try {
            url = new URL(value);
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
        return '';
    }

    function providerEntityKey(value) {
        let url;
        try {
            url = new URL(value);
        } catch {
            return canonicalUrlKey(value);
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
        return canonicalUrlKey(url.href);
    }

    function dedupeSources(sources, sourceBeatportUrl) {
        const sourceKey = providerEntityKey(sourceBeatportUrl);
        const map = new Map();

        for (const source of sources || []) {
            if (!source?.url) continue;
            const key = providerEntityKey(source.url);
            if (!key || key === sourceKey) continue;

            const current = map.get(key);
            const linkType = Number(source.linkType) || 0;
            if (!current || (!current.linkType && linkType)) {
                map.set(key, {
                    url: source.url,
                    linkType,
                    provider: providerFamily(source.url),
                });
            }
        }
        return [...map.values()];
    }

    function uniqueEntityObjects(release, tracks) {
        const artists = [];
        const seenArtists = new Set();

        for (const artist of [
            ...(release?.artists || []),
            ...tracks.flatMap(track => track?.artists || []),
        ]) {
            if (!artist?.name) continue;
            const key = artistKey(artist);
            if (seenArtists.has(key)) continue;
            seenArtists.add(key);
            artists.push(artist);
        }

        return { artists, label: release?.label || null };
    }

    async function reverseResolveBeatportLinks(release, tracks, setStatus) {
        const { artists, label } = uniqueEntityObjects(release, tracks);
        const sourceUrl = cleanBeatportUrl();
        const resourceEntries = [];

        for (const artist of artists) {
            const url = beatportEntityUrl(artist, 'artist');
            if (url) resourceEntries.push({ url, kind: 'artist', entity: artist });
        }

        const labelUrl = beatportEntityUrl(label, 'label');
        if (labelUrl) resourceEntries.push({ url: labelUrl, kind: 'label', entity: label });
        resourceEntries.push({ url: sourceUrl, kind: 'release', entity: release });

        const byResource = new Map();
        for (const entry of resourceEntries) {
            const key = canonicalUrlKey(entry.url);
            if (!byResource.has(key)) byResource.set(key, []);
            byResource.get(key).push(entry);
        }

        const resources = [...new Set(resourceEntries.map(entry => entry.url))];
        const linkedReleaseIds = new Set();
        let linkedArtists = 0;
        let linkedLabel = false;

        for (let offset = 0; offset < resources.length; offset += 25) {
            const chunk = resources.slice(offset, offset + 25);
            setStatus(`Resolving Beatport links in MusicBrainz (${Math.min(offset + chunk.length, resources.length)}/${resources.length})...`);

            const query = new URLSearchParams();
            for (const resource of chunk) query.append('resource', resource);
            query.set('inc', 'artist-rels+label-rels+release-rels');
            query.set('fmt', 'json');

            const data = await mbJson(`/url?${query.toString()}`, { allow404: true });
            if (!data) continue;

            const rows = Array.isArray(data.urls)
                ? data.urls
                : data.resource
                    ? [data]
                    : [];

            for (const row of rows) {
                const entries = byResource.get(canonicalUrlKey(row.resource)) || [];
                const relations = row.relations || [];

                for (const entry of entries) {
                    if (entry.kind === 'artist') {
                        const targets = new Map();
                        for (const rel of relations) {
                            if (rel?.['target-type'] !== 'artist' || !rel?.artist?.id) continue;
                            targets.set(rel.artist.id.toLowerCase(), rel.artist);
                        }
                        if (targets.size === 1) {
                            const target = [...targets.values()][0];
                            entry.entity.mbid = target.id;
                            entry.entity.mbName = target.name || entry.entity.name;
                            linkedArtists++;
                        }
                    } else if (entry.kind === 'label') {
                        const targets = new Map();
                        for (const rel of relations) {
                            if (rel?.['target-type'] !== 'label' || !rel?.label?.id) continue;
                            targets.set(rel.label.id.toLowerCase(), rel.label);
                        }
                        if (targets.size === 1) {
                            const target = [...targets.values()][0];
                            entry.entity.mbid = target.id;
                            entry.entity.mbName = target.name || entry.entity.name;
                            linkedLabel = true;
                        }
                    } else if (entry.kind === 'release') {
                        for (const rel of relations) {
                            if (rel?.['target-type'] === 'release' && rel?.release?.id) {
                                linkedReleaseIds.add(rel.release.id);
                            }
                        }
                    }
                }
            }
        }

        const resolvedArtists = new Map(
            artists
                .filter(artist => artist.mbid)
                .map(artist => [artistKey(artist), { mbid: artist.mbid, mbName: artist.mbName }])
        );
        for (const artist of [
            ...(release?.artists || []),
            ...tracks.flatMap(track => track?.artists || []),
        ]) {
            const resolved = resolvedArtists.get(artistKey(artist));
            if (!resolved) continue;
            artist.mbid = resolved.mbid;
            artist.mbName = resolved.mbName || artist.name;
        }

        return {
            artistCount: artists.length,
            linkedArtists,
            linkedLabel,
            linkedReleaseIds: [...linkedReleaseIds],
        };
    }

    function cacheRecordingId(value) {
        const id = String(
            typeof value === 'string'
                ? value
                : value?.recordingMbid || value?.recordingId || value?.id || ''
        ).trim().toLowerCase();
        return UUID.test(id) ? id : '';
    }

    function normalizeChoiceMap(value) {
        const result = {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) return result;

        for (const [rawIsrc, rawRecording] of Object.entries(value)) {
            const isrc = normalizeIsrc(rawIsrc);
            const recordingId = cacheRecordingId(rawRecording);
            if (isrc && recordingId) result[isrc] = recordingId;
        }
        return result;
    }

    function readIsrcChoiceCache() {
        const read = key => {
            try {
                return normalizeChoiceMap(JSON.parse(localStorage.getItem(key) || '{}'));
            } catch {
                return {};
            }
        };
        return {
            ...read(LEGACY_ISRC_CHOICE_CACHE_KEY),
            ...read(ISRC_CHOICE_CACHE_KEY),
        };
    }

    function writeIsrcChoiceCache(cache) {
        try {
            localStorage.setItem(
                ISRC_CHOICE_CACHE_KEY,
                JSON.stringify(normalizeChoiceMap(cache))
            );
        } catch {
            // Matching still works if local storage is unavailable.
        }
    }

    function cachedIsrcRecording(isrc, candidates) {
        const code = normalizeIsrc(isrc);
        if (!code) return null;

        const cache = readIsrcChoiceCache();
        const cachedId = cacheRecordingId(cache[code]);
        if (!cachedId) return null;

        const candidate = (candidates || []).find(item =>
            cacheRecordingId(item?.id) === cachedId
        );

        if (candidate) return candidate;

        delete cache[code];
        writeIsrcChoiceCache(cache);
        return null;
    }

    function rememberIsrcChoice(isrc, recordingId) {
        const code = normalizeIsrc(isrc);
        const id = cacheRecordingId(recordingId);
        if (!code || !id) return false;

        const cache = readIsrcChoiceCache();
        if (cacheRecordingId(cache[code]) === id) return false;
        cache[code] = id;
        writeIsrcChoiceCache(cache);
        return true;
    }

    function decodeBase64Utf8(text) {
        const binary = atob(String(text || '').replace(/\s+/g, ''));
        const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }

    function githubCacheGet(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: {
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'Cache-Control': 'no-cache',
                },
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
            '/contents/' + GITHUB_CACHE_PATH +
            '?ref=main&cb=' + Date.now();
        const response = await githubCacheGet(url);
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
            choices: parsed.choices,
        };
    }

    async function pullGithubChoices() {
        const remote = await fetchGithubChoiceFile();
        const local = readIsrcChoiceCache();
        const merged = {...local, ...remote.choices};
        writeIsrcChoiceCache(merged);
        return {count: Object.keys(remote.choices).length};
    }

    function candidateCredit(candidate) {
        const parts = candidate?.['artist-credit'];
        if (!Array.isArray(parts)) return { ids: [], text: '' };
        return {
            ids: parts.map(part => part?.artist?.id).filter(Boolean),
            text: parts.map(part => (part?.name ?? part?.artist?.name ?? '') + (part?.joinphrase ?? '')).join(''),
        };
    }

    function chooseByIsrc(track, candidates, isrc = '') {
        const unique = new Map();
        for (const candidate of candidates || []) {
            if (!candidate?.id || candidate.video) continue;
            unique.set(candidate.id.toLowerCase(), candidate);
        }

        const all = [...unique.values()];
        if (!all.length) return { reason: 'No recording is linked to this ISRC' };

        if (all.length === 1) {
            return { id: all[0].id, candidate: all[0] };
        }

        const cached = cachedIsrcRecording(isrc, all);
        if (cached) {
            return { id: cached.id, candidate: cached, cached: true };
        }

        const wantedTitle = normalizeTitle(track.title);
        const titleMatches = all.filter(candidate =>
            wantedTitle && normalizeTitle(candidate.title ?? candidate.name) === wantedTitle
        );

        if (!titleMatches.length) {
            return { reason: `ISRC is linked to ${all.length} recordings, but none matches the track title` };
        }
        if (titleMatches.length === 1) {
            return { id: titleMatches[0].id, candidate: titleMatches[0] };
        }

        const artistMatches = titleMatches.filter(candidate => {
            const credit = candidateCredit(candidate);
            return track.artistIds?.length &&
                credit.ids.length === track.artistIds.length &&
                track.artistIds.every((id, index) =>
                    id && id.toLowerCase() === credit.ids[index]?.toLowerCase()
                );
        });

        const pool = artistMatches.length ? artistMatches : titleMatches;
        if (pool.length === 1) {
            return { id: pool[0].id, candidate: pool[0] };
        }

        if (Number.isInteger(track.length) && track.length > 0) {
            const ranked = pool
                .filter(candidate => Number.isInteger(candidate.length) && candidate.length > 0)
                .map(candidate => ({
                    candidate,
                    difference: Math.abs(track.length - candidate.length),
                }))
                .sort((a, b) => a.difference - b.difference);

            if (
                ranked.length &&
                ranked[0].difference <= MAX_DIFFERENCE_MS &&
                (ranked.length === 1 || ranked[0].difference < ranked[1].difference)
            ) {
                return { id: ranked[0].candidate.id, candidate: ranked[0].candidate };
            }
        }

        return { reason: 'ISRC is linked to multiple recordings with the same matching title; review manually' };
    }

    async function resolveRecordingsByIsrc(tracks, setStatus) {
        const wantedCodes = [...new Set(tracks.map(track => normalizeIsrc(track?.isrc)).filter(Boolean))];
        const candidatesByIsrc = new Map();

        for (let index = 0; index < wantedCodes.length; index++) {
            const code = wantedCodes[index];
            setStatus(`Matching recordings by ISRC (${index + 1}/${wantedCodes.length})...`);

            const data = await mbJson(
                `/isrc/${encodeURIComponent(code)}?fmt=json&inc=artist-credits`,
                { allow404: true }
            );
            candidatesByIsrc.set(code, Array.isArray(data?.recordings) ? data.recordings : []);
        }

        let matched = 0;
        for (const track of tracks) {
            const isrc = normalizeIsrc(track?.isrc);
            track._mbRecordingId = '';
            track._mbRecordingReason = '';

            if (!isrc) {
                track._mbRecordingReason = 'No ISRC';
                continue;
            }

            const decision = chooseByIsrc({
                title: trackTitle(track),
                length: Number.isInteger(Number(track?.length_ms)) ? Math.round(Number(track.length_ms)) : null,
                artistIds: (track?.artists || []).map(artist => artist.mbid).filter(Boolean),
            }, candidatesByIsrc.get(isrc) || [], isrc);

            if (decision.id) {
                track._mbRecordingId = decision.id;
                track._mbRecordingCandidate = decision.candidate || null;
                track._mbRecordingCached = Boolean(decision.cached);
                rememberIsrcChoice(isrc, decision.id);
                matched++;
            } else {
                track._mbRecordingReason = decision.reason || 'No safe recording match';
            }
        }

        return {
            isrcCount: wantedCodes.length,
            matched,
            unmatched: tracks.filter(track => normalizeIsrc(track?.isrc) && !track._mbRecordingId).length,
        };
    }

    function escapeLucene(value) {
        return String(value ?? '').replace(/[+\-!(){}\[\]^"~*?:\\/|&]/g, char => '\\' + char);
    }

    function normalizedEntityName(value) {
        return normalizeSpace(value).normalize('NFKC').toLocaleLowerCase();
    }

    async function resolveExactEntityMbid(kind, entity) {
        if (!entity?.name || entity.mbid) return entity?.mbid || '';

        const field = kind === 'artist' ? 'artist' : 'label';
        const query = field + ':"' + escapeLucene(entity.name) + '"';
        const data = await mbJson(
            '/' + kind + '?query=' + encodeURIComponent(query) + '&fmt=json&limit=25'
        );
        const rows = Array.isArray(data?.[kind + 's']) ? data[kind + 's'] : [];
        const wanted = normalizedEntityName(entity.name);

        const exact = rows.filter(row => {
            if (!row?.id) return false;
            if (normalizedEntityName(row.name) === wanted) return true;
            return (row.aliases || []).some(alias =>
                normalizedEntityName(alias?.name) === wanted
            );
        });

        const unique = new Map(exact.map(row => [String(row.id).toLowerCase(), row]));
        if (unique.size !== 1) return '';

        const target = [...unique.values()][0];
        entity.mbid = target.id;
        entity.mbName = target.name || entity.name;
        return target.id;
    }

    function learnArtistMbidsFromRecordingCandidates(release, tracks) {
        const mappings = new Map();

        for (const track of tracks) {
            const parts = track?._mbRecordingCandidate?.['artist-credit'];
            if (!Array.isArray(parts)) continue;

            for (const part of parts) {
                const id = String(part?.artist?.id || '').toLowerCase();
                const names = [
                    part?.name,
                    part?.artist?.name,
                    ...(part?.artist?.aliases || []).map(alias => alias?.name),
                ].map(normalizedEntityName).filter(Boolean);

                if (!UUID.test(id)) continue;
                for (const name of names) {
                    if (!mappings.has(name)) mappings.set(name, new Set());
                    mappings.get(name).add(id);
                }
            }
        }

        for (const artist of [
            ...(release?.artists || []),
            ...tracks.flatMap(track => track?.artists || []),
        ]) {
            if (!artist?.name || artist.mbid) continue;
            const ids = mappings.get(normalizedEntityName(artist.name));
            if (ids?.size === 1) artist.mbid = [...ids][0];
        }
    }

    async function resolveMissingEntityMbids(release, tracks, setStatus) {
        learnArtistMbidsFromRecordingCandidates(release, tracks);
        const {artists, label} = uniqueEntityObjects(release, tracks);

        for (let i = 0; i < artists.length; i++) {
            if (artists[i].mbid) continue;
            setStatus('Resolving MusicBrainz artist ' + (i + 1) + '/' + artists.length + '...');
            await resolveExactEntityMbid('artist', artists[i]);
        }

        if (label && !label.mbid) {
            setStatus('Resolving MusicBrainz label...');
            await resolveExactEntityMbid('label', label);
        }

        const resolvedArtists = new Map(
            artists.filter(artist => artist.mbid)
                .map(artist => [artistKey(artist), {mbid: artist.mbid, mbName: artist.mbName}])
        );
        for (const artist of [
            ...(release?.artists || []),
            ...tracks.flatMap(track => track?.artists || []),
        ]) {
            const resolved = resolvedArtists.get(artistKey(artist));
            if (!resolved) continue;
            artist.mbid = resolved.mbid;
            artist.mbName = resolved.mbName || artist.name;
        }
    }

    function beatportEntityIdentity(value, kind) {
        try {
            const path = new URL(value).pathname;
            return path.match(new RegExp('/' + kind + '/[^/]+/(\\d+)/?$', 'i'))?.[1] || '';
        } catch {
            return '';
        }
    }

    async function mbEntityHasBeatportLink(kind, mbid, beatportUrl) {
        const data = await mbJson('/' + kind + '/' + encodeURIComponent(mbid) + '?fmt=json&inc=url-rels');
        const wantedId = beatportEntityIdentity(beatportUrl, kind);
        return (data?.relations || []).some(rel => {
            const resource = rel?.url?.resource || rel?.target || '';
            if (providerFamily(resource) !== 'beatport') return false;
            if (!wantedId) return canonicalUrlKey(resource) === canonicalUrlKey(beatportUrl);
            return beatportEntityIdentity(resource, kind) === wantedId;
        });
    }

    const beatportLinkTypeIdCache = new Map();
    async function beatportLinkTypeId(kind) {
        if (beatportLinkTypeIdCache.has(kind)) return beatportLinkTypeIdCache.get(kind);
        const uuid = BEATPORT_REL_UUID[kind];
        if (!uuid) throw new Error('Unsupported MusicBrainz entity type: ' + kind);

        const response = await gmTextRequest('https://musicbrainz.org/relationship/' + uuid);
        const doc = new DOMParser().parseFromString(response.text, 'text/html');
        const match = normalizeSpace(doc.body?.textContent).match(/\bID:\s*(\d+)\b/);
        if (!match) throw new Error('Could not resolve MusicBrainz Beatport relationship type');
        beatportLinkTypeIdCache.set(kind, match[1]);
        return match[1];
    }

    function findEntityEditForm(doc, kind) {
        const prefix = 'edit-' + kind + '.';
        return [...doc.querySelectorAll('form')].find(form => {
            const method = (form.getAttribute('method') || 'get').toLowerCase();
            return method === 'post' && [...form.elements].some(element =>
                typeof element.name === 'string' && element.name.startsWith(prefix)
            );
        }) || null;
    }

    function gmFormRequest(method, url, body = null) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url,
                headers: body ? {
                    Accept: 'text/html,application/xhtml+xml',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                } : {
                    Accept: 'text/html,application/xhtml+xml',
                },
                data: body || undefined,
                timeout: 30000,
                onload: response => resolve({
                    status: response.status,
                    text: response.responseText || '',
                    finalUrl: response.finalUrl || url,
                }),
                ontimeout: () => reject(new Error('MusicBrainz edit request timed out')),
                onerror: () => reject(new Error('MusicBrainz edit request failed')),
            });
        });
    }

    async function submitMissingBeatportEntityLink(kind, mbid, beatportUrl) {
        if (!UUID.test(String(mbid || '')) || !beatportUrl) return {added: false};

        if (await mbEntityHasBeatportLink(kind, mbid, beatportUrl)) {
            return {added: false, alreadyPresent: true};
        }

        const linkTypeId = await beatportLinkTypeId(kind);
        const editUrl = new URL('https://musicbrainz.org/' + kind + '/' + mbid + '/edit');
        const prefix = 'edit-' + kind + '.';
        editUrl.searchParams.set(prefix + 'url.0.text', beatportUrl);
        editUrl.searchParams.set(prefix + 'url.0.link_type_id', String(linkTypeId));
        editUrl.searchParams.set(
            prefix + 'edit_note',
            'Add missing Beatport link.\nImporter: ' + GITHUB_SCRIPT_URL
        );

        const getResponse = await gmFormRequest('GET', editUrl.href);
        const getUrl = new URL(getResponse.finalUrl);
        if (getUrl.pathname.startsWith('/login')) {
            throw new Error('MusicBrainz login is required to add Beatport links');
        }
        if (getResponse.status < 200 || getResponse.status >= 400) {
            throw new Error('MusicBrainz edit page HTTP ' + getResponse.status);
        }

        const doc = new DOMParser().parseFromString(getResponse.text, 'text/html');
        const form = findEntityEditForm(doc, kind);
        if (!form) throw new Error('Could not find MusicBrainz ' + kind + ' edit form');

        const params = new URLSearchParams();
        for (const [key, value] of new FormData(form).entries()) {
            if (typeof value === 'string') params.append(key, value);
        }

        for (const [key, value] of editUrl.searchParams.entries()) {
            if (
                key.startsWith(prefix + 'url.') &&
                (key.endsWith('.text') || key.endsWith('.link_type_id'))
            ) {
                params.set(key, value);
            }
        }

        if (!params.has(prefix + 'edit_note')) {
            params.set(
                prefix + 'edit_note',
                'Add missing Beatport link.\nImporter: ' + GITHUB_SCRIPT_URL
            );
        } else {
            const currentNote = params.get(prefix + 'edit_note') || '';
            if (!currentNote.includes(GITHUB_SCRIPT_URL)) {
                params.set(
                    prefix + 'edit_note',
                    (currentNote.trim() ? currentNote.trim() + '\n\n' : '') +
                    'Add missing Beatport link.\nImporter: ' + GITHUB_SCRIPT_URL
                );
            }
        }

        const action = new URL(form.getAttribute('action') || getResponse.finalUrl, getResponse.finalUrl);
        const postResponse = await gmFormRequest('POST', action.href, params.toString());
        const finalUrl = new URL(postResponse.finalUrl);
        const stillEditing = new RegExp('^/' + kind + '/[0-9a-f-]{36}/edit/?$', 'i')
            .test(finalUrl.pathname);

        if (postResponse.status < 200 || postResponse.status >= 400 || stillEditing) {
            const postDoc = new DOMParser().parseFromString(postResponse.text, 'text/html');
            const error = [...postDoc.querySelectorAll('.error, .errors, .error-message, .field-error')]
                .map(node => normalizeSpace(node.textContent))
                .filter(Boolean)
                .slice(0, 3)
                .join(' | ');
            throw new Error(error || 'MusicBrainz did not confirm the Beatport link edit');
        }

        return {added: true};
    }

    async function addMissingBeatportEntityLinks(release, tracks, setStatus) {
        const {artists, label} = uniqueEntityObjects(release, tracks);
        const entries = [
            ...artists.map(entity => ({kind: 'artist', entity, url: beatportEntityUrl(entity, 'artist')})),
            ...(label ? [{kind: 'label', entity: label, url: beatportEntityUrl(label, 'label')}] : []),
        ].filter(entry => entry.url && entry.entity?.mbid);

        let added = 0;
        let failed = 0;
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            setStatus(
                'Checking Beatport ' + entry.kind + ' links (' + (i + 1) + '/' + entries.length + ')...'
            );
            try {
                const result = await submitMissingBeatportEntityLink(
                    entry.kind,
                    entry.entity.mbid,
                    entry.url
                );
                if (result.added) added++;
            } catch (error) {
                failed++;
                console.warn('[Beatport MB Importer] Could not add Beatport link', entry, error);
            }
        }

        return {checked: entries.length, added, failed};
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

    function releaseRelationSources(release) {
        const sources = [];
        for (const rel of release?.relations || []) {
            if (rel?.['target-type'] !== 'url' || rel?.ended || !rel?.url?.resource) continue;
            const relName = normalizeSpace(rel.type).toLocaleLowerCase();
            sources.push({
                url: rel.url.resource,
                linkType: RELEASE_LINK_TYPE_IDS.get(relName) || 0,
            });
        }
        return sources;
    }

    async function fetchReleaseSourcesByMbid(mbid) {
        const release = await mbJson(`/release/${encodeURIComponent(mbid)}?inc=url-rels+media&fmt=json`, { allow404: true });
        return release ? releaseRelationSources(release) : [];
    }

    async function findMusicBrainzSourcesByBarcode(barcode, linkedReleaseIds, setStatus) {
        if (!barcode) return [];

        setStatus('Finding MusicBrainz releases with the same barcode...');
        const search = await mbJson(`/release?query=${encodeURIComponent(`barcode:${barcode}`)}&fmt=json&limit=20`);
        const ids = new Set(linkedReleaseIds || []);

        for (const release of search?.releases || []) {
            if (release?.id && (!release.barcode || equalGtin(release.barcode, barcode))) {
                ids.add(release.id);
            }
        }

        const selected = [...ids].slice(0, 8);
        const sources = [];
        for (let index = 0; index < selected.length; index++) {
            setStatus(`Reading linked release sources (${index + 1}/${selected.length})...`);
            sources.push(...await fetchReleaseSourcesByMbid(selected[index]));
        }
        return sources;
    }

    function parseAppleAlbumUrl(value) {
        let url;
        try {
            url = new URL(value);
        } catch {
            return null;
        }

        if (providerFamily(url) !== 'apple') return null;
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

    async function lookupAppleByBarcode(barcode) {
        const storefronts = ['us', 'gb', 'de', 'fr', 'jp'];
        for (const storefront of storefronts) {
            const url = new URL(`${APPLE_API_BASE}/catalog/${storefront}/albums`);
            url.searchParams.set('filter[upc]', barcode);

            try {
                const json = await appleApiRequest(url.href, 'https://music.apple.com/us/browse');
                const albums = (json.data || []).filter(item => item.type === 'albums');
                // Apple may return non-matching albums for filter[upc]; never fall back to an unchecked result.
                const album = albums.find(item => {
                    const candidateUpc = item?.attributes?.upc;
                    return candidateUpc && equalGtin(candidateUpc, barcode);
                });
                if (album?.attributes?.url) {
                    return {
                        url: album.attributes.url,
                        linkType: PAID_STREAMING,
                        provider: 'apple',
                    };
                }
            } catch (error) {
                console.debug('[Beatport MB Importer] Apple Music barcode lookup failed', storefront, error);
            }
        }
        return null;
    }

    async function findReleaseSources(release, reverseInfo, setStatus) {
        const sourceUrl = cleanBeatportUrl();
        const barcode = String(release?.upc || '').trim();
        const sources = await findMusicBrainzSourcesByBarcode(
            barcode,
            reverseInfo?.linkedReleaseIds || [],
            setStatus
        );

        if (barcode && !sources.some(source => providerFamily(source.url) === 'apple')) {
            setStatus('Checking Apple Music by barcode...');
            const apple = await lookupAppleByBarcode(barcode);
            if (apple) sources.push(apple);
        }

        return dedupeSources(sources, sourceUrl);
    }

    function buildImport(release, tracks, extraSources = []) {
        const sourceUrl = cleanBeatportUrl();
        const params = [];
        const title = normalizeSpace(release.name);
        const releaseCredits = determineReleaseArtists(release, tracks);
        const date = String(release.new_release_date || release.publish_date || '').split('-');
        const releaseType = mapReleaseType(release?.type?.name);

        params.push(['name', title]);
        addArtistCreditParams(params, '', releaseCredits);
        if (releaseType) params.push(['type', releaseType]);
        params.push(['status', 'official']);
        params.push(['packaging', 'None']);

        if (/^\d{4}$/.test(date[0] || '')) params.push(['events.0.date.year', date[0]]);
        if (/^\d{2}$/.test(date[1] || '')) params.push(['events.0.date.month', String(Number(date[1]))]);
        if (/^\d{2}$/.test(date[2] || '')) params.push(['events.0.date.day', String(Number(date[2]))]);

        const worldwide = tracks.length > 0 && tracks.every(track => track.available_worldwide === true);
        if (worldwide) params.push(['events.0.country', 'XW']);

        if (release?.upc) params.push(['barcode', String(release.upc)]);
        if (release?.label?.name) params.push(['labels.0.name', release.label.name]);
        if (release?.label?.mbid) params.push(['labels.0.mbid', release.label.mbid]);
        if (release?.catalog_number) params.push(['labels.0.catalog_number', String(release.catalog_number)]);

        const urls = [
            { url: sourceUrl, linkType: PURCHASE_FOR_DOWNLOAD },
            ...dedupeSources(extraSources, sourceUrl),
        ];
        urls.forEach((entry, index) => {
            params.push([`urls.${index}.url`, entry.url]);
            if (entry.linkType) params.push([`urls.${index}.link_type`, String(entry.linkType)]);
        });

        params.push(['mediums.0.format', 'Digital Media']);

        tracks.forEach((track, index) => {
            const prefix = `mediums.0.track.${index}.`;
            params.push([`${prefix}number`, String(index + 1)]);
            params.push([`${prefix}name`, trackTitle(track)]);

            if (track._mbRecordingId) {
                params.push([`${prefix}recording`, track._mbRecordingId]);
            }

            if (Number.isFinite(Number(track?.length_ms)) && Number(track.length_ms) > 0) {
                params.push([`${prefix}length`, String(Math.round(Number(track.length_ms)))]);
            }
            addArtistCreditParams(params, prefix, makeCredits(track?.artists || []));
        });

        const editNoteLines = [
            `Imported from Beatport: ${sourceUrl}`,
            'Beatport artist/label links were reverse-resolved through MusicBrainz where available.',
            'Existing recordings were matched by Beatport ISRC where the result was unambiguous.',
        ];
        if (extraSources.length) {
            editNoteLines.push(`Additional release URLs found from barcode/reverse-link lookups: ${extraSources.length}.`);
        }
        editNoteLines.push(`Importer: ${GITHUB_SCRIPT_URL}`);
        params.push(['edit_note', editNoteLines.join('\n')]);

        return {
            params,
            pending: {
                beatportReleaseId: String(release.id),
                sourceUrl,
                title,
                barcode: String(release?.upc || ''),
                createdAt: Date.now(),
                tracks: tracks.map(track => ({
                    title: trackTitle(track),
                    isrc: normalizeIsrc(track?.isrc),
                    recordingId: cacheRecordingId(track?._mbRecordingId),
                    length: Number.isFinite(Number(track?.length_ms))
                        ? Math.round(Number(track.length_ms))
                        : null,
                })),
            },
            releaseCredits,
        };
    }

    function submitMusicBrainzImport(importData) {
        try {
            GM_setValue(PENDING_IMPORT_KEY, JSON.stringify(importData.pending || {}));
        } catch (error) {
            console.warn('[Beatport MB Importer] Could not save pending import state', error);
        }

        const form = document.createElement('form');
        form.method = 'post';
        form.action = MB_ADD_RELEASE;
        form.target = '_blank';
        form.acceptCharset = 'UTF-8';
        form.style.display = 'none';

        for (const [name, value] of importData.params) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = String(value);
            form.appendChild(input);
        }

        document.body.appendChild(form);
        form.submit();
        form.remove();
    }

    function openMusicBrainzSearch(importData, tracks) {
        const title = importData.pending.title || '';
        const artist = importData.releaseCredits.map(credit => credit.artist_name).join(', ');
        const barcode = importData.pending.barcode || '';
        const queryParts = [
            `artist:(${artist})`,
            `release:(${title})`,
            `tracks:(${tracks.length})`,
        ];
        if (barcode) queryParts.push(`barcode:${barcode}`);

        const url = new URL('https://musicbrainz.org/search');
        url.searchParams.set('query', queryParts.join(' '));
        url.searchParams.set('type', 'release');
        url.searchParams.set('advanced', '1');
        window.open(url.toString(), '_blank', 'noopener');
    }

    function openAllIsrcs(release, tracks) {
        const isrcs = tracks.map(track => normalizeIsrc(track?.isrc));
        if (!isrcs.some(Boolean)) return;

        const target = new URL(MAGIC_ISRC);
        isrcs.forEach((isrc, index) => {
            if (isrc) target.searchParams.set(`isrc1-${index + 1}`, isrc);
        });
        target.searchParams.set(
            'edit-note',
            `ISRCs imported from Beatport: ${cleanBeatportUrl()}\nImporter: ${GITHUB_SCRIPT_URL}`
        );
        window.open(target.toString(), '_blank', 'noopener');
    }


    function canonicalBeatportReleaseResource() {
        const parts = releasePathParts();
        if (!parts) return '';
        return `https://www.beatport.com/release/${parts.slug.toLowerCase()}/${String(Number(parts.id))}`;
    }

    function readMbReleaseLinkCache() {
        try {
            const value = GM_getValue(MB_RELEASE_LINK_CACHE_KEY, {});
            return value && typeof value === 'object' ? value : {};
        } catch {
            return {};
        }
    }

    function writeMbReleaseLinkCache(cache) {
        try {
            const entries = Object.entries(cache)
                .sort((a, b) => Number(b[1]?.checkedAt || 0) - Number(a[1]?.checkedAt || 0))
                .slice(0, 500);
            GM_setValue(MB_RELEASE_LINK_CACHE_KEY, Object.fromEntries(entries));
        } catch {
            // Cache failure must never break the importer.
        }
    }

    function cachedMbReleaseLinks(resource, force = false) {
        if (force || !resource) return null;
        const item = readMbReleaseLinkCache()[resource];
        if (!item?.checkedAt || !Array.isArray(item.releases)) return null;

        const ttl = item.releases.length
            ? MB_RELEASE_FOUND_TTL
            : MB_RELEASE_MISSING_TTL;
        return Date.now() - Number(item.checkedAt) <= ttl
            ? item.releases
            : null;
    }

    function storeMbReleaseLinks(resource, releases) {
        const cache = readMbReleaseLinkCache();
        cache[resource] = {
            checkedAt: Date.now(),
            releases,
        };
        writeMbReleaseLinkCache(cache);
    }

    function parseMbReleaseRelations(data) {
        const unique = new Map();

        for (const relation of Array.isArray(data?.relations) ? data.relations : []) {
            const release = relation?.release;
            const id = String(release?.id || '').trim().toLowerCase();
            if (!UUID.test(id) || unique.has(id)) continue;

            unique.set(id, {
                id,
                title: normalizeSpace(release?.title),
                disambiguation: normalizeSpace(release?.disambiguation),
            });
        }

        return [...unique.values()];
    }

    async function lookupMbReleasesForBeatport(resource, force = false) {
        const cached = cachedMbReleaseLinks(resource, force);
        if (cached !== null) return cached;

        const pendingKey = resource + (force ? ':force' : '');
        if (mbReleaseLinkPending.has(pendingKey)) {
            return mbReleaseLinkPending.get(pendingKey);
        }

        const promise = (async () => {
            try {
                const data = await mbJson(
                    '/url?resource=' + encodeURIComponent(resource) +
                    '&inc=release-rels&fmt=json',
                    {allow404: true}
                );
                const releases = parseMbReleaseRelations(data);
                storeMbReleaseLinks(resource, releases);
                return releases;
            } catch (error) {
                console.warn(
                    '[Beatport MB Importer] MusicBrainz release-link lookup failed:',
                    resource,
                    error
                );
                return null;
            } finally {
                mbReleaseLinkPending.delete(pendingKey);
            }
        })();

        mbReleaseLinkPending.set(pendingKey, promise);
        return promise;
    }

    function musicBrainzCatalogSearchUrl(catalogNumber) {
        const value = normalizeSpace(catalogNumber);
        if (!value) return 'https://musicbrainz.org/search?type=release&method=indexed&query=';

        const url = new URL('https://musicbrainz.org/search');
        url.searchParams.set('query', 'catno:"' + value.replace(/"/g, '\\"') + '"');
        url.searchParams.set('type', 'release');
        url.searchParams.set('method', 'indexed');
        return url.href;
    }

    function installMbReleaseIndicatorStyles() {
        if (document.getElementById(MB_RELEASE_INDICATOR_STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = MB_RELEASE_INDICATOR_STYLE_ID;
        style.textContent = `
            #${MB_RELEASE_INDICATOR_ID} {
                display: inline-flex !important;
                align-items: center !important;
                gap: 4px !important;
                margin-left: 9px !important;
                vertical-align: middle !important;
                text-decoration: none !important;
            }
            #${MB_RELEASE_INDICATOR_ID} > a,
            #${MB_RELEASE_INDICATOR_ID} > span {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
            }
            #${MB_RELEASE_INDICATOR_ID} img {
                display: block !important;
                width: 26px !important;
                height: 26px !important;
                max-width: none !important;
                border: 0 !important;
                opacity: .94 !important;
                transition: transform .12s ease, opacity .12s ease !important;
            }
            #${MB_RELEASE_INDICATOR_ID} a:hover img {
                opacity: 1 !important;
                transform: scale(1.12) !important;
            }
            #${MB_RELEASE_INDICATOR_ID} .beatport-mb-release-search {
                width: 16px !important;
                height: 16px !important;
                border: 1px solid rgba(255,255,255,.48) !important;
                border-radius: 50% !important;
                color: #fff !important;
                background: rgba(0,0,0,.28) !important;
                text-decoration: none !important;
                font: 700 11px/1 "Segoe UI", sans-serif !important;
            }
        `;
        document.head.appendChild(style);
    }

    function findBeatportReleaseHeading() {
        return document.querySelector(
            'main h1, div[class^="ReleaseDetailCard-style__"] h1, h1'
        );
    }

    function makeMbFavicon() {
        const image = document.createElement('img');
        image.src = 'https://musicbrainz.org/favicon.ico';
        image.alt = 'MusicBrainz';
        image.width = 26;
        image.height = 26;
        return image;
    }

    async function updateMusicBrainzReleaseIndicator(release, serial, force = false) {
        const resource = canonicalBeatportReleaseResource();
        if (!resource) {
            document.getElementById(MB_RELEASE_INDICATOR_ID)?.remove();
            return;
        }

        const heading = findBeatportReleaseHeading();
        if (!heading) return;

        const releases = await lookupMbReleasesForBeatport(resource, force);
        if (
            !Array.isArray(releases) ||
            serial !== processSerial ||
            resource !== canonicalBeatportReleaseResource()
        ) {
            return;
        }

        const currentHeading = findBeatportReleaseHeading();
        if (!currentHeading) return;

        installMbReleaseIndicatorStyles();
        document.getElementById(MB_RELEASE_INDICATOR_ID)?.remove();

        const holder = document.createElement('span');
        holder.id = MB_RELEASE_INDICATOR_ID;
        holder.dataset.resource = resource;
        holder.dataset.missing = releases.length ? '0' : '1';

        if (releases.length) {
            const linkedRelease = releases[0];
            const link = document.createElement('a');
            link.href = 'https://musicbrainz.org/release/' + linkedRelease.id;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';

            const label = linkedRelease.title
                ? 'Open MusicBrainz release: ' + linkedRelease.title
                : 'Open MusicBrainz release';
            link.title = linkedRelease.disambiguation
                ? label + ' (' + linkedRelease.disambiguation + ')'
                : label;
            link.setAttribute('aria-label', link.title);
            link.appendChild(makeMbFavicon());
            holder.appendChild(link);
        } else {
            const icon = document.createElement('span');
            icon.title = 'No MusicBrainz release link found';
            icon.appendChild(makeMbFavicon());

            const question = document.createElement('a');
            question.className = 'beatport-mb-release-search';
            question.textContent = '?';
            question.href = musicBrainzCatalogSearchUrl(release?.catalog_number);
            question.target = '_blank';
            question.rel = 'noopener noreferrer';
            question.title = release?.catalog_number
                ? 'Search MusicBrainz releases by catalog number: ' + release.catalog_number
                : 'Search MusicBrainz releases';
            question.setAttribute('aria-label', question.title);

            holder.append(icon, question);
        }

        currentHeading.appendChild(holder);
    }

    function refreshMissingMusicBrainzReleaseIndicator() {
        if (!currentReleaseForIndicator) return;

        const resource = canonicalBeatportReleaseResource();
        const holder = document.getElementById(MB_RELEASE_INDICATOR_ID);
        if (!resource || holder?.dataset.resource !== resource) return;

        const cached = cachedMbReleaseLinks(resource);
        if (holder.dataset.missing === '1' && cached !== null) {
            void updateMusicBrainzReleaseIndicator(
                currentReleaseForIndicator.release,
                currentReleaseForIndicator.serial,
                true
            );
        }
    }

    function makeButton(text, primary = false) {
        const selector = primary
            ? 'button[class*="Button_primary__"]'
            : 'button[class*="Button_text__"]';

        const nativeButton = document.querySelector(selector);
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;

        if (nativeButton?.className && typeof nativeButton.className === 'string') {
            button.className = nativeButton.className;
        } else {
            // Current Beatport CSS-module fallbacks; visual styling still comes
            // from Beatport's own stylesheet rather than custom importer CSS.
            button.className = primary
                ? 'Button_button__exqP_ Button_primary__DEC_1'
                : 'Button_button__exqP_ Button_text__bvVGC';
        }

        return button;
    }

    function findUiAnchor() {
        const controls = document.querySelector('div[class^="ReleaseDetailCard-style__Controls"]');
        const infoArea = document.querySelector('div[class^="ReleaseDetailCard-style__Info"]')?.parentElement;
        return controls || infoArea || null;
    }

    function removeImporterMetadata() {
        document.getElementById('beatport-mb-barcode-row')?.remove();
        document.getElementById('beatport-mb-release-artist-row')?.remove();
        document.getElementById('beatport-mb-status-row')?.remove();
    }

    function releaseMetaElements() {
        const meta = document.querySelector('div[class^="ReleaseDetailCard-style__Meta"]');
        if (!meta) return null;

        const template = meta.querySelector('div[class^="ReleaseDetailCard-style__Info"]');
        const controls = meta.querySelector('div[class^="ReleaseDetailCard-style__Controls"]');
        if (!template || !controls) return null;

        return {meta, template, controls};
    }

    function makeNativeInfoRow(id, label, value) {
        const parts = releaseMetaElements();
        if (!parts || !value) return null;

        document.getElementById(id)?.remove();

        const row = document.createElement('div');
        row.id = id;
        row.className = parts.template.className;

        const labelElement = document.createElement('p');
        labelElement.textContent = label;

        const valueElement = document.createElement('span');
        valueElement.textContent = value;

        row.append(labelElement, valueElement);
        parts.controls.insertAdjacentElement('beforebegin', row);
        return row;
    }

    function displayReleaseMetadata(release, tracks) {
        document.getElementById('beatport-mb-barcode-row')?.remove();
        document.getElementById('beatport-mb-release-artist-row')?.remove();

        const barcode = normalizeSpace(release?.upc);
        const releaseArtists = determineReleaseArtists(release, tracks)
            .map(credit => normalizeSpace(credit.credited_name || credit.artist_name))
            .filter(Boolean)
            .join(', ');

        if (barcode) {
            makeNativeInfoRow('beatport-mb-barcode-row', 'Barcode', barcode);
        }

        if (releaseArtists) {
            makeNativeInfoRow(
                'beatport-mb-release-artist-row',
                'Release Artist',
                releaseArtists
            );
        }
    }

    function setNativeStatus(text) {
        const value = normalizeSpace(text);
        if (!value) {
            document.getElementById('beatport-mb-status-row')?.remove();
            return;
        }
        makeNativeInfoRow('beatport-mb-status-row', 'MusicBrainz', value);
    }

    function makeUiBox() {
        document.getElementById(UI_ID)?.remove();

        const box = document.createElement('div');
        box.id = UI_ID;
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', 'MusicBrainz tools');
        Object.assign(box.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            marginTop: '8px',
            font: 'inherit',
            color: 'inherit',
        });

        const anchor = findUiAnchor();
        if (anchor) {
            // Keep the importer inside Beatport's own release controls instead
            // of drawing a separate custom panel.
            if (anchor.matches('div[class^="ReleaseDetailCard-style__Controls"]')) {
                anchor.appendChild(box);
            } else if (anchor.parentElement) {
                anchor.insertAdjacentElement('afterend', box);
            } else {
                anchor.appendChild(box);
            }
        } else {
            const main = document.querySelector('main') || document.body;
            main.prepend(box);
        }

        return box;
    }

    function installIdleUi(release, trackResults, serial) {
        const box = makeUiBox();
        const previewTracks = orderTracks(release, trackResults);
        const allIsrcs = trackResults.map(track => normalizeIsrc(track?.isrc)).filter(Boolean);
        const baseImportData = buildImport(release, previewTracks, []);

        const importButton = makeButton('Import to MusicBrainz', true);
        importButton.title = 'Start MusicBrainz lookups, then open the release editor with the enriched Beatport metadata';

        const searchButton = makeButton('Search MusicBrainz');
        searchButton.title = 'Search MusicBrainz for an existing release without running importer lookups';
        searchButton.addEventListener('click', () => openMusicBrainzSearch(baseImportData, previewTracks));

        const isrcButton = makeButton(`Submit ISRCs (${allIsrcs.length})`);
        isrcButton.title = 'Open MagicISRC with this Beatport release\'s ISRCs prefilled in visible track order';
        isrcButton.disabled = allIsrcs.length === 0;
        isrcButton.addEventListener('click', async () => {
            try {
                setNativeStatus('Verifying Beatport track order...');
                const tracks = await requireRenderedTrackOrder(trackResults);
                if (serial !== processSerial) return;
                setNativeStatus('');
                openAllIsrcs(release, tracks);
            } catch (error) {
                console.error('[Beatport MB Importer]', error);
                setNativeStatus(`Importer error: ${error.message}`);
            }
        });

        importButton.addEventListener('click', async () => {
            if (serial !== processSerial) return;

            importButton.disabled = true;
            searchButton.disabled = true;
            isrcButton.disabled = true;

            const setStatus = text => setNativeStatus(text);

            try {
                setStatus('Verifying Beatport track order...');
                const tracks = await requireRenderedTrackOrder(trackResults);
                if (serial !== processSerial) return;

                setStatus('Syncing shared ISRC cache...');
                try {
                    await pullGithubChoices();
                } catch (error) {
                    console.warn('[Beatport MB Importer] Shared cache pull failed:', error);
                }

                setStatus('Resolving Beatport artist/label links in MusicBrainz...');
                const reverse = await reverseResolveBeatportLinks(release, tracks, setStatus);
                if (serial !== processSerial) return;

                const recordings = await resolveRecordingsByIsrc(tracks, setStatus);
                if (serial !== processSerial) return;

                await resolveMissingEntityMbids(release, tracks, setStatus);
                if (serial !== processSerial) return;

                const entityLinks = await addMissingBeatportEntityLinks(release, tracks, setStatus);
                if (serial !== processSerial) return;

                const sources = await findReleaseSources(release, reverse, setStatus);
                if (serial !== processSerial) return;

                const importData = buildImport(release, tracks, sources);
                setStatus([
                    `Ready: artists linked ${reverse.linkedArtists}/${reverse.artistCount}`,
                    `recordings linked ${recordings.matched}/${allIsrcs.length}`,
                    `Beatport entity links added ${entityLinks.added}`,
                    entityLinks.failed ? `entity-link failures ${entityLinks.failed}` : '',
                    `extra sources ${sources.length}`,
                    release?.label?.mbid ? 'label linked' : 'label unresolved',
                    'opening MusicBrainz...',
                ].filter(Boolean).join(' | '));

                submitMusicBrainzImport(importData);
            } catch (error) {
                console.error('[Beatport MB Importer]', error);
                setStatus(`Importer error: ${error.message}`);
                importButton.disabled = false;
                searchButton.disabled = false;
                isrcButton.disabled = allIsrcs.length === 0;
            }
        });

        box.append(importButton, searchButton, isrcButton);
    }

    async function processBeatportRelease() {
        const serial = ++processSerial;

        if (!releasePathParts()) {
            document.getElementById(UI_ID)?.remove();
            document.getElementById(MB_RELEASE_INDICATOR_ID)?.remove();
            currentReleaseForIndicator = null;
            removeImporterMetadata();
            return;
        }

        try {
            const pageProps = await getCurrentPageProps();
            if (serial !== processSerial) return;

            const release = pageProps?.release;
            const trackResults = findTracksQuery(pageProps, release?.id, 1)?.state?.data?.results || [];
            if (!release || !trackResults.length) {
                throw new Error('Beatport release metadata or tracks were not found');
            }

            const tracks = orderTracks(release, trackResults);
            if (!tracks.length) throw new Error('No tracks belonging to this release were found');

            const expected = Number(release.track_count || 0);
            if (expected && tracks.length !== expected) {
                throw new Error(
                    `Beatport track count mismatch (${tracks.length}/${expected}). Import cancelled.`
                );
            }

            displayReleaseMetadata(release, tracks);
            setNativeStatus('');
            installIdleUi(release, trackResults, serial);
            currentReleaseForIndicator = {release, serial};
            void updateMusicBrainzReleaseIndicator(release, serial);
        } catch (error) {
            console.error('[Beatport MB Importer]', error);
            if (serial !== processSerial) return;
            makeUiBox();
            setNativeStatus(`Importer error: ${error.message}`);
        }
    }

    let lastUrl = '';
    const refresh = () => {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        void processBeatportRelease();
    };

    window.addEventListener('focus', refreshMissingMusicBrainzReleaseIndicator);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            refreshMissingMusicBrainzReleaseIndicator();
        }
    });

    refresh();
    setInterval(refresh, 750);
})();

// MusicBrainz-side support for Beatport imports:
// - preserve exact ISRC-linked recording associations across Tracklist edits
// - highlight tracks that still show "Add new recording"
(() => {
    'use strict';

    if (!/^(?:beta\.)?musicbrainz\.org$/i.test(location.hostname)) return;
    if (!/^\/release\/add\/?$/i.test(location.pathname)) return;

    const PAGE_WINDOW = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    const PENDING_KEY = 'beatport-mb-importer:pending:v1';
    const UNLINKED_CLASS = 'beatport-unlinked-recording';

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const normalize = value => String(value ?? '')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLocaleLowerCase();

    function currentRecordingId(trackModel) {
        const recording = typeof trackModel?.recording === 'function'
            ? trackModel.recording()
            : trackModel?.recording;
        const id = String(recording?.gid || recording?.id || '').trim().toLowerCase();
        return /^[0-9a-f-]{36}$/i.test(id) ? id : '';
    }

    function keepExactIsrcAssociationAcrossTracklistEdits(trackModel, recordingEntity) {
        if (
            !trackModel ||
            typeof trackModel.recording !== 'function' ||
            !recordingEntity?.gid
        ) return;

        const expectedGid = String(recordingEntity.gid).toLowerCase();
        const previous = trackModel.__beatportExactIsrcGuard;
        if (previous?.subscriptions) {
            for (const subscription of previous.subscriptions) subscription?.dispose?.();
        }

        const guard = {
            expectedGid,
            recordingEntity,
            subscriptions: [],
            restoring: false,
            recentTracklistChangeUntil: 0,
        };
        trackModel.__beatportExactIsrcGuard = guard;

        const disposeGuard = () => {
            if (trackModel.__beatportExactIsrcGuard !== guard) return;
            for (const subscription of guard.subscriptions) subscription?.dispose?.();
            delete trackModel.__beatportExactIsrcGuard;
        };

        const refreshSavedComparisonState = () => {
            if (trackModel.__beatportExactIsrcGuard !== guard) return;

            if (typeof trackModel.name === 'function') {
                trackModel.name.saved =
                    typeof trackModel.name.peek === 'function'
                        ? trackModel.name.peek()
                        : trackModel.name();
            }

            if (typeof trackModel.length === 'function') {
                trackModel.length.saved =
                    typeof trackModel.length.peek === 'function'
                        ? trackModel.length.peek()
                        : trackModel.length();
            }
        };

        const restoreIfMusicBrainzUnlinked = () => {
            if (guard.restoring || trackModel.__beatportExactIsrcGuard !== guard) return;

            const current = trackModel.recording();
            const gid = String(current?.gid || '').toLowerCase();

            if (gid && gid !== expectedGid) {
                disposeGuard();
                return;
            }
            if (gid === expectedGid) return;
            if (Date.now() > guard.recentTracklistChangeUntil) {
                disposeGuard();
                return;
            }

            guard.restoring = true;
            try {
                refreshSavedComparisonState();
                trackModel.recording(recordingEntity);
                if (typeof trackModel.hasNewRecording === 'function') {
                    trackModel.hasNewRecording(false);
                }
            } finally {
                guard.restoring = false;
            }
        };

        refreshSavedComparisonState();

        for (const observable of [trackModel.name, trackModel.length]) {
            if (typeof observable?.subscribe !== 'function') continue;

            guard.subscriptions.push(observable.subscribe(() => {
                guard.recentTracklistChangeUntil = Date.now() + 1500;
                refreshSavedComparisonState();
                setTimeout(restoreIfMusicBrainzUnlinked, 0);
                setTimeout(restoreIfMusicBrainzUnlinked, 350);
            }));
        }

        if (typeof trackModel.recording.subscribe === 'function') {
            guard.subscriptions.push(trackModel.recording.subscribe(value => {
                if (guard.restoring) return;

                const gid = String(value?.gid || '').toLowerCase();
                if (gid && gid !== expectedGid) {
                    disposeGuard();
                    return;
                }

                if (!gid && Date.now() <= guard.recentTracklistChangeUntil) {
                    setTimeout(restoreIfMusicBrainzUnlinked, 0);
                } else if (!gid) {
                    disposeGuard();
                }
            }));
        }
    }

    function readPendingImport() {
        try {
            const parsed = JSON.parse(String(GM_getValue(PENDING_KEY, '') || '{}'));
            if (!parsed || typeof parsed !== 'object') return null;
            if (!Array.isArray(parsed.tracks) || !parsed.tracks.length) return null;
            if (
                !Number(parsed.createdAt) ||
                Date.now() - Number(parsed.createdAt) > 6 * 60 * 60 * 1000
            ) {
                return null;
            }
            return parsed;
        } catch {
            return null;
        }
    }

    async function installRecordingGuards() {
        const pending = readPendingImport();
        if (!pending) return;

        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
            const release = PAGE_WINDOW.MB?.releaseEditor?.rootField?.release?.();
            const tracks = release && typeof release.allTracks === 'function'
                ? [...release.allTracks()]
                : [];

            if (tracks.length === pending.tracks.length) {
                const compatible = tracks.every((track, index) => {
                    const expected = pending.tracks[index];
                    const title = typeof track?.name === 'function' ? track.name() : '';
                    return !expected?.title || !title || normalize(expected.title) === normalize(title);
                });

                if (compatible) {
                    const guarded = [];
                    let ready = true;

                    for (let i = 0; i < tracks.length; i++) {
                        const expected = pending.tracks[i];
                        const track = tracks[i];
                        if (!expected?.isrc || !expected?.recordingId) continue;
                        if (typeof track?.recording !== 'function') {
                            ready = false;
                            break;
                        }

                        const current = track.recording();
                        const gid = currentRecordingId(track);
                        if (
                            gid !== String(expected.recordingId).toLowerCase() ||
                            !current?.gid
                        ) {
                            ready = false;
                            break;
                        }

                        guarded.push([track, current]);
                    }

                    if (ready) {
                        for (const [track, recording] of guarded) {
                            keepExactIsrcAssociationAcrossTracklistEdits(track, recording);
                        }
                        return;
                    }
                }
            }

            await sleep(250);
        }
    }

    function updateUnlinkedHighlights() {
        for (const row of document.querySelectorAll('#recordings tr.track')) {
            const cells = row.querySelectorAll('td.name');
            const recordingCell = cells[1];
            const text = normalize(recordingCell?.textContent);
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
        }
    }

    const style = document.createElement('style');
    style.textContent = `
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
    `;
    document.head.appendChild(style);

    let timer = null;
    const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(updateUnlinkedHighlights, 40);
    });
    observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['href'],
    });

    updateUnlinkedHighlights();
    void installRecordingGuards();
})();

// BPTopTracker release-page importer
(() => {
    'use strict';

    if (!/^(?:www\.)?bptoptracker\.com$/i.test(location.hostname)) return;
    if (window.__beatportMbRedirecting) return;
    if (!/^\/release\//i.test(location.pathname)) return;

    const MUSICBRAINZ_ADD_RELEASE_URL = 'https://musicbrainz.org/release/add';
    const MUSICBRAINZ_SEARCH_URL = 'https://musicbrainz.org/search';
    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/beatport-musicbrainz-importer/Beatport_MusicBrainz_Importer.user.js';
    const PURCHASE_FOR_DOWNLOAD_LINK_TYPE = '74';

    const normalizeWhitespace = (value) =>
        String(value ?? '').replace(/\s+/g, ' ').trim();

    const absoluteUrl = (value) => {
        try {
            return new URL(value, location.href).href;
        } catch {
            return '';
        }
    };

    function unique(values) {
        return [...new Set(values.filter(Boolean))];
    }

    function defaultJoinPhrase(index, count) {
        if (index >= count - 1) return '';
        return index === count - 2 ? ' & ' : ', ';
    }

    function makeArtistCredit(names) {
        const cleaned = unique(names.map(normalizeWhitespace));
        return cleaned.map((name, index) => ({
            name,
            joinPhrase: defaultJoinPhrase(index, cleaned.length),
        }));
    }

    function artistNamesFrom(container) {
        if (!container) return [];
        return unique(
            [...container.querySelectorAll('a[href*="/artist/"]')]
                .map((link) => normalizeWhitespace(link.textContent))
                .filter(Boolean)
        );
    }

    function normalizeTrackTitle(rawTitle) {
        let title = normalizeWhitespace(rawTitle);

        // MusicBrainz title style keeps extra title information (ETI), while
        // descriptive words such as mix/remix/edit/version are lowercased.
        // Examples:
        //   Ghost Dance (Original Mix) -> Ghost Dance (original mix)
        //   Song (John Doe Remix)      -> Song (John Doe remix)
        title = title.replace(
            /\(([^()]*)\b(Mix|Remix|Edit|Version|Rework|Dub)\)$/i,
            (_, prefix, descriptor) =>
                `(${prefix}${descriptor.toLowerCase()})`
        );

        return normalizeWhitespace(title);
    }

    function findReleaseSection() {
        const beatportLink = document.querySelector(
            'a[href*="beatport.com/release/"]'
        );
        const heading = document.querySelector('h1');

        return (
            beatportLink?.closest('section') ||
            heading?.closest('section') ||
            heading?.closest('.container') ||
            document
        );
    }

    function findIconValue(section, iconClass) {
        const icon = section?.querySelector(`i.${iconClass}`);
        if (!icon) return '';

        const holder = icon.closest('div') || icon.parentElement;
        if (!holder) return '';

        const clone = holder.cloneNode(true);
        clone.querySelectorAll('i').forEach((node) => node.remove());
        return normalizeWhitespace(clone.textContent);
    }

    function parseReleaseDate(section) {
        const calendarIcon = section?.querySelector(
            'i.fa-calendar-check-o, i.fa-calendar'
        );
        const localText =
            calendarIcon?.parentElement?.textContent || section?.textContent || '';

        const match = localText.match(
            /\b(\d{4})-(\d{2})-(\d{2})\b/
        );

        if (!match) return null;

        return {
            year: match[1],
            month: match[2],
            day: match[3],
            text: `${match[1]}-${match[2]}-${match[3]}`,
        };
    }

    function parseTracks() {
        const table =
            document.querySelector('table.table-tracks') ||
            [...document.querySelectorAll('table')].find((candidate) => {
                const headers = [...candidate.querySelectorAll('th')].map((th) =>
                    normalizeWhitespace(th.textContent).toLowerCase()
                );
                return headers.includes('title') && headers.includes('length');
            });

        if (!table) return [];

        const headers = [...table.querySelectorAll('thead th, tr:first-child th')]
            .map((th) => normalizeWhitespace(th.textContent).toLowerCase());

        const indexOf = (name) => headers.indexOf(name.toLowerCase());

        const titleIndex = indexOf('title');
        const artistsIndex = indexOf('artists');
        const lengthIndex = indexOf('length');

        const rows = [...table.querySelectorAll('tbody tr')];
        const usableRows = rows.length
            ? rows
            : [...table.querySelectorAll('tr')].filter(
                  (row) => row.querySelectorAll('td').length > 0
              );

        return usableRows
            .map((row, rowIndex) => {
                const cells = [...row.querySelectorAll('td')];
                if (!cells.length) return null;

                const position =
                    normalizeWhitespace(
                        row.querySelector('td.position')?.textContent
                    ) || String(rowIndex + 1);

                const titleCell =
                    row.querySelector('td.title') ||
                    (titleIndex >= 0 ? cells[titleIndex] : null);

                const artistsCell =
                    row.querySelector('td.artists') ||
                    (artistsIndex >= 0 ? cells[artistsIndex] : null);

                const lengthCell =
                    lengthIndex >= 0 ? cells[lengthIndex] : null;

                const rawTitle = normalizeWhitespace(
                    titleCell?.querySelector('a')?.textContent ||
                        titleCell?.textContent
                );

                const artists = artistNamesFrom(artistsCell);
                const duration = normalizeWhitespace(lengthCell?.textContent);

                if (!rawTitle) return null;

                return {
                    number: position,
                    title: normalizeTrackTitle(rawTitle),
                    artists,
                    duration: /^\d{1,3}:\d{2}(?::\d{2})?$/.test(duration)
                        ? duration
                        : '',
                };
            })
            .filter(Boolean);
    }

    function releaseHeadingText(section) {
        const heading =
            section?.querySelector('h1') ||
            document.querySelector('h1');

        if (!heading) return '';

        const clone = heading.cloneNode(true);
        clone.querySelectorAll(
            [
                '.mb-toolbox-release-list-indicator',
                '#beatport-mb-release-indicator',
                '[data-mbtb-target]',
            ].join(',')
        ).forEach(node => node.remove());

        return normalizeWhitespace(clone.textContent);
    }

    function parsePage() {
        const section = findReleaseSection();

        const title = releaseHeadingText(section);

        const releaseArtistContainer =
            section.querySelector('h1 + .g-font-size-18') ||
            section.querySelector('.g-font-size-18');

        const releaseArtists = artistNamesFrom(releaseArtistContainer);

        const labelLink = section.querySelector('a[href*="/label/"]');
        const label = normalizeWhitespace(labelLink?.textContent);

        const date = parseReleaseDate(section);

        const catalogNumber =
            findIconValue(section, 'fa-file-o') ||
            findIconValue(section, 'fa-file');

        const beatportLink = section.querySelector(
            'a[href*="beatport.com/release/"]'
        );
        const beatportUrl = absoluteUrl(beatportLink?.getAttribute('href'));

        const tracks = parseTracks();

        return {
            title,
            releaseArtists,
            label,
            date,
            catalogNumber,
            beatportUrl,
            sourceUrl: location.href.split('#')[0],
            tracks,
        };
    }

    function addArtistCredit(params, prefix, credit) {
        credit.forEach((entry, index) => {
            params.set(`${prefix}.names.${index}.name`, entry.name);
            params.set(`${prefix}.names.${index}.artist.name`, entry.name);

            if (entry.joinPhrase) {
                params.set(
                    `${prefix}.names.${index}.join_phrase`,
                    entry.joinPhrase
                );
            }
        });
    }

    function buildSeedParameters(release) {
        const params = new URLSearchParams();

        params.set('name', release.title);
        params.set('status', 'official');
        params.set('packaging', 'None');

        if (release.date) {
            params.set('events.0.date.year', release.date.year);
            params.set('events.0.date.month', release.date.month);
            params.set('events.0.date.day', release.date.day);

            // Deliberately do not seed events.0.country:
            // BPTopTracker does not establish a MusicBrainz release country.
        }

        if (release.label) {
            params.set('labels.0.name', release.label);

            if (release.catalogNumber) {
                params.set('labels.0.catalog_number', release.catalogNumber);
            }
        }

        if (release.releaseArtists.length) {
            addArtistCredit(
                params,
                'artist_credit',
                makeArtistCredit(release.releaseArtists)
            );
        }

        params.set('mediums.0.format', 'Digital Media');

        release.tracks.forEach((track, index) => {
            const prefix = `mediums.0.track.${index}`;

            params.set(`${prefix}.name`, track.title);
            params.set(`${prefix}.number`, track.number);

            if (track.duration) {
                params.set(`${prefix}.length`, track.duration);
            }

            if (track.artists.length) {
                addArtistCredit(
                    params,
                    `${prefix}.artist_credit`,
                    makeArtistCredit(track.artists)
                );
            }
        });

        if (release.beatportUrl) {
            params.set('urls.0.url', release.beatportUrl);
            params.set(
                'urls.0.link_type',
                PURCHASE_FOR_DOWNLOAD_LINK_TYPE
            );
        }

        const note = [
            `Imported from BPTopTracker: ${release.sourceUrl}`,
            release.beatportUrl
                ? `Original Beatport release: ${release.beatportUrl}`
                : '',
            `Script: ${SCRIPT_URL}`,
        ]
            .filter(Boolean)
            .join('\n');

        params.set('edit_note', note);

        // Deliberately not seeded unless BPTopTracker explicitly provides them:
        // - barcode / UPC
        // - release country
        // - language
        // - script
        // - release-group type
        //
        // ISRCs are recording-level identifiers and are not fields supported by
        // MusicBrainz Release Editor seeding.

        return params;
    }

    function submitToMusicBrainz(release) {
        if (!release.title) {
            alert('MusicBrainz import: release title was not found.');
            return;
        }

        if (!release.tracks.length) {
            alert('MusicBrainz import: no tracks were found.');
            return;
        }

        const params = buildSeedParameters(release);
        const form = document.createElement('form');

        form.method = 'POST';
        form.action = MUSICBRAINZ_ADD_RELEASE_URL;
        form.enctype = 'multipart/form-data';
        form.target = '_blank';
        form.style.display = 'none';

        for (const [name, value] of params.entries()) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = value;
            form.appendChild(input);
        }

        document.body.appendChild(form);
        form.submit();
        form.remove();
    }

    function searchMusicBrainz(release) {
        const terms = [
            release.title ? `"${release.title}"` : '',
            release.releaseArtists[0] || '',
            release.catalogNumber || '',
        ]
            .filter(Boolean)
            .join(' ');

        const url = new URL(MUSICBRAINZ_SEARCH_URL);
        url.searchParams.set('query', terms);
        url.searchParams.set('type', 'release');
        url.searchParams.set('method', 'indexed');

        window.open(url.href, '_blank', 'noopener');
    }

    function addImporterUI(release) {
        if (document.getElementById('bpt-mb-importer')) return;

        const beatportButton = document.querySelector(
            'a[href*="beatport.com/release/"]'
        );

        const host =
            beatportButton?.parentElement ||
            findReleaseSection().querySelector('.col-lg-4') ||
            findReleaseSection();

        const wrapper = document.createElement('div');
        wrapper.id = 'bpt-mb-importer';
        wrapper.className = 'g-mt-5';

        const importButton = document.createElement('button');
        importButton.type = 'button';
        importButton.className = 'btn u-btn-primary g-ma-2';
        importButton.textContent = 'Import to MusicBrainz';
        importButton.title =
            'Open the MusicBrainz Add Release editor with BPTopTracker data pre-filled';

        const searchButton = document.createElement('button');
        searchButton.type = 'button';
        searchButton.className = 'btn u-btn-outline-primary g-ma-2';
        searchButton.textContent = 'Search MusicBrainz';
        searchButton.title =
            'Search MusicBrainz before adding the release';

        const status = document.createElement('small');
        status.className = 'g-color-gray-dark-v4 g-ml-5';
        status.textContent = release.tracks.length
            ? `${release.tracks.length} track${release.tracks.length === 1 ? '' : 's'} ready`
            : 'No tracks found';

        if (!release.title || !release.tracks.length) {
            importButton.disabled = true;
            importButton.title =
                'Cannot import because required release/track data was not found';
        }

        importButton.addEventListener('click', () =>
            submitToMusicBrainz(parsePage())
        );
        searchButton.addEventListener('click', () =>
            searchMusicBrainz(parsePage())
        );

        wrapper.append(importButton, searchButton, status);
        host.appendChild(wrapper);
    }

    try {
        const release = parsePage();

        console.info('[BPTopTracker -> MusicBrainz]', release);
        addImporterUI(release);
    } catch (error) {
        console.error('[BPTopTracker -> MusicBrainz] Importer failed:', error);
    }
})();
