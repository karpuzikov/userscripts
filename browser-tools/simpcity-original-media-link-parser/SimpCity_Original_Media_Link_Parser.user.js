// ==UserScript==
// @name         SimpCity - Original Media Link Parser
// @namespace    https://simpcity.cr/
// @version      1.0.1
// @description  Parse an entire SimpCity thread and list original/direct image and video URLs.
// @author       karpuzikov
// @match        https://simpcity.cr/threads/*
// @match        https://www.simpcity.cr/threads/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      goonbox.cr
// @connect      turbo.cr
// @connect      pixeldrain.com
// @connect      cyberdrop.cr
// @connect      api.cyberdrop.cr
// @connect      bunkr.cr
// @connect      apidl.bunkr.ru
// @connect      get.bunkrr.su
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    const SCRIPT_NAME = 'Original Media Links';
    const THREAD_LIMIT = 500;
    const REQUEST_CONCURRENCY = 8;
    const DIRECT_IMAGE_EXT = /\.(?:avif|bmp|gif|jpe?g|jxl|png|webp)(?:[?#].*)?$/i;
    const DIRECT_VIDEO_EXT = /\.(?:m4v|mkv|mov|mp4|mpeg|mpg|ogv|webm)(?:[?#].*)?$/i;

    const state = {
        running: false,
        images: [],
        videos: [],
        unresolved: [],
        seenImages: new Set(),
        seenVideos: new Set(),
        seenUnresolved: new Set(),
        pages: 0,
        posts: 0,
        hostTasks: [],
    };

    function normalizeUrl(value, base = location.href) {
        if (!value) return null;
        try {
            const url = new URL(String(value).trim(), base);
            if (!/^https?:$/i.test(url.protocol)) return null;
            return url.href;
        } catch {
            return null;
        }
    }

    function decodeHtml(text) {
        const el = document.createElement('textarea');
        el.innerHTML = text;
        return el.value;
    }

    function decodeBase64Url(value) {
        if (!value) return null;
        try {
            let s = value.replace(/-/g, '+').replace(/_/g, '/');
            while (s.length % 4) s += '=';
            const bytes = Uint8Array.from(atob(s), c => c.charCodeAt(0));
            return new TextDecoder().decode(bytes);
        } catch {
            return null;
        }
    }

    function unwrapSimpCityRedirect(rawUrl, anchor, base) {
        const visible = anchor?.textContent?.trim();
        if (visible && /^https?:\/\/\S+$/i.test(visible)) {
            return normalizeUrl(decodeHtml(visible), base);
        }

        const absolute = normalizeUrl(rawUrl, base);
        if (!absolute) return null;

        try {
            const u = new URL(absolute);
            if (/^(?:www\.)?simpcity\.cr$/i.test(u.hostname) && /^\/redirect\/?$/i.test(u.pathname)) {
                const encoded = u.searchParams.get('to');
                const decoded = decodeBase64Url(encoded);
                const result = normalizeUrl(decoded, base);
                if (result) return result;
            }
        } catch {}

        return absolute;
    }

    function stripCuckcapitalMedium(url) {
        if (!url) return null;
        return url.replace(/\.md(?=\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$))/i, '');
    }

    function largestSrcset(srcset, base) {
        if (!srcset) return null;
        const candidates = srcset.split(',').map(part => {
            const bits = part.trim().split(/\s+/);
            const url = normalizeUrl(bits[0], base);
            const score = bits[1] ? parseFloat(bits[1]) || 0 : 0;
            return { url, score };
        }).filter(x => x.url);
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0]?.url || null;
    }

    function bestImageUrl(img, base) {
        if (!img) return null;
        const candidates = [
            img.getAttribute('data-url'),
            img.getAttribute('data-full-url'),
            img.getAttribute('data-src'),
            largestSrcset(img.getAttribute('srcset'), base),
            img.getAttribute('src'),
        ];
        for (const value of candidates) {
            const url = normalizeUrl(value, base);
            if (url) return url;
        }
        return null;
    }

    function isForumUiImage(img, url) {
        const cls = String(img?.className || '');
        const alt = String(img?.getAttribute('alt') || '');
        if (/avatar|smilie|emoji|reaction|icon/i.test(cls)) return true;
        if (/^:\w+:$/.test(alt)) return true;
        try {
            const h = new URL(url).hostname.toLowerCase();
            if (h === 'cdn.jsdelivr.net' && /twemoji/i.test(url)) return true;
        } catch {}
        return false;
    }

    function addImage(url) {
        url = normalizeUrl(stripCuckcapitalMedium(url));
        if (!url || state.seenImages.has(url)) return;
        state.seenImages.add(url);
        state.images.push(url);
    }

    function addVideo(url) {
        url = normalizeUrl(url);
        if (!url || state.seenVideos.has(url)) return;
        state.seenVideos.add(url);
        state.videos.push(url);
    }

    function addUnresolved(url, reason = '') {
        url = normalizeUrl(url);
        if (!url || state.seenUnresolved.has(url)) return;
        state.seenUnresolved.add(url);
        state.unresolved.push({ url, reason });
    }

    function queueTask(task) {
        const key = `${task.type}|${task.url}`;
        if (state.hostTasks.some(x => x.key === key)) return;
        state.hostTasks.push({ ...task, key });
    }

    function threadBaseUrl(input = location.href) {
        const u = new URL(input);
        u.hash = '';
        u.search = '';
        u.pathname = u.pathname.replace(/\/page-\d+\/?$/i, '/');
        if (!u.pathname.endsWith('/')) u.pathname += '/';
        return u.href;
    }

    function findNextPage(doc, currentUrl) {
        const next = doc.querySelector('a.pageNav-jump--next[href], a[rel="next"][href], link[rel="next"][href]');
        const href = next?.getAttribute('href');
        return href ? normalizeUrl(href, currentUrl) : null;
    }

    async function fetchDocument(url) {
        const here = new URL(location.href);
        const target = new URL(url);
        const samePage = here.origin === target.origin && here.pathname.replace(/\/$/, '') === target.pathname.replace(/\/$/, '') && here.search === target.search;
        if (samePage) return document;

        const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Accept': 'text/html,application/xhtml+xml' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        return new DOMParser().parseFromString(text, 'text/html');
    }

    function collectFromDocument(doc, pageUrl) {
        let roots = [...doc.querySelectorAll('article.message .message-userContent')];
        if (!roots.length) roots = [...doc.querySelectorAll('.message-userContent, .bbWrapper')];
        state.posts += roots.length;

        for (const root of roots) {
            const handledImages = new Set();

            for (const a of root.querySelectorAll('a[href]')) {
                const raw = a.getAttribute('href');
                const href = unwrapSimpCityRedirect(raw, a, pageUrl);
                if (!href) continue;

                let u;
                try { u = new URL(href); } catch { continue; }
                const host = u.hostname.toLowerCase();
                const path = u.pathname;
                const nestedImg = a.querySelector('img');
                const thumb = bestImageUrl(nestedImg, pageUrl);

                if (host === 'goonbox.cr' || host.endsWith('.goonbox.cr')) {
                    if (/\/(?:img|image)\//i.test(path)) {
                        if (thumb) {
                            const direct = stripCuckcapitalMedium(thumb);
                            if (direct !== thumb || DIRECT_IMAGE_EXT.test(direct)) {
                                addImage(direct);
                                handledImages.add(nestedImg);
                            } else {
                                queueTask({ type: 'goonbox-image', url: href, fallback: thumb });
                            }
                        } else {
                            queueTask({ type: 'goonbox-image', url: href });
                        }
                        continue;
                    }
                    if (/\/(?:a|album|albums)\//i.test(path)) {
                        queueTask({ type: 'goonbox-album', url: href });
                        continue;
                    }
                }

                if (host === 'turbo.cr' || host.endsWith('.turbo.cr')) {
                    if (/\/(?:embed|v|d)\//i.test(path)) {
                        queueTask({ type: 'turbo', url: href });
                        continue;
                    }
                }

                if (host === 'pixeldrain.com' || host.endsWith('.pixeldrain.com')) {
                    const single = path.match(/^\/u\/([^/?#]+)/i);
                    const list = path.match(/^\/l\/([^/?#]+)/i);
                    if (single) {
                        queueTask({ type: 'pixeldrain-file', url: href, id: single[1] });
                        continue;
                    }
                    if (list) {
                        queueTask({ type: 'pixeldrain-list', url: href });
                        continue;
                    }
                }

                if (host === 'cyberdrop.cr' || host.endsWith('.cyberdrop.cr')) {
                    const file = path.match(/^\/[ef]\/([^/?#]+)/i);
                    if (file) {
                        queueTask({ type: 'cyberdrop-file', url: href, id: file[1] });
                        continue;
                    }
                }

                if (host === 'bunkr.cr' || host.endsWith('.bunkr.cr')) {
                    const album = path.match(/^\/a\/([^/?#]+)/i);
                    const file = path.match(/^\/[fvid]\/([^/?#]+)/i);
                    if (album) {
                        queueTask({ type: 'bunkr-album', url: href, id: album[1] });
                        continue;
                    }
                    if (file) {
                        queueTask({ type: 'bunkr-media', url: href });
                        continue;
                    }
                }

                if (DIRECT_IMAGE_EXT.test(href)) {
                    addImage(href);
                    if (nestedImg) handledImages.add(nestedImg);
                    continue;
                }
                if (DIRECT_VIDEO_EXT.test(href)) {
                    addVideo(href);
                    continue;
                }

                if (nestedImg && thumb && !isForumUiImage(nestedImg, thumb)) {
                    if (/cuckcapital\.cr$/i.test(new URL(thumb).hostname) || DIRECT_IMAGE_EXT.test(thumb)) {
                        addImage(thumb);
                        handledImages.add(nestedImg);
                    }
                }
            }

            for (const iframe of root.querySelectorAll('iframe[src]')) {
                const src = normalizeUrl(iframe.getAttribute('src'), pageUrl);
                if (!src) continue;
                try {
                    const u = new URL(src);
                    if ((u.hostname === 'turbo.cr' || u.hostname.endsWith('.turbo.cr')) && /\/(?:embed|v|d)\//i.test(u.pathname)) {
                        queueTask({ type: 'turbo', url: src });
                        continue;
                    }
                    if ((u.hostname === 'cyberdrop.cr' || u.hostname.endsWith('.cyberdrop.cr'))) {
                        const file = u.pathname.match(/^\/[ef]\/([^/?#]+)/i);
                        if (file) queueTask({ type: 'cyberdrop-file', url: src, id: file[1] });
                    }
                } catch {}
            }

            for (const unfurl of root.querySelectorAll('[data-url]')) {
                const href = normalizeUrl(unfurl.getAttribute('data-url'), pageUrl);
                if (!href) continue;
                try {
                    const u = new URL(href);
                    const host = u.hostname.toLowerCase();
                    if (host === 'bunkr.cr' || host.endsWith('.bunkr.cr')) {
                        const album = u.pathname.match(/^\/a\/([^/?#]+)/i);
                        const file = u.pathname.match(/^\/[fvid]\/([^/?#]+)/i);
                        if (album) queueTask({ type: 'bunkr-album', url: href, id: album[1] });
                        else if (file) queueTask({ type: 'bunkr-media', url: href });
                    } else if (host === 'cyberdrop.cr' || host.endsWith('.cyberdrop.cr')) {
                        const file = u.pathname.match(/^\/[ef]\/([^/?#]+)/i);
                        if (file) queueTask({ type: 'cyberdrop-file', url: href, id: file[1] });
                    }
                } catch {}
            }

            for (const video of root.querySelectorAll('video[src], video source[src]')) {
                const src = normalizeUrl(video.getAttribute('src'), pageUrl);
                if (src) addVideo(src);
            }

            for (const img of root.querySelectorAll('img')) {
                if (handledImages.has(img)) continue;
                const src = bestImageUrl(img, pageUrl);
                if (!src || isForumUiImage(img, src)) continue;
                try {
                    const host = new URL(src).hostname.toLowerCase();
                    if (host.endsWith('cuckcapital.cr')) {
                        addImage(src);
                    } else if (DIRECT_IMAGE_EXT.test(src)) {
                        addImage(src);
                    }
                } catch {}
            }
        }
    }

    function addMediaByMime(url, mime = '', name = '') {
        const lowerMime = String(mime || '').toLowerCase();
        const lowerName = String(name || '').toLowerCase();
        if (lowerMime.startsWith('image/') || DIRECT_IMAGE_EXT.test(lowerName) || DIRECT_IMAGE_EXT.test(url)) {
            addImage(url);
            return true;
        }
        if (lowerMime.startsWith('video/') || DIRECT_VIDEO_EXT.test(lowerName) || DIRECT_VIDEO_EXT.test(url)) {
            addVideo(url);
            return true;
        }
        return false;
    }

    function gmRequest(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: options.url,
                headers: options.headers || {},
                timeout: options.timeout || 20000,
                responseType: options.responseType || 'text',
                data: options.data,
                onload: response => resolve(response),
                onerror: error => reject(new Error(error?.error || 'Network error')),
                ontimeout: () => reject(new Error('Request timed out')),
            });
        });
    }

    async function gmJson(url, headers = {}, options = {}) {
        const response = await gmRequest({ url, headers, ...options });
        if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
        try { return JSON.parse(response.responseText); }
        catch { throw new Error('Invalid JSON response'); }
    }

    function goonboxIdFromUrl(url) {
        try {
            const m = new URL(url).pathname.match(/\/(?:img|image|images)\/([^/?#]+)/i);
            return m?.[1] || null;
        } catch { return null; }
    }

    function goonboxAlbumIdFromUrl(url) {
        try {
            const m = new URL(url).pathname.match(/\/(?:a|album|albums)\/([^/?#]+)/i);
            return m?.[1] || null;
        } catch { return null; }
    }

    function getGoonboxOriginal(data) {
        const candidates = [
            data?.image?.original_url,
            data?.data?.image?.original_url,
            data?.data?.original_url,
            data?.original_url,
            data?.image?.url,
            data?.data?.url,
            data?.url,
            data?.image?.medium_url,
            data?.medium_url,
        ];
        return candidates.find(x => typeof x === 'string' && /^https?:\/\//i.test(x)) || null;
    }

    async function resolveGoonboxImage(task) {
        const id = goonboxIdFromUrl(task.url);
        if (!id) {
            if (task.fallback) addImage(task.fallback);
            else addUnresolved(task.url, 'Could not read Goonbox image ID');
            return;
        }

        const endpoints = [
            `https://goonbox.cr/api/images/${encodeURIComponent(id)}`,
            `https://goonbox.cr/api/image/${encodeURIComponent(id)}`,
        ];

        for (const endpoint of endpoints) {
            try {
                const data = await gmJson(endpoint, { 'Accept': 'application/json' });
                const original = getGoonboxOriginal(data);
                if (original) {
                    addImage(original);
                    return;
                }
            } catch {}
        }

        if (task.fallback) addImage(task.fallback);
        else addUnresolved(task.url, 'Goonbox API did not return an original URL');
    }

    function normalizeGoonboxImageObject(img) {
        if (!img || typeof img !== 'object') return null;
        return img.original_url || img.url || img.src || img.medium_url || img.thumb_url || null;
    }

    async function resolveGoonboxAlbum(task) {
        const id = goonboxAlbumIdFromUrl(task.url);
        if (!id) {
            addUnresolved(task.url, 'Could not read Goonbox album ID');
            return;
        }

        let found = 0;
        for (let page = 1; page <= 500; page++) {
            let data;
            try {
                data = await gmJson(`https://goonbox.cr/api/albums/${encodeURIComponent(id)}/images?page=${page}`, { 'Accept': 'application/json' });
            } catch (error) {
                if (page === 1) addUnresolved(task.url, `Goonbox album API failed: ${error.message}`);
                break;
            }

            const images = data?.images || data?.data?.images || data?.data || [];
            const list = Array.isArray(images) ? images : [];
            if (!list.length) break;

            for (const img of list) {
                const direct = normalizeGoonboxImageObject(img);
                if (direct) {
                    addImage(direct);
                    found++;
                }
            }

            const lastPage = Number(data?.last_page || data?.meta?.last_page || data?.pagination?.last_page || 0);
            const hasMore = data?.has_more ?? data?.meta?.has_more;
            if ((lastPage && page >= lastPage) || hasMore === false) break;
        }

        if (!found && !state.seenUnresolved.has(task.url)) addUnresolved(task.url, 'Goonbox album contained no resolvable images');
    }

    function turboIdFromUrl(url) {
        try {
            const m = new URL(url).pathname.match(/\/(?:embed|v|d)\/([^/?#]+)/i);
            return m?.[1] || null;
        } catch { return null; }
    }

    async function resolveTurbo(task) {
        const id = turboIdFromUrl(task.url);
        if (!id) {
            addUnresolved(task.url, 'Could not read Turbo video ID');
            return;
        }
        try {
            const data = await gmJson(`https://turbo.cr/api/sign?v=${encodeURIComponent(id)}`, {
                'Accept': 'application/json',
                'Referer': `https://turbo.cr/embed/${id}`,
                'Origin': 'https://turbo.cr',
            });
            const direct = data?.url || data?.data?.url;
            if (data?.success !== false && typeof direct === 'string' && /^https?:\/\//i.test(direct)) {
                addVideo(direct);
                return;
            }
            throw new Error(data?.message || 'No signed URL returned');
        } catch (error) {
            addUnresolved(`https://turbo.cr/v/${id}`, `Turbo direct URL failed: ${error.message}`);
        }
    }

    async function resolvePixeldrainFile(task) {
        const id = task.id;
        if (!id) {
            addUnresolved(task.url, 'Could not read Pixeldrain file ID');
            return;
        }
        try {
            const data = await gmJson(`https://pixeldrain.com/api/file/${encodeURIComponent(id)}/info`, { 'Accept': 'application/json' });
            const direct = `https://pixeldrain.com/api/file/${encodeURIComponent(id)}`;
            addMediaByMime(direct, data?.mime_type || '', data?.name || '');
        } catch (error) {
            addUnresolved(task.url, `Pixeldrain file info failed: ${error.message}`);
        }
    }

    async function resolvePixeldrainList(task) {
        let id;
        try { id = new URL(task.url).pathname.match(/^\/l\/([^/?#]+)/i)?.[1]; }
        catch {}
        if (!id) {
            addUnresolved(task.url, 'Could not read Pixeldrain list ID');
            return;
        }

        try {
            const data = await gmJson(`https://pixeldrain.com/api/list/${encodeURIComponent(id)}`, { 'Accept': 'application/json' });
            const files = Array.isArray(data?.files) ? data.files : [];
            if (!files.length) throw new Error('List contains no files');
            for (const file of files) {
                const fileId = file?.id;
                if (!fileId) continue;
                addMediaByMime(
                    `https://pixeldrain.com/api/file/${encodeURIComponent(fileId)}`,
                    file?.mime_type || file?.mimetype || '',
                    file?.name || ''
                );
            }
        } catch (error) {
            addUnresolved(task.url, `Pixeldrain list API failed: ${error.message}`);
        }
    }

    function decodeBase64Bytes(value) {
        try {
            return Uint8Array.from(atob(String(value || '')), c => c.charCodeAt(0));
        } catch {
            return null;
        }
    }

    function decryptBunkrUrl(data) {
        const raw = data?.url;
        if (typeof raw !== 'string' || !raw) return null;
        if (!data?.encrypted) return raw;

        const timestamp = Number(data?.timestamp);
        if (!Number.isFinite(timestamp)) return null;
        const key = new TextEncoder().encode(`SECRET_KEY_${Math.floor(timestamp / 3600)}`);
        const encrypted = decodeBase64Bytes(raw);
        if (!encrypted || !key.length) return null;

        const decoded = new Uint8Array(encrypted.length);
        for (let i = 0; i < encrypted.length; i++) decoded[i] = encrypted[i] ^ key[i % key.length];
        try {
            return new TextDecoder().decode(decoded);
        } catch {
            return null;
        }
    }

    async function resolveCyberdrop(task) {
        const id = task.id || (() => {
            try { return new URL(task.url).pathname.match(/^\/[ef]\/([^/?#]+)/i)?.[1] || null; }
            catch { return null; }
        })();

        if (!id) {
            addUnresolved(task.url, 'Could not read CyberDrop file ID');
            return;
        }

        try {
            const info = await gmJson(`https://api.cyberdrop.cr/api/file/info/${encodeURIComponent(id)}`, { 'Accept': 'application/json' });
            const authUrl = normalizeUrl(info?.auth_url) || `https://api.cyberdrop.cr/api/file/auth/${encodeURIComponent(id)}`;
            const auth = await gmJson(authUrl, { 'Accept': 'application/json' });
            const direct = auth?.url || auth?.data?.url;
            if (typeof direct !== 'string' || !/^https?:\/\//i.test(direct)) throw new Error('No authorized URL returned');

            const mime = info?.mime_type || info?.mime || info?.type || '';
            const name = info?.name || info?.filename || info?.file_name || '';
            if (!addMediaByMime(direct, mime, name)) {
                addVideo(direct);
            }
        } catch (error) {
            addUnresolved(task.url, `CyberDrop direct URL failed: ${error.message}`);
        }
    }

    async function resolveBunkrFileId(dataId, sourceUrl, name = '') {
        const id = String(dataId || '').trim();
        if (!/^\d+$/.test(id)) {
            addUnresolved(sourceUrl, 'Could not read Bunkr file ID');
            return false;
        }

        try {
            const referer = `https://get.bunkrr.su/file/${id}`;
            const data = await gmJson('https://apidl.bunkr.ru/api/_001_v2', {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Referer': referer,
                'Origin': 'https://get.bunkrr.su',
            }, {
                method: 'POST',
                data: JSON.stringify({ id: Number(id) }),
            });

            const direct = decryptBunkrUrl(data);
            if (!direct || !/^https?:\/\//i.test(direct)) throw new Error('No direct URL returned');
            if (!addMediaByMime(direct, data?.mime_type || data?.mime || '', name || data?.name || data?.filename || '')) {
                addUnresolved(sourceUrl, 'Bunkr returned an unsupported media type');
                return false;
            }
            return true;
        } catch (error) {
            addUnresolved(sourceUrl, `Bunkr direct URL failed: ${error.message}`);
            return false;
        }
    }

    async function resolveBunkrAlbum(task) {
        try {
            const albumUrl = task.url.includes('?') ? `${task.url}&advanced=1` : `${task.url}?advanced=1`;
            const response = await gmRequest({
                url: albumUrl,
                headers: { 'Accept': 'text/html,application/xhtml+xml' },
            });
            if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);

            const page = response.responseText || '';
            const block = page.match(/window\.albumFiles\s*=\s*\[([\s\S]*?)<\/script>/i)?.[1] || '';
            const entries = [...block.matchAll(/\bid\s*:\s*(\d+)[\s\S]*?\boriginal\s*:\s*(['"])(.*?)\2/gi)]
                .map(m => ({ id: m[1], name: decodeHtml(m[3].replace(/\\'/g, "'").replace(/\\\"/g, '"')) }));

            let ids = entries;
            if (!ids.length) {
                ids = [...block.matchAll(/\bid\s*:\s*(\d+)/gi)].map(m => ({ id: m[1], name: '' }));
            }
            if (!ids.length) throw new Error('No files found in album data');

            await runPool(ids, item => resolveBunkrFileId(item.id, task.url, item.name), Math.min(REQUEST_CONCURRENCY, 6));
        } catch (error) {
            addUnresolved(task.url, `Bunkr album failed: ${error.message}`);
        }
    }

    async function resolveBunkrMedia(task) {
        try {
            const response = await gmRequest({
                url: task.url,
                headers: { 'Accept': 'text/html,application/xhtml+xml' },
            });
            if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
            const page = response.responseText || '';
            const dataId = page.match(/data-file-id=["'](\d+)["']/i)?.[1];
            const name = decodeHtml(page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '') || '');
            if (!dataId) throw new Error('No file ID found');
            await resolveBunkrFileId(dataId, task.url, name);
        } catch (error) {
            addUnresolved(task.url, `Bunkr media page failed: ${error.message}`);
        }
    }

    async function runPool(items, worker, concurrency = REQUEST_CONCURRENCY) {
        let index = 0;
        const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
            while (true) {
                const current = index++;
                if (current >= items.length) return;
                await worker(items[current], current, items.length);
            }
        });
        await Promise.all(runners);
    }

    async function resolveTask(task) {
        if (task.type === 'goonbox-image') return resolveGoonboxImage(task);
        if (task.type === 'goonbox-album') return resolveGoonboxAlbum(task);
        if (task.type === 'turbo') return resolveTurbo(task);
        if (task.type === 'pixeldrain-file') return resolvePixeldrainFile(task);
        if (task.type === 'pixeldrain-list') return resolvePixeldrainList(task);
        if (task.type === 'cyberdrop-file') return resolveCyberdrop(task);
        if (task.type === 'bunkr-album') return resolveBunkrAlbum(task);
        if (task.type === 'bunkr-media') return resolveBunkrMedia(task);
    }

    function resetState() {
        state.images = [];
        state.videos = [];
        state.unresolved = [];
        state.seenImages = new Set();
        state.seenVideos = new Set();
        state.seenUnresolved = new Set();
        state.pages = 0;
        state.posts = 0;
        state.hostTasks = [];
    }

    function setStatus(text) {
        const el = document.getElementById('sc-omlp-status');
        if (el) el.textContent = text;
    }

    async function parseThread() {
        if (state.running) return;
        state.running = true;
        resetState();
        setStatus('Starting...');
        setButtonBusy(true);

        try {
            let nextUrl = threadBaseUrl();
            const visited = new Set();

            while (nextUrl && !visited.has(nextUrl) && visited.size < THREAD_LIMIT) {
                visited.add(nextUrl);
                setStatus(`Reading page ${visited.size}...`);
                const doc = await fetchDocument(nextUrl);
                collectFromDocument(doc, nextUrl);
                state.pages = visited.size;
                nextUrl = findNextPage(doc, nextUrl);
            }

            if (visited.size >= THREAD_LIMIT && nextUrl) {
                addUnresolved(nextUrl, `Stopped after ${THREAD_LIMIT} pages`);
            }

            const tasks = state.hostTasks.slice();
            if (tasks.length) {
                let completed = 0;
                await runPool(tasks, async task => {
                    await resolveTask(task);
                    completed++;
                    setStatus(`Resolving host links ${completed}/${tasks.length}...`);
                });
            }

            renderResults('all');
            setStatus(`Done: ${state.pages} page(s), ${state.posts} post(s), ${state.images.length} image(s), ${state.videos.length} video(s)`);
        } catch (error) {
            setStatus(`Error: ${error.message}`);
            console.error('[SimpCity Original Media Parser]', error);
        } finally {
            state.running = false;
            setButtonBusy(false);
        }
    }

    function getView(mode) {
        if (mode === 'images') return state.images.slice();
        if (mode === 'videos') return state.videos.slice();
        if (mode === 'unresolved') return state.unresolved.map(x => x.url);
        return [...state.images, ...state.videos];
    }

    function renderResults(mode = 'all') {
        const panel = document.getElementById('sc-omlp-panel');
        const textarea = document.getElementById('sc-omlp-output');
        const meta = document.getElementById('sc-omlp-meta');
        if (!panel || !textarea || !meta) return;

        panel.dataset.mode = mode;
        const urls = getView(mode);
        textarea.value = urls.join('\n');
        meta.textContent = `${urls.length} URL(s) | Images: ${state.images.length} | Videos: ${state.videos.length} | Unresolved: ${state.unresolved.length}`;

        for (const b of panel.querySelectorAll('[data-view]')) {
            b.classList.toggle('sc-omlp-active', b.dataset.view === mode);
        }

        const unresolvedBox = document.getElementById('sc-omlp-unresolved-details');
        if (unresolvedBox) {
            unresolvedBox.textContent = mode === 'unresolved'
                ? state.unresolved.map(x => x.reason ? `${x.url}\n  ${x.reason}` : x.url).join('\n\n')
                : '';
            unresolvedBox.style.display = mode === 'unresolved' && state.unresolved.length ? 'block' : 'none';
        }
    }

    async function copyCurrent() {
        const textarea = document.getElementById('sc-omlp-output');
        if (!textarea) return;
        const text = textarea.value;
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
            else GM_setClipboard(text, 'text');
            setStatus(`Copied ${text ? text.split('\n').length : 0} URL(s)`);
        } catch {
            GM_setClipboard(text, 'text');
            setStatus('Copied');
        }
    }

    function saveCurrent() {
        const textarea = document.getElementById('sc-omlp-output');
        if (!textarea) return;
        const mode = document.getElementById('sc-omlp-panel')?.dataset.mode || 'all';
        const title = document.querySelector('h1')?.textContent?.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'SimpCity';
        const blob = new Blob([textarea.value + (textarea.value ? '\n' : '')], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${title} - ${mode} media URLs.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    function setButtonBusy(busy) {
        const button = document.getElementById('sc-omlp-run');
        if (!button) return;
        button.disabled = busy;
        button.textContent = busy ? 'Parsing...' : 'Parse Original Media';
    }

    function createUi() {
        if (document.getElementById('sc-omlp-run')) return;

        const style = document.createElement('style');
        style.textContent = `
#sc-omlp-run{position:fixed;right:18px;bottom:18px;z-index:2147483646;border:0;border-radius:8px;padding:11px 15px;font:600 14px/1.2 Arial,sans-serif;cursor:pointer;background:#2f6fed;color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.35)}
#sc-omlp-run:disabled{opacity:.65;cursor:wait}
#sc-omlp-panel{display:none;position:fixed;inset:5vh 5vw;z-index:2147483647;background:#1d1d1d;color:#eee;border:1px solid #555;border-radius:10px;box-shadow:0 12px 50px rgba(0,0,0,.65);padding:14px;font:14px/1.35 Arial,sans-serif}
#sc-omlp-panel.sc-omlp-open{display:flex;flex-direction:column;gap:10px}
#sc-omlp-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
#sc-omlp-head strong{font-size:16px;margin-right:auto}
#sc-omlp-panel button{border:1px solid #666;border-radius:6px;padding:7px 10px;background:#333;color:#eee;cursor:pointer}
#sc-omlp-panel button:hover,#sc-omlp-panel button.sc-omlp-active{background:#2f6fed;border-color:#2f6fed;color:#fff}
#sc-omlp-output{width:100%;flex:1;min-height:45vh;box-sizing:border-box;resize:none;background:#111;color:#e8e8e8;border:1px solid #555;border-radius:6px;padding:10px;font:12px/1.45 Consolas,monospace;white-space:pre}
#sc-omlp-status,#sc-omlp-meta{color:#bbb}
#sc-omlp-unresolved-details{display:none;max-height:18vh;overflow:auto;white-space:pre-wrap;background:#151515;border:1px solid #444;border-radius:6px;padding:8px;color:#e7ad66;font:12px/1.4 Consolas,monospace}
#sc-omlp-note{color:#d7b46a;font-size:12px}
`;
        document.head.appendChild(style);

        const run = document.createElement('button');
        run.id = 'sc-omlp-run';
        run.type = 'button';
        run.textContent = 'Parse Original Media';
        run.addEventListener('click', () => {
            openPanel();
            parseThread();
        });
        document.body.appendChild(run);

        const panel = document.createElement('div');
        panel.id = 'sc-omlp-panel';
        panel.dataset.mode = 'all';
        panel.innerHTML = `
<div id="sc-omlp-head">
  <strong>${SCRIPT_NAME}</strong>
  <button type="button" data-view="all" class="sc-omlp-active">All</button>
  <button type="button" data-view="images">Images</button>
  <button type="button" data-view="videos">Videos</button>
  <button type="button" data-view="unresolved">Unresolved</button>
  <button type="button" id="sc-omlp-copy">Copy</button>
  <button type="button" id="sc-omlp-save">Save TXT</button>
  <button type="button" id="sc-omlp-close">Close</button>
</div>
<div id="sc-omlp-status">Ready</div>
<div id="sc-omlp-meta">0 URL(s)</div>
<textarea id="sc-omlp-output" spellcheck="false" readonly></textarea>
<div id="sc-omlp-unresolved-details"></div>
<div id="sc-omlp-note">Turbo direct video URLs are signed and may expire. Re-run the parser to refresh them.</div>`;
        document.body.appendChild(panel);

        for (const b of panel.querySelectorAll('[data-view]')) {
            b.addEventListener('click', () => renderResults(b.dataset.view));
        }
        panel.querySelector('#sc-omlp-copy').addEventListener('click', copyCurrent);
        panel.querySelector('#sc-omlp-save').addEventListener('click', saveCurrent);
        panel.querySelector('#sc-omlp-close').addEventListener('click', () => panel.classList.remove('sc-omlp-open'));
    }

    function openPanel() {
        document.getElementById('sc-omlp-panel')?.classList.add('sc-omlp-open');
    }

    createUi();
})();