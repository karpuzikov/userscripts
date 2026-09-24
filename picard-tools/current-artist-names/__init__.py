# SPDX-License-Identifier: GPL-2.0-or-later
"""Current Artist Names Everywhere for MusicBrainz Picard 3.x.

The plugin maps historical / "credited as" / alias forms of artists that are
actually present in the loaded MusicBrainz release / track data to the current
canonical MusicBrainz artist name (the artist entity's current ``name``).

It then applies those mappings to all string metadata values, including titles,
while using canonical sort names for tags whose name contains ``sort``.

Safety measures:
* Only artists linked to the current release / track are considered.
* Whole-name boundaries are used for replacements.
* Longer old names are replaced before shorter ones.
* Ambiguous old names that map to multiple current artists are skipped.
* A name that is itself the canonical name of another linked artist is protected.
* Short aliases are never expanded inside an already-canonical artist name.
"""

from __future__ import annotations

from collections import defaultdict
import re
from typing import Any


PLUGIN_PRIORITY = -100  # Run late, after most metadata-modifying plugins.

# Tags where textual artist-name replacement would be inappropriate even if a
# name happened to occur by chance. Most technical tags would never match, but
# explicitly skipping identifiers is safer.
SKIP_TAG_PREFIXES = (
    "musicbrainz_",
    "acoustid_",
)
SKIP_TAGS = {
    "barcode",
    "asin",
    "isrc",
    "iswc",
    "musicip_puid",
    "musicip_fingerprint",
}


class _ArtistMaps:
    """Collect unambiguous old-name -> current-name mappings."""

    def __init__(self) -> None:
        self._names: dict[str, set[str]] = defaultdict(set)
        self._sorts: dict[str, set[str]] = defaultdict(set)
        self.canonical_names: set[str] = set()
        self.canonical_sorts: set[str] = set()

    @staticmethod
    def _clean(value: Any) -> str:
        if value is None:
            return ""
        return str(value).strip()

    def add_artist(self, artist: Any, credited_name: Any = None) -> None:
        if not isinstance(artist, dict):
            return

        current_name = self._clean(artist.get("name"))
        if not current_name:
            return

        current_sort = self._clean(artist.get("sort-name")) or current_name
        self.canonical_names.add(current_name)
        self.canonical_sorts.add(current_sort)

        # The exact historical / release-specific "credited as" value.
        self._add_name_variant(credited_name, current_name)
        self._add_sort_variant(credited_name, current_sort)

        # Include aliases supplied by MusicBrainz for linked artists. Some old
        # credits are short aliases (e.g. "Kaliko" -> "Krizz Kaliko"), so the
        # replacement stage must protect already-canonical names from recursive
        # expansion.
        aliases = artist.get("aliases") or []
        if isinstance(aliases, list):
            for alias in aliases:
                if not isinstance(alias, dict):
                    continue
                alias_name = alias.get("name")
                alias_sort = alias.get("sort-name")
                self._add_name_variant(alias_name, current_name)
                self._add_sort_variant(alias_name, current_sort)
                self._add_sort_variant(alias_sort, current_sort)

    def _add_name_variant(self, old: Any, current: str) -> None:
        old_name = self._clean(old)
        if old_name and old_name != current:
            self._names[old_name].add(current)

    def _add_sort_variant(self, old: Any, current_sort: str) -> None:
        old_name = self._clean(old)
        if old_name and old_name != current_sort:
            self._sorts[old_name].add(current_sort)

    def finalize(self) -> tuple[dict[str, str], dict[str, str], set[str], set[str]]:
        name_map: dict[str, str] = {}
        sort_map: dict[str, str] = {}

        # Keep only one-to-one mappings. Also protect the canonical name of any
        # other artist in the same context from being treated as somebody else's
        # alias.
        for old, targets in self._names.items():
            if len(targets) != 1:
                continue
            target = next(iter(targets))
            if old in self.canonical_names and old != target:
                continue
            name_map[old] = target

        for old, targets in self._sorts.items():
            if len(targets) != 1:
                continue
            target = next(iter(targets))
            if old in self.canonical_sorts and old != target:
                continue
            sort_map[old] = target

        return name_map, sort_map, set(self.canonical_names), set(self.canonical_sorts)


def _collect_artist_data(node: Any, maps: _ArtistMaps) -> None:
    """Recursively collect artist entities and their local credited forms."""
    if isinstance(node, list):
        for item in node:
            _collect_artist_data(item, maps)
        return

    if not isinstance(node, dict):
        return

    # Artist credits on releases, recordings and tracks.
    credits = node.get("artist-credit")
    if isinstance(credits, list):
        for credit in credits:
            if not isinstance(credit, dict):
                continue
            artist = credit.get("artist")
            if isinstance(artist, dict):
                maps.add_artist(artist, credit.get("name"))

    # Artist targets in relationships. ``target-credit`` is the relationship's
    # "credited as" value when one exists.
    artist = node.get("artist")
    if isinstance(artist, dict) and artist.get("name"):
        maps.add_artist(artist, node.get("target-credit"))

    # Recurse to find nested recording / work / relationship artists as well.
    for value in node.values():
        _collect_artist_data(value, maps)


def _make_pattern(name: str) -> re.Pattern[str]:
    """Create a conservative whole-name pattern for an exact artist name."""
    escaped = re.escape(name)

    # Only require a word boundary on a side when the name begins / ends in a
    # word character. This still handles artist names ending in punctuation.
    left = r"(?<!\w)" if name and (name[0].isalnum() or name[0] == "_") else ""
    right = r"(?!\w)" if name and (name[-1].isalnum() or name[-1] == "_") else ""
    return re.compile(left + escaped + right)


def _canonical_spans(text: str, canonical_names: set[str]) -> list[tuple[int, int]]:
    """Return spans occupied by complete current/canonical artist names."""
    spans: list[tuple[int, int]] = []
    for name in canonical_names:
        if not name or name not in text:
            continue
        for match in _make_pattern(name).finditer(text):
            spans.append(match.span())
    return spans


def _span_inside_any(start: int, end: int, spans: list[tuple[int, int]]) -> bool:
    """Whether [start,end) lies entirely inside one protected canonical span."""
    return any(start >= protected_start and end <= protected_end
               for protected_start, protected_end in spans)


def _replace_text(
    text: str,
    replacements: dict[str, str],
    canonical_names: set[str] | None = None,
) -> str:
    if not text or not replacements:
        return text

    result = text
    protected_names = canonical_names or set()

    # Replace the most specific / longest historical forms first, e.g.
    # "Ubiquitous of Ces Cru" before "Ubiquitous". Before each alias pass,
    # detect complete canonical artist names already present in the current
    # text. If a shorter alias match is entirely *inside* such a canonical
    # name, leave it alone. This prevents e.g. "Kaliko" -> "Krizz Kaliko"
    # from turning an already-correct "Krizz Kaliko" into
    # "Krizz Krizz Kaliko" while standalone "Kaliko" still normalizes.
    for old in sorted(replacements, key=len, reverse=True):
        if old not in result:
            continue

        pattern = _make_pattern(old)
        protected_spans = _canonical_spans(result, protected_names)
        replacement = replacements[old]

        def replace_match(match: re.Match[str]) -> str:
            if _span_inside_any(match.start(), match.end(), protected_spans):
                return match.group(0)
            return replacement

        result = pattern.sub(replace_match, result)

    return result


def _skip_tag(tag: str) -> bool:
    lower = tag.lower().lstrip("~")
    if lower in SKIP_TAGS:
        return True
    return any(lower.startswith(prefix) for prefix in SKIP_TAG_PREFIXES)


def _normalize_metadata(
    api: Any,
    metadata: Any,
    name_map: dict[str, str],
    sort_map: dict[str, str],
    canonical_names: set[str],
    canonical_sorts: set[str],
) -> None:
    """Apply artist-name mappings to every applicable metadata string."""
    if not name_map and not sort_map:
        return

    changed_tags = 0

    # Metadata stores multi-value tags internally as lists. Snapshot rawitems()
    # before modifying them to avoid mutating the mapping while iterating.
    try:
        items = [(tag, list(values)) for tag, values in metadata.rawitems()]
    except Exception:
        items = [(tag, list(metadata.getall(tag))) for tag in list(metadata)]

    for tag, values in items:
        if _skip_tag(tag):
            continue

        is_sort = "sort" in tag.lower()
        replacements = sort_map if is_sort else name_map
        protected = canonical_sorts if is_sort else canonical_names
        if not replacements:
            continue

        new_values: list[str] = []
        changed = False
        for value in values:
            text = str(value)
            new_text = _replace_text(text, replacements, protected)
            new_values.append(new_text)
            if new_text != text:
                changed = True

        if changed:
            metadata[tag] = new_values
            changed_tags += 1

    if changed_tags:
        api.logger.debug("Normalized current artist names in %d metadata tag(s)", changed_tags)


def _maps_for_nodes(
    *nodes: Any,
) -> tuple[dict[str, str], dict[str, str], set[str], set[str]]:
    maps = _ArtistMaps()
    for node in nodes:
        if node:
            _collect_artist_data(node, maps)
    return maps.finalize()


def process_album(api: Any, album: Any, metadata: Any, release_node: Any) -> None:
    name_map, sort_map, canonical_names, canonical_sorts = _maps_for_nodes(release_node)
    _normalize_metadata(
        api, metadata, name_map, sort_map, canonical_names, canonical_sorts
    )


def process_track(
    api: Any,
    track: Any,
    metadata: Any,
    track_node: Any,
    release_node: Any = None,
) -> None:
    # Include the release node as well so album-artist fields copied onto track
    # metadata are normalized too.
    name_map, sort_map, canonical_names, canonical_sorts = _maps_for_nodes(
        track_node, release_node
    )
    _normalize_metadata(
        api, metadata, name_map, sort_map, canonical_names, canonical_sorts
    )


def enable(api: Any) -> None:
    api.logger.info("Current Artist Names Everywhere enabled")
    api.register_album_metadata_processor(process_album, priority=PLUGIN_PRIORITY)
    api.register_track_metadata_processor(process_track, priority=PLUGIN_PRIORITY)