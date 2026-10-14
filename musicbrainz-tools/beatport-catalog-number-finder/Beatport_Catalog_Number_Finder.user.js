// ==UserScript==
// @name         MusicBrainz - Beatport Catalog Number Finder
// @namespace    https://github.com/karpuzikov/userscripts
// @version      0.1.5
// @description  Find missing digital-release catalog numbers on Beatport and review safe MusicBrainz edits.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/artist/*
// @match        https://beta.musicbrainz.org/artist/*
// @match        https://musicbrainz.org/release/*/edit*
// @match        https://beta.musicbrainz.org/release/*/edit*
// @match        https://www.beatport.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @connect      www.beatport.com
// @connect      beatport.com
// @connect      musicbrainz.org
// @connect      beta.musicbrainz.org
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/beatport-catalog-number-finder/Beatport_Catalog_Number_Finder.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/beatport-catalog-number-finder/Beatport_Catalog_Number_Finder.meta.js
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const NAME = 'Beatport catalog numbers';
    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/beatport-catalog-number-finder/Beatport_Catalog_Number_Finder.user.js';
    const KEY = 'karpuzikov:beatport-catno:pending:v1';
    const BRIDGE = 'karpuzikov:beatport-catno:browser-bridge:v1';
    const IS_BEATPORT = location.hostname === 'www.beatport.com';
    const UUID = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
    const ARTIST = location.pathname.match(/^\/artist\/([a-f\d-]{36})(?:\/|$)/i);
    const EDIT = location.pathname.match(/^\/release\/([a-f\d-]{36})\/edit\/?$/i);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const normalizeBarcode = x => {
        const digits = String(x || '').replace(/\D/g, '');
        if (!/^\d{8,14}$/.test(digits)) return '';
        return digits.replace(/^0{1,3}(?=\d{8,13}$)/, '');
    };
    const sameBarcode = (a, b) => !!normalizeBarcode(a) && normalizeBarcode(a) === normalizeBarcode(b);
    const normalizeCatalog = x => String(x || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const plain = x => String(x ?? '').replace(/\s+/g, ' ').trim();
    // Barcode-equivalent or UPC/EAN/GTIN-shaped numeric catnos are not useful here.
    function isBarcodeCatalog(catalog, upc, barcode) {
        const digits = plain(catalog).normalize('NFKC').replace(/[\s._-]/g, '');
        if (!/^\d{8,14}$/.test(digits)) return false;
        return sameBarcode(digits, upc) || sameBarcode(digits, barcode) ||
            [8, 12, 13, 14].includes(digits.length);
    }
    const isPresent = x => !!plain(x); // [none] is intentional existing data, not an empty field.
    const cancelledError = () => new Error('Scan stopped by user');
    const metadataCache = new Map();
    const searchCache = new Map();
    let lastMbRequest = 0;

    let run = null;

    function parseDelay(value) {
        const text = plain(value);
        if (!text) return 0;
        const n = Number(text);
        if (Number.isFinite(n) && n >= 0) return n * 1000;
        const date = Date.parse(text);
        return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
    }

    async function sleepCancellable(ms, state) {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            if (state?.cancelled) throw cancelledError();
            await wait(Math.min(200, Math.max(1, until - Date.now())));
        }
    }

    async function mbJson(url, state) {
        for (;;) {
            if (state?.cancelled) throw cancelledError();
            await sleepCancellable(Math.max(0, lastMbRequest + 1150 - Date.now()), state);
            lastMbRequest = Date.now();
            const response = await fetch(url, {credentials: 'same-origin', headers: {Accept: 'application/json'}});
            if (response.status === 503) {
                // MusicBrainz project invariant: unlimited 503 retries, honor Retry-After.
                await sleepCancellable(Math.max(5000, parseDelay(response.headers.get('Retry-After'))), state);
                continue;
            }
            if (!response.ok) throw new Error(`MusicBrainz HTTP ${response.status}`);
            return response.json();
        }
    }

    // Browser origin bridge: using Beatport's own loaded web page means we do not
    // mistake the public search box for a UPC lookup or issue blocked GM cross-site GETs.
    // ONE normal Beatport browser tab is opened on explicit user scan and closed afterward.
    function bridgeId() {
        return String(Date.now()) + '-' + Math.random().toString(36).slice(2);
    }

    function bridgeKey(session, field) {
        return BRIDGE + ':' + session + ':' + field;
    }

    async function ensureBeatportTab(state, progress) {
        if (state.bridgeSession) return;
        const session = bridgeId();
        state.bridgeSession = session;
        progress('Opening Beatport browser tab to read release metadata...');
        state.bridgeTab = GM_openInTab('https://www.beatport.com/?bpcnf_worker=' + encodeURIComponent(session), {
            active: true, insert: true, setParent: true,
        });
        const start = Date.now();
        // The Beatport tab may be on a CAPTCHA for an arbitrary duration.
        // Wait for a genuine ready signal; only the Stop scan button cancels.
        while (!state.cancelled) {
            const ready = GM_getValue(bridgeKey(session, 'ready'), null);
            if (ready?.session === session && ready.timestamp >= start) return;
            const phase = GM_getValue(bridgeKey(session, 'status'), null);
            if (phase?.phase === 'challenge' || Date.now() - start > 5000)
                progress('Beatport needs attention: finish the CAPTCHA in its tab. Scan is paused; use Stop scan to cancel.');
            await sleepCancellable(450, state);
        }
        throw cancelledError();
    }

    async function beatportTask(kind, value, state) {
        if (state.cancelled) throw cancelledError();
        if (!state.bridgeSession) throw new Error('Beatport browser tab is not ready');
        const session = state.bridgeSession;
        const requestKey = bridgeKey(session, 'request');
        const replyKey = bridgeKey(session, 'reply');
        const requestId = bridgeId();
        return new Promise((resolve, reject) => {
            let settled = false;
            let listener = null;
            let monitor = null;
            const started = Date.now();
            function finish(error, result) {
                if (settled) return;
                settled = true;
                if (listener !== null) GM_removeValueChangeListener(listener);
                if (monitor !== null) clearInterval(monitor);
                if (state.activeRequest?.id === requestId) state.activeRequest = null;
                if (error) reject(error); else resolve(result);
            }
            listener = GM_addValueChangeListener(replyKey, (_key, _old, reply) => {
                if (!reply || reply.requestId !== requestId) return;
                finish(reply.error ? new Error(reply.error) : null, reply.result);
            });
            // Never time out and advance to another release while a human
            // is still completing a Beatport verification challenge.
            monitor = setInterval(() => {
                if (state.cancelled) return finish(cancelledError());
                const status = GM_getValue(bridgeKey(session, 'status'), null);
                if (status?.requestId === requestId && status.phase === 'challenge')
                    state.progress?.('Beatport CAPTCHA: complete it in the Beatport tab. Scan paused; Stop scan cancels.');
                else if (Date.now() - started > 7000)
                    state.progress?.('Waiting for this Beatport page; the scan will not advance until it responds. Stop scan to cancel.');
            }, 900);
            state.activeRequest = {id: requestId, abort: () => finish(cancelledError())};
            GM_setValue(requestKey, {requestId, kind, value, timestamp: Date.now()});
        });
    }

    function releaseDetailsFromProps(data, expectedId = '') {
        // Same release payload and ID check as the existing Beatport -> MusicBrainz Importer.
        const release = data?.props?.pageProps?.release || data?.pageProps?.release || data?.release;
        if (!release?.id || (expectedId && String(release.id) !== String(expectedId))) return null;
        return {
            id: String(release.id),
            upc: plain(release.upc),
            catalog: plain(release.catalog_number),
            label: plain(typeof release.label === 'string' ? release.label : release.label?.name),
            title: plain(release.name || release.title),
            url: beatportUrl(`https://www.beatport.com/release/${release.slug || 'release'}/${release.id}`),
        };
    }

    async function browserBeatportRequest(kind, value, signal) {
        let url;
        if (kind === 'release') {
            url = beatportUrl(value);
            if (!url) throw new Error('Invalid Beatport release URL');
            // The importer obtains this same Next.js JSON from the build ID on the
            // Beatport page. If available, use structured JSON without HTML scraping.
            const embedded = document.getElementById('__NEXT_DATA__');
            let next;
            try { next = JSON.parse(embedded?.textContent || '{}'); } catch { next = {}; }
            const id = url.match(/\/(\d+)$/)?.[1];
            const match = new URL(url).pathname.match(/^\/release\/([^/]+)\/(\d+)$/);
            if (next.buildId && match) {
                const jsonUrl = `https://www.beatport.com/_next/data/${encodeURIComponent(next.buildId)}/en/release/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}.json?id=${encodeURIComponent(match[2])}`;
                try {
                    const response = await fetch(jsonUrl, {credentials: 'same-origin', signal});
                    if (response.ok) {
                        const json = await response.json();
                        const item = releaseDetailsFromProps(json, id);
                        if (item) {item.url = url; return item;}
                    }
                    if (response.status === 403) throw new Error('Beatport HTTP 403 on release JSON');
                } catch (error) {
                    if (error.name === 'AbortError') throw error;
                    // A changed Next.js build, route, or inaccessible JSON can still
                    // leave the normal browser-rendered release HTML available.
                }
            }
        } else if (kind === 'search') {
            // Search by RELEASE TITLE only. Beatport public search is not a UPC database.
            const term = plain(value);
            if (!term || /^\d{8,14}$/.test(term)) throw new Error('Beatport UPC search is not supported');
            url = 'https://www.beatport.com/search/releases?q=' + encodeURIComponent(term);
        } else {
            throw new Error('Unsupported Beatport browser request');
        }
        const response = await fetch(url, {credentials: 'same-origin', signal, headers: {Accept: 'text/html,application/xhtml+xml'}});
        if (!response.ok) throw new Error(`Beatport HTTP ${response.status}: ${new URL(url).pathname}`);
        const html = await response.text();
        if (kind === 'search') return searchReleaseLinks(html);
        return releaseDetailsFromHtml(html, url.match(/\/(\d+)$/)?.[1]);
    }

    function browserNavigationUrl(request, session) {
        let destination;
        if (request.kind === 'release') destination = beatportUrl(request.value);
        else if (request.kind === 'search' && plain(request.value) && !/^\d{8,14}$/.test(plain(request.value))) {
            destination = 'https://www.beatport.com/search/releases?q=' + encodeURIComponent(plain(request.value));
        }
        if (!destination) return '';
        const url = new URL(destination);
        url.searchParams.set('bpcnf_worker', session);
        url.searchParams.set('bpcnf_request', request.requestId);
        return url.href;
    }

    function beatportChallengeVisible() {
        const path = location.pathname.toLowerCase();
        if (path.includes('/cdn-cgi/challenge') || path.includes('/cdn-cgi/l/chk_')) return true;
        const title = plain(document.title).toLowerCase();
        if (/just a moment|attention required|verify (?:you are|that you are) human|checking your browser|security check/.test(title)) return true;
        if (document.querySelector('#cf-challenge-running, #challenge-form, #challenge-stage, .cf-challenge, .cf-turnstile, iframe[src*="challenges.cloudflare.com"], input[name="cf-turnstile-response"]')) return true;
        const body = plain(document.body?.innerText || '').slice(0, 1200).toLowerCase();
        return /verify (?:you are|that you are) human|checking (?:your browser|if the site connection is secure)|complete the security check|performing security verification/.test(body);
    }

    async function browserLoadedPageResult(request, session) {
        const requestKey = bridgeKey(session, 'request');
        const statusKey = bridgeKey(session, 'status');
        let emptySince = 0;
        let lastUrl = '';
        for (;;) {
            if (GM_getValue(requestKey, null)?.requestId !== request.requestId) throw cancelledError();
            if (beatportChallengeVisible()) {
                GM_setValue(statusKey, {requestId:request.requestId, phase:'challenge', timestamp:Date.now()});
                emptySince = 0;
                await wait(900);
                continue;
            }
            const current = new URL(location.href);
            if (request.kind === 'release') {
                const expected = beatportUrl(request.value)?.match(/\/(\d+)$/)?.[1];
                if (!expected) throw new Error('Invalid Beatport release');
                if (current.pathname.match(/\/(\d+)\/?$/)?.[1] === expected) {
                    const node = document.getElementById('__NEXT_DATA__');
                    let data = null;
                    try {data = JSON.parse(node?.textContent || '{}');} catch {}
                    const item = releaseDetailsFromProps(data, expected);
                    if (item) {
                        item.url = beatportUrl(request.value);
                        GM_setValue(statusKey,{requestId:request.requestId,phase:'completed',timestamp:Date.now()});
                        return item;
                    }
                }
                // No metadata is NOT a reason to leave while a CAPTCHA
                // may still be pending or Beatport is hydrating the page.
                GM_setValue(statusKey,{requestId:request.requestId,phase:'loading',timestamp:Date.now()});
                await wait(900);
                continue;
            }
            if (request.kind === 'search') {
                if (/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?search\/releases\/?$/i.test(current.pathname) &&
                    current.searchParams.get('q') === plain(request.value)) {
                    const links = searchReleaseLinks(document.documentElement.outerHTML);
                    if (links.length) {
                        GM_setValue(statusKey,{requestId:request.requestId,phase:'completed',timestamp:Date.now()});
                        return links;
                    }
                    if (document.getElementById('__NEXT_DATA__')) {
                        if (!emptySince || lastUrl !== location.href) emptySince = Date.now();
                        // Only a hydrated non-challenge search may finish empty.
                        if (Date.now() - emptySince > 12000) return [];
                    } else emptySince = 0;
                } else emptySince = 0;
                lastUrl = location.href;
                GM_setValue(statusKey,{requestId:request.requestId,phase:'loading',timestamp:Date.now()});
                await wait(900);
                continue;
            }
            throw new Error('Unsupported browser request');
        }
    }

    function initBeatportWorker() {
        const search = new URL(location.href).searchParams;
        const session = search.get('bpcnf_worker') || sessionStorage.getItem(BRIDGE + ':worker-session');
        if (!session || !/^[\w-]{8,100}$/.test(session)) return;
        if (search.get('bpcnf_worker')) sessionStorage.setItem(BRIDGE + ':worker-session', session);
        let busy = false;
        let lastId = '';
        let activeController = null;
        const directRequestId = search.get('bpcnf_request') ||
            sessionStorage.getItem(BRIDGE + ':direct-request');
        const reqKey = bridgeKey(session, 'request');
        const replyKey = bridgeKey(session, 'reply');
        const readyKey = bridgeKey(session, 'ready');
        function ready() {GM_setValue(readyKey, {session, timestamp: Date.now()});}
        async function process(request) {
            if (!request || busy || lastId === request.requestId ||
                Date.now() - Number(request.timestamp || 0) > 6 * 60 * 60 * 1000) return;
            if (!/^[\w-]{8,100}$/.test(String(request.requestId))) return;
            busy = true;
            lastId = request.requestId;
            activeController = new AbortController();
            const timer = directRequestId === request.requestId ? null :
                setTimeout(() => activeController?.abort(), 24000);
            let reply;
            let navigating = false;
            try {
                let result;
                if (directRequestId === request.requestId) {
                    // Cloudflare sometimes rejects fetch even inside an allowed browser
                    // session. Read the real top-level page after ordinary navigation.
                    result = await browserLoadedPageResult(request, session);
                } else {
                    result = await browserBeatportRequest(request.kind, request.value, activeController.signal);
                }
                if (request.kind === 'search' && !result?.length && directRequestId !== request.requestId) throw new Error('Beatport returned no search result links');
                if (request.kind === 'release' && !result && directRequestId !== request.requestId) throw new Error('Beatport release metadata missing from request');
                reply = {requestId: request.requestId, result};
            } catch (error) {
                if (directRequestId !== request.requestId &&
                    /Beatport HTTP 403|no search result links|release metadata missing from request/.test(String(error.message))) {
                    const url = browserNavigationUrl(request, session);
                    if (url) {
                        navigating = true;
                        sessionStorage.setItem(BRIDGE + ':direct-request', request.requestId);
                        GM_setValue(bridgeKey(session, 'status'),
                            {requestId:request.requestId,phase:'loading',timestamp:Date.now()});
                        location.assign(url);
                    }
                }
                if (!navigating) reply = {requestId: request.requestId, error: plain(error.message)};
            } finally {
                if (timer !== null) clearTimeout(timer);
                activeController = null;
                busy = false;
            }
            if (reply) GM_setValue(replyKey, reply);
        }
        GM_addValueChangeListener(reqKey, (_key, _old, request) => {void process(request);});
        const pending = GM_getValue(reqKey, null);
        // Do not signal that the initial tab is ready while it shows
        // Cloudflare/Turnstile; the scan must remain paused.
        const initialReady = async () => {
            while (beatportChallengeVisible()) {
                GM_setValue(bridgeKey(session,'status'),
                    {requestId:pending?.requestId || '',phase:'challenge',timestamp:Date.now()});
                await wait(900);
            }
            ready();
        };
        void initialReady();
        if (!directRequestId || pending?.requestId === directRequestId) void process(pending);
    }

    function beatportUrl(value) {
        try {
            const url = new URL(String(value || ''));
            if (url.protocol !== 'https:' || !/^(?:www\.)?beatport\.com$/i.test(url.hostname)) return '';
            const m = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?release\/([^/]+)\/(\d+)\/?$/i);
            return m ? `https://www.beatport.com/release/${m[1]}/${m[2]}` : '';
        } catch { return ''; }
    }

    function releaseDetailsFromHtml(html, expectedId = '') {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const node = doc.querySelector('script#__NEXT_DATA__');
        if (!node?.textContent) return null;
        try {return releaseDetailsFromProps(JSON.parse(node.textContent), expectedId);} catch {return null;}
    }

    function searchReleaseLinks(html) {
        const found = new Set();
        // React/Next search pages can hold links in both anchors and hydrated JSON.
        const normalized = String(html || '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
        const regex = /(?:https?:\/\/(?:www\.)?beatport\.com)?\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?release\/([a-z0-9_-]+)\/(\d+)/gi;
        let match;
        while ((match = regex.exec(normalized)) && found.size < 60) {
            const clean = beatportUrl(`https://www.beatport.com/release/${match[1]}/${match[2]}`);
            if (clean) found.add(clean);
        }
        return [...found];
    }

    async function getBeatportRelease(url, state) {
        const clean = beatportUrl(url);
        if (!clean) return null;
        const id = clean.match(/\/(\d+)$/)?.[1];
        if (metadataCache.has(id)) return metadataCache.get(id);
        let result = null;
        try {
            result = await beatportTask('release', clean, state);
            if (result && String(result.id) !== String(id)) result = null;
            if (result) result.url = clean;
        } catch (err) {
            if (state.cancelled) throw err;
            state.errors.push(plain(err.message));
        }
        metadataCache.set(id, result);
        return result;
    }

    function releaseLinks(release) {
        const links = new Set();
        for (const rel of release.relations || []) {
            const link = beatportUrl(rel?.url?.resource);
            if (link) links.add(link);
        }
        return [...links];
    }

    function isDigital(release) {
        const media = release?.media || [];
        return media.length > 0 && media.every(m => plain(m.format).toLowerCase() === 'digital media');
    }

    function catalogs(release) {
        return (release['label-info'] || []).map(x => plain(x?.['catalog-number'])).filter(isPresent);
    }

    async function readArtistReleases(id, state, progress) {
        const all = [];
        let offset = 0;
        for (;;) {
            if (state.cancelled) throw cancelledError();
            const url = `/ws/2/release?artist=${encodeURIComponent(id)}&inc=labels+media+url-rels&fmt=json&limit=100&offset=${offset}`;
            const data = await mbJson(url, state);
            const batch = data.releases || [];
            all.push(...batch);
            offset += batch.length; // MB may cap response at 500 total tracks.
            progress(`Loading artist releases: ${offset}/${data['release-count'] ?? '?'}`);
            if (!batch.length || offset >= Number(data['release-count'] || 0)) break;
        }
        return all;
    }

    async function findByBarcode(release, state, progress) {
        const wanted = release.barcode;
        const linked = releaseLinks(release);
        // A linked page is a reliable starting point ONLY when its own UPC agrees.
        const confirmed = [];
        for (const link of linked) {
            const item = await getBeatportRelease(link, state);
            if (item && sameBarcode(item.upc, wanted)) confirmed.push(item);
        }
        if (confirmed.length === 1) return {status: 'match', item: confirmed[0], evidence: 'Beatport link + verified UPC'};
        if (confirmed.length > 1) return {status: 'ambiguous', reason: 'Multiple linked Beatport releases have this UPC'};

        // Beatport's public release search does NOT search by UPC. Discover by
        // release title, then verify each candidate's actual UPC from Beatport.
        const searchTerms = [plain(release.title)].filter(Boolean);
        const candidates = new Map();
        for (const term of [...new Set(searchTerms)]) {
            if (!term) continue;
            if (state.cancelled) throw cancelledError();
            progress(`Searching Beatport: ${term.slice(0, 65)}`);
            let links;
            if (searchCache.has(term)) links = searchCache.get(term);
            else {
                try {
                    links = await beatportTask('search', term, state);
                } catch (err) {
                    if (state.cancelled) throw err;
                    state.errors.push(plain(err.message));
                    links = [];
                }
                searchCache.set(term, links);
            }
            // Limit remote page requests; never infer a UPC from a search-result title.
            for (const link of links.slice(0, 25)) {
                const item = await getBeatportRelease(link, state);
                if (item && sameBarcode(item.upc, wanted)) candidates.set(item.id, item);
                if (candidates.size > 1) break;
            }
            // Check all discovered hits before declaring an unambiguous UPC match.
        }
        if (candidates.size > 1) return {status: 'ambiguous', reason: 'Multiple Beatport releases share this UPC'};
        if (candidates.size === 1) return {status: 'match', item: [...candidates.values()][0], evidence: 'Exact verified UPC'};
        return {status: 'missing', reason: 'No verified Beatport UPC match (or search is unavailable)'};
    }

    async function findByLink(release, state) {
        const links = releaseLinks(release);
        const found = [];
        for (const link of links) {
            const item = await getBeatportRelease(link, state);
            if (item) found.push(item);
        }
        if (!found.length) return {status: 'missing', reason: 'Linked Beatport page is unavailable'};
        const distinct = new Set(found.map(item => item.catalog));
        if (distinct.size > 1 || found.some(x => !x.catalog)) {
            return {status: 'ambiguous', reason: 'Linked Beatport pages disagree or catalog number is missing'};
        }
        return {status: 'match', item: found[0], evidence: 'MusicBrainz Beatport release link (no barcode)'};
    }

    function reviewFinding(release, hit, usedCatalogs, staged) {
        if (hit.status !== 'match') return {status: hit.status, reason: hit.reason};
        const item = hit.item;
        if (!item.catalog || !normalizeCatalog(item.catalog)) return {status: 'missing', reason: 'No Beatport catalog number'};
        if (isBarcodeCatalog(item.catalog, item.upc, release.barcode)) return {status:'barcode', reason:'Beatport catalog number is a barcode'};
        const catKey = normalizeCatalog(item.catalog);
        if (usedCatalogs.has(catKey)) return {status: 'duplicate', reason: 'Catalog number already belongs to an artist digital release'};
        if (staged.has(catKey)) return {status: 'duplicate', reason: 'Catalog number already proposed for another release'};
        staged.add(catKey);
        return {status: 'candidate', item, evidence: hit.evidence};
    }

    function css() {
        if (document.getElementById('bpcnf-style')) return;
        const style = document.createElement('style');
        style.id = 'bpcnf-style';
        style.textContent = `
          #bpcnf-panel { position:fixed; right:16px; bottom:16px; z-index:2147483641; width:min(570px,calc(100vw - 32px)); max-height:min(74vh,680px); display:flex; flex-direction:column; color:#e9edf4; background:#161c26; border:1px solid #566177; box-shadow:0 16px 55px #000b; border-radius:10px; font:13px/1.45 system-ui,Segoe UI,sans-serif; }
          #bpcnf-panel * {box-sizing:border-box;} #bpcnf-panel[hidden] {display:none;}
          #bpcnf-panel header {display:flex; gap:8px; align-items:center; padding:11px 13px; border-bottom:1px solid #364357;}
          #bpcnf-panel header strong {font-size:14px;flex:1;}
          #bpcnf-panel main {padding:12px;overflow:auto;scrollbar-color:#708099 #161c26;}
          #bpcnf-panel button, #bpcnf-panel a.bpcnf-btn {border:1px solid #52627a;border-radius:5px;padding:6px 10px;color:#f5f7fa;background:#263448;font:inherit;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:32px;}
          #bpcnf-panel button:hover, #bpcnf-panel a.bpcnf-btn:hover {background:#385273;} #bpcnf-panel button:focus-visible, #bpcnf-panel a:focus-visible {outline:2px solid #82cfff;outline-offset:2px;}
          #bpcnf-panel button:disabled {opacity:.48;cursor:not-allowed;} #bpcnf-panel button.bpcnf-primary {background:#0c5e76;border-color:#288aac;} #bpcnf-panel button.bpcnf-primary:hover {background:#097a94;}
          #bpcnf-panel .bpcnf-controls {display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:9px;}
          #bpcnf-panel .bpcnf-small {font-size:12px;color:#bcc9da;} #bpcnf-panel #bpcnf-status {min-height:20px;margin-bottom:7px;overflow-wrap:anywhere;}
          #bpcnf-panel progress {width:100%;height:8px;accent-color:#47b9d9;} #bpcnf-panel progress[hidden] {display:none;}
          #bpcnf-panel .bpcnf-row {border-top:1px solid #344154;padding:9px 1px;display:grid;gap:4px;}
          #bpcnf-panel .bpcnf-row-title {font-weight:600;} #bpcnf-panel .bpcnf-row a {color:#9cd3ff;} #bpcnf-panel .bpcnf-actions {display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:3px;}
          #bpcnf-panel .bpcnf-warning {color:#ffd39b;} #bpcnf-panel details {margin-top:10px;} #bpcnf-panel summary {cursor:pointer;} #bpcnf-panel #bpcnf-errors {max-height:90px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.4 Consolas,monospace;}
          #bpcnf-edit {padding:9px 12px;display:grid;gap:7px;background:#263448;border-bottom:1px solid #52627a;} #bpcnf-edit div {display:flex;gap:7px;flex-wrap:wrap;align-items:center;}
          @media(max-width:520px){#bpcnf-panel {right:8px;bottom:8px;width:calc(100vw - 16px); max-height:83vh;} }
        `;
        document.head.append(style);
    }

    function element(tag, attributes = {}, text) {
        const el = document.createElement(tag);
        Object.entries(attributes).forEach(([key, value]) => {
            if (key === 'className') el.className = value;
            else if (key === 'title') el.title = value;
            else el.setAttribute(key, value);
        });
        if (text !== undefined) el.textContent = text;
        return el;
    }
    function button(label, handler, className = '') {
        const el = element('button', {type: 'button', className}, label);
        el.addEventListener('click', handler);
        return el;
    }
    function anchor(text, href) {
        const a = element('a', {href, target: '_blank', rel: 'noopener noreferrer'}, text);
        return a;
    }

    function createPanel() {
        css();
        const panel = element('section', {id: 'bpcnf-panel', 'aria-label': NAME});
        const head = element('header');
        head.append(element('strong', {}, NAME));
        const close = button('×', () => { panel.hidden = true; }, '');
        close.setAttribute('aria-label', 'Hide Beatport catalog number finder');
        head.append(close);
        const main = element('main');
        const intro = element('div', {className: 'bpcnf-small'}, 'Finds digital releases missing catalog numbers. Opens one Beatport browser tab; searches release titles, then verifies UPC from Beatport metadata or checks direct Beatport links. It closes the tab afterward. Reviews only; never submits.');
        intro.style.marginBottom = '10px';
        const controls = element('div', {className: 'bpcnf-controls'});
        const start = button('▶ Scan (open Beatport tab)', () => startScan(ui), 'bpcnf-primary');
        const stop = button('■ Stop scan', () => {if (run) {run.cancelled = true;run.activeRequest?.abort?.();}}, '');
        stop.disabled = true;
        controls.append(start, stop);
        const status = element('div', {id: 'bpcnf-status', className: 'bpcnf-small', role: 'status', 'aria-live': 'polite'}, 'Ready.');
        const progress = element('progress', {max: '100', value: '0'});
        progress.hidden = true;
        const summary = element('div', {className: 'bpcnf-small'});
        const results = element('div');
        const detail = element('details');
        const label = element('summary', {}, 'Errors / limitations');
        const errors = element('div', {id: 'bpcnf-errors'});
        detail.append(label, errors);
        main.append(intro, controls, status, progress, summary, results, detail);
        panel.append(head, main);
        document.body.append(panel);
        // Artist page doesn't offer this action natively. One reversible entry point.
        const open = button('♪ Beatport catnos', () => {panel.hidden = false;start.focus();});
        open.id = 'bpcnf-reopen';
        open.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483640;background:#182536;color:#fff;border:1px solid #67839b;border-radius:8px;padding:9px 13px;cursor:pointer;';
        open.title = 'Open Beatport catalog number finder';
        open.addEventListener('keydown', e => {if (e.key === 'Escape') panel.hidden = true;});
        document.body.append(open);
        const ui = {panel, start, stop, status, progress, summary, results, errors, detail};
        panel.addEventListener('keydown', e => {if (e.key === 'Escape') {panel.hidden = true;open.focus();}});
        return ui;
    }

    function isBeatportReleaseAlreadyLinked(release, value) {
        const wantedId = beatportUrl(value)?.match(/\/(\d+)$/)?.[1];
        return !!wantedId && releaseLinks(release).some(link => link.match(/\/(\d+)$/)?.[1] === wantedId);
    }

    function stageEdit(release, item, evidence) {
        const source = beatportUrl(item.url);
        if (!source || !UUID.test(release.id)) return;
        const addBeatportLink = !isBeatportReleaseAlreadyLinked(release, source);
        const record = {id: release.id, title: release.title, catalog: item.catalog, label: item.label, beatport: source, upc: item.upc, barcode: release.barcode, evidence, addBeatportLink, timestamp: Date.now()};
        const stored = GM_getValue(KEY, {});
        const next = stored && typeof stored === 'object' ? stored : {};
        next[release.id] = record;
        for (const id of Object.keys(next)) {
            if (Date.now() - Number(next[id]?.timestamp || 0) > 2 * 60 * 60 * 1000) delete next[id];
        }
        GM_setValue(KEY, next);
        // MusicBrainz seeds release URL relationships from these query keys
        // (root/static/scripts/external-links-editor/state.js). Type 74
        // is "purchase for download", the Beatport release shop page.
        const editUrl = new URL(location.origin + '/release/' + encodeURIComponent(release.id) + '/edit');
        if (addBeatportLink) {
            editUrl.searchParams.set('edit-release.url.0.text', source);
            editUrl.searchParams.set('edit-release.url.0.link_type_id', '74');
        }
        window.open(editUrl.href, '_blank', 'noopener');
    }

    function displayCandidate(ui, release, finding) {
        const {item, evidence} = finding;
        const row = element('article', {className: 'bpcnf-row'});
        const name = element('div', {className: 'bpcnf-row-title'});
        name.append(anchor(release.title, `${location.origin}/release/${release.id}`));
        const info = element('div', {className: 'bpcnf-small'}, `${item.catalog} · ${item.label || 'Label not available'} · ${evidence}`);
        const links = element('div', {className: 'bpcnf-small'});
        links.append(anchor('Beatport source ↗', item.url));
        if (release.barcode) links.append(document.createTextNode(` · UPC ${release.barcode}`));
        const actions = element('div', {className: 'bpcnf-actions'});
        actions.append(button('↗ Review edit', () => stageEdit(release, item, evidence), 'bpcnf-primary'));
        actions.append(button('Copy catalog', () => {
            if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(item.catalog).catch(() => window.prompt('Copy catalog number:', item.catalog));
            } else window.prompt('Copy catalog number:', item.catalog);
        }));
        row.append(name, info, links, actions);
        ui.results.append(row);
    }

    async function startScan(ui) {
        if (run) return;
        const state = {cancelled: false, errors: [], activeRequest: null, bridgeTab: null, bridgeSession: ''};
        run = state;
        state.progress = text => {ui.status.textContent = text;};
        metadataCache.clear(); searchCache.clear();
        ui.start.disabled = true; ui.stop.disabled = false;
        ui.progress.hidden = false; ui.progress.value = 0;
        ui.results.replaceChildren(); ui.errors.textContent = '';
        ui.summary.textContent = '';
        const stats = {digital: 0, eligible: 0, candidate: 0, duplicate: 0, barcode: 0, missing: 0, ambiguous: 0, already: 0};
        const progress = text => {ui.status.textContent = text;};
        try {
            const releases = await readArtistReleases(ARTIST[1], state, progress);
            const digital = releases.filter(isDigital);
            const usedCatalogs = new Set(digital.flatMap(r => catalogs(r).map(normalizeCatalog)).filter(Boolean));
            const candidates = digital.filter(r => {
                if (catalogs(r).length) {stats.already++;return false;}
                return !!plain(r.barcode) || releaseLinks(r).length > 0;
            });
            stats.digital = digital.length;
            stats.eligible = candidates.length;
            if (candidates.length) await ensureBeatportTab(state, progress);
            const staged = new Set();
            for (let i = 0; i < candidates.length; i++) {
                if (state.cancelled) throw cancelledError();
                const release = candidates[i];
                const counter = `${i + 1}/${candidates.length}`;
                progress(`Checking ${counter}: ${release.title}`);
                ui.progress.max = Math.max(1, candidates.length);
                ui.progress.value = i;
                const hit = plain(release.barcode)
                    ? await findByBarcode(release, state, progress)
                    : await findByLink(release, state);
                const finding = reviewFinding(release, hit, usedCatalogs, staged);
                if (finding.status === 'candidate') {stats.candidate++;displayCandidate(ui, release, finding);}
                else {stats[finding.status] = (stats[finding.status] || 0) + 1;}
                ui.summary.textContent = `${stats.candidate} edits to review · ${stats.duplicate} duplicates skipped · ${stats.barcode} barcode-like skipped · ${stats.missing} unverified · ${stats.ambiguous} ambiguous`;
            }
            ui.progress.value = candidates.length;
            progress(`Complete: ${stats.digital} digital releases; ${stats.eligible} with no catalog number and barcode/link; ${stats.candidate} proposed edits.`);
        } catch (err) {
            progress(state.cancelled ? 'Scan stopped. Reviewed results remain available.' : `Scan failed: ${plain(err.message)}`);
        } finally {
            ui.start.disabled = false;
            ui.stop.disabled = true;
            ui.errors.textContent = [...new Set(state.errors)].slice(0, 30).join('\n') || 'No network errors. Beatport search may still return no public results; those are not treated as matches.';
            if (state.errors.length) ui.detail.open = true;
            try {
                if (state.bridgeSession) GM_setValue(bridgeKey(state.bridgeSession, 'request'), null);
                state.activeRequest?.abort?.();
                state.bridgeTab?.close?.();
            } catch {}
            run = null;
        }
    }

    // MusicBrainz editor uses #catno-N and Knockout "value: catalogNumber".
    function findCatalogInputs() {
        const root = document.getElementById('release-editor');
        if (!root) return [];
        return [...root.querySelectorAll('#information input[type="text"]')].filter(el =>
            !el.disabled && !el.readOnly && (
                /^catno-\d+$/i.test(el.id) ||
                /\bvalue\s*:\s*catalogNumber\b/.test(el.getAttribute('data-bind') || '') ||
                /catalog[_-]?number/i.test(el.name || '')
            )
        );
    }
    function chooseCatalogInput(record) {
        const all = findCatalogInputs();
        if (!all.length) return {status:'wait', reason:'Waiting for the label fields to load.'};
        if (all.some(x => plain(x.value).toLowerCase() === '[none]'))
            return {status:'stop', reason:'A [none] catalog number is present; nothing changed.'};
        if (all.some(x => normalizeCatalog(x.value) === normalizeCatalog(record.catalog)))
            return {status:'already'};
        const empty = all.filter(x => !plain(x.value));
        if (!empty.length) return {status:'stop', reason:'No empty catalog-number field; existing values were preserved.'};
        if (all.length === 1 && empty.length === 1) return {status:'fill',el:empty[0]};
        const wanted = plain(record.label).normalize('NFKC').toLowerCase();
        if (wanted) {
            const matching = empty.filter(x =>
                plain(x.closest('tr')?.querySelector('input.name')?.value).normalize('NFKC').toLowerCase() === wanted
            );
            if (matching.length === 1) return {status:'fill',el:matching[0]};
        }
        return {status:'stop',reason:'Several label rows were found without a unique label match. Use Copy catalog and choose the correct row manually.'};
    }
    function proposedEditNote(record) {
        return 'Catalog number ' + record.catalog + ' verified from Beatport: ' +
            record.beatport + '\n' + SCRIPT_URL;
    }
    function findEditableEditNote() {
        const field = document.getElementById('edit-note-text');
        if (field?.tagName === 'TEXTAREA' && !field.disabled && !field.readOnly) return field;
        const fields = [...document.querySelectorAll('#release-editor textarea')].filter(x =>
            /^(?:edit[_-]?note|editNote|edit-note-text)$/i.test(plain(x.name || x.id)) &&
            !x.disabled && !x.readOnly
        );
        return fields.length === 1 ? fields[0] : null;
    }
    function setBoundValue(input, value) {
        const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto,'value')?.set;
        if (setter) setter.call(input,value); else input.value=value;
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.dispatchEvent(new Event('change',{bubbles:true}));
    }
    function appendEditNote(record) {
        const input = findEditableEditNote();
        if (!input) return false;
        if (!input.value.includes(SCRIPT_URL))
            setBoundValue(input,[input.value.trim(),proposedEditNote(record)].filter(Boolean).join('\n\n'));
        return true;
    }
    function editorHasBeatportLink(beatport) {
        const wantedId = beatportUrl(beatport)?.match(/\/(\d+)$/)?.[1];
        const table = document.getElementById('external-links-editor');
        if (!wantedId || !table) return false;
        return [...table.querySelectorAll('a.url, input.value')].some(el => {
            const address = el.tagName === 'A' ? el.href : el.value;
            return beatportUrl(address)?.match(/\/(\d+)$/)?.[1] === wantedId;
        });
    }

    function initEdit(recordId) {
        let data;
        try {data=GM_getValue(KEY,{})?.[recordId];} catch {return;}
        if (!data || data.id!==recordId || Date.now()-Number(data.timestamp||0)>7200000) return;
        css();
        const panel=element('section',{id:'bpcnf-panel','aria-label':'Beatport catalog edit'});
        panel.style.bottom='12px';panel.style.maxHeight='55vh';
        const head=element('header');head.append(element('strong',{},'Beatport catalog edit'));
        let timer=null;
        const dismiss=button('×',()=>{
            if(timer!==null)clearInterval(timer);
            panel.remove();
            const stored=GM_getValue(KEY,{});
            delete stored[recordId];GM_setValue(KEY,stored);
        });
        dismiss.setAttribute('aria-label','Dismiss catalog proposal');head.append(dismiss);
        const body=element('div',{id:'bpcnf-edit'});
        body.append(element('div',{},data.catalog+' · Beatport label: '+(data.label||'Unknown')+' · '+data.evidence));
        body.append(anchor('Beatport evidence ↗',data.beatport));
        const message=element('div',{className:'bpcnf-small',role:'status','aria-live':'polite'},
            'Preparing the catalog number as soon as the MusicBrainz editor loads.');
        const actions=element('div');
        actions.append(button('Copy catalog',()=>{
            if(navigator.clipboard?.writeText)navigator.clipboard.writeText(data.catalog).then(()=>{message.textContent='Catalog number copied.';}).catch(()=>window.prompt('Copy catalog:',data.catalog));
            else window.prompt('Copy catalog:',data.catalog);
        }));
        actions.append(button('Copy edit note',()=>{
            const note=proposedEditNote(data);
            if(navigator.clipboard?.writeText)navigator.clipboard.writeText(note).then(()=>{message.textContent='Edit note copied.';}).catch(()=>window.prompt('Copy edit note:',note));
            else window.prompt('Copy edit note:',note);
        }));
        body.append(actions,message);panel.append(head,body);document.body.append(panel);
        if(isBarcodeCatalog(data.catalog,data.upc,data.barcode)){
            message.textContent='Skipped barcode-shaped catalog number. No changes made.';return;
        }
        const deadline=Date.now()+25000;
        let filled=false,finished=false;
        function apply(){
            if(!panel.isConnected || finished)return;
            const choice=chooseCatalogInput(data);
            if(choice.status==='wait'){
                if(Date.now()>deadline){message.textContent='Catalog field did not load. Use Copy catalog to enter it manually.';finished=true;}
                return;
            }
            if(choice.status==='stop'){message.textContent=choice.reason;finished=true;return;}
            if(choice.status==='fill'){
                if(plain(choice.el.value)){message.textContent='Catalog field is no longer empty. Nothing overwritten.';finished=true;return;}
                setBoundValue(choice.el,data.catalog);filled=true;
            }
            const note=appendEditNote(data);
            if(!filled && choice.status==='already'){
                message.textContent='Catalog number already present; no changes needed.';finished=true;
            }else if(note && (!data.addBeatportLink || editorHasBeatportLink(data.beatport))){
                message.textContent = data.addBeatportLink
                    ? 'Catalog number, Beatport purchase link and evidence note prepared. Review and submit manually.'
                    : 'Catalog number and evidence note prepared. Beatport release link already exists. Review and submit manually.';
                finished=true;
            }else if(Date.now()>deadline){
                message.textContent='Catalog number prepared, but the Beatport external link or edit note could not be verified. Check External links and use Copy edit note before submitting.';
                finished=true;
            }else message.textContent='Preparing Beatport external link and edit note...';
        }
        apply();
        if(!finished)timer=setInterval(()=>{
            apply();
            if(finished){clearInterval(timer);timer=null;}
        },500);
    }

    if (IS_BEATPORT) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBeatportWorker, {once: true});
        else initBeatportWorker();
    }
    if (ARTIST && UUID.test(ARTIST[1])) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createPanel, {once: true});
        else createPanel();
    }
    if (EDIT && UUID.test(EDIT[1])) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initEdit(EDIT[1]), {once: true});
        else initEdit(EDIT[1]);
    }

    // Test entry point is disabled in production unless explicitly enabled by a test harness.
    if (globalThis.__BPCNF_TEST__ === true) {
        globalThis.__BPCNF_TEST_HOOKS__ = {beatportChallengeVisible, browserLoadedPageResult, sameBarcode, normalizeCatalog, beatportUrl, releaseDetailsFromHtml, searchReleaseLinks, isDigital, catalogs, releaseLinks, reviewFinding, proposedEditNote, isBarcodeCatalog, findCatalogInputs, chooseCatalogInput, isBeatportReleaseAlreadyLinked, editorHasBeatportLink, releaseDetailsFromProps, browserBeatportRequest, bridgeKey, browserNavigationUrl};
    }
})();
