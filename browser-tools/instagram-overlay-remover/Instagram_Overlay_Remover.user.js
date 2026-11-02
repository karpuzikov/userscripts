// ==UserScript==
// @name         Instagram Image Overlay Remover
// @namespace    https://github.com/karpuzikov/userscripts
// @version      1.0.1
// @description  Make image overlays click-through without hiding post media.
// @homepageURL  https://github.com/karpuzikov/userscripts/tree/main/browser-tools/instagram-overlay-remover
// @updateURL    https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/instagram-overlay-remover/Instagram_Overlay_Remover.user.js
// @downloadURL  https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/instagram-overlay-remover/Instagram_Overlay_Remover.user.js
// @match        https://www.instagram.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
    article .x1n2onr6:nth-child(2) .xtijo5x:nth-child(2):not(:has(img, video, picture, canvas)),
    .xyri2b:nth-child(2) > div > div > .x1i10hfl .xtijo5x:not(:has(img, video, picture, canvas)) {
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
})();
