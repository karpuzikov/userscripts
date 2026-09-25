# Userscripts & Tools

A collection of Tampermonkey userscripts, MusicBrainz/Picard helpers, Windows utilities, image tools, game installers, and backup scripts.

## Browser Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Instagram Force Full Quality Media** | Forces the highest-quality Instagram post/Reel media while leaving profile, search, and Explore thumbnails untouched. | 4.0.0 | [![Download](https://img.shields.io/badge/Download-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/instagram-full-quality/Instagram_Force_Full_Quality_Media.user.js) |
| **YYYY-MM-DD for All** | Converts dates to `YYYY-MM-DD` on CDJapan, IAFD, setlist.fm, and Blu-ray.com. Adapter-based design makes more websites easy to add later. | 1.0.0 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/yyyy-mm-dd-for-all/YYYY-MM-DD_for_All.user.js) |
| **BPTopTracker 500 redirect to Beatport** | Redirects BPTopTracker HTTP 500/Internal Server Error pages to the equivalent Beatport URL. | 1.1.0 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/bptoptracker-to-beatport/BPTopTracker_to_Beatport.user.js) |
| **Genius Lyrics Copier** | Adds a one-click Copy Lyrics button to Genius and cleans annotations, page clutter, and spacing before copying. | 1.9 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/genius-lyrics-copier/Genius_Lyrics_Copier.user.js) |
| **Emoji Text Renderer** | Renders Unicode emoji, including country flags, in page text using Noto Color Emoji. Leaves editors and ordinary symbols unchanged. | 1.0.1 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/emoji-text-renderer/Emoji_Text_Renderer.user.js) |
| **RuTracker Digital Release Linker** | Links exact Deezer release pages by barcode/catalog number, shows an expanded list of releases that were not found, preserves existing concrete release URLs while treating artist pages as placeholders, recognizes identifiers before trailing `(by ...)` annotations, catalog numbers containing spaces such as `[SUB 003]`, and catalog/reissue-year forms such as `[RBR0869DL - 2021]`, replaces placeholder WEB links with the resolved Deezer source, accepts source lines with or without `[hr]`, uses Deezer/Beatport links only from the exact matched MusicBrainz release, including Deezer track relationships on its recordings, processes unresolved `WEB|redacted.sh` / `WEB|redacted.ch` entries, falls back to MusicBrainz-linked Beatport URLs without scraping Beatport, and adds country flag emoji. | 1.1.13 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/rutracker-digital-release-linker/RuTracker_Digital_Release_Linker.user.js?v=1.1.13) |

## MusicBrainz Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **MusicBrainz - Barcode and Catalog Number Search** | Adds Barcode and Catalog number release search fields directly to the left of MusicBrainz's native header search. If exactly one release matches, it opens that release immediately; otherwise it shows the normal release search results. | 1.1.1 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/barcode-catalog-search/MusicBrainz_Barcode_Catalog_Search.user.js) |
| **BPTopTracker -> MusicBrainz Importer** | Imports BPTopTracker release metadata into the MusicBrainz Add Release editor, including artist credits, label, catalog number, date, digital medium, track titles, artists, lengths, and Beatport purchase URL without inventing unavailable identifiers. | 1.0.1 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/bptoptracker-musicbrainz-importer/BPTopTracker_MusicBrainz_Importer.user.js) |
| **MusicBrainz BOIU Cover Art Removal** | Adds a **BOIU** button next to Edit/Remove for each cover image. One click removes that image with the edit note `better one is uploaded`. | 1.0.1 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/MusicBrainz_BOIU_Cover_Art_Removal.user.js) |
| **MusicBrainz Release Events -> Worldwide** | Replaces all release events with one `[Worldwide]` event while preserving the existing release date. | 1.1.1 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/release-events-worldwide/MusicBrainz_Release_Events_Worldwide.user.js) |
| **Apple Music Barcodes/ISRCs** | Improved fork for extracting Apple Music barcodes, ISRCs, and metadata with a dark theme, per-column alignment, a hidden-by-default Composer column toggle, selectable text, and one-click ISRC copying. | 0.26 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/apple-music-barcode-isrc/master/apple-music-barcode-isrc.user.js) |
| **Apple Music works credits -> MusicBrainz** | Verifies the Apple Music release, routes credits to Recording/Work/Release, resolves artists through four priority context circles, resolves or creates missing Works, and when new Works are needed asks for the lyrics language once per album import, then reuses it for every newly created Song Work. | 2.3.11 (not tested ⚠️) | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/c45cb83061576953b6a42bf57aadcf50c04b85d5/musicbrainz-tools/apple-music-composition-lyrics-importer/MusicBrainz_Apple_Music_Composition_Lyrics_Importer.user.js) |
| **MusicBrainz Barcode vs Linked Releases Checker** | Checks Digital Media release barcodes against linked provider release pages through Harmony, moves mismatched provider URLs to the release whose barcode matches, finds provider links by barcode when missing/unreadable, and opens reviewable correcting edits without auto-submitting them. | 1.3.1 (not tested) | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/barcode-linked-release-checker/MusicBrainz_Barcode_Linked_Release_Checker.user.js) |
| **Harmony - Copy ISRCs** | Adds a one-click Copy ISRCs button to Harmony release tracklists and copies all displayed ISRCs in track order. | 1.0.1 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/harmony-copy-isrcs/Harmony_Copy_ISRCs.user.js) |
| **Harmony - Link External IDs in One Click** | Fast Harmony -> MusicBrainz external-ID submission. The global all-in-one button is placed directly above the first available external-ID section; Artists, Labels, and Songs get their own buttons inside their respective Harmony sections, and type-specific buttons appear only when that type actually has links to submit. | 1.2.5 (not tested ⚠️) | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/harmony-link-external-ids-one-click/Harmony_Link_External_IDs_in_One_Click.user.js) |

## MusicBrainz Picard Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Picard - Current Artist Names Everywhere** | Replaces historical/credited/alias artist names with the current MusicBrainz artist name. Its downloader bootstraps WinGet and installs Picard when missing while preserving non-WinGet prerelease/custom installations. | 0.2.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/current-artist-names/Download_Current_Artist_Names_Plugin.bat) |
| **Picard - Move Featured Artists to Title** | Moves featured credits into the title using `(ft. Artist)` and removes the featured credit from artist/album artist fields. | 1.0.0 | [![TXT](https://img.shields.io/badge/Manual-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/Move_Featured_Artists_to_Title.txt) [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |
| **Picard - Unicode to ASCII** | Normalizes common Unicode punctuation and symbols to ASCII while keeping Unicode letters intact. | 1.0.0 | [![TXT](https://img.shields.io/badge/Manual-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/Unicode_to_ASCII.txt) [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |
| **Picard - Format Multiple Artists** | Formats multiple artists as `A & B` or `A, B & C`. | 1.0.0 | [![TXT](https://img.shields.io/badge/Manual-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/Format_Multiple_Artists.txt) [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |
| **Picard - Add EP/Single Suffix** | Adds ` - EP` or ` - Single` to release titles based on the primary release type. | 1.0.0 | [![TXT](https://img.shields.io/badge/Manual-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/Add_EP_Single_Suffix.txt) [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |
| **Picard - English Title Capitalization** | Applies the Picard title-capitalization rules used in this collection while preserving ambiguous words such as `Up`, `In`, `On`, `Off`, and `By`. | 1.0.0 | [![TXT](https://img.shields.io/badge/Manual-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/English_Title_Capitalization.txt) [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |

### Picard 3 Git plugin installation

The five tagging scripts above remain available as individual **Manual .txt** downloads.

For automatic GitHub updates, install the shared **Karpuzikov Picard Scripts** plugin once:

1. Open `Options -> Plugins -> Install Plugin -> URL`.
2. Git URL: `https://github.com/karpuzikov/userscripts.git`
3. Leave `Ref/Tag` empty so Picard uses `main`.
4. Install and enable **Karpuzikov Picard Scripts**.
5. Open `Options -> Plugins -> Karpuzikov Picard Scripts` and enable only the scripts you want.

Picard can then check for and install future updates from its Plugins interface. If the same script is also enabled under `Options -> Scripting`, disable one copy so it is not run twice.

## Audio Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **CUE Filename Fixer - UTF-8 Recursive** | Single-file BAT. Recursively repairs CUE `FILE` references, creates backups, saves UTF-8, and embeds its Python GUI internally while bootstrapping Python 3.13 automatically. | 2.0.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/audio-tools/cue-filename-fixer/CUE_Filename_Fixer_UTF8_Recursive.bat) |
| **AudioChecker UTF-8 Patch (Experimental)** | Single-file BAT that generates all required UTF-8 manifests itself and patches the existing AudioChecker folder without bundled helper files. | Experimental | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/audio-tools/audiochecker-utf8-patch/Install_AudioChecker_UTF8_Patch.bat) |

## Image Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **3x3 Image Combiner** | Single-file BAT with an embedded `.pyw` payload. Installs/updates Python 3.13 and Pillow automatically, then combines up to nine images into a 3x3 JPEG grid. | 2.0.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/image-tools/3x3-image-combiner/Run_3x3_Image_Combiner.bat) |
| **Fast Image to JPG Converter** | Multicore recursive PNG/HEIC/HEIF/JPEG-to-JPG converter with transparency checks. WinGet and ImageMagick are installed/updated automatically; HEIC/HEIF now use ImageMagick. | 2.0.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/image-tools/fast-image-to-jpg/Fast_Image_to_JPG_Converter.bat) |
| **Photoshop 500px PNG / 600px JPG Batch Exporter** | Batch-processes images in Photoshop, creating a 600px JPG with smart size control and a 500px PNG with JPG fallback when needed. | 1.4 | [![Download](https://img.shields.io/badge/Download-.jsx-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/image-tools/photoshop-batch-export/Photoshop_Batch_500PNG_600JPG.jsx) |

## Media Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Archive Media Compressor** | Single-file BAT with the PowerShell compressor embedded. Bootstraps WinGet and installs/updates PowerShell 7, FFmpeg, and ImageMagick before launch. | 2.0.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/archive-media-compressor/ArchiveMedia.bat) |

## Windows Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Requirements Manager** | Installs one or many `requirements.txt` files, prefers ComfyUI embedded Python, and auto-installs/updates Python 3.13 when needed. WinGet is bootstrapped automatically. | 1.1.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/windows-tools/requirements-manager/Requirements_Manager.bat) |

## Game Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **DriveV One-Click Auto Installer** | One-BAT user entrypoint. Bootstraps WinGet, Python 3.13, and 7-Zip, then downloads/updates one self-contained `.pyw` GUI with the core and package manifest embedded. | 2.1.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/game-tools/drivev-one-click-installer/Install_DriveV.bat) |

## Backup Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Backup and Restore Windows Drivers** | Single BAT with Backup/Restore menu. Creates verified timestamped ZIP backups of third-party Windows drivers and restores the newest backup with PnPUtil, administrator elevation, detailed logging, reboot tracking, and legacy backup compatibility. | 1.0.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/backup-tools/windows-drivers/Backup_and_Restore_Windows_Drivers.bat) |
| **Backup and Restore SyncTrayzor & Syncthing** | Single BAT with Backup/Restore menu. Creates verified timestamped ZIP backups of SyncTrayzor/Syncthing configuration, refuses live-changing copies while either app is running, restores the newest backup, and supports legacy backup layouts. | 2.0.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/backup-tools/syncthing-backup/Backup_and_Restore_SyncTrayzor_Syncthing.bat) |
| **Backup and Restore qBittorrent** | Single BAT with Backup/Restore menu. Creates verified timestamped ZIP backups of qBittorrent profiles and installation data, restores the newest backup with automatic elevation, and supports legacy backup layouts. | 2.1.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/backup-tools/qbittorrent-backup/Backup_and_Restore_qBittorrent.bat) |

## Dependency Bootstrap, Credentials, and Software Layout

Standalone Windows entrypoints check WinGet first. If it is missing, they bootstrap WinGet automatically, then install or update the dependencies required by that tool. See [Windows Dependency Bootstrap Policy](windows-tools/DEPENDENCY_BOOTSTRAP.md).

Software that explicitly manages authentication stores protected credentials under the dynamically resolved Windows Documents library at `Software Credentials\\<App Name>`, migrates legacy locations when practical, and reuses that store across updates.

Repository software also follows these layout rules:
- Prefer a single BAT or PYW whenever technically practical.
- Python GUI software uses `.pyw` rather than `.py`.
- A `.py` helper is only acceptable when the software is launched through a BAT and merging it would materially hurt reliability.
- Redundant launchers/helpers are embedded or removed where practical.
- Related tools use unified UI/UX, status wording, logging, naming, and behavior whenever practical.
- Backup tools use timestamped names in the form `<Product>_Backup_YYYY-MM-DD-HH-MM`, restore the newest compatible backup by default, and preserve legacy backup compatibility when practical.
- Host-required formats such as Picard `__init__.py`, Tampermonkey `.user.js`, and Photoshop `.jsx` keep the filenames required by their host applications.
- MusicBrainz userscripts that create, submit, or modify MusicBrainz edits must include a link to the exact GitHub script in the edit note, while preserving any user-entered edit-note text.

## Notes

- Tampermonkey userscripts use direct `.user.js` links so clicking **Install** should open the userscript installer when Tampermonkey is installed.
- When a host format genuinely requires multiple runtime files, the downloadable BAT creates or downloads only the minimum required files.
- Source files remain available in their project folders.

## License

MIT