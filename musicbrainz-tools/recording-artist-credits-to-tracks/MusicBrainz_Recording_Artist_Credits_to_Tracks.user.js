// ==UserScript==
// @name         MusicBrainz - Recording Artist Credits to Tracks
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Copies recording artist credits to the corresponding track artist credits in the MusicBrainz release editor.
// @author       karpuzikov
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/recording-artist-credits-to-tracks/MusicBrainz_Recording_Artist_Credits_to_Tracks.user.js
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/recording-artist-credits-to-tracks/MusicBrainz_Recording_Artist_Credits_to_Tracks.user.js
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

    const SCRIPT_NAME = 'MusicBrainz - Recording Artist Credits to Tracks';
    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/recording-artist-credits-to-tracks/MusicBrainz_Recording_Artist_Credits_to_Tracks.user.js';
    const BUTTON_ID = 'mb-recording-ac-to-tracks-button';
    const STATUS_ID = 'mb-recording-ac-to-tracks-status';

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

    function cloneArtistCredit(artistCredit) {
        const source = unwrap(artistCredit);
        return {
            ...(source || {}),
            names: (source?.names || []).map(credit => ({
                ...credit,
                artist: unwrap(credit.artist),
                name: unwrap(credit.name),
                joinPhrase: unwrap(credit.joinPhrase ?? credit.join_phrase ?? ''),
            })),
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

    async function copyRecordingArtistCredits() {
        const button = document.getElementById(BUTTON_ID);
        const ed = editor();
        const release = ed?.rootField?.release?.();

        if (!release) {
            setStatus('MusicBrainz release editor is not ready.', 'bad');
            return;
        }

        button.disabled = true;
        setStatus('Loading recordings...');

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

                    track.artistCredit(cloneArtistCredit(sourceCredit));
                    changed++;
                }
            }

            if (changed) {
                appendEditNote(ed);
            }

            const parts = [];
            if (changed) parts.push(`${changed} copied`);
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
            button.disabled = false;
        }
    }

    function insertButton() {
        if (document.getElementById(BUTTON_ID)) return true;

        const nativeOption = document.getElementById('update-all-recording-artists');
        if (!nativeOption) return false;

        const paragraph = nativeOption.closest('p');
        const fieldset = nativeOption.closest('fieldset');
        if (!fieldset) return false;

        const wrapper = document.createElement('p');
        wrapper.id = 'mb-recording-ac-to-tracks-wrapper';

        const button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = 'Copy recording artist credits to tracks';
        button.addEventListener('click', copyRecordingArtistCredits);

        const status = document.createElement('span');
        status.id = STATUS_ID;
        status.style.marginLeft = '10px';

        wrapper.append(button, status);

        if (paragraph?.nextSibling) {
            fieldset.insertBefore(wrapper, paragraph.nextSibling);
        } else {
            fieldset.appendChild(wrapper);
        }

        const style = document.createElement('style');
        style.textContent = `
            #${STATUS_ID}[data-kind="ok"] { color: #087a28; }
            #${STATUS_ID}[data-kind="bad"] { color: #b00020; }
        `;
        document.head.appendChild(style);

        return true;
    }

    if (!insertButton()) {
        const observer = new MutationObserver(() => {
            if (insertButton()) observer.disconnect();
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
})();
