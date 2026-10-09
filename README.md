# Userscripts & Tools

A collection of Tampermonkey userscripts, MusicBrainz/Picard helpers, Windows utilities, image tools, game installers, and backup scripts.

## Browser Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Instagram Force Full Quality Media** | IG Helper's original download interface and functionality with its Media API/DASH quality options enabled by default. | 4.4.0 - Under construction ⚠️ | [![Download](https://img.shields.io/badge/Download-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/09f43768d5c2a1d6bdd8c8d17ddf0321f64600fa/instagram-full-quality/Instagram_Force_Full_Quality_Media.user.js) |
| **Spotify Hidden Releases** | Finds hidden/unlisted Spotify releases for the exact Spotify artist profile being scanned, walks the rendered discography to avoid false hidden labels, checks MusicBrainz linkage, filters by link status, and opens unlinked releases in Harmony. | 0.3.6 - Under construction ⚠️ | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/a482d415b1294dffba2f7f817b54f5e8321703e4/browser-tools/spotify-hidden-releases/Spotify_Hidden_Releases.user.js) |
| **YYYY-MM-DD for All** | Converts website dates to `YYYY-MM-DD` format. | 1.0.4 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/71d799fb87c998aeaf9d3a10970aad6ee2dd6fd9/browser-tools/yyyy-mm-dd-for-all/YYYY-MM-DD_for_All.user.js) |
| **Genius Lyrics Copier** | Copies clean lyrics from Genius with one click. | 1.9 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/f12046a20cd2e37027ff4b2b38a3fea75598b154/browser-tools/genius-lyrics-copier/Genius_Lyrics_Copier.user.js) |
| **Emoji Text Renderer** | Renders emoji correctly in the browser. | 1.0.2 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/f12046a20cd2e37027ff4b2b38a3fea75598b154/browser-tools/emoji-text-renderer/Emoji_Text_Renderer.user.js) |
| **RuTracker Digital Release Linker** | Links digital releases to their release pages. | 1.1.18 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/f12046a20cd2e37027ff4b2b38a3fea75598b154/browser-tools/rutracker-digital-release-linker/RuTracker_Digital_Release_Linker.user.js) |
| **SimpCity - Original Media Link Parser** | Extracts original image and video links from SimpCity threads. | 1.0.0 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/f12046a20cd2e37027ff4b2b38a3fea75598b154/browser-tools/simpcity-original-media-link-parser/SimpCity_Original_Media_Link_Parser.user.js) |

## MusicBrainz Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Harmony ToolBox** | Combines one-click ISRC copying and fast MusicBrainz external-ID linking for Harmony. | 1.0.2 - Under construction ⚠️ | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/b550615febaf11a169653b6affb8fa516b474592/musicbrainz-tools/harmony-toolbox/Harmony_ToolBox.user.js) |
| **MusicBrainz ToolBox** | Combines recording matching, track/recording tools, relationship shortcuts, remixer-credit detection/removal, duplicate-edit checking, barcode tools, Spotify/Apple Music -> MusicBrainz links, release-event helpers, external-link removal, cover-art removal, and Disc ID automation. | 1.0.55 - Under construction ⚠️ | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/02993c76c1fc7a1dd60f627e7237aabdc86cd88a/musicbrainz-tools/toolbox/MusicBrainz_ToolBox.user.js) |
| **Beatport -> MusicBrainz Importer** | Imports Beatport and BPTopTracker releases into MusicBrainz, shows MusicBrainz-link indicators and catalog-number search fallback on BPTopTracker, redirects BPTopTracker HTTP 500 pages to Beatport, and includes Beatport metadata enrichment, ISRC recording matching, and release-source handling. | 1.2.16 - Under construction ⚠️ | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/6c488448527bb73e0e9b671dd8c6ad57c554a03f/musicbrainz-tools/beatport-musicbrainz-importer/Beatport_MusicBrainz_Importer.user.js) |
| **Apple Music Barcodes/ISRCs** | Extracts barcodes, ISRCs, and track metadata from Apple Music. | 0.26 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/apple-music-barcode-isrc/master/apple-music-barcode-isrc.user.js) |
| **Apple Music works credits -> MusicBrainz** | Imports Apple Music work and composition credits into MusicBrainz. | 2.3.12 - Under construction ⚠️ | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/6dbb8443c0e9af9927ae76865c7c44c14df1c1cf/musicbrainz-tools/apple-music-composition-lyrics-importer/MusicBrainz_Apple_Music_Composition_Lyrics_Importer.user.js) |

## MusicBrainz Picard Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Picard - Current Artist Names Everywhere** | Uses current MusicBrainz artist names throughout Picard metadata. | 1.5.7 - Under construction ⚠️ | [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |
| **Picard - MusicBrainz Title Capitalization** | Capitalizes release and track titles according to MusicBrainz language rules. | 1.5.7 - Under construction ⚠️ | [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |
| **Picard - Barcode/UPC Lookup** | Resolves exact Barcode/UPC to a MusicBrainz release, uses total disc count to break duplicate-barcode ties, then matches each file directly by track/disc number. | 1.5.7 - Under construction ⚠️ | [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |
| **Picard - Move Featured Artists to Title** | Moves featured artists from artist fields into the track title. | 1.0.0 | [![TXT](https://img.shields.io/badge/Manual-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/Move_Featured_Artists_to_Title.txt) [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |
| **Picard - Unicode to ASCII** | Converts common Unicode punctuation and symbols to ASCII. | 1.0.0 | [![TXT](https://img.shields.io/badge/Manual-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/Unicode_to_ASCII.txt) [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |
| **Picard - Format Multiple Artists** | Formats multiple artist names consistently. | 1.0.0 | [![TXT](https://img.shields.io/badge/Manual-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/Format_Multiple_Artists.txt) [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |
| **Picard - Add EP/Single Suffix** | Adds `- EP` or `- Single` to release titles. | 1.0.0 | [![TXT](https://img.shields.io/badge/Manual-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/Add_EP_Single_Suffix.txt) [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |
| **Picard - English Title Capitalization** | Applies English title capitalization rules in Picard. | 1.1.1 | [![TXT](https://img.shields.io/badge/Manual-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/English_Title_Capitalization.txt) [![Picard 3](https://img.shields.io/badge/Picard_3-Git_plugin-0969da?style=for-the-badge)](https://github.com/karpuzikov/userscripts) |

### Picard 3 Git plugin installation

**Current Artist Names Everywhere**, **MusicBrainz Title Capitalization**, the five tagging scripts above, and the Barcode/UPC-first Lookup helper are available through the shared Picard 3 plugin. The five tagging scripts also remain available as individual **Manual .txt** downloads.

For automatic GitHub updates, install the shared **Karpuzikov Picard Scripts** plugin once:

1. Open `Options -> Plugins -> Install Plugin -> URL`.
2. Git URL: `https://github.com/karpuzikov/userscripts.git`
3. Leave `Ref/Tag` empty so Picard uses `main`.
4. Install and enable **Karpuzikov Picard Scripts**.
5. Open `Options -> Plugins -> Karpuzikov Picard Scripts` and enable only the tools/scripts you want.

Picard can then check for and install future updates from its Plugins interface. If Current Artist Names Everywhere is also installed as the old standalone plugin, disable one copy. Do not enable both **MusicBrainz Title Capitalization** and the legacy **English Title Capitalization** script. If the same tagging script is also enabled under `Options -> Scripting`, disable one copy so it is not run twice.

## Audio Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Duplicate Edition Analyzer Lightweight** | Fast graphical WebView2 edition with Changes-first Release Map, acoustic matching and review. | 0.4.2 - Under construction ⚠️ | [![Download](https://img.shields.io/badge/Download-.pyw-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/dea-lightweight-modern/audio-tools/discography-torrent-project/lightweight/Duplicate%20Edition%20Analyzer%20Lightweight%20v0.4.2.pyw) |
| **CUE Filename Fixer - UTF-8 Recursive** | Repairs CUE file references recursively and saves them as UTF-8. | 2.0.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/audio-tools/cue-filename-fixer/CUE_Filename_Fixer_UTF8_Recursive.bat) |
| **AudioChecker UTF-8 Patch (Experimental)** | Patches AudioChecker for UTF-8 support. | Experimental | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/audio-tools/audiochecker-utf8-patch/Install_AudioChecker_UTF8_Patch.bat) |

## Image Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Corrupt Image Verifier** | Recursively verifies image integrity and moves confirmed corrupt files to a sibling `_CORRUPTED` folder while preserving the original folder structure. | 1.0.2 - Under construction ⚠️ | [![Download](https://img.shields.io/badge/Download-.pyw-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/image-tools/corrupt-image-verifier/Corrupt%20Image%20Verifier%20v1.0.2.pyw) |
| **3x3 Image Combiner** | Combines up to nine images into a 3x3 grid. | 2.0.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/image-tools/3x3-image-combiner/Run_3x3_Image_Combiner.bat) |
| **Fast Image to JPG Converter** | Recursively converts supported images to JPG. | 2.0.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/image-tools/fast-image-to-jpg/Fast_Image_to_JPG_Converter.bat) |
| **Photoshop 500px PNG / 600px JPG Batch Exporter** | Batch-exports 500px PNG and 600px JPG images from Photoshop. | 1.4 | [![Download](https://img.shields.io/badge/Download-.jsx-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/image-tools/photoshop-batch-export/Photoshop_Batch_500PNG_600JPG.jsx) |

## Media Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Archive Media Compressor** | Compresses and resizes media archives while preserving their folder structure. | 6.0.13 - Under construction ⚠️ | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/archive-media-compressor/ArchiveMedia%20v6.0.13.bat) |

## Windows Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Priorities** | Exhaustive pairwise preference sorter that compares every item against every other item and exports an AI-readable hierarchy. | 0.1.0 - Under construction ⚠️ | [![Download](https://img.shields.io/badge/Download-.pyw-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/windows-tools/priorities/Priorities%20v0.1.0.pyw) |
| **Requirements Manager** | Installs Python requirements and required dependencies automatically. | 1.1.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/windows-tools/requirements-manager/Requirements_Manager.bat) |

## Game Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **DriveV One-Click Auto Installer** | Installs or updates DriveV with one click. | 2.1.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/game-tools/drivev-one-click-installer/Install_DriveV.bat) |

## Backup Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Backup and Restore Windows Drivers** | Backs up and restores Windows drivers. | 1.0.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/backup-tools/windows-drivers/Backup_and_Restore_Windows_Drivers.bat) |
| **Backup and Restore SyncTrayzor & Syncthing** | Backs up and restores SyncTrayzor and Syncthing configuration. | 2.0.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/backup-tools/syncthing-backup/Backup_and_Restore_SyncTrayzor_Syncthing.bat) |
| **Backup and Restore qBittorrent** | Backs up and restores qBittorrent data. | 2.1.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/backup-tools/qbittorrent-backup/Backup_and_Restore_qBittorrent.bat) |

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

## Development rules

Repository-wide software rules: [SOFTWARE_RULES.md](SOFTWARE_RULES.md)
