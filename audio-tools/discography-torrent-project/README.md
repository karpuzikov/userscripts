# Discography Torrent Project

Complete project source and workflow assets for the discography torrent automation project.

## Current tools

- `tools/Duplicate Edition Analyzer v0.9.9.pyw` - duplicate/edition filtering. Not tested! ⚠️
- `tools/AudioChecker Automation v0.1.pyw` - AudioChecker batch automation.
- `tools/ALAC Conversion Automation v0.2.pyw` - lossless -> ALAC conversion. Not tested! ⚠️
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
