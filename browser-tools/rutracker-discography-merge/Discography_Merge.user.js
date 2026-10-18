// ==UserScript==
// @name         Discography Merge
// @namespace    https://github.com/karpuzikov/userscripts
// @version      0.1.1
// @description  Insert only missing BBCode releases into a forum post without modifying existing releases.
// @match        https://rutracker.org/forum/posting.php*
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/rutracker-discography-merge/Discography_Merge.user.js
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/rutracker-discography-merge/Discography_Merge.user.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      fastpic.org
// @connect      www.fastpic.org
// ==/UserScript==

(() => {
    'use strict';

    const EXAMPLE_SESSIONS = [
        'https://fastpic.org/session/2026/1018/WvkKAKaush.html',
        'https://fastpic.org/session/2026/1018/pd2tFCJvyB.html'
    ].join('\n');
    const PLACEHOLDER = '[img=right]ссылка[/img]';
    const TOP_SPOILER_RE = /\[spoiler(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]|\[\/spoiler\]/gi;
    const DIRECT_IMAGE_RE = /https?:\/\/i\d+\.fastpic\.org\/big\/\d{4}\/\d{4}\/[a-f\d]{2}\/[a-f\d]{32}\.(?:png|jpe?g|webp)/gi;

    function parseTopLevelSpoilers(source) {
        const entries = [];
        const expression = new RegExp(TOP_SPOILER_RE.source, 'gi');
        let match, depth = 0, begin = -1, title = '';
        while ((match = expression.exec(source)) !== null) {
            if (match[0].toLowerCase().startsWith('[/spoiler')) {
                if (depth < 1) throw new Error('Invalid BBCode: unexpected [/spoiler].');
                if (--depth === 0) {
                    entries.push({ start: begin, end: expression.lastIndex, title,
                        body: source.slice(begin, expression.lastIndex) });
                }
            } else {
                if (depth === 0) {
                    begin = match.index;
                    title = match[1] ?? match[2] ?? match[3] ?? '';
                }
                depth++;
            }
        }
        if (depth !== 0) throw new Error('Invalid BBCode: an [spoiler] block is not closed.');
        return entries;
    }

    function identity(block) {
        const date = block.title.match(/^(\d{4}-\d{2}-\d{2})\s+-\s+/);
        const ids = [...block.title.matchAll(/\[([^\]]+)\]/g)];
        // A standalone CD or Screenshots spoiler is not a complete, dated release.
        return date && ids.length ? { date: date[1], id: ids[ids.length - 1][1].trim() } : null;
    }

    function directImageUrls(raw) {
        return [...new Set(raw.match(DIRECT_IMAGE_RE) || [])];
    }

    function imageHash(url) {
        return url.match(/([a-f\d]{32})\.(?:png|jpe?g|webp)(?:\.html)?(?:[?#]|$)/i)?.[1]?.toLowerCase() || null;
    }

    function parseFastpicHtml(html) {
        const dom = new DOMParser().parseFromString(html, 'text/html');
        const options = [...dom.querySelectorAll('textarea')].map(node => directImageUrls(node.value || node.textContent));
        // Direct links textarea carries filenames in gallery order; other textareas may repeat links.
        const fromDirectArea = options.sort((a, b) => b.length - a.length)[0] || [];
        const direct = fromDirectArea.length ? fromDirectArea : directImageUrls(html);
        const byHash = new Map(direct.map(url => [imageHash(url), url]));
        const covers = new Map();
        for (const titleElement of dom.querySelectorAll('h3')) {
            const filename = titleElement.textContent.trim();
            const catalog = filename.match(/\[([^\]]+)\]\.(?:png|jpe?g|webp)$/i)?.[1]?.trim();
            if (!catalog) continue;
            const group = titleElement.closest('div');
            const anchor = group?.querySelector('a[href*="/view/"]');
            const hash = imageHash(anchor?.getAttribute('href') || '');
            const url = hash ? byHash.get(hash) : null;
            if (!url) continue;
            const previous = covers.get(catalog);
            if (previous && previous !== url) {
                throw new Error(`Multiple different covers for catalog ${catalog}. Resolve the FastPic upload first.`);
            }
            covers.set(catalog, url);
        }
        return covers;
    }

    function mergeDiscography(original, updated, covers) {
        const existing = parseTopLevelSpoilers(original);
        const incoming = parseTopLevelSpoilers(updated);
        if (!existing.length) throw new Error('No release blocks were found in the current post.');
        if (!incoming.length) throw new Error('No [spoiler] blocks were found in the updated post.');

        const originalKeys = new Set(existing.map(identity).filter(Boolean).map(item => item.id));
        const seen = new Set(originalKeys);
        const additions = [];
        const eol = original.includes('\r\n') ? '\r\n' : '\n';
        for (const block of incoming) {
            const key = identity(block);
            if (!key || seen.has(key.id)) continue;
            seen.add(key.id);
            const cover = covers.get(key.id);
            const hasPlaceholder = block.body.includes(PLACEHOLDER);
            // Never alter source links, metadata, title, tracklists, or tags.
            let body = cover && hasPlaceholder
                ? block.body.replace(PLACEHOLDER, `[img=right]${cover}[/img]`)
                : block.body;
            body = body.replace(/\r\n|\r|\n/g, eol);
            additions.push({ ...key, body, title: block.title,
                matched: Boolean(cover && hasPlaceholder), missing: !cover && hasPlaceholder });
        }
        additions.sort((a, b) => a.date.localeCompare(b.date));
        if (!additions.length) return { text: original, added: 0, covers: 0, missing: [] };

        const hasDatedOriginals = existing.filter(block => identity(block));
        if (!hasDatedOriginals.length) throw new Error('No dated releases found in the original post.');
        if (hasDatedOriginals.some((block, i) => i > 0 &&
                identity(hasDatedOriginals[i - 1]).date > identity(block).date)) {
            throw new Error('Original releases are not in chronological order. No changes made.');
        }

        // Append fragments from ORIGINAL verbatim, only adding new blocks at release boundaries.
        // This preserves the entirety of each old release and all pre-existing links.
        const segments = [];
        let offset = 0;
        let inserted = 0;
        for (const block of hasDatedOriginals) {
            segments.push(original.slice(offset, block.start));
            while (inserted < additions.length && additions[inserted].date < identity(block).date) {
                segments.push(additions[inserted].body, eol, eol);
                inserted++;
            }
            segments.push(original.slice(block.start, block.end));
            offset = block.end;
        }
        // Newer releases belong after the last existing release but before any original footer.
        while (inserted < additions.length) {
            segments.push(eol, eol, additions[inserted].body);
            inserted++;
        }
        segments.push(original.slice(offset));
        const merged = segments.join('');
        const resultBlocks = parseTopLevelSpoilers(merged);
        for (const originalBlock of existing) {
            if (!resultBlocks.some(current => current.body === originalBlock.body)) {
                throw new Error(`Safety check failed: original block changed (${originalBlock.title}).`);
            }
        }
        if (resultBlocks.length !== existing.length + additions.length) {
            throw new Error('Safety check failed: release count mismatch.');
        }
        return { text: merged, added: additions.length,
            covers: additions.filter(item => item.matched).length,
            missing: additions.filter(item => item.missing).map(item => item.title) };
    }

    function getSessionUrls(value) {
        const urls = [...new Set(value.split(/[\s,]+/).map(s => s.trim()).filter(Boolean))];
        if (!urls.length) throw new Error('Enter at least one FastPic session URL.');
        for (const url of urls) {
            let parsed;
            try { parsed = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
            if (parsed.protocol !== 'https:' || !['fastpic.org', 'www.fastpic.org'].includes(parsed.hostname) ||
                !/^\/session\/\d{4}\/\d{4}\/[A-Za-z0-9]+\.html$/.test(parsed.pathname)) {
                throw new Error(`Not a FastPic session URL: ${url}`);
            }
        }
        return urls;
    }

    function fetchFastpic(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({ method: 'GET', url, timeout: 30000,
                onload: response => response.status >= 200 && response.status < 300
                    ? resolve(response.responseText)
                    : reject(new Error(`FastPic returned HTTP ${response.status}: ${url}`)),
                ontimeout: () => reject(new Error(`FastPic request timed out: ${url}`)),
                onerror: () => reject(new Error(`Cannot load FastPic session: ${url}`)) });
        });
    }

    function fetchAllCovers(urls) {
        return Promise.all(urls.map(fetchFastpic)).then(pages => {
            const all = new Map();
            pages.forEach((page, index) => {
                const links = parseFastpicHtml(page);
                if (!links.size) throw new Error(`No labeled covers on session page ${index + 1}.`);
                for (const [catalog, url] of links) {
                    const current = all.get(catalog);
                    if (current && current !== url) {
                        throw new Error(`Conflicting covers for catalog ${catalog}.`);
                    }
                    all.set(catalog, url);
                }
            });
            return all;
        });
    }

    if (typeof module === 'object' && module?.exports) {
        Object.assign(module.exports, { parseTopLevelSpoilers, identity, parseFastpicHtml,
            mergeDiscography, getSessionUrls, directImageUrls });
    }

    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    if (new URLSearchParams(window.location.search).get('mode') !== 'editpost') return;

    const EDITOR_SELECTOR = '#post-textarea';
    let initialized = false;
    function findEditor() {
        return [...document.querySelectorAll(EDITOR_SELECTOR)]
            .filter(node => !node.disabled && !node.readOnly && /\[spoiler(?:=|\])/i.test(node.value || ''))
            .sort((a, b) => (b.value || '').length - (a.value || '').length)[0] || null;
    }

    function writeEditor(editor, value) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(editor, value);
        else editor.value = value;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setup(editor) {
        if (initialized) return;
        initialized = true;
        const root = document.createElement('div');
        root.id = 'discography-merge-controls';
        root.innerHTML = `
          <style>
            #discography-merge-controls {font:13px/1.4 system-ui,Arial,sans-serif;color:#eee;background:#202126;border:1px solid #444650;border-radius:7px;margin:8px 0;max-width:680px;box-sizing:border-box}
            #discography-merge-controls * {box-sizing:border-box}
            #discography-merge-controls button {font:inherit;color:#f4f4f5;cursor:pointer;border:1px solid #555862;background:#34363f;border-radius:5px;padding:7px 12px;min-height:34px}
            #discography-merge-controls button:hover {background:#444752}
            #discography-merge-controls button:focus-visible,#discography-merge-controls textarea:focus-visible {outline:2px solid #8baeff;outline-offset:2px}
            #discography-merge-controls button:disabled {opacity:.55;cursor:wait}
            #discography-merge-controls .dm-primary {background:#365f9b;border-color:#5477b6}
            #discography-merge-controls .dm-primary:hover {background:#4271b4}
            #discography-merge-controls .dm-top {display:flex;align-items:center;gap:10px;padding:7px}
            #discography-merge-controls .dm-panel {padding:0 10px 10px;display:grid;gap:8px}
            #discography-merge-controls .dm-panel[hidden] {display:none}
            #discography-merge-controls textarea {display:block;width:100%;background:#141519;color:#eee;border:1px solid #555862;border-radius:5px;padding:8px;font:12px/1.4 Consolas,monospace;resize:vertical}
            #discography-merge-controls .dm-actions {display:flex;align-items:center;gap:8px;flex-wrap:wrap}
            #discography-merge-controls .dm-status {font-size:12px;min-width:0;overflow-wrap:anywhere}
            #discography-merge-controls .dm-error {color:#ffa09a}
            #discography-merge-controls .dm-label {display:block;font-weight:600;margin-bottom:3px}
          </style>
          <div class="dm-top"><button type="button" class="dm-toggle" aria-expanded="false" aria-controls="dm-panel"><span aria-hidden="true">✚</span> Discography updater</button><span class="dm-status" role="status" aria-live="polite"></span></div>
          <div class="dm-panel" id="dm-panel" hidden>
            <label><span class="dm-label">Updated BBCode</span><textarea data-dm-control class="dm-updated" rows="7" placeholder="Paste the updated discography here" spellcheck="false"></textarea></label>
            <label><span class="dm-label">FastPic session URLs (one per line)</span><textarea data-dm-control class="dm-sessions" rows="2" spellcheck="false"></textarea></label>
            <div class="dm-actions"><button type="button" class="dm-primary dm-merge">Insert new releases</button><button type="button" class="dm-undo" hidden>Undo merge</button></div>
          </div>`;
        editor.parentElement.insertBefore(root, editor);
        const toggle = root.querySelector('.dm-toggle');
        const panel = root.querySelector('.dm-panel');
        const updatedInput = root.querySelector('.dm-updated');
        const sessionsInput = root.querySelector('.dm-sessions');
        const mergeButton = root.querySelector('.dm-merge');
        const undoButton = root.querySelector('.dm-undo');
        const status = root.querySelector('.dm-status');
        sessionsInput.value = GM_getValue('discography-merge:sessions', EXAMPLE_SESSIONS);
        let snapshot = null;
        const say = (value, error = false, detail = '') => {
            status.textContent = value;
            status.classList.toggle('dm-error', error);
            status.title = detail;
        };
        toggle.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            toggle.setAttribute('aria-expanded', String(!panel.hidden));
            if (!panel.hidden) updatedInput.focus();
        });
        sessionsInput.addEventListener('change', () => GM_setValue('discography-merge:sessions', sessionsInput.value));
        undoButton.addEventListener('click', () => {
            if (snapshot === null) return;
            if (editor.value !== snapshot.after) {
                say('Editor changed since merge. Undo not applied.', true);
                return;
            }
            writeEditor(editor, snapshot.before);
            snapshot = null;
            undoButton.hidden = true;
            say('Merge undone.');
        });
        mergeButton.addEventListener('click', async () => {
            mergeButton.disabled = true;
            say('Loading FastPic covers...');
            try {
                const original = editor.value;
                const updated = updatedInput.value;
                if (!updated.trim()) throw new Error('Paste the updated BBCode first.');
                const sessionUrls = getSessionUrls(sessionsInput.value);
                const covers = await fetchAllCovers(sessionUrls);
                const result = mergeDiscography(original, updated, covers);
                if (editor.value !== original) throw new Error('Editor changed while loading; retry the merge.');
                if (result.added) {
                    snapshot = { before: original, after: result.text };
                    writeEditor(editor, result.text);
                    undoButton.hidden = false;
                }
                GM_setValue('discography-merge:sessions', sessionsInput.value);
                say(result.added ? `Added ${result.added} · Covers ${result.covers} · Missing ${result.missing.length}` :
                    'No new releases found.', false, result.missing.join('\n'));
            } catch (error) {
                say(error.message || String(error), true);
            } finally {
                mergeButton.disabled = false;
            }
        });
    }

    const editor = findEditor();
    if (editor) setup(editor);
    else {
        const watcher = new MutationObserver(() => {
            const candidate = findEditor();
            if (candidate) { watcher.disconnect(); setup(candidate); }
        });
        watcher.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => watcher.disconnect(), 120000);
    }
})();