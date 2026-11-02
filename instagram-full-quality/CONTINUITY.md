# Instagram Force Full Quality Media - Continuity

## Product and status
- Product: Instagram Force Full Quality Media, a Tampermonkey userscript for downloading Instagram media and exposing image context-menu actions.
- Current published version: 4.4.6 - Under construction ⚠️ (source-level tests passed; real Instagram browser QA NOT RUN).
- Repository and active branch: `karpuzikov/userscripts`, `main`.
- Product root: `instagram-full-quality/`.
- Canonical source: `instagram-full-quality/Instagram_Force_Full_Quality_Media.user.js`.
- No product-specific `RULES.md` exists; repository-root `SOFTWARE_RULES.md` and `UI_UX_RULES.md` govern this product.

## Architecture
- Single-file userscript; no separate build/package step. The source is the installable artifact.
- Tampermonkey metadata contains direct `@downloadURL` and `@updateURL` to the raw GitHub main-branch source.
- Dependencies: jQuery 4.0.0 and Mediabunny 1.34.5 via pinned `@require` URLs.
- Granted APIs include `GM_addStyle`, `GM_download`, `GM_getValue`, `GM_setValue`, `GM_openInTab`, `GM_xmlhttpRequest`, and menu commands.
- Media retrieval currently prefers embedded page-script JSON (`findEmbeddedPostMedia`), then Instagram GraphQL query-hash/query-ID calls, and Instagram Media API for media IDs. Downloader supports images, videos, carousels, Reels, Stories and profile images.
- Localized translations and popup stylesheet are bundled in the userscript. IG Helper branding, donation controls, external legacy style/translation dependencies, and legacy update checker were removed in v4.4.4.

## Behavior contract
- Post overlay controls: Image Viewer (opens an internal image viewer), Open in new tab (opens the direct media URL), Download (opens the compact media picker or downloads according to existing settings), and Video Thumbnail (opens/downloads the video's poster thumbnail).
- Image context menu must reach the actual image so browser-native Copy image / Save image actions work. Do not hide or remove the media container; broad `display:none` selectors previously caused black carousel posts.
- The compact picker supports selected/all downloads, previews, and per-item new-tab/video-thumbnail actions.
- Preserve user settings, existing download naming, cache behavior, and all media workflows when changing post-page fallback behavior.
- Resolved in source v4.4.6, pending browser confirmation: on post pages such as `https://www.instagram.com/p/DT5angriDSP/?img_index=1`, selector `._aa20 > .xtijo5x` was intercepting image context menu; open-tab/download could fail after Instagram returned `feedback_required`. CSS now makes the layer click-through, media already present in the visible post DOM is used as a fallback, image tab URLs keep their original CDN host, video-only host rewriting is retained, direct fallback downloads use `GM_download` for non-blob URLs, and `getBlobMediaWithQueryID` no longer raises a blocking alert before recovery.
- Implemented in v4.4.6: click-through CSS for the exact overlay, native button semantics/localized aria labels for injected controls, direct extraction of the currently displayed image/video URL from the post DOM when API requests fail, `GM_openInTab` for new-tab opens, removal of the blocking API failure alert, original image CDN host preservation for new tabs, video-only host rewriting, and privileged `GM_download` for HTTP(S) DOM-fallback links. For a carousel fallback, only the currently visible slide is available from DOM; do not falsely claim a full carousel listing.

## Persistent data and dependencies
- Settings/cache are managed by Tampermonkey GM storage; no product-owned filesystem files.
- Cache key includes `URLS_OF_IMAGES_TEMPORARILY_STORED`; cache max age is 12 hours and max image-cache entries is 300.
- Do not alter existing GM storage keys or settings defaults without an explicit requirement.

## Release and validation
- Update the userscript `@version`, root README Browser Tools row, this continuity file, and `UI_UX_ACCEPTANCE.md` in the same release checkpoint.
- Verify source syntax, expected fallback/control/CSS markers, and direct-source extraction logic before commit.
- Real browser acceptance is mandatory: test on the supplied post URL, right-click Copy image/Save image, Open in new tab, Download, selected carousel slide, a normal feed post, and a video post; ensure carousel media never renders black and the picker remains usable.
- Do not mark stable/fixed until real browser tests pass. If browser QA is unavailable, explicitly mark it NOT RUN and retain `Under construction ⚠️`.

## Current work and next action
- v4.4.6 source implementation is published after the post-page overlay/API-throttle bug report dated 2026-11-02.
- Source syntax, direct-media fallback helper cases, static regression checks, and mocked `GM_openInTab`/`GM_download` routing tests passed in this session. The connected local browser was unavailable; actual Instagram interaction/visual acceptance is NOT RUN.
- Exact next action: update Tampermonkey to v4.4.5 and test `https://www.instagram.com/p/DT5angriDSP/?img_index=1` for native Copy image, Open in new tab, and Download. Then test a carousel and a video post. Keep status Under construction ⚠️ until the user confirms.
