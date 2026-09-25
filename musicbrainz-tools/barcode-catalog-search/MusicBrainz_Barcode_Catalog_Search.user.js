// ==UserScript==
// @name         MusicBrainz - Barcode and Catalog Number Search
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Adds always-visible Barcode and Catalog number release search fields to MusicBrainz.
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

    if (window.top !== window.self || document.getElementById('mb-quick-release-search')) {
        return;
    }

    const style = document.createElement('style');
    style.textContent = `
        #mb-quick-release-search {
            position: sticky;
            top: 0;
            z-index: 1000;
            width: 100%;
            box-sizing: border-box;
            padding: 6px 12px;
            border-bottom: 1px solid rgba(127, 127, 127, 0.35);
            background: Canvas;
            color: CanvasText;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
        }

        #mb-quick-release-search .mb-qrs-inner {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            max-width: 1200px;
            margin: 0 auto;
        }

        #mb-quick-release-search form {
            display: flex;
            align-items: center;
            gap: 5px;
            min-width: 0;
        }

        #mb-quick-release-search input {
            width: 240px;
            max-width: 38vw;
            box-sizing: border-box;
            padding: 5px 8px;
            border: 1px solid #aaa;
            border-radius: 3px;
            background: Field;
            color: FieldText;
            font: inherit;
        }

        #mb-quick-release-search button {
            box-sizing: border-box;
            padding: 5px 9px;
            border: 1px solid #999;
            border-radius: 3px;
            background: ButtonFace;
            color: ButtonText;
            font: inherit;
            cursor: pointer;
        }

        #mb-quick-release-search button:hover {
            filter: brightness(0.96);
        }

        @media (max-width: 720px) {
            #mb-quick-release-search .mb-qrs-inner {
                align-items: stretch;
                flex-direction: column;
                gap: 6px;
            }

            #mb-quick-release-search form {
                width: 100%;
            }

            #mb-quick-release-search input {
                width: 100%;
                max-width: none;
                flex: 1;
            }
        }
    `;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.id = 'mb-quick-release-search';
    bar.innerHTML = `
        <div class="mb-qrs-inner">
            <form data-search="barcode" autocomplete="off">
                <input
                    type="search"
                    name="barcode"
                    inputmode="numeric"
                    placeholder="Barcode"
                    aria-label="Search MusicBrainz releases by barcode"
                >
                <button type="submit">Search</button>
            </form>

            <form data-search="catno" autocomplete="off">
                <input
                    type="search"
                    name="catno"
                    placeholder="Catalog number"
                    aria-label="Search MusicBrainz releases by catalog number"
                >
                <button type="submit">Search</button>
            </form>
        </div>
    `;

    document.body.prepend(bar);

    const openReleaseSearch = (query) => {
        const url = new URL('/search', location.origin);
        url.searchParams.set('query', query);
        url.searchParams.set('type', 'release');
        url.searchParams.set('limit', '100');
        url.searchParams.set('method', 'advanced');
        location.assign(url.toString());
    };

    bar.querySelector('[data-search="barcode"]').addEventListener('submit', (event) => {
        event.preventDefault();

        const input = event.currentTarget.elements.barcode;
        const barcode = input.value.replace(/\D/g, '');

        if (!barcode) {
            input.focus();
            return;
        }

        openReleaseSearch(`barcode:${barcode}`);
    });

    bar.querySelector('[data-search="catno"]').addEventListener('submit', (event) => {
        event.preventDefault();

        const input = event.currentTarget.elements.catno;
        const catalogNumber = input.value.trim();

        if (!catalogNumber) {
            input.focus();
            return;
        }

        const escapedCatalogNumber = catalogNumber
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');

        openReleaseSearch(`catno:"${escapedCatalogNumber}"`);
    });
})();
