// ==UserScript==
// @name         MusicBrainz - Beatport Catalog Number Finder
// @namespace    https://github.com/karpuzikov/userscripts
// @version      0.1.2
// @description  Find missing digital-release catalog numbers on Beatport and review safe MusicBrainz edits.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/artist/*
// @match        https://beta.musicbrainz.org/artist/*
// @match        https://musicbrainz.org/release/*/edit*
// @match        https://beta.musicbrainz.org/release/*/edit*
// @match        https://www.beatport.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @connect      www.beatport.com
// @connect      beatport.com
// @connect      musicbrainz.org
// @connect      beta.musicbrainz.org
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/beatport-catalog-number-finder/Beatport_Catalog_Number_Finder.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/beatport-catalog-number-finder/Beatport_Catalog_Number_Finder.meta.js
// @run-at       document-idle
// ==/UserScript==
