// ==UserScript==
// @name         OLX - Model Tags
// @namespace    https://www.olx.ua/
// @version      0.15.0
// @description  Tag OLX ads by model (tags shared by every ad of that model) or per ad, mark broken ads, filter search results by tags, per-tag Hide (pixel mesh) / Highlight (outline). Shared model catalog is read from GitHub without any key; your own marks stay in this browser. Phone specs (year, DXOMARK camera, AnTuTu, sensor, display, battery, charger, NFC) are captured from the DXOMARK, Kimovil and GSMArena pages you open. OLX only gets read locally from the open page.
// @match        https://www.olx.ua/*
// @match        https://www.dxomark.com/smartphones/*
// @match        https://www.kimovil.com/*
// @match        https://www.gsmarena.com/*
// @match        https://hocotech.com/product/*
// @match        https://hocotech.com/category/*
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/olx-model-tags/OLX_Model_Tags.user.js
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/olx-model-tags/OLX_Model_Tags.user.js
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// ==/UserScript==

(() => {
    'use strict';

    // ---------- Pure logic (unit-tested in olx-model-tags.test.cjs) ----------

    const BROKEN_TAG = 'broken';
    const DISLIKED_BRAND_TAG = 'disliked brand';
    // Used until the user edits the list for the first time; afterwards data.stopPhrases is the list.
    const DEFAULT_STOP_PHRASES = ['на запчастини', 'на запчасти', 'під ремонт', 'под ремонт', 'на ремонт', 'не працює', 'не работает', 'неробочий', 'нерабочий', 'не включається', 'не включается', 'розбитий', 'разбит', 'битий', 'полоси', 'полосы'];
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
            group: adEntry?.group || modelEntry?.group || '',
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
    // Derived tags, recomputed whenever a model's values change:
    // "Capacity: 75000mAh" + "Weight: 1400g" -> "mAh per g: 53.6"; + "Dimensions: 157×116×45mm" -> "mAh per liter: 91518".
    const DERIVED_TAG_PROPERTIES = ['mAh per g', 'mAh per liter'];

    function computeDerivedTags(tags) {
        const valueOf = (property) => tags.map(splitTagIntoPropertyAndValue).find((tag) => tag.property.toLowerCase() === property)?.value;
        const capacity = parseFloat(valueOf('capacity'));
        const weight = parseFloat(valueOf('weight'));
        const sidesInMillimetres = (valueOf('dimensions') || '').match(/(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)mm/)?.slice(1).map(Number);
        const derivedTags = [];
        if (capacity > 0 && weight > 0) derivedTags.push(`${DERIVED_TAG_PROPERTIES[0]}: ${(capacity / weight).toFixed(1)}`);
        if (capacity > 0 && sidesInMillimetres) derivedTags.push(`${DERIVED_TAG_PROPERTIES[1]}: ${Math.round(capacity / (sidesInMillimetres[0] * sidesInMillimetres[1] * sidesInMillimetres[2] / 1e6))}`);
        return derivedTags;
    }

    function updateDerivedTags(modelEntry) {
        const derivedTags = computeDerivedTags(modelEntry.tags);
        const derivedProperties = derivedTags.map((tag) => splitTagIntoPropertyAndValue(tag).property.toLowerCase());
        modelEntry.tags = [...modelEntry.tags.filter((tag) => !derivedProperties.includes(splitTagIntoPropertyAndValue(tag).property.toLowerCase())), ...derivedTags];
    }

    function applyOlxModelTagsOperation(data, operation) {
        if (operation.type === 'addRawSpecs') return; // goes to its own file at upload time, never into the local data
        if (['addPhrase', 'removePhrase', 'addStopPhrase', 'removeStopPhrase'].includes(operation.type)) {
            const listName = operation.listName || 'stopPhrases'; // 0.4.0 ops had no listName
            if (!PHRASE_LISTS[listName]) throw new Error(`Unknown OLX Model Tags phrase list: ${listName}`);
            const phrase = operation.phrase.trim().toLowerCase();
            const remainingPhrases = getPhraseList(data, listName).filter((existingPhrase) => existingPhrase !== phrase);
            data[listName] = operation.type.startsWith('add') && phrase ? [...remainingPhrases, phrase] : remainingPhrases;
            return;
        }
        if (operation.type === 'setGroup') {
            // The user's own grouping ("Monitors", "square-ish objects"); set on the model when the ad has one, else on the ad.
            const groupOwner = operation.scope === 'model' ? ensureModelEntry(data, operation.modelName) : (data.ads[operation.adId] ||= { model: '', tags: [] });
            groupOwner.group = operation.group.trim();
            return;
        }
        if (operation.type === 'updateDerivedTags') {
            updateDerivedTags(ensureModelEntry(data, operation.modelName));
            return;
        }
        if (operation.type === 'setModelProperty') {
            // One value per property on a model: "Year: 2023" replaces an earlier "Year: 2022". Used by the spec-site capture.
            const modelEntry = ensureModelEntry(data, operation.modelName);
            const propertyKey = operation.property.toLowerCase();
            modelEntry.tags = modelEntry.tags.filter((tag) => splitTagIntoPropertyAndValue(tag).property.toLowerCase() !== propertyKey);
            modelEntry.tags.push(`${operation.property}: ${operation.value}`);
            if (operation.groupIfEmpty && !modelEntry.group) modelEntry.group = operation.groupIfEmpty;
            updateDerivedTags(modelEntry);
            return;
        }
        if (operation.type === 'setAdInfo') {
            // Ad URL, title and title-detected model, kept for the Google Sheet view (the script itself reads them from the page).
            Object.assign((data.ads[operation.adId] ||= { model: '', tags: [] }), { url: operation.url, title: operation.title, detectedModel: operation.detectedModel, category: operation.category || '' });
            return;
        }
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

    // "Squishiness: very squishy" → property + value; a tag without "Name: " has no property. Same rule as the Google Sheet.
    function splitTagIntoPropertyAndValue(tag) {
        const namedTag = tag.match(/^([^\d:][^:]{0,30}):\s+(.+)$/);
        return namedTag ? { property: namedTag[1].trim(), value: namedTag[2].trim() } : { property: '', value: tag.trim() };
    }

    function encodeUtf8TextAsBase64(text) {
        let binary = '';
        for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
        return btoa(binary);
    }

    function decodeBase64AsUtf8Text(base64) {
        return new TextDecoder().decode(Uint8Array.from(atob(base64.replace(/\s/g, '')), (character) => character.charCodeAt(0)));
    }

    // Defaults apply until the user edits a list for the first time; afterwards data[listName] is the list.
    const PHRASE_LISTS = {
        stopPhrases: { defaults: DEFAULT_STOP_PHRASES, matchesWholeWordOnly: false },
        dislikedBrands: { defaults: [], matchesWholeWordOnly: true },
    };

    function getPhraseList(data, listName) {
        return data[listName] ?? PHRASE_LISTS[listName].defaults;
    }

    // Stop phrases: plain case-insensitive substring (shortcut: "полоси" can hit an unrelated word; edit the list if it misfires).
    // Brands: whole word, so "lg" does not hit "LGA", while "hp" still hits "HP2035".
    function findPhraseInText(data, listName, text) {
        const lowercaseText = text.toLowerCase();
        return getPhraseList(data, listName).find((phrase) => (PHRASE_LISTS[listName].matchesWholeWordOnly
            ? new RegExp(`(^|\\P{L})${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|\\P{L})`, 'u').test(lowercaseText)
            : lowercaseText.includes(phrase))) || '';
    }

    function doesAdMatchActiveFilters(filterValues, activeFilters, showBrokenAds, showDislikedBrandAds = false) {
        if (!showBrokenAds && filterValues.includes(BROKEN_TAG)) return false;
        if (!showDislikedBrandAds && filterValues.includes(DISLIKED_BRAND_TAG)) return false;
        return activeFilters.every((filter) => filterValues.includes(filter));
    }

    // ---- Phone spec capture: text -> value helpers (DOM readers are below, after the sync code) ----
    function extractYearFromText(text) {
        return text.match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
    }

    // "IPS LCD, 90Hz" -> IPS, "Super AMOLED" -> OLED, anything else -> its first word (TFT, LCD, ...).
    function classifyDisplayType(text) {
        const upperText = text.toUpperCase();
        if (upperText.includes('OLED')) return 'OLED';
        if (upperText.includes('IPS')) return 'IPS';
        return text.trim().split(/[,\s]/)[0];
    }

    function extractBatteryCapacity(text) {
        const capacity = text.match(/(\d[\d,]*)\s*mAh/i);
        return capacity ? `${capacity[1].replace(/,/g, '')}mAh` : '';
    }

    // GSMArena lists one charging line per market ("35W ... (Europe)" / "22.5W ... (Global)"); the Global one wins, else the first.
    function extractChargerPower(chargingLines) {
        const chargingLine = chargingLines.find((line) => /global/i.test(line)) || chargingLines[0] || '';
        const power = chargingLine.match(/(\d+(?:\.\d+)?)\s*W/);
        return power ? `${power[1]}W` : '';
    }

    function extractNfcSupport(text) {
        return /^\s*yes/i.test(text) ? 'Yes' : 'No';
    }

    // Kimovil: "AnTuTu of Honor 90 Lite is 391.900 (v10)." -> { property: 'AnTuTu v10', value: '391900' }
    function parseAnTuTuAnswer(text) {
        const answer = text.match(/([\d.,]+)\s*\(v(\d+)\)/);
        return answer ? { property: `AnTuTu v${answer[2]}`, value: answer[1].replace(/[.,]/g, '') } : null;
    }

    // Spec-site adapters (olx-model-tags-sources.json) can only pick one of these value converters; no code comes from the file.
    const SOURCE_VALUE_TRANSFORMS = {
        text: (text) => text,
        year: (text) => extractYearFromText(text),
        digits: (text) => text.replace(/\D/g, ''),
        displayType: (text) => classifyDisplayType(text),
        batteryMah: (text) => extractBatteryCapacity(text),
        yesNo: (text) => extractNfcSupport(text),
        unknownIfEmpty: (text) => (!text || /^(unknown|-+)$/i.test(text) ? 'Unknown' : text),
        chargerPower: (text, element) => extractChargerPower(element.innerHTML.split(/<hr[^>]*>/).map((html) => html.replace(/<[^>]+>/g, ' '))),
        dimensionsMm: (text) => { const sides = text.replace(/\s+/g, '').replace(/[x*]/gi, '×'); return /^[\d.]+×[\d.]+×[\d.]+mm$/.test(sides) ? sides : ''; },
        maxWatts: (text) => { const watts = [...text.matchAll(/(\d+(?:\.\d+)?)\s*W\b/g)].map((match) => Number(match[1])); return watts.length ? `${Math.max(...watts)}W` : ''; },
        antutu: (text) => parseAnTuTuAnswer(text),
    };

    function findSourcePage(sources, hostname, pathname, pageDocument) {
        for (const source of sources) {
            if (!source.hosts.includes(hostname)) continue;
            const page = source.pages.find((candidate) => (!candidate.path || new RegExp(candidate.path).test(pathname)) && (!candidate.whenSelector || pageDocument?.querySelector(candidate.whenSelector)));
            if (page) return { source, page };
        }
        return null;
    }

    function findSourceCategory(sources, hostname, pathname, pageDocument) {
        for (const source of sources) {
            const category = source.category;
            if (category && source.hosts.includes(hostname) && new RegExp(category.path).test(pathname) && pageDocument?.querySelector(category.products)) return { source, category };
        }
        return null;
    }

    function isModelPropertyAlreadySet(data, modelName, property, value) {
        return data.models[normalizeModelKey(modelName)]?.tags.includes(`${property}: ${value}`) ?? false;
    }

    // Catalog = models, stop phrases, brands: public, shared by everyone, written only by the owner (token).
    // Personal = ads and per-tag display modes: kept in each browser (the owner's also sync to a second GitHub file).
    function splitDataIntoCatalogAndPersonal(data) {
        const { ads, tagDisplayModes, ...catalog } = data;
        return { catalog, personal: { ads, tagDisplayModes } };
    }

    function joinCatalogAndPersonal(catalog, personal) {
        return { ...createEmptyOlxModelTagsData(), ...catalog, ads: personal.ads ?? {}, tagDisplayModes: personal.tagDisplayModes ?? {} };
    }

    function resolveAdDisplayEffects(data, filterValues) {
        const displayModes = filterValues.map((value) => data.tagDisplayModes?.[value]);
        return { isMeshed: displayModes.includes('hide'), isHighlighted: displayModes.includes('highlight') };
    }

    if (typeof module === 'object') {
        module.exports = { normalizeModelKey, createEmptyOlxModelTagsData, detectModelKeyInTitle, resolveAdTagging, applyOlxModelTagsOperation, encodeUtf8TextAsBase64, decodeBase64AsUtf8Text, doesAdMatchActiveFilters, resolveAdDisplayEffects, getPhraseList, findPhraseInText, splitTagIntoPropertyAndValue, splitDataIntoCatalogAndPersonal, joinCatalogAndPersonal, extractYearFromText, classifyDisplayType, extractBatteryCapacity, extractChargerPower, extractNfcSupport, parseAnTuTuAnswer, isModelPropertyAlreadySet, findSourcePage, findSourceCategory, computeDerivedTags, SOURCE_VALUE_TRANSFORMS };
        return;
    }

    // Two installed copies have separate Tampermonkey storage and overwrite each other's tag bars (one may hold no tags).
    // The DOM is shared between copies, so the second one stops and makes the first one show an error.
    const DUPLICATE_INSTALL_EVENT = 'olx-model-tags-duplicate-install';
    if (document.documentElement.dataset.olxModelTagsRunning) {
        document.dispatchEvent(new CustomEvent(DUPLICATE_INSTALL_EVENT));
        console.error('OLX - Model Tags is installed twice in Tampermonkey; delete one copy.');
        return;
    }
    document.documentElement.dataset.olxModelTagsRunning = 'true';

    // ---------- Storage and GitHub sync ----------
    // Nothing here talks to OLX: ads are read from the already-open page DOM. Only GitHub is contacted.
    // Everyone reads the public catalog file without a key; edits stay in this browser as pending operations replayed
    // over every fresh catalog. Only with the owner's token are the operations uploaded (catalog file + personal file).

    const IS_OLX_PAGE = location.hostname.endsWith('olx.ua');
    const GITHUB_DATA_REPOSITORY = 'karpuzikov/userscripts';
    const GITHUB_DATA_BRANCH = 'main';
    const GITHUB_CATALOG_FILE_PATH = 'browser-tools/olx-model-tags/olx-model-tags-catalog.json';
    const GITHUB_SOURCES_FILE_PATH = 'browser-tools/olx-model-tags/olx-model-tags-sources.json';
    const STORAGE_KEY_CACHED_SOURCES = 'olxModelTagsCachedSources';
    const GITHUB_RAW_SPECS_FILE_PATH = 'browser-tools/olx-model-tags/olx-model-tags-rawspecs.json';
    const GITHUB_PERSONAL_FILE_PATH = 'browser-tools/olx-model-tags/olx-model-tags-data.json';
    const githubApiFileUrl = (filePath) => `https://api.github.com/repos/${GITHUB_DATA_REPOSITORY}/contents/${filePath}`;
    const githubRawFileUrl = (filePath) => `https://raw.githubusercontent.com/${GITHUB_DATA_REPOSITORY}/${GITHUB_DATA_BRANCH}/${filePath}`;
    const STORAGE_KEY_CACHED_DATA = 'olxModelTagsCachedData';
    const STORAGE_KEY_CACHED_AT = 'olxModelTagsCachedAt';
    const STORAGE_KEY_PENDING_OPERATIONS = 'olxModelTagsPendingOperations';
    const STORAGE_KEY_GITHUB_TOKEN = 'olxModelTagsGithubToken';
    const STORAGE_KEY_ACTIVE_FILTERS = 'olxModelTagsActiveFilters';
    const STORAGE_KEY_SHOW_BROKEN_ADS = 'olxModelTagsShowBrokenAds';
    const STORAGE_KEY_SHOW_DISLIKED_BRAND_ADS = 'olxModelTagsShowDislikedBrandAds';
    const STORAGE_KEY_AUTO_BROKEN_AD_IDS = 'olxModelTagsAutoBrokenAdIds';
    const UPLOAD_DEBOUNCE_MS = 2000;
    const UPLOAD_CONFLICT_RETRIES = 8;
    const PENDING_OPERATION_KEY_PREFIX = 'olxModelTagsPendingOperation:';
    const CATALOG_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

    let olxModelTagsData = GM_getValue(STORAGE_KEY_CACHED_DATA, null);
    let synchronizationStatus = { state: 'idle', message: '' };
    let synchronizationInProgress = false;
    let synchronizationRequestedAgain = false;
    let uploadDebounceTimer = 0;

    const hasGithubToken = () => Boolean(GM_getValue(STORAGE_KEY_GITHUB_TOKEN, ''));

    // Every pending operation is its own stored value, so tabs opened at the same time cannot overwrite each other's
    // (one shared list lost operations when many tabs saved at once). Keys sort in the order the operations were made.
    let pendingOperationCounter = 0;
    const ownPendingOperationKeys = new Set(); // this tab's operations: the badge is green only once these are uploaded

    function storePendingOperation(operation) {
        pendingOperationCounter++;
        const key = `${PENDING_OPERATION_KEY_PREFIX}${String(Date.now()).padStart(15, '0')}-${String(pendingOperationCounter).padStart(6, '0')}-${Math.random().toString(36).slice(2, 8)}`;
        ownPendingOperationKeys.add(key);
        GM_setValue(key, operation);
    }

    function listPendingOperationKeys() {
        const oldSharedList = GM_getValue(STORAGE_KEY_PENDING_OPERATIONS, []);
        if (oldSharedList.length) { oldSharedList.forEach(storePendingOperation); GM_setValue(STORAGE_KEY_PENDING_OPERATIONS, []); }
        return GM_listValues().filter((key) => key.startsWith(PENDING_OPERATION_KEY_PREFIX)).sort();
    }

    function rebuildLocalDataFromCacheAndPendingOperations(baseData) {
        const data = structuredClone(baseData);
        for (const key of listPendingOperationKeys()) applyOlxModelTagsOperation(data, GM_getValue(key));
        return data;
    }

    function recordOperationForAd(ad, operation) {
        recordAdInfoIfChanged(ad);
        recordOperation(operation);
    }

    // Every ad the user touched gets its URL/title saved, so the Google Sheet can list it.
    function recordAdInfoIfChanged(ad) {
        const adEntry = olxModelTagsData.ads[ad.adId];
        const detectedModel = olxModelTagsData.models[detectModelKeyInTitle(olxModelTagsData, ad.title)]?.name || '';
        const title = ad.title.trim();
        // A search without a category gives no category; keep the one saved earlier instead of erasing it.
        const category = ad.category || adEntry?.category || '';
        if (!ad.url || (adEntry?.url === ad.url && adEntry.title === title && adEntry.detectedModel === detectedModel && adEntry.category === category)) return;
        recordOperation({ type: 'setAdInfo', adId: ad.adId, url: ad.url, title, detectedModel, category });
    }

    // shortcut: without a token the pending list only grows (idempotent ops, a few KB per hundred ads); compact it if storage ever bites.
    function recordOperation(operation) {
        storePendingOperation(operation);
        applyOlxModelTagsOperation(olxModelTagsData, operation);
        renderEverything();
        if (!hasGithubToken()) return;
        clearTimeout(uploadDebounceTimer);
        uploadDebounceTimer = setTimeout(synchronizeWithGithub, UPLOAD_DEBOUNCE_MS);
    }

    function requestGithub(method, url, body) {
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

    // No token: the public raw file (no API rate limit; GitHub's CDN may serve a copy up to ~5 min old).
    // Token: the contents API, which also gives the sha needed to upload.
    async function downloadJsonFileFromGithub(filePath, fileMayBeMissing = false) {
        const response = hasGithubToken()
            ? await requestGithub('GET', `${githubApiFileUrl(filePath)}?ref=${GITHUB_DATA_BRANCH}&t=${Date.now()}`)
            : await requestGithub('GET', githubRawFileUrl(filePath));
        // A missing file is only normal for the owner before the first sync; afterwards it must not silently wipe the local data.
        if (response.status === 404 && hasGithubToken() && (fileMayBeMissing || !GM_getValue(STORAGE_KEY_CACHED_AT, 0))) return { data: {}, sha: null };
        if (response.status !== 200) throw new Error(`GitHub download failed for ${filePath} (HTTP ${response.status}${response.json?.message ? `: ${response.json.message}` : ''})`);
        if (!hasGithubToken()) {
            if (!response.json) throw new Error(`${filePath} is not valid JSON`);
            return { data: response.json, sha: null };
        }
        // shortcut: the contents API inlines files up to 1 MB; switch to the blob API if a data file ever grows past that.
        if (!response.json.content) throw new Error(`${filePath} is over 1 MB; the script needs the blob API`);
        return { data: JSON.parse(decodeBase64AsUtf8Text(response.json.content)), sha: response.json.sha };
    }

    async function uploadJsonFileToGithub(filePath, data, sha) {
        const response = await requestGithub('PUT', githubApiFileUrl(filePath), {
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
            const canUpload = hasGithubToken();
            const pendingKeys = listPendingOperationKeys();
            const pendingOperations = pendingKeys.map((key) => GM_getValue(key));
            let remoteData;
            for (let attempt = 1; ; attempt++) {
                const catalogFile = await downloadJsonFileFromGithub(GITHUB_CATALOG_FILE_PATH);
                const personalFile = canUpload ? await downloadJsonFileFromGithub(GITHUB_PERSONAL_FILE_PATH) : { data: {}, sha: null };
                remoteData = joinCatalogAndPersonal(catalogFile.data, personalFile.data);
                if (!canUpload || !pendingOperations.length) break;
                // Raw page specs (scan) live in their own file: { pageUrl: { model, scannedAt, specs } }.
                const rawSpecOperations = pendingOperations.filter((operation) => operation.type === 'addRawSpecs');
                const rawFile = rawSpecOperations.length ? await downloadJsonFileFromGithub(GITHUB_RAW_SPECS_FILE_PATH, true) : null;
                const rawSpecs = rawFile ? { ...rawFile.data } : null;
                for (const { url, model, scannedAt, specs } of rawSpecOperations) rawSpecs[url] = { model, scannedAt, specs };
                const updatedData = structuredClone(remoteData);
                for (const operation of pendingOperations) applyOlxModelTagsOperation(updatedData, operation);
                const { catalog, personal } = splitDataIntoCatalogAndPersonal(updatedData);
                let hasConflict = false;
                for (const [filePath, file, content] of [[GITHUB_CATALOG_FILE_PATH, catalogFile, catalog], [GITHUB_PERSONAL_FILE_PATH, personalFile, personal], ...(rawFile ? [[GITHUB_RAW_SPECS_FILE_PATH, rawFile, rawSpecs]] : [])]) {
                    if (JSON.stringify(content) === JSON.stringify(file.data)) continue;
                    if (await uploadJsonFileToGithub(filePath, content, file.sha) === 'conflict') { hasConflict = true; break; }
                }
                if (!hasConflict) { remoteData = updatedData; break; }
                if (attempt >= UPLOAD_CONFLICT_RETRIES) throw Object.assign(new Error('GitHub data file kept changing during upload; retrying later'), { retryLater: true });
                await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 1500)); // other tabs upload too; random waits stop them colliding again
            }
            // Operations added while uploading stay pending and are applied on top of the fresh data.
            if (canUpload) pendingKeys.forEach((key) => GM_deleteValue(key));
            GM_setValue(STORAGE_KEY_CACHED_DATA, remoteData);
            GM_setValue(STORAGE_KEY_CACHED_AT, Date.now());
            olxModelTagsData = rebuildLocalDataFromCacheAndPendingOperations(remoteData);
            setSynchronizationStatus('synced', canUpload ? 'Synced' : 'Catalog synced; your edits stay in this browser');
        } catch (error) {
            setSynchronizationStatus('error', error.message);
            if (error.retryLater) setTimeout(synchronizeWithGithub, 20000 + Math.random() * 20000);
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

    // Owner only: strangers never need this, so it lives in the Tampermonkey menu instead of the panel.
    function askForGithubToken() {
        const token = prompt(`GitHub fine-grained token with Contents read/write on ${GITHUB_DATA_REPOSITORY}:`, GM_getValue(STORAGE_KEY_GITHUB_TOKEN, ''));
        if (token === null) return;
        GM_setValue(STORAGE_KEY_GITHUB_TOKEN, token.trim());
        synchronizeWithGithub();
    }
    GM_registerMenuCommand('Set GitHub token (owner only)', askForGithubToken);

    // ---------- Spec capture (adapters from olx-model-tags-sources.json) ----------
    // Reads only the page that is already open, following the selectors of the site's adapter, and saves the values as tags
    // of the model named on the page (e.g. "Honor 90 Lite"); OLX ads whose title contains it then show them.

    const readTextOf = (element) => (element?.textContent || '').replace(/\s+/g, ' ').trim();

    // Finds the element a property (or the model) is read from; { element, text } with element null when the page lacks it.
    function readAdapterValue(valueSpec, root, columnIndexByName, page) {
        let element = null;
        if (valueSpec.column) {
            element = [...root.querySelectorAll(page.columns.cells)].map((cell) => cell.querySelector(page.columns.cellValue))[columnIndexByName[valueSpec.column]];
        } else if (valueSpec.afterLabel) {
            const labelPattern = new RegExp(valueSpec.afterLabel, 'i');
            element = [...root.querySelectorAll(valueSpec.labels || 'dt, th, td, li, span')].find((label) => labelPattern.test(readTextOf(label)))?.nextElementSibling;
        } else if (valueSpec.selector) {
            element = root.querySelector(valueSpec.selector);
        }
        let text = valueSpec.fromTitle ? (document.title.match(new RegExp(valueSpec.fromTitle))?.[1] || '') : readTextOf(element);
        if (valueSpec.attribute && element) text = (element.getAttribute(valueSpec.attribute) || '').trim();
        if (valueSpec.regex) text = text.match(new RegExp(valueSpec.regex))?.[1] || '';
        if (text && valueSpec.prefix) text = valueSpec.prefix + text;
        if (valueSpec.ignoreRegex && new RegExp(valueSpec.ignoreRegex).test(text)) text = '';
        return { element: element || (valueSpec.fromTitle ? document.body : null), text };
    }

    // Every label/value pair of the product's spec section, as shown (unified later by unify-rawspecs.cjs).
    // `rows` layout: one element per spec with label and value elements; `text` layout: numbered lines "3. Output: ..." in one block.
    function readRawSpecsOfPage(rawSpecsSpec) {
        const specs = {};
        if (rawSpecsSpec.rows) {
            for (const row of document.querySelectorAll(rawSpecsSpec.rows)) {
                const label = readTextOf(row.querySelector(rawSpecsSpec.label)).replace(/:$/, '');
                if (label) specs[label] = readTextOf(row.querySelector(rawSpecsSpec.value));
            }
        } else if (rawSpecsSpec.text) {
            const text = readTextOf(document.querySelector(rawSpecsSpec.text));
            for (const [, label, value] of text.matchAll(new RegExp(rawSpecsSpec.itemRegex, 'g'))) specs[label.trim()] = value.trim();
        }
        return specs;
    }

    function readCapturesOfSourcePage(page) {
        const headerClassNames = page.columns ? [...document.querySelectorAll(page.columns.headers)].map((header) => header.className) : [];
        const columnIndexByName = {};
        for (const property of page.properties) {
            if (property.column) columnIndexByName[property.column] = headerClassNames.findIndex((className) => className.includes(property.column));
        }
        return (page.rows ? [...document.querySelectorAll(page.rows)] : [document]).map((root) => {
            const modelName = readAdapterValue(page.model, root, columnIndexByName, page).text;
            const properties = [];
            for (const propertySpec of page.properties) {
                const { element, text } = readAdapterValue(propertySpec, root, columnIndexByName, page);
                const propertyName = propertySpec.name || propertySpec.transform;
                if (!element) { properties.push([propertyName, '']); continue; }
                const transform = SOURCE_VALUE_TRANSFORMS[propertySpec.transform || 'text'];
                if (!transform) throw new Error(`Unknown transform "${propertySpec.transform}" in olx-model-tags-sources.json`);
                const converted = transform(text, element);
                if (converted && typeof converted === 'object') properties.push([converted.property, converted.value]);
                else properties.push([propertyName, converted || '']);
            }
            return { modelName, properties };
        });
    }

    // A small corner icon on every source website: green check = this page was read, red cross = it was not (so a page that
    // should have been sourced and was not is easy to spot). Shadow DOM keeps the site's CSS away from it.
    const SOURCE_BADGE_ICONS = {
        sourced: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#0ECB81" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
        partial: '<path d="M12 6v7.5" fill="none" stroke="#F0B90B" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="18" r="1.6" fill="#F0B90B"/>',
        notSourced: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="#F6465D" stroke-width="2.6" stroke-linecap="round"/>',
    };

    function showSourceBadge(state, message) {
        let badge = document.querySelector('olx-model-tags-source-badge');
        if (!badge) {
            badge = document.createElement('olx-model-tags-source-badge');
            badge.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
            badge.attachShadow({ mode: 'open' }).innerHTML = '<style>div{box-sizing:border-box;width:32px;height:32px;padding:6px;border-radius:8px;background:#1E2329;box-shadow:0 2px 8px rgba(0,0,0,.5);cursor:help}svg{display:block;width:20px;height:20px}</style><div role="img"><svg viewBox="0 0 24 24"></svg></div>';
            document.body.append(badge);
        }
        const badgeBox = badge.shadowRoot.querySelector('div');
        badgeBox.setAttribute('aria-label', message);
        badgeBox.title = message;
        badge.shadowRoot.querySelector('svg').innerHTML = SOURCE_BADGE_ICONS[state];
    }

    // What the page read gave (set by the capture) combined with whether it really reached GitHub (checked every few seconds):
    // green only when every value this tab recorded is uploaded, so a green check can no longer mean "read but lost".
    let lastSourceCapture = null;
    let rawSpecsRecorded = false;

    function setSourceCapture(state, message) {
        lastSourceCapture = { state, message };
        renderSourceBadge();
    }

    function renderSourceBadge() {
        if (!lastSourceCapture) return;
        const { state, message } = lastSourceCapture;
        const scriptVersion = typeof GM_info === 'object' ? ` [script v${GM_info.script.version}]` : '';
        if (state !== 'sourced') { showSourceBadge(state, message + scriptVersion); return; }
        const livePendingKeys = new Set(GM_listValues());
        const unsavedCount = [...ownPendingOperationKeys].filter((key) => livePendingKeys.has(key)).length;
        if (!hasGithubToken()) showSourceBadge('partial', `${message}. NOT saved to GitHub: no GitHub token is set in this browser, so it stays here${scriptVersion}`);
        else if (synchronizationStatus.state === 'error') showSourceBadge('notSourced', `${message}. Upload FAILED: ${synchronizationStatus.message}; ${unsavedCount} value(s) wait in this browser${scriptVersion}`);
        else if (unsavedCount) showSourceBadge('partial', `${message}. Uploading to GitHub: ${unsavedCount} value(s) not yet saved${scriptVersion}`);
        else showSourceBadge('sourced', `${message}. Saved to GitHub${scriptVersion}`);
    }

    function captureSpecsOfOpenPage() {
        if (!olxModelTagsSources.length) { setSourceCapture('notSourced', 'Not sourced: the source list could not be loaded from GitHub'); return false; }
        const match = findSourcePage(olxModelTagsSources, location.hostname, location.pathname, document);
        if (!match) { setSourceCapture('notSourced', 'Not sourced: no adapter in olx-model-tags-sources.json matches this page'); return false; }
        let captures;
        try {
            captures = readCapturesOfSourcePage(match.page);
        } catch (error) {
            setSourceCapture('notSourced', `Not sourced: ${error.message}`);
            throw error;
        }
        if (match.page.rawSpecs && !rawSpecsRecorded && captures[0]?.modelName) {
            const specs = readRawSpecsOfPage(match.page.rawSpecs);
            if (Object.keys(specs).length) {
                rawSpecsRecorded = true;
                recordOperation({ type: 'addRawSpecs', url: scanKeyOf(location.href), model: captures[0].modelName, scannedAt: new Date().toISOString(), specs });
            }
        }
        let readModelCount = 0, readValueCount = 0;
        const modelCountMissingProperty = {};
        for (const { modelName, properties } of captures) {
            const readProperties = properties.filter(([, value]) => value);
            if (!normalizeModelKey(modelName) || !readProperties.length) continue;
            readModelCount++;
            for (const [property, value] of properties) if (!value) modelCountMissingProperty[property] = (modelCountMissingProperty[property] || 0) + 1;
            for (const [property, value] of readProperties) {
                readValueCount++;
                if (isModelPropertyAlreadySet(olxModelTagsData, modelName, property, value)) continue;
                recordOperation({ type: 'setModelProperty', modelName, property, value, groupIfEmpty: match.source.group });
            }
            const modelEntry = olxModelTagsData.models[normalizeModelKey(modelName)];
            if (modelEntry && !computeDerivedTags(modelEntry.tags).every((tag) => modelEntry.tags.includes(tag))) recordOperation({ type: 'updateDerivedTags', modelName });
        }
        const missingProperties = Object.entries(modelCountMissingProperty).map(([property, count]) => (readModelCount > 1 ? `${property} (${count} of ${readModelCount} models)` : property));
        if (!readValueCount) {
            setSourceCapture('notSourced', `Not sourced: the ${match.source.name} adapter matches this page but found no values (the site layout may have changed)`);
            return false;
        }
        const summary = `${readModelCount} model(s), ${readValueCount} value(s)`;
        if (missingProperties.length) {
            setSourceCapture('partial', `Partly sourced (${match.source.name}): ${summary}. Not found: ${missingProperties.join(', ')}`);
            return false;
        }
        setSourceCapture('sourced', `Sourced (${match.source.name}): ${summary}`);
        return true;
    }

    // Adapters come from the public repo (no key), cached an hour like the catalog; an unreachable file keeps the cached copy.
    async function loadSourceAdapters(ignoreCache = false) {
        const cached = GM_getValue(STORAGE_KEY_CACHED_SOURCES, null);
        // A cached list without this site (a source added since) is refetched at once instead of waiting out the hour.
        if (!ignoreCache && cached && Date.now() - cached.at < CATALOG_REFRESH_INTERVAL_MS && cached.sources.some((source) => source.hosts.includes(location.hostname))) return cached.sources;
        try {
            const response = await requestGithub('GET', githubRawFileUrl(GITHUB_SOURCES_FILE_PATH));
            if (response.status !== 200 || !response.json?.sources) throw new Error(`HTTP ${response.status}`);
            GM_setValue(STORAGE_KEY_CACHED_SOURCES, { at: Date.now(), sources: response.json.sources });
            return response.json.sources;
        } catch (error) {
            console.error(`OLX Model Tags: could not download ${GITHUB_SOURCES_FILE_PATH} (${error.message})`);
            return cached?.sources || [];
        }
    }

    let olxModelTagsSources = [];

    // DXOMARK builds its ranking rows after the page loads, so the capture reruns (it skips what is already saved).
    async function startSpecsCapture() {
        olxModelTagsData = olxModelTagsData ? rebuildLocalDataFromCacheAndPendingOperations(olxModelTagsData) : createEmptyOlxModelTagsData();
        olxModelTagsSources = await loadSourceAdapters();
        if (hasGithubToken() && listPendingOperationKeys().length) synchronizeWithGithub(); // leftovers of earlier tabs
        const categoryMatch = findSourceCategory(olxModelTagsSources, location.hostname, location.pathname, document);
        if (categoryMatch) { startCategoryScanPanel(categoryMatch); return; }
        startScanTabReporting();
        setInterval(renderSourceBadge, 3000);
        // A page the cached adapters could not read may be covered by adapters added since: refetch once and retry.
        if (!captureSpecsOfOpenPage()) {
            olxModelTagsSources = await loadSourceAdapters(true);
            captureSpecsOfOpenPage();
        }
        let captureTimer = 0;
        new MutationObserver(() => { clearTimeout(captureTimer); captureTimer = setTimeout(captureSpecsOfOpenPage, 1000); })
            .observe(document.body, { childList: true, subtree: true });
    }

    // ---------- Category scan (owner): opens every product of a category page in background tabs, one after another ----------
    // The category tab keeps the job in Tampermonkey storage and runs it; each product tab reads its page like normal, and once its
    // values are uploaded it writes a result and closes itself. Tabs that report nothing within SCAN_TAB_TIMEOUT_MS count as failed.

    const STORAGE_KEY_SCAN_JOB = 'olxModelTagsScanJob';
    const SCAN_RESULT_KEY_PREFIX = 'olxModelTagsScanResult:';
    const SCAN_TAB_TIMEOUT_MS = 90 * 1000;
    const SCAN_JOB_STALE_MS = 5 * 60 * 1000;
    const scanKeyOf = (url) => { const parsed = new URL(url, location.href); return parsed.origin + parsed.pathname.replace(/\/+$/, ''); };

    // Product tab: report once everything this tab read is saved (or has failed), then close.
    function startScanTabReporting() {
        const job = GM_getValue(STORAGE_KEY_SCAN_JOB, null);
        const pageKey = scanKeyOf(location.href);
        if (!job?.active || !(pageKey in job.inFlight)) return;
        const timer = setInterval(() => {
            if (!lastSourceCapture) return;
            const unsavedCount = [...ownPendingOperationKeys].filter((key) => GM_listValues().includes(key)).length;
            let result = null;
            if (lastSourceCapture.state === 'notSourced') result = { status: 'failed', message: lastSourceCapture.message };
            else if (!hasGithubToken()) result = { status: 'failed', message: 'no GitHub token in this browser' };
            else if (synchronizationStatus.state === 'error') result = { status: 'failed', message: `upload failed: ${synchronizationStatus.message}` };
            else if (!unsavedCount && !synchronizationInProgress) result = { status: lastSourceCapture.state === 'partial' ? 'partial' : 'saved', message: lastSourceCapture.message };
            if (!result) return;
            clearInterval(timer);
            GM_setValue(SCAN_RESULT_KEY_PREFIX + pageKey, result);
            window.close();
        }, 1000);
    }

    function startCategoryScanPanel({ category }) {
        const openTabs = {};
        const host = document.createElement('olx-model-tags-scan-panel');
        host.style.cssText = 'position:fixed;right:16px;bottom:64px;z-index:2147483647';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `<style>
            .panel{box-sizing:border-box;width:280px;padding:12px;border-radius:8px;background:#1E2329;color:#EAECEF;font:13px/1.4 Inter,system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.6);display:grid;gap:8px}
            .row{display:flex;gap:8px;align-items:center}
            button{box-sizing:border-box;padding:8px 12px;border-radius:6px;border:1px solid #474D57;background:#2B3139;color:#EAECEF;font:inherit;cursor:pointer}
            button.primary{background:#C6F432;color:#181A20;border-color:#C6F432;font-weight:600}
            button:disabled{opacity:.5;cursor:not-allowed}
            input{box-sizing:border-box;width:56px;padding:8px 12px;border-radius:6px;border:1px solid #474D57;background:#0B0E11;color:#EAECEF;font:12px 'JetBrains Mono',monospace}
            .status{color:#848E9C;font-family:'JetBrains Mono',monospace;font-size:12px;white-space:pre-wrap}
        </style><div class="panel">
            <div class="row"><button class="primary" id="start">Scan specs</button><button id="stop" hidden>Stop</button></div>
            <label class="row">Tabs at once <input id="concurrency" type="number" min="1" max="10" value="3"></label>
            <div class="status" id="status"></div></div>`;
        document.body.append(host);
        const element = (id) => shadow.getElementById(id);
        const readJob = () => { const job = GM_getValue(STORAGE_KEY_SCAN_JOB, null); return job && job.active && Date.now() - job.updatedAt > SCAN_JOB_STALE_MS ? { ...job, active: false } : job; };
        const saveJob = (job) => GM_setValue(STORAGE_KEY_SCAN_JOB, { ...job, updatedAt: Date.now() });
        const pageCount = Math.max(1, ...[...document.querySelectorAll(category.pageLinks || 'a.page-numbers')].map((link) => parseInt(link.textContent, 10) || 0));

        element('start').addEventListener('click', () => {
            if (!hasGithubToken()) { element('status').textContent = 'Set the GitHub token first (Tampermonkey menu); a scan has to save to GitHub.'; return; }
            saveJob({ active: true, concurrency: Math.min(10, Math.max(1, parseInt(element('concurrency').value, 10) || 3)), page: 1, pageKey: null, queue: [], inFlight: {}, done: {} });
        });
        element('stop').addEventListener('click', () => { const job = readJob(); if (job) saveJob({ ...job, active: false }); });

        function tick() {
            let job = readJob();
            const counts = (done) => Object.values(done).reduce((sum, result) => ({ ...sum, [result.status]: (sum[result.status] || 0) + 1 }), { saved: 0, partial: 0, failed: 0 });
            if (job?.active) {
                for (const key of Object.keys(job.inFlight)) {
                    const result = GM_getValue(SCAN_RESULT_KEY_PREFIX + key, null);
                    if (!result && Date.now() - job.inFlight[key] < SCAN_TAB_TIMEOUT_MS) continue;
                    openTabs[key]?.close();
                    GM_deleteValue(SCAN_RESULT_KEY_PREFIX + key);
                    delete job.inFlight[key];
                    job.done[key] = result || { status: 'failed', message: 'no result within 90 s' };
                }
                const here = scanKeyOf(location.href);
                if (job.pageKey !== here && !job.queue.length && !Object.keys(job.inFlight).length) {
                    job.pageKey = here;
                    job.queue = [...new Set([...document.querySelectorAll(category.products)].map((item) => item.querySelector(category.link)?.href).filter(Boolean))];
                }
                while (Object.keys(job.inFlight).length < job.concurrency && job.queue.length) {
                    const url = job.queue.shift();
                    job.inFlight[scanKeyOf(url)] = Date.now();
                    openTabs[scanKeyOf(url)] = GM_openInTab(url, { active: false, insert: true, setParent: true });
                }
                if (!job.queue.length && !Object.keys(job.inFlight).length) {
                    const nextPageLink = document.querySelector(category.next);
                    if (nextPageLink) { job.page++; saveJob(job); location.href = nextPageLink.href; return; }
                    job.active = false;
                    job.finished = true;
                    const problems = Object.entries(job.done).filter(([, result]) => result.status !== 'saved');
                    if (problems.length) console.warn('OLX Model Tags scan: pages that were not fully saved', problems);
                }
                saveJob(job);
            }
            element('start').disabled = Boolean(job?.active);
            element('stop').hidden = !job?.active;
            element('concurrency').disabled = Boolean(job?.active);
            if (job) {
                const total = counts(job.done);
                element('status').textContent = `${job.active ? 'Scanning' : job.finished ? 'Done' : 'Stopped'}: page ${job.page}/${pageCount}\n`
                    + `open ${Object.keys(job.inFlight).length}, waiting ${job.queue.length}\nsaved ${total.saved}, partial ${total.partial}, failed ${total.failed}`
                    + (!job.active && (total.partial || total.failed) ? '\n(details in the browser console)' : '');
            }
        }
        setInterval(tick, 1000);
        tick();
    }

    if (!IS_OLX_PAGE) { startSpecsCapture(); return; }

    // ---------- Page reading (local DOM only) ----------

    // OLX's client re-render of the listing does not always use <h4>; the title link (or its aria-label) is stable.
    function findCardTitleText(titleContainer) {
        const titleLink = titleContainer.querySelector('[data-testid="card-title-link"]');
        return readTextWithoutStyleTags(titleLink) || titleLink?.getAttribute('aria-label') || '';
    }

    function doesAdNeedTagBarRender(ad) {
        const bar = ad.anchor.nextElementSibling;
        return !bar?.classList.contains('olx-model-tags-bar') || (bar.dataset.editing !== 'true' && bar.dataset.renderedText !== ad.text);
    }

    // OLX server-renders inline <style> tags inside titles; textContent would include that CSS
    // (and innerText does too for hidden cards), so only text outside <style>/<script> is read.
    function readTextWithoutStyleTags(element) {
        if (!element) return '';
        const textParts = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('style, script')) textParts.push(walker.currentNode.data);
        return textParts.join(' ').replace(/\s+/g, ' ').trim();
    }

    function removeUrlQueryAndHash(url) {
        return url.split(/[?#]/)[0];
    }

    // Deepest OLX category in the breadcrumbs ("Монітори"); region crumbs look like "Монітори - Київ" and are skipped.
    function findPageCategory() {
        const categoryCrumbs = [...document.querySelectorAll('[data-testid="breadcrumb-item"]')].slice(1)
            .map((crumb) => readTextWithoutStyleTags(crumb)).filter((crumbText) => crumbText && !crumbText.includes(' - '));
        return categoryCrumbs.at(-1) || '';
    }

    function findAdsOnPage() {
        const ads = [];
        const category = findPageCategory();
        for (const card of document.querySelectorAll('[data-cy="l-card"][id]')) {
            const titleContainer = card.querySelector('[data-testid="ad-card-title"]');
            if (titleContainer && /^\d+$/.test(card.id)) {
                const title = findCardTitleText(titleContainer);
                const href = titleContainer.querySelector('[data-testid="card-title-link"]')?.getAttribute('href') || '';
                ads.push({ adId: card.id, title, text: title, category, url: href && removeUrlQueryAndHash(new URL(href, location.href).href), anchor: titleContainer, card });
            }
        }
        const adPageTitle = document.querySelector('[data-testid="offer_title"]');
        const adPageId = document.querySelector('[data-testid="ad-footer-bar-section"]')?.textContent.match(/ID:\s*(\d+)/)?.[1];
        if (adPageTitle && adPageId) {
            // Search cards only have the title; the ad page also has the description. Both are read from the open page only.
            const description = readTextWithoutStyleTags(document.querySelector('[data-cy="ad_description"]'));
            const parameters = readTextWithoutStyleTags(document.querySelector('[data-testid="ad-parameters-container"]'));
            const title = readTextWithoutStyleTags(adPageTitle);
            ads.push({ adId: adPageId, title, category, text: `${title}\n${parameters}\n${description}`, url: removeUrlQueryAndHash(location.href), anchor: adPageTitle, card: null });
        }
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
.olx-model-tags-chip-group{background:transparent;color:var(--muted)}
.olx-model-tags-table{flex:1 0 100%;border-collapse:collapse;margin:0}
.olx-model-tags-table th,.olx-model-tags-table td{padding:4px;border-bottom:1px solid var(--surface-elevated);text-align:left;vertical-align:middle}
.olx-model-tags-table th{width:1%;white-space:nowrap;color:var(--muted);font-weight:400}
.olx-model-tags-table td{color:var(--text);font-family:"JetBrains Mono",ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}
.olx-model-tags-table td:last-child{width:1%;text-align:right}
.olx-model-tags-row-ad th{font-style:italic}
.olx-model-tags-destination{color:var(--muted);white-space:nowrap}
.olx-model-tags-chip-broken{background:var(--negative);color:var(--on-primary);font-weight:600}
.olx-model-tags-icon-button{display:inline-flex;align-items:center;justify-content:center;padding:4px;border:0;border-radius:4px;background:transparent;color:var(--muted);cursor:pointer;line-height:0}
.olx-model-tags-icon-button:hover{background:var(--surface-elevated);color:var(--text)}
.olx-model-tags-icon-button-broken-active{color:var(--negative)}
.olx-model-tags-text-button{padding:6px;border:1px solid var(--border-strong);border-radius:6px;background:var(--surface-card);color:var(--text);font-weight:600;cursor:pointer;white-space:nowrap}
.olx-model-tags-text-button:hover{background:var(--surface-elevated)}
.olx-model-tags-text-button-active{background:var(--primary);border-color:var(--primary);color:var(--on-primary)}
.olx-model-tags-text-button-active:hover{background:var(--primary-active)}
.olx-model-tags-root button:focus-visible,.olx-model-tags-root input:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(59,130,246,.5)}
.olx-model-tags-input{width:140px;padding:4px;border:1px solid var(--border-strong);border-radius:4px;background:var(--surface-elevated);color:var(--text)}
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
.olx-model-tags-bar[data-editing="true"] .olx-model-tags-chip .olx-model-tags-icon-button,.olx-model-tags-bar[data-editing="true"] .olx-model-tags-table .olx-model-tags-icon-button{display:none}
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
        check: 'M5 12l5 5 9-10',
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
        const entries = [...Object.values(olxModelTagsData.models), ...Object.values(olxModelTagsData.ads)];
        fillDatalist('olx-model-tags-known-groups', entries.map((entry) => entry.group));
        fillDatalist('olx-model-tags-known-models', Object.values(olxModelTagsData.models).map((model) => model.name));
        fillDatalist('olx-model-tags-known-properties', entries.flatMap((entry) => entry.tags).map((tag) => splitTagIntoPropertyAndValue(tag).property));
    }

    function fillDatalist(datalistId, values) {
        let datalist = document.getElementById(datalistId);
        if (!datalist) { datalist = createElement('datalist'); datalist.id = datalistId; document.body.append(datalist); }
        datalist.replaceChildren(...[...new Set(values.filter(Boolean))].sort().map((value) => Object.assign(document.createElement('option'), { value })));
    }

    function fillKnownValuesDatalistForProperty(property) {
        const allTags = [...Object.values(olxModelTagsData.models), ...Object.values(olxModelTagsData.ads)].flatMap((entry) => entry.tags);
        fillDatalist('olx-model-tags-known-values', allTags.map(splitTagIntoPropertyAndValue)
            .filter((splitTag) => splitTag.property.toLowerCase() === property.trim().toLowerCase()).map((splitTag) => splitTag.value));
    }

    function renderTagBar(ad) {
        let bar = ad.anchor.nextElementSibling?.classList.contains('olx-model-tags-bar') ? ad.anchor.nextElementSibling : null;
        if (!bar) {
            // Custom tag, not <div>: when the script runs before OLX's React hydration (e.g. Dark Reader slows the page),
            // React adopts a <div> sitting where it expects its own <div> and fills it with OLX content, wiping the tags.
            // React never adopts an element of a different type.
            bar = createElement('olx-model-tags-bar', 'olx-model-tags-root olx-model-tags-bar');
            bar.addEventListener('click', (event) => event.stopPropagation());
            ad.anchor.after(bar);
        }
        if (bar.dataset.editing === 'true') return;
        bar.dataset.renderedText = ad.text;
        const tagging = resolveAdTagging(olxModelTagsData, ad.adId, ad.title);
        const isBroken = tagging.adTags.includes(BROKEN_TAG);
        const matchedStopPhrase = findPhraseInText(olxModelTagsData, 'stopPhrases', ad.text);
        const children = [];
        if (tagging.group) {
            const groupChip = createElement('span', 'olx-model-tags-chip olx-model-tags-chip-group', tagging.group);
            groupChip.title = 'Group';
            children.push(groupChip);
        }
        if (tagging.modelName) {
            const modelChip = createElement('span', 'olx-model-tags-chip olx-model-tags-chip-model', tagging.modelName);
            const isModelSetForThisAd = Boolean(olxModelTagsData.ads[ad.adId]?.model);
            modelChip.title = isModelSetForThisAd ? 'Model set for this ad' : 'Model found in the title';
            if (isModelSetForThisAd) modelChip.append(createIconButton('close', `Remove model ${tagging.modelName} from this ad`, () => recordOperationForAd(ad, { type: 'setAdModel', adId: ad.adId, modelName: '' })));
            children.push(modelChip);
        }
        // "Property: value" tags go into a table (one row per property); tags without a property stay chips.
        const tableRows = [];
        const addTagToBar = (tag, isAdTag, removeLabel, onRemove) => {
            const { property, value } = splitTagIntoPropertyAndValue(tag);
            if (property) tableRows.push({ property, value, isAdTag, removeLabel, onRemove });
            else children.push(createTagChip(tag, `olx-model-tags-chip${isAdTag ? ' olx-model-tags-chip-ad' : ''}`, removeLabel, onRemove));
        };
        for (const tag of tagging.modelTags) {
            addTagToBar(tag, false, `Remove "${tag}" from every ${tagging.modelName} ad`,
                () => recordOperationForAd(ad, { type: 'removeTag', scope: 'model', modelName: tagging.modelName, tag }));
        }
        for (const tag of tagging.adTags.filter((tag) => tag !== BROKEN_TAG)) {
            addTagToBar(tag, true, `Remove "${tag}" from this ad`,
                () => recordOperationForAd(ad, { type: 'removeTag', scope: 'ad', adId: ad.adId, tag }));
        }
        if (isBroken) {
            const brokenChip = createElement('span', 'olx-model-tags-chip olx-model-tags-chip-broken', '⚠ Broken');
            if (matchedStopPhrase) brokenChip.title = `Stop phrase «${matchedStopPhrase}»`;
            children.push(brokenChip);
        }
        // Search cards only show the title, so a stop phrase found in the description on the ad page is saved as the
        // ad's Broken tag; search results then hide it too. Done once per ad, so un-marking it by hand sticks.
        const savedAdEntry = olxModelTagsData.ads[ad.adId];
        if (savedAdEntry && ad.url && (!savedAdEntry.url || (!savedAdEntry.category && ad.category))) queueMicrotask(() => recordAdInfoIfChanged(ad));
        const autoBrokenAdIds = GM_getValue(STORAGE_KEY_AUTO_BROKEN_AD_IDS, []);
        if (!ad.card && matchedStopPhrase && !isBroken && !autoBrokenAdIds.includes(ad.adId)) {
            GM_setValue(STORAGE_KEY_AUTO_BROKEN_AD_IDS, [...autoBrokenAdIds, ad.adId]);
            queueMicrotask(() => recordOperationForAd(ad, { type: 'addTag', scope: 'ad', adId: ad.adId, tag: BROKEN_TAG }));
        }
        if (matchedStopPhrase && !isBroken) {
            const stopPhraseChip = createElement('span', 'olx-model-tags-chip olx-model-tags-chip-broken', `⚠ «${matchedStopPhrase}»`);
            stopPhraseChip.title = 'Matches a stop phrase: treated as broken and hidden in searches';
            children.push(stopPhraseChip);
        }
        const matchedDislikedBrand = findPhraseInText(olxModelTagsData, 'dislikedBrands', ad.text);
        if (matchedDislikedBrand) {
            const dislikedBrandChip = createElement('span', 'olx-model-tags-chip olx-model-tags-chip-broken', `⊘ ${matchedDislikedBrand}`);
            dislikedBrandChip.title = 'Disliked brand: hidden in searches';
            children.push(dislikedBrandChip);
        }
        children.push(createIconButton('broken', isBroken ? 'Unmark as broken' : 'Mark this ad as broken (hidden from searches)',
            () => recordOperationForAd(ad, { type: isBroken ? 'removeTag' : 'addTag', scope: 'ad', adId: ad.adId, tag: BROKEN_TAG }),
            isBroken ? 'olx-model-tags-icon-button-broken-active' : ''));
        children.push(createIconButton('plus', 'Add tag or set model', () => openTagEditor(bar, ad, tagging)));
        if (tableRows.length) children.push(createPropertyTable(tableRows));
        bar.replaceChildren(...children);
    }

    function createPropertyTable(tableRows) {
        const table = createElement('table', 'olx-model-tags-table');
        for (const { property, value, isAdTag, removeLabel, onRemove } of tableRows) {
            const row = createElement('tr', isAdTag ? 'olx-model-tags-row-ad' : '');
            row.append(createElement('th', '', property), createElement('td', '', value));
            const removeCell = createElement('td');
            removeCell.append(createIconButton('close', removeLabel, onRemove));
            row.append(removeCell);
            table.append(row);
        }
        return table;
    }

    function createTagChip(tag, className, removeLabel, onRemove) {
        const chip = createElement('span', className, tag);
        chip.append(createIconButton('close', removeLabel, onRemove));
        return chip;
    }

    function createEditorInput(placeholder, ariaLabel, value, datalistId, extraClassName = '') {
        const input = createElement('input', `olx-model-tags-input ${extraClassName}`.trim());
        input.placeholder = placeholder;
        input.value = value;
        input.setAttribute('aria-label', ariaLabel);
        input.setAttribute('list', datalistId);
        return input;
    }

    // Fields: Group → Model → Property → Value. "Property: value" is stored as one tag, so filters and the sheet keep working.
    function openTagEditor(bar, ad, tagging) {
        bar.dataset.editing = 'true';
        const groupInput = createEditorInput('Group (e.g. Monitors)', 'Group of this ad or model', tagging.group, 'olx-model-tags-known-groups');
        const modelInput = createEditorInput('Model (optional)', 'Model of this ad', tagging.modelName, 'olx-model-tags-known-models', 'olx-model-tags-input-model');
        const propertyInput = createEditorInput('Property (e.g. Size)', 'Property name, optional', '', 'olx-model-tags-known-properties');
        const valueInput = createEditorInput('Value', 'Property value or plain tag', '', 'olx-model-tags-known-values');
        fillKnownValuesDatalistForProperty('');
        propertyInput.addEventListener('input', () => fillKnownValuesDatalistForProperty(propertyInput.value));
        const destinationText = createElement('span', 'olx-model-tags-destination');
        const updateDestinationText = () => {
            destinationText.textContent = modelInput.value.trim() ? `→ every ${modelInput.value.trim()} ad` : '→ this ad only';
        };
        updateDestinationText();
        modelInput.addEventListener('input', updateDestinationText);
        const closeEditor = () => { delete bar.dataset.editing; renderTagBar(ad); bar.querySelector('[aria-label="Add tag or set model"]')?.focus(); };
        // Enter saves and keeps the editor open for the next property; ✓ saves and closes; × / Esc discard.
        const saveEditor = (shouldKeepEditorOpen) => {
            const group = groupInput.value.trim();
            const modelName = modelInput.value.trim();
            const property = propertyInput.value.trim().replace(/:+$/, '');
            const value = valueInput.value.trim();
            if (modelName && !normalizeModelKey(modelName)) { modelInput.setCustomValidity('Model needs letters or digits'); modelInput.reportValidity(); return; }
            if (property && !value) { valueInput.setCustomValidity(`Enter a value for ${property}`); valueInput.reportValidity(); return; }
            delete bar.dataset.editing;
            if (modelName !== tagging.modelName) recordOperationForAd(ad, { type: 'setAdModel', adId: ad.adId, modelName });
            if (group !== tagging.group) recordOperationForAd(ad, modelName ? { type: 'setGroup', scope: 'model', modelName, group } : { type: 'setGroup', scope: 'ad', adId: ad.adId, group });
            const tag = property ? `${property}: ${value}` : value;
            if (tag) recordOperationForAd(ad, modelName ? { type: 'addTag', scope: 'model', modelName, tag } : { type: 'addTag', scope: 'ad', adId: ad.adId, tag });
            renderTagBar(ad);
            if (shouldKeepEditorOpen) openTagEditor(bar, ad, resolveAdTagging(olxModelTagsData, ad.adId, ad.title));
            else bar.querySelector('[aria-label="Add tag or set model"]')?.focus();
        };
        for (const input of [groupInput, modelInput, propertyInput, valueInput]) {
            input.addEventListener('keydown', (event) => {
                event.stopPropagation();
                if (event.key === 'Enter') { event.preventDefault(); saveEditor(true); }
                if (event.key === 'Escape') { event.preventDefault(); closeEditor(); }
            });
            input.addEventListener('input', () => input.setCustomValidity(''));
        }
        // Existing tags stay visible; the editor replaces only the Broken and + buttons and stays open until Esc/×.
        for (const actionButton of bar.querySelectorAll(':scope > .olx-model-tags-icon-button')) actionButton.remove();
        bar.append(groupInput, modelInput, propertyInput, valueInput, destinationText,
            createIconButton('check', 'Save and close (Enter saves and adds another)', () => saveEditor(false)), createIconButton('close', 'Discard and close (Esc)', closeEditor));
        if (!hasGithubToken() && tagging.modelTags.length) bar.append(createTextButton('Suggest model', 'Open a pre-filled GitHub issue so the owner can add this model to the shared catalog', () => suggestModelToCatalog(ad, tagging)));
        (tagging.group ? propertyInput : groupInput).focus();
    }

    // No account-free write path on purpose (it would invite spam): a GitHub issue the owner reviews.
    function suggestModelToCatalog(ad, tagging) {
        const suggestion = JSON.stringify({ name: tagging.modelName, group: tagging.group, tags: tagging.modelTags }, null, 1);
        const issueUrl = `https://github.com/${GITHUB_DATA_REPOSITORY}/issues/new?title=${encodeURIComponent(`Model: ${tagging.modelName}`)}&body=${encodeURIComponent(`\`\`\`json\n${suggestion}\n\`\`\`\nExample ad: ${ad.url}`)}`;
        window.open(issueUrl, '_blank', 'noopener');
    }

    let isFilterPanelExpanded = false;
    let expandedPhraseListName = '';

    function createPhraseListToggleButton(listName, label, description) {
        const isExpanded = expandedPhraseListName === listName;
        const toggleButton = createTextButton(`${isExpanded ? '✓ ' : ''}${label} (${getPhraseList(olxModelTagsData, listName).length})`,
            isExpanded ? `Hide ${label.toLowerCase()}` : `Edit ${label.toLowerCase()}: ${description}`,
            () => { expandedPhraseListName = isExpanded ? '' : listName; renderFilterPanel(); }, isExpanded);
        toggleButton.setAttribute('aria-expanded', String(isExpanded));
        return toggleButton;
    }

    function createPhraseListEditors() {
        const toggleRow = createElement('div', 'olx-model-tags-panel-row');
        toggleRow.append(
            createPhraseListToggleButton('stopPhrases', 'Stop phrases', 'ads whose title or description contains one are treated as broken'),
            createPhraseListToggleButton('dislikedBrands', 'Disliked brands', 'ads naming one of these brands are hidden'));
        if (!expandedPhraseListName) return [toggleRow];
        const singularLabel = expandedPhraseListName === 'stopPhrases' ? 'stop phrase' : 'disliked brand';
        const phraseList = createElement('div', 'olx-model-tags-panel-filters');
        for (const phrase of getPhraseList(olxModelTagsData, expandedPhraseListName)) {
            phraseList.append(createTagChip(phrase, 'olx-model-tags-chip', `Remove ${singularLabel} "${phrase}"`,
                () => recordOperation({ type: 'removePhrase', listName: expandedPhraseListName, phrase })));
        }
        const phraseInput = createElement('input', 'olx-model-tags-input');
        phraseInput.placeholder = `Add ${singularLabel}`;
        phraseInput.setAttribute('aria-label', `Add ${singularLabel} (Enter)`);
        phraseInput.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key !== 'Enter' || !phraseInput.value.trim()) return;
            event.preventDefault();
            recordOperation({ type: 'addPhrase', listName: expandedPhraseListName, phrase: phraseInput.value });
            document.querySelector(`.olx-model-tags-panel [aria-label^="Add ${singularLabel}"]`)?.focus();
        });
        phraseList.append(phraseInput);
        return [toggleRow, phraseList];
    }

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
        if (!IS_OLX_PAGE || !olxModelTagsData || !document.body) return;
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
        const showDislikedBrandAds = GM_getValue(STORAGE_KEY_SHOW_DISLIKED_BRAND_ADS, false);
        let dislikedBrandAdCount = 0;
        const filterValueCounts = new Map();
        let shownAdCount = 0;
        let brokenAdCount = 0;
        for (const ad of ads) {
            const tagging = resolveAdTagging(olxModelTagsData, ad.adId, ad.title);
            const filterValues = [...new Set([...tagging.modelTags, ...tagging.adTags, ...(tagging.modelName ? [tagging.modelName] : []), ...(findPhraseInText(olxModelTagsData, 'stopPhrases', ad.text) ? [BROKEN_TAG] : []),
                ...(findPhraseInText(olxModelTagsData, 'dislikedBrands', ad.text) ? [DISLIKED_BRAND_TAG] : [])])];
            for (const value of filterValues) if (value !== BROKEN_TAG && value !== DISLIKED_BRAND_TAG) filterValueCounts.set(value, (filterValueCounts.get(value) || 0) + 1);
            if (filterValues.includes(BROKEN_TAG)) brokenAdCount++;
            if (filterValues.includes(DISLIKED_BRAND_TAG)) dislikedBrandAdCount++;
            const isShown = doesAdMatchActiveFilters(filterValues, activeFilters, showBrokenAds, showDislikedBrandAds);
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
        const closeButton = createIconButton('close', 'Close tag filters (Esc)', () => setFilterPanelExpanded(false));
        closeButton.setAttribute('aria-expanded', 'true');
        headerRow.append(createIconButton('sync', 'Refresh the shared catalog from GitHub now', synchronizeWithGithub), closeButton);
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
                () => { GM_setValue(STORAGE_KEY_SHOW_BROKEN_ADS, !showBrokenAds); renderFilterPanel(); }, showBrokenAds),
                createTextButton(`${showDislikedBrandAds ? '✓ ' : ''}Show disliked brands (${dislikedBrandAdCount})`, showDislikedBrandAds ? 'Hide ads of disliked brands' : 'Show ads of disliked brands',
                () => { GM_setValue(STORAGE_KEY_SHOW_DISLIKED_BRAND_ADS, !showDislikedBrandAds); renderFilterPanel(); }, showDislikedBrandAds));
            if (activeFilters.length) footerRow.append(createTextButton('Clear filters', 'Remove all tag filters', () => { GM_setValue(STORAGE_KEY_ACTIVE_FILTERS, []); renderFilterPanel(); }));
            if (sortedValues.length) children.push(filters);
            children.push(footerRow);
        }
        children.push(...createPhraseListEditors());
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
        if (!IS_OLX_PAGE || !olxModelTagsData) return;
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
            if (olxModelTagsData && findAdsOnPage().some(doesAdNeedTagBarRender)) renderEverything();
        });
    }).observe(document.body, { childList: true, subtree: true });

    document.addEventListener(DUPLICATE_INSTALL_EVENT, () => setSynchronizationStatus('error', 'Installed twice in Tampermonkey: delete one copy'));

    if (olxModelTagsData) {
        olxModelTagsData = rebuildLocalDataFromCacheAndPendingOperations(olxModelTagsData);
        const cachedAt = GM_getValue(STORAGE_KEY_CACHED_AT, 0);
        synchronizationStatus = { state: 'synced', message: cachedAt ? `Cached ${new Date(cachedAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}` : 'Cached' };
        renderEverything();
        if (Date.now() - cachedAt > CATALOG_REFRESH_INTERVAL_MS || (hasGithubToken() && listPendingOperationKeys().length)) synchronizeWithGithub();
    } else {
        olxModelTagsData = createEmptyOlxModelTagsData();
        synchronizeWithGithub();
    }
})();
