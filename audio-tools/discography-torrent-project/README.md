# Discography Torrent Project

Complete project source and workflow assets for the discography torrent automation project.

## Current tools

- `tools/Duplicate Edition Analyzer v0.19.1.pyw` - Fixes FFmpeg/FFprobe dependency setup. After the required WinGet attempt, the analyzer now discovers binaries directly inside WinGet package storage even when the current process PATH/WinGet Links were not refreshed. If WinGet still cannot provide usable binaries, it downloads the official Gyan FFmpeg release essentials ZIP into `Documents\\Karpuzikov Tools\\Duplicate Edition Analyzer\\dependencies\\FFmpeg` and uses that isolated app-owned copy. v0.19.0 exact global optimization remains intact. Under construction ⚠️
- `tools/AudioChecker Automation v0.1.pyw` - AudioChecker batch automation.
- `tools/ALAC Conversion Automation v0.2.pyw` - lossless -> ALAC conversion. Under construction ⚠️
- `tools/CUE Corrector - MusicBrainz DiscID 1.3.1.pyw` - MusicBrainz DiscID/CUE workflow.
- `tools/Folder Structure Scanner.pyw` - recursive folder structure report.

## Existing workflow assets

- `workflow/CUE LOG 4.1.pyw`
- `workflow/Photoshop script 500png 600jpg 1.4.jsx`
- `workflow/ALAC + header.mte`
- `workflow/Мой стандарт.mta`

## Project documentation

- `PROJECT.md` - workflow, implementation status, and integration plan.
- `RULES.md` - canonical duplicate/edition/source-selection rules.

## Repository rule

This directory is the canonical source of truth for the project. Every project-owned script, workflow asset, and documentation change must be committed here when it changes.

Third-party applications and binaries such as AudioChecker, CUETools, refalac, FFmpeg, Picard, Mp3tag, xrecode2, Photoshop, qBittorrent, MediaHuman Lyrics Finder, and the original CueCorrectorNET application are dependencies/reference software and are not vendored into this repository.

## CD rip log scoring

Duplicate Edition Analyzer uses [hey-bro-check-log](https://github.com/ligh7s/hey-bro-check-log) v1.3.2 (Apache-2.0), pinned to commit `d3192ad2764f2682cffce4db2abc419f8ac68c69`, as an auto-installed runtime dependency for supported EAC/XLD logs. Log score is only a quality tie-break between otherwise exact-equivalent CD rips; it never creates duplicate identity or replaces a different edition.


## Release Map

After every analysis, Duplicate Edition Analyzer opens a release-only network before filesystem changes. The canvas contains releases only: click a connected release node to move through the dependency web. Details are shown separately below the map with a draggable divider so the track list can take as much vertical space as needed.

The selected release shows its true retention/removal reason, source, selectable path, Copy path, Open folder, and a full high-contrast track list. Yellow tracks are unique to that retained release; red tracks warn that a manual release removal would leave the recording uncovered. If same/similar titles are intentionally kept as separate recordings, the track status explains the visible reason when available (artist/featured credit, ISRC, length) and explicitly says when Chromaprint is what differs.

During a live analysis, click a track and use **Skip track** to remove that recording group from optimization. The choice is saved in `Documents\Karpuzikov Tools\Duplicate Edition Analyzer\state\manual_track_skips.json` and is reapplied automatically in future analyses using the recording's saved fingerprint/identifier evidence. **Restore track** removes that saved preference. Release-level manual removal remains reversible and re-runs only the collection optimizer against already-computed audio groups.

The Release Map is a normal resizable/maximizable Windows top-level window (no modal/transient grab), so it can be positioned with FancyZones. **Apply plan**, **Analyze again**, and **Close** are always explicit live-analysis actions. The last map snapshot remains available read-only from the main window after the in-memory analysis context is gone.
