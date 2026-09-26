// ==UserScript==
// @name         MusicBrainz - Auto-Select Single Disc ID Artist
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Automatically continues Disc ID attachment when an artist search returns exactly one result.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/cdtoc/attach*
// @match        https://beta.musicbrainz.org/cdtoc/attach*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/disc-id-auto-select-artist/MusicBrainz_Auto_Select_Single_Disc_ID_Artist.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/disc-id-auto-select-artist/MusicBrainz_Auto_Select_Single_Disc_ID_Artist.user.js
// @supportURL   https://github.com/karpuzikov/userscripts
// @grant        none
// @run-at       document-end
// ==/UserScript==

(() => {
    'use strict';

    const url = new URL(location.href);

    if (!url.searchParams.has('filter-artist.query') || url.searchParams.has('artist')) {
        return;
    }

    const artistRadios = [
        ...document.querySelectorAll('input[type="radio"][name="artist"]')
    ];

    if (artistRadios.length !== 1) {
        return;
    }

    const radio = artistRadios[0];
    const form = radio.form;

    if (!form) {
        return;
    }

    radio.checked = true;

    if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
    } else {
        form.submit();
    }
})();
