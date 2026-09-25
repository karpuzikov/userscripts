// ==UserScript==
// @name         RuTracker Digital Release Linker
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Replaces generic digital-store source links in RuTracker BBCode with exact release pages. Deezer is supported first; more providers can be added later.
// @author       karpuzikov
// @match        https://rutracker.org/forum/posting.php*
// @grant        GM_xmlhttpRequest
// @connect      api.deezer.com
// @connect      musicbrainz.org
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_NAME = 'RuTracker Digital Release Linker';
    const CONCURRENCY = 4;
    const MB_MIN_INTERVAL_MS = 1100;

    const caches = {
        deezerBarcode: new Map(),
        deezerAlbum: new Map(),
        deezerArtist: new Map(),
        deezerSearch: new Map(),
        musicBrainzCatalog: new Map(),
    };

    let mbQueue = Promise.resolve();
    let lastMbRequestAt = 0;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function gmJson(url, options = {}) {
        const retries = options.retries ?? 2;
        const headers = options.headers ?? {};

        return new Promise((resolve, reject) => {
            const attempt = (number) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: {
                        Accept: 'application/json',
                        ...headers,
                    },
                    responseType: 'json',
                    timeout: 20000,
                    onload(response) {
                        const status = response.status || 0;
                        if ((status === 429 || status >= 500) && number < retries) {
                            setTimeout(() => attempt(number + 1), 1000 * (number + 1));
                            return;
                        }

                        if (status < 200 || status >= 300) {
                            reject(new Error(`HTTP ${status} for ${url}`));
                            return;
                        }

                        try {
                            const data = response.response ?? JSON.parse(response.responseText);
                            resolve(data);
                        } catch (error) {
                            reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
                        }
                    },
                    ontimeout() {
                        if (number < retries) {
                            setTimeout(() => attempt(number + 1), 1000 * (number + 1));
                        } else {
                            reject(new Error(`Timeout for ${url}`));
                        }
                    },
                    onerror() {
                        if (number < retries) {
                            setTimeout(() => attempt(number + 1), 1000 * (number + 1));
                        } else {
                            reject(new Error(`Network error for ${url}`));
                        }
                    },
                });
            };

            attempt(0);
        });
    }

    function mbJson(url) {
        const task = mbQueue.then(async () => {
            const elapsed = Date.now() - lastMbRequestAt;
            if (elapsed < MB_MIN_INTERVAL_MS) {
                await sleep(MB_MIN_INTERVAL_MS - elapsed);
            }

            lastMbRequestAt = Date.now();
            return gmJson(url, {
                retries: 2,
                headers: {
                    'User-Agent': `${SCRIPT_NAME}/1.0.0 (Tampermonkey userscript)`,
                },
            });
        });

        mbQueue = task.catch(() => undefined);
        return task;
    }

    function normalizeBarcode(value) {
        const digits = String(value ?? '').replace(/\D/g, '');
        if (!digits) return '';
        const stripped = digits.replace(/^0+/, '');
        return stripped || '0';
    }

    function normalizeCatalog(value) {
        return String(value ?? '')
            .normalize('NFKC')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
    }

    function normalizeText(value) {
        return String(value ?? '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/\bft\.?\b/g, ' feat ')
            .replace(/\bfeaturing\b/g, ' feat ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    function tokenSimilarity(a, b) {
        const left = normalizeText(a);
        const right = normalizeText(b);
        if (!left || !right) return 0;
        if (left === right) return 1;
        if (left.includes(right) || right.includes(left)) return 0.9;

        const aSet = new Set(left.split(' '));
        const bSet = new Set(right.split(' '));
        let intersection = 0;
        for (const token of aSet) {
            if (bSet.has(token)) intersection += 1;
        }
        const union = new Set([...aSet, ...bSet]).size;
        return union ? intersection / union : 0;
    }

    function cleanTrackTitle(value) {
        return String(value ?? '')
            .replace(/\s*[\[(](?:ft\.?|feat\.?)[\s\S]*?[\])]/gi, '')
            .replace(/\s*\[(?:radio edit|single version|instrumental|a cappella|acapella)\]\s*$/i, '')
            .trim();
    }

    function parseSpoilerMeta(spoilerTitle, blockText) {
        const dateMatch = spoilerTitle.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*/);
        const date = dateMatch ? dateMatch[1] : '';

        let title = spoilerTitle.replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, '').trim();
        title = title.replace(/\s*\[[^\[\]]+\]\s*$/, '').trim();
        title = title.replace(/\s*-\s*(?:single|ep|album)\s*$/i, '').trim();

        const identifier = extractIdentifier(spoilerTitle);
        const tracks = [];
        const trackRegex = /^\[b\]\d{1,3}\[\/b\]\s+(.+?)\s+\(\d{1,2}:\d{2}\)\s*$/gmi;
        let trackMatch;
        while ((trackMatch = trackRegex.exec(blockText))) {
            tracks.push(trackMatch[1].trim());
        }

        return {
            spoilerTitle,
            date,
            title,
            identifier,
            trackCount: tracks.length,
            firstTrack: tracks[0] || '',
        };
    }

    function extractIdentifier(spoilerTitle) {
        const match = spoilerTitle.match(/\[([^\[\]]+)\]\s*$/);
        if (!match) return null;

        let value = match[1].trim();
        if (/\s+-\s+/.test(value)) {
            value = value.split(/\s+-\s+/).pop().trim();
        }

        if (/^\d{8,14}$/.test(value)) {
            return { type: 'barcode', value };
        }

        if (/^(?=.*\d)[A-Za-z0-9][A-Za-z0-9._/+\-]{3,}$/.test(value)) {
            return { type: 'catalog', value };
        }

        return null;
    }

    function getTopicArtist(postText) {
        const heading = postText.match(/\[size=\d+\]\s*([^|\r\n\[]+?)\s*\|\s*(?:Дискография|Discography)\b/i);
        return heading ? heading[1].trim() : '';
    }

    function getDeezerArtistId(url) {
        if (!url) return '';
        const match = String(url).match(/deezer\.com\/(?:[^/]+\/)?artist\/(\d+)/i);
        return match ? match[1] : '';
    }

    function isDeezerAlbumUrl(url) {
        return /https?:\/\/(?:www\.)?deezer\.com\/(?:[^/]+\/)?album\/\d+(?:[/?#]|$)/i.test(String(url || ''));
    }

    async function deezerAlbumById(id) {
        const key = String(id);
        if (caches.deezerAlbum.has(key)) return caches.deezerAlbum.get(key);

        const promise = gmJson(`https://api.deezer.com/album/${encodeURIComponent(key)}`)
            .then((data) => (data && !data.error && data.id ? data : null))
            .catch(() => null);

        caches.deezerAlbum.set(key, promise);
        return promise;
    }

    async function deezerAlbumByBarcode(barcode) {
        const key = normalizeBarcode(barcode);
        if (!key) return null;
        if (caches.deezerBarcode.has(key)) return caches.deezerBarcode.get(key);

        const promise = gmJson(`https://api.deezer.com/album/upc:${encodeURIComponent(barcode)}`)
            .then((data) => {
                if (!data || data.error || !data.id) return null;

                const returned = normalizeBarcode(data.upc);
                if (!returned || returned !== key) {
                    console.warn(`[${SCRIPT_NAME}] Deezer UPC mismatch`, {
                        requested: barcode,
                        returned: data.upc,
                        albumId: data.id,
                    });
                    return null;
                }

                return data;
            })
            .catch(() => null);

        caches.deezerBarcode.set(key, promise);
        return promise;
    }

    async function deezerArtistById(id) {
        const key = String(id);
        if (caches.deezerArtist.has(key)) return caches.deezerArtist.get(key);

        const promise = gmJson(`https://api.deezer.com/artist/${encodeURIComponent(key)}`)
            .then((data) => (data && !data.error && data.id ? data : null))
            .catch(() => null);

        caches.deezerArtist.set(key, promise);
        return promise;
    }

    async function deezerSearchAlbums(title, artistName) {
        const key = `${normalizeText(artistName)}|${normalizeText(title)}`;
        if (caches.deezerSearch.has(key)) return caches.deezerSearch.get(key);

        const queryParts = [];
        if (artistName) queryParts.push(`artist:"${artistName.replace(/"/g, '')}"`);
        if (title) queryParts.push(`album:"${title.replace(/"/g, '')}"`);
        const query = queryParts.join(' ');
        if (!query) return [];

        const promise = gmJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(query)}&limit=25`)
            .then((data) => (Array.isArray(data?.data) ? data.data : []))
            .catch(() => []);

        caches.deezerSearch.set(key, promise);
        return promise;
    }

    function scoreDeezerAlbum(album, meta, artistName) {
        let score = 0;

        const titleScore = tokenSimilarity(meta.title, album.title);
        score += titleScore * 10;

        if (meta.date && album.release_date) {
            if (album.release_date === meta.date) score += 5;
            else if (album.release_date.slice(0, 4) === meta.date.slice(0, 4)) score += 1.5;
        }

        if (artistName && album.artist?.name) {
            const artistScore = tokenSimilarity(artistName, album.artist.name);
            score += artistScore * 4;
        }

        if (meta.trackCount && album.nb_tracks) {
            if (meta.trackCount === album.nb_tracks) score += 2.5;
            else if (Math.abs(meta.trackCount - album.nb_tracks) === 1) score += 0.5;
        }

        if (meta.firstTrack && Array.isArray(album.tracks?.data) && album.tracks.data[0]?.title) {
            score += tokenSimilarity(cleanTrackTitle(meta.firstTrack), cleanTrackTitle(album.tracks.data[0].title)) * 2.5;
        }

        return score;
    }

    async function resolveDeezerByMetadata(meta, artistName) {
        const results = await deezerSearchAlbums(meta.title, artistName);
        if (!results.length) return null;

        const prelim = results
            .map((item) => ({
                item,
                score: tokenSimilarity(meta.title, item.title) * 10 +
                    (artistName && item.artist?.name ? tokenSimilarity(artistName, item.artist.name) * 4 : 0),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 8);

        const detailed = await Promise.all(prelim.map(async ({ item }) => {
            const album = await deezerAlbumById(item.id);
            return album ? { album, score: scoreDeezerAlbum(album, meta, artistName) } : null;
        }));

        const ranked = detailed
            .filter(Boolean)
            .sort((a, b) => b.score - a.score);

        if (!ranked.length) return null;

        const best = ranked[0];
        const second = ranked[1];
        const confident = best.score >= 10 && (!second || best.score - second.score >= 1.5 || best.score >= 14);
        return confident ? best.album : null;
    }

    function escapeLucenePhrase(value) {
        return String(value).replace(/([\\"])/g, '\\$1');
    }

    function scoreMusicBrainzRelease(release, meta) {
        let score = 0;
        score += tokenSimilarity(meta.title, release.title) * 10;

        if (meta.date && release.date) {
            if (release.date === meta.date) score += 5;
            else if (release.date.slice(0, 4) === meta.date.slice(0, 4)) score += 1.5;
        }

        if (release.barcode) score += 1;
        return score;
    }

    async function musicBrainzReleaseDetails(mbid) {
        const url = `https://musicbrainz.org/ws/2/release/${encodeURIComponent(mbid)}?inc=labels&fmt=json`;
        return mbJson(url).catch(() => null);
    }

    async function musicBrainzBarcodesByCatalog(catalog, meta) {
        const key = `${normalizeCatalog(catalog)}|${normalizeText(meta.title)}|${meta.date}`;
        if (caches.musicBrainzCatalog.has(key)) return caches.musicBrainzCatalog.get(key);

        const promise = (async () => {
            const query = `catno:"${escapeLucenePhrase(catalog)}"`;
            const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
            const data = await mbJson(url).catch(() => null);
            const releases = Array.isArray(data?.releases) ? data.releases : [];
            if (!releases.length) return [];

            const targetCatalog = normalizeCatalog(catalog);
            const verified = [];

            for (const release of releases) {
                let full = release;
                let labelInfo = Array.isArray(full['label-info']) ? full['label-info'] : [];
                let exactCatalog = labelInfo.some((entry) => normalizeCatalog(entry?.['catalog-number']) === targetCatalog);

                if (!exactCatalog && release.id) {
                    full = await musicBrainzReleaseDetails(release.id) || release;
                    labelInfo = Array.isArray(full['label-info']) ? full['label-info'] : [];
                    exactCatalog = labelInfo.some((entry) => normalizeCatalog(entry?.['catalog-number']) === targetCatalog);
                }

                if (!exactCatalog) continue;
                verified.push(full);
            }

            verified.sort((a, b) => scoreMusicBrainzRelease(b, meta) - scoreMusicBrainzRelease(a, meta));

            const barcodes = [];
            for (const release of verified) {
                const barcode = String(release.barcode || '').replace(/\D/g, '');
                if (!barcode) continue;
                if (!barcodes.some((existing) => normalizeBarcode(existing) === normalizeBarcode(barcode))) {
                    barcodes.push(barcode);
                }
            }

            return barcodes;
        })();

        caches.musicBrainzCatalog.set(key, promise);
        return promise;
    }

    async function resolveDeezer(context) {
        const { meta, currentUrl, topicArtist } = context;
        let artistName = topicArtist || '';

        const deezerArtistId = getDeezerArtistId(currentUrl);
        if (deezerArtistId) {
            const artist = await deezerArtistById(deezerArtistId);
            if (artist?.name) artistName = artist.name;
        }

        if (meta.identifier?.type === 'barcode') {
            const album = await deezerAlbumByBarcode(meta.identifier.value);
            if (album) return `https://www.deezer.com/album/${album.id}`;

            // Some numeric values are catalog numbers rather than barcodes.
            const mbBarcodes = await musicBrainzBarcodesByCatalog(meta.identifier.value, meta);
            for (const barcode of mbBarcodes) {
                const mbAlbum = await deezerAlbumByBarcode(barcode);
                if (mbAlbum) return `https://www.deezer.com/album/${mbAlbum.id}`;
            }
        }

        if (meta.identifier?.type === 'catalog') {
            const barcodes = await musicBrainzBarcodesByCatalog(meta.identifier.value, meta);
            for (const barcode of barcodes) {
                const album = await deezerAlbumByBarcode(barcode);
                if (album) return `https://www.deezer.com/album/${album.id}`;
            }
        }

        const fallback = await resolveDeezerByMetadata(meta, artistName);
        return fallback ? `https://www.deezer.com/album/${fallback.id}` : null;
    }

    const PROVIDERS = [
        {
            key: 'deezer',
            label: 'Deezer',
            sourceRegex: /(\[b\]Носитель\|Источник\[\/b\]\s*:\s*WEB\|)(?:Deezer|\[url=(?:"([^"]+)"|([^\]]+))\]Deezer\[\/url\])(\[hr\])/i,
            isReleaseUrl: isDeezerAlbumUrl,
            resolve: resolveDeezer,
            makeLinkedSource(match, url) {
                return `${match[1]}[url=${url}]Deezer[/url]${match[4]}`;
            },
            getCurrentUrl(match) {
                return (match[2] || match[3] || '').trim();
            },
        },
    ];

    function findSpoilers(text) {
        const spoilers = [];
        const regex = /\[spoiler="([^"]*)"\]([\s\S]*?)\[\/spoiler\]/gi;
        let match;
        while ((match = regex.exec(text))) {
            spoilers.push({
                start: match.index,
                end: regex.lastIndex,
                fullText: match[0],
                title: match[1],
                body: match[2],
            });
        }
        return spoilers;
    }

    function findProviderMatch(blockText) {
        for (const provider of PROVIDERS) {
            const match = blockText.match(provider.sourceRegex);
            if (match) return { provider, match };
        }
        return null;
    }

    async function mapLimit(items, limit, worker) {
        const results = new Array(items.length);
        let nextIndex = 0;

        async function run() {
            while (true) {
                const index = nextIndex++;
                if (index >= items.length) return;
                results[index] = await worker(items[index], index);
            }
        }

        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
        return results;
    }

    function createUi(textarea) {
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;flex-wrap:wrap;';

        const button = document.createElement('input');
        button.type = 'button';
        button.value = 'Link digital release pages';
        button.className = 'btn';
        button.style.cursor = 'pointer';

        const status = document.createElement('span');
        status.style.cssText = 'font-size:11px;';

        wrapper.append(button, status);
        textarea.parentNode.insertBefore(wrapper, textarea);
        return { wrapper, button, status };
    }

    function setStatus(statusNode, text) {
        statusNode.textContent = text;
    }

    async function runLinker(textarea, ui) {
        const originalText = textarea.value;
        const topicArtist = getTopicArtist(originalText);
        const spoilers = findSpoilers(originalText);
        const candidates = [];
        let alreadyLinked = 0;

        for (const spoiler of spoilers) {
            const found = findProviderMatch(spoiler.fullText);
            if (!found) continue;

            const currentUrl = found.provider.getCurrentUrl(found.match);
            if (currentUrl && found.provider.isReleaseUrl(currentUrl)) {
                alreadyLinked += 1;
                continue;
            }

            candidates.push({
                spoiler,
                provider: found.provider,
                sourceMatch: found.match,
                currentUrl,
                meta: parseSpoilerMeta(spoiler.title, spoiler.fullText),
            });
        }

        if (!candidates.length) {
            setStatus(ui.status, alreadyLinked ? `Nothing to change. ${alreadyLinked} release link(s) already present.` : 'Nothing to link.');
            return;
        }

        ui.button.disabled = true;
        let finished = 0;
        setStatus(ui.status, `Resolving 0/${candidates.length}...`);

        try {
            const results = await mapLimit(candidates, CONCURRENCY, async (candidate) => {
                let url = null;
                let error = null;

                try {
                    url = await candidate.provider.resolve({
                        meta: candidate.meta,
                        currentUrl: candidate.currentUrl,
                        topicArtist,
                        blockText: candidate.spoiler.fullText,
                    });
                } catch (caught) {
                    error = caught;
                    console.error(`[${SCRIPT_NAME}]`, candidate.meta.spoilerTitle, caught);
                }

                finished += 1;
                setStatus(ui.status, `Resolving ${finished}/${candidates.length}...`);
                return { candidate, url, error };
            });

            const replacements = [];
            let linked = 0;
            let notFound = 0;

            for (const result of results) {
                if (!result.url) {
                    notFound += 1;
                    console.warn(`[${SCRIPT_NAME}] Release not resolved: ${result.candidate.meta.spoilerTitle}`);
                    continue;
                }

                const { candidate } = result;
                const replacedBlock = candidate.spoiler.fullText.replace(
                    candidate.provider.sourceRegex,
                    (...args) => candidate.provider.makeLinkedSource(args, result.url),
                );

                if (replacedBlock !== candidate.spoiler.fullText) {
                    replacements.push({
                        start: candidate.spoiler.start,
                        end: candidate.spoiler.end,
                        text: replacedBlock,
                    });
                    linked += 1;
                }
            }

            replacements.sort((a, b) => b.start - a.start);
            let updatedText = originalText;
            for (const replacement of replacements) {
                updatedText = updatedText.slice(0, replacement.start) + replacement.text + updatedText.slice(replacement.end);
            }

            if (updatedText !== originalText) {
                textarea.value = updatedText;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.dispatchEvent(new Event('change', { bubbles: true }));
            }

            const parts = [`Linked: ${linked}`];
            if (alreadyLinked) parts.push(`already linked: ${alreadyLinked}`);
            if (notFound) parts.push(`not found: ${notFound}`);
            setStatus(ui.status, parts.join(' | '));
        } finally {
            ui.button.disabled = false;
        }
    }

    function init() {
        const url = new URL(location.href);
        if (url.searchParams.get('mode') !== 'editpost') return;

        const textarea = document.querySelector('textarea[name="message"], textarea#message');
        if (!textarea) return;
        if (document.querySelector('[data-rutracker-digital-release-linker]')) return;

        const ui = createUi(textarea);
        ui.wrapper.dataset.rutrackerDigitalReleaseLinker = '1';
        ui.button.addEventListener('click', () => runLinker(textarea, ui));
    }

    init();
})();