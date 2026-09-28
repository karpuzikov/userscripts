// ==UserScript==
// @name         MusicBrainz - Duplicate Recording Highlighter
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Highlight tracks in bright red when the same recording is linked to multiple tracks on a MusicBrainz release.
// @author       karpuzikov
// @license      MIT
// @match        https://musicbrainz.org/release/*
// @match        https://beta.musicbrainz.org/release/*
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/duplicate-recording-highlighter/MusicBrainz_Duplicate_Recording_Highlighter.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/duplicate-recording-highlighter/MusicBrainz_Duplicate_Recording_Highlighter.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const RELEASE_PAGE = new RegExp('^/release/' + UUID + '/?$', 'i');
    const RELEASE_EDIT_PAGE = new RegExp('^/release/' + UUID + '/edit/?$', 'i');
    const IS_RELEASE_PAGE = RELEASE_PAGE.test(location.pathname);
    const IS_RELEASE_EDITOR = location.pathname === '/release/add' || RELEASE_EDIT_PAGE.test(location.pathname);
    const HIGHLIGHT_CLASS = 'mb-duplicate-recording';
    const RECORDING_HREF = new RegExp('/recording/(' + UUID + ')(?:[/?#]|$)', 'i');

    if (!IS_RELEASE_PAGE && !IS_RELEASE_EDITOR) return;

    const style = document.createElement('style');
    style.textContent = `
        .${HIGHLIGHT_CLASS} > td {
            background: #ff1616 !important;
            color: #ffffff !important;
        }

        .${HIGHLIGHT_CLASS} > td a,
        .${HIGHLIGHT_CLASS} > td a:visited {
            color: #ffffff !important;
            font-weight: 700 !important;
            text-decoration: underline !important;
        }

        .${HIGHLIGHT_CLASS} > td:first-child {
            box-shadow: inset 4px 0 0 #7a0000 !important;
        }
    `;
    document.head.appendChild(style);

    function recordingMBIDFromLink(link) {
        if (!link) return null;

        const href = link.getAttribute('href') || '';
        const match = RECORDING_HREF.exec(href);
        return match ? match[1].toLowerCase() : null;
    }

    function getReleasePageTracks() {
        const entries = [];

        for (const row of document.querySelectorAll('table.medium tbody > tr')) {
            if (!row.querySelector(':scope > td.pos.t')) continue;

            const titleCell = row.querySelector(':scope > td.wrap-anywhere, :scope > td:nth-child(2)');
            const recordingLink = titleCell?.querySelector('a[href*="/recording/"]');
            const recordingMBID = recordingMBIDFromLink(recordingLink);

            if (recordingMBID) entries.push({ row, recordingMBID });
        }

        return entries;
    }

    function getReleaseEditorTracks() {
        const entries = [];

        for (const row of document.querySelectorAll('#recordings table[id="track-recording-assignation"] tbody > tr.track')) {
            const recordingCells = [...row.querySelectorAll(':scope > td.name')].slice(1);
            const recordingLink = recordingCells
                .map(cell => cell.querySelector('a[href*="/recording/"]'))
                .find(Boolean);
            const recordingMBID = recordingMBIDFromLink(recordingLink);

            if (recordingMBID) entries.push({ row, recordingMBID });
        }

        return entries;
    }

    function updateHighlights() {
        document.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach(row => {
            row.classList.remove(HIGHLIGHT_CLASS);
            row.removeAttribute('data-mb-duplicate-recording-count');
        });

        const entries = IS_RELEASE_PAGE ? getReleasePageTracks() : getReleaseEditorTracks();
        const groups = new Map();

        for (const entry of entries) {
            if (!groups.has(entry.recordingMBID)) groups.set(entry.recordingMBID, []);
            groups.get(entry.recordingMBID).push(entry.row);
        }

        for (const rows of groups.values()) {
            const uniqueRows = [...new Set(rows)];
            if (uniqueRows.length < 2) continue;

            for (const row of uniqueRows) {
                row.classList.add(HIGHLIGHT_CLASS);
                row.dataset.mbDuplicateRecordingCount = String(uniqueRows.length);
            }
        }
    }

    let updateTimer = null;

    function scheduleUpdate() {
        clearTimeout(updateTimer);
        updateTimer = setTimeout(updateHighlights, 40);
    }

    updateHighlights();

    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['href']
    });
})();
