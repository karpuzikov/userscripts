// ==UserScript==
// @name         MusicBrainz - Harmony Importer
// @namespace    https://github.com/karpuzikov/userscripts
// @version      0.1.0
// @description  Harmony-style Apple Music lookup and MusicBrainz release import directly from MusicBrainz.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/*
// @connect      music.apple.com
// @connect      amp-api.music.apple.com
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/harmony-importer/MusicBrainz_Harmony_Importer.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/harmony-importer/MusicBrainz_Harmony_Importer.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/harmony-importer/MusicBrainz_Harmony_Importer.user.js';
    const APPLE = 'https://music.apple.com';
    const API = 'https://amp-api.music.apple.com/v1';
    const STREAMING_LINK_TYPE = '980';
    let token = '';

    const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
    const uniq = (v) => [...new Set(v.filter(Boolean))];
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    function request(url, headers = {}) {
        return new Promise((resolve, reject) => GM_xmlhttpRequest({
            method: 'GET', url, headers, timeout: 30000,
            onload: (r) => r.status >= 200 && r.status < 300 ? resolve(r.responseText) : reject(new Error(`HTTP ${r.status}`)),
            onerror: () => reject(new Error('Request failed')),
            ontimeout: () => reject(new Error('Request timed out')),
        }));
    }

    function jwtPayload(value) {
        try {
            const p = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            return JSON.parse(atob(p + '='.repeat((4 - p.length % 4) % 4)));
        } catch { return null; }
    }

    async function appleToken() {
        if (token && (!jwtPayload(token)?.exp || jwtPayload(token).exp > Date.now() / 1000 + 60)) return token;
        token = '';
        const html = await request(`${APPLE}/us/browse`);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const scripts = uniq([...doc.querySelectorAll('script[src]')].map(s => {
            try { return new URL(s.src || s.getAttribute('src'), APPLE).href; } catch { return ''; }
        }));
        for (const src of scripts) {
            let js;
            try { js = await request(src, { Referer: `${APPLE}/` }); } catch { continue; }
            for (const candidate of js.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
                const p = jwtPayload(candidate);
                if (p && (!p.exp || p.exp > Date.now() / 1000 + 60)) return token = candidate;
            }
        }
        throw new Error('Could not discover the current Apple Music API token.');
    }

    async function apple(path, storefront) {
        const auth = await appleToken();
        const url = new URL(path, `${API}/`);
        const text = await request(url.href, {
            Authorization: `Bearer ${auth}`,
            Origin: APPLE,
            Referer: `${APPLE}/${storefront}/browse`,
        });
        return JSON.parse(text);
    }

    function parseInput(input, storefront) {
        input = clean(input);
        if (/^https?:\/\//i.test(input)) {
            const u = new URL(input);
            if (!/(^|\.)music\.apple\.com$/i.test(u.hostname)) throw new Error('Only Apple Music URLs are supported in this first version.');
            const p = u.pathname.split('/').filter(Boolean);
            const i = p.indexOf('album');
            const id = p.slice(i + 1).reverse().find(x => /^\d+$/.test(x));
            if (i < 0 || !id) throw new Error('Could not find an Apple Music album ID.');
            return { type: 'id', value: id, storefront: /^[a-z]{2}$/i.test(p[0] || '') ? p[0].toLowerCase() : storefront };
        }
        const digits = input.replace(/[-\s]/g, '');
        if (/^\d{8,14}$/.test(digits)) return { type: 'barcode', value: digits, storefront };
        if (/^id:\d+$/i.test(input)) return { type: 'id', value: input.slice(3), storefront };
        throw new Error('Enter an Apple Music album URL, barcode, or id:123456789.');
    }

    async function albumById(id, storefront) {
        const data = await apple(`catalog/${storefront}/albums/${encodeURIComponent(id)}?include=artists,tracks`, storefront);
        const album = data?.data?.[0];
        if (!album) throw new Error('Apple Music album not found.');
        let tracks = [...(album.relationships?.tracks?.data || [])];
        let next = album.relationships?.tracks?.next || '';
        for (let n = 0; next && n < 20; n++) {
            const page = await apple(next, storefront);
            tracks.push(...(page.data || []));
            next = page.next || '';
        }
        if (!tracks.length) {
            const page = await apple(`catalog/${storefront}/albums/${id}/tracks?limit=100`, storefront);
            tracks = page.data || [];
        }
        return convert(album, tracks, storefront);
    }

    async function lookup(raw, storefront) {
        const q = parseInput(raw, storefront);
        if (q.type === 'id') return albumById(q.value, q.storefront);
        const data = await apple(`catalog/${q.storefront}/albums?filter[upc]=${encodeURIComponent(q.value)}&limit=25`, q.storefront);
        const found = data.data || [];
        if (!found.length) throw new Error(`No Apple Music release with barcode ${q.value} in ${q.storefront.toUpperCase()}.`);
        let chosen = found[0];
        if (found.length > 1) {
            const list = found.map((x, i) => `${i + 1}. ${clean(x.attributes?.name)} - ${clean(x.attributes?.artistName)} (${clean(x.attributes?.releaseDate)})`).join('\n');
            const pick = Number(prompt(`Multiple Apple Music releases matched:\n\n${list}\n\nEnter number:`, '1'));
            if (!Number.isInteger(pick) || pick < 1 || pick > found.length) throw new Error('No release selected.');
            chosen = found[pick - 1];
        }
        return albumById(String(chosen.id), q.storefront);
    }

    function artists(entity) {
        const related = entity.relationships?.artists?.data?.map(x => clean(x.attributes?.name)).filter(Boolean) || [];
        return related.length ? uniq(related) : (clean(entity.attributes?.artistName) ? [clean(entity.attributes.artistName)] : []);
    }

    function duration(ms) {
        if (!Number(ms)) return '';
        const s = Math.round(Number(ms) / 1000), m = Math.floor(s / 60);
        return `${m}:${String(s % 60).padStart(2, '0')}`;
    }

    function convert(album, tracks, storefront) {
        const a = album.attributes || {}, media = new Map();
        for (const t of tracks) {
            const x = t.attributes || {}, disc = Number(x.discNumber) || 1;
            if (!media.has(disc)) media.set(disc, []);
            media.get(disc).push({
                number: Number(x.trackNumber) || media.get(disc).length + 1,
                title: clean(x.name), artists: artists(t), length: duration(x.durationInMillis), isrc: clean(x.isrc),
            });
        }
        let source = a.url || `${APPLE}/${storefront}/album/${album.id}`;
        try { const u = new URL(source); u.search = ''; source = u.href; } catch {}
        return {
            id: String(album.id), storefront, source, title: clean(a.name), artists: artists(album),
            date: clean(a.releaseDate), label: clean(a.recordLabel), barcode: clean(a.upc),
            media: [...media.entries()].sort((x, y) => x[0] - y[0]).map(([number, list]) => ({ number, tracks: list.sort((x, y) => x.number - y.number) })),
        };
    }

    function artistCredit(params, prefix, names) {
        uniq(names.map(clean)).forEach((name, i, all) => {
            params.set(`${prefix}.names.${i}.name`, name);
            params.set(`${prefix}.names.${i}.artist.name`, name);
            if (i < all.length - 1) params.set(`${prefix}.names.${i}.join_phrase`, i === all.length - 2 ? ' & ' : ', ');
        });
    }

    function seed(release) {
        const p = new URLSearchParams();
        p.set('name', release.title); p.set('status', 'official'); p.set('packaging', 'None');
        if (release.artists.length) artistCredit(p, 'artist_credit', release.artists);
        if (release.barcode) p.set('barcode', release.barcode);
        const d = release.date.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
        if (d) {
            p.set('events.0.date.year', d[1]);
            if (d[2]) p.set('events.0.date.month', d[2]);
            if (d[3]) p.set('events.0.date.day', d[3]);
        }
        if (release.label) p.set('labels.0.name', release.label);
        release.media.forEach((m, mi) => {
            p.set(`mediums.${mi}.format`, 'Digital Media');
            m.tracks.forEach((t, ti) => {
                const b = `mediums.${mi}.track.${ti}`;
                p.set(`${b}.name`, t.title); p.set(`${b}.number`, String(t.number));
                if (t.length) p.set(`${b}.length`, t.length);
                if (t.artists.length) artistCredit(p, `${b}.artist_credit`, t.artists);
            });
        });
        p.set('urls.0.url', release.source); p.set('urls.0.link_type', STREAMING_LINK_TYPE);
        p.set('edit_note', `Imported from Apple Music: ${release.source}\n${release.barcode ? `Barcode: ${release.barcode}\n` : ''}Script: ${SCRIPT_URL}`);
        return p;
    }

    function importRelease(release) {
        const form = document.createElement('form');
        form.method = 'POST'; form.action = 'https://musicbrainz.org/release/add'; form.enctype = 'multipart/form-data'; form.target = '_blank'; form.hidden = true;
        for (const [name, value] of seed(release)) {
            const i = document.createElement('input'); i.type = 'hidden'; i.name = name; i.value = value; form.appendChild(i);
        }
        document.body.appendChild(form); form.submit(); form.remove();
    }

    async function duplicateCount(release) {
        if (!release.barcode) return null;
        const u = new URL('/ws/2/release/', location.origin); u.searchParams.set('query', `barcode:${release.barcode}`); u.searchParams.set('fmt', 'json');
        const r = await fetch(u); if (!r.ok) return null; return (await r.json()).count ?? null;
    }

    function copyIsrcs(release) {
        const list = release.media.flatMap(m => m.tracks.map(t => t.isrc).filter(Boolean));
        if (!list.length) return alert('No ISRCs returned.');
        GM_setClipboard(list.join('\n'), 'text'); alert(`Copied ${list.length} ISRC${list.length === 1 ? '' : 's'}.`);
    }

    function searchMB(release) {
        const u = new URL('https://musicbrainz.org/search');
        u.searchParams.set('query', release.barcode ? `barcode:${release.barcode}` : `${release.title} ${release.artists[0] || ''}`);
        u.searchParams.set('type', 'release'); u.searchParams.set('method', 'indexed'); window.open(u, '_blank', 'noopener');
    }

    function closePanel() { document.getElementById('mbhi-panel')?.remove(); }

    async function show(release) {
        closePanel();
        const dupes = await duplicateCount(release).catch(() => null);
        const isrcs = release.media.flatMap(m => m.tracks.map(t => t.isrc).filter(Boolean)).length;
        const tracks = release.media.flatMap(m => m.tracks);
        const panel = document.createElement('div'); panel.id = 'mbhi-panel';
        panel.innerHTML = `<button id="mbhi-x">x</button><h2>${esc(release.title)}</h2><b>Artist:</b> ${esc(release.artists.join(', ') || '[unknown]')}<br><b>Date:</b> ${esc(release.date || '[unknown]')}<br><b>Label:</b> ${esc(release.label || '[unknown]')}<br><b>Barcode:</b> ${esc(release.barcode || '[unknown]')}<br><b>Storefront:</b> ${esc(release.storefront.toUpperCase())}<br><b>Tracks:</b> ${tracks.length} | <b>ISRCs:</b> ${isrcs}<br><b>MusicBrainz barcode matches:</b> ${dupes ?? 'not checked'}<div class="mbhi-actions"><button id="mbhi-import">Import into MusicBrainz</button><button id="mbhi-search">Search MusicBrainz</button><button id="mbhi-copy">Copy ISRCs</button><button id="mbhi-apple">Open Apple Music</button></div><details><summary>Tracklist</summary><ol>${tracks.map(t => `<li>${esc(t.title)} - ${esc(t.artists.join(', '))}${t.isrc ? ` [${esc(t.isrc)}]` : ''}</li>`).join('')}</ol></details>`;
        document.body.appendChild(panel);
        panel.querySelector('#mbhi-x').onclick = closePanel;
        panel.querySelector('#mbhi-import').onclick = () => importRelease(release);
        panel.querySelector('#mbhi-search').onclick = () => searchMB(release);
        panel.querySelector('#mbhi-copy').onclick = () => copyIsrcs(release);
        panel.querySelector('#mbhi-apple').onclick = () => window.open(release.source, '_blank', 'noopener');
        if (dupes > 0) panel.style.borderColor = '#b77b00';
    }

    async function start() {
        try {
            const raw = prompt('Apple Music album URL or barcode:'); if (!raw) return;
            let sf = localStorage.getItem('mbhi-storefront') || 'us';
            if (!/^https?:\/\//i.test(raw)) {
                sf = clean(prompt('Apple Music storefront (2-letter code):', sf) || sf).toLowerCase();
                if (!/^[a-z]{2}$/.test(sf)) throw new Error('Invalid storefront code.');
                localStorage.setItem('mbhi-storefront', sf);
            }
            const button = document.getElementById('mbhi-launch'); button.textContent = 'Loading...'; button.disabled = true;
            const release = await lookup(raw, sf); await show(release);
        } catch (e) { alert(`Harmony Import: ${e.message || e}`); }
        finally { const b = document.getElementById('mbhi-launch'); if (b) { b.textContent = 'Harmony Import'; b.disabled = false; } }
    }

    const style = document.createElement('style');
    style.textContent = '#mbhi-launch{position:fixed;right:18px;bottom:18px;z-index:99999;padding:7px 11px;background:#ffd66b;border:1px solid #8b6b21;border-radius:5px;cursor:pointer;font-weight:bold}#mbhi-panel{position:fixed;right:18px;bottom:58px;z-index:99999;width:min(620px,90vw);max-height:75vh;overflow:auto;background:#fff;color:#222;border:2px solid #777;border-radius:6px;padding:12px;box-shadow:0 4px 22px #0006;font:14px/1.4 Arial}#mbhi-panel h2{margin:0 30px 8px 0}#mbhi-x{position:absolute;right:8px;top:8px}.mbhi-actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.mbhi-actions button{padding:5px 8px;cursor:pointer}';
    document.head.appendChild(style);
    const launch = document.createElement('button'); launch.id = 'mbhi-launch'; launch.textContent = 'Harmony Import'; launch.onclick = start; document.body.appendChild(launch);
    if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Harmony Import', start);
})();