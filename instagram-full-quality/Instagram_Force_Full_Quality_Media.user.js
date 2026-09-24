// ==UserScript==
// @name         Instagram Force Full Quality Media
// @namespace    https://www.instagram.com/
// @version      4.0.0
// @description  Forces the highest-quality Instagram post/Reel media while leaving profile/search/explore thumbnails untouched.
// @match        https://www.instagram.com/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const CFG = {
        SHOW_BADGE: true,
        DEBUG: false,
        RESCAN_MS: 900,
        MIN_IMAGE_SIDE: 220,
        MIN_VIDEO_SIDE: 180,
        API_RETRY_MS: 6000
    };

    const IG_APP_ID = '936619743392459';
    const IG_ASBD_ID = '129477';
    const SHORTCODE_ALPHABET =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

    const MEDIA_PATH_RE = /^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/;
    const CDN_HOST_RE = /(^|\.)((cdninstagram\.com)|(fbcdn\.net))$/i;

    const mediaByCode = new Map();
    const mediaInfoCache = new Map();
    const imageState = new WeakMap();
    const videoState = new WeakMap();

    let imageUpgradeCount = 0;
    let videoUpgradeCount = 0;
    let apiSuccessCount = 0;
    let badge = null;
    let applyTimer = 0;

    const log = (...args) => {
        if (CFG.DEBUG) console.log('[IG HQ]', ...args);
    };

    function isInstagramMediaUrl(value) {
        if (!value || typeof value !== 'string') return false;
        if (value.startsWith('blob:') || value.startsWith('data:')) return false;

        try {
            const url = new URL(value, location.href);
            return url.protocol === 'https:' && CDN_HOST_RE.test(url.hostname);
        } catch {
            return false;
        }
    }

    function shortcodeFromUrl(value) {
        try {
            return new URL(value, location.href).pathname.match(MEDIA_PATH_RE)?.[1] || null;
        } catch {
            return null;
        }
    }

    function currentShortcode() {
        return shortcodeFromUrl(location.href);
    }

    function shortcodeToMediaPk(shortcode) {
        if (!shortcode) return null;

        let value = 0n;

        for (const ch of shortcode) {
            const index = SHORTCODE_ALPHABET.indexOf(ch);
            if (index < 0) return null;
            value = value * 64n + BigInt(index);
        }

        return value.toString();
    }

    function ensureBadge() {
        if (!CFG.SHOW_BADGE || badge || !document.documentElement) return;

        badge = document.createElement('div');
        badge.id = '__ig_hq_status';
        Object.assign(badge.style, {
            position: 'fixed',
            right: '8px',
            bottom: '8px',
            zIndex: '2147483647',
            padding: '4px 7px',
            borderRadius: '5px',
            background: 'rgba(0,0,0,.78)',
            color: '#fff',
            font: '11px/1.2 Arial,sans-serif',
            pointerEvents: 'none',
            opacity: '0.82'
        });

        (document.body || document.documentElement).appendChild(badge);
        updateBadge();
    }

    function updateBadge() {
        if (!badge) return;
        badge.textContent =
            `IG HQ: ON | img ${imageUpgradeCount} | video ${videoUpgradeCount} | api ${apiSuccessCount}`;
    }

    function scheduleApply(delay = 20) {
        clearTimeout(applyTimer);
        applyTimer = setTimeout(applyAll, delay);
    }

    function n(value) {
        const x = Number(value);
        return Number.isFinite(x) ? x : 0;
    }

    function normalizeCandidate(candidate) {
        if (!candidate || typeof candidate !== 'object') return null;

        const url = typeof candidate.url === 'string' ? candidate.url : '';
        if (!isInstagramMediaUrl(url)) return null;

        return {
            url,
            width: n(candidate.width),
            height: n(candidate.height),
            bitrate: n(candidate.bitrate || candidate.bandwidth)
        };
    }

    function uniqueCandidates(list) {
        const seen = new Set();
        const out = [];

        for (const value of list || []) {
            const candidate = normalizeCandidate(value);
            if (!candidate || seen.has(candidate.url)) continue;

            seen.add(candidate.url);
            out.push(candidate);
        }

        return out;
    }

    function allImageCandidates(item) {
        if (!item || typeof item !== 'object') return [];

        const list = [
            ...uniqueCandidates(item.image_versions2?.candidates)
        ];

        const additional = item.image_versions2?.additional_candidates;

        if (additional && typeof additional === 'object') {
            if (Array.isArray(additional)) {
                list.push(...uniqueCandidates(additional));
            } else {
                list.push(...uniqueCandidates(Object.values(additional)));
            }
        }

        const width = n(
            item.original_width ||
            item.width ||
            item.dimensions?.width
        );

        const height = n(
            item.original_height ||
            item.height ||
            item.dimensions?.height
        );

        for (const key of ['display_uri', 'display_url']) {
            const url = item[key];

            if (typeof url === 'string' && isInstagramMediaUrl(url)) {
                list.push({ url, width, height, bitrate: 0 });
            }
        }

        const seen = new Set();

        return list.filter(candidate => {
            if (seen.has(candidate.url)) return false;
            seen.add(candidate.url);
            return true;
        });
    }

    function bestImage(item) {
        return allImageCandidates(item)
            .sort((a, b) => {
                const areaDiff =
                    (b.width * b.height) - (a.width * a.height);

                if (areaDiff) return areaDiff;

                const widthDiff = b.width - a.width;
                if (widthDiff) return widthDiff;

                return b.height - a.height;
            })[0] || null;
    }

    function allVideoCandidates(item) {
        return uniqueCandidates(item?.video_versions)
            .sort((a, b) => {
                const areaDiff =
                    (b.width * b.height) - (a.width * a.height);

                if (areaDiff) return areaDiff;

                const bitrateDiff = b.bitrate - a.bitrate;
                if (bitrateDiff) return bitrateDiff;

                return b.width - a.width;
            });
    }

    function compactMedia(item, inheritedCode = '') {
        if (!item || typeof item !== 'object') return null;

        const code =
            (typeof item.code === 'string' && item.code) ||
            (typeof item.shortcode === 'string' && item.shortcode) ||
            inheritedCode ||
            '';

        const carousel = Array.isArray(item.carousel_media)
            ? item.carousel_media
                .slice(0, 50)
                .map(child => compactMedia(child, ''))
                .filter(Boolean)
            : [];

        return {
            code,
            id: String(item.pk ?? item.id ?? ''),
            media_type: n(item.media_type),
            original_width: n(
                item.original_width ||
                item.width ||
                item.dimensions?.width
            ),
            original_height: n(
                item.original_height ||
                item.height ||
                item.dimensions?.height
            ),
            image_versions2: item.image_versions2 || null,
            display_uri:
                typeof item.display_uri === 'string'
                    ? item.display_uri
                    : '',
            display_url:
                typeof item.display_url === 'string'
                    ? item.display_url
                    : '',
            video_versions: Array.isArray(item.video_versions)
                ? item.video_versions
                : [],
            carousel_media: carousel
        };
    }

    function mediaRichness(item) {
        if (!item) return -1;

        return (
            allImageCandidates(item).length +
            allVideoCandidates(item).length * 10 +
            (item.carousel_media?.length || 0) * 100
        );
    }

    function storeMedia(code, item) {
        if (!code || !item) return;

        const compact = compactMedia(item, code);
        if (!compact) return;

        compact.code = code;

        const old = mediaByCode.get(code);

        if (!old || mediaRichness(compact) >= mediaRichness(old)) {
            mediaByCode.set(code, compact);
        }
    }

    async function fetchMediaInfo(code, force = false) {
        if (!code) return null;

        const now = Date.now();
        const cached = mediaInfoCache.get(code);

        if (!force && cached) {
            if (cached.value) return cached.value;
            if (cached.promise) return cached.promise;

            if (
                cached.failedAt &&
                now - cached.failedAt < CFG.API_RETRY_MS
            ) {
                return null;
            }
        }

        const pk = shortcodeToMediaPk(code);
        if (!pk) return null;

        const promise = (async () => {
            try {
                const response = await fetch(
                    `/api/v1/media/${pk}/info/`,
                    {
                        method: 'GET',
                        credentials: 'include',
                        cache: 'no-store',
                        headers: {
                            'Accept': '*/*',
                            'X-IG-App-ID': IG_APP_ID,
                            'X-ASBD-ID': IG_ASBD_ID,
                            'X-Requested-With': 'XMLHttpRequest'
                        }
                    }
                );

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const json = await response.json();
                const item = json?.items?.[0];

                if (!item) {
                    throw new Error('No media item returned');
                }

                const compact = compactMedia(item, code);
                compact.code = code;

                mediaByCode.set(code, compact);
                mediaInfoCache.set(code, {
                    value: compact,
                    promise: null,
                    failedAt: 0
                });

                apiSuccessCount++;
                updateBadge();
                scheduleApply(0);

                return compact;
            } catch (error) {
                mediaInfoCache.set(code, {
                    value: null,
                    promise: null,
                    failedAt: Date.now()
                });

                log('media info failed', code, error);
                return null;
            }
        })();

        mediaInfoCache.set(code, {
            value: null,
            promise,
            failedAt: 0
        });

        return promise;
    }

    function parseSrcset(srcset) {
        if (!srcset) return [];

        const out = [];

        for (const part of srcset.split(',')) {
            const value = part.trim();
            if (!value) continue;

            const match = value.match(/^(\S+)(?:\s+([0-9.]+)(w|x))?$/);
            if (!match) continue;

            const url = match[1];
            if (!isInstagramMediaUrl(url)) continue;

            let score = 1;

            if (match[2]) {
                const amount = Number(match[2]) || 0;
                score = match[3] === 'x'
                    ? amount * 1000000
                    : amount;
            }

            out.push({ url, score });
        }

        return out.sort((a, b) => b.score - a.score);
    }

    function getImageState(img) {
        let state = imageState.get(img);

        if (!state) {
            state = {
                nativeSrc: '',
                nativeSrcset: '',
                appliedSrc: '',
                appliedSrcset: null
            };

            imageState.set(img, state);
            captureNativeImageState(img, state, true);
        }

        return state;
    }

    function captureNativeImageState(img, state = getImageState(img), initial = false) {
        const src = img.getAttribute('src') || '';
        const srcset = img.getAttribute('srcset') || '';

        const srcIsApplied =
            state.appliedSrc &&
            src === state.appliedSrc;

        const srcsetIsApplied =
            state.appliedSrcset !== null &&
            srcset === state.appliedSrcset;

        if (initial || !srcIsApplied) {
            if (src && isInstagramMediaUrl(src)) {
                state.nativeSrc = src;
            }
        }

        if (initial || !srcsetIsApplied) {
            if (srcset) {
                state.nativeSrcset = srcset;
            }
        }

        return state;
    }

    function nativeImageUrls(img) {
        const state = captureNativeImageState(img);
        const urls = new Set();

        if (isInstagramMediaUrl(state.nativeSrc)) {
            urls.add(state.nativeSrc);
        }

        for (const candidate of parseSrcset(state.nativeSrcset)) {
            urls.add(candidate.url);
        }

        return [...urls];
    }

    function normalizedAssetPath(value) {
        if (!isInstagramMediaUrl(value)) return '';

        try {
            return decodeURIComponent(
                new URL(value, location.href).pathname
            );
        } catch {
            return '';
        }
    }

    function assetFilename(value) {
        const path = normalizedAssetPath(value);
        return path.split('/').filter(Boolean).pop() || '';
    }

    function candidateMatchScore(img, item) {
        const nativeUrls = nativeImageUrls(img);
        if (!nativeUrls.length) return 0;

        const itemUrls = allImageCandidates(item)
            .map(candidate => candidate.url);

        let best = 0;

        for (const nativeUrl of nativeUrls) {
            const nativePath = normalizedAssetPath(nativeUrl);
            const nativeFile = assetFilename(nativeUrl);

            for (const itemUrl of itemUrls) {
                if (nativeUrl === itemUrl) {
                    best = Math.max(best, 1000);
                    continue;
                }

                const itemPath = normalizedAssetPath(itemUrl);

                if (
                    nativePath &&
                    itemPath &&
                    nativePath === itemPath
                ) {
                    best = Math.max(best, 800);
                    continue;
                }

                const itemFile = assetFilename(itemUrl);

                if (
                    nativeFile &&
                    itemFile &&
                    nativeFile.length >= 12 &&
                    nativeFile === itemFile
                ) {
                    best = Math.max(best, 500);
                }
            }
        }

        return best;
    }

    function findCarouselChild(img, record) {
        const children = record?.carousel_media || [];
        if (!children.length) return null;

        let winner = null;
        let winnerScore = 0;
        let tied = false;

        for (const child of children) {
            if (allVideoCandidates(child).length) continue;

            const score = candidateMatchScore(img, child);

            if (score > winnerScore) {
                winner = child;
                winnerScore = score;
                tied = false;
            } else if (score > 0 && score === winnerScore) {
                tied = true;
            }
        }

        if (tied || winnerScore <= 0) return null;
        return winner;
    }

    function isLargeImage(img) {
        const rect = img.getBoundingClientRect();

        return (
            rect.width >= CFG.MIN_IMAGE_SIDE &&
            rect.height >= CFG.MIN_IMAGE_SIDE
        ) || (
            img.naturalWidth >= CFG.MIN_IMAGE_SIDE &&
            img.naturalHeight >= CFG.MIN_IMAGE_SIDE
        );
    }

    function isLargeVideo(video) {
        const rect = video.getBoundingClientRect();

        return (
            rect.width >= CFG.MIN_VIDEO_SIDE &&
            rect.height >= CFG.MIN_VIDEO_SIDE
        ) || (
            video.videoWidth >= CFG.MIN_VIDEO_SIDE &&
            video.videoHeight >= CFG.MIN_VIDEO_SIDE
        );
    }

    function looksLikeAvatarOrUiImage(img) {
        if (!(img instanceof HTMLImageElement)) return true;

        const alt = (img.alt || '').toLowerCase();

        if (
            alt.includes('profile picture') ||
            alt.includes('profile photo')
        ) {
            return true;
        }

        const rect = img.getBoundingClientRect();

        if (rect.width > 0 && rect.height > 0) {
            if (rect.width < CFG.MIN_IMAGE_SIDE || rect.height < CFG.MIN_IMAGE_SIDE) {
                return true;
            }
        }

        return false;
    }

    function applyImageUrl(img, target) {
        if (
            !(img instanceof HTMLImageElement) ||
            !isInstagramMediaUrl(target)
        ) {
            return false;
        }

        const state = getImageState(img);

        if (
            state.appliedSrc === target &&
            img.getAttribute('src') === target &&
            !img.hasAttribute('srcset')
        ) {
            return true;
        }

        captureNativeImageState(img, state);

        state.appliedSrc = target;
        state.appliedSrcset = '';

        img.dataset.igHqManaged = '1';
        img.removeAttribute('sizes');
        img.removeAttribute('srcset');

        if (img.getAttribute('src') !== target) {
            img.setAttribute('src', target);
        }

        imageUpgradeCount++;
        updateBadge();

        return true;
    }

    function restoreNativeImageIfNeeded(img) {
        const state = imageState.get(img);
        if (!state) return;

        const currentSrc = img.getAttribute('src') || '';
        const currentSrcset = img.getAttribute('srcset') || '';

        const stillApplied =
            currentSrc === state.appliedSrc &&
            currentSrcset === '';

        if (stillApplied) return;

        captureNativeImageState(img, state);

        state.appliedSrc = '';
        state.appliedSrcset = null;
    }

    function fallbackToOwnLargestSrcset(img) {
        const state = getImageState(img);
        const candidates = parseSrcset(state.nativeSrcset);
        const target = candidates[0]?.url;

        if (!target) return false;
        return applyImageUrl(img, target);
    }

    function applySingleImage(img, record) {
        if (
            !(img instanceof HTMLImageElement) ||
            looksLikeAvatarOrUiImage(img) ||
            !isLargeImage(img)
        ) {
            return false;
        }

        const best = bestImage(record);

        if (best?.url) {
            const score = candidateMatchScore(img, record);

            if (score > 0) {
                return applyImageUrl(img, best.url);
            }
        }

        return fallbackToOwnLargestSrcset(img);
    }

    function applyCarouselImage(img, record) {
        if (
            !(img instanceof HTMLImageElement) ||
            looksLikeAvatarOrUiImage(img) ||
            !isLargeImage(img)
        ) {
            return false;
        }

        const child = findCarouselChild(img, record);

        if (!child) {
            // Safety first: if identity is uncertain, do not force another
            // carousel item's URL onto this image. Use only this img's own
            // largest native srcset candidate.
            return fallbackToOwnLargestSrcset(img);
        }

        const best = bestImage(child);
        if (!best?.url) {
            return fallbackToOwnLargestSrcset(img);
        }

        return applyImageUrl(img, best.url);
    }

    function applyVideoUrl(video, target) {
        if (
            !(video instanceof HTMLVideoElement) ||
            !isInstagramMediaUrl(target)
        ) {
            return false;
        }

        let state = videoState.get(video);

        if (!state) {
            state = {
                target: '',
                failures: new Set()
            };
            videoState.set(video, state);
        }

        if (state.failures.has(target)) return false;

        const current =
            video.currentSrc ||
            video.getAttribute('src') ||
            '';

        if (state.target === target && current === target) {
            return true;
        }

        const playback = {
            paused: video.paused,
            time: Number.isFinite(video.currentTime)
                ? video.currentTime
                : 0,
            muted: video.muted,
            volume: video.volume,
            rate: video.playbackRate
        };

        state.target = target;
        video.dataset.igHqManaged = '1';

        const onError = () => {
            video.removeEventListener('error', onError);

            if (state.target === target) {
                state.failures.add(target);
                state.target = '';
                scheduleApply(100);
            }
        };

        video.addEventListener('error', onError, { once: true });

        try {
            video.pause();

            for (const source of video.querySelectorAll('source')) {
                source.remove();
            }

            try {
                video.srcObject = null;
            } catch {}

            video.setAttribute('src', target);
            video.preload = 'auto';
            video.load();

            const restore = () => {
                video.removeEventListener('loadedmetadata', restore);

                try {
                    video.muted = playback.muted;
                    video.volume = playback.volume;
                    video.playbackRate = playback.rate;

                    if (
                        playback.time > 0 &&
                        Number.isFinite(video.duration) &&
                        video.duration > 0
                    ) {
                        video.currentTime = Math.min(
                            playback.time,
                            Math.max(0, video.duration - 0.05)
                        );
                    }

                    if (!playback.paused) {
                        video.play().catch(() => {});
                    }
                } catch {}
            };

            video.addEventListener(
                'loadedmetadata',
                restore,
                { once: true }
            );

            videoUpgradeCount++;
            updateBadge();

            return true;
        } catch (error) {
            state.failures.add(target);
            state.target = '';
            log('video apply failed', error);
            return false;
        }
    }

    function applySingleVideo(video, record) {
        if (!isLargeVideo(video)) return false;

        const candidates = allVideoCandidates(record);
        const state = videoState.get(video);

        for (const candidate of candidates) {
            if (state?.failures?.has(candidate.url)) continue;

            if (applyVideoUrl(video, candidate.url)) {
                return true;
            }
        }

        return false;
    }

    function contextCode(context) {
        if (!(context instanceof Element)) return null;

        if (
            context.tagName === 'MAIN' &&
            currentShortcode()
        ) {
            return currentShortcode();
        }

        const links = context.querySelectorAll(
            'a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]'
        );

        for (const link of links) {
            const code = shortcodeFromUrl(link.href);
            if (code) return code;
        }

        if (
            context.matches('div[role="dialog"]') &&
            currentShortcode()
        ) {
            return currentShortcode();
        }

        return null;
    }

    function getMediaContexts() {
        const out = [];
        const seen = new Set();

        const add = element => {
            if (
                !element ||
                !(element instanceof Element) ||
                seen.has(element)
            ) {
                return;
            }

            seen.add(element);
            out.push(element);
        };

        // Feed posts.
        for (const article of document.querySelectorAll('article')) {
            if (contextCode(article)) add(article);
        }

        // Open post/Reel modal.
        for (const dialog of document.querySelectorAll('div[role="dialog"]')) {
            if (contextCode(dialog)) add(dialog);
        }

        // Dedicated /p/... or /reel/... page only.
        // IMPORTANT: generic profile/search/explore <main> is intentionally ignored.
        if (currentShortcode()) {
            add(document.querySelector('main'));
        }

        return out;
    }

    function contextContentImages(context) {
        return [...context.querySelectorAll('img')]
            .filter(img => !looksLikeAvatarOrUiImage(img))
            .filter(isLargeImage);
    }

    function contextVideos(context) {
        return [...context.querySelectorAll('video')]
            .filter(isLargeVideo);
    }

    function applyRecordToContext(context, record) {
        if (!context || !record) return;

        const images = contextContentImages(context);
        const videos = contextVideos(context);

        if (record.carousel_media?.length) {
            for (const img of images) {
                restoreNativeImageIfNeeded(img);
                applyCarouselImage(img, record);
            }

            const videoChildren = record.carousel_media
                .filter(child => allVideoCandidates(child).length);

            if (videos.length === 1 && videoChildren.length === 1) {
                applySingleVideo(videos[0], videoChildren[0]);
            }

            return;
        }

        if (allVideoCandidates(record).length) {
            for (const video of videos) {
                applySingleVideo(video, record);
            }
        }

        if (bestImage(record)) {
            for (const img of images) {
                restoreNativeImageIfNeeded(img);
                applySingleImage(img, record);
            }
        }
    }

    function applyAll() {
        ensureBadge();

        const contexts = getMediaContexts();

        for (const context of contexts) {
            const code = contextCode(context);
            if (!code) continue;

            const record = mediaByCode.get(code);

            if (record) {
                applyRecordToContext(context, record);
            }

            // Primary metadata path. A completed fetch schedules another pass.
            fetchMediaInfo(code);
        }
    }

    function observeDom() {
        if (!document.documentElement) {
            queueMicrotask(observeDom);
            return;
        }

        const observer = new MutationObserver(mutations => {
            let relevant = false;

            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    const target = mutation.target;

                    if (target instanceof HTMLImageElement) {
                        const state = imageState.get(target);
                        if (state) {
                            const src =
                                target.getAttribute('src') || '';

                            const srcset =
                                target.getAttribute('srcset') || '';

                            const isOurState =
                                src === state.appliedSrc &&
                                srcset === '';

                            if (!isOurState) {
                                if (
                                    src &&
                                    isInstagramMediaUrl(src)
                                ) {
                                    state.nativeSrc = src;
                                }

                                if (srcset) {
                                    state.nativeSrcset = srcset;
                                }

                                state.appliedSrc = '';
                                state.appliedSrcset = null;
                            }
                        }
                    }

                    relevant = true;
                    continue;
                }

                if (mutation.type === 'childList') {
                    relevant = true;
                }
            }

            if (relevant) scheduleApply();
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'srcset', 'sizes', 'poster']
        });

        ensureBadge();
        scheduleApply(0);
    }

    // SPA URL changes are not guaranteed to produce a useful media mutation.
    let lastUrl = location.href;

    setInterval(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            scheduleApply(0);
        } else {
            scheduleApply(0);
        }
    }, CFG.RESCAN_MS);

    observeDom();

    console.info('[IG HQ] v4 active');
})();