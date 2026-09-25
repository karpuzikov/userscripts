// ==UserScript==
// @name         MusicBrainz - Barcode and Catalog Number Search
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.1.0
// @description  Adds Barcode and Catalog number release search fields beside the native MusicBrainz search and opens unique matches directly.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/*
// @match        https://beta.musicbrainz.org/*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/barcode-catalog-search/MusicBrainz_Barcode_Catalog_Search.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/barcode-catalog-search/MusicBrainz_Barcode_Catalog_Search.user.js
// @supportURL   https://github.com/karpuzikov/userscripts
// @grant        none
// @run-at       document-end
// ==/UserScript==

(() => {
    'use strict';

    const GROUP_ID = 'mb-quick-release-search';

    if (window.top !== window.self || document.getElementById(GROUP_ID)) {
        return;
    }

    const nativeInput = document.getElementById('headerid-query');
    const nativeForm = nativeInput?.closest('form[action="/search"]');
    const searchContainer = nativeForm?.parentElement;
    const nativeButton = nativeForm?.querySelector('button[type="submit"]');

    if (!nativeInput || !nativeForm || !searchContainer || !nativeButton) {
        return;
    }

    searchContainer.classList.add('mb-quick-release-search-enabled');

    const style = document.createElement('style');
    style.textContent = `
        .search-container.mb-quick-release-search-enabled {
            display: flex;
            align-items: flex-start;
        }

        #${GROUP_ID} {
            display: flex;
            align-items: flex-start;
            gap: 4px;
            margin-right: 6px;
        }

        #${GROUP_ID} form {
            width: 180px !important;
            height: 25px;
            margin-top: 5px !important;
            position: relative;
            flex: 0 0 180px;
        }

        #${GROUP_ID} input {
            width: 150px !important;
            height: 25px !important;
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
        }

        #${GROUP_ID} button {
            width: 30px !important;
            height: 25px !important;
            position: absolute !important;
            left: 149px !important;
            top: 0 !important;
        }
    `;
    document.head.appendChild(style);

    const visualProperties = [
        'boxSizing',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'lineHeight',
        'letterSpacing',
        'color',
        'backgroundColor',
        'backgroundImage',
        'backgroundPosition',
        'backgroundRepeat',
        'borderTopWidth',
        'borderRightWidth',
        'borderBottomWidth',
        'borderLeftWidth',
        'borderTopStyle',
        'borderRightStyle',
        'borderBottomStyle',
        'borderLeftStyle',
        'borderTopColor',
        'borderRightColor',
        'borderBottomColor',
        'borderLeftColor',
        'borderTopLeftRadius',
        'borderTopRightRadius',
        'borderBottomRightRadius',
        'borderBottomLeftRadius'
    ];

    const copyVisualStyle = (source, target) => {
        const computed = getComputedStyle(source);
        for (const property of visualProperties) {
            target.style[property] = computed[property];
        }
    };

    const group = document.createElement('div');
    group.id = GROUP_ID;

    const makeSearchForm = (type, placeholder, ariaLabel, numeric = false) => {
        const form = document.createElement('form');
        form.dataset.search = type;
        form.autocomplete = 'off';

        const input = nativeInput.cloneNode(false);
        input.removeAttribute('id');
        input.name = type;
        input.value = '';
        input.placeholder = placeholder;
        input.setAttribute('aria-label', ariaLabel);
        input.type = 'text';
        if (numeric) {
            input.inputMode = 'numeric';
        } else {
            input.removeAttribute('inputmode');
        }
        copyVisualStyle(nativeInput, input);

        const button = nativeButton.cloneNode(true);
        button.removeAttribute('id');
        button.type = 'submit';

        form.append(input, ' ', button);
        group.appendChild(form);

        return {form, input};
    };

    const barcodeSearch = makeSearchForm(
        'barcode',
        'Barcode',
        'Search MusicBrainz releases by barcode',
        true
    );

    const catnoSearch = makeSearchForm(
        'catno',
        'Catalog number',
        'Search MusicBrainz releases by catalog number'
    );

    searchContainer.insertBefore(group, nativeForm);

    const buildSearchUrl = (query) => {
        const url = new URL('/search', location.origin);
        url.searchParams.set('query', query);
        url.searchParams.set('type', 'release');
        url.searchParams.set('limit', '100');
        url.searchParams.set('method', 'advanced');
        return url;
    };

    const openUniqueReleaseOrResults = async (query) => {
        const resultsUrl = buildSearchUrl(query);
        const apiUrl = new URL('/ws/2/release/', location.origin);
        apiUrl.searchParams.set('query', query);
        apiUrl.searchParams.set('fmt', 'json');
        apiUrl.searchParams.set('limit', '2');

        try {
            const response = await fetch(apiUrl, {
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json'
                }
            });

            if (response.ok) {
                const data = await response.json();
                const releases = Array.isArray(data.releases) ? data.releases : [];

                if (Number(data.count) === 1 && releases.length === 1 && releases[0]?.id) {
                    location.assign('/release/' + releases[0].id);
                    return;
                }
            }
        } catch {
            // Fall back to the normal MusicBrainz results page.
        }

        location.assign(resultsUrl.toString());
    };

    barcodeSearch.form.addEventListener('submit', (event) => {
        event.preventDefault();

        const barcode = barcodeSearch.input.value.replace(/\D/g, '');

        if (!barcode) {
            barcodeSearch.input.focus();
            return;
        }

        openUniqueReleaseOrResults('barcode:' + barcode);
    });

    catnoSearch.form.addEventListener('submit', (event) => {
        event.preventDefault();

        const catalogNumber = catnoSearch.input.value.trim();

        if (!catalogNumber) {
            catnoSearch.input.focus();
            return;
        }

        const escapedCatalogNumber = catalogNumber
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');

        openUniqueReleaseOrResults('catno:"' + escapedCatalogNumber + '"');
    });
})();
