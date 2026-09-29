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
        return null;
    }

    function buildProposals(edits, previewMap, releaseInfo) {
        return edits.map((edit, index) => {
            const preview = previewMap.get(String(edit.hash || '')) || null;
            const fingerprint = fingerprintFromHtml(preview?.preview);
            if (!fingerprint) {
                throw new Error(`Could not read MusicBrainz preview for edit ${index + 1}.`);
            }
            return {
                index,
                edit,
                hash: String(edit.hash || ''),
                editType: Number(edit.edit_type),
                editName: normalizeText(preview?.editName) || `Edit ${index + 1}`,
                fingerprint,
                scope: scopeForEdit(edit, releaseInfo),
            };
        });
    }

    function parsePageNumber(url, expectedPath) {
        try {
            const parsed = new URL(url, location.href);
            if (parsed.pathname !== expectedPath) return null;
            const page = Number(parsed.searchParams.get('page'));
            return Number.isInteger(page) && page > 0 ? page : null;
        } catch {
            return null;
        }
    }

    async function fetchDocument(url) {
        const response = await pageWindow().fetch(url, {
            credentials: 'same-origin',
            headers: {Accept: 'text/html'},
        });
        if (!response.ok) {
            throw new Error(`Could not load ${url}: HTTP ${response.status}`);
        }
        const html = await response.text();
        return new DOMParser().parseFromString(html, 'text/html');
    }

    function extractOpenEditBlocks(doc) {
        const result = [];
        for (const block of doc.querySelectorAll('.edit-list')) {
            const idInput = block.querySelector('input[type="hidden"][name$=".edit_id"]');
            const id = Number(idInput?.value);
            const details = block.querySelector('.edit-details');
            const fingerprint = fingerprintFromRoot(details);
            if (Number.isInteger(id) && id > 0 && fingerprint) {
                result.push({id, fingerprint});
            }
        }
        return result;
    }

    async function fetchOpenEditBlocks(scope, progress) {
        const baseUrl = new URL(`/${scope}/open_edits`, location.origin);
        const firstDoc = await fetchDocument(baseUrl.href);
        progress.pagesDone += 1;
        setStatus(`Checking open edits... ${progress.pagesDone} page${progress.pagesDone === 1 ? '' : 's'} loaded`);

        let maxPage = 1;
        for (const link of firstDoc.querySelectorAll('a[href]')) {
            const page = parsePageNumber(link.getAttribute('href'), baseUrl.pathname);
            if (page) maxPage = Math.max(maxPage, page);
        }

        const blocks = extractOpenEditBlocks(firstDoc);
        for (let page = 2; page <= maxPage; page += 1) {
            const pageUrl = new URL(baseUrl.href);
            pageUrl.searchParams.set('page', String(page));
            const doc = await fetchDocument(pageUrl.href);
            blocks.push(...extractOpenEditBlocks(doc));
            progress.pagesDone += 1;
            setStatus(`Checking open edits... ${progress.pagesDone} pages loaded`);
        }
        return blocks;
    }

    async function mapLimit(items, limit, worker) {
        const results = new Array(items.length);
        let cursor = 0;

        async function run() {
            while (true) {
                const index = cursor;
                cursor += 1;
                if (index >= items.length) return;
                results[index] = await worker(items[index], index);
            }
        }

        const count = Math.min(Math.max(1, limit), Math.max(1, items.length));
        await Promise.all(Array.from({length: count}, run));
        return results;
    }

    async function fetchEditData(id) {
        const response = await pageWindow().fetch(`/edit/${id}/data`, {
            credentials: 'same-origin',
            headers: {Accept: 'application/json'},
        });
        if (!response.ok) {
            throw new Error(`Could not inspect MusicBrainz edit #${id}: HTTP ${response.status}`);
        }
        return response.json();
    }

    function groupByScope(proposals) {
        const groups = new Map();
        for (const proposal of proposals) {
            if (!proposal.scope) continue;
            if (!groups.has(proposal.scope)) groups.set(proposal.scope, []);
            groups.get(proposal.scope).push(proposal);
        }
        return groups;
    }

    function buildInSubmissionDuplicateInfo(proposals, pendingHashes) {
        const seen = new Set();
        const repeated = [];
        for (const proposal of proposals) {
            if (pendingHashes.has(proposal.hash)) continue;
            if (proposal.hash && seen.has(proposal.hash)) {
                repeated.push(proposal);
            } else if (proposal.hash) {
                seen.add(proposal.hash);
            }
        }
        return repeated;
    }

    async function analyzeDuplicates(ed, edits) {
        setStatus(`Preparing duplicate check for ${edits.length} edit${edits.length === 1 ? '' : 's'}...`);
        const previewMap = await ensurePreviews(ed, edits);
        const proposals = buildProposals(edits, previewMap, getReleaseInfo(ed));
        const groups = groupByScope(proposals);
        const pendingHashes = new Set();
        const matchesByHash = new Map();
        const progress = {pagesDone: 0};

        let groupIndex = 0;
        for (const [scope, scopedProposals] of groups) {
            groupIndex += 1;
            setStatus(`Checking pending edits... entity ${groupIndex}/${groups.size}`);
            const blocks = await fetchOpenEditBlocks(scope, progress);

            const candidatePairs = [];
            for (const block of blocks) {
                for (const proposal of scopedProposals) {
                    if (fingerprintsEqual(proposal.fingerprint, block.fingerprint)) {
                        candidatePairs.push({block, proposal});
                    }
                }
            }

            if (!candidatePairs.length) continue;

            const uniqueIds = [...new Set(candidatePairs.map(pair => pair.block.id))];
            setStatus(`Verifying ${uniqueIds.length} possible duplicate${uniqueIds.length === 1 ? '' : 's'}...`);
            const dataList = await mapLimit(
                uniqueIds,
                MAX_CONCURRENT_DATA_REQUESTS,
                id => fetchEditData(id),
            );
            const dataById = new Map(uniqueIds.map((id, index) => [id, dataList[index]]));

            for (const {block, proposal} of candidatePairs) {
                const data = dataById.get(block.id);
                if (
                    Number(data?.status) === OPEN_STATUS &&
                    Number(data?.type) === proposal.editType
                ) {
                    pendingHashes.add(proposal.hash);
                    if (!matchesByHash.has(proposal.hash)) matchesByHash.set(proposal.hash, new Set());
                    matchesByHash.get(proposal.hash).add(block.id);
                }
            }
        }

        const repeated = buildInSubmissionDuplicateInfo(proposals, pendingHashes);
        const repeatedIndexes = new Set(repeated.map(proposal => proposal.index));
        const pendingCount = proposals.filter(proposal => pendingHashes.has(proposal.hash)).length;
        const repeatedCount = repeated.length;
        const newCount = proposals.length - pendingCount - repeatedCount;

        return {
            proposals,
            pendingHashes,
            matchesByHash,
            repeatedIndexes,
            pendingCount,
            repeatedCount,
            newCount,
            total: proposals.length,
        };
    }

    function addModalStyles() {
        if (document.getElementById('mb-duplicate-edit-checker-style')) return;
        const style = document.createElement('style');
        style.id = 'mb-duplicate-edit-checker-style';
        style.textContent = `
#${MODAL_ID} {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, .55);
}
#${MODAL_ID} .mb-dec-dialog {
  width: min(760px, calc(100vw - 48px));
  max-height: calc(100vh - 48px);
  overflow: auto;
  box-sizing: border-box;
  padding: 20px;
  border: 1px solid #aaa;
  border-radius: 6px;
  background: Canvas;
  color: CanvasText;
  box-shadow: 0 12px 40px rgba(0, 0, 0, .35);
}
#${MODAL_ID} h2 { margin: 0 0 14px; }
#${MODAL_ID} .mb-dec-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(110px, 1fr));
  gap: 8px;
  margin: 12px 0 16px;
}
#${MODAL_ID} .mb-dec-stat {
  padding: 10px;
  border: 1px solid #bbb;
  border-radius: 4px;
  text-align: center;
}
#${MODAL_ID} .mb-dec-stat strong { display: block; font-size: 1.35em; }
#${MODAL_ID} details { margin: 12px 0; }
#${MODAL_ID} .mb-dec-list { max-height: 260px; overflow: auto; margin: 8px 0 0 20px; }
#${MODAL_ID} .mb-dec-buttons { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 18px; }
#${MODAL_ID} .mb-dec-buttons button { margin: 0; }
#${MODAL_ID} .mb-dec-error { color: #a40000; white-space: pre-wrap; }
@media (max-width: 650px) {
  #${MODAL_ID} .mb-dec-summary { grid-template-columns: repeat(2, 1fr); }
}
`;
        document.head.appendChild(style);
    }

    function closeModal() {
        document.getElementById(MODAL_ID)?.remove();
    }

    function makeButton(label, className, value, resolve) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        if (className) button.className = className;
        button.addEventListener('click', () => {
            closeModal();
            resolve(value);
        });
        return button;
    }

    function openEditLink(id) {
        const link = document.createElement('a');
        link.href = `/edit/${id}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `Edit #${id}`;
        return link;
    }

    function showDuplicateDialog(result) {
        addModalStyles();
        closeModal();

        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.id = MODAL_ID;
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');

            const dialog = document.createElement('div');
            dialog.className = 'mb-dec-dialog';
            overlay.appendChild(dialog);

            const heading = document.createElement('h2');
            heading.textContent = result.newCount
                ? 'Duplicate pending edits found'
                : 'All proposed edits are duplicates';
            dialog.appendChild(heading);

            const intro = document.createElement('p');
            intro.textContent = result.newCount
                ? 'Exact duplicates will be skipped as one batch. No existing MusicBrainz edits are cancelled or changed.'
                : 'Nothing new needs to be submitted. No existing MusicBrainz edits are cancelled or changed.';
            dialog.appendChild(intro);

            const summary = document.createElement('div');
            summary.className = 'mb-dec-summary';
            const stats = [
                ['Proposed', result.total],
                ['Already pending', result.pendingCount],
                ['Repeated here', result.repeatedCount],
                ['New', result.newCount],
            ];
            for (const [label, value] of stats) {
                const stat = document.createElement('div');
                stat.className = 'mb-dec-stat';
                const strong = document.createElement('strong');
                strong.textContent = String(value);
                stat.append(strong, document.createTextNode(label));
                summary.appendChild(stat);
            }
            dialog.appendChild(summary);

            if (result.pendingCount) {
                const details = document.createElement('details');
                const summaryNode = document.createElement('summary');
                summaryNode.textContent = `Show pending duplicates (${result.pendingCount})`;
                details.appendChild(summaryNode);

                const list = document.createElement('ol');
                list.className = 'mb-dec-list';
                const shown = new Set();
                for (const proposal of result.proposals) {
                    if (!result.pendingHashes.has(proposal.hash) || shown.has(proposal.hash)) continue;
                    shown.add(proposal.hash);

                    const item = document.createElement('li');
                    item.append(document.createTextNode(`${proposal.editName} - `));
                    const ids = [...(result.matchesByHash.get(proposal.hash) || [])];
                    ids.forEach((id, index) => {
                        if (index) item.append(document.createTextNode(', '));
                        item.appendChild(openEditLink(id));
                    });
                    list.appendChild(item);
                }
                details.appendChild(list);
                dialog.appendChild(details);
            }

            if (result.repeatedCount) {
                const note = document.createElement('p');
                note.textContent = `${result.repeatedCount} duplicate edit${result.repeatedCount === 1 ? '' : 's'} also appear more than once in this same submission; only the first copy will be kept.`;
                dialog.appendChild(note);
            }

            const buttons = document.createElement('div');
            buttons.className = 'mb-dec-buttons';

            if (result.newCount > 0) {
                buttons.appendChild(makeButton(
                    `Submit ${result.newCount} new edit${result.newCount === 1 ? '' : 's'}`,
                    'positive',
                    'submit-new',
                    resolve,
                ));
            } else {
                buttons.appendChild(makeButton('Close', 'positive', 'cancel', resolve));
            }

            buttons.appendChild(makeButton(
                `Submit all ${result.total} anyway`,
                '',
                'submit-all',
                resolve,
            ));
            buttons.appendChild(makeButton('Cancel', 'negative', 'cancel', resolve));
            dialog.appendChild(buttons);

            document.body.appendChild(overlay);
            dialog.querySelector('button')?.focus();
        });
    }

    function showErrorDialog(error) {
        addModalStyles();
        closeModal();

        return new Promise(resolve => {
            const overlay = document.createElement('div');
            overlay.id = MODAL_ID;
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');

            const dialog = document.createElement('div');
            dialog.className = 'mb-dec-dialog';
            overlay.appendChild(dialog);

            const heading = document.createElement('h2');
            heading.textContent = 'Duplicate check failed';
            dialog.appendChild(heading);

            const message = document.createElement('p');
            message.className = 'mb-dec-error';
            message.textContent = String(error?.message || error || 'Unknown error');
            dialog.appendChild(message);

            const explanation = document.createElement('p');
            explanation.textContent = 'No edits have been submitted. Retry the check, submit everything without filtering, or cancel.';
            dialog.appendChild(explanation);

            const buttons = document.createElement('div');
            buttons.className = 'mb-dec-buttons';
            buttons.appendChild(makeButton('Retry duplicate check', 'positive', 'retry', resolve));
            buttons.appendChild(makeButton('Submit all anyway', '', 'submit-all', resolve));
            buttons.appendChild(makeButton('Cancel', 'negative', 'cancel', resolve));
            dialog.appendChild(buttons);

            document.body.appendChild(overlay);
            dialog.querySelector('button')?.focus();
        });
    }

    function installSubmissionFilters(ed) {
        if (ed.__mbDuplicateEditCheckerFiltersInstalled) return;

        for (const submission of ed.orderedEditSubmissions) {
            if (!submission || typeof submission.edits !== 'function') continue;
            const original = submission.edits;
            submission.edits = function (...args) {
                const edits = original.apply(this, args);
                if (!runtime.active || !Array.isArray(edits)) return edits;

                return edits.filter(edit => {
                    const hash = String(edit?.hash || '');
                    if (!hash) return true;
                    if (runtime.pendingHashes.has(hash)) return false;
                    if (runtime.skipRepeatedInSubmission && runtime.seenSubmissionHashes.has(hash)) return false;
                    runtime.seenSubmissionHashes.add(hash);
                    return true;
                });
            };
        }

        ed.__mbDuplicateEditCheckerFiltersInstalled = true;
    }

    function prepareFilteredSubmission(result) {
        runtime.pendingHashes = new Set(result.pendingHashes);
        runtime.seenSubmissionHashes = new Set();
