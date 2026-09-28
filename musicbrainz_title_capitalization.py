# SPDX-License-Identifier: MIT
"""MusicBrainz-style capitalization for English release and track titles.

This intentionally limits itself to capitalization. It does not rewrite title
punctuation, add/remove extra-title-information parentheses, or change titles
on releases whose MusicBrainz title language is not English.
"""

from __future__ import annotations

import re
from typing import Any


_MINOR_WORDS = {
    "a", "an", "the",
    "and", "but", "or", "nor",
    "as", "at", "by", "for", "in", "of", "on", "to",
    "cum", "mid", "off", "per", "qua", "re", "up", "via",
}

# Common forms MusicBrainz's own Guess Case treats as uppercase.
_UPPERCASE_WORDS = {
    "dj", "mc", "tv", "mtv", "ep", "lp", "ymca", "nyc", "ny", "ussr",
    "usa", "r&b", "bbc", "fm", "bc", "ac", "dc", "uk", "bpm", "ok",
    "nba", "rza", "gza", "odb", "dmx", "2xlc",
}

_KNOWN_MIXED_CASE = {
    "imac": "iMac",
    "ipad": "iPad",
    "iphone": "iPhone",
    "ipod": "iPod",
    "itunes": "iTunes",
    "tiktok": "TikTok",
    "youtube": "YouTube",
}

# Conservative verb + short-preposition combinations where the preposition is
# functioning as part of a phrasal verb/adverb and therefore stays capitalized.
_PHRASAL_VERBS = {
    ("break", "in"), ("check", "in"), ("come", "in"), ("drop", "in"),
    ("fill", "in"), ("get", "in"), ("give", "in"), ("join", "in"),
    ("let", "in"), ("move", "in"), ("plug", "in"), ("tune", "in"),
    ("turn", "in"), ("walk", "in"),
    ("bring", "on"), ("carry", "on"), ("come", "on"), ("get", "on"),
    ("go", "on"), ("hold", "on"), ("keep", "on"), ("move", "on"),
    ("pass", "on"), ("put", "on"), ("shine", "on"), ("take", "on"),
    ("turn", "on"), ("try", "on"),
    ("come", "by"), ("drop", "by"), ("get", "by"), ("go", "by"),
    ("pass", "by"), ("stand", "by"), ("stop", "by"), ("swing", "by"),
    ("walk", "by"),
}

# Words that identify descriptive extra title information (ETI). MusicBrainz
# requires descriptive ETI to be lowercase while genuine names/title elements
# inside the ETI keep normal title capitalization.
_ETI_HEAD_WORDS = {
    "mix", "remix", "version", "edit", "re-edit", "dub", "live", "remaster",
    "remastered", "remastering", "refix", "remode", "take", "demo",
    "instrumental", "karaoke", "stereo", "mono", "single", "radio", "video",
    "loop",
}
_ETI_MODIFIER_WORDS = _ETI_HEAD_WORDS | {
    "album", "club", "vocal", "power", "extended", "original", "studio",
    "official", "uncensored", "explicit", "clean", "dirty", "acoustic",
    "alternate", "alternative", "bonus", "digital", "deluxe", "promo",
    "promotional", "rap", "techno", "house", "dance", "8-bit",
}

_ROMAN_NUMERAL_RE = re.compile(
    r"(?i)^(?=[mdclxvi]+$)m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$"
)
_WORD_RE = re.compile(
    r"R&B|[^\W_]+(?:[’'][^\W_]+)*(?:[-‐‑‒–—][^\W_]+(?:[’'][^\W_]+)*)*",
    re.UNICODE,
)
_HYPHEN_RE = re.compile(r"([-‐‑‒–—])")
_MAJOR_BOUNDARY_RE = re.compile(r'[:?!—]|["“”]')


def _release_language(metadata: Any, release_node: Any) -> str:
    if isinstance(release_node, dict):
        representation = release_node.get("text-representation")
        if isinstance(representation, dict):
            language = representation.get("language")
            if language:
                return str(language).strip().lower()

    try:
        language = metadata.get("language")
    except Exception:
        language = None

    if isinstance(language, (list, tuple)):
        language = language[0] if language else None

    return str(language).strip().lower() if language else ""


def _is_mixed_case(word: str) -> bool:
    letters = "".join(char for char in word if char.isalpha())
    if not letters:
        return False
    if letters.islower() or letters.isupper():
        return False
    return not (letters[0].isupper() and letters[1:].islower())


def _capitalize_piece(piece: str) -> str:
    lower = piece.lower()

    if lower in _UPPERCASE_WORDS:
        return lower.upper()

    if lower in _KNOWN_MIXED_CASE:
        return _KNOWN_MIXED_CASE[lower]

    if (
        _ROMAN_NUMERAL_RE.fullmatch(lower)
        and lower not in {"mi", "mix"}
    ):
        return lower.upper()

    # Preserve an already-deliberate internal mixed-case form such as eMOTIVe.
    if _is_mixed_case(piece):
        return piece

    if re.fullmatch(r"o['’]clock", lower):
        separator = "’" if "’" in piece else "'"
        return "O" + separator + "Clock"

    if lower.startswith("mc") and len(lower) > 2 and lower[2].isalpha():
        return "Mc" + lower[2].upper() + lower[3:]

    return lower[:1].upper() + lower[1:]


def _style_word(
    word: str,
    *,
    segment_start: bool,
    segment_end: bool,
    force_major: bool = False,
) -> str:
    lower_word = word.lower()

    # MusicBrainz Guess Case and style examples treat this as a normal
    # title element outside descriptive ETI.
    if lower_word == "re-edit":
        return "Re-Edit"

    parts = _HYPHEN_RE.split(word)
    component_indexes = list(range(0, len(parts), 2))
    component_position = {index: pos for pos, index in enumerate(component_indexes)}

    output: list[str] = []
    for index, part in enumerate(parts):
        if index % 2:
            output.append(part)
            continue

        lower = part.lower()
        position = component_position[index]
        positional_cap = (
            (segment_start and position == 0)
            or (segment_end and position == len(component_indexes) - 1)
        )

        if lower in _MINOR_WORDS and not positional_cap and not force_major:
            output.append(lower)
        else:
            output.append(_capitalize_piece(part))

    return "".join(output)


def _lower_descriptive_eti(title: str) -> str:
    def rewrite(match: re.Match[str]) -> str:
        content = match.group(1)
        words = list(_WORD_RE.finditer(content))
        if not words:
            return match.group(0)

        lowered = [word.group(0).lower() for word in words]

        # Keep featured-artist markers lowercase if they already exist in a
        # title, without trying to add or remove featured credits.
        content = re.sub(
            r"(?i)^\s*(feat|ft|f)(\.)",
            lambda marker: marker.group(1).lower() + marker.group(2),
            content,
        )

        if lowered[-1] not in _ETI_HEAD_WORDS:
            return "(" + content + ")"

        start = len(words) - 1
        while start > 0:
            previous = lowered[start - 1]
            if (
                previous in _ETI_MODIFIER_WORDS
                or re.fullmatch(r"\d+(?:-bit|-inch)?", previous)
            ):
                start -= 1
            else:
                break

        suffix_start = words[start].start()
        suffix_end = words[-1].end()
        content = (
            content[:suffix_start]
            + content[suffix_start:suffix_end].lower()
            + content[suffix_end:]
        )
        return "(" + content + ")"

    # Process simple parenthetical ETI without changing bracket structure.
    return re.sub(r"\(([^()]*)\)", rewrite, title)


def musicbrainz_english_title_case(title: str) -> str:
    if not title:
        return title

    protected: dict[str, str] = {}

    def protect_special(match: re.Match[str]) -> str:
        token = f"\ufff0{len(protected)}\ufff1"
        protected[token] = match.group(0).lower()
        return token

    working = re.sub(
        r"(?i)\[(unknown|untitled)\]",
        protect_special,
        title,
    )

    words = list(_WORD_RE.finditer(working))
    if not words:
        return title

    segment_starts = {0}
    segment_ends = {len(words) - 1}

    for index in range(1, len(words)):
        between = working[words[index - 1].end():words[index].start()]
        if _MAJOR_BOUNDARY_RE.search(between):
            segment_ends.add(index - 1)
            segment_starts.add(index)

    # A leading optional parenthetical such as "(Don't Fear) The Reaper"
    # creates a new title section after the closing parenthesis.
    stripped_start = len(working) - len(working.lstrip())
    if stripped_start < len(working) and working[stripped_start] == "(":
        depth = 0
        closing = None
        for char_index in range(stripped_start, len(working)):
            if working[char_index] == "(":
                depth += 1
            elif working[char_index] == ")":
                depth -= 1
                if depth == 0:
                    closing = char_index
                    break
        if closing is not None:
            for index, word in enumerate(words):
                if word.start() > closing:
                    segment_starts.add(index)
                    break

    chunks: list[str] = []
    cursor = 0

    for index, match in enumerate(words):
        word = match.group(0)
        lower = word.lower()

        force_major = False
        if index > 0:
            previous = words[index - 1].group(0).lower().strip("'’")
            if (previous, lower) in _PHRASAL_VERBS:
                force_major = True

        replacement = _style_word(
            word,
            segment_start=index in segment_starts,
            segment_end=index in segment_ends,
            force_major=force_major,
        )

        chunks.append(working[cursor:match.start()])
        chunks.append(replacement)
        cursor = match.end()

    chunks.append(working[cursor:])
    result = "".join(chunks)

    result = _lower_descriptive_eti(result)

    result = re.sub(
        r"(?i)\bRock\s+['’]?N['’]?\s+Roll\b",
        "Rock 'n' Roll",
        result,
    )
    result = re.sub(r"(?i)\bSanta fe\b", "Santa Fe", result)

    # English classical key capitalization.
    result = re.sub(
        r"\bin ([A-Ga-g])(?:[\s-]+(flat|sharp))?\s+"
        r"(dorian|lydian|major|minor|mixolydian)\b",
        lambda match: (
            "in "
            + match.group(1).upper()
            + (("-" + match.group(2).lower()) if match.group(2) else "")
            + " "
            + match.group(3).lower()
        ),
        result,
        flags=re.IGNORECASE,
    )

    for token, original in protected.items():
        result = result.replace(token, original)

    return result


def _set_single_value(metadata: Any, tag: str, value: str) -> None:
    try:
        metadata[tag] = value
    except Exception:
        metadata[tag] = [value]


def capitalize_release_title(api: Any, metadata: Any, release_node: Any) -> None:
    if _release_language(metadata, release_node) not in {"eng", "en"}:
        return

    try:
        original = metadata.get("album")
    except Exception:
        original = None

    if isinstance(original, (list, tuple)):
        original = original[0] if original else None

    if not original:
        return

    updated = musicbrainz_english_title_case(str(original))
    if updated != str(original):
        _set_single_value(metadata, "album", updated)
        api.logger.debug(
            "MusicBrainz capitalization changed release title: %r -> %r",
            original,
            updated,
        )


def capitalize_track_title(
    api: Any,
    metadata: Any,
    track_node: Any,
    release_node: Any = None,
) -> None:
    if _release_language(metadata, release_node) not in {"eng", "en"}:
        return

    try:
        original = metadata.get("title")
    except Exception:
        original = None

    if isinstance(original, (list, tuple)):
        original = original[0] if original else None

    if not original:
        return

    updated = musicbrainz_english_title_case(str(original))
    if updated != str(original):
        _set_single_value(metadata, "title", updated)
        api.logger.debug(
            "MusicBrainz capitalization changed track title: %r -> %r",
            original,
            updated,
        )
