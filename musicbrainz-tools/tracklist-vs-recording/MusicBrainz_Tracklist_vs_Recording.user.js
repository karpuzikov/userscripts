// ==UserScript==
// @name         MusicBrainz - Tracklist vs Recording
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Shows tracklist title/artist-credit discrepancies against linked recordings and lets you replace each track value with the recording value in one click.
// @author       karpuzikov
// @license      MIT
// @supportURL   https://github.com/karpuzikov/userscripts
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/tracklist-vs-recording/MusicBrainz_Tracklist_vs_Recording.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/tracklist-vs-recording/MusicBrainz_Tracklist_vs_Recording.user.js
// @match        https://musicbrainz.org/release/add*
// @match        https://musicbrainz.org/release/*/edit*
// @match        https://beta.musicbrainz.org/release/add*
// @match        https://beta.musicbrainz.org/release/*/edit*
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(() => {
    'use strict';

    const SCRIPT_NAME = 'MusicBrainz - Tracklist vs Recording';
    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/tracklist-vs-recording/MusicBrainz_Tracklist_vs_Recording.user.js';
    const STYLE_ID = 'mb-tracklist-vs-recording-style';
    const DIFF_ROW_CLASS = 'mb-tracklist-vs-recording-diff-row';
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const watchedTracks = new WeakSet();
    const artistEntityCache = new Map();
    let scanTimer = 0;

    function pageWindow() {
        try {
            return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        } catch {
            return window;
        }
    }

    function editor() {
        return pageWindow().MB?._releaseEditor || null;
    }

    function unwrap(value) {
        return typeof value === 'function' ? value() : value;
    }

    function installStyle() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            tr.${DIFF_ROW_CLASS} > td {
                padding-top: 2px;
                padding-bottom: 6px;
                vertical-align: middle;
            }

            tr.${DIFF_ROW_CLASS} > td.mb-tvr-diff-cell {
                font-size: 12px;
            }

            .mb-tvr-diff {
                display: flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
            }

            .mb-tvr-value {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                min-width: 0;
            }

            .mb-tvr-track-value {
                text-decoration: line-through;
                opacity: .8;
            }

            .mb-tvr-recording-value {
                font-weight: 600;
            }

            .mb-tvr-replace {
                min-width: 28px;
                padding: 0 7px;
                font-weight: 700;
                line-height: 20px;
                cursor: pointer;
                flex: 0 0 auto;
            }

            .mb-tvr-replace[disabled] {
                cursor: default;
                opacity: .55;
            }
        `;
        document.head.appendChild(style);
    }

    function appendScriptLinkToEditNote() {
        const ed = editor();
        const editNote = ed?.rootField?.editNote;
        if (typeof editNote === 'function') {
            const current = String(editNote() || '');
            if (!current.includes(SCRIPT_URL)) {
                editNote(current
                    ? `${current.replace(/\s+$/, '')}\n\nScript: ${SCRIPT_URL}`
                    : `Script: ${SCRIPT_URL}`);
            }
            return;
        }

        const textarea = document.querySelector('#edit-note-text, textarea.edit-note');
        if (!textarea || textarea.value.includes(SCRIPT_URL)) return;

        const current = textarea.value.trimEnd();
        const next = current
            ? `${current}\n\nScript: ${SCRIPT_URL}`
            : `Script: ${SCRIPT_URL}`;

        const setter = Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            'value'
        )?.set;

        if (setter) setter.call(textarea, next);
        else textarea.value = next;

        textarea.dispatchEvent(new Event('input', {bubbles: true}));
        textarea.dispatchEvent(new Event('change', {bubbles: true}));
    }

    function hasExistingRecording(track) {
        try {
            if (typeof track?.hasExistingRecording === 'function') {
                return Boolean(track.hasExistingRecording());
            }
        } catch {
            // Fall through to the recording GID check.
        }

        return Boolean(unwrap(track?.recording)?.gid);
    }

    function recordingTitle(recording) {
        return String(unwrap(recording?.name) || '').trim();
    }

    function trackTitle(track) {
        return String(unwrap(track?.name) || '').trim();
    }

    function artistMbid(artist) {
        const entity = unwrap(artist) || {};
        const gid = String(unwrap(entity.gid) || '').trim();
        if (UUID.test(gid)) return gid.toLowerCase();

        const id = String(unwrap(entity.id) || '').trim();
        return UUID.test(id) ? id.toLowerCase() : '';
    }

    function numericArtistId(artist) {
        const entity = unwrap(artist) || {};
        const id = unwrap(entity.id);
        if (Number.isInteger(id) && id > 0) return id;
        if (/^\d+$/.test(String(id || '')) && Number(id) > 0) return Number(id);
        return null;
    }

    function artistCreditNames(artistCredit) {
        return unwrap(artistCredit)?.names || [];
    }

    function artistCreditText(artistCredit) {
        return artistCreditNames(artistCredit)
            .map(credit => {
                const artist = unwrap(credit?.artist) || {};
                const creditedName = String(
                    unwrap(credit?.name) || unwrap(artist.name) || ''
                );
                const joinPhrase = String(
                    unwrap(credit?.joinPhrase ?? credit?.join_phrase ?? '') || ''
                );
                return creditedName + joinPhrase;
            })
            .join('')
            .trim();
    }

    function artistCreditSignature(artistCredit) {
        return JSON.stringify(artistCreditNames(artistCredit).map(credit => {
            const artist = unwrap(credit?.artist) || {};
            return {
                artistId: numericArtistId(artist),
                artistGid: artistMbid(artist),
                artistName: String(unwrap(artist.name) || ''),
                creditedName: String(unwrap(credit?.name) || ''),
                joinPhrase: String(
                    unwrap(credit?.joinPhrase ?? credit?.join_phrase ?? '') || ''
                ),
            };
        }));
    }

    function titleDiffers(track) {
        if (!hasExistingRecording(track)) return false;

        try {
            if (typeof track.titleDiffersFromRecording === 'function') {
                return Boolean(track.titleDiffersFromRecording());
            }
        } catch {
            // Fall through to the exact comparison.
        }

        return trackTitle(track) !== recordingTitle(unwrap(track.recording));
    }

    function artistDiffers(track) {
        if (!hasExistingRecording(track)) return false;

        try {
            if (typeof track.artistDiffersFromRecording === 'function') {
                return Boolean(track.artistDiffersFromRecording());
            }
        } catch {
            // Fall through to a structural comparison.
        }

        const recording = unwrap(track.recording);
        return artistCreditSignature(track.artistCredit) !==
            artistCreditSignature(recording?.artistCredit);
    }

    function writeTrackTitle(track, title, recording) {
        if (!title || typeof track?.name !== 'function') return false;

        /*
         * MusicBrainz may unlink a recording when a track title changes too
         * far from the title saved at association time. This replacement is
         * coming from the linked recording itself, so update the saved title
         * first and keep the association intact.
         */
        if (recording?.gid) {
            track.name.saved = title;
        }

        if (typeof track.inputName === 'function') {
            track.inputName(title);
        } else {
            track.name(title);
        }

        return true;
    }

    async function resolveArtistEntity(artist) {
        const source = unwrap(artist) || {};
        if (numericArtistId(source)) return source;

        const gid = artistMbid(source);
        if (!gid) return null;

        const mb = pageWindow().MB;
        const cachedMbEntity = mb?.entityCache?.[gid];
        if (cachedMbEntity && numericArtistId(cachedMbEntity)) {
            return cachedMbEntity;
        }

        if (artistEntityCache.has(gid)) {
            return artistEntityCache.get(gid);
        }

        const promise = (async () => {
            const response = await fetch('/ws/js/entity/' + encodeURIComponent(gid), {
                credentials: 'same-origin',
                headers: {Accept: 'application/json'},
            });

            if (!response.ok) {
                throw new Error('Could not resolve artist ' + gid + ' (HTTP ' + response.status + ')');
            }

            const entity = await response.json();
            if (!entity || entity.entityType !== 'artist' || !numericArtistId(entity)) {
                throw new Error('MusicBrainz did not return a linkable artist for ' + gid);
            }

            if (!entity.gid) entity.gid = gid;
            return entity;
        })();

        artistEntityCache.set(gid, promise);

        try {
            const entity = await promise;
            artistEntityCache.set(gid, entity);
            return entity;
        } catch (error) {
            artistEntityCache.delete(gid);
            throw error;
        }
    }

    async function cloneLinkedArtistCredit(artistCredit) {
        const source = unwrap(artistCredit);
        const sourceNames = source?.names || [];
        const names = [];

        for (const credit of sourceNames) {
            const sourceArtist = unwrap(credit?.artist);
            const artist = await resolveArtistEntity(sourceArtist);

            if (!artist) {
                throw new Error(
                    'Could not resolve MusicBrainz artist for credit "' +
                    String(unwrap(credit?.name) || unwrap(sourceArtist?.name) || '').trim() +
                    '"'
                );
            }

            names.push({
                ...credit,
                artist,
                name: unwrap(credit?.name) || unwrap(artist.name) || '',
                joinPhrase: unwrap(credit?.joinPhrase ?? credit?.join_phrase ?? '') || '',
            });
        }

        return {
            ...(source || {}),
            names,
        };
    }

    function removeDiffRow(track) {
        const row = document.querySelector(
            `tr.${DIFF_ROW_CLASS}[data-track-id="${CSS.escape(String(track?.elementID || ''))}"]`
        );
        row?.remove();
    }

    function createDiffRow(track, trackRow) {
        const diffRow = document.createElement('tr');
        diffRow.className = DIFF_ROW_CLASS;
        diffRow.dataset.trackId = String(track.elementID || '');

        const reorder = document.createElement('td');
        const position = document.createElement('td');
        const title = document.createElement('td');
        const artist = document.createElement('td');
        const length = document.createElement('td');
        const icon = document.createElement('td');

        title.className = 'mb-tvr-diff-cell mb-tvr-title-cell';
        artist.className = 'mb-tvr-diff-cell mb-tvr-artist-cell';

        diffRow.append(reorder, position, title, artist, length, icon);
        trackRow.insertAdjacentElement('afterend', diffRow);
        return diffRow;
    }

    function valueSpan(text, className, title) {
        const span = document.createElement('span');
        span.className = `mb-tvr-value ${className}`;
        span.textContent = text || '[empty]';
        span.title = title;
        return span;
    }

    function replaceButton(title, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mb-tvr-replace';
        button.textContent = '<';
        button.title = title;
        button.addEventListener('click', onClick);
        return button;
    }

    function renderTitleDiff(track, cell, recording) {
        cell.textContent = '';
        if (!titleDiffers(track)) return false;

        const currentTitle = trackTitle(track);
        const sourceTitle = recordingTitle(recording);
        const wrapper = document.createElement('div');
        wrapper.className = 'mb-tvr-diff';

        const current = valueSpan(
            currentTitle,
            'mb-tvr-track-value',
            'Current tracklist title: ' + (currentTitle || '[empty]')
        );

        const button = replaceButton(
            'Replace tracklist title with recording title',
            () => {
                if (writeTrackTitle(track, sourceTitle, recording)) {
                    appendScriptLinkToEditNote();
                    renderTrack(track);
                }
            }
        );

        const source = valueSpan(
            sourceTitle,
            'mb-tvr-recording-value',
            'Recording title: ' + (sourceTitle || '[empty]')
        );

        wrapper.append(current, button, source);
        cell.appendChild(wrapper);
        return true;
    }

    function renderArtistDiff(track, cell, recording) {
        cell.textContent = '';
        if (!artistDiffers(track)) return false;

        const currentText = artistCreditText(track.artistCredit);
        const sourceText = artistCreditText(recording?.artistCredit);
        const wrapper = document.createElement('div');
        wrapper.className = 'mb-tvr-diff';

        const current = valueSpan(
            currentText,
            'mb-tvr-track-value',
            'Current tracklist artist credit: ' + (currentText || '[empty]')
        );

        const button = replaceButton(
            'Replace tracklist artist credit with recording artist credit',
            async () => {
                if (button.disabled) return;
                button.disabled = true;

                try {
                    if (typeof track.artistCredit !== 'function') {
                        throw new Error('Track artist credit is not editable.');
                    }

                    const linkedCredit = await cloneLinkedArtistCredit(recording?.artistCredit);
                    track.artistCredit(linkedCredit);
                    appendScriptLinkToEditNote();
                    renderTrack(track);
                } catch (error) {
                    console.error(`[${SCRIPT_NAME}]`, error);
                    button.disabled = false;
                    button.title = 'Error: ' + error.message;
                }
            }
        );

        const source = valueSpan(
            sourceText,
            'mb-tvr-recording-value',
            'Recording artist credit: ' + (sourceText || '[empty]')
        );

        wrapper.append(current, button, source);
        cell.appendChild(wrapper);
        return true;
    }

    function renderTrack(track) {
        if (!track?.elementID) return;

        const trackRow = document.getElementById(track.elementID);
        if (!trackRow || !trackRow.matches('tr.track')) {
            removeDiffRow(track);
            return;
        }

        const recording = unwrap(track.recording);
        if (!hasExistingRecording(track) || !recording?.gid) {
            removeDiffRow(track);
            return;
        }

        const hasTitleDiff = titleDiffers(track);
        const hasArtistDiff = artistDiffers(track);

        if (!hasTitleDiff && !hasArtistDiff) {
            removeDiffRow(track);
            return;
        }

        let diffRow = document.querySelector(
            `tr.${DIFF_ROW_CLASS}[data-track-id="${CSS.escape(String(track.elementID))}"]`
        );

        if (!diffRow) {
            diffRow = createDiffRow(track, trackRow);
        } else if (diffRow.previousElementSibling !== trackRow) {
            trackRow.insertAdjacentElement('afterend', diffRow);
        }

        const titleCell = diffRow.querySelector('.mb-tvr-title-cell');
        const artistCell = diffRow.querySelector('.mb-tvr-artist-cell');

        renderTitleDiff(track, titleCell, recording);
        renderArtistDiff(track, artistCell, recording);
    }

    function watchObservable(observable, track) {
        if (typeof observable?.subscribe !== 'function') return;
        observable.subscribe(() => {
            queueMicrotask(() => renderTrack(track));
        });
    }

    function watchTrack(track) {
        if (!track || watchedTracks.has(track)) return;
        watchedTracks.add(track);

        watchObservable(track.name, track);
        watchObservable(track.artistCredit, track);
        watchObservable(track.recording, track);

        renderTrack(track);
    }

    function releaseTracks() {
        const release = editor()?.rootField?.release?.();
        if (!release) return [];

        const tracks = [];
        for (const medium of unwrap(release.mediums) || []) {
            for (const track of unwrap(medium.tracks) || []) {
                tracks.push(track);
            }
        }
        return tracks;
    }

    function removeOrphanRows(liveTrackIds) {
        for (const row of document.querySelectorAll(`tr.${DIFF_ROW_CLASS}`)) {
            if (!liveTrackIds.has(row.dataset.trackId || '')) {
                row.remove();
            }
        }
    }

    function scan() {
        const tracks = releaseTracks();
        const liveTrackIds = new Set();

        for (const track of tracks) {
            if (track?.elementID) liveTrackIds.add(String(track.elementID));
            watchTrack(track);
            renderTrack(track);
        }

        removeOrphanRows(liveTrackIds);
    }

    function start() {
        installStyle();
        scan();

        if (!scanTimer) {
            scanTimer = window.setInterval(scan, 800);
        }

        const tracklist = document.getElementById('tracklist');
        if (tracklist) {
            const observer = new MutationObserver(() => scan());
            observer.observe(tracklist, {childList: true, subtree: true});
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, {once: true});
    } else {
        start();
    }
})();
