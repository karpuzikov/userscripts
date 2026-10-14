// ==UserScript==
// @name         MusicBrainz - Beatport Catalog Number Finder
// @namespace    https://github.com/karpuzikov/userscripts
// @version      0.1.1
// @description  Find missing digital-release catalog numbers on Beatport and review safe MusicBrainz edits.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/artist/*
// @match        https://beta.musicbrainz.org/artist/*
// @match        https://musicbrainz.org/release/*/edit*
// @match        https://beta.musicbrainz.org/release/*/edit*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
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
    const isPresent = x => !!plain(x); // [none] is intentional existing data, not an empty field.
    const cancelledError = () => new Error('Scan stopped by user');
    const metadataCache = new Map();
    const searchCache = new Map();
    let lastMbRequest = 0;
    let lastBeatportRequest = 0;
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

    async function beatportText(url, state) {
        if (state?.cancelled) throw cancelledError();
        await sleepCancellable(Math.max(0, lastBeatportRequest + 350 - Date.now()), state);
        lastBeatportRequest = Date.now();
        return new Promise((resolve, reject) => {
            const handle = GM_xmlhttpRequest({
                method: 'GET', url, timeout: 20000, responseType: 'text',
                headers: {Accept: 'text/html,application/xhtml+xml'},
                onload: response => {
                    if (state?.cancelled) return reject(cancelledError());
                    if (response.status < 200 || response.status >= 300) {
                        return reject(new Error(`Beatport HTTP ${response.status} (${url})`));
                    }
                    resolve(response.responseText || String(response.response || ''));
                },
                onerror: () => reject(new Error('Beatport request failed')),
                ontimeout: () => reject(new Error('Beatport request timed out')),
                onabort: () => reject(cancelledError()),
            });
            if (state) state.activeRequest = handle;
        });
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
        let data;
        try { data = JSON.parse(node.textContent); } catch { return null; }
        const release = data?.props?.pageProps?.release || data?.pageProps?.release;
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
            const html = await beatportText(clean, state);
            result = releaseDetailsFromHtml(html, id);
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

        const searchTerms = [plain(wanted)];
        const simplified = normalizeBarcode(wanted);
        if (simplified && simplified !== wanted) searchTerms.push(simplified);
        // A title search is discovery-only; every candidate still needs verified UPC.
        searchTerms.push(plain(release.title));
        const candidates = new Map();
        for (const term of [...new Set(searchTerms)]) {
            if (!term) continue;
            if (state.cancelled) throw cancelledError();
            progress(`Searching Beatport: ${term.slice(0, 65)}`);
            let links;
            if (searchCache.has(term)) links = searchCache.get(term);
            else {
                try {
                    const html = await beatportText(`https://www.beatport.com/search/releases?q=${encodeURIComponent(term)}`, state);
                    links = searchReleaseLinks(html);
                } catch (err) {
                    if (state.cancelled) throw err;
                    state.errors.push(plain(err.message));
                    links = [];
                }
                searchCache.set(term, links);
            }
            // Limit remote page requests; never infer a UPC from a search-result title.
            for (const link of links.slice(0, term === release.title ? 20 : 35)) {
                const item = await getBeatportRelease(link, state);
                if (item && sameBarcode(item.upc, wanted)) candidates.set(item.id, item);
                if (candidates.size > 1) break;
            }
            if (candidates.size) break;
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
        const intro = element('div', {className: 'bpcnf-small'}, 'Scans digital releases with a barcode or Beatport link and missing catalog number. Prepares edits for review; never submits.');
        intro.style.marginBottom = '10px';
        const controls = element('div', {className: 'bpcnf-controls'});
        const start = button('▶ Scan artist releases', () => startScan(ui), 'bpcnf-primary');
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

    function stageEdit(release, item, evidence) {
        const record = {id: release.id, title: release.title, catalog: item.catalog, label: item.label, beatport: item.url, evidence, timestamp: Date.now()};
        const stored = GM_getValue(KEY, {});
        const next = stored && typeof stored === 'object' ? stored : {};
        next[release.id] = record;
        for (const id of Object.keys(next)) {
            if (Date.now() - Number(next[id]?.timestamp || 0) > 2 * 60 * 60 * 1000) delete next[id];
        }
        GM_setValue(KEY, next);
        // Open editor for manual confirmation. No database edit is submitted by the script.
        window.open(`${location.origin}/release/${encodeURIComponent(release.id)}/edit`, '_blank', 'noopener');
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
        const state = {cancelled: false, errors: [], activeRequest: null};
        run = state;
        metadataCache.clear(); searchCache.clear();
        ui.start.disabled = true; ui.stop.disabled = false;
        ui.progress.hidden = false; ui.progress.value = 0;
        ui.results.replaceChildren(); ui.errors.textContent = '';
        ui.summary.textContent = '';
        const stats = {digital: 0, eligible: 0, candidate: 0, duplicate: 0, missing: 0, ambiguous: 0, already: 0};
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
                ui.summary.textContent = `${stats.candidate} edits to review · ${stats.duplicate} duplicates skipped · ${stats.missing} unverified · ${stats.ambiguous} ambiguous`;
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
            run = null;
        }
    }

    function findCatalogInputs() {
        return [...document.querySelectorAll('input[type="text"],input:not([type])')].filter(el => {
            const value = `${el.name || ''} ${el.id || ''}`;
            return /catalog[_-]?number|catalog[_-]?no\b/i.test(value) && !el.disabled && !el.readOnly;
        });
    }

    function proposedEditNote(record) {
        return `Catalog number ${record.catalog} verified from Beatport: ${record.beatport}\n${SCRIPT_URL}`;
    }

    function findEditableEditNote() {
        const fields = [...document.querySelectorAll('textarea')].filter(el =>
            /^(?:edit[_-]?note|editNote)$/i.test(plain(el.name || el.id)) && !el.disabled && !el.readOnly
        );
        return fields.length === 1 ? fields[0] : null;
    }

    function appendEditNote(record) {
        const field = findEditableEditNote();
        if (!field) return false;
        if (!field.value.includes(SCRIPT_URL)) {
            const text = [field.value.trim(), proposedEditNote(record)].filter(Boolean).join('\n\n');
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
            if (setter) setter.call(field, text); else field.value = text;
            field.dispatchEvent(new Event('input', {bubbles: true}));
            field.dispatchEvent(new Event('change', {bubbles: true}));
        }
        return true;
    }

    function initEdit(recordId) {
        let data;
        try { data = GM_getValue(KEY, {})?.[recordId]; } catch { return; }
        if (!data || data.id !== recordId || Date.now() - Number(data.timestamp || 0) > 2 * 60 * 60 * 1000) return;
        css();
        const panel = element('section', {id: 'bpcnf-panel', 'aria-label': 'Beatport catalog edit proposal'});
        panel.style.bottom = '12px';
        panel.style.maxHeight = '55vh';
        const head = element('header');
        head.append(element('strong', {}, 'Beatport catalog proposal'));
        const dismiss = button('×', () => {panel.remove();const stored = GM_getValue(KEY, {});delete stored[recordId];GM_setValue(KEY, stored);});
        dismiss.setAttribute('aria-label', 'Dismiss catalog proposal');
        head.append(dismiss);
        const body = element('div', {id: 'bpcnf-edit'});
        body.append(element('div', {}, `${data.catalog} · Beatport label: ${data.label || 'Unknown'} · ${data.evidence}`));
        const links = element('div');links.append(anchor('Beatport evidence ↗', data.beatport));body.append(links);
        const message = element('div', {className: 'bpcnf-small', role: 'status', 'aria-live': 'polite'}, 'Review the label and catalog field before entering the MusicBrainz edit.');
        const actions = element('div');
        actions.append(button('Fill sole empty catalog field', () => {
            const fields = findCatalogInputs();
            if (fields.some(f => plain(f.value) === '[none]')) {message.textContent = 'An explicit [none] catalog exists; nothing changed.';return;}
            const empty = fields.filter(f => !plain(f.value));
            if (fields.length !== 1 || empty.length !== 1) {
                message.textContent = `${fields.length} catalog field(s) found. Only one unambiguous empty field can be filled automatically; use Copy catalog and select the correct label manually.`;
                return;
            }
            if (!appendEditNote(data)) {
                message.textContent = 'Could not identify one editable MusicBrainz edit-note field. No changes made. Copy the catalog number and include the Beatport source plus this script URL in your edit note.';
                return;
            }
            const input = empty[0];
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (setter) setter.call(input, data.catalog); else input.value = data.catalog;
            input.dispatchEvent(new Event('input', {bubbles: true}));
            input.dispatchEvent(new Event('change', {bubbles: true}));
            input.focus();
            message.textContent = 'Catalog field filled. Verify the label, continue the edit, and submit manually.';
        }, 'bpcnf-primary'));
        actions.append(button('Copy catalog', () => {
            if (navigator.clipboard?.writeText) navigator.clipboard.writeText(data.catalog).then(() => {message.textContent = 'Catalog number copied.';}).catch(() => {window.prompt('Copy catalog number:', data.catalog);});
            else window.prompt('Copy catalog number:', data.catalog);
        }));
        actions.append(button('Copy edit note', () => {
            const note = proposedEditNote(data);
            if (navigator.clipboard?.writeText) navigator.clipboard.writeText(note).then(() => {message.textContent = 'Edit note copied; preserve any existing note when pasting.';}).catch(() => {window.prompt('Copy edit note:', note);});
            else window.prompt('Copy edit note:', note);
        }));
        body.append(actions, message);
        panel.append(head, body);
        document.body.append(panel);
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
        globalThis.__BPCNF_TEST_HOOKS__ = {sameBarcode, normalizeCatalog, beatportUrl, releaseDetailsFromHtml, searchReleaseLinks, isDigital, catalogs, releaseLinks, reviewFinding, proposedEditNote};
    }
})();
