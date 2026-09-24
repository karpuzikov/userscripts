# Userscripts & Tools

A collection of Tampermonkey userscripts, MusicBrainz/Picard helpers, Windows utilities, image tools, game installers, and backup scripts.

## Browser Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Instagram Force Full Quality Media** | Forces the highest-quality Instagram post/Reel media while leaving profile, search, and Explore thumbnails untouched. | 4.0.0 | [![Download](https://img.shields.io/badge/Download-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/instagram-full-quality/Instagram_Force_Full_Quality_Media.user.js) |
| **YYYY-MM-DD for All** | Converts dates to `YYYY-MM-DD` on CDJapan, IAFD, setlist.fm, and Blu-ray.com. Adapter-based design makes more websites easy to add later. | 1.0.0 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/yyyy-mm-dd-for-all/YYYY-MM-DD_for_All.user.js) |
| **BPTopTracker -> Beatport** | Redirects BPTopTracker 500 Server Error pages to the equivalent Beatport URL. | 1.0 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/bptoptracker-to-beatport/BPTopTracker_to_Beatport.user.js) |
| **Genius Lyrics Copier** | Adds a one-click Copy Lyrics button to Genius and cleans annotations, page clutter, and spacing before copying. | 1.9 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/browser-tools/genius-lyrics-copier/Genius_Lyrics_Copier.user.js) |

## MusicBrainz Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **MusicBrainz BOIU Cover Art Removal** | Adds a **BOIU** button next to Edit/Remove for each cover image. One click removes that image with the edit note `better one is uploaded`. | 1.0.0 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/MusicBrainz_BOIU_Cover_Art_Removal.user.js) |
| **MusicBrainz Release Events -> Worldwide** | Replaces all release events with one `[Worldwide]` event while preserving the existing release date. | 1.0.0 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/musicbrainz-tools/release-events-worldwide/MusicBrainz_Release_Events_Worldwide.user.js) |
| **Apple Music Barcodes/ISRCs** | Improved fork for extracting Apple Music barcodes, ISRCs, and metadata with a dark theme, centered table, selectable text, and one-click ISRC copying. | 0.24 | [![Install](https://img.shields.io/badge/Install-.user.js-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/apple-music-barcode-isrc/master/apple-music-barcode-isrc.user.js) |

## MusicBrainz Picard Tools

| Project | Description | Version | Download |
| --- | --- | ---: | --- |
| **Picard - Current Artist Names Everywhere** | Replaces historical/credited/alias artist names with the current MusicBrainz artist name. Its downloader bootstraps WinGet and installs Picard when missing while preserving non-WinGet prerelease/custom installations. | 0.2.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/current-artist-names/Download_Current_Artist_Names_Plugin.bat) |
| **Picard - Move Featured Artists to Title** | Moves featured credits into the title using `(ft. Artist)` and removes the featured credit from artist/album artist fields. | - | [![Download](https://img.shields.io/badge/Download-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/Move_Featured_Artists_to_Title.txt) |
| **Picard - Unicode to ASCII** | Normalizes common Unicode punctuation and symbols to ASCII while keeping Unicode letters intact. | - | [![Download](https://img.shields.io/badge/Download-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/Unicode_to_ASCII.txt) |
| **Picard - Format Multiple Artists** | Formats multiple artists as `A & B` or `A, B & C`. | - | [![Download](https://img.shields.io/badge/Download-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/Format_Multiple_Artists.txt) |
| **Picard - Add EP/Single Suffix** | Adds ` - EP` or ` - Single` to release titles based on the primary release type. | - | [![Download](https://img.shields.io/badge/Download-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/Add_EP_Single_Suffix.txt) |
| **Picard - English Title Capitalization** | Applies the Picard title-capitalization rules used in this collection while preserving ambiguous words such as `Up`, `In`, `On`, `Off`, and `By`. | - | [![Download](https://img.shields.io/badge/Download-.txt-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/picard-tools/scripts/English_Title_Capitalization.txt) |

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
| **SyncTrayzor & Syncthing Backup** | Creates a verified timestamped ZIP of SyncTrayzor/Syncthing configuration, supports relocated current-user profiles, and refuses to copy live-changing config while either app is running. | 1.1.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/backup-tools/syncthing-backup/SyncTrayzor_Syncthing_Backup.bat) |
| **qBittorrent Backup & Restore** | Single BAT with Backup/Restore menu. Creates timestamped ZIP backups (`YYYY-MM-DD-HH-MM`) and restores the newest backup with automatic WinGet bootstrap. | 2.0.0 | [![Download](https://img.shields.io/badge/Download-.bat-2ea44f?style=for-the-badge)](https://raw.githubusercontent.com/karpuzikov/userscripts/main/backup-tools/qbittorrent-backup/qBittorrent_Backup_Restore.bat) |

## Dependency Bootstrap, Credentials, and Software Layout

Standalone Windows entrypoints check WinGet first. If it is missing, they bootstrap WinGet automatically, then install or update the dependencies required by that tool. See [Windows Dependency Bootstrap Policy](windows-tools/DEPENDENCY_BOOTSTRAP.md).

Software that explicitly manages authentication stores protected credentials under the dynamically resolved Windows Documents library at `Software Credentials\\<App Name>`, migrates legacy locations when practical, and reuses that store across updates.

Repository software also follows these layout rules:
- Prefer a single BAT or PYW whenever technically practical.
- Python GUI software uses `.pyw` rather than `.py`.
- A `.py` helper is only acceptable when the software is launched through a BAT and merging it would materially hurt reliability.
- Redundant launchers/helpers are embedded or removed where practical.
- Host-required formats such as Picard `__init__.py`, Tampermonkey `.user.js`, and Photoshop `.jsx` keep the filenames required by their host applications.

## Notes

- Tampermonkey userscripts use direct `.user.js` links so clicking **Install** should open the userscript installer when Tampermonkey is installed.
- When a host format genuinely requires multiple runtime files, the downloadable BAT creates or downloads only the minimum required files.
- Source files remain available in their project folders.

## License

MIT