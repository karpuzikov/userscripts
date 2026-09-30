# Discography Torrent Project

Complete project source and workflow assets for the discography torrent automation project.

## Current tools

- `tools/Duplicate Edition Analyzer v0.13.0.pyw` - adds an interactive Decision Map for every analyzed release: searchable retained/duplicate list plus a mind-map-style visual explanation of the outcome, direct reason, unique/essential recordings, covering retained releases, Personal Picks, option exclusions, source/rip-quality context, and replacement relationships. The map is shown before moves are applied and the last analysis remains available from the main window and after completion. CUE-image/split-rip comparison, CUETools verification, EAC/XLD scoring, Personal Picks, and collection-wide minimum-track optimization remain included. Under construction ⚠️
- `tools/AudioChecker Automation v0.1.pyw` - AudioChecker batch automation.
- `tools/ALAC Conversion Automation v0.2.pyw` - lossless -> ALAC conversion. Under construction ⚠️
- `tools/CUE Corrector - MusicBrainz DiscID 1.3.pyw` - MusicBrainz DiscID/CUE workflow.
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


## Decision Map

After every analysis, Duplicate Edition Analyzer opens a visual Decision Map before any proposed move is applied. Search or filter releases by Retained/Duplicate and click any release to inspect why it survived or why it was marked redundant. The graph shows the direct optimizer reason, essential/unique recordings, retained releases covering a duplicate, Personal Picks, skipped remix/live/pattern material, source and CD-rip quality context, and relevant replacement/equivalent alternatives. The last Decision Map is stored as application state under `Documents\Karpuzikov Tools\Duplicate Edition Analyzer\state\last_decision_map.json` and can be reopened from the main window; this is structured UI state, not the optional detailed comparison log.
