# Windows Dependency Bootstrap Policy

Standalone Windows tools in this repository follow this startup policy:

1. Check whether WinGet is available.
2. If WinGet is missing, bootstrap the latest WinGet with Microsoft's WinGet repair path, with the App Installer package as a fallback.
3. Check every required external dependency.
4. Install missing dependencies automatically.
5. Check WinGet-managed dependencies for updates and upgrade them when available.
6. Start the tool only after required dependencies are ready.

A first run on a fresh Windows installation may require an internet connection and Windows permission to install software.

## Host-only tools

Some tools execute inside another application instead of as standalone Windows programs:

- Tampermonkey userscripts require a browser userscript manager.
- Photoshop JSX scripts require Adobe Photoshop.
- MusicBrainz Picard script snippets require MusicBrainz Picard.

Those host environments cannot always be installed safely or legally from inside the hosted script. Where practical, this repository provides a Windows downloader or launcher that prepares the host dependency before installing or launching the tool.
