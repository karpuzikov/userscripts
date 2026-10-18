// ==UserScript==
// @name         RuTracker Digital Release Linker
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.1.24
// @description  Links verified digital release pages and merges new releases with catalog-matched FastPic covers.
// @author       karpuzikov
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/rutracker-digital-release-linker/RuTracker_Digital_Release_Linker.user.js
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/rutracker-digital-release-linker/RuTracker_Digital_Release_Linker.user.js
// @match        https://rutracker.org/forum/posting.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      api.deezer.com
// @connect      musicbrainz.org
// @connect      fastpic.org
// @connect      www.fastpic.org
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
        musicBrainzBarcode: new Map(),
        musicBrainzIdentifier: new Map(),
        musicBrainzReleasePage: new Map(),
    };

    let mbQueue = Promise.resolve();
    let lastMbRequestAt = 0;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function musicBrainz503Delay(response) {
        const headers = String(response?.responseHeaders || '');
        const value = headers.match(/(?:^|\r?\n)Retry-After:\s*([^\r\n]+)/i)?.[1]?.trim() || '';
        const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
        const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
        return Number.isFinite(requested) ? Math.max(5000, Math.ceil(requested)) : 5000;
    }

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
                        if (status === 503 && options.retry503) {
                            setTimeout(() => attempt(number), musicBrainz503Delay(response));
                            return;
                        }
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
                retry503: true,
                headers: {
                    'User-Agent': `${SCRIPT_NAME}/1.1.23 (Tampermonkey userscript)`,
                },
            });
        });

        mbQueue = task.catch(() => undefined);
        return task;
    }

    function mbText(url) {
        const task = mbQueue.then(async () => {
            const elapsed = Date.now() - lastMbRequestAt;
            if (elapsed < MB_MIN_INTERVAL_MS) {
                await sleep(MB_MIN_INTERVAL_MS - elapsed);
            }

            lastMbRequestAt = Date.now();

            return new Promise((resolve, reject) => {
                const attempt = (number) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url,
                        headers: {
                            Accept: 'text/html',
                            'User-Agent': `${SCRIPT_NAME}/1.1.23 (Tampermonkey userscript)`,
                        },
                        timeout: 20000,
                        onload(response) {
                            const status = response.status || 0;
                            if (status === 503) {
                                setTimeout(() => attempt(number), musicBrainz503Delay(response));
                                return;
                            }
                            if ((status === 429 || status >= 500) && number < 2) {
                                setTimeout(() => attempt(number + 1), 1000 * (number + 1));
                                return;
                            }

                            if (status < 200 || status >= 300) {
                                reject(new Error(`HTTP ${status} for ${url}`));
                                return;
                            }

                            resolve(String(response.responseText || ''));
                        },
                        ontimeout() {
                            if (number < 2) {
                                setTimeout(() => attempt(number + 1), 1000 * (number + 1));
                            } else {
                                reject(new Error(`Timeout for ${url}`));
                            }
                        },
                        onerror() {
                            if (number < 2) {
                                setTimeout(() => attempt(number + 1), 1000 * (number + 1));
                            } else {
                                reject(new Error(`Network error for ${url}`));
                            }
                        },
                    });
                };

                attempt(0);
            });
        });

        mbQueue = task.catch(() => undefined);
        return task;
    }

    function extractStoreUrlFromMusicBrainzHtml(html, store) {
        const source = String(html || '')
            .replace(/&amp;/gi, '&')
            .replace(/\\\//g, '/')
            .replace(/\\u002f/gi, '/')
            .replace(/\\u003a/gi, ':');

        let matcher = null;
        if (store === 'deezer') {
            matcher = /^https?:\/\/(?:www\.)?deezer\.com\/(?:[^/]+\/)?album\/\d+(?:[/?#].*)?$/i;
        } else if (store === 'beatport') {
            matcher = /^https?:\/\/(?:www\.)?beatport\.com\/release\/[^?#\s]+(?:[?#].*)?$/i;
        }

        if (!matcher) return '';

        try {
            const doc = new DOMParser().parseFromString(source, 'text/html');
            for (const anchor of doc.querySelectorAll('a[href]')) {
                let href = String(anchor.getAttribute('href') || '').trim();
                if (!href) continue;

                try {
                    href = decodeURIComponent(href);
                } catch {
                    // Keep the original href when it is not percent-encoded.
                }

                if (matcher.test(href)) return href;
            }
        } catch {
            // Fall through to raw HTML matching.
        }

        const rawRegex = store === 'deezer'
            ? /https?:\/\/(?:www\.)?deezer\.com\/(?:[^/"'<>\s]+\/)?album\/\d+(?:[^"'<>\s]*)?/i
            : /https?:\/\/(?:www\.)?beatport\.com\/release\/[^"'<>\s]+/i;

        const direct = source.match(rawRegex);
        if (direct) return direct[0];

        const encodedRegex = store === 'deezer'
            ? /https?%3A%2F%2F(?:www\.)?deezer\.com%2F(?:[^"'<>\s%]+%2F)?album%2F\d+(?:[^"'<>\s]*)?/i
            : /https?%3A%2F%2F(?:www\.)?beatport\.com%2Frelease%2F[^"'<>\s]+/i;

        const encoded = source.match(encodedRegex);
        if (!encoded) return '';

        try {
            return decodeURIComponent(encoded[0]);
        } catch {
            return '';
        }
    }

    async function musicBrainzReleasePageStoreUrl(mbid, store) {
        if (!mbid) return '';

        const cacheKey = `${mbid}|${store}`;
        if (caches.musicBrainzReleasePage.has(cacheKey)) {
            return caches.musicBrainzReleasePage.get(cacheKey);
        }

        const promise = mbText(
            `https://musicbrainz.org/release/${encodeURIComponent(mbid)}`,
        )
            .then((html) => extractStoreUrlFromMusicBrainzHtml(html, store))
            .catch(() => '');

        caches.musicBrainzReleasePage.set(cacheKey, promise);
        return promise;
    }



    const COUNTRY_ALIASES = new Map(Object.entries({
        usa: 'US',
        'united states': 'US',
        'united states of america': 'US',
        uk: 'GB',
        'united kingdom': 'GB',
        'great britain': 'GB',
        britain: 'GB',
        'northern ireland': 'GB',
        russia: 'RU',
        'south korea': 'KR',
        'north korea': 'KP',
        'czech republic': 'CZ',
        czechia: 'CZ',
        vietnam: 'VN',
        'viet nam': 'VN',
        iran: 'IR',
        syria: 'SY',
        laos: 'LA',
        moldova: 'MD',
        bolivia: 'BO',
        venezuela: 'VE',
        tanzania: 'TZ',
        'ivory coast': 'CI',
        "cote d'ivoire": 'CI',
        taiwan: 'TW',
    }));

    const SUBDIVISION_FLAGS = new Map(Object.entries({
        england: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
        scotland: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
        wales: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
    }));

    let countryNameIndex = null;

    function normalizeCountryName(value) {
        return String(value ?? '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    function countryCodeFromName(value) {
        const key = normalizeCountryName(value);
        if (!key) return '';

        const alias = COUNTRY_ALIASES.get(key);
        if (alias) return alias;

        if (!countryNameIndex) {
            countryNameIndex = new Map();
            if (typeof Intl?.DisplayNames === 'function') {
                const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
                for (let first = 65; first <= 90; first += 1) {
                    for (let second = 65; second <= 90; second += 1) {
                        const code = String.fromCharCode(first, second);
                        const name = displayNames.of(code);
                        if (!name || name === code) continue;
                        if (!/^\p{RGI_Emoji}$/v.test(flagEmoji(code))) continue;
                        const key = normalizeCountryName(name);
                        if (!countryNameIndex.has(key)) countryNameIndex.set(key, code);
                    }
                }
            }
        }

        return countryNameIndex.get(key) || '';
    }

    function flagEmoji(countryCode) {
        if (!/^[A-Z]{2}$/.test(countryCode)) return '';
        return [...countryCode]
            .map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0)))
            .join('');
    }

    function flagForCountryName(value) {
        const key = normalizeCountryName(value);
        const subdivisionFlag = SUBDIVISION_FLAGS.get(key);
        if (subdivisionFlag) return subdivisionFlag;

        const code = countryCodeFromName(value);
        return flagEmoji(code);
    }

    function stripTrailingFlag(value) {
        return String(value ?? '')
            .replace(/\s*(?:[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F3F4}[\u{E0061}-\u{E007A}]+\u{E007F})\s*$/u, '')
            .trim();
    }

    function addCountryFlags(text) {
        let changed = 0;
        const updated = text.replace(
            /(\[b\]Страна\[\/b\]\s*:\s*)([^|\r\n]+)/gi,
            (full, prefix, rawCountry) => {
                const country = stripTrailingFlag(rawCountry);
                const flag = flagForCountryName(country);
                if (!flag) return full;

                const replacement = `${prefix}${country} ${flag}`;
                if (replacement !== full) changed += 1;
                return replacement;
            },
        );

        return { text: updated, changed };
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

        const identifier = extractIdentifier(spoilerTitle);

        let title = spoilerTitle.replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, '').trim();
        title = title.replace(/\s*\(by\s+[\s\S]*\)\s*$/i, '').trim();
        if (identifier || /\[(?:none|n\/?a|unknown)\]\s*$/i.test(title)) {
            title = title.replace(/\s*\[[^\[\]]+\]\s*$/, '').trim();
        }
        title = title.replace(/\s*-\s*(?:single|ep|album)\s*$/i, '').trim();

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
        const cleaned = String(spoilerTitle ?? '')
            .replace(/\s*\(by\s+[\s\S]*\)\s*$/i, '')
            .trim();

        const match = cleaned.match(/\[([^\[\]]+)\]\s*$/);
        if (!match) return null;

        const raw = match[1].trim();
        let value = raw;
        let reissueYear = '';

        const parts = raw.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
        if (parts.length > 1) {
            const last = parts[parts.length - 1];
            if (/^(?:19|20)\d{2}$/.test(last)) {
                reissueYear = last;
                value = parts.slice(0, -1).join(' - ').trim();
            } else {
                value = last;
            }
        }

        if (/^\d{8,14}$/.test(value)) {
            return { type: 'barcode', value, reissueYear };
        }

        const placeholder = normalizeText(value);
        if ([
            'none',
            'n a',
            'na',
            'unknown',
            'no catalog',
            'no catalogue',
            'no cat',
            'not available',
        ].includes(placeholder)) {
            return null;
        }

        const allowedCatalog = /^[A-Za-z0-9][A-Za-z0-9 ._/+\-]{2,}$/;
        const hasDigit = /\d/.test(value);
        const uppercaseLetterOnly =
            /^[A-Z][A-Z._/+\-]{2,}$/.test(value) &&
            /[A-Z]/.test(value);

        if (allowedCatalog.test(value) && (hasDigit || uppercaseLetterOnly)) {
            return { type: 'catalog', value, reissueYear };
        }

        return null;
    }
    function getTopicArtist(postText) {
        const heading = postText.match(/\[size=\d+\]\s*([^|\r\n\[]+?)\s*\|\s*(?:Дискография|Discography)(?![\p{L}\p{N}])/iu);
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

    function isBeatportReleaseUrl(url) {
        return /https?:\/\/(?:www\.)?beatport\.com\/release\/[^?#\s]+/i.test(String(url || ''));
    }

    function isArtistPlaceholderUrl(url) {
        const value = String(url || '').trim();
        if (!value) return false;

        try {
            const parsed = new URL(value);
            const host = parsed.hostname.toLowerCase();
            const path = parsed.pathname.replace(/\/+$/, '') || '/';

            if (/(?:^|\.)deezer\.com$/.test(host)) {
                return /^\/(?:[^/]+\/)?artist\/\d+$/i.test(path);
            }

            if (/(?:^|\.)beatport\.com$/.test(host)) {
                return /^\/artist\/[^/]+(?:\/\d+)?$/i.test(path);
            }

            if (/\.bandcamp\.com$/.test(host)) {
                return path === '/' || path === '/music';
            }

            if (/(?:^|\.)7digital\.com$/.test(host)) {
                return /^\/artist\/[^/]+$/i.test(path);
            }

            if (/(?:^|\.)qobuz\.com$/.test(host)) {
                return /\/(?:artist|interpreter)\/[^/]+$/i.test(path);
            }

            return false;
        } catch {
            return false;
        }
    }

    function isResolvedDigitalReleaseUrl(url) {
        const value = String(url || '').trim();
        if (!value || /^(?:ссылка|ссылкаНаИсточник|Источник)$/i.test(value)) return false;

        if (isDeezerAlbumUrl(value) || isBeatportReleaseUrl(value)) return true;

        // Existing concrete source URLs are already useful. Only known
        // artist-level pages are placeholders that should be replaced.
        return !isArtistPlaceholderUrl(value);
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

    function barcodeLookupVariants(value) {
        const digits = String(value ?? '').replace(/\D/g, '');
        if (!digits) return [];

        const variants = [];
        const add = (candidate) => {
            if (candidate && !variants.includes(candidate)) variants.push(candidate);
        };

        add(digits);

        let trimmed = digits;
        while (trimmed.startsWith('0') && trimmed.length > 8) {
            trimmed = trimmed.slice(1);
            if ([14, 13, 12, 8].includes(trimmed.length)) add(trimmed);
        }

        return variants;
    }

    async function deezerAlbumByBarcode(barcode) {
        const key = normalizeBarcode(barcode);
        if (!key) return null;
        if (caches.deezerBarcode.has(key)) return caches.deezerBarcode.get(key);

        const promise = (async () => {
            for (const variant of barcodeLookupVariants(barcode)) {
                const data = await gmJson(`https://api.deezer.com/album/upc:${encodeURIComponent(variant)}`)
                    .catch(() => null);

                if (!data || data.error || !data.id) continue;

                const returned = normalizeBarcode(data.upc);
                if (!returned || returned !== key) {
                    console.warn(`[${SCRIPT_NAME}] Deezer UPC mismatch`, {
                        requested: barcode,
                        attempted: variant,
                        returned: data.upc,
                        albumId: data.id,
                    });
                    continue;
                }

                return data;
            }

            return null;
        })();

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

        const targetYear = meta.identifier?.reissueYear || meta.date?.slice(0, 4) || '';
        if (release.date && targetYear) {
            if (meta.identifier?.reissueYear && release.date.slice(0, 4) === targetYear) {
                score += 5;
            } else if (!meta.identifier?.reissueYear && release.date === meta.date) {
                score += 5;
            } else if (release.date.slice(0, 4) === targetYear) {
                score += 1.5;
            }
        }

        if (release.barcode) score += 1;
        return score;
    }

    async function musicBrainzReleaseDetails(mbid) {
        const url = `https://musicbrainz.org/ws/2/release/${encodeURIComponent(mbid)}?inc=labels+recordings+recording-level-rels+url-rels&fmt=json`;
        return mbJson(url).catch(() => null);
    }

    function beatportReleaseUrl(release) {
        const relations = Array.isArray(release?.relations) ? release.relations : [];
        for (const relation of relations) {
            const resource = String(relation?.url?.resource || '').trim();
            if (/^https?:\/\/(?:www\.)?beatport\.com\/release\/[^?#\s]+/i.test(resource)) {
                return resource;
            }
        }
        return '';
    }

    function deezerReleaseUrl(release) {
        const relations = Array.isArray(release?.relations) ? release.relations : [];
        for (const relation of relations) {
            const resource = String(relation?.url?.resource || '').trim();
            const match = resource.match(
                /^https?:\/\/(?:www\.)?deezer\.com\/(?:[^/]+\/)?album\/(\d+)(?:[/?#]|$)/i,
            );
            if (match) return `https://www.deezer.com/album/${match[1]}`;
        }
        return '';
    }

    function deezerTrackUrlFromReleaseRecordings(release) {
        const media = Array.isArray(release?.media) ? release.media : [];

        for (const medium of media) {
            const tracks = Array.isArray(medium?.tracks) ? medium.tracks : [];

            for (const track of tracks) {
                const relations = Array.isArray(track?.recording?.relations)
                    ? track.recording.relations
                    : [];

                for (const relation of relations) {
                    const resource = String(relation?.url?.resource || '').trim();
                    if (/^https?:\/\/(?:www\.)?deezer\.com\/(?:[^/]+\/)?track\/\d+(?:[/?#]|$)/i.test(resource)) {
                        return resource;
                    }
                }
            }
        }

        return '';
    }

    async function deezerAlbumUrlFromTrackUrl(trackUrl) {
        const match = String(trackUrl || '').match(
            /deezer\.com\/(?:[^/]+\/)?track\/(\d+)/i,
        );
        if (!match) return '';

        const data = await gmJson(
            `https://api.deezer.com/track/${encodeURIComponent(match[1])}`,
        ).catch(() => null);

        const albumId = data?.album?.id;
        return albumId ? `https://www.deezer.com/album/${albumId}` : '';
    }

    async function musicBrainzReleasesByIdentifier(identifier, meta) {
        if (!identifier?.type || !identifier?.value) return [];

        const cacheKey = `${identifier.type}|${identifier.value}|${identifier.reissueYear || ''}|${normalizeText(meta.title)}|${meta.date}|${meta.trackCount}`;
        if (caches.musicBrainzIdentifier.has(cacheKey)) {
            return caches.musicBrainzIdentifier.get(cacheKey);
        }

        const promise = (async () => {
            let releases = [];

            if (identifier.type === 'barcode') {
                for (const variant of barcodeLookupVariants(identifier.value)) {
                    const query = `barcode:"${escapeLucenePhrase(variant)}"`;
                    const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
                    const data = await mbJson(url).catch(() => null);
                    const matches = Array.isArray(data?.releases) ? data.releases : [];

                    releases = matches.filter((release) =>
                        normalizeBarcode(release.barcode) === normalizeBarcode(identifier.value)
                    );
                    if (releases.length) break;
                }
            } else if (identifier.type === 'catalog') {
                const targetCatalog = normalizeCatalog(identifier.value);
                const query = `catno:"${escapeLucenePhrase(identifier.value)}"`;
                const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=25`;
                const data = await mbJson(url).catch(() => null);
                const matches = Array.isArray(data?.releases) ? data.releases : [];

                for (const release of matches) {
                    if (!release.id) continue;
                    const full = await musicBrainzReleaseDetails(release.id);
                    if (!full) continue;
                    const labelInfo = Array.isArray(full['label-info']) ? full['label-info'] : [];
                    const exactCatalog = labelInfo.some((entry) =>
                        normalizeCatalog(entry?.['catalog-number']) === targetCatalog
                    );
                    if (exactCatalog) releases.push(full);
                }
            }

            releases.sort((a, b) => scoreMusicBrainzRelease(b, meta) - scoreMusicBrainzRelease(a, meta));

            const detailed = [];
            for (const release of releases) {
                if (!release?.id) continue;
                const full = Array.isArray(release.relations)
                    ? release
                    : await musicBrainzReleaseDetails(release.id);
                if (full) detailed.push(full);
            }

            return detailed;
        })();

        caches.musicBrainzIdentifier.set(cacheKey, promise);
        return promise;
    }

    async function resolveDeezerFromMusicBrainz(meta) {
        if (!meta.identifier) return null;

        const releases = await musicBrainzReleasesByIdentifier(meta.identifier, meta);
        for (const release of releases) {
            const relationUrl = deezerReleaseUrl(release);
            if (relationUrl) return { kind: 'deezer', url: relationUrl };

            // Some exact MusicBrainz releases only expose Deezer on one of the
            // linked recordings. Convert that exact Deezer track to its album.
            const trackUrl = deezerTrackUrlFromReleaseRecordings(release);
            if (trackUrl) {
                const albumUrl = await deezerAlbumUrlFromTrackUrl(trackUrl);
                if (albumUrl) return { kind: 'deezer', url: albumUrl };
            }

            // Use only the exact MusicBrainz release page. Do not traverse
            // release groups or guess by metadata.
            const pageUrl = await musicBrainzReleasePageStoreUrl(release.id, 'deezer');
            if (pageUrl) return { kind: 'deezer', url: pageUrl };
        }

        return null;
    }

    async function resolveBeatportFromMusicBrainz(meta) {
        if (!meta.identifier) return null;

        const releases = await musicBrainzReleasesByIdentifier(meta.identifier, meta);
        for (const release of releases) {
            const relationUrl = beatportReleaseUrl(release);
            if (relationUrl) return { kind: 'beatport', url: relationUrl };

            // Same rule as Deezer: only links present on the exact release page.
            const pageUrl = await musicBrainzReleasePageStoreUrl(release.id, 'beatport');
            if (pageUrl) return { kind: 'beatport', url: pageUrl };
        }

        return null;
    }

    async function musicBrainzEquivalentBarcodesByBarcode(barcode, meta) {
        const key = `${normalizeBarcode(barcode)}|${normalizeText(meta.title)}|${meta.date}|${meta.trackCount}`;
        if (caches.musicBrainzBarcode.has(key)) return caches.musicBrainzBarcode.get(key);

        const promise = (async () => {
            let matched = [];

            for (const variant of barcodeLookupVariants(barcode)) {
                const query = `barcode:"${escapeLucenePhrase(variant)}"`;
                const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
                const data = await mbJson(url).catch(() => null);
                const releases = Array.isArray(data?.releases) ? data.releases : [];

                matched = releases.filter((release) =>
                    normalizeBarcode(release.barcode) === normalizeBarcode(barcode)
                );

                if (matched.length) break;
            }

            if (!matched.length) return [];

            matched.sort((a, b) => scoreMusicBrainzRelease(b, meta) - scoreMusicBrainzRelease(a, meta));
            const source = matched[0];
            const releaseGroupId = source?.['release-group']?.id;
            if (!releaseGroupId) return [];

            const sourceTitle = normalizeText(source.title || meta.title);
            const sourceComment = normalizeText(source.disambiguation || '');
            const groupQuery = `rgid:${releaseGroupId}`;
            const groupUrl = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(groupQuery)}&fmt=json&limit=100`;
            const groupData = await mbJson(groupUrl).catch(() => null);
            const siblings = Array.isArray(groupData?.releases) ? groupData.releases : [];

            const candidates = siblings
                .filter((release) => {
                    const siblingBarcode = String(release.barcode || '').replace(/\D/g, '');
                    if (!siblingBarcode) return false;
                    if (normalizeBarcode(siblingBarcode) === normalizeBarcode(barcode)) return false;

                    if (sourceTitle && normalizeText(release.title) !== sourceTitle) return false;

                    if (meta.date && release.date && release.date !== meta.date) return false;

                    const trackCount = Number(release['track-count'] || 0);
                    if (meta.trackCount && trackCount && trackCount !== meta.trackCount) return false;

                    if (sourceComment) {
                        const siblingComment = normalizeText(release.disambiguation || '');
                        if (siblingComment !== sourceComment) return false;
                    }

                    return true;
                })
                .sort((a, b) => scoreMusicBrainzRelease(b, meta) - scoreMusicBrainzRelease(a, meta));

            const barcodes = [];
            for (const release of candidates) {
                const siblingBarcode = String(release.barcode || '').replace(/\D/g, '');
                if (!siblingBarcode) continue;
                if (!barcodes.some((existing) =>
                    normalizeBarcode(existing) === normalizeBarcode(siblingBarcode)
                )) {
                    barcodes.push(siblingBarcode);
                }
            }

            return barcodes;
        })();

        caches.musicBrainzBarcode.set(key, promise);
        return promise;
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

    async function resolveDeezer(context, { deezerOnly = false } = {}) {
        const { meta, currentUrl, topicArtist } = context;

        if (meta.identifier?.type === 'barcode') {
            const album = await deezerAlbumByBarcode(meta.identifier.value);
            if (album) return { kind: 'deezer', url: `https://www.deezer.com/album/${album.id}` };

            const musicBrainzDeezer = await resolveDeezerFromMusicBrainz(meta);
            if (musicBrainzDeezer) return musicBrainzDeezer;

            // Deezer can use a different regional barcode for the same digital
            // release. Use MusicBrainz only to bridge to equivalent barcodes
            // from the same release group/version, then retry Deezer by barcode.
            const equivalentBarcodes = await musicBrainzEquivalentBarcodesByBarcode(meta.identifier.value, meta);
            for (const barcode of equivalentBarcodes) {
                const equivalentAlbum = await deezerAlbumByBarcode(barcode);
                if (equivalentAlbum) {
                    return { kind: 'deezer', url: `https://www.deezer.com/album/${equivalentAlbum.id}` };
                }
            }

            // A numeric identifier can sometimes actually be a catalog number.
            const mbBarcodes = await musicBrainzBarcodesByCatalog(meta.identifier.value, meta);
            for (const barcode of mbBarcodes) {
                const mbAlbum = await deezerAlbumByBarcode(barcode);
                if (mbAlbum) return { kind: 'deezer', url: `https://www.deezer.com/album/${mbAlbum.id}` };
            }

            return deezerOnly ? null : resolveBeatportFromMusicBrainz(meta);
        }

        if (meta.identifier?.type === 'catalog') {
            const musicBrainzDeezer = await resolveDeezerFromMusicBrainz(meta);
            if (musicBrainzDeezer) return musicBrainzDeezer;

            const barcodes = await musicBrainzBarcodesByCatalog(meta.identifier.value, meta);
            for (const barcode of barcodes) {
                const album = await deezerAlbumByBarcode(barcode);
                if (album) return { kind: 'deezer', url: `https://www.deezer.com/album/${album.id}` };
            }

            return deezerOnly ? null : resolveBeatportFromMusicBrainz(meta);
        }

        // No identifier: only search by metadata when repairing an existing
        // generic Deezer artist link. Beatport fallback is intentionally not
        // attempted without a barcode or catalog number.
        const deezerArtistId = getDeezerArtistId(currentUrl);
        if (!deezerArtistId) return null;

        let artistName = topicArtist || '';
        const artist = await deezerArtistById(deezerArtistId);
        if (artist?.name) artistName = artist.name;

        const fallback = await resolveDeezerByMetadata(meta, artistName);
        return fallback
            ? { kind: 'deezer', url: `https://www.deezer.com/album/${fallback.id}` }
            : null;
    }

    const PROVIDERS = [
        {
            key: 'unfilled-digital-release',
            label: 'Unfilled digital release',
            sourceRegex: /(\[b\]Носитель\|Источник\[\/b\]\s*:\s*)CD\s*\/\s*WEB\s*\|\s*\[url=(?:"[^"]+"|[^\]]+)\]Источник\[\/url\](\[hr\])?/i,
            isReleaseUrl: () => false,
            resolve: resolveDeezer,
            getCurrentUrl: () => '',
            makeLinkedSource(match, resolution) {
                const name = resolution.kind === 'beatport' ? 'Beatport' : 'Deezer';
                return `${match[1]}WEB|[url=${resolution.url}]${name}[/url]${match[2] || ''}`;
            },
        },
        {
            key: 'digital-release',
            label: 'Digital release',
            sourceRegex: /(\[b\]Носитель\|Источник\[\/b\]\s*:\s*)(?:(WEB)\|(?:Deezer|\[url=(?:"([^"]+)"|([^\]]+))\]Deezer\[\/url\]|(redacted\.(?:sh|ch)))|\[url=(?:"([^"]+)"|([^\]]+))\]WEB\[\/url\]\|(redacted\.(?:sh|ch)))(\[hr\])?/i,
            isReleaseUrl: isResolvedDigitalReleaseUrl,
            resolve: resolveDeezer,
            makeLinkedSource(match, resolution) {
                const originalRedacted = (match[5] || match[8] || '').trim();
                const hr = match[9] || '';

                if (resolution.kind === 'beatport') {
                    const tracker = originalRedacted || 'redacted.sh';
                    return `${match[1]}[url=${resolution.url}]WEB[/url]|${tracker}${hr}`;
                }

                return `${match[1]}WEB|[url=${resolution.url}]Deezer[/url]${hr}`;
            },
            getCurrentUrl(match) {
                return (match[3] || match[4] || match[6] || match[7] || '').trim();
            },
        },
    ];

    // Mandatory: in forced mode, search Deezer for EVERY WEB release
    // irrespective of existing links, barcode, or catalog number.
    async function resolveForceDeezer(context) {
        const primary = await resolveDeezer(context, { deezerOnly: true });
        if (primary?.kind === 'deezer') return primary;
        // A failed UPC/catalog lookup must not skip Deezer album search.
        if (!context.topicArtist) return null;

        const { meta, topicArtist } = context;
        const results = await deezerSearchAlbums(meta.title, topicArtist);
        const candidates = results.filter((item) =>
            normalizeText(item.title) === normalizeText(meta.title) &&
            normalizeText(item.artist?.name) === normalizeText(topicArtist)
        );
        if (!candidates.length || candidates.length > 8) return null;

        const matches = (await Promise.all(candidates.map((item) => deezerAlbumById(item.id))))
            .filter((album) => album && normalizeText(album.title) === normalizeText(meta.title) &&
                normalizeText(album.artist?.name) === normalizeText(topicArtist) &&
                (!meta.trackCount || Number(album.nb_tracks) === meta.trackCount) &&
                (!meta.date || !album.release_date ||
                    album.release_date.slice(0, 4) === meta.date.slice(0, 4)) &&
                (!meta.firstTrack || !album.tracks?.data?.[0]?.title ||
                    normalizeText(cleanTrackTitle(album.tracks.data[0].title)) ===
                    normalizeText(cleanTrackTitle(meta.firstTrack))));
        return matches.length === 1
            ? { kind: 'deezer', url: 'https://www.deezer.com/album/' + matches[0].id }
            : null;
    }

    const FORCE_WEB_SOURCE_REGEX = /(\[b\]Носитель\|Источник\[\/b\]\s*:\s*)([^\r\n]*?)(\[hr\]|(?=\r?\n|$))/i;

    const FORCE_WEB_PROVIDER = {
        key: 'force-web',
        isReleaseUrl: () => false,
        getCurrentUrl(match) {
            const found = match[2].match(/\[url=(?:"([^"]+)"|([^\]]+))\](?:WEB|Deezer)\[\/url\]/i);
            return (found?.[1] || found?.[2] || '').trim();
        },
        resolve: resolveForceDeezer,
        makeLinkedSource(match, resolution) {
            // Forced mode replaces the previous source credit with Deezer.
            return match[1] + 'WEB|[url=' + resolution.url + ']Deezer[/url]' +
                (match[3] || '');
        },
    };

    function findForceWebMatch(text) {
        const match = text.match(FORCE_WEB_SOURCE_REGEX);
        if (!match) return null;
        const media = match[2].split('|', 1)[0].trim()
            .replace(/^\[url=(?:"[^"]+"|[^\]]+)\]([\s\S]*?)\[\/url\]$/i, '$1')
            .replace(/\s+/g, '').toUpperCase();
        return media === 'WEB' || media === 'CD/WEB'
            ? { provider: FORCE_WEB_PROVIDER, match }
            : null;
    }

    function findSpoilers(text) {
        const spoilers = [];
        const stack = [];
        const tokenRegex = /\[spoiler="([^"]*)"\]|\[\/spoiler\]/gi;
        let match;

        while ((match = tokenRegex.exec(text))) {
            if (match[1] !== undefined) {
                stack.push({
                    start: match.index,
                    openEnd: tokenRegex.lastIndex,
                    title: match[1],
                    children: [],
                });
                continue;
            }

            const current = stack.pop();
            if (!current) continue;

            const end = tokenRegex.lastIndex;
            const fullText = text.slice(current.start, end);
            const body = text.slice(current.openEnd, match.index);
            let ownText = fullText;

            for (const child of current.children) {
                const relativeStart = child.start - current.start;
                const relativeEnd = child.end - current.start;
                ownText =
                    ownText.slice(0, relativeStart) +
                    ' '.repeat(relativeEnd - relativeStart) +
                    ownText.slice(relativeEnd);
            }

            const spoiler = {
                start: current.start,
                end,
                fullText,
                ownText,
                title: current.title,
                body,
            };
            spoilers.push(spoiler);

            const parent = stack[stack.length - 1];
            if (parent) {
                parent.children.push({ start: current.start, end });
            }
        }

        return spoilers.sort((a, b) => a.start - b.start || a.end - b.end);
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

    const EXAMPLE_SESSIONS = [
        'https://fastpic.org/session/2026/1018/WvkKAKaush.html',
        'https://fastpic.org/session/2026/1018/pd2tFCJvyB.html'
    ].join('\n');
    const PLACEHOLDER = '[img=right]ссылка[/img]';
    const TOP_SPOILER_RE = /\[spoiler(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|\[\/spoiler\]/gi;
    const DIRECT_IMAGE_RE = /https?:\/\/i\d+\.fastpic\.org\/big\/\d{4}\/\d{4}\/[a-f\d]{2}\/[a-f\d]{32}\.(?:png|jpe?g|webp)/gi;

    function parseTopLevelSpoilers(source) {
        const entries = [];
        const expression = new RegExp(TOP_SPOILER_RE.source, 'gi');
        let match, depth = 0, begin = -1, title = '';
        while ((match = expression.exec(source)) !== null) {
            if (match[0].toLowerCase().startsWith('[/spoiler')) {
                if (depth < 1) throw new Error('Invalid BBCode: unexpected [/spoiler].');
                if (--depth === 0) {
                    entries.push({ start: begin, end: expression.lastIndex, title,
                        body: source.slice(begin, expression.lastIndex) });
                }
            } else {
                if (depth === 0) {
                    begin = match.index;
                    title = match[1] ?? match[2] ?? match[3] ?? '';
                }
                depth++;
            }
        }
        if (depth !== 0) throw new Error('Invalid BBCode: an [spoiler] block is not closed.');
        return entries;
    }

    function identity(block) {
        const date = block.title.match(/^(\d{4}-\d{2}-\d{2})\s+-\s+/);
        const ids = [...block.title.matchAll(/\[([^\]]+)\]/g)];
        // A standalone CD or Screenshots spoiler is not a complete, dated release.
        return date && ids.length ? { date: date[1], id: ids[ids.length - 1][1].trim() } : null;
    }

    function directImageUrls(raw) {
        return [...new Set(raw.match(DIRECT_IMAGE_RE) || [])];
    }

    function imageHash(url) {
        return url.match(/([a-f\d]{32})\.(?:png|jpe?g|webp)(?:\.html)?(?:[?#]|$)/i)?.[1]?.toLowerCase() || null;
    }

    function parseFastpicHtml(html) {
        const dom = new DOMParser().parseFromString(html, 'text/html');
        const options = [...dom.querySelectorAll('textarea')].map(node => directImageUrls(node.value || node.textContent));
        // Direct links textarea carries filenames in gallery order; other textareas may repeat links.
        const fromDirectArea = options.sort((a, b) => b.length - a.length)[0] || [];
        const direct = fromDirectArea.length ? fromDirectArea : directImageUrls(html);
        const byHash = new Map(direct.map(url => [imageHash(url), url]));
        const covers = new Map();
        for (const titleElement of dom.querySelectorAll('h3')) {
            const filename = titleElement.textContent.trim();
            const catalog = filename.match(/\[([^\]]+)\]\.(?:png|jpe?g|webp)$/i)?.[1]?.trim();
            if (!catalog) continue;
            const group = titleElement.closest('div');
            const anchor = group?.querySelector('a[href*="/view/"]');
            const hash = imageHash(anchor?.getAttribute('href') || '');
            const url = hash ? byHash.get(hash) : null;
            if (!url) continue;
            const previous = covers.get(catalog);
            if (previous && previous !== url) {
                throw new Error(`Multiple different covers for catalog ${catalog}. Resolve the FastPic upload first.`);
            }
            covers.set(catalog, url);
        }
        return covers;
    }

    function mergeDiscography(original, updated, covers) {
        const existing = parseTopLevelSpoilers(original);
        const incoming = parseTopLevelSpoilers(updated);
        if (!existing.length) throw new Error('No release blocks were found in the current post.');
        if (!incoming.length) throw new Error('No [spoiler] blocks were found in the updated post.');

        const originalKeys = new Set(existing.map(identity).filter(Boolean).map(item => item.id));
        const seen = new Set(originalKeys);
        const additions = [];
        const eol = original.includes('\r\n') ? '\r\n' : '\n';
        for (const block of incoming) {
            const key = identity(block);
            if (!key || seen.has(key.id)) continue;
            seen.add(key.id);
            const cover = covers.get(key.id);
            const hasPlaceholder = block.body.includes(PLACEHOLDER);
            // Never alter source links, metadata, title, tracklists, or tags.
            let body = cover && hasPlaceholder
                ? block.body.replace(PLACEHOLDER, `[img=right]${cover}[/img]`)
                : block.body;
            body = body.replace(/\r\n|\r|\n/g, eol);
            additions.push({ ...key, body, title: block.title,
                matched: Boolean(cover && hasPlaceholder), missing: !cover && hasPlaceholder });
        }
        additions.sort((a, b) => a.date.localeCompare(b.date));
        if (!additions.length) return { text: original, added: 0, covers: 0, missing: [] };

        const hasDatedOriginals = existing.filter(block => identity(block));
        if (!hasDatedOriginals.length) throw new Error('No dated releases found in the original post.');
        if (hasDatedOriginals.some((block, i) => i > 0 &&
                identity(hasDatedOriginals[i - 1]).date > identity(block).date)) {
            throw new Error('Original releases are not in chronological order. No changes made.');
        }

        // Append fragments from ORIGINAL verbatim, only adding new blocks at release boundaries.
        // This preserves the entirety of each old release and all pre-existing links.
        const segments = [];
        let offset = 0;
        let inserted = 0;
        for (const block of hasDatedOriginals) {
            segments.push(original.slice(offset, block.start));
            while (inserted < additions.length && additions[inserted].date < identity(block).date) {
                segments.push(additions[inserted].body, eol, eol);
                inserted++;
            }
            segments.push(original.slice(block.start, block.end));
            offset = block.end;
        }
        // Newer releases belong after the last existing release but before any original footer.
        while (inserted < additions.length) {
            segments.push(eol, eol, additions[inserted].body);
            inserted++;
        }
        segments.push(original.slice(offset));
        const merged = segments.join('');
        const resultBlocks = parseTopLevelSpoilers(merged);
        for (const originalBlock of existing) {
            if (!resultBlocks.some(current => current.body === originalBlock.body)) {
                throw new Error(`Safety check failed: original block changed (${originalBlock.title}).`);
            }
        }
        if (resultBlocks.length !== existing.length + additions.length) {
            throw new Error('Safety check failed: release count mismatch.');
        }
        return { text: merged, added: additions.length,
            covers: additions.filter(item => item.matched).length,
            missing: additions.filter(item => item.missing).map(item => item.title) };
    }

    function getSessionUrls(value) {
        const urls = [...new Set(value.split(/[\s,]+/).map(s => s.trim()).filter(Boolean))];
        if (!urls.length) throw new Error('Enter at least one FastPic session URL.');
        for (const url of urls) {
            let parsed;
            try { parsed = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
            if (parsed.protocol !== 'https:' || !['fastpic.org', 'www.fastpic.org'].includes(parsed.hostname) ||
                !/^\/session\/\d{4}\/\d{4}\/[A-Za-z0-9]+\.html$/.test(parsed.pathname)) {
                throw new Error(`Not a FastPic session URL: ${url}`);
            }
        }
        return urls;
    }

    function fetchFastpic(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({ method: 'GET', url, timeout: 30000,
                onload: response => response.status >= 200 && response.status < 300
                    ? resolve(response.responseText)
                    : reject(new Error(`FastPic returned HTTP ${response.status}: ${url}`)),
                ontimeout: () => reject(new Error(`FastPic request timed out: ${url}`)),
                onerror: () => reject(new Error(`Cannot load FastPic session: ${url}`)) });
        });
    }

    function fetchAllCovers(urls) {
        return Promise.all(urls.map(fetchFastpic)).then(pages => {
            const all = new Map();
            pages.forEach((page, index) => {
                const links = parseFastpicHtml(page);
                if (!links.size) throw new Error(`No labeled covers on session page ${index + 1}.`);
                for (const [catalog, url] of links) {
                    const current = all.get(catalog);
                    if (current && current !== url) {
                        throw new Error(`Conflicting covers for catalog ${catalog}.`);
                    }
                    all.set(catalog, url);
                }
            });
            return all;
        });
    }


    function createUi(textarea) {
        const wrapper = document.createElement('div');
        wrapper.id = 'rdl-tools';
        wrapper.dataset.rutrackerDigitalReleaseLinker = '1';
        wrapper.innerHTML = "<style>\n#rdl-tools{box-sizing:border-box;color:#eceef2;background:#202229;border:1px solid #434853;border-radius:7px;margin:6px 0;max-width:940px;font:12px/1.4 system-ui,Segoe UI,sans-serif}\n#rdl-tools *{box-sizing:border-box}\n#rdl-tools [hidden]{display:none!important}\n#rdl-tools .rdl-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:7px}\n#rdl-tools button{font:inherit;border:1px solid #555c6a;background:#343b46;color:#f3f4f6;border-radius:5px;min-height:32px;padding:5px 10px;cursor:pointer}\n#rdl-tools button:hover:not(:disabled){background:#475466}\n#rdl-tools button:focus-visible,#rdl-tools textarea:focus-visible{outline:2px solid #9ac1ff;outline-offset:2px}\n#rdl-tools button:disabled{opacity:.48;cursor:progress}\n#rdl-tools .rdl-primary{background:#315d94;border-color:#5284bf}\n#rdl-tools .rdl-primary:hover:not(:disabled){background:#3b72b5}\n#rdl-tools .rdl-current[aria-expanded=\"true\"]{background:#364962;border-color:#799ac4}\n#rdl-tools .rdl-status{min-width:0;flex:1 1 200px;overflow-wrap:anywhere}\n#rdl-tools .rdl-panel{display:grid;gap:7px;padding:4px 8px 9px;border-top:1px solid #3e434b}\n#rdl-tools .rdl-label{display:block;margin-bottom:3px;font-weight:600}\n#rdl-tools textarea{display:block;width:100%;background:#171a20;color:#f1f3f5;border:1px solid #535b67;border-radius:5px;padding:7px;font:12px/1.4 Consolas,monospace;resize:vertical}\n#rdl-tools .rdl-footer{display:flex;align-items:center;gap:8px}\n#rdl-tools details{margin:0 8px 7px;font-size:12px}\n#rdl-tools summary{cursor:pointer;font-weight:600}\n#rdl-tools .rdl-missing{white-space:pre-wrap;margin:5px 0 0 10px;max-height:180px;overflow:auto}\n#rdl-tools .rdl-error{color:#ffa39c}\n@media(max-width:600px){#rdl-tools .rdl-bar{align-items:stretch}#rdl-tools .rdl-bar button{flex:1 1 auto}#rdl-tools .rdl-status{flex-basis:100%}}\n</style>\n<div class=\"rdl-bar\">\n<button type=\"button\" class=\"rdl-normal\" title=\"Fill missing digital release links without changing artwork.\">Link digital release pages</button>\n<button type=\"button\" class=\"rdl-force\" title=\"Search Deezer for every WEB release without changing artwork.\">Force link all web releases</button>\n<button type=\"button\" class=\"rdl-current\" aria-expanded=\"false\" aria-controls=\"rdl-merge-fields\">Add new releases</button>\n<button type=\"button\" class=\"rdl-undo\" hidden>Undo</button>\n<span class=\"rdl-status\" role=\"status\" aria-live=\"polite\"></span>\n</div>\n<div id=\"rdl-merge-fields\" class=\"rdl-panel\" hidden>\n<label><span class=\"rdl-label\">Updated BBCode</span><textarea class=\"rdl-updated\" rows=\"7\" spellcheck=\"false\" placeholder=\"Paste updated discography\"></textarea></label>\n<label><span class=\"rdl-label\">FastPic session URLs</span><textarea class=\"rdl-sessions\" rows=\"2\" spellcheck=\"false\" placeholder=\"https://fastpic.org/session/...\"></textarea></label>\n<div class=\"rdl-footer\"><button type=\"button\" class=\"rdl-primary rdl-insert\">Insert new releases</button></div>\n</div>\n<details class=\"rdl-not-found\" hidden><summary class=\"rdl-not-found-summary\"></summary><div class=\"rdl-missing\"></div></details>";
        textarea.parentNode.insertBefore(wrapper, textarea);
        const get = (selector) => wrapper.querySelector(selector);
        const ui = {
            wrapper, button: get('.rdl-normal'), forceButton: get('.rdl-force'),
            toggleButton: get('.rdl-current'), undoButton: get('.rdl-undo'),
            status: get('.rdl-status'), mergePanel: get('.rdl-panel'),
            updatedInput: get('.rdl-updated'), sessionsInput: get('.rdl-sessions'),
            mergeButton: get('.rdl-insert'), notFoundDetails: get('.rdl-not-found'),
            notFoundSummary: get('.rdl-not-found-summary'), notFoundList: get('.rdl-missing'),
            undoSnapshot: null, busy: false
        };
        ui.sessionsInput.value = GM_getValue('discography-merge:sessions', EXAMPLE_SESSIONS);
        ui.toggleButton.addEventListener('click', () => {
            ui.mergePanel.hidden = !ui.mergePanel.hidden;
            ui.toggleButton.setAttribute('aria-expanded', String(!ui.mergePanel.hidden));
            if (!ui.mergePanel.hidden) ui.updatedInput.focus();
        });
        ui.sessionsInput.addEventListener('change', () =>
            GM_setValue('discography-merge:sessions', ui.sessionsInput.value));
        return ui;
    }

    function setStatus(statusNode, text) {
        statusNode.textContent = text;
    }

    function showNotFound(ui, titles, label = 'Not found') {
        if (!titles.length) {
            ui.notFoundDetails.hidden = true;
            ui.notFoundSummary.textContent = '';
            ui.notFoundList.textContent = '';
            return;
        }

        ui.notFoundSummary.textContent = `${label} (${titles.length})`;
        ui.notFoundList.textContent = titles.map((title) => `- ${title}`).join('\n');
        ui.notFoundDetails.hidden = false;
        ui.notFoundDetails.open = true;
    }

    function writePost(textarea, content) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(textarea, content);
        else textarea.value = content;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function applyPostChange(textarea, ui, previous, next) {
        if (previous === next) return;
        ui.undoSnapshot = { before: previous, after: next };
        ui.undoButton.hidden = false;
        writePost(textarea, next);
    }

    function setBusy(ui, state) {
        ui.busy = state;
        for (const control of [ui.button, ui.forceButton, ui.mergeButton, ui.undoButton,
            ui.updatedInput, ui.sessionsInput]) control.disabled = state;
    }

    async function runMerge(textarea, ui) {
        if (ui.busy) return;
        showNotFound(ui, []);
        const original = textarea.value;
        const updated = ui.updatedInput.value;
        try {
            if (!updated.trim()) throw new Error('Paste updated BBCode first.');
            const sessions = ui.sessionsInput.value.trim()
                ? getSessionUrls(ui.sessionsInput.value) : [];
            setBusy(ui, true);
            setStatus(ui.status, 'Loading FastPic covers...');
            const covers = sessions.length ? await fetchAllCovers(sessions) : new Map();
            const result = mergeDiscography(original, updated, covers);
            if (textarea.value !== original)
                throw new Error('The post changed during the merge. Retry.');
            if (result.added) applyPostChange(textarea, ui, original, result.text);
            GM_setValue('discography-merge:sessions', ui.sessionsInput.value);
            ui.status.classList.remove('rdl-error');
            setStatus(ui.status, result.added
                ? 'Added ' + result.added + ' | Covers ' + result.covers +
                    ' | Missing ' + result.missing.length
                : 'No new releases.');
            showNotFound(ui, result.missing, 'Missing covers');
        } catch (error) {
            ui.status.classList.add('rdl-error');
            setStatus(ui.status, error.message || String(error));
        } finally {
            setBusy(ui, false);
        }
    }

    async function runLinker(textarea, ui, { forceWeb = false } = {}) {
        if (ui.busy) return;
        const originalText = textarea.value;
        ui.status.classList.remove('rdl-error');
        showNotFound(ui, []);
        const countryResult = addCountryFlags(originalText);
        const workingText = countryResult.text;
        const topicArtist = getTopicArtist(workingText);
        const spoilers = findSpoilers(workingText);
        const candidates = [];
        let alreadyLinked = 0;

        for (const spoiler of spoilers) {
            const found = forceWeb ? findForceWebMatch(spoiler.ownText) : findProviderMatch(spoiler.ownText);
            if (!found) continue;

            const currentUrl = found.provider.getCurrentUrl(found.match);
            if (!forceWeb && currentUrl && found.provider.isReleaseUrl(currentUrl)) {
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
            if (textarea.value !== originalText) {
                setStatus(ui.status, 'The post changed during scanning. Retry.');
                return;
            }
            applyPostChange(textarea, ui, originalText, workingText);

            const parts = [];
            if (countryResult.changed) parts.push(`country flags: ${countryResult.changed}`);
            if (alreadyLinked) parts.push(`already linked: ${alreadyLinked}`);
            setStatus(ui.status, parts.length ? parts.join(' | ') : (forceWeb ? 'No WEB releases found.' : 'Nothing to link.'));
            return;
        }

        setBusy(ui, true);
        let finished = 0;
        const stage = forceWeb ? 'Searching Deezer for WEB releases' : 'Resolving';
        setStatus(ui.status, `${stage} 0/${candidates.length}...`);

        try {
            const results = await mapLimit(candidates, CONCURRENCY, async (candidate) => {
                let resolution = null;
                let error = null;

                try {
                    resolution = await candidate.provider.resolve({
                        meta: candidate.meta,
                        currentUrl: candidate.currentUrl,
                        topicArtist,
                        blockText: candidate.spoiler.fullText,
                    });
                } catch (caught) {
                    error = caught;
                    console.error(`[${SCRIPT_NAME}]`, candidate.meta.spoilerTitle, caught);
                }

                // Reuse an existing Deezer album URL if no lookup match was found.
                // Only normalize that URL; do not invent a replacement release.
                if (forceWeb && !resolution?.url) {
                    const existing = candidate.currentUrl.match(
                        /^https?:\/\/(?:www\.)?deezer\.com\/(?:[^/]+\/)?album\/(\d+)(?:[/?#]|$)/i,
                    );
                    if (existing) {
                        resolution = {
                            kind: 'deezer',
                            url: `https://www.deezer.com/album/${existing[1]}`,
                        };
                    }
                }

                finished += 1;
                setStatus(ui.status, `${stage} ${finished}/${candidates.length}...`);
                return { candidate, resolution, error };
            });

            const replacements = [];
            const notFoundTitles = [];
            let linked = 0;
            let alreadyCorrect = 0;
            let beatportFallbacks = 0;

            for (const result of results) {
                if (!result.resolution?.url) {
                    notFoundTitles.push(result.candidate.meta.spoilerTitle);
                    console.warn(`[${SCRIPT_NAME}] Release not resolved: ${result.candidate.meta.spoilerTitle}`);
                    continue;
                }

                const { candidate } = result;
                const sourceMatch = candidate.sourceMatch;
                const replacementSource = candidate.provider.makeLinkedSource(
                    sourceMatch,
                    result.resolution,
                );

                if (replacementSource !== sourceMatch[0]) {
                    const sourceStart = candidate.spoiler.start + sourceMatch.index;
                    replacements.push({
                        start: sourceStart,
                        end: sourceStart + sourceMatch[0].length,
                        text: replacementSource,
                    });
                    linked += 1;
                    if (result.resolution.kind === 'beatport') beatportFallbacks += 1;
                } else if (forceWeb) {
                    alreadyCorrect += 1;
                }
            }

            replacements.sort((a, b) => b.start - a.start);
            let updatedText = workingText;
            for (const replacement of replacements) {
                updatedText = updatedText.slice(0, replacement.start) + replacement.text + updatedText.slice(replacement.end);
            }

            if (textarea.value !== originalText)
                throw new Error('The post changed during scanning. Retry.');
            applyPostChange(textarea, ui, originalText, updatedText);

            const parts = [`${forceWeb ? 'Deezer links updated' : 'Linked'}: ${linked}`];
            if (forceWeb) parts.push(`WEB searched: ${candidates.length}`);
            if (alreadyCorrect) parts.push(`already correct: ${alreadyCorrect}`);
            if (beatportFallbacks) parts.push(`Beatport fallback: ${beatportFallbacks}`);
            if (countryResult.changed) parts.push(`country flags: ${countryResult.changed}`);
            if (alreadyLinked) parts.push(`already linked: ${alreadyLinked}`);
            if (notFoundTitles.length) parts.push(`not found: ${notFoundTitles.length}`);
            setStatus(ui.status, parts.join(' | '));
            showNotFound(ui, notFoundTitles);
        } catch (error) {
            ui.status.classList.add('rdl-error');
            setStatus(ui.status, error.message || String(error));
        } finally {
            setBusy(ui, false);
        }
    }

    function init() {
        const url = new URL(location.href);
        if (url.searchParams.get('mode') !== 'editpost') return;
        const textarea = document.querySelector('textarea[name="message"], textarea#message');
        if (!textarea || document.querySelector('[data-rutracker-digital-release-linker]')) return;
        const ui = createUi(textarea);
        ui.button.addEventListener('click', () => runLinker(textarea, ui));
        ui.forceButton.addEventListener('click', () => runLinker(textarea, ui, { forceWeb: true }));
        ui.mergeButton.addEventListener('click', () => runMerge(textarea, ui));
        ui.undoButton.addEventListener('click', () => {
            if (!ui.undoSnapshot || ui.busy) return;
            if (textarea.value !== ui.undoSnapshot.after) {
                ui.status.classList.add('rdl-error');
                setStatus(ui.status, 'The post changed since the last action. Undo cancelled.');
                return;
            }
            const previous = ui.undoSnapshot.before;
            ui.undoSnapshot = null;
            ui.undoButton.hidden = true;
            writePost(textarea, previous);
            showNotFound(ui, []);
            ui.status.classList.remove('rdl-error');
            setStatus(ui.status, 'Last change undone.');
        });
    }

    init();
})();