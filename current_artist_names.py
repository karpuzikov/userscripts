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
    # Release titles are independent of artist identity, even if text matches.
    "album",
    "albumsort",
}


class _ArtistMaps:
    def __init__(self, exceptions=None):
        self.exceptions = exceptions or {}
        self.names = defaultdict(set)
        self.sorts = defaultdict(set)
        self.override_names = defaultdict(set)
        self.override_sorts = defaultdict(set)
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
            # Store explicit MBID overrides separately; free-text tags must
            # never inherit the replacement just because their words match.
            self._add(self.override_names, current, target_name)
            self._add(self.override_sorts, current, target_sort)
            self._add(self.override_sorts, current_sort, target_sort)
            names = self.override_names
            sorts = self.override_sorts
        else:
            names = self.names
            sorts = self.sorts

        self._add(names, credited_name, target_name)
        self._add(sorts, credited_name, target_sort)

        aliases = artist.get("aliases") or []
        if isinstance(aliases, list):
            for alias in aliases:
                if not isinstance(alias, dict):
                    continue
                self._add(names, alias.get("name"), target_name)
                self._add(sorts, alias.get("name"), target_sort)
                self._add(sorts, alias.get("sort-name"), target_sort)

    def _add(self, mapping, old, current):
        old = self._clean(old)
        # MusicBrainz can credit [unknown] with a lone "-" or another symbol.
        # Such aliases are not artist names safe to substitute in free text.
        if old and old != current and (
            any(char.isalpha() for char in old)
            or mapping is self.override_names
            or mapping is self.override_sorts
        ):
            # Punctuation-only artist names are permitted *only* for explicit
            # MBID overrides, which are limited to artist-credit fields.
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

    def finalize_overrides(self):
        # Do not replace names also used by another credited artist.
        name_map = {}
        sort_map = {}
        for source, targets in self.override_names.items():
            if (len(targets) == 1 and
                    source not in self.canonical_names and
                    source not in self.names and
                    source not in self.sorts):
                name_map[source] = next(iter(targets))
        for source, targets in self.override_sorts.items():
            if (len(targets) == 1 and
                    source not in self.canonical_sorts and
                    source not in self.sorts and
                    source not in self.names):
                sort_map[source] = next(iter(targets))
        return name_map, sort_map


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


def _replace_artist_override(text, replacements, canonical_names):
    """Apply MBID-scoped overrides without substring-matching symbolic names."""
    words = {name: target for name, target in replacements.items()
             if any(char.isalnum() for char in name)}
    result = _replace(text, words, canonical_names)
    # "¥$" is a valid artist entity. For symbol-only names, require a
    # standalone credit delimited by a known artist-joining phrase; never
    # substitute currency or punctuation inside another name.
    join = r"(?:,\s*|;\s*|\s+&\s+|\s+and\s+|\s+(?:feat\.?|ft\.?|featuring|with)\s+)"
    for name, target in replacements.items():
        if any(char.isalnum() for char in name):
            continue
        pattern = re.compile(
            r"(^|" + join + r")" + re.escape(name) + r"(?=$|" + join + r")",
            re.IGNORECASE,
        )
        result = pattern.sub(lambda match: match.group(1) + target, result)
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


def _build_maps_with_overrides(*nodes, exceptions=None):
    maps = _ArtistMaps(exceptions)
    for node in nodes:
        if node:
            _collect(node, maps)
    return (*maps.finalize(), *maps.finalize_overrides())


_ARTIST_ID_TAGS = {
    "artist": "musicbrainz_artistid",
    "artists": "musicbrainz_artistid",
    "artistsort": "musicbrainz_artistid",
    "albumartist": "musicbrainz_albumartistid",
    "albumartists": "musicbrainz_albumartistid",
    "albumartistsort": "musicbrainz_albumartistid",
}


def _matching_override_ids(metadata, tag, exceptions):
    id_tag = _ARTIST_ID_TAGS.get(str(tag).lower().lstrip("~"))
    if not id_tag:
        return False
    try:
        values = metadata.getall(id_tag)
    except (AttributeError, TypeError):
        values = metadata.get(id_tag, ())
    if isinstance(values, str):
        values = [values]
    return bool(set(str(value).lower() for value in (values or ())) & exceptions.keys())


def _normalize(api, metadata, *nodes):
    config = getattr(api, "plugin_config", {})
    try:
        rule_text = config["artist_name_exceptions"]
    except (KeyError, TypeError, AttributeError):
        rule_text = ""
    exceptions = _parse_exceptions(rule_text)
    (name_map, sort_map, canonical_names, canonical_sorts,
     override_names, override_sorts) = _build_maps_with_overrides(
        *nodes, exceptions=exceptions
    )
    if not name_map and not sort_map and not override_names and not override_sorts:
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
        overrides = override_sorts if is_sort else override_names
        protected = canonical_sorts if is_sort else canonical_names
        allow_override = bool(overrides) and _matching_override_ids(
            metadata, tag, exceptions
        )
        if not replacements and not allow_override:
            continue

        new_values = []
        changed = False
        for value in values:
            text = str(value)
            new_text = _replace(text, replacements, protected)
            if allow_override:
                new_text = _replace_artist_override(new_text, overrides, protected)
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
