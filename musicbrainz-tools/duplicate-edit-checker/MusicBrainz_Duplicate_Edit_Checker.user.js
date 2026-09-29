// ==UserScript==
// @name         MusicBrainz - Duplicate Edit Checker
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Checks release-editor submissions against open MusicBrainz edits and skips exact pending duplicates in one batch.
// @author       karpuzikov
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/duplicate-edit-checker/MusicBrainz_Duplicate_Edit_Checker.user.js?v=1.0.0
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/duplicate-edit-checker/MusicBrainz_Duplicate_Edit_Checker.user.js?v=1.0.0
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

    const SCRIPT_URL = 'https://github.com/karpuzikov/userscripts/blob/main/musicbrainz-tools/duplicate-edit-checker/MusicBrainz_Duplicate_Edit_Checker.user.js';
    const STATUS_ID = 'mb-duplicate-edit-checker-status';
    const MODAL_ID = 'mb-duplicate-edit-checker-modal';
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const OPEN_STATUS = 1;
    const PREVIEW_WAIT_MS = 5000;
    const EDITOR_WAIT_MS = 20000;
    const MAX_CONCURRENT_DATA_REQUESTS = 6;

    const runtime = {
        active: false,
        checking: false,
        pendingHashes: new Set(),
        seenSubmissionHashes: new Set(),
        skipRepeatedInSubmission: true,
    };

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

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getEditor() {
        return pageWindow().MB?._releaseEditor || null;
    }

    async function waitForEditor() {
        const deadline = Date.now() + EDITOR_WAIT_MS;
        while (Date.now() < deadline) {
            const ed = getEditor();
            if (
                ed &&
                typeof ed.submitEdits === 'function' &&
                typeof ed.allEdits === 'function' &&
                Array.isArray(ed.orderedEditSubmissions)
            ) {
                return ed;
            }
            await sleep(100);
        }
        return null;
    }

    function currentEdits(ed) {
        const edits = unwrap(ed?.allEdits);
        return Array.isArray(edits) ? edits.filter(Boolean) : [];
    }

    function snapshotKey(edits) {
        return edits.map((edit, index) => String(edit?.hash || `no-hash-${index}`)).join('\u0000');
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

    function ensureStatusElement() {
        let status = document.getElementById(STATUS_ID);
        if (status) return status;

        const submit = document.getElementById('enter-edit');
        if (!submit?.parentElement) return null;

        status = document.createElement('span');
        status.id = STATUS_ID;
        status.setAttribute('role', 'status');
        status.style.cssText = [
            'display:none',
            'margin-right:12px',
            'font-weight:600',
            'vertical-align:middle',
        ].join(';');
        submit.parentElement.insertBefore(status, submit);
        return status;
    }

    function setStatus(message, kind = '') {
        const status = ensureStatusElement();
        if (!status) return;

        status.textContent = message || '';
        status.style.display = message ? 'inline-block' : 'none';
        status.style.color = kind === 'error'
            ? '#a40000'
            : kind === 'success'
                ? '#246b2f'
                : '';
    }

    function setSubmitButtonBusy(busy) {
        const button = document.getElementById('enter-edit');
        if (!button) return;
        button.dataset.mbDuplicateCheckerBusy = busy ? '1' : '0';
        button.setAttribute('aria-busy', busy ? 'true' : 'false');
        button.style.cursor = busy ? 'progress' : '';
    }

    function normalizeText(value) {
        return String(value ?? '')
            .normalize('NFKC')
            .replace(/[\u200B-\u200D\uFEFF]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getDirectRows(table) {
        const rows = [];
        for (const child of table?.children || []) {
            const tag = child.tagName?.toUpperCase();
            if (tag === 'TR') {
                rows.push(child);
            } else if (tag === 'TBODY' || tag === 'THEAD' || tag === 'TFOOT') {
                for (const row of child.children || []) {
                    if (row.tagName?.toUpperCase() === 'TR') rows.push(row);
                }
            }
        }
        return rows;
    }

    function rowText(row) {
        const clone = row.cloneNode(true);
        clone.querySelectorAll('script, style, noscript').forEach(node => node.remove());
        return normalizeText(clone.textContent);
    }

    function fingerprintFromRoot(root) {
        const table = root?.matches?.('table.details')
            ? root
            : root?.querySelector?.('table.details');
        if (!table) return null;

        const classKey = [...table.classList].sort().join(' ');
        const rows = getDirectRows(table).map(rowText).filter(Boolean);
        return rows.length ? {classKey, rows} : null;
    }

    function fingerprintFromHtml(html) {
        if (!html) return null;
        const doc = new DOMParser().parseFromString(String(html), 'text/html');
        return fingerprintFromRoot(doc.body);
    }

    function arraysEqual(a, b) {
        return a.length === b.length && a.every((value, index) => value === b[index]);
    }

    function fingerprintsEqual(proposed, open) {
        if (!proposed || !open) return false;
        if (proposed.classKey !== open.classKey) return false;

        if (arraysEqual(proposed.rows, open.rows)) return true;

        // Several MusicBrainz preview components intentionally hide only the
        // entity-context row (usually "Release:") while the open-edit view
        // includes it. Allow exactly that one leading-row difference, but no
        // other superset/subset matching.
        return (
            open.rows.length === proposed.rows.length + 1 &&
            arraysEqual(proposed.rows, open.rows.slice(1))
        );
    }

    function existingPreviewMap(ed) {
        const map = new Map();
        const previews = unwrap(ed?.editPreviews);
        if (!Array.isArray(previews)) return map;

        for (const preview of previews) {
            if (preview?.editHash) map.set(String(preview.editHash), preview);
        }
        return map;
    }

    function stripHash(edit) {
        const copy = {...edit};
        delete copy.hash;
        return copy;
    }

    async function requestMissingPreviews(edits) {
        if (!edits.length) return [];

        const response = await pageWindow().fetch('/ws/js/edit/preview', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({
                edits: edits.map(stripHash),
                makeVotable: false,
            }),
        });

        if (!response.ok) {
            throw new Error(`MusicBrainz preview request failed: HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!Array.isArray(data?.previews) || data.previews.length !== edits.length) {
            throw new Error('MusicBrainz returned an incomplete edit preview response.');
        }
        return data.previews;
    }

    async function ensurePreviews(ed, edits) {
        const deadline = Date.now() + PREVIEW_WAIT_MS;
        while (Date.now() < deadline && unwrap(ed?.loadingEditPreviews)) {
            setStatus('Waiting for MusicBrainz edit previews...');
            await sleep(100);
        }

        const map = existingPreviewMap(ed);
        const missing = edits.filter(edit => !map.has(String(edit.hash || '')));

        if (missing.length) {
            setStatus(`Building ${missing.length} missing edit preview${missing.length === 1 ? '' : 's'}...`);
            const previews = await requestMissingPreviews(missing);
            previews.forEach((preview, index) => {
                map.set(String(missing[index].hash || ''), {
                    ...preview,
                    editHash: missing[index].hash,
                });
            });
        }

        return map;
    }

    function getReleaseInfo(ed) {
        const release = unwrap(ed?.rootField?.release) || null;
        const releaseGid = normalizeText(unwrap(release?.gid));
        const releaseGroup = unwrap(release?.releaseGroup) || null;
        const releaseGroupGid = normalizeText(unwrap(releaseGroup?.gid));
        return {release, releaseGid, releaseGroupGid};
    }

    function scopeForEdit(edit, releaseInfo) {
        const enteredFrom = edit?.enteredFrom || edit?.entered_from || null;
        const enteredFromType = String(enteredFrom?.entity_type || enteredFrom?.entityType || '');
        const toEdit = normalizeText(edit?.to_edit);
        const gid = normalizeText(edit?.gid);

        if (enteredFromType === 'release' && UUID.test(toEdit)) {
            return `recording/${toEdit}`;
        }

        if (enteredFromType === 'release' && UUID.test(gid)) {
            return `release-group/${gid}`;
        }

        if (UUID.test(releaseInfo.releaseGid)) {
            return `release/${releaseInfo.releaseGid}`;
        }

        // A brand-new release has no entity page and therefore cannot already
        // have release-level open edits. Recording / release-group edits above
        // are still checked because those entities already exist.
