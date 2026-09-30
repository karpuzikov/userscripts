# Discography Torrent Project

Complete project source and workflow assets for the discography torrent automation project.

## Current tools

- `tools/Duplicate Edition Analyzer v0.11.1.pyw` - optimized audio candidate filtering, absolute Save Remixes/Save Live selection filters, optional detailed comparison logging, intra-release audio deduplication, hey-bro-check-log CD-rip quality scoring, and final ITUNESADVISORY explicit-over-clean tie-breaking. Under construction ⚠️
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

Duplicate Edition Analyzer uses [hey-bro-check-log](https://github.com/ligh7s/hey-bro-check-log) v1.3.2 (Apache-2.0) as an auto-installed runtime dependency for supported EAC/XLD logs. Log score is only a quality tie-break between otherwise exact-equivalent CD rips; it never creates duplicate identity or replaces a different edition.
