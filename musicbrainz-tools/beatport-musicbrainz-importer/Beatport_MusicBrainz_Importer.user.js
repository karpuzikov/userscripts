// ==UserScript==
// @name         Beatport - MusicBrainz Importer
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.1.4
// @description  Import Beatport releases into MusicBrainz with reverse-linked artists/labels, ISRC recording matching, and barcode-based release sources.
// @author       karpuzikov
// @match        https://www.beatport.com/*
// @connect      musicbrainz.org
// @connect      music.apple.com
// @connect      amp-api.music.apple.com
// @grant        GM_xmlhttpRequest
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/beatport-musicbrainz-importer/Beatport_MusicBrainz_Importer.user.js?v=1.1.4
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/beatport-musicbrainz-importer/Beatport_MusicBrainz_Importer.user.js?v=1.1.4
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const MB_ADD_RELEASE = 'https://musicbrainz.org/release/add';
    const MB_WS = 'https://musicbrainz.org/ws/2';
    const MAGIC_ISRC = 'https://magicisrc.kepstin.ca/';
    const APPLE_API_BASE = 'https://amp-api.music.apple.com/v1';
    const PURCHASE_FOR_DOWNLOAD = 74;
    const PAID_STREAMING = 980;
    const VARIOUS_ARTISTS_MBID = '89ad4ac3-39f7-470e-963a-56509c546377';
    const UI_ID = 'beatport-musicbrainz-importer';
    const MAX_DIFFERENCE_MS = 7000;
    const MB_REQUEST_GAP_MS = 1100;
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

    function findTracksQuery(pageProps) {
        return pageProps?.dehydratedState?.queries?.find(query => {
            const key = query?.queryKey;
            if (Array.isArray(key)) return key[0] === 'tracks' || String(key[0]).includes('tracks');
            return String(key || '').includes('tracks');
        }) || null;
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

        const expected = Number(pageProps.release.track_count || 0);
        const query = findTracksQuery(pageProps);
        const currentResults = query?.state?.data?.results || [];

        if (expected > currentResults.length && expected > 100) {
            const pages = Math.ceil(expected / 100);
            const all = [];
            const seen = new Set();

            for (let page = 1; page <= pages; page++) {
                const props = page === 1 ? pageProps : await fetchPageProps(next.buildId, parts, page);
                const results = findTracksQuery(props)?.state?.data?.results || [];
                for (const track of results) {
                    const key = track?.id ?? track?.url;
                    if (key == null || seen.has(key)) continue;
                    seen.add(key);
                    all.push(track);
                }
            }

            if (all.length) {
                const replacement = findTracksQuery(pageProps);
                if (replacement?.state?.data) replacement.state.data.results = all;
            }
        }

        return pageProps;
    }

    function orderTracks(release, trackResults) {
        const byUrl = new Map();
        const byId = new Map();
        for (const track of trackResults || []) {
            if (track?.url) byUrl.set(track.url, track);
            if (track?.id != null) byId.set(String(track.id), track);
        }

        const ordered = [];
        const seen = new Set();
        const refs = Array.isArray(release?.tracks) ? [...release.tracks].reverse() : [];

        for (const ref of refs) {
            const url = typeof ref === 'string' ? ref : ref?.url;
            const id = typeof ref === 'object' && ref?.id != null
                ? String(ref.id)
                : typeof url === 'string'
                    ? url.match(/\/tracks\/(\d+)\/?$/)?.[1]
                    : null;
            const track = (url && byUrl.get(url)) || (id && byId.get(id));
            if (!track || seen.has(track.id)) continue;
            seen.add(track.id);
            ordered.push(track);
        }

        if (ordered.length === trackResults.length) return ordered;

        for (const track of [...trackResults].reverse()) {
            if (!track || seen.has(track.id)) continue;
            seen.add(track.id);
            ordered.push(track);
        }
        return ordered;
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

    function candidateCredit(candidate) {
        const parts = candidate?.['artist-credit'];
        if (!Array.isArray(parts)) return { ids: [], text: '' };
        return {
            ids: parts.map(part => part?.artist?.id).filter(Boolean),
            text: parts.map(part => (part?.name ?? part?.artist?.name ?? '') + (part?.joinphrase ?? '')).join(''),
        };
    }

    function chooseByIsrc(track, candidates) {
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
            }, candidatesByIsrc.get(isrc) || []);

            if (decision.id) {
                track._mbRecordingId = decision.id;
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
                const album = albums.find(item => equalGtin(item.attributes?.upc, barcode)) || albums[0];
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
            },
            releaseCredits,
        };
    }

    function submitMusicBrainzImport(importData) {
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

    function makeButton(text, primary = false) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = text;
        Object.assign(button.style, {
            border: primary ? '1px solid #01ff95' : '1px solid #666',
            borderRadius: '4px',
            background: primary ? '#01ff95' : '#242424',
            color: primary ? '#111' : '#fff',
            padding: '8px 12px',
            fontWeight: '700',
            cursor: 'pointer',
            fontSize: '13px',
        });
        return button;
    }

    function findUiAnchor() {
        const controls = document.querySelector('div[class^="ReleaseDetailCard-style__Controls"]');
        const infoArea = document.querySelector('div[class^="ReleaseDetailCard-style__Info"]')?.parentElement;
        return controls || infoArea || null;
    }

    function displayBarcodeBelowCatalogNumber(release) {
        document.getElementById('beatport-mb-barcode-row')?.remove();

        const barcode = normalizeSpace(release?.upc);
        const catalog = normalizeSpace(release?.catalog_number);
        if (!barcode || !catalog) return;

        const scope =
            document.querySelector('div[class^="ReleaseDetailCard-style__Info"]') ||
            document.querySelector('main') ||
            document.body;

        const candidates = [...scope.querySelectorAll('div, p, li, dt, dd, span')];
        let catalogElement = candidates.find(element => {
            const text = normalizeSpace(element.textContent);
            return text === catalog;
        });

        if (!catalogElement) {
            catalogElement = candidates.find(element => {
                const text = normalizeSpace(element.textContent);
                return text.includes(catalog) &&
                    text.toLocaleLowerCase().includes('catalog') &&
                    text.length < 180;
            });
        }

        if (!catalogElement) return;

        let row = catalogElement;
        for (let i = 0; i < 4 && row.parentElement && row.parentElement !== scope; i++) {
            const parentText = normalizeSpace(row.parentElement.textContent);
            if (
                parentText.includes(catalog) &&
                parentText.toLocaleLowerCase().includes('catalog') &&
                parentText.length < 220
            ) {
                row = row.parentElement;
            } else {
                break;
            }
        }

        const barcodeRow = document.createElement('div');
        barcodeRow.id = 'beatport-mb-barcode-row';
        barcodeRow.textContent = `Barcode: ${barcode}`;
        barcodeRow.style.marginTop = '4px';
        barcodeRow.style.fontSize = 'inherit';
        barcodeRow.style.lineHeight = 'inherit';

        row.insertAdjacentElement('afterend', barcodeRow);
    }

    function makeUiBox() {
        document.getElementById(UI_ID)?.remove();
        const box = document.createElement('div');
        box.id = UI_ID;
        Object.assign(box.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            marginTop: '12px',
            padding: '10px',
            background: '#1d1d1d',
            border: '1px solid #343434',
            borderRadius: '6px',
            color: '#fff',
            fontSize: '13px',
            zIndex: '50',
        });

        const anchor = findUiAnchor();
        if (anchor?.parentElement) {
            anchor.insertAdjacentElement('afterend', box);
        } else {
            Object.assign(box.style, {
                position: 'fixed',
                right: '20px',
                bottom: '20px',
                marginTop: '0',
                maxWidth: 'min(760px, calc(100vw - 40px))',
                boxShadow: '0 6px 30px rgba(0,0,0,.45)',
            });
            document.body.appendChild(box);
        }
        return box;
    }

    function installIdleUi(release, tracks, serial) {
        const box = makeUiBox();
        const allIsrcs = tracks.map(track => normalizeIsrc(track?.isrc)).filter(Boolean);
        const baseImportData = buildImport(release, tracks, []);
        const mainArtists = baseImportData.releaseCredits
            .map(credit => credit.credited_name || credit.artist_name)
            .join(', ');

        const importButton = makeButton('Import to MusicBrainz', true);
        importButton.title = 'Start MusicBrainz lookups, then open the release editor with the enriched Beatport metadata';

        const searchButton = makeButton('Search in MusicBrainz');
        searchButton.title = 'Search MusicBrainz for an existing release without running importer lookups';
        searchButton.addEventListener('click', () => openMusicBrainzSearch(baseImportData, tracks));

        const isrcButton = makeButton(`Submit ISRCs (${allIsrcs.length})`);
        isrcButton.title = 'Open MagicISRC with this Beatport release\'s ISRCs prefilled';
        isrcButton.disabled = allIsrcs.length === 0;
        isrcButton.addEventListener('click', () => openAllIsrcs(release, tracks));

        const status = document.createElement('span');
        status.style.fontWeight = '700';
        status.textContent = 'Ready - no MusicBrainz lookups have been run.';

        const info = document.createElement('span');
        info.style.opacity = '0.82';
        info.textContent = [
            `Barcode: ${release?.upc || 'none'}`,
            `${tracks.length} tracks`,
            `${allIsrcs.length} ISRCs`,
            `release artist: ${mainArtists}`,
        ].join(' | ');

        importButton.addEventListener('click', async () => {
            if (serial !== processSerial) return;

            importButton.disabled = true;
            searchButton.disabled = true;
            isrcButton.disabled = true;

            const setStatus = text => {
                if (status.isConnected) status.textContent = text;
            };

            try {
                setStatus('Resolving Beatport artist/label links in MusicBrainz...');
                const reverse = await reverseResolveBeatportLinks(release, tracks, setStatus);
                if (serial !== processSerial) return;

                const recordings = await resolveRecordingsByIsrc(tracks, setStatus);
                if (serial !== processSerial) return;

                const sources = await findReleaseSources(release, reverse, setStatus);
                if (serial !== processSerial) return;

                const importData = buildImport(release, tracks, sources);
                setStatus([
                    `Ready: artists linked ${reverse.linkedArtists}/${reverse.artistCount}`,
                    `recordings linked ${recordings.matched}/${allIsrcs.length}`,
                    `extra sources ${sources.length}`,
                    release?.label?.mbid ? 'label linked' : 'label unresolved',
                    'opening MusicBrainz...',
                ].join(' | '));

                submitMusicBrainzImport(importData);
            } catch (error) {
                console.error('[Beatport MB Importer]', error);
                setStatus(`Importer error: ${error.message}`);
                status.style.color = '#ff8080';
                importButton.disabled = false;
                searchButton.disabled = false;
                isrcButton.disabled = allIsrcs.length === 0;
            }
        });

        box.append(importButton, searchButton, isrcButton, status, info);
    }

    async function processBeatportRelease() {
        const serial = ++processSerial;

        if (!releasePathParts()) {
            document.getElementById(UI_ID)?.remove();
            return;
        }

        try {
            const pageProps = await getCurrentPageProps();
            if (serial !== processSerial) return;

            const release = pageProps?.release;
            const trackResults = findTracksQuery(pageProps)?.state?.data?.results || [];
            if (!release || !trackResults.length) {
                throw new Error('Beatport release metadata or tracks were not found');
            }

            const tracks = orderTracks(release, trackResults)
                .filter(track => String(track?.release?.id || release.id) === String(release.id));
            if (!tracks.length) throw new Error('No tracks belonging to this release were found');

            displayBarcodeBelowCatalogNumber(release);
            installIdleUi(release, tracks, serial);
        } catch (error) {
            console.error('[Beatport MB Importer]', error);
            if (serial !== processSerial) return;
            const box = makeUiBox();
            const status = document.createElement('span');
            status.textContent = `Importer error: ${error.message}`;
            status.style.color = '#ff8080';
            box.appendChild(status);
        }
    }

    let lastUrl = '';
    const refresh = () => {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        void processBeatportRelease();
    };

    refresh();
    setInterval(refresh, 750);
})();
