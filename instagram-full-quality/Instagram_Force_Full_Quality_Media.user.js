// ==UserScript==
// @name               Instagram Force Full Quality Media
// @namespace          https://www.instagram.com/
// @version            4.4.5
// @description        Download original-quality Instagram photos and videos, including carousels, Reels and Stories.
// @description:ar     نزّل صورًا ومقاطع فيديو من منشورات Instagram بنقرة واحدة، بما في ذلك القصص وReels وصور الملف الشخصي.
// @description:de     Lade Fotos und Videos aus Instagram-Beiträgen mit einem Klick herunter, einschließlich Stories, Reels und Profilbildern.
// @description:es     Descarga fotos y videos de publicaciones de Instagram con un clic, incluyendo Stories, Reels y fotos de perfil.
// @description:fr     Téléchargez en un clic les photos et vidéos des publications Instagram, y compris les Stories, les Reels et les photos de profil.
// @description:id     Unduh foto dan video dari postingan Instagram dalam satu klik, termasuk Stories, Reels, dan foto profil.
// @description:it     Scarica foto e video dai post di Instagram con un solo clic, incluse Storie, Reels e foto del profilo.
// @description:ja     Instagramの投稿の写真や動画をワンクリックでダウンロード。ストーリー、リール、プロフィール写真にも対応。
// @description:ko     한 번의 클릭으로 Instagram 게시물의 사진과 동영상을 다운로드하고, 스토리, 릴스, 프로필 사진도 지원합니다.
// @description:pt-BR  Baixe fotos e vídeos de publicações do Instagram com um clique, incluindo Stories, Reels e fotos de perfil.
// @description:ro     Descarcă cu un singur clic fotografii și videoclipuri din postările Instagram, inclusiv storyuri, reels și fotografii de profil.
// @description:ru     Скачивайте фото и видео из публикаций Instagram в один клик, включая Stories, Reels и фото профиля.
// @description:th     ดาวน์โหลดรูปภาพและวิดีโอจากโพสต์ Instagram ได้ในคลิกเดียว รวมถึง Stories, Reels และรูปโปรไฟล์.
// @description:tr     Instagram gönderilerindeki fotoğraf ve videoları tek tıkla indirin; Hikayeler, Reels ve profil fotoğrafları da dahildir.
// @description:vi     Tải xuống ảnh và video từ bài viết trên Instagram chỉ với một cú nhấp, bao gồm Stories, Reels và ảnh đại diện.
// @description:zh-CN  一键下载 Instagram 帖子中的照片和视频，还包括快拍、Reels 和头像。
// @description:zh-TW  一鍵下載 Instagram 貼文中的照片、影片，還包含限時動態、Reels 與大頭貼。
// @author             SN-Koarashi (5026)
// @match              https://*.instagram.com/*
// @downloadURL         https://raw.githubusercontent.com/karpuzikov/userscripts/main/instagram-full-quality/Instagram_Force_Full_Quality_Media.user.js
// @updateURL           https://raw.githubusercontent.com/karpuzikov/userscripts/main/instagram-full-quality/Instagram_Force_Full_Quality_Media.user.js
// @grant              GM_addStyle
// @grant              GM_download
// @grant              GM_getValue
// @grant              GM_info
// @grant              GM_openInTab
// @grant              GM_registerMenuCommand
// @grant              GM_setValue
// @grant              GM_unregisterMenuCommand
// @grant              GM_xmlhttpRequest
// @connect            i.instagram.com
// @require            https://cdn.jsdelivr.net/npm/mediabunny@1.34.5/dist/bundles/mediabunny.min.cjs#sha256-wUFR+x2bDvpqgMAVGy2CvGvULyjTGvGy4UUAm8rae5U=
// @require            https://code.jquery.com/jquery-4.0.0.min.js#sha256-OaVG6prZf4v69dPg6PhVattBXkcOWQB62pdZ3ORyrao=
// @supportURL         https://github.com/karpuzikov/userscripts/issues
// @icon               https://www.google.com/s2/favicons?domain=www.instagram.com&sz=32
// @compatible         chrome >= 100
// @compatible         edge >= 100
// @compatible         firefox >= 100
// @license            GPL-3.0-only
// @run-at             document-idle
// ==/UserScript==

// eslint-disable-next-line no-unused-vars
(function ($, Mediabunny) {
    'use strict';

    /* initial */

    /******** USER SETTINGS ********/
    // !!! DO NOT CHANGE THIS AREA !!!
    // ??? PLEASE CHANGE SETTING WITH MENU ???
    const USER_SETTING = {
        'AUTO_RENAME': true,
        'CAPTURE_IMAGE_VIA_MEDIA_CACHE': true,
        'DIRECT_DOWNLOAD_ALL': false,
        'DIRECT_DOWNLOAD_STORY': false,
        'DIRECT_DOWNLOAD_VISIBLE_RESOURCE': false,
        'DISABLE_VIDEO_LOOPING': false,
        'FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED': false,
        'FORCE_FETCH_ALL_RESOURCES': false,
        'FORCE_RESOURCE_VIA_MEDIA': true,
        'HTML5_VIDEO_CONTROL': false,
        'MODIFY_RESOURCE_EXIF': false,
        'MODIFY_VIDEO_VOLUME': false,
        'NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST': false,
        'PREFER_DASH_MANIFEST': true,
        'REDIRECT_CLICK_USER_STORY_PICTURE': false,
        'RENAME_PUBLISH_DATE': true,
        'SCROLL_BUTTON': true,
        'SKIP_VIEW_STORY_CONFIRM': false,
        'SKIP_SHARED_WITH_YOU_DIALOG': false,
        'USE_EXTERNAL_DOWNLOAD_MODE': false
    };

    const PARENT_CHILD_MAPPING = {
        'AUTO_RENAME': [
            'RENAME_PUBLISH_DATE'
        ],
        'FORCE_RESOURCE_VIA_MEDIA': [
            'FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED',
            'NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST',
            'PREFER_DASH_MANIFEST'
        ]
    };
    const IMAGE_CACHE_KEY = 'URLS_OF_IMAGES_TEMPORARILY_STORED';
    const IMAGE_CACHE_MAX_AGE = 12 * 60 * 60 * 1000; // 12h in ms
    const IMAGE_MAX_CACHE_ITEMS = 300;
    /*******************************/

    // Icon download by Google Fonts Material Icon & Lucide
    const SVG = {
        DOWNLOAD: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-download-icon lucide-download"><path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/></svg>',
        NEW_TAB: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-external-link-icon lucide-external-link"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
        THUMBNAIL: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image-icon lucide-image"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
        DOWNLOAD_ALL: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-cloud-download-icon lucide-cloud-download"><path d="M12 13v8l-4-4"/><path d="m12 21 4-4"/><path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284"/></svg>',
        CLOSE: '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="#000000"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>',
        FULLSCREEN: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-maximize-icon lucide-maximize"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
        TURN_DEG: '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="#1f1f1f"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M7.34 6.41L.86 12.9l6.49 6.48 6.49-6.48-6.5-6.49zM3.69 12.9l3.66-3.66L11 12.9l-3.66 3.66-3.65-3.66zm15.67-6.26C17.61 4.88 15.3 4 13 4V.76L8.76 5 13 9.24V6c1.79 0 3.58.68 4.95 2.05 2.73 2.73 2.73 7.17 0 9.9C16.58 19.32 14.79 20 13 20c-.97 0-1.94-.21-2.84-.61l-1.49 1.49C10.02 21.62 11.51 22 13 22c2.3 0 4.61-.88 6.36-2.64 3.52-3.51 3.52-9.21 0-12.72z"/></svg>'
    };

    /*******************************/

    // FIX: resourceCountSelector moved to module scope — was previously re-declared
    // inside every createDownloadButton() invocation, and also referenced from the
    // body-level delegated handlers added below.

    // Improve the selector by using the value from the getVisibleNodeIndex function in 'const $viewport'.
    const resourceCountSelector = '*:not([data-pagelet])>*:not([role]):not([data-pagelet])>*>*>*[role]>*>ul[class] li[class]';

    /*******************************/
    const checkInterval = 250;
    // Bundle the original GPL-3.0-licensed stylesheet and translations so this fork works independently.
    const style = String.raw`[data-ih-locale-title] svg {
    vertical-align: middle;
}

.IG_POPUP_DIG {
    position: fixed;
    left: 0px;
    right: 0px;
    bottom: 0px;
    top: 0px;
    z-index: 500;
}

.IG_POPUP_DIG.hidden {
    display: none;
}

.IG_POPUP_DIG button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
}

.IG_POPUP_DIG_BG {
    position: fixed;
    left: 0px;
    right: 0px;
    bottom: 0px;
    top: 0px;
    z-index: 502;
    background: rgba(0, 0, 0, .75);
}

.IG_POPUP_DIG_MAIN {
    z-index: 510;
    padding: 10px 15px;
    top: 7%;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 500px;
    background: #fff;
    background: rgb(var(--ig-secondary-background));
    color: #000;
    color: rgb(var(--ig-primary-text));
    border-radius: 7px;
}

.IG_POPUP_DIG_BODY {
    min-height: 100px;
    max-height: 70vh;
    overflow-y: auto;
}

.IG_POPUP_DIG_BODY a {
    display: block;
    padding: 5px 0px;
    color: #111;
    color: rgb(var(--ig-primary-text));
    font-size: 1rem;
    line-height: 1rem;
    text-align: center;
    border-radius: 5px;
}

.IG_DW_MAIN,
.IG_NEWTAB_MAIN,
.IG_THUMBNAIL_MAIN,
.IG_DW_ALL_MAIN,
.IG_IMAGE_VIEWER {
    position: relative;
    top: 0px;
    padding: 4px;
    line-height: 0;
    background: transparent;
    color: #ffffff;
    border: 0;
    font: inherit;
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    box-sizing: border-box;
    transition: background 0.2s ease;
}

.IG_DW_MAIN:hover,
.IG_NEWTAB_MAIN:hover,
.IG_THUMBNAIL_MAIN:hover,
.IG_DW_ALL_MAIN:hover,
.IG_IMAGE_VIEWER:hover {
    background: rgba(255, 255, 255, 0.25);
}

.button_wrapper {
    position: absolute;
    top: 15px;
    right: 15px;
    line-height: 0;
    display: flex;
    flex-flow: row-reverse;
    gap: 8px;
    z-index: 1;
    background: rgba(0, 0, 0, 0.35);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    padding: 6px 8px;
    border-radius: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
}

/* SVG scaling */
.button_wrapper svg {
    width: 18px;
    height: 18px;
    display: block;
}
.button_wrapper > button:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.95);
    outline-offset: 2px;
}

#_SNLOAD {
    text-align: center;
    font-size: 20px;
}
.IG_POPUP_DIG.igdm-picker .igdm-error {
    grid-column: 1 / -1;
    margin: 16px;
    padding: 12px;
    color: #ffb4a7;
    text-align: center;
    font-size: 13px;
    line-height: 1.4;
}

.IG_REELS,
.IG_DWSTORY,
.IG_DWHISTORY,
.IG_DWSTORY_ALL,
.IG_DWHISTORY_ALL {
    position: absolute;
    right: 40px;
    top: 15px;
    padding: 2px;
    line-height: 0;
    background: #fff;
    border-radius: 5px;
    cursor: pointer;
    z-index: 5;
}

.IG_REELS_NEWTAB,
.IG_DWNEWTAB,
.IG_DWHINEWTAB {
    position: absolute;
    right: 40px;
    top: 47px;
    padding: 2px;
    line-height: 0;
    background: #fff;
    border-radius: 5px;
    cursor: pointer;
    z-index: 5;
    color: #000;
}

.IG_REELS_THUMBNAIL,
.IG_DWSTORY_THUMBNAIL,
.IG_DWHISTORY_THUMBNAIL {
    position: absolute;
    right: 40px;
    top: 79px;
    padding: 2px;
    line-height: 1;
    background: #fff;
    border-radius: 5px;
    cursor: pointer;
    z-index: 5;
}

.IG_DWSTORY_POSITION,
.IG_DWHISTORY_POSITION {
    position: absolute;
    right: -24px;
    top: 47px;
    width: 28px;
    height: 28px;
    padding: 2px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    border-radius: 5px;
    color: #000;
    cursor: default;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.4px;
    white-space: nowrap;
    z-index: 5;
    user-select: none;
}

*:not(:has(> section[class]))>.IG_DWSTORY,
*:not(:has(> section[class]))>.IG_DWHISTORY,
*:not(:has(> section[class]))>.IG_DWSTORY_THUMBNAIL,
*:not(:has(> section[class]))>.IG_DWHISTORY_THUMBNAIL,
*:not(:has(> section[class]))>.IG_DWNEWTAB,
*:not(:has(> section[class]))>.IG_DWHINEWTAB {
    right: -40px;
    color: #000;
}

*:not(:has(> section[class]))>.IG_DWSTORY_ALL,
*:not(:has(> section[class]))>.IG_DWHISTORY_ALL,
*:not(:has(> section[class]))>.IG_DWSTORY_POSITION,
*:not(:has(> section[class]))>.IG_DWHISTORY_POSITION {
    right: -70px;
    color: #000;
}

.IG_DWSTORY,
.IG_DWHISTORY,
.IG_DWSTORY_THUMBNAIL,
.IG_DWHISTORY_THUMBNAIL,
.IG_DWNEWTAB,
.IG_DWHINEWTAB {
    right: 6px;
    color: #000;
}

.IG_DWSTORY_ALL,
.IG_DWHISTORY_ALL {
    right: -24px;
    color: #000;
}

.IG_DWPROFILE {
    position: absolute;
    right: 0px;
    top: 0px;
    padding: 2px;
    line-height: 1;
    background: #fff;
    border-radius: 50%;
    cursor: pointer;
    border: 1px solid #ccc
}

.IG_DWPROFILE svg {
    color: #000;
}

.globalSettings {
    position: relative;
    display: inline-block;
    color: #000;
    color: rgb(var(--ig-primary-text));
    text-decoration: none;
    text-align: left;
    width: 100%;
    min-height: 30px;
    padding: 5px;
    padding-right: 60px;
    line-height: 18px;
    font-size: 18px;
    box-sizing: border-box;
    border-radius: 5px;
    vertical-align: middle;
    outline: none;
    cursor: pointer;
    -ms-user-select: none;
    -moz-user-select: none;
    -webkit-user-select: none;
    user-select: none;
    margin: 5px 0px;
}

.globalSettings:hover {
    background: #e7e7e7;
    background: rgb(var(--ig-secondary-button-hover));
}

.globalSettings:hover>span {
    cursor: help;
}

.globalSettings input:not(#date_format) {
    display: none;
}

.globalSettings input#date_format {
    width: calc(100% - 50px);
    background: rgb(var(--ig-secondary-background));
    border: 1px solid;
    position: relative;
    top: 50%;
    transform: translateY(-50%);
}

.globalSettings .chbtn {
    width: 40px;
    height: 15px;
    background: #9c9c9c;
    display: inline-block;
    vertical-align: middle;
    border-radius: 7px;
    position: absolute;
    right: 15px;
    top: 50%;
    transition: background 0.2s;
    transform: translateY(-50%);
}

.globalSettings .chbtn .rounds {
    width: 20px;
    height: 20px;
    background: #777;
    display: inline-block;
    vertical-align: middle;
    border-radius: 50%;
    position: absolute;
    left: 0px;
    top: -3px;
    transition: left 0.15s, background 0.15s;
}

.globalSettings input:checked~.chbtn {
    background: #004c5a;
}

.globalSettings input:checked~.chbtn .rounds {
    left: 20px;
    background: #048aa4;
}

.checkbox {
    font-size: 18px;
    vertical-align: middle;
    margin: 0px 7px;
    user-select: none;
    margin-left: 0px;
}

.checkbox input {
    transform: scale(1.5);
    margin-right: 10px;
}

.inner_box_wrapper {
    display: block;
    position: absolute;
    left: 0px;
    top: 0px;
    width: 50px;
    height: 100%;
    border-right: 1px solid;
    background: #e7e7e7;
    background: rgb(var(--ig-secondary-button-hover));
    cursor: pointer;
    border-radius: 7px 0px 0px 7px;
}

.inner_box~span {
    position: relative;
    height: 100%;
    width: 100%;
    display: block;
    border-radius: 7px 0px 0px 7px;
}

.inner_box:checked~span {
    background: rgb(var(--ig-success));
}

.inner_box~span:after {
    content: "";
    position: absolute;
    display: none;
    left: 12px;
    top: 50%;
    width: 10px;
    height: 20px;
    margin-top: -8px;
    border: solid black;
    border: solid rgb(var(--ig-primary-text));
    border-width: 0 3px 3px 0;
    -webkit-transform: rotate(45deg) translateY(-50%);
    -ms-transform: rotate(45deg) translateY(-50%);
    transform: rotate(45deg) translateY(-50%);
}

.inner_box:checked~span:after {
    display: block;
}

.inner_box {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: scale(2.5) translateY(-50%);
    cursor: pointer;
    appearance: none;
    opacity: 0;
}

.IG_POPUP_DIG_BODY>div {
    position: relative;
    border: 1px solid #000;
    border: 1px solid rgb(var(--ig-primary-text));
    margin: 5px 0px;
    border-radius: 7px;
}

.IG_POPUP_DIG_BODY>div:hover {
    background: rgba(var(--ig-hover-overlay));
}

.IG_POPUP_DIG_TITLE {
    padding-bottom: 5px;
}

.IG_POPUP_DIG_TITLE button {
    font-size: 14px;
    vertical-align: middle;
    margin: 0px 7px;
}

kbd {
    font-weight: bold;
    padding: 4px 5px;
    background: rgb(var(--ig-primary-background));
    border-radius: 3px;
    border: 1px solid rgb(var(--ig-primary-text));
}

.globalSettings #tempWrapper {
    position: absolute;
    top: 0px;
    left: 0px;
    right: 0px;
    height: 100%;
    background: #fff;
    background: rgb(var(--ig-secondary-background));
}

.globalSettings #tempWrapper input[type="range"] {
    display: inline-block;
    width: 80%;
    position: relative;
    top: 50%;
    transform: translateY(-50%);
}

.globalSettings #tempWrapper input[type="number"] {
    display: inline-block;
    width: 50px;
    border-radius: 7px;
    outline: 0px;
    background: transparent;
    border: 1px solid;
    position: relative;
    top: 50%;
    transform: translateY(-50%);
}

.globalSettings.child {
    margin-left: 15px;
    width: calc(100% - 15px);
}

#scrollWrapper {
    position: fixed;
    right: 15px;
    bottom: 15px;
}

#scrollWrapper .button-up,
#scrollWrapper .button-down {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background-color: rgba(0, 0, 0, 0.25);
    background-color: rgba(var(--ig-banner-background));
    cursor: pointer;
    margin: 5px 0px;
    border: 1px solid;
    border-color: rgb(var(--ig-separator));
}

#scrollWrapper .button-up:hover,
#scrollWrapper .button-down:hover {
    width: 32px;
    height: 32px;
    border-radius: 10px;
    background-color: rgba(0, 0, 0, 0.25);
    background-color: rgba(var(--ig-hover-overlay));
    cursor: pointer;
    margin: 5px 0px;
}

#scrollWrapper .button-up>div,
#scrollWrapper .button-down>div {
    position: relative;
    border: solid #000;
    border: solid rgb(var(--ig-primary-text));
    border-width: 0 4px 4px 0;
    display: inline-block;
    padding: 4px;
    left: 9.5px;
}

#scrollWrapper .button-up>div {
    transform: rotate(-135deg);
    -webkit-transform: rotate(-135deg);
    top: 9px;
}

#scrollWrapper .button-down>div {
    transform: rotate(45deg);
    -webkit-transform: rotate(45deg);
    top: 6px;
}

.IG_POPUP_DIG_BODY .newTab {
    position: absolute;
    right: 0px;
    top: 0px;
    z-index: 3;
    padding: 7px;
    cursor: pointer;
    line-height: 0;
    border-radius: 5px;
}

.IG_POPUP_DIG_BODY .videoThumbnail {
    position: absolute;
    right: 0px;
    top: 40px;
    z-index: 3;
    padding: 7px;
    cursor: pointer;
    line-height: 0;
    border-radius: 5px;
}

.IG_POPUP_DIG_BODY .newTab:hover,
.IG_POPUP_DIG_BODY .videoThumbnail:hover {
    background: rgb(var(--ig-secondary-button-hover));
}

.IG_POPUP_DIG_BTN {
    cursor: pointer;
    position: absolute;
    right: 0px;
    top: 0px;
    line-height: 0;
}

#tempWrapper .IG_POPUP_DIG_BTN {
    right: 5px;
    transform: translateY(-50%);
    top: 50%;
}

#tempWrapper #locatePreview {
    margin-left: 5px;
    display: inline-block;
    text-overflow: ellipsis;
    overflow: hidden;
    width: 60%;
    white-space: nowrap;
    vertical-align: middle;
    position: relative;
    transform: translateY(-50%);
    top: 50%;
}

#tempWrapper #locateSelect {
    transform: translateY(-50%);
    top: 50%;
    position: relative;
    vertical-align: middle;
}

.volume_slider>div {
    display: none;
}

div[class]:hover+.volume_slider>div,
.volume_slider:hover>div {
    display: block;
}

.volume_slider {
    position: absolute;
    height: 30px;
    left: 0px;
    right: 40px;
}

.volume_slider.bottom {
    left: 50px;
    right: 45px;
    bottom: 15px;
}

.volume_slider.vertical {
    top: 80px;
    right: 25px;
    transform: rotate(-90deg);
    transform-origin: right center;
}

.volume_slider>div {
    width: calc(100% - 20px);
    position: absolute;
    right: 10px;
    top: 0px;
    height: 30px;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 25px;
    text-align: center;
}

.volume_slider input[type="range"] {
    overflow: hidden;
    width: 90%;
    height: inherit;
    margin: 0 auto;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
}

.volume_slider input[type="range"]::-webkit-slider-runnable-track {
    background: rgba(255, 255, 255, 0.35);
    height: 6px;
    border-radius: 7px;
    background: linear-gradient(to right, #fff 0%, #fff var(--ig-track-progress), rgba(255, 255, 255, 0.35) var(--ig-track-progress), rgba(255, 255, 255, 0.35) 100%);
}

.volume_slider input[type="range"]::-moz-range-track {
    background: rgba(255, 255, 255, 0.35);
    height: 6px;
    border-radius: 7px;
}

.volume_slider input[type="range"]::-moz-range-progress {
    background-color: #fff;
    height: 6px;
    border-radius: 7px;
}

.volume_slider input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    margin-top: -5px;
    background-color: #fff;
    height: 16px;
    width: 16px;
    border-radius: 50%;
}

.volume_slider input[type="range"]::-moz-range-thumb {
    border: none;
    border-radius: 0;
    background-color: #fff;
    height: 16px;
    width: 16px;
    border-radius: 50%;
}

.circle_wrapper {
    position: fixed;
    display: flex;
    right: 15px;
    bottom: 15px;
    z-index: 50000;
    width: fit-content;
    align-items: center;
    flex-direction: row;
    padding: 7px;
    border-radius: 7px;
    box-shadow: 0 0 5px #202020;
    background: rgb(var(--ig-secondary-background));
}

.circle_wrapper circle {
    display: inline-block;
    border: 2px solid rgba(255, 152, 0, 0.9);
    opacity: .9;
    border-left: 2px solid rgba(0, 0, 0, 0);
    border-right: 2px solid rgba(0, 0, 0, 0);
    border-radius: 50px;
    width: 24px;
    height: 24px;
    margin: 0 5px;
    animation: spinoffPulse 0.5s infinite linear;
}

.circle_wrapper span {
    font-size: 16px;
    font-family: monospace;
    color: rgb(var(--ig-primary-text));
}

@keyframes spinoffPulse {
    0% {
        transform: rotate(0deg);
    }

    100% {
        transform: rotate(360deg);
    }
}

#imageViewer {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: none;
    justify-content: center;
    align-items: center;
    z-index: 600001;
    transform: scale(1);
    transition: transform 0.15s;

    @starting-style {
        transform: scale(0);
    }
}

#imageViewer>div {
    position: absolute;
    top: 0px;
    left: 0px;
    right: 0px;
    height: 35px;
    background: rgba(0, 0, 0, 0.2);
    display: flex;
    justify-content: flex-end;
    align-items: center;
    z-index: 2;
    color: #fff;
    padding: 0px 15px;
}

#imageViewer>div>div#iv_close {
    cursor: pointer;
}

#imageViewer>section {
    width: auto;
    height: auto;
}

#iv_image {
    max-width: none;
    max-height: 80svh;
    width: auto;
    height: 100%;
    user-select: none;
    cursor: grab;
}

#iv_close {
    filter: invert(1);
}`;
    const locale_manifest = {"ar":"العربية (Arabic)","de":"Deutsch (German)","en-US":"English","es":"Español (Spanish)","fr":"Français (French)","id":"Bahasa Indonesia (Indonesian)","it":"Italiano (Italian)","ja":"日本語 (Japanese)","ko":"한국어 (Korean)","pt-BR":"Português (Brazilian Portuguese)","ro":"Română (Romanian)","ru":"Русский (Russian)","th":"ไทย (Thai)","tr":"Türkçe (Turkish)","vi":"Tiếng Việt (Vietnamese)","zh-CN":"简体中文 (Simplified Chinese)","zh-TW":"繁體中文 (Traditional Chinese)"};
    const EMBEDDED_TRANSLATIONS = {
        "ar": {"RELOAD_SCRIPT":"إعادة تحميل السكربت","IMAGE_VIEWER":"فتح الصورة في العارض","NEW_TAB":"فتح في علامة تبويب جديدة","SHOW_DOM_TREE":"عرض شجرة DOM","SELECT_AND_COPY":"تحديد الكل والنسخ من مربع الإدخال","DOWNLOAD_DOM_TREE":"تنزيل شجرة DOM كملف نصي","REPORT_GITHUB":"الإبلاغ عن مشكلة على GitHub","DEBUG":"نافذة التصحيح","CLOSE":"إغلاق","ALL_CHECK":"تحديد الكل","ITEM_COUNT_SINGULAR":"%COUNT% عنصر","ITEM_COUNT_PLURAL":"%COUNT% عناصر","ITEM_POSITION":"العنصر %CURRENT% من %TOTAL%","SELECTED_COUNT_SINGULAR":"تم تحديد %COUNT%","SELECTED_COUNT_PLURAL":"تم تحديد %COUNT%","BATCH_DOWNLOAD_SELECTED":"تنزيل الموارد المحددة","BATCH_DOWNLOAD_DIRECT":"تنزيل جميع الموارد","IMG":"صورة","VID":"فيديو","DW":"تنزيل","DW_ALL":"تنزيل جميع الموارد","VIDEO_THUMBNAIL":"تنزيل الصورة المصغرة للفيديو","LOAD_BLOB_ONE":"جارٍ تحميل وسائط Blob...","LOAD_BLOB_MULTIPLE":"جارٍ تحميل وسائط Blob وغيرها...","LOAD_BLOB_RELOAD":"جارٍ اكتشاف وسائط Blob، تتم إعادة التحميل...","NO_CHECK_RESOURCE":"تحتاج إلى تحديد مورد لتنزيله.","NO_VID_URL":"يتعذر العثور على عنوان URL للفيديو.","SETTING":"الإعدادات","AUTO_RENAME":"إعادة تسمية الملفات تلقائيًا (انقر بزر الماوس الأيمن للضبط)","RENAME_PUBLISH_DATE":"تعيين الطابع الزمني للملفات المعاد تسميتها إلى تاريخ نشر الموارد","RENAME_LOCATE_DATE":"تعديل تنسيق تاريخ الطابع الزمني للملفات المعاد تسميتها (انقر بزر الماوس الأيمن للضبط)","DISABLE_VIDEO_LOOPING":"تعطيل التكرار التلقائي للفيديو","HTML5_VIDEO_CONTROL":"عرض وحدة تحكم فيديو HTML5","REDIRECT_CLICK_USER_STORY_PICTURE":"إعادة التوجيه عند النقر على صورة قصة المستخدم","FORCE_FETCH_ALL_RESOURCES":"فرض جلب جميع الموارد في المنشور","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"تنزيل الموارد المرئية في المنشور مباشرةً","DIRECT_DOWNLOAD_ALL":"تنزيل جميع الموارد في المنشور مباشرةً","DIRECT_DOWNLOAD_STORY":"تنزيل جميع الموارد في القصة/الهايلايت مباشرةً","MODIFY_VIDEO_VOLUME":"تعديل مستوى صوت الفيديو (انقر بزر الماوس الأيمن للضبط)","MODIFY_RESOURCE_EXIF":"تعديل خصائص EXIF للموارد","SCROLL_BUTTON":"تمكين أزرار التمرير لصفحة Reels","FORCE_RESOURCE_VIA_MEDIA":"فرض جلب الموارد عبر Media API","PREFER_DASH_MANIFEST":"تفضيل بيان DASH (فيديو بجودة أعلى عبر Media API)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"استخدام طرق بديلة للتنزيل عندما لا يكون Media API متاحًا","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"استخدام Media API دائمًا لـ [فتح في علامة تبويب جديدة] في المنشورات","SKIP_VIEW_STORY_CONFIRM":"تخطي صفحة التأكيد لعرض قصة/هايلايت","SKIP_SHARED_WITH_YOU_DIALOG":"تخطي مربع حوار «شارك هذا معك» في روابط الملفات الشخصية المشتركة","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"التقاط موارد الصور باستخدام ذاكرة التخزين المؤقت للوسائط","AUTO_RENAME_INTRO":["إعادة تسمية الملف تلقائيًا إلى تنسيق مخصص:","قائمة التنسيقات المخصصة:","%USERNAME% - اسم المستخدم","%SOURCE_TYPE% - مصدر التنزيل","%SHORTCODE% - الرمز القصير للمنشور","%YEAR% - سنة التنزيل/النشر","%2-YEAR% - السنة (آخر رقمين) للتنزيل/النشر","%MONTH% - شهر التنزيل/النشر","%DAY% - يوم التنزيل/النشر","%HOUR% - ساعة التنزيل/النشر","%MINUTE% - دقيقة التنزيل/النشر","%SECOND% - ثانية التنزيل/النشر","%ORIGINAL_NAME% - الاسم الأصلي للملف الذي تم تنزيله","%ORIGINAL_NAME_FIRST% - الاسم الأصلي للملف الذي تم تنزيله (الجزء الأول من الاسم)","%INDEX% - فهرس المورد","%UID% - المعرّف الفريد لحساب المستخدم","","إذا تم ضبطه على false، فسيبقى اسم الملف دون تغيير.","مثال: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"يضبط الطابع الزمني في تنسيق إعادة تسمية الملفات إلى تاريخ نشر الموارد (المنطقة الزمنية للمتصفح).\n\nتعمل هذه الميزة فقط عندما يتم ضبط [إعادة تسمية الملفات تلقائيًا] على TRUE.","RENAME_LOCATE_DATE_INTRO":"يعدّل تنسيق تاريخ الطابع الزمني للملفات المعاد تسميتها إلى الوقت المحلي للمتصفح، وينسّقه وفق تنسيق التاريخ الإقليمي المفضل لديك.\n\nتعمل هذه الميزة فقط عندما يتم ضبط [إعادة تسمية الملفات تلقائيًا] على TRUE.","DISABLE_VIDEO_LOOPING_INTRO":"يعطّل التكرار التلقائي للفيديو في Reels والمنشورات.","HTML5_VIDEO_CONTROL_INTRO":"يعرض وحدة تحكم فيديو HTML5 في موارد الفيديو.\n\nسيؤدي ذلك إلى إخفاء شريط تمرير مستوى الصوت المخصص واستبداله بوحدة تحكم HTML5. يمكن إخفاء وحدة تحكم HTML5 بالنقر بزر الماوس الأيمن على الفيديو لإظهار التفاصيل الأصلية.","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"يعيد التوجيه إلى صفحة الملف الشخصي للمستخدم عند النقر بزر الماوس الأيمن على صورته الرمزية في منطقة القصص على الصفحة الرئيسية.\nإذا استخدمت زر الماوس الأوسط للنقر، فسيتم فتحها في علامة تبويب جديدة.","FORCE_FETCH_ALL_RESOURCES_INTRO":"يفرض جلب جميع الموارد (الصور ومقاطع الفيديو) في منشور عبر واجهة Instagram API لإزالة حد ثلاثة موارد لكل منشور.","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"ينزّل الموارد الحالية المتاحة في المنشور مباشرةً.","DIRECT_DOWNLOAD_ALL_INTRO":"عند النقر على زر التنزيل، سيتم جلب جميع الموارد في المنشور قسرًا وتنزيلها.","MODIFY_VIDEO_VOLUME_INTRO":"يعدّل مستوى صوت تشغيل الفيديو في Reels والمنشورات (انقر بزر الماوس الأيمن لفتح شريط تمرير إعداد مستوى الصوت).","SCROLL_BUTTON_INTRO":"يمكّن أزرار التمرير في الزاوية اليمنى السفلية من صفحة Reels.","FORCE_RESOURCE_VIA_MEDIA_INTRO":"سيحاول Media API الحصول على الصورة أو الفيديو بأعلى جودة ممكنة، لكن التحميل قد يستغرق وقتًا أطول.","PREFER_DASH_MANIFEST_INTRO":"يفضّل بيان DASH لموارد الفيديو عبر Media API. إذا كان بيان DASH متاحًا، فسيتم تنزيل تدفقات الفيديو والصوت بشكل منفصل للحصول على أفضل جودة ممكنة.","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"عندما يصل Media API إلى حد المعدل أو لا يمكن استخدامه لأسباب أخرى، سيتم استخدام Forced Fetch API لتنزيل الموارد (قد تكون جودة الموارد أقل قليلًا).","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"سيستخدم زر [فتح في علامة تبويب جديدة] في المنشورات Media API دائمًا للحصول على موارد عالية الدقة.","SKIP_VIEW_STORY_CONFIRM_INTRO":"يتخطى تلقائيًا عند عرض صفحة التأكيد في قصة أو هايلايت.","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"ينقر تلقائيًا على «ليس الآن» في مربع حوار «شارك X هذا معك» عند فتح أي روابط ?igsh=.","MODIFY_RESOURCE_EXIF_INTRO":"يعدّل سمات EXIF لموارد الصور لتضمين بيانات وصفية مثل رابط المنشور وتاريخ الالتقاط والمؤلف.","DIRECT_DOWNLOAD_STORY_INTRO":"عند النقر على [تنزيل جميع الموارد]، يتم تنزيل جميع القصص/الهايلايت مباشرةً دون عرض مربع حوار اختيار الصور.","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"يستخدم مراقبًا لالتقاط أي عناوين URL لصور عالية الجودة من شجرة DOM إلى مساحة تخزين السكربت، بحيث يمكن استخراجها عند توفرها وبناءً على إدخال المستخدم.","HOTKEY_DEBUG_KEY":"نافذة التصحيح","HOTKEY_SETTINGS_KEY":"إعدادات التفضيلات","HOTKEY_KEY_SETTINGS_KEY":"إعدادات مفاتيح الاختصار","HOTKEY_DOWNLOAD_STORY_KEY":"تنزيل القصة","HOTKEY_CONFLICT_WARNING":"قد يتعارض مفتاح الاختصار هذا مع إعدادات أخرى.","HOTKEY_RESET":"إعادة تعيين","USE_EXTERNAL_DOWNLOAD_MODE":"استخدم وضع التنزيل الخارجي","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"سيؤدي تفعيل هذه الميزة إلى جعل البرنامج النصي يستخدم وظائف تنزيل موسعة (مثل GM_download) لتنزيل الملفات، مما يحل مشكلة الملفات المفقودة عند تنزيل عدة ملفات.\n\nيرجى ملاحظة: قد يؤدي تفعيل هذه الميزة إلى تعطل وظيفة إعادة تسمية الملفات. يرجى التأكد من أن وضع التنزيل في إعدادات الميزات الموسعة مضبوط على الوضع الأصلي."},
        "de": {"RELOAD_SCRIPT":"Skript neu laden","IMAGE_VIEWER":"Bild im Betrachter öffnen","NEW_TAB":"In neuem Tab öffnen","SHOW_DOM_TREE":"DOM-Baum anzeigen","SELECT_AND_COPY":"Alles auswählen und aus dem Eingabefeld kopieren","DOWNLOAD_DOM_TREE":"DOM-Baum als Textdatei herunterladen","REPORT_GITHUB":"Problem auf GitHub melden","DEBUG":"Debug-Fenster","CLOSE":"Schließen","ALL_CHECK":"Alle auswählen","ITEM_COUNT_SINGULAR":"%COUNT% Element","ITEM_COUNT_PLURAL":"%COUNT% Elemente","ITEM_POSITION":"Element %CURRENT% von %TOTAL%","SELECTED_COUNT_SINGULAR":"%COUNT% ausgewählt","SELECTED_COUNT_PLURAL":"%COUNT% ausgewählt","BATCH_DOWNLOAD_SELECTED":"Ausgewählte Ressourcen herunterladen","BATCH_DOWNLOAD_DIRECT":"Alle Ressourcen herunterladen","IMG":"Bild","VID":"Video","DW":"Herunterladen","DW_ALL":"Alle Ressourcen herunterladen","VIDEO_THUMBNAIL":"Video-Miniaturansicht herunterladen","LOAD_BLOB_ONE":"Blob-Medien werden geladen...","LOAD_BLOB_MULTIPLE":"Blob-Medien und andere Ressourcen werden geladen...","LOAD_BLOB_RELOAD":"Blob-Medien werden erkannt, wird neu geladen...","NO_CHECK_RESOURCE":"Du musst eine Ressource zum Herunterladen auswählen.","NO_VID_URL":"Video-URL kann nicht gefunden werden.","SETTING":"Einstellungen","AUTO_RENAME":"Dateien automatisch umbenennen (Rechtsklick zum Festlegen)","RENAME_PUBLISH_DATE":"Zeitstempel der umbenannten Datei auf das Veröffentlichungsdatum der Ressource setzen","RENAME_LOCATE_DATE":"Datumsformat des Zeitstempels umbenannter Dateien ändern (Rechtsklick zum Festlegen)","DISABLE_VIDEO_LOOPING":"Automatische Videowiedergabe in Schleife deaktivieren","HTML5_VIDEO_CONTROL":"HTML5-Videosteuerung anzeigen","REDIRECT_CLICK_USER_STORY_PICTURE":"Beim Klicken auf das Story-Bild des Benutzers weiterleiten","FORCE_FETCH_ALL_RESOURCES":"Abruf aller Ressourcen im Beitrag erzwingen","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"Sichtbare Ressourcen im Beitrag direkt herunterladen","DIRECT_DOWNLOAD_ALL":"Alle Ressourcen im Beitrag direkt herunterladen","DIRECT_DOWNLOAD_STORY":"Alle Ressourcen in der Story/im Highlight direkt herunterladen","MODIFY_VIDEO_VOLUME":"Videolautstärke ändern (Rechtsklick zum Festlegen)","MODIFY_RESOURCE_EXIF":"EXIF-Eigenschaften der Ressource ändern","SCROLL_BUTTON":"Scroll-Schaltflächen für die Reels-Seite aktivieren","FORCE_RESOURCE_VIA_MEDIA":"Abruf der Ressource über die Media API erzwingen","PREFER_DASH_MANIFEST":"DASH-Manifest bevorzugen (Video in höherer Qualität über die Media API)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"Alternative Download-Methoden verwenden, wenn die Media API nicht zugänglich ist","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"Für [In neuem Tab öffnen] in Beiträgen immer die Media API verwenden","SKIP_VIEW_STORY_CONFIRM":"Bestätigungsseite beim Ansehen einer Story/eines Highlights überspringen","SKIP_SHARED_WITH_YOU_DIALOG":"Dialog „hat dies mit dir geteilt“ bei geteilten Profillinks überspringen","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"Bildressource über den Mediencache erfassen","AUTO_RENAME_INTRO":["Dateien automatisch in ein benutzerdefiniertes Format umbenennen:","Liste benutzerdefinierter Formate:","%USERNAME% - Benutzername","%SOURCE_TYPE% - Download-Quelle","%SHORTCODE% - Kurzcode des Beitrags","%YEAR% - Jahr des Downloads/der Veröffentlichung","%2-YEAR% - Jahr (letzte zwei Ziffern) des Downloads/der Veröffentlichung","%MONTH% - Monat des Downloads/der Veröffentlichung","%DAY% - Tag des Downloads/der Veröffentlichung","%HOUR% - Stunde des Downloads/der Veröffentlichung","%MINUTE% - Minute des Downloads/der Veröffentlichung","%SECOND% - Sekunde des Downloads/der Veröffentlichung","%ORIGINAL_NAME% - Ursprünglicher Name der heruntergeladenen Datei","%ORIGINAL_NAME_FIRST% - Ursprünglicher Name der heruntergeladenen Datei (erster Teil des Namens)","%INDEX% - Index der Ressource","%UID% - Eindeutige ID des Benutzerkontos","","Wenn auf falsch gesetzt, bleibt der Dateiname unverändert.","Beispiel: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"Setzt den Zeitstempel im Dateiumbenennungsformat auf das Veröffentlichungsdatum der Ressource (Zeitzone des Browsers).\n\nDiese Funktion funktioniert nur, wenn [Dateien automatisch umbenennen] auf WAHR gesetzt ist.","RENAME_LOCATE_DATE_INTRO":"Ändert das Datumsformat des Zeitstempels der umbenannten Datei auf die lokale Zeit des Browsers und formatiert es in dein bevorzugtes regionales Datumsformat.\n\nDiese Funktion funktioniert nur, wenn [Dateien automatisch umbenennen] auf WAHR gesetzt ist.","DISABLE_VIDEO_LOOPING_INTRO":"Deaktiviert die automatische Videowiedergabe in Schleife in Reels und Beiträgen.","HTML5_VIDEO_CONTROL_INTRO":"Zeigt die HTML5-Videosteuerung in der Videoressource an.\n\nDadurch wird der benutzerdefinierte Lautstärkeregler ausgeblendet und durch die HTML5-Steuerung ersetzt. Die HTML5-Steuerung kann ausgeblendet werden, indem du mit der rechten Maustaste auf das Video klickst, um die ursprünglichen Details anzuzeigen.","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"Leitet zur Profilseite eines Benutzers weiter, wenn du mit der rechten Maustaste auf dessen Avatar im Story-Bereich der Startseite klickst.\nWenn du mit der mittleren Maustaste klickst, wird die Seite in einem neuen Tab geöffnet.","FORCE_FETCH_ALL_RESOURCES_INTRO":"Erzwingt den Abruf aller Ressourcen (Fotos und Videos) in einem Beitrag über die Instagram-API, um die Begrenzung auf drei Ressourcen pro Beitrag zu entfernen.","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"Lädt die aktuell im Beitrag verfügbaren Ressourcen direkt herunter.","DIRECT_DOWNLOAD_ALL_INTRO":"Wenn du auf die Download-Schaltfläche klickst, werden alle Ressourcen im Beitrag zwangsweise abgerufen und heruntergeladen.","MODIFY_VIDEO_VOLUME_INTRO":"Ändert die Wiedergabelautstärke von Videos in Reels und Beiträgen (Rechtsklick, um den Lautstärkeregler zu öffnen).","SCROLL_BUTTON_INTRO":"Aktiviert Scroll-Schaltflächen in der unteren rechten Ecke der Reels-Seite.","FORCE_RESOURCE_VIA_MEDIA_INTRO":"Die Media API versucht, Fotos oder Videos in der höchstmöglichen Qualität zu erhalten, das Laden kann jedoch länger dauern.","PREFER_DASH_MANIFEST_INTRO":"Bevorzugt das DASH-Manifest für Videoressourcen über die Media API. Wenn ein DASH-Manifest verfügbar ist, werden die Video- und Audiostreams SEPARAT heruntergeladen, um die bestmögliche Qualität zu erhalten.","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"Wenn die Media API ihre Ratenbegrenzung erreicht oder aus anderen Gründen nicht verwendet werden kann, wird die Forced Fetch API zum Herunterladen der Ressourcen verwendet (die Ressourcenqualität kann etwas niedriger sein).","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"Die Schaltfläche [In neuem Tab öffnen] in Beiträgen verwendet immer die Media API, um hochauflösende Ressourcen zu erhalten.","SKIP_VIEW_STORY_CONFIRM_INTRO":"Überspringt automatisch, wenn die Bestätigungsseite in einer Story oder einem Highlight angezeigt wird.","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"Klickt beim Öffnen beliebiger ?igsh=-Links automatisch auf „Jetzt nicht“ im Dialog „X hat dies mit dir geteilt“.","MODIFY_RESOURCE_EXIF_INTRO":"Ändert die EXIF-Attribute der Bildressource, um Metadaten wie Beitragslink, Aufnahmedatum und Autor einzuschließen.","DIRECT_DOWNLOAD_STORY_INTRO":"Wenn du auf [Alle Ressourcen herunterladen] klickst, werden alle Storys/Highlights direkt heruntergeladen, ohne den Bildauswahldialog anzuzeigen.","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"Verwendet einen Beobachter, um alle URLs hochwertiger Bilder aus dem DOM-Baum im Speicher des Skripts zu erfassen, damit sie extrahiert werden können, sobald sie verfügbar sind und der Benutzer dies anfordert.","HOTKEY_DEBUG_KEY":"Debug-Fenster","HOTKEY_SETTINGS_KEY":"Voreinstellungen","HOTKEY_KEY_SETTINGS_KEY":"Tastenkürzel-Einstellungen","HOTKEY_DOWNLOAD_STORY_KEY":"Story herunterladen","HOTKEY_CONFLICT_WARNING":"Dieses Tastenkürzel kann mit anderen Einstellungen in Konflikt stehen.","HOTKEY_RESET":"Zurücksetzen","USE_EXTERNAL_DOWNLOAD_MODE":"Externen Downloadmodus verwenden","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"Durch das Aktivieren dieser Funktion verwendet das Skript erweiterte Downloadfunktionen (wie GM_download), um Dateien herunterzuladen. Dadurch wird das Problem fehlender Dateien beim Herunterladen mehrerer Dateien behoben.\n\nBitte beachte: Das Aktivieren dieser Funktion kann dazu führen, dass die Funktion zum Umbenennen von Dateien nicht ordnungsgemäß funktioniert. Stelle sicher, dass der Downloadmodus in den Einstellungen der erweiterten Funktionen auf „Nativ“ eingestellt ist."},
        "es": {"RELOAD_SCRIPT":"Recargar script","IMAGE_VIEWER":"Abrir imagen en el visor","NEW_TAB":"Abrir en una pestaña nueva","SHOW_DOM_TREE":"Mostrar árbol DOM","SELECT_AND_COPY":"Seleccionar todo y copiar desde el cuadro de entrada","DOWNLOAD_DOM_TREE":"Descargar árbol DOM como archivo de texto","REPORT_GITHUB":"Reportar un problema en GitHub","DEBUG":"Ventana de depuración","CLOSE":"Cerrar","ALL_CHECK":"Seleccionar todo","ITEM_COUNT_SINGULAR":"%COUNT% elemento","ITEM_COUNT_PLURAL":"%COUNT% elementos","ITEM_POSITION":"Elemento %CURRENT% de %TOTAL%","SELECTED_COUNT_SINGULAR":"%COUNT% seleccionado","SELECTED_COUNT_PLURAL":"%COUNT% seleccionados","BATCH_DOWNLOAD_SELECTED":"Descargar recursos seleccionados","BATCH_DOWNLOAD_DIRECT":"Descargar todos los recursos","IMG":"Imagen","VID":"Vídeo","DW":"Descargar","DW_ALL":"Descargar todos los recursos","VIDEO_THUMBNAIL":"Descargar miniatura del vídeo","LOAD_BLOB_ONE":"Cargando contenido multimedia en formato Blob...","LOAD_BLOB_MULTIPLE":"Cargando contenido multimedia en formato Blob y otros...","LOAD_BLOB_RELOAD":"Detectando contenido multimedia en formato Blob, recargando...","NO_CHECK_RESOURCE":"Necesitas seleccionar un recurso para descargar.","NO_VID_URL":"No se puede encontrar la URL del vídeo.","SETTING":"Ajustes","AUTO_RENAME":"Renombrar archivos automáticamente (clic derecho para configurar)","RENAME_PUBLISH_DATE":"Establecer la marca de tiempo de los archivos renombrados en la fecha de publicación de los recursos","RENAME_LOCATE_DATE":"Modificar el formato de fecha de la marca de tiempo de los archivos renombrados (clic derecho para configurar)","DISABLE_VIDEO_LOOPING":"Desactivar la reproducción automática en bucle de los vídeos","HTML5_VIDEO_CONTROL":"Mostrar el controlador de vídeo HTML5","REDIRECT_CLICK_USER_STORY_PICTURE":"Redirigir al hacer clic en la foto de perfil en la historia del usuario","FORCE_FETCH_ALL_RESOURCES":"Forzar la obtención de todos los recursos de la publicación","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"Descargar directamente los recursos visibles de la publicación","DIRECT_DOWNLOAD_ALL":"Descargar directamente todos los recursos de la publicación","DIRECT_DOWNLOAD_STORY":"Descargar directamente todos los recursos de la historia/destacado","MODIFY_VIDEO_VOLUME":"Modificar el volumen del vídeo (clic derecho para configurar)","MODIFY_RESOURCE_EXIF":"Modificar las propiedades EXIF del recurso","SCROLL_BUTTON":"Habilitar botones de desplazamiento para la página de Reels","FORCE_RESOURCE_VIA_MEDIA":"Forzar la obtención de recursos a través de la API de Media","PREFER_DASH_MANIFEST":"Preferir manifiesto DASH (vídeo de mayor calidad vía la API de Media)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"Usar métodos alternativos para descargar cuando la API de Media no sea accesible","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"Usar siempre la API de Media para [Abrir en una pestaña nueva] en publicaciones","SKIP_VIEW_STORY_CONFIRM":"Omitir la página de confirmación al ver una historia/destacado","SKIP_SHARED_WITH_YOU_DIALOG":"Omitir el diálogo \"compartió esto contigo\" en enlaces de perfil compartidos","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"Capturar recursos de imagen usando la caché multimedia","AUTO_RENAME_INTRO":["Renombrar archivos automáticamente a un formato personalizado:","Lista de formatos personalizados:","%USERNAME% - Nombre de usuario","%SOURCE_TYPE% - Fuente de la descarga","%SHORTCODE% - Código corto de la publicación","%YEAR% - Año de descarga/publicación","%2-YEAR% - Año (últimos dos dígitos) de descarga/publicación","%MONTH% - Mes de descarga/publicación","%DAY% - Día de descarga/publicación","%HOUR% - Hora de descarga/publicación","%MINUTE% - Minuto de descarga/publicación","%SECOND% - Segundo de descarga/publicación","%ORIGINAL_NAME% - Nombre original del archivo descargado","%ORIGINAL_NAME_FIRST% - Nombre original del archivo descargado (primera parte del nombre)","%INDEX% - Índice del recurso","%UID% - ID único de la cuenta de usuario","","Si se establece en falso, el nombre del archivo permanecerá sin cambios.","Ejemplo: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"Establece la marca de tiempo en el formato de renombramiento de archivos en la fecha de publicación de los recursos (zona horaria del navegador).\n\nEsta función solo funciona cuando [Renombrar archivos automáticamente] está establecido en VERDADERO.","RENAME_LOCATE_DATE_INTRO":"Modifica el formato de fecha de la marca de tiempo de los archivos renombrados a la hora local del navegador y dale el formato regional de fecha que prefieras.\n\nEsta función solo funciona cuando [Renombrar archivos automáticamente] está establecido en VERDADERO.","DISABLE_VIDEO_LOOPING_INTRO":"Desactiva la reproducción automática en bucle de los vídeos en Reels y publicaciones.","HTML5_VIDEO_CONTROL_INTRO":"Muestra el controlador de vídeo HTML5 en los recursos de vídeo.\n\nEsto ocultará el control deslizante de volumen de vídeo personalizado y lo reemplazará con el controlador HTML5. El controlador HTML5 se puede ocultar haciendo clic derecho en el vídeo para revelar los detalles originales.","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"Redirige a la página de perfil de un usuario al hacer clic derecho en su avatar en el área de historias de la página de inicio.\nSi usas el botón central del ratón para hacer clic, se abrirá en una pestaña nueva.","FORCE_FETCH_ALL_RESOURCES_INTRO":"Fuerza la obtención de todos los recursos (fotos y vídeos) de una publicación a través de la API de Instagram para eliminar el límite de tres recursos por publicación.","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"Descarga directamente los recursos actuales disponibles en la publicación.","DIRECT_DOWNLOAD_ALL_INTRO":"Al hacer clic en el botón de descarga, todos los recursos de la publicación se obtendrán y descargarán de forma forzada.","MODIFY_VIDEO_VOLUME_INTRO":"Modifica el volumen de reproducción de vídeo en Reels y publicaciones (haz clic derecho para abrir el control deslizante de configuración del volumen).","SCROLL_BUTTON_INTRO":"Habilita botones de desplazamiento para la esquina inferior derecha de la página de Reels.","FORCE_RESOURCE_VIA_MEDIA_INTRO":"La API de Media intentará obtener la foto o el vídeo de mayor calidad posible, pero puede tardar más en cargarse.","PREFER_DASH_MANIFEST_INTRO":"Prefiere el manifiesto DASH para recursos de vídeo vía la API de Media. Si hay un manifiesto DASH disponible, descargará los flujos de vídeo y audio POR SEPARADO para obtener la mejor calidad posible.","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"Cuando la API de Media alcance su límite de frecuencia o no pueda usarse por otros motivos, se utilizará la API de obtención forzada para descargar recursos (la calidad del recurso puede ser ligeramente inferior).","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"El botón [Abrir en una pestaña nueva] de las publicaciones siempre usará la API de Media para obtener recursos de alta resolución.","SKIP_VIEW_STORY_CONFIRM_INTRO":"Omite automáticamente la página de confirmación cuando se muestra en una historia o destacado.","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"Al abrir cualquier enlace ?igsh=, haz clic automáticamente en \"Ahora no\" en el diálogo \"X compartió esto contigo\".","MODIFY_RESOURCE_EXIF_INTRO":"Modifica los atributos EXIF del recurso de imagen para incluir metadatos como el enlace de la publicación, la fecha de captura y el autor.","DIRECT_DOWNLOAD_STORY_INTRO":"Al hacer clic en [Descargar todos los recursos], todas las historias/destacados se descargan directamente, sin mostrar el cuadro de diálogo de selección de imágenes.","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"Usa un observador para capturar cualquier URL de imágenes de alta calidad del árbol DOM en el almacenamiento del script, de modo que puedan extraerse cuando estén disponibles y a petición del usuario.","HOTKEY_DEBUG_KEY":"Ventana de depuración","HOTKEY_SETTINGS_KEY":"Ajustes de preferencias","HOTKEY_KEY_SETTINGS_KEY":"Configuración de atajos de teclado","HOTKEY_DOWNLOAD_STORY_KEY":"Descargar historia","HOTKEY_CONFLICT_WARNING":"Este atajo de teclado puede entrar en conflicto con otras configuraciones.","HOTKEY_RESET":"Restablecer","USE_EXTERNAL_DOWNLOAD_MODE":"Usar el modo de descarga externo","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"Al activar esta función, el script utilizará funciones de descarga ampliadas (como GM_download) para descargar archivos, resolviendo el problema de los archivos que faltan al descargar varios archivos.\n\nTen en cuenta: Activar esta función puede hacer que la función de cambio de nombre de archivos no funcione correctamente. Asegúrate de que el modo de descarga en la configuración de las funciones ampliadas esté establecido en Nativo."},
        "fr": {"RELOAD_SCRIPT":"Recharger le script","IMAGE_VIEWER":"Ouvrir l'image dans la visionneuse","NEW_TAB":"Ouvrir dans un nouvel onglet","SHOW_DOM_TREE":"Afficher l'arborescence DOM","SELECT_AND_COPY":"Tout sélectionner et copier depuis la zone de saisie","DOWNLOAD_DOM_TREE":"Télécharger l'arborescence DOM en tant que fichier texte","REPORT_GITHUB":"Signaler un problème sur GitHub","DEBUG":"Fenêtre de débogage","CLOSE":"Fermer","ALL_CHECK":"Tout sélectionner","ITEM_COUNT_SINGULAR":"%COUNT% élément","ITEM_COUNT_PLURAL":"%COUNT% éléments","ITEM_POSITION":"Élément %CURRENT% sur %TOTAL%","SELECTED_COUNT_SINGULAR":"%COUNT% sélectionné","SELECTED_COUNT_PLURAL":"%COUNT% sélectionnés","BATCH_DOWNLOAD_SELECTED":"Télécharger les ressources sélectionnées","BATCH_DOWNLOAD_DIRECT":"Télécharger toutes les ressources","IMG":"Image","VID":"Vidéo","DW":"Télécharger","DW_ALL":"Télécharger toutes les ressources","VIDEO_THUMBNAIL":"Télécharger la miniature de la vidéo","LOAD_BLOB_ONE":"Chargement du média Blob...","LOAD_BLOB_MULTIPLE":"Chargement du média Blob et des autres ressources...","LOAD_BLOB_RELOAD":"Détection du média Blob, rechargement...","NO_CHECK_RESOURCE":"Vous devez sélectionner une ressource à télécharger.","NO_VID_URL":"Impossible de trouver l'URL de la vidéo.","SETTING":"Paramètres","AUTO_RENAME":"Renommer automatiquement les fichiers (clic droit pour configurer)","RENAME_PUBLISH_DATE":"Définir l'horodatage des fichiers renommés à la date de publication de la ressource","RENAME_LOCATE_DATE":"Modifier le format de date de l'horodatage des fichiers renommés (clic droit pour configurer)","DISABLE_VIDEO_LOOPING":"Désactiver la lecture automatique en boucle des vidéos","HTML5_VIDEO_CONTROL":"Afficher le contrôleur vidéo HTML5","REDIRECT_CLICK_USER_STORY_PICTURE":"Rediriger lors d'un clic sur la photo de story de l'utilisateur","FORCE_FETCH_ALL_RESOURCES":"Forcer la récupération de toutes les ressources du post","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"Télécharger directement les ressources visibles dans le post","DIRECT_DOWNLOAD_ALL":"Télécharger directement toutes les ressources du post","DIRECT_DOWNLOAD_STORY":"Télécharger directement toutes les ressources de la story/du contenu à la une","MODIFY_VIDEO_VOLUME":"Modifier le volume de la vidéo (clic droit pour configurer)","MODIFY_RESOURCE_EXIF":"Modifier les propriétés EXIF de la ressource","SCROLL_BUTTON":"Activer les boutons de défilement pour la page des Reels","FORCE_RESOURCE_VIA_MEDIA":"Forcer la récupération des ressources via l'API Media","PREFER_DASH_MANIFEST":"Préférer le manifeste DASH (vidéo de meilleure qualité via l'API Media)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"Utiliser des méthodes alternatives de téléchargement lorsque l'API Media n'est pas accessible","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"Toujours utiliser l'API Media pour [Ouvrir dans un nouvel onglet] dans les posts","SKIP_VIEW_STORY_CONFIRM":"Ignorer la page de confirmation pour afficher une story/un contenu à la une","SKIP_SHARED_WITH_YOU_DIALOG":"Ignorer la boîte de dialogue « a partagé ceci avec vous » sur les liens de profil partagés","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"Capturer les ressources image à l'aide du cache multimédia","AUTO_RENAME_INTRO":["Renommer automatiquement les fichiers dans un format personnalisé :","Liste des formats personnalisés :","%USERNAME% - Nom d'utilisateur","%SOURCE_TYPE% - Source du téléchargement","%SHORTCODE% - Code court du post","%YEAR% - Année de téléchargement/publication","%2-YEAR% - Année (deux derniers chiffres) de téléchargement/publication","%MONTH% - Mois de téléchargement/publication","%DAY% - Jour de téléchargement/publication","%HOUR% - Heure de téléchargement/publication","%MINUTE% - Minute de téléchargement/publication","%SECOND% - Seconde de téléchargement/publication","%ORIGINAL_NAME% - Nom original du fichier téléchargé","%ORIGINAL_NAME_FIRST% - Nom original du fichier téléchargé (première partie du nom)","%INDEX% - Index de la ressource","%UID% - ID unique du compte utilisateur","","Si défini sur faux, le nom du fichier restera inchangé.","Exemple : instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"Définit l'horodatage dans le format de renommage du fichier à la date de publication de la ressource (fuseau horaire du navigateur).\n\nCette fonctionnalité fonctionne uniquement lorsque [Renommer automatiquement les fichiers] est défini sur VRAI.","RENAME_LOCATE_DATE_INTRO":"Modifie le format de date de l'horodatage du fichier renommé selon l'heure locale du navigateur et le formate dans votre format de date régional préféré.\n\nCette fonctionnalité fonctionne uniquement lorsque [Renommer automatiquement les fichiers] est défini sur VRAI.","DISABLE_VIDEO_LOOPING_INTRO":"Désactiver la lecture automatique en boucle des vidéos dans les Reels et les posts.","HTML5_VIDEO_CONTROL_INTRO":"Afficher le contrôleur vidéo HTML5 dans la ressource vidéo.\n\nCela masquera le curseur de volume vidéo personnalisé et le remplacera par le contrôleur HTML5. Le contrôleur HTML5 peut être masqué en faisant un clic droit sur la vidéo pour révéler les détails d'origine.","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"Rediriger vers la page de profil d'un utilisateur en faisant un clic droit sur son avatar dans la zone des stories de la page d'accueil.\nSi vous cliquez avec le bouton central de la souris, cela s'ouvrira dans un nouvel onglet.","FORCE_FETCH_ALL_RESOURCES_INTRO":"Forcer la récupération de toutes les ressources (photos et vidéos) d'un post via l'API Instagram afin de supprimer la limite de trois ressources par post.","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"Télécharger directement les ressources actuellement disponibles dans le post.","DIRECT_DOWNLOAD_ALL_INTRO":"Lorsque vous cliquez sur le bouton de téléchargement, toutes les ressources du post seront récupérées et téléchargées de force.","MODIFY_VIDEO_VOLUME_INTRO":"Modifier le volume de lecture vidéo dans les Reels et les posts (clic droit pour ouvrir le curseur de réglage du volume).","SCROLL_BUTTON_INTRO":"Activer les boutons de défilement dans le coin inférieur droit de la page des Reels.","FORCE_RESOURCE_VIA_MEDIA_INTRO":"L'API Media essaiera d'obtenir la meilleure qualité possible pour les photos ou les vidéos, mais le chargement peut prendre plus de temps.","PREFER_DASH_MANIFEST_INTRO":"Préférer le manifeste DASH pour les ressources vidéo via l'API Media. Si un manifeste DASH est disponible, les flux vidéo et audio seront téléchargés SÉPARÉMENT pour obtenir la meilleure qualité possible.","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"Lorsque l'API Media atteint sa limite de débit ou ne peut pas être utilisée pour d'autres raisons, l'API de récupération forcée sera utilisée pour télécharger les ressources (la qualité des ressources peut être légèrement inférieure).","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"Le bouton [Ouvrir dans un nouvel onglet] dans les posts utilisera toujours l'API Media pour obtenir des ressources en haute résolution.","SKIP_VIEW_STORY_CONFIRM_INTRO":"Ignorer automatiquement lorsque la page de confirmation s'affiche dans une story ou un contenu à la une.","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"Cliquer automatiquement sur « Pas maintenant » dans la boîte de dialogue « X a partagé ceci avec vous » lors de l'ouverture de tout lien ?igsh=.","MODIFY_RESOURCE_EXIF_INTRO":"Modifier les attributs EXIF de la ressource image afin d'inclure des métadonnées telles que le lien du post, la date de prise de vue et l'auteur.","DIRECT_DOWNLOAD_STORY_INTRO":"Lorsque vous cliquez sur [Télécharger toutes les ressources], toutes les stories/contenus à la une sont téléchargés directement, sans afficher la boîte de dialogue de sélection des images.","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"Utilise un observateur pour capturer toutes les URL d'images de haute qualité de l'arborescence DOM dans le stockage du script, afin qu'elles puissent être extraites lorsqu'elles sont disponibles et à la demande de l'utilisateur.","HOTKEY_DEBUG_KEY":"Fenêtre de débogage","HOTKEY_SETTINGS_KEY":"Paramètres de préférences","HOTKEY_KEY_SETTINGS_KEY":"Paramètres des raccourcis clavier","HOTKEY_DOWNLOAD_STORY_KEY":"Télécharger la story","HOTKEY_CONFLICT_WARNING":"Ce raccourci clavier peut entrer en conflit avec d'autres paramètres.","HOTKEY_RESET":"Réinitialiser","USE_EXTERNAL_DOWNLOAD_MODE":"Utiliser le mode de téléchargement externe","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"L'activation de cette fonctionnalité permettra au script d'utiliser des fonctions de téléchargement étendues (telles que GM_download) pour télécharger des fichiers, ce qui résout le problème des fichiers manquants lors du téléchargement de plusieurs fichiers.\n\nRemarque : L'activation de cette fonctionnalité peut empêcher le bon fonctionnement de la fonction de renommage des fichiers. Assurez-vous que le mode de téléchargement dans les paramètres des fonctionnalités étendues est défini sur Natif."},
        "id": {"RELOAD_SCRIPT":"Muat ulang skrip","IMAGE_VIEWER":"Buka gambar di penampil","NEW_TAB":"Buka di tab baru","SHOW_DOM_TREE":"Tampilkan pohon DOM","SELECT_AND_COPY":"Pilih semua dan salin dari kotak input","DOWNLOAD_DOM_TREE":"Unduh pohon DOM sebagai file teks","REPORT_GITHUB":"Laporkan masalah di GitHub","DEBUG":"Jendela debug","CLOSE":"Tutup","ALL_CHECK":"Pilih semua","ITEM_COUNT_SINGULAR":"%COUNT% item","ITEM_COUNT_PLURAL":"%COUNT% item","ITEM_POSITION":"Item %CURRENT% dari %TOTAL%","SELECTED_COUNT_SINGULAR":"%COUNT% dipilih","SELECTED_COUNT_PLURAL":"%COUNT% dipilih","BATCH_DOWNLOAD_SELECTED":"Unduh sumber daya yang dipilih","BATCH_DOWNLOAD_DIRECT":"Unduh semua sumber daya","IMG":"Gambar","VID":"Video","DW":"Unduh","DW_ALL":"Unduh semua sumber daya","VIDEO_THUMBNAIL":"Unduh thumbnail video","LOAD_BLOB_ONE":"Memuat media Blob...","LOAD_BLOB_MULTIPLE":"Memuat media Blob dan lainnya...","LOAD_BLOB_RELOAD":"Mendeteksi media Blob, memuat ulang...","NO_CHECK_RESOURCE":"Kamu harus memilih sumber daya untuk diunduh.","NO_VID_URL":"Tidak dapat menemukan URL video.","SETTING":"Pengaturan","AUTO_RENAME":"Ganti nama file secara otomatis (klik kanan untuk mengatur)","RENAME_PUBLISH_DATE":"Atur stempel waktu file yang diganti namanya ke tanggal publikasi sumber daya","RENAME_LOCATE_DATE":"Ubah format tanggal stempel waktu file yang diganti namanya (klik kanan untuk mengatur)","DISABLE_VIDEO_LOOPING":"Nonaktifkan pemutaran video berulang otomatis","HTML5_VIDEO_CONTROL":"Tampilkan kontrol video HTML5","REDIRECT_CLICK_USER_STORY_PICTURE":"Alihkan saat mengklik foto cerita pengguna","FORCE_FETCH_ALL_RESOURCES":"Paksa pengambilan semua sumber daya dalam postingan","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"Unduh langsung sumber daya yang terlihat dalam postingan","DIRECT_DOWNLOAD_ALL":"Unduh langsung semua sumber daya dalam postingan","DIRECT_DOWNLOAD_STORY":"Unduh langsung semua sumber daya dalam cerita/sorotan","MODIFY_VIDEO_VOLUME":"Ubah volume video (klik kanan untuk mengatur)","MODIFY_RESOURCE_EXIF":"Ubah properti EXIF sumber daya","SCROLL_BUTTON":"Aktifkan tombol gulir untuk halaman Reels","FORCE_RESOURCE_VIA_MEDIA":"Paksa pengambilan sumber daya melalui Media API","PREFER_DASH_MANIFEST":"Utamakan manifes DASH (video berkualitas lebih tinggi melalui Media API)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"Gunakan metode alternatif untuk mengunduh saat Media API tidak dapat diakses","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"Selalu gunakan Media API untuk [Buka di tab baru] dalam postingan","SKIP_VIEW_STORY_CONFIRM":"Lewati halaman konfirmasi untuk melihat cerita/sorotan","SKIP_SHARED_WITH_YOU_DIALOG":"Lewati dialog \"membagikan ini denganmu\" pada tautan profil yang dibagikan","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"Tangkap sumber daya gambar menggunakan cache media","AUTO_RENAME_INTRO":["Ganti nama file secara otomatis ke format khusus:","Daftar format khusus:","%USERNAME% - Nama pengguna","%SOURCE_TYPE% - Sumber unduhan","%SHORTCODE% - Shortcode postingan","%YEAR% - Tahun saat diunduh/dipublikasikan","%2-YEAR% - Tahun (dua digit terakhir) saat diunduh/dipublikasikan","%MONTH% - Bulan saat diunduh/dipublikasikan","%DAY% - Hari saat diunduh/dipublikasikan","%HOUR% - Jam saat diunduh/dipublikasikan","%MINUTE% - Menit saat diunduh/dipublikasikan","%SECOND% - Detik saat diunduh/dipublikasikan","%ORIGINAL_NAME% - Nama asli file yang diunduh","%ORIGINAL_NAME_FIRST% - Nama asli file yang diunduh (bagian pertama nama)","%INDEX% - Indeks sumber daya","%UID% - ID unik akun pengguna","","Jika diatur ke false, nama file akan tetap tidak berubah.","Contoh: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"Mengatur stempel waktu dalam format penggantian nama file ke tanggal publikasi sumber daya (zona waktu browser).\n\nFitur ini hanya berfungsi saat [Ganti nama file secara otomatis] diatur ke TRUE.","RENAME_LOCATE_DATE_INTRO":"Mengubah format tanggal stempel waktu file yang diganti namanya ke waktu lokal browser dan memformatnya ke format tanggal regional yang kamu inginkan.\n\nFitur ini hanya berfungsi saat [Ganti nama file secara otomatis] diatur ke TRUE.","DISABLE_VIDEO_LOOPING_INTRO":"Nonaktifkan pemutaran video berulang otomatis di Reels dan postingan.","HTML5_VIDEO_CONTROL_INTRO":"Tampilkan kontrol video HTML5 pada sumber daya video.\n\nIni akan menyembunyikan penggeser volume khusus dan menggantinya dengan kontrol HTML5. Kontrol HTML5 dapat disembunyikan dengan mengklik kanan video untuk menampilkan detail asli.","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"Alihkan ke halaman profil pengguna saat kamu mengklik kanan avatar mereka di area cerita pada beranda.\nJika kamu menggunakan tombol tengah mouse untuk mengklik, itu akan terbuka di tab baru.","FORCE_FETCH_ALL_RESOURCES_INTRO":"Paksa pengambilan semua sumber daya (foto dan video) dalam postingan melalui API Instagram untuk menghapus batas tiga sumber daya per postingan.","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"Unduh langsung sumber daya yang saat ini tersedia dalam postingan.","DIRECT_DOWNLOAD_ALL_INTRO":"Saat kamu mengklik tombol unduh, semua sumber daya dalam postingan akan diambil dan diunduh secara paksa.","MODIFY_VIDEO_VOLUME_INTRO":"Ubah volume pemutaran video di Reels dan postingan (klik kanan untuk membuka penggeser pengaturan volume).","SCROLL_BUTTON_INTRO":"Aktifkan tombol gulir di sudut kanan bawah halaman Reels.","FORCE_RESOURCE_VIA_MEDIA_INTRO":"Media API akan mencoba mendapatkan foto atau video dengan kualitas setinggi mungkin, tetapi pemuatannya mungkin memerlukan waktu lebih lama.","PREFER_DASH_MANIFEST_INTRO":"Utamakan manifes DASH untuk sumber daya video melalui Media API. Jika manifes DASH tersedia, aliran video dan audio akan diunduh SECARA TERPISAH untuk mendapatkan kualitas terbaik yang memungkinkan.","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"Saat Media API mencapai batas laju permintaan atau tidak dapat digunakan karena alasan lain, Forced Fetch API akan digunakan untuk mengunduh sumber daya (kualitas sumber daya mungkin sedikit lebih rendah).","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"Tombol [Buka di tab baru] dalam postingan akan selalu menggunakan Media API untuk mendapatkan sumber daya beresolusi tinggi.","SKIP_VIEW_STORY_CONFIRM_INTRO":"Lewati secara otomatis saat halaman konfirmasi ditampilkan dalam cerita atau sorotan.","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"Klik otomatis \"Tidak sekarang\" pada dialog \"X membagikan ini denganmu\" saat membuka tautan ?igsh= apa pun.","MODIFY_RESOURCE_EXIF_INTRO":"Ubah atribut EXIF sumber daya gambar untuk menyertakan metadata seperti tautan postingan, tanggal pengambilan, dan penulis.","DIRECT_DOWNLOAD_STORY_INTRO":"Saat kamu mengklik [Unduh semua sumber daya], semua cerita/sorotan diunduh langsung tanpa menampilkan dialog pemilihan gambar.","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"Gunakan pemantau untuk menangkap URL gambar berkualitas tinggi apa pun di pohon DOM ke penyimpanan skrip, sehingga dapat diekstrak saat tersedia dan atas input pengguna.","HOTKEY_DEBUG_KEY":"Jendela debug","HOTKEY_SETTINGS_KEY":"Pengaturan preferensi","HOTKEY_KEY_SETTINGS_KEY":"Pengaturan tombol pintas","HOTKEY_DOWNLOAD_STORY_KEY":"Unduh cerita","HOTKEY_CONFLICT_WARNING":"Tombol pintas ini mungkin bertentangan dengan pengaturan lain.","HOTKEY_RESET":"Atur ulang","USE_EXTERNAL_DOWNLOAD_MODE":"Gunakan Mode Unduhan Eksternal","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"Mengaktifkan fitur ini akan membuat skrip menggunakan fungsi unduhan lanjutan (seperti GM_download) untuk mengunduh file, sehingga mengatasi masalah file yang hilang saat mengunduh beberapa file.\n\nHarap diperhatikan: Mengaktifkan fitur ini dapat menyebabkan fungsi penggantian nama file tidak berfungsi dengan baik. Pastikan mode unduhan di pengaturan fitur lanjutan diatur ke Native."},
        "it": {"RELOAD_SCRIPT":"Ricarica script","IMAGE_VIEWER":"Apri immagine nel visualizzatore","NEW_TAB":"Apri in una nuova scheda","SHOW_DOM_TREE":"Mostra albero DOM","SELECT_AND_COPY":"Seleziona tutto e copia dalla casella di input","DOWNLOAD_DOM_TREE":"Scarica l'albero DOM come file di testo","REPORT_GITHUB":"Segnala un problema su GitHub","DEBUG":"Finestra di debug","CLOSE":"Chiudi","ALL_CHECK":"Seleziona tutto","ITEM_COUNT_SINGULAR":"%COUNT% elemento","ITEM_COUNT_PLURAL":"%COUNT% elementi","ITEM_POSITION":"Elemento %CURRENT% di %TOTAL%","SELECTED_COUNT_SINGULAR":"%COUNT% selezionato","SELECTED_COUNT_PLURAL":"%COUNT% selezionati","BATCH_DOWNLOAD_SELECTED":"Scarica le risorse selezionate","BATCH_DOWNLOAD_DIRECT":"Scarica tutte le risorse","IMG":"Immagine","VID":"Video","DW":"Scarica","DW_ALL":"Scarica tutte le risorse","VIDEO_THUMBNAIL":"Scarica miniatura del video","LOAD_BLOB_ONE":"Caricamento media Blob...","LOAD_BLOB_MULTIPLE":"Caricamento media Blob e altri...","LOAD_BLOB_RELOAD":"Rilevamento media Blob, ricaricamento...","NO_CHECK_RESOURCE":"Devi selezionare una risorsa da scaricare.","NO_VID_URL":"Impossibile trovare l'URL del video.","SETTING":"Impostazioni","AUTO_RENAME":"Rinomina automaticamente i file (clic destro per impostare)","RENAME_PUBLISH_DATE":"Imposta il timestamp del file rinominato sulla data di pubblicazione della risorsa","RENAME_LOCATE_DATE":"Modifica il formato della data del timestamp del file rinominato (clic destro per impostare)","DISABLE_VIDEO_LOOPING":"Disabilita il loop automatico del video","HTML5_VIDEO_CONTROL":"Mostra i controlli video HTML5","REDIRECT_CLICK_USER_STORY_PICTURE":"Reindirizza quando si clicca sull'immagine della storia dell'utente","FORCE_FETCH_ALL_RESOURCES":"Forza il recupero di tutte le risorse nel post","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"Scarica direttamente le risorse visibili nel post","DIRECT_DOWNLOAD_ALL":"Scarica direttamente tutte le risorse nel post","DIRECT_DOWNLOAD_STORY":"Scarica direttamente tutte le risorse nella storia/in evidenza","MODIFY_VIDEO_VOLUME":"Modifica il volume del video (clic destro per impostare)","MODIFY_RESOURCE_EXIF":"Modifica le proprietà EXIF della risorsa","SCROLL_BUTTON":"Abilita pulsanti di scorrimento per la pagina Reels","FORCE_RESOURCE_VIA_MEDIA":"Forza il recupero della risorsa tramite Media API","PREFER_DASH_MANIFEST":"Preferisci il manifest DASH (video di qualità superiore tramite Media API)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"Usa metodi alternativi di download quando la Media API non è accessibile","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"Usa sempre la Media API per [Apri in una nuova scheda] nei post","SKIP_VIEW_STORY_CONFIRM":"Salta la pagina di conferma per visualizzare una storia/un contenuto in evidenza","SKIP_SHARED_WITH_YOU_DIALOG":"Salta la finestra di dialogo \"ha condiviso con te\" nei link profilo condivisi","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"Cattura la risorsa immagine usando la cache dei media","AUTO_RENAME_INTRO":["Rinomina automaticamente il file con un formato personalizzato:","Elenco dei formati personalizzati:","%USERNAME% - Nome utente","%SOURCE_TYPE% - Origine del download","%SHORTCODE% - Shortcode del post","%YEAR% - Anno di download/pubblicazione","%2-YEAR% - Anno (ultime due cifre) di download/pubblicazione","%MONTH% - Mese di download/pubblicazione","%DAY% - Giorno di download/pubblicazione","%HOUR% - Ora di download/pubblicazione","%MINUTE% - Minuto di download/pubblicazione","%SECOND% - Secondo di download/pubblicazione","%ORIGINAL_NAME% - Nome originale del file scaricato","%ORIGINAL_NAME_FIRST% - Nome originale del file scaricato (prima parte del nome)","%INDEX% - Indice della risorsa","%UID% - ID univoco dell'account utente","","Se impostato su false, il nome del file rimarrà invariato.","Esempio: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"Imposta il timestamp nel formato di rinomina del file sulla data di pubblicazione della risorsa (fuso orario del browser).\n\nQuesta funzione funziona solo quando [Rinomina automaticamente i file] è impostato su TRUE.","RENAME_LOCATE_DATE_INTRO":"Modifica il formato della data del timestamp del file rinominato sull'ora locale del browser e lo formatta secondo il formato regionale preferito.\n\nQuesta funzione funziona solo quando [Rinomina automaticamente i file] è impostato su TRUE.","DISABLE_VIDEO_LOOPING_INTRO":"Disabilita il loop automatico dei video nei Reels e nei post.","HTML5_VIDEO_CONTROL_INTRO":"Mostra i controlli video HTML5 nella risorsa video.\n\nQuesto nasconderà il cursore personalizzato del volume e lo sostituirà con il controller HTML5. Il controller HTML5 può essere nascosto facendo clic con il tasto destro sul video per mostrare i dettagli originali.","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"Reindirizza al profilo dell'utente quando fai clic con il tasto destro sul suo avatar nell'area delle storie nella homepage.\nSe usi il tasto centrale del mouse, si aprirà in una nuova scheda.","FORCE_FETCH_ALL_RESOURCES_INTRO":"Forza il recupero di tutte le risorse (foto e video) in un post tramite l'API di Instagram per rimuovere il limite di tre risorse per post.","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"Scarica direttamente le risorse attualmente disponibili nel post.","DIRECT_DOWNLOAD_ALL_INTRO":"Quando clicchi il pulsante di download, tutte le risorse del post verranno recuperate e scaricate forzatamente.","MODIFY_VIDEO_VOLUME_INTRO":"Modifica il volume di riproduzione dei video nei Reels e nei post (clic destro per aprire il cursore delle impostazioni del volume).","SCROLL_BUTTON_INTRO":"Abilita i pulsanti di scorrimento nell'angolo in basso a destra della pagina Reels.","FORCE_RESOURCE_VIA_MEDIA_INTRO":"La Media API proverà a ottenere la foto o il video della qualità più alta possibile, ma il caricamento potrebbe richiedere più tempo.","PREFER_DASH_MANIFEST_INTRO":"Preferisci il manifest DASH per le risorse video tramite la Media API. Se è disponibile un manifest DASH, il video e l'audio verranno scaricati SEPARATAMENTE per ottenere la migliore qualità possibile.","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"Quando la Media API raggiunge il limite di richieste o non può essere usata per altri motivi, verrà usata la Forced Fetch API per scaricare le risorse (la qualità della risorsa potrebbe essere leggermente inferiore).","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"Il pulsante [Apri in una nuova scheda] nei post userà sempre la Media API per ottenere risorse ad alta risoluzione.","SKIP_VIEW_STORY_CONFIRM_INTRO":"Salta automaticamente la pagina di conferma quando viene mostrata in una storia o in un contenuto in evidenza.","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"Clicca automaticamente su \"Non ora\" nella finestra di dialogo \"X ha condiviso con te\" quando apri qualsiasi link ?igsh=.","MODIFY_RESOURCE_EXIF_INTRO":"Modifica gli attributi EXIF della risorsa immagine per includere metadati come il link del post, la data dello scatto e l'autore.","DIRECT_DOWNLOAD_STORY_INTRO":"Quando clicchi su [Scarica tutte le risorse], tutte le storie/i contenuti in evidenza vengono scaricati direttamente, senza mostrare la finestra di selezione delle immagini.","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"Usa un watcher per catturare nella memoria dello script eventuali URL di immagini ad alta qualità presenti nell'albero DOM, in modo che possano essere estratti quando disponibili e su richiesta dell'utente.","HOTKEY_DEBUG_KEY":"Finestra di debug","HOTKEY_SETTINGS_KEY":"Impostazioni preferenze","HOTKEY_KEY_SETTINGS_KEY":"Impostazioni scorciatoie da tastiera","HOTKEY_DOWNLOAD_STORY_KEY":"Scarica storia","HOTKEY_CONFLICT_WARNING":"Questa scorciatoia da tastiera potrebbe entrare in conflitto con altre impostazioni.","HOTKEY_RESET":"Reimposta","USE_EXTERNAL_DOWNLOAD_MODE":"Usa la modalità di download esterna","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"L'attivazione di questa funzione farà sì che lo script utilizzi funzioni di download avanzate (come GM_download) per scaricare i file, risolvendo il problema dei file mancanti durante il download di più file.\n\nNota: L'attivazione di questa funzione potrebbe compromettere il corretto funzionamento della funzione di rinomina dei file. Assicurati che la modalità di download nelle impostazioni delle funzionalità avanzate sia impostata su Nativa."},
        "ja": {"RELOAD_SCRIPT":"スクリプトを再読み込み","IMAGE_VIEWER":"ビューアーで画像を開く","NEW_TAB":"新しいタブで開く","SHOW_DOM_TREE":"DOM ツリーを表示","SELECT_AND_COPY":"入力ボックスからすべて選択してコピー","DOWNLOAD_DOM_TREE":"DOM ツリーをテキストファイルとしてダウンロード","REPORT_GITHUB":"GitHub で問題を報告","DEBUG":"デバッグウィンドウ","CLOSE":"閉じる","ALL_CHECK":"すべて選択","ITEM_COUNT_SINGULAR":"%COUNT% 件の項目","ITEM_COUNT_PLURAL":"%COUNT% 件の項目","ITEM_POSITION":"%TOTAL% 件中 %CURRENT% 件目","SELECTED_COUNT_SINGULAR":"%COUNT% 件選択済み","SELECTED_COUNT_PLURAL":"%COUNT% 件選択済み","BATCH_DOWNLOAD_SELECTED":"選択したリソースをダウンロード","BATCH_DOWNLOAD_DIRECT":"すべてのリソースをダウンロード","IMG":"画像","VID":"動画","DW":"ダウンロード","DW_ALL":"すべてのリソースをダウンロード","VIDEO_THUMBNAIL":"動画のサムネイルをダウンロード","LOAD_BLOB_ONE":"Blob メディアを読み込み中...","LOAD_BLOB_MULTIPLE":"Blob メディアとその他を読み込み中...","LOAD_BLOB_RELOAD":"Blob メディアを検出中、再読み込みしています...","NO_CHECK_RESOURCE":"ダウンロードするリソースを選択する必要があります。","NO_VID_URL":"動画の URL が見つかりません。","SETTING":"設定","AUTO_RENAME":"ファイルを自動的に名前変更（右クリックで設定）","RENAME_PUBLISH_DATE":"名前変更したファイルのタイムスタンプをリソースの公開日に設定","RENAME_LOCATE_DATE":"名前変更したファイルのタイムスタンプの日付形式を変更（右クリックで設定）","DISABLE_VIDEO_LOOPING":"動画の自動ループ再生を無効化","HTML5_VIDEO_CONTROL":"HTML5 動画コントローラーを表示","REDIRECT_CLICK_USER_STORY_PICTURE":"ユーザーのストーリー画像をクリックしたときにリダイレクト","FORCE_FETCH_ALL_RESOURCES":"投稿内のすべてのリソースを強制取得","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"投稿内の表示中のリソースを直接ダウンロード","DIRECT_DOWNLOAD_ALL":"投稿内のすべてのリソースを直接ダウンロード","DIRECT_DOWNLOAD_STORY":"ストーリー／ハイライト内のすべてのリソースを直接ダウンロード","MODIFY_VIDEO_VOLUME":"動画の音量を変更（右クリックで設定）","MODIFY_RESOURCE_EXIF":"リソースの EXIF プロパティを変更","SCROLL_BUTTON":"リールページのスクロールボタンを有効化","FORCE_RESOURCE_VIA_MEDIA":"Media API 経由でリソースを強制取得","PREFER_DASH_MANIFEST":"DASH マニフェストを優先（Media API 経由で高品質動画）","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"Media API にアクセスできない場合は代替方法でダウンロード","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"投稿内の「新しいタブで開く」では常に Media API を使用","SKIP_VIEW_STORY_CONFIRM":"ストーリー／ハイライトを表示する確認ページをスキップ","SKIP_SHARED_WITH_YOU_DIALOG":"共有プロフィールリンクの「あなたと共有しました」ダイアログをスキップ","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"Media Cache を使用して画像リソースをキャプチャ","AUTO_RENAME_INTRO":["ファイルをカスタム形式に自動的に名前変更します：","カスタム形式リスト：","%USERNAME% - ユーザー名","%SOURCE_TYPE% - ダウンロード元","%SHORTCODE% - 投稿のショートコード","%YEAR% - ダウンロード／公開された年","%2-YEAR% - ダウンロード／公開された年（下 2 桁）","%MONTH% - ダウンロード／公開された月","%DAY% - ダウンロード／公開された日","%HOUR% - ダウンロード／公開された時","%MINUTE% - ダウンロード／公開された分","%SECOND% - ダウンロード／公開された秒","%ORIGINAL_NAME% - ダウンロードしたファイルの元の名前","%ORIGINAL_NAME_FIRST% - ダウンロードしたファイルの元の名前（名前の最初の部分）","%INDEX% - リソースのインデックス","%UID% - ユーザーアカウントの一意の ID","","false に設定すると、ファイル名は変更されません。","例： instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"ファイル名変更形式内のタイムスタンプをリソースの公開日（ブラウザーのタイムゾーン）に設定します。\n\nこの機能は「ファイルを自動的に名前変更」が TRUE に設定されている場合にのみ動作します。","RENAME_LOCATE_DATE_INTRO":"名前変更したファイルのタイムスタンプの日付形式をブラウザーのローカル時刻に変更し、希望する地域の日付形式に整形します。\n\nこの機能は「ファイルを自動的に名前変更」が TRUE に設定されている場合にのみ動作します。","DISABLE_VIDEO_LOOPING_INTRO":"リールと投稿内の動画の自動ループ再生を無効にします。","HTML5_VIDEO_CONTROL_INTRO":"動画リソースに HTML5 動画コントローラーを表示します。\n\nこれにより、カスタム動画音量スライダーが非表示になり、HTML5 コントローラーに置き換えられます。HTML5 コントローラーは、動画を右クリックして元の詳細を表示することで非表示にできます。","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"ホームページのストーリーエリアでユーザーのアバターを右クリックしたとき、そのユーザーのプロフィールページにリダイレクトします。\nマウスの中ボタンでクリックすると、新しいタブで開きます。","FORCE_FETCH_ALL_RESOURCES_INTRO":"Instagram API 経由で投稿内のすべてのリソース（写真と動画）を強制取得し、投稿ごとの 3 件のリソース制限を解除します。","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"投稿内で現在利用可能なリソースを直接ダウンロードします。","DIRECT_DOWNLOAD_ALL_INTRO":"ダウンロードボタンをクリックすると、投稿内のすべてのリソースが強制的に取得され、ダウンロードされます。","MODIFY_VIDEO_VOLUME_INTRO":"リールと投稿内の動画再生音量を変更します（右クリックで音量設定スライダーを開きます）。","SCROLL_BUTTON_INTRO":"リールページの右下隅にスクロールボタンを有効にします。","FORCE_RESOURCE_VIA_MEDIA_INTRO":"Media API は可能な限り最高品質の写真または動画を取得しようとしますが、読み込みに時間がかかる場合があります。","PREFER_DASH_MANIFEST_INTRO":"Media API 経由の動画リソースでは DASH マニフェストを優先します。DASH マニフェストが利用可能な場合、最高品質を得るために動画ストリームと音声ストリームを別々にダウンロードします。","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"Media API がレート制限に達した場合、またはその他の理由で使用できない場合、Forced Fetch API を使用してリソースをダウンロードします（リソースの品質はやや低くなる場合があります）。","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"投稿内の「新しいタブで開く」ボタンは、高解像度リソースを取得するために常に Media API を使用します。","SKIP_VIEW_STORY_CONFIRM_INTRO":"ストーリーまたはハイライトで確認ページが表示された場合、自動的にスキップします。","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"?igsh= リンクを開いたとき、「X があなたとこれを共有しました」ダイアログで「後で」を自動的にクリックします。","MODIFY_RESOURCE_EXIF_INTRO":"画像リソースの EXIF 属性を変更し、投稿リンク、撮影日、作成者などのメタデータを含めます。","DIRECT_DOWNLOAD_STORY_INTRO":"「すべてのリソースをダウンロード」をクリックすると、画像選択ダイアログを表示せずに、すべてのストーリー／ハイライトが直接ダウンロードされます。","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"ウォッチャーを使用して、DOM ツリー内の高品質画像 URL をスクリプトのストレージにキャプチャし、利用可能になったときやユーザー入力時に抽出できるようにします。","HOTKEY_DEBUG_KEY":"デバッグウィンドウ","HOTKEY_SETTINGS_KEY":"環境設定","HOTKEY_KEY_SETTINGS_KEY":"ホットキー設定","HOTKEY_DOWNLOAD_STORY_KEY":"ストーリーをダウンロード","HOTKEY_CONFLICT_WARNING":"このホットキーは他の設定と競合する可能性があります。","HOTKEY_RESET":"リセット","USE_EXTERNAL_DOWNLOAD_MODE":"外部ダウンロードモードを使用","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"この機能を有効にすると、スクリプトはファイルのダウンロードに GM_download などの拡張ダウンロード機能を使用するようになり、複数のファイルをダウンロードした際に一部のファイルが欠落する問題を解決します。\n\n注意: この機能を有効にすると、ファイル名変更機能が正常に動作しなくなる場合があります。拡張機能の設定で、ダウンロードモードが「ネイティブ」に設定されていることを確認してください。"},
        "ko": {"RELOAD_SCRIPT":"스크립트 다시 불러오기","IMAGE_VIEWER":"뷰어에서 이미지 열기","NEW_TAB":"새 탭에서 열기","SHOW_DOM_TREE":"DOM 트리 표시","SELECT_AND_COPY":"입력 상자에서 모두 선택하고 복사","DOWNLOAD_DOM_TREE":"DOM 트리를 텍스트 파일로 다운로드","REPORT_GITHUB":"GitHub에 문제 보고","DEBUG":"디버그 창","CLOSE":"닫기","ALL_CHECK":"모두 선택","ITEM_COUNT_SINGULAR":"%COUNT%개 항목","ITEM_COUNT_PLURAL":"%COUNT%개 항목","ITEM_POSITION":"%TOTAL%개 중 %CURRENT%번째 항목","SELECTED_COUNT_SINGULAR":"%COUNT%개 선택됨","SELECTED_COUNT_PLURAL":"%COUNT%개 선택됨","BATCH_DOWNLOAD_SELECTED":"선택한 리소스 다운로드","BATCH_DOWNLOAD_DIRECT":"모든 리소스 다운로드","IMG":"이미지","VID":"동영상","DW":"다운로드","DW_ALL":"모든 리소스 다운로드","VIDEO_THUMBNAIL":"동영상 썸네일 다운로드","LOAD_BLOB_ONE":"Blob 미디어를 불러오는 중...","LOAD_BLOB_MULTIPLE":"Blob 미디어 및 기타 항목을 불러오는 중...","LOAD_BLOB_RELOAD":"Blob 미디어 감지 중, 다시 불러오는 중...","NO_CHECK_RESOURCE":"다운로드할 리소스를 선택해야 합니다.","NO_VID_URL":"동영상 URL을 찾을 수 없습니다.","SETTING":"설정","AUTO_RENAME":"파일 자동 이름 변경(마우스 오른쪽 버튼으로 설정)","RENAME_PUBLISH_DATE":"이름이 변경된 파일의 타임스탬프를 리소스 게시일로 설정","RENAME_LOCATE_DATE":"이름이 변경된 파일 타임스탬프의 날짜 형식 수정(마우스 오른쪽 버튼으로 설정)","DISABLE_VIDEO_LOOPING":"동영상 자동 반복 재생 비활성화","HTML5_VIDEO_CONTROL":"HTML5 동영상 컨트롤러 표시","REDIRECT_CLICK_USER_STORY_PICTURE":"사용자의 스토리 사진을 클릭할 때 리디렉션","FORCE_FETCH_ALL_RESOURCES":"게시물의 모든 리소스 강제 가져오기","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"게시물의 표시된 리소스 직접 다운로드","DIRECT_DOWNLOAD_ALL":"게시물의 모든 리소스 직접 다운로드","DIRECT_DOWNLOAD_STORY":"스토리/하이라이트의 모든 리소스 직접 다운로드","MODIFY_VIDEO_VOLUME":"동영상 볼륨 수정(마우스 오른쪽 버튼으로 설정)","MODIFY_RESOURCE_EXIF":"리소스 EXIF 속성 수정","SCROLL_BUTTON":"릴스 페이지의 스크롤 버튼 활성화","FORCE_RESOURCE_VIA_MEDIA":"Media API를 통해 리소스 강제 가져오기","PREFER_DASH_MANIFEST":"DASH 매니페스트 선호(Media API를 통한 더 높은 품질의 동영상)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"Media API에 접근할 수 없을 때 대체 방법으로 다운로드","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"게시물의 [새 탭에서 열기]에 항상 Media API 사용","SKIP_VIEW_STORY_CONFIRM":"스토리/하이라이트 보기 확인 페이지 건너뛰기","SKIP_SHARED_WITH_YOU_DIALOG":"공유된 프로필 링크에서 “회원님과 공유했습니다” 대화 상자 건너뛰기","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"Media Cache를 사용하여 이미지 리소스 캡처","AUTO_RENAME_INTRO":["파일을 사용자 지정 형식으로 자동 이름 변경:","사용자 지정 형식 목록:","%USERNAME% - 사용자 이름","%SOURCE_TYPE% - 다운로드 소스","%SHORTCODE% - 게시물 숏코드","%YEAR% - 다운로드/게시된 연도","%2-YEAR% - 다운로드/게시된 연도(마지막 두 자리)","%MONTH% - 다운로드/게시된 월","%DAY% - 다운로드/게시된 일","%HOUR% - 다운로드/게시된 시","%MINUTE% - 다운로드/게시된 분","%SECOND% - 다운로드/게시된 초","%ORIGINAL_NAME% - 다운로드한 파일의 원래 이름","%ORIGINAL_NAME_FIRST% - 다운로드한 파일의 원래 이름(이름의 첫 부분)","%INDEX% - 리소스 인덱스","%UID% - 사용자 계정 고유 ID","","false로 설정하면 파일 이름이 변경되지 않습니다.","예: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"파일 이름 변경 형식의 타임스탬프를 리소스 게시일(브라우저 시간대)로 설정합니다.\n\n이 기능은 [파일 자동 이름 변경]이 TRUE로 설정된 경우에만 작동합니다.","RENAME_LOCATE_DATE_INTRO":"이름이 변경된 파일 타임스탬프의 날짜 형식을 브라우저의 현지 시간으로 수정하고, 원하는 지역 날짜 형식으로 지정합니다.\n\n이 기능은 [파일 자동 이름 변경]이 TRUE로 설정된 경우에만 작동합니다.","DISABLE_VIDEO_LOOPING_INTRO":"릴스와 게시물에서 동영상 자동 반복 재생을 비활성화합니다.","HTML5_VIDEO_CONTROL_INTRO":"동영상 리소스에 HTML5 동영상 컨트롤러를 표시합니다.\n\n이렇게 하면 사용자 지정 동영상 볼륨 슬라이더가 숨겨지고 HTML5 컨트롤러로 대체됩니다. 동영상을 마우스 오른쪽 버튼으로 클릭하여 원래 세부 정보를 표시하면 HTML5 컨트롤러를 숨길 수 있습니다.","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"홈페이지의 스토리 영역에서 사용자의 아바타를 마우스 오른쪽 버튼으로 클릭하면 해당 사용자의 프로필 페이지로 리디렉션합니다.\n마우스 가운데 버튼으로 클릭하면 새 탭에서 열립니다.","FORCE_FETCH_ALL_RESOURCES_INTRO":"Instagram API를 통해 게시물의 모든 리소스(사진 및 동영상)를 강제로 가져와 게시물당 리소스 3개 제한을 제거합니다.","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"게시물에서 현재 사용할 수 있는 리소스를 직접 다운로드합니다.","DIRECT_DOWNLOAD_ALL_INTRO":"다운로드 버튼을 클릭하면 게시물의 모든 리소스를 강제로 가져와 다운로드합니다.","MODIFY_VIDEO_VOLUME_INTRO":"릴스와 게시물의 동영상 재생 볼륨을 수정합니다(마우스 오른쪽 버튼으로 볼륨 설정 슬라이더 열기).","SCROLL_BUTTON_INTRO":"릴스 페이지의 오른쪽 아래 모서리에 스크롤 버튼을 활성화합니다.","FORCE_RESOURCE_VIA_MEDIA_INTRO":"Media API는 가능한 한 가장 높은 품질의 사진 또는 동영상을 가져오려고 하지만, 불러오는 데 시간이 더 걸릴 수 있습니다.","PREFER_DASH_MANIFEST_INTRO":"Media API를 통한 동영상 리소스에 DASH 매니페스트를 우선 사용합니다. DASH 매니페스트를 사용할 수 있으면 최상의 품질을 위해 동영상과 오디오 스트림을 별도로 다운로드합니다.","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"Media API가 속도 제한에 도달했거나 다른 이유로 사용할 수 없는 경우, Forced Fetch API를 사용하여 리소스를 다운로드합니다(리소스 품질이 약간 낮을 수 있음).","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"게시물의 [새 탭에서 열기] 버튼은 고해상도 리소스를 가져오기 위해 항상 Media API를 사용합니다.","SKIP_VIEW_STORY_CONFIRM_INTRO":"스토리 또는 하이라이트에서 확인 페이지가 표시되면 자동으로 건너뜁니다.","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"?igsh= 링크를 열 때 “X님이 회원님과 공유했습니다” 대화 상자에서 “나중에”를 자동으로 클릭합니다.","MODIFY_RESOURCE_EXIF_INTRO":"이미지 리소스의 EXIF 속성을 수정하여 게시물 링크, 촬영 날짜, 작성자 등의 메타데이터를 포함합니다.","DIRECT_DOWNLOAD_STORY_INTRO":"[모든 리소스 다운로드]를 클릭하면 이미지 선택 대화 상자를 표시하지 않고 모든 스토리/하이라이트가 직접 다운로드됩니다.","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"감시자를 사용하여 DOM 트리의 고품질 이미지 URL을 스크립트 저장소에 캡처하여, 사용 가능할 때와 사용자 입력 시 추출할 수 있도록 합니다.","HOTKEY_DEBUG_KEY":"디버그 창","HOTKEY_SETTINGS_KEY":"환경 설정","HOTKEY_KEY_SETTINGS_KEY":"단축키 설정","HOTKEY_DOWNLOAD_STORY_KEY":"스토리 다운로드","HOTKEY_CONFLICT_WARNING":"이 단축키는 다른 설정과 충돌할 수 있습니다.","HOTKEY_RESET":"초기화","USE_EXTERNAL_DOWNLOAD_MODE":"외부 다운로드 모드 사용","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"이 기능을 활성화하면 스크립트가 파일을 다운로드할 때 GM_download와 같은 확장 다운로드 기능을 사용하여 여러 파일을 다운로드할 때 일부 파일이 누락되는 문제를 해결합니다.\n\n참고: 이 기능을 활성화하면 파일 이름 변경 기능이 제대로 작동하지 않을 수 있습니다. 확장 기능 설정에서 다운로드 모드가 '기본(Native)'으로 설정되어 있는지 확인하세요."},
        "pt-BR": {"RELOAD_SCRIPT":"Recarregar script","IMAGE_VIEWER":"Abrir imagem no visualizador","NEW_TAB":"Abrir em nova aba","SHOW_DOM_TREE":"Mostrar árvore DOM","SELECT_AND_COPY":"Selecionar tudo e copiar da caixa de entrada","DOWNLOAD_DOM_TREE":"Baixar árvore DOM como arquivo de texto","REPORT_GITHUB":"Reportar um problema no GitHub","DEBUG":"Janela de depuração","CLOSE":"Fechar","ALL_CHECK":"Selecionar tudo","ITEM_COUNT_SINGULAR":"%COUNT% item","ITEM_COUNT_PLURAL":"%COUNT% itens","ITEM_POSITION":"Item %CURRENT% de %TOTAL%","SELECTED_COUNT_SINGULAR":"%COUNT% selecionado","SELECTED_COUNT_PLURAL":"%COUNT% selecionados","BATCH_DOWNLOAD_SELECTED":"Baixar recursos selecionados","BATCH_DOWNLOAD_DIRECT":"Baixar todos os recursos","IMG":"Imagem","VID":"Vídeo","DW":"Baixar","DW_ALL":"Baixar todos os recursos","VIDEO_THUMBNAIL":"Baixar miniatura do vídeo","LOAD_BLOB_ONE":"Carregando mídia Blob...","LOAD_BLOB_MULTIPLE":"Carregando mídia Blob e outros...","LOAD_BLOB_RELOAD":"Detectando mídia Blob, recarregando...","NO_CHECK_RESOURCE":"Você precisa selecionar um recurso para baixar.","NO_VID_URL":"Não foi possível encontrar o URL do vídeo.","SETTING":"Configurações","AUTO_RENAME":"Renomear arquivos automaticamente (clique com o botão direito para definir)","RENAME_PUBLISH_DATE":"Definir o carimbo de data/hora do arquivo renomeado para a data de publicação do recurso","RENAME_LOCATE_DATE":"Modificar o formato da data do carimbo de data/hora do arquivo renomeado (clique com o botão direito para definir)","DISABLE_VIDEO_LOOPING":"Desativar a reprodução automática em loop de vídeos","HTML5_VIDEO_CONTROL":"Exibir o controlador de vídeo HTML5","REDIRECT_CLICK_USER_STORY_PICTURE":"Redirecionar ao clicar na foto do perfil na story do usuário","FORCE_FETCH_ALL_RESOURCES":"Forçar a busca de todos os recursos na publicação","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"Baixar diretamente os recursos visíveis na publicação","DIRECT_DOWNLOAD_ALL":"Baixar diretamente todos os recursos na publicação","DIRECT_DOWNLOAD_STORY":"Baixar diretamente todos os recursos do story/destaque","MODIFY_VIDEO_VOLUME":"Modificar o volume do vídeo (clique com o botão direito para definir)","MODIFY_RESOURCE_EXIF":"Modificar propriedades EXIF do recurso","SCROLL_BUTTON":"Habilitar botões de rolagem para a página de Reels","FORCE_RESOURCE_VIA_MEDIA":"Forçar a busca de recursos via API de Mídia","PREFER_DASH_MANIFEST":"Preferir o manifesto DASH (vídeo de qualidade mais alta via API de Mídia)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"Usar métodos alternativos para baixar quando a API de Mídia não estiver acessível","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"Sempre usar a API de Mídia para [Abrir em nova aba] em publicações","SKIP_VIEW_STORY_CONFIRM":"Pular a página de confirmação ao visualizar um story/destaque","SKIP_SHARED_WITH_YOU_DIALOG":"Ignorar a caixa de diálogo \"compartilhou isso com você\" em links de perfil compartilhados","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"Capturar recurso de imagem usando o cache de mídia","AUTO_RENAME_INTRO":["Renomear automaticamente os arquivos para um formato personalizado:","Lista de formatos personalizados:","%USERNAME% - Nome de usuário","%SOURCE_TYPE% - Fonte do download","%SHORTCODE% - Código curto da publicação","%YEAR% - Ano de download/publicação","%2-YEAR% - Ano (dois últimos dígitos) de download/publicação","%MONTH% - Mês de download/publicação","%DAY% - Dia de download/publicação","%HOUR% - Hora de download/publicação","%MINUTE% - Minuto de download/publicação","%SECOND% - Segundo de download/publicação","%ORIGINAL_NAME% - Nome original do arquivo baixado","%ORIGINAL_NAME_FIRST% - Nome original do arquivo baixado (primeira parte do nome)","%INDEX% - Índice do recurso","%UID% - ID único da conta do usuário","","Se definido como falso, o nome do arquivo permanecerá inalterado.","Exemplo: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"Define o carimbo de data/hora no formato de renomeação de arquivo para a data de publicação do recurso (fuso horário do navegador).\n\nEsse recurso só funciona quando [Renomear arquivos automaticamente] está definido como VERDADEIRO.","RENAME_LOCATE_DATE_INTRO":"Modificar o formato da data do carimbo de data/hora do arquivo renomeado para a hora local do navegador e formatá-lo para o formato de data regional de sua preferência.\n\nEsse recurso só funciona quando [Renomear arquivos automaticamente] está definido como VERDADEIRO.","DISABLE_VIDEO_LOOPING_INTRO":"Desativar a reprodução automática em loop de vídeos em Reels e publicações.","HTML5_VIDEO_CONTROL_INTRO":"Exibir o controlador de vídeo HTML5 no recurso de vídeo.\n\nIsso ocultará o controle deslizante de volume de vídeo personalizado e o substituirá pelo controlador HTML5. O controlador HTML5 pode ser ocultado clicando com o botão direito do mouse no vídeo para revelar os detalhes originais.","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"Redirecionar para a página de perfil de um usuário ao clicar com o botão direito do mouse em seu avatar na área de stories na página inicial.\nSe você usar o botão do meio do mouse para clicar, ele será aberto em uma nova aba.","FORCE_FETCH_ALL_RESOURCES_INTRO":"Forçar a busca de todos os recursos (fotos e vídeos) em uma publicação por meio da API do Instagram para remover o limite de três recursos por publicação.","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"Baixar diretamente os recursos atuais disponíveis na publicação.","DIRECT_DOWNLOAD_ALL_INTRO":"Ao clicar no botão de download, todos os recursos da publicação serão forçados a serem buscados e baixados.","MODIFY_VIDEO_VOLUME_INTRO":"Modificar o volume de reprodução de vídeo em Reels e publicações (clique com o botão direito do mouse para abrir o controle deslizante de configuração de volume).","SCROLL_BUTTON_INTRO":"Habilitar botões de rolagem para o canto inferior direito da página de Reels.","FORCE_RESOURCE_VIA_MEDIA_INTRO":"A API de Mídia tentará obter a foto ou o vídeo da mais alta qualidade possível, mas pode demorar mais para carregar.","PREFER_DASH_MANIFEST_INTRO":"Dar preferência ao manifesto DASH para recursos de vídeo via API de Mídia. Se um manifesto DASH estiver disponível, ele baixará os fluxos de vídeo e áudio SEPARADAMENTE para obter a melhor qualidade possível.","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"Quando a API de Mídia atingir seu limite de requisições ou não puder ser usada por outros motivos, a API de Busca Forçada será usada para baixar recursos (a qualidade do recurso pode ser um pouco menor).","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"O botão [Abrir em nova aba] nas publicações sempre usará a API de Mídia para obter recursos de alta resolução.","SKIP_VIEW_STORY_CONFIRM_INTRO":"Pular automaticamente quando a página de confirmação for exibida na story ou no destaque.","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"Ao abrir qualquer link ?igsh=, clica automaticamente em \"Agora não\" na caixa de diálogo \"X compartilhou isso com você\".","MODIFY_RESOURCE_EXIF_INTRO":"Modificar os atributos EXIF do recurso de imagem para incluir metadados como link da publicação, data de captura e autor.","DIRECT_DOWNLOAD_STORY_INTRO":"Ao clicar em [Baixar todos os recursos], todos os stories/destaques são baixados diretamente, sem exibir a caixa de diálogo de seleção de imagens.","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"Usar um observador para capturar quaisquer URLs de imagens de alta qualidade da árvore DOM no armazenamento do script, para que possam ser extraídos quando estiverem disponíveis e mediante ação do usuário.","HOTKEY_DEBUG_KEY":"Janela de depuração","HOTKEY_SETTINGS_KEY":"Configurações de preferência","HOTKEY_KEY_SETTINGS_KEY":"Configurações de atalhos de teclado","HOTKEY_DOWNLOAD_STORY_KEY":"Baixar story","HOTKEY_CONFLICT_WARNING":"Este atalho de teclado pode entrar em conflito com outras configurações.","HOTKEY_RESET":"Redefinir","USE_EXTERNAL_DOWNLOAD_MODE":"Usar modo de download externo","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"Ativar este recurso fará com que o script utilize funções de download estendidas (como GM_download) para baixar arquivos, resolvendo o problema de arquivos ausentes ao baixar vários arquivos.\n\nObservação: Ativar este recurso pode fazer com que a função de renomeação de arquivos não funcione corretamente. Certifique-se de que o modo de download nas configurações dos recursos estendidos esteja definido como Nativo."},
        "ro": {"RELOAD_SCRIPT":"Reîncarcă scriptul","IMAGE_VIEWER":"Deschide imaginea în vizualizator","NEW_TAB":"Deschide într-o filă nouă","SHOW_DOM_TREE":"Afișează arborele DOM","SELECT_AND_COPY":"Selectează tot și copiază din caseta de introducere","DOWNLOAD_DOM_TREE":"Descarcă arborele DOM ca fișier text","REPORT_GITHUB":"Raportează o problemă pe GitHub","DEBUG":"Fereastră de depanare","CLOSE":"Închide","ALL_CHECK":"Selectează toate","ITEM_COUNT_SINGULAR":"%COUNT% element","ITEM_COUNT_PLURAL":"%COUNT% elemente","ITEM_POSITION":"Elementul %CURRENT% din %TOTAL%","SELECTED_COUNT_SINGULAR":"%COUNT% selectat","SELECTED_COUNT_PLURAL":"%COUNT% selectate","BATCH_DOWNLOAD_SELECTED":"Descarcă resursele selectate","BATCH_DOWNLOAD_DIRECT":"Descarcă toate resursele","IMG":"Imagine","VID":"Videoclip","DW":"Descarcă","DW_ALL":"Descarcă toate resursele","VIDEO_THUMBNAIL":"Descarcă miniatura videoclipului","LOAD_BLOB_ONE":"Se încarcă conținutul media în format Blob...","LOAD_BLOB_MULTIPLE":"Se încarcă conținutul media în format Blob și celelalte...","LOAD_BLOB_RELOAD":"Se detectează conținutul media în format Blob, se reîncarcă...","NO_CHECK_RESOURCE":"Trebuie să selectezi o resursă pentru a o descărca.","NO_VID_URL":"Nu se poate găsi URL-ul videoclipului.","SETTING":"Setări","AUTO_RENAME":"Redenumește automat fișierele (clic dreapta pentru a seta)","RENAME_PUBLISH_DATE":"Setează marcajul de timp al fișierelor redenumite la data publicării resurselor","RENAME_LOCATE_DATE":"Modifică formatul de dată al marcajului de timp pentru fișierele redenumite (clic dreapta pentru a seta)","DISABLE_VIDEO_LOOPING":"Dezactivează redarea automată în buclă a videoclipurilor","HTML5_VIDEO_CONTROL":"Afișează controllerul video HTML5","REDIRECT_CLICK_USER_STORY_PICTURE":"Redirecționează când dai clic pe fotografia profilului în storyul utilizatorului","FORCE_FETCH_ALL_RESOURCES":"Forțează preluarea tuturor resurselor din postare","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"Descarcă direct resursele vizibile din postare","DIRECT_DOWNLOAD_ALL":"Descarcă direct toate resursele din postare","DIRECT_DOWNLOAD_STORY":"Descarcă direct toate resursele din story/highlight","MODIFY_VIDEO_VOLUME":"Modifică volumul videoclipurilor (clic dreapta pentru a seta)","MODIFY_RESOURCE_EXIF":"Modifică proprietățile EXIF ale resurselor","SCROLL_BUTTON":"Activează butoanele de derulare pentru pagina Reels","FORCE_RESOURCE_VIA_MEDIA":"Forțează preluarea resurselor prin Media API","PREFER_DASH_MANIFEST":"Preferă manifestul DASH (videoclipuri de calitate mai înaltă prin Media API)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"Folosește metode alternative pentru descărcare când Media API nu este accesibil","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"Folosește întotdeauna Media API pentru [Deschide într-o filă nouă] în postări","SKIP_VIEW_STORY_CONFIRM":"Omite pagina de confirmare pentru vizualizarea unui story/highlight","SKIP_SHARED_WITH_YOU_DIALOG":"Omite caseta de dialog „a partajat asta cu tine” la linkurile de profil partajate","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"Capturează resursele de tip imagine folosind cache-ul media","AUTO_RENAME_INTRO":["Redenumește automat fișierele într-un format personalizat:","Listă de formaturi personalizate:","%USERNAME% - Numele de utilizator","%SOURCE_TYPE% - Sursa descărcării","%SHORTCODE% - Codul scurt al postării\\","%YEAR% - Anul descărcării/publicării","%2-YEAR% - Anul (ultimele două cifre) descărcării/publicării","%MONTH% - Luna descărcării/publicării","%DAY% - Ziua descărcării/publicării","%HOUR% - Ora descărcării/publicării","%MINUTE% - Minutul descărcării/publicării","%SECOND% - Secunda descărcării/publicării","%ORIGINAL_NAME% - Numele original al fișierului descărcat","%ORIGINAL_NAME_FIRST% - Numele original al fișierului descărcat (prima parte a numelui)","%INDEX% - Indexul resursei","%UID% - ID-ul unic al contului de utilizator","","Dacă este setat pe fals, numele fișierului va rămâne neschimbat.","Exemplu: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"Setează marcajul de timp din formatul de redenumire a fișierelor la data publicării resurselor (fusul orar al browserului).\n\nAceastă funcție funcționează numai când [Redenumește automat fișierele] este setată pe ADEVĂRAT.","RENAME_LOCATE_DATE_INTRO":"Modifică formatul datei marcajului de timp al fișierelor redenumite la ora locală a browserului și formateaz-o în formatul regional de dată preferat.\n\nAceastă funcție funcționează numai când [Redenumește automat fișierele] este setată pe ADEVĂRAT.","DISABLE_VIDEO_LOOPING_INTRO":"Dezactivează redarea automată în buclă a videoclipurilor din Reels și postări.","HTML5_VIDEO_CONTROL_INTRO":"Afișează controllerul video HTML5 la resursele video.\n\nAcest lucru va ascunde glisorul personalizat pentru volum și îl va înlocui cu controllerul HTML5. Controlerul HTML5 poate fi ascuns dând clic dreapta pe videoclip pentru a arăta detaliile originale.","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"Redirecționează spre pagina de profil a unui utilizator când dai clic dreapta pe avatarul acestuia în zona de storyuri de pe pagina principală.\nDacă folosești butonul din mijloc al mouse-ului pentru a da clic, se va deschide într-o filă nouă.","FORCE_FETCH_ALL_RESOURCES_INTRO":"Forțează preluarea tuturor resurselor (fotografii și videoclipuri) dintr-o postare prin API-ul Instagram pentru a elimina limita de trei resurse per postare.","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"Descarcă direct resursele actuale disponibile în postare.","DIRECT_DOWNLOAD_ALL_INTRO":"Când dai clic pe butonul de descărcare, toate resursele din postare vor fi preluate și descărcate forțat.","MODIFY_VIDEO_VOLUME_INTRO":"Modifică volumul de redare al videoclipurilor din Reels și postări (clic dreapta pentru a deschide glisorul pentru setarea volumului).","SCROLL_BUTTON_INTRO":"Activează butoanele de derulare în colțul din dreapta jos al paginii Reels.","FORCE_RESOURCE_VIA_MEDIA_INTRO":"Media API va încerca să obțină fotografia sau videoclipul la cea mai înaltă calitate posibilă, dar încărcarea poate dura mai mult.","PREFER_DASH_MANIFEST_INTRO":"Preferă manifestul DASH pentru resursele video prin Media API. Dacă este disponibil un manifest DASH, va descărca fluxurile video și audio SEPARAT pentru cea mai bună calitate posibilă.","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"Când Media API atinge limita de rată sau nu poate fi folosit din alte motive, Forced Fetch API va fi folosit pentru a descărca resursele (calitatea resurselor poate fi puțin mai scăzută).","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"Butonul [Deschide într-o filă nouă] din postări va folosi întotdeauna Media API pentru a obține resurse la rezoluție înaltă.","SKIP_VIEW_STORY_CONFIRM_INTRO":"Omite automat atunci când pagina de confirmare este afișată într-un story sau highlight.","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"Dă clic automat pe „Nu acum” în caseta de dialog „X a partajat asta cu tine” când se deschide orice link ?igsh=.","MODIFY_RESOURCE_EXIF_INTRO":"Modifică atributele EXIF ale resurselor de tip imagine pentru a include metadate precum linkul postării, data capturării și autorul.","DIRECT_DOWNLOAD_STORY_INTRO":"Când dai clic pe [Descarcă toate resursele], toate storyurile/highlighturile sunt descărcate direct, fără a afișa caseta de dialog de selectare a resurselor.","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"Folosește un observator pentru a captura orice URL-uri ale imaginilor de înaltă calitate din arborele DOM în spațiul de stocare al scriptului, astfel încât acestea să poată fi extrase când sunt disponibile și la intervenția utilizatorului.","HOTKEY_DEBUG_KEY":"Fereastră de depanare","HOTKEY_SETTINGS_KEY":"Setări de preferințe","HOTKEY_KEY_SETTINGS_KEY":"Setări pentru taste rapide","HOTKEY_DOWNLOAD_STORY_KEY":"Descarcă storyul","HOTKEY_CONFLICT_WARNING":"Această tastă rapidă poate intra în conflict cu alte setări.","HOTKEY_RESET":"Resetează","USE_EXTERNAL_DOWNLOAD_MODE":"Folosește modul de descărcare externă","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"Activarea acestei funcții va face ca scriptul să folosească funcții de descărcare extinse (precum GM_download) pentru a descărca fișiere, rezolvând problema fișierelor lipsă la descărcarea mai multor fișiere.\n\nTe rugăm să reții: Activarea acestei funcții poate cauza funcționarea defectuoasă a funcției de redenumire a fișierelor. Te rugăm să te asiguri că modul de descărcare din setările funcțiilor extinse este setat pe Nativ."},
        "ru": {"RELOAD_SCRIPT":"Перезагрузить скрипт","IMAGE_VIEWER":"Открыть изображение в средстве просмотра","NEW_TAB":"Открыть в новой вкладке","SHOW_DOM_TREE":"Показать DOM-дерево","SELECT_AND_COPY":"Выбрать всё и скопировать из поля ввода","DOWNLOAD_DOM_TREE":"Скачать DOM-дерево как текстовый файл","REPORT_GITHUB":"Сообщить о проблеме на GitHub","DEBUG":"Окно отладки","CLOSE":"Закрыть","ALL_CHECK":"Выбрать всё","ITEM_COUNT_SINGULAR":"%COUNT% элемент","ITEM_COUNT_PLURAL":"%COUNT% элементов","ITEM_POSITION":"Элемент %CURRENT% из %TOTAL%","SELECTED_COUNT_SINGULAR":"%COUNT% выбран","SELECTED_COUNT_PLURAL":"%COUNT% выбрано","BATCH_DOWNLOAD_SELECTED":"Скачать выбранные ресурсы","BATCH_DOWNLOAD_DIRECT":"Скачать все ресурсы","IMG":"Изображение","VID":"Видео","DW":"Скачать","DW_ALL":"Скачать все ресурсы","VIDEO_THUMBNAIL":"Скачать миниатюру видео","LOAD_BLOB_ONE":"Загружается Blob-медиа...","LOAD_BLOB_MULTIPLE":"Загружаются Blob-медиа и другие ресурсы...","LOAD_BLOB_RELOAD":"Обнаруживаются Blob-медиа, перезагрузка...","NO_CHECK_RESOURCE":"Необходимо выбрать ресурс для скачивания.","NO_VID_URL":"Не удалось найти URL видео.","SETTING":"Настройки","AUTO_RENAME":"Автоматически переименовывать файлы (ПКМ для настройки)","RENAME_PUBLISH_DATE":"Задавать метку времени переименованного файла по дате публикации ресурса","RENAME_LOCATE_DATE":"Изменить формат даты метки времени переименованного файла (ПКМ для настройки)","DISABLE_VIDEO_LOOPING":"Отключить автоматическое зацикливание видео","HTML5_VIDEO_CONTROL":"Показывать контроллер видео HTML5","REDIRECT_CLICK_USER_STORY_PICTURE":"Перенаправлять при клике по фото истории пользователя","FORCE_FETCH_ALL_RESOURCES":"Принудительно получать все ресурсы в посте","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"Напрямую скачивать видимые ресурсы в посте","DIRECT_DOWNLOAD_ALL":"Напрямую скачивать все ресурсы в посте","DIRECT_DOWNLOAD_STORY":"Напрямую скачивать все ресурсы в истории/актуальном","MODIFY_VIDEO_VOLUME":"Изменить громкость видео (ПКМ для настройки)","MODIFY_RESOURCE_EXIF":"Изменить свойства EXIF ресурса","SCROLL_BUTTON":"Включить кнопки прокрутки для страницы Reels","FORCE_RESOURCE_VIA_MEDIA":"Принудительно получать ресурс через Media API","PREFER_DASH_MANIFEST":"Предпочитать манифест DASH (видео более высокого качества через Media API)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"Использовать альтернативные методы скачивания, когда Media API недоступен","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"Всегда использовать Media API для [Открыть в новой вкладке] в постах","SKIP_VIEW_STORY_CONFIRM":"Пропускать страницу подтверждения при просмотре истории/актуального","SKIP_SHARED_WITH_YOU_DIALOG":"Пропускать диалог «поделился(-ась) этим с вами» в ссылках на общий профиль","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"Захватывать ресурсы изображений с помощью медиакэша","AUTO_RENAME_INTRO":["Автоматически переименовывать файлы в пользовательский формат:","Список пользовательских форматов:","%USERNAME% - Имя пользователя","%SOURCE_TYPE% - Источник скачивания","%SHORTCODE% - Короткий код поста","%YEAR% - Год скачивания/публикации","%2-YEAR% - Год (последние две цифры) скачивания/публикации","%MONTH% - Месяц скачивания/публикации","%DAY% - День скачивания/публикации","%HOUR% - Час скачивания/публикации","%MINUTE% - Минута скачивания/публикации","%SECOND% - Секунда скачивания/публикации","%ORIGINAL_NAME% - Исходное имя скачанного файла","%ORIGINAL_NAME_FIRST% - Исходное имя скачанного файла (первая часть имени)","%INDEX% - Индекс ресурса","%UID% - Уникальный ID аккаунта пользователя","","Если задано значение false, имя файла останется без изменений.","Пример: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"Задаёт метку времени в формате переименования файла по дате публикации ресурса (часовой пояс браузера).\n\nЭта функция работает только тогда, когда [Автоматически переименовывать файлы] имеет значение TRUE.","RENAME_LOCATE_DATE_INTRO":"Изменяет формат даты метки времени переименованного файла на локальное время браузера и форматирует её в предпочитаемый региональный формат даты.\n\nЭта функция работает только тогда, когда [Автоматически переименовывать файлы] имеет значение TRUE.","DISABLE_VIDEO_LOOPING_INTRO":"Отключает автоматическое зацикливание видео в Reels и постах.","HTML5_VIDEO_CONTROL_INTRO":"Показывает контроллер видео HTML5 в видеоресурсе.\n\nЭто скроет пользовательский ползунок громкости и заменит его контроллером HTML5. Контроллер HTML5 можно скрыть, щёлкнув видео правой кнопкой мыши, чтобы показать исходные сведения.","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"Перенаправляет на страницу профиля пользователя при клике правой кнопкой мыши по его аватару в области историй на главной странице.\nЕсли нажать средней кнопкой мыши, страница откроется в новой вкладке.","FORCE_FETCH_ALL_RESOURCES_INTRO":"Принудительно получает все ресурсы (фото и видео) в посте через API Instagram, чтобы убрать ограничение в три ресурса на пост.","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"Напрямую скачивает текущие ресурсы, доступные в посте.","DIRECT_DOWNLOAD_ALL_INTRO":"Когда вы нажимаете кнопку скачивания, все ресурсы в посте будут принудительно получены и скачаны.","MODIFY_VIDEO_VOLUME_INTRO":"Изменяет громкость воспроизведения видео в Reels и постах (ПКМ, чтобы открыть ползунок настройки громкости).","SCROLL_BUTTON_INTRO":"Включает кнопки прокрутки в правом нижнем углу страницы Reels.","FORCE_RESOURCE_VIA_MEDIA_INTRO":"Media API попытается получить фото или видео максимально возможного качества, но загрузка может занять больше времени.","PREFER_DASH_MANIFEST_INTRO":"Предпочитает манифест DASH для видеоресурсов через Media API. Если манифест DASH доступен, видео- и аудиопотоки будут скачаны ОТДЕЛЬНО для наилучшего возможного качества.","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"Когда Media API достигает лимита запросов или не может использоваться по другим причинам, для скачивания ресурсов будет использоваться Forced Fetch API (качество ресурса может быть немного ниже).","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"Кнопка [Открыть в новой вкладке] в постах всегда будет использовать Media API для получения ресурсов высокого разрешения.","SKIP_VIEW_STORY_CONFIRM_INTRO":"Автоматически пропускает страницу подтверждения, когда она отображается в истории или актуальном.","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"Автоматически нажимает «Не сейчас» в диалоге «X поделился(-ась) этим с вами» при открытии любых ссылок ?igsh=.","MODIFY_RESOURCE_EXIF_INTRO":"Изменяет атрибут EXIF ресурса изображения, чтобы добавить метаданные, такие как ссылка на пост, дата съёмки и автор.","DIRECT_DOWNLOAD_STORY_INTRO":"Когда вы нажимаете [Скачать все ресурсы], все истории/актуальное скачиваются напрямую, без отображения диалога выбора изображений.","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"Использует наблюдатель, чтобы захватывать любые URL изображений высокого качества из DOM-дерева в хранилище скрипта, чтобы их можно было извлечь при наличии и по запросу пользователя.","HOTKEY_DEBUG_KEY":"Окно отладки","HOTKEY_SETTINGS_KEY":"Настройки предпочтений","HOTKEY_KEY_SETTINGS_KEY":"Настройки горячих клавиш","HOTKEY_DOWNLOAD_STORY_KEY":"Скачать историю","HOTKEY_CONFLICT_WARNING":"Эта горячая клавиша может конфликтовать с другими настройками.","HOTKEY_RESET":"Сброс","USE_EXTERNAL_DOWNLOAD_MODE":"Использовать внешний режим загрузки","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"При включении этой функции скрипт будет использовать расширенные функции загрузки (например, GM_download) для скачивания файлов, что решит проблему отсутствующих файлов при загрузке нескольких файлов.\n\nОбратите внимание: Включение этой функции может привести к некорректной работе функции переименования файлов. Убедитесь, что режим загрузки в настройках расширенных функций установлен на «Нативный»."},
        "th": {"RELOAD_SCRIPT":"โหลดสคริปต์ใหม่","IMAGE_VIEWER":"เปิดรูปภาพในตัวแสดง","NEW_TAB":"เปิดในแท็บใหม่","SHOW_DOM_TREE":"แสดงโครงสร้าง DOM","SELECT_AND_COPY":"เลือกทั้งหมดและคัดลอกจากกล่องป้อนข้อมูล","DOWNLOAD_DOM_TREE":"ดาวน์โหลดโครงสร้าง DOM เป็นไฟล์ข้อความ","REPORT_GITHUB":"รายงานปัญหาบน GitHub","DEBUG":"หน้าต่างดีบัก","CLOSE":"ปิด","ALL_CHECK":"เลือกทั้งหมด","ITEM_COUNT_SINGULAR":"%COUNT% รายการ","ITEM_COUNT_PLURAL":"%COUNT% รายการ","ITEM_POSITION":"รายการที่ %CURRENT% จาก %TOTAL%","SELECTED_COUNT_SINGULAR":"เลือกแล้ว %COUNT% รายการ","SELECTED_COUNT_PLURAL":"เลือกแล้ว %COUNT% รายการ","BATCH_DOWNLOAD_SELECTED":"ดาวน์โหลดทรัพยากรที่เลือก","BATCH_DOWNLOAD_DIRECT":"ดาวน์โหลดทรัพยากรทั้งหมด","IMG":"รูปภาพ","VID":"วิดีโอ","DW":"ดาวน์โหลด","DW_ALL":"ดาวน์โหลดทรัพยากรทั้งหมด","VIDEO_THUMBNAIL":"ดาวน์โหลดภาพขนาดย่อของวิดีโอ","LOAD_BLOB_ONE":"กำลังโหลดสื่อ Blob...","LOAD_BLOB_MULTIPLE":"กำลังโหลดสื่อ Blob และรายการอื่นๆ...","LOAD_BLOB_RELOAD":"กำลังตรวจหาสื่อ Blob กำลังโหลดใหม่...","NO_CHECK_RESOURCE":"คุณต้องเลือกทรัพยากรเพื่อดาวน์โหลด","NO_VID_URL":"ไม่พบ URL ของวิดีโอ","SETTING":"การตั้งค่า","AUTO_RENAME":"เปลี่ยนชื่อไฟล์โดยอัตโนมัติ (คลิกขวาเพื่อตั้งค่า)","RENAME_PUBLISH_DATE":"ตั้งค่าประทับเวลาของไฟล์ที่เปลี่ยนชื่อเป็นวันที่เผยแพร่ทรัพยากร","RENAME_LOCATE_DATE":"แก้ไขรูปแบบวันที่ของค่าประทับเวลาสำหรับไฟล์ที่เปลี่ยนชื่อ (คลิกขวาเพื่อตั้งค่า)","DISABLE_VIDEO_LOOPING":"ปิดใช้งานการวนซ้ำอัตโนมัติของวิดีโอ","HTML5_VIDEO_CONTROL":"แสดงตัวควบคุมวิดีโอ HTML5","REDIRECT_CLICK_USER_STORY_PICTURE":"เปลี่ยนเส้นทางเมื่อคลิกรูปโปรไฟล์ในสตอรี่ของผู้ใช้","FORCE_FETCH_ALL_RESOURCES":"บังคับดึงทรัพยากรทั้งหมดในโพสต์","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"ดาวน์โหลดทรัพยากรที่มองเห็นได้ในโพสต์โดยตรง","DIRECT_DOWNLOAD_ALL":"ดาวน์โหลดทรัพยากรทั้งหมดในโพสต์โดยตรง","DIRECT_DOWNLOAD_STORY":"ดาวน์โหลดทรัพยากรทั้งหมดในสตอรี่/ไฮไลต์โดยตรง","MODIFY_VIDEO_VOLUME":"ปรับระดับเสียงวิดีโอ (คลิกขวาเพื่อตั้งค่า)","MODIFY_RESOURCE_EXIF":"แก้ไขคุณสมบัติ EXIF ของทรัพยากร","SCROLL_BUTTON":"เปิดใช้งานปุ่มเลื่อนสำหรับหน้า Reels","FORCE_RESOURCE_VIA_MEDIA":"บังคับดึงทรัพยากรผ่าน Media API","PREFER_DASH_MANIFEST":"ใช้ DASH Manifest เป็นลำดับแรก (วิดีโอคุณภาพสูงขึ้นผ่าน Media API)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"ใช้วิธีอื่นในการดาวน์โหลดเมื่อไม่สามารถเข้าถึง Media API ได้","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"ใช้ Media API เสมอสำหรับ「เปิดในแท็บใหม่」ในโพสต์","SKIP_VIEW_STORY_CONFIRM":"ข้ามหน้ายืนยันสำหรับการดูสตอรี่/ไฮไลต์","SKIP_SHARED_WITH_YOU_DIALOG":"ข้ามกล่องโต้ตอบ “แชร์สิ่งนี้กับคุณ” บนลิงก์โปรไฟล์ที่แชร์","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"จับทรัพยากรรูปภาพโดยใช้แคชสื่อ","AUTO_RENAME_INTRO":["เปลี่ยนชื่อไฟล์โดยอัตโนมัติเป็นรูปแบบกำหนดเอง:","รายการรูปแบบกำหนดเอง:","%USERNAME% - ชื่อผู้ใช้","%SOURCE_TYPE% - แหล่งที่มาของการดาวน์โหลด","%SHORTCODE% - รหัสย่อของโพสต์","%YEAR% - ปีที่ดาวน์โหลด/เผยแพร่","%2-YEAR% - ปี (สองหลักท้าย) ที่ดาวน์โหลด/เผยแพร่","%MONTH% - เดือนที่ดาวน์โหลด/เผยแพร่","%DAY% - วันที่ดาวน์โหลด/เผยแพร่","%HOUR% - ชั่วโมงที่ดาวน์โหลด/เผยแพร่","%MINUTE% - นาทีที่ดาวน์โหลด/เผยแพร่","%SECOND% - วินาทีที่ดาวน์โหลด/เผยแพร่","%ORIGINAL_NAME% - ชื่อเดิมของไฟล์ที่ดาวน์โหลด","%ORIGINAL_NAME_FIRST% - ชื่อเดิมของไฟล์ที่ดาวน์โหลด (ส่วนแรกของชื่อ)","%INDEX% - ดัชนีทรัพยากร","%UID% - ID เฉพาะของบัญชีผู้ใช้","","หากตั้งค่าเป็น false ชื่อไฟล์จะยังคงไม่เปลี่ยนแปลง","ัวอย่าง: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"ตั้งค่าประทับเวลาในรูปแบบการเปลี่ยนชื่อไฟล์เป็นวันที่เผยแพร่ทรัพยากร (เขตเวลาของเบราว์เซอร์)\n\nฟีเจอร์นี้จะทำงานเฉพาะเมื่อ「เปลี่ยนชื่อไฟล์โดยอัตโนมัติ」ตั้งค่าเป็น TRUE","RENAME_LOCATE_DATE_INTRO":"แก้ไขรูปแบบวันที่ของค่าประทับเวลาสำหรับไฟล์ที่เปลี่ยนชื่อให้เป็นเวลาท้องถิ่นของเบราว์เซอร์ และจัดรูปแบบเป็นรูปแบบวันที่ตามภูมิภาคที่คุณต้องการ\n\nฟีเจอร์นี้จะทำงานเฉพาะเมื่อ「เปลี่ยนชื่อไฟล์โดยอัตโนมัติ」ตั้งค่าเป็น TRUE","DISABLE_VIDEO_LOOPING_INTRO":"ปิดใช้งานการวนซ้ำอัตโนมัติของวิดีโอใน Reels และโพสต์","HTML5_VIDEO_CONTROL_INTRO":"แสดงตัวควบคุมวิดีโอ HTML5 ในทรัพยากรวิดีโอ\n\nการดำเนินการนี้จะซ่อนแถบเลื่อนระดับเสียงแบบกำหนดเองและแทนที่ด้วยตัวควบคุม HTML5 สามารถซ่อนตัวควบคุม HTML5 ได้โดยคลิกขวาที่วิดีโอเพื่อแสดงรายละเอียดเดิม","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"เปลี่ยนเส้นทางไปยังหน้าโปรไฟล์ของผู้ใช้เมื่อคลิกขวาที่รูปประจำตัวของผู้ใช้นั้นในพื้นที่สตอรี่บนหน้าแรก\nหากคุณใช้ปุ่มกลางของเมาส์คลิก จะเปิดในแท็บใหม่","FORCE_FETCH_ALL_RESOURCES_INTRO":"บังคับดึงทรัพยากรทั้งหมด (รูปภาพและวิดีโอ) ในโพสต์ผ่าน Instagram API เพื่อลบขีดจำกัดสามทรัพยากรต่อโพสต์","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"ดาวน์โหลดทรัพยากรปัจจุบันที่มีอยู่ในโพสต์โดยตรง","DIRECT_DOWNLOAD_ALL_INTRO":"เมื่อคุณคลิกปุ่มดาวน์โหลด ทรัพยากรทั้งหมดในโพสต์จะถูกบังคับดึงและดาวน์โหลด","MODIFY_VIDEO_VOLUME_INTRO":"ปรับระดับเสียงการเล่นวิดีโอใน Reels และโพสต์ (คลิกขวาเพื่อเปิดแถบเลื่อนการตั้งค่าระดับเสียง)","SCROLL_BUTTON_INTRO":"เปิดใช้งานปุ่มเลื่อนที่มุมขวาล่างของหน้า Reels","FORCE_RESOURCE_VIA_MEDIA_INTRO":"Media API จะพยายามดึงรูปภาพหรือวิดีโอที่มีคุณภาพสูงที่สุดเท่าที่เป็นไปได้ แต่อาจใช้เวลาโหลดนานขึ้น","PREFER_DASH_MANIFEST_INTRO":"ใช้ DASH Manifest เป็นลำดับแรกสำหรับทรัพยากรวิดีโอผ่าน Media API หากมี DASH Manifest จะดาวน์โหลดสตรีมวิดีโอและเสียงแยกกันเพื่อให้ได้คุณภาพดีที่สุด","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"เมื่อ Media API ถึงขีดจำกัดอัตราการใช้งานหรือไม่สามารถใช้ได้ด้วยเหตุผลอื่น Forced Fetch API จะถูกใช้เพื่อดาวน์โหลดทรัพยากร (คุณภาพของทรัพยากรอาจต่ำลงเล็กน้อย)","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"ปุ่ม「เปิดในแท็บใหม่」ในโพสต์จะใช้ Media API เสมอเพื่อรับทรัพยากรความละเอียดสูง","SKIP_VIEW_STORY_CONFIRM_INTRO":"ข้ามโดยอัตโนมัติเมื่อมีการแสดงหน้ายืนยันในสตอรี่หรือไฮไลต์","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"คลิก “ไม่ใช่ตอนนี้” โดยอัตโนมัติในกล่องโต้ตอบ “X แชร์สิ่งนี้กับคุณ” เมื่อเปิดลิงก์ ?igsh= ใดๆ","MODIFY_RESOURCE_EXIF_INTRO":"แก้ไขแอตทริบิวต์ EXIF ของทรัพยากรรูปภาพเพื่อรวมเมทาดาทา เช่น ลิงก์โพสต์ วันที่ถ่าย และผู้เขียน","DIRECT_DOWNLOAD_STORY_INTRO":"เมื่อคุณคลิก「ดาวน์โหลดทรัพยากรทั้งหมด」สตอรี่/ไฮไลต์ทั้งหมดจะถูกดาวน์โหลดโดยตรง โดยไม่แสดงกล่องโต้ตอบการเลือกทรัพยากร","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"ใช้ตัวเฝ้าดูเพื่อจับ URL รูปภาพคุณภาพสูงใดๆ ในโครงสร้าง DOM ไปยังพื้นที่จัดเก็บของสคริปต์ เพื่อให้สามารถดึงออกมาได้เมื่อพร้อมใช้งานและเมื่อผู้ใช้สั่งการ","HOTKEY_DEBUG_KEY":"หน้าต่างดีบัก","HOTKEY_SETTINGS_KEY":"การตั้งค่าการกำหนดลักษณะ","HOTKEY_KEY_SETTINGS_KEY":"การตั้งค่าปุ่มลัด","HOTKEY_DOWNLOAD_STORY_KEY":"ดาวน์โหลดสตอรี่","HOTKEY_CONFLICT_WARNING":"ปุ่มลัดนี้อาจขัดแย้งกับการตั้งค่าอื่น","HOTKEY_RESET":"รีเซ็ต","USE_EXTERNAL_DOWNLOAD_MODE":"ใช้โหมดดาวน์โหลดภายนอก","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"เมื่อเปิดใช้งานคุณสมบัตินี้ สคริปต์จะใช้ฟังก์ชันการดาวน์โหลดแบบขยาย (เช่น GM_download) เพื่อดาวน์โหลดไฟล์ ซึ่งช่วยแก้ปัญหาไฟล์หายเมื่อดาวน์โหลดหลายไฟล์พร้อมกัน\n\nโปรดทราบ: การเปิดใช้งานคุณสมบัตินี้อาจทำให้ฟังก์ชันเปลี่ยนชื่อไฟล์ทำงานผิดปกติ โปรดตรวจสอบให้แน่ใจว่าโหมดดาวน์โหลดในการตั้งค่าคุณสมบัติแบบขยายถูกตั้งค่าเป็น Native"},
        "tr": {"RELOAD_SCRIPT":"Betiği yeniden yükle","IMAGE_VIEWER":"Görseli görüntüleyicide aç","NEW_TAB":"Yeni sekmede aç","SHOW_DOM_TREE":"DOM ağacını göster","SELECT_AND_COPY":"Tümünü seç ve giriş kutusundan kopyala","DOWNLOAD_DOM_TREE":"DOM ağacını metin dosyası olarak indir","REPORT_GITHUB":"GitHub’da sorun bildir","DEBUG":"Hata ayıklama penceresi","CLOSE":"Kapat","ALL_CHECK":"Tümünü seç","ITEM_COUNT_SINGULAR":"%COUNT% öğe","ITEM_COUNT_PLURAL":"%COUNT% öğe","ITEM_POSITION":"Öğe %CURRENT% / %TOTAL%","SELECTED_COUNT_SINGULAR":"%COUNT% seçildi","SELECTED_COUNT_PLURAL":"%COUNT% seçildi","BATCH_DOWNLOAD_SELECTED":"Seçili kaynakları indir","BATCH_DOWNLOAD_DIRECT":"Tüm kaynakları indir","IMG":"Görsel","VID":"Video","DW":"İndir","DW_ALL":"Tüm kaynakları indir","VIDEO_THUMBNAIL":"Video küçük resmini indir","LOAD_BLOB_ONE":"Blob medyası yükleniyor...","LOAD_BLOB_MULTIPLE":"Blob medyası ve diğerleri yükleniyor...","LOAD_BLOB_RELOAD":"Blob medyası algılanıyor, yeniden yükleniyor...","NO_CHECK_RESOURCE":"İndirmek için bir kaynak seçmen gerekiyor.","NO_VID_URL":"Video URL’si bulunamıyor.","SETTING":"Ayarlar","AUTO_RENAME":"Dosyaları otomatik olarak yeniden adlandır (ayarlamak için sağ tıkla)","RENAME_PUBLISH_DATE":"Yeniden adlandırılan dosyanın zaman damgasını kaynağın yayımlanma tarihine ayarla","RENAME_LOCATE_DATE":"Yeniden adlandırılan dosyanın zaman damgası tarih biçimini değiştir (ayarlamak için sağ tıkla)","DISABLE_VIDEO_LOOPING":"Videoların otomatik döngüye alınmasını devre dışı bırak","HTML5_VIDEO_CONTROL":"HTML5 video denetimlerini göster","REDIRECT_CLICK_USER_STORY_PICTURE":"Kullanıcının hikaye fotoğrafına tıklandığında yönlendir","FORCE_FETCH_ALL_RESOURCES":"Gönderideki tüm kaynakları zorla getir","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"Gönderideki görünür kaynakları doğrudan indir","DIRECT_DOWNLOAD_ALL":"Gönderideki tüm kaynakları doğrudan indir","DIRECT_DOWNLOAD_STORY":"Hikayedeki/öne çıkandaki tüm kaynakları doğrudan indir","MODIFY_VIDEO_VOLUME":"Video ses düzeyini değiştir (ayarlamak için sağ tıkla)","MODIFY_RESOURCE_EXIF":"Kaynağın EXIF özelliklerini değiştir","SCROLL_BUTTON":"Reels sayfası için kaydırma düğmelerini etkinleştir","FORCE_RESOURCE_VIA_MEDIA":"Kaynağı Media API üzerinden zorla getir","PREFER_DASH_MANIFEST":"DASH manifestini tercih et (Media API üzerinden daha yüksek kaliteli video)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"Media API erişilebilir olmadığında indirmek için alternatif yöntemleri kullan","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"Gönderilerde [Yeni sekmede aç] için her zaman Media API’yi kullan","SKIP_VIEW_STORY_CONFIRM":"Bir hikayeyi/öne çıkanı görüntüleme onay sayfasını atla","SKIP_SHARED_WITH_YOU_DIALOG":"Paylaşılan profil bağlantılarında \"bunu seninle paylaştı\" iletişim kutusunu atla","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"Medya önbelleğini kullanarak görsel kaynağını yakala","AUTO_RENAME_INTRO":["Dosyayı otomatik olarak özel bir biçimle yeniden adlandır:","Özel biçim listesi:","%USERNAME% - Kullanıcı adı","%SOURCE_TYPE% - İndirme kaynağı","%SHORTCODE% - Gönderi kısa kodu","%YEAR% - İndirme/yayımlanma yılı","%2-YEAR% - İndirme/yayımlanma yılı (son iki basamak)","%MONTH% - İndirme/yayımlanma ayı","%DAY% - İndirme/yayımlanma günü","%HOUR% - İndirme/yayımlanma saati","%MINUTE% - İndirme/yayımlanma dakikası","%SECOND% - İndirme/yayımlanma saniyesi","%ORIGINAL_NAME% - İndirilen dosyanın özgün adı","%ORIGINAL_NAME_FIRST% - İndirilen dosyanın özgün adı (adın ilk bölümü)","%INDEX% - Kaynak dizini","%UID% - Kullanıcı hesabının benzersiz kimliği","","false olarak ayarlanırsa dosya adı değişmeden kalır.","Örnek: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"Dosya yeniden adlandırma biçimindeki zaman damgasını kaynağın yayımlanma tarihine ayarlar (tarayıcı saat dilimi).\n\nBu özellik yalnızca [Dosyaları otomatik olarak yeniden adlandır] TRUE olarak ayarlandığında çalışır.","RENAME_LOCATE_DATE_INTRO":"Yeniden adlandırılan dosyanın zaman damgası tarih biçimini tarayıcının yerel saatine göre değiştirir ve tercih ettiğin bölgesel tarih biçimine göre biçimlendirir.\n\nBu özellik yalnızca [Dosyaları otomatik olarak yeniden adlandır] TRUE olarak ayarlandığında çalışır.","DISABLE_VIDEO_LOOPING_INTRO":"Reels ve gönderilerde videoların otomatik döngüye alınmasını devre dışı bırakır.","HTML5_VIDEO_CONTROL_INTRO":"Video kaynağında HTML5 video denetimlerini gösterir.\n\nBu, özel ses düzeyi kaydırıcısını gizler ve onun yerine HTML5 denetleyicisini koyar. HTML5 denetleyicisi, özgün ayrıntıları göstermek için videoya sağ tıklanarak gizlenebilir.","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"Ana sayfadaki hikayeler alanında bir kullanıcının avatarına sağ tıkladığında kullanıcının profil sayfasına yönlendirir.\nOrta fare düğmesiyle tıklarsan yeni sekmede açılır.","FORCE_FETCH_ALL_RESOURCES_INTRO":"Gönderi başına üç kaynak sınırını kaldırmak için bir gönderideki tüm kaynakların (fotoğraflar ve videolar) Instagram API üzerinden zorla getirilmesini sağlar.","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"Gönderide şu anda kullanılabilir olan kaynakları doğrudan indirir.","DIRECT_DOWNLOAD_ALL_INTRO":"İndirme düğmesine tıkladığında gönderideki tüm kaynaklar zorla getirilecek ve indirilecektir.","MODIFY_VIDEO_VOLUME_INTRO":"Reels ve gönderilerde videoların oynatma ses düzeyini değiştirir (ses düzeyi ayarı kaydırıcısını açmak için sağ tıkla).","SCROLL_BUTTON_INTRO":"Reels sayfasının sağ alt köşesinde kaydırma düğmelerini etkinleştirir.","FORCE_RESOURCE_VIA_MEDIA_INTRO":"Media API mümkün olan en yüksek kalitede fotoğrafı veya videoyu almaya çalışır, ancak yüklenmesi daha uzun sürebilir.","PREFER_DASH_MANIFEST_INTRO":"Media API üzerinden video kaynakları için DASH manifestini tercih eder. Bir DASH manifesti mevcutsa, mümkün olan en iyi kalite için video ve ses akışlarını AYRI AYRI indirir.","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"Media API hız sınırına ulaştığında veya başka nedenlerle kullanılamadığında, kaynakları indirmek için Forced Fetch API kullanılacaktır (kaynak kalitesi biraz daha düşük olabilir).","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"Gönderilerdeki [Yeni sekmede aç] düğmesi, yüksek çözünürlüklü kaynakları almak için her zaman Media API’yi kullanacaktır.","SKIP_VIEW_STORY_CONFIRM_INTRO":"Bir hikayede veya öne çıkanda onay sayfası gösterildiğinde otomatik olarak atlar.","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"Herhangi bir ?igsh= bağlantısı açılırken \"X bunu seninle paylaştı\" iletişim kutusunda otomatik olarak \"Şimdi değil\" seçeneğine tıklar.","MODIFY_RESOURCE_EXIF_INTRO":"Görsel kaynağının EXIF özniteliklerini, gönderi bağlantısı, çekim tarihi ve yazar gibi meta verileri içerecek şekilde değiştirir.","DIRECT_DOWNLOAD_STORY_INTRO":"[Tüm kaynakları indir] seçeneğine tıkladığında, tüm hikayeler/öne çıkanlar görsel seçme iletişim kutusu gösterilmeden doğrudan indirilir.","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"DOM ağacındaki yüksek kaliteli görsel URL’lerini betiğin depolama alanına yakalamak için bir watcher kullanır; böylece bunlar kullanılabilir olduğunda ve kullanıcı girdisiyle çıkarılabilir.","HOTKEY_DEBUG_KEY":"Hata ayıklama penceresi","HOTKEY_SETTINGS_KEY":"Tercih ayarları","HOTKEY_KEY_SETTINGS_KEY":"Kısayol tuşu ayarları","HOTKEY_DOWNLOAD_STORY_KEY":"Hikayeyi indir","HOTKEY_CONFLICT_WARNING":"Bu kısayol tuşu diğer ayarlarla çakışabilir.","HOTKEY_RESET":"Sıfırla","USE_EXTERNAL_DOWNLOAD_MODE":"Harici İndirme Modunu Kullan","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"Bu özelliği etkinleştirmek, komut dosyasının dosyaları indirmek için GM_download gibi gelişmiş indirme işlevlerini kullanmasını sağlayarak birden fazla dosya indirilirken eksik dosya sorununu çözer.\n\nLütfen unutma: Bu özelliğin etkinleştirilmesi dosya yeniden adlandırma işlevinin düzgün çalışmamasına neden olabilir. Gelişmiş özellik ayarlarında indirme modunun Yerel olarak ayarlandığından emin ol."},
        "vi": {"RELOAD_SCRIPT":"Tải lại script","IMAGE_VIEWER":"Mở hình ảnh trong trình xem","NEW_TAB":"Mở trong thẻ mới","SHOW_DOM_TREE":"Hiển thị cây DOM","SELECT_AND_COPY":"Chọn tất cả và sao chép từ hộp nhập","DOWNLOAD_DOM_TREE":"Tải cây DOM xuống dưới dạng tệp văn bản","REPORT_GITHUB":"Báo cáo sự cố trên GitHub","DEBUG":"Cửa sổ gỡ lỗi","CLOSE":"Đóng","ALL_CHECK":"Chọn tất cả","ITEM_COUNT_SINGULAR":"%COUNT% mục","ITEM_COUNT_PLURAL":"%COUNT% mục","ITEM_POSITION":"Mục %CURRENT% trên %TOTAL%","SELECTED_COUNT_SINGULAR":"Đã chọn %COUNT% mục","SELECTED_COUNT_PLURAL":"Đã chọn %COUNT% mục","BATCH_DOWNLOAD_SELECTED":"Tải xuống các tài nguyên đã chọn","BATCH_DOWNLOAD_DIRECT":"Tải xuống tất cả tài nguyên","IMG":"Hình ảnh","VID":"Video","DW":"Tải xuống","DW_ALL":"Tải xuống tất cả tài nguyên","VIDEO_THUMBNAIL":"Tải xuống hình thu nhỏ của video","LOAD_BLOB_ONE":"Đang tải phương tiện Blob...","LOAD_BLOB_MULTIPLE":"Đang tải phương tiện Blob và các nội dung khác...","LOAD_BLOB_RELOAD":"Đang phát hiện phương tiện Blob, đang tải lại...","NO_CHECK_RESOURCE":"Bạn cần chọn một tài nguyên để tải xuống.","NO_VID_URL":"Không tìm thấy URL video.","SETTING":"Cài đặt","AUTO_RENAME":"Tự động đổi tên tệp (nhấp chuột phải để đặt)","RENAME_PUBLISH_DATE":"Đặt dấu thời gian của tệp đã đổi tên thành ngày đăng tài nguyên","RENAME_LOCATE_DATE":"Sửa đổi định dạng ngày của dấu thời gian cho tệp đã đổi tên (nhấp chuột phải để đặt)","DISABLE_VIDEO_LOOPING":"Tắt tự động lặp video","HTML5_VIDEO_CONTROL":"Hiển thị bộ điều khiển video HTML5","REDIRECT_CLICK_USER_STORY_PICTURE":"Chuyển hướng khi nhấp vào ảnh tin của người dùng","FORCE_FETCH_ALL_RESOURCES":"Buộc lấy tất cả tài nguyên trong bài viết","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"Tải trực tiếp các tài nguyên hiển thị trong bài viết","DIRECT_DOWNLOAD_ALL":"Tải trực tiếp tất cả tài nguyên trong bài viết","DIRECT_DOWNLOAD_STORY":"Tải trực tiếp tất cả tài nguyên trong tin/tin nổi bật","MODIFY_VIDEO_VOLUME":"Sửa đổi âm lượng video (nhấp chuột phải để đặt)","MODIFY_RESOURCE_EXIF":"Sửa đổi thuộc tính EXIF của tài nguyên","SCROLL_BUTTON":"Bật nút cuộn cho trang Reels","FORCE_RESOURCE_VIA_MEDIA":"Buộc lấy tài nguyên qua Media API","PREFER_DASH_MANIFEST":"Ưu tiên DASH Manifest (video chất lượng cao hơn qua Media API)","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"Dùng các phương thức thay thế để tải xuống khi không thể truy cập Media API","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"Luôn dùng Media API cho「Mở trong thẻ mới」trong bài viết","SKIP_VIEW_STORY_CONFIRM":"Bỏ qua trang xác nhận khi xem tin/tin nổi bật","SKIP_SHARED_WITH_YOU_DIALOG":"Bỏ qua hộp thoại “đã chia sẻ nội dung này với bạn” trên liên kết hồ sơ được chia sẻ","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"Chụp tài nguyên hình ảnh bằng bộ nhớ đệm phương tiện","AUTO_RENAME_INTRO":["Tự động đổi tên tệp theo định dạng tùy chỉnh:","Danh sách định dạng tùy chỉnh:","%USERNAME% - Tên người dùng","%SOURCE_TYPE% - Nguồn tải xuống","%SHORTCODE% - Mã ngắn của bài viết","%YEAR% - Năm tải xuống/đăng","%2-YEAR% - Năm (hai chữ số cuối) tải xuống/đăng","%MONTH% - Tháng tải xuống/đăng","%DAY% - Ngày tải xuống/đăng","%HOUR% - Giờ tải xuống/đăng","%MINUTE% - Phút tải xuống/đăng","%SECOND% - Giây tải xuống/đăng","%ORIGINAL_NAME% - Tên gốc của tệp đã tải xuống","%ORIGINAL_NAME_FIRST% - Tên gốc của tệp đã tải xuống (phần đầu của tên)","%INDEX% - Chỉ mục tài nguyên","%UID% - ID duy nhất của tài khoản người dùng","","Nếu đặt thành false, tên tệp sẽ giữ nguyên.","Ví dụ: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"Đặt dấu thời gian trong định dạng đổi tên tệp thành ngày đăng tài nguyên (múi giờ của trình duyệt).\n\nTính năng này chỉ hoạt động khi「Tự động đổi tên tệp」được đặt thành TRUE.","RENAME_LOCATE_DATE_INTRO":"Sửa đổi định dạng ngày của dấu thời gian cho tệp đã đổi tên sang giờ địa phương của trình duyệt và định dạng theo kiểu ngày khu vực bạn muốn.\n\nTính năng này chỉ hoạt động khi「Tự động đổi tên tệp」được đặt thành TRUE.","DISABLE_VIDEO_LOOPING_INTRO":"Tắt tự động lặp video trong Reels và bài viết.","HTML5_VIDEO_CONTROL_INTRO":"Hiển thị bộ điều khiển video HTML5 trong tài nguyên video.\n\nThao tác này sẽ ẩn thanh trượt âm lượng tùy chỉnh và thay bằng bộ điều khiển HTML5. Có thể ẩn bộ điều khiển HTML5 bằng cách nhấp chuột phải vào video để hiển thị chi tiết ban đầu.","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"Chuyển hướng đến trang hồ sơ của người dùng khi nhấp chuột phải vào ảnh đại diện của họ trong khu vực tin trên trang chủ.\nNếu bạn dùng nút giữa của chuột để nhấp, trang sẽ mở trong thẻ mới.","FORCE_FETCH_ALL_RESOURCES_INTRO":"Buộc lấy tất cả tài nguyên (ảnh và video) trong bài viết qua API Instagram để loại bỏ giới hạn ba tài nguyên cho mỗi bài viết.","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"Tải trực tiếp các tài nguyên hiện có trong bài viết.","DIRECT_DOWNLOAD_ALL_INTRO":"Khi bạn nhấp vào nút tải xuống, tất cả tài nguyên trong bài viết sẽ được buộc lấy và tải xuống.","MODIFY_VIDEO_VOLUME_INTRO":"Sửa đổi âm lượng phát video trong Reels và bài viết (nhấp chuột phải để mở thanh trượt cài đặt âm lượng).","SCROLL_BUTTON_INTRO":"Bật các nút cuộn ở góc dưới bên phải của trang Reels.","FORCE_RESOURCE_VIA_MEDIA_INTRO":"Media API sẽ cố gắng lấy ảnh hoặc video có chất lượng cao nhất có thể, nhưng có thể mất nhiều thời gian hơn để tải.","PREFER_DASH_MANIFEST_INTRO":"Ưu tiên DASH Manifest cho tài nguyên video qua Media API. Nếu có DASH Manifest, luồng video và âm thanh sẽ được tải xuống RIÊNG BIỆT để đạt chất lượng tốt nhất có thể.","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"Khi Media API đạt giới hạn tốc độ hoặc không thể dùng vì lý do khác, Forced Fetch API sẽ được dùng để tải xuống tài nguyên (chất lượng tài nguyên có thể thấp hơn một chút).","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"Nút「Mở trong thẻ mới」trong bài viết sẽ luôn dùng Media API để lấy tài nguyên có độ phân giải cao.","SKIP_VIEW_STORY_CONFIRM_INTRO":"Tự động bỏ qua khi trang xác nhận được hiển thị trong tin hoặc tin nổi bật.","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"Tự động nhấp vào “Không phải bây giờ” trong hộp thoại “X đã chia sẻ nội dung này với bạn” khi mở bất kỳ liên kết ?igsh= nào.","MODIFY_RESOURCE_EXIF_INTRO":"Sửa đổi thuộc tính EXIF của tài nguyên hình ảnh để bao gồm siêu dữ liệu như liên kết bài viết, ngày chụp và tác giả.","DIRECT_DOWNLOAD_STORY_INTRO":"Khi bạn nhấp vào「Tải xuống tất cả tài nguyên」, tất cả tin/tin nổi bật sẽ được tải xuống trực tiếp mà không hiển thị hộp thoại chọn tài nguyên.","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"Dùng trình theo dõi để chụp mọi URL hình ảnh chất lượng cao trong cây DOM vào bộ nhớ của script, để có thể trích xuất chúng khi có sẵn và theo thao tác của người dùng.","HOTKEY_DEBUG_KEY":"Cửa sổ gỡ lỗi","HOTKEY_SETTINGS_KEY":"Cài đặt tùy chọn","HOTKEY_KEY_SETTINGS_KEY":"Cài đặt phím tắt","HOTKEY_DOWNLOAD_STORY_KEY":"Tải xuống tin","HOTKEY_CONFLICT_WARNING":"Phím tắt này có thể xung đột với các cài đặt khác.","HOTKEY_RESET":"Đặt lại","USE_EXTERNAL_DOWNLOAD_MODE":"Sử dụng chế độ tải xuống bên ngoài","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"Việc bật tính năng này sẽ khiến tập lệnh sử dụng các chức năng tải xuống mở rộng (chẳng hạn như GM_download) để tải tệp xuống, giúp khắc phục tình trạng thiếu tệp khi tải nhiều tệp cùng lúc.\n\nLưu ý: Việc bật tính năng này có thể khiến chức năng đổi tên tệp hoạt động không chính xác. Hãy đảm bảo chế độ tải xuống trong phần cài đặt tính năng mở rộng được đặt thành Gốc (Native)."},
        "zh-CN": {"RELOAD_SCRIPT":"重新加载脚本","IMAGE_VIEWER":"在查看器中打开图片","NEW_TAB":"在新选项卡中打开","SHOW_DOM_TREE":"显示 DOM 树","SELECT_AND_COPY":"全选并复制输入框中的内容","DOWNLOAD_DOM_TREE":"将 DOM 树下载为文本文件","REPORT_GITHUB":"在 GitHub 上报告问题","DEBUG":"调试窗口","CLOSE":"关闭","ALL_CHECK":"全选","ITEM_COUNT_SINGULAR":"%COUNT% 项","ITEM_COUNT_PLURAL":"%COUNT% 项","ITEM_POSITION":"第 %CURRENT% 项，共 %TOTAL% 项","SELECTED_COUNT_SINGULAR":"已选择 %COUNT% 项","SELECTED_COUNT_PLURAL":"已选择 %COUNT% 项","BATCH_DOWNLOAD_SELECTED":"下载已选资源","BATCH_DOWNLOAD_DIRECT":"下载全部资源","IMG":"图片","VID":"视频","DW":"下载","DW_ALL":"下载全部资源","VIDEO_THUMBNAIL":"下载视频缩略图","LOAD_BLOB_ONE":"正在加载 Blob 媒体...","LOAD_BLOB_MULTIPLE":"正在加载 Blob 媒体及其他资源...","LOAD_BLOB_RELOAD":"正在检测 Blob 媒体，正在重新加载...","NO_CHECK_RESOURCE":"你需要选择要下载的资源。","NO_VID_URL":"无法找到视频 URL。","SETTING":"设置","AUTO_RENAME":"自动重命名文件（右键单击以设置）","RENAME_PUBLISH_DATE":"将重命名文件的时间戳设置为资源发布日期","RENAME_LOCATE_DATE":"修改重命名文件时间戳的日期格式（右键单击以设置）","DISABLE_VIDEO_LOOPING":"禁用视频自动循环播放","HTML5_VIDEO_CONTROL":"显示 HTML5 视频控制器","REDIRECT_CLICK_USER_STORY_PICTURE":"点击用户快拍头像时重定向","FORCE_FETCH_ALL_RESOURCES":"强制获取帖子中的所有资源","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"直接下载帖子中的可见资源","DIRECT_DOWNLOAD_ALL":"直接下载帖子中的所有资源","DIRECT_DOWNLOAD_STORY":"直接下载快拍/精选中的所有资源","MODIFY_VIDEO_VOLUME":"修改视频音量（右键单击以设置）","MODIFY_RESOURCE_EXIF":"修改资源 EXIF 属性","SCROLL_BUTTON":"为 Reels 页面启用滚动按钮","FORCE_RESOURCE_VIA_MEDIA":"通过 Media API 强制获取资源","PREFER_DASH_MANIFEST":"优先使用 DASH 清单（通过 Media API 获取更高质量的视频）","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"当 Media API 不可访问时使用其他方法下载","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"在帖子中始终为「在新选项卡中打开」使用 Media API","SKIP_VIEW_STORY_CONFIRM":"跳过查看快拍/精选的确认页面","SKIP_SHARED_WITH_YOU_DIALOG":"跳过共享个人资料链接上的“已与你分享此内容”对话框","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"使用 Media Cache 捕获图片资源","AUTO_RENAME_INTRO":["自动将文件重命名为自定义格式:","自定义格式列表:","%USERNAME% - 用户名","%SOURCE_TYPE% - 下载来源","%SHORTCODE% - 帖子短代码","%YEAR% - 下载/发布年份","%2-YEAR% - 下载/发布年份（后两位）","%MONTH% - 下载/发布月份","%DAY% - 下载/发布日期","%HOUR% - 下载/发布小时","%MINUTE% - 下载/发布分钟","%SECOND% - 下载/发布秒","%ORIGINAL_NAME% - 已下载文件的原始名称","%ORIGINAL_NAME_FIRST% - 已下载文件原始名称（名称的第一部分）","%INDEX% - 资源索引","%UID% - 用户账号唯一 ID","","如果设置为 false，文件名将保持不变。","示例: instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"将文件重命名格式中的时间戳设置为资源发布日期（浏览器时区）。\n\n此功能仅在「自动重命名文件」设置为 TRUE 时有效。","RENAME_LOCATE_DATE_INTRO":"将重命名文件时间戳的日期格式修改为浏览器本地时间，并格式化为你偏好的地区日期格式。\n\n此功能仅在「自动重命名文件」设置为 TRUE 时有效。","DISABLE_VIDEO_LOOPING_INTRO":"禁用 Reels 和帖子中的视频自动循环播放。","HTML5_VIDEO_CONTROL_INTRO":"在视频资源中显示 HTML5 视频控制器。\n\n这将隐藏自定义视频音量滑块，并将其替换为 HTML5 控制器。可以通过右键单击视频来隐藏 HTML5 控制器，以显示原始详情。","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"在主页的快拍区域中右键单击用户头像时，重定向到该用户的个人资料页面。\n如果使用鼠标中键点击，则会在新选项卡中打开。","FORCE_FETCH_ALL_RESOURCES_INTRO":"通过 Instagram API 强制获取帖子中的所有资源（照片和视频），以移除每个帖子三个资源的限制。","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"直接下载帖子中当前可用的资源。","DIRECT_DOWNLOAD_ALL_INTRO":"当你点击下载按钮时，将强制获取并下载帖子中的所有资源。","MODIFY_VIDEO_VOLUME_INTRO":"修改 Reels 和帖子中的视频播放音量（右键单击可打开音量设置滑块）。","SCROLL_BUTTON_INTRO":"为 Reels 页面右下角启用滚动按钮。","FORCE_RESOURCE_VIA_MEDIA_INTRO":"Media API 将尝试获取尽可能最高质量的照片或视频，但加载时间可能更长。","PREFER_DASH_MANIFEST_INTRO":"通过 Media API 优先使用视频资源的 DASH 清单。如果 DASH 清单可用，将分别下载视频流和音频流，以获得尽可能最佳的质量。","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"当 Media API 达到速率限制或因其他原因无法使用时，将使用 Forced Fetch API 下载资源（资源质量可能会略低）。","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"帖子中的「在新选项卡中打开」按钮将始终使用 Media API 获取高分辨率资源。","SKIP_VIEW_STORY_CONFIRM_INTRO":"当快拍或精选中显示确认页面时自动跳过。","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"打开任何 ?igsh= 链接时，在“X 已与你分享此内容”对话框中自动点击“不用了”。","MODIFY_RESOURCE_EXIF_INTRO":"修改图片资源的 EXIF 属性，以包含帖子链接、拍摄日期和作者等元数据。","DIRECT_DOWNLOAD_STORY_INTRO":"当你点击「下载全部资源」时，所有快拍/精选都会直接下载，不显示资源选择对话框。","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"使用观察者将 DOM 树中的任何高质量图片 URL 捕获到脚本存储中，以便在可用时以及根据用户输入进行提取。","HOTKEY_DEBUG_KEY":"调试窗口","HOTKEY_SETTINGS_KEY":"偏好设置","HOTKEY_KEY_SETTINGS_KEY":"快捷键设置","HOTKEY_DOWNLOAD_STORY_KEY":"下载快拍","HOTKEY_CONFLICT_WARNING":"此快捷键可能与其他设置冲突。","HOTKEY_RESET":"重设","USE_EXTERNAL_DOWNLOAD_MODE":"使用外部下载模式","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"启用此功能后，脚本将使用扩展下载功能（如 GM_download）下载文件，从而解决下载多个文件时文件缺失的问题。\n\n请注意：启用此功能可能会导致文件重命名功能无法正常工作。请确保扩展功能设置中的下载模式已设置为“原生（Native）”。"},
        "zh-TW": {"RELOAD_SCRIPT":"重新載入腳本","IMAGE_VIEWER":"在檢視器中開啟圖片","NEW_TAB":"在新分頁中開啟","SHOW_DOM_TREE":"顯示 DOM 樹","SELECT_AND_COPY":"全選並複製輸入框的內容","DOWNLOAD_DOM_TREE":"將 DOM 樹下載為文字檔案","REPORT_GITHUB":"在 GitHub 上回報問題","DEBUG":"偵錯視窗","CLOSE":"關閉","ALL_CHECK":"全選","ITEM_COUNT_SINGULAR":"%COUNT% 個項目","ITEM_COUNT_PLURAL":"%COUNT% 個項目","ITEM_POSITION":"第 %CURRENT% 個項目，共 %TOTAL% 個","SELECTED_COUNT_SINGULAR":"已選取 %COUNT% 個","SELECTED_COUNT_PLURAL":"已選取 %COUNT% 個","BATCH_DOWNLOAD_SELECTED":"下載已選取的資源","BATCH_DOWNLOAD_DIRECT":"下載所有資源","IMG":"相片","VID":"影片","DW":"下載","DW_ALL":"下載所有資源","VIDEO_THUMBNAIL":"下載影片縮圖","LOAD_BLOB_ONE":"正在載入 Blob 媒體...","LOAD_BLOB_MULTIPLE":"正在載入 Blob 媒體和其他資源...","LOAD_BLOB_RELOAD":"正在偵測 Blob 媒體，重新載入中...","NO_CHECK_RESOURCE":"您需要選取一項資源才能下載。","NO_VID_URL":"找不到影片網址。","SETTING":"設定","AUTO_RENAME":"自動重新命名檔案（右鍵設定）","RENAME_PUBLISH_DATE":"將重新命名檔案的時間戳設定為資源發布日期","RENAME_LOCATE_DATE":"修改重新命名檔案時間戳的日期格式（右鍵設定）","DISABLE_VIDEO_LOOPING":"停用影片自動循環播放","HTML5_VIDEO_CONTROL":"顯示 HTML5 影片控制器","REDIRECT_CLICK_USER_STORY_PICTURE":"點擊使用者限時動態頭像時重新導向","FORCE_FETCH_ALL_RESOURCES":"強制擷取貼文中的所有資源","DIRECT_DOWNLOAD_VISIBLE_RESOURCE":"直接下載貼文中的可見資源","DIRECT_DOWNLOAD_ALL":"直接下載貼文中的所有資源","DIRECT_DOWNLOAD_STORY":"直接下載限時動態／精選動態中的所有資源","MODIFY_VIDEO_VOLUME":"修改影片音量（右鍵設定）","MODIFY_RESOURCE_EXIF":"修改資源 EXIF 屬性","SCROLL_BUTTON":"為 Reels 頁面啟用捲動按鈕","FORCE_RESOURCE_VIA_MEDIA":"透過 Media API 強制擷取資源","PREFER_DASH_MANIFEST":"優先使用 DASH 清單（透過 Media API 取得更高品質影片）","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED":"當 Media API 無法存取時使用其他方式下載","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST":"在貼文中一律使用 Media API 執行「在新分頁中開啟」","SKIP_VIEW_STORY_CONFIRM":"略過檢視限時動態／精選動態的確認頁面","SKIP_SHARED_WITH_YOU_DIALOG":"略過共享個人檔案連結上的「已與您分享此內容」對話框","CAPTURE_IMAGE_VIA_MEDIA_CACHE":"使用 Media Cache 擷取圖片資源","AUTO_RENAME_INTRO":["自動將檔案重新命名為自訂格式：","自訂格式列表：","%USERNAME% - 使用者名稱","%SOURCE_TYPE% - 下載來源","%SHORTCODE% - 貼文短碼","%YEAR% - 下載／發布年份","%2-YEAR% - 下載／發布年份（後兩位）","%MONTH% - 下載／發布月份","%DAY% - 下載／發布日期","%HOUR% - 下載／發布小時","%MINUTE% - 下載／發布分鐘","%SECOND% - 下載／發布秒","%ORIGINAL_NAME% - 已下載檔案的原始名稱","%ORIGINAL_NAME_FIRST% - 已下載檔案的原始名稱（名稱的第一部分）","%INDEX% - 資源索引","%UID% - 使用者帳號唯一 ID","","若設定為 false，檔名將維持不變。","範例： instagram_321565527_679025940443063_4318007696887450953_n.jpg"],"RENAME_PUBLISH_DATE_INTRO":"將檔案重新命名格式中的時間戳設定為資源發布日期（瀏覽器時區）。\n\n此功能僅在「自動重新命名檔案」設定為 TRUE 時有效。","RENAME_LOCATE_DATE_INTRO":"將重新命名檔案的時間戳日期格式修改為瀏覽器當地時間，並將其格式化為您偏好的地區日期格式。\n\n此功能僅在「自動重新命名檔案」設定為 TRUE 時有效。","DISABLE_VIDEO_LOOPING_INTRO":"停用 Reels 和貼文中的影片自動循環播放。","HTML5_VIDEO_CONTROL_INTRO":"在影片資源中顯示 HTML5 影片控制器。\n\n這會隱藏自訂影片音量滑桿，並以 HTML5 控制器取代。可在影片上按右鍵隱藏 HTML5 控制器，以顯示原始詳細資訊。","REDIRECT_CLICK_USER_STORY_PICTURE_INTRO":"在首頁限時動態區域中，以右鍵點擊使用者頭像時，重新導向至該使用者的個人檔案頁面。\n如果使用滑鼠中鍵點擊，則會在新分頁中開啟。","FORCE_FETCH_ALL_RESOURCES_INTRO":"透過 Instagram API 強制擷取貼文中的所有資源（照片和影片），以移除每篇貼文三項資源的限制。","DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO":"直接下載貼文中目前可用的資源。","DIRECT_DOWNLOAD_ALL_INTRO":"當您點擊下載按鈕時，將強制擷取並下載貼文中的所有資源。","MODIFY_VIDEO_VOLUME_INTRO":"修改 Reels 和貼文中的影片播放音量（右鍵開啟音量設定滑桿）。","SCROLL_BUTTON_INTRO":"為 Reels 頁面右下角啟用捲動按鈕。","FORCE_RESOURCE_VIA_MEDIA_INTRO":"Media API 會嘗試取得品質盡可能最高的照片或影片，但載入時間可能較長。","PREFER_DASH_MANIFEST_INTRO":"透過 Media API 優先使用 DASH 清單作為影片資源。如果有可用的 DASH 清單，將會分別下載影片與音訊串流，以取得最佳品質。","FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO":"當 Media API 達到速率限制，或因其他原因無法使用時，將使用強制擷取 API 下載資源（資源品質可能略低）。","NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO":"貼文中的「在新分頁中開啟」按鈕將一律使用 Media API 取得高解析度資源。","SKIP_VIEW_STORY_CONFIRM_INTRO":"在限時動態或精選動態中顯示確認頁面時，自動略過。","SKIP_SHARED_WITH_YOU_DIALOG_INTRO":"開啟任何 ?igsh= 連結時，在「X 已與您分享此內容」對話框中自動點擊「現在不要」。","MODIFY_RESOURCE_EXIF_INTRO":"修改圖片資源的 EXIF 屬性，以包含貼文連結、拍攝日期和作者等中繼資料。","DIRECT_DOWNLOAD_STORY_INTRO":"當您點擊「下載所有資源」時，所有限時動態／精選動態都會直接下載，不會顯示圖片選擇對話框。","CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO":"使用 Observer 將 DOM 樹中的任何高品質圖片網址擷取至腳本儲存空間，以便在可用時及依使用者輸入進行擷取。","HOTKEY_DEBUG_KEY":"偵錯視窗","HOTKEY_SETTINGS_KEY":"偏好設定","HOTKEY_KEY_SETTINGS_KEY":"快捷鍵設定","HOTKEY_DOWNLOAD_STORY_KEY":"下載限時動態","HOTKEY_CONFLICT_WARNING":"此快捷鍵可能與其他設定衝突。","HOTKEY_RESET":"重置","USE_EXTERNAL_DOWNLOAD_MODE":"使用外部下載模式","USE_EXTERNAL_DOWNLOAD_MODE_INTRO":"啟用此功能後，腳本將使用擴充功能的下載模式（例如 GM_download）來下載檔案，藉此解決下載多個檔案時遺漏檔案的問題。\n\n請注意：啟用此功能可能會導致檔案重新命名功能無法正常運作。請確認擴充功能設定中的下載模式已設為「原生（Native）」。"},
    };

    const userIdCache = new Map();

    // OPTIMIZATION: Cached jQuery body reference — used in many places, jQuery 4
    // creates a new wrapper for each $('body') call. Reusing $body avoids that
    // overhead while remaining 100% behavior-compatible.
    const $body = $('body');

    var state = {
        videoVolume: (GM_getValue('G_VIDEO_VOLUME')) ? GM_getValue('G_VIDEO_VOLUME') : 1,
        tempFetchRateLimit: false,
        fileRenameFormat: (GM_getValue('G_RENAME_FORMAT')) ? GM_getValue('G_RENAME_FORMAT') : '%USERNAME%-%SOURCE_TYPE%-%SHORTCODE%-%YEAR%%MONTH%%DAY%_%HOUR%%MINUTE%%SECOND%_%ORIGINAL_NAME_FIRST%',
        registerMenuIds: [],
        locale: {},
        lang: GM_getValue('UI_LANGUAGE') || navigator.language || navigator.userLanguage,
        currentURL: location.href,
        firstStarted: false,
        pageLoaded: false,
        GL_logger: [],
        GL_referrer: null,
        GL_postPath: null,
        GL_username: null,
        GL_repeat: null,
        GL_dataCache: {
            stories: {},
            highlights: {}
        },
        GL_observer: new MutationObserver(function () {
            onReadyMyDW();
        }),
        GL_imageCache: GM_getValue(IMAGE_CACHE_KEY, {}),
        GL_mediaDataCache: {},
        GL_weakCache: {
            overlay: new WeakMap(),
            mutedButton: new WeakMap(),
        },
        debugHotkeyKeyCode: (GM_getValue('G_HOTKEY_DEBUG_KEYCODE')) ? GM_getValue('G_HOTKEY_DEBUG_KEYCODE') : 90,
        settingsHotkeyKeyCode: (GM_getValue('G_HOTKEY_SETTINGS_KEYCODE')) ? GM_getValue('G_HOTKEY_SETTINGS_KEYCODE') : 87,
        keySettingsHotkeyKeyCode: (GM_getValue('G_HOTKEY_KEY_SETTINGS_KEYCODE')) ? GM_getValue('G_HOTKEY_KEY_SETTINGS_KEYCODE') : 67,
        downloadStoryHotkeyKeyCode: (GM_getValue('G_HOTKEY_DOWNLOAD_STORY_KEYCODE')) ? GM_getValue('G_HOTKEY_DOWNLOAD_STORY_KEYCODE') : 83
    };
    /*******************************/

    // initialization script
    initSettings();
    GM_addStyle(style);
    GM_addStyle(`

    /* Media download picker: scoped so settings and debug dialogs keep their layout. */
    .IG_POPUP_DIG.igdm-picker {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #f3f5fb;
    }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BG {
        background: rgba(5, 7, 12, .76);
        -webkit-backdrop-filter: blur(3px);
        backdrop-filter: blur(3px);
    }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_MAIN {
        box-sizing: border-box;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        width: min(560px, calc(100vw - 32px));
        max-height: min(690px, calc(100dvh - 32px));
        min-height: 0;
        overflow: hidden;
        padding: 0;
        border: 1px solid #373c49;
        border-radius: 16px;
        background: #1c2029;
        color: #f3f5fb;
        box-shadow: 0 24px 80px rgba(0, 0, 0, .55);
    }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_TITLE {
        flex: none;
        padding: 20px 20px 14px;
        border-bottom: 1px solid #343945;
    }
    .IG_POPUP_DIG.igdm-picker .igdm-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
    }
    .IG_POPUP_DIG.igdm-picker .igdm-title {
        margin: 0;
        color: #f8f9fc;
        font-size: 19px;
        font-weight: 650;
        line-height: 1.3;
        letter-spacing: -.02em;
    }
    .IG_POPUP_DIG.igdm-picker #post_info {
        margin-top: 5px;
        color: #a6adbd;
        font-size: 12px;
        line-height: 1.5;
    }
    .IG_POPUP_DIG.igdm-picker #post_info a {
        color: #a5b8ff;
        text-decoration: none;
        font-size: inherit;
    }
    .IG_POPUP_DIG.igdm-picker #post_info a:hover { text-decoration: underline; }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BTN {
        position: static;
        flex: 0 0 34px;
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        margin: -5px -5px 0 0;
        padding: 0;
        border: 0;
        border-radius: 9px;
        background: transparent;
        color: #adb4c2;
        cursor: pointer;
    }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BTN:hover {
        background: #303644;
        color: #fff;
    }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BTN svg {
        width: 18px;
        height: 18px;
    }
    .IG_POPUP_DIG.igdm-picker .igdm-selection {
        margin-top: 17px;
    }
    .IG_POPUP_DIG.igdm-picker .checkbox {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        margin: 0;
        color: #dce0ea;
        font-size: 13px;
        font-weight: 500;
        line-height: 20px;
        cursor: pointer;
    }
    .IG_POPUP_DIG.igdm-picker .checkbox input {
        flex: none;
        width: 16px;
        height: 16px;
        margin: 0;
        transform: none;
        accent-color: #9cadff;
        cursor: pointer;
    }
    .IG_POPUP_DIG.igdm-picker .item-count {
        padding: 2px 7px;
        border: 1px solid #444b59;
        border-radius: 6px;
        color: #aab1bf;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        line-height: 16px;
    }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BODY {
        flex: 1 1 auto;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
        align-content: start;
        gap: 12px;
        box-sizing: border-box;
        min-height: 0;
        max-height: none;
        overflow-y: auto;
        padding: 18px 20px;
        scrollbar-color: #515867 transparent;
        scrollbar-width: thin;
    }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BODY #_SNLOAD {
        grid-column: 1 / -1;
        margin: 16px 0;
        color: #b5bdca;
        font-size: 13px;
        text-align: center;
    }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BODY > .igdm-media-card {
        position: relative;
        box-sizing: border-box;
        min-width: 0;
        margin: 0;
        overflow: hidden;
        border: 1px solid #3b414f;
        border-radius: 12px;
        background: #252a35;
        transition: border-color .16s ease, background .16s ease;
    }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BODY > .igdm-media-card:hover {
        border-color: #6779af;
        background: #2b3040;
    }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BODY > .igdm-media-card:has(.inner_box:checked) {
        border-color: #9cacff;
        box-shadow: inset 0 0 0 1px #9cacff;
    }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BODY .igdm-media-card > a {
        display: flex;
        flex-direction: column;
        gap: 0;
        padding: 0;
        color: #e8ebf5;
        font-size: 12px;
        font-weight: 550;
        line-height: 1.4;
        text-align: left;
        text-decoration: none;
        cursor: pointer;
    }
    .IG_POPUP_DIG.igdm-picker .igdm-media-card > a > img {
        display: block;
        box-sizing: border-box;
        width: 100%;
        height: 170px;
        margin: 0;
        border-radius: 0;
        background: #10131a;
        object-fit: contain;
    }
    .IG_POPUP_DIG.igdm-picker .igdm-caption {
        display: block;
        min-height: 17px;
        padding: 11px 33px 11px 12px;
    }
    .IG_POPUP_DIG.igdm-picker .igdm-caption::after {
        position: absolute;
        right: 12px;
        bottom: 10px;
        color: #b3bfff;
        content: "↓";
        font-size: 18px;
        font-weight: 400;
    }
    .IG_POPUP_DIG.igdm-picker .inner_box_wrapper {
        z-index: 4;
        display: grid;
        place-items: center;
        box-sizing: border-box;
        position: absolute;
        top: 9px;
        left: 9px;
        width: 29px;
        height: 29px;
        border: 1px solid #686f7e;
        border-radius: 8px;
        background: rgba(18, 21, 29, .88);
        cursor: pointer;
    }
    .IG_POPUP_DIG.igdm-picker .inner_box_wrapper:hover { border-color: #b5bfff; }
    .IG_POPUP_DIG.igdm-picker .inner_box {
        position: static;
        display: block;
        width: 16px;
        height: 16px;
        margin: 0;
        padding: 0;
        opacity: 1;
        appearance: auto;
        transform: none;
        accent-color: #9cacff;
        cursor: pointer;
    }
    .IG_POPUP_DIG.igdm-picker .inner_box ~ span { display: none; }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BODY .newTab,
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BODY .videoThumbnail {
        display: grid;
        place-items: center;
        box-sizing: border-box;
        position: absolute;
        right: 9px;
        top: 9px;
        width: 29px;
        height: 29px;
        padding: 5px;
        border: 1px solid #686f7e;
        border-radius: 8px;
        background: rgba(18, 21, 29, .88);
        color: #e0e5ef;
        line-height: 0;
        cursor: pointer;
    }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BODY .videoThumbnail { top: 46px; }
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BODY .newTab:hover,
    .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BODY .videoThumbnail:hover {
        border-color: #b5bfff;
        background: #353e56;
    }
    .IG_POPUP_DIG.igdm-picker .igdm-actions {
        flex: none;
        display: flex;
        justify-content: flex-end;
        gap: 9px;
        padding: 15px 20px;
        border-top: 1px solid #343945;
        background: #1c2029;
    }
    .IG_POPUP_DIG.igdm-picker .igdm-actions button {
        box-sizing: border-box;
        min-height: 39px;
        margin: 0;
        padding: 0 16px;
        border: 1px solid #4b5363;
        border-radius: 9px;
        background: #303645;
        color: #f2f3f9;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.3;
        cursor: pointer;
        transition: background .16s ease, border-color .16s ease;
    }
    .IG_POPUP_DIG.igdm-picker .igdm-actions button:hover:not(:disabled) {
        background: #3e465b;
        border-color: #747f9a;
    }
    .IG_POPUP_DIG.igdm-picker .igdm-actions #batch_download_direct {
        border-color: #aab9ff;
        background: #9aafff;
        color: #101628;
    }
    .IG_POPUP_DIG.igdm-picker .igdm-actions #batch_download_direct:hover:not(:disabled) {
        border-color: #cad2ff;
        background: #bfcbff;
    }
    .IG_POPUP_DIG.igdm-picker .igdm-actions button:disabled { opacity: .42; }
    .IG_POPUP_DIG.igdm-picker.igdm-single .igdm-selection,
    .IG_POPUP_DIG.igdm-picker.igdm-single #batch_download_selected { display: none; }
    .IG_POPUP_DIG.igdm-picker.igdm-single .IG_POPUP_DIG_BODY {
        grid-template-columns: 1fr;
        justify-items: center;
    }
    .IG_POPUP_DIG.igdm-picker.igdm-single .IG_POPUP_DIG_BODY > .igdm-media-card {
        width: min(240px, 100%);
    }
    .IG_POPUP_DIG.igdm-picker.igdm-single .igdm-media-card > a > img { height: 270px; }
    .IG_POPUP_DIG.igdm-picker button:focus-visible,
    .IG_POPUP_DIG.igdm-picker a:focus-visible,
    .IG_POPUP_DIG.igdm-picker input:focus-visible {
        outline: 2px solid #b2bdff;
        outline-offset: 2px;
    }
    @media (max-width: 440px) {
        .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_TITLE { padding: 16px 16px 12px; }
        .IG_POPUP_DIG.igdm-picker .IG_POPUP_DIG_BODY {
            grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
            gap: 10px;
            padding: 14px 16px;
        }
        .IG_POPUP_DIG.igdm-picker .igdm-media-card > a > img { height: 148px; }
        .IG_POPUP_DIG.igdm-picker .igdm-actions { padding: 12px 16px; }
    }
    @media (prefers-reduced-motion: reduce) {
        .IG_POPUP_DIG.igdm-picker * { transition: none !important; }
    }
    `);
    GM_addStyle(`
        /* Allow image context menus without hiding carousel slides or media. */
        article .x1n2onr6:nth-child(2) .xtijo5x:nth-child(2):not(:has(img, video, picture, canvas)),
        .xyri2b:nth-child(2) > div > div > .x1i10hfl .xtijo5x:not(:has(img, video, picture, canvas)),
        ._aa20 > .xtijo5x {
            pointer-events: none !important;
        }
        /* Preserve pointer targeting for actual media and the userscript's own overlay controls. */
        ._aa20 > .xtijo5x img,
        ._aa20 > .xtijo5x video,
        ._aa20 > .xtijo5x picture,
        .button_wrapper,
        .button_wrapper > button {
            pointer-events: auto !important;
        }
        .button_wrapper svg { pointer-events: none !important; }
    `);
    registerMenuCommand();

    getTranslationText(state.lang).then((res) => {
        state.locale[state.lang] = res;
        repaintingTranslations();
        registerMenuCommand();
    }).catch((err) => {
        registerMenuCommand();

        if (!state.lang.startsWith('en')) {
            console.error('getTranslationText catch error:', err);
        }
    });

    logger('Script Loaded', GM_info.script.name, 'version:', GM_info.script.version);
    registerPostClickHandlers();
    purgeCache();
    /*******************************/

    // Main Timer
    // eslint-disable-next-line no-unused-vars
    var timer = setInterval(function () {
        // page loading or unnecessary route
        if ($('div#splash-screen').length > 0 && !$('div#splash-screen').is(':hidden') ||
            location.pathname.match(/^\/(explore(\/.*)?|challenge\/?.*|direct\/?.*|qr\/?|accounts\/.*|emails\/.*|language\/?.*?|your_activity\/?.*|settings\/help(\/.*)?$)$/ig) ||
            !location.hostname.startsWith('www.') || location.pathname.startsWith('/auth_platform/codeentry/') || location.pathname.startsWith('/auth_platform/recaptcha/') ||
            location.pathname.startsWith('/challenge/') || location.pathname.startsWith('/consent/') || location.pathname.startsWith('/accounts/') ||
            ((location.pathname.endsWith('/followers/') || location.pathname.endsWith('/following/')) && ($(`body > div[class]:not([id^="mount"]) div div[role="dialog"]`).length > 0))
        ) {
            state.pageLoaded = false;
            return;
        }

        if (state.currentURL != location.href || !state.firstStarted || !state.pageLoaded) {
            console.log('Main Timer', 'trigging');

            clearInterval(state.GL_repeat);
            state.pageLoaded = false;
            state.firstStarted = true;
            state.currentURL = location.href;
            clearTimeout(state.homepageObserverDebounce);
            if (!state.currentURL.includes('/stories/') || !location.pathname.startsWith('/stories/')) {
                state.GL_observer.disconnect();
            }

            // Auto-skip "X shared this with you" dialog on any ?igsh= link
            if (USER_SETTING.SKIP_SHARED_WITH_YOU_DIALOG && window.location.search.includes("igsh")) {
                let tries = 0;
                const skipTimer = setInterval(() => {
                    tries += 1;

                    // stop early if URL no longer has ?igsh (navigation changed)
                    if (!window.location.search.includes("igsh")) {
                        clearInterval(skipTimer);
                        return;
                    }

                    skipSharedWithYouDialog();

                    if (tries >= 20) {
                        clearInterval(skipTimer);
                    }
                }, 200);
            }

            if (location.pathname.startsWith("/p/") || location.pathname.match(/^\/(.*?)\/(p|reel)\//ig) || location.pathname.startsWith("/reel/")) {
                state.GL_dataCache.stories = {};
                state.GL_dataCache.highlights = {};

                logger('isDialog');

                // This is a delayed function call that prevents the dialog element from appearing before the function is called.
                var dialogTimer = setInterval(() => {
                    // body > div[id^="mount"] section nav + div > article << (mobile page in single post) >>
                    // section:visible > main > div > div > div > div > div > hr << (single foreground post in page, non-floating // <hr> element here is literally the line beneath poster's username) >>
                    // section:visible > main > div > div > article > div > div > div > div > div > header (is the same as above, except that this is on the route of the /{username}/p/{shortcode} structure)
                    // section:visible > main > div > div.xdt5ytf << (former CSS selector for single foreground post in page, non-floating) >>
                    // <hr> is much more unique element than "div.xdt5ytf"
                    if ($(`body > div[class]:not([id^="mount"]) div div[role="dialog"] article,
                                section:visible > main > div > div > div > div > div > hr,
                                body > div[id^="mount"] section nav + div > article,
                                section:visible > main > div > div > article > div > div > div > div > div > header
                            `).length > 0) {
                        clearInterval(dialogTimer);

                        // This is to prevent the detection of the "Modify Video Volume" setting from being too slow.
                        setTimeout(() => {
                            clearInterval(state.GL_repeat);
                            state.GL_repeat = null;
                            onReadyMyDW(false);
                        }, 15);
                    }
                }, 100);

                state.pageLoaded = true;
            }

            if (location.pathname.startsWith("/reels/")) {
                logger('isReelsPage');
                setTimeout(() => {
                    onReels(false);
                }, 150);
                state.pageLoaded = true;
            }

            if (location.pathname === "/") {
                state.GL_dataCache.stories = {};
                state.GL_dataCache.highlights = {};

                let hasReferrer = state.GL_referrer?.match(/^\/(stories|highlights)\//ig) != null;

                logger('isHomepage', hasReferrer);
                setTimeout(() => {
                    onReadyMyDW(false, hasReferrer);

                    const element = $('div[id^="mount"] > div > div div > section > main div:not([class]):not([style]) > div > article')?.parent()[0];
                    if (element) {
                        state.GL_observer.disconnect();
                        state.GL_observer.observe(element, {
                            childList: true
                        });
                    }
                }, 150);

                state.pageLoaded = true;
            }

            if (
                $('header > *[class]:first-child img[alt]').length &&
                // eslint-disable-next-line no-useless-escape
                location.pathname.match(/^(\/)([0-9A-Za-z\.\-_]+)\/?(tagged|reels|saved)?\/?$/ig) &&
                !location.pathname.match(/^(\/explore\/?$|\/stories(\/.*)?$|\/p\/)/ig)
            ) {
                logger('isProfile');
                setTimeout(() => {
                    onProfileAvatar(false);
                }, 150);
                state.pageLoaded = true;
            }

            if (!state.pageLoaded) {
                // Call Instagram stories function
                if (location.pathname.startsWith("/stories/highlights/")) {
                    state.GL_dataCache.highlights = {};

                    logger('isHighlightsStory');

                    onHighlightsStory(false);
                    state.GL_repeat = setInterval(() => {
                        onHighlightsStoryThumbnail(false);
                    }, checkInterval);

                    if ($(".IG_DWHISTORY").length) {
                        setTimeout(() => {
                            if (USER_SETTING.SKIP_VIEW_STORY_CONFIRM) {
                                var $viewStoryButton = $('div[id^="mount"] section:last-child > div > div:not([class]) div:last-child > div[role="button"]').filter(function () {
                                    return $(this).children().length === 0 && this.textContent.trim() !== "";
                                });
                                $viewStoryButton?.trigger("click");
                            }

                            state.pageLoaded = true;
                        }, 150);
                    }
                }
                else if (location.pathname.startsWith("/stories/")) {
                    logger('isStory');

                    /*
                     *
                     *  $('body div[id^="mount"] > div > div > div[class]').length >= 2 &&
                     *  $('body div[id^="mount"] > div > div > div[class]').last().find('svg > path[d^="M16.792"], svg > path[d^="M34.6 3.1c-4.5"]').length > 0 &&
                     *  $('body div[id^="mount"] > div > div > div[class]').last().find('svg > polyline + line').length > 0
                     *
                     */
                    // ? detect logo element in left-top corner
                    if (
                        $('div[id^="mount"] section > div > a[href="/"]').length > 0 ||
                        $('div[id^="mount"] section > div > a[href^="/?hl="]').length > 0 ||
                        $('div[id^="mount"] section i[aria-label="Instagram"]').length > 0
                    ) {
                        $('.IG_DWSTORY').remove();
                        $('.IG_DWNEWTAB').remove();
                        if ($('.IG_DWSTORY_THUMBNAIL').length) {
                            $('.IG_DWSTORY_THUMBNAIL').remove();
                        }
                        if ($('.IG_DWSTORY_POSITION').length) {
                            $('.IG_DWSTORY_POSITION').remove();
                        }

                        onStory(false);

                        // Prevent buttons from being eaten by black holes sometimes
                        setTimeout(() => {
                            onStory(false);
                        }, 150);
                    }

                    if ($(".IG_DWSTORY").length) {
                        setTimeout(() => {
                            if (USER_SETTING.SKIP_VIEW_STORY_CONFIRM) {
                                var $viewStoryButton = $('div[id^="mount"] section:last-child > div > div:not([class]) div:last-child > div[role="button"]').filter(function () {
                                    return $(this).children().length === 0 && this.textContent.trim() !== "";
                                });
                                $viewStoryButton?.trigger("click");
                            }

                            state.pageLoaded = true;
                        }, 150);
                    }
                }
                else {
                    state.pageLoaded = false;
                    // Remove icons
                    // OPTIMIZATION: Single combined selector + .remove() — replaces 8 separate
                    // $('.CLASS').length checks + removes. Behavior is identical because
                    // .remove() is a no-op on an empty set.
                    $('.IG_DWSTORY, .IG_DWSTORY_ALL, .IG_DWNEWTAB, .IG_DWSTORY_THUMBNAIL, .IG_DWSTORY_POSITION, .IG_DWHISTORY, .IG_DWHISTORY_ALL, .IG_DWHINEWTAB, .IG_DWHISTORY_THUMBNAIL, .IG_DWHISTORY_POSITION').remove();
                }
            }

                state.GL_referrer = new URL(location.href).pathname;
        }
    }, checkInterval);

    /* Main functions */

    /**
     * getHighlightsStoryUsername
     * @description Get the current highlight story owner's username.
     *
     * @return {?String}
     */
    function getHighlightsStoryUsername() {
        let href = $('body > div section:visible a[href^="/"]').filter(function () {
            return $(this).attr('href').split('/').filter(e => e.length > 0).length === 1
        }).first().attr('href');

        return href?.split('/').filter(e => e.length > 0).at(0);
    }

    /**
     * onHighlightsStoryAll
     * @description Trigger user's highlight all download event.
     *
     * @return {void}
     */
    async function onHighlightsStoryAll() {
        updateLoadingBar(true);

        let date = new Date().getTime();
        let timestamp = Math.floor(date / 1000);
        let highlightId = location.href.replace(/\/$/ig, '').split('/').at(-1);
        let highStories = await getHighlightStories(highlightId);
        let username = highStories.data.reels_media[0].owner.username;

        if (USER_SETTING.DIRECT_DOWNLOAD_STORY) {

            let complete = 0;
            // OPTIMIZATION: Cache items array — accessed inside per-item setTimeout closures,
            // avoids repeated .reels_media[0].items lookups (was 3 lookups per iteration).
            const items = highStories.data.reels_media[0].items;
            const totalItems = items.length;
            setDownloadProgress(complete, totalItems);

            items.forEach((item, idx) => {
                setTimeout(() => {
                    if (USER_SETTING.RENAME_PUBLISH_DATE) {
                        timestamp = item.taken_at_timestamp;
                    }

                    item.display_resources.sort(function (a, b) {
                        if (a.config_width < b.config_width) return 1;
                        if (a.config_width > b.config_width) return -1;
                        return 0;
                    });

                    if (item.is_video) {
                        (async () => {
                            if (USER_SETTING.FORCE_RESOURCE_VIA_MEDIA && USER_SETTING.PREFER_DASH_MANIFEST && !state.tempFetchRateLimit) {
                                const mi = await getMediaInfo(item.id);
                                if (mi?.status === 'ok') {
                                    const handled = await tryHandleDashFromMediaItem({
                                        mediaItem: mi.items[0],
                                        username,
                                        sourceType: "highlights",
                                        timestamp,
                                        shortcode: mi.items[0].id,
                                        isPreview: false,
                                    });
                                    if (handled) {
                                        setDownloadProgress(++complete, totalItems);
                                        return;
                                    }
                                } else if (USER_SETTING.FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED) {
                                    state.tempFetchRateLimit = true;
                                }
                            }

                            await saveFiles(
                                item.video_resources[0].src,
                                {
                                    username,
                                    sourceType: "highlights",
                                    timestamp,
                                    filetype: 'mp4',
                                    shortcode: item.id
                                }
                            );
                            setDownloadProgress(++complete, totalItems);
                        })();
                    }
                    else {
                        saveFiles(item.display_resources[0].src,
                            {
                                username,
                                sourceType: "highlights",
                                timestamp,
                                filetype: 'jpg',
                                shortcode: item.id
                            }).then(() => {
                                setDownloadProgress(++complete, totalItems);
                            });
                    }
                }, 100 * idx);
            });
        }
        else {
            IG_createDM(false, true);
            createStoryListDOM(highStories, 'highlights');
        }
    }

    /**
     * onHighlightsStory
     * @description Trigger user's highlight download event or button display event.
     *
     * @param  {Boolean}  isDownload - Check if it is a download operation
     * @param  {Boolean}  isPreview - Check if it is need to open new tab
     * @return {void}
     */
    async function onHighlightsStory(isDownload, isPreview) {
        var username = getHighlightsStoryUsername();

        if (isDownload) {
            let date = new Date().getTime();
            let timestamp = Math.floor(date / 1000);
            let highlightId = location.href.replace(/\/$/ig, '').split('/').at(-1);
            let nowIndex = $("body > div section._ac0a header._ac0k > ._ac3r ._ac3n ._ac3p[style]").length ||
                $('body > div section:visible > div > div:not([class]) > div > div div.x1ned7t2.x78zum5 div.x1caxmr6').length ||
                $('body > div div:not([hidden]) section:visible > div div[style]:not([class]) > div').find('div div.x1ned7t2.x78zum5 div.x1caxmr6').length;
            let target = 0;

            updateLoadingBar(true);

            if (state.GL_dataCache.highlights[highlightId]) {
                logger('Fetch from memory cache:', highlightId);

                // OPTIMIZATION: cache items array — avoids 4 repeated property lookups
                const items = state.GL_dataCache.highlights[highlightId].data.reels_media[0].items;
                let totIndex = items.length;
                username = state.GL_dataCache.highlights[highlightId].data.reels_media[0].owner.username;
                target = items[totIndex - nowIndex];
            }
            else {
                let highStories = await getHighlightStories(highlightId);
                const items = highStories.data.reels_media[0].items;
                let totIndex = items.length;
                username = highStories.data.reels_media[0].owner.username;
                target = items[totIndex - nowIndex];

                state.GL_dataCache.highlights[highlightId] = highStories;
            }

            logger('onHighlightsStory', highlightId, state.GL_dataCache.highlights[highlightId]);

            if (USER_SETTING.RENAME_PUBLISH_DATE) {
                timestamp = target.taken_at_timestamp;
            }

            if (USER_SETTING.CAPTURE_IMAGE_VIA_MEDIA_CACHE) {
                const cached = getImageFromCache(target.id);
                if (cached && !state.GL_dataCache.highlights[highlightId].data.reels_media[0].items.filter(item => item.id === target.id).at(0).is_video) {
                    logger("[Restore Cached onHighlight]", target.id);
                    if (isPreview) {
                        openNewTab(cached);
                    }
                    else {
                        saveFiles(cached, {
                            username,
                            sourceType: "highlights",
                            timestamp,
                            filetype: 'jpg',
                            shortcode: target.id
                        });
                    }
                    return;
                }
            }

            if (USER_SETTING.FORCE_RESOURCE_VIA_MEDIA && !state.tempFetchRateLimit) {
                let result = await getMediaInfo(target.id);

                if (result.status === 'ok') {
                    // OPTIMIZATION: cache first media item — accessed 5+ times below
                    const mediaItem = result.items[0];
                    if (mediaItem.video_versions) {
                        const handled = await tryHandleDashFromMediaItem({
                            mediaItem: mediaItem,
                            username,
                            sourceType: "highlights",
                            timestamp,
                            shortcode: mediaItem.id,
                            isPreview,
                        });
                        if (handled) return;

                        if (isPreview) {
                            openNewTab(mediaItem.video_versions[0].url);
                        }
                        else {
                            saveFiles(mediaItem.video_versions[0].url,
                                {
                                    username,
                                    sourceType: "highlights",
                                    timestamp,
                                    filetype: 'mp4',
                                    shortcode: mediaItem.id
                                });
                        }
                    }
                    else {
                        if (isPreview) {
                            openNewTab(mediaItem.image_versions2.candidates[0].url);
                        }
                        else {
                            saveFiles(mediaItem.image_versions2.candidates[0].url, {
                                username,
                                sourceType: "highlights",
                                timestamp,
                                filetype: 'jpg',
                                shortcode: mediaItem.id
                            });
                        }
                    }
                }
                else {
                    if (USER_SETTING.FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED) {
                        delete state.GL_dataCache.highlights[highlightId];
                        state.tempFetchRateLimit = true;

                        onHighlightsStory(true, isPreview);
                    }
                    else {
                        alert('Fetch failed from Media API. API response message: ' + result.message);
                    }

                    logger(result);
                }
            }
            else {
                if (target.is_video) {
                    if (isPreview) {
                        openNewTab(target.video_resources.at(-1).src, username);
                    }
                    else {
                        saveFiles(target.video_resources.at(-1).src, {
                            username,
                            sourceType: "highlights",
                            timestamp,
                            filetype: 'mp4',
                            shortcode: target.id
                        });
                    }
                }
                else {
                    if (isPreview) {
                        openNewTab(target.display_resources.at(-1).src, username);
                    }
                    else {
                        saveFiles(target.display_resources.at(-1).src, {
                            username,
                            sourceType: "highlights",
                            timestamp,
                            filetype: 'jpg',
                            shortcode: target.id
                        });
                    }
                }

                state.tempFetchRateLimit = false;
            }

            updateLoadingBar(false);
        }
        else {
            // Add the stories download button
            if (!$('.IG_DWHISTORY').length) {
                let $element = null;

                // Default detecter (section layout mode)
                if ($('body > div section._ac0a').length > 0) {
                    $element = $('body > div section:visible._ac0a');
                }
                else {
                    $element = $('body > div section:visible > div > div[style]:not([class])');
                    $element.css('position', 'relative');
                }

                // Detecter for div layout mode
                if ($element.length === 0) {
                    let $$element = $('body > div div:not([hidden]) section:visible > div div[class][style] > div[style]:not([class])');
                    let nowSize = 0;

                    $$element.each(function () {
                        // OPTIMIZATION: cache $(this) — was wrapped 3 times per iteration
                        const $this = $(this);
                        const width = $this.width();
                        if (width > nowSize) {
                            nowSize = width;
                            $element = $this.children('div').first();
                        }
                    });
                }


                if ($element != null) {
                    //$element.css('position','relative');
                    $element.append(`<div data-ih-locale-title="DW" title="${_i18n("DW")}" class="IG_DWHISTORY">${SVG.DOWNLOAD}</div>`);
                    $element.append(`<div data-ih-locale-title="NEW_TAB" title="${_i18n("NEW_TAB")}" class="IG_DWHINEWTAB">${SVG.NEW_TAB}</div>`);

                    let $header = getStoryProgress(username);
                    if ($header.length > 1) {
                        $element.append(`<div data-ih-locale-title="DW_ALL" title="${_i18n("DW_ALL")}" class="IG_DWHISTORY_ALL">${SVG.DOWNLOAD_ALL}</div>`);
                    }

                    setStoryProgressIndexText($element, $header, 'IG_DWHISTORY_POSITION');

                    // replace something times ago format to publish time in first init
                    setTimeElementDateAndLocaleTime(getHighlightCurrentTimeElement($header));

                    //// Modify video volume
                    //if(USER_SETTING.MODIFY_VIDEO_VOLUME){
                    //    $element.find('video').each(function(){
                    //        $(this).on('play playing', function(){
                    //            if(!$(this).data('modify')){
                    //                $(this).data('modify', true);
                    //                this.volume = VIDEO_VOLUME;
                    //                logger('(highlight) Added video event listener #modify');
                    //            }
                    //        });
                    //    });
                    //}

                    // Make sure to first remove thumbnail button if still exists and highlight is a picture
                    if ($element.find('img[referrerpolicy]').length) {
                        $element.find('img[referrerpolicy]').each(function () {
                            $(this).one('load', function () {
                                const $img = $(this);
                                if ($img.data('remove-thumbnail')) {
                                    return;
                                }
                                $img.data('remove-thumbnail', true);
                                if ($element.find('.IG_DWHISTORY_THUMBNAIL').length === 0) {
                                    $('.IG_DWHISTORY_THUMBNAIL').remove();
                                    logger('(highlight) Manually removing thumbnail button');
                                }
                                else {
                                    logger('(highlight) Thumbnail button is not present for this picture');
                                }
                            });
                        });
                    }
                    // If the highlight's <video> (blob src) is already present in the DOM by the time
                    // onHighlightsStory runs (e.g. script initialized late, after 'timeupdate' already
                    // fired once), insert the thumbnail button immediately instead of relying on a
                    // future 'timeupdate' event that may never come. The MutationObserver-based
                    // listener elsewhere only attaches to <video> nodes that are added *after* it
                    // was created, so a late init otherwise misses the button entirely.
                    // Create separate late-thumbnail-insert flag to avoid conflict with
                    // insert-thumbnail, which may be misset prematurely to true.
    				// We also check for IG_DWHISTORY_THUMBNAIL so the button is only added if necessary.
                    else if ($element.find('video[src^="blob:"]').length) {
                        $element.find('video[src^="blob:"]').each(function () {
                            const $video = $(this);
                            if (!$video.data('late-thumbnail-insert')) {
                                $video.data('late-thumbnail-insert', true);
                                if ($element.find('.IG_DWHISTORY_THUMBNAIL').length === 0) {
                                    onHighlightsStoryThumbnail(false);
                                    logger('(highlight) Manually inserting thumbnail button (late init)');
                                }
                                else {
                                    logger('(highlight) Thumbnail button already inserted');
                                }
                            }
                        });
                    }

                    // Try to use event listener 'timeupdate' in order to detect if highlight is a video
                    //$element.find('video').each(function(){
                    //    $(this).on('timeupdate',function(){
                    //        if(!$(this).data('modify-thumbnail')){
                    //            if($element.find('.IG_DWHISTORY_THUMBNAIL').length === 0){
                    //                $(this).data('modify-thumbnail', true);
                    //                onHighlightsStoryThumbnail(false);
                    //                logger('(highlight) Manually inserting thumbnail button');
                    //            }
                    //            else{
                    //                $(this).data('modify-thumbnail', true);
                    //                logger('(highlight) Thumbnail button already inserted');
                    //            }
                    //        }
                    //    });
                    //});
                }
            }
        }
    }

    /**
     * onHighlightsStoryThumbnail
     * @description Trigger user's highlight video thumbnail download event or button display event.
     *
     * @param  {Boolean}  isDownload - Check if it is a download operation
     * @return {void}
     */
    async function onHighlightsStoryThumbnail(isDownload) {
        if (isDownload) {
            let date = new Date().getTime();
            let timestamp = Math.floor(date / 1000);
            let highlightId = location.href.replace(/\/$/ig, '').split('/').at(-1);
            let username = "";
            let nowIndex = $("body > div section._ac0a header._ac0k > ._ac3r ._ac3n ._ac3p[style]").length ||
                $('body > div section:visible > div > div:not([class]) > div > div div.x1ned7t2.x78zum5 div.x1caxmr6').length ||
                $('body > div div:not([hidden]) section:visible > div div[style]:not([class]) > div').find('div div.x1ned7t2.x78zum5 div.x1caxmr6').length;
            let target = "";

            updateLoadingBar(true);

            if (state.GL_dataCache.highlights[highlightId]) {
                logger('Fetch from memory cache:', highlightId);

                const items = state.GL_dataCache.highlights[highlightId].data.reels_media[0].items;
                let totIndex = items.length;
                username = state.GL_dataCache.highlights[highlightId].data.reels_media[0].owner.username;
                target = items[totIndex - nowIndex];
            }
            else {
                let highStories = await getHighlightStories(highlightId);
                const items = highStories.data.reels_media[0].items;
                let totIndex = items.length;
                username = highStories.data.reels_media[0].owner.username;
                target = items[totIndex - nowIndex];

                state.GL_dataCache.highlights[highlightId] = highStories;
            }

            if (USER_SETTING.RENAME_PUBLISH_DATE) {
                timestamp = target.taken_at_timestamp;
            }

            if (USER_SETTING.CAPTURE_IMAGE_VIA_MEDIA_CACHE) {
                const cached = getImageFromCache(target.id);
                if (cached) {
                    logger("[Restore Cached onHighlightsStoryThumbnail]", target.id);
                    saveFiles(cached, {
                        username,
                        sourceType: "highlights",
                        timestamp,
                        filetype: 'jpg',
                        shortcode: target.id
                    });
                    return;
                }
            }

            if (USER_SETTING.FORCE_RESOURCE_VIA_MEDIA && !state.tempFetchRateLimit) {
                let result = await getMediaInfo(target.id);

                if (result.status === 'ok') {
                    saveFiles(result.items[0].image_versions2.candidates[0].url, {
                        username,
                        sourceType: "highlights",
                        timestamp,
                        filetype: 'jpg',
                        shortcode: highlightId
                    });
                }
                else {
                    if (USER_SETTING.FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED) {
                        delete state.GL_dataCache.highlights[highlightId];
                        state.tempFetchRateLimit = true;

                        onHighlightsStoryThumbnail(true);
                    }
                    else {
                        alert('Fetch failed from Media API. API response message: ' + result.message);
                    }

                    logger(result);
                }
            }
            else {
                saveFiles(target.display_resources.at(-1).src, {
                    username,
                    sourceType: "highlights",
                    timestamp,
                    filetype: 'jpg',
                    shortcode: highlightId
                });
                state.tempFetchRateLimit = false;
            }

            updateLoadingBar(false);
        }
        else {
            setStoryProgressIndexByUsername($('.IG_DWHISTORY').parent(), getHighlightsStoryUsername(), 'IG_DWHISTORY_POSITION');

            if ($('body > div section video.xh8yej3').length) {
                // Add the stories thumbnail download button
                if (!$('.IG_DWHISTORY_THUMBNAIL').length) {
                    let $element = null;

                    // Default detecter (section layout mode)
                    if ($('body > div section._ac0a').length > 0) {
                        $element = $('body > div section:visible._ac0a');
                    }
                    else {
                        $element = $('body > div section:visible > div > div[style]:not([class])');
                        $element.css('position', 'relative');
                    }

                    // Detecter for div layout mode
                    if ($element.length === 0) {
                        let $$element = $('body > div div:not([hidden]) section:visible > div div[class][style] > div[style]:not([class])');
                        let nowSize = 0;

                        $$element.each(function () {
                            const $this = $(this);
                            const width = $this.width();
                            if (width > nowSize) {
                                nowSize = width;
                                $element = $this.children('div').first();
                            }
                        });
                    }

                    if ($element != null) {
                        $element.append(`<div data-ih-locale-title="VIDEO_THUMBNAIL" title="${_i18n("VIDEO_THUMBNAIL")}" class="IG_DWHISTORY_THUMBNAIL">${SVG.THUMBNAIL}</div>`);
                    }
                }
            }
            else {
                $('.IG_DWHISTORY_THUMBNAIL').remove();
            }
        }
    }

    /**
     * onReadyMyDW
     * @description Create an event entry point for the download button for the post.
     *
     * @param  {Boolean}  NoDialog    - Check if it not showing the dialog
     * @param  {?Boolean}  hasReferrer - Check if the source of the previous page is a story page
     * @return {void}
     */
    function onReadyMyDW(NoDialog, hasReferrer) {
        if (hasReferrer === true) {
            logger('hasReferrer', 'regenerated');
            $('article[data-snig="canDownload"], div[data-snig="canDownload"]').filter(function () {
                return $(this).find('.IG_DW_MAIN').length === 0
            }).removeAttr('data-snig');
        }

        clearInterval(state.GL_repeat);
        state.GL_repeat = null;

        // Whether is Instagram dialog?
        if (NoDialog == false) {
            const maxCall = 100;
            let i = 0;
            state.GL_repeat = setInterval(() => {
                // section:visible > main > div > div[data-snig="canDownload"] > div > div > div > hr << (single foreground post in page, non-floating // <hr> element here is literally the line beneath poster's username) >>
                // section:visible > main > div > div.xdt5ytf[data-snig="canDownload"] << (former CSS selector for single foreground post in page, non-floating) >>
                // <hr> is much more unique element than "div.xdt5ytf"
                if (i > maxCall || $(`article[data-snig="canDownload"],
                    section:visible > main > div > div[data-snig="canDownload"] > div > div > div > hr,
                    div[id^="mount"] div div div.x1n2onr6.x1vjfegm div[data-snig="canDownload"]
                `).length > 0) {
                    clearInterval(state.GL_repeat);
                    state.GL_repeat = null;

                    if (i > maxCall) {
                        //alert('Trying to call button creation method reached to maximum try times. If you want to re-register method, please open script menu and press "Reload Script" button or hotkey "R" to reload main timer.');
                        console.warn('onReadyMyDW() Timer', 'maximum number of repetitions reached, terminated');
                    }
                }

                logger('onReadyMyDW() Timer', 'repeating to call detection createDownloadButton()');
                createDownloadButton();
                i++;
            }, 50);
        }
        else {
            createDownloadButton();
        }
    }


    /**
     * initPostVideoFunction
     * @description Initialize settings related to the video resources in the post.
     *
     * @param  {JQuery<HTMLElement>}  $mainElement
     * @return {Void}
     */
    function initPostVideoFunction($mainElement) {
        // OPTIMIZATION: cache $videos — used in 3-4 separate .find('video') traversals below
        const $videos = $mainElement.find('video');

        $videos.each(function () {
            $(this).off('fullscreenchange.IG_videoControl').on('fullscreenchange.IG_videoControl', function () {
                const $vid = $(this);
                if ($vid.attr('style').includes('object-fit')) {
                    if (document.fullscreenElement == this) {
                        $vid.css('object-fit', 'contain');
                    }
                    else {
                        $vid.css('object-fit', 'cover');
                    }
                }
            });
        });

        // Disable video autoplay
        if (USER_SETTING.DISABLE_VIDEO_LOOPING) {
            $videos.each(function () {
                $(this).on('ended', function () {
                    this.pause();
                    logger('(post) Stop video playing #loop');
                });
            });
        }

        // Modify video volume
        if (USER_SETTING.MODIFY_VIDEO_VOLUME) {
            $videos.each(function () {
                $(this).on('play playing', function () {
                    const $vid = $(this);
                    if (!$vid.data('modify')) {
                        $vid.data('modify', true);
                        this.volume = state.videoVolume;
                        logger('(post) Added video event listener #modify');
                    }
                });
            });
        }

        if (USER_SETTING.HTML5_VIDEO_CONTROL) {
            const handleSwitchController = function (e) {
                e.preventDefault();
                e.stopPropagation();

                let $overlayElement = null;

                if ($overlayElement == null) {
                    $overlayElement = $(e.target).parents('div[aria-label][data-visualcompletion="ignore"]').first();
                }

                $videos.each(function () {
                    $(this).css('z-index', '2');
                    $(this).attr('controls', true);
                    state.GL_weakCache.overlay.set(this, $overlayElement);
                });

                $overlayElement.css('z-index', '-10');
                $mainElement.find('a[href^="/reels/"]').first().attr("draggable", false);
            };

            $mainElement.off('contextmenu.IG_videoControl').on('contextmenu.IG_videoControl', handleSwitchController);

            $videos.each(function () {
                const $video = $(this);
                if (!$video.data('controls')) {

                    logger('(post) Added video html5 contorller #modify');

                    if (USER_SETTING.MODIFY_VIDEO_VOLUME) {
                        this.volume = state.videoVolume;

                        $video.on('loadstart', function () {
                            this.volume = state.videoVolume;
                        });
                    }


                    let $mute_button_wrapper = $video.parent().find('video + div > div');
                    $mute_button_wrapper = $mute_button_wrapper.add($mainElement);

                    // eslint-disable-next-line no-unused-vars
                    let $element_mute_button = $mute_button_wrapper.find('button[type="button"], div[role="button"]').filter(function (idx) {
                        const $b = $(this);
                        // This is mute/unmute's icon
                        return $b.width() <= 64 && $b.height() <= 64 && $b.find('svg > path[d^="M16.636 7.028a1.5"], svg > path[d^="M1.5 13.3c-.8"]').length > 0;
                    });

                    state.GL_weakCache.mutedButton.set(this, $element_mute_button);

                    let $targets = $video.parent().find('video + div > div').first();

                    // Hide layout to show controller
                    $targets.off('contextmenu.IG_videoControl').on('contextmenu.IG_videoControl', handleSwitchController);

                    // Restore layout to show details interface
                    $video.on('contextmenu', function (e) {
                        e.preventDefault();
                        e.stopPropagation();

                        $video.css('z-index', '-1');
                        $video.removeAttr('controls');

                        $targets.css('z-index', '1');
                        state.GL_weakCache.overlay.get(this)?.css('z-index', '1');
                        $(this).parents('a[href^="/reels/"]').first().removeAttr("draggable");
                    });

                    $video.on('volumechange', function () {
                        let video = this;
                        let $element_mute_button = state.GL_weakCache.mutedButton.get(this) || {};
                        let is_element_muted = $element_mute_button.find && $element_mute_button.find('svg > path[d^="M16.636"]').length === 0;

                        if (this.muted != is_element_muted) {
                            this.volume = state.videoVolume;

                            if ($element_mute_button.length === 1) {
                                triggerReactClickHandler($element_mute_button.first()[0]);
                            }
                            else {
                                let $firstElementMuteButton = $element_mute_button.filter(function () {
                                    return $(this).closest(state.GL_weakCache.overlay.get(video)).length > 0;
                                }).first();

                                triggerReactClickHandler($firstElementMuteButton.first()[0]);
                            }
                        }

                        const $v = $(this);
                        if ($v.data('completed')) {
                            state.videoVolume = this.volume;
                            GM_setValue('G_VIDEO_VOLUME', this.volume);
                        }

                        if (this.volume == state.videoVolume) {
                            $v.data('completed', true);
                        }
                    });

                    $video.parents('a[href^="/reels/"]').first().on('click', function (e) {
                        if ($video.attr('controls')) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                    });

                    $video.css('position', 'absolute');
                    $video.data('controls', true);
                }
            });
        }

        var $buttonParent = $mainElement.find('video + div > div').first();
        toggleVolumeSilder($videos, $buttonParent, 'post', 'bottom');
    };


    /**
     * createDownloadButton
     * @description Create a download button in the upper right corner of each post.
     *
     * @return {void}
     */
    function createDownloadButton() {
        // Add download icon per each posts
        // eslint-disable-next-line no-unused-vars
        $('article, section:visible > main > div > div > div > div > div > hr').map(function (index) {
            return $(this).is('section:visible > main > div > div > div > div > div > hr') ? $(this).parent().parent().parent().parent()[0] : this;
        }).filter(function () {
            const $this = $(this);
            return $this.height() > 0 && $this.width() > 0
        })
            .each(function (index) {
                // OPTIMIZATION: cache $(this) — referenced 8+ times in this each() body
                const $self = $(this);
                // If it is have not download icon
                // class x1iyjqo2 mean user profile pages post list container
                if (!$self.attr('data-snig') && !$self.hasClass('x1iyjqo2') && !$self.children('article')?.hasClass('x1iyjqo2') && $self.parents('div#scrollview').length === 0) {
                    logger("Found post container", $self);

                    const $mainElement = $self;
                    const tagName = this.tagName;

                    // not loop each in single top post
                    if (tagName === "DIV" && index != 0) {
                        return;
                    }

                    const $childElement = $mainElement.children("div").children("div");

                    if ($mainElement.find('> .button_wrapper, .button_wrapper').length > 0) {
                        $mainElement.attr('data-snig', 'canDownload');
                        return;
                    }

                    if ($childElement.length === 0) return;

                    logger("Found insert point", $childElement);

                    // Modify carousel post counter's position to not interfere with our buttons
                    // OPTIMIZATION: cache repeated ._acay lookup
                    const $acay = $mainElement.find('._acay');
                    if ($acay.length > 0) {
                        const $acayX24 = $mainElement.find('._acay + .x24i39r');
                        if ($acayX24.length > 0) {
                            $acayX24.css('top', '37px');
                        }

                        const observeNode = $acay.first().parent()[0];
                        var observer = new MutationObserver(function () {
                            $mainElement.find('._acay + .x24i39r').css('top', '37px');
                        });

                        observer.observe(observeNode, {
                            childList: true
                        });
                    }

                    $childElement.eq((tagName === "DIV") ? 0 : $childElement.length - 2).append(`<div class="button_wrapper">`);

                    // Add icons
                    const DownloadElement = `<button type="button" data-ih-locale-title="DW" data-ih-locale-aria="DW" aria-label="${_i18n("DW")}" title="${_i18n("DW")}" class="IG_DW_MAIN">${SVG.DOWNLOAD}</button>`;
                    const NewTabElement = `<button type="button" data-ih-locale-title="NEW_TAB" data-ih-locale-aria="NEW_TAB" aria-label="${_i18n("NEW_TAB")}" title="${_i18n("NEW_TAB")}" class="IG_NEWTAB_MAIN">${SVG.NEW_TAB}</button>`;
                    const ThumbnailElement = `<button type="button" data-ih-locale-title="VIDEO_THUMBNAIL" data-ih-locale-aria="VIDEO_THUMBNAIL" aria-label="${_i18n("VIDEO_THUMBNAIL")}" title="${_i18n("VIDEO_THUMBNAIL")}" class="IG_THUMBNAIL_MAIN">${SVG.THUMBNAIL}</button>`;
                    const ViewerElement = `<button type="button" data-ih-locale-title="IMAGE_VIEWER" data-ih-locale-aria="IMAGE_VIEWER" aria-label="${_i18n("IMAGE_VIEWER")}" title="${_i18n("IMAGE_VIEWER")}" class="IG_IMAGE_VIEWER">${SVG.FULLSCREEN}</button>`;

                    // OPTIMIZATION: cache .button_wrapper inside $childElement (used 5+ times)
                    const $buttonWrapper = $childElement.find(".button_wrapper");
                    $buttonWrapper.append(DownloadElement);

                    const resource_count = $mainElement.find(resourceCountSelector).length;

                    if (resource_count > 1 && USER_SETTING.DIRECT_DOWNLOAD_VISIBLE_RESOURCE && !USER_SETTING.DIRECT_DOWNLOAD_ALL) {
                        const DownloadAllElement = `<div data-ih-locale-title="DW_ALL" title="${_i18n("DW_ALL")}" class="IG_DW_ALL_MAIN">${SVG.DOWNLOAD_ALL}</div>`;
                        $buttonWrapper.append(DownloadAllElement);
                    }

                    $buttonWrapper.append(NewTabElement);

                    let $resourceLayout = $childElement.filter(function () {
                        const $this = $(this);
                        return $this.width() > 100 && $this.height() > 100;
                    }).first();

                    let $isNewPostStyleLayout = $resourceLayout.find(`a[role="link"][tabindex="0"][href^="/"]`).filter(function () {
                        const href = $(this).attr('href');
                        return !href.startsWith("/p/") && !href.startsWith("/reels/");
                    }).length > 0;

                    // Make sure the button wrapper doesn't cover the "More Options" button.
                    if ($isNewPostStyleLayout) {
                        $buttonWrapper.css('top', '45px');
                    }

                    setTimeout(() => {
                        // eslint-disable-next-line no-unused-vars
                        const checkNodeCallback = (entries, observer) => {
                            entries.forEach((entry) => {
                                if (entry.isIntersecting) {
                                    var $targetNode = $(entry.target);
                                    // OPTIMIZATION: combined remove selector instead of 2 separate
                                    $childElement.find('.IG_THUMBNAIL_MAIN, .IG_IMAGE_VIEWER').remove();

                                    // Check if video?
                                    if ($targetNode.find('video').length > 0) {
                                        // FIX: clear any stale image URL when the visible item is a video
                                        $mainElement.removeData('igMedia_displayResourceURL');

                                        if ($childElement.find('.IG_THUMBNAIL_MAIN').length === 0) {
                                            $childElement.find(".button_wrapper").append(ThumbnailElement);
                                        }

                                        initPostVideoFunction($mainElement);
                                    }
                                    // is Image
                                    else {
                                        const imgSrc = $targetNode.find('img').attr('src');
                                        $mainElement.data('igMedia_displayResourceURL', imgSrc);

                                        $childElement.find(".button_wrapper").append(ViewerElement);
                                    }
                                }
                            });
                        };

                        const observer_i = new IntersectionObserver(checkNodeCallback, {
                            root: $childElement.find('.button_wrapper').parent()[0],
                            rootMargin: "0px",
                            threshold: 0.1,
                        });

                        // trigger when switching resources
                        // eslint-disable-next-line no-unused-vars
                        const observer = new MutationObserver(function (mutation, owner) {
                            var target = mutation.at(0)?.target;
                            observer_i.disconnect();

                            $(target).find('li').each(function () {
                                const $t = $(target);
                                if ($t.find('video').length > 0 || $t.find('img').length > 0) {
                                    observer_i.observe(this);
                                }
                            });
                        });

                        let $triggeredTarget = null;
                        // first onload
                        $childElement.find('.button_wrapper').parent().find('ul li, div[role="button"] > div, div[class] > div').each(function () {
                            const $li = $(this);
                            const $targetNode = $li.find('video').length > 0
                                ? $li.find('video')?.first()
                                : $li.find('img')?.first();

                            // Check if the node is visible and has size, 
                            // and not the same node as last triggered one to avoid duplicated trigger 
                            // when switching resources with same container
                            if (
                                $targetNode.length > 0 &&
                                $targetNode.is(':visible') &&
                                $targetNode.get(0).getBoundingClientRect().width > 0 &&
                                $targetNode.get(0).getBoundingClientRect().height > 0 &&
                                this.getBoundingClientRect().width > 64 &&
                                this.getBoundingClientRect().height > 64 &&
                                $triggeredTarget?.get(0) != $targetNode?.get(0)
                            ) {
                                // ignore the image without alt attribute, 
                                // because it is usually used for video thumbnail
                                if (
                                    $targetNode.get(0).tagName === "IMG" &&
                                    $targetNode.attr('alt')?.length == 0
                                ) {
                                    return;
                                }

                                $triggeredTarget = $targetNode;
                                observer_i.observe(this);
                            }
                        });

                        const $bwParent = $childElement.find('.button_wrapper').parent();
                        const listRoot =
                            $bwParent.find('ul li, div[role="button"] > div').first().parent()[0] ||
                            $bwParent.find('ul').first()[0];

                        if (listRoot) {
                            observer.observe(listRoot, {
                                attributes: true,
                                childList: true,
                            });
                        } else {
                            initPostVideoFunction($mainElement);
                            logger("Cannot find resource list root element, thumbnail and viewer button may not work.");
                        }

                    }, 50);

                    $childElement.css('position', 'relative');

                    // Add the mark that download is ready
                    var username = $self.find("header > div:last-child > div:first-child span a").first().text() || $self.find('a[href^="/"]').filter(function () {
                        return $(this)?.text()?.length > 0;
                    }).first().text();

                    $self.attr('data-snig', 'canDownload');
                    $self.data('username', username);
                }
            });
    }


    /**
     * registerPostClickHandlers
     * @description Registers delegated body-level handlers for post download/view actions.
     *
     * FIX: Registers all post-button click handlers exactly once on $('body') using
     * the event namespace ".igMediaPost". Body-level delegation means jQuery stores
     * only a single handler object per event type (not one per article), and the
     * handlers themselves never hold strong references to article DOM nodes —
     * they resolve the relevant article at click-time via $(this).closest().
     *
     * Cleanup is a single $('body').off('.igMediaPost') call in reloadScript().
     */
    function registerPostClickHandlers() {
        if (state.bodyEventsRegistered) return;
        state.bodyEventsRegistered = true;

        // OPTIMIZATION: All body-level delegated handlers now use cached $body reference
        $body.on('click.igMediaPost', '.IG_IMAGE_VIEWER', function () {
            const { $article } = getPostContextFromButton(this);
            let url = $article.data('igMedia_displayResourceURL');

            if (!url) {
                url = $article.find('img:visible').filter(function () {
                    const $img = $(this);
                    return (($img.attr('alt') || '').length > 0) && (($img.attr('src') || '').length > 0);
                }).first().attr('src');
            }

            if (url) {
                openImageViewer(url);
            } else {
                alert("Cannot find resource url.");
            }
        });

        $body.on('click.igMediaPost', '.IG_THUMBNAIL_MAIN', async function () {
            updateLoadingBar(true);

            try {
                const { $article, postPath } = getPostContextFromButton(this);
                if ($article.length === 0 || !postPath) {
                    alert('Cannot determine post path.');
                    return;
                }

                state.GL_username = $article.data('username');
                state.GL_postPath = postPath;
                const index = getVisibleNodeIndex($article);

                IG_createDM(true, false);

                const totalInserted = await createMediaListDOM(
                    state.GL_postPath,
                    ".IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY",
                    "",
                    $article
                );

                if (!totalInserted || totalInserted < 1) {
                    alert('Cannot find thumbnail URL.');
                    return;
                }

                const $popupBody = $('.IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY');
                const $videoThumbnail = $popupBody
                    .find('a[data-globalindex="' + (index + 1) + '"]')
                    .parent()
                    .find('.videoThumbnail')
                    .first();

                if ($videoThumbnail.length > 0) {
                    $videoThumbnail.trigger("click");
                }
                else {
                    alert('Cannot find thumbnail URL.');
                }
            }
            catch (err) {
                logger('registerPostClickHandlers .IG_THUMBNAIL_MAIN', err);
                alert('Cannot find thumbnail URL.');
            }
            finally {
                updateLoadingBar(false);
                $('.IG_POPUP_DIG').remove();
            }
        });

        $body.on('click.igMediaPost', '.IG_NEWTAB_MAIN', async function () {
            updateLoadingBar(true);

            try {
                const { $article, postPath } = getPostContextFromButton(this);
                if ($article.length === 0 || !postPath) {
                    alert('Cannot determine post path.');
                    return;
                }

                state.GL_username = $article.data('username');
                state.GL_postPath = postPath;
                const index = getVisibleNodeIndex($article);

                IG_createDM(true, false);

                const totalInserted = await createMediaListDOM(
                    state.GL_postPath,
                    ".IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY",
                    "",
                    $article
                );

                if (!totalInserted || totalInserted < 1) {
                    alert('Cannot find open tab URL.');
                    return;
                }

                const $popupBody = $('.IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY');
                const $linkElement = $popupBody.find('a[data-globalindex="' + (index + 1) + '"]');

                if ($linkElement.length === 0) {
                    alert('Cannot find open tab URL.');
                    return;
                }

                if (USER_SETTING.FORCE_RESOURCE_VIA_MEDIA && USER_SETTING.NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST) {
                    triggerLinkElement($linkElement.first()[0], true);
                }
                else {
                    const href = $linkElement.data('href');
                    if (href) {
                        openNewTab(replaceSameOriginHost(href));
                    }
                    else {
                        alert('Cannot find open tab URL.');
                    }
                }
            }
            catch (err) {
                logger('registerPostClickHandlers .IG_NEWTAB_MAIN', err);
                alert('Cannot find open tab URL.');
            }
            finally {
                updateLoadingBar(false);
                $('.IG_POPUP_DIG').remove();
            }
        });

        $body.on('click.igMediaPost', '.IG_DW_ALL_MAIN', async function () {
            try {
                const { $article, postPath } = getPostContextFromButton(this);
                if ($article.length === 0 || !postPath) {
                    alert('Cannot determine post path.');
                    return;
                }

                state.GL_username = $article.data('username');
                state.GL_postPath = postPath;

                IG_createDM(USER_SETTING.DIRECT_DOWNLOAD_ALL, true);
                $("#article-id").html(`<a href="https://www.instagram.com/p/${state.GL_postPath}">${state.GL_postPath}</a>`);

                const totalInserted = await createMediaListDOM(
                    state.GL_postPath,
                    ".IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY",
                    _i18n("LOAD_BLOB_MULTIPLE")
                );

                if (!totalInserted || totalInserted < 1) {
                    $('.IG_POPUP_DIG').remove();
                    return;
                }

                const links = [];
                $('.IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY a').each(function () {
                    links.push($(this));
                });

                await batchDownloadPostFiles(links);
            }
            catch (err) {
                logger('registerPostClickHandlers .IG_DW_ALL_MAIN', err);
            }
            finally {
                $('.IG_POPUP_DIG').remove();
            }
        });

        $body.on('click.igMediaPost', '.IG_DW_MAIN', async function () {
            try {
                const { $article, postPath } = getPostContextFromButton(this);
                if ($article.length === 0 || !postPath) {
                    alert('Cannot determine post path.');
                    return;
                }

                state.GL_username = $article.data('username');
                state.GL_postPath = postPath;

                IG_createDM(USER_SETTING.DIRECT_DOWNLOAD_ALL, true);
                $("#article-id").html(`<a href="https://www.instagram.com/p/${state.GL_postPath}">${state.GL_postPath}</a>`);

                if (USER_SETTING.DIRECT_DOWNLOAD_VISIBLE_RESOURCE) {
                    updateLoadingBar(true);
                    IG_setDM(true);

                    try {
                        const index = getVisibleNodeIndex($article);

                        const totalInserted = await createMediaListDOM(
                            state.GL_postPath,
                            ".IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY",
                            "",
                            $article
                        );

                        if (!totalInserted || totalInserted < 1) {
                            alert('Cannot find download URL.');
                            return;
                        }

                        const $popupBody = $('.IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY');
                        const $targetLink = $popupBody.find('a[data-globalindex="' + (index + 1) + '"]');
                        const href = $targetLink.data('href');

                        if ($targetLink.length > 0 && href) {
                            $targetLink.trigger("click");
                        }
                        else {
                            alert('Cannot find download URL.');
                        }
                    }
                    catch (err) {
                        logger('registerPostClickHandlers .IG_DW_MAIN visibleResource', err);
                        alert('Cannot find download URL.');
                    }
                    finally {
                        updateLoadingBar(false);
                        $('.IG_POPUP_DIG').remove();
                    }

                    return;
                }

                if (!USER_SETTING.DIRECT_DOWNLOAD_ALL) {
                    let s = 0;
                    const $resourceItems = $article.find(resourceCountSelector);
                    let multiple = $resourceItems.length;
                    let blob = USER_SETTING.FORCE_FETCH_ALL_RESOURCES;
                    const publish_time = new Date(
                        $article.find('a[href] time[datetime]').filter(function () {
                            let href = $(this).parents("a[href]").attr("href");
                            return href?.startsWith("/p/") || href?.match(/\/([\w.\-_]+)\/(p|reel)\//ig) != null;
                        }).first().attr('datetime')
                    ).getTime();

                    if (multiple) {
                        $resourceItems.each(function () {
                            let element_videos = $(this).parent().parent().parent().find('video');
                            if (element_videos && element_videos.attr('src')) {
                                blob = true;
                            }
                        });

                        if (blob || USER_SETTING.FORCE_RESOURCE_VIA_MEDIA) {
                            await createMediaListDOM(
                                state.GL_postPath,
                                ".IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY",
                                _i18n("LOAD_BLOB_MULTIPLE"),
                                $article
                            );
                        }
                        else {
                            const $popupBody = $('.IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY');
                            $resourceItems.each(function () {
                                s++;
                                const $this = $(this);
                                let element_videos = $this.find('video');
                                let element_images = $this.find('._aagv img');
                                let imgLink = (element_images.attr('srcset')) ? element_images.attr('srcset').split(" ")[0] : element_images.attr('src');

                                if (element_videos && element_videos.attr('src')) {
                                    blob = true;
                                }
                                if (element_images && imgLink) {
                                    $popupBody.append(`<a datetime="${publish_time}" data-needed="direct" data-path="${state.GL_postPath}" data-name="photo" data-type="jpg" data-username="${state.GL_username || ''}" data-globalIndex="${s}" href="javascript:;" data-href="${imgLink}"><img src="${imgLink}" alt="" loading="lazy" /><span class="igdm-caption"><span data-ih-locale="IMG">${_i18n("IMG")}</span> ${s}</span></a>`);
                                }
                            });

                            if (blob) {
                                await createMediaListDOM(
                                        state.GL_postPath,
                                        ".IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY",
                                        _i18n("LOAD_BLOB_RELOAD"),
                                        $article
                                    );
                            }
                        }
                    }
                    else {
                        if (USER_SETTING.FORCE_RESOURCE_VIA_MEDIA) {
                            await createMediaListDOM(
                                state.GL_postPath,
                                ".IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY",
                                _i18n("LOAD_BLOB_MULTIPLE"),
                                $article
                            );
                        }
                        else {
                            s++;
                            let element_videos = $article.find('video');
                            let element_images = $article.find('._aagv img');
                            let imgLink = (element_images.attr('srcset')) ? element_images.attr('srcset').split(" ")[0] : element_images.attr('src');

                            if (element_videos && element_videos.attr('src')) {
                                await createMediaListDOM(
                                    state.GL_postPath,
                                    ".IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY",
                                    _i18n("LOAD_BLOB_ONE"),
                                    $article
                                );
                            }
                            if (element_images && imgLink) {
                                $('.IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY').append(`<a datetime="${publish_time}" data-needed="direct" data-path="${state.GL_postPath}" data-name="photo" data-type="jpg" data-username="${state.GL_username || ''}" data-globalIndex="${s}" href="javascript:;" data-href="${imgLink}"><img src="${imgLink}" alt="" loading="lazy" /><span class="igdm-caption"><span data-ih-locale="IMG">${_i18n("IMG")}</span> ${s}</span></a>`);
                            }
                        }
                    }
                }

                $('.IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY a').each(function () {
                    const $a = $(this);
                    if ($a.parent().is('div') && $a.prev('.inner_box_wrapper').length > 0) {
                        return;
                    }

                    $a.wrap('<div class="igdm-media-card"></div>');
                    $a.before('<label class="inner_box_wrapper"><input class="inner_box" type="checkbox" aria-label="Select media"><span></span></label>');
                    $a.after(`<button type="button" data-ih-locale-title="NEW_TAB" aria-label="${_i18n("NEW_TAB")}" title="${_i18n("NEW_TAB")}" class="newTab">${SVG.NEW_TAB}</button>`);

                    if ($a.data('name') == 'video') {
                        $a.after(`<button type="button" data-ih-locale-title="VIDEO_THUMBNAIL" aria-label="${_i18n("VIDEO_THUMBNAIL")}" title="${_i18n("VIDEO_THUMBNAIL")}" class="videoThumbnail">${SVG.THUMBNAIL}</button>`);
                    }
                });

                if (USER_SETTING.DIRECT_DOWNLOAD_ALL) {
                    const totalInserted = await createMediaListDOM(
                        state.GL_postPath,
                        ".IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY",
                        _i18n("LOAD_BLOB_MULTIPLE")
                    );

                    if (!totalInserted || totalInserted < 1) {
                        $('.IG_POPUP_DIG').remove();
                        return;
                    }

                    const links = [];
                    $('.IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY a').each(function () {
                        links.push($(this));
                    });

                    await batchDownloadPostFiles(links);
                    $('.IG_POPUP_DIG').remove();
                }
            }
            catch (err) {
                logger('registerPostClickHandlers .IG_DW_MAIN', err);
                $('.IG_POPUP_DIG').remove();
            }
        });
    }


    /**
     * filterResourceData
     * @description Standardized resource object format.
     *
     * @param  {Object}  data
     * @return {Object}
     */
    function filterResourceData(data) {
        var resource = data.shortcode_media ?? data;
        if (resource.owner == null && resource.user != null) {
            resource.owner = resource.user;
        }

        if (resource.owner == null) {
            logger('carousel_media:', 'undefined username');
            alert('carousel_media: undefined username');
        }

        return resource;
    }


    /**
     * createMediaListDOM
     * @description Create a list of media elements from post URLs.
     *
     * @param  {String}  postURL
     * @param  {String}  selector - Use CSS element selectors to choose where it appears.
     * @param  {String}  message - i18n display loading message
     * @return {Promise<number>}  The number of <a> elements inserted into the DOM
     */
    async function createMediaListDOM(postURL, selector, message, fallbackArticle = null) {
        const $fallbackArticle = fallbackArticle ? $(fallbackArticle).first() : $();
        try {
            // OPTIMIZATION: cache the popup body selection used many times below
            const $target = $(selector);
            $target.find('a').remove();
            $target.append('<p id="_SNLOAD">' + message + '</p>');
            $('.IG_POPUP_DIG #batch_download_selected, .IG_POPUP_DIG #batch_download_direct').prop('disabled', true);
            let result = null;
            let apiError = null;
            try {
                result = await getBlobMedia(postURL);
            } catch (err) {
                apiError = err;
            }

            const hasMediaSource = (data) => {
                const item = data?.shortcode_media ?? data;
                return Boolean(
                    item?.video_url || item?.display_resources?.length ||
                    item?.image_versions2?.candidates?.length || item?.video_versions?.length ||
                    item?.carousel_media?.length || item?.edge_sidecar_to_children?.edges?.length
                );
            };

            if (!result || !hasMediaSource(result.data)) {
                const fallbackResource = $fallbackArticle.length
                    ? getCurrentVisibleMediaFromDOM($fallbackArticle, postURL)
                    : null;
                if (fallbackResource) {
                    logger('getBlobMedia() failed or returned no media; using current visible media from DOM', apiError?.message || apiError || 'No media source');
                    result = { type: 'query_id', data: fallbackResource };
                } else if (apiError) {
                    throw apiError;
                } else {
                    throw new Error('No media source returned by Instagram.');
                }
            }

            let resource = filterResourceData(result.data);

            if (result.type === 'query_hash') {
                let idx = 1;

                // GraphVideo
                if (resource.__typename == "GraphVideo" && resource.video_url) {
                    $target.append(`<a media-id="${resource.id}" datetime="${resource.taken_at_timestamp}" data-blob="true" data-needed="direct" data-path="${resource.shortcode}" data-name="video" data-type="mp4" data-username="${resource.owner.username}" data-globalIndex="${idx}" href="javascript:;" data-href="${resource.video_url}"><img src="${resource.display_resources[1].src}" alt="" loading="lazy" /><span class="igdm-caption"><span data-ih-locale="VID">${_i18n("VID")}</span> ${idx}</span></a>`);
                    idx++;

                    if (resource.video_dash_manifest) {
                        state.GL_mediaDataCache[resource.id] = resource;
                    }
                }
                // GraphImage
                if (resource.__typename == "GraphImage") {
                    $target.append(`<a media-id="${resource.id}" datetime="${resource.taken_at_timestamp}" data-blob="true" data-needed="direct" data-path="${resource.shortcode}" data-name="photo" data-type="jpg" data-username="${resource.owner.username}" data-globalIndex="${idx}" href="javascript:;" data-href="${resource.display_resources[resource.display_resources.length - 1].src}"><img src="${resource.display_resources[1].src}" alt="" loading="lazy" /><span class="igdm-caption"><span data-ih-locale="IMG">${_i18n("IMG")}</span> ${idx}</span></a>`);
                    idx++;
                }
                // GraphSidecar
                if (resource.__typename == "GraphSidecar" && resource.edge_sidecar_to_children) {
                    for (let e of resource.edge_sidecar_to_children.edges) {
                        if (e.node.__typename == "GraphVideo") {
                            $target.append(`<a media-id="${e.node.id}" datetime="${resource.taken_at_timestamp}" data-blob="true" data-needed="direct" data-path="${resource.shortcode}" data-name="video" data-type="mp4" data-username="${resource.owner.username}" data-globalIndex="${idx}" href="javascript:;" data-href="${e.node.video_url}"><img src="${e.node.display_resources[1].src}" alt="" loading="lazy" /><span class="igdm-caption"><span data-ih-locale="VID">${_i18n("VID")}</span> ${idx}</span></a>`);
                            if (e.node.video_dash_manifest) {
                                state.GL_mediaDataCache[e.node.id] = e.node;
                            }
                        }

                        if (e.node.__typename == "GraphImage") {
                            $target.append(`<a media-id="${e.node.id}" datetime="${resource.taken_at_timestamp}" data-blob="true" data-needed="direct" data-path="${resource.shortcode}" data-name="photo" data-type="jpg" data-username="${resource.owner.username}" data-globalIndex="${idx}" href="javascript:;" data-href="${e.node.display_resources[e.node.display_resources.length - 1].src}"><img src="${e.node.display_resources[1].src}" alt="" loading="lazy" /><span class="igdm-caption"><span data-ih-locale="IMG">${_i18n("IMG")}</span> ${idx}</span></a>`);
                        }
                        idx++;
                    }
                }
            }
            else {
                if (resource.carousel_media) {
                    logger('carousel_media');

                    resource.carousel_media.forEach((mda, ind) => {
                        let idx = ind + 1;
                        // Image
                        if (mda.video_versions == null) {
                            mda.image_versions2.candidates.sort(function (a, b) {
                                let aSTP = new URL(a.url).searchParams.get('stp');
                                let bSTP = new URL(b.url).searchParams.get('stp');

                                if (aSTP && bSTP) {
                                    if (aSTP.length > bSTP.length) return 1;
                                    if (aSTP.length < bSTP.length) return -1;
                                }
                                else {
                                    if (a.width < b.width) return 1;
                                    if (a.width > b.width) return -1;
                                }

                                return 0;
                            });

                            $target.append(`<a media-id="${mda.pk}" datetime="${mda.taken_at}" data-blob="true" data-needed="direct" data-path="${resource.code}" data-name="photo" data-type="jpg" data-username="${resource.owner.username}" data-globalIndex="${idx}" href="javascript:;" data-href="${mda.image_versions2.candidates[0].url}"><img src="${mda.image_versions2.candidates[0].url}" alt="" loading="lazy" /><span class="igdm-caption"><span data-ih-locale="IMG">${_i18n("IMG")}</span> ${idx}</span></a>`);
                        }
                        // Video
                        else {
                            $target.append(`<a media-id="${mda.pk}" datetime="${mda.taken_at}" data-blob="true" data-needed="direct" data-path="${resource.code}" data-name="video" data-type="mp4" data-username="${resource.owner.username}" data-globalIndex="${idx}" href="javascript:;" data-href="${mda.video_versions[0].url}"><img src="${mda.image_versions2.candidates[0].url}" alt="" loading="lazy" /><span class="igdm-caption"><span data-ih-locale="VID">${_i18n("VID")}</span> ${idx}</span></a>`);
                            if (mda.video_dash_manifest) {
                                state.GL_mediaDataCache[mda.pk] = mda;
                            }
                        }
                    });
                }
                else {
                    let idx = Number(resource.__snCurrentIndex) || 1;
                    // Image
                    if (resource.video_versions == null) {
                        resource.image_versions2.candidates.sort(function (a, b) {
                            let aSTP = new URL(a.url).searchParams.get('stp');
                            let bSTP = new URL(b.url).searchParams.get('stp');

                            if (aSTP && bSTP) {
                                if (aSTP.length > bSTP.length) return 1;
                                if (aSTP.length < bSTP.length) return -1;
                            }
                            else {
                                if (a.width < b.width) return 1;
                                if (a.width > b.width) return -1;
                            }

                            return 0;
                        });

                        $target.append(`<a media-id="${resource.pk}" datetime="${resource.taken_at}" data-blob="true" data-needed="direct" data-path="${resource.code}" data-name="photo" data-type="jpg" data-username="${resource.owner.username}" data-globalIndex="${idx}" href="javascript:;" data-href="${resource.image_versions2.candidates[0].url}"><img src="${resource.image_versions2.candidates[0].url}" alt="" loading="lazy" /><span class="igdm-caption"><span data-ih-locale="IMG">${_i18n("IMG")}</span> ${idx}</span></a>`);
                    }
                    // Video
                    else {
                        if (resource.video_dash_manifest) {
                            state.GL_mediaDataCache[resource.pk] = resource;
                        }
                        $target.append(`<a media-id="${resource.pk}" datetime="${resource.taken_at}" data-blob="true" data-needed="direct" data-path="${resource.code}" data-name="video" data-type="mp4" data-username="${resource.owner.username}" data-globalIndex="${idx}" href="javascript:;" data-href="${resource.video_versions[0].url}"><img src="${resource.image_versions2.candidates[0].url}" alt="" loading="lazy" /><span class="igdm-caption"><span data-ih-locale="VID">${_i18n("VID")}</span> ${idx}</span></a>`);
                    }
                }
            }

            $("#_SNLOAD").remove();
            $('.IG_POPUP_DIG #batch_download_selected, .IG_POPUP_DIG #batch_download_direct').prop('disabled', false);
            $('.IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY a').each(function () {
                const $a = $(this);
                $a.wrap('<div class="igdm-media-card"></div>');
                $a.before('<label class="inner_box_wrapper"><input class="inner_box" type="checkbox" aria-label="Select media"><span></span></label>');
                $a.after(`<button type="button" data-ih-locale-title="NEW_TAB" aria-label="${_i18n("NEW_TAB")}" title="${_i18n("NEW_TAB")}" class="newTab">${SVG.NEW_TAB}</button>`);

                if ($a.data('name') == 'video') {
                    $a.after(`<button type="button" data-ih-locale-title="VIDEO_THUMBNAIL" aria-label="${_i18n("VIDEO_THUMBNAIL")}" title="${_i18n("VIDEO_THUMBNAIL")}" class="videoThumbnail">${SVG.THUMBNAIL}</button>`);
                }
            });
            updatePopupSelectionSummary();

            return $target.find('a').length;
        }
        catch (err) {
            logger('createMediaListDOM', err);
            $("#_SNLOAD").remove();
            $('.IG_POPUP_DIG #batch_download_selected, .IG_POPUP_DIG #batch_download_direct').prop('disabled', false);
            if ($fallbackArticle.length > 0) {
                $(selector).append('<p class="igdm-error" role="alert">No direct media URL found. Reload the post and retry.</p>');
            }
            return 0;
        }
    }


    /**
     * getVisibleNodeIndex
     * @description Get element visible node.
     *
     * @param  {Object}  $main
     * @return {Integer}
     */
    function getVisibleNodeIndex($main) {
        // 1. Prioritize the most efficient rule: check if the "back" button exists.
        const hasBackButton = $main.find('button._afxv._al46._al47').length > 0;

        // 2. If the "back" button does not exist, it is determined to be the first image, and the result is returned immediately.
        if (!hasBackButton) {
            return 0;
        }
        var index = 0;

        // 3. If the code execution reaches here, it means it is not the first image, and the final geometric algorithm is enabled.

        // a. Locate the "viewport" element: it is the grandparent of ul
        // "_acay" class of <ul> has been removed by Instagram; [class] added to <ul> to get much lesser matches in page
        // The parent of the parent of ul[class] always has the attributes "role"
        // '*:not([data-pagelet])>*:not([role]):not([data-pagelet])>*>*>*[role]>*>ul[class]' is useful for avoiding the homepage stories section, account highlights section, and notes section in Messages.
        const $viewport = $main.find('*:not([data-pagelet])>*:not([role]):not([data-pagelet])>*>*>*[role]>*>ul[class]').parent().parent('[role]');

        if ($viewport.length > 0) {
            const viewportRect = $viewport.get(0).getBoundingClientRect();
            // b. Get itemWidth: directly use the width of the viewport, this method is the most generalizable
            const itemWidth = viewportRect.width;

            // Must successfully obtain the width to continue, to prevent division by zero errors
            if (itemWidth > 0) {
                // STAGE 1: Visual positioning, find the currently displayed <li> element
                // "_acaz" class of <li> has been removed by Instagram; [class] added to <li> to get much lesser matches in page
                const viewportRight = viewportRect.right;
                let closestSlideElement = null;
                let minDistance = Infinity;

                $main.find('li[class]').each(function () {
                    if (this.getBoundingClientRect().width === 0) return;

                    const slideRect = this.getBoundingClientRect();
                    const distance = Math.abs(slideRect.right - viewportRight);

                    if (distance < minDistance) {
                        minDistance = distance;
                        closestSlideElement = this;
                    }
                });

                // STAGE 2: Index calculation, use the found <li> and itemWidth to calculate the global index
                if (closestSlideElement) {
                    const style = $(closestSlideElement).attr('style');
                    if (style && style.includes('translateX')) {
                        const offsetMatch = style.match(/translateX\(([^p]+)px\)/);
                        if (offsetMatch && offsetMatch[1]) {
                            const totalOffset = parseFloat(offsetMatch[1]);
                            // c. Execute the final calculation formula
                            index = Math.round(totalOffset / itemWidth);
                        }
                    }
                }
            }
        }
        return index;
    }


    /**
     * batchDownloadPostFiles
     * @description Batch download media files in posts to prevent browser crashes.
     * @param {jQuery} $elements
     * @return {Promise<void>}
     */
    async function batchDownloadPostFiles($elements) {
        let index = 0;
        const totalLen = $elements.length;
        setDownloadProgress(0, totalLen);

        for (const element of $elements) {
            try {
                await triggerLinkElement($(element), false);
            } catch (err) {
                console.error('batchDownloadPostFiles failed:', err, element?.dataset?.href);
            }

            index++;
            setDownloadProgress(index, totalLen);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }


    /**
     * getPostContextFromButton
     * @description Resolve the current post container and shortcode safely across
     * homepage, dialog, /p/, /reel/, and changing Instagram layouts.
     *
     * @param {HTMLElement|JQuery} target
     * @return {{ $article: JQuery<HTMLElement>, postPath: (string|null) }}
     */
    function getPostContextFromButton(target) {
        const $article = $(target).closest('[data-snig="canDownload"], article, div[data-snig]');
        if ($article.length === 0) {
            return { $article: $(), postPath: null };
        }

        const candidates = [];
        const pushHref = (href) => {
            if (typeof href === 'string' && href.trim().length > 0) {
                candidates.push(href.trim());
            }
        };

        pushHref($article.find('a[href^="/p/"]').first().attr('href'));
        pushHref($article.find('a[href^="/reel/"]').first().attr('href'));
        pushHref($article.find('a[href*="/p/"]').first().attr('href'));
        pushHref($article.find('a[href*="/reel/"]').first().attr('href'));

        $article.find('a[role="link"][href], a[href]').each(function () {
            const href = $(this).attr('href') || '';
            if (href.startsWith('/p/') || href.startsWith('/reel/') || href.match(/^\/[^/]+\/(p|reel)\//i)) {
                pushHref(href);
                return false;
            }
        });

        let postPath = null;
        for (const href of candidates) {
            const parts = href.split('/').filter(Boolean);
            const idx = parts.findIndex(p => p === 'p' || p === 'reel');
            if (idx >= 0 && parts[idx + 1]) {
                postPath = parts[idx + 1];
                break;
            }
            if ((href.startsWith('/p/') || href.startsWith('/reel/')) && parts[1]) {
                postPath = parts[1];
                break;
            }
        }

        if (!postPath) {
            const pathParts = location.pathname.replace(/\/$/, '').split('/').filter(Boolean);
            if ((pathParts[0] === 'p' || pathParts[0] === 'reel') && pathParts[1]) {
                postPath = pathParts[1];
            }
            else {
                const routeIndex = pathParts.findIndex(p => p === 'p' || p === 'reel');
                if (routeIndex >= 0 && pathParts[routeIndex + 1]) {
                    postPath = pathParts[routeIndex + 1];
                }
            }
        }

        return { $article, postPath };
    }

    /**
     * onProfileAvatar
     * @description Trigger user avatar download event or button display event.
     *
     * @param  {Boolean}  isDownload - Check if it is a download operation
     * @return {void}
     */
    async function onProfileAvatar(isDownload) {
        if (isDownload) {
            updateLoadingBar(true);

            let date = new Date().getTime();
            let timestamp = Math.floor(date / 1000);
            let username = location.pathname.replaceAll(/(reels|tagged)\/$/ig, '').split('/').filter(s => s.length > 0).at(-1);
            let userInfo = await getUserId(username);
            try {
                let dataURL = await getUserHighSizeProfile(userInfo.user.pk);
                saveFiles(dataURL, {
                    username,
                    sourceType: "avatar",
                    timestamp,
                    filetype: 'jpg',
                    uid: userInfo.user.id
                });
            }
            // eslint-disable-next-line no-unused-vars
            catch (err) {
                saveFiles(userInfo.user.profile_pic_url, {
                    username,
                    sourceType: "avatar",
                    timestamp,
                    filetype: 'jpg',
                    uid: userInfo.user.id
                });
            }

            updateLoadingBar(false);
        }
        else {
            // Add the profile download button
            if (!$('.IG_DWPROFILE').length) {
                let profileTimer = setInterval(() => {
                    if ($('.IG_DWPROFILE').length) {
                        clearInterval(profileTimer);
                        return;
                    }

                    const selector = 'header > *[class]:first-child > *[class]:first-child img[alt]';
                    const $draggableElements = $(`${selector}[draggable]`).parent().parent();
                    const $nonDraggableElements = $(`${selector}:not([draggable])`).parent().parent().parent();
                    $draggableElements.append(`<div data-ih-locale-title="DW" title="${_i18n("DW")}" class="IG_DWPROFILE">${SVG.DOWNLOAD}</div>`);
                    $draggableElements.css('position', 'relative');
                    $nonDraggableElements.append(`<div data-ih-locale-title="DW" title="${_i18n("DW")}" class="IG_DWPROFILE">${SVG.DOWNLOAD}</div>`);
                    $nonDraggableElements.css('position', 'relative');
                }, 150);
            }
        }
    }


    /**
     * skipSharedWithYouDialog
     * @description Auto-skip the "X shared this with you" dialog for ?igsh= links.
     *
     * @return {void}
     */
    function skipSharedWithYouDialog() {
        if (!USER_SETTING.SKIP_SHARED_WITH_YOU_DIALOG) return;

        let url;
        try {
            url = new URL(window.location.href);
        }
        catch (e) {
            logger("[skipSharedWithYouDialog] invalid URL", e);
            return;
        }

        // only for shared links with the tracking param ?igsh=...
        if (!url.searchParams || !url.searchParams.has("igsh")) return;

        const $dialogs = $("div[role=\"dialog\"]");
        if (!$dialogs || !$dialogs.length) {
            return;
        }

        const profileUsername = location.pathname
            .split("/")
            .filter(s => s.length > 0)
            .at(0)?.toLowerCase();

        $dialogs.each(function () {
            const $dialog = $(this);

            if (!$dialog.is(":visible")) {
                return;
            }

            const $headers = $dialog.find("h2");
            if (!$headers.length) {
                return;
            }

            // Heuristic: header text that looks like "profile_name shared this with you"
            const isSharedHeader = $headers.filter(function () {
                const rawText = (this.textContent || "").trim().toLowerCase();
                if (!rawText) return false;

                // Typical case
                if (rawText.includes("shared this with you")) return true;
                if (rawText.includes("shared with you")) return true;

                // Fallback: contains username + "shared"
                if (profileUsername &&
                    rawText.includes(profileUsername) &&
                    rawText.includes("shared")) {
                    return true;
                }

                return false;
            }).length > 0;

            if (!isSharedHeader) {
                return;
            }

            const $buttons = $dialog.find("div[role=\"button\"]");
            if (!$buttons.length) {
                logger("[skipSharedWithYouDialog] dialog has no buttons");
                return;
            }

            let $notNow = null;

            // Prefer a button whose text is exactly "Not now" (case-insensitive)
            $buttons.each(function () {
                const text = (this.textContent || "").trim().toLowerCase();
                if (!text) return;

                if (text === "not now") {
                    $notNow = $(this);
                    return false;
                }
            });

            // Fallback: if there are exactly 2 buttons, assume the second is "Not now"
            if ((!$notNow || !$notNow.length) && $buttons.length === 2) {
                $notNow = $buttons.last();
            }

            if (!$notNow || !$notNow.length) {
                logger("[skipSharedWithYouDialog] could not find \"Not now\" button");
                return;
            }

            logger("[skipSharedWithYouDialog] clicking \"Not now\" button");
            $notNow.trigger("click");
        });
    }

    /**
     * onReels
     * @description Trigger user's reels download event or button display event.
     *
     * @param  {Boolean}  isDownload - Check if it is a download operation
     * @param  {Boolean}  isVideo - Check if reel is a video element
     * @param  {Boolean}  isPreview - Check if it is need to open new tab
     * @return {void}
     */
    async function onReels(isDownload, isVideo, isPreview) {
        try {
            if (isDownload) {
                updateLoadingBar(true);

                let reelsPath = location.href.split('?').at(0).split('instagram.com/reels/').at(-1).replaceAll('/', '');
                let result = await getBlobMedia(reelsPath);
                let media = filterResourceData(result.data);

                let timestamp = new Date().getTime();

                if (USER_SETTING.RENAME_PUBLISH_DATE) {
                    if (result.type === 'query_hash') {
                        timestamp = media.taken_at_timestamp;
                    }
                    else {
                        timestamp = media.taken_at;
                    }
                }

                if (result.type === 'query_hash') {
                    if (isVideo && media.is_video) {
                        if (isPreview) {
                            openNewTab(media.video_url);
                        }
                        else {
                            let type = 'mp4';
                            saveFiles(media.video_url, {
                                username: media.owner.username,
                                sourceType: "reels",
                                timestamp,
                                filetype: type,
                                shortcode: reelsPath
                            });
                        }
                    }
                    else {
                        if (isPreview) {
                            openNewTab(media.display_resources.at(-1).src);
                        }
                        else {
                            let type = 'jpg';
                            saveFiles(media.display_resources.at(-1).src, {
                                username: media.owner.username,
                                sourceType: "reels",
                                timestamp,
                                filetype: type,
                                shortcode: reelsPath
                            });
                        }
                    }
                }
                else {
                    if (isVideo && media.video_versions != null) {
                        if (isPreview) {
                            openNewTab(media.video_versions[0].url);
                        }
                        else {
                            let type = 'mp4';
                            saveFiles(media.video_versions[0].url, {
                                username: media.owner.username,
                                sourceType: "reels",
                                timestamp,
                                filetype: type,
                                shortcode: reelsPath
                            });
                        }
                    }
                    else {
                        if (isPreview) {
                            openNewTab(media.image_versions2.candidates[0].url);
                        }
                        else {
                            let type = 'jpg';
                            saveFiles(media.image_versions2.candidates[0].url, {
                                username: media.owner.username,
                                sourceType: "reels",
                                timestamp,
                                filetype: type,
                                shortcode: reelsPath
                            });
                        }
                    }
                }

                updateLoadingBar(false);
            }
            else {
                const svgClose = 'svg > polyline[points^="20.643 3.357 12 12 3.353 20.647"] ~ line';
                var timer = setInterval(() => {
                    const hasTiktokStyleLayout = $(svgClose).length > 0;
                    if (hasTiktokStyleLayout || $('section > main[role="main"] > div div.x1qjc9v5 video').length > 0) {
                        clearInterval(timer);

                        if (USER_SETTING.SCROLL_BUTTON) {
                            $('#scrollWrapper').remove();
                            // OPTIMIZATION: cache reels main element (used 5 times below)
                            const $reelsMain = $('section > main[role="main"]');
                            $reelsMain.append('<section id="scrollWrapper"></section>');
                            const $scrollWrapper = $reelsMain.find('> #scrollWrapper');
                            $scrollWrapper.append('<div class="button-up"><div></div></div>');
                            $scrollWrapper.append('<div class="button-down"><div></div></div>');

                            $scrollWrapper.find('> .button-up').on('click', function () {
                                $reelsMain.find('> div')[0].scrollBy({ top: -30, behavior: "smooth" });
                            });
                            $scrollWrapper.find('> .button-down').on('click', function () {
                                $reelsMain.find('> div')[0].scrollBy({ top: 30, behavior: "smooth" });
                            });
                        }

                        $('div[aria-busy][tabindex]').children('div').each(function () {
                            const $this = $(this);
                            if (
                                $this.children().length > 0 &&
                                $this.width() > window.innerWidth * 0.8 &&
                                $this.height() > window.innerHeight * 0.8 &&
                                $this.find('video').length > 0
                            ) {
                                appendReelsButton($this);
                            }
                        });
                    }
                }, 250);
            }
        }
        catch (err) {
            console.error("[reels]", err);
        }
    }

    function appendReelsButton($main) {
        // OPTIMIZATION: cache $main.children() and $main.find('video') usage
        const $mainChildren = $main.children();
        if (!$mainChildren.find('.IG_REELS').length) {
            $mainChildren.css('position', 'relative');

            $mainChildren.append(`<div data-ih-locale-title="DW" title="${_i18n("DW")}" class="IG_REELS">${SVG.DOWNLOAD}</div>`);
            $mainChildren.append(`<div data-ih-locale-title="NEW_TAB" title="${_i18n("NEW_TAB")}" class="IG_REELS_NEWTAB">${SVG.NEW_TAB}</div>`);
            $mainChildren.append(`<div data-ih-locale-title="VIDEO_THUMBNAIL" title="${_i18n("VIDEO_THUMBNAIL")}" class="IG_REELS_THUMBNAIL">${SVG.THUMBNAIL}</div>`);

            const $videos = $main.find('video');

            $videos.each(function () {
                $(this).off('fullscreenchange.IG_videoControl').on('fullscreenchange.IG_videoControl', function () {
                    const $vid = $(this);
                    if ($vid.attr('style').includes('object-fit')) {
                        if (document.fullscreenElement == this) {
                            $vid.css('object-fit', 'contain');
                        }
                        else {
                            $vid.css('object-fit', 'cover');
                        }
                    }
                });
            });

            // Disable video autoplay
            if (USER_SETTING.DISABLE_VIDEO_LOOPING) {
                $videos.each(function () {
                    $(this).on('ended', function () {
                        const $this = $(this);

                        let $element_play_button = $this.next().find('div[role="presentation"] > div svg > path[d^="M5.888"]').parents('button[role="button"], div[role="button"]');
                        if ($element_play_button.length > 0) {
                            $element_play_button.trigger("click");
                            logger('(reel) Stop video playing #loop, then paused click()');
                        }
                        else {
                            $this.parent().find('.xpgaw4o').removeAttr('style');
                            this.pause();
                            logger('(reel) Stop video playing #loop, then paused pause()');
                        }

                    });
                });
            }

            if (USER_SETTING.HTML5_VIDEO_CONTROL) {

                const handleSwitchController = function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    let $overlayElement = null;
                    if ($overlayElement == null) {
                        $overlayElement = $(e.target).parents('div[aria-label][data-visualcompletion="ignore"]').first();
                    }

                    $videos.each(function () {
                        const $v = $(this);
                        $v.css('z-index', '2');
                        $v.attr('controls', true);
                        state.GL_weakCache.overlay.set(this, $overlayElement);
                    });

                    $overlayElement.css('z-index', '-10');
                    $main.find('a[href^="/reels/"]').first().attr("draggable", false);
                };

                $main.off('contextmenu.IG_videoControl').on('contextmenu.IG_videoControl', handleSwitchController);
                $videos.each(function () {
                    const $video = $(this);
                    if (!$video.data('controls')) {

                        logger('(reel) Added video html5 contorller #modify');

                        if (USER_SETTING.MODIFY_VIDEO_VOLUME) {
                            this.volume = state.videoVolume;

                            $video.on('loadstart', function () {
                                this.volume = state.videoVolume;
                            });
                        }

                        let $mute_button_wrapper = $video.parent().find('video + div > div');
                        $mute_button_wrapper = $mute_button_wrapper.add($main);

                        // eslint-disable-next-line no-unused-vars
                        let $element_mute_button = $mute_button_wrapper.find('button[type="button"], div[role="button"]').filter(function (idx) {
                            const $b = $(this);
                            return $b.width() <= 64 && $b.height() <= 64 && $b.find('svg > path[d^="M16.636 7.028a1.5"], svg > path[d^="M1.5 13.3c-.8"]').length > 0;
                        });

                        state.GL_weakCache.mutedButton.set(this, $element_mute_button);

                        let $targets = $video.parent().find('video + div div[role="button"]').filter(function () {
                            const $t = $(this);
                            return $t.parent('div[role="presentation"]').length > 0 && $t.css('cursor') === 'pointer' && $t.attr('style') != null;
                        }).first();

                        $video.on('contextmenu', function (e) {
                            e.preventDefault();
                            e.stopPropagation();

                            $video.css('z-index', '-1');
                            $video.removeAttr('controls');
                            $targets.css('z-index', '1');
                            state.GL_weakCache.overlay.get(this)?.css('z-index', '1');
                        });

                        $targets.off('contextmenu.IG_videoControl').on('contextmenu.IG_videoControl', handleSwitchController);

                        $video.on('volumechange', function () {
                            let video = this;
                            let $element_mute_button = state.GL_weakCache.mutedButton.get(this) || {};
                            let is_element_muted = $element_mute_button.find && $element_mute_button.find('svg > path[d^="M16.636"]').length === 0;

                            if (this.muted != is_element_muted) {
                                this.volume = state.videoVolume;

                                if ($element_mute_button.length === 1) {
                                    triggerReactClickHandler($element_mute_button.first()[0]);
                                }
                                else {
                                    let $firstElementMuteButton = $element_mute_button.filter(function () {
                                        return $(this).closest(state.GL_weakCache.overlay.get(video)).length > 0;
                                    }).first();

                                    triggerReactClickHandler($firstElementMuteButton.first()[0]);
                                }
                            }

                            const $v = $(this);
                            if ($v.data('completed')) {
                                state.videoVolume = this.volume;
                                GM_setValue('G_VIDEO_VOLUME', this.volume);
                            }

                            if (this.volume == state.videoVolume) {
                                $v.data('completed', true);
                            }
                        });

                        $video.css('position', 'relative');
                        $video.data('controls', true);
                    }
                });
            }

            var $buttonParent = $main.find('div[role="presentation"] > div[role="button"] > div').first();
            toggleVolumeSilder($videos, $buttonParent, 'reel');
        }
    }

    /**
     * createStoryListDOM
     * @description Create a list of story items in the popup dialog.
     *
     * @return {void}
     */
    async function createStoryListDOM(obj, type) {
        try {
            $('.IG_POPUP_DIG #post_info').text(`${type} ID: ${obj.data.reels_media[0].id}`);
            const selector = '.IG_POPUP_DIG .IG_POPUP_DIG_MAIN .IG_POPUP_DIG_BODY';
            // OPTIMIZATION: cache target once
            const $selector = $(selector);

            // OPTIMIZATION: cache reels_media[0] reference
            const reel = obj.data.reels_media[0];
            const items = reel.items;

            items.forEach((item, idx) => {
                let date = new Date().getTime();
                let timestamp = Math.floor(date / 1000);
                let username = reel?.user?.username || reel?.owner?.username;

                if (USER_SETTING.RENAME_PUBLISH_DATE) {
                    timestamp = item.taken_at_timestamp;
                }

                item.display_resources.sort(function (a, b) {
                    if (a.config_width < b.config_width) return 1;
                    if (a.config_width > b.config_width) return -1;
                    return 0;
                });

                if (item.is_video) {
                    $selector.append(`<a media-id="${item.id}" datetime="${timestamp}" data-blob="true" data-needed="direct" data-name="${type}" data-type="mp4" data-username="${username}" data-path="${item.id}" data-globalIndex="${idx + 1}" href="javascript:;" data-href="${item.video_resources[0].src}"><img src="${item.display_resources[0].src}" alt="" loading="lazy" /><span class="igdm-caption"><span data-ih-locale="VID">${_i18n("VID")}</span> ${idx}</span></a>`);
                }
                else {
                    $selector.append(`<a media-id="${item.id}" datetime="${timestamp}" data-blob="true" data-needed="direct" data-name="${type}" data-type="jpg" data-username="${username}" data-path="${item.id}" data-globalIndex="${idx + 1}" href="javascript:;" data-href="${item.display_resources[0].src}"><img src="${item.display_resources[0].src}" alt="" loading="lazy" /><span class="igdm-caption"><span data-ih-locale="IMG">${_i18n("IMG")}</span> ${idx}</span></a>`);
                }
            });

            $selector.find('a').each(function () {
                const $a = $(this);
                $a.wrap('<div class="igdm-media-card"></div>');
                $a.before('<label class="inner_box_wrapper"><input class="inner_box" type="checkbox" aria-label="Select media"><span></span></label>');
                $a.after(`<button type="button" data-ih-locale-title="NEW_TAB" aria-label="${_i18n("NEW_TAB")}" title="${_i18n("NEW_TAB")}" class="newTab">${SVG.NEW_TAB}</button>`);

                if ($a.data('type') == 'mp4') {
                    $a.after(`<button type="button" data-ih-locale-title="VIDEO_THUMBNAIL" aria-label="${_i18n("VIDEO_THUMBNAIL")}" title="${_i18n("VIDEO_THUMBNAIL")}" class="videoThumbnail">${SVG.THUMBNAIL}</button>`);
                }
            });

            $('.IG_POPUP_DIG #batch_download_direct').prop('disabled', false);
            updatePopupSelectionSummary();
            updateLoadingBar(false);
        }
        catch (err) {
            console.error('createStoryListDOM()', err);
        }
    }

    /**
     * onStoryAll
     * @description Trigger user's story all download event.
     *
     * @return {void}
     */
    async function onStoryAll() {
        updateLoadingBar(true);

        let date = new Date().getTime();
        let timestamp = Math.floor(date / 1000);
        let username = $("body > div section._ac0a header._ac0k ._ac0l a + div a").first().text() || location.pathname.split("/").filter(s => s.length > 0).at(1);

        let userInfo = await getUserId(username);
        let userId = userInfo.user.pk;
        let stories = await getStories(userId);

        if (USER_SETTING.DIRECT_DOWNLOAD_STORY) {
            let complete = 0;
            // OPTIMIZATION: cache items array — repeatedly accessed inside setTimeout closures
            const items = stories.data.reels_media[0].items;
            const totalItems = items.length;
            setDownloadProgress(complete, totalItems);

            items.forEach((item, idx) => {
                setTimeout(() => {
                    if (USER_SETTING.RENAME_PUBLISH_DATE) {
                        timestamp = item.taken_at_timestamp;
                    }

                    item.display_resources.sort(function (a, b) {
                        if (a.config_width < b.config_width) return 1;
                        if (a.config_width > b.config_width) return -1;
                        return 0;
                    });

                    if (item.is_video) {
                        saveFiles(item.video_resources[0].src,
                            {
                                username,
                                sourceType: "stories",
                                timestamp,
                                filetype: 'mp4',
                                shortcode: item.id
                            }).then(() => {
                                setDownloadProgress(++complete, totalItems);
                            });
                    }
                    else {
                        saveFiles(item.display_resources[0].src, {
                            username,
                            sourceType: "stories",
                            timestamp,
                            filetype: 'jpg',
                            shortcode: item.id
                        }).then(() => {
                            setDownloadProgress(++complete, totalItems);
                        });
                    }
                }, 100 * idx);
            });
        }
        else {
            IG_createDM(false, true);
            createStoryListDOM(stories, 'stories');
        }
    }

    /**
     * resolveStoryMediaIdByTimestamp
     * @description Identifies the currently visible story by comparing the
     *              <time datetime> element in the viewer with taken_at_timestamp
     *              from the API items array. More reliable than index-based DOM
     *              mapping because it does not depend on CSS class names or
     *              progress-bar structure.
     *
     * @param  {Object}  stories  - Full getStories() / getHighlightStories() response
     * @return {?String}          - Best-matching item id, or null if undetermined
     */
    function resolveStoryMediaIdByTimestamp(stories) {
        const items = stories?.data?.reels_media?.[0]?.items;
        if (!items || items.length === 0) return null;

        // Reuse the same multi-layout time-element selection that the rest of the
        // script already relies on; exclude highlight-nav links and role="button"
        // to avoid picking up unrelated timestamps.
        const $time = $(
            'body > div section:visible time[datetime]'
        ).filter(function () {
            const $this = $(this);
            return (
                $this.is(':visible') &&
                $this.closest('a[href^="/stories/highlights/"]').length === 0 &&
                $this.closest('[role="button"]').length === 0
            );
        }).first();

        if ($time.length === 0) return null;

        const visibleTs = Math.floor(new Date($time.attr('datetime')).getTime() / 1000);
        if (!Number.isFinite(visibleTs) || visibleTs === 0) return null;

        let bestId = null;
        let minDiff = Infinity;

        items.forEach(item => {
            const diff = Math.abs((item.taken_at_timestamp || 0) - visibleTs);
            if (diff < minDiff) {
                minDiff = diff;
                bestId = item.id;
            }
        });

        logger('[resolveStoryMediaIdByTimestamp]', 'best match:', bestId, 'diff(s):', minDiff);
        return bestId;  // always return best match — better than any index heuristic
    }

    /**
     * onStory
     * @description Trigger user's story download event or button display event.
     *
     * @param  {Boolean}  isDownload - Check if it is a download operation
     * @param  {Boolean}  isForce - Check if downloading directly from API instead of cache
     * @param  {Boolean}  isPreview - Check if it is need to open new tab
     * @return {void}
     */
    async function onStory(isDownload, isForce, isPreview) {
        var username = $("body > div section._ac0a header._ac0k ._ac0l a + div a").first().text() || location.pathname.split("/").filter(s => s.length > 0).at(1);
        if (isDownload) {
            let date = new Date().getTime();
            let timestamp = Math.floor(date / 1000);

            updateLoadingBar(true);
            if (USER_SETTING.FORCE_RESOURCE_VIA_MEDIA && !state.tempFetchRateLimit) {
                let mediaId = null;

                let userInfo = await getUserId(username);
                let userId = userInfo.user.pk;
                let stories = await getStories(userId);
                let urlID = location.pathname.split('/').filter(s => s.length > 0 && s.match(/^([0-9]{10,})$/)).at(-1);

                // OPTIMIZATION: cache items reference (used 4+ times)
                const items = stories.data.reels_media[0].items;

                items.forEach(item => {
                    if (item.id == urlID) {
                        mediaId = item.id;
                    }
                });

                // FIX: timestamp-based match before fragile index/CSS fallbacks
                if (mediaId == null) {
                    mediaId = resolveStoryMediaIdByTimestamp(stories);
                }

                if (mediaId == null) {
                    let $header = getStoryProgress(username);

                    $header.each(function (index) {
                        if ($(this).children().length > 0) {
                            mediaId = items[index].id;
                        }
                    });
                }

                if (mediaId == null) {
                    // appear in from profile page to story page
                    $('body > div section:visible div.x1ned7t2.x78zum5 > div').each(function (index) {
                        const $this = $(this);
                        if ($this.hasClass('x1lix1fw')) {
                            if ($this.children().length > 0) {
                                mediaId = items[index].id;
                            }
                        }
                    });

                    // appear in from home page to story page
                    $('body > div section:visible ._ac0k > ._ac3r > div').each(function (index) {
                        if ($(this).children().hasClass('_ac3q')) {
                            mediaId = items[index].id;
                        }
                    });
                }

                if (mediaId == null) {
                    mediaId = location.pathname.split('/').filter(s => s.length > 0 && s.match(/^([0-9]{10,})$/)).at(-1);
                }

                if (USER_SETTING.CAPTURE_IMAGE_VIA_MEDIA_CACHE) {
                    const cached = getImageFromCache(mediaId);
                    if (cached && !items.filter(item => item.id === mediaId).at(0).is_video) {
                        logger("[Restore Cached onStory]", mediaId);
                        if (isPreview) {
                            openNewTab(cached);
                        }
                        else {
                            saveFiles(cached, {
                                username,
                                sourceType: "stories",
                                timestamp,
                                filetype: 'jpg',
                                shortcode: mediaId
                            });
                        }
                        return;
                    }
                }

                let result = await getMediaInfo(mediaId);

                if (USER_SETTING.RENAME_PUBLISH_DATE) {
                    timestamp = result.items[0].taken_at;
                }

                if (result.status === 'ok') {
                    // OPTIMIZATION: cache result.items[0]
                    const mediaItem = result.items[0];
                    if (mediaItem.video_versions) {
                        const handled = await tryHandleDashFromMediaItem({
                            mediaItem: mediaItem,
                            username,
                            sourceType: "stories",
                            timestamp,
                            shortcode: mediaId,
                            isPreview,
                        });
                        if (handled) {
                            updateLoadingBar(false);
                            return;
                        }

                        if (isPreview) {
                            openNewTab(mediaItem.video_versions[0].url);
                        }
                        else {
                            saveFiles(mediaItem.video_versions[0].url, {
                                username,
                                sourceType: "stories",
                                timestamp,
                                filetype: 'mp4',
                                shortcode: mediaId
                            });
                        }
                    }
                    else {
                        if (isPreview) {
                            openNewTab(mediaItem.image_versions2.candidates[0].url);
                        }
                        else {
                            saveFiles(mediaItem.image_versions2.candidates[0].url, {
                                username,
                                sourceType: "stories",
                                timestamp,
                                filetype: 'jpg',
                                shortcode: mediaId
                            });
                        }
                    }
                }
                else {
                    if (USER_SETTING.FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED) {
                        state.tempFetchRateLimit = true;
                        onStory(isDownload, isForce, isPreview);
                    }
                    else {
                        alert('Fetch failed from Media API. API response message: ' + result.message);
                    }
                    logger(result);
                }

                updateLoadingBar(false);
                return;
            }

            if ($('body > div section:visible video[playsinline]').length > 0) {
                // Download stories if it is video
                let type = "mp4";
                let videoURL = "";
                let targetURL = location.pathname.replace(/\/$/ig, '').split("/").at(-1);
                let mediaId = null;

                if (state.GL_dataCache.stories[username] && !isForce) {
                    logger('Fetch from memory cache:', username);
                    state.GL_dataCache.stories[username].data.reels_media[0].items.forEach(item => {
                        if (item.id == targetURL) {
                            videoURL = item.video_resources[0].src;
                            if (USER_SETTING.RENAME_PUBLISH_DATE) {
                                timestamp = item.taken_at_timestamp;
                                mediaId = item.id;
                            }
                        }
                    });

                    if (videoURL.length == 0) {
                        logger('Memory cache not found, try fetch from API:', username);
                        onStory(true, true);
                        return;
                    }
                }
                else {
                    let userInfo = await getUserId(username);
                    let userId = userInfo.user.pk;
                    let stories = await getStories(userId);
                    // OPTIMIZATION: cache items
                    const items = stories.data.reels_media[0].items;

                    items.forEach(item => {
                        if (item.id == targetURL) {
                            videoURL = item.video_resources[0].src;
                            if (USER_SETTING.RENAME_PUBLISH_DATE) {
                                timestamp = item.taken_at_timestamp;
                                mediaId = item.id;
                            }
                        }
                    });

                    // GitHub issue #4: thinkpad4
                    if (videoURL.length == 0) {

                        let $header = getStoryProgress(username);

                        $header.each(function (index) {
                            if ($(this).children().length > 0) {
                                videoURL = items[index].video_resources[0].src;
                                if (USER_SETTING.RENAME_PUBLISH_DATE) {
                                    timestamp = items[index].taken_at_timestamp;
                                    mediaId = items[index].id;
                                }
                            }
                        });


                        if (videoURL.length == 0) {
                            // appear in from profile page to story page
                            $('body > div section:visible div.x1ned7t2.x78zum5 > div').each(function (index) {
                                const $this = $(this);
                                if ($this.hasClass('x1lix1fw')) {
                                    if ($this.children().length > 0) {
                                        videoURL = items[index].video_resources[0].src;
                                        if (USER_SETTING.RENAME_PUBLISH_DATE) {
                                            timestamp = items[index].taken_at_timestamp;
                                            mediaId = items[index].id;
                                        }
                                    }
                                }
                            });

                            // appear in from home page to story page
                            $('body > div section:visible ._ac0k > ._ac3r > div').each(function (index) {
                                if ($(this).children().hasClass('_ac3q')) {
                                    videoURL = items[index].video_resources[0].src;
                                    if (USER_SETTING.RENAME_PUBLISH_DATE) {
                                        timestamp = items[index].taken_at_timestamp;
                                        mediaId = items[index].id;
                                    }
                                }
                            });
                        }
                    }

                    state.GL_dataCache.stories[username] = stories;
                }

                if (videoURL.length == 0) {
                    alert(_i18n("NO_VID_URL"));
                }
                else {
                    if (isPreview) {
                        openNewTab(videoURL);
                    }
                    else {
                        saveFiles(videoURL, {
                            username,
                            sourceType: "stories",
                            timestamp,
                            filetype: type,
                            shortcode: mediaId
                        });
                    }
                }
            }
            else {
                // Download stories if it is image
                let srcset = $('body > div section:visible img[referrerpolicy][class], body > div section:visible img[crossorigin][class]:not([alt])').attr('srcset')?.split(',')[0]?.split(' ')[0];
                let link = (srcset) ? srcset : $('body > div section:visible img[referrerpolicy][class], body > div section:visible img[crossorigin][class]:not([alt])').filter(function () {
                    const $this = $(this);
                    return $this.parents('a').length === 0 && $this.width() === $this.parent().width();
                }).attr('src');

                if (!link) {
                    // _aa63 mean stories picture in stories page (not avatar)
                    let $element = $('body > div section:visible img._aa63');
                    link = ($element.attr('srcset')) ? $element.attr('srcset')?.split(',')[0]?.split(' ')[0] : $element.attr('src');
                }

                if (USER_SETTING.RENAME_PUBLISH_DATE) {
                    timestamp = new Date($('body > div section:visible time[datetime][class]').first().attr('datetime')).getTime();
                }

                let downloadLink = link;
                let type = 'jpg';

                const mediaId = getImageFromCache(getStoryId(downloadLink) ?? "-");

                if (USER_SETTING.CAPTURE_IMAGE_VIA_MEDIA_CACHE) {
                    const cached = getImageFromCache(mediaId);
                    if (cached) {
                        if (isPreview) {
                            openNewTab(cached);
                        }
                        else {
                            saveFiles(cached, {
                                username,
                                sourceType: "stories",
                                timestamp,
                                filetype: 'jpg',
                                shortcode: mediaId
                            });
                        }
                        return;
                    }
                }

                if (isPreview) {
                    openNewTab(downloadLink);
                }
                else {
                    saveFiles(downloadLink, {
                        username,
                        sourceType: "stories",
                        timestamp,
                        filetype: type,
                        shortcode: mediaId
                    });
                }
            }

            state.tempFetchRateLimit = false;
            updateLoadingBar(false);
        }
        else {
            // Add the stories download button
            if (!$('.IG_DWSTORY').length) {
                state.GL_dataCache.stories = {};
                let $element = null;
                // Default detecter (section layout mode)
                if ($('body > div section._ac0a').length > 0) {
                    $element = $('body > div section:visible._ac0a');
                }
                // detecter (single story layout mode)
                else {
                    $element = $('body > div section:visible > div > div[style]:not([class])');
                    $element.css('position', 'relative');
                }


                if ($element.length === 0) {
                    $element = $('div[id^="mount"] section > div > a[href="/"]').parent().parent().parent().find('section:visible > div > div[style]:not([class])');
                    $element.css('position', 'relative');
                }

                if ($element.length === 0) {
                    $element = $('div[id^="mount"] section > div > a[href="/"]').parent().parent().parent().find('section:visible > div div[style]:not([class]) > div:not([data-visualcompletion="loading-state"])');
                    $element.css('position', 'relative');
                }

                if ($element.length === 0) {
                    $element = $('div[id^="mount"] section > div a[href="/"]').parents('section:visible').find('div[style]:not([class])');
                    $element.css('position', 'relative');
                }


                // Detecter for div layout mode
                if ($element.length === 0) {
                    let $$element = $('body > div div:not([hidden]) section:visible > div div[class][style] > div[style]:not([class])');
                    let nowSize = 0;

                    $$element.each(function () {
                        const $this = $(this);
                        const width = $this.width();
                        if (width > nowSize) {
                            nowSize = width;
                            $element = $this.children('div').first();
                        }
                    });
                }


                if ($element != null) {
                    // OPTIMIZATION: cache .first() once
                    const $firstEl = $element.first();
                    $firstEl.css('position', 'relative');
                    $firstEl.append(`<div data-ih-locale-title="DW" title="${_i18n("DW")}" class="IG_DWSTORY">${SVG.DOWNLOAD}</div>`);
                    $firstEl.append(`<div data-ih-locale-title="NEW_TAB" title="${_i18n("NEW_TAB")}" class="IG_DWNEWTAB">${SVG.NEW_TAB}</div>`);

                    let $header = getStoryProgress(username);
                    if ($header.length > 1) {
                        $firstEl.append(`<div data-ih-locale-title="DW_ALL" title="${_i18n("DW_ALL")}" class="IG_DWSTORY_ALL">${SVG.DOWNLOAD_ALL}</div>`);
                    }

                    setStoryProgressIndexText($firstEl, $header, 'IG_DWSTORY_POSITION');

                    // Modify video volume
                    //if(USER_SETTING.MODIFY_VIDEO_VOLUME){
                    //    $element.find('video').each(function(){
                    //        $(this).on('play playing', function(){
                    //            if(!$(this).data('modify')){
                    //                $(this).data('modify', true);
                    //                this.volume = VIDEO_VOLUME;
                    //                logger('(story) Added video event listener #modify');
                    //            }
                    //        });
                    //    });
                    //}

                    // Make sure to first remove thumbnail button if still exists and story is a picture
                    if ($element.find('img[referrerpolicy]').length) {
                        $element.find('img[referrerpolicy]').each(function () {
                            $(this).one('load', function () {
                                const $img = $(this);
                                if ($img.data('remove-thumbnail')) {
                                    return;
                                }
                                $img.data('remove-thumbnail', true);
                                if ($element.find('.IG_DWSTORY_THUMBNAIL').length === 0) {
    								$('.IG_DWSTORY_THUMBNAIL').remove();
                                    logger('(story) Manually removing thumbnail button');
                                }
                                else {
                                    logger('(story) Thumbnail button is not present for this picture');
                                }
                            });
                        });
                    }
                    // If the story's <video> (blob src) is already present in the DOM by the time
                    // onStory runs (e.g. script initialized late, after 'timeupdate' already fired
                    // once), insert the thumbnail button immediately instead of relying on a
                    // future 'timeupdate' event that may never come. The MutationObserver-based
                    // listener elsewhere only attaches to <video> nodes that are added *after* it
                    // was created, so a late init otherwise misses the button entirely.
                    // Create separate late-thumbnail-insert flag to avoid conflict with
                    // insert-thumbnail, which may be misset prematurely to true.
    				// We also check for IG_DWSTORY_THUMBNAIL so the button is only added if necessary.
                    else if ($element.find('video[src^="blob:"]').length) {
                        $element.find('video[src^="blob:"]').each(function () {
                            const $video = $(this);
                            if (!$video.data('late-thumbnail-insert')) {
                                $video.data('late-thumbnail-insert', true);
                                if ($element.find('.IG_DWSTORY_THUMBNAIL').length === 0) {
                                    onStoryThumbnail(false);
                                    logger('(story) Manually inserting thumbnail button (late init)');
                                }
                                else {
                                    logger('(story) Thumbnail button already inserted');
                                }
                            }
                        });
                    }

                    // Try to use event listener 'timeupdate' in order to detect if story is a video
                    //$element.find('video').each(function(){
                    //    $(this).on('timeupdate',function(){
                    //        if(!$(this).data('modify-thumbnail')){
                    //            if($element.find('.IG_DWSTORY_THUMBNAIL').length === 0){
                    //                $(this).data('modify-thumbnail', true);
                    //                onStoryThumbnail(false);
                    //                logger('(story) Manually inserting thumbnail button');
                    //            }
                    //            else{
                    //                $(this).data('modify-thumbnail', true);
                    //                logger('(story) Thumbnail button already inserted');
                    //            }
                    //        }
                    //    });
                    //});
                }
            }
            else {
                setStoryProgressIndexByUsername($('.IG_DWSTORY').parent(), username, 'IG_DWSTORY_POSITION');
            }
        }
    }

    /**
     * onStoryThumbnail
     * @description Trigger user's story video thumbnail download event or button display event.
     *
     * @param  {Boolean}  isDownload - Check if it is a download operation
     * @param  {Boolean}  isForce - Check if downloading directly from API instead of cache
     * @return {void}
     */
    async function onStoryThumbnail(isDownload, isForce) {
        if (isDownload) {
            // Download stories if it is video
            let date = new Date().getTime();
            let timestamp = Math.floor(date / 1000);
            let type = 'jpg';
            let username = $("body > div section._ac0a header._ac0k ._ac0l a + div a").first().text() || location.pathname.split('/').at(2);
            // Download thumbnail
            let targetURL = location.pathname.replace(/\/$/ig, '').split("/").at(-1);
            let videoThumbnailURL = "";
            let mediaId = null;

            updateLoadingBar(true);

            if (USER_SETTING.FORCE_RESOURCE_VIA_MEDIA && !state.tempFetchRateLimit) {
                let userInfo = await getUserId(username);
                let userId = userInfo.user.pk;
                let stories = await getStories(userId);
                let urlID = location.pathname.split('/').filter(s => s.length > 0 && s.match(/^([0-9]{10,})$/)).at(-1);
                // OPTIMIZATION: cache items reference
                const items = stories.data.reels_media[0].items;

                items.forEach(item => {
                    if (item.id == urlID) {
                        mediaId = item.id;
                    }
                });

                // FIX: timestamp-based match before fragile index/CSS fallbacks
                if (mediaId == null) {
                    mediaId = resolveStoryMediaIdByTimestamp(stories);
                }

                if (mediaId == null) {
                    let $header = getStoryProgress(username);

                    $header.each(function (index) {
                        if ($(this).children().length > 0) {
                            mediaId = items[index].id;
                        }
                    });
                }

                if (mediaId == null) {
                    // appear in from profile page to story page
                    $('body > div section:visible div.x1ned7t2.x78zum5 > div').each(function (index) {
                        const $this = $(this);
                        if ($this.hasClass('x1lix1fw')) {
                            if ($this.children().length > 0) {
                                mediaId = items[index].id;
                            }
                        }
                    });

                    // appear in from home page to story page
                    $('body > div section:visible ._ac0k > ._ac3r > div').each(function (index) {
                        if ($(this).children().hasClass('_ac3q')) {
                            mediaId = items[index].id;
                        }
                    });
                }

                if (mediaId == null) {
                    mediaId = location.pathname.split('/').filter(s => s.length > 0 && s.match(/^([0-9]{10,})$/)).at(-1);
                }

                if (USER_SETTING.CAPTURE_IMAGE_VIA_MEDIA_CACHE) {
                    const cached = getImageFromCache(mediaId);
                    if (cached) {
                        logger("[Restore Cached onStoryThumbnail]", mediaId);
                        saveFiles(cached, {
                            username,
                            sourceType: "stories",
                            timestamp,
                            filetype: 'jpg',
                            shortcode: mediaId
                        });
                        return;
                    }
                }

                let result = await getMediaInfo(mediaId);

                if (USER_SETTING.RENAME_PUBLISH_DATE) {
                    timestamp = result.items[0].taken_at;
                }

                if (result.status === 'ok') {
                    saveFiles(result.items[0].image_versions2.candidates[0].url, {
                        username,
                        sourceType: "stories",
                        timestamp,
                        filetype: 'jpg',
                        shortcode: mediaId
                    });

                }
                else {
                    if (USER_SETTING.FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED) {
                        state.tempFetchRateLimit = true;
                        onStoryThumbnail(true, isForce);
                    }
                    else {
                        alert('Fetch failed from Media API. API response message: ' + result.message);
                    }

                    logger(result);
                }

                updateLoadingBar(false);
                return;
            }

            if (state.GL_dataCache.stories[username] && !isForce) {
                logger('Fetch from memory cache:', username);
                state.GL_dataCache.stories[username].data.reels_media[0].items.forEach(item => {
                    if (item.id == targetURL) {
                        videoThumbnailURL = item.display_url;
                        if (USER_SETTING.RENAME_PUBLISH_DATE) {
                            timestamp = item.taken_at_timestamp;
                            mediaId = item.id;
                        }
                    }
                });

                if (videoThumbnailURL.length == 0) {
                    logger('Memory cache not found, try fetch from API:', username);
                    onStoryThumbnail(true, true);
                    return;
                }
            }
            else {
                let userInfo = await getUserId(username);
                let userId = userInfo.user.pk;
                let stories = await getStories(userId);
                // OPTIMIZATION: cache items
                const items = stories.data.reels_media[0].items;

                items.forEach(item => {
                    if (item.id == targetURL) {
                        videoThumbnailURL = item.display_url;
                        if (USER_SETTING.RENAME_PUBLISH_DATE) {
                            timestamp = item.taken_at_timestamp;
                            mediaId = item.id;
                        }
                    }
                });

                // GitHub issue #4: thinkpad4
                if (videoThumbnailURL.length == 0) {
                    let $header = getStoryProgress(username);

                    $header.each(function (index) {
                        if ($(this).children().length > 0) {
                            videoThumbnailURL = items[index].display_url;
                            if (USER_SETTING.RENAME_PUBLISH_DATE) {
                                timestamp = items[index].taken_at_timestamp;
                                mediaId = items[index].id;
                            }
                        }
                    });

                    if (videoThumbnailURL.length == 0) {
                        // appear in from profile page to story page
                        $('body > div section:visible div.x1ned7t2.x78zum5 > div').each(function (index) {
                            const $this = $(this);
                            if ($this.hasClass('x1lix1fw')) {
                                if ($this.children().length > 0) {
                                    videoThumbnailURL = items[index].display_url;
                                    if (USER_SETTING.RENAME_PUBLISH_DATE) {
                                        timestamp = items[index].taken_at_timestamp;
                                        mediaId = items[index].id;
                                    }
                                }
                            }
                        });

                        // appear in from home page to story page
                        $('body > div section:visible ._ac0k > ._ac3r > div').each(function (index) {
                            if ($(this).children().hasClass('_ac3q')) {
                                videoThumbnailURL = items[index].display_url;
                                if (USER_SETTING.RENAME_PUBLISH_DATE) {
                                    timestamp = items[index].taken_at_timestamp;
                                    mediaId = items[index].id;
                                }
                            }
                        });
                    }
                }
            }

            saveFiles(videoThumbnailURL, {
                username,
                sourceType: "thumbnail",
                timestamp,
                filetype: type,
                shortcode: mediaId
            });
            state.tempFetchRateLimit = false;
            updateLoadingBar(false);
        }
        else {
            if ($('body > div div.IG_DWSTORY').parent().find('video').length) {
                // Add the stories download button
                let $element = null;
                // Default detecter (section layout mode)
                if ($('body > div section._ac0a').length > 0) {
                    $element = $('body > div section:visible._ac0a');
                }
                // detecter (single story layout mode)
                else {
                    $element = $('body > div section:visible > div > div[style]:not([class])');
                    $element.css('position', 'relative');
                }

                if ($element.length === 0) {
                    $element = $('div[id^="mount"] section > div > a[href="/"]').parent().parent().parent().find('section:visible > div > div[style]:not([class])');
                    $element.css('position', 'relative');
                }

                if ($element.length === 0) {
                    $element = $('div[id^="mount"] section > div > a[href="/"]').parent().parent().parent().find('section:visible > div div[style]:not([class]) > div:not([data-visualcompletion="loading-state"])');
                    $element.css('position', 'relative');
                }

                // Detecter for div layout mode
                if ($element.length === 0) {
                    let $$element = $('body > div div:not([hidden]) section:visible > div div[class][style] > div[style]:not([class])');
                    let nowSize = 0;

                    $$element.each(function () {
                        const $this = $(this);
                        const width = $this.width();
                        if (width > nowSize) {
                            nowSize = width;
                            $element = $this.children('div').first();
                        }
                    });
                }


                if ($element != null) {
                    const $firstEl = $element.first();
                    $firstEl.css('position', 'relative');
                    $firstEl.append(`<div data-ih-locale-title="VIDEO_THUMBNAIL" title="${_i18n("VIDEO_THUMBNAIL")}" class="IG_DWSTORY_THUMBNAIL">${SVG.THUMBNAIL}</div>`);
                }

            }
        }
    }

    /* utils */

    const DB_NAME = 'IG_HELPER'; // Preserve the existing IndexedDB cache across script upgrades.
    const DB_VERSION = 1;
    const STORE_NAME = 'DATA_CACHE';

    /**
     * openDB
     */
    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(`Database open failed: ${event.target.error}`);
        });
    }

    /**
     * @param {Object} data
     */
    async function addData(data) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.add(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(`Insert failed: ${event.target.error}`);
        });
    }

    /**
     * @param {number} id
     */
    async function getData(id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(`Read failed: ${event.target.error}`);
        });
    }

    /**
     * @returns {Promise<Array>}
     */
    async function getAllData() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(`Read all failed: ${event.target.error}`);
        });
    }

    /**
     * @param {Object} data
     */
    async function updateData(data) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);

            const request = store.put(data);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (event) => reject(`Update failed: ${event.target.error}`);
        });
    }

    /**
     * @param {number} id
     */
    async function deleteData(id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => resolve(true);
            request.onerror = (event) => reject(`Delete failed: ${event.target.error}`);
        });
    }

    /**
     * getHighlightStories
     * @description Get a list of all stories in highlight Id.
     *
     * @param  {Integer}  highlightId
     * @return {Object}
     */
    function getHighlightStories(highlightId) {
        return new Promise((resolve, reject) => {
            const getURL = `https://www.instagram.com/graphql/query/?query_hash=45246d3fe16ccc6577e0bd297a5db1ab&variables=%7B%22highlight_reel_ids%22:%5B%22${highlightId}%22%5D,%22precomposed_overlay%22:false%7D`;

            GM_xmlhttpRequest({
                method: "GET",
                url: getURL,
                onload: function (response) {
                    try {
                        let obj = JSON.parse(response.response);
                        resolve(obj);
                    }
                    catch (err) {
                        logger('getHighlightStories()', 'reject', err.message);
                        reject(err);
                    }
                },
                onerror: function (err) {
                    logger('getHighlightStories()', 'reject', err);
                    reject(err);
                }
            });
        });
    }

    /**
     * getStories
     * @description Get a list of all stories in user Id.
     *
     * @param  {Integer}  userId
     * @return {Object}
     */
    function getStories(userId) {
        return new Promise((resolve, reject) => {
            const getURL = `https://www.instagram.com/graphql/query/?query_hash=15463e8449a83d3d60b06be7e90627c7&variables=%7B%22reel_ids%22:%5B%22${userId}%22%5D,%22precomposed_overlay%22:false%7D`;

            GM_xmlhttpRequest({
                method: "GET",
                url: getURL,
                onload: function (response) {
                    try {
                        let obj = JSON.parse(response.response);
                        logger('getStories()', obj);
                        resolve(obj);
                    }
                    catch (err) {
                        logger('getStories()', 'reject', err.message);
                        reject(err);
                    }
                },
                onerror: function (err) {
                    logger('getStories()', 'reject', err);
                    reject(err);
                }
            });
        });
    }

    /**
     * getUserId
     * @description Get user's id with username.
     *
     * @param  {String}  username
     * @return {Promise<Integer>}
     */
    function getUserId(username) {
        return new Promise((resolve, reject) => {
            if (userIdCache.has(username)) {
                logger('getUserId()', 'return from cache:', userIdCache.get(username));
                resolve(userIdCache.get(username));
                return;
            }

            let getURL = `https://www.instagram.com/web/search/topsearch/?query=${username}`;

            GM_xmlhttpRequest({
                method: "GET",
                url: getURL,
                onload: function (response) {
                    try {
                        // Fix search issue by Discord: sno_w_
                        let obj = JSON.parse(response.response);
                        let result = null;
                        (obj.users ?? []).forEach(pos => {
                            if (pos.user.username?.toLowerCase() === username?.toLowerCase()) {
                                result = pos;
                            }
                        });

                        if (result != null) {
                            logger('getUserId()', result);
                            userIdCache.set(username, result);
                            resolve(result);
                        }
                        else {
                            getUserIdWithAgent(username).then((result) => {
                                userIdCache.set(username, result);
                                resolve(result);
                            // eslint-disable-next-line no-unused-vars
                            }).catch((err) => {
                                userIdCache.delete(username);
                                logger('getUserId()', 'fallback reject', err);
    							alert("Cannot find user info from getUserId()\nDetails may be in the console.");
                                reject(err);
                            });
                        }
                    } catch (err) {
                        userIdCache.delete(username);
                        logger('getUserId()', 'parse reject', err);
                        reject(err);
                    }
                },
                onerror: function (err) {
                    logger('getUserId()', 'reject', err);
                    userIdCache.delete(username);
                    reject(err);
                }
            });
        });
    }

    /**
     * getUserIdWithAgent
     * @description Get user's id with username.
     *
     * @param  {String}  username
     * @return {Integer}
     */
    function getUserIdWithAgent(username) {
        return new Promise((resolve, reject) => {
            const getURL = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`;

            GM_xmlhttpRequest({
                method: "GET",
                url: getURL,
                headers: {
                    'X-IG-App-ID': getAppID()
                },
                onload: function (response) {
                    try {
                        let obj = JSON.parse(response.response);
                        let hasUser = obj?.data?.user;

                        if (hasUser != null) {
                            let userInfo = obj?.data;
                            userInfo.user.pk = userInfo.user.id;
                            logger('getUserIdWithAgent()', obj);
                            resolve(userInfo);
                        }
                        else {
                            logger('getUserIdWithAgent()', 'reject', 'undefined');
                            reject('undefined');
                        }
                    }
                    catch (err) {
                        logger('getUserIdWithAgent()', 'reject', err.message);
                        reject(err);
                    }
                },
                onerror: function (err) {
                    logger('getUserIdWithAgent()', 'reject', err);
                    reject(err);
                }
            });
        });
    }

    /**
     * getUserHighSizeProfile
     * @description Get user's high quality avatar image.
     *
     * @param  {Integer}  userId
     * @return {String}
     */
    function getUserHighSizeProfile(userId) {
        return new Promise((resolve, reject) => {
            const getURL = `https://www.instagram.com/api/v1/users/${userId}/info/`;

            GM_xmlhttpRequest({
                method: "GET",
                url: getURL,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 7 XL)Build/RP1A.20845.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 Chrome/117.0.5938.60 Mobile Safari/537.36 Instagram 307.0.0.34.111'
                },
                onload: function (response) {
                    try {
                        let obj = JSON.parse(response.response);
                        if (obj.status !== 'ok') {
                            logger('getUserHighSizeProfile()', 'reject', obj);
                            reject('faild');
                        }
                        else {
                            logger('getUserHighSizeProfile()', obj);
                            resolve(obj.user.hd_profile_pic_url_info?.url);
                        }
                    }
                    catch (err) {
                        logger('getUserHighSizeProfile()', 'reject', err);
                        reject(err);
                    }
                },
                onerror: function (err) {
                    logger('getUserHighSizeProfile()', 'reject', err);
                    reject(err);
                }
            });
        });
    }

    /**
     * getPostOwner
     * @description Get post's author with post shortcode.
     *
     * @param  {String}  postPath
     * @return {String}
     */
    function getPostOwner(postPath) {
        return new Promise((resolve, reject) => {
            if (!postPath) reject("NOPATH");
            const postShortCode = postPath;
            const getURL = `https://www.instagram.com/graphql/query/?query_hash=2c4c2e343a8f64c625ba02b2aa12c7f8&variables=%7B%22shortcode%22:%22${postShortCode}%22}`;

            GM_xmlhttpRequest({
                method: "GET",
                url: getURL,
                onload: function (response) {
                    try {
                        let obj = JSON.parse(response.response);
                        logger('getPostOwner()', obj);
                        resolve(obj.data.shortcode_media.owner.username);
                    }
                    catch (err) {
                        logger('getPostOwner()', 'reject', err.message);
                        reject(err);
                    }
                },
                onerror: function (err) {
                    logger('getPostOwner()', 'reject', err);
                    reject(err);
                }
            });
        });
    }

    // Reuse media data already loaded by Instagram before calling its API.
    function findEmbeddedPostMedia(shortcode, scripts, fallbackUsername) {
        if (!shortcode || !scripts) return null;
    
        let best = null;
        let bestScore = 0;
        let scanned = 0;
        const isURL = value => typeof value === 'string' && /^https?:\/\//i.test(value);
        const hasImage = media => media?.image_versions2?.candidates?.some(c => isURL(c?.url));
        const hasVideo = media => media?.video_versions?.some(v => isURL(v?.url));
    
        function inspect(value, depth, seen) {
            if (depth > 45 || scanned++ > 150000 || value == null) return;
            if (typeof value === 'string') {
                if (value.length > 2 && value.length < 2000000 && value.includes(shortcode)) {
                    const trimmed = value.trim();
                    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                        try { inspect(JSON.parse(trimmed), depth + 1, seen); } catch (_) { /* not JSON */ }
                    }
                }
                return;
            }
            if (typeof value !== 'object' || seen.has(value)) return;
            seen.add(value);
    
            const code = value.code || value.shortcode;
            if (code === shortcode) {
                const carousel = Array.isArray(value.carousel_media)
                    ? value.carousel_media.filter(m => hasImage(m) || hasVideo(m)) : [];
                const score = (hasVideo(value) ? 3 : 0) + (hasImage(value) ? 2 : 0) + carousel.length * 4;
                if (score > bestScore) {
                    best = value;
                    bestScore = score;
                }
            }
            for (const child of Object.values(value)) inspect(child, depth + 1, seen);
        }
    
        for (const script of scripts) {
            if (scanned > 150000) break;
            let content = script?.textContent || '';
            if (!content.includes(shortcode) || content.length > 4000000) continue;
            content = content.trim().replace(/^for\s*\(\s*;\s*;\s*\)\s*;?/, '').trim();
            if (!content.startsWith('{') && !content.startsWith('[')) continue;
            try { inspect(JSON.parse(content), 0, new WeakSet()); } catch (_) { /* not JSON */ }
        }
    
        if (!best) return null;
        const owner = best.owner || best.user || {};
        return {
            ...best,
            code: best.code || best.shortcode || shortcode,
            pk: best.pk || best.id,
            owner: { ...owner, username: owner.username || fallbackUsername || 'NONE' },
        };
    }

    // Fallback: use the media URL Instagram has already rendered in the active post.
    // This intentionally returns only the current slide; it must not masquerade as a full carousel listing.
    function getCurrentVisibleMediaFromDOM($article, shortcode) {
        const $root = $($article).first();
        if ($root.length === 0) return null;

        const toMediaURL = (value) => {
            if (typeof value !== 'string' || !value.trim()) return null;
            try {
                const parsed = new URL(value.trim(), location.href);
                return (parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'blob:')
                    ? parsed.href
                    : null;
            } catch (_) {
                return null;
            }
        };

        const parseSrcset = (srcset) => {
            return String(srcset || '').split(',').map((part) => {
                const match = part.trim().match(/^(\S+)\s+([\d.]+)(w|x)$/i);
                if (!match) return null;
                const size = parseFloat(match[2]) || 0;
                return {
                    url: toMediaURL(match[1]),
                    width: match[3].toLowerCase() === 'w' ? size : size * 10000
                };
            }).filter(candidate => candidate && candidate.url)
                .sort((a, b) => b.width - a.width);
        };

        const getImageCandidate = (img) => {
            const srcset = img.getAttribute('srcset') || img.srcset || '';
            const candidates = parseSrcset(srcset);
            if (candidates.length > 0) return candidates[0];

            const url = toMediaURL(img.currentSrc || img.getAttribute('src') || img.src);
            if (!url) return null;
            return {
                url,
                width: img.naturalWidth || 0,
                height: img.naturalHeight || 0
            };
        };

        let bestImage = null;
        $root.find('img:visible').each(function () {
            const rect = this.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (rect.width < 100 || rect.height < 100 || area < 20000) return;

            const candidate = getImageCandidate(this);
            if (!candidate) return;
            if (!bestImage || area > bestImage.area) {
                bestImage = {
                    ...candidate,
                    area,
                    element: this
                };
            }
        });

        const storedImageURL = toMediaURL($root.data('igMedia_displayResourceURL'));
        if (!bestImage && storedImageURL) {
            bestImage = { url: storedImageURL, width: 0, height: 0, area: 0, element: null };
        }

        let bestVideo = null;
        $root.find('video:visible').each(function () {
            const rect = this.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (rect.width < 100 || rect.height < 100 || area < 20000) return;

            const source = this.querySelector('source[src]');
            const videoURL = toMediaURL(
                this.currentSrc || this.getAttribute('src') || source?.getAttribute('src')
            );
            if (!videoURL) return;

            const posterURL = toMediaURL(this.getAttribute('poster')) || bestImage?.url || null;
            if (!posterURL) return;

            if (!bestVideo || area > bestVideo.area) {
                bestVideo = {
                    url: videoURL,
                    poster: posterURL,
                    area,
                    width: this.videoWidth || rect.width,
                    height: this.videoHeight || rect.height
                };
            }
        });

        let globalIndex = 1;
        const routeMatch = location.pathname.match(/^\/(?:p|reel)\/([^/]+)/i);
        const routeIndex = new URLSearchParams(location.search).get('img_index');
        if (routeMatch && routeMatch[1] === shortcode && routeIndex !== null) {
            const parsedIndex = Number(routeIndex);
            if (Number.isInteger(parsedIndex) && parsedIndex >= 1) {
                // Instagram's img_index is one-based; userscript data-globalIndex is also one-based.
                globalIndex = parsedIndex;
            } else {
                globalIndex = Math.max(0, getVisibleNodeIndex($root)) + 1;
            }
        } else {
            globalIndex = Math.max(0, getVisibleNodeIndex($root)) + 1;
        }

        const username = String(
            $root.data('username') || state.GL_username ||
            $root.find('header a[href^="/"]').first().text() || 'NONE'
        ).trim();

        const datetime = $root.find('time[datetime]').first().attr('datetime');
        let takenAt = 0;
        if (datetime) {
            const numeric = Number(datetime);
            if (Number.isFinite(numeric) && numeric > 0) {
                takenAt = Math.floor(numeric > 1000000000000 ? numeric / 1000 : numeric);
            } else {
                const parsedDate = Date.parse(datetime);
                if (Number.isFinite(parsedDate)) takenAt = Math.floor(parsedDate / 1000);
            }
        }
        if (!takenAt) takenAt = Math.floor(Date.now() / 1000);

        if (bestVideo) {
            return {
                pk: '',
                code: shortcode,
                taken_at: takenAt,
                owner: { username },
                __snCurrentIndex: globalIndex,
                image_versions2: {
                    candidates: [{
                        url: bestVideo.poster,
                        width: bestVideo.width,
                        height: bestVideo.height
                    }]
                },
                video_versions: [{ url: bestVideo.url }]
            };
        }

        if (bestImage) {
            return {
                pk: '',
                code: shortcode,
                taken_at: takenAt,
                owner: { username },
                __snCurrentIndex: globalIndex,
                image_versions2: {
                    candidates: [{
                        url: bestImage.url,
                        width: bestImage.width || bestImage.element?.naturalWidth || 0,
                        height: bestImage.height || bestImage.element?.naturalHeight || 0
                    }]
                },
                video_versions: null
            };
        }

        return null;
    }

    /**
     * getBlobMedia
     * @description Get list of all media files in post with post shortcode.
     *
     * @param  {String}  postPath
     * @return {Object}
     */
    function getBlobMedia(postPath) {
        const embedded = findEmbeddedPostMedia(postPath, document.scripts, state.GL_username);
        if (embedded) return Promise.resolve({ type: 'query_id', data: embedded });
        return new Promise((resolve, reject) => {
            if (!postPath) reject("NOPATH");
            const postShortCode = postPath;
            const getURL = `https://www.instagram.com/graphql/query/?query_hash=2c4c2e343a8f64c625ba02b2aa12c7f8&variables=%7B%22shortcode%22:%22${postShortCode}%22}`;

            GM_xmlhttpRequest({
                method: "GET",
                url: getURL,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Linux; Android 10; Pixel 7 XL)Build/RP1A.20845.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 Chrome/117.0.5938.60 Mobile Safari/537.36 Instagram 307.0.0.34.111"
                },
                onload: function (response) {
                    try {
                        let obj = JSON.parse(response.response);
                        logger(obj);

                        if (obj.status === 'fail') {
                            // alert(`Request failed with API response:\n${obj.message}: ${obj.feedback_message}`);
                            logger('Request with:', 'getBlobMediaWithQuery()', postShortCode);
                            getBlobMediaWithQueryID(postShortCode).then((res) => {
                                resolve({ type: 'query_id', data: res.xdt_api__v1__media__shortcode__web_info.items[0] });
                            }).catch((err) => {
                                reject(err);
                            })
                        }
                        else {
                            resolve({ type: 'query_hash', data: obj.data });
                        }
                    }
                    catch (err) {
                        logger('getBlobMedia()', 'reject', err.message);
                        reject(err);
                    }
                },
                onerror: function (err) {
                    logger('getBlobMedia()', 'reject', err);
                    reject(err);
                }
            });
        });
    }

    /**
     * getBlobMediaWithQueryID
     * @description Get list of all media files in post with post shortcode.
     *
     * @param  {String}  postPath
     * @return {Object}
     */
    function getBlobMediaWithQueryID(postPath) {
        return new Promise((resolve, reject) => {
            if (!postPath) reject("NOPATH");
            const postShortCode = postPath;
            const getURL = `https://www.instagram.com/graphql/query/?query_id=9496392173716084&variables={%22shortcode%22:%22${postShortCode}%22,%22__relay_internal__pv__PolarisFeedShareMenurelayprovider%22:true,%22__relay_internal__pv__PolarisIsLoggedInrelayprovider%22:true}`;

            GM_xmlhttpRequest({
                method: "GET",
                url: getURL,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Linux; Android 10; Pixel 7 XL)Build/RP1A.20845.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 Chrome/117.0.5938.60 Mobile Safari/537.36 Instagram 307.0.0.34.111",
                    'X-IG-App-ID': getAppID()
                },
                onload: function (response) {
                    try {
                        let obj = JSON.parse(response.response);
                        logger(obj);

                        if (obj.status === 'fail') {
                            const errorMessage = 'Request failed with API response ' + obj.message + ': ' + obj.feedback_message;
                            logger('getBlobMediaWithQueryID()', errorMessage);
                            reject(new Error(errorMessage));
                        }
                        else {
                            logger('getBlobMediaWithQueryID()', obj.data);
                            resolve(obj.data);
                        }
                    }
                    catch (err) {
                        logger('getBlobMediaWithQueryID()', 'reject', err.message);
                        reject(err);
                    }
                },
                onerror: function (err) {
                    logger('getBlobMediaWithQueryID()', 'reject', err);
                    reject(err);
                }
            });
        });
    }

    /**
     * getMediaInfo
     * @description Get Instagram Media object.
     *
     * @param  {String}  mediaId
     * @return {Object}
     */
    function getMediaInfo(mediaId) {
        return new Promise((resolve, reject) => {
            const getURL = `https://i.instagram.com/api/v1/media/${mediaId}/info/`;

            if (mediaId == null) {
                alert("Cannot call Media API because of the media id is invalid.");
                logger('getMediaInfo()', 'reject', 'Cannot call Media API because of the media id is invalid.');

                updateLoadingBar(false);
                reject(-1);
                return;
            }
            if (getAppID() == null) {
                alert("Cannot call Media API because of the app id is invalid.");
                logger('getMediaInfo()', 'reject', 'Cannot call Media API because of the app id is invalid.');
                updateLoadingBar(false);
                reject(-1);
                return;
            }

            GM_xmlhttpRequest({
                method: "GET",
                url: getURL,
                headers: {
                    "User-Agent": window.navigator.userAgent,
                    "Accept": "*/*",
                    'X-IG-App-ID': getAppID()
                },
                onload: function (response) {
                    if (response.finalUrl == getURL) {
                        let obj = JSON.parse(response.response);
                        logger('getMediaInfo()', obj);
                        resolve(obj);
                    }
                    else {
                        let finalURL = new URL(response.finalUrl);
                        if (finalURL.pathname.startsWith('/accounts/login')) {
                            logger('getMediaInfo()', 'reject', 'The account must be logged in to access Media API.');
                            alert("The account must be logged in to access Media API.");
                        }
                        else {
                            logger('getMediaInfo()', 'reject', 'Unable to retrieve content because the API was redirected to "' + response.finalUrl + '"');
                            alert('Unable to retrieve content because the API was redirected to "' + response.finalUrl + '"');
                        }
                        updateLoadingBar(false);
                        reject(-1);
                    }
                },
                onerror: function (err) {
                    logger('getMediaInfo()', 'reject', err);
                    resolve(err);
                }
            });
        });
    }

    function isMacOS() {
        return /Macintosh|Mac OS/i.test(navigator.userAgent);
    }

    function getPlatformModifierKey() {
        return isMacOS() ? '⌥' : 'Alt';
    }

    /**
     * getStoryId
     * @description Obtain the media id through the resource URL.
     *
     * @param  {string}  url
     * @return {string}
     */
    function getStoryId(url) {
        let obj = new URL(url);
        let base64 = obj?.searchParams?.get('ig_cache_key')?.split('.').at(0);
        if (base64) {
            return atob(base64);
        }
        else {
            return null;
        }
    }

    /**
     * getAppID
     * @description Get Instagram App ID.
     *
     * @return {?string}
     */
    function getAppID() {
        let result = null;
        $('script[type="application/json"]').each(function () {
            const regexp = /"APP_ID":"([0-9]+)"/ig;
            const $this = $(this);
            const text = $this.text();
            const matcher = text.match(regexp);
            if (matcher != null && result == null) {
                result = [...text.matchAll(regexp)];
            }
        })

        return (result) ? result.at(0).at(-1) : null;
    }

    /**
     * getTimeElementBaseDateSource
     * @description Get the base date text source and cache key from a time element.
     *
     * @param  {JQuery}  $time
     * @return {{dateText: ?string, cacheKey: ?string}}
     */
    function getTimeElementBaseDateSource($time) {
        const titleText = $time.attr('title')?.trim();
        if (titleText) {
            return {
                dateText: titleText,
                cacheKey: `title:${titleText}`
            };
        }

        const datetime = $time.attr('datetime')?.trim();
        if (datetime) {
            const date = new Date(datetime);
            if (!Number.isNaN(date.getTime())) {
                return {
                    dateText: new Intl.DateTimeFormat(undefined, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    }).format(date),
                    cacheKey: `datetime:${datetime}`
                };
            }
        }

        return {
            dateText: null,
            cacheKey: null
        };
    }

    /**
     * getTimeElementBaseDateText
     * @description Get the preserved absolute date text from a time element.
     *
     * @param  {JQuery}  $time
     * @return {?string}
     */
    function getTimeElementBaseDateText($time) {
        const preservedText = $time.attr('data-ih-original-date')?.trim();
        const preservedKey = $time.attr('data-ih-original-date-key')?.trim();
        const { dateText, cacheKey } = getTimeElementBaseDateSource($time);

        if (preservedText && preservedKey && cacheKey && preservedKey === cacheKey) {
            return preservedText;
        }

        if (dateText && cacheKey) {
            $time.attr('data-ih-original-date', dateText);
            $time.attr('data-ih-original-date-key', cacheKey);
            return dateText;
        }

        return null;
    }

    /**
     * setTimeElementDateAndLocaleTime
     * @description Replace time element text with absolute date and localized time.
     *
     * @param  {JQuery}  $time
     * @return {void}
     */
    function setTimeElementDateAndLocaleTime($time) {
        if ($time == null || $time.length === 0) {
            return;
        }

        const datetime = $time.attr('datetime');
        if (!datetime) {
            return;
        }

        const date = new Date(datetime);
        if (Number.isNaN(date.getTime())) {
            return;
        }

        const dateText = getTimeElementBaseDateText($time);
        if (!dateText) {
            return;
        }

        const localeTime = new Intl.DateTimeFormat(undefined, {
            hour: 'numeric',
            minute: '2-digit'
        }).format(date);

        if (!localeTime) {
            return;
        }

        const finalText = `${dateText} ${localeTime}`;

        if ($time.text()?.trim() !== finalText) {
            $time.text(finalText);
            $time.css('white-space', 'break-spaces');
        }
    }

    /**
     * getHighlightCurrentTimeElement
     * @description Get the publish time element in the current highlight view.
     *
     * @param  {JQuery}  $element
     * @return {JQuery}
     */
    function getHighlightCurrentTimeElement($element) {
        if ($element == null || $element.length === 0) {
            $element = $body;
        }

        let $section = $element.closest('section:visible');
        if ($section.length === 0) {
            $section = $('body > div section:visible').last();
        }

        if ($section.length === 0) {
            return $();
        }

        let $times = $section.find('time[datetime]').filter(function () {
            const $time = $(this);

            return (
                $time.is(':visible') &&
                $time.closest('a[href^="/stories/highlights/"]').length === 0 &&
                $time.closest('[role="button"]').length === 0
            );
        });

        if ($times.length === 0) {
            return $();
        }

        return $times.first();
    }

    /**
     * updateLoadingBar
     * @description Update loading state.
     *
     * @param  {Boolean}  isLoading - Check if loading state
     * @return {void}
     */
    function updateLoadingBar(isLoading) {
        // OPTIMIZATION: cache the mount root selection (called every time)
        const $mountDiv = $('div[id^="mount"] > div > div > div:first');
        if (isLoading) {
            $mountDiv.removeClass('x1s85apg');
            $mountDiv.css('z-index', '20000');
        }
        else {
            $mountDiv.addClass('x1s85apg');
            $mountDiv.css('z-index', '');
        }
    }

    /**
     * getStoryProgress
     * @description Get the story progress of the username (post several stories).
     *
     * @param  {String}  username - Get progress of username
     * @return {Object}
     */
    function getStoryProgress(username) {
        const lowerUsername = username?.toLowerCase();
        let $header = $('body > div section:visible a[href^="/' + (username) + '"] span').filter(function () {
            const $this = $(this);
            return $this.children().length === 0 && $this.find('svg').length === 0 && $this.text()?.toLowerCase() === lowerUsername;
        }).parents('div:not([class]):not([style])').filter(function () {
            return $(this).text()?.toLowerCase() !== lowerUsername
        }).filter(function () {
            return $(this).children().length > 1
        }).first();

        if ($header.length === 0) {
            $header = $('body > div section:visible a[href^="/' + (username) + '"]').filter(function () {
                return $(this).find('img').length > 0
            }).parents('div:not([class]):not([style])').filter(function () {
                return $(this).text()?.toLowerCase() !== lowerUsername
            }).filter(function () {
                return $(this).children().length > 1
            }).first();
        }

        return $header.children().filter(function () {
            return $(this).height() < 10
        }).first().children();
    }

    /**
     * getStoryProgressIndex
     * @description Get the current story index and total count from Instagram's progress bar.
     *
     * @param  {Object}  $header - Progress bar items returned by getStoryProgress
     * @return {?Object}
     */
    function getStoryProgressIndex($header) {
        let current = 0;
        let total = $header.length;

        if (total === 0) {
            return null;
        }

        $header.each(function (index) {
            if ($(this).children().length > 0) {
                current = index + 1;
            }
        });

        if (current === 0) {
            return null;
        }

        return { current, total };
    }

    /**
     * setStoryProgressIndexText
     * @description Render the current story index and total count.
     *
     * @param  {Object}  $element - Element to append the counter to
     * @param  {Object}  $header - Progress bar items returned by getStoryProgress
     * @param  {String}  className - Counter class name
     * @return {void}
     */
    function setStoryProgressIndexText($element, $header, className) {
        let progress = getStoryProgressIndex($header);
        let $counter = $element.find('.' + className).first();

        if (progress == null || progress.total < 2) {
            if ($counter.length > 0) {
                $counter.remove();
            }
            return;
        }

        let text = progress.current + '/' + progress.total;
        let title = _i18n('ITEM_POSITION')
            .replace('%CURRENT%', progress.current)
            .replace('%TOTAL%', progress.total);

        if ($counter.length === 0) {
            $counter = $('<div>').addClass(className);
            $element.append($counter);
        }

        if ($counter.text() !== text) {
            $counter.text(text);
        }

        if ($counter.attr('title') !== title) {
            $counter.attr('title', title);
        }

        if ($counter.attr('aria-label') !== title) {
            $counter.attr('aria-label', title);
        }
    }

    /**
     * setStoryProgressIndexByUsername
     * @description Render current story index and total count from a username.
     *
     * @param  {Object}  $element - Element to append the counter to
     * @param  {String}  username - Story owner's username
     * @param  {String}  className - Counter class name
     * @return {void}
     */
    function setStoryProgressIndexByUsername($element, username, className) {
        if ($element == null || $element.length === 0 || username == null) {
            return;
        }

        let $header = getStoryProgress(username);
        setStoryProgressIndexText($element, $header, className);
    }

    /**
     * setDownloadProgress
     * @description Show and set download circle progress.
     *
     * @param  {Integer}  now
     * @param  {Integer}  total
     * @return {Void}
     */
    function setDownloadProgress(now, total) {
        // OPTIMIZATION: cache the circle wrapper lookup
        const $circle = $('.circle_wrapper');
        if ($circle.length) {
            $circle.find('span').text(`${now}/${total}`);

            if (now >= total) {
                $circle.fadeOut(250, function () {
                    $(this).remove();
                });
            }
        }
        else {
            $body.append(`<div class="circle_wrapper"><circle></circle><span>${now}/${total}</span></div>`);
        }
    }

    /**
     * saveFiles
     * @description Download the specified media URL to the computer.
     *
     * @param  {String}  downloadLink
     * @param  {Object}  metadata
     * @param  {String}  metadata.username
     * @param  {String}  metadata.sourceType
     * @param  {Integer}  metadata.timestamp
     * @param  {String}  metadata.filetype
     * @param  {String}  metadata.shortcode
     * @param  {Integer|null}  metadata.index
     * @param  {String|null}  metadata.uid
     * @return {Promise}
     */
    function saveFiles(downloadLink, metadata) {
        return new Promise(resolve => {
            setTimeout(() => {
                updateLoadingBar(true);

                const downloadName = getSaveFileName(downloadLink, metadata);
                const { filetype, shortcode, sourceType } = metadata;

                if (
                    USER_SETTING.MODIFY_RESOURCE_EXIF &&
                    filetype === 'jpg' &&
                    shortcode &&
                    sourceType === 'photo'
                ) {
                    fetch(downloadLink)
                        .then(res => res.blob())
                        .then(dwel => {
                            updateLoadingBar(false);
                            return createSaveFileElement(downloadLink, dwel, metadata);
                        })
                        .then(() => resolve(true))
                        .catch(err => {
                            updateLoadingBar(false);
                            console.error('saveFiles failed', err);
                            resolve(false);
                        });
                } else {
                    if (USER_SETTING.USE_EXTERNAL_DOWNLOAD_MODE) {
                        GM_download({
                            url: downloadLink,
                            name: downloadName,
                            onload: () => {
                                updateLoadingBar(false);
                                resolve(true);
                            },
                            // eslint-disable-next-line no-unused-vars
                            onerror: (err) => {
                                updateLoadingBar(false);
                                resolve(true);
                            },
                        });
                    }
                    else {
                        updateLoadingBar(true);
                        fetch(downloadLink)
                            .then(res => res.blob())
                            .then(dwel => {
                                updateLoadingBar(false);
                                return createSaveFileElement(downloadLink, dwel, metadata);
                            })
                            .then(() => resolve(true))
                            .catch(err => {
                                updateLoadingBar(false);
                                console.error('saveFiles failed:', err);
                                resolve(false);
                            });
                    }
                }
            }, 50);
        });
    }

    /**
     * fetchArrayBuffer
     * @description Download URL as ArrayBuffer.
     *
     * @param {string} url
     * @return {Promise<ArrayBuffer>}
     */
    async function fetchArrayBuffer(url) {
        updateLoadingBar(true);
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.arrayBuffer();
        } finally {
            updateLoadingBar(false);
        }
    }

    /**
     * parseDashManifest
     * @description Parse Media API video_dash_manifest (MPD XML).
     *              Returns best video/audio representation URLs.
     *
     * @param  {string} mpdXml
     * @return {{ video: any|null, audio: any|null }}
     */
    function parseDashManifest(mpdXml) {
        try {
            if (!mpdXml || typeof mpdXml !== 'string') return { video: null, audio: null };

            const xml = new DOMParser().parseFromString(mpdXml, 'application/xml');
            if (xml.querySelector('parsererror')) return { video: null, audio: null };

            const reps = Array.from(xml.querySelectorAll('Representation'));
            const candidates = reps.map((rep) => {
                const base = rep.querySelector('BaseURL')?.textContent?.trim();
                if (!base) return null;

                const set = rep.closest('AdaptationSet');
                const mimeType = rep.getAttribute('mimeType') || set?.getAttribute('mimeType') || '';
                const contentType = set?.getAttribute('contentType') || '';
                const codecs = rep.getAttribute('codecs') || set?.getAttribute('codecs') || '';
                const bandwidth = parseInt(rep.getAttribute('bandwidth') || '0', 10) || 0;
                const width = parseInt(rep.getAttribute('width') || '0', 10) || 0;
                const height = parseInt(rep.getAttribute('height') || '0', 10) || 0;
                const id = rep.getAttribute('id') || '';

                return { id, url: base, mimeType, contentType, codecs, bandwidth, width, height };
            }).filter(Boolean);

            const isVideo = (c) => ((c.contentType || '').includes('video') || (c.mimeType || '').startsWith('video'));
            const isAudio = (c) => ((c.contentType || '').includes('audio') || (c.mimeType || '').startsWith('audio'));

            const bestVideo = candidates
                .filter(isVideo)
                .sort((a, b) => (b.height - a.height) || (b.bandwidth - a.bandwidth) || (b.width - a.width))[0] || null;

            const bestAudio = candidates
                .filter(isAudio)
                .sort((a, b) => (b.bandwidth - a.bandwidth))[0] || null;

            return { video: bestVideo, audio: bestAudio };
        } catch (e) {
            logger('[DASH]', 'parseDashManifest() error:', e);
            return { video: null, audio: null };
        }
    }

    /**
     * muxDashVideoAudioToMp4
     * @description Mux DASH video+audio into one MP4 using Mediabunny (demux + mux).
     *
     * @param {ArrayBuffer} videoBuf
     * @param {ArrayBuffer} audioBuf
     * @return {Promise<ArrayBuffer>}
     */
    async function muxDashVideoAudioToMp4(videoBuf, audioBuf) {
        const MB = Mediabunny;

        const videoInput = new MB.Input({
            formats: [MB.MP4],
            source: new MB.BufferSource(videoBuf),
        });
        const audioInput = new MB.Input({
            formats: [MB.MP4],
            source: new MB.BufferSource(audioBuf),
        });

        const vTrack = await videoInput.getPrimaryVideoTrack();
        if (!vTrack || !vTrack.codec) throw new Error('No video track found');

        const aTrack = await audioInput.getPrimaryAudioTrack();
        if (!aTrack || !aTrack.codec) throw new Error('No audio track found');

        const vSink = new MB.EncodedPacketSink(vTrack);
        const aSink = new MB.EncodedPacketSink(aTrack);

        const output = new MB.Output({
            format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }),
            target: new MB.BufferTarget(),
        });

        const vSource = new MB.EncodedVideoPacketSource(vTrack.codec);
        const aSource = new MB.EncodedAudioPacketSource(aTrack.codec);

        output.addVideoTrack(vSource, { rotation: vTrack.rotation || 0 });
        output.addAudioTrack(aSource);

        await output.start();

        const vDecoderConfig = await vTrack.getDecoderConfig();
        const aDecoderConfig = await aTrack.getDecoderConfig();

        const vMeta = vDecoderConfig ? { decoderConfig: vDecoderConfig } : undefined;
        const aMeta = aDecoderConfig ? { decoderConfig: aDecoderConfig } : undefined;

        const vIter = vSink.packets();
        const aIter = aSink.packets();

        let vNext = await vIter.next();
        let aNext = await aIter.next();
        let vSentMeta = false;
        let aSentMeta = false;

        while (!vNext.done || !aNext.done) {
            const takeVideo = (() => {
                if (vNext.done) return false;
                if (aNext.done) return true;
                return vNext.value.timestamp <= aNext.value.timestamp;
            })();

            if (takeVideo) {
                await vSource.add(vNext.value, vSentMeta ? undefined : vMeta);
                vSentMeta = true;
                vNext = await vIter.next();
            } else {
                await aSource.add(aNext.value, aSentMeta ? undefined : aMeta);
                aSentMeta = true;
                aNext = await aIter.next();
            }
        }

        await output.finalize();

        const outBuf = output.target.buffer;
        if (outBuf instanceof ArrayBuffer) return outBuf;
        if (outBuf && outBuf.buffer) {
            return outBuf.buffer.slice(outBuf.byteOffset, outBuf.byteOffset + outBuf.byteLength);
        }
        throw new Error('Unexpected output buffer type');
    }

    async function downloadDashStreams(videoUrl, audioUrl, username, sourceType, timestamp, shortcode) {
        logger('[DASH]', 'downloadDashStreams()', {
            videoUrl: videoUrl,
            audioUrl: audioUrl || null,
            sourceType,
            shortcode
        });

        if (!audioUrl) {
            logger('[DASH]', 'Downloaded DASH video only (no audio rep / has_audio=false).');
            await saveFiles(videoUrl, {
                username,
                sourceType,
                timestamp,
                filetype: 'mp4',
                shortcode
            });
            return true;
        }

        try {
            logger('[DASH]', 'Fetching DASH streams for mux...');
            const [vBuf, aBuf] = await Promise.all([
                fetchArrayBuffer(videoUrl),
                fetchArrayBuffer(audioUrl)
            ]);

            logger('[DASH]', 'Muxing DASH video+audio into one MP4 (mp4box main thread)...');
            const mergedBuf = await muxDashVideoAudioToMp4(vBuf, aBuf);
            const mergedBlob = new Blob([mergedBuf], { type: 'video/mp4' });

            await createSaveFileElement(videoUrl, mergedBlob, { username, sourceType, timestamp, filetype: 'mp4', shortcode });
            logger('[DASH]', 'Merged MP4 download triggered.');
            return true;
        } catch (e) {
            logger('[DASH]', 'Mux failed -> fallback to separate downloads', e?.message || e);
            await saveFiles(videoUrl, {
                username,
                sourceType,
                timestamp,
                filetype: 'mp4',
                shortcode
            });
            await saveFiles(audioUrl, {
                username,
                sourceType,
                timestamp,
                filetype: 'm4a',
                shortcode
            });
            return true;
        }
    }

    /**
     * tryHandleDashFromMediaItem
     * @description Centralized DASH handling for Media API items.
     *              Uses video_dash_manifest when present.
     *              Picks best video by resolution (height/width), then bandwidth.
     *              Audio is optional.
     *
     * @return {Promise<boolean>} true if DASH path handled it, false to let caller fallback.
     */
    async function tryHandleDashFromMediaItem({
        mediaItem,
        username,
        sourceType,
        timestamp,
        shortcode,
        isPreview,
        index
    }) {
        try {
            if (!USER_SETTING.PREFER_DASH_MANIFEST) return false;
            if (!USER_SETTING.FORCE_RESOURCE_VIA_MEDIA) return false;
            if (!mediaItem?.video_dash_manifest) return false;
            if (!mediaItem?.video_versions) return false;

            const best = parseDashManifest(mediaItem.video_dash_manifest);
            const vUrl = best?.video?.url || '';
            const aUrl = best?.audio?.url || '';

            if (!vUrl) {
                return false;
            }

            logger('[DASH]', 'best reps selected', {
                video: best.video ? { height: best.video.height, width: best.video.width, bandwidth: best.video.bandwidth, codecs: best.video.codecs } : null,
                audio: best.audio ? { bandwidth: best.audio.bandwidth, codecs: best.audio.codecs } : '(none)'
            });

            if (isPreview) {
                openNewTab(vUrl);
                return true;
            }

            if (!aUrl) {
                logger('[DASH]', 'download mode -> VIDEO-ONLY DASH (no audio rep)');
                await saveFiles(vUrl, {
                    username,
                    sourceType,
                    timestamp,
                    filetype: 'mp4',
                    shortcode,
                    index
                });
                return true;
            }

            logger('[DASH]', 'download mode -> DASH video+audio');
            await downloadDashStreams(vUrl, aUrl, username, sourceType, timestamp, shortcode);
            return true;
        } catch (e) {
            logger('[DASH]', 'tryHandleDashFromMediaItem failed -> fallback', e?.message || e);
            return false;
        }
    }

    /**
     * triggerDownload
     * @description Trigger download from Blob with filename.
     * 
     * @param {Blob} blob
     * @param {string} filename
     */
    function triggerDownload(blob, filename) {
        return new Promise(resolve => {
            const url = URL.createObjectURL(blob);

            if (USER_SETTING.USE_EXTERNAL_DOWNLOAD_MODE) {
                GM_download({
                    url: url,
                    name: filename,
                    onload: () => {
                        URL.revokeObjectURL(url);
                        resolve();
                    },
                    onerror: () => {
                        URL.revokeObjectURL(url);
                        resolve();
                    },
                });
            }
            else {
                const link = document.createElement("a");
                link.href = url;
                link.download = filename;
                link.rel = "noopener";
                link.style.display = "none";
                document.body.appendChild(link);
                link.click();
                setTimeout(() => {
                    // eslint-disable-next-line no-unused-vars
                    try { document.body.removeChild(link); } catch (e) { /* noop */ }
                    URL.revokeObjectURL(url);
                    resolve();
                }, 250);
            }
        });
    }

    /**
     * getSaveFileName
     * @description Get the file name for downloaded media according to the user settings and resource information.
     *
     * @param  {String}  downloadLink
     * @param  {Object}  metadata
     * @param  {String}  metadata.username
     * @param  {String}  metadata.sourceType
     * @param  {Integer}  metadata.timestamp
     * @param  {String}  metadata.filetype
     * @param  {String}  metadata.shortcode
     * @param  {Integer|null}  metadata.index
     * @param  {String|null}  metadata.uid
     * @return {String}  The generated filename
     */
    function getSaveFileName(downloadLink, metadata) {
        let { username, sourceType, timestamp, filetype, shortcode, index, uid } = metadata;
        timestamp = parseInt(timestamp.toString().padEnd(13, '0'));
        index = (index != null) ? index : 0;

        const date = new Date(timestamp);

        const original_name = new URL(downloadLink).pathname.split('/').at(-1).split('.').slice(0, -1).join('.');
        const year = date.getFullYear().toString();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hour = date.getHours().toString().padStart(2, '0');
        const minute = date.getMinutes().toString().padStart(2, '0');
        const second = date.getSeconds().toString().padStart(2, '0');

        var filename = state.fileRenameFormat.replace(/%([^%]+)%/g, (match, content) => {
            return `%${content.toUpperCase()}%`;
        });

        var replacements = {
            '%USERNAME%': username,
            '%SOURCE_TYPE%': sourceType,
            '%SHORTCODE%': shortcode || '',
            '%YEAR%': year,
            '%2-YEAR%': year.substr(-2),
            '%MONTH%': month,
            '%DAY%': day,
            '%HOUR%': hour,
            '%MINUTE%': minute,
            '%SECOND%': second,
            '%ORIGINAL_NAME%': original_name,
            '%ORIGINAL_NAME_FIRST%': original_name.split('_').at(0),
            '%INDEX%': index.toString(),
            '%UID%': uid || '',
        };

        // eslint-disable-next-line no-useless-escape
        filename = filename.replace(/%[\w\-]+%/g, function (str) {
            if (replacements[str] == null) {
                return str;
            }

            return replacements[str];
        });

        const originally = username + '_' + original_name + '.' + filetype;
        const downloadName = USER_SETTING.AUTO_RENAME ? filename + '.' + filetype : originally;

        return downloadName;
    }


    /**
     * createSaveFileElement
     * @description Download the specified media with link element.
     *
     * @param  {String}  downloadLink
     * @param  {Object}  object
     * @param  {Object}  metadata
     * @param  {String}  metadata.username
     * @param  {String}  metadata.sourceType
     * @param  {Integer}  metadata.timestamp
     * @param  {String}  metadata.filetype
     * @param  {String}  metadata.shortcode
     * @param  {Integer|null}  metadata.index
     * @param  {String|null}  metadata.uid
     * @return {void}
     */
    async function createSaveFileElement(downloadLink, object, metadata) {
        let { username, sourceType, filetype, shortcode } = metadata;

        if (metadata.uid == null) {
            username = metadata.username;
            if (!userIdCache.has(username)) {
                userIdCache.set(username, getUserId(username));
            }
            try {
                const userInfo = await userIdCache.get(username);
                metadata.uid = userInfo?.user?.id ?? null;
                // eslint-disable-next-line no-unused-vars
            } catch (err) {
                userIdCache.delete(username);
                metadata.uid = null;
            }
        }

        const downloadName = getSaveFileName(downloadLink, metadata);

        if (
            USER_SETTING.MODIFY_RESOURCE_EXIF &&
            filetype === 'jpg' &&
            shortcode &&
            sourceType === 'photo' &&
            (object.type === 'image/jpeg' || object.type === 'image/webp')
        ) {
            try {
                const newBlob = await changeExifData(object, metadata);
                await triggerDownload(newBlob, downloadName);
            } catch (err) {
                console.error('Failed to strip EXIF and/or attach post URL to EXIF.', err);
                await triggerDownload(object, downloadName);
            }
            return;
        }
        else {
            await triggerDownload(object, downloadName);
        }
    }

    /**
     * changeExifData
     * @description Strips EXIF metadata and attaches post URLs to the EXIF of downloaded image resources.
     *
     * @param  {Object}  blob
     * @param  {Object}  metadata
     * @param  {String}  metadata.username
     * @param  {String}  metadata.sourceType
     * @param  {Integer}  metadata.timestamp
     * @param  {String}  metadata.filetype
     * @param  {String}  metadata.shortcode
     * @param  {Integer|null}  metadata.index
     * @param  {String}  metadata.uid
     * @return {Blob}
     */
    async function changeExifData(blob, metadata) {
        const concat = (...arr) => {
            const len = arr.reduce((s, a) => s + a.length, 0);
            const out = new Uint8Array(len);
            let p = 0;
            for (const a of arr) {
                out.set(a, p);
                p += a.length;
            }
            return out;
        };
        const u32le = v => {
            const b = new Uint8Array(4);
            new DataView(b.buffer).setUint32(0, v, true);
            return b;
        };
        const u16le = v => {
            const b = new Uint8Array(2);
            new DataView(b.buffer).setUint16(0, v, true);
            return b;
        };
        const enc = s => new TextEncoder().encode(s);
        const encUtf16le = s => {
            const out = new Uint8Array(s.length * 2);
            for (let i = 0; i < s.length; i++) {
                const code = s.charCodeAt(i);
                out[i * 2] = code & 0xFF;
                out[i * 2 + 1] = (code >> 8) & 0xFF;
            }
            return out;
        };
        const formatExifDate = ts => {
            let parsed = Number(ts);
            if (!Number.isFinite(parsed)) {
                parsed = Date.now();
            }
            if (parsed < 1e12) {
                parsed *= 1000;
            }

            const date = new Date(parsed);
            if (Number.isNaN(date.getTime())) {
                return '1970:01:01 00:00:00';
            }

            const y = String(date.getFullYear()).padStart(4, '0');
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            const hh = String(date.getHours()).padStart(2, '0');
            const mm = String(date.getMinutes()).padStart(2, '0');
            const ss = String(date.getSeconds()).padStart(2, '0');
            return `${y}:${m}:${d} ${hh}:${mm}:${ss}`;
        };
        const makeIFDEntry = (tag, type, count, valueOrOffset) =>
            concat(u16le(tag), u16le(type), u32le(count), u32le(valueOrOffset));
        const fourCC = (dv, o) =>
            String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

        const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
        const isJPEG = head[0] === 0xFF && head[1] === 0xD8;
        const isWEBP = head.length >= 12 &&
            String.fromCharCode(...head.subarray(0, 4)) === 'RIFF' &&
            String.fromCharCode(...head.subarray(8, 12)) === 'WEBP';
        if (!isJPEG && !isWEBP) throw new Error('Not a JPEG or WEBP');

        const exifDateString = `${formatExifDate(metadata.timestamp)}\0`;
        const username = `${(metadata.username || 'unknown').toString()}\0`;
        const url = `https://www.instagram.com/p/${metadata.shortcode}/`;
        const commentUrl = `https://www.instagram.com/uid/${metadata.uid || 'unknown'}`;

        const dateBytes = enc(exifDateString);
        const artistBytes = enc(username);
        const keywordBytes = encUtf16le(`${url}\0`);
        const xpCommentBytes = encUtf16le(`${commentUrl}\0`);

        const exifPrefix = enc('Exif\0\0');
        const tiffHeader = Uint8Array.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]);

        const ifd0Count = 4;
        const exifIfdCount = 1;

        const ifd0Size = 2 + (ifd0Count * 12) + 4;
        const exifIfdOffset = 8 + ifd0Size;
        const exifIfdSize = 2 + (exifIfdCount * 12) + 4;
        const dataStartOffset = 8 + ifd0Size + exifIfdSize;

        const artistOffset = dataStartOffset;
        const keywordOffset = artistOffset + artistBytes.length;
        const xpCommentOffset = keywordOffset + keywordBytes.length;
        const dateOffset = xpCommentOffset + xpCommentBytes.length;

        const ifd0 = concat(
            u16le(ifd0Count),
            makeIFDEntry(0x013B, 2, artistBytes.length, artistOffset),                 // Artist
            makeIFDEntry(0x8769, 4, 1, exifIfdOffset),                                 // Exif Offset
            makeIFDEntry(0x9C9C, 1, xpCommentBytes.length, xpCommentOffset),           // XPComment
            makeIFDEntry(0x9C9E, 1, keywordBytes.length, keywordOffset),               // XPKeywords
            u32le(0)
        );

        const exifIfd = concat(
            u16le(exifIfdCount),
            makeIFDEntry(0x9003, 2, dateBytes.length, dateOffset),
            u32le(0)
        );

        const tiffBody = concat(tiffHeader, ifd0, exifIfd, artistBytes, keywordBytes, xpCommentBytes, dateBytes);

        if (isJPEG) {
            const ab = await blob.arrayBuffer();
            const dv = new DataView(ab);
            const app1Body = concat(exifPrefix, tiffBody);
            const app1Header = new Uint8Array(4);
            new DataView(app1Header.buffer).setUint16(0, 0xFFE1);
            new DataView(app1Header.buffer).setUint16(2, app1Body.length + 2);
            const newAPP1 = concat(app1Header, app1Body);

            const parts = [new Uint8Array(ab, 0, 2)];
            let off = 2,
                added = false;
            while (off < dv.byteLength) {
                const marker = dv.getUint16(off);
                if ((marker & 0xFF00) !== 0xFF00) break;
                if (marker === 0xFFDA) {
                    if (!added) parts.push(newAPP1);
                    parts.push(new Uint8Array(ab, off));
                    break;
                }
                const len = dv.getUint16(off + 2) + 2;
                if (marker === 0xFFE1) {
                    off += len;
                    continue;
                }
                parts.push(new Uint8Array(ab, off, len));
                off += len;
            }
            const total = parts.reduce((s, a) => s + a.length, 0);
            const out = new Uint8Array(total);
            let p = 0;
            parts.forEach(a => {
                out.set(a, p);
                p += a.length;
            });
            return new Blob([out], {
                type: 'image/jpeg'
            });
        }

        const ab = await blob.arrayBuffer();
        const dv = new DataView(ab);
        const chunks = [];
        let vp8xIdx = -1;
        let offset = 12;
        while (offset < dv.byteLength) {
            const cc = fourCC(dv, offset);
            const sz = dv.getUint32(offset + 4, true);
            const pad = sz & 1;
            const full = 8 + sz + pad;
            if (cc !== 'EXIF' && cc !== 'XMP ') {
                chunks.push(new Uint8Array(ab, offset, full));
                if (cc === 'VP8X') vp8xIdx = chunks.length - 1;
            }
            offset += full;
        }
        let exifChunk = concat(
            enc('EXIF'),
            u32le(exifPrefix.length + tiffBody.length),
            exifPrefix,
            tiffBody
        );
        if (exifChunk.length & 1) exifChunk = concat(exifChunk, Uint8Array.of(0));
        if (vp8xIdx !== -1) {
            const vp8x = new Uint8Array(chunks[vp8xIdx]);
            vp8x[8] |= 0x10;
            chunks[vp8xIdx] = vp8x;
            chunks.splice(vp8xIdx + 1, 0, exifChunk);
        } else {
            chunks.push(exifChunk);
        }
        const payload = chunks.reduce((s, c) => s + c.length, 0);
        const riffHeader = concat(enc('RIFF'), u32le(payload + 4), enc('WEBP'));
        const finalBuf = concat(riffHeader, ...chunks);
        return new Blob([finalBuf], {
            type: 'image/webp'
        });
    }

    /**
     * triggerLinkElement
     * @description Trigger the link element to start downloading or previewing the resource.
     *
     * @param  {Object}   element     - The element containing resource link metadata.
     * @param  {Boolean}  [isPreview] - True to preview in a new tab instead of downloading.
     * @return {void}
     */
    async function triggerLinkElement($element, isPreview = false) {
        try {
            const $el = $($element);

            let date = new Date().getTime();
            let timestamp = Math.floor(date / 1000);
            let username = $el.data('username') ? $el.data('username') : state.GL_username;
            let index = parseInt($el.attr('data-globalindex') || 0, 10) || 0;

            if (!username && $el.data('path')) {
                logger('catching owner name from shortcode', $el.data('href'));
                username = await getPostOwner($el.data('path')).catch(err => {
                    logger('get username failed, replace with default string, error message', err?.message);
                    return null;
                });
            }

            if (username == null) username = 'NONE';

            if (USER_SETTING.RENAME_PUBLISH_DATE && $el.attr('datetime')) {
                timestamp = parseInt($el.attr('datetime'), 10) || timestamp;
            }

            const mediaId = $el.attr('media-id') || $el.attr('data-media-id') || null;
            const sourceType = $el.data('name');
            const filetype = $el.data('type') || 'jpg';
            const shortcode = $el.data('path');
            const href = $el.data('href');

            const downloadOnly = !isPreview;

            if (!isPreview && index < 0) {
                alert(_i18n('NO_CHECK_RESOURCE'));
                return;
            }

            if (USER_SETTING.PREFER_DASH_MANIFEST && state.GL_mediaDataCache[mediaId]) {
                logger('Video Dash Stream, Processing video with DASH manifest', 'mediaId', mediaId);

                const handled = await tryHandleDashFromMediaItem(
                    state.GL_mediaDataCache[mediaId],
                    username,
                    sourceType,
                    timestamp,
                    shortcode,
                    downloadOnly ? false : isPreview,
                    index
                );

                if (handled) return;
            }

            if (USER_SETTING.CAPTURE_IMAGE_VIA_MEDIA_CACHE) {
                const cached = getImageFromCache(mediaId);

                if (cached && filetype !== 'mp4') {
                    if (!downloadOnly && isPreview) {
                        openNewTab(cached);
                    } else {
                        await saveFiles(cached, {
                            username,
                            sourceType,
                            timestamp,
                            filetype: filetype || 'jpg',
                            shortcode,
                            index
                        });
                    }
                    return;
                }
            }

            if (USER_SETTING.FORCE_RESOURCE_VIA_MEDIA && mediaId) {
                updateLoadingBar(true);
                let result = await getMediaInfo(mediaId);
                updateLoadingBar(false);

                if (result?.status === 'ok') {
                    let resource_url = null;
                    // OPTIMIZATION: cache result.items[0]
                    const mediaItem = result.items?.[0];

                    if (mediaItem?.video_versions?.length) {
                        resource_url = mediaItem.video_versions[0].url;
                    } else if (mediaItem?.image_versions2?.candidates?.length) {
                        mediaItem.image_versions2.candidates.sort(function (a, b) {
                            let aSTP = new URL(a.url).searchParams.get('stp');
                            let bSTP = new URL(b.url).searchParams.get('stp');

                            if (aSTP && bSTP) {
                                if (aSTP.length > bSTP.length) return 1;
                                if (aSTP.length < bSTP.length) return -1;
                            } else {
                                if ((a.width || 0) > (b.width || 0)) return 1;
                                if ((a.width || 0) < (b.width || 0)) return -1;
                            }

                            return 0;
                        });

                        resource_url = mediaItem.image_versions2.candidates[0].url;
                    }

                    if (!resource_url) {
                        alert('Cannot find download URL.');
                        return;
                    }

                    if (!downloadOnly && isPreview) {
                        openNewTab(replaceSameOriginHost(resource_url));
                    } else {
                        await saveFiles(resource_url, {
                            username,
                            sourceType,
                            timestamp,
                            filetype,
                            shortcode,
                            index
                        });
                    }
                    return;
                }

                if (USER_SETTING.FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED && href) {
                    if (!downloadOnly && isPreview) {
                        openNewTab(replaceSameOriginHost(href));
                    } else {
                        await saveFiles(href, {
                            username,
                            sourceType,
                            timestamp,
                            filetype,
                            shortcode,
                            index
                        });
                    }
                    return;
                }

                alert(`Fetch failed from Media API. API response message: ${result?.message}`);
                logger(result);
                return;
            }

            if (href) {
                if (!downloadOnly && isPreview) {
                    openNewTab(replaceSameOriginHost(href));
                } else {
                    await saveFiles(href, {
                        username,
                        sourceType,
                        timestamp,
                        filetype,
                        shortcode,
                        index
                    });
                }
                return;
            }

            alert('Cannot find download URL.');
        } catch (err) {
            console.error('Occur error in triggerLinkElement:', err);
            logger('Occur error in triggerLinkElement:', err);
        }
    }

    /**
     * replaceSameOriginHost
     * @description Replace the host of the URL to bypass the same-origin policy for certain video resources that cannot be downloaded directly.
     *
     * @param  {string}  url
     * @return {string}
     */
    function replaceSameOriginHost(url) {
        // replace https://instagram.ftpe8-2.fna.fbcdn.net/ to https://scontent.cdninstagram.com/ becase of same origin policy (some video)
        var urlObj = new URL(url);
        urlObj.host = 'scontent.cdninstagram.com';

        return urlObj.href;
    }

    /**
     * openNewTab
     * @description Open URL in new tab.
     *
     * @param  {String}  link
     * @return {void}
     */
    function openNewTab(link) {
        if (typeof link !== 'string' || !link.trim()) return;

        try {
            if (typeof GM_openInTab === 'function') {
                GM_openInTab(link, { active: true, insert: true });
            } else {
                const a = document.createElement('a');
                a.href = link;
                a.target = '_blank';
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        } catch (err) {
            logger('GM_openInTab failed; using anchor fallback', err);
            const a = document.createElement('a');
            a.href = link;
            a.target = '_blank';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
        }

        setTimeout(() => { updateLoadingBar(false); }, 125);
    }

    /**
     * reloadScript
     * @description Re-register main timer.
     *
     * @return {void}
     */
    function reloadScript() {
        clearInterval(state.GL_repeat);

        // OPTIMIZATION: use cached $body and combine .off() calls
        $body.off('.igMediaPost');
        state.bodyEventsRegistered = false;

        $('.button_wrapper').remove();
        $('.IG_DWPROFILE, .IG_DWPROFILE, .IG_DWSTORY, .IG_DWSTORY_ALL, .IG_DWSTORY_THUMBNAIL, .IG_DWSTORY_POSITION, .IG_DWNEWTAB, .IG_DWHISTORY, .IG_DWHISTORY_ALL, .IG_DWHINEWTAB, .IG_DWHISTORY_THUMBNAIL, .IG_DWHISTORY_POSITION, .IG_REELS, .IG_REELS_NEWTAB, .IG_REELS_THUMBNAIL').remove();
        $('[data-snig]').removeAttr('data-snig');

        state.pageLoaded = false;
        state.firstStarted = false;
        state.currentURL = location.href;
        state.GL_observer?.disconnect();

        logger('main timer re-register completed');
    }

    /**
     * logger
     * @description Event record.
     *
     * @return {void}
     */
    function logger(...messages) {
        var dd = new Date();
        state.GL_logger.push({
            time: dd.getTime(),
            content: [...messages]
        });

        if (state.GL_logger.length > 1000) {
            state.GL_logger = [{
                time: dd.getTime(),
                content: ['logger sliced']
            }, ...state.GL_logger.slice(-999)];
        }

        console.log(`[${dd.toISOString()}]`, ...messages);
    }

    /**
     * initSettings
     * @description Initialize preferences.
     *
     * @return {void}
     */
    function initSettings() {
        for (let name in USER_SETTING) {
            if (GM_getValue(name) != null && typeof GM_getValue(name) === 'boolean') {
                USER_SETTING[name] = GM_getValue(name);

                if (name === "MODIFY_VIDEO_VOLUME" && GM_getValue(name) !== true) {
                    state.videoVolume = 1;
                }
            }
        }
    }


    /**
     * toggleVolumeSilder
     * @description Toggle display of custom volume slider.
     *
     * @param  {object}  $videos
     * @param  {object}  $buttonParent
     * @param  {string}  loggerType
     * @param  {string}  customClass
     * @return {void}
     */
    function toggleVolumeSilder($videos, $buttonParent, loggerType, customClass = "") {
        // OPTIMIZATION: cache the volume_slider lookup
        let $existingSlider = $buttonParent.find('div.volume_slider');
        if ($existingSlider.length === 0) {
            $buttonParent.append(`<div class="volume_slider ${customClass}" />`);
            const $newSlider = $buttonParent.find('div.volume_slider');
            $newSlider.append(`<div><input type="range" max="1" min="0" step="0.05" value="${state.videoVolume}" /></div>`);
            const $sliderInput = $newSlider.find('input');
            $sliderInput.attr('style', `--ig-track-progress: ${(state.videoVolume * 100) + '%'}`);
            $sliderInput.on('input', function () {
                const $this = $(this);
                var percent = ($this.val() * 100) + '%';

                state.videoVolume = $this.val();
                GM_setValue('G_VIDEO_VOLUME', $this.val());

                $this.attr('style', `--ig-track-progress: ${percent}`);

                $videos.each(function () {
                    logger(`(${loggerType})`, 'video volume changed #slider');
                    this.volume = state.videoVolume;
                });
            });

            $sliderInput.on('mouseenter', function () {
                const $this = $(this);
                var percent = (state.videoVolume * 100) + '%';
                $this.attr('style', `--ig-track-progress: ${percent}`);
                $this.val(state.videoVolume);


                $videos.each(function () {
                    logger(`(${loggerType})`, 'video volume changed #slider');
                    this.volume = state.videoVolume;
                });
            });

            $newSlider.on('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
            });
        }
        else {
            $existingSlider.remove();
        }
    }

    /**
     * @description Trigger React onClick event handler for the given element.
     * @param {HTMLElement} el 
     */
    function triggerReactClickHandler(el) {
        const reactKey = Object.keys(el).find(k => k.startsWith('__reactProps') || k.startsWith('__reactEventHandlers'));
        const props = el[reactKey];

        if (props && typeof props.onClick === 'function') {
            const mockEvent = {
                target: el,
                currentTarget: el,
                preventDefault: () => { },
                stopPropagation: () => { },
                nativeEvent: new MouseEvent('click')
            };

            props.onClick(mockEvent);
        } else {
            logger('No React click handler found for the element:', el);
        }
    };

    // /**
    //  * @description Get the element at the pointer position and check if it is the target element or if it is covered by another element.
    //  * @param {JQuery<HTMLElement>} $target 
    //  * @param {number} clientX
    //  * @param {number} clientY
    //  */
    // export function getPointerElement($target, clientX, clientY) {
    //     let element = $target.get(0);
    //     const rect = element.getBoundingClientRect();

    //     const viewportWidth = window.innerWidth;
    //     const viewportHeight = window.innerHeight;

    //     const visibleX = Math.max(rect.left, 0) + (Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)) / 2;
    //     const visibleY = Math.max(rect.top, 0) + (Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)) / 2;

    //     if (visibleX < 0 || visibleX > viewportWidth || visibleY < 0 || visibleY > viewportHeight) {
    //         if (clientX == null || clientY == null) {
    //             return { self: false, topElement: null, target: $target, error: 'out_of_viewport', rect };
    //         }
    //     }

    //     const topElement = document.elementFromPoint(clientX || visibleX, clientY || visibleY);

    //     if ($(topElement).height() > document.body.clientHeight) {
    //         return { self: false, topElement: null, target: $target, error: 'oversize_element', rect };
    //     }

    //     if ($(topElement).width() < 100 || $(topElement).height() < 100) {
    //         return { self: false, topElement: null, target: $target, error: 'small_element', rect };
    //     }

    //     if (topElement && topElement !== element && !element.contains(topElement)) {
    //         if ($(topElement).find($target).length > 0) {
    //             // return { self: false, topElement, target: $target };
    //             return { self: false, topElement: null, target: $target, error: 'covered_by_element', rect };
    //         }

    //         if ($(topElement).width() != $target.width() || $(topElement).height() != $target.height()) {
    //             return { self: false, topElement: null, target: $target, error: 'different_dimensions', rect };
    //         }


    //         // return { self: false, topElement: null, target: $target, error: 'none_of_element', rect };
    //         return { self: false, topElement, target: $target };
    //     } else {
    //         return { self: true, topElement, target: $target };
    //     }
    // }

    /**
     * updatePopupSelectionSummary
     * @description Update selection summary in popup dialog.
     *
     * @param {string|JQuery} root
     * @return {void}
     */
    function updatePopupSelectionSummary(root = '.IG_POPUP_DIG') {
        const $root = (typeof root === 'string') ? $(root) : root;
        if (!$root || $root.length === 0) return;

        const $titleCheckbox = $root.find('.IG_POPUP_DIG_TITLE .checkbox');
        const $countSpan = $titleCheckbox.find('.item-count');
        if ($titleCheckbox.length === 0 || $countSpan.length === 0) return;

        const $items = $root.find('.IG_POPUP_DIG_BODY .inner_box');
        const total = $items.length;
        const selected = $items.filter(':checked').length;

        $titleCheckbox.find('input').prop('checked', total > 0 && selected === total);

        $countSpan.text(`${selected} / ${total}`);
        $root.toggleClass('igdm-single', total === 1);
        $root.find('#batch_download_selected').prop('disabled', selected === 0 || $root.find('#_SNLOAD').length > 0);
        $root.find('#batch_download_direct').text(total === 1 ? 'Download' : 'Download all');
    }

    /**
     * IG_createDM
     * @description A dialog showing a list of all media files in the post.
     *
     * @param  {Boolean}  hasHidden
     * @param  {Boolean}  hasCheckbox
     * @return {void}
     */
    function IG_createDM(hasHidden, hasCheckbox) {
        const isHidden = hasHidden ? "hidden" : "";
        const pickerClass = hasCheckbox ? " igdm-picker" : "";
        $body.append('<div class="IG_POPUP_DIG' + pickerClass + ' ' + isHidden + '"><div class="IG_POPUP_DIG_BG"></div><div class="IG_POPUP_DIG_MAIN"><div class="IG_POPUP_DIG_TITLE"></div><div class="IG_POPUP_DIG_BODY"></div></div></div>');
        const $popup = $('.IG_POPUP_DIG').last();
        const $title = $popup.find('.IG_POPUP_DIG_TITLE');

        if (hasCheckbox) {
            $title.append('<div class="igdm-header"><div><h2 class="igdm-title">Download media</h2><div id="post_info">Post <span id="article-id"></span></div></div><button type="button" class="IG_POPUP_DIG_BTN" aria-label="Close" title="Close">' + SVG.CLOSE + '</button></div>');
            $title.append('<div class="igdm-selection"><label class="checkbox"><input value="yes" type="checkbox" /><span data-ih-locale="ALL_CHECK">' + _i18n('ALL_CHECK') + '</span><span class="item-count">0 / 0</span></label></div>');
            const $actions = $('<div id="button_group" class="igdm-actions"></div>');
            $actions.append('<button type="button" id="batch_download_selected" disabled>Download selected</button>');
            $actions.append('<button type="button" id="batch_download_direct" disabled>Download all</button>');
            $popup.find('.IG_POPUP_DIG_MAIN').append($actions);
        }
        else {
            $title.append('<div style="position:relative;min-height:36px;text-align:center;margin-bottom:7px;"><div style="position:absolute;left:0;line-height:18px;"><kbd>' + getPlatformModifierKey() + '</kbd>+<kbd>Q</kbd></div><div style="line-height:18px;">Instagram tools</div><div id="post_info" style="line-height:14px;font-size:14px;"></div><div class="IG_POPUP_DIG_BTN">' + SVG.CLOSE + '</div></div>');
        }
    }

    /**
     * IG_setDM
     * @description Set a dialog status.
     *
     * @param  {Boolean}  hasHidden
     * @return {void}
     */
    function IG_setDM(hasHidden) {
        const $popup = $('.IG_POPUP_DIG');
        if ($popup.length) {
            if (hasHidden) {
                $popup.addClass("hidden");
            }
            else {
                $popup.removeClass("hidden");
            }
        }
    }


    /**
     * registerMenuCommand
     * @description Register script menu command.
     *
     * @return {void}
     */
    function registerMenuCommand() {
        for (let id of state.registerMenuIds) {
            logger('GM_unregisterMenuCommand', id);
            GM_unregisterMenuCommand(id);
        }

        state.registerMenuIds.push(GM_registerMenuCommand(_i18n('SETTING'), () => {
            showSetting();
        }, {
            accessKey: "w"
        }));

        state.registerMenuIds.push(GM_registerMenuCommand(_i18n('HOTKEY_KEY_SETTINGS_KEY'), () => {
            showHotkeySetting();
        }, {
            accessKey: "q"
        }));

        state.registerMenuIds.push(GM_registerMenuCommand(_i18n('DEBUG'), () => {
            showDebugDOM();
        }, {
            accessKey: "z"
        }));

        state.registerMenuIds.push(GM_registerMenuCommand(_i18n('RELOAD_SCRIPT'), () => {
            reloadScript();
        }, {
            accessKey: "r"
        }));
    }

    function showHotkeySetting() {
        $('.IG_POPUP_DIG').remove();
        IG_createDM();

        $('.IG_POPUP_DIG #post_info').text('Hotkey Settings');

        const $popupBody = $('.IG_POPUP_DIG .IG_POPUP_DIG_BODY');

        const hotkeyOptions = [
            { value: '87', label: 'Alt+W' },
            { value: '90', label: 'Alt+Z' },
            { value: '88', label: 'Alt+X' },
            { value: '68', label: 'Alt+D' },
            { value: '75', label: 'Alt+K' },
            { value: '67', label: 'Alt+C' },
            { value: '83', label: 'Alt+S' },
            { value: '192', label: 'Alt+~' },
            { value: '49', label: 'Alt+1' },
            { value: '50', label: 'Alt+2' },
            { value: '51', label: 'Alt+3' },
            { value: '52', label: 'Alt+4' },
            { value: '53', label: 'Alt+5' }
        ];

        const hotkeyConfigs = [
            { name: 'HOTKEY_SETTINGS', key: 'HOTKEY_SETTINGS_KEY', stateKey: 'settingsHotkeyKeyCode', storageKey: 'G_HOTKEY_SETTINGS_KEYCODE', defaultKeyCode: 87 },
            { name: 'HOTKEY_KEY_SETTINGS', key: 'HOTKEY_KEY_SETTINGS_KEY', stateKey: 'keySettingsHotkeyKeyCode', storageKey: 'G_HOTKEY_KEY_SETTINGS_KEYCODE', defaultKeyCode: 67 },
            { name: 'HOTKEY_DEBUG', key: 'HOTKEY_DEBUG_KEY', stateKey: 'debugHotkeyKeyCode', storageKey: 'G_HOTKEY_DEBUG_KEYCODE', defaultKeyCode: 90 },
            { name: 'HOTKEY_DOWNLOAD_STORY', key: 'HOTKEY_DOWNLOAD_STORY_KEY', stateKey: 'downloadStoryHotkeyKeyCode', storageKey: 'G_HOTKEY_DOWNLOAD_STORY_KEYCODE', defaultKeyCode: 83 },
        ];

        function checkHotkeyConflict(keyCode, excludeStateKey) {
            for (const config of hotkeyConfigs) {
                if (config.stateKey !== excludeStateKey && state[config.stateKey] === keyCode) {
                    return true;
                }
            }
            return false;
        }

        function createHotkeySetting(name, key, stateKey, storageKey, defaultKeyCode) {
            const currentKeyCode = state[stateKey];
            const $container = $(`
                <label class="globalSettings hotkey-setting-item" data-hotkey="${name}" style="position: relative;display: flex; align-items: center; padding-right: 5px;">
                    <span>${_i18n(key)}</span>
                    <div class="hotkey-select-wrapper" style="display: flex; align-items: center; gap: 8px; justify-content: flex-end; flex: 1;">
                        <select class="hotkey-preset" data-storage="${storageKey}" data-state="${stateKey}" data-default="${defaultKeyCode}" style="padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px;">
                            ${hotkeyOptions.filter(o => o.value != defaultKeyCode.toString()).map(o => `<option value="${o.value}" ${o.value == currentKeyCode ? 'selected' : ''}>${o.label}</option>`).join('')}
                            <option value="${defaultKeyCode}" ${currentKeyCode == defaultKeyCode ? 'selected' : ''}>Alt+${String.fromCharCode(defaultKeyCode)}</option>
                        </select>
                        <button class="hotkey-reset" title="${_i18n('HOTKEY_RESET')}" style="padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; color: #1f1f1f; background: #fff; cursor: pointer;">${_i18n('HOTKEY_RESET')}</button>
                    </div>
                    <div class="hotkey-conflict-warning" style="pointer-events: none; position: absolute; bottom: -10px; display: none; font-size: 11px; color: #e74c3c;">▲ ${_i18n('HOTKEY_CONFLICT_WARNING')}</div>
                </label>
            `);

            $container.find('.hotkey-reset').on('click', function () {
                const $preset = $container.find('.hotkey-preset');
                const defaultCode = parseInt($preset.data('default'));
                const stateKeyName = $preset.data('state');
                const storage = $preset.data('storage');

                state[stateKeyName] = defaultCode;
                GM_setValue(storage, defaultCode);
                $preset.val(defaultCode);
                $container.find('.hotkey-conflict-warning').hide();
            });

            $container.find('.hotkey-preset').on('change', function () {
                const $this = $(this);
                const val = $this.val();
                const storage = $this.data('storage');
                const stateKeyName = $this.data('state');
                const defaultCode = parseInt($this.data('default'));
                const keyCode = parseInt(val);

                if (checkHotkeyConflict(keyCode, stateKeyName)) {
                    state[stateKeyName] = defaultCode;
                    GM_setValue(storage, defaultCode);
                    $this.val(defaultCode);
                    $container.find('.hotkey-conflict-warning').show().delay(2000).fadeOut(500);
                } else {
                    state[stateKeyName] = keyCode;
                    GM_setValue(storage, keyCode);
                    $container.find('.hotkey-conflict-warning').hide();
                }
            });

            return $container;
        }

        $popupBody.append('<span style="display: block; margin-bottom: 15px;" class="hotkey-settings-container"></span>');
        const $container = $popupBody.find('.hotkey-settings-container');

        hotkeyConfigs.forEach((config) => {
            $container.append(
                createHotkeySetting(config.name, config.key, config.stateKey, config.storageKey, config.defaultKeyCode)
            );
        });
    }

    /**
     * showSetting
     * @description Show script settings window.
     *
     * @return {void}
     */
    function showSetting() {
        $('.IG_POPUP_DIG').remove();
        IG_createDM();

        $('.IG_POPUP_DIG #post_info').text('Preference Settings');
        $('.IG_POPUP_DIG .IG_POPUP_DIG_TITLE > div')
            .append(`
                <select id="langSelect"></select>
            `);

        // OPTIMIZATION: cache the lang select once
        const $langSelect = $('#langSelect');
        for (const o in locale_manifest) {
            $langSelect.append(
                `<option value="${o}" ${(state.lang === o) ? 'selected' : ''}>${locale_manifest[o]}</option>`
            );
        }

        const $popupBody = $('.IG_POPUP_DIG .IG_POPUP_DIG_BODY');

        for (const name in USER_SETTING) {
            $popupBody.append(`
                <label class="globalSettings"
                       title="${_i18n(name + '_INTRO')}"
                       data-ih-locale-title="${name + '_INTRO'}">

                    <span data-ih-locale="${name}">${_i18n(name)}</span>
                    <input id="${name}" value="box" type="checkbox"
                           ${USER_SETTING[name] === true ? 'checked' : ''}>
                    <div class="chbtn"><div class="rounds"></div></div>
                </label>`
            );

            if (name === 'MODIFY_VIDEO_VOLUME') {
                $popupBody.find(`input[id="${name}"]`).parent('label').on('contextmenu', function (e) {
                    e.preventDefault();
                    const $this = $(this);
                    if (!$this.find('#tempWrapper').length) {
                        $this.append('<div id="tempWrapper"></div>')
                            .children('#tempWrapper')
                            .append(`<input value="${state.videoVolume}" type="range" min="0" max="1" step="0.05" />`)
                            .append(`<input value="${state.videoVolume}" step="0.05" type="number" />`)
                            .append(`<div class="IG_POPUP_DIG_BTN">${SVG.CLOSE}</div>`);
                    }
                });
            }

            if (name === 'AUTO_RENAME') {
                $popupBody.find(`input[id="${name}"]`).parent('label').on('contextmenu', function (e) {
                    e.preventDefault();
                    const $this = $(this);
                    if (!$this.find('#tempWrapper').length) {
                        $this.append('<div id="tempWrapper"></div>')
                            .children('#tempWrapper')
                            .append(`<input id="date_format" value="${state.fileRenameFormat}" />`)
                            .append(`<div class="IG_POPUP_DIG_BTN">${SVG.CLOSE}</div>`);
                    }
                });
            }
        }


        arrangeSettingHierarchy();
    }

    /**
     * arrangeSettingHierarchy
     * @description Arrange specific settings under the corresponding setting. 
     *
     * @return {void}
     */
    function arrangeSettingHierarchy() {
        Object.entries(PARENT_CHILD_MAPPING).forEach(([parent, children]) => {

            let $prev = $(`.IG_POPUP_DIG .IG_POPUP_DIG_BODY input#${parent}`).closest('label');

            children.forEach(child => {
                const $childLbl = $(`.IG_POPUP_DIG .IG_POPUP_DIG_BODY input#${child}`).closest('label').detach();
                $childLbl.addClass("child");
                $prev.after($childLbl);
                $prev = $childLbl;
            });
        });
    }

    /**
     * showDebugDOM
     * @description Show full DOM tree.
     *
     * @return {void}
     */
    function showDebugDOM() {
        $('.IG_POPUP_DIG').remove();
        IG_createDM();
        $('.IG_POPUP_DIG #post_info').text('IG Debug DOM Tree');

        // OPTIMIZATION: cache popup body
        const $popupBody = $('.IG_POPUP_DIG .IG_POPUP_DIG_BODY');
        $popupBody.append(`<textarea style="font-family: monospace;width:100%;box-sizing: border-box;height:300px;background: transparent;" readonly></textarea>`);
        $popupBody.append(`<span style="display:block;text-align:center;">`);
        const $span = $popupBody.find('span').last();
        $span.append(`<button style="margin: 3px;" class="IG_DISPLAY_DOM_TREE"><a>${_i18n('SHOW_DOM_TREE')}</a></button>`);
        $span.append(`<button style="margin: 3px;" class="IG_SELECT_DOM_TREE"><a>${_i18n('SELECT_AND_COPY')}</a></button>`);
        $span.append(`<button style="margin: 3px;" class="IG_DOWNLOAD_DOM_TREE"><a>${_i18n('DOWNLOAD_DOM_TREE')}</a></button><br/>`);
        $span.append(`<button style="margin: 3px;" class="IG_REPORT_GITHUB"><a href="https://github.com/karpuzikov/userscripts/issues" target="_blank">${_i18n('REPORT_GITHUB')}</a></button>`);
    }

    var detectMovingViewerTimer = null;

    function openImageViewer(imageUrl) {
        removeImageViewer();

        $body.append(
            `<div id="imageViewer">
    	<div id="iv_header">
    		<div style="flex:1;">Image Viewer</div>
    		<div style="display: flex;filter: invert(1);gap: 8px;margin-right: 8px;">
                <div id="rotate_left" style="cursor: pointer;">${SVG.TURN_DEG}</div>
                <div id="rotate_right" style="transform: scaleX(-1);cursor: pointer;">${SVG.TURN_DEG}</div>
            </div>
    		<div id="iv_close">${SVG.CLOSE}</div>
    	</div>
        <section>
            <div id="iv_transform">
                <div id="iv_rotate">
                    <img id="iv_image" src="" />
                </div>
            </div>
        </section>
    </div>`);

        const $container = $('#imageViewer');
        const $section = $('#imageViewer > section');
        const $wrapT = $('#iv_transform');
        const $wrapR = $('#iv_rotate');
        const $header = $('#iv_header');
        const $closeIcon = $('#iv_close');
        const $image = $('#iv_image');
        const $rotateLeft = $('#rotate_left');
        const $rotateRight = $('#rotate_right');

        $image.attr('src', imageUrl);
        $container.css('display', 'flex');
        $wrapT.css('transform-origin', '0 0');
        $wrapT.css('transition', `transform 0.15s ease`);
        $wrapR.css('transform-origin', 'center');
        $wrapR.css('transition', `transform 0.15s ease`);
        $wrapT.css('will-change', 'transform');
        $wrapR.css('will-change', 'transform');

        let rotate = 0;
        let scale = 1;
        let posX = 0, posY = 0;
        let isDragging = false;
        let isMovingPhoto = false;
        let startX, startY;
        var previousPosition = {
            x: 0,
            y: 0
        };

        detectMovingViewerTimer = setInterval(() => {
            const currentPosition = {
                x: posX,
                y: posY
            };
            if (currentPosition.x !== previousPosition.x || currentPosition.y !== previousPosition.y) {
                isMovingPhoto = true;
            } else {
                isMovingPhoto = false;
            }
            previousPosition = currentPosition;
        }, 100);


        $image.on('load', () => {
            posX = 0;
            posY = 0;
            updateImageStyle();
        });

        $image.on('dragstart drop', (e) => {
            e.preventDefault();
        });

        $image.on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!isMovingPhoto) {
                if (scale <= 1) {
                    makeZoomAction(e, Math.min(Math.max(1, scale + 1.25), 5));
                }
                else {
                    scale = 1;
                    posX = 0;
                    posY = 0;
                }

                updateImageStyle();
            }
        });

        $section.on('wheel', (e) => {
            e.preventDefault();
            makeZoomAction(e);
        });

        $container.on('wheel', (e) => {
            e.preventDefault();
        });

        $image.on('mousedown', (e) => {
            if (scale == 1) return;

            isDragging = true;

            startX = e.pageX - posX;
            startY = e.pageY - posY;
            $image.css('cursor', 'grabbing');
        });

        $image.on('mouseup', () => {
            if (scale == 1) return;

            isDragging = false;
            $image.css('cursor', 'grab');
        });

        $rotateLeft.on('click', function () {
            rotate -= 90;
            updateImageStyle();
        });

        $rotateRight.on('click', function () {
            rotate += 90;
            updateImageStyle();
        });

        $(document).on('mousemove.igMedia', (e) => {
            if (!isDragging) return;
            e.preventDefault();

            posX = e.pageX - startX;
            posY = e.pageY - startY;

            updateImageStyle();
        });

        $container.on('click', () => {
            removeImageViewer();
        });

        $closeIcon.on('click', () => {
            removeImageViewer();
        });

        $header.on('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        function updateImageStyle() {
            $wrapT.css('transition', isMovingPhoto ? "none" : `transform 0.15s ease`);
            $wrapT.css('transform', `translate(${posX}px, ${posY}px) scale(${scale})`);
            $wrapR.css('transform', `rotate(${rotate}deg)`);

            if (scale == 1) {
                $image.css('cursor', 'zoom-in');
            }
            else {
                $image.css('cursor', 'grabbing');
            }
        }


        function makeZoomAction(e, newScale) {
            e.preventDefault();

            let prevScale = scale;

            // newScale should be null when passing by wheel event
            if (newScale == null) {
                let factor = 0.1;
                let delta = e.originalEvent.deltaY < 0 ? 1 : -1;
                scale = Math.min(5, Math.max(1, scale + delta * factor * scale));
            }
            else {
                scale = newScale;
            }


            let rect = $section[0].getBoundingClientRect();
            let mx = e.clientX - rect.left;
            let my = e.clientY - rect.top;

            let zoomTargetX = (mx - posX) / prevScale;
            let zoomTargetY = (my - posY) / prevScale;

            posX = -zoomTargetX * scale + mx;
            posY = -zoomTargetY * scale + my;

            updateImageStyle();
        }
    }

    function removeImageViewer() {
        clearInterval(detectMovingViewerTimer);
        $('#imageViewer').remove();
        $(document).off('mousemove.igMedia');
    }

    let mediaCacheDirty = false;
    let mediaCacheSaveTimer = null;

    /**
     * purgeCache
     * @description Purge image cache entries older than 12 hours.
     *
     * @return {void}
     */
    function purgeCache() {
        const now = Date.now();
        for (const id in state.GL_imageCache) {
            if ((now - state.GL_imageCache[id].ts) > IMAGE_CACHE_MAX_AGE) delete state.GL_imageCache[id];
        }
        GM_setValue(IMAGE_CACHE_KEY, state.GL_imageCache);
    }


    /**
     * mediaIdFromURL
     * @description Decode mediaId from ig_cache_key parameter that Instagram includes in the URL.
     *
     * @param  {string}  url
     * @return {?string}
     */
    function mediaIdFromURL(url) {
        try {
            const u = new URL(url);
            const key = u.searchParams.get('ig_cache_key');
            if (!key) return null;
            const b64 = key.split('.')[0];          // Part before “.3-ccb7…”
            return atob(b64);                       // e.g., “3670776772828545770”
        } catch { return null; }
    }

    /**
     * putInCache
     * @description Save URL to image cache.
     *
     * @param  {string}  mediaId
     * @param  {string}  url
     * @return {void}
     */
    function putInCache(mediaId, url) {
        if (!mediaId) return;

        const keys = Object.keys(state.GL_imageCache);
        if (keys.length >= IMAGE_MAX_CACHE_ITEMS) {
            keys.sort((a, b) => state.GL_imageCache[a].ts - state.GL_imageCache[b].ts);
            delete state.GL_imageCache[keys[0]];
        }

        mediaCacheDirty = true;
        state.GL_imageCache[mediaId] = { url, ts: Date.now() };

        if (!mediaCacheSaveTimer) {
            mediaCacheSaveTimer = setTimeout(() => {
                if (mediaCacheDirty) {
                    GM_setValue(IMAGE_CACHE_KEY, state.GL_imageCache);
                    mediaCacheDirty = false;
                }
                mediaCacheSaveTimer = null;
            }, 500); // write in script storage per 500 ms
        }
    }

    /**
     * getImageFromCache
     * @description Read image URL from cache; returns null if not found or expired.
     *
     * @param  {string}  mediaId
     * @return {?string}
     */
    function getImageFromCache(mediaId) {
        if (!mediaId) return null;
        const entry = state.GL_imageCache[mediaId];
        if (!entry) return null;
        if ((Date.now() - entry.ts) > IMAGE_CACHE_MAX_AGE) { delete state.GL_imageCache[mediaId]; return null; }
        return entry.url;
    }

    /**
     * registerPerformanceObserver
     * @description Register performance observer to document, captures any loaded image resource.
     *
     * @return {void}
     */
    function registerPerformanceObserver() {
        const perfObs = new PerformanceObserver(list => {
            if (!USER_SETTING.CAPTURE_IMAGE_VIA_MEDIA_CACHE) return;

            list.getEntries().forEach(entry => {
                if (entry.initiatorType === 'img') {
                    const u = entry.name;

                    if (
                        !(u.includes('_e35') || u.includes('_e15') || u.includes('.webp?')) ||
                        u.includes('_e35_s') ||
                        u.match(/_[sp](\d+)x\1(?!\d)/)
                    ) {
                        return;
                    }

                    const id = mediaIdFromURL(u);
                    if (id && !state.GL_imageCache[id]) putInCache(id, u);
                }
            });
        });
        perfObs.observe({ entryTypes: ['resource'] });
    }

    /**
     * translateText
     * @description i18n translation text.
     *
     * @return {void}
     */
    function translateText() {
        var eLocale = {
            "en-US": {
                "RELOAD_SCRIPT": "Reload Script",
                "IMAGE_VIEWER": "Open Image In Viewer",
                "NEW_TAB": "Open in New Tab",
                "SHOW_DOM_TREE": "Show DOM Tree",
                "SELECT_AND_COPY": "Select All and Copy from the Input Box",
                "DOWNLOAD_DOM_TREE": "Download DOM Tree as a Text File",
                "REPORT_GITHUB": "Report an Issue on GitHub",
                "DEBUG": "Debug Window",
                "CLOSE": "Close",
                "ALL_CHECK": "Select All",
                "ITEM_COUNT_SINGULAR": "%COUNT% item",
                "ITEM_COUNT_PLURAL": "%COUNT% items",
                "ITEM_POSITION": "Item %CURRENT% of %TOTAL%",
                "SELECTED_COUNT_SINGULAR": "%COUNT% selected",
                "SELECTED_COUNT_PLURAL": "%COUNT% selected",
                "BATCH_DOWNLOAD_SELECTED": "Download Selected Resources",
                "BATCH_DOWNLOAD_DIRECT": "Download All Resources",
                "IMG": "Image",
                "VID": "Video",
                "DW": "Download",
                "DW_ALL": "Download All Resources",
                "VIDEO_THUMBNAIL": "Download Video Thumbnail",
                "LOAD_BLOB_ONE": "Loading Blob Media...",
                "LOAD_BLOB_MULTIPLE": "Loading Blob Media and Others...",
                "LOAD_BLOB_RELOAD": "Detecting Blob Media, reloading...",
                "NO_CHECK_RESOURCE": "You need to select a resource to download.",
                "NO_VID_URL": "Cannot find video URL.",
                "SETTING": "Settings",
                "AUTO_RENAME": "Automatically Rename Files (Right-Click to Set)",
                "RENAME_PUBLISH_DATE": "Set Renamed File Timestamp to Resource Publish Date",
                "RENAME_LOCATE_DATE": "Modify Renamed File Timestamp Date Format (Right-Click to Set)",
                "DISABLE_VIDEO_LOOPING": "Disable Video Auto-looping",
                "HTML5_VIDEO_CONTROL": "Display HTML5 Video Controller",
                "REDIRECT_CLICK_USER_STORY_PICTURE": "Redirect When Clicking on User's Story Picture",
                "FORCE_FETCH_ALL_RESOURCES": "Force Fetch All Resources in the Post",
                "DIRECT_DOWNLOAD_VISIBLE_RESOURCE": "Directly Download the Visible Resources in the Post",
                "DIRECT_DOWNLOAD_ALL": "Directly Download All Resources in the Post",
                "DIRECT_DOWNLOAD_STORY": "Directly Download All Resources in the Story/Highlight",
                "MODIFY_VIDEO_VOLUME": "Modify Video Volume (Right-Click to Set)",
                "MODIFY_RESOURCE_EXIF": "Modify Resource EXIF Properties",
                "SCROLL_BUTTON": "Enable Scroll Buttons for Reels Page",
                "FORCE_RESOURCE_VIA_MEDIA": "Force Fetch Resource via Media API",
                "PREFER_DASH_MANIFEST": "Prefer DASH Manifest (Higher-Quality Video via Media API)",
                "FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED": "Use Alternative Methods to Download When the Media API is Not Accessible",
                "NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST": "Always Use Media API for [Open in New Tab] in Posts",
                "SKIP_VIEW_STORY_CONFIRM": "Skip the Confirmation Page for Viewing a Story/Highlight",
                "SKIP_SHARED_WITH_YOU_DIALOG": "Skip \"shared this with you\" dialog on shared profile links",
                "CAPTURE_IMAGE_VIA_MEDIA_CACHE": "Capture Image Resource Using Media Cache",
                "AUTO_RENAME_INTRO": [
                    "Auto rename file to custom format:",
                    "Custom Format List:",
                    "%USERNAME% - Username",
                    "%SOURCE_TYPE% - Download Source",
                    "%SHORTCODE% - Post Shortcode",
                    "%YEAR% - Year when downloaded/published",
                    "%2-YEAR% - Year (last two digits) when downloaded/published",
                    "%MONTH% - Month when downloaded/published",
                    "%DAY% - Day when downloaded/published",
                    "%HOUR% - Hour when downloaded/published",
                    "%MINUTE% - Minute when downloaded/published",
                    "%SECOND% - Second when downloaded/published",
                    "%ORIGINAL_NAME% - Original name of downloaded file",
                    "%ORIGINAL_NAME_FIRST% - Original name of downloaded file (first part of name)",
                    "%INDEX% - Resource index",
                    "%UID% - User account unique ID",
                    "",
                    "If set to false, the file name will remain unchanged.",
                    "Example: instagram_321565527_679025940443063_4318007696887450953_n.jpg"
                ],
                "RENAME_PUBLISH_DATE_INTRO": "Sets the timestamp in the file rename format to the resource publish date (browser time zone).\n\nThis feature only works when [Automatically Rename Files] is set to TRUE.",
                "RENAME_LOCATE_DATE_INTRO": "Modify the renamed file timestamp date format to the browser's local time, and format it to your preferred regional date format.\n\nThis feature only works when [Automatically Rename Files] is set to TRUE.",
                "DISABLE_VIDEO_LOOPING_INTRO": "Disable video auto-looping in Reels and posts.",
                "HTML5_VIDEO_CONTROL_INTRO": "Display the HTML5 video controller in video resource.\n\nThis will hide the custom video volume slider and replace it with the HTML5 controller. The HTML5 controller can be hidden by right-clicking on the video to reveal the original details.",
                "REDIRECT_CLICK_USER_STORY_PICTURE_INTRO": "Redirect to a user's profile page when right-clicking on their avatar in the story area on the homepage.\nIf you use the middle mouse button to click, it will open in a new tab.",
                "FORCE_FETCH_ALL_RESOURCES_INTRO": "Force fetching of all resources (photos and videos) in a post via the Instagram API to remove the limit of three resources per post.",
                "DIRECT_DOWNLOAD_VISIBLE_RESOURCE_INTRO": "Directly download the current resources available in the post.",
                "DIRECT_DOWNLOAD_ALL_INTRO": "When you click the download button, all resources in the post will be forcibly fetched and downloaded.",
                "MODIFY_VIDEO_VOLUME_INTRO": "Modify the video playback volume in Reels and posts (right-click to open the volume setting slider).",
                "SCROLL_BUTTON_INTRO": "Enable scroll buttons for the lower right corner of the Reels page.",
                "FORCE_RESOURCE_VIA_MEDIA_INTRO": "The Media API will try to get the highest quality photo or video possible, but it may take longer to load.",
                "PREFER_DASH_MANIFEST_INTRO": "Prefer the DASH manifest for video resources via the Media API. If a DASH manifest is available, it will download the video and audio streams SEPARATELY for the best possible quality.",
                "FALLBACK_TO_BLOB_FETCH_IF_MEDIA_API_THROTTLED_INTRO": "When the Media API reaches its rate limit or cannot be used for other reasons, the Forced Fetch API will be used to download resources (the resource quality may be slightly lower).",
                "NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST_INTRO": "The [Open in New Tab] button in posts will always use the Media API to obtain high-resolution resources.",
                "SKIP_VIEW_STORY_CONFIRM_INTRO": "Automatically skip when confirmation page is shown in story or highlight.",
                "SKIP_SHARED_WITH_YOU_DIALOG_INTRO": "Automatically click \"Not now\" on the \"X shared this with you\" dialog when opening any ?igsh= links.",
                "MODIFY_RESOURCE_EXIF_INTRO": "Modify the EXIF attribute of the image resource to include metadata such as post link, shooting date, and author.",
                "DIRECT_DOWNLOAD_STORY_INTRO": "When you click [Download All Resources], all stories/highlights are downloaded directly, without showing the image selection dialog.",
                "CAPTURE_IMAGE_VIA_MEDIA_CACHE_INTRO": "Use a watcher to capture any high-quality image URLs in the DOM tree into the script's storage so that they can be extracted when available and upon user input.",
                "HOTKEY_DEBUG_KEY": "Debug Window",
                "HOTKEY_SETTINGS_KEY": "Preference Settings",
                "HOTKEY_KEY_SETTINGS_KEY": "Hotkey Settings",
                "HOTKEY_DOWNLOAD_STORY_KEY": "Download Story",
                "HOTKEY_CONFLICT_WARNING": "This hotkey may conflict with other settings.",
                "HOTKEY_RESET": "Reset",
                "USE_EXTERNAL_DOWNLOAD_MODE": "Use External Download Mode",
                "USE_EXTERNAL_DOWNLOAD_MODE_INTRO": "Enabling this feature will cause the script to use extended download functions (such as GM_download) to download files, resolving the issue of missing files when download multiple files.\n\nPlease note: Enabling this feature may cause the file renaming function to malfunction. Please ensure that the download mode in your extended feature settings is set to Native."
            }
        };

        var resultUnsorted = Object.assign({}, eLocale, state.locale);
        var resultSorted = Object.keys(resultUnsorted).sort().reduce(
            (obj, key) => {
                obj[key] = resultUnsorted[key];
                return obj;
            }, {}
        );

        var result = Object.assign({}, resultSorted);
        for (const lang in result) {
            const translations = result[lang];
            if (!translations || typeof translations !== "object") {
                continue;
            }

            Object.keys(translations).forEach((key) => {
                const value = translations[key];
                if (Array.isArray(value)) {
                    translations[key] = value.join("\n");
                }
            });
        }

        return result;
    }

    /**
     * getTranslationText
     * @description i18n translation text.
     *
     * @param  {String}  lang
     * @return {Object}
     */
    async function getTranslationText(lang) {
        return Object.prototype.hasOwnProperty.call(EMBEDDED_TRANSLATIONS, lang)
            ? EMBEDDED_TRANSLATIONS[lang]
            : translateText()['en-US'];
    }

    /**
     * _i18n
     * @description Perform i18n translation.
     *
     * @param  {String}  text
     * @return {void}
     */
    function _i18n(text) {
        const translate = translateText();

        if (translate[state.lang] != undefined && translate[state.lang][text] != undefined) {
            return translate[state.lang][text];
        }
        else {
            return translate["en-US"][text];
        }
    }

    /**
     * repaintingTranslations
     * @description Perform i18n translation.
     *
     * @return {void}
     */
    function repaintingTranslations() {
        $('[data-ih-locale]').each(function () {
            const $this = $(this);
            $this.text(_i18n($this.data('ih-locale')));
        });
        $('[data-ih-locale-title]').each(function () {
            const $this = $(this);
            $this.attr('title', _i18n($this.data('ih-locale-title')));
        });
        $('[data-ih-locale-aria]').each(function () {
            const $this = $(this);
            $this.attr('aria-label', _i18n($this.data('ih-locale-aria')));
        });
    }

    /* register all events */

    // Running if document is ready
    $(function () {
        function ConvertDOM(domEl) {
            var obj = [];
            for (var ele of domEl) {
                obj.push({
                    tagName: ele.tagName,
                    id: ele.id,
                    className: ele.className
                });
            }

            return obj;
        }

        function setDOMTreeContent() {
            let text = $('div[id^="mount"]')[0];
            var loggerStr = "";
            state.GL_logger.forEach(log => {
                var jsonData = JSON.stringify(log.content, function (key, value) {
                    if (Array.isArray(this)) {
                        if (typeof value === "object" && value instanceof jQuery) {
                            return ConvertDOM(value);
                        }
                        return value;
                    }
                    else {
                        return value;
                    }
                }, "\t");
                loggerStr += `${new Date(log.time).toISOString()}: ${jsonData}\n`
            });
            $('.IG_POPUP_DIG .IG_POPUP_DIG_BODY textarea').text("Logger:\n" + loggerStr + "\n-----\n\nLocation: " + location.pathname + "\nDOM Tree with div#mount:\n" + text.innerHTML);
        }

        $body.on('click', '.IG_POPUP_DIG .IG_POPUP_DIG_BODY .IG_DISPLAY_DOM_TREE', function () {
            setDOMTreeContent();
        });

        // OPTIMIZATION: replace deprecated document.execCommand('copy') with modern
        // navigator.clipboard.writeText() API. Falls back to execCommand on browsers
        // that don't support it (unlikely on Chrome/Firefox/Edge >= 100).
        $body.on('click', '.IG_POPUP_DIG .IG_POPUP_DIG_BODY .IG_SELECT_DOM_TREE', function () {
            const $textarea = $('.IG_POPUP_DIG .IG_POPUP_DIG_BODY textarea');
            const textContent = $textarea.val() || $textarea.text();
            $textarea.trigger('select');

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textContent).catch(err => {
                    logger('Clipboard API failed, falling back to execCommand:', err);
                    try { document.execCommand('copy'); } catch (e) { logger('execCommand fallback failed:', e); }
                });
            }
            else {
                try { document.execCommand('copy'); } catch (e) { logger('execCommand failed:', e); }
            }
        });

        $body.on('click', '.IG_POPUP_DIG .IG_POPUP_DIG_BODY .IG_DOWNLOAD_DOM_TREE', function () {
            const $textarea = $('.IG_POPUP_DIG .IG_POPUP_DIG_BODY textarea');
            if ($textarea.text().length === 0) {
                setDOMTreeContent();
            }

            var text = $textarea.text();
            var a = document.createElement("a");
            var file = new Blob([text], { type: "text/plain" });
            a.href = URL.createObjectURL(file);
            a.download = "DOMTree-" + new Date().getTime() + ".txt";

            document.body.appendChild(a);
            a.click();
            a.remove();
        });

        // Close the download dialog if user click the close icon
        $body.on('click', '.IG_POPUP_DIG_BTN, .IG_POPUP_DIG_BG', function () {
            const $this = $(this);
            if ($this.parent('#tempWrapper').length > 0) {
                $this.parent('#tempWrapper').fadeOut(250, function () {
                    $(this).remove();
                });
            }
            else {
                $('.IG_POPUP_DIG').remove();
            }
        });

        $(window).on('keydown', function (e) {
            // Hot key [Alt+Q] to close the download dialog - fixed
            if (e.altKey && e.which == 81) {
                $('.IG_POPUP_DIG').remove();
                e.preventDefault();
            }
            // Hot key [Alt+W] to open/close the settings dialog - use custom keycode if enabled, fallback to default Alt+W(87)
            let settingsKeyCode = state.settingsHotkeyKeyCode || 87;
            if (e.altKey && e.which == settingsKeyCode) {
                const $popup = $('.IG_POPUP_DIG');
                if ($popup.length > 0 && $popup.find('#post_info').text() === 'Preference Settings') {
                    $popup.remove();
                } else {
                    showSetting();
                }
                e.preventDefault();
            }

            // Hot key [Alt+W] to open/close the key settings dialog - use custom keycode if enabled, fallback to default Alt+C(67)
            let keySettingsHotkeyKeyCode = state.keySettingsHotkeyKeyCode || 67;
            if (e.altKey && e.which == keySettingsHotkeyKeyCode) {
                const $popup = $('.IG_POPUP_DIG');
                if ($popup.length > 0 && $popup.find('#post_info').text() === 'Hotkey Settings') {
                    $popup.remove();
                } else {
                    showHotkeySetting();
                }
                e.preventDefault();
            }

            // Hot key [Alt+Z] to open the debug DOM - use custom keycode if enabled, fallback to default Alt+Z(90)
            let debugKeyCode = state.debugHotkeyKeyCode || 90;
            if (e.altKey && e.which == debugKeyCode) {
                showDebugDOM();
                e.preventDefault();
            }

            // Hot key [Alt+R] to reload script (fixed, not customizable)
            if (e.which == '82' && e.altKey) {
                reloadScript();
                e.preventDefault();
            }

            // Hot key [Alt+S] to download story/highlights resource - use custom keycode if enabled, fallback to default Alt+S(83)
            let downloadStoryKeyCode = state.downloadStoryHotkeyKeyCode || 83;
            if (e.altKey && e.which == downloadStoryKeyCode) {
                if (location.href.match(/^(https:\/\/www\.instagram\.com\/stories\/)/ig) && $('.IG_DWSTORY').length > 0) {
                    $('.IG_DWSTORY')?.trigger("click");
                }
                if (location.href.match(/^(https:\/\/www\.instagram\.com\/stories\/highlights\/)/ig) && $('.IG_DWHISTORY').length > 0) {
                    $('.IG_DWHISTORY')?.trigger("click");
                }
                e.preventDefault();
            }
        });

        $body.on('change', '.IG_POPUP_DIG input', function () {
            const $this = $(this);
            var name = $this.attr('id');

            if (name && USER_SETTING[name] !== undefined) {
                let isChecked = $this.prop('checked');
                GM_setValue(name, isChecked);
                USER_SETTING[name] = isChecked;

                console.log('user settings', name, isChecked);
            }
        });

        $body.on('click', '.IG_POPUP_DIG .globalSettings', function (e) {
            if ($(this).find('#tempWrapper').length > 0) {
                e.preventDefault();
            }
        });

        $body.on('change', '.IG_POPUP_DIG #tempWrapper input:not(#date_format)', function () {
            const $this = $(this);
            let value = $this.val();

            if ($this.attr('type') == 'range') {
                $this.next().val(value);
            }
            else {
                $this.prev().val(value);
            }

            if (value >= 0 && value <= 1) {
                state.videoVolume = value;
                GM_setValue('G_VIDEO_VOLUME', value);
            }
        });

        $body.on('input', '.IG_POPUP_DIG #tempWrapper input:not(#date_format)', function () {
            const $this = $(this);
            if ($this.attr('type') == 'range') {
                let value = $this.val();
                $this.next().val(value);
            }
            else {
                let value = $this.val();
                if (value >= 0 && value <= 1) {
                    $this.prev().val(value);
                }
                else {
                    if (value < 0) {
                        $this.val(0);
                    }
                    else {
                        $this.val(1);
                    }
                }
            }
        });

        $body.on('input', '.IG_POPUP_DIG #tempWrapper input#date_format', function () {
            const val = $(this).val();
            GM_setValue('G_RENAME_FORMAT', val);
            state.fileRenameFormat = val;
        });

        $body.on('click', 'a[data-needed="direct"]', function (e) {
            e.preventDefault();
            triggerLinkElement($(this), false);
        });

        $body.on('click', '.IG_POPUP_DIG_BODY .newTab', function () {
            const $this = $(this);
            const $linkA = $this.parent().children('a');
            if (USER_SETTING.FORCE_RESOURCE_VIA_MEDIA && USER_SETTING.NEW_TAB_ALWAYS_FORCE_MEDIA_IN_POST) {
                triggerLinkElement($linkA.first()[0], true);
            }
            else {
                openNewTab(replaceSameOriginHost($linkA.data('href')));
            }
        });

        $body.on('click', '.IG_POPUP_DIG_BODY .videoThumbnail', function () {
            const $this = $(this);
            const $linkA = $this.parent().children('a');
            let timestamp = new Date().getTime();

            if (USER_SETTING.RENAME_PUBLISH_DATE && $linkA.attr('datetime')) {
                timestamp = $linkA.attr('datetime');
            }

            let postPath = $linkA.data('path') ?? $('#article-id').text();

            if (USER_SETTING.CAPTURE_IMAGE_VIA_MEDIA_CACHE) {
                const mediaId = $linkA.first().attr('media-id');
                const cached = getImageFromCache(mediaId);

                if (cached) {
                    logger("[Restore Cached postThumbnail]", mediaId);
                    saveFiles(cached, {
                        username: $linkA.data('username'),
                        sourceType: 'thumbnail',
                        timestamp,
                        filetype: 'jpg',
                        shortcode: postPath
                    });
                    return;
                }
            }

            saveFiles(
                $linkA.find('img').first().attr('src'),
                {
                    username: $linkA.data('username'),
                    sourceType: 'thumbnail',
                    timestamp,
                    filetype: 'jpg',
                    shortcode: postPath
                });
        });

        // Running if user left-click download icon in stories
        $body.on('click', '.IG_DWSTORY', function () {
            onStory(true);
        });

        // Running if user left-click all download icon in stories
        $body.on('click', '.IG_DWSTORY_ALL', function () {
            onStoryAll();
        });

        // Running if user left-click 'open in new tab' icon in stories
        $body.on('click', '.IG_DWNEWTAB', function (e) {
            e.preventDefault();
            onStory(true, true, true);
        });

        // Running if user left-click download thumbnail icon in stories
        $body.on('click', '.IG_DWSTORY_THUMBNAIL', function () {
            onStoryThumbnail(true);
        });

        // Running if user left-click download icon in profile
        $body.on('click', '.IG_DWPROFILE', function (e) {
            e.stopPropagation();
            onProfileAvatar(true);
        });

        // Running if user left-click download icon in highlight stories
        $body.on('click', '.IG_DWHISTORY', function () {
            onHighlightsStory(true);
        });

        // Running if user left-click all download icon in highlight stories
        $body.on('click', '.IG_DWHISTORY_ALL', function () {
            onHighlightsStoryAll();
        });

        // Running if user left-click 'open in new tab' icon in highlight stories
        $body.on('click', '.IG_DWHINEWTAB', function (e) {
            e.preventDefault();
            onHighlightsStory(true, true);
        });

        // Running if user left-click thumbnail download icon in highlight stories
        $body.on('click', '.IG_DWHISTORY_THUMBNAIL', function () {
            onHighlightsStoryThumbnail(true);
        });

        // Running if user left-click download icon in reels
        $body.on('click', '.IG_REELS', function () {
            onReels(true, true);
        });

        // Running if user left-click newtab icon in reels
        $body.on('click', '.IG_REELS_NEWTAB', function () {
            onReels(true, true, true);
        });

        // Running if user left-click download icon in reels
        $body.on('click', '.IG_REELS_THUMBNAIL', function () {
            onReels(true, false);
        });

        // Running if user right-click profile picture in stories area
        $body.on('mousedown', 'button[role="menuitem"], div[role="menuitem"], ul > li[tabindex="-1"] > div[role="button"]', function (e) {
            // Right-Click || Middle-Click
            if (e.which === 3 || e.which === 2) {
                if (location.href === 'https://www.instagram.com/' && USER_SETTING.REDIRECT_CLICK_USER_STORY_PICTURE) {
                    e.preventDefault();

                    const $this = $(this);
                    $this.find('img').each(function () {
                        const $img = $(this);
                        if (!$img.data('contextmenu')) {
                            $img.data('contextmenu', true);
                            $img.on('contextmenu', function (e) {
                                e.preventDefault();
                            });
                        }
                    });

                    if ($this.find('canvas._aarh, canvas + span > img').length > 0) {
                        const targetUrl = 'https://www.instagram.com/' + $this.children('div').last().text();
                        if (e.which === 2) {
                            GM_openInTab(targetUrl);
                        }
                        else {
                            location.href = targetUrl;
                        }
                    }
                }
            }
        });

        $body.on('change', '.IG_POPUP_DIG_TITLE .checkbox', function () {
            const isChecked = $(this).find('input').prop('checked');
            $('.IG_POPUP_DIG_BODY .inner_box').each(function () {
                $(this).prop('checked', isChecked);
            });
            updatePopupSelectionSummary();
        });

        $body.on('change', '.IG_POPUP_DIG_BODY .inner_box', function () {
            updatePopupSelectionSummary();
        });

        $body.on('click', '.IG_POPUP_DIG #batch_download_selected', function () {
            if ($('.IG_POPUP_DIG #_SNLOAD').length > 0) return;

            let index = 0;
            let links = [];
            $('.IG_POPUP_DIG_BODY a[data-needed="direct"]').each(function () {
                let $link = $(this);
                if ($link.prev().children('input').prop('checked')) {
                    links.push($link);
                    index++;
                }
            });

            if (index == 0) {
                alert(_i18n('NO_CHECK_RESOURCE'));
            }
            else {
                batchDownloadPostFiles(links);
            }
        });

        $body.on('change', '.IG_POPUP_DIG_TITLE #langSelect', function () {
            const $this = $(this);
            const val = $this.val();
            GM_setValue('UI_LANGUAGE', val);
            state.lang = val;

            if (state.lang?.startsWith('en') || state.locale[state.lang] != null) {
                repaintingTranslations();
                registerMenuCommand();
            }
            else {
                getTranslationText(state.lang).then((res) => {
                    state.locale[state.lang] = res;
                    repaintingTranslations();
                    registerMenuCommand();
                }).catch((err) => {
                    console.error('getTranslationText catch error:', err);
                });
            }
        });

        $body.on('click', '.IG_POPUP_DIG #batch_download_direct', function () {
            if ($('.IG_POPUP_DIG #_SNLOAD').length > 0) return;

            let links = [];
            $('.IG_POPUP_DIG_BODY a[data-needed="direct"]').each(function () {
                links.push($(this));
            });

            batchDownloadPostFiles(links);
        });

        registerPerformanceObserver();

        const element_observer = new MutationObserver((mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        const $node = $(node);
                        const $videos = $node.find('video').addBack('video');

                        if (location.pathname.startsWith("/stories/highlights/")) {
                            if (
                                $node.attr("data-ih-locale-title") == null &&
                                $node.attr("data-visualcompletion") == null &&
                                node.tagName === "DIV"
                            ) {
                                // replace something times ago format to publish time when switch highlight
                                var $time = getHighlightCurrentTimeElement($node);
                                setTimeElementDateAndLocaleTime($time);
                            }
                        }

                        if ($videos.length > 0) {
                            // Modify video volume
                            if (USER_SETTING.MODIFY_VIDEO_VOLUME) {
                                $videos.each(function () {
                                    $(this).one('play playing', function () {
                                        const $this = $(this);
                                        if (!$this.data('modify')) {
                                            $this.data('modify', true);
                                            this.volume = state.videoVolume;
                                            logger('(audio_observer) Added video event listener #modify');
                                        }
                                    });
                                });
                            }

                            if (location.pathname.match(/^(\/stories\/)/ig)) {
                                const isHighlight = location.pathname.match(/^(\/stories\/highlights\/)/ig) != null;
                                const storyType = isHighlight ? 'highlight' : 'story';

                                $videos.each(function () {
                                    $(this).one('timeupdate', function () {
                                        const $this = $(this);
                                        if (!$this.data('insert-thumbnail')) {
                                            let $video = $this;
                                            if ($video.parents('div[style][class]').filter(function () {
                                                return $(this).width() == $video.width();
                                            }).find(isHighlight ? '.IG_DWHISTORY_THUMBNAIL' : '.IG_DWSTORY_THUMBNAIL').length === 0) {
                                                $this.data('insert-thumbnail', true);

                                                if (isHighlight) {
                                                    onHighlightsStoryThumbnail(false);
                                                }
                                                else {
                                                    onStoryThumbnail(false);
                                                }

                                                logger(`(${storyType})`, 'Manually inserting thumbnail button');
                                            }
                                            else {
                                                $this.data('insert-thumbnail', true);
                                                logger(`(${storyType})`, 'Thumbnail button already inserted');
                                            }
                                        }
                                    });

                                    var $video = $(this);

                                    if (USER_SETTING.HTML5_VIDEO_CONTROL) {
                                        if (!$video.data('controls')) {
                                            logger(`(${storyType})`, 'Added video html5 contorller #modify');

                                            if (USER_SETTING.MODIFY_VIDEO_VOLUME) {
                                                this.volume = state.videoVolume;

                                                $video.on('loadstart', function () {
                                                    this.volume = state.videoVolume;
                                                });
                                            }

                                            let $videoParent = $video.parents('div').filter(function () {
                                                const $this = $(this);
                                                return $this.attr('class') == null && $this.attr('style') == null;
                                            }).first();

                                            // This is mute/unmute's icon
                                            let $element_mute_button = $videoParent.parent().find('svg > path[d^="M1.5 13.3c-.8 0-1.5.7-1.5 1.5v18.4c0"], svg > path[d^="M16.636 7.028a1.5 1.5"]').parents('[role="button"]').first();
                                            state.GL_weakCache.mutedButton.set($video[0], $element_mute_button);

                                            // story bottom bar
                                            let $bottomBar = $videoParent.next();

                                            // read more button in center
                                            let $readMoreButton = $videoParent.find('div[class][role="button"]');

                                            let $targets = $video.parent().find('video + div');

                                            const hideContextmenu = function (e) {
                                                e.preventDefault();
                                                e.stopPropagation();

                                                let $overlayElement = null;

                                                if ($overlayElement == null) {
                                                    $overlayElement = $(e.target).parent().find('div[aria-label][data-visualcompletion="ignore"]').first();

                                                    if ($overlayElement.length === 0) {
                                                        $overlayElement = $(e.target).first();
                                                    }
                                                }

                                                state.GL_weakCache.overlay.set($video[0], $overlayElement);

                                                $video.css('z-index', '2');
                                                $video.attr('controls', true);
                                                $targets.css('z-index', '-10');
                                                $overlayElement.css('z-index', '-10');

                                                $readMoreButton.hide();
                                                $bottomBar.hide();

                                                toggleVolumeSilder($video, $video.parents('div[style][class]').filter(function () {
                                                    return $(this).width() == $video.width();
                                                }).first(), storyType, 'vertical');
                                            };

                                            // Hide layout to show controller
                                            $targets.off('contextmenu.IG_videoControl').on('contextmenu.IG_videoControl', hideContextmenu);
                                            $readMoreButton.off('contextmenu.IG_videoControl').on('contextmenu.IG_videoControl', hideContextmenu);
                                            $bottomBar.off('contextmenu.IG_videoControl').on('contextmenu.IG_videoControl', hideContextmenu);
                                            $videoParent.off('contextmenu.IG_videoControl').on('contextmenu.IG_videoControl', hideContextmenu);

                                            // Restore layout to show details interface
                                            $video.on('contextmenu', function (e) {
                                                e.preventDefault();
                                                e.stopPropagation();

                                                $video.css('z-index', '-1');
                                                $video.removeAttr('controls');
                                                $targets.css('z-index', '1');
                                                state.GL_weakCache.overlay.get($video[0])?.css('z-index', '1');

                                                $bottomBar.show();
                                                $readMoreButton.show();

                                                toggleVolumeSilder($video, $video.parents('div[style][class]').filter(function () {
                                                    return $(this).width() == $video.width();
                                                }).first(), storyType, 'vertical');
                                            });

                                            $video.on('volumechange', function () {
                                                let $element_mute_button = state.GL_weakCache.mutedButton.get(this) || {};
                                                var is_element_muted = $element_mute_button?.find && $element_mute_button.find('svg > path[d^="M16.636"]').length === 0;

                                                if (this.muted != is_element_muted) {
                                                    this.volume = state.videoVolume;

                                                    triggerReactClickHandler($element_mute_button.first()[0]);
                                                }

                                                const $v = $(this);
                                                if ($v.data('completed')) {
                                                    state.videoVolume = this.volume;
                                                    GM_setValue('G_VIDEO_VOLUME', this.volume);
                                                }

                                                if (this.volume == state.videoVolume) {
                                                    $v.data('completed', true);
                                                }
                                            });

                                            $video.css('position', 'absolute');
                                            $video.data('controls', true);

                                            toggleVolumeSilder($video, $video.parents('div[style][class]').filter(function () {
                                                return $(this).width() == $video.width();
                                            }).first(), storyType, 'vertical');
                                        }
                                    }
                                    else {
                                        toggleVolumeSilder($video, $video.parents('div[style][class]').filter(function () {
                                            return $(this).width() == $video.width();
                                        }).first(), storyType, 'vertical');
                                    }
                                });
                            }
                        }
                    });
                }
            }
        });

        (function installElementObserver(attempts) {
            const mountRoot = $('div[id^="mount"]')[0];
            if (mountRoot) {
                element_observer.observe(mountRoot, { childList: true, subtree: true });
                logger('[element_observer] installed on mount root');
            } else if (attempts > 0) {
                setTimeout(() => installElementObserver(attempts - 1), 250);
                logger('[element_observer] mount root not ready, retrying...');
            } else {
                logger('[element_observer] mount root not found after multiple retries');
            }
        })(20);
    });
})(jQuery, Mediabunny);
