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
- MusicBrainz / AcoustID identifiers and other identifier tags are not modified.

## Interaction with tagging scripts

The plugin registers its metadata processors at low priority (`-100`) so it runs late in plugin metadata processing. Picard tagging scripts run on the resulting metadata, so a script that moves featured artists into the title will receive the normalized current artist name.

## Installation in Picard 3

This directory is a Picard 3 plugin repository. In Picard:

1. Options -> Plugins -> Install Plugin...
2. Choose **Local**.
3. Select this extracted repository directory.
4. Install / enable it.
5. Reload releases already open in Picard so their metadata is processed again.



## 0.2.0

Fixed recursive alias expansion where a short alias inside an already-canonical artist name could duplicate the name (for example `Krizz Kaliko` becoming `Krizz Krizz Kaliko`). Canonical artist-name spans are now protected during replacement while standalone and longer historical credits still normalize.