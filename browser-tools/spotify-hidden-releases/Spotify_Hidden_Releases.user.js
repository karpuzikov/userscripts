// ==UserScript==
// @name         Spotify Hidden Releases
// @namespace    https://github.com/karpuzikov/userscripts
// @version      0.1.0
// @description  Finds Spotify releases missing from an artist's visible discography, including indexed unlisted and region-restricted releases.
// @author       karpuzikov
// @match        https://open.spotify.com/artist/*
// @match        https://open.spotify.com/intl-*/artist/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @connect      www.google.com
// @connect      www.bing.com
// @connect      html.duckduckgo.com
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/spotify-hidden-releases/Spotify_Hidden_Releases.user.js
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/spotify-hidden-releases/Spotify_Hidden_Releases.user.js
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '0.1.0';
    const CACHE_HOURS = 24;
    const BTN_ID = 'kz-shr-button';
    const MODAL_ID = 'kz-shr-modal';
    const albumUrl = id => `https://open.spotify.com/album/${id}`;
    const embedUrl = id => `https://open.spotify.com/embed/album/${id}`;
    let state = null;

    function artistId() {
        return location.pathname.match(/\/artist\/([A-Za-z0-9]{22})(?:\/|$)/)?.[1] || null;
    }

    function artistName() {
        return document.querySelector('main h1, h1')?.textContent?.trim()
            || document.querySelector('meta[property="og:title"]')?.content?.replace(/\s*\|\s*Spotify\s*$/i, '').trim()
            || document.title.replace(/\s*[-|]\s*Spotify\s*$/i, '').trim();
    }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function norm(s) {
        return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }

    function extractIds(text) {
        const ids = new Set();
        const decoded = [String(text || '')];
        try { decoded.push(decodeURIComponent(decoded[0].replace(/&amp;/g, '&'))); } catch {}
        for (const s of decoded) {
            const re = /(?:https?:\/\/open\.spotify\.com)?(?:\/intl-[a-z]{2,3})?\/album\/([A-Za-z0-9]{22})/gi;
            let m;
            while ((m = re.exec(s))) ids.add(m[1]);
        }
        return ids;
    }

    function gmGet(url) {
        return new Promise((resolve, reject) => GM_xmlhttpRequest({
            method: 'GET', url, timeout: 25000,
            headers: {'Accept':'text/html,application/xhtml+xml','Accept-Language':'en-US,en;q=0.9'},
            onload: r => r.status >= 200 && r.status < 400 ? resolve(r.responseText || '') : reject(new Error(`HTTP ${r.status}`)),
            onerror: () => reject(new Error('Network error')),
            ontimeout: () => reject(new Error('Timeout'))
        }));
    }

    async function spotifyGet(url) {
        const r = await fetch(url, {credentials:'include', cache:'no-store', headers:{Accept:'text/html'}});
        if (!r.ok) throw new Error(`Spotify HTTP ${r.status}`);
        return r.text();
    }

    function parseMeta(html, id) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const og = p => doc.querySelector(`meta[property="${p}"]`)?.content?.trim() || '';
        let title = og('og:title').replace(/\s*[-|]\s*Spotify\s*$/i, '').trim();
        const desc = og('og:description');
        const image = og('og:image');
        let artist = '';
        const ma = desc.match(/^(.+?)\s*[\u00b7\u2022-]\s*(?:Album|EP|Single)\b/i);
        if (ma) artist = ma[1].trim();
        if (!title) title = `Spotify album ${id}`;
        const mt = desc.match(/(?:^|[\u00b7\u2022-]\s*)(Album|EP|Single)(?:\s*[\u00b7\u2022-]|$)/i);
        const md = desc.match(/\b(19|20)\d{2}(?:-\d{2}-\d{2})?\b/);
        const tracks = desc.match(/\b(\d+)\s+(?:songs?|tracks?)\b/i);
        return {id, title, artist, image, description:desc, type:mt?.[1] || '', date:md?.[0] || '', tracks:tracks?.[1] || ''};
    }

    async function visibleIds(id) {
        const found = new Set(extractIds(document.documentElement.innerHTML));
        const paths = [
            `/artist/${id}/discography/all`, `/artist/${id}/discography/album`,
            `/artist/${id}/discography/single`, `/artist/${id}/discography/compilation`
        ];
        for (const path of paths) {
            try {
                const html = await spotifyGet(path);
                extractIds(html).forEach(x => found.add(x));
            } catch {}
        }
        return found;
    }

    function searchUrl(engine, query, page = 0) {
        const q = encodeURIComponent(query);
        if (engine === 'Google') return `https://www.google.com/search?q=${q}&num=100&filter=0`;
        if (engine === 'Bing') return `https://www.bing.com/search?q=${q}&count=50&first=${page * 50 + 1}`;
        return `https://html.duckduckgo.com/html/?q=${q}`;
    }

    async function discover(name, setStatus) {
        const candidateSources = new Map();
        const errors = {};
        const query = `site:open.spotify.com/album "${name.replace(/"/g, '')}"`;
        const jobs = [
            ['Google', searchUrl('Google', query)],
            ['Bing', searchUrl('Bing', query, 0)],
            ['Bing', searchUrl('Bing', query, 1)],
            ['DuckDuckGo', searchUrl('DuckDuckGo', query)]
        ];
        let done = 0;
        for (const [source, url] of jobs) {
            setStatus(`Searching public indexes...`, `${source} ${done + 1}/${jobs.length}`, 20 + done * 10);
            try {
                const html = await gmGet(url);
                const ids = extractIds(html);
                if (!ids.size) throw new Error('No Spotify album IDs returned');
                ids.forEach(id => {
                    const list = candidateSources.get(id) || [];
                    if (!list.includes(source)) list.push(source);
                    candidateSources.set(id, list);
                });
            } catch (e) {
                errors[source] = e.message;
            }
            done++;
        }
        return {candidateSources, errors};
    }

    async function verify(id, expectedArtist) {
        let html = '';
        try { html = await spotifyGet(embedUrl(id)); }
        catch { try { html = await spotifyGet(albumUrl(id)); } catch { return null; } }
        const meta = parseMeta(html, id);
        const expected = norm(expectedArtist);
        const hay = norm(`${meta.artist} ${meta.description}`);
        meta.artistMatch = expected && hay.includes(expected);
        try {
            const direct = await spotifyGet(albumUrl(id));
            meta.marketRestricted = /(?:restriction.{0,80}reason.{0,30}market|reason.{0,30}market|not available in your (?:country|region)|is not available in your (?:country|region))/i.test(direct);
        } catch {
            meta.marketRestricted = true;
        }
        return meta;
    }

    const key = (kind, id) => `spotify-hidden-releases:${kind}:v1:${id}`;
    const readManual = id => GM_getValue(key('manual', id), []);
    const writeManual = (id, ids) => GM_setValue(key('manual', id), ids);
    const readCache = id => GM_getValue(key('cache', id), null);
    const writeCache = (id, data) => GM_setValue(key('cache', id), data);

    function css() {
        if (document.getElementById('kz-shr-css')) return;
        const s = document.createElement('style');
        s.id = 'kz-shr-css';
        s.textContent = `
#${BTN_ID}{border:0;border-radius:999px;background:#1ed760;color:#000;font:700 14px Arial;padding:11px 18px;margin-left:12px;cursor:pointer}#${BTN_ID}:hover{background:#3be477}
#${MODAL_ID}{position:fixed;inset:0;z-index:2147483646;background:#000b;display:grid;place-items:center;padding:20px;color:#fff;font:13px Arial}#${MODAL_ID}[hidden]{display:none}
.kzshr-panel{width:min(1050px,96vw);max-height:90vh;background:#121212;border:1px solid #333;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 80px #000}
.kzshr-head,.kzshr-tools,.kzshr-status{padding:14px 18px;border-bottom:1px solid #292929}.kzshr-head{display:flex;align-items:center;gap:12px}.kzshr-head b{font-size:21px}.kzshr-head span{color:#999;margin-right:auto}.kzshr-x,.kzshr-btn{border:1px solid #444;border-radius:999px;background:#252525;color:#fff;padding:9px 13px;font-weight:700;cursor:pointer}.kzshr-btn:hover,.kzshr-x:hover{background:#333}.kzshr-primary{background:#1ed760;color:#000;border-color:#1ed760}.kzshr-tools{display:grid;grid-template-columns:1fr 1fr auto;gap:9px}.kzshr-input{min-width:0;background:#202020;color:#fff;border:1px solid #444;border-radius:8px;padding:10px 11px}.kzshr-status b{display:block}.kzshr-status small{color:#aaa}.kzshr-bar{height:4px;background:#292929;margin-top:9px;border-radius:9px;overflow:hidden}.kzshr-bar i{display:block;height:100%;width:0;background:#1ed760;transition:.2s}.kzshr-note{padding:10px 18px;color:#aaa;border-bottom:1px solid #292929;line-height:1.4}.kzshr-list{overflow:auto;padding:12px 18px 18px;display:grid;gap:9px}.kzshr-card{display:grid;grid-template-columns:64px 1fr auto;gap:12px;align-items:center;background:#191919;border:1px solid #2e2e2e;border-radius:10px;padding:10px}.kzshr-cover{width:64px;height:64px;object-fit:cover;border-radius:6px;background:#292929}.kzshr-title{font-size:15px;font-weight:800}.kzshr-meta{color:#aaa;margin-top:4px}.kzshr-badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.kzshr-badge{background:#303030;border-radius:999px;padding:3px 7px;font-size:11px}.kzshr-market{background:#563300;color:#ffd28a}.kzshr-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.kzshr-empty{padding:35px;text-align:center;color:#aaa}.kzshr-warn{color:#ffb86b}.kzshr-err{padding:8px 18px;color:#ff9c9c;border-bottom:1px solid #292929}
@media(max-width:720px){.kzshr-tools{grid-template-columns:1fr}.kzshr-card{grid-template-columns:52px 1fr}.kzshr-cover{width:52px;height:52px}.kzshr-actions{grid-column:1/-1;justify-content:flex-start}}
`;
        document.head.appendChild(s);
    }

    function modal() {
        css();
        let m = document.getElementById(MODAL_ID);
        if (m) return m;
        m = document.createElement('div');
        m.id = MODAL_ID; m.hidden = true;
        m.innerHTML = `<div class="kzshr-panel">
<div class="kzshr-head"><b>Spotify Hidden Releases</b><span>v${VERSION} - Under construction</span><button class="kzshr-x">X</button></div>
<div class="kzshr-tools"><input id="kzshr-filter" class="kzshr-input" placeholder="Filter found releases"><input id="kzshr-manual" class="kzshr-input" placeholder="Known hidden Spotify album URL or 22-character ID"><button id="kzshr-add" class="kzshr-btn">Save hidden ID</button></div>
<div class="kzshr-status"><b id="kzshr-st">Ready.</b><small id="kzshr-detail"></small><div class="kzshr-bar"><i id="kzshr-progress"></i></div></div>
<div class="kzshr-note">Scans public web indexes for Spotify album IDs, then removes releases already present in this artist's visible Spotify discography. A truly unindexed release cannot be discovered from the artist ID alone; paste its Spotify URL/ID above once known.</div>
<div id="kzshr-errors"></div><div id="kzshr-list" class="kzshr-list"></div></div>`;
        document.body.appendChild(m);
        m.querySelector('.kzshr-x').onclick = () => { m.hidden = true; };
        m.addEventListener('click', e => { if (e.target === m) m.hidden = true; });
        m.querySelector('#kzshr-filter').addEventListener('input', render);
        m.querySelector('#kzshr-add').onclick = saveManual;
        return m;
    }

    function setStatus(a, b = '', p = 0) {
        modal().querySelector('#kzshr-st').textContent = a;
        modal().querySelector('#kzshr-detail').textContent = b;
        modal().querySelector('#kzshr-progress').style.width = `${Math.max(0, Math.min(100, p))}%`;
    }

    function render() {
        const m = modal();
        const list = m.querySelector('#kzshr-list');
        const errors = m.querySelector('#kzshr-errors');
        const q = norm(m.querySelector('#kzshr-filter').value);
        if (!state) { list.innerHTML = '<div class="kzshr-empty">Run a scan from an artist page.</div>'; return; }
        const err = Object.entries(state.errors || {});
        errors.innerHTML = err.length ? `<div class="kzshr-err">Partial search: ${esc(err.map(([k,v]) => `${k}: ${v}`).join('; '))}</div>` : '';
        const rows = state.results.filter(x => !q || norm(`${x.title} ${x.artist} ${x.id} ${(x.sources||[]).join(' ')}`).includes(q));
        if (!rows.length) { list.innerHTML = `<div class="kzshr-empty">${q ? 'No matches for this filter.' : 'No hidden releases found by the available indexes.'}</div>`; return; }
        list.innerHTML = rows.map(x => {
            const meta = [x.artist, x.type, x.date, x.tracks ? `${x.tracks} tracks` : '', `Spotify ID: ${x.id}`].filter(Boolean).join(' - ');
            const badges = [
                '<span class="kzshr-badge">Hidden from visible discography</span>',
                x.marketRestricted ? '<span class="kzshr-badge kzshr-market">Market restriction detected</span>' : '',
                x.manual ? '<span class="kzshr-badge">Saved manually</span>' : '',
                ...(x.sources || []).filter(s => s !== 'Manual').map(s => `<span class="kzshr-badge">${esc(s)}</span>`)
            ].join('');
            return `<div class="kzshr-card" data-id="${x.id}">${x.image ? `<img class="kzshr-cover" src="${esc(x.image)}">` : '<div class="kzshr-cover"></div>'}<div><div class="kzshr-title">${esc(x.title)}</div><div class="kzshr-meta">${esc(meta)}</div><div class="kzshr-badges">${badges}</div></div><div class="kzshr-actions"><a class="kzshr-btn kzshr-primary" target="_blank" rel="noopener" href="${albumUrl(x.id)}">Open Spotify</a><a class="kzshr-btn" target="_blank" rel="noopener" href="${embedUrl(x.id)}">Open embed</a><button class="kzshr-btn kzshr-copy" data-url="${albumUrl(x.id)}">Copy URL</button>${x.manual ? `<button class="kzshr-btn kzshr-forget" data-id="${x.id}">Forget</button>` : ''}</div></div>`;
        }).join('');
        list.querySelectorAll('.kzshr-copy').forEach(b => b.onclick = () => { GM_setClipboard(b.dataset.url, 'text'); b.textContent='Copied'; setTimeout(()=>b.textContent='Copy URL',700); });
        list.querySelectorAll('.kzshr-forget').forEach(b => b.onclick = () => forgetManual(b.dataset.id));
    }

    async function scan(force = false) {
        const id = artistId(), name = artistName();
        if (!id || !name) return;
        const m = modal(); m.hidden = false;
        const cached = readCache(id);
        if (!force && cached?.time && Date.now() - cached.time < CACHE_HOURS * 3600000) {
            state = cached.state;
            setStatus(`Loaded ${state.results.length} cached hidden release${state.results.length === 1 ? '' : 's'}.`, `Cache is less than ${CACHE_HOURS} hours old.`, 100);
            render();
            return;
        }
        setStatus('Reading visible Spotify discography...', name, 5);
        const visible = await visibleIds(id);
        setStatus('Searching public indexes...', `${visible.size} visible album IDs found`, 18);
        const {candidateSources, errors} = await discover(name, setStatus);
        for (const manualId of readManual(id)) candidateSources.set(manualId, ['Manual', ...(candidateSources.get(manualId) || [])]);
        const candidates = [...candidateSources.keys()].filter(x => !visible.has(x));
        const results = [];
        for (let i = 0; i < candidates.length; i++) {
            const cid = candidates[i];
            setStatus('Verifying hidden Spotify releases...', `${i + 1}/${candidates.length}`, 55 + Math.round((i / Math.max(1, candidates.length)) * 40));
            const meta = await verify(cid, name);
            if (!meta) continue;
            const manual = readManual(id).includes(cid);
            if (!manual && !meta.artistMatch) continue;
            results.push({...meta, hidden:true, manual, sources:candidateSources.get(cid) || []});
        }
        results.sort((a,b) => Number(b.marketRestricted)-Number(a.marketRestricted) || String(b.date).localeCompare(String(a.date)) || a.title.localeCompare(b.title));
        state = {artistId:id, artistName:name, visible:[...visible], results, errors};
        writeCache(id, {time:Date.now(), state});
        setStatus(`Found ${results.length} hidden release${results.length === 1 ? '' : 's'}.`, `${visible.size} visible IDs checked; ${candidateSources.size} indexed candidates verified.`, 100);
        render();
    }

    async function saveManual() {
        const id = artistId();
        const input = modal().querySelector('#kzshr-manual');
        const aid = String(input.value || '').match(/(?:album\/)?([A-Za-z0-9]{22})(?:[/?#]|$)/)?.[1];
        if (!id || !aid) { setStatus('Invalid Spotify album URL or ID.', 'Expected a 22-character album ID.', 100); return; }
        const ids = readManual(id);
        if (!ids.includes(aid)) { ids.push(aid); writeManual(id, ids); }
        input.value = '';
        setStatus('Verifying saved hidden release...', aid, 70);
        const meta = await verify(aid, artistName());
        if (!meta) { setStatus('Spotify album could not be verified.', aid, 100); return; }
        if (!state) state = {artistId:id, artistName:artistName(), visible:[], results:[], errors:{}};
        state.results = state.results.filter(x => x.id !== aid);
        state.results.push({...meta, hidden:!new Set(state.visible).has(aid), manual:true, sources:['Manual']});
        writeCache(id, {time:Date.now(), state});
        setStatus('Saved hidden release.', meta.title, 100); render();
    }

    function forgetManual(aid) {
        const id = artistId(); if (!id) return;
        writeManual(id, readManual(id).filter(x => x !== aid));
        if (state) state.results = state.results.filter(x => x.id !== aid || (x.sources || []).some(s => s !== 'Manual'));
        writeCache(id, {time:Date.now(), state}); render();
    }

    function inject() {
        const id = artistId();
        if (!id) { document.getElementById(BTN_ID)?.remove(); return; }
        if (document.getElementById(BTN_ID)) return;
        css();
        const b = document.createElement('button');
        b.id = BTN_ID; b.textContent = 'Show hidden releases'; b.title = 'Find region-restricted and unlisted Spotify releases missing from this artist discography';
        b.onclick = e => { e.preventDefault(); e.stopPropagation(); scan(false); };
        const h1 = document.querySelector('main h1, h1');
        const target = h1?.parentElement || document.querySelector('main');
        if (target) target.appendChild(b);
        else { b.style.cssText += ';position:fixed;right:24px;bottom:88px;z-index:9999'; document.body.appendChild(b); }
    }

    const observer = new MutationObserver(inject);
    observer.observe(document.documentElement, {childList:true, subtree:true});
    setInterval(inject, 1200);
    inject();
})();
