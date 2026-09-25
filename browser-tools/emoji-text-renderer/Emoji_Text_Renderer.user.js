// ==UserScript==
// @name         Emoji Text Renderer
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.1
// @description  Display Unicode emoji in page text, including flags, without changing editor fonts.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const emojiPattern = /\p{RGI_Emoji}/gv;

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
    font.href = 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap';
    (document.head || document.documentElement).appendChild(font);

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
