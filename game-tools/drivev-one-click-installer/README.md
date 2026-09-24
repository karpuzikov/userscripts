# Drive V One-Click Auto Installer — Legacy + Enhanced

Snapshot: **2026-09-15**.

## Use

1. Extract this ZIP anywhere.
2. Double-click **`Install_DriveV.bat`**.
3. Confirm/select the GTA V folder if auto-detection did not find it.
4. Click **`INSTALL / UPDATE — AUTO-DOWNLOAD`**.

That is the normal workflow. **You do not download the mod packages yourself.** The installer resolves the current official download links, downloads the archives to its private `Packages` cache, extracts them, and continues automatically.

If Python is not installed, the launcher first tries Windows Package Manager (`winget`) and then falls back to the official Python 3.12 installer from python.org. If a downloaded RAR/7z needs 7-Zip and Windows' built-in `tar` cannot extract it, the tool installs 7-Zip with `winget` automatically.

## Automatic download sources

The installer resolves downloads from the original project pages:

- Drive V — GTA5-Mods
- CodeWalker OIV Package Installer — GTA5-Mods
- Script Hook V — AB Software Development (`dev-c.com`)
- Simple Trainer — GTA5-Mods
- InversePower — GTA5-Mods
- RageOpenV — GTA5-Mods, only for Legacy when no compatible mods-folder loader already exists
- OpenRPF — GTA5-Mods, Enhanced only
- ENBSeries GTA V — ENBDev, Legacy only
- Subtle Scratches (and Dents) — GTA5-Mods, optional resource not automated by this installer

For GTA5-Mods, the installer reads the mod page, selects the newest `/download/<id>` version, then follows the site's own `files.gta5-mods.com` file URL. It does not scrape a search engine or use third-party mirrors.

## What is installed

### GTA V Legacy

Drive V; Script Hook V + ASI loader; existing OpenIV.asi/RageOpenV.asi or automatically downloaded RageOpenV; Simple Trainer; InversePower; Drive V's recommended InversePower config when bundled; ENB using Drive V's `d3d11.dll` + `d3d12.dll` setup; Drive V traffic edits and AI-driving improvements (enabled by default).

Subtle Scratches is not automated by this installer.

### GTA V Enhanced

Base Drive V through the Enhanced-capable CodeWalker OIV path; Script Hook V; Simple Trainer; InversePower; OpenRPF. Drive V's optional traffic edits and AI-driving improvements are selectable on Enhanced and are installed exactly according to the checkboxes.

ENB and the Legacy `fxdecal.ytd` texture replacement are not automated on Enhanced because they are separate Legacy/Gen8 resources, not Drive V traffic/AI option modules.

## Safety / restore

- Story mode only. Do not use this mod stack in GTA Online.
- Original game RPFs are not edited directly by this wrapper; OIV work is delegated to CodeWalker and uses the game `mods` path.
- The wrapper passes CodeWalker `--force` only for OIVs that do **not** declare a game version. This suppresses CodeWalker's redundant second GTA-folder prompt after this installer has already validated the selected folder. Explicit Legacy/Enhanced OIVs keep CodeWalker's normal compatibility guard.
- Every loose DLL/ASI/INI file replaced by this wrapper is backed up first.
- Exact OIVs used for installation are retained under `<GTA V>\_DriveV_AutoInstaller\` for smart uninstall.
- Uninstall resolves the retained OIV package name itself and calls CodeWalker with `--uninstall <name> --game <saved path>`, so CodeWalker does not reopen its GTA-folder picker for Drive V's unversioned OIV.
- Use **UNINSTALL / RESTORE** in the GUI to undo the installation, or launch `Install_DriveV.bat --restore`.

## Network failures

The installer retries downloads three times. If an upstream author changes hosting away from its official downloadable endpoint, the installer stops with the exact component that failed rather than silently installing an unknown mirror.

## GTA V path detection and memory

- **Detect** checks Steam libraries (including libraries on D:, E:, etc.), Epic launcher manifests, Rockstar registry locations, and common GTA V folders on every fixed/removable Windows drive.
- The last valid GTA V folder is saved to `%LOCALAPPDATA%\DriveV_AutoInstaller\settings.json` and restored automatically the next time the installer starts.
- The saved path survives replacing or re-extracting this installer.

## Automatic dependency setup

`Install_DriveV.bat` checks WinGet first. If WinGet is missing, it bootstraps it automatically. It then installs or updates Python 3.13 and 7-Zip before launching the installer GUI. Restore mode uses the same `Install_DriveV.bat` setup path.


## Single-file distribution

The user-facing download is now only `Install_DriveV.bat`. It bootstraps WinGet, Python 3.13, and 7-Zip, then downloads/updates the self-contained `DriveV_AutoInstaller.pyw` into the per-user application folder and launches it.

The Python GUI no longer requires a separate `.py` helper or separate JSON manifest file. Restore is available from the GUI and can also be launched with:

`Install_DriveV.bat --restore`
