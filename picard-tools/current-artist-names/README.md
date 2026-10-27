# Current Artist Names Everywhere

Picard 3.x metadata plugin that replaces historical / credited / alias artist names with the artist entity's **current MusicBrainz name** everywhere in loaded metadata, including track titles.

## Example

If an artist entity is currently named `Ubi`, but an older MusicBrainz credit says `Ubiquitous` or `Ubi of Ces Cru`, metadata such as:

- `artist = Tech N9ne feat. Ubiquitous`
- `artists = [Tech N9ne, Ubiquitous]`
- `title = Example (feat. Ubiquitous)`
- `albumartist = Ubiquitous`

is normalized to use `Ubi`.

The plugin is generic. It does not contain any hard-coded artist names or MBIDs.

## What it uses

Picard normally requests `artists`, `artist-credits`, and `aliases` with releases / tracks. The plugin reads that already-loaded MusicBrainz data. It does not make a separate request for every artist.

It also scans artist relationships that are present in the MusicBrainz nodes, so relationship-derived tags can be normalized when the corresponding Picard relationship options are enabled.

## Safety

- Only artists actually linked to the current release / track are considered.
- Replacement is boundary-aware, not a blind substring replacement.
- Longer historical names are replaced before shorter ones.
- Ambiguous aliases mapping to multiple linked artists are skipped.
- Canonical names of other linked artists are protected.
- MusicBrainz / AcoustID identifiers, dates and catalog numbers are not modified.
- Punctuation-only and numeric-only aliases cannot act as global artist-name replacements.

## Interaction with tagging scripts

The plugin registers its metadata processors at low priority (`-100`) so it runs late in plugin metadata processing. Picard tagging scripts run on the resulting metadata, so a script that moves featured artists into the title will receive the normalized current artist name.

## Installation in Picard 3

Recommended Git-updatable installation:

1. Open `Options -> Plugins -> Install Plugin -> URL`.
2. Git URL: `https://github.com/karpuzikov/userscripts.git`
3. Leave `Ref/Tag` empty so Picard uses `main`.
4. Install and enable **Karpuzikov Picard Scripts**.
5. Open `Options -> Plugins -> Karpuzikov Picard Scripts`.
6. Enable **Current Artist Names Everywhere**.
7. Reload releases already open in Picard so their metadata is processed again.

The standalone plugin in this directory remains available for compatibility. Do not enable both copies at the same time.



## 0.2.3

Fixed short alias expansion inside apostrophized artist names. For example, `Cam` no longer expands within `Cam'ron` to create `Cam'ron'ron`; instead, straight and curly apostrophe variants of complete canonical names are recognized before short aliases. Shared plugin v1.5.36 includes the same fix.

## 0.2.2

Special-purpose MusicBrainz artist `[unknown]` (MBID `125ec42a-7229-4250-afc5-e057484327fe`) can be credited as `God` on Kanye West's `I Am a God` track. Such credits should remain verbatim, including in the title `I Am a God (ft. God)`. This version no longer maps credited names of that special-purpose entity to `[unknown]`.

## 0.2.1

Fixed metadata corruption caused by punctuation-only artist aliases (e.g. a hyphen credited to the special artist `[unknown]`). Preserves date fields and catalog numbers even when a linked artist has a conflicting text alias. Shared Picard plugin v1.5.32 contains the same safeguards.

## 0.2.0

Fixed recursive alias expansion where a short alias inside an already-canonical artist name could duplicate the name (for example `Krizz Kaliko` becoming `Krizz Krizz Kaliko`). Canonical artist-name spans are now protected during replacement while standalone and longer historical credits still normalize.

## Dependency bootstrap

`Download_Current_Artist_Names_Plugin.bat` checks WinGet first. If MusicBrainz Picard is missing, it installs Picard automatically. If the existing Picard installation is managed by WinGet, it checks for updates.

If Picard is already installed outside WinGet, the downloader leaves that installation alone. This preserves prerelease or custom release channels instead of silently replacing them with WinGet's stable package.


## File layout

The downloader itself is one BAT. The installed Picard plugin uses only two runtime files: `__init__.py` and `MANIFEST.toml`. The `__init__.py` filename is required by the Picard/Python plugin format, so converting it to `.pyw` would break the plugin.
