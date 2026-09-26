// ==UserScript==
// @name         Emoji Text Renderer
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.2
// @description  Display Unicode emoji in page text and flags in editable fields without changing ordinary characters.
// @match        *://*/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      fonts.googleapis.com
// ==/UserScript==

(() => {
  'use strict';

  const emojiPattern = /\p{RGI_Emoji}/gv;
  const fontUrl = 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap';
  const editorSelector = 'textarea, input, select, option, [contenteditable]:not([contenteditable="false"])';
  const flagFamily = '"Emoji Text Renderer Flags"';

  function rangeContains(list, point) {
    return list.split(',').some((item) => {
      const match = /^U\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i.exec(item.trim());
      if (!match) return false;
      const low = parseInt(match[1].replaceAll('?', '0'), 16);
      const high = parseInt(match[2] || match[1].replaceAll('?', 'F'), 16);
      return low <= point && point <= high;
    });
  }

  function flagFontCss(googleCss) {
    const faces = [];
    let hasRegional = false;
    let hasSubdivision = false;
    for (const [, body] of googleCss.matchAll(/@font-face\s*\{([^}]+)\}/gi)) {
      if (!/font-family:\s*['"]?Noto Color Emoji['"]?\s*;/i.test(body)) continue;
      const range = /unicode-range:\s*([^;]+);/i.exec(body)?.[1];
      const url = /url\(\s*['"]?(https:\/\/fonts\.gstatic\.com\/[^'"\s)]+)['"]?\s*\)/i.exec(body)?.[1];
      if (!range || !url) continue;
      const regional = rangeContains(range, 0x1F1E6) && rangeContains(range, 0x1F1FF);
      const subdivision = rangeContains(range, 0x1F3F4);
      if (!regional && !subdivision) continue;
      const allowed = [];
      if (regional) {
        allowed.push('U+1F1E6-1F1FF');
        hasRegional = true;
      }
      if (subdivision) {
        allowed.push('U+1F3F4, U+E0061-E007A, U+E007F');
        hasSubdivision = true;
      }
      faces.push(`@font-face { font-family: ${flagFamily}; src: url("${url}") format("woff2"); font-display: swap; unicode-range: ${allowed.join(', ')}; }`);
    }
    // An incomplete font must not change editable fields.
    return hasRegional && hasSubdivision ? faces.join('\n') : '';
  }

  function splitEmoji(text) {
    const parts = [];
    let last = 0;
    emojiPattern.lastIndex = 0;
    for (const match of text.matchAll(emojiPattern)) {
      if (match.index > last) parts.push({ text: text.slice(last, match.index) });
      last = match.index + match[0].length;
      parts.push({ emoji: match[0] });
    }
    if (last < text.length || parts.length === 0) parts.push({ text: text.slice(last) });
    return parts;
  }

  function decorateTextNode(node) {
    if (!node.isConnected || !node.parentElement ||
        node.parentElement.closest('.emoji-text-renderer, script, style, noscript, textarea, input, select, option, code, pre, kbd, samp, [contenteditable]')) {
      return;
    }
    const parts = splitEmoji(node.nodeValue);
    if (parts.length === 1 && Object.hasOwn(parts[0], 'text')) return;

    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      if (Object.hasOwn(part, 'text')) {
        fragment.appendChild(document.createTextNode(part.text));
      } else {
        const span = document.createElement('span');
        span.className = 'emoji-text-renderer';
        span.textContent = part.emoji;
        span.style.setProperty('font-family',
          '"Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif', 'important');
        span.style.setProperty('font-variant-emoji', 'emoji', 'important');
        fragment.appendChild(span);
      }
    }
    node.replaceWith(fragment);
  }

  function start() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', start, { once: true });
      return;
    }

    const font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = fontUrl;
    (document.head || document.documentElement).appendChild(font);

    let flagFontReady = false;
    const styledEditors = new WeakSet();

    function styleEditor(element) {
      if (!flagFontReady || styledEditors.has(element)) return;
      const original = getComputedStyle(element).fontFamily;
      element.style.setProperty('font-family', `${flagFamily}, ${original}`, 'important');
      styledEditors.add(element);
    }

    function scanEditors(root) {
      if (root.nodeType !== 1) return;
      if (root.matches(editorSelector)) styleEditor(root);
      for (const element of root.querySelectorAll(editorSelector)) styleEditor(element);
    }

    GM_xmlhttpRequest({
      method: 'GET', url: fontUrl,
      onload(response) {
        if (response.status !== 200) return;
        const css = flagFontCss(response.responseText);
        if (!css) return;
        GM_addStyle(css);
        flagFontReady = true;
        scanEditors(document.body);
      },
      onerror() {},
    });

    const pending = new Set();
    let scheduled = false;

    function drain(deadline) {
      scheduled = false;
      let processed = 0;
      for (const node of pending) {
        pending.delete(node);
        decorateTextNode(node);
        processed++;
        if (processed >= 150 || deadline.timeRemaining() < 2) break;
      }
      schedule();
    }

    function schedule() {
      if (scheduled || !pending.size) return;
      scheduled = true;
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(drain, { timeout: 300 });
      } else {
        setTimeout(() => drain({ timeRemaining: () => 50 }), 0);
      }
    }

    function enqueue(root) {
      if (root.nodeType === 3) {
        pending.add(root);
      } else if (root.nodeType === 1 || root.nodeType === 11) {
        if (root.nodeType === 1) scanEditors(root);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) pending.add(node);
      }
      schedule();
    }

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') enqueue(record.target);
        else for (const node of record.addedNodes) enqueue(node);
      }
    });
    observer.observe(document.documentElement, {
      childList: true, characterData: true, subtree: true,
    });
    enqueue(document.body);
  }

  start();
})();
