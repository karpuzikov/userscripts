// ==UserScript==
// @name         Emoji Text Renderer
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.0
// @description  Display Unicode emoji, including flags, in color on Chrome.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const emojiPattern = /\p{RGI_Emoji}|\p{Extended_Pictographic}/gv;

  function splitEmoji(text) {
    const parts = [];
    let last = 0;
    emojiPattern.lastIndex = 0;
    for (const match of text.matchAll(emojiPattern)) {
      if (match.index > last) parts.push({ text: text.slice(last, match.index) });
      let emoji = match[0];
      last = match.index + emoji.length;
      if (!/\p{RGI_Emoji}/v.test(emoji)) {
        if (text[last] === '\uFE0E' || text[last] === '\uFE0F') last++;
        emoji += '\uFE0F';
      }
      parts.push({ emoji });
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

  const styledEditors = new WeakSet();

  function styleEditable(element) {
    if (styledEditors.has(element)) return;
    const tag = element.tagName.toLowerCase();
    if (tag === 'input' &&
        /^(password|hidden|file|checkbox|radio|range|color|button|submit|reset|image)$/.test(element.type)) {
      return;
    }
    if (tag !== 'input' && tag !== 'textarea' &&
        !['', 'true', 'plaintext-only'].includes(element.getAttribute('contenteditable'))) {
      return;
    }
    const fontFamily = getComputedStyle(element).fontFamily;
    element.style.setProperty('font-family', '"Noto Color Emoji", ' + fontFamily, 'important');
    element.style.setProperty('font-variant-emoji', 'emoji', 'important');
    styledEditors.add(element);
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
        if (root.nodeType === 1 && root.matches?.('input, textarea, [contenteditable]')) {
          styleEditable(root);
        }
        for (const field of root.querySelectorAll?.('input, textarea, [contenteditable]') || []) {
          styleEditable(field);
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) pending.add(node);
      }
      schedule();
    }

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') enqueue(record.target);
        else if (record.type === 'attributes') styleEditable(record.target);
        else for (const node of record.addedNodes) enqueue(node);
      }
    });
    observer.observe(document.documentElement, {
      childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ['contenteditable'],
    });
    enqueue(document.body);
  }

  start();
})();
