# YouTube - Channel Liked Videos

Version: 1.0.0 - Under construction ⚠️
Branch: main. Canonical source: `YouTube_Channel_Liked_Videos.user.js` in this directory.

## Purpose and behavior
Adds a Liked tab to the desktop YouTube channel tab group, before the channel search control. On click, replaces the channel content with matching liked videos from the current account's Liked Videos playlist (LL), following continuation pages. Channel matching prioritizes canonical UC IDs and falls back to canonical channel paths. Results retain playlist order and display thumbnails, titles, durations and available metadata. No separate login, external API key, persistent local database or third-party service. The browser's existing YouTube session is used only for same-origin requests; thumbnails use YouTube's image host. Navigating away cancels the scan and restores the native content. No likes are modified.

## Architecture and distribution
Standalone Tampermonkey userscript, `@grant none`, native YouTube DOM and internal browse endpoints, no build or runtime dependencies beyond desktop YouTube and Tampermonkey. No persistent storage. Preserve name and namespace (`youtube-channel-liked`), use native Tampermonkey updates with clean main raw URLs and pin the README manual install link to the verified source commit. Follow root SOFTWARE_RULES.md, UI_UX_RULES.md and DESIGN.md. No GitHub Actions for publication.

## Validation and limitations
Previous local checkpoint reported syntax, filtering and saved HTML selector checks. Authenticated YouTube playlist requests, account switching, native visual/interaction acceptance, screenshots, geometry and keyboard/resizing checks: NOT RUN. No stable/completed claim. The playlist can expose only a limited history (YouTube's 5,000-item limit); removed/private or unidentifiable entries may not match, and internal endpoint changes can break loading. No passwords, account cookies or supplied personal HTML are published. No failed approaches recorded.

## Next action
Install in Tampermonkey on desktop YouTube, open a channel with known liked videos, click Liked, compare the results against the LL playlist including continuation pages, then test no matches, errors/retry, switching tabs/channels and accounts, dark/light theme, long titles, resize and keyboard. Capture and inspect real screenshots and record evidence in UI_UX_ACCEPTANCE.md. Fix any defects and increment version before publishing an update. Keep Under construction until user acceptance.
