# SPDX-License-Identifier: MIT
"""Current artist-name normalization used by the shared Picard 3 plugin."""

from collections import defaultdict
import re


_MBID_PATTERN = re.compile(r"^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$", re.I)

# Special-purpose artist: preserve its release-specific credited names such as "God".
_UNKNOWN_ARTIST_MBID = "125ec42a-7229-4250-afc5-e057484327fe"


_SKIP_PREFIXES = ("musicbrainz_", "acoustid_")
_SKIP_TAGS = {
    "barcode",
    "asin",
    "isrc",
    "iswc",
    "musicip_puid",
    "musicip_fingerprint",
    # Structured identifiers are never artist-name text.
    "date",
    "originaldate",
    "releasedate",
    "originalyear",
    "year",
    "catalognumber",
    "catalognumbers",
}


class _ArtistMaps:
    def __init__(self, exceptions=None):
        self.exceptions = exceptions or {}
        self.names = defaultdict(set)
        self.sorts = defaultdict(set)
        self.canonical_names = set()
        self.canonical_sorts = set()

    @staticmethod
    def _clean(value):
        return "" if value is None else str(value).strip()

    def add(self, artist, credited_name=None):
        if not isinstance(artist, dict):
            return

        current = self._clean(artist.get("name"))
        if not current:
            return

        current_sort = self._clean(artist.get("sort-name")) or current
        artist_mbid = self._clean(artist.get("id")).lower()
        preferred = self.exceptions.get(artist_mbid)
        if artist_mbid == _UNKNOWN_ARTIST_MBID and not preferred:
            return  # Do not turn "God" or other credited names into "[unknown]".
        target_name = preferred or current
        target_sort = preferred or current_sort
        self.canonical_names.add(target_name)
        self.canonical_sorts.add(target_sort)

        if preferred:
            # Only this exact MusicBrainz artist entity receives the override.
            self._add(self.names, current, target_name)
            self._add(self.sorts, current, target_sort)
            self._add(self.sorts, current_sort, target_sort)

        self._add(self.names, credited_name, target_name)
        self._add(self.sorts, credited_name, target_sort)

        aliases = artist.get("aliases") or []
        if isinstance(aliases, list):
            for alias in aliases:
                if not isinstance(alias, dict):
                    continue
                self._add(self.names, alias.get("name"), target_name)
                self._add(self.sorts, alias.get("name"), target_sort)
                self._add(self.sorts, alias.get("sort-name"), target_sort)

    def _add(self, mapping, old, current):
        old = self._clean(old)
        # MusicBrainz can credit [unknown] with a lone "-" or another symbol.
        # Such aliases are not artist names safe to substitute in free text.
        if old and old != current and any(char.isalpha() for char in old):
            mapping[old].add(current)

    def finalize(self):
        name_map = {}
        sort_map = {}

        for old, targets in self.names.items():
            if len(targets) != 1:
                continue
            target = next(iter(targets))
            if old in self.canonical_names and old != target:
                continue
            name_map[old] = target

        for old, targets in self.sorts.items():
            if len(targets) != 1:
                continue
            target = next(iter(targets))
            if old in self.canonical_sorts and old != target:
                continue
            sort_map[old] = target

        return name_map, sort_map, self.canonical_names, self.canonical_sorts


def _collect(node, maps):
    if isinstance(node, list):
        for item in node:
            _collect(item, maps)
        return
    if not isinstance(node, dict):
        return

    credits = node.get("artist-credit")
    if isinstance(credits, list):
        for credit in credits:
            if not isinstance(credit, dict):
                continue
            artist = credit.get("artist")
            if isinstance(artist, dict):
                maps.add(artist, credit.get("name"))

    artist = node.get("artist")
    if isinstance(artist, dict) and artist.get("name"):
        maps.add(artist, node.get("target-credit"))

    for value in node.values():
        _collect(value, maps)


def _pattern(name):
    escaped = re.escape(name)
    left = r"(?<!\w)" if name and (name[0].isalnum() or name[0] == "_") else ""
    right = r"(?!\w)" if name and (name[-1].isalnum() or name[-1] == "_") else ""
    return re.compile(left + escaped + right)


def _canonical_spans(text, canonical_names):
    spans = []
    for name in canonical_names:
        if name and name in text:
            spans.extend(match.span() for match in _pattern(name).finditer(text))
    return spans


def _replace(text, replacements, canonical_names):
    result = text
    for old in sorted(replacements, key=len, reverse=True):
        if old not in result:
            continue

        protected = _canonical_spans(result, canonical_names)
        replacement = replacements[old]

        def repl(match):
            start, end = match.span()
            if any(start >= a and end <= b for a, b in protected):
                return match.group(0)
            return replacement

        result = _pattern(old).sub(repl, result)
    return result


def _skip_tag(tag):
    lower = str(tag).lower().lstrip("~")
    return (
        lower in _SKIP_TAGS
        or lower.endswith("date")
        or any(lower.startswith(p) for p in _SKIP_PREFIXES)
    )


def _parse_exceptions(text):
    """Parse only 'artist MBID => Preferred Name' entries, never name-based rules."""
    rules = {}
    for line in str(text or "").splitlines():
        if "=>" not in line:
            continue
        mbid, preferred = (part.strip() for part in line.split("=>", 1))
        if _MBID_PATTERN.fullmatch(mbid) and preferred:
            rules[mbid.lower()] = preferred
    return rules


def _migrate_legacy_exceptions(text):
    """Upgrade the former shipped Ye rule without guessing other artist IDs."""
    before = str(text or "")
    return "".join(
        line.replace(
            "Ye => Kanye West",
            "164f0d73-1234-4e2c-8743-d77bf2191051 => Kanye West",
            1,
        )
        if line.strip() == "Ye => Kanye West" else line
        for line in before.splitlines(keepends=True)
    )


def _build_maps(*nodes, exceptions=None):
    maps = _ArtistMaps(exceptions)
    for node in nodes:
        if node:
            _collect(node, maps)
    return maps.finalize()


def _normalize(api, metadata, *nodes):
    config = getattr(api, "plugin_config", {})
    try:
        rule_text = config["artist_name_exceptions"]
    except (KeyError, TypeError, AttributeError):
        rule_text = ""
    exceptions = _parse_exceptions(rule_text)
    name_map, sort_map, canonical_names, canonical_sorts = _build_maps(
        *nodes, exceptions=exceptions
    )
    if not name_map and not sort_map:
        return

    try:
        items = [(tag, list(values)) for tag, values in metadata.rawitems()]
    except Exception:
        items = [(tag, list(metadata.getall(tag))) for tag in list(metadata)]

    changed_tags = 0
    for tag, values in items:
        if _skip_tag(tag):
            continue

        is_sort = "sort" in str(tag).lower()
        replacements = sort_map if is_sort else name_map
        protected = canonical_sorts if is_sort else canonical_names
        if not replacements:
            continue

        new_values = []
        changed = False
        for value in values:
            text = str(value)
            new_text = _replace(text, replacements, protected)
            new_values.append(new_text)
            changed = changed or new_text != text

        if changed:
            metadata[tag] = new_values
            changed_tags += 1

    if changed_tags:
        api.logger.debug(
            "Current Artist Names Everywhere normalized %d metadata tag(s)",
            changed_tags,
        )


def normalize_album_artist_names(api, metadata, release_node):
    _normalize(api, metadata, release_node)


def normalize_track_artist_names(api, metadata, track_node, release_node=None):
    _normalize(api, metadata, track_node, release_node)
