// ==UserScript==
// @name         MusicBrainz - Barcode vs Linked Releases Checker
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.2.1
// @description  Checks Digital Media release barcodes against linked provider release pages through Harmony and stages MusicBrainz correction edits.
// @author       karpuzikov
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/barcode-linked-release-checker/MusicBrainz_Barcode_Linked_Release_Checker.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/barcode-linked-release-checker/MusicBrainz_Barcode_Linked_Release_Checker.user.js
// @supportURL   https://github.com/karpuzikov/userscripts
// @match        https://musicbrainz.org/release-group/*
// @match        https://beta.musicbrainz.org/release-group/*
// @match        https://musicbrainz.org/release/*/edit*
// @match        https://beta.musicbrainz.org/release/*/edit*
// @connect      harmony.pulsewidth.org.uk
// @connect      music.apple.com
// @connect      amp-api.music.apple.com
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(() => {
    'use strict';

    const SCRIPT_NAME = 'MusicBrainz - Barcode vs Linked Releases Checker';
    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/barcode-linked-release-checker/MusicBrainz_Barcode_Linked_Release_Checker.user.js';
    const HARMONY_URL = 'https://harmony.pulsewidth.org.uk/';
    const APPLE_API_BASE = 'https://amp-api.music.apple.com/v1';
    const TASK_PREFIX = 'mb-barcode-link-checker:';
    let appleTokenPromise = null;

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

    const PROVIDER_LABELS = {
        spotify: 'Spotify',
        deezer: 'Deezer',
        tidal: 'TIDAL',
        apple: 'Apple Music/iTunes',
        qobuz: 'Qobuz',
        beatport: 'Beatport',
        bandcamp: 'Bandcamp',
        discogs: 'Discogs',
        mora: 'Mora',
        ototoy: 'OTOTOY',
        bugs: 'Bugs!',
        melon: 'Melon',
    };

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function normalizeSpace(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function extractMbid(value) {
        return String(value || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0]?.toLowerCase() || '';
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

    function gtinChecksum(value) {
        const digits = String(value).split('').map(Number);
        const length = digits.length;
        return digits.reduce(
            (sum, digit, index) => sum + digit * ((length - index) % 2 ? 1 : 3),
            0,
        );
    }

    function isValidGtin(value) {
        const gtin = String(value || '');
        return /^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin) &&
            gtinChecksum(gtin) % 10 === 0;
    }

    function qobuzNormalizedGtin(value) {
        const gtin = String(value || '');
        if (isValidGtin(gtin)) return gtin;

        // Harmony/Qobuz compatibility: some older 13-digit Qobuz IDs omit
        // the GTIN-14 check digit. Append it only when that produces a valid GTIN.
        if (/^\d{13}$/.test(gtin)) {
            const provisional = `${gtin}0`;
            const checkDigit = (10 - (gtinChecksum(provisional) % 10)) % 10;
            const normalized = `${gtin}${checkDigit}`;
            if (isValidGtin(normalized)) return normalized;
        }

        return '';
    }

    function extractGtinFromProviderUrl(value) {
        let url;
        try {
            url = value instanceof URL ? value : new URL(value);
        } catch {
            return '';
        }

        const family = providerFamily(url);
        const parts = url.pathname.split('/').filter(Boolean);

        if (family === 'mora') {
            // Example:
            // /package/43000174/093624949107_48/
            // 093624949107 = UPC, _48 = Mora Hi-Res package suffix.
            const packageId = parts.at(-1) || '';
            const candidate = packageId.match(/^(\d{8}|\d{12}|\d{13}|\d{14})(?:_[^/]+)?$/)?.[1] || '';
            return isValidGtin(candidate) ? candidate : '';
        }

        if (family === 'qobuz') {
            // Many Qobuz album URLs use the barcode itself as the final album ID.
            // Example: /album/.../0093624447061
            const candidate = parts.at(-1) || '';
            if (!/^\d{8,14}$/.test(candidate)) return '';
            return qobuzNormalizedGtin(candidate);
        }

        return '';
    }

    function lookupUrlEmbeddedGtin(url) {
        const gtin = extractGtinFromProviderUrl(url);
        if (!gtin) return null;

        return {
            sourceUrl: url,
            provider: providerFamily(url),
            found: true,
            gtin,
            externalLinks: [{
                url,
                types: providerFamily(url) === 'mora'
                    ? ['paid download']
                    : ['paid streaming', 'paid download'],
            }],
            providers: [providerLabel(url)],
            errors: [],
            lookupUrl: url,
            state: 'ok',
            method: 'url-embedded-gtin',
        };
    }

    function providerFamily(value) {
        let url;
        try {
            url = value instanceof URL ? value : new URL(value);
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
        if (host === 'mora.jp') return 'mora';
        if (host === 'ototoy.jp') return 'ototoy';
        if (host === 'bugs.co.kr' || host.endsWith('.bugs.co.kr')) return 'bugs';
        if (host === 'melon.com' || host.endsWith('.melon.com')) return 'melon';
        return '';
    }

    function providerLabel(url) {
        const family = providerFamily(url);
        return PROVIDER_LABELS[family] || family || 'Provider';
    }

    function providerEntityKey(value) {
        let url;
        try {
            url = value instanceof URL ? value : new URL(value);
        } catch {
            return String(value || '');
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

        const clean = new URL(url.href);
        clean.hash = '';
        clean.search = '';
        clean.hostname = clean.hostname.toLowerCase().replace(/^www\./, '');
        clean.pathname = clean.pathname.replace(/\/+$/, '');
        return `${family || clean.hostname}:${clean.href.toLowerCase()}`;
    }

    function isDigitalRelease(release) {
        return Array.isArray(release.media) &&
            release.media.length > 0 &&
            release.media.every(medium => medium?.format === 'Digital Media');
    }

    function releaseRelations(release) {
        return (release.relations || [])
            .filter(rel => rel?.['target-type'] === 'url' && !rel?.ended && rel?.url?.resource)
            .map(rel => rel.url.resource);
    }

    function gmTextRequest(url, { headers = {}, timeout = 60000 } = {}) {
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

    function parseAppleAlbumUrl(value) {
        let url;
        try {
            url = new URL(value);
        } catch {
            return null;
        }

        if (providerFamily(url) !== 'apple') return null;

        // Always use the regular music.apple.com host for token extraction.
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

    async function lookupAppleByUrl(url) {
        const parsedUrl = parseAppleAlbumUrl(url);
        const lookupUrl = parsedUrl
            ? `${APPLE_API_BASE}/catalog/${parsedUrl.storefront}/albums/${parsedUrl.id}`
            : '';

        if (!parsedUrl) {
            return {
                sourceUrl: url,
                provider: 'apple',
                found: false,
                gtin: '',
                externalLinks: [],
                providers: ['Apple Music'],
                errors: ['Unsupported Apple Music album URL'],
                lookupUrl,
                state: 'failed',
            };
        }

        try {
            const json = await appleApiRequest(lookupUrl, parsedUrl.pageUrl);
            const album = (json.data || []).find(item => item.type === 'albums') || json.data?.[0];
            const gtin = album?.attributes?.upc || '';
            const releaseUrl = album?.attributes?.url || parsedUrl.pageUrl;

            return {
                sourceUrl: url,
                provider: 'apple',
                found: Boolean(album),
                gtin,
                externalLinks: album ? [{ url: releaseUrl, types: ['paid streaming'] }] : [],
                providers: ['Apple Music'],
                errors: [],
                lookupUrl,
                state: gtin ? 'ok' : (album ? 'no-gtin' : 'failed'),
            };
        } catch (error) {
            return {
                sourceUrl: url,
                provider: 'apple',
                found: false,
                gtin: '',
                externalLinks: [],
                providers: ['Apple Music'],
                errors: [error.message],
                lookupUrl,
                state: 'failed',
            };
        }
    }

    async function lookupAppleByBarcode(barcode, seedUrl = 'https://music.apple.com/us/browse') {
        const seed = parseAppleAlbumUrl(seedUrl);
        const storefronts = [...new Set([
            seed?.storefront,
            'us',
            'gb',
            'de',
            'jp',
        ].filter(Boolean))];

        const lookupUrls = [];
        let lastError = null;

        for (const storefront of storefronts) {
            const url = new URL(`${APPLE_API_BASE}/catalog/${storefront}/albums`);
            url.searchParams.set('filter[upc]', barcode);
            lookupUrls.push(url.href);

            try {
                const json = await appleApiRequest(url.href, seed?.pageUrl || seedUrl);
                const albums = (json.data || []).filter(item => item.type === 'albums');
                const album = albums.find(item => equalGtin(item.attributes?.upc, barcode)) || albums[0];
                if (!album) continue;

                return {
                    found: true,
                    gtin: album.attributes?.upc || barcode,
                    externalLinks: album.attributes?.url
                        ? [{ url: album.attributes.url, types: ['paid streaming'] }]
                        : [],
                    providers: ['Apple Music'],
                    errors: [],
                    lookupUrl: url.href,
                    lookupUrls,
                };
            } catch (error) {
                lastError = error;
            }
        }

        return {
            found: false,
            gtin: '',
            externalLinks: [],
            providers: ['Apple Music'],
            errors: lastError ? [lastError.message] : [],
            lookupUrl: lookupUrls[0] || '',
            lookupUrls,
        };
    }

    async function lookupLinkedUrl(url) {
        const embedded = lookupUrlEmbeddedGtin(url);
        if (embedded) return embedded;

        return providerFamily(url) === 'apple'
            ? lookupAppleByUrl(url)
            : lookupHarmonyByUrl(url);
    }

    async function lookupByBarcode(barcode, appleSeedUrl) {
        const harmony = await lookupHarmonyByBarcode(barcode);
        harmony.externalLinks = (harmony.externalLinks || [])
            .filter(link => providerFamily(link.url) !== 'apple');

        const apple = await lookupAppleByBarcode(barcode, appleSeedUrl);

        return {
            found: Boolean(harmony.found || apple.found),
            gtin: harmony.gtin || apple.gtin || '',
            externalLinks: dedupeExternalLinks([
                ...(harmony.externalLinks || []),
                ...(apple.externalLinks || []),
            ]),
            providers: [...new Set([
                ...(harmony.providers || []),
                ...(apple.providers || []),
            ])],
            errors: [...(harmony.errors || []), ...(apple.errors || [])],
            lookupUrl: [harmony.lookupUrl, apple.lookupUrl].filter(Boolean).join(' | '),
            lookupUrls: [
                harmony.lookupUrl,
                ...(apple.lookupUrls || [apple.lookupUrl]),
            ].filter(Boolean),
        };
    }

    function harmonyRequest(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers: { Accept: 'text/html,application/xhtml+xml' },
                timeout: 60000,
                onload(response) {
                    if (response.status >= 200 && response.status < 400) {
                        resolve({ html: response.responseText, finalUrl: response.finalUrl || url });
                    } else {
                        reject(new Error(`Harmony HTTP ${response.status}`));
                    }
                },
                ontimeout() {
                    reject(new Error('Harmony request timed out'));
                },
                onerror() {
                    reject(new Error('Harmony request failed'));
                },
            });
        });
    }

    function findReleaseInfoRow(doc, label) {
        const wanted = label.toLowerCase();
        return [...doc.querySelectorAll('table.release-info tr')].find(row => {
            const th = row.querySelector('th');
            return th && normalizeSpace(th.textContent).toLowerCase() === wanted;
        });
    }

    function parseHarmony(html, lookupUrl) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const release = doc.querySelector('.release');
        const gtinRow = findReleaseInfoRow(doc, 'GTIN');
        const linksRow = findReleaseInfoRow(doc, 'External links');
        const errors = [...doc.querySelectorAll('.message-box.error, .error-message, .page-error')]
            .map(node => normalizeSpace(node.textContent))
            .filter(Boolean);

        let gtin = '';
        if (gtinRow) {
            const text = normalizeSpace(gtinRow.querySelector('td')?.textContent || '');
            gtin = text.match(/\b(?:\d{14}|\d{13}|\d{12}|\d{8})\b/)?.[0] || '';
        }

        const externalLinks = [];
        if (linksRow) {
            for (const item of linksRow.querySelectorAll('li')) {
                const anchor = item.querySelector('a[href]');
                if (!anchor) continue;
                const labels = [...item.querySelectorAll('.label')]
                    .map(node => normalizeSpace(node.textContent).toLowerCase())
                    .filter(Boolean);
                externalLinks.push({
                    url: anchor.href,
                    types: labels,
                });
            }
        }

        const providers = [...doc.querySelectorAll('.provider-list li[data-provider]')]
            .map(node => node.dataset.provider || normalizeSpace(node.textContent).split(':')[0])
            .filter(Boolean);

        return {
            found: Boolean(release || gtinRow || linksRow),
            gtin,
            externalLinks,
            providers,
            errors,
            lookupUrl,
        };
    }

    async function lookupHarmonyByUrl(url) {
        const lookupUrl = `${HARMONY_URL}release?url=${encodeURIComponent(url)}`;
        try {
            const response = await harmonyRequest(lookupUrl);
            const parsed = parseHarmony(response.html, lookupUrl);
            return {
                sourceUrl: url,
                provider: providerFamily(url),
                ...parsed,
                state: parsed.gtin ? 'ok' : (parsed.found ? 'no-gtin' : 'failed'),
            };
        } catch (error) {
            return {
                sourceUrl: url,
                provider: providerFamily(url),
                found: false,
                gtin: '',
                externalLinks: [],
                providers: [],
                errors: [error.message],
                lookupUrl,
                state: 'failed',
            };
        }
    }

    async function lookupHarmonyByBarcode(barcode) {
        const lookupUrl = `${HARMONY_URL}release?gtin=${encodeURIComponent(barcode)}&category=digital`;
        try {
            const response = await harmonyRequest(lookupUrl);
            const parsed = parseHarmony(response.html, lookupUrl);
            parsed.externalLinks = parsed.externalLinks.filter(link => providerFamily(link.url));
            return parsed;
        } catch (error) {
            return {
                found: false,
                gtin: '',
                externalLinks: [],
                providers: [],
                errors: [error.message],
                lookupUrl,
            };
        }
    }

    async function mapPool(items, concurrency, worker) {
        const results = new Array(items.length);
        let next = 0;

        async function run() {
            while (true) {
                const index = next++;
                if (index >= items.length) return;
                results[index] = await worker(items[index], index);
            }
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, run));
        return results;
    }

    async function fetchReleaseGroupReleases(releaseGroupMbid) {
        const releases = [];
        let offset = 0;
        const limit = 100;

        while (true) {
            const url = `/ws/2/release?release-group=${encodeURIComponent(releaseGroupMbid)}` +
                `&inc=media+url-rels&fmt=json&limit=${limit}&offset=${offset}`;
            const response = await fetch(url, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            });
            if (!response.ok) throw new Error(`MusicBrainz API HTTP ${response.status}`);

            const data = await response.json();
            const page = data.releases || [];
            releases.push(...page);

            if (releases.length >= Number(data['release-count'] || releases.length) || page.length < limit) break;
            offset += limit;
            await sleep(1100);
        }

        return releases;
    }

    function dedupeExternalLinks(links) {
        const map = new Map();
        for (const link of links || []) {
            if (!providerFamily(link.url)) continue;
            const key = providerEntityKey(link.url);
            if (!map.has(key)) {
                map.set(key, { url: link.url, types: [...new Set(link.types || [])] });
            } else {
                const existing = map.get(key);
                existing.types = [...new Set([...existing.types, ...(link.types || [])])];
            }
        }
        return [...map.values()];
    }

    function selectReverseLinks(reverse, existingUrls, wantedFamilies = null) {
        const existingKeys = new Set(existingUrls.map(providerEntityKey));
        return dedupeExternalLinks(reverse?.externalLinks || []).filter(link => {
            if (existingKeys.has(providerEntityKey(link.url))) return false;
            if (wantedFamilies && !wantedFamilies.has(providerFamily(link.url))) return false;
            return true;
        });
    }

    function uniqueGtinGroups(checks) {
        const groups = [];
        for (const check of checks.filter(item => item.gtin)) {
            let group = groups.find(item => equalGtin(item.gtin, check.gtin));
            if (!group) {
                group = { gtin: check.gtin, checks: [] };
                groups.push(group);
            }
            group.checks.push(check);
        }
        return groups;
    }

    function buildCorrection(release, checks, reverse) {
        const mbBarcode = release.barcode;
        const existingUrls = releaseRelations(release);
        const successful = checks.filter(check => check.gtin);
        const matches = successful.filter(check => equalGtin(check.gtin, mbBarcode));
        const mismatches = successful.filter(check => !equalGtin(check.gtin, mbBarcode));
        const unreadable = checks.filter(check => !check.gtin);
        const gtinGroups = uniqueGtinGroups(successful);
        const reverseLinks = dedupeExternalLinks(reverse?.externalLinks || []);
        const correction = {
            mbid: release.id,
            title: release.title,
            oldBarcode: mbBarcode,
            newBarcode: '',
            addLinks: [],
            removeUrls: [],
            reasons: [],
            notes: [],
            evidence: checks,
            reverse,
            ambiguous: false,
        };

        if (!checks.length) {
            correction.addLinks = selectReverseLinks(reverse, existingUrls);
            if (correction.addLinks.length) {
                correction.reasons.push(`No supported linked release pages were present; found ${correction.addLinks.length} link(s) by barcode ${mbBarcode}.`);
            } else {
                correction.notes.push('No supported linked release pages were present, and no provider links were found by barcode.');
            }
            return correction;
        }

        if (!successful.length) {
            correction.addLinks = selectReverseLinks(reverse, existingUrls);
            if (correction.addLinks.length) {
                correction.reasons.push(`Linked pages did not return a usable GTIN; found ${correction.addLinks.length} replacement/additional link(s) by barcode ${mbBarcode}.`);
            } else {
                correction.notes.push('Linked pages did not return a usable GTIN, and no provider links were found by barcode.');
            }
            if (unreadable.length) {
                correction.notes.push('Unreadable/dead links are not removed automatically; MusicBrainz guidance generally prefers ending a formerly-correct dead URL relationship.');
            }
            return correction;
        }

        if (!mismatches.length) {
            if (unreadable.length) {
                const deadFamilies = new Set(unreadable.map(check => check.provider).filter(Boolean));
                correction.addLinks = selectReverseLinks(reverse, existingUrls, deadFamilies);
                if (correction.addLinks.length) {
                    correction.reasons.push(`Some linked pages were unreadable; found ${correction.addLinks.length} same-provider replacement link(s) by barcode.`);
                }
                correction.notes.push('Unreadable/dead links are left in place for manual review/end-date handling.');
            }
            return correction;
        }

        if (matches.length) {
            correction.removeUrls = mismatches.map(check => check.sourceUrl);
            const mismatchFamilies = new Set(mismatches.map(check => check.provider).filter(Boolean));
            correction.addLinks = selectReverseLinks(reverse, existingUrls, mismatchFamilies);
            correction.reasons.push(
                `${matches.length} linked page(s) confirm MusicBrainz barcode ${mbBarcode}; ${mismatches.length} linked page(s) resolve to a different GTIN and are staged for removal.`,
            );
            return correction;
        }

        if (gtinGroups.length === 1) {
            const externalGtin = gtinGroups[0].gtin;
            const distinctProviders = new Set(successful.map(check => check.provider).filter(Boolean));

            if (reverseLinks.length) {
                correction.removeUrls = mismatches.map(check => check.sourceUrl);
                correction.addLinks = selectReverseLinks(reverse, existingUrls);
                correction.reasons.push(
                    `All readable linked pages disagree with MusicBrainz barcode ${mbBarcode}, but the barcode lookup resolves ${mbBarcode} to other provider page(s); current mismatching links are staged for removal and barcode-matched links for addition.`,
                );
                return correction;
            }

            if (distinctProviders.size >= 2) {
                correction.newBarcode = externalGtin;
                correction.reasons.push(
                    `${distinctProviders.size} independent linked providers agree on GTIN ${externalGtin}, while the barcode lookup found no provider pages for MusicBrainz barcode ${mbBarcode}; barcode ${externalGtin} is staged.`,
                );
                return correction;
            }

            correction.ambiguous = true;
            correction.notes.push(
                `The only readable linked provider reports GTIN ${externalGtin}, not ${mbBarcode}. One provider is not enough to choose automatically between a wrong barcode and a wrong link.`,
            );
            return correction;
        }

        correction.ambiguous = true;
        correction.notes.push(
            `Linked providers disagree with each other (${gtinGroups.map(group => group.gtin).join(', ')}) and none confirms MusicBrainz barcode ${mbBarcode}; no automatic edit was prepared.`,
        );
        return correction;
    }

    function reconcileAcrossReleaseGroup(results) {
        const byBarcode = results.filter(result => result.release.barcode);

        const findByGtin = gtin => byBarcode.find(result => equalGtin(result.release.barcode, gtin));

        for (const source of results) {
            for (const check of source.checks || []) {
                if (!check.gtin || equalGtin(check.gtin, source.release.barcode)) continue;

                const target = findByGtin(check.gtin);
                if (!target || target.release.id === source.release.id) continue;

                const sourceCorrection = source.correction;
                const targetCorrection = target.correction;
                const sourceKey = providerEntityKey(check.sourceUrl);

                if (!sourceCorrection.removeUrls.some(url => providerEntityKey(url) === sourceKey)) {
                    sourceCorrection.removeUrls.push(check.sourceUrl);
                }

                const existingTargetUrls = [
                    ...releaseRelations(target.release),
                    ...targetCorrection.addLinks.map(link => link.url),
                ];
                if (!existingTargetUrls.some(url => providerEntityKey(url) === sourceKey)) {
                    const harmonyLink = (check.externalLinks || []).find(
                        link => providerEntityKey(link.url) === sourceKey
                    );
                    targetCorrection.addLinks.push({
                        url: check.sourceUrl,
                        types: harmonyLink?.types || [],
                    });
                }

                const moveReason =
                    `${providerLabel(check.sourceUrl)} resolves to GTIN ${check.gtin}, which matches release ${target.release.id}; move this URL from ${source.release.id} to that release.`;

                if (!sourceCorrection.reasons.includes(moveReason)) {
                    sourceCorrection.reasons.push(moveReason);
                }
                if (!targetCorrection.reasons.includes(moveReason)) {
                    targetCorrection.reasons.push(moveReason);
                }
            }
        }

        for (const result of results) {
            result.correction.addLinks = dedupeExternalLinks(result.correction.addLinks);
            result.correction.removeUrls = [...new Map(
                result.correction.removeUrls.map(url => [providerEntityKey(url), url])
            ).values()];
        }
    }

    function hasCorrection(correction) {
        return Boolean(correction.newBarcode || correction.addLinks.length || correction.removeUrls.length);
    }

    async function checkRelease(release, progress) {
        const allUrls = releaseRelations(release);
        const supportedUrls = [...new Map(
            allUrls
                .filter(providerFamily)
                .map(url => [providerEntityKey(url), url])
        ).values()];

        const checks = await mapPool(supportedUrls, 3, async (url, index) => {
            progress(`Checking ${release.title}: ${index + 1}/${supportedUrls.length} ${providerLabel(url)}`);
            return lookupLinkedUrl(url);
        });

        const successful = checks.filter(check => check.gtin);
        const mismatches = successful.filter(check => !equalGtin(check.gtin, release.barcode));
        const unreadable = checks.filter(check => !check.gtin);
        const needsReverse = supportedUrls.length === 0 || successful.length === 0 || mismatches.length > 0 || unreadable.length > 0;

        let reverse = null;
        if (needsReverse) {
            progress(`Looking up barcode ${release.barcode} across providers...`);
            const appleSeedUrl = supportedUrls.find(url => providerFamily(url) === 'apple');
            reverse = await lookupByBarcode(release.barcode, appleSeedUrl);
        }

        return {
            release,
            allUrls,
            supportedUrls,
            checks,
            correction: buildCorrection(release, checks, reverse),
        };
    }

    function makeEditNote(correction) {
        const lines = [
            'Checked Digital Media release barcode against linked provider release pages using Harmony; Apple Music uses direct Apple Music API barcode data via the ToadKing method.',
            `MusicBrainz release: https://musicbrainz.org/release/${correction.mbid}`,
            `MusicBrainz barcode before check: ${correction.oldBarcode}`,
        ];

        if (correction.evidence.length) {
            lines.push('', 'Linked-page evidence:');
            for (const item of correction.evidence) {
                const sourceMethod = item.method === 'url-embedded-gtin'
                    ? 'barcode extracted directly from provider URL'
                    : item.lookupUrl;
                lines.push(`- ${providerLabel(item.sourceUrl)}: ${item.sourceUrl} -> ${item.gtin || '[no GTIN returned]'} (${sourceMethod})`);
            }
        }

        if (correction.reverse) {
            lines.push('', `Barcode lookup: ${correction.reverse.lookupUrl}`);
        }

        if (correction.reasons.length) {
            lines.push('', 'Prepared correction:');
            for (const reason of correction.reasons) lines.push(`- ${reason}`);
        }

        lines.push('', `Script: ${SCRIPT_URL}`, 'Harmony: https://github.com/kellnerd/harmony', 'Apple Music barcode method: https://github.com/ToadKing/apple-music-barcode-isrc');
        return lines.join('\n');
    }

    function flattenSeedLinks(links) {
        const output = [];
        for (const link of links) {
            const typeIds = [...new Set((link.types || []).map(type => RELEASE_LINK_TYPE_IDS.get(type)).filter(Boolean))];
            if (!typeIds.length) {
                output.push({ url: link.url, linkTypeId: '' });
            } else {
                for (const linkTypeId of typeIds) output.push({ url: link.url, linkTypeId });
            }
        }
        return output;
    }

    function storeTask(correction) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const task = {
            created: Date.now(),
            mbid: correction.mbid,
            removeUrls: correction.removeUrls,
            newBarcode: correction.newBarcode,
            addLinks: correction.addLinks,
            summary: correction.reasons,
        };
        localStorage.setItem(`${TASK_PREFIX}${id}`, JSON.stringify(task));
        return id;
    }

    function openCorrection(correction) {
        if (!hasCorrection(correction)) return;

        const taskId = storeTask(correction);
        const targetName = `mb-barcode-link-check-${correction.mbid}`;
        const form = document.createElement('form');
        form.method = 'post';
        form.target = targetName;
        form.action = `/release/${encodeURIComponent(correction.mbid)}/edit?barcode-link-checker=${encodeURIComponent(taskId)}`;
        form.style.display = 'none';

        const addField = (name, value) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = String(value);
            form.appendChild(input);
        };

        if (correction.newBarcode) addField('barcode', correction.newBarcode);

        const seedLinks = flattenSeedLinks(correction.addLinks);
        seedLinks.forEach((link, index) => {
            addField(`urls.${index}.url`, link.url);
            if (link.linkTypeId) addField(`urls.${index}.link_type`, link.linkTypeId);
        });

        addField('edit_note', makeEditNote(correction));
        document.body.appendChild(form);
        form.submit();
        form.remove();
    }

    function cleanupExpiredTasks() {
        const maxAge = 60 * 60 * 1000;
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!key?.startsWith(TASK_PREFIX)) continue;
            try {
                const task = JSON.parse(localStorage.getItem(key));
                if (!task?.created || Date.now() - task.created > maxAge) localStorage.removeItem(key);
            } catch {
                localStorage.removeItem(key);
            }
        }
    }

    function findExistingUrlRow(url) {
        const wantedKey = providerEntityKey(url);
        const rows = [...document.querySelectorAll('#external-links-editor tr.external-link-item')];
        return rows.find(row => {
            const anchors = [...row.querySelectorAll('a[href]')];
            return anchors.some(anchor => {
                try {
                    return providerEntityKey(anchor.href) === wantedKey;
                } catch {
                    return false;
                }
            });
        }) || null;
    }

    async function waitFor(predicate, timeout = 20000, interval = 250) {
        const started = Date.now();
        while (Date.now() - started < timeout) {
            const value = predicate();
            if (value) return value;
            await sleep(interval);
        }
        return null;
    }

    function showEditBanner(task, removed, missing) {
        const banner = document.createElement('div');
        banner.id = 'mb-barcode-link-checker-edit-banner';
        banner.style.cssText = [
            'margin:10px 0',
            'padding:10px 12px',
            'border:1px solid #b58b00',
            'border-radius:5px',
            'background:#fff7cf',
            'color:#222',
            'font-weight:600',
        ].join(';');

        const parts = ['Barcode/link checker staged this correction. Review every change before submitting.'];
        if (task.newBarcode) parts.push(`Barcode staged: ${task.newBarcode}.`);
        if (task.addLinks?.length) parts.push(`Added link seeds: ${task.addLinks.length}.`);
        if (task.removeUrls?.length) parts.push(`Wrong links removed from editor: ${removed}/${task.removeUrls.length}.`);
        if (missing.length) parts.push(`Could not locate for automatic removal: ${missing.join(', ')}.`);
        banner.textContent = parts.join(' ');

        const editor = document.getElementById('release-editor');
        if (editor?.parentElement) editor.parentElement.insertBefore(banner, editor);
        else document.body.prepend(banner);
    }

    async function applyPendingEditTask() {
        cleanupExpiredTasks();
        const taskId = new URL(location.href).searchParams.get('barcode-link-checker');
        if (!taskId) return false;

        const key = `${TASK_PREFIX}${taskId}`;
        let task;
        try {
            task = JSON.parse(localStorage.getItem(key));
        } catch {
            task = null;
        }
        if (!task) return false;

        await waitFor(() => document.querySelector('#external-links-editor'));
        await waitFor(() => document.querySelectorAll('#external-links-editor tr.external-link-item').length > 0, 20000);

        let removed = 0;
        const missing = [];
        for (const url of task.removeUrls || []) {
            let row = null;
            for (let attempt = 0; attempt < 20 && !row; attempt++) {
                row = findExistingUrlRow(url);
                if (!row) await sleep(250);
            }
            const button = row?.querySelector('button.remove-item');
            if (button) {
                button.click();
                removed++;
                await sleep(100);
            } else {
                missing.push(url);
            }
        }

        localStorage.removeItem(key);
        showEditBanner(task, removed, missing);

        const cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete('barcode-link-checker');
        history.replaceState(null, '', cleanUrl.href);
        return true;
    }

    function resultStatus(result) {
        const correction = result.correction;
        if (hasCorrection(correction)) return 'Correction prepared';
        if (correction.ambiguous) return 'Manual review required';
        const readable = result.checks.filter(check => check.gtin);
        if (readable.length && readable.every(check => equalGtin(check.gtin, result.release.barcode))) return 'OK';
        return correction.notes[0] || 'No correction';
    }

    function resultDetails(result) {
        const rows = [];
        for (const check of result.checks) {
            const status = check.gtin
                ? (equalGtin(check.gtin, result.release.barcode) ? 'MATCH' : 'MISMATCH')
                : (check.state === 'failed' ? 'UNREADABLE' : 'NO GTIN');
            rows.push(`
                <li>
                    <strong>${escapeHtml(providerLabel(check.sourceUrl))}</strong>: 
                    <a href="${escapeHtml(check.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(check.sourceUrl)}</a>
                    -> <code>${escapeHtml(check.gtin || '[none]')}</code> - ${status}
                </li>
            `);
        }
        if (!rows.length) rows.push('<li>No Harmony-supported linked release pages.</li>');
        return rows.join('');
    }

    function showResults(results) {
        document.getElementById('mb-barcode-checker-results')?.remove();
        const corrections = results.filter(result => hasCorrection(result.correction));
        const overlay = document.createElement('div');
        overlay.id = 'mb-barcode-checker-results';
        overlay.innerHTML = `
            <div class="mb-bc-dialog">
                <div class="mb-bc-header">
                    <h2>Barcode vs linked releases</h2>
                    <button type="button" class="mb-bc-close">Close</button>
                </div>
                <p>Only releases whose every medium is <strong>Digital Media</strong> are checked. No MusicBrainz edit is submitted automatically.</p>
                <div class="mb-bc-list">
                    ${results.map((result, index) => {
                        const c = result.correction;
                        return `
                            <section class="mb-bc-release">
                                <h3><a href="/release/${escapeHtml(result.release.id)}" target="_blank">${escapeHtml(result.release.title)}</a></h3>
                                <div><strong>MusicBrainz barcode:</strong> <code>${escapeHtml(result.release.barcode)}</code></div>
                                <div><strong>Status:</strong> ${escapeHtml(resultStatus(result))}</div>
                                <ul>${resultDetails(result)}</ul>
                                ${c.reasons.length ? `<div><strong>Prepared:</strong><ul>${c.reasons.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : ''}
                                ${c.notes.length ? `<div><strong>Notes:</strong><ul>${c.notes.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : ''}
                                ${c.newBarcode ? `<div><strong>New barcode:</strong> <code>${escapeHtml(c.newBarcode)}</code></div>` : ''}
                                ${c.removeUrls.length ? `<div><strong>Remove wrong links:</strong><ul>${c.removeUrls.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : ''}
                                ${c.addLinks.length ? `<div><strong>Add barcode-matched links:</strong><ul>${c.addLinks.map(x => `<li>${escapeHtml(x.url)}</li>`).join('')}</ul></div>` : ''}
                                ${hasCorrection(c) ? `<button type="button" class="mb-bc-open-one positive" data-result-index="${index}">Open correcting edit</button>` : ''}
                            </section>
                        `;
                    }).join('')}
                </div>
                <div class="mb-bc-actions">
                    ${corrections.length ? `<button type="button" class="mb-bc-open-all positive">Open correcting edits (${corrections.length})</button>` : '<strong>No correcting edits are needed/prepared.</strong>'}
                </div>
            </div>
        `;

        const style = document.createElement('style');
        style.textContent = `
            #mb-barcode-checker-results { position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,.55); display:flex; align-items:flex-start; justify-content:center; padding:4vh 18px; overflow:auto; }
            #mb-barcode-checker-results .mb-bc-dialog { background:#fff; color:#222; width:min(980px, 96vw); max-height:92vh; overflow:auto; border-radius:7px; padding:16px; box-shadow:0 12px 40px rgba(0,0,0,.35); }
            #mb-barcode-checker-results .mb-bc-header { display:flex; align-items:center; justify-content:space-between; gap:15px; border-bottom:1px solid #ccc; margin-bottom:12px; }
            #mb-barcode-checker-results .mb-bc-header h2 { margin:0 0 10px; }
            #mb-barcode-checker-results .mb-bc-release { border:1px solid #ccc; border-radius:5px; margin:12px 0; padding:12px; }
            #mb-barcode-checker-results .mb-bc-release h3 { margin:0 0 8px; }
            #mb-barcode-checker-results .mb-bc-release ul { margin:5px 0 8px 20px; }
            #mb-barcode-checker-results .mb-bc-release code { user-select:all; }
            #mb-barcode-checker-results .mb-bc-actions { position:sticky; bottom:0; background:#fff; border-top:1px solid #ccc; padding:12px 0 2px; text-align:right; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);

        overlay.querySelector('.mb-bc-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', event => {
            if (event.target === overlay) overlay.remove();
        });
        for (const button of overlay.querySelectorAll('.mb-bc-open-one')) {
            button.addEventListener('click', () => {
                const result = results[Number(button.dataset.resultIndex)];
                openCorrection(result.correction);
            });
        }
        overlay.querySelector('.mb-bc-open-all')?.addEventListener('click', () => {
            for (const result of corrections) openCorrection(result.correction);
        });
    }

    function setSidebarStatus(text, kind = '') {
        const node = document.getElementById('mb-barcode-checker-status');
        if (!node) return;
        node.textContent = text;
        node.dataset.kind = kind;
    }

    let lastCheckResults = null;

    function updateResultsButton(results) {
        const resultButton = document.getElementById('mb-barcode-checker-results-button');
        if (!resultButton) return;

        lastCheckResults = results;
        const hasProblems = results.some(result =>
            hasCorrection(result.correction) || result.correction.ambiguous
        );

        resultButton.textContent = hasProblems ? '⚠️' : '✅';
        resultButton.title = hasProblems ? 'Open barcode/link check results - review needed' : 'Open barcode/link check results - all passed';
        resultButton.style.display = '';
        resultButton.onclick = () => {
            if (lastCheckResults) showResults(lastCheckResults);
        };
    }

    async function runCheck() {
        const button = document.getElementById('mb-barcode-checker-button');
        const resultButton = document.getElementById('mb-barcode-checker-results-button');
        if (!button) return;
        button.disabled = true;
        if (resultButton) resultButton.style.display = 'none';

        try {
            const rgid = extractMbid(location.pathname);
            if (!rgid) throw new Error('Could not determine release-group MBID.');

            setSidebarStatus('Loading MusicBrainz releases...');
            const releases = await fetchReleaseGroupReleases(rgid);
            const eligible = releases.filter(release => isDigitalRelease(release) && release.barcode);

            if (!eligible.length) {
                setSidebarStatus('No Digital Media releases with barcodes found.', 'ok');
                updateResultsButton([]);
                return;
            }

            const results = [];
            for (let i = 0; i < eligible.length; i++) {
                const release = eligible[i];
                setSidebarStatus(`Checking release ${i + 1}/${eligible.length}: ${release.title}`);
                results.push(await checkRelease(release, message => setSidebarStatus(message)));
            }

            reconcileAcrossReleaseGroup(results);

            const corrections = results.filter(result => hasCorrection(result.correction)).length;
            const ambiguous = results.filter(result => result.correction.ambiguous).length;
            setSidebarStatus(
                `Checked ${eligible.length} Digital Media release(s): ${corrections} correction(s), ${ambiguous} manual review.`,
                corrections || ambiguous ? 'warn' : 'ok',
            );
            updateResultsButton(results);
        } catch (error) {
            console.error(`[${SCRIPT_NAME}]`, error);
            setSidebarStatus(error.message, 'bad');
        } finally {
            button.disabled = false;
        }
    }

    function makeReleaseTableBlock(releaseTable, barcodeHeader) {
        const block = document.createElement('div');
        block.id = 'mb-barcode-checker-block';
        block.innerHTML = `
            <button type="button" id="mb-barcode-checker-button">Check barcodes against links</button>
            <button type="button" id="mb-barcode-checker-results-button" title="Open check results" style="display:none">✅</button>
            <div id="mb-barcode-checker-status"></div>
        `;

        const style = document.createElement('style');
        style.textContent = `
            #mb-barcode-checker-block { margin:0 0 6px 0; box-sizing:border-box; }
            #mb-barcode-checker-button,
            #mb-barcode-checker-results-button { width:100%; box-sizing:border-box; }
            #mb-barcode-checker-results-button { margin-top:4px; font-size:18px; line-height:1.2; cursor:pointer; }
            #mb-barcode-checker-status { margin-top:5px; text-align:left; font-size:90%; line-height:1.3; overflow-wrap:anywhere; }
            #mb-barcode-checker-status[data-kind="bad"] { color:#b00020; }
            #mb-barcode-checker-status[data-kind="warn"] { color:#8a5a00; }
            #mb-barcode-checker-status[data-kind="ok"] { color:#087a28; }
        `;
        document.head.appendChild(style);

        const alignToBarcodeColumn = () => {
            if (!block.isConnected || !releaseTable.isConnected || !barcodeHeader.isConnected) return;
            const headerRect = barcodeHeader.getBoundingClientRect();
            const parentRect = releaseTable.parentElement.getBoundingClientRect();
            block.style.width = `${headerRect.width}px`;
            block.style.marginLeft = `${headerRect.left - parentRect.left}px`;
        };

        block.querySelector('#mb-barcode-checker-button').addEventListener('click', runCheck);
        requestAnimationFrame(alignToBarcodeColumn);
        window.addEventListener('resize', alignToBarcodeColumn, { passive: true });
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(alignToBarcodeColumn).observe(releaseTable);
        }

        return block;
    }

    function insertReleaseGroupButton() {
        if (document.getElementById('mb-barcode-checker-block')) return;

        const releaseTable = [...document.querySelectorAll('table.tbl.mergeable-table')].find(table =>
            [...table.querySelectorAll('thead th')].some(th => /^barcode$/i.test(normalizeSpace(th.textContent)))
        );
        if (!releaseTable) {
            setTimeout(insertReleaseGroupButton, 500);
            return;
        }

        const barcodeHeader = [...releaseTable.querySelectorAll('thead th')]
            .find(th => /^barcode$/i.test(normalizeSpace(th.textContent)));
        if (!barcodeHeader) {
            setTimeout(insertReleaseGroupButton, 500);
            return;
        }

        releaseTable.insertAdjacentElement('beforebegin', makeReleaseTableBlock(releaseTable, barcodeHeader));
    }

    cleanupExpiredTasks();

    if (/^\/release-group\/[0-9a-f-]+/i.test(location.pathname)) {
        insertReleaseGroupButton();
    } else if (/^\/release\/[0-9a-f-]+\/edit\/?$/i.test(location.pathname)) {
        applyPendingEditTask().catch(error => console.error(`[${SCRIPT_NAME}]`, error));
    }
})();
