# SPDX-License-Identifier: MIT
"""MusicBrainz-style capitalization for release and track titles.

Main titles follow language-aware MusicBrainz capitalization rules, with a
conservative title-language override when MusicBrainz metadata is obviously
wrong. Parenthetical extra title information (ETI) intentionally uses Apple
Music-style title capitalization, e.g. "(Club Mix)", "(Remix)", "(Live)" and
"(Extended Version)".
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
    "edm", "vip", "ost", "hd", "hq",
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
    ("bun", "up"),
    ("bring", "on"), ("carry", "on"), ("come", "on"), ("get", "on"),
    ("go", "on"), ("hold", "on"), ("keep", "on"), ("move", "on"),
    ("pass", "on"), ("put", "on"), ("shine", "on"), ("take", "on"),
    ("turn", "on"), ("try", "on"),
    ("come", "by"), ("drop", "by"), ("get", "by"), ("go", "by"),
    ("pass", "by"), ("stand", "by"), ("stop", "by"), ("swing", "by"),
    ("walk", "by"),
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


def _release_title(metadata: Any, release_node: Any) -> str:
    if isinstance(release_node, dict):
        title = release_node.get("title")
        if title:
            return str(title)

    try:
        title = metadata.get("album")
    except Exception:
        title = None

    if isinstance(title, (list, tuple)):
        title = title[0] if title else None

    return str(title or "")


def _language_scores(metadata: Any, release_node: Any) -> tuple[int, int, int]:
    probe = _release_title(metadata, release_node).lower()
    words = set(re.findall(r"[^\W_]+", probe, flags=re.UNICODE))

    french_score = 0
    spanish_score = 0
    portuguese_score = 0

    if re.search(r"[àâæçéèêëîïôœùûüÿ]", probe):
        french_score += 2
    if {"le", "la", "les", "des", "du", "une", "et", "vous", "avec", "sans"} & words:
        french_score += 2
    if {"de", "se", "souvenir", "souvient"} & words:
        french_score += 1

    if re.search(r"[¿¡ñ]", probe):
        spanish_score += 3
    if {"el", "los", "las", "una", "del", "con", "sin", "para", "por"} & words:
        spanish_score += 2
    if {"y", "te", "mi"} & words:
        spanish_score += 1
    # Distinctive phrases override incorrect release-language metadata.
    # A single "la" is ambiguous (French/Spanish); "la noche" is not.
    if re.search(r"\bla\s+noche\b", probe):
        spanish_score += 4

    # Portuguese uses sentence case. Common "vai + gerund" constructions,
    # e.g. "Vai sentando", are strong evidence even when a release is
    # incorrectly marked English.
    if re.search(r"\bvai\s+[a-zà-ÿ]+(?:ando|endo|indo)\b", probe):
        portuguese_score += 5

    return french_score, spanish_score, portuguese_score


def _language_mode(metadata: Any, release_node: Any) -> str:
    language = _release_language(metadata, release_node)
    french_score, spanish_score, portuguese_score = _language_scores(metadata, release_node)

    # MusicBrainz release language can be wrong. If a release marked English
    # has strong French/Spanish title evidence, prefer the title evidence for
    # capitalization instead of blindly applying English title case.
    if language in {"eng", "en", "english"}:
        if portuguese_score >= 4 and portuguese_score > spanish_score and portuguese_score > french_score:
            return "sentence"
        if spanish_score >= 3 and spanish_score > french_score and spanish_score > portuguese_score:
            return "sentence"
        if french_score >= 3 and french_score > spanish_score and french_score > portuguese_score:
            return "french"
        return "english"

    if language in {"fra", "fre", "fr", "french"}:
        return "french"
    if language in {"spa", "es", "spanish"}:
        return "sentence"
    if language in {
        "ita", "it", "italian",
        "por", "pt", "portuguese",
        "cat", "ca", "catalan",
        "lat", "la", "latin",
    }:
        return "sentence"

    # Some releases have a script but no language. Infer only when the title
    # gives strong clues; otherwise use the conservative ALL CAPS fallback.
    if portuguese_score >= 4 and portuguese_score > spanish_score and portuguese_score > french_score:
        return "sentence"
    if spanish_score >= 3 and spanish_score > french_score and spanish_score > portuguese_score:
        return "sentence"
    if french_score >= 3 and french_score > spanish_score and french_score > portuguese_score:
        return "french"

    return "unknown"


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

    # Preserve compact all-uppercase abbreviations such as GPB. The heuristic
    # intentionally avoids preserving ordinary ALL CAPS words such as LIVE.
    if _looks_like_acronym(piece):
        return piece

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

        # Treat parenthetical information as its own title segment. This is an
        # intentional Apple Music-style override for ETI, so "(club mix)"
        # becomes "(Club Mix)", "(live)" becomes "(Live)", etc.
        if "(" in between:
            segment_ends.add(index - 1)
            segment_starts.add(index)
        if ")" in between:
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

    # Apple Music keeps featured-artist markers lowercase even though the
    # surrounding parenthetical version information uses title capitalization.
    result = re.sub(
        r"(?i)\((\s*)(feat|ft|f)(\.)",
        lambda match: (
            "(" + match.group(1) + match.group(2).lower() + match.group(3)
        ),
        result,
    )

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

    return _restore_stylized_names(_lowercase_vs_abbreviation(result))


def _has_cased_letters(text: str) -> bool:
    return any(char.isalpha() and char.lower() != char.upper() for char in text)


def _is_all_caps_title(text: str) -> bool:
    letters = [
        char for char in text
        if char.isalpha() and char.lower() != char.upper()
    ]
    return bool(letters) and all(char == char.upper() for char in letters)


def _looks_like_acronym(word: str) -> bool:
    letters = "".join(char for char in word if char.isalpha())
    if not letters or len(letters) > 6 or not letters.isupper():
        return False

    # Preserve compact consonant-heavy initialisms such as GPB, BBC, DJ, etc.
    vowels = set("AEIOUYÀÂÄÁÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜ")
    return not any(char in vowels for char in letters)


def _sentence_case_title(
    title: str,
    *,
    colon_starts_segment: bool = False,
) -> str:
    if not title:
        return title

    words = list(_WORD_RE.finditer(title))
    if not words:
        return title

    chunks: list[str] = []
    cursor = 0
    capitalize_next = True

    boundary_pattern = r"[.!?/]"
    if colon_starts_segment:
        boundary_pattern = r"[:.!?/]"

    for index, match in enumerate(words):
        word = match.group(0)
        between = title[cursor:match.start()]

        if index > 0 and re.search(boundary_pattern + r"\s*$", between):
            capitalize_next = True

        lower = word.lower()

        if _looks_like_acronym(word):
            replacement = word
        elif _is_mixed_case(word):
            replacement = word
        elif lower in _KNOWN_MIXED_CASE:
            replacement = _KNOWN_MIXED_CASE[lower]
        elif capitalize_next:
            replacement = _capitalize_piece(word)
        else:
            replacement = lower

        chunks.append(title[cursor:match.start()])
        chunks.append(replacement)
        cursor = match.end()
        capitalize_next = False

    chunks.append(title[cursor:])
    return "".join(chunks)


def _french_punctuation(title: str) -> str:
    # MusicBrainz French style: ? ! ; : are preceded by a space and followed
    # by a normal space unless they end the title.
    def repl(match: re.Match[str]) -> str:
        punctuation = match.group(1)
        trailing = " " if match.end() < len(title) else ""
        return " " + punctuation + trailing

    return re.sub(r"\s*([?!;:])\s*", repl, title)


def _french_title_case(title: str) -> str:
    result = _sentence_case_title(title, colon_starts_segment=True)
    result = _french_punctuation(result)
    return _apple_eti_case(result)


def _apple_eti_case(title: str) -> str:
    def rewrite(match: re.Match[str]) -> str:
        content = match.group(1)
        if not content.strip():
            return match.group(0)

        styled = musicbrainz_english_title_case(content)
        styled = re.sub(
            r"(?i)^\s*(feat|ft|f)(\.)",
            lambda marker: marker.group(1).lower() + marker.group(2),
            styled,
        )
        return "(" + styled + ")"

    return re.sub(r"\(([^()]*)\)", rewrite, title)


def _restore_stylized_names(title: str) -> str:
    """Keep established artist/album spellings after automatic title casing.

    French punctuation normalization may introduce spaces around "!", hence
    the narrowly limited optional whitespace in this exact brand-name rule.
    """
    return re.sub(r"(?i)(?<!\w)3oh\s*!\s*3(?!\w)", "3OH!3", title)


def _lowercase_vs_abbreviation(title: str) -> str:
    """The abbreviated comparison marker 'vs.' remains lowercase everywhere."""
    return re.sub(r"(?i)\bvs\.", "vs.", title)


def _english_all_caps_title(title: str) -> bool:
    """Detect clearly English all-caps titles even after '- Single' / '- EP'."""
    core = re.sub(r"(?i)(?:\s+-\s+(?:single|ep))+\s*$", "", title).strip()
    return bool(
        re.match(r"(?i)^the\s+[a-z]", core)
        and _is_all_caps_title(core)
    )


def standardize_title_case(
    title: str,
    mode: str,
) -> str:
    if not title or not _has_cased_letters(title):
        return title

    if mode == "english":
        result = musicbrainz_english_title_case(title)
    elif mode == "french":
        result = _french_title_case(title)
    elif mode == "sentence":
        result = _apple_eti_case(_sentence_case_title(title))
    elif _english_all_caps_title(title):
        # "THE OUTSIDE (OUTSIDERS VERSION)" should be English title case
        # even when the source release language is undetermined.
        result = musicbrainz_english_title_case(title)
    elif _is_all_caps_title(title):
        # Unknown language: preserve normally styled text; normalize the
        # usual all-caps fallback conservatively.
        result = _apple_eti_case(_sentence_case_title(title))
    else:
        result = title

    return _restore_stylized_names(_lowercase_vs_abbreviation(result))


def _canonical_release_suffix(title: str) -> str:
    """Preserve a single exact '- Single' or '- EP' formatting suffix.

    Sentence case must not lower 'Single' to 'single', because a separate
    case-sensitive suffix script can then append a second suffix.
    """
    match = re.search(r"(?:\s+-\s+(?:single|ep))+\s*$", title, re.I)
    if not match:
        return title
    labels = re.findall(r"\s+-\s+(single|ep)", match.group(0), re.I)
    if not labels or len({label.lower() for label in labels}) != 1:
        return title
    final = "EP" if labels[-1].lower() == "ep" else "Single"
    return title[:match.start()].rstrip() + " - " + final


def _set_single_value(metadata: Any, tag: str, value: str) -> None:
    try:
        metadata[tag] = value
    except Exception:
        metadata[tag] = [value]


_DIGITAL_MEDIUM_RE = re.compile(r"^(?:[0-9]+\s*[x×]\s*)?digital media$", re.I)


def _is_digital_medium(value: Any) -> bool:
    return isinstance(value, str) and bool(_DIGITAL_MEDIUM_RE.fullmatch(value.strip()))


def _is_digital_release(metadata: Any, release_node: Any = None) -> bool:
    """Classify only proven all-digital releases; never infer from file codecs."""
    if isinstance(release_node, dict):
        mediums = release_node.get("media")
        if isinstance(mediums, (list, tuple)) and mediums:
            return all(
                isinstance(medium, dict) and _is_digital_medium(medium.get("format"))
                for medium in mediums
            )

    # Picard's per-track media tag is the MusicBrainz medium format.
    try:
        media = metadata.getall("media")
    except AttributeError:
        media = metadata.get("media")
    if isinstance(media, (list, tuple)):
        return bool(media) and all(_is_digital_medium(value) for value in media)
    return _is_digital_medium(media)


def normalize_europe_release_country(metadata: Any, release_node: Any = None) -> None:
    """Remove digital release countries; otherwise write EU instead of XE."""
    if _is_digital_release(metadata, release_node):
        # Picard Metadata.delete marks an existing file tag for actual deletion;
        # deleting a key from a plain dict is used only by regression tests.
        delete = getattr(metadata, "delete", None)
        if callable(delete):
            delete("releasecountry")
        else:
            metadata.pop("releasecountry", None)
        return

    try:
        values = metadata.getall("releasecountry")
    except AttributeError:
        values = metadata.get("releasecountry")
    if values is None:
        return
    if isinstance(values, (list, tuple)):
        if "XE" in values:
            metadata["releasecountry"] = [
                "EU" if value == "XE" else value for value in values
            ]
    elif values == "XE":
        metadata["releasecountry"] = "EU"


def capitalize_release_title(api: Any, metadata: Any, release_node: Any) -> None:
    normalize_europe_release_country(metadata, release_node)
    try:
        original = metadata.get("album")
    except Exception:
        original = None

    if isinstance(original, (list, tuple)):
        original = original[0] if original else None

    if not original:
        return

    mode = _language_mode(metadata, release_node)
    updated = _canonical_release_suffix(standardize_title_case(str(original), mode))
    if updated != str(original):
        _set_single_value(metadata, "album", updated)
        api.logger.debug(
            "MusicBrainz capitalization changed release title (%s): %r -> %r",
            mode,
            original,
            updated,
        )


def capitalize_track_title(
    api: Any,
    metadata: Any,
    track_node: Any,
    release_node: Any = None,
) -> None:
    normalize_europe_release_country(metadata, release_node)
    try:
        original = metadata.get("title")
    except Exception:
        original = None

    if isinstance(original, (list, tuple)):
        original = original[0] if original else None

    if not original:
        return

    mode = _language_mode(metadata, release_node)
    updated = standardize_title_case(str(original), mode)
    if updated != str(original):
        _set_single_value(metadata, "title", updated)
        api.logger.debug(
            "MusicBrainz capitalization changed track title (%s): %r -> %r",
            mode,
            original,
            updated,
        )
