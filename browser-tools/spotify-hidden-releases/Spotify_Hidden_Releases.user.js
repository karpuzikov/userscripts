// ==UserScript==
// @name         Spotify Hidden Releases
// @namespace    https://github.com/karpuzikov/userscripts
// @version      0.2.0
// @description  Finds Spotify releases missing from an artist's visible discography using Spotify Web API catalog data, market scans, and historical artist credits.
// @author       karpuzikov
// @match        https://open.spotify.com/artist/*
// @match        https://open.spotify.com/intl-*/artist/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @connect      accounts.spotify.com
// @connect      api.spotify.com
// @connect      musicbrainz.org
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/spotify-hidden-releases/Spotify_Hidden_Releases.user.js
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/spotify-hidden-releases/Spotify_Hidden_Releases.user.js
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '0.2.0';
    const CACHE_HOURS = 24;
    const BTN_ID = 'kz-shr-button';
    const MODAL_ID = 'kz-shr-modal';
    const SETTINGS_KEY = 'spotify-hidden-releases:settings:v2';
    const TOKEN_KEY = 'spotify-hidden-releases:token:v2';
    const API = 'https://api.spotify.com/v1';
    const TOKEN_URL = 'https://accounts.spotify.com/api/token';
    const MB = 'https://musicbrainz.org/ws/2';
    const CORE_MARKETS = [
        'US','GB','CA','AU','NZ','DE','FR','ES','IT','NL','BE','CH','AT','SE','NO','DK','FI','PL','UA','CZ','RO','GR','PT','IE',
        'TR','BR','MX','AR','CL','CO','PE','ZA','IN','JP','KR','HK','TW','SG','ID','PH','TH','MY','VN','AE','SA','IL'
    ];
    const FALLBACK_MARKETS = [
        'AD','AE','AG','AL','AM','AO','AR','AT','AU','AW','AZ','BA','BB','BD','BE','BF','BG','BH','BI','BJ','BN','BO','BR','BS','BT','BW','BY','BZ',
        'CA','CD','CG','CH','CI','CL','CM','CO','CR','CV','CW','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','ES','ET','FI','FJ','FM','FR',
        'GA','GB','GD','GE','GH','GM','GN','GQ','GR','GT','GW','GY','HK','HN','HR','HT','HU','ID','IE','IL','IN','IQ','IS','IT','JM','JO','JP',
        'KE','KG','KH','KI','KM','KN','KR','KW','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MG','MH','MK',
        'ML','MN','MO','MR','MT','MU','MV','MW','MX','MY','MZ','NA','NE','NG','NI','NL','NO','NP','NR','NZ','OM','PA','PE','PG','PH','PK','PL',
        'PS','PT','PW','PY','QA','RO','RS','RW','SA','SB','SC','SE','SG','SI','SK','SL','SM','SN','SR','ST','SV','SZ','TD','TG','TH','TJ','TL',
        'TN','TO','TR','TT','TV','TW','TZ','UA','UG','US','UY','UZ','VC','VE','VN','VU','WS','XK','ZA','ZM','ZW'
    ];
    const SEARCH_MARKETS = ['US','GB','CA','AU','DE','FR','ES','IT','NL','SE','PL','UA','BR','MX','JP','KR','IN','ZA'];

    let state = null;
    let tokenMemory = null;
    let activeArtistId = null;
    let activePath = location.pathname;
    let mbLastRequestAt = 0;

    const albumUrl = id => `https://open.spotify.com/album/${id}`;
    const embedUrl = id => `https://open.spotify.com/embed/album/${id}`;
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function artistId() {
        return location.pathname.match(/\/artist\/([A-Za-z0-9]{22})(?:\/|$)/)?.[1] || null;
    }

    function artistNameFromPage() {
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

    function unique(values) {
        return [...new Set(values.filter(Boolean))];
    }

    function quoteSearch(s) {
        return `"${String(s || '').replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
    }

    function settings() {
        return GM_getValue(SETTINGS_KEY, {clientId:'', clientSecret:'', market:'', exhaustive:false, historical:true});
    }

    function saveSettings(v) {
        GM_setValue(SETTINGS_KEY, v);
    }

    const key = (kind, id) => `spotify-hidden-releases:${kind}:v2:${id}`;
    const oldManualKey = id => `spotify-hidden-releases:manual:v1:${id}`;
    const readManual = id => unique([...(GM_getValue(key('manual', id), []) || []), ...(GM_getValue(oldManualKey(id), []) || [])]);
    const writeManual = (id, ids) => GM_setValue(key('manual', id), unique(ids));
    const readCache = id => GM_getValue(key('cache', id), null);
    const writeCache = (id, data) => GM_setValue(key('cache', id), data);

    function gmRequest(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                timeout: 45000,
                ...options,
                onload: r => resolve(r),
                onerror: () => reject(new Error('Network error')),
                ontimeout: () => reject(new Error('Request timed out'))
            });
        });
    }

    async function getAppToken(force = false) {
        const s = settings();
        if (!s.clientId || !s.clientSecret) throw new Error('Spotify API credentials are not configured');
        const now = Date.now();
        if (!force && tokenMemory?.token && tokenMemory.expiresAt > now + 60000) return tokenMemory.token;
        const persisted = GM_getValue(TOKEN_KEY, null);
        if (!force && persisted?.token && persisted.expiresAt > now + 60000) {
            tokenMemory = persisted;
            return persisted.token;
        }
        const clientId = s.clientId.trim();
        const clientSecret = s.clientSecret.trim();
        const attempts = [
            {
                headers: {
                    'Content-Type':'application/x-www-form-urlencoded',
                    'Accept':'application/json',
                    'Authorization':`Basic ${btoa(`${clientId}:${clientSecret}`)}`
                },
                data:new URLSearchParams({grant_type:'client_credentials'}).toString()
            },
            {
                headers:{'Content-Type':'application/x-www-form-urlencoded', 'Accept':'application/json'},
                data:new URLSearchParams({grant_type:'client_credentials', client_id:clientId, client_secret:clientSecret}).toString()
            }
        ];
        let r = null;
        let data = {};
        for (const attempt of attempts) {
            r = await gmRequest({method:'POST', url:TOKEN_URL, ...attempt});
            try { data = JSON.parse(r.responseText || '{}'); } catch { data = {}; }
            if (r.status >= 200 && r.status < 300 && data.access_token) break;
        }
        if (!r || r.status < 200 || r.status >= 300 || !data.access_token) {
            throw new Error(data.error_description || data.error || `Spotify token HTTP ${r?.status || 0}`);
        }
        tokenMemory = {token:data.access_token, expiresAt:now + Math.max(60, Number(data.expires_in || 3600)) * 1000};
        GM_setValue(TOKEN_KEY, tokenMemory);
        return tokenMemory.token;
    }

    async function spotifyApi(path, params = null, retryAuth = true) {
        const qs = params ? `?${new URLSearchParams(Object.entries(params).filter(([,v]) => v !== undefined && v !== null && v !== '')).toString()}` : '';
        const url = `${API}${path}${qs}`;
        while (true) {
            const token = await getAppToken(false);
            const r = await gmRequest({method:'GET', url, headers:{Authorization:`Bearer ${token}`, Accept:'application/json'}});
            if (r.status === 401 && retryAuth) {
                tokenMemory = null;
                GM_setValue(TOKEN_KEY, null);
                await getAppToken(true);
                return spotifyApi(path, params, false);
            }
            if (r.status === 429) {
                const retry = Math.max(1, Number(r.responseHeaders?.match(/retry-after:\s*(\d+)/i)?.[1] || 2));
                setStatus('Spotify rate limit reached. Continuing automatically...', `Retrying in ${retry} seconds`, currentProgress());
                await sleep(retry * 1000 + 100);
                continue;
            }
            let data = {};
            try { data = JSON.parse(r.responseText || '{}'); } catch {}
            if (r.status < 200 || r.status >= 300) {
                const msg = data?.error?.message || data?.error_description || `Spotify API HTTP ${r.status}`;
                const e = new Error(msg);
                e.status = r.status;
                throw e;
            }
            return data;
        }
    }

    async function mbRequest(url) {
        while (true) {
            const gap = Date.now() - mbLastRequestAt;
            if (gap < 1050) await sleep(1050 - gap);
            mbLastRequestAt = Date.now();
            const r = await gmRequest({
                method:'GET', url,
                headers:{Accept:'application/json', 'User-Agent':`Spotify-Hidden-Releases/${VERSION} (https://github.com/karpuzikov/userscripts)`}
            });
            if (r.status === 503) {
                const retry = Math.max(5, Number(r.responseHeaders?.match(/retry-after:\s*(\d+)/i)?.[1] || 5));
                await sleep(retry * 1000);
                continue;
            }
            if (r.status === 404) return null;
            if (r.status < 200 || r.status >= 300) throw new Error(`MusicBrainz HTTP ${r.status}`);
            try { return JSON.parse(r.responseText || '{}'); }
            catch { throw new Error('Invalid MusicBrainz response'); }
        }
    }

    function extractIds(text) {
        const ids = new Set();
        const re = /(?:https?:\/\/open\.spotify\.com)?(?:\/intl-[a-z]{2,3})?\/album\/([A-Za-z0-9]{22})/gi;
        let m;
        while ((m = re.exec(String(text || '')))) ids.add(m[1]);
        return ids;
    }

    async function visibleIds(id) {
        const found = new Set(extractIds(document.documentElement.innerHTML));
        const paths = [
            `/artist/${id}/discography/all`, `/artist/${id}/discography/album`,
            `/artist/${id}/discography/single`, `/artist/${id}/discography/compilation`
        ];
        for (const path of paths) {
            try {
                const r = await fetch(path, {credentials:'include', cache:'no-store', headers:{Accept:'text/html'}});
                if (!r.ok) continue;
                extractIds(await r.text()).forEach(x => found.add(x));
            } catch {}
        }
        return found;
    }

    function albumMeta(a, source, targetArtistId, targetNames = []) {
        const artistNames = (a.artists || []).map(x => x.name).filter(Boolean);
        const artistIds = (a.artists || []).map(x => x.id).filter(Boolean);
        const targetNorms = targetNames.map(norm).filter(Boolean);
        const artistNorms = artistNames.map(norm);
        const nameMatch = artistNorms.some(an => targetNorms.some(tn => an === tn || an.endsWith(` ${tn}`) || tn.endsWith(` ${an}`)));
        return {
            id:a.id,
            title:a.name || `Spotify album ${a.id}`,
            artist:artistNames.join(', '),
            artistIds,
            image:a.images?.[0]?.url || '',
            date:a.release_date || '',
            tracks:a.total_tracks || '',
            type:a.album_type || a.album_group || '',
            availableMarkets:Array.isArray(a.available_markets) ? a.available_markets : [],
            restriction:a.restrictions?.reason || '',
            source,
            targetArtistMatch:artistIds.includes(targetArtistId) || nameMatch,
            raw:a
        };
    }

    async function listArtistAlbums(id, market, source, targetNames, progressLabel = '') {
        const out = new Map();
        let offset = 0;
        while (true) {
            const p = {include_groups:'album,single,compilation', limit:10, offset};
            if (market) p.market = market;
            const data = await spotifyApi(`/artists/${id}/albums`, p);
            const items = data.items || [];
            for (const a of items) out.set(a.id, albumMeta(a, source, id, targetNames));
            offset += items.length;
            if (!items.length || !data.next || offset >= Number(data.total || 0)) break;
            if (progressLabel) setStatus('Reading Spotify catalog...', `${progressLabel}: ${offset}/${data.total}`, currentProgress());
        }
        return out;
    }

    async function availableMarkets() {
        try {
            const data = await spotifyApi('/markets');
            if (Array.isArray(data.markets) && data.markets.length) return unique(data.markets);
        } catch {}
        return FALLBACK_MARKETS;
    }

    async function mapLimit(items, limit, fn) {
        const result = new Array(items.length);
        let next = 0;
        async function worker() {
            while (true) {
                const i = next++;
                if (i >= items.length) return;
                result[i] = await fn(items[i], i);
            }
        }
        await Promise.all(Array.from({length:Math.min(limit, items.length)}, worker));
        return result;
    }

    async function discoverAcrossMarkets(id, names, exhaustive) {
        const all = new Map();
        const errors = [];
        const markets = exhaustive ? await availableMarkets() : CORE_MARKETS;

        // First try market-free catalog retrieval. Some Spotify app modes return useful catalog data here.
        try {
            const direct = await listArtistAlbums(id, null, 'Spotify artist catalog', names, 'global');
            direct.forEach((v,k) => all.set(k,v));
        } catch (e) {
            errors.push(`Global catalog: ${e.message}`);
        }

        let done = 0;
        await mapLimit(markets, 3, async market => {
            try {
                const items = await listArtistAlbums(id, market, `Spotify ${market}`, names, market);
                items.forEach((v,k) => {
                    const old = all.get(k);
                    if (old) {
                        old.sources = unique([...(old.sources || [old.source]), `Spotify ${market}`]);
                        old.availableMarkets = unique([...(old.availableMarkets || []), ...(v.availableMarkets || [])]);
                    } else {
                        v.sources = [`Spotify ${market}`];
                        all.set(k, v);
                    }
                });
            } catch (e) {
                if (![400,403].includes(e.status)) errors.push(`${market}: ${e.message}`);
            } finally {
                done++;
                setStatus('Scanning Spotify markets...', `${done}/${markets.length} markets - ${all.size} unique releases`, 18 + Math.round((done / Math.max(1, markets.length)) * 47));
            }
        });
        return {all, errors, markets};
    }

    async function musicBrainzHistoricalCredits(spotifyArtistId) {
        let relation = null;
        const resources = [
            `https://open.spotify.com/artist/${spotifyArtistId}`,
            `https://open.spotify.com/artist/${spotifyArtistId}/`
        ];
        for (const resource of resources) {
            const url = await mbRequest(`${MB}/url?resource=${encodeURIComponent(resource)}&inc=artist-rels&fmt=json`);
            relation = (url?.relations || []).find(r => r['target-type'] === 'artist' && r.artist?.id) || null;
            if (relation) break;
        }
        if (!relation?.artist?.id) return {mbid:null, names:[], releases:[]};
        const mbid = relation.artist.id;
        const names = new Set([relation.artist.name]);
        const releases = [];
        let offset = 0;
        while (true) {
            const data = await mbRequest(`${MB}/release-group?artist=${encodeURIComponent(mbid)}&inc=artist-credits&limit=100&offset=${offset}&fmt=json`);
            const groups = data?.['release-groups'] || [];
            for (const rg of groups) {
                const credits = rg['artist-credit'] || [];
                const creditedNames = [];
                for (const ac of credits) {
                    if (ac.artist?.id === mbid) {
                        names.add(ac.name || ac.artist.name);
                        creditedNames.push(ac.name || ac.artist.name);
                    }
                }
                if (rg.title && creditedNames.length) releases.push({title:rg.title, names:unique(creditedNames)});
            }
            offset += groups.length;
            if (!groups.length || offset >= Number(data?.['release-group-count'] || 0)) break;
        }
        return {mbid, names:[...names].filter(Boolean), releases};
    }

    function likelyArtistMatch(album, targetArtistId, acceptedNames) {
        const ids = (album.artists || []).map(x => x.id);
        if (ids.includes(targetArtistId)) return true;
        const n = (album.artists || []).map(x => norm(x.name));
        const accepted = acceptedNames.map(norm).filter(Boolean);
        return n.some(an => accepted.some(tn => an === tn || an.endsWith(` ${tn}`) || tn.endsWith(` ${an}`)));
    }

    async function searchAlbum(q, market) {
        const data = await spotifyApi('/search', {q, type:'album', market, limit:10, offset:0});
        return data.albums?.items || [];
    }

    async function discoverHistorical(id, currentName, historical) {
        const found = new Map();
        const errors = [];
        if (!historical) return {found, errors, names:[currentName]};
        setStatus('Reading historical artist credits...', 'MusicBrainz', 67);
        let mb;
        try { mb = await musicBrainzHistoricalCredits(id); }
        catch (e) { errors.push(`Historical credits: ${e.message}`); return {found, errors, names:[currentName]}; }
        const names = unique([currentName, ...(mb.names || [])]);
        const releases = mb.releases || [];
        if (!releases.length) return {found, errors, names};

        let done = 0;
        const total = releases.length;
        await mapLimit(releases, 2, async rg => {
            const creditNames = unique([...rg.names, ...names]);
            const searches = rg.names.length ? rg.names : names.slice(0, 2);
            for (const credit of searches) {
                const q = `album:${quoteSearch(rg.title)} artist:${quoteSearch(credit)}`;
                for (const market of SEARCH_MARKETS) {
                    try {
                        const items = await searchAlbum(q, market);
                        for (const a of items) {
                            if (!likelyArtistMatch(a, id, creditNames)) continue;
                            const m = albumMeta(a, 'Historical credit search', id, creditNames);
                            m.sources = unique([...(m.sources || []), `Historical credit: ${credit}`, `Spotify search ${market}`]);
                            const old = found.get(a.id);
                            if (old) old.sources = unique([...(old.sources || []), ...m.sources]);
                            else found.set(a.id, m);
                        }
                    } catch (e) {
                        if (![400,403].includes(e.status)) errors.push(`Search ${market}: ${e.message}`);
                    }
                    if (found.size && [...found.values()].some(x => norm(x.title) === norm(rg.title))) break;
                }
            }
            done++;
            setStatus('Searching old/unlisted Spotify identities...', `${done}/${total} historical releases - ${found.size} Spotify candidates`, 67 + Math.round((done / Math.max(1,total)) * 23));
        });
        return {found, errors, names};
    }

    async function currentMarketCatalog(id, market, names) {
        if (!market) return new Map();
        try { return await listArtistAlbums(id, market, `Current market ${market}`, names, market); }
        catch { return new Map(); }
    }

    async function getAlbum(id, market, targetArtistId, names) {
        const p = market ? {market} : null;
        try {
            const a = await spotifyApi(`/albums/${id}`, p);
            return albumMeta(a, 'Manual', targetArtistId, names);
        } catch {
            return null;
        }
    }

    function currentProgress() {
        const el = document.getElementById('kzshr-progress');
        return el ? Number(String(el.style.width || '0').replace('%','')) || 0 : 0;
    }

    function css() {
        if (document.getElementById('kz-shr-css')) return;
        const s = document.createElement('style');
        s.id = 'kz-shr-css';
        s.textContent = `
#${BTN_ID}{border:0;border-radius:999px;background:#1ed760;color:#000;font:700 14px Arial;padding:11px 18px;margin-left:12px;cursor:pointer}#${BTN_ID}:hover{background:#3be477}
#${MODAL_ID}{position:fixed;inset:0;z-index:2147483646;background:#000b;display:grid;place-items:center;padding:20px;color:#fff;font:13px Arial}#${MODAL_ID}[hidden]{display:none}
.kzshr-panel{width:min(1120px,96vw);max-height:92vh;background:#121212;border:1px solid #333;border-radius:14px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 80px #000}
.kzshr-head,.kzshr-tools,.kzshr-status,.kzshr-settings{padding:14px 18px;border-bottom:1px solid #292929}.kzshr-head{display:flex;align-items:center;gap:12px}.kzshr-head b{font-size:21px}.kzshr-head span{color:#999;margin-right:auto}.kzshr-x,.kzshr-btn{border:1px solid #444;border-radius:999px;background:#252525;color:#fff;padding:9px 13px;font-weight:700;cursor:pointer;text-decoration:none}.kzshr-btn:hover,.kzshr-x:hover{background:#333}.kzshr-primary{background:#1ed760;color:#000;border-color:#1ed760}.kzshr-tools{display:flex;gap:9px;align-items:center}.kzshr-tools .kzshr-input{flex:1}.kzshr-input,.kzshr-select{min-width:0;background:#202020;color:#fff;border:1px solid #444;border-radius:8px;padding:10px 11px}.kzshr-settings{display:grid;grid-template-columns:1.2fr 1.2fr .45fr .7fr auto;gap:9px;align-items:center;background:#171717}.kzshr-settings[hidden]{display:none}.kzshr-settings small{grid-column:1/-1;color:#aaa}.kzshr-status b{display:block}.kzshr-status small{color:#aaa}.kzshr-bar{height:4px;background:#292929;margin-top:9px;border-radius:9px;overflow:hidden}.kzshr-bar i{display:block;height:100%;width:0;background:#1ed760;transition:.2s}.kzshr-note{padding:10px 18px;color:#aaa;border-bottom:1px solid #292929;line-height:1.4}.kzshr-list{overflow:auto;padding:12px 18px 18px;display:grid;gap:9px}.kzshr-card{display:grid;grid-template-columns:64px 1fr auto;gap:12px;align-items:center;background:#191919;border:1px solid #2e2e2e;border-radius:10px;padding:10px}.kzshr-cover{width:64px;height:64px;object-fit:cover;border-radius:6px;background:#292929}.kzshr-title{font-size:15px;font-weight:800}.kzshr-meta{color:#aaa;margin-top:4px}.kzshr-badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.kzshr-badge{background:#303030;border-radius:999px;padding:3px 7px;font-size:11px}.kzshr-regional{background:#563300;color:#ffd28a}.kzshr-unlisted{background:#153d58;color:#9ed8ff}.kzshr-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.kzshr-empty{padding:35px;text-align:center;color:#aaa}.kzshr-err{padding:8px 18px;color:#ffb0b0;border-bottom:1px solid #292929}.kzshr-ok{color:#9ee6ad}.kzshr-danger{border-color:#7a3434;color:#ffb0b0}
@media(max-width:850px){.kzshr-settings{grid-template-columns:1fr 1fr}.kzshr-settings .kzshr-btn,.kzshr-settings small{grid-column:1/-1}.kzshr-card{grid-template-columns:52px 1fr}.kzshr-cover{width:52px;height:52px}.kzshr-actions{grid-column:1/-1;justify-content:flex-start}.kzshr-tools{flex-wrap:wrap}.kzshr-tools .kzshr-input{min-width:220px}}
`;
        document.head.appendChild(s);
    }

    function modal() {
        css();
        let m = document.getElementById(MODAL_ID);
        if (m) return m;
        m = document.createElement('div');
        m.id = MODAL_ID;
        m.hidden = true;
        m.innerHTML = `<div class="kzshr-panel">
<div class="kzshr-head"><b>Spotify Hidden Releases</b><span>v${VERSION} - Under construction</span><button id="kzshr-rescan" class="kzshr-btn">Rescan</button><button id="kzshr-settings-toggle" class="kzshr-btn">API settings</button><button class="kzshr-x">X</button></div>
<div id="kzshr-settings" class="kzshr-settings" hidden>
<input id="kzshr-client-id" class="kzshr-input" placeholder="Spotify Client ID">
<input id="kzshr-client-secret" class="kzshr-input" type="password" placeholder="Spotify Client Secret">
<input id="kzshr-market" class="kzshr-input" maxlength="2" placeholder="Market, e.g. UA">
<select id="kzshr-scan-mode" class="kzshr-select"><option value="core">Broad global scan</option><option value="all">Exhaustive markets</option></select>
<button id="kzshr-save-settings" class="kzshr-btn kzshr-primary">Save and test API</button>
<small>Uses Spotify's official Client Credentials flow. Credentials stay in Tampermonkey and are sent only to accounts.spotify.com. The market is your Spotify account country and is used to label regional releases.</small>
</div>
<div class="kzshr-tools"><input id="kzshr-filter" class="kzshr-input" placeholder="Filter found releases"><input id="kzshr-manual" class="kzshr-input" placeholder="Known hidden Spotify album URL or 22-character ID"><button id="kzshr-add" class="kzshr-btn">Save hidden ID</button></div>
<div class="kzshr-status"><b id="kzshr-st">Ready.</b><small id="kzshr-detail"></small><div class="kzshr-bar"><i id="kzshr-progress"></i></div></div>
<div class="kzshr-note">Discovery is API-first: Spotify artist catalog + cross-market catalog + Spotify search using historical artist credits/releases. Public search engines are not used. Results absent from your market are labeled regional; results present in your market but absent from Spotify's visible artist discography are labeled unlisted/hidden.</div>
<div id="kzshr-errors"></div><div id="kzshr-list" class="kzshr-list"></div></div>`;
        document.body.appendChild(m);
        m.querySelector('.kzshr-x').onclick = () => { m.hidden = true; };
        m.addEventListener('click', e => { if (e.target === m) m.hidden = true; });
        m.querySelector('#kzshr-filter').addEventListener('input', render);
        m.querySelector('#kzshr-add').onclick = saveManual;
        m.querySelector('#kzshr-rescan').onclick = () => scan(true);
        m.querySelector('#kzshr-settings-toggle').onclick = () => {
            const p = m.querySelector('#kzshr-settings');
            p.hidden = !p.hidden;
            if (!p.hidden) loadSettingsUi();
        };
        m.querySelector('#kzshr-save-settings').onclick = saveSettingsFromUi;
        return m;
    }

    function loadSettingsUi() {
        const m = modal(), s = settings();
        m.querySelector('#kzshr-client-id').value = s.clientId || '';
        m.querySelector('#kzshr-client-secret').value = s.clientSecret || '';
        m.querySelector('#kzshr-market').value = s.market || '';
        m.querySelector('#kzshr-scan-mode').value = s.exhaustive ? 'all' : 'core';
    }

    async function saveSettingsFromUi() {
        const m = modal();
        const v = {
            clientId:m.querySelector('#kzshr-client-id').value.trim(),
            clientSecret:m.querySelector('#kzshr-client-secret').value.trim(),
            market:m.querySelector('#kzshr-market').value.trim().toUpperCase(),
            exhaustive:m.querySelector('#kzshr-scan-mode').value === 'all',
            historical:true
        };
        if (!v.clientId || !v.clientSecret) return setStatus('Client ID and Client Secret are required.', '', 100);
        if (!/^[A-Z]{2}$/.test(v.market)) return setStatus('Enter your 2-letter Spotify market.', 'Example: UA, US, GB', 100);
        saveSettings(v);
        tokenMemory = null;
        GM_setValue(TOKEN_KEY, null);
        setStatus('Testing Spotify Web API...', '', 40);
        try {
            await getAppToken(true);
            const id = artistId();
            if (id) await spotifyApi(`/artists/${id}`);
            setStatus('Spotify Web API connected.', 'Credentials saved locally in Tampermonkey.', 100);
            m.querySelector('#kzshr-settings').hidden = true;
        } catch (e) {
            setStatus('Spotify API setup failed.', e.message, 100);
        }
    }

    function setStatus(a, b = '', p = 0) {
        const m = modal();
        m.querySelector('#kzshr-st').textContent = a;
        m.querySelector('#kzshr-detail').textContent = b;
        m.querySelector('#kzshr-progress').style.width = `${Math.max(0, Math.min(100, p))}%`;
    }

    function render() {
        const m = modal();
        const list = m.querySelector('#kzshr-list');
        const errors = m.querySelector('#kzshr-errors');
        const q = norm(m.querySelector('#kzshr-filter').value);
        if (!state) { list.innerHTML = '<div class="kzshr-empty">Configure Spotify API access, then run a scan.</div>'; return; }
        const err = unique(state.errors || []);
        errors.innerHTML = err.length ? `<div class="kzshr-err">Partial scan: ${esc(err.slice(0,8).join('; '))}${err.length > 8 ? `; +${err.length - 8} more` : ''}</div>` : '';
        const rows = state.results.filter(x => !q || norm(`${x.title} ${x.artist} ${x.id} ${(x.sources||[]).join(' ')}`).includes(q));
        if (!rows.length) { list.innerHTML = `<div class="kzshr-empty">${q ? 'No matches for this filter.' : 'No hidden releases found by the Spotify/API scan.'}</div>`; return; }
        list.innerHTML = rows.map(x => {
            const meta = [x.artist, x.type, x.date, x.tracks ? `${x.tracks} tracks` : '', `Spotify ID: ${x.id}`].filter(Boolean).join(' - ');
            const badges = [
                x.kind === 'regional' ? '<span class="kzshr-badge kzshr-regional">Regional - unavailable in your market</span>' : '<span class="kzshr-badge kzshr-unlisted">Unlisted/hidden in artist discography</span>',
                x.manual ? '<span class="kzshr-badge">Saved manually</span>' : '',
                ...(x.sources || []).slice(0,6).map(s => `<span class="kzshr-badge">${esc(s)}</span>`)
            ].join('');
            return `<div class="kzshr-card" data-id="${x.id}">${x.image ? `<img class="kzshr-cover" src="${esc(x.image)}">` : '<div class="kzshr-cover"></div>'}<div><div class="kzshr-title">${esc(x.title)}</div><div class="kzshr-meta">${esc(meta)}</div><div class="kzshr-badges">${badges}</div></div><div class="kzshr-actions"><a class="kzshr-btn kzshr-primary" target="_blank" rel="noopener" href="${albumUrl(x.id)}">Open Spotify</a><a class="kzshr-btn" target="_blank" rel="noopener" href="${embedUrl(x.id)}">Open embed</a><button class="kzshr-btn kzshr-copy" data-url="${albumUrl(x.id)}">Copy URL</button>${x.manual ? `<button class="kzshr-btn kzshr-forget" data-id="${x.id}">Forget</button>` : ''}</div></div>`;
        }).join('');
        list.querySelectorAll('.kzshr-copy').forEach(b => b.onclick = () => { GM_setClipboard(b.dataset.url, 'text'); b.textContent='Copied'; setTimeout(()=>b.textContent='Copy URL',700); });
        list.querySelectorAll('.kzshr-forget').forEach(b => b.onclick = () => forgetManual(b.dataset.id));
    }

    async function scan(force = false) {
        const id = artistId();
        if (!id) return;
        activeArtistId = id;
        const m = modal();
        m.hidden = false;
        const s = settings();
        if (!s.clientId || !s.clientSecret || !/^[A-Z]{2}$/.test(s.market || '')) {
            m.querySelector('#kzshr-settings').hidden = false;
            loadSettingsUi();
            setStatus('Spotify API setup required.', 'Enter Client ID, Client Secret, and your Spotify market once.', 0);
            render();
            return;
        }
        const cached = readCache(id);
        if (!force && cached?.time && Date.now() - cached.time < CACHE_HOURS * 3600000) {
            state = cached.state;
            setStatus(`Loaded ${state.results.length} cached hidden release${state.results.length === 1 ? '' : 's'}.`, `Cache is less than ${CACHE_HOURS} hours old. Use Rescan for fresh API data.`, 100);
            render();
            return;
        }

        try {
            setStatus('Connecting to Spotify Web API...', '', 2);
            await getAppToken(false);
            const artist = await spotifyApi(`/artists/${id}`);
            const name = artist.name || artistNameFromPage();
            setStatus('Reading visible Spotify discography...', name, 6);
            const visible = await visibleIds(id);

            setStatus('Scanning Spotify catalog...', `${visible.size} visible album IDs found`, 10);
            const catalog = await discoverAcrossMarkets(id, [name], !!s.exhaustive);

            const historical = await discoverHistorical(id, name, s.historical !== false);
            historical.found.forEach((v,k) => {
                const old = catalog.all.get(k);
                if (old) old.sources = unique([...(old.sources || []), ...(v.sources || [])]);
                else catalog.all.set(k, v);
            });

            setStatus('Checking your Spotify market...', s.market, 92);
            const currentMarket = await currentMarketCatalog(id, s.market, historical.names || [name]);
            const manualIds = readManual(id);
            for (const mid of manualIds) {
                if (!catalog.all.has(mid)) {
                    const a = await getAlbum(mid, s.market, id, historical.names || [name]);
                    if (a) { a.manual = true; a.sources = ['Manual']; catalog.all.set(mid, a); }
                }
            }

            const results = [];
            for (const [rid, item] of catalog.all) {
                if (visible.has(rid) && !manualIds.includes(rid)) continue;
                if (!item.targetArtistMatch && !manualIds.includes(rid)) continue;
                const inCurrent = currentMarket.has(rid) || (item.availableMarkets || []).includes(s.market);
                results.push({
                    ...item,
                    manual:manualIds.includes(rid),
                    kind:inCurrent ? 'unlisted' : 'regional',
                    sources:unique(item.sources || [item.source]).slice(0,12)
                });
            }
            results.sort((a,b) => (a.kind === 'regional' ? -1 : 1) - (b.kind === 'regional' ? -1 : 1) || String(b.date).localeCompare(String(a.date)) || a.title.localeCompare(b.title));
            state = {
                artistId:id, artistName:name, market:s.market, visible:[...visible], results,
                errors:unique([...(catalog.errors || []), ...(historical.errors || [])]),
                stats:{catalog:catalog.all.size, visible:visible.size, historical:historical.found.size, markets:catalog.markets.length}
            };
            writeCache(id, {time:Date.now(), state});
            setStatus(`Found ${results.length} hidden release${results.length === 1 ? '' : 's'}.`, `${catalog.all.size} unique Spotify releases checked across ${catalog.markets.length} markets; ${historical.found.size} historical-credit candidates.`, 100);
            render();
        } catch (e) {
            setStatus('Scan failed.', e.message, 100);
            if (/credential|token|client|premium|forbidden|403/i.test(e.message)) {
                m.querySelector('#kzshr-settings').hidden = false;
                loadSettingsUi();
            }
        }
    }

    async function saveManual() {
        const id = artistId();
        if (!id) return;
        const s = settings();
        const input = modal().querySelector('#kzshr-manual');
        const aid = String(input.value || '').match(/(?:album\/)?([A-Za-z0-9]{22})(?:[/?#]|$)/)?.[1];
        if (!aid) return setStatus('Invalid Spotify album URL or ID.', 'Expected a 22-character album ID.', 100);
        const ids = readManual(id);
        if (!ids.includes(aid)) { ids.push(aid); writeManual(id, ids); }
        input.value = '';
        if (!s.clientId || !s.clientSecret) return setStatus('Hidden ID saved.', 'Configure Spotify API access to retrieve its metadata.', 100);
        setStatus('Reading saved release from Spotify API...', aid, 70);
        try {
            const artist = await spotifyApi(`/artists/${id}`);
            const a = await getAlbum(aid, s.market, id, [artist.name]);
            if (!a) return setStatus('Spotify album could not be retrieved in the configured market.', aid, 100);
            if (!state) state = {artistId:id, artistName:artist.name, market:s.market, visible:[], results:[], errors:[]};
            state.results = state.results.filter(x => x.id !== aid);
            state.results.push({...a, manual:true, kind:new Set(state.visible || []).has(aid) ? 'unlisted' : ((a.availableMarkets || []).includes(s.market) ? 'unlisted' : 'regional'), sources:['Manual']});
            writeCache(id, {time:Date.now(), state});
            setStatus('Saved hidden release.', a.title, 100);
            render();
        } catch (e) {
            setStatus('Hidden ID saved, but metadata lookup failed.', e.message, 100);
        }
    }

    function forgetManual(aid) {
        const id = artistId();
        if (!id) return;
        writeManual(id, readManual(id).filter(x => x !== aid));
        if (state) state.results = state.results.filter(x => x.id !== aid || (x.sources || []).some(s => s !== 'Manual'));
        writeCache(id, {time:Date.now(), state});
        render();
    }

    function inject() {
        const id = artistId();
        if (!id) {
            document.getElementById(BTN_ID)?.remove();
            return;
        }
        if (activePath !== location.pathname) {
            activePath = location.pathname;
            activeArtistId = id;
            state = null;
        }
        if (document.getElementById(BTN_ID)) return;
        css();
        const b = document.createElement('button');
        b.id = BTN_ID;
        b.textContent = 'Show hidden releases';
        b.title = 'Find region-restricted and unlisted Spotify releases with Spotify Web API';
        b.onclick = e => { e.preventDefault(); e.stopPropagation(); scan(false); };
        const h1 = document.querySelector('main h1, h1');
        const target = h1?.parentElement || document.querySelector('main');
        if (target) target.appendChild(b);
        else {
            b.style.cssText += ';position:fixed;right:24px;bottom:88px;z-index:9999';
            document.body.appendChild(b);
        }
    }

    const observer = new MutationObserver(inject);
    observer.observe(document.documentElement, {childList:true, subtree:true});
    setInterval(inject, 1200);
    inject();
})();
