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
