// ==UserScript==
// @name         OLX - Model Tags
// @namespace    https://www.olx.ua/
// @version      0.3.1
// @description  Tag OLX ads by model (tags shared by every ad of that model) or per ad, mark broken ads, filter search results by tags, per-tag Hide (pixel mesh) / Highlight (outline). Data syncs to GitHub; OLX only gets read locally from the open page.
// @match        https://www.olx.ua/*
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/olx-model-tags/OLX_Model_Tags.user.js
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/olx-model-tags/OLX_Model_Tags.user.js
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      api.github.com
// ==/UserScript==

(() => {
    'use strict';

    // ---------- Pure logic (unit-tested in olx-model-tags.test.cjs) ----------

    const BROKEN_TAG = 'broken';
    const CYRILLIC_LOOKALIKE_TO_LATIN = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', І: 'I' };

    function normalizeModelKey(text) {
        return String(text).toUpperCase()
            .replace(/[АВЕКМНОРСТХУІ]/g, (letter) => CYRILLIC_LOOKALIKE_TO_LATIN[letter])
            .replace(/[^0-9A-Z]/g, '');
    }

    function createEmptyOlxModelTagsData() {
        return { models: {}, ads: {}, tagDisplayModes: {} };
    }

    // shortcut: substring match on the normalized title; very short model names (<4 chars) are ignored to avoid false hits.
    function detectModelKeyInTitle(data, title) {
        const normalizedTitle = normalizeModelKey(title);
        let bestModelKey = '';
        for (const modelKey of Object.keys(data.models)) {
            if (modelKey.length >= 4 && modelKey.length > bestModelKey.length && normalizedTitle.includes(modelKey)) bestModelKey = modelKey;
        }
        return bestModelKey;
    }

    function resolveAdTagging(data, adId, title) {
        const adEntry = data.ads[adId];
        const modelKey = adEntry?.model ? normalizeModelKey(adEntry.model) : detectModelKeyInTitle(data, title);
        const modelEntry = data.models[modelKey];
        return {
            modelKey,
            modelName: modelEntry?.name || adEntry?.model || '',
            modelTags: modelEntry?.tags || [],
            adTags: adEntry?.tags || [],
        };
    }

    function ensureModelEntry(data, modelName) {
        const modelKey = normalizeModelKey(modelName);
        if (!modelKey) throw new Error(`Model "${modelName}" has no letters or digits`);
        data.models[modelKey] ||= { name: modelName.trim(), tags: [] };
        return data.models[modelKey];
    }

    // Operations are idempotent, so replaying them on fresh GitHub data (or twice from two tabs) is safe.
    function applyOlxModelTagsOperation(data, operation) {
        if (operation.type === 'setTagDisplayMode') {
            data.tagDisplayModes ||= {};
            if (operation.displayMode === 'hide' || operation.displayMode === 'highlight') data.tagDisplayModes[operation.tag] = operation.displayMode;
            else delete data.tagDisplayModes[operation.tag];
            return;
        }
        if (operation.type === 'setAdModel') {
            const adEntry = (data.ads[operation.adId] ||= { model: '', tags: [] });
            const previousModelKey = normalizeModelKey(adEntry.model);
            adEntry.model = operation.modelName.trim();
            if (adEntry.model) ensureModelEntry(data, adEntry.model);
            // A mistyped model with no tags and no other ads is dropped, so it stops showing up in suggestions.
            const isPreviousModelUnused = !Object.values(data.ads).some((otherAd) => normalizeModelKey(otherAd.model) === previousModelKey);
            if (previousModelKey && isPreviousModelUnused && !data.models[previousModelKey]?.tags.length) delete data.models[previousModelKey];
            return;
        }
        const tagOwner = operation.scope === 'model'
            ? ensureModelEntry(data, operation.modelName)
            : (data.ads[operation.adId] ||= { model: '', tags: [] });
        if (operation.type === 'addTag' && !tagOwner.tags.includes(operation.tag)) tagOwner.tags.push(operation.tag);
        else if (operation.type === 'removeTag') tagOwner.tags = tagOwner.tags.filter((tag) => tag !== operation.tag);
        else if (operation.type !== 'addTag') throw new Error(`Unknown OLX Model Tags operation: ${operation.type}`);
    }

    function encodeUtf8TextAsBase64(text) {
        let binary = '';
        for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
        return btoa(binary);
    }

    function decodeBase64AsUtf8Text(base64) {
        return new TextDecoder().decode(Uint8Array.from(atob(base64.replace(/\s/g, '')), (character) => character.charCodeAt(0)));
    }

    function doesAdMatchActiveFilters(filterValues, activeFilters, showBrokenAds) {
        if (!showBrokenAds && filterValues.includes(BROKEN_TAG)) return false;
        return activeFilters.every((filter) => filterValues.includes(filter));
    }

    function resolveAdDisplayEffects(data, filterValues) {
        const displayModes = filterValues.map((value) => data.tagDisplayModes?.[value]);
        return { isMeshed: displayModes.includes('hide'), isHighlighted: displayModes.includes('highlight') };
    }

    if (typeof module === 'object') {
        module.exports = { normalizeModelKey, createEmptyOlxModelTagsData, detectModelKeyInTitle, resolveAdTagging, applyOlxModelTagsOperation, encodeUtf8TextAsBase64, decodeBase64AsUtf8Text, doesAdMatchActiveFilters, resolveAdDisplayEffects };
        return;
    }

    // ---------- Storage and GitHub sync ----------
    // Nothing here talks to OLX: ads are read from the already-open page DOM. Only api.github.com is contacted.

    const GITHUB_DATA_REPOSITORY = 'karpuzikov/userscripts';
    const GITHUB_DATA_BRANCH = 'main';
    const GITHUB_DATA_FILE_PATH = 'browser-tools/olx-model-tags/olx-model-tags-data.json';
    const GITHUB_DATA_FILE_URL = `https://api.github.com/repos/${GITHUB_DATA_REPOSITORY}/contents/${GITHUB_DATA_FILE_PATH}`;
    const STORAGE_KEY_CACHED_DATA = 'olxModelTagsCachedData';
    const STORAGE_KEY_CACHED_AT = 'olxModelTagsCachedAt';
    const STORAGE_KEY_PENDING_OPERATIONS = 'olxModelTagsPendingOperations';
    const STORAGE_KEY_GITHUB_TOKEN = 'olxModelTagsGithubToken';
    const STORAGE_KEY_ACTIVE_FILTERS = 'olxModelTagsActiveFilters';
    const STORAGE_KEY_SHOW_BROKEN_ADS = 'olxModelTagsShowBrokenAds';
    const UPLOAD_DEBOUNCE_MS = 2000;
    const UPLOAD_CONFLICT_RETRIES = 3;

    let olxModelTagsData = GM_getValue(STORAGE_KEY_CACHED_DATA, null);
    let synchronizationStatus = { state: 'idle', message: '' };
    let synchronizationInProgress = false;
    let synchronizationRequestedAgain = false;
    let uploadDebounceTimer = 0;

    function rebuildLocalDataFromCacheAndPendingOperations(baseData) {
        const data = structuredClone(baseData);
        for (const operation of GM_getValue(STORAGE_KEY_PENDING_OPERATIONS, [])) applyOlxModelTagsOperation(data, operation);
        return data;
    }

    function recordOperation(operation) {
        GM_setValue(STORAGE_KEY_PENDING_OPERATIONS, [...GM_getValue(STORAGE_KEY_PENDING_OPERATIONS, []), operation]);
        applyOlxModelTagsOperation(olxModelTagsData, operation);
        renderEverything();
        clearTimeout(uploadDebounceTimer);
        uploadDebounceTimer = setTimeout(synchronizeWithGithub, UPLOAD_DEBOUNCE_MS);
    }

    function requestGithubApi(method, url, body) {
        const token = GM_getValue(STORAGE_KEY_GITHUB_TOKEN, '');
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url,
                headers: {
                    Accept: 'application/vnd.github+json',
                    'Cache-Control': 'no-cache',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                data: body ? JSON.stringify(body) : undefined,
                onload: (response) => resolve({ status: response.status, json: (() => { try { return JSON.parse(response.responseText); } catch { return null; } })() }),
                onerror: () => reject(new Error('GitHub unreachable')),
                ontimeout: () => reject(new Error('GitHub timed out')),
            });
        });
    }

    async function downloadDataFileFromGithub() {
        const response = await requestGithubApi('GET', `${GITHUB_DATA_FILE_URL}?ref=${GITHUB_DATA_BRANCH}&t=${Date.now()}`);
        if (response.status === 404) return { data: createEmptyOlxModelTagsData(), sha: null };
        if (response.status !== 200) throw new Error(`GitHub download failed (HTTP ${response.status}${response.json?.message ? `: ${response.json.message}` : ''})`);
        // shortcut: the contents API inlines files up to 1 MB; switch to the blob API if the data file ever grows past that.
        if (!response.json.content) throw new Error('GitHub data file is over 1 MB; the script needs the blob API');
        return { data: JSON.parse(decodeBase64AsUtf8Text(response.json.content)), sha: response.json.sha };
    }

    async function uploadDataFileToGithub(data, sha) {
        const response = await requestGithubApi('PUT', GITHUB_DATA_FILE_URL, {
            message: 'OLX Model Tags: update tags',
            content: encodeUtf8TextAsBase64(`${JSON.stringify(data, null, 1)}\n`),
            branch: GITHUB_DATA_BRANCH,
            ...(sha ? { sha } : {}),
        });
        if (response.status === 200 || response.status === 201) return 'uploaded';
        if (response.status === 409 || response.status === 422) return 'conflict';
        if (response.status === 401 || response.status === 403 || response.status === 404) throw new Error(`GitHub refused the token (HTTP ${response.status}); set a token with Contents write access to ${GITHUB_DATA_REPOSITORY}`);
        throw new Error(`GitHub upload failed (HTTP ${response.status}${response.json?.message ? `: ${response.json.message}` : ''})`);
    }

    async function synchronizeWithGithub() {
        if (synchronizationInProgress) { synchronizationRequestedAgain = true; return; }
        synchronizationInProgress = true;
        setSynchronizationStatus('working', 'Syncing…');
        try {
            let remote;
            const pendingOperations = GM_getValue(STORAGE_KEY_PENDING_OPERATIONS, []);
            for (let attempt = 1; ; attempt++) {
                remote = await downloadDataFileFromGithub();
                if (!pendingOperations.length) break;
                if (!GM_getValue(STORAGE_KEY_GITHUB_TOKEN, '')) throw new Error('GitHub token needed to save tags');
                for (const operation of pendingOperations) applyOlxModelTagsOperation(remote.data, operation);
                if (await uploadDataFileToGithub(remote.data, remote.sha) === 'uploaded') break;
                if (attempt >= UPLOAD_CONFLICT_RETRIES) throw new Error('GitHub data file kept changing during upload; retry');
            }
            // Operations added while uploading stay pending and are applied on top of the fresh data.
            GM_setValue(STORAGE_KEY_PENDING_OPERATIONS, GM_getValue(STORAGE_KEY_PENDING_OPERATIONS, []).slice(pendingOperations.length));
            GM_setValue(STORAGE_KEY_CACHED_DATA, remote.data);
            GM_setValue(STORAGE_KEY_CACHED_AT, Date.now());
            olxModelTagsData = rebuildLocalDataFromCacheAndPendingOperations(remote.data);
            setSynchronizationStatus('synced', 'Synced');
        } catch (error) {
            setSynchronizationStatus('error', error.message);
        } finally {
            synchronizationInProgress = false;
            renderEverything();
            if (synchronizationRequestedAgain) { synchronizationRequestedAgain = false; synchronizeWithGithub(); }
        }
    }

    function setSynchronizationStatus(state, message) {
        synchronizationStatus = { state, message };
        renderFilterPanel();
    }

    function askForGithubToken() {
        const token = prompt(`GitHub fine-grained token with Contents read/write on ${GITHUB_DATA_REPOSITORY}:`, GM_getValue(STORAGE_KEY_GITHUB_TOKEN, ''));
        if (token === null) return;
        GM_setValue(STORAGE_KEY_GITHUB_TOKEN, token.trim());
        synchronizeWithGithub();
    }

    // ---------- Page reading (local DOM only) ----------

    function findAdsOnPage() {
        const ads = [];
        for (const card of document.querySelectorAll('[data-cy="l-card"][id]')) {
            const titleContainer = card.querySelector('[data-testid="ad-card-title"]');
            if (titleContainer && /^\d+$/.test(card.id)) ads.push({ adId: card.id, title: titleContainer.querySelector('h4')?.textContent || '', anchor: titleContainer, card });
        }
        const adPageTitle = document.querySelector('[data-testid="offer_title"]');
        const adPageId = document.querySelector('[data-testid="ad-footer-bar-section"]')?.textContent.match(/ID:\s*(\d+)/)?.[1];
        if (adPageTitle && adPageId) ads.push({ adId: adPageId, title: adPageTitle.textContent, anchor: adPageTitle, card: null });
        return ads;
    }

    // ---------- UI ----------

    GM_addStyle(`
.olx-model-tags-root{--primary:#C6F432;--primary-active:#A9D61C;--on-primary:#181A20;--accent:#2DBDB6;--canvas:#0B0E11;--surface-card:#1E2329;--surface-elevated:#2B3139;--text:#FFFFFF;--body:#EAECEF;--muted:#848E9C;--border-strong:#474D57;--positive:#0ECB81;--negative:#F6465D;--info:#3B82F6;
 font:400 13px/1.4 "Atkinson Hyperlegible Next",Inter,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--body);box-sizing:border-box}
.olx-model-tags-root *{box-sizing:border-box;font:inherit}
.olx-model-tags-bar{position:relative;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:6px 0;padding:4px;background:var(--canvas);border-radius:6px;width:fit-content;max-width:100%}
.olx-model-tags-chip{display:inline-flex;align-items:center;gap:4px;padding:4px;border-radius:4px;background:var(--surface-elevated);color:var(--body);white-space:nowrap}
.olx-model-tags-chip-model{background:transparent;color:var(--accent);font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-weight:500}
.olx-model-tags-chip-ad{color:var(--text);outline:1px dashed var(--border-strong);outline-offset:-1px}
.olx-model-tags-chip-broken{background:var(--negative);color:var(--on-primary);font-weight:600}
.olx-model-tags-icon-button{display:inline-flex;align-items:center;justify-content:center;padding:4px;border:0;border-radius:4px;background:transparent;color:var(--muted);cursor:pointer;line-height:0}
.olx-model-tags-icon-button:hover{background:var(--surface-elevated);color:var(--text)}
.olx-model-tags-icon-button-broken-active{color:var(--negative)}
.olx-model-tags-text-button{padding:6px;border:1px solid var(--border-strong);border-radius:6px;background:var(--surface-card);color:var(--text);font-weight:600;cursor:pointer;white-space:nowrap}
.olx-model-tags-text-button:hover{background:var(--surface-elevated)}
.olx-model-tags-text-button-active{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
.olx-model-tags-text-button-active:hover{background:var(--primary-active)}
.olx-model-tags-root button:focus-visible,.olx-model-tags-root input:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(59,130,246,.5)}
.olx-model-tags-input{width:120px;padding:4px;border:1px solid var(--border-strong);border-radius:4px;background:var(--surface-elevated);color:var(--text)}
.olx-model-tags-input-model{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace}
.olx-model-tags-input::placeholder{color:var(--muted)}
.olx-model-tags-panel{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column;gap:8px;max-width:min(420px,calc(100vw - 32px));max-height:60vh;padding:12px;background:var(--surface-card);border:1px solid var(--border-strong);border-radius:12px}
.olx-model-tags-panel-collapsed{padding:4px;border-radius:8px}
.olx-model-tags-panel-collapsed .olx-model-tags-icon-button{gap:4px;line-height:1}
.olx-model-tags-panel-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.olx-model-tags-panel-filters{display:flex;flex-wrap:wrap;gap:4px;overflow:auto}
.olx-model-tags-count{font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums;color:var(--muted)}
.olx-model-tags-text-button-active .olx-model-tags-count{color:var(--on-primary)}
.olx-model-tags-status-error{color:var(--negative)}
.olx-model-tags-hidden-ad{display:none!important}
.olx-model-tags-bar[data-editing="true"] .olx-model-tags-chip .olx-model-tags-icon-button{display:none}
.olx-model-tags-tag-group{display:inline-flex;align-items:center;gap:4px;padding:4px;border-radius:8px;background:var(--canvas)}
.olx-model-tags-mode-switch{display:inline-flex;gap:2px;padding:2px;border-radius:6px;background:var(--surface-elevated)}
.olx-model-tags-mode-switch .olx-model-tags-icon-button:hover{background:var(--border-strong)}
.olx-model-tags-mode-switch .olx-model-tags-mode-switch-active,.olx-model-tags-mode-switch .olx-model-tags-mode-switch-active:hover{background:#C6F432;color:#181A20}
.olx-model-tags-mode-switch [aria-label^="Do nothing"].olx-model-tags-mode-switch-active{background:var(--border-strong);color:var(--text)}
.olx-model-tags-meshed-ad,.olx-model-tags-highlighted-ad{position:relative!important}
.olx-model-tags-meshed-ad::after{content:"";position:absolute;inset:0;z-index:1;pointer-events:none;border-radius:inherit;background:repeating-conic-gradient(rgba(11,14,17,.9) 0 25%,transparent 0 50%) 0 0/4px 4px}
.olx-model-tags-highlighted-ad::before{content:"";position:absolute;inset:0;z-index:3;pointer-events:none;border:3px solid #C6F432;border-radius:4px}
`);

    const ICON_PATHS = {
        plus: 'M12 5v14M5 12h14',
        close: 'M6 6l12 12M18 6L6 18',
        broken: 'M12 3l9.5 16.5h-19L12 3zM12 10v4M12 17.5v.01',
        sync: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5',
        tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9zM7.5 7.5h.01',
        hide: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3 4M6.6 6.6C4.5 8 3 10 2 12c1 2.5 5 7 10 7 1.7 0 3.3-.5 4.6-1.3',
        nothing: 'M6 12h12',
        highlight: 'M4 4h16v16H4z',
    };

    function createIcon(iconName) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.5');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', ICON_PATHS[iconName]);
        svg.append(path);
        return svg;
    }

    function createElement(tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function createIconButton(iconName, label, onClick, extraClassName = '') {
        const button = createElement('button', `olx-model-tags-icon-button ${extraClassName}`.trim());
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.append(createIcon(iconName));
        button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); onClick(); });
        return button;
    }

    function createTextButton(text, label, onClick, isActive = false) {
        const button = createElement('button', `olx-model-tags-text-button${isActive ? ' olx-model-tags-text-button-active' : ''}`, text);
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-pressed', String(isActive));
        button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); onClick(); });
        return button;
    }

    function ensureDatalists() {
        for (const [datalistId, values] of [
            ['olx-model-tags-known-tags', new Set([...Object.values(olxModelTagsData.models), ...Object.values(olxModelTagsData.ads)].flatMap((entry) => entry.tags))],
            ['olx-model-tags-known-models', new Set(Object.values(olxModelTagsData.models).map((model) => model.name))],
        ]) {
            let datalist = document.getElementById(datalistId);
            if (!datalist) { datalist = createElement('datalist'); datalist.id = datalistId; document.body.append(datalist); }
            datalist.replaceChildren(...[...values].sort().map((value) => Object.assign(document.createElement('option'), { value })));
        }
    }

    function renderTagBar(ad) {
        let bar = ad.anchor.nextElementSibling?.classList.contains('olx-model-tags-bar') ? ad.anchor.nextElementSibling : null;
        if (!bar) {
            bar = createElement('div', 'olx-model-tags-root olx-model-tags-bar');
            bar.addEventListener('click', (event) => event.stopPropagation());
            ad.anchor.after(bar);
        }
        if (bar.dataset.editing === 'true') return;
        const tagging = resolveAdTagging(olxModelTagsData, ad.adId, ad.title);
        const isBroken = tagging.adTags.includes(BROKEN_TAG);
        const children = [];
        if (tagging.modelName) {
            const modelChip = createElement('span', 'olx-model-tags-chip olx-model-tags-chip-model', tagging.modelName);
            const isModelSetForThisAd = Boolean(olxModelTagsData.ads[ad.adId]?.model);
            modelChip.title = isModelSetForThisAd ? 'Model set for this ad' : 'Model found in the title';
            if (isModelSetForThisAd) modelChip.append(createIconButton('close', `Remove model ${tagging.modelName} from this ad`, () => recordOperation({ type: 'setAdModel', adId: ad.adId, modelName: '' })));
            children.push(modelChip);
        }
        for (const tag of tagging.modelTags) {
            children.push(createTagChip(tag, 'olx-model-tags-chip', `Remove "${tag}" from every ${tagging.modelName} ad`,
                () => recordOperation({ type: 'removeTag', scope: 'model', modelName: tagging.modelName, tag })));
        }
        for (const tag of tagging.adTags.filter((tag) => tag !== BROKEN_TAG)) {
            children.push(createTagChip(tag, 'olx-model-tags-chip olx-model-tags-chip-ad', `Remove "${tag}" from this ad`,
                () => recordOperation({ type: 'removeTag', scope: 'ad', adId: ad.adId, tag })));
        }
        if (isBroken) children.push(createElement('span', 'olx-model-tags-chip olx-model-tags-chip-broken', '⚠ Broken'));
        children.push(createIconButton('broken', isBroken ? 'Unmark as broken' : 'Mark this ad as broken (hidden from searches)',
            () => recordOperation({ type: isBroken ? 'removeTag' : 'addTag', scope: 'ad', adId: ad.adId, tag: BROKEN_TAG }),
            isBroken ? 'olx-model-tags-icon-button-broken-active' : ''));
        children.push(createIconButton('plus', 'Add tag or set model', () => openTagEditor(bar, ad, tagging)));
        bar.replaceChildren(...children);
    }

    function createTagChip(tag, className, removeLabel, onRemove) {
        const chip = createElement('span', className, tag);
        chip.append(createIconButton('close', removeLabel, onRemove));
        return chip;
    }

    function openTagEditor(bar, ad, tagging) {
        bar.dataset.editing = 'true';
        const modelInput = createElement('input', 'olx-model-tags-input olx-model-tags-input-model');
        modelInput.placeholder = 'Model (optional)';
        modelInput.value = tagging.modelName;
        modelInput.setAttribute('aria-label', 'Model of this ad');
        modelInput.setAttribute('list', 'olx-model-tags-known-models');
        const tagInput = createElement('input', 'olx-model-tags-input');
        tagInput.placeholder = tagging.modelName ? `Tag for all ${tagging.modelName}` : 'Tag for this ad';
        tagInput.setAttribute('aria-label', tagInput.placeholder);
        tagInput.setAttribute('list', 'olx-model-tags-known-tags');
        modelInput.addEventListener('input', () => {
            tagInput.placeholder = modelInput.value.trim() ? `Tag for all ${modelInput.value.trim()}` : 'Tag for this ad';
            tagInput.setAttribute('aria-label', tagInput.placeholder);
        });
        const closeEditor = () => { delete bar.dataset.editing; renderTagBar(ad); bar.querySelector('[aria-label="Add tag or set model"]')?.focus(); };
        const saveEditor = () => {
            const modelName = modelInput.value.trim();
            const tag = tagInput.value.trim();
            if (modelName && !normalizeModelKey(modelName)) { modelInput.setCustomValidity('Model needs letters or digits'); modelInput.reportValidity(); return; }
            delete bar.dataset.editing;
            if (modelName !== tagging.modelName) recordOperation({ type: 'setAdModel', adId: ad.adId, modelName });
            if (tag) recordOperation(modelName ? { type: 'addTag', scope: 'model', modelName, tag } : { type: 'addTag', scope: 'ad', adId: ad.adId, tag });
            renderTagBar(ad);
            openTagEditor(bar, ad, resolveAdTagging(olxModelTagsData, ad.adId, ad.title));
        };
        for (const input of [modelInput, tagInput]) {
            input.addEventListener('keydown', (event) => {
                event.stopPropagation();
                if (event.key === 'Enter') { event.preventDefault(); saveEditor(); }
                if (event.key === 'Escape') { event.preventDefault(); closeEditor(); }
            });
            input.addEventListener('input', () => input.setCustomValidity(''));
        }
        // Existing tags stay visible; the editor replaces only the Broken and + buttons and stays open for the next tag until Esc/×.
        for (const actionButton of bar.querySelectorAll(':scope > .olx-model-tags-icon-button')) actionButton.remove();
        bar.append(tagInput, modelInput, createTextButton('Save', 'Save model and tag (Enter)', saveEditor), createIconButton('close', 'Close editor (Esc)', closeEditor));
        tagInput.focus();
    }

    let isFilterPanelExpanded = false;

    function setFilterPanelExpanded(isExpanded) {
        isFilterPanelExpanded = isExpanded;
        renderFilterPanel();
        document.querySelector(`.olx-model-tags-panel [aria-label^="${isExpanded ? 'Close tag filters' : 'Tag filters'}"]`)?.focus();
    }

    document.addEventListener('pointerdown', (event) => {
        if (isFilterPanelExpanded && !event.target.closest?.('.olx-model-tags-panel, .olx-model-tags-bar')) setFilterPanelExpanded(false);
    }, true);
    document.addEventListener('keydown', (event) => {
        if (isFilterPanelExpanded && event.key === 'Escape' && !event.target.closest?.('.olx-model-tags-bar')) setFilterPanelExpanded(false);
    });

    function renderFilterPanel() {
        if (!olxModelTagsData || !document.body) return;
        let panel = document.querySelector('.olx-model-tags-panel');
        if (!panel) {
            panel = createElement('div', 'olx-model-tags-root olx-model-tags-panel');
            panel.setAttribute('role', 'region');
            panel.setAttribute('aria-label', 'OLX Model Tags');
            document.body.append(panel);
        }
        const ads = findAdsOnPage().filter((ad) => ad.card);
        const activeFilters = GM_getValue(STORAGE_KEY_ACTIVE_FILTERS, []);
        const showBrokenAds = GM_getValue(STORAGE_KEY_SHOW_BROKEN_ADS, false);
        const filterValueCounts = new Map();
        let shownAdCount = 0;
        let brokenAdCount = 0;
        for (const ad of ads) {
            const tagging = resolveAdTagging(olxModelTagsData, ad.adId, ad.title);
            const filterValues = [...new Set([...tagging.modelTags, ...tagging.adTags, ...(tagging.modelName ? [tagging.modelName] : [])])];
            for (const value of filterValues) if (value !== BROKEN_TAG) filterValueCounts.set(value, (filterValueCounts.get(value) || 0) + 1);
            if (filterValues.includes(BROKEN_TAG)) brokenAdCount++;
            const isShown = doesAdMatchActiveFilters(filterValues, activeFilters, showBrokenAds);
            ad.card.classList.toggle('olx-model-tags-hidden-ad', !isShown);
            const displayEffects = resolveAdDisplayEffects(olxModelTagsData, filterValues);
            ad.card.classList.toggle('olx-model-tags-meshed-ad', displayEffects.isMeshed);
            ad.card.classList.toggle('olx-model-tags-highlighted-ad', displayEffects.isHighlighted);
            if (isShown) shownAdCount++;
        }

        // Collapsed by default to one small icon; the badge still shows active filters and sync errors.
        panel.classList.toggle('olx-model-tags-panel-collapsed', !isFilterPanelExpanded);
        const isSynchronizationError = synchronizationStatus.state === 'error';
        if (!isFilterPanelExpanded) {
            const openButton = createIconButton('tag', `Tag filters${activeFilters.length ? ` (${activeFilters.length} active)` : ''}${isSynchronizationError ? ` - sync error: ${synchronizationStatus.message}` : ''}`,
                () => setFilterPanelExpanded(true));
            openButton.setAttribute('aria-expanded', 'false');
            if (activeFilters.length || isSynchronizationError) {
                openButton.append(createElement('span', isSynchronizationError ? 'olx-model-tags-status-error' : 'olx-model-tags-count',
                    `${activeFilters.length || ''}${isSynchronizationError ? '⚠' : ''}`));
            }
            panel.replaceChildren(openButton);
            return;
        }
        const headerRow = createElement('div', 'olx-model-tags-panel-row');
        if (ads.length) headerRow.append(createElement('span', 'olx-model-tags-count', `${shownAdCount}/${ads.length} shown`));
        const statusText = createElement('span', isSynchronizationError ? 'olx-model-tags-status-error' : 'olx-model-tags-count',
            isSynchronizationError ? `⚠ ${synchronizationStatus.message}` : synchronizationStatus.message);
        statusText.setAttribute('role', 'status');
        headerRow.append(statusText);
        if (isSynchronizationError && /token/i.test(synchronizationStatus.message)) headerRow.append(createTextButton('Set GitHub token', 'Enter the GitHub token used to save tags', askForGithubToken));
        const closeButton = createIconButton('close', 'Close tag filters (Esc)', () => setFilterPanelExpanded(false));
        closeButton.setAttribute('aria-expanded', 'true');
        headerRow.append(createIconButton('sync', 'Sync tags with GitHub now', synchronizeWithGithub), closeButton);
        const children = [headerRow];

        if (ads.length) {
            const filters = createElement('div', 'olx-model-tags-panel-filters');
            const sortedValues = [...new Set([...activeFilters, ...filterValueCounts.keys()])].sort((a, b) => (filterValueCounts.get(b) || 0) - (filterValueCounts.get(a) || 0) || a.localeCompare(b));
            for (const value of sortedValues) {
                const isActive = activeFilters.includes(value);
                const button = createTextButton(`${isActive ? '✓ ' : ''}${value} `, isActive ? `Stop filtering by "${value}"` : `Show only ads tagged "${value}"`, () => {
                    GM_setValue(STORAGE_KEY_ACTIVE_FILTERS, isActive ? activeFilters.filter((filter) => filter !== value) : [...activeFilters, value]);
                    renderFilterPanel();
                }, isActive);
                button.append(createElement('span', 'olx-model-tags-count', String(filterValueCounts.get(value) || 0)));
                const tagGroup = createElement('div', 'olx-model-tags-tag-group');
                tagGroup.append(createTagDisplayModeSwitch(value), button);
                filters.append(tagGroup);
            }
            const footerRow = createElement('div', 'olx-model-tags-panel-row');
            footerRow.append(createTextButton(`${showBrokenAds ? '✓ ' : ''}Show broken (${brokenAdCount})`, showBrokenAds ? 'Hide ads marked broken' : 'Show ads marked broken',
                () => { GM_setValue(STORAGE_KEY_SHOW_BROKEN_ADS, !showBrokenAds); renderFilterPanel(); }, showBrokenAds));
            if (activeFilters.length) footerRow.append(createTextButton('Clear filters', 'Remove all tag filters', () => { GM_setValue(STORAGE_KEY_ACTIVE_FILTERS, []); renderFilterPanel(); }));
            if (sortedValues.length) children.push(filters);
            children.push(footerRow);
        }
        panel.replaceChildren(...children);
    }

    function createTagDisplayModeSwitch(tag) {
        const currentDisplayMode = olxModelTagsData.tagDisplayModes?.[tag] || 'nothing';
        const displayModeSwitch = createElement('div', 'olx-model-tags-mode-switch');
        displayModeSwitch.setAttribute('role', 'group');
        displayModeSwitch.setAttribute('aria-label', `What to do with ads tagged "${tag}"`);
        for (const [displayMode, label] of [['hide', 'Hide'], ['nothing', 'Do nothing'], ['highlight', 'Highlight']]) {
            const isActive = displayMode === currentDisplayMode;
            const button = createIconButton(displayMode, `${label}: ads tagged "${tag}"`,
                () => { if (!isActive) recordOperation({ type: 'setTagDisplayMode', tag, displayMode }); },
                isActive ? 'olx-model-tags-mode-switch-active' : '');
            button.setAttribute('aria-pressed', String(isActive));
            displayModeSwitch.append(button);
        }
        return displayModeSwitch;
    }

    function renderEverything() {
        if (!olxModelTagsData) return;
        ensureDatalists();
        for (const ad of findAdsOnPage()) renderTagBar(ad);
        renderFilterPanel();
    }

    // OLX is a React app: re-attach bars to cards it adds or re-renders. Only bar-less ads trigger work.
    let renderFrame = 0;
    new MutationObserver(() => {
        if (renderFrame) return;
        renderFrame = requestAnimationFrame(() => {
            renderFrame = 0;
            if (olxModelTagsData && findAdsOnPage().some((ad) => !ad.anchor.nextElementSibling?.classList.contains('olx-model-tags-bar'))) renderEverything();
        });
    }).observe(document.body, { childList: true, subtree: true });

    if (olxModelTagsData) {
        olxModelTagsData = rebuildLocalDataFromCacheAndPendingOperations(olxModelTagsData);
        const cachedAt = GM_getValue(STORAGE_KEY_CACHED_AT, 0);
        synchronizationStatus = { state: 'synced', message: cachedAt ? `Cached ${new Date(cachedAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}` : 'Cached' };
        renderEverything();
        if (GM_getValue(STORAGE_KEY_PENDING_OPERATIONS, []).length) synchronizeWithGithub();
    } else {
        olxModelTagsData = createEmptyOlxModelTagsData();
        synchronizeWithGithub();
    }
})();
