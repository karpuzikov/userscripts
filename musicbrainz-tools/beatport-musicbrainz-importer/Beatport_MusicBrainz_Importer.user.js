// ==UserScript==
// @name         Beatport - MusicBrainz Importer
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Import Beatport releases into MusicBrainz with release metadata, track credits, lengths, and a follow-up ISRC import.
// @author       karpuzikov
// @match        https://www.beatport.com/*
// @match        https://musicbrainz.org/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/beatport-musicbrainz-importer/Beatport_MusicBrainz_Importer.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/beatport-musicbrainz-importer/Beatport_MusicBrainz_Importer.user.js
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const MB_ADD_RELEASE = 'https://musicbrainz.org/release/add';
    const MAGIC_ISRC = 'https://magicisrc.kepstin.ca/';
    const PURCHASE_FOR_DOWNLOAD = '74';
    const VARIOUS_ARTISTS_MBID = '89ad4ac3-39f7-470e-963a-56509c546377';
    const STORAGE_PREFIX = 'beatport-mb-import:';
    const UI_ID = 'beatport-musicbrainz-importer';
    const GITHUB_SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/beatport-musicbrainz-importer/Beatport_MusicBrainz_Importer.user.js';

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
        return pageProps?.dehydratedState?.queries?.find((query) => {
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

    function artistKey(artist) {
        return artist?.id != null ? `id:${artist.id}` : `name:${String(artist?.name || '').trim().toLocaleLowerCase()}`;
    }

    function makeCredits(artists) {
        return (artists || []).filter((a) => a?.name).map((artist, index, list) => ({
            artist_name: artist.name,
            credited_name: artist.name,
            mbid: artist.mbid || null,
            join_phrase: index < list.length - 1 ? ', ' : '',
        }));
    }

    function determineReleaseArtists(release, tracks) {
        const releaseArtists = (release?.artists || []).filter((a) => a?.name);
        const trackSets = tracks
            .filter((track) => Array.isArray(track?.artists) && track.artists.length)
            .map((track) => new Set(track.artists.map(artistKey)));

        if (trackSets.length) {
            const common = releaseArtists.filter((artist) => trackSets.every((set) => set.has(artistKey(artist))));
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
        const title = String(track?.name || '').trim();
        const mix = String(track?.mix_name || '').trim();
        if (!mix || /^original mix$/i.test(mix)) return title;
        const suffix = `(${mix})`;
        if (title.toLocaleLowerCase().endsWith(suffix.toLocaleLowerCase())) return title;
        return `${title} ${suffix}`;
    }

    function mapReleaseType(typeName) {
        const type = String(typeName || '').trim().toLocaleLowerCase();
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

    function buildImport(release, tracks) {
        const sourceUrl = cleanBeatportUrl();
        const params = [];
        const title = String(release.name || '').trim();
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

        const worldwide = tracks.length > 0 && tracks.every((track) => track.available_worldwide === true);
        if (worldwide) params.push(['events.0.country', 'XW']);

        if (release?.upc) params.push(['barcode', String(release.upc)]);
        if (release?.label?.name) params.push(['labels.0.name', release.label.name]);
        if (release?.catalog_number) params.push(['labels.0.catalog_number', String(release.catalog_number)]);

        params.push(['urls.0.url', sourceUrl]);
        params.push(['urls.0.link_type', PURCHASE_FOR_DOWNLOAD]);
        params.push(['mediums.0.format', 'Digital Media']);

        tracks.forEach((track, index) => {
            const prefix = `mediums.0.track.${index}.`;
            params.push([`${prefix}number`, String(index + 1)]);
            params.push([`${prefix}name`, trackTitle(track)]);
            if (Number.isFinite(Number(track?.length_ms)) && Number(track.length_ms) > 0) {
                params.push([`${prefix}length`, String(Math.round(Number(track.length_ms)))]);
            }
            addArtistCreditParams(params, prefix, makeCredits(track?.artists || []));
        });

        params.push(['edit_note', `Imported from Beatport: ${sourceUrl}\nImporter: ${GITHUB_SCRIPT_URL}`]);

        const isrcs = tracks.map((track) => String(track?.isrc || '').trim().toUpperCase());
        const storageKey = `${STORAGE_PREFIX}${release.id}:${Date.now()}`;
        const redirect = new URL('https://musicbrainz.org/');
        redirect.searchParams.set('beatport_isrc_import', storageKey);
        params.push(['redirect_uri', redirect.toString()]);

        return {
            params,
            storageKey,
            pending: {
                beatportReleaseId: String(release.id),
                sourceUrl,
                title,
                isrcs,
                createdAt: Date.now(),
            },
            releaseCredits,
        };
    }

    function submitMusicBrainzImport(importData) {
        GM_setValue(importData.storageKey, importData.pending);

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

    function openMagicIsrcForCurrentRelease() {
        const url = new URL(location.href);
        const storageKey = url.searchParams.get('beatport_isrc_import');
        const releaseMbid = url.searchParams.get('release_mbid');
        if (!storageKey || !releaseMbid) return false;

        const pending = GM_getValue(storageKey, null);
        if (!pending?.isrcs?.length) return false;

        const target = new URL(MAGIC_ISRC);
        target.searchParams.set('mbid', releaseMbid);
        pending.isrcs.forEach((isrc, index) => {
            if (isrc) target.searchParams.set(`isrc1-${index + 1}`, isrc);
        });
        target.searchParams.set('edit-note', `ISRCs imported from Beatport: ${pending.sourceUrl}\nImporter: ${GITHUB_SCRIPT_URL}`);
        GM_deleteValue(storageKey);
        location.replace(target.toString());
        return true;
    }

    function openMusicBrainzSearch(importData, tracks) {
        const title = importData.pending.title || '';
        const artist = importData.releaseCredits.map((credit) => credit.artist_name).join(', ');
        const query = `artist:(${artist}) release:(${title}) tracks:(${tracks.length})`;
        const url = new URL('https://musicbrainz.org/search');
        url.searchParams.set('query', query);
        url.searchParams.set('type', 'release');
        url.searchParams.set('advanced', '1');
        window.open(url.toString(), '_blank', 'noopener');
    }

    function openHarmony(importData) {
        const url = new URL('https://harmony.pulsewidth.org.uk/release');
        url.searchParams.set('url', importData.pending.sourceUrl);
        window.open(url.toString(), '_blank', 'noopener');
    }

    function openMagicIsrcWithoutMbid(importData) {
        const target = new URL(MAGIC_ISRC);
        importData.pending.isrcs.forEach((isrc, index) => {
            if (isrc) target.searchParams.set(`isrc1-${index + 1}`, isrc);
        });
        target.searchParams.set('edit-note', `ISRCs imported from Beatport: ${importData.pending.sourceUrl}\nImporter: ${GITHUB_SCRIPT_URL}`);
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

    function installUi(release, tracks) {
        document.getElementById(UI_ID)?.remove();

        const importData = buildImport(release, tracks);
        const isrcCount = importData.pending.isrcs.filter(Boolean).length;
        const mainArtists = importData.releaseCredits.map((credit) => credit.credited_name || credit.artist_name).join(', ');

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

        const importButton = makeButton('Import to MusicBrainz', true);
        importButton.title = 'Open the MusicBrainz release editor with Beatport metadata prefilled';
        importButton.addEventListener('click', () => submitMusicBrainzImport(importData));

        const searchButton = makeButton('Search in MusicBrainz');
        searchButton.title = 'Search MusicBrainz for an existing release';
        searchButton.addEventListener('click', () => openMusicBrainzSearch(importData, tracks));

        const harmonyButton = makeButton('Open in Harmony');
        harmonyButton.title = 'Open this Beatport release in Harmony';
        harmonyButton.addEventListener('click', () => openHarmony(importData));

        const isrcButton = makeButton(`Submit ISRCs (${isrcCount})`);
        isrcButton.title = 'Open MagicISRC with the Beatport ISRCs prefilled';
        isrcButton.disabled = isrcCount === 0;
        isrcButton.addEventListener('click', () => openMagicIsrcWithoutMbid(importData));

        const info = document.createElement('span');
        const barcode = String(release?.upc || 'none');
        info.textContent = `Barcode: ${barcode} | ${tracks.length} tracks | ${isrcCount} ISRCs | Release artist: ${mainArtists}`;
        info.style.opacity = '0.8';

        box.append(importButton, searchButton, harmonyButton, isrcButton, info);

        const controls = document.querySelector('div[class^="ReleaseDetailCard-style__Controls"]');
        const infoArea = document.querySelector('div[class^="ReleaseDetailCard-style__Info"]')?.parentElement;
        const anchor = controls || infoArea;
        if (anchor?.parentElement) {
            anchor.insertAdjacentElement('afterend', box);
        } else {
            Object.assign(box.style, {
                position: 'fixed',
                right: '20px',
                bottom: '20px',
                marginTop: '0',
                boxShadow: '0 6px 30px rgba(0,0,0,.45)',
            });
            document.body.appendChild(box);
        }
    }

    async function processBeatportRelease() {
        if (!releasePathParts()) {
            document.getElementById(UI_ID)?.remove();
            return;
        }

        try {
            const pageProps = await getCurrentPageProps();
            const release = pageProps?.release;
            const trackResults = findTracksQuery(pageProps)?.state?.data?.results || [];
            if (!release || !trackResults.length) throw new Error('Beatport release metadata or tracks were not found');

            const tracks = orderTracks(release, trackResults).filter((track) => String(track?.release?.id || release.id) === String(release.id));
            if (!tracks.length) throw new Error('No tracks belonging to this release were found');
            installUi(release, tracks);
        } catch (error) {
            console.error('[Beatport MB Importer]', error);
        }
    }

    if (location.hostname === 'musicbrainz.org') {
        openMagicIsrcForCurrentRelease();
        return;
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
