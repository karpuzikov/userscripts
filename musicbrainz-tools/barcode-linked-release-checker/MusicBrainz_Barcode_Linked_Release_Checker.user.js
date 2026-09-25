// ==UserScript==
// @name         MusicBrainz - Barcode vs Linked Releases Checker
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
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
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(() => {
    'use strict';

    const SCRIPT_NAME = 'MusicBrainz - Barcode vs Linked Releases Checker';
    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/barcode-linked-release-checker/MusicBrainz_Barcode_Linked_Release_Checker.user.js';
    const HARMONY_URL = 'https://harmony.pulsewidth.org.uk/';
    const TASK_PREFIX = 'mb-barcode-link-checker:';

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
        const lookupUrl = `${HARMONY_URL}release?gtin=${encodeURIComponent(barcode)}&category=default`;
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

        await Promise.all(Array.from({ length: Math.min(concurren