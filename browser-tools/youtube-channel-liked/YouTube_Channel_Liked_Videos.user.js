// ==UserScript==
// @name         YouTube - Channel Liked Videos
// @namespace    youtube-channel-liked
// @version      1.0.0
// @description  Adds a Liked tab to YouTube channels and shows your liked videos from that channel.
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';
    const TAB = 'ycl-liked-tab', PANEL = 'ycl-liked-panel', ACTIVE = 'ycl-active';
    const UC = /^UC[A-Za-z0-9_-]{22}$/;
    const VID = /^[A-Za-z0-9_-]{11}$/;
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    let active = null, scheduled = false;

    function* nodes(root, key) {
        if (!root || typeof root !== 'object') return;
        if (Object.hasOwn(root, key)) yield root[key];
        for (const value of Object.values(root)) {
            if (value && typeof value === 'object') yield* nodes(value, key);
        }
    }
    const first = (root, key) => nodes(root, key).next().value;
    const text = v => typeof v === 'string' ? v : v?.simpleText ?? v?.content ?? v?.runs?.map(r => r.text || '').join('') ?? '';
    function channelPath(value) {
        if (!value) return '';
        try {
            const u = new URL(value, location.origin);
            if (u.hostname !== 'www.youtube.com' && u.hostname !== 'youtube.com') return '';
            const p = decodeURIComponent(u.pathname).match(/^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)/i)?.[0];
            if (!p) return '';
            return p.startsWith('/channel/') ? p : p.toLowerCase();
        } catch { return ''; }
    }
    function identity(root) {
        const ids = new Set(), paths = new Set();
        for (const endpoint of nodes(root, 'browseEndpoint')) {
            if (UC.test(endpoint?.browseId || '')) ids.add(endpoint.browseId);
            const p = channelPath(endpoint?.canonicalBaseUrl);
            if (p) paths.add(p);
        }
        for (const metadata of nodes(root, 'webCommandMetadata')) {
            const p = channelPath(metadata?.url);
            if (p) paths.add(p);
        }
        for (const p of paths) if (UC.test(p.slice(9)) && p.startsWith('/channel/')) ids.add(p.slice(9));
        return {ids, paths};
    }
    function initialData(html) {
        const match = /(?:\bvar\s+ytInitialData\s*=|\bwindow\s*\[\s*["']ytInitialData["']\s*\]\s*=|\bytInitialData\s*=)\s*(\{)/.exec(html);
        if (!match) throw new Error('YouTube page data was not found.');
        const start = match.index + match[0].length - 1;
        let depth = 0, quote = false, escape = false;
        for (let i = start; i < html.length; i++) {
            const ch = html[i];
            if (quote) {
                if (escape) escape = false;
                else if (ch === '\\') escape = true;
                else if (ch === '"') quote = false;
            } else if (ch === '"') quote = true;
            else if (ch === '{') depth++;
            else if (ch === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
        }
        throw new Error('Incomplete YouTube page data.');
    }
    function config(key) { return window.ytcfg?.get?.(key); }
    function account() { return [config('SESSION_INDEX'), config('DATASYNC_ID'), config('DELEGATED_SESSION_ID')].join('|'); }
    function check(run) {
        if (active !== run || run.controller.signal.aborted || account() !== run.account) throw new DOMException('Cancelled', 'AbortError');
    }
    async function getPage(path, run) {
        check(run);
        const response = await fetch(path, {credentials: 'same-origin', cache: 'no-store', signal: run.controller.signal});
        if (!response.ok) throw new Error(`YouTube returned HTTP ${response.status}.`);
        if (new URL(response.url).origin !== location.origin) throw new Error('Sign in to YouTube first.');
        return initialData(await response.text());
    }
    async function authorization() {
        // Same-origin authentication, as used by YouTube's web client. Never transmitted elsewhere.
        const cookies = Object.fromEntries(document.cookie.split(/;\s*/).map(c => {
            const i = c.indexOf('='); return i < 0 ? [c, ''] : [c.slice(0, i), c.slice(i + 1)];
        }));
        const timestamp = Math.floor(Date.now() / 1000);
        const hash = async (scheme, value) => {
            if (!value) return '';
            const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${timestamp} ${value} ${location.origin}`));
            return `${scheme} ${timestamp}_${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`;
        };
        return (await Promise.all([
            hash('SAPISIDHASH', cookies.SAPISID || cookies['__Secure-3PAPISID']),
            hash('SAPISID1PHASH', cookies['__Secure-1PAPISID']),
            hash('SAPISID3PHASH', cookies['__Secure-3PAPISID'])
        ])).filter(Boolean).join(' ');
    }
    async function browse(continuation, run) {
        check(run);
        const context = config('INNERTUBE_CONTEXT');
        if (!context?.client) throw new Error('YouTube client is not ready. Reload the page.');
        const headers = {'Content-Type': 'application/json', 'X-Origin': location.origin};
        const optional = {
            'X-Youtube-Client-Name': config('INNERTUBE_CONTEXT_CLIENT_NAME'),
            'X-Youtube-Client-Version': context.client.clientVersion,
            'X-Goog-Visitor-Id': context.client.visitorData || config('VISITOR_DATA'),
            'X-Goog-AuthUser': config('SESSION_INDEX') ?? 0,
            'X-Goog-PageId': config('DELEGATED_SESSION_ID'),
            'Authorization': await authorization()
        };
        for (const [k, v] of Object.entries(optional)) if (v !== undefined && v !== null && v !== '') headers[k] = String(v);
        const url = new URL('/youtubei/v1/browse', location.origin);
        const key = config('INNERTUBE_API_KEY');
        if (key) url.searchParams.set('key', key);
        url.searchParams.set('prettyPrint', 'false');
        for (let attempt = 0; attempt < 3; attempt++) {
            check(run);
            const response = await fetch(url, {method:'POST', credentials:'same-origin', headers, signal:run.controller.signal, body:JSON.stringify({context, continuation})});
            if (response.ok) return response.json();
            if (response.status !== 429 && response.status < 500 || attempt === 2) throw new Error(`YouTube returned HTTP ${response.status}.`);
            await sleep(1000 * (attempt + 1));
        }
    }
    function pageItems(data, initial) {
        if (initial) {
            const list = first(data.contents, 'playlistVideoListRenderer');
            if (Array.isArray(list?.contents)) return list.contents;
            // Alternate playlist list wrapper; do not scan unrelated recommendations.
            const selected = [...nodes(data.contents, 'tabRenderer')].find(t => t.selected);
            const content = selected?.content || data.contents;
            const candidates = [...nodes(content, 'itemSectionRenderer')].map(x => x.contents).filter(Array.isArray);
            const items = candidates.find(a => a.some(x => x.playlistVideoRenderer || x.lockupViewModel || x.continuationItemRenderer));
            if (items) return items;
            const alert = first(data.alerts, 'alertRenderer');
            throw new Error(text(alert?.text) || 'Liked videos playlist unavailable or its format has changed.');
        }
        const old = first(data.continuationContents, 'playlistVideoListContinuation');
        if (Array.isArray(old?.contents)) return old.contents;
        const actions = [...(data.onResponseReceivedActions || []), ...(data.onResponseReceivedEndpoints || []), ...(data.onResponseReceivedCommands || [])];
        const groups = actions.flatMap(a => [a.appendContinuationItemsAction?.continuationItems, a.reloadContinuationItemsCommand?.continuationItems]).filter(Array.isArray);
        if (!groups.length) throw new Error('YouTube did not return the next playlist page.');
        return groups.flat();
    }
    function parseItem(item) {
        const p = item.playlistVideoRenderer || item.playlistPanelVideoRenderer || item.videoRenderer;
        const l = item.lockupViewModel || item.shortsLockupViewModel;
        let id, title, author, duration, thumb, shorts = false, info = '';
        if (p) {
            id = p.videoId;
            title = text(p.title);
            author = identity([p.shortBylineText, p.longBylineText, p.ownerText]);
            duration = text(p.lengthText) || text(first(p.thumbnailOverlays, 'thumbnailOverlayTimeStatusRenderer')?.text);
            thumb = p.thumbnail?.thumbnails?.at(-1)?.url;
            shorts = !!first(p.navigationEndpoint, 'reelWatchEndpoint');
            info = text(p.videoInfo);
        } else if (l) {
            const watch = first(l.rendererContext, 'watchEndpoint') || first(l.onTap, 'watchEndpoint');
            const reel = first(l, 'reelWatchEndpoint');
            shorts = !!reel || /SHORTS/.test(l.contentType || '');
            if (!shorts && !watch && l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
            id = watch?.videoId || reel?.videoId || l.contentId;
            const metadata = l.metadata?.lockupMetadataViewModel;
            title = text(metadata?.title) || text(l.overlayMetadata?.primaryText);
            author = identity(metadata?.metadata || l.overlayMetadata);
            const image = l.contentImage?.thumbnailViewModel || l.contentImage;
            thumb = image?.image?.sources?.at(-1)?.url || first(image, 'sources')?.at(-1)?.url;
            duration = [...nodes(image, 'thumbnailBadgeViewModel')].map(x => text(x.text)).find(x => /^\d+(?::\d+)+$/.test(x)) || '';
        } else return null;
        if (!VID.test(id || '')) return null;
        return {id, title: title || 'Unavailable video', author, duration, thumb, shorts, info};
    }
    function continuationToken(items) {
        for (const item of items) {
            const renderer = item.continuationItemRenderer || item.continuationItemViewModel;
            const token = first(renderer, 'continuationCommand')?.token;
            if (token) return token;
        }
        return '';
    }
    function channelMeta(data) {
        const m = data?.metadata?.channelMetadataRenderer;
        if (!m || !UC.test(m.externalId || '')) return null;
        const paths = new Set([m.channelUrl, m.vanityChannelUrl, ...(m.ownerUrls || [])].map(channelPath).filter(Boolean));
        return {ids:new Set([m.externalId]), paths};
    }
    async function resolveChannel(run) {
        const live = run.page.data;
        // Fetch the current route to avoid stale SPA data from a previously visited channel.
        const data = await getPage(location.pathname + location.search, run);
        const target = channelMeta(data) || channelMeta(live?.response) || channelMeta(live);
        if (!target) throw new Error('Could not identify this channel.');
        target.paths.add(run.path);
        return target;
    }
    function matches(author, target) {
        if (author.ids.size) return [...author.ids].some(id => target.ids.has(id));
        return [...author.paths].some(p => target.paths.has(p));
    }
    function element(tag, className, label) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        if (label !== undefined) e.textContent = label;
        return e;
    }
    function addCard(run, v) {
        const card = element('a','ycl-card');
        card.href = v.shorts ? `/shorts/${v.id}` : `/watch?v=${v.id}`;
        const image = element('div','ycl-thumb');
        const img = element('img'); img.loading = 'lazy'; img.alt = '';
        // Only use YouTube's own thumbnail host, or a deterministic fallback.
        try { const u = new URL(v.thumb, location.origin); if (u.protocol === 'https:' && /(^|\.)ytimg\.com$/.test(u.hostname)) img.src = u.href; } catch {}
        if (!img.getAttribute('src')) img.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`;
        image.append(img);
        if (v.duration) image.append(element('span','ycl-duration',v.duration));
        card.append(image, element('div','ycl-title',v.title));
        if (v.info) card.append(element('div','ycl-info',v.info));
        run.grid.append(card);
    }
    async function load(run) {
        let scanned = 0, found = 0, unknown = 0;
        try {
            if (config('LOGGED_IN') === false) throw new Error('Sign in to YouTube first.');
            const target = await resolveChannel(run);
            let data = await getPage('/playlist?list=LL', run), initial = true;
            const seen = new Set(), tokens = new Set();
            for (;;) {
                check(run);
                const items = pageItems(data, initial);
                for (const item of items) {
                    const v = parseItem(item);
                    if (!v || seen.has(v.id)) continue;
                    seen.add(v.id); scanned++;
                    if (matches(v.author, target)) { found++; addCard(run, v); }
                    else if (!v.author.ids.size && !v.author.paths.size) unknown++;
                }
                const token = continuationToken(items);
                run.status.textContent = `${found} liked · Checking ${scanned.toLocaleString()} videos…`;
                if (!token) break;
                if (tokens.has(token)) throw new Error('YouTube repeated a playlist page.');
                tokens.add(token);
                await sleep(120);
                data = await browse(token, run); initial = false;
            }
            check(run);
            run.status.textContent = found ? `${found} liked video${found === 1 ? '' : 's'}` : 'No liked videos found on this channel.';
            if (unknown) run.status.textContent += ` · ${unknown} playlist entries had no channel ID or link.`;
        } catch (error) {
            if (error.name === 'AbortError' || active !== run) return;
            run.status.textContent = `${found ? `${found} found · ` : ''}${error.message} Results may be incomplete.`;
            const retry = element('button','ycl-retry','Retry');
            retry.onclick = () => { const {page, group, tab} = run; close(); open(page, group, tab); };
            run.status.append(' ', retry);
        }
    }
    function close() {
        if (!active) return;
        const run = active; active = null;
        run.controller.abort();
        run.content.classList.remove('ycl-hidden');
        run.group.classList.remove(ACTIVE);
        run.tab.setAttribute('aria-selected','false');
        run.panel.remove();
    }
    function open(page, group, tab) {
        if (active) return;
        const path = channelPath(location.pathname);
        const content = page.querySelector(':scope > ytd-two-column-browse-results-renderer') || page.querySelector('ytd-two-column-browse-results-renderer');
        if (!path || !content) return;
        const panel = element('section'); panel.id = PANEL; panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby',TAB);
        const status = element('div','ycl-status','Loading liked videos…'); status.setAttribute('role','status');
        const grid = element('div','ycl-grid'); panel.append(status,grid);
        content.before(panel); content.classList.add('ycl-hidden'); group.classList.add(ACTIVE);
        tab.setAttribute('aria-selected','true');
        active = {page, group, tab, panel, content, status, grid, path, account:account(), controller:new AbortController()};
        void load(active);
    }
    function sync() {
        const path = channelPath(location.pathname);
        const page = path && document.querySelector('ytd-browse[page-subtype="channels"]:not([hidden])');
        const group = page && page.querySelector('yt-tab-group-shape .tabGroupShapeTabs[role="tablist"]');
        if (active && (!page || page !== active.page || group !== active.group || path !== active.path || account() !== active.account || !active.panel.isConnected || !active.content.isConnected || !active.tab.isConnected)) close();
        if (!group) return;
        const old = group.querySelector(`#${TAB}`);
        if (old) return;
        const sample = group.querySelector('yt-tab-shape[tab-title]');
        if (!sample) return;
        const tab = element('button','ycl-tab'); tab.id = TAB; tab.type = 'button';
        tab.setAttribute('role','tab'); tab.setAttribute('aria-selected','false'); tab.setAttribute('aria-controls',PANEL);
        tab.append(element('span','ycl-label','Liked'));
        tab.addEventListener('click', event => { event.stopPropagation(); open(page,group,tab); });
        const search = group.querySelector('yt-tab-shape:not([tab-title])');
        group.insertBefore(tab, search || null);
    }
    const style = element('style');
    style.textContent = `
        .ycl-tab { appearance:none; border:0; background:none; cursor:pointer; position:relative; display:flex; align-items:center; flex:none; padding:0 16px; color:var(--yt-spec-text-secondary); font:500 1.6rem Roboto,Arial,sans-serif; white-space:nowrap; }
        .ycl-tab:hover,.ycl-tab[aria-selected=true] {color:var(--yt-spec-text-primary)}
        .ycl-tab::after {content:''; position:absolute; bottom:0; left:16px; right:16px; height:2px; border-radius:2px; background:transparent}
        .ycl-tab[aria-selected=true]::after {background:var(--yt-spec-text-primary)}
        .ycl-tab:focus-visible {outline:2px solid var(--yt-spec-text-primary);outline-offset:-2px}
        .ycl-active .ytTabShapeTabSelected {color:var(--yt-spec-text-secondary)!important}
        .ycl-active .ytTabShapeTabBarSelected {visibility:hidden!important}
        yt-tab-group-shape:has(.ycl-active) .tabGroupShapeSlider {visibility:hidden!important}
        .ycl-hidden {display:none!important}
        #ycl-liked-panel {box-sizing:border-box;width:100%;max-width:2300px;margin:0 auto;padding:24px 24px 36px;color:var(--yt-spec-text-primary);font-family:Roboto,Arial,sans-serif}
        .ycl-status {font-size:1.4rem;color:var(--yt-spec-text-secondary);margin-bottom:18px}
        .ycl-grid {display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr));gap:32px 16px}
        .ycl-card {display:block;min-width:0;color:inherit;text-decoration:none!important}
        .ycl-thumb {position:relative;aspect-ratio:16/9;background:var(--yt-spec-badge-chip-background);border-radius:12px;overflow:hidden}
        .ycl-thumb img {width:100%;height:100%;object-fit:cover;display:block}
        .ycl-duration {position:absolute;bottom:5px;right:5px;padding:3px 4px;border-radius:4px;background:#000c;color:#fff;font-size:1.2rem;font-weight:500}
        .ycl-title {font-size:1.6rem;font-weight:500;line-height:2.2rem;margin-top:10px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .ycl-info {font-size:1.4rem;line-height:2rem;color:var(--yt-spec-text-secondary);margin-top:3px}
        .ycl-retry {border:0;border-radius:18px;padding:6px 14px;cursor:pointer;background:var(--yt-spec-badge-chip-background);color:var(--yt-spec-text-primary)}
    `;
    document.head.append(style);
    document.addEventListener('click', e => {
        if (active && e.target instanceof Element && active.group.contains(e.target) && !active.tab.contains(e.target)) close();
    }, true);
    document.addEventListener('yt-navigate-start',close);
    document.addEventListener('yt-navigate-finish',sync);
    window.addEventListener('popstate',close);
    new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; sync(); });
    }).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','page-subtype']});
    sync();
})();
