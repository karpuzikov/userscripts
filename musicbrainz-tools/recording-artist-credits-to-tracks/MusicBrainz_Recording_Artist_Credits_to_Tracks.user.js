// ==UserScript==
// @name         MusicBrainz - Recording Data to Tracks
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.1.1
// @description  Copies linked recording titles and artist credits to the corresponding tracks in the MusicBrainz release editor.
// @author       karpuzikov
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/recording-artist-credits-to-tracks/MusicBrainz_Recording_Artist_Credits_to_Tracks.user.js?v=1.1.1
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/recording-artist-credits-to-tracks/MusicBrainz_Recording_Artist_Credits_to_Tracks.user.js?v=1.1.1
// @supportURL   https://github.com/karpuzikov/userscripts
// @match        https://musicbrainz.org/release/add*
// @match        https://musicbrainz.org/release/*/edit*
// @match        https://beta.musicbrainz.org/release/add*
// @match        https://beta.musicbrainz.org/release/*/edit*
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(() => {
    'use strict';

    const SCRIPT_NAME = 'MusicBrainz - Recording Data to Tracks';
    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/recording-artist-credits-to-tracks/MusicBrainz_Recording_Artist_Credits_to_Tracks.user.js';
    const WRAPPER_ID = 'mb-recording-data-to-tracks';
    const TITLE_BUTTON_ID = 'mb-recording-title-to-tracks-button';
    const ARTIST_BUTTON_ID = 'mb-recording-ac-to-tracks-button';
    const STATUS_ID = 'mb-recording-data-to-tracks-status';

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    function pageWindow() {
        try {
            return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        } catch {
            return window;
        }
    }

    function unwrap(value) {
        return typeof value === 'function' ? value() : value;
    }

    function editor() {
        return pageWindow().MB?._releaseEditor || null;
    }

    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const artistEntityCache = new Map();

    function artistMbid(artist) {
        const entity = unwrap(artist) || {};
        const gid = String(unwrap(entity.gid) || '').trim();
        if (UUID.test(gid)) return gid.toLowerCase();

        const id = String(unwrap(entity.id) || '').trim();
        return UUID.test(id) ? id.toLowerCase() : '';
    }

    function hasLinkedArtistId(artist) {
        const entity = unwrap(artist) || {};
        const id = unwrap(entity.id);
        return Number.isInteger(id) ? id > 0 : /^\d+$/.test(String(id || '')) && Number(id) > 0;
    }

    async function resolveArtistEntity(artist) {
        const source = unwrap(artist) || {};
        if (hasLinkedArtistId(source)) return source;

        const gid = artistMbid(source);
        if (!gid) return null;

        const mb = pageWindow().MB;
        const cachedMbEntity = mb?.entityCache?.[gid];
        if (cachedMbEntity && hasLinkedArtistId(cachedMbEntity)) {
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
            if (!entity || entity.entityType !== 'artist' || !hasLinkedArtistId(entity)) {
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
        const names = [];

        for (const credit of source?.names || []) {
            const artist = await resolveArtistEntity(credit.artist);
            if (!artist) {
                throw new Error(
                    'Could not resolve MusicBrainz artist for credit "' +
                    String(unwrap(credit.name) || '').trim() + '"'
                );
            }

            names.push({
                ...credit,
                artist,
                name: unwrap(credit.name) || unwrap(artist.name) || '',
                joinPhrase: unwrap(credit.joinPhrase ?? credit.join_phrase ?? '') || '',
            });
        }

        return {
            ...(source || {}),
            names,
        };
    }

    function artistCreditSignature(artistCredit) {
        const source = unwrap(artistCredit);
        return JSON.stringify((source?.names || []).map(credit => {
            const artist = unwrap(credit.artist) || {};
            return {
                artistId: unwrap(artist.id) ?? null,
                artistGid: unwrap(artist.gid) || '',
                artistName: unwrap(artist.name) || '',
                creditedName: unwrap(credit.name) || '',
                joinPhrase: unwrap(credit.joinPhrase ?? credit.join_phrase ?? '') || '',
            };
        }));
    }

    function hasCompleteRecordingArtistCredit(track, recording) {
        const artistCredit = recording?.artistCredit;
        if (!artistCredit) return false;

        try {
            if (typeof track.isCompleteArtistCredit === 'function') {
                return Boolean(track.isCompleteArtistCredit(artistCredit));
            }
        } catch {
            // Fall through to a conservative structural check.
        }

        const names = unwrap(artistCredit)?.names || [];
        return names.length > 0 && names.every(credit => {
            const artist = unwrap(credit.artist);
            return Boolean(artist && (unwrap(artist.gid) || unwrap(artist.id)));
        });
    }

    async function ensureMediumLoaded(medium) {
        if (unwrap(medium.loaded)) return true;

        if (!unwrap(medium.loading) && typeof medium.loadTracks === 'function') {
            medium.loadTracks();
        }

        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            if (unwrap(medium.loaded)) return true;
            await sleep(200);
        }
        return false;
    }

    function appendEditNote(ed) {
        const editNote = ed?.rootField?.editNote;
        if (typeof editNote !== 'function') return;

        const current = String(editNote() || '');
        if (current.includes(SCRIPT_URL)) return;

        editNote(current
            ? `${current.replace(/\s+$/, '')}\n\nScript: ${SCRIPT_URL}`
            : `Script: ${SCRIPT_URL}`);
    }

    function setStatus(message, kind = '') {
        const status = document.getElementById(STATUS_ID);
        if (!status) return;
        status.textContent = message;
        status.dataset.kind = kind;
    }

    function setButtonsDisabled(disabled) {
        const titleButton = document.getElementById(TITLE_BUTTON_ID);
        const artistButton = document.getElementById(ARTIST_BUTTON_ID);
        if (titleButton) titleButton.disabled = disabled;
        if (artistButton) artistButton.disabled = disabled;
    }

    function recordingTitle(recording) {
        return String(unwrap(recording?.name) || '').trim();
    }

    function trackTitle(track) {
        return String(unwrap(track?.name) || '').trim();
    }

    function writeTrackTitle(track, title, recording) {
        if (!title || typeof track?.name !== 'function') return false;

        /*
         * MusicBrainz watches track-title changes and can unlink a recording
         * when the new title differs from the title saved at association time.
         * The new value here comes from that exact linked recording, so update
         * the saved comparison value first to preserve the association.
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

    async function copyRecordingTitles() {
        const ed = editor();
        const release = ed?.rootField?.release?.();

        if (!release) {
            setStatus('MusicBrainz release editor is not ready.', 'bad');
            return;
        }

        setButtonsDisabled(true);
        setStatus('Loading linked recordings...');

        try {
            const mediums = unwrap(release.mediums) || [];
            let changed = 0;
            let unchanged = 0;
            let skipped = 0;
            let loadFailures = 0;

            for (const medium of mediums) {
                if (!(await ensureMediumLoaded(medium))) {
                    loadFailures++;
                    continue;
                }

                const tracks = unwrap(medium.tracks) || [];
                for (const track of tracks) {
                    const recording = unwrap(track.recording);
                    const sourceTitle = recordingTitle(recording);

                    if (!recording?.gid || !sourceTitle) {
                        skipped++;
                        continue;
                    }

                    if (trackTitle(track) === sourceTitle) {
                        unchanged++;
                        continue;
                    }

                    if (writeTrackTitle(track, sourceTitle, recording)) {
                        changed++;
                    } else {
                        skipped++;
                    }
                }
            }

            if (changed) appendEditNote(ed);

            const parts = [];
            if (changed) parts.push(`${changed} title(s) copied`);
            if (unchanged) parts.push(`${unchanged} already identical`);
            if (skipped) parts.push(`${skipped} skipped`);
            if (loadFailures) parts.push(`${loadFailures} medium(s) failed to load`);

            setStatus(
                parts.length ? parts.join(' | ') : 'No tracks found.',
                changed ? 'ok' : (loadFailures ? 'bad' : '')
            );
        } catch (error) {
            console.error(`[${SCRIPT_NAME}]`, error);
            setStatus(`Error: ${error.message}`, 'bad');
        } finally {
            setButtonsDisabled(false);
        }
    }

    async function copyRecordingArtistCredits() {
        const ed = editor();
        const release = ed?.rootField?.release?.();

        if (!release) {
            setStatus('MusicBrainz release editor is not ready.', 'bad');
            return;
        }

        setButtonsDisabled(true);
        setStatus('Loading linked recordings...');

        try {
            const mediums = unwrap(release.mediums) || [];
            let changed = 0;
            let unchanged = 0;
            let skipped = 0;
            let loadFailures = 0;

            for (const medium of mediums) {
                if (!(await ensureMediumLoaded(medium))) {
                    loadFailures++;
                    continue;
                }

                const tracks = unwrap(medium.tracks) || [];
                for (const track of tracks) {
                    const recording = unwrap(track.recording);

                    if (!recording?.gid || !hasCompleteRecordingArtistCredit(track, recording)) {
                        skipped++;
                        continue;
                    }

                    const sourceCredit = recording.artistCredit;
                    const before = artistCreditSignature(track.artistCredit);
                    const after = artistCreditSignature(sourceCredit);

                    if (before === after) {
                        unchanged++;
                        continue;
                    }

                    const linkedCredit = await cloneLinkedArtistCredit(sourceCredit);
                    track.artistCredit(linkedCredit);
                    changed++;
                }
            }

            if (changed) appendEditNote(ed);

            const parts = [];
            if (changed) parts.push(`${changed} artist credit(s) copied`);
            if (unchanged) parts.push(`${unchanged} already identical`);
            if (skipped) parts.push(`${skipped} skipped`);
            if (loadFailures) parts.push(`${loadFailures} medium(s) failed to load`);

            setStatus(
                parts.length ? parts.join(' | ') : 'No tracks found.',
                changed ? 'ok' : (loadFailures ? 'bad' : '')
            );
        } catch (error) {
            console.error(`[${SCRIPT_NAME}]`, error);
            setStatus(`Error: ${error.message}`, 'bad');
        } finally {
            setButtonsDisabled(false);
        }
    }

    function insertButtons() {
        if (document.getElementById(WRAPPER_ID)) return true;

        const tracklist = document.getElementById('tracklist');
        if (!tracklist) return false;

        const wrapper = document.createElement('div');
        wrapper.id = WRAPPER_ID;
        wrapper.style.cssText = [
            'display:flex',
            'align-items:center',
            'gap:8px',
            'flex-wrap:wrap',
            'margin:0 0 12px 0',
            'padding:10px',
            'border:1px solid #bbb',
            'border-radius:4px',
        ].join(';');

        const titleButton = document.createElement('button');
        titleButton.id = TITLE_BUTTON_ID;
        titleButton.type = 'button';
        titleButton.textContent = 'Copy recording titles to tracks';
        titleButton.title = 'Replace track titles with the titles of their linked MusicBrainz recordings';
        titleButton.addEventListener('click', copyRecordingTitles);

        const artistButton = document.createElement('button');
        artistButton.id = ARTIST_BUTTON_ID;
        artistButton.type = 'button';
        artistButton.textContent = 'Copy recording artist credits to tracks';
        artistButton.title = 'Replace track artist credits with the exact artist credits of their linked MusicBrainz recordings';
        artistButton.addEventListener('click', copyRecordingArtistCredits);

        const status = document.createElement('span');
        status.id = STATUS_ID;
        status.style.marginLeft = '2px';

        wrapper.append(titleButton, artistButton, status);
        tracklist.insertBefore(wrapper, tracklist.firstChild);

        const style = document.createElement('style');
        style.textContent = `
            #${STATUS_ID}[data-kind="ok"] { color: #087a28; }
            #${STATUS_ID}[data-kind="bad"] { color: #b00020; }
        `;
        document.head.appendChild(style);

        return true;
    }

    if (!insertButtons()) {
        const observer = new MutationObserver(() => {
            if (insertButtons()) observer.disconnect();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
})();
