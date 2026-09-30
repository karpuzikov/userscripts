# Duplicate / Edition Analyzer
# Automatic discography optimizer: performs track-by-track comparison, reports actions, never deletes files.

from __future__ import annotations

import hashlib
import importlib
import itertools
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import textwrap
import threading
import traceback
import time
import unicodedata
import urllib.request
import zipfile
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

APP_NAME = "Duplicate / Edition Analyzer"
APP_VERSION = "0.15.1"
PROGRAM_DATA_DIR_NAME = "Duplicate Edition Analyzer"
AUDIO_EXTS = {".m4a", ".flac", ".wav", ".ape", ".wv", ".mp3", ".aac", ".ogg", ".opus"}
def _logical_cpu_count() -> int:
    return max(1, os.cpu_count() or 1)


def _probe_workers() -> int:
    # ffprobe jobs are short and spend much of their time waiting on process/I/O.
    return min(64, max(8, _logical_cpu_count() * 2))


def _fingerprint_workers() -> int:
    # fpcalc is CPU-heavy and largely single-threaded per file. Run roughly one
    # process per logical CPU, with a sane ceiling to avoid storage thrashing on
    # very high-core-count systems.
    return min(32, max(4, _logical_cpu_count()))


def _compare_workers() -> int:
    # Fingerprint similarity is Python CPU work. Use processes, not threads, so
    # the GIL does not leave the comparison stage pinned to one logical CPU.
    return min(32, max(2, _logical_cpu_count()))

CHROMAPRINT_VERSION = "1.6.1"
CHROMAPRINT_URL = f"https://github.com/acoustid/chromaprint/releases/download/v{CHROMAPRINT_VERSION}/chromaprint-fpcalc-{CHROMAPRINT_VERSION}-windows-x86_64.zip"

# External CD rip log quality scorer. Installed as a dependency at runtime;
# its source is not vendored into this one-file tool.
HEYBROCHECKLOG_VERSION = "1.3.2"
HEYBROCHECKLOG_COMMIT = "d3192ad2764f2682cffce4db2abc419f8ac68c69"
HEYBROCHECKLOG_SOURCE = f"https://github.com/ligh7s/hey-bro-check-log/archive/{HEYBROCHECKLOG_COMMIT}.zip"
FFMPEG_PACKAGE_ID = "Gyan.FFmpeg"
CUETOOLS_PACKAGE_ID = "gchudov.CUETools"
# hey-bro-check-log by ligh7s, Apache-2.0:
# https://github.com/ligh7s/hey-bro-check-log


# Unified dark UI palette.
DARK_BG = "#1e1e1e"
DARK_PANEL = "#252526"
DARK_FIELD = "#2d2d30"
DARK_BUTTON = "#333337"
DARK_BUTTON_ACTIVE = "#3f3f46"
DARK_FG = "#f0f0f0"
DARK_MUTED = "#b8b8b8"
DARK_BORDER = "#4a4a4f"
DARK_ACCENT = "#5b9bd5"


def _enable_dark_titlebar(window) -> None:
    if os.name != "nt":
        return
    try:
        import ctypes
        window.update_idletasks()
        hwnd = ctypes.windll.user32.GetParent(window.winfo_id())
        value = ctypes.c_int(1)
        # DWMWA_USE_IMMERSIVE_DARK_MODE: 20 on current Windows 10/11, 19 on older builds.
        for attribute in (20, 19):
            try:
                if ctypes.windll.dwmapi.DwmSetWindowAttribute(
                    hwnd, attribute, ctypes.byref(value), ctypes.sizeof(value)
                ) == 0:
                    break
            except Exception:
                pass
    except Exception:
        pass


def _apply_dark_theme(root) -> None:
    root.configure(background=DARK_BG)
    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except Exception:
        pass

    style.configure(".", background=DARK_BG, foreground=DARK_FG, font=("Segoe UI", 9))
    style.configure("TFrame", background=DARK_BG)
    style.configure("TLabel", background=DARK_BG, foreground=DARK_FG)
    style.configure("Section.TLabel", background=DARK_BG, foreground=DARK_FG, font=("Segoe UI", 10, "bold"))
    style.configure("Help.TLabel", background=DARK_BG, foreground=DARK_MUTED, font=("Segoe UI", 9))
    style.configure("TCheckbutton", background=DARK_BG, foreground=DARK_FG)
    style.map(
        "TCheckbutton",
        background=[("active", DARK_BG)],
        foreground=[("disabled", "#777777"), ("active", DARK_FG)],
    )
    style.configure(
        "TEntry",
        fieldbackground=DARK_FIELD,
        foreground=DARK_FG,
        insertcolor=DARK_FG,
        bordercolor=DARK_BORDER,
        lightcolor=DARK_BORDER,
        darkcolor=DARK_BORDER,
        padding=5,
    )
    style.map(
        "TEntry",
        fieldbackground=[("disabled", DARK_PANEL), ("readonly", DARK_FIELD)],
        foreground=[("disabled", "#777777")],
        bordercolor=[("focus", DARK_ACCENT)],
    )
    style.configure(
        "TButton",
        background=DARK_BUTTON,
        foreground=DARK_FG,
        bordercolor=DARK_BORDER,
        lightcolor=DARK_BORDER,
        darkcolor=DARK_BORDER,
        padding=(10, 6),
    )
    style.map(
        "TButton",
        background=[("pressed", DARK_PANEL), ("active", DARK_BUTTON_ACTIVE), ("disabled", "#292929")],
        foreground=[("disabled", "#777777"), ("active", DARK_FG)],
        bordercolor=[("focus", DARK_ACCENT)],
    )
    style.configure(
        "TProgressbar",
        troughcolor=DARK_FIELD,
        background=DARK_ACCENT,
        bordercolor=DARK_BORDER,
        lightcolor=DARK_ACCENT,
        darkcolor=DARK_ACCENT,
    )
    style.configure(
        "Analyzer.Treeview",
        background="#18181b",
        fieldbackground="#18181b",
        foreground="#f4f4f5",
        borderwidth=0,
        relief="flat",
        rowheight=30,
        font=("Segoe UI", 9),
    )
    style.map(
        "Analyzer.Treeview",
        background=[("selected", "#264f78")],
        foreground=[("selected", "#ffffff")],
    )
    style.configure(
        "Analyzer.Treeview.Heading",
        background="#27272a",
        foreground="#f4f4f5",
        bordercolor="#3f3f46",
        relief="flat",
        font=("Segoe UI", 9, "bold"),
        padding=(8, 7),
    )
    style.map(
        "Analyzer.Treeview.Heading",
        background=[("active", "#3f3f46")],
    )
    _enable_dark_titlebar(root)


def _documents_dir() -> Path:
    """Resolve the user's actual Windows Documents folder, including redirection."""
    if os.name == "nt":
        try:
            import winreg
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as key:
                value, _ = winreg.QueryValueEx(key, "Personal")
            return Path(os.path.expandvars(value)).expanduser()
        except Exception:
            pass
    return Path.home() / "Documents"


def _karpuzikov_tools_dir() -> Path:
    return _documents_dir() / "Karpuzikov Tools"


def _saved_data_dir() -> Path:
    """Program-isolated persistent data root required by the development rules."""
    return _karpuzikov_tools_dir() / PROGRAM_DATA_DIR_NAME


def _dependencies_dir() -> Path:
    return _saved_data_dir() / "dependencies"


def _logs_dir() -> Path:
    return _saved_data_dir() / "logs"


def _temp_dir() -> Path:
    return _saved_data_dir() / "temp"


def _cache_dir() -> Path:
    return _saved_data_dir() / "cache"


def _state_dir() -> Path:
    return _saved_data_dir() / "state"


def _settings_path() -> Path:
    return _saved_data_dir() / "settings.json"


def _ensure_app_data_dirs() -> None:
    for path in (
        _saved_data_dir(),
        _dependencies_dir(),
        _logs_dir(),
        _temp_dir(),
        _cache_dir(),
        _state_dir(),
    ):
        path.mkdir(parents=True, exist_ok=True)


def _atomic_write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


_DATA_MIGRATION_DONE = False


def _migrate_legacy_app_data() -> None:
    """Migrate older analyzer data into its required per-program Documents folder."""
    global _DATA_MIGRATION_DONE
    if _DATA_MIGRATION_DONE:
        return
    _DATA_MIGRATION_DONE = True

    try:
        _ensure_app_data_dirs()
    except Exception:
        return

    tools_root = _karpuzikov_tools_dir()
    current_settings = _settings_path()

    # Older builds stored every program in one shared Documents\Karpuzikov Tools\settings.json.
    legacy_settings = tools_root / "settings.json"
    if not current_settings.exists() and legacy_settings.is_file():
        try:
            data = json.loads(legacy_settings.read_text(encoding="utf-8"))
            migrated = {}
            if isinstance(data, dict):
                apps = data.get("apps")
                if isinstance(apps, dict) and isinstance(apps.get("duplicate_edition_analyzer"), dict):
                    migrated = dict(apps["duplicate_edition_analyzer"])
                elif any(
                    key in data
                    for key in (
                        "existing_discography",
                        "recycle_update_folder",
                        "save_remixes",
                        "save_live",
                    )
                ):
                    migrated = dict(data)
            if migrated:
                _atomic_write_json(current_settings, migrated)
        except Exception:
            pass

    # Move analyzer-owned flat files out of the shared Karpuzikov Tools root.
    try:
        for old in tools_root.glob("Duplicate Edition Analyzer Comparison *.jsonl"):
            target = _logs_dir() / old.name
            if not target.exists():
                shutil.move(str(old), str(target))
    except Exception:
        pass

    for old_name, target in (
        ("Duplicate Edition Analyzer - Crash.log", _logs_dir() / "Duplicate Edition Analyzer - Crash.log"),
        ("Duplicate Edition Analyzer - Last Move.json", _state_dir() / "last_move.json"),
    ):
        old = tools_root / old_name
        if old.is_file() and not target.exists():
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(old), str(target))
            except Exception:
                pass

    # Very old undo state lived under LocalAppData. Copy it forward without
    # removing the legacy copy, so older builds can still recover if needed.
    legacy_local = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Karpuzikov" / PROGRAM_DATA_DIR_NAME
    legacy_manifest = legacy_local / "last_move.json"
    current_manifest = _state_dir() / "last_move.json"
    if legacy_manifest.is_file() and not current_manifest.exists():
        try:
            shutil.copy2(legacy_manifest, current_manifest)
        except Exception:
            pass


def _load_app_settings() -> dict:
    _migrate_legacy_app_data()
    path = _settings_path()
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def _save_app_settings(
    existing_discography: str,
    recycle_update: str,
    save_remixes: bool = False,
    save_live: bool = False,
    logging_enabled: bool = False,
    pattern_preferences: Optional[Dict[str, bool]] = None,
    personal_keep_rules: Optional[List[Dict[str, str]]] = None,
) -> None:
    _migrate_legacy_app_data()
    previous = _load_app_settings()

    saved_patterns = previous.get("unusual_pattern_preferences_v5", {})
    if not isinstance(saved_patterns, dict):
        saved_patterns = {}
    if pattern_preferences is not None:
        saved_patterns.update({str(k): bool(v) for k, v in pattern_preferences.items()})

    saved_personal = previous.get("personal_keep_rules_v1", [])
    if not isinstance(saved_personal, list):
        saved_personal = []
    if personal_keep_rules is not None:
        saved_personal = []
        for item in personal_keep_rules:
            if not isinstance(item, dict):
                continue
            mode = str(item.get("mode", "contains")).strip().lower()
            value = str(item.get("value", "")).strip()
            if mode not in {"contains", "exact"} or not value:
                continue
            saved_personal.append({"mode": mode, "value": value})

    data = {
        "existing_discography": existing_discography.strip(),
        "recycle_update_folder": recycle_update.strip(),
        "save_remixes": bool(save_remixes),
        "save_live": bool(save_live),
        "logging_enabled": bool(logging_enabled),
        "unusual_pattern_preferences_v5": saved_patterns,
        "personal_keep_rules_v1": saved_personal,
        # Preserve legacy semantic keys for update compatibility.
        "exclude_remixes": not bool(save_remixes),
        "exclude_live": not bool(save_live),
    }

    try:
        _atomic_write_json(_settings_path(), data)
    except Exception:
        # Settings persistence must never prevent the analyzer from running.
        pass


FP_AUTO_SCORE = 5.0
FP_AUTO_GOOD_FRACTION = 0.90
FP_AUTO_EXCELLENT_FRACTION = 0.70
FP_AUTO_MEDIAN_MAX = 4.0
FP_AUTO_P90_MAX = 10
FP_MIN_OVERLAP = 0.85

# Secondary audio-only acceptance for the same recording from a different
# mastering/pressing. It is deliberately much tighter than random Chromaprint
# similarity and requires near-identical duration plus strong full-track overlap.
FP_MASTERING_SCORE = 7.5
FP_MASTERING_GOOD_FRACTION = 0.80
FP_MASTERING_MEDIAN_MAX = 7.0
FP_MASTERING_P90_MAX = 14
FP_MASTERING_MIN_OVERLAP = 0.92
FP_MASTERING_MAX_DURATION_SECONDS = 4.0
FP_MASTERING_MAX_DURATION_RATIO = 0.02

FP_SILENCE_MIN_FRAMES = 120

# Candidate prefilter. The previous pure-duration fallback compared almost every
# track with every other similarly-sized track. Real matches from the diagnostic
# corpus had far stronger token overlap, so keep a generous weak fallback without
# turning the expensive matcher back into O(n^2).
FP_CANDIDATE_STRONG_SHARED_TOKENS = 64
FP_CANDIDATE_WEAK_SHARED_TOKENS = 24
FP_CANDIDATE_DURATION_SECONDS = 6.0
FP_CANDIDATE_DURATION_RATIO = 0.035


def _new_comparison_log_path(recycle: Path) -> Path:
    """Create a per-run comparison log in this program's isolated logs folder."""
    _migrate_legacy_app_data()
    stamp = datetime.now().strftime("%Y-%m-%d-%H-%M-%S")
    root = _logs_dir()
    try:
        root.mkdir(parents=True, exist_ok=True)
        candidate = root / f"Duplicate Edition Analyzer Comparison {stamp}.jsonl"
        suffix = 2
        while candidate.exists():
            candidate = root / f"Duplicate Edition Analyzer Comparison {stamp} ({suffix}).jsonl"
            suffix += 1
        return candidate
    except Exception as exc:
        raise RuntimeError(f"Could not create comparison log: {exc}") from exc


UNICODE_REPLACEMENTS = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
    "…": "...", "·": ".", "•": "*", "‧": ".",
    "×": "&", "÷": "/", "⁄": "/", "＆": "&", "＋": "+", "＝": "=",
    "（": "(", "）": ")", "［": "[", "］": "]", "｛": "{", "｝": "}",
    "：": ":", "；": ";", "！": "!", "？": "?", "，": ",", "．": ".",
    "／": "/", "＼": "\\", "｜": "|", "＜": "<", "＞": ">", "＿": "_",
    "©": "(c)", "®": "(R)", "™": "TM", "№": "No.",
    "\u00a0": " ", "\u2009": " ", "\u202f": " ",
}

VERSION_WORDS = {
    "remix", "mix", "live", "acoustic", "edit", "version", "extended", "instrumental",
    "acapella", "a", "capella", "dub", "demo", "radio", "club", "remaster", "remastered",
    "clean", "explicit", "single", "alternate", "alternative", "unplugged", "session",
}

EDITION_PATTERNS = [
    r"\s*\((?:deluxe(?: edition)?|limited(?: edition)?|special(?: edition)?|expanded(?: edition)?|"
    r"anniversary(?: edition)?|bonus track version|standard edition|remaster(?:ed)?(?: edition)?)\)\s*$",
    r"\s*\[(?:deluxe|limited|special|expanded|anniversary|remastered?)\]\s*$",
]


MOJIBAKE_REPLACEMENTS = {
    "â€™": "'", "â€˜": "'", "â€œ": '"', "â€": '"', "â€�": '"',
    "â€“": "-", "â€”": "-", "â€¦": "...", "Â": "",
}


def repair_mojibake(text: str) -> str:
    value = text or ""
    if any(marker in value for marker in ("Ã", "Â", "â")):
        try:
            repaired = value.encode("cp1252").decode("utf-8")
            if repaired.count("Ã") + repaired.count("Â") + repaired.count("â") < value.count("Ã") + value.count("Â") + value.count("â"):
                value = repaired
        except Exception:
            pass
    for bad, good in MOJIBAKE_REPLACEMENTS.items():
        value = value.replace(bad, good)
    return value


def ascii_punctuation(text: str) -> str:
    text = repair_mojibake(text)
    for src, dst in UNICODE_REPLACEMENTS.items():
        text = text.replace(src, dst)
    return text


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def strip_track_number(name: str) -> str:
    return re.sub(r"^\s*\d{1,3}(?:\s*[-._)]\s*|\s+)", "", name).strip()


def canonical_featured_title(text: str) -> str:
    text = ascii_punctuation(text)
    feat_names: List[str] = []

    def repl(m: re.Match) -> str:
        person = normalize_space(m.group(1).strip(" ()[]"))
        if person:
            feat_names.append(person)
        return " "

    patterns = [
        r"[\[(]\s*(?:feat(?:uring)?|ft)\.?\s+([^\])]+)[\])]",
        r"\s+(?:feat(?:uring)?|ft)\.?\s+([^\[(]+)$",
    ]
    for pat in patterns:
        text = re.sub(pat, repl, text, flags=re.I)
    text = normalize_space(text)
    if feat_names:
        uniq = []
        for n in feat_names:
            if n.lower() not in {x.lower() for x in uniq}:
                uniq.append(n)
        text += " (ft. " + " & ".join(uniq) + ")"
    return text


def normalize_title(text: str) -> str:
    text = canonical_featured_title(text)
    text = text.lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-z0-9$+()\[\]'. -]+", " ", text)
    text = re.sub(r"\s*([()\[\]])\s*", r"\1", text)
    return normalize_space(text)


def compact_title(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", normalize_title(text))


def semantic_qualifiers(text: str) -> Set[str]:
    n = normalize_title(text)
    words = set(re.findall(r"[a-z]+", n))
    q = words & VERSION_WORDS
    # The standalone letter/word "a" is not a version qualifier. It only
    # participates in the phrase "a capella".
    if "capella" in q:
        q.discard("a")
        q.discard("capella")
        q.add("acapella")
    else:
        q.discard("a")
    return q


REMIX_TRACK_RE = re.compile(r"\b(?:remix(?:es|ed)?|rmx|dub)\b", re.I)
CLUB_MIX_RE = re.compile(r"\bclub\s+mix(?:es)?\b", re.I)
TEMPO_EFFECT_REMIX_RE = re.compile(
    r"\b(?:sped\s*up|speed\s*up|slowed(?:\s*down)?|reverb(?:ed)?|redux)\b",
    re.I,
)

# A mix credited/named after a person, DJ, producer, or act is a remix.
# Ordinary functional/style mix labels remain non-remix unless another rule says otherwise.
STANDARD_NON_REMIX_MIX_RE = re.compile(
    r"^(?:"
    r"original|extended|vip|v\.i\.p|radio|album|single|main|vocal|instrumental|studio|full|"
    r"ambient|chillout|downtempo|garage|house|trance|dance|full continuous|"
    r"7|12|7 dance|12 dance"
    r")\s+mix(?:\s*#?\d+)?$",
    re.I,
)
GENERIC_MIX_WORDS = {
    "original", "extended", "vip", "radio", "album", "single", "main", "vocal",
    "instrumental", "studio", "full", "ambient", "chillout", "downtempo",
    "garage", "house", "trance", "dance", "continuous", "mix", "new", "big",
    "smooth", "roll", "evolution",
}


def _mix_descriptor_candidates(text: str) -> List[str]:
    source = normalize_space(ascii_punctuation(text or ""))
    if not source:
        return []

    candidates: List[str] = []
    for part in re.findall(r"[\(\[]([^\)\]]+)[\)\]]", source):
        part = normalize_space(part)
        if re.search(r"\bmix(?:\s*#?\d+)?(?:\s+by\s+.+)?\s*$", part, re.I):
            candidates.append(part)

    trailing = re.search(r"(?:^|\s+-\s+|\s*;\s*)([^;]+?\bmix(?:\s*#?\d+)?)\s*$", source, re.I)
    if trailing:
        candidates.append(normalize_space(trailing.group(1)))

    # Also catch a bare descriptor passed directly to this function.
    if re.fullmatch(r".+\bmix(?:\s*#?\d+)?", source, re.I):
        candidates.append(source)

    seen: Set[str] = set()
    result: List[str] = []
    for candidate in candidates:
        key = candidate.casefold()
        if key not in seen:
            seen.add(key)
            result.append(candidate)
    return result


def _is_named_person_mix_descriptor(text: str) -> bool:
    """Detect 'Someone Mix' / 'Someone's Mix' style remix credits."""
    value = normalize_space(ascii_punctuation(text or "")).strip("()[] ")
    if re.search(r"\bmix(?:\s*#?\d+)?\s+by\s+\S.+$", value, re.I):
        return True
    if not re.search(r"\bmix(?:\s*#?\d+)?$", value, re.I):
        return False

    normalized = _normalized_pattern_text(value)
    if STANDARD_NON_REMIX_MIX_RE.fullmatch(normalized):
        return False

    prefix = re.sub(r"\s+mix(?:\s*#?\d+)?$", "", value, flags=re.I).strip()
    prefix_norm = _normalized_pattern_text(prefix)
    if not prefix_norm:
        return False

    # Explicit personal/act-credit signals.
    if re.search(r"(?:'s|’s)\b|\bby\s+|\b(?:dj|mc)\s+|\s(?:&|\+|vs\.?|versus|x)\s", prefix, re.I):
        return True

    words = re.findall(r"[A-Za-z][A-Za-z0-9.'-]*", prefix)
    if not words:
        return False

    meaningful = [w for w in words if w.lower().strip(".'-") not in GENERIC_MIX_WORDS]
    if not meaningful:
        return False

    # Proper-name/act-looking labels: "Ferry Corsten", "Tom Lord-Alge",
    # "Madlib", "Timo Maas", "The Matrix", etc.
    capitalized = [
        w for w in meaningful
        if w[:1].isupper() or (len(w) >= 2 and w.isupper())
    ]
    if len(capitalized) >= 2:
        return True
    if len(meaningful) == 1 and len(capitalized) == 1:
        return True

    # DJ/producer handles often contain digits or internal capitals:
    # "only4Erol Mix", "2manydjs Mix", etc.
    compact_prefix = re.sub(r"[^A-Za-z0-9]", "", prefix)
    if re.search(r"\d", compact_prefix):
        return True
    if re.search(r"[a-z][A-Z]", compact_prefix):
        return True

    return False


LIVE_TRACK_RE = re.compile(r"\b(?:live|sessions?|unplugged)\b", re.I)
REMIX_RELEASE_RE = re.compile(
    r"\b(?:remix(?:es|ed)?|rmx|sped\s*up|speed\s*up|slowed(?:\s*down)?|reverb(?:ed)?|redux)\b",
    re.I,
)
VERSION_LABEL_RE = re.compile(r"[\(\[]\s*([^\)\]]*?\bversion)\s*[\)\]]", re.I)

TRACK_PATTERN_DESCRIPTOR_RE = re.compile(
    r"\b(?:mix(?:es)?|remix(?:es|ed)?|redux|dub|version|edit|acoustic|live|instrumental|"
    r"a\s*capella|acapella|demo|radio|club|remaster(?:ed)?|clean|explicit|session|"
    r"alternate|alternative|unplugged|hook|call\s*out|callout|excerpt|tv\s+track)\b",
    re.I,
)
CALLOUT_PATTERN_RE = re.compile(
    r"\b(?:(?:suggested\s+)?(?:call\s*out|callout)(?:\s+research)?(?:\s+hook)?|hook)\b",
    re.I,
)


LANGUAGE_VERSION_RE = re.compile(
    r"^(?:american|arabic|brazilian|cantonese|chinese|czech|danish|dutch|english|finnish|"
    r"french|german|greek|hebrew|hindi|hungarian|italian|japanese|korean|latin|mandarin|"
    r"norwegian|polish|portuguese|romanian|russian|spanish|swedish|thai|turkish|"
    r"ukrainian|vietnamese) version$",
    re.I,
)

STANDARD_PATTERN_TOKEN_RE = re.compile(
    r"\b(?:acoustic|instrumental|acapella|a\s+capella|demo|session|unplugged|"
    r"remaster(?:ed)?|radio|clean|explicit|edited)\b",
    re.I,
)

STANDARD_EDIT_RE = re.compile(r"\b(?:re[- ]?edit|edit)\b", re.I)

STANDARD_STYLE_MIX_SUFFIX_RE = re.compile(
    r"\b(?:original|extended|vip|v\.i\.p|radio|album|single|main|vocal|instrumental|"
    r"studio|full|full continuous|ambient|chillout|downtempo|garage|house|trance|dance|"
    r"big|new|smooth|low gain)"
    r"\s+mix(?:\s*#?\d+)?$",
    re.I,
)

STANDARD_VERSION_SUFFIX_RE = re.compile(
    r"\b(?:single|album|main|original|og|clean|explicit|edited|club|full|full length|"
    r"piano|harp|guitar|vocal|acoustic|instrumental|special|speed up|sped up|"
    r"alternate|alternative|chillout|ambient|downtempo|garage|house|trance|dance|pop|rock)"
    r"\s+version$",
    re.I,
)

STANDARD_EDITION_RE = re.compile(
    r"\b(?:clean|explicit|edited|deluxe|special|limited|standard)\s+edition$",
    re.I,
)

INSTRUMENT_VERSION_RE = re.compile(
    r"(?:^|\b)(?:piano|harp|guitar|strings?|orchestral|orchestra|vocal|instrumental|"
    r"acoustic|acapella|a\s+capella|karaoke)\s+version$",
    re.I,
)


def _normalized_pattern_text(text: str) -> str:
    raw = ascii_punctuation(text or "")
    # Normalize inch/foot marks in 7"/12" version labels before title cleanup.
    raw = re.sub(r"(?<=\d)[\"'′″]+", " ", raw)
    value = normalize_title(raw)
    value = value.replace('"', " ")
    value = re.sub(r"\s+", " ", value).strip(" .;:-")
    return value


def _is_standard_pattern(text: str) -> bool:
    """True for ordinary version structures that never need manual review."""
    value = _normalized_pattern_text(text)
    if not value:
        return True

    # Parser leftovers such as "Single Version / 2008".
    if re.fullmatch(r"(?:19|20)\d{2}", value):
        return True

    if LANGUAGE_VERSION_RE.fullmatch(value):
        return True
    if STANDARD_EDITION_RE.search(value):
        return True

    # Any prefix may precede these well-known structural families.
    if STANDARD_PATTERN_TOKEN_RE.search(value):
        return True
    if STANDARD_EDIT_RE.search(value):
        return True
    if STANDARD_STYLE_MIX_SUFFIX_RE.search(value):
        return True
    if STANDARD_VERSION_SUFFIX_RE.search(value):
        return True
    if INSTRUMENT_VERSION_RE.search(value):
        return True

    # 7-inch / 12-inch forms, with arbitrary artist/remixer prefixes.
    if re.search(r"\b(?:7|12)\s+(?:dance\s+)?(?:mix|version|edit)\b", value):
        return True
    if re.search(r"\b(?:7|12)\s+.*\b(?:mix|version|edit|instrumental)\b", value):
        return True

    # Common compound forms produced by slash/semicolon naming.
    if re.search(r"\bfull\s+continuous\s+mix$", value):
        return True
    if re.search(r"\bfull\s+version(?:\s+single)?$", value):
        return True
    if re.search(r"\bbonus\s+alt\.?\s+version$", value):
        return True
    if re.search(r"\bspecial\s+dj\s+version$", value):
        return True
    if re.fullmatch(r"(?:us|uk|eu|jp|de|fr|it|es|ca|au)\s+version", value):
        return True
    if re.search(r"\b(?:80s|90s|00s|10s|20s)\s+version$", value):
        return True
    if re.search(r"^version\s+(?:piano|voix|piano[- ]voix|vocal|instrumental)\b", value):
        return True

    # "Extended Version" remains standard even with a name/prefix before it.
    if re.search(r"\bextended\s+version$", value):
        return True

    return False


def _strip_common_review_parts(text: str) -> str:
    parts = [normalize_space(p) for p in re.split(r"\s*/\s*", text or "") if normalize_space(p)]
    if len(parts) <= 1:
        return normalize_space(text or "")
    unusual = [p for p in parts if not _is_standard_pattern(p)]
    # If every slash-separated component is standard (e.g. "Single Version / 2008"),
    # there is nothing to review.
    return " / ".join(unusual)


def _should_review_pattern(text: str) -> bool:
    value = normalize_space(text or "")
    if not value:
        return False
    if CALLOUT_PATTERN_RE.search(value):
        return True
    reduced = _strip_common_review_parts(value)
    return bool(reduced and not _is_standard_pattern(reduced))


def canonical_track_pattern(text: str) -> str:
    """Stable key used for the grouped pre-analysis included-content filter."""
    value = normalize_title(text or "")
    value = re.sub(r"\bcall\s+out\b", "callout", value)
    value = re.sub(r"\ba\s+capella\b", "acapella", value)
    words = set(re.findall(r"[a-z0-9]+", value))
    if "callout" in words or words == {"hook"}:
        return "suggested callout"
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def _looks_like_trailing_pattern(text: str) -> bool:
    """Return True only when a trailing ' - ...' / ': ...' segment looks like a version descriptor.

    This deliberately rejects normal artist-title forms such as
    'INNA - I Am The Club Rocker'. A descriptor word appearing somewhere inside
    a normal song title is not enough; the trailing segment must itself have a
    version/edit/mix/live/etc. shape.
    """
    value = normalize_space(ascii_punctuation(text or ""))
    if not value:
        return False

    normalized = _normalized_pattern_text(value)
    if not normalized:
        return False

    # Explicit callout/hook review families.
    if CALLOUT_PATTERN_RE.fullmatch(value) or CALLOUT_PATTERN_RE.search(value):
        return True

    # Named mix/remix/version families and the standard structural families.
    if re.search(
        r"\b(?:mix(?:es)?|remix(?:es|ed)?|rmx|redux|dub|version|edit|acoustic|live|"
        r"instrumental|a\s*capella|acapella|demo|radio|remaster(?:ed)?|session(?:s)?|"
        r"alternate|alternative|unplugged|excerpt|tv\s+track)\b"
        r"(?:\s*(?:[-,/]|\(|\[)?\s*(?:19|20)\d{2}\s*[\)\]]?)?$",
        normalized,
        re.I,
    ):
        return True

    # 'Clean', 'Explicit', and 'Club' are too common as ordinary title words.
    # Only accept them when they form an actual descriptor at the end.
    if re.search(r"\b(?:clean|explicit)\s+(?:version|edit|mix|edition)$", normalized, re.I):
        return True
    if re.search(r"\bclub\s+(?:mix|version|edit)$", normalized, re.I):
        return True

    return False


def extract_track_patterns(title: str) -> List[Tuple[str, str]]:
    """Extract user-reviewable version descriptors without using them as duplicate evidence."""
    source = normalize_space(ascii_punctuation(strip_track_number(title or "")))
    if not source:
        return []

    candidates: List[str] = []

    for part in re.findall(r"[\(\[]([^\)\]]+)[\)\]]", source):
        part = normalize_space(part)
        if part and TRACK_PATTERN_DESCRIPTOR_RE.search(part) and _should_review_pattern(part):
            candidates.append(_strip_common_review_parts(part))

    trailing = re.search(r"\s+(?:-|:)\s+(.+)$", source)
    if trailing:
        part = normalize_space(trailing.group(1))
        if (
            part
            and _looks_like_trailing_pattern(part)
            and TRACK_PATTERN_DESCRIPTOR_RE.search(part)
            and _should_review_pattern(part)
        ):
            candidates.append(_strip_common_review_parts(part))

    # Catch callout/hook titles even when the whole track title is the descriptor,
    # e.g. "Suggested Callout Hook".
    for match in CALLOUT_PATTERN_RE.finditer(source):
        candidates.append(normalize_space(match.group(0)))

    seen: Set[Tuple[str, str]] = set()
    result: List[Tuple[str, str]] = []
    for candidate in candidates:
        key = canonical_track_pattern(candidate)
        if not key:
            continue
        pair = (key, candidate)
        if pair not in seen:
            seen.add(pair)
            result.append(pair)
    return result


def track_pattern_keys(track: "Track") -> Set[str]:
    keys: Set[str] = set()
    texts = {track.display_title, strip_track_number(track.path.stem)}
    for text in texts:
        for key, _variant in extract_track_patterns(text):
            keys.add(key)
    return keys


def collect_track_patterns(tracks: List["Track"]) -> List[Dict[str, object]]:
    """Collect only non-remix, non-live patterns for manual included-content review.

    Remix/live handling remains exclusively controlled by Save Remixes and
    Save Live recordings.
    """
    grouped: Dict[str, Dict[str, object]] = {}

    for track in tracks:
        classification_text = f"{track.display_title} {strip_track_number(track.path.stem)}"
        if is_remix_text(classification_text) or is_live_text(classification_text):
            continue

        found_for_track: Set[str] = set()
        for key, variant in extract_track_patterns(track.display_title):
            row = grouped.setdefault(
                key,
                {"key": key, "variants": Counter(), "examples": [], "count": 0},
            )
            variants = row["variants"]
            variants[variant] += 1
            examples = row["examples"]
            display_example = repair_mojibake(track.display_title)
            if display_example not in examples and len(examples) < 4:
                examples.append(display_example)
            found_for_track.add(key)

        for key in found_for_track:
            grouped[key]["count"] += 1

    result: List[Dict[str, object]] = []
    for key, row in grouped.items():
        variants: Counter = row["variants"]
        if key == "suggested callout":
            label = "Suggested Call Out / Callout Hook"
        else:
            label = variants.most_common(1)[0][0] if variants else key

        result.append({
            "key": key,
            "label": label,
            "count": int(row["count"]),
            "variants": [name for name, _count in variants.most_common()],
            "examples": list(row["examples"]),
        })

    return sorted(result, key=lambda row: str(row["label"]).lower())


def apply_pattern_exclusions(releases: List["Release"], excluded_pattern_keys: Set[str]) -> None:
    """Apply user pattern choices to included coverage only, never duplicate identity."""
    if not excluded_pattern_keys:
        return

    for release in releases:
        for track in release.tracks:
            classification_text = f"{track.display_title} {strip_track_number(track.path.stem)}"
            if is_remix_text(classification_text) or is_live_text(classification_text):
                continue
            matched = sorted(track_pattern_keys(track) & excluded_pattern_keys)
            if matched:
                track.exclude_from_coverage = True
                track.excluded_by_pattern = ", ".join(matched)



def refresh_heuristic_release_types(releases: List["Release"]) -> None:
    """Re-run only heuristic type detection using checkbox-visible tracks."""
    for rel in releases:
        if rel.type_source != "heuristic":
            continue
        first_tags = rel.tracks[0].tags if rel.tracks else {}
        rel.release_type, rel.type_source = infer_release_type(
            rel.title,
            rel.path.name,
            rel.included_track_count,
            first_tags,
        )


def is_remix_text(text: str) -> bool:
    # Explicit Remix/Dub, Club Mix, Redux, and tempo/effect variants such as
    # Sped Up, Slowed/Slowed Down, and Reverb are remix material.
    # In addition, a mix credited/named after a person/DJ/producer/act is a remix,
    # e.g. "Ferry Corsten Mix", "Tom Lord-Alge Mix", "Madlib's Mix".
    normalized = ascii_punctuation(text or "")
    if (
        REMIX_TRACK_RE.search(normalized)
        or CLUB_MIX_RE.search(normalized)
        or TEMPO_EFFECT_REMIX_RE.search(normalized)
    ):
        return True
    return any(_is_named_person_mix_descriptor(part) for part in _mix_descriptor_candidates(normalized))


def is_live_text(text: str) -> bool:
    return bool(LIVE_TRACK_RE.search(ascii_punctuation(text or "")))


def version_labels(text: str) -> Set[str]:
    """Return semantic named-version labels such as US/French/Guitar Version.

    Generic explicit/clean advisory labels are intentionally ignored at the
    current analyzer stage.
    """
    normalized = ascii_punctuation(text or "").lower()
    labels: Set[str] = set()
    for part in re.findall(r"[\[(]([^\])]+)[\])]", normalized):
        p = re.sub(r"[^a-z0-9]+", " ", part).strip()
        if "version" not in p:
            continue
        generic = bool(re.fullmatch(
            r"(?:(?:album|main|original) version(?: (?:explicit|edited|clean|dirty|censored))?|"
            r"(?:explicit|edited|clean|dirty|censored) version)", p
        ))
        if not generic:
            labels.add(p)
    return labels


def version_label_conflict(a: str, b: str) -> bool:
    va = version_labels(a)
    vb = version_labels(b)
    return va != vb and bool(va or vb)


def _normalized_identifier(value: str) -> str:
    return re.sub(r"[^A-Z0-9-]+", "", (value or "").upper())


def _artist_signature(text: str) -> Set[str]:
    """Normalize multi-artist credits into a comparison set."""
    source = ascii_punctuation(text or "")
    parts = re.split(r"\s*(?:;|,|&|\band\b|\bx\b)\s*", source, flags=re.I)
    result: Set[str] = set()
    for part in parts:
        key = re.sub(r"[^a-z0-9]+", "", normalize_title(part))
        if key:
            result.add(key)
    return result


def _featured_credit_signature(text: str) -> Set[str]:
    """Return featured performers explicitly named in a track title."""
    source = ascii_punctuation(text or "")
    values: List[str] = []
    for part in re.findall(r"[\[(]([^\])]+)[\])]", source):
        match = re.match(r"\s*(?:feat(?:uring)?|ft)\.?\s+(.+)", part, re.I)
        if match:
            values.extend(
                re.split(r"\s*(?:,|&|\band\b|\bx\b)\s*", match.group(1), flags=re.I)
            )
    result: Set[str] = set()
    for value in values:
        key = re.sub(r"[^a-z0-9]+", "", normalize_title(value))
        if key:
            result.add(key)
    return result


def _version_descriptors(text: str) -> Set[str]:
    """Return meaningful parenthetical/bracket version descriptors.

    Featured credits, mastering labels, and generic clean/explicit advisory
    labels are not treated as separate versions here.
    """
    source = ascii_punctuation(strip_track_number(text or ""))
    result: Set[str] = set()
    for part in re.findall(r"[\[(]([^\])]+)[\])]", source):
        value = normalize_space(part)
        if re.match(r"^(?:feat(?:uring)?|ft)\.?\s+", value, re.I):
            continue
        normalized = _normalized_pattern_text(value)
        if not normalized:
            continue
        if re.fullmatch(
            r"(?:(?:album|main|original) version(?: (?:explicit|edited|clean|dirty|censored))?|"
            r"(?:explicit|edited|clean|dirty|censored)(?: version)?)",
            normalized,
            re.I,
        ):
            continue
        if re.fullmatch(r"(?:\d{4}\s+)?remaster(?:ed)?(?:\s+version)?", normalized, re.I):
            continue
        result.add(normalized)

    trailing = re.search(r"\s+(?:-|:)\s+(.+)$", source)
    if trailing:
        value = _normalized_pattern_text(trailing.group(1))
        if value and (
            TRACK_PATTERN_DESCRIPTOR_RE.search(value)
            or LANGUAGE_VERSION_RE.fullmatch(value)
        ):
            result.add(value)
    return result


def _semantic_version_descriptors(text: str) -> Set[str]:
    """Subset of descriptors that explicitly signal a different recording/version."""
    result: Set[str] = set()
    for value in _version_descriptors(text):
        if (
            TRACK_PATTERN_DESCRIPTOR_RE.search(value)
            or LANGUAGE_VERSION_RE.fullmatch(value)
            or re.search(
                r"\b(?:slowed|sped\s*up|speed\s*up|redux|nightcore|karaoke|piano|harp|guitar|"
                r"orchestral|orchestra|vocal)\b",
                value,
                re.I,
            )
        ):
            result.add(value)
    return result


def _base_title_identity(text: str) -> str:
    """Title identity with bracketed descriptors/featured credits removed."""
    source = ascii_punctuation(strip_track_number(text or ""))
    source = re.sub(r"[\[(][^\])]+[\])]", " ", source)
    source = re.sub(r"\s+(?:feat(?:uring)?|ft)\.?\s+.+$", " ", source, flags=re.I)
    source = strip_advisory_version_for_match(source)
    source = re.sub(r"\b(?:\d{4}\s+)?remaster(?:ed)?\b", " ", source, flags=re.I)
    return re.sub(r"[^a-z0-9]+", "", normalize_title(source))


def _candidate_duration_close(a: Track, b: Track) -> bool:
    if a.duration <= 0 or b.duration <= 0:
        return False
    delta = abs(a.duration - b.duration)
    return delta <= max(
        FP_CANDIDATE_DURATION_SECONDS,
        FP_CANDIDATE_DURATION_RATIO * max(a.duration, b.duration),
    )


def _descriptor_family_set(values: Set[str]) -> Set[str]:
    """Collapse wording aliases into semantic families for metadata safety.

    Metadata is only allowed to veto a proven audio match when both sides state
    genuinely incompatible version families. Wording aliases such as
    "Radio Edit" vs "Play & Win Radio Version" are the same radio family.
    """
    families: Set[str] = set()
    for value in values:
        text = normalize_space(ascii_punctuation(value or "").lower())
        if not text:
            continue
        if "radio" in text:
            families.add("radio")
        elif "acoustic" in text or "unplugged" in text:
            families.add("acoustic")
        elif "instrumental" in text:
            families.add("instrumental")
        elif "a capella" in text or "acapella" in text or "acappella" in text:
            families.add("acapella")
        elif "live" in text:
            families.add("live")
        elif "remix" in text or "dub" in text or "club mix" in text:
            families.add("remix")
        elif "extended" in text:
            families.add("extended")
        else:
            # Preserve language/named-version distinctions when both sides state them.
            families.add(re.sub(r"[^a-z0-9]+", " ", text).strip())
    return families


def _metadata_match_conflict(a: Track, b: Track) -> str:
    """Return a conservative reason to veto an otherwise-valid audio match.

    Audio remains required. Metadata only blocks a merge when it contains strong,
    contradictory evidence that the files are distinct recordings/versions.
    """
    mbid_a = _normalized_identifier(a.mbid)
    mbid_b = _normalized_identifier(b.mbid)
    isrc_a = _normalized_identifier(a.isrc)
    isrc_b = _normalized_identifier(b.isrc)

    if mbid_a and mbid_b and mbid_a != mbid_b:
        return f"different MusicBrainz recording MBIDs ({a.mbid} vs {b.mbid})"

    artists_a = _artist_signature(a.artist)
    artists_b = _artist_signature(b.artist)
    same_mbid = bool(mbid_a and mbid_b and mbid_a == mbid_b)
    same_isrc = bool(isrc_a and isrc_b and isrc_a == isrc_b)

    # A shared recording MBID is the strongest available identity evidence.
    if same_mbid:
        return ""

    # A shared ISRC plus the same credited performers is strong enough to tolerate
    # packaging/edition suffixes such as "(Pilule bleue)".
    if same_isrc and (not artists_a or not artists_b or artists_a == artists_b):
        return ""

    semantic_a = _semantic_version_descriptors(a.display_title)
    semantic_b = _semantic_version_descriptors(b.display_title)
    if semantic_a and semantic_b:
        semantic_families_a = _descriptor_family_set(semantic_a)
        semantic_families_b = _descriptor_family_set(semantic_b)
        if semantic_families_a != semantic_families_b:
            return (
                "conflicting semantic version descriptors "
                f"({sorted(semantic_a)} vs {sorted(semantic_b)})"
            )

    featured_a = _featured_credit_signature(a.display_title)
    featured_b = _featured_credit_signature(b.display_title)
    if (
        featured_a != featured_b
        and (featured_a or featured_b)
        and isrc_a and isrc_b and isrc_a != isrc_b
    ):
        return (
            "different featured performers with different ISRCs "
            f"({sorted(featured_a)} vs {sorted(featured_b)})"
        )

    if (
        artists_a and artists_b and artists_a != artists_b
        and isrc_a and isrc_b and isrc_a != isrc_b
    ):
        return (
            "different credited artists with different ISRCs "
            f"({sorted(artists_a)} vs {sorted(artists_b)})"
        )

    descriptors_a = _version_descriptors(a.display_title)
    descriptors_b = _version_descriptors(b.display_title)
    if (
        descriptors_a
        and descriptors_b
        and _descriptor_family_set(descriptors_a) != _descriptor_family_set(descriptors_b)
        and isrc_a and isrc_b and isrc_a != isrc_b
    ):
        return (
            "different title/version descriptors with different ISRCs "
            f"({sorted(descriptors_a)} vs {sorted(descriptors_b)})"
        )

    base_a = _base_title_identity(a.display_title)
    base_b = _base_title_identity(b.display_title)
    if (
        isrc_a and isrc_b and isrc_a != isrc_b
        and base_a and base_b and base_a != base_b
    ):
        return (
            "different ISRCs and different base titles "
            f"({a.display_title!r} vs {b.display_title!r})"
        )

    return ""


FEATURE_CREDIT_RE = re.compile(
    r"(?:[\[(]\s*)?\b(?:feat(?:uring)?|ft)\.?\s+([^\])]+)",
    re.I,
)


def _normalize_feature_artist(text: str) -> str:
    text = ascii_punctuation(text or "").lower()
    return re.sub(r"[^a-z0-9$]+", "", text)


def featured_artists(track: "Track") -> Set[str]:
    """Extract explicitly credited featured artists from title/artist metadata."""
    found: Set[str] = set()
    for text in (track.display_title, track.artist):
        normalized = ascii_punctuation(text or "")
        for match in FEATURE_CREDIT_RE.finditer(normalized):
            credit = match.group(1)
            credit = re.split(
                r"\b(?:remix(?:es|ed)?|dub|club\s+mix(?:es)?|live)\b",
                credit,
                maxsplit=1,
                flags=re.I,
            )[0]
            for name in re.split(r"\s*(?:,|&|;|\band\b)\s*", credit, flags=re.I):
                key = _normalize_feature_artist(name)
                if key:
                    found.add(key)
    return found


def remix_base_title_key(text: str) -> str:
    """Normalize a title only for locating its non-remix counterpart.

    This is NOT duplicate identity evidence. Duplicate identity remains audio-only.
    """
    value = ascii_punctuation(text or "")
    value = re.sub(
        r"[\[(]\s*(?:feat(?:uring)?|ft)\.?\s+[^\])]+[\])]",
        " ",
        value,
        flags=re.I,
    )
    value = re.sub(
        r"\s+(?:feat(?:uring)?|ft)\.?\s+.*$",
        " ",
        value,
        flags=re.I,
    )
    value = re.sub(
        r"[\[(]\s*[^)\]]*\b(?:remix(?:es|ed)?|dub|club\s+mix(?:es)?|"
        r"sped\s*up|speed\s*up|slowed(?:\s*down)?|reverb(?:ed)?|redux)\b[^)\]]*[\])]",
        " ",
        value,
        flags=re.I,
    )
    value = re.sub(
        r"\b(?:remix(?:es|ed)?|dub|club\s+mix(?:es)?|"
        r"sped\s*up|speed\s*up|slowed(?:\s*down)?|reverb(?:ed)?|redux)\b",
        " ",
        value,
        flags=re.I,
    )
    return re.sub(r"[^a-z0-9]+", "", normalize_title(value))


def _personal_pick_normalize(text: str) -> str:
    value = normalize_title(ascii_punctuation(text or ""))
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def _personal_phrase_family(text: str) -> str:
    """Normalize a detected live/remix descriptor into a reusable phrase rule."""
    value = normalize_space(ascii_punctuation(text or "").replace("_", " "))
    value = re.sub(r"\s*(?:[-,;/]|\s)+\s*(?:19|20)\d{2}\s*$", "", value).strip(" -_,;/")
    value = re.sub(r"\b(?:19|20)\d{2}\b", " ", value)
    value = normalize_space(value).strip(" -_,;/")

    # Prefer venue/session family phrases over one-off location/year suffixes.
    m = re.match(r"^(live\s+(?:from|at)\s+[^,;]+)", value, re.I)
    if m:
        value = normalize_space(m.group(1))

    return value


def detect_personal_pick_phrases(roots: List[Path]) -> List[Tuple[str, int, List[str]]]:
    """Scan audio filenames and return reusable live/remix phrase candidates."""
    grouped: Dict[str, Dict[str, object]] = {}

    for root in roots:
        if not root or not root.is_dir():
            continue
        try:
            files = root.rglob("*")
        except Exception:
            continue

        for path in files:
            try:
                if not path.is_file() or path.suffix.lower() not in AUDIO_EXTS:
                    continue
            except OSError:
                continue

            title = strip_track_number(path.stem)
            source = normalize_space(ascii_punctuation(title).replace("_", " "))
            raw_parts = [normalize_space(x) for x in re.findall(r"[\(\[]([^\)\]]+)[\)\]]", source)]

            # Named/trailing Mix descriptors are not always bracketed.
            raw_parts.extend(_mix_descriptor_candidates(source))

            seen_here: Set[str] = set()
            for raw in raw_parts:
                family = _personal_phrase_family(raw)
                if not family:
                    continue
                if not (is_remix_text(family) or is_live_text(family)):
                    continue

                key = _personal_pick_normalize(family)
                if not key or key in seen_here:
                    continue
                seen_here.add(key)

                row = grouped.setdefault(
                    key,
                    {"labels": Counter(), "count": 0, "examples": []},
                )
                row["labels"][family] += 1
                row["count"] += 1
                if len(row["examples"]) < 3 and title not in row["examples"]:
                    row["examples"].append(title)

    result: List[Tuple[str, int, List[str]]] = []
    for row in grouped.values():
        labels: Counter = row["labels"]
        label = labels.most_common(1)[0][0] if labels else ""
        if label:
            result.append((label, int(row["count"]), list(row["examples"])))

    return sorted(result, key=lambda item: (-item[1], item[0].casefold()))


def detect_personal_pick_phrases_from_tracks(
    tracks: List["Track"],
    include_remixes: bool = True,
    include_live: bool = True,
) -> List[Tuple[str, int, List[str]]]:
    """Detect reusable remix/live phrase families from already-scanned tracks."""
    grouped: Dict[str, Dict[str, object]] = {}

    for track in tracks:
        title = track.display_title or strip_track_number(track.path.stem)
        source = normalize_space(ascii_punctuation(title).replace("_", " "))

        track_is_remix = is_remix_text(source)
        track_is_live = is_live_text(source)
        if not (track_is_remix or track_is_live):
            continue

        # During Analyze we only need exceptions for categories that are globally skipped.
        if track_is_remix and not track_is_live and not include_remixes:
            continue
        if track_is_live and not track_is_remix and not include_live:
            continue
        if track_is_remix and track_is_live and not (include_remixes or include_live):
            continue

        raw_parts = [normalize_space(x) for x in re.findall(r"[\(\[]([^\)\]]+)[\)\]]", source)]
        raw_parts.extend(_mix_descriptor_candidates(source))

        for pattern in (
            r"\bLive\s+(?:From|At)\s+.+$",
            r"\b[^()\[\]]{0,80}\b(?:Session|Sessions|Unplugged)\b[^()\[\]]*$",
            r"(?:^|\s+-\s+)([^-]+\b(?:Remix|Rmx|Redux|Dub|Sped\s*Up|Speed\s*Up|Slowed(?:\s*Down)?|Reverb(?:ed)?)\b.*)$",
        ):
            match = re.search(pattern, source, re.I)
            if match:
                raw_parts.append(normalize_space(match.group(1) if match.lastindex else match.group(0)))

        if not raw_parts:
            raw_parts.append(source)

        seen_here: Set[str] = set()
        for raw in raw_parts:
            family = _personal_phrase_family(raw)
            if not family:
                continue

            family_is_remix = is_remix_text(family)
            family_is_live = is_live_text(family)
            if not (family_is_remix or family_is_live):
                continue
            if family_is_remix and not family_is_live and not include_remixes:
                continue
            if family_is_live and not family_is_remix and not include_live:
                continue
            if family_is_remix and family_is_live and not (include_remixes or include_live):
                continue

            key = _personal_pick_normalize(family)
            if not key or key in seen_here:
                continue
            seen_here.add(key)

            row = grouped.setdefault(
                key,
                {"labels": Counter(), "count": 0, "examples": []},
            )
            row["labels"][family] += 1
            row["count"] += 1
            example = repair_mojibake(title)
            if len(row["examples"]) < 3 and example not in row["examples"]:
                row["examples"].append(example)

    result: List[Tuple[str, int, List[str]]] = []
    for row in grouped.values():
        labels: Counter = row["labels"]
        label = labels.most_common(1)[0][0] if labels else ""
        if label:
            result.append((label, int(row["count"]), list(row["examples"])))

    return sorted(result, key=lambda item: (-item[1], item[0].casefold()))


def _personal_pick_match(track: "Track", rules: List[Dict[str, str]]) -> str:
    """Return the matching user rule, or an empty string.

    Personal picks are preference metadata only. They can override an unchecked
    remix/live checkbox, but they never create duplicate identity.
    """
    title_values = {
        _personal_pick_normalize(track.display_title),
        _personal_pick_normalize(strip_track_number(track.path.stem)),
    }
    title_values.discard("")

    for item in rules:
        if not isinstance(item, dict):
            continue
        mode = str(item.get("mode", "contains")).strip().lower()
        raw = str(item.get("value", "")).strip()
        needle = _personal_pick_normalize(raw)
        if not needle:
            continue

        if mode == "exact":
            matched = needle in title_values
        else:
            matched = any(needle in value for value in title_values)

        if matched:
            return raw
    return ""


def configure_exclusions(
    releases: List["Release"],
    exclude_remixes: bool,
    exclude_live: bool,
    personal_keep_rules: Optional[List[Dict[str, str]]] = None,
) -> None:
    """Apply Save Remixes / Save Live, then restore explicit personal picks.

    Checked categories participate normally. Unchecked categories are skipped,
    except tracks matching a Personal Picks rule. A personal pick participates
    normally in collection optimization without forcing any particular release.
    """
    tracks = [track for rel in releases for track in rel.tracks]
    rules = list(personal_keep_rules or [])

    for track in tracks:
        classification_text = f"{track.display_title} {strip_track_number(track.path.stem)}"
        track.is_remix = is_remix_text(classification_text)
        track.is_live = is_live_text(classification_text)
        track.remix_feature_exception = False
        track.personal_keep_rule = ""

        track.exclude_from_coverage = (
            (exclude_remixes and track.is_remix)
            or (exclude_live and track.is_live)
        )

        if track.exclude_from_coverage and rules:
            matched_rule = _personal_pick_match(track, rules)
            if matched_rule:
                track.exclude_from_coverage = False
                track.personal_keep_rule = matched_rule


def normalize_artist(text: str) -> str:
    text = ascii_punctuation(text).lower()
    text = re.sub(r"\b(?:feat(?:uring)?|ft)\.?\b.*$", "", text).strip()
    return re.sub(r"[^a-z0-9$]+", "", text)


def normalized_tag_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(k).lower())


def tag_lookup(tags: Dict[str, str], *names: str) -> str:
    indexed = {normalized_tag_key(k): str(v) for k, v in tags.items()}
    for name in names:
        v = indexed.get(normalized_tag_key(name))
        if v:
            return v
    return ""


def parse_track_number(value: str, fallback: int) -> int:
    m = re.search(r"\d+", value or "")
    return int(m.group()) if m else fallback


def explicit_state(tags: Dict[str, str], *texts: str) -> str:
    # ITUNESADVISORY is authoritative when present:
    #   0 = clean
    #   1 = explicit
    advisory = tag_lookup(tags, "itunesadvisory", "rtng", "advisory")
    if advisory:
        av = advisory.strip().lower()
        if av in {"1", "explicit", "yes", "true"}:
            return "explicit"
        if av in {"0", "2", "clean", "no", "false"}:
            return "clean"
    ex = tag_lookup(tags, "explicit")
    if ex:
        ev = ex.strip().lower()
        if ev in {"1", "yes", "true", "explicit"}:
            return "explicit"
        if ev in {"0", "no", "false", "clean"}:
            return "clean"
    joined = " ".join(texts).lower()
    if re.search(r"(?:\(|\[|\b)explicit(?:\)|\]|\b)", joined):
        return "explicit"
    if re.search(r"(?:\(|\[|\b)clean(?:\)|\]|\b)", joined):
        return "clean"
    return "unknown"


def release_title_from_folder(name: str) -> str:
    s = re.sub(r"^\d{4}(?:-\d{2}-\d{2})?\s*-\s*", "", name).strip()
    s = re.sub(r"\s*\[[^\]]+\]\s*$", "", s).strip()
    return s


def album_family(title: str) -> str:
    s = ascii_punctuation(title)
    changed = True
    while changed:
        old = s
        for pat in EDITION_PATTERNS:
            s = re.sub(pat, "", s, flags=re.I).strip()
        changed = old != s
    s = re.sub(r"\s+-\s+(?:deluxe|limited|special|expanded|remastered?)\s*$", "", s, flags=re.I)
    return normalize_title(s)


def infer_release_type(title: str, folder_name: str, track_count: int, tags: Dict[str, str]) -> Tuple[str, str]:
    raw = tag_lookup(tags, "releasetype", "musicbrainzalbumtype", "albumtype", "primaryreleasetype").lower()
    if raw:
        if "album" in raw:
            return "album", "tag"
        if "ep" in raw:
            return "ep", "tag"
        if "single" in raw:
            return "single", "tag"
    x = f"{title} {folder_name}".lower()
    if re.search(r"\b(?:single)\b", x):
        return "single", "name"
    if re.search(r"\bep\b|remix(?:es)?|\brmx\b", x):
        return "ep", "name"
    if track_count >= 7:
        return "album", "heuristic"
    if track_count <= 2:
        return "single", "heuristic"
    return "ep", "heuristic"


def locate_executable(name: str) -> Optional[str]:
    p = shutil.which(name)
    if p:
        return p
    local = os.environ.get("LOCALAPPDATA")
    if local:
        candidate = Path(local) / "Microsoft" / "WinGet" / "Links" / (name + ".exe")
        if candidate.exists():
            return str(candidate)
    return None


def run_hidden(args: List[str], **kwargs) -> subprocess.CompletedProcess:
    creationflags = 0
    if os.name == "nt":
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.run(args, creationflags=creationflags, **kwargs)


def bootstrap_winget() -> Optional[str]:
    winget = locate_executable("winget")
    if winget:
        return winget
    if os.name != "nt":
        return None
    ps = locate_executable("powershell") or locate_executable("pwsh")
    if not ps:
        return None
    script = (
        "$ProgressPreference='SilentlyContinue';"
        "Install-PackageProvider -Name NuGet -Force | Out-Null;"
        "Install-Module -Name Microsoft.WinGet.Client -Force -Repository PSGallery | Out-Null;"
        "Import-Module Microsoft.WinGet.Client;"
        "Repair-WinGetPackageManager -Force -Latest"
    )
    try:
        run_hidden([ps, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], check=False)
    except Exception:
        return None
    return locate_executable("winget")


def _dependency_update_cache_path() -> Path:
    return _cache_dir() / "dependency_updates.json"


def _load_dependency_update_cache() -> Dict[str, float]:
    _migrate_legacy_app_data()
    path = _dependency_update_cache_path()
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {str(k): float(v) for k, v in data.items()}
    except Exception:
        pass
    return {}


def _mark_dependency_checked(package_id: str) -> None:
    data = _load_dependency_update_cache()
    data[package_id] = time.time()
    try:
        _atomic_write_json(_dependency_update_cache_path(), data)
    except Exception:
        pass


def _winget_install_or_update(package_id: str, installed: bool) -> None:
    """Install missing dependencies or periodically check installed ones for updates."""
    winget = bootstrap_winget()
    if not winget:
        return

    if installed:
        last = _load_dependency_update_cache().get(package_id, 0.0)
        if time.time() - last < 7 * 24 * 60 * 60:
            return
        action = "upgrade"
    else:
        action = "install"

    args = [
        winget,
        action,
        "--id", package_id,
        "-e",
        "--source", "winget",
        "--accept-package-agreements",
        "--accept-source-agreements",
        "--silent",
    ]
    try:
        run_hidden(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
            check=False,
        )
    finally:
        _mark_dependency_checked(package_id)


def ensure_ffmpeg() -> Tuple[str, str]:
    # Mandatory dependency preflight: make sure winget itself is available first.
    bootstrap_winget()

    ffmpeg = locate_executable("ffmpeg")
    ffprobe = locate_executable("ffprobe")
    installed = bool(ffmpeg and ffprobe)
    _winget_install_or_update(FFMPEG_PACKAGE_ID, installed=installed)

    ffmpeg = locate_executable("ffmpeg")
    ffprobe = locate_executable("ffprobe")
    if not (ffmpeg and ffprobe):
        raise RuntimeError("FFmpeg/FFprobe are required and could not be installed automatically.")
    return ffmpeg, ffprobe


def locate_cuetools_arcue() -> Optional[str]:
    """Find CUETools' console AccurateRip/CTDB verifier."""
    for name in ("CUETools.ARCUE", "CUETools.ARCUE.exe", "ArCueDotNet", "ArCueDotNet.exe"):
        found = locate_executable(name)
        if found:
            return found

    main = locate_executable("CUETools")
    if main:
        sibling = Path(main).with_name("CUETools.ARCUE.exe")
        if sibling.exists():
            return str(sibling)

    roots: List[Path] = []
    for env_name in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
        value = os.environ.get(env_name)
        if value:
            roots.append(Path(value))

    local = os.environ.get("LOCALAPPDATA")
    if local:
        packages = Path(local) / "Microsoft" / "WinGet" / "Packages"
        if packages.is_dir():
            try:
                for folder in packages.glob("gchudov.CUETools_*"):
                    candidate = next(folder.rglob("CUETools.ARCUE.exe"), None)
                    if candidate:
                        return str(candidate)
            except OSError:
                pass

    for root in roots:
        for relative in (
            Path("CUETools") / "CUETools.ARCUE.exe",
            Path("Programs") / "CUETools" / "CUETools.ARCUE.exe",
        ):
            candidate = root / relative
            if candidate.exists():
                return str(candidate)
    return None


def ensure_cuetools_arcue() -> Optional[str]:
    """Reuse CUETools when present; install or periodically update it through winget."""
    bootstrap_winget()
    arc = locate_cuetools_arcue()
    _winget_install_or_update(CUETOOLS_PACKAGE_ID, installed=bool(arc))
    return locate_cuetools_arcue()


def _cuetools_verify_output(arcue: str, cue_path: Path) -> Tuple[bool, int, int, str]:
    """Return positive verification, best confidence, match-line count and raw output."""
    cp = run_hidden(
        [arcue, "-v", str(cue_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        errors="replace",
        check=False,
        timeout=180,
    )
    output = normalize_space((cp.stdout or "") + "\n" + (cp.stderr or ""))
    matches = len(re.findall(r"\bAccurately ripped\b", output, re.I))
    confidences = [
        int(value)
        for value in re.findall(
            r"\((\d+)(?:\+\d+)?/\d+\)\s+Accurately ripped",
            output,
            re.I,
        )
    ]
    best_confidence = max(confidences, default=(1 if matches else 0))
    return bool(matches), best_confidence, matches, output


def verify_cuetools_image_families(
    releases: List["Release"],
    progress_cb,
    errors: List[str],
) -> None:
    """Verify CUE-based rips with CUETools when an image rip is in the family.

    CUETools verification is positive quality evidence only. Database absence,
    no-match output, or CUETools failure remains neutral and never marks a rip bad.
    """
    image_families = {r.family for r in releases if r.has_cd_image and r.family}
    if not image_families:
        return

    jobs = [
        (rel, cue)
        for rel in releases
        if rel.has_cue and rel.family in image_families
        for cue in rel.cue_paths
    ]
    if not jobs:
        return

    arcue = ensure_cuetools_arcue()
    if not arcue:
        errors.append("CUETools.ARCUE.exe was not found; CD-image verification skipped.")
        return

    progress_cb("Verifying CD image families with CUETools...", 0, len(jobs))
    for index, (rel, cue) in enumerate(jobs, 1):
        rel.cuetools_checked_cues += 1
        try:
            verified, confidence, match_lines, output = _cuetools_verify_output(arcue, cue)
            rel.cuetools_match_lines += match_lines
            if verified:
                rel.cuetools_verified_cues += 1
                if rel.cuetools_min_confidence <= 0:
                    rel.cuetools_min_confidence = confidence
                else:
                    rel.cuetools_min_confidence = min(rel.cuetools_min_confidence, confidence)
                rel.cuetools_notes.append(
                    f"{cue.name}: verified, confidence {confidence}, {match_lines} match line(s)"
                )
            else:
                rel.cuetools_notes.append(f"{cue.name}: no positive AccurateRip/CTDB match")
                if output:
                    errors.append(f"CUETools verification neutral: {cue}: no positive match")
        except Exception as exc:
            rel.cuetools_notes.append(f"{cue.name}: verification failed: {exc}")
            errors.append(f"CUETools verification error: {cue}: {exc}")

        progress_cb("Verifying CD image families with CUETools...", index, len(jobs))


def cuetools_cd_quality_key(rel: "Release") -> Optional[Tuple[int, int]]:
    """Positive CUETools verification evidence; unavailable/no-match stays neutral."""
    if not rel.cue_paths:
        return None
    if rel.cuetools_checked_cues != len(rel.cue_paths):
        return None
    if rel.cuetools_verified_cues != len(rel.cue_paths):
        return None
    if rel.cuetools_verified_cues <= 0:
        return None
    return rel.cuetools_min_confidence, rel.cuetools_match_lines


def cuetools_cd_quality_text(rel: "Release") -> str:
    key = cuetools_cd_quality_key(rel)
    if key is None:
        if rel.cuetools_checked_cues:
            return (
                f"neutral ({rel.cuetools_verified_cues}/{rel.cuetools_checked_cues} "
                "CUE file(s) positively verified)"
            )
        return "not checked"
    confidence, matches = key
    return (
        f"verified ({rel.cuetools_verified_cues}/{rel.cuetools_checked_cues} CUE file(s), "
        f"min confidence {confidence}, {matches} AccurateRip/CTDB match line(s))"
    )


def ensure_heybrochecklog():
    """Return the pinned log scorer, stored under this program's dependencies folder."""
    _migrate_legacy_app_data()
    deps = _dependencies_dir() / f"heybrochecklog-{HEYBROCHECKLOG_VERSION}"

    legacy = (
        Path(os.environ.get("LOCALAPPDATA") or Path.home())
        / "Karpuzikov"
        / PROGRAM_DATA_DIR_NAME
        / "deps"
        / f"heybrochecklog-{HEYBROCHECKLOG_VERSION}"
    )
    if not deps.exists() and legacy.is_dir():
        try:
            shutil.copytree(legacy, deps, dirs_exist_ok=True)
        except Exception:
            pass

    deps_text = str(deps)
    if deps.is_dir() and deps_text not in sys.path:
        sys.path.insert(0, deps_text)

    try:
        module = importlib.import_module("heybrochecklog")
        return module.score_log
    except Exception:
        pass

    # Keep the dependency isolated from the user's normal Python environment.
    bootstrap_winget()
    try:
        pip_check = run_hidden(
            [sys.executable, "-m", "pip", "--version"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
            check=False,
        )
        if pip_check.returncode != 0:
            run_hidden(
                [sys.executable, "-m", "ensurepip", "--upgrade"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                errors="replace",
                check=False,
            )

        deps.mkdir(parents=True, exist_ok=True)
        cp = run_hidden(
            [
                sys.executable, "-m", "pip", "install",
                "--disable-pip-version-check", "--quiet",
                "--upgrade",
                "--target", str(deps),
                HEYBROCHECKLOG_SOURCE,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
            check=False,
        )
        if cp.returncode != 0:
            raise RuntimeError(cp.stderr.strip() or cp.stdout.strip() or "pip install failed")

        if deps_text not in sys.path:
            sys.path.insert(0, deps_text)
        importlib.invalidate_caches()
        for module_name in [name for name in list(sys.modules) if name == "heybrochecklog" or name.startswith("heybrochecklog.")]:
            sys.modules.pop(module_name, None)
        module = importlib.import_module("heybrochecklog")
        return module.score_log
    except Exception as exc:
        raise RuntimeError(
            "hey-bro-check-log is required for CD rip log quality scoring and "
            f"could not be installed automatically: {exc}"
        ) from exc


@dataclass
class Track:
    release_id: int
    path: Path
    index: int
    title: str = ""
    artist: str = ""
    album: str = ""
    duration: float = 0.0
    tags: Dict[str, str] = field(default_factory=dict)
    mbid: str = ""
    isrc: str = ""
    fingerprint: Tuple[int, ...] = field(default_factory=tuple)
    fingerprint_duration: float = 0.0
    explicit: str = "unknown"
    group_id: int = -1
    is_remix: bool = False
    is_live: bool = False
    remix_feature_exception: bool = False
    exclude_from_coverage: bool = False
    excluded_by_pattern: str = ""
    personal_keep_rule: str = ""
    base_excluded_from_coverage: bool = False
    manual_skip_rule: str = ""
    codec_name: str = ""
    sample_rate: int = 0
    bit_depth: int = 0
    channels: int = 0
    bit_rate: int = 0
    file_size: int = 0
    virtual_from_cue: bool = False
    cue_path: Optional[Path] = None
    cue_track_number: int = 0
    cue_start_seconds: float = 0.0
    cue_end_seconds: float = 0.0
    cue_title: str = ""
    cue_performer: str = ""
    cue_album: str = ""
    cue_isrc: str = ""

    @property
    def display_title(self) -> str:
        return self.title or strip_track_number(self.path.stem)


@dataclass
class Release:
    rid: int
    root_kind: str
    path: Path
    title: str
    paths: List[Path] = field(default_factory=list)
    scan_root: Optional[Path] = None
    tracks: List[Track] = field(default_factory=list)
    release_type: str = "unknown"
    type_source: str = ""
    family: str = ""
    source_quality: int = 0
    source_medium: str = "Unknown"
    explicit: str = "unknown"
    has_cue: bool = False
    has_rip_log: bool = False
    has_audiochecker: bool = False
    rip_log_paths: List[Path] = field(default_factory=list)
    rip_log_scores: List[int] = field(default_factory=list)
    rip_log_rippers: List[str] = field(default_factory=list)
    rip_log_flagged: int = 0
    rip_log_unrecognized: List[str] = field(default_factory=list)
    has_cd_image: bool = False
    cd_image_track_count: int = 0
    cue_paths: List[Path] = field(default_factory=list)
    cuetools_checked_cues: int = 0
    cuetools_verified_cues: int = 0
    cuetools_min_confidence: int = 0
    cuetools_match_lines: int = 0
    cuetools_notes: List[str] = field(default_factory=list)

    @property
    def source_paths(self) -> List[Path]:
        return list(self.paths) if self.paths else [self.path]

    @property
    def track_count(self) -> int:
        return len(self.tracks)

    @property
    def included_track_count(self) -> int:
        """Tracks included by the active checkboxes/pattern choices."""
        return sum(1 for t in self.tracks if not t.exclude_from_coverage)

    @property
    def ignored_track_count(self) -> int:
        """Tracks skipped by the active checkboxes/pattern choices."""
        return sum(1 for t in self.tracks if t.exclude_from_coverage)

    @property
    def groups(self) -> Set[int]:
        return {t.group_id for t in self.tracks if t.group_id >= 0 and not t.exclude_from_coverage}

    @property
    def excluded_only(self) -> bool:
        return bool(self.tracks) and all(t.exclude_from_coverage for t in self.tracks)

    @property
    def has_remixes(self) -> bool:
        # Used only for duplicate destination routing. A package explicitly titled
        # Remixes belongs under !Remixes even when it also contains included versions.
        package_text = f"{self.title} {self.path.name}"
        return any(t.is_remix for t in self.tracks) or bool(REMIX_RELEASE_RE.search(ascii_punctuation(package_text)))

    @property
    def remix_only(self) -> bool:
        return bool(self.tracks) and all(t.is_remix for t in self.tracks)


class UnionFind:
    def __init__(self, n: int):
        self.p = list(range(n))
        self.r = [0] * n

    def find(self, x: int) -> int:
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.r[ra] < self.r[rb]:
            ra, rb = rb, ra
        self.p[rb] = ra
        if self.r[ra] == self.r[rb]:
            self.r[ra] += 1


def probe_track(ffprobe: str, track: Track) -> None:
    cmd = [
        ffprobe, "-v", "error",
        "-show_entries",
        "stream=codec_name,codec_type,sample_rate,bits_per_sample,bits_per_raw_sample,channels,bit_rate:"
        "format=duration,bit_rate:format_tags",
        "-of", "json", str(track.path)
    ]
    cp = run_hidden(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace", check=False)
    if cp.returncode != 0:
        raise RuntimeError(cp.stderr.strip() or "ffprobe failed")
    data = json.loads(cp.stdout or "{}")
    fmt = data.get("format") or {}
    full_duration = float(fmt.get("duration") or 0.0)
    track.tags = {str(k): str(v) for k, v in (fmt.get("tags") or {}).items()}

    if track.virtual_from_cue:
        start = max(0.0, float(track.cue_start_seconds))
        end = float(track.cue_end_seconds)
        track.duration = (end - start) if end > start else max(0.0, full_duration - start)
        track.title = track.cue_title or f"Track {track.cue_track_number:02d}"
        track.artist = track.cue_performer or tag_lookup(track.tags, "artist")
        track.album = track.cue_album or tag_lookup(track.tags, "album")
        track.isrc = track.cue_isrc or tag_lookup(track.tags, "isrc")
        if track.cue_track_number:
            track.tags["TRACKNUMBER"] = str(track.cue_track_number)
    else:
        track.duration = full_duration
        track.title = tag_lookup(track.tags, "title") or strip_track_number(track.path.stem)
        track.artist = tag_lookup(track.tags, "artist")
        track.album = tag_lookup(track.tags, "album")
        track.isrc = tag_lookup(track.tags, "isrc")

    track.mbid = tag_lookup(track.tags, "musicbrainztrackid", "musicbrainzrecordingid", "musicbrainz track id")
    track.explicit = explicit_state(track.tags, track.title, track.path.name, track.album)

    audio_stream = next(
        (stream for stream in (data.get("streams") or []) if str(stream.get("codec_type") or "").lower() == "audio"),
        {},
    )
    track.codec_name = str(audio_stream.get("codec_name") or "").lower()
    try:
        track.sample_rate = int(audio_stream.get("sample_rate") or 0)
    except (TypeError, ValueError):
        track.sample_rate = 0
    try:
        track.bit_depth = int(audio_stream.get("bits_per_raw_sample") or audio_stream.get("bits_per_sample") or 0)
    except (TypeError, ValueError):
        track.bit_depth = 0
    try:
        track.channels = int(audio_stream.get("channels") or 0)
    except (TypeError, ValueError):
        track.channels = 0
    try:
        track.bit_rate = int(audio_stream.get("bit_rate") or fmt.get("bit_rate") or 0)
    except (TypeError, ValueError):
        track.bit_rate = 0
    try:
        track.file_size = track.path.stat().st_size
    except OSError:
        track.file_size = 0


def locate_fpcalc() -> Optional[str]:
    _migrate_legacy_app_data()
    app_local = _dependencies_dir() / f"Chromaprint-{CHROMAPRINT_VERSION}" / "fpcalc.exe"
    if app_local.exists():
        return str(app_local)

    p = locate_executable("fpcalc")
    if p:
        return p

    candidates: List[Path] = []
    pf = os.environ.get("ProgramFiles")
    pf86 = os.environ.get("ProgramFiles(x86)")
    local = os.environ.get("LOCALAPPDATA")
    if pf:
        candidates.append(Path(pf) / "MusicBrainz Picard" / "fpcalc.exe")
    if pf86:
        candidates.append(Path(pf86) / "MusicBrainz Picard" / "fpcalc.exe")
    if local:
        candidates.extend([
            Path(local) / "Programs" / "MusicBrainz Picard" / "fpcalc.exe",
            Path(local) / "Karpuzikov" / "Discography Builder" / f"Chromaprint-{CHROMAPRINT_VERSION}" / "fpcalc.exe",
        ])
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def ensure_fpcalc() -> str:
    # Mandatory dependency preflight: winget first, even though Chromaprint's
    # official versioned binary is installed app-locally when needed.
    bootstrap_winget()
    _migrate_legacy_app_data()

    target = _dependencies_dir() / f"Chromaprint-{CHROMAPRINT_VERSION}"
    exe = target / "fpcalc.exe"
    if exe.exists():
        return str(exe)

    # Preserve earlier downloaded dependency without removing the old copy.
    legacy = (
        Path(os.environ.get("LOCALAPPDATA") or Path.home())
        / "Karpuzikov"
        / "Discography Builder"
        / f"Chromaprint-{CHROMAPRINT_VERSION}"
        / "fpcalc.exe"
    )
    if legacy.is_file():
        try:
            target.mkdir(parents=True, exist_ok=True)
            shutil.copy2(legacy, exe)
            return str(exe)
        except Exception:
            pass

    # A system/Picard copy can be used immediately, but downloads owned by this
    # program are always stored inside its own dependencies folder.
    existing = locate_fpcalc()
    if existing and Path(existing) != exe:
        return existing

    if os.name != "nt":
        raise RuntimeError("fpcalc/Chromaprint is required.")

    target.mkdir(parents=True, exist_ok=True)
    _temp_dir().mkdir(parents=True, exist_ok=True)
    zip_path = _temp_dir() / f"chromaprint-{CHROMAPRINT_VERSION}.zip"
    try:
        urllib.request.urlretrieve(CHROMAPRINT_URL, zip_path)
        with zipfile.ZipFile(zip_path, "r") as archive:
            archive.extractall(target)
        found = next(target.rglob("fpcalc.exe"), None)
        if not found:
            raise RuntimeError("fpcalc.exe was not found in the downloaded Chromaprint archive.")
        if found != exe:
            shutil.copy2(found, exe)
    finally:
        try:
            zip_path.unlink(missing_ok=True)
        except Exception:
            pass
    return str(exe)


def chromaprint_fingerprint(fpcalc: str, track: Track) -> Tuple[Tuple[int, ...], float]:
    fingerprint_source = track.path
    temporary_path: Optional[Path] = None

    if track.virtual_from_cue:
        ffmpeg = locate_executable("ffmpeg")
        if not ffmpeg:
            ffmpeg, _ffprobe = ensure_ffmpeg()

        _migrate_legacy_app_data()
        temp_root = _temp_dir() / "cue_segments"
        temp_root.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(
            prefix=f"cue_{track.release_id}_{track.cue_track_number:02d}_",
            suffix=".wav",
            dir=str(temp_root),
        )
        os.close(fd)
        temporary_path = Path(temp_name)

        cmd = [
            ffmpeg,
            "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{max(0.0, track.cue_start_seconds):.6f}",
            "-i", str(track.path),
        ]
        if track.duration > 0:
            cmd += ["-t", f"{track.duration:.6f}"]
        cmd += ["-map", "0:a:0", "-vn", "-acodec", "pcm_s16le", "-f", "wav", str(temporary_path)]

        cp = run_hidden(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace", check=False)
        if cp.returncode != 0:
            try:
                temporary_path.unlink(missing_ok=True)
            except Exception:
                pass
            raise RuntimeError(cp.stderr.strip() or "ffmpeg failed to extract CUE track")
        fingerprint_source = temporary_path

    try:
        cmd = [fpcalc, "-length", "0", "-raw", "-json", str(fingerprint_source)]
        cp = run_hidden(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace", check=False)
        if cp.returncode not in (0, 3):
            raise RuntimeError(cp.stderr.strip() or "fpcalc failed")
        data = json.loads((cp.stdout or "{}").strip())
        fp = tuple(int(x) & 0xFFFFFFFF for x in (data.get("fingerprint") or []))
        if not fp:
            raise RuntimeError("fpcalc returned an empty fingerprint")
        return fp, float(data.get("duration") or track.duration or 0.0)
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except Exception:
                pass


ADVISORY_VERSION_PAREN_RE = re.compile(
    r"[\[(]\s*(?:(?:album|main|original)\s+version(?:\s+(?:explicit|edited|clean|dirty|censored))?|"
    r"(?:explicit|edited|clean|dirty|censored)\s+version|(?:explicit|clean|dirty|censored))\s*[\])]",
    re.I,
)
ADVISORY_VERSION_TRAILING_RE = re.compile(
    r"\s*(?:-|:)\s*(?:(?:album|main|original)\s+version(?:\s+(?:explicit|edited|clean|dirty|censored))?|"
    r"(?:explicit|edited|clean|dirty|censored)\s+version)\s*$",
    re.I,
)
CENSOR_MASK_RE = re.compile(r"(?:\*{2,}|_{2,})")


def strip_featured_credit_for_match(text: str) -> str:
    text = ascii_punctuation(text or "")
    text = re.sub(r"[\[(]\s*(?:feat(?:uring)?|ft)\.?\s+[^\])]+[\])]", " ", text, flags=re.I)
    text = re.sub(r"\s+(?:feat(?:uring)?|ft)\.?\s+[^\[(]+$", " ", text, flags=re.I)
    return normalize_space(text)


def strip_advisory_version_for_match(text: str) -> str:
    """Ignore explicit/clean advisory wording in the current analyzer stage.

    This intentionally strips labels such as Album Version Edited/Explicit and
    Explicit/Clean Version, while preserving semantic versions such as Radio Edit,
    Acoustic, French Version, US Version, Guitar Version, etc.
    """
    text = ADVISORY_VERSION_PAREN_RE.sub(" ", text or "")
    text = ADVISORY_VERSION_TRAILING_RE.sub(" ", text)
    return normalize_space(text)


def title_for_match(text: str) -> str:
    text = strip_featured_credit_for_match(text)
    text = strip_advisory_version_for_match(text)
    return text


def identity_title(text: str) -> str:
    n = normalize_title(title_for_match(text))
    # Mastering labels are not separate songs for this project's coverage goal.
    n = re.sub(r"[\[(]?\s*(?:\d{4}\s+)?remaster(?:ed)?(?:\s+version)?\s*[\])] ?", " ", n, flags=re.I)
    n = re.sub(r"\b(?:\d{4}\s+)?remaster(?:ed)?\b", " ", n, flags=re.I)
    return re.sub(r"[^a-z0-9]+", "", normalize_space(n))


def content_qualifiers(text: str) -> Set[str]:
    q = semantic_qualifiers(title_for_match(text))
    q.discard("remaster")
    q.discard("remastered")
    # Explicit/clean/edited advisory state is intentionally not an active
    # analyzer criterion until a reliable detector is implemented.
    q.discard("explicit")
    q.discard("clean")
    q.discard("version")
    return q


def masked_title_compatible(a: str, b: str) -> bool:
    """Allow censorship masks such as Ni**as / Ni__as to match the full title."""
    def pattern(text: str):
        raw = title_for_match(text or "").lower()
        if not CENSOR_MASK_RE.search(raw):
            return None
        raw = CENSOR_MASK_RE.sub(" CENSORMASK ", raw)
        raw = ascii_punctuation(raw)
        parts = re.split(r"\s*CENSORMASK\s*", raw)
        keys = [re.sub(r"[^a-z0-9]+", "", normalize_title(x)) for x in parts]
        return "^" + "[a-z0-9]*".join(re.escape(k) for k in keys) + "$"

    ka = identity_title(a)
    kb = identity_title(b)
    pa = pattern(a)
    pb = pattern(b)
    return bool((pa and re.fullmatch(pa, kb)) or (pb and re.fullmatch(pb, ka)))


def fingerprint_similarity(fp1: Tuple[int, ...], fp2: Tuple[int, ...]) -> Optional[Tuple[float, float, float, int, float, float, int]]:
    """Compare Chromaprint fingerprints using audio only.

    Always evaluate zero/near-zero alignment in addition to histogram candidates.
    The previous implementation could omit the real shift when alternate
    masterings produced too few identical high-bit fingerprint words.
    """
    if not fp1 or not fp2 or min(len(fp1), len(fp2)) < 20:
        return None

    positions12 = defaultdict(list)
    positions10 = defaultdict(list)
    for i, value in enumerate(fp1):
        positions12[(value >> 20) & 0xFFF].append(i)
        positions10[(value >> 22) & 0x3FF].append(i)

    histogram = Counter()
    for j, value in enumerate(fp2):
        for i in positions12.get((value >> 20) & 0xFFF, ()):
            histogram[i - j] += 4
        for i in positions10.get((value >> 22) & 0x3FF, ()):
            histogram[i - j] += 1

    shifts: List[int] = []
    seen_shifts: Set[int] = set()

    def add_shift(value: int) -> None:
        if value not in seen_shifts:
            seen_shifts.add(value)
            shifts.append(value)

    for shift in (0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6):
        add_shift(shift)
    for shift, _count in histogram.most_common(24):
        add_shift(shift)

    best = None
    for shift in shifts:
        a0 = max(shift, 0)
        b0 = max(-shift, 0)
        n = min(len(fp1) - a0, len(fp2) - b0)
        if n < 20:
            continue
        overlap = n / max(1, min(len(fp1), len(fp2)))
        dists = [(fp1[a0 + k] ^ fp2[b0 + k]).bit_count() for k in range(n)]
        avg = sum(dists) / n
        good = sum(d <= 10 for d in dists) / n
        excellent = sum(d <= 5 for d in dists) / n
        ordered = sorted(dists)
        median = float(ordered[n // 2]) if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2.0
        p90 = ordered[int(0.90 * (n - 1))]
        cand = (avg, good, overlap, shift, excellent, median, p90)
        if best is None or (avg, -good, -excellent, -overlap) < (best[0], -best[1], -best[4], -best[2]):
            best = cand
    return best

def _fingerprint_segment_is_silence(segment: Tuple[int, ...]) -> bool:
    """Recognize long Chromaprint regions produced by digital/near silence."""
    if len(segment) < FP_SILENCE_MIN_FRAMES:
        return True
    counts = Counter(segment)
    dominant = counts.most_common(1)[0][1] / len(segment)
    unique_fraction = len(counts) / len(segment)
    return dominant >= 0.90 or unique_fraction <= 0.03


def _unmatched_fingerprint_is_silence(fp1: Tuple[int, ...], fp2: Tuple[int, ...], shift: int) -> bool:
    a0 = max(shift, 0)
    b0 = max(-shift, 0)
    n = min(len(fp1) - a0, len(fp2) - b0)
    segments = (fp1[:a0], fp2[:b0], fp1[a0 + n:], fp2[b0 + n:])
    return all(_fingerprint_segment_is_silence(seg) for seg in segments)


def fingerprint_auto_match_values(
    fp1: Tuple[int, ...],
    duration1: float,
    fp2: Tuple[int, ...],
    duration2: float,
) -> Tuple[bool, Optional[Tuple[float, float, float, int, float, float, int]]]:
    sim = fingerprint_similarity(fp1, fp2)
    if not sim:
        return False, None

    score, good, overlap, shift, excellent, median, p90 = sim

    strict_match = (
        overlap >= FP_MIN_OVERLAP
        and score <= FP_AUTO_SCORE
        and good >= FP_AUTO_GOOD_FRACTION
        and excellent >= FP_AUTO_EXCELLENT_FRACTION
        and median <= FP_AUTO_MEDIAN_MAX
        and p90 <= FP_AUTO_P90_MAX
    )

    longer = max(duration1, duration2, 1.0)
    shorter = min(duration1, duration2, longer)
    duration_delta = abs(duration1 - duration2)

    mastering_match = (
        overlap >= FP_MASTERING_MIN_OVERLAP
        and duration_delta <= max(
            FP_MASTERING_MAX_DURATION_SECONDS,
            FP_MASTERING_MAX_DURATION_RATIO * longer,
        )
        and score <= FP_MASTERING_SCORE
        and good >= FP_MASTERING_GOOD_FRACTION
        and median <= FP_MASTERING_MEDIAN_MAX
        and p90 <= FP_MASTERING_P90_MAX
    )

    if not strict_match and not mastering_match:
        return False, sim

    length_ratio = shorter / longer
    if length_ratio < 0.94 or duration_delta > max(12.0, 0.06 * longer):
        if not _unmatched_fingerprint_is_silence(fp1, fp2, shift):
            return False, sim

    return True, sim

def fingerprint_auto_match(a: Track, b: Track) -> Tuple[bool, Optional[Tuple[float, float, float, int, float, float, int]]]:
    """High-confidence audio-only identity test."""
    return fingerprint_auto_match_values(
        a.fingerprint, a.duration, b.fingerprint, b.duration
    )


_COMPARE_TRACK_DATA: List[Tuple[Tuple[int, ...], float]] = []


def _init_compare_worker(track_data: List[Tuple[Tuple[int, ...], float]]) -> None:
    global _COMPARE_TRACK_DATA
    _COMPARE_TRACK_DATA = track_data


def _compare_pair_worker(pair: Tuple[int, int]):
    a, b = pair
    fp1, d1 = _COMPARE_TRACK_DATA[a]
    fp2, d2 = _COMPARE_TRACK_DATA[b]
    matched, sim = fingerprint_auto_match_values(fp1, d1, fp2, d2)
    return a, b, matched, sim

def _release_tree_files(folder: Path) -> Tuple[List[Path], List[Path]]:
    """Return audio files and all files for one release container recursively."""
    audio: List[Path] = []
    all_files: List[Path] = []
    for current, dirs, files in os.walk(folder):
        dirs.sort(key=str.lower)
        files.sort(key=str.lower)
        base = Path(current)
        for name in files:
            fp = base / name
            all_files.append(fp)
            if fp.suffix.lower() in AUDIO_EXTS:
                audio.append(fp)
    return audio, all_files


DISC_FOLDER_RE = re.compile(r"^(?:cd|disc|disk)\s*[-_. ]*\d+\b|^bonus\s+(?:cd|disc|disk)\b", re.I)
SIBLING_DISC_SUFFIX_RE = re.compile(
    r"^(?P<base>.+?)\s+(?:cd|disc|disk)\s*[-_. ]*(?P<num>\d+)\s*$",
    re.I,
)


def _direct_audio_files(folder: Path) -> List[Path]:
    try:
        return sorted(
            (p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_EXTS),
            key=lambda p: p.name.lower(),
        )
    except OSError:
        return []


def _audio_child_dirs(folder: Path) -> List[Path]:
    children: List[Path] = []
    try:
        dirs = sorted((p for p in folder.iterdir() if p.is_dir()), key=lambda p: p.name.lower())
    except OSError:
        return children
    for child in dirs:
        audio, _ = _release_tree_files(child)
        if audio:
            children.append(child)
    return children


def _is_multidisc_release_container(folder: Path, audio_children: List[Path]) -> bool:
    """Parent release with internal CD1/CD2/Disc 1 subfolders."""
    if not audio_children:
        return False
    return all(DISC_FOLDER_RE.search(child.name.strip()) for child in audio_children)


def _sibling_disc_parts(name: str) -> Optional[Tuple[str, int]]:
    match = SIBLING_DISC_SUFFIX_RE.match(name.strip())
    if not match:
        return None
    return match.group("base").strip(), int(match.group("num"))


def _discover_release_groups(root: Path) -> List[List[Path]]:
    """Return logical releases, each as one or more physical folders.

    Handles both layouts:
      Release/CD1 + Release/CD2
      Release CD 1 + Release CD 2   (sibling folders)
    Organizational folders such as Albums/Other/Singles are traversed.
    """
    groups: List[List[Path]] = []

    def walk(folder: Path) -> None:
        direct_audio = _direct_audio_files(folder)
        audio_children = _audio_child_dirs(folder)

        if direct_audio:
            groups.append([folder])
            return

        if _is_multidisc_release_container(folder, audio_children):
            groups.append([folder])
            return

        try:
            children = sorted((p for p in folder.iterdir() if p.is_dir()), key=lambda p: p.name.lower())
        except OSError:
            return

        sibling_discs: Dict[str, List[Tuple[int, Path]]] = defaultdict(list)
        for child in children:
            parts = _sibling_disc_parts(child.name)
            if parts and _direct_audio_files(child):
                base, number = parts
                sibling_discs[os.path.normcase(base)].append((number, child))

        consumed: Set[Path] = set()
        for entries in sibling_discs.values():
            if len(entries) < 2:
                continue
            ordered = [p for _n, p in sorted(entries, key=lambda x: (x[0], x[1].name.lower()))]
            groups.append(ordered)
            consumed.update(ordered)

        for child in children:
            if child in consumed:
                continue
            audio, _ = _release_tree_files(child)
            if audio:
                walk(child)

    walk(root)
    groups.sort(key=lambda paths: str(paths[0]).lower())
    return groups


def _read_cue_text(path: Path) -> str:
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1", errors="replace")


def _cue_unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        return value[1:-1]
    return value


def _cue_time_seconds(value: str) -> float:
    match = re.fullmatch(r"\s*(\d+):(\d+):(\d+)\s*", value or "")
    if not match:
        return 0.0
    minutes, seconds, frames = (int(x) for x in match.groups())
    return minutes * 60.0 + seconds + frames / 75.0


def _resolve_cue_audio_path(cue_path: Path, raw_name: str, audio_files: List[Path]) -> Optional[Path]:
    raw_name = _cue_unquote(raw_name).replace("\\", os.sep).replace("/", os.sep)
    candidate = (cue_path.parent / raw_name).resolve(strict=False)

    for path in audio_files:
        try:
            if path.resolve(strict=False) == candidate:
                return path
        except Exception:
            pass

    wanted_name = Path(raw_name).name.casefold()
    same_dir = [
        p for p in audio_files
        if p.parent.resolve() == cue_path.parent.resolve() and p.name.casefold() == wanted_name
    ]
    if same_dir:
        return same_dir[0]

    by_name = [p for p in audio_files if p.name.casefold() == wanted_name]
    return by_name[0] if len(by_name) == 1 else None


def _parse_cue_tracks(cue_path: Path, audio_files: List[Path]) -> List[Dict[str, object]]:
    try:
        text = _read_cue_text(cue_path)
    except Exception:
        return []

    global_title = ""
    global_performer = ""
    current_file: Optional[Path] = None
    current: Optional[Dict[str, object]] = None
    tracks: List[Dict[str, object]] = []

    file_re = re.compile(r'^\s*FILE\s+(.+?)\s+(?:WAVE|MP3|AIFF|BINARY|MOTOROLA)\s*$', re.I)
    track_re = re.compile(r'^\s*TRACK\s+(\d+)\s+AUDIO\s*$', re.I)
    title_re = re.compile(r'^\s*TITLE\s+(.+?)\s*$', re.I)
    performer_re = re.compile(r'^\s*PERFORMER\s+(.+?)\s*$', re.I)
    isrc_re = re.compile(r'^\s*ISRC\s+([^\s]+)\s*$', re.I)
    index_re = re.compile(r'^\s*INDEX\s+01\s+(\d+:\d+:\d+)\s*$', re.I)

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        match = file_re.match(line)
        if match:
            current_file = _resolve_cue_audio_path(cue_path, match.group(1), audio_files)
            current = None
            continue

        match = track_re.match(line)
        if match:
            if current_file is None:
                current = None
                continue
            current = {
                "cue_path": cue_path,
                "path": current_file,
                "track_number": int(match.group(1)),
                "title": "",
                "performer": "",
                "album": global_title,
                "album_performer": global_performer,
                "isrc": "",
                "start": None,
                "end": 0.0,
            }
            tracks.append(current)
            continue

        match = title_re.match(line)
        if match:
            value = _cue_unquote(match.group(1))
            if current is None:
                global_title = value
            else:
                current["title"] = value
            continue

        match = performer_re.match(line)
        if match:
            value = _cue_unquote(match.group(1))
            if current is None:
                global_performer = value
            else:
                current["performer"] = value
            continue

        if current is None:
            continue

        match = isrc_re.match(line)
        if match:
            current["isrc"] = match.group(1).strip()
            continue

        match = index_re.match(line)
        if match and current.get("start") is None:
            current["start"] = _cue_time_seconds(match.group(1))

    tracks = [t for t in tracks if isinstance(t.get("path"), Path) and t.get("start") is not None]

    for track in tracks:
        if not track.get("album"):
            track["album"] = global_title
        if not track.get("album_performer"):
            track["album_performer"] = global_performer

    for i, track in enumerate(tracks):
        for later in tracks[i + 1:]:
            if later["path"] == track["path"]:
                track["end"] = float(later["start"])
                break

    return tracks


def _cue_image_track_specs(
    cue_files: List[Path],
    audio_files: List[Path],
) -> Tuple[List[Dict[str, object]], Set[Path]]:
    chosen_by_image: Dict[Path, Tuple[Path, List[Dict[str, object]]]] = {}

    for cue_path in sorted(cue_files, key=lambda p: str(p).lower()):
        parsed = _parse_cue_tracks(cue_path, audio_files)
        by_image: Dict[Path, List[Dict[str, object]]] = defaultdict(list)
        for item in parsed:
            by_image[item["path"]].append(item)

        for image_path, specs in by_image.items():
            if len(specs) < 2:
                continue
            previous = chosen_by_image.get(image_path)
            if previous is None or len(specs) > len(previous[1]):
                chosen_by_image[image_path] = (cue_path, specs)

    virtual_specs: List[Dict[str, object]] = []
    image_files: Set[Path] = set()
    for image_path, (_cue, specs) in sorted(chosen_by_image.items(), key=lambda item: str(item[0]).lower()):
        image_files.add(image_path)
        virtual_specs.extend(specs)

    return virtual_specs, image_files


def discover_releases(root: Path, root_kind: str, start_id: int) -> List[Release]:
    """Discover logical releases recursively, including CUE-based CD images."""
    releases: List[Release] = []
    rid = start_id

    for physical_paths in _discover_release_groups(root):
        audio: List[Path] = []
        all_files: List[Path] = []
        for p in physical_paths:
            part_audio, part_files = _release_tree_files(p)
            audio.extend(part_audio)
            all_files.extend(part_files)
        if not audio:
            continue

        primary = physical_paths[0]
        sibling = _sibling_disc_parts(primary.name) if len(physical_paths) > 1 else None
        logical_name = sibling[0] if sibling else primary.name
        title = release_title_from_folder(logical_name)

        cue_files = [f for f in all_files if f.suffix.lower() == ".cue"]
        cue = bool(cue_files)
        image_specs, image_files = _cue_image_track_specs(cue_files, audio)

        logs = [f for f in all_files if f.suffix.lower() == ".log"]
        audiochecker = any(f.name.lower() == "audiochecker.log" for f in logs)
        rip_logs = [f for f in logs if f.name.lower() != "audiochecker.log"]
        rip_log = bool(rip_logs)
        quality = 100 if cue and rip_log else 75 if cue else 50 if audiochecker else 40

        rel = Release(
            rid=rid,
            root_kind=root_kind,
            path=primary,
            title=title,
            paths=list(physical_paths),
            scan_root=root,
            source_quality=quality,
            has_cue=cue,
            has_rip_log=rip_log,
            has_audiochecker=audiochecker,
            rip_log_paths=list(rip_logs),
            has_cd_image=bool(image_specs),
            cd_image_track_count=len(image_specs),
            cue_paths=list(cue_files),
        )

        track_index = 1
        for ap in audio:
            if ap in image_files:
                continue
            rel.tracks.append(Track(release_id=rid, path=ap, index=track_index))
            track_index += 1

        for spec in image_specs:
            rel.tracks.append(
                Track(
                    release_id=rid,
                    path=spec["path"],
                    index=track_index,
                    virtual_from_cue=True,
                    cue_path=spec["cue_path"],
                    cue_track_number=int(spec["track_number"]),
                    cue_start_seconds=float(spec["start"]),
                    cue_end_seconds=float(spec.get("end") or 0.0),
                    cue_title=str(spec.get("title") or ""),
                    cue_performer=str(spec.get("performer") or spec.get("album_performer") or ""),
                    cue_album=str(spec.get("album") or title),
                    cue_isrc=str(spec.get("isrc") or ""),
                )
            )
            track_index += 1

        releases.append(rel)
        rid += 1
    return releases


def _fingerprint_tokens(fp: Tuple[int, ...]) -> Set[int]:
    """Cheap title-independent prefilter for full Chromaprint comparison."""
    if len(fp) < 2:
        return set()
    # Consecutive high-12-bit pairs are stable enough to find likely candidates
    # while making random collisions uncommon. Position is intentionally ignored
    # so small leading/trailing offsets still become candidates.
    return {
        (((fp[i] >> 20) & 0xFFF) << 12) | ((fp[i + 1] >> 20) & 0xFFF)
        for i in range(0, len(fp) - 1, 2)
    }


def _comparison_decision_details(
    fp1: Tuple[int, ...],
    duration1: float,
    fp2: Tuple[int, ...],
    duration2: float,
    matched: bool,
    sim: Optional[Tuple[float, float, float, int, float, float, int]],
) -> Dict[str, object]:
    """Explain every threshold involved in one fingerprint decision."""
    longer = max(duration1, duration2, 1.0)
    shorter = min(duration1, duration2, longer)
    duration_delta = abs(duration1 - duration2)
    length_ratio = shorter / longer

    details: Dict[str, object] = {
        "worker_matched": bool(matched),
        "duration_delta_seconds": round(duration_delta, 6),
        "length_ratio": round(length_ratio, 6),
    }
    if not sim:
        details.update({
            "similarity_available": False,
            "accepted_by": [],
            "strict_pass": False,
            "mastering_pass": False,
            "length_gate_triggered": False,
            "length_gate_pass": False,
            "rejection_reasons": ["fingerprint_similarity returned no comparable result"],
        })
        return details

    score, good, overlap, shift, excellent, median, p90 = sim
    strict_checks = {
        "overlap": overlap >= FP_MIN_OVERLAP,
        "score": score <= FP_AUTO_SCORE,
        "good_fraction": good >= FP_AUTO_GOOD_FRACTION,
        "excellent_fraction": excellent >= FP_AUTO_EXCELLENT_FRACTION,
        "median": median <= FP_AUTO_MEDIAN_MAX,
        "p90": p90 <= FP_AUTO_P90_MAX,
    }
    mastering_duration_limit = max(
        FP_MASTERING_MAX_DURATION_SECONDS,
        FP_MASTERING_MAX_DURATION_RATIO * longer,
    )
    mastering_checks = {
        "overlap": overlap >= FP_MASTERING_MIN_OVERLAP,
        "duration_delta": duration_delta <= mastering_duration_limit,
        "score": score <= FP_MASTERING_SCORE,
        "good_fraction": good >= FP_MASTERING_GOOD_FRACTION,
        "median": median <= FP_MASTERING_MEDIAN_MAX,
        "p90": p90 <= FP_MASTERING_P90_MAX,
    }
    strict_pass = all(strict_checks.values())
    mastering_pass = all(mastering_checks.values())
    preliminary_pass = strict_pass or mastering_pass

    length_gate_triggered = bool(
        preliminary_pass
        and (length_ratio < 0.94 or duration_delta > max(12.0, 0.06 * longer))
    )
    unmatched_is_silence: Optional[bool] = None
    length_gate_pass = True
    if length_gate_triggered:
        unmatched_is_silence = _unmatched_fingerprint_is_silence(fp1, fp2, shift)
        length_gate_pass = bool(unmatched_is_silence)

    rejection_reasons: List[str] = []
    if not preliminary_pass:
        strict_failed = [name for name, passed in strict_checks.items() if not passed]
        mastering_failed = [name for name, passed in mastering_checks.items() if not passed]
        rejection_reasons.append("strict failed: " + ", ".join(strict_failed))
        rejection_reasons.append("mastering failed: " + ", ".join(mastering_failed))
    elif not length_gate_pass:
        rejection_reasons.append("length gate failed: unmatched fingerprint content is not silence")

    accepted_by: List[str] = []
    if strict_pass:
        accepted_by.append("strict")
    if mastering_pass:
        accepted_by.append("mastering")

    details.update({
        "similarity_available": True,
        "score": round(score, 6),
        "good_fraction": round(good, 6),
        "excellent_fraction": round(excellent, 6),
        "overlap": round(overlap, 6),
        "median": round(median, 6),
        "p90": int(p90),
        "shift": int(shift),
        "strict_checks": strict_checks,
        "strict_pass": strict_pass,
        "mastering_checks": mastering_checks,
        "mastering_duration_limit_seconds": round(mastering_duration_limit, 6),
        "mastering_pass": mastering_pass,
        "accepted_by": accepted_by,
        "length_gate_triggered": length_gate_triggered,
        "unmatched_is_silence": unmatched_is_silence,
        "length_gate_pass": length_gate_pass,
        "derived_final_match": bool(preliminary_pass and length_gate_pass),
        "decision_consistent": bool(matched) == bool(preliminary_pass and length_gate_pass),
        "rejection_reasons": rejection_reasons,
    })
    return details


def _comparison_track_log_data(track: Track) -> Dict[str, object]:
    return {
        "release_id": track.release_id,
        "path": str(track.path),
        "file": track.path.name,
        "title": track.display_title,
        "artist": track.artist,
        "album": track.album,
        "duration_seconds": round(track.duration, 6),
        "fingerprint_duration_seconds": round(track.fingerprint_duration, 6),
        "mbid": track.mbid,
        "isrc": track.isrc,
        "identity_title": identity_title(track.display_title),
        "base_title_identity": _base_title_identity(track.display_title),
        "content_qualifiers": sorted(content_qualifiers(track.display_title)),
        "version_descriptors": sorted(_version_descriptors(track.display_title)),
        "semantic_version_descriptors": sorted(_semantic_version_descriptors(track.display_title)),
        "featured_credit_signature": sorted(_featured_credit_signature(track.display_title)),
        "artist_signature": sorted(_artist_signature(track.artist)),
        "is_remix": track.is_remix,
        "is_live": track.is_live,
        "excluded_from_coverage": track.exclude_from_coverage,
        "personal_keep_rule": track.personal_keep_rule,
        "virtual_from_cue": track.virtual_from_cue,
        "cue_path": str(track.cue_path) if track.cue_path else "",
        "cue_track_number": track.cue_track_number,
        "cue_start_seconds": round(track.cue_start_seconds, 6),
        "cue_end_seconds": round(track.cue_end_seconds, 6),
    }


def merge_equivalent_tracks(
    tracks: List[Track],
    progress_cb=None,
    comparison_log_path: Optional[Path] = None,
) -> Tuple[Dict[int, List[int]], List[str]]:
    """Group recordings from audio fingerprints with a conservative metadata veto.

    Candidate discovery now uses strong fingerprint-token overlap, a weaker
    token+duration fallback, exact ID indexes, and same-base-title+duration
    fallback. Pure duration-only all-pairs comparison is intentionally avoided.
    """
    uf = UnionFind(len(tracks))
    notes: List[str] = []
    tokens: List[Set[int]] = [_fingerprint_tokens(t.fingerprint) for t in tracks]

    token_tracks: Dict[int, List[int]] = defaultdict(list)
    indexed = sum(1 for x in tokens if x)
    if progress_cb:
        progress_cb("Indexing fingerprints...", 0, max(1, indexed))

    done = 0
    for i, values in enumerate(tokens):
        if not values:
            continue
        for token in values:
            token_tracks[token].append(i)
        done += 1
        if progress_cb and (done % 25 == 0 or done == indexed):
            progress_cb("Indexing fingerprints...", done, max(1, indexed))

    buckets = [ids for ids in token_tracks.values() if len(ids) >= 2]
    pair_counts: Counter = Counter()
    total_buckets = len(buckets)
    if progress_cb:
        progress_cb("Finding audio candidates...", 0, max(1, total_buckets))

    for bi, ids in enumerate(buckets, 1):
        ids = sorted(set(ids))
        for a, b in itertools.combinations(ids, 2):
            pair_counts[(a, b)] += 1
        if progress_cb and (bi % 250 == 0 or bi == total_buckets):
            progress_cb("Finding audio candidates...", bi, max(1, total_buckets))

    candidate_reasons: Dict[Tuple[int, int], Set[str]] = defaultdict(set)

    # Primary fingerprint-token routes.
    for pair, shared in pair_counts.items():
        a, b = pair
        if shared >= FP_CANDIDATE_STRONG_SHARED_TOKENS:
            candidate_reasons[pair].add("fingerprint_tokens_strong")
        elif (
            shared >= FP_CANDIDATE_WEAK_SHARED_TOKENS
            and _candidate_duration_close(tracks[a], tracks[b])
        ):
            candidate_reasons[pair].add("fingerprint_tokens_weak+duration")

    # Exact identifiers are candidate hints only; audio still has to pass.
    mbid_index: Dict[str, List[int]] = defaultdict(list)
    isrc_index: Dict[str, List[int]] = defaultdict(list)
    for i, track in enumerate(tracks):
        if not track.fingerprint:
            continue
        mbid = _normalized_identifier(track.mbid)
        isrc = _normalized_identifier(track.isrc)
        if mbid:
            mbid_index[mbid].append(i)
        if isrc:
            isrc_index[isrc].append(i)

    for ids in mbid_index.values():
        for a, b in itertools.combinations(sorted(set(ids)), 2):
            candidate_reasons[(a, b)].add("same_mbid")
    for ids in isrc_index.values():
        for a, b in itertools.combinations(sorted(set(ids)), 2):
            candidate_reasons[(a, b)].add("same_isrc")

    # Conservative fallback for alternate masterings whose cheap fingerprint
    # tokens diverge: same base title + close duration still gets a full audio test.
    title_index: Dict[str, List[int]] = defaultdict(list)
    for i, track in enumerate(tracks):
        if not track.fingerprint or track.duration <= 0:
            continue
        key = _base_title_identity(track.display_title)
        if key:
            title_index[key].append(i)

    for ids in title_index.values():
        ordered = sorted(ids, key=lambda i: tracks[i].duration)
        for pos, a in enumerate(ordered):
            for b in ordered[pos + 1:]:
                if not _candidate_duration_close(tracks[a], tracks[b]):
                    if (
                        tracks[b].duration - tracks[a].duration
                        > max(
                            FP_CANDIDATE_DURATION_SECONDS,
                            FP_CANDIDATE_DURATION_RATIO * tracks[b].duration,
                        )
                    ):
                        break
                    continue
                pair = (min(a, b), max(a, b))
                candidate_reasons[pair].add("same_base_title+duration")

    candidate_pairs = sorted(candidate_reasons)
    total_candidates = len(candidate_pairs)
    total_possible = indexed * (indexed - 1) // 2
    prefilter_rejected = max(0, total_possible - total_candidates)

    log_handle = None
    log_counts: Counter = Counter()
    processed_pairs: Set[Tuple[int, int]] = set()
    if comparison_log_path is not None:
        try:
            comparison_log_path.parent.mkdir(parents=True, exist_ok=True)
            log_handle = comparison_log_path.open("w", encoding="utf-8", newline="\n")
            route_counts = Counter(
                reason
                for reasons in candidate_reasons.values()
                for reason in reasons
            )
            header = {
                "record_type": "run",
                "app": APP_NAME,
                "version": APP_VERSION,
                "generated": datetime.now().isoformat(timespec="seconds"),
                "tracks_total": len(tracks),
                "tracks_with_fingerprints": indexed,
                "possible_pairs": total_possible,
                "token_pairs_seen": len(pair_counts),
                "candidate_pairs": total_candidates,
                "prefilter_rejected_pairs": prefilter_rejected,
                "candidate_token_buckets": total_buckets,
                "candidate_routes": dict(sorted(route_counts.items())),
                "thresholds": {
                    "candidate_prefilter": {
                        "strong_shared_token_min": FP_CANDIDATE_STRONG_SHARED_TOKENS,
                        "weak_shared_token_min": FP_CANDIDATE_WEAK_SHARED_TOKENS,
                        "weak_duration_seconds": FP_CANDIDATE_DURATION_SECONDS,
                        "weak_duration_ratio": FP_CANDIDATE_DURATION_RATIO,
                        "fallbacks": [
                            "same_mbid",
                            "same_isrc",
                            "same_base_title+duration",
                        ],
                    },
                    "strict": {
                        "score_max": FP_AUTO_SCORE,
                        "good_fraction_min": FP_AUTO_GOOD_FRACTION,
                        "excellent_fraction_min": FP_AUTO_EXCELLENT_FRACTION,
                        "median_max": FP_AUTO_MEDIAN_MAX,
                        "p90_max": FP_AUTO_P90_MAX,
                        "overlap_min": FP_MIN_OVERLAP,
                    },
                    "mastering": {
                        "score_max": FP_MASTERING_SCORE,
                        "good_fraction_min": FP_MASTERING_GOOD_FRACTION,
                        "median_max": FP_MASTERING_MEDIAN_MAX,
                        "p90_max": FP_MASTERING_P90_MAX,
                        "overlap_min": FP_MASTERING_MIN_OVERLAP,
                        "duration_delta_seconds_max": FP_MASTERING_MAX_DURATION_SECONDS,
                        "duration_delta_ratio_max": FP_MASTERING_MAX_DURATION_RATIO,
                    },
                    "length_gate": {
                        "length_ratio_min": 0.94,
                        "duration_delta_seconds_or_ratio": "12.0 seconds or 6% of longer track; unmatched part must be silence",
                    },
                    "metadata_safety_gate": [
                        "different recording MBIDs",
                        "semantic version descriptor conflict",
                        "different featured performers + different ISRCs",
                        "different credited artists + different ISRCs",
                        "different descriptors + different ISRCs",
                        "different ISRCs + different base titles",
                    ],
                },
            }
            log_handle.write(json.dumps(header, ensure_ascii=False) + "\n")
        except Exception as exc:
            notes.append(f"Comparison log unavailable: {exc}")
            log_handle = None

    def log_comparison(
        pair_index: int,
        a: int,
        b: int,
        audio_matched: bool,
        final_matched: bool,
        sim,
        metadata_conflict: str,
    ) -> None:
        pair = (a, b)
        processed_pairs.add(pair)
        if log_handle is None:
            return

        first = tracks[a]
        second = tracks[b]
        shared_tokens = int(pair_counts.get(pair, 0))
        duration_delta = abs(first.duration - second.duration)
        duration_limit = max(
            FP_CANDIDATE_DURATION_SECONDS,
            FP_CANDIDATE_DURATION_RATIO * max(first.duration, second.duration),
        )
        reasons = sorted(candidate_reasons.get(pair, set()))

        details = _comparison_decision_details(
            first.fingerprint,
            first.duration,
            second.fingerprint,
            second.duration,
            audio_matched,
            sim,
        )
        details["audio_match"] = bool(audio_matched)
        details["metadata_conflict"] = metadata_conflict
        details["final_match"] = bool(final_matched)

        if final_matched:
            log_counts["matched"] += 1
            for route in details.get("accepted_by", []):
                log_counts[f"matched_{route}"] += 1
        elif audio_matched and metadata_conflict:
            log_counts["rejected_metadata_conflict"] += 1
        else:
            log_counts["rejected_audio"] += 1
            if not details.get("similarity_available"):
                log_counts["rejected_no_similarity"] += 1
            elif details.get("strict_pass") or details.get("mastering_pass"):
                log_counts["rejected_length_gate"] += 1
            else:
                log_counts["rejected_thresholds"] += 1

        row = {
            "record_type": "comparison",
            "pair_index": pair_index,
            "pair_total": total_candidates,
            "candidate": {
                "reasons": reasons,
                "shared_token_buckets": shared_tokens,
                "duration_delta_seconds": round(duration_delta, 6),
                "duration_candidate_limit_seconds": round(duration_limit, 6),
            },
            "track_a": _comparison_track_log_data(first),
            "track_b": _comparison_track_log_data(second),
            "audio_decision": "MATCH" if audio_matched else "REJECT",
            "metadata_safety": {
                "blocked": bool(metadata_conflict),
                "reason": metadata_conflict,
            },
            "decision": "MATCH" if final_matched else "REJECT",
            "details": details,
        }
        try:
            log_handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        except Exception as exc:
            notes.append(f"Comparison log write error: {exc}")

    def handle_result(done: int, a: int, b: int, audio_matched: bool, sim) -> None:
        metadata_conflict = _metadata_match_conflict(tracks[a], tracks[b]) if audio_matched else ""
        final_matched = bool(audio_matched and not metadata_conflict)
        log_comparison(done, a, b, audio_matched, final_matched, sim, metadata_conflict)

        if final_matched:
            uf.union(a, b)
            if sim:
                score, good, overlap, shift, excellent, median, p90 = sim
                notes.append(
                    f"AUDIO MATCH: {tracks[a].path.name} <-> {tracks[b].path.name}; "
                    f"score={score:.2f}, good={good:.0%}, excellent={excellent:.0%}, "
                    f"overlap={overlap:.0%}, median={median:.1f}, p90={p90}, shift={shift}"
                )
        elif audio_matched and metadata_conflict:
            if sim:
                score, good, overlap, shift, excellent, median, p90 = sim
                notes.append(
                    f"AUDIO MATCH BLOCKED: {tracks[a].path.name} <-> {tracks[b].path.name}; "
                    f"reason={metadata_conflict}; score={score:.2f}, good={good:.0%}, "
                    f"excellent={excellent:.0%}, overlap={overlap:.0%}, "
                    f"median={median:.1f}, p90={p90}, shift={shift}"
                )

    if total_candidates:
        workers = min(total_candidates, _compare_workers())
        label = f"Comparing audio ({workers} workers)..."
        if progress_cb:
            progress_cb(label, 0, total_candidates)

        track_data = [(t.fingerprint, t.duration) for t in tracks]
        chunksize = max(1, total_candidates // max(1, workers * 8))

        try:
            with ProcessPoolExecutor(
                max_workers=workers,
                initializer=_init_compare_worker,
                initargs=(track_data,),
            ) as ex:
                results = ex.map(_compare_pair_worker, candidate_pairs, chunksize=chunksize)
                for done, result in enumerate(results, 1):
                    a, b, audio_matched, sim = result
                    handle_result(done, a, b, audio_matched, sim)
                    if progress_cb and (done % 25 == 0 or done == total_candidates):
                        progress_cb(label, done, total_candidates)
        except Exception as e:
            notes.append(f"Parallel comparison unavailable; serial fallback: {e}")
            label = "Comparing audio (serial fallback)..."
            for done, (a, b) in enumerate(candidate_pairs, 1):
                if (a, b) in processed_pairs:
                    continue
                audio_matched, sim = fingerprint_auto_match(tracks[a], tracks[b])
                handle_result(done, a, b, audio_matched, sim)
                if progress_cb and (done % 25 == 0 or done == total_candidates):
                    progress_cb(label, done, total_candidates)
    elif progress_cb:
        progress_cb("Comparing audio...", 1, 1)

    roots: Dict[int, List[int]] = {}
    for i in range(len(tracks)):
        roots.setdefault(uf.find(i), []).append(i)
    remap = {root: gid for gid, root in enumerate(sorted(roots))}
    groups: Dict[int, List[int]] = {}
    for root, ids in roots.items():
        gid = remap[root]
        groups[gid] = ids
        for i in ids:
            tracks[i].group_id = gid

    if log_handle is not None:
        try:
            summary = {
                "record_type": "summary",
                "generated": datetime.now().isoformat(timespec="seconds"),
                "possible_pairs": total_possible,
                "token_pairs_seen": len(pair_counts),
                "candidate_pairs": total_candidates,
                "prefilter_rejected_pairs": prefilter_rejected,
                "comparisons_logged": len(processed_pairs),
                "recording_groups": len(groups),
                "counts": dict(sorted(log_counts.items())),
            }
            log_handle.write(json.dumps(summary, ensure_ascii=False) + "\n")
            log_handle.close()
            notes.append(f"COMPARISON LOG: {comparison_log_path}")
        except Exception as exc:
            notes.append(f"Comparison log finalization error: {exc}")
            try:
                log_handle.close()
            except Exception:
                pass

    return groups, notes

def release_explicit_state(rel: Release) -> str:
    states = {t.explicit for t in rel.tracks}
    if "explicit" in states:
        return "explicit"
    if states == {"clean"}:
        return "clean"
    if "clean" in states and "unknown" not in states:
        return "clean"
    return "unknown"


def finalize_release_metadata(releases: List[Release]) -> None:
    for rel in releases:
        first_tags = rel.tracks[0].tags if rel.tracks else {}
        album_tag = rel.tracks[0].album if rel.tracks else ""
        if album_tag:
            rel.title = album_tag
        rel.release_type, rel.type_source = infer_release_type(rel.title, rel.path.name, rel.track_count, first_tags)
        rel.family = album_family(rel.title)
        rel.explicit = release_explicit_state(rel)

        # Prefer explicit medium metadata when present, but CUE + rip LOG is
        # authoritative enough to classify an existing lossless rip as CD.
        medium_tag = tag_lookup(first_tags, "media", "medium", "format").strip()
        medium_norm = normalize_title(medium_tag)
        if rel.has_cue and rel.has_rip_log:
            rel.source_medium = "CD"
            rel.source_quality = max(rel.source_quality, 100)
        elif "cd" in medium_norm and "digital" not in medium_norm:
            rel.source_medium = medium_tag or "CD"
            rel.source_quality = max(rel.source_quality, 95)
        elif "digital" in medium_norm or "web" in medium_norm:
            rel.source_medium = medium_tag or "WEB"
            rel.source_quality = min(rel.source_quality, 50) if rel.source_quality else 40
        elif rel.has_audiochecker:
            rel.source_medium = "WEB"
        elif rel.has_cue:
            rel.source_medium = "CD/CUE"
        else:
            rel.source_medium = "WEB/Unknown"


def source_rank(rel: Release) -> int:
    """Rank source medium using structural evidence first.

    A CUE plus any real rip LOG (everything except audiochecker.log) is
    authoritative CD evidence for this project.
    """
    if rel.has_cue and rel.has_rip_log:
        return 3
    medium = normalize_title(rel.source_medium)
    if "cd" in medium and "web" not in medium and "digital" not in medium:
        return 2
    return 1


def score_cd_rip_logs(releases: List[Release], progress_cb, errors: List[str]) -> None:
    """Score EAC/XLD rip logs with hey-bro-check-log.

    Unrecognized logs are kept neutral rather than treated as bad rips. A release
    receives a usable quality key only when every non-AudioChecker .log belonging
    to that release was recognized by the upstream scorer.
    """
    jobs = [(rel, path) for rel in releases for path in rel.rip_log_paths]
    if not jobs:
        return

    score_log = ensure_heybrochecklog()
    progress_cb("Scoring CD rip logs...", 0, len(jobs))

    for index, (rel, path) in enumerate(jobs, 1):
        try:
            result = score_log(path)
            unrecognized = result.get("unrecognized")
            if unrecognized:
                message = str(unrecognized)
                rel.rip_log_unrecognized.append(f"{path.name}: {message}")
                errors.append(f"Rip log unrecognized: {path}: {message}")
            else:
                try:
                    score = int(result.get("score"))
                except (TypeError, ValueError):
                    raise RuntimeError("log checker returned no numeric score")
                rel.rip_log_scores.append(score)
                rel.rip_log_rippers.append(str(result.get("ripper") or ""))
                if bool(result.get("flagged")):
                    rel.rip_log_flagged += 1
        except Exception as exc:
            message = str(exc)
            rel.rip_log_unrecognized.append(f"{path.name}: {message}")
            errors.append(f"Rip log scoring error: {path}: {message}")

        progress_cb("Scoring CD rip logs...", index, len(jobs))


def cd_rip_log_quality_key(rel: Release) -> Optional[Tuple[int, float, int]]:
    """Comparable hey-bro-check-log quality for a fully scored CD rip.

    Higher is better. The worst disc score comes first so one bad disc cannot be
    hidden by several perfect discs; average score breaks ties, then an unflagged
    set wins over an otherwise equal flagged one.
    """
    if source_rank(rel) < 2:
        return None
    if not rel.rip_log_paths:
        return None
    if len(rel.rip_log_scores) != len(rel.rip_log_paths):
        return None

    scores = rel.rip_log_scores
    return (
        min(scores),
        sum(scores) / len(scores),
        -rel.rip_log_flagged,
    )


def cd_rip_log_quality_text(rel: Release) -> str:
    key = cd_rip_log_quality_key(rel)
    if key is None:
        if rel.rip_log_paths:
            return f"unavailable ({len(rel.rip_log_scores)}/{len(rel.rip_log_paths)} log(s) recognized)"
        return "not available"
    minimum, average, _flagged = key
    flagged = f", flagged: {rel.rip_log_flagged}" if rel.rip_log_flagged else ""
    rippers = sorted({r for r in rel.rip_log_rippers if r})
    ripper_text = f", {'/'.join(rippers)}" if rippers else ""
    return (
        f"min {minimum}/100, avg {average:.1f}/100 "
        f"({len(rel.rip_log_scores)}/{len(rel.rip_log_paths)} log(s){ripper_text}{flagged})"
    )


def cd_rip_quality_key(rel: Release) -> Optional[Tuple[int, int, int, int, float, int]]:
    """Combined positive CUETools verification and EAC/XLD log quality.

    CUETools/AccurateRip/CTDB verification is stronger positive evidence than
    log settings. Missing database entries or unverified output are neutral.
    """
    cue_key = cuetools_cd_quality_key(rel)
    log_key = cd_rip_log_quality_key(rel)
    if cue_key is None and log_key is None:
        return None

    cue_confidence, cue_matches = cue_key or (0, 0)
    log_min, log_avg, log_flagged = log_key or (0, 0.0, 0)
    return (
        1 if cue_key is not None else 0,
        cue_confidence,
        cue_matches,
        1 if log_key is not None else 0,
        log_avg if log_key is not None else 0.0,
        log_flagged if log_key is not None else 0,
    )


def _same_release_exact_cd_content(a: Release, b: Release) -> bool:
    """Strict identity gate for comparing CD rip log quality.

    The log score never proves duplicates. Audio groups, order, release identity,
    type, source class, and track counts must already prove the two releases are
    otherwise interchangeable.
    """
    if source_rank(a) < 2 or source_rank(b) < 2:
        return False
    if source_rank(a) != source_rank(b):
        return False
    if a.release_type != b.release_type:
        return False
    if a.included_track_count != b.included_track_count:
        return False

    if a.release_type == "album":
        if not a.family or not b.family or a.family != b.family:
            return False
    elif normalize_title(a.title) != normalize_title(b.title):
        return False

    seq_a = _included_group_sequence(a)
    seq_b = _included_group_sequence(b)
    if not seq_a or seq_a != seq_b:
        return False
    return _included_group_counter(a) == _included_group_counter(b)


def prefer_better_cd_rips(releases: List[Release], selected: Set[int]) -> Set[int]:
    """Among exact-equivalent CD rips, keep the strongest verified/quality copy."""
    selected = set(selected)

    changed = True
    while changed:
        changed = False
        for current in [r for r in releases if r.rid in selected]:
            current_quality = cd_rip_quality_key(current)
            if current_quality is None:
                continue

            better = [
                candidate for candidate in releases
                if candidate.rid != current.rid
                and _same_release_exact_cd_content(current, candidate)
                and cd_rip_quality_key(candidate) is not None
                and cd_rip_quality_key(candidate) > current_quality
            ]
            if not better:
                continue

            best = max(
                better,
                key=lambda r: (
                    cd_rip_quality_key(r),
                    1 if r.root_kind == "existing" else 0,
                    -r.rid,
                ),
            )
            selected.discard(current.rid)
            selected.add(best.rid)
            changed = True
            break

    selected_rels = [r for r in releases if r.rid in selected]
    for a, b in itertools.combinations(selected_rels, 2):
        if not _same_release_exact_cd_content(a, b):
            continue
        qa = cd_rip_quality_key(a)
        qb = cd_rip_quality_key(b)
        if qa is None or qb is None or qa == qb:
            continue
        if qa > qb:
            selected.discard(b.rid)
        else:
            selected.discard(a.rid)

    return selected


def quality_key(rel: Release) -> Tuple[int, int, int]:
    # Advisory state stays neutral here; explicit wins only at the absolute
    # final stage when two releases are proven otherwise identical.
    explicit_score = 1
    existing_score = 1 if rel.root_kind == "existing" else 0
    return source_rank(rel), explicit_score, existing_score


def greedy_cover(target: Set[int], releases: List[Release], selected: Set[int]) -> Tuple[Set[int], Set[int]]:
    covered: Set[int] = set()
    for r in releases:
        if r.rid in selected:
            covered |= r.groups
    missing = set(target) - covered
    chosen: Set[int] = set()
    while missing:
        best = None
        best_key = None
        for r in releases:
            if r.rid in selected or r.rid in chosen or not r.groups:
                continue
            new = r.groups & missing
            if not new:
                continue
            # Tracks skipped by the active options do not participate in coverage/cost. Among otherwise
            # equivalent coverage, explicit and better source medium win.
            cost_per = max(1, r.included_track_count) / len(new)
            q, ex, existing = quality_key(r)
            key = (cost_per, -len(new), -ex, -q, 0 if r.root_kind == "existing" else 1, r.included_track_count, r.title.lower())
            if best_key is None or key < best_key:
                best_key = key
                best = r
        if best is None:
            break
        chosen.add(best.rid)
        missing -= best.groups
    return chosen, missing


def _explicit_rank(rel: Release) -> int:
    """Keep advisory state neutral during normal optimization.

    Explicit preference is intentionally applied only by the final
    exact-equivalent clean/explicit release pass.
    """
    return 1


def _core_album_preference(combo: Tuple[Release, ...], core_groups: Set[int]) -> Tuple[int, int, int]:
    """Score equivalent album core content without rewarding duplicates.

    Priority for equivalent included content: source medium, then an
    already-processed existing release. Advisory state is deferred to the final exact-equivalence pass.
    """
    explicit_total = 0
    source_total = 0
    existing_total = 0
    if core_groups:
        for gid in core_groups:
            carriers = [r for r in combo if gid in r.groups]
            if not carriers:
                continue
            best = max(carriers, key=lambda r: (_explicit_rank(r), source_rank(r), 1 if r.root_kind == "existing" else 0))
            explicit_total += _explicit_rank(best)
            source_total += source_rank(best)
            existing_total += 1 if best.root_kind == "existing" else 0
    else:
        best = max(combo, key=lambda r: (_explicit_rank(r), source_rank(r), 1 if r.root_kind == "existing" else 0))
        explicit_total = _explicit_rank(best)
        source_total = source_rank(best)
        existing_total = 1 if best.root_kind == "existing" else 0
    return explicit_total, source_total, existing_total


def _included_group_sequence(rel: Release) -> List[int]:
    return [
        t.group_id for t in rel.tracks
        if t.group_id >= 0 and not t.exclude_from_coverage
    ]


def _lcs_length(a: List[int], b: List[int]) -> int:
    if not a or not b:
        return 0
    if len(a) > len(b):
        a, b = b, a
    prev = [0] * (len(a) + 1)
    for value_b in b:
        cur = [0]
        for j, value_a in enumerate(a, 1):
            if value_a == value_b:
                cur.append(prev[j - 1] + 1)
            else:
                cur.append(max(cur[-1], prev[j]))
        prev = cur
    return prev[-1]


def _album_editions_related_by_audio(a: Release, b: Release) -> bool:
    """Detect alternate editions from included audio overlap/order, not names."""
    if a.release_type != "album" or b.release_type != "album":
        return False
    seq_a = _included_group_sequence(a)
    seq_b = _included_group_sequence(b)
    if not seq_a or not seq_b:
        return False

    unique_a = set(seq_a)
    unique_b = set(seq_b)
    common = len(unique_a & unique_b)
    smaller_unique = min(len(unique_a), len(unique_b))
    if smaller_unique < 5:
        return False
    if common < max(5, int(smaller_unique * 0.70)):
        return False

    lcs = _lcs_length(seq_a, seq_b)
    smaller_sequence = min(len(seq_a), len(seq_b))
    return lcs >= max(5, int(smaller_sequence * 0.65))


def _album_clusters(albums: List[Release]) -> List[List[Release]]:
    if not albums:
        return []
    uf = UnionFind(len(albums))
    for i, j in itertools.combinations(range(len(albums)), 2):
        if _album_editions_related_by_audio(albums[i], albums[j]):
            uf.union(i, j)
    grouped: Dict[int, List[Release]] = defaultdict(list)
    for i, rel in enumerate(albums):
        grouped[uf.find(i)].append(rel)
    return [grouped[k] for k in sorted(grouped)]


def choose_album_families(releases: List[Release]) -> Set[int]:
    selected: Set[int] = set()
    albums = [r for r in releases if r.release_type == "album" and not r.excluded_only]
    clusters = _album_clusters(albums)

    by_id = {r.rid: r for r in releases}
    for candidates in clusters:
        if any(r.rid in selected for r in candidates):
            continue
        candidate_ids = {r.rid for r in candidates}
        universe: Set[int] = set().union(*(r.groups for r in candidates)) if candidates else set()
        core_groups: Set[int] = set(candidates[0].groups) if candidates else set()
        for r in candidates[1:]:
            core_groups &= r.groups

        best_selection: Optional[Set[int]] = None
        best_score = None
        max_combo = len(candidates) if len(candidates) <= 10 else 2
        combos: Iterable[Tuple[Release, ...]] = itertools.chain.from_iterable(
            itertools.combinations(candidates, n)
            for n in range(1, max_combo + 1)
        )

        for combo in combos:
            base = set(selected) | {r.rid for r in combo}
            covered = set().union(*(by_id[x].groups for x in base)) if base else set()
            missing = universe - covered
            # Bonus tracks may be covered more efficiently by singles/EPs or
            # another album outside this audio-derived edition cluster.
            ext_pool = [r for r in releases if r.rid not in candidate_ids]
            extra, remain = greedy_cover(missing, ext_pool, base)
            if remain:
                continue
            new_ids = ({r.rid for r in combo} | extra) - selected
            new_rels = [by_id[x] for x in new_ids]

            core_explicit, core_source, core_existing = _core_album_preference(combo, core_groups)
            total_included_files = sum(r.included_track_count for r in new_rels)
            total_releases = len(new_rels)
            recycle_count = sum(r.root_kind == "recycle" for r in new_rels)
            score = (
                -core_explicit,
                -core_source,
                -core_existing,
                total_included_files,
                total_releases,
                recycle_count,
            )
            if best_score is None or score < best_score:
                best_score = score
                best_selection = set(new_ids)

        if best_selection is None:
            chosen = min(
                candidates,
                key=lambda r: (
                    -_explicit_rank(r),
                    -source_rank(r),
                    0 if r.root_kind == "existing" else 1,
                    r.included_track_count,
                ),
            )
            selected.add(chosen.rid)
        else:
            selected |= best_selection
    return selected


def _included_group_counter(rel: Release) -> Counter:
    return Counter(t.group_id for t in rel.tracks if t.group_id >= 0 and not t.exclude_from_coverage)


def _release_track_match(a: Track, b: Track) -> bool:
    if a.exclude_from_coverage or b.exclude_from_coverage:
        return False
    return a.group_id >= 0 and a.group_id == b.group_id


def _release_covers(covering: Release, target: Release) -> bool:
    """Audio-only included-content coverage using fingerprint groups."""
    need = _included_group_counter(target)
    have = _included_group_counter(covering)
    return all(have[gid] >= count for gid, count in need.items())


def _release_barcodes(rel: Release) -> Set[str]:
    values: Set[str] = set()
    if rel.tracks:
        tag = tag_lookup(rel.tracks[0].tags, "barcode", "upc", "ean")
        digits = re.sub(r"\D", "", tag)
        if 8 <= len(digits) <= 14:
            values.add(digits)
    return values


def _related_album_releases(a: Release, b: Release) -> bool:
    """Album-edition relation from audio overlap/order, with barcode fallback."""
    if a.release_type != "album" or b.release_type != "album":
        return False
    if _album_editions_related_by_audio(a, b):
        return True
    return bool(_release_barcodes(a) & _release_barcodes(b))


def _structural_track_match(a: Track, b: Track) -> bool:
    # Compatibility wrapper retained for older internal callers: audio groups only.
    return _release_track_match(a, b)


def _structural_release_covers(covering: Release, target: Release) -> bool:
    # Compatibility wrapper retained for older internal callers: audio coverage only.
    return _release_covers(covering, target)


def _content_preference(rel: Release) -> Tuple[int, int, int]:
    """Preference after included content equivalence has already been established."""
    return (_explicit_rank(rel), source_rank(rel), 1 if rel.root_kind == "existing" else 0)


def _folder_related_releases(a: Release, b: Release) -> bool:
    # Historical name kept for compatibility. Folder names are not used.
    if a.release_type == "album" and b.release_type == "album":
        return _related_album_releases(a, b)
    return True

def enforce_existing_precedence(releases: List[Release], selected: Set[int]) -> Set[int]:
    """Hard final safeguard for existing-vs-recycle duplicates.

    If an existing release structurally covers a recycle release and is not worse
    on source quality, the existing processed release must win. This is
    deliberately independent of embedded album tags, inferred release type and
    fingerprint grouping.
    """
    selected = set(selected)
    existing_rels = [r for r in releases if r.root_kind == "existing" and not r.excluded_only]
    recycle_rels = [r for r in releases if r.root_kind == "recycle" and not r.excluded_only]

    for er in existing_rels:
        for rr in recycle_rels:
            if not _folder_related_releases(er, rr):
                continue

            er_covers_rr = _release_covers(er, rr)
            if not er_covers_rr:
                continue

            rr_covers_er = _release_covers(rr, er)
            er_quality = (_explicit_rank(er), source_rank(er), 1)
            rr_quality = (_explicit_rank(rr), source_rank(rr), 0)

            if rr_covers_er:
                # Same included content: source decides; existing wins ties here. Advisory preference is deferred.
                if er_quality >= rr_quality:
                    selected.add(er.rid)
                    selected.discard(rr.rid)
                else:
                    selected.add(rr.rid)
                    selected.discard(er.rid)
            else:
                # Existing is a included-content superset. If its source is not worse,
                # the recycle subset can never be the better choice.
                if (_explicit_rank(er), source_rank(er)) >= (_explicit_rank(rr), source_rank(rr)):
                    selected.add(er.rid)
                    selected.discard(rr.rid)

    return selected


def stabilize_equivalent_sources(releases: List[Release], selected: Set[int]) -> Set[int]:
    """Enforce source/current precedence for equivalent album content.

    This pass is deliberately release-level so a borderline fingerprint merge
    cannot make a WEB duplicate replace an existing CD or an already-processed
    existing WEB copy.
    """
    selected = set(selected)
    by_id = {r.rid: r for r in releases}

    changed = True
    while changed:
        changed = False

        # Selected recycle release vs unselected existing equivalent/superset:
        # existing wins when source is better, or when source ties.
        for rr in [r for r in releases if r.root_kind == "recycle" and r.rid in selected]:
            candidates = [
                e for e in releases
                if e.root_kind == "existing" and e.rid not in selected
                and _related_album_releases(e, rr)
                and _release_covers(e, rr)
                and (_explicit_rank(e), source_rank(e)) >= (_explicit_rank(rr), source_rank(rr))
            ]
            if candidates:
                best = max(candidates, key=lambda e: (_explicit_rank(e), source_rank(e), e.included_track_count))
                selected.discard(rr.rid)
                selected.add(best.rid)
                changed = True
                break
        if changed:
            continue

        # The reverse is allowed only when recycle is objectively better on
        # source quality and covers the existing release's included content.
        for er in [r for r in releases if r.root_kind == "existing" and r.rid in selected]:
            candidates = [
                r for r in releases
                if r.root_kind == "recycle" and r.rid not in selected
                and _related_album_releases(er, r)
                and _release_covers(r, er)
                and (_explicit_rank(r), source_rank(r)) > (_explicit_rank(er), source_rank(er))
            ]
            if candidates:
                best = max(candidates, key=lambda r: (_explicit_rank(r), source_rank(r), r.included_track_count))
                selected.discard(er.rid)
                selected.add(best.rid)
                changed = True
                break

    return selected


def _semantically_covered_by_selected(rel: Release, selected_rels: List[Release]) -> bool:
    # Historical name kept for compatibility. Coverage is audio-only.
    if not rel.groups and not rel.included_track_count:
        return True
    return any(_release_covers(r, rel) for r in selected_rels)

def find_dominated_releases(releases: List[Release]) -> Set[int]:
    """Remove only pairwise-equivalent album duplicates before global optimization.

    A strict superset is NOT allowed to eliminate a smaller edition here. Its
    extra recording groups may already be supplied by another retained release,
    in which case the smaller edition can lower the collection's total track
    count. Superset/subset decisions therefore remain collection-wide.
    """
    dominated: Set[int] = set()
    albums = [r for r in releases if r.release_type == "album" and not r.excluded_only]

    for a, b in itertools.combinations(albums, 2):
        if not _related_album_releases(a, b):
            continue

        a_covers_b = _release_covers(a, b)
        b_covers_a = _release_covers(b, a)

        # Only exact coverage equivalence is safe to collapse pairwise.
        if not (a_covers_b and b_covers_a):
            continue

        a_pref = (_explicit_rank(a), source_rank(a), 1 if a.root_kind == "existing" else 0, -a.rid)
        b_pref = (_explicit_rank(b), source_rank(b), 1 if b.root_kind == "existing" else 0, -b.rid)
        if a_pref > b_pref:
            dominated.add(b.rid)
        elif b_pref > a_pref:
            dominated.add(a.rid)

    return dominated

def _selected_album_cluster_map(releases: List[Release]) -> Dict[int, int]:
    albums = [r for r in releases if r.release_type == "album" and not r.excluded_only]
    result: Dict[int, int] = {}
    for cluster_id, cluster in enumerate(_album_clusters(albums)):
        for rel in cluster:
            result[rel.rid] = cluster_id
    return result


def minimize_collection_track_count(releases: List[Release], selected: Set[int]) -> Set[int]:
    """Reduce total included track count using whole-collection coverage.

    This pass fixes the classic "larger deluxe edition wins because it has one
    extra track" problem when that extra recording is already supplied by some
    other retained release. A swap is allowed only when:
      - the replacement is a related edition of the same album cluster;
      - its source class is not worse;
      - every included recording group in the entire collection remains covered;
      - total included track count strictly decreases.

    Existing-vs-recycle, CD-log and clean/explicit rules still apply afterward.
    """
    selected = set(selected)
    by_id = {r.rid: r for r in releases}
    required_groups: Set[int] = set()
    for rel in releases:
        if not rel.excluded_only:
            required_groups |= rel.groups

    def covered(ids: Set[int]) -> Set[int]:
        result: Set[int] = set()
        for rid in ids:
            result |= by_id[rid].groups
        return result

    changed = True
    while changed:
        changed = False
        best_swap = None
        best_key = None

        selected_albums = [
            by_id[rid] for rid in selected
            if by_id[rid].release_type == "album" and not by_id[rid].excluded_only
        ]
        unselected_albums = [
            r for r in releases
            if r.rid not in selected
            and r.release_type == "album"
            and not r.excluded_only
        ]

        for current in selected_albums:
            for candidate in unselected_albums:
                if not _related_album_releases(current, candidate):
                    continue
                if source_rank(candidate) < source_rank(current):
                    continue
                if candidate.included_track_count >= current.included_track_count:
                    continue

                trial = (selected - {current.rid}) | {candidate.rid}
                if not required_groups <= covered(trial):
                    continue

                saved_tracks = current.included_track_count - candidate.included_track_count
                key = (
                    -saved_tracks,
                    -source_rank(candidate),
                    0 if candidate.root_kind == "existing" else 1,
                    candidate.included_track_count,
                    candidate.rid,
                )
                if best_key is None or key < best_key:
                    best_key = key
                    best_swap = (current, candidate)

        if best_swap is not None:
            current, candidate = best_swap
            selected.discard(current.rid)
            selected.add(candidate.rid)
            changed = True

    return selected


def prune_redundant_selected(releases: List[Release], selected: Set[int]) -> Set[int]:
    """Final exact redundancy pass after the optimizer."""
    selected = set(selected)
    by_id = {r.rid: r for r in releases}
    album_cluster = _selected_album_cluster_map(releases)

    changed = True
    while changed:
        changed = False
        ordered = sorted(
            (by_id[rid] for rid in selected),
            key=lambda r: (
                0 if r.release_type != "album" else 1,
                -r.included_track_count,
                r.rid,
            ),
        )

        for rel in ordered:
            others = [by_id[rid] for rid in selected if rid != rel.rid]
            if not others:
                continue

            if rel.release_type == "album":
                cid = album_cluster.get(rel.rid)
                if cid is None:
                    continue
                if not any(
                    other.release_type == "album"
                    and album_cluster.get(other.rid) == cid
                    for other in others
                ):
                    continue

            need = _included_group_counter(rel)
            have = Counter()
            carriers: Dict[int, List[Release]] = defaultdict(list)
            for other in others:
                counter = _included_group_counter(other)
                have.update(counter)
                for gid in counter:
                    carriers[gid].append(other)

            if any(have[gid] < count for gid, count in need.items()):
                continue

            rel_pref = (source_rank(rel), 1 if rel.root_kind == "existing" else 0)
            source_safe = True
            for gid in need:
                if not any(
                    (source_rank(other), 1 if other.root_kind == "existing" else 0) >= rel_pref
                    for other in carriers.get(gid, [])
                ):
                    source_safe = False
                    break
            if not source_safe:
                continue

            selected.remove(rel.rid)
            changed = True
            break

    return selected


def _release_advisory_identity(rel: Release) -> str:
    """Normalize only clean/explicit packaging words for same-release checks."""
    value = ascii_punctuation(rel.title or "")
    value = re.sub(
        r"[\[(]\s*(?:(?:clean|explicit)(?:\s+(?:version|edition))?|"
        r"(?:album|main|original)\s+version\s+(?:clean|explicit))\s*[\])]",
        " ",
        value,
        flags=re.I,
    )
    value = re.sub(
        r"\s*(?:-|:)\s*(?:(?:clean|explicit)(?:\s+(?:version|edition))?|"
        r"(?:album|main|original)\s+version\s+(?:clean|explicit))\s*$",
        " ",
        value,
        flags=re.I,
    )
    return compact_title(normalize_space(value))


def _exact_clean_explicit_equivalent(a: Release, b: Release) -> bool:
    """True only when clean/explicit copies are otherwise the same release.

    This is deliberately stricter than normal release coverage. The final
    advisory preference must never replace a genuinely different clean edit,
    bonus-track edition, ordering, source class, or incomplete release.
    """
    if {a.explicit, b.explicit} != {"clean", "explicit"}:
        return False
    if a.release_type != b.release_type:
        return False
    if source_rank(a) != source_rank(b):
        return False
    if a.included_track_count != b.included_track_count:
        return False
    if _release_advisory_identity(a) != _release_advisory_identity(b):
        return False

    seq_a = _included_group_sequence(a)
    seq_b = _included_group_sequence(b)
    if not seq_a or seq_a != seq_b:
        return False

    # Exact multiset equality protects repeated tracks and ensures neither
    # release has extra/missing included audio despite sequence normalization.
    return _included_group_counter(a) == _included_group_counter(b)


def prefer_explicit_exact_equivalents(releases: List[Release], selected: Set[int]) -> Set[int]:
    """Absolute final tie-break: explicit beats clean only for exact equivalents."""
    selected = set(selected)

    # Repeat because a swap can expose another duplicate clean copy.
    changed = True
    while changed:
        changed = False
        selected_clean = [
            r for r in releases
            if r.rid in selected and r.explicit == "clean" and not r.excluded_only
        ]

        for clean in selected_clean:
            explicit_candidates = [
                r for r in releases
                if r.explicit == "explicit"
                and not r.excluded_only
                and _exact_clean_explicit_equivalent(clean, r)
            ]
            if not explicit_candidates:
                continue

            # At this point content and source class are identical by rule.
            # Prefer an already-processed explicit copy if available, then use
            # deterministic path/rid ordering.
            explicit = max(
                explicit_candidates,
                key=lambda r: (
                    1 if r.root_kind == "existing" else 0,
                    -r.rid,
                ),
            )

            selected.discard(clean.rid)
            selected.add(explicit.rid)
            changed = True
            break

    # If both exact copies somehow survived earlier passes, remove the clean one.
    selected_rels = [r for r in releases if r.rid in selected]
    for clean in [r for r in selected_rels if r.explicit == "clean"]:
        if any(
            explicit.rid in selected
            and explicit.explicit == "explicit"
            and _exact_clean_explicit_equivalent(clean, explicit)
            for explicit in releases
        ):
            selected.discard(clean.rid)

    return selected


def optimize_collection(
    releases: List[Release],
    groups: Dict[int, List[int]],
    blocked_release_ids: Optional[Set[int]] = None,
) -> Set[int]:
    """Optimize the retained set, optionally forbidding user-removed releases.

    Manual Decision Map removals are planning constraints only. Fingerprints and
    recording groups are reused; the expensive audio-analysis stage is not rerun.
    """
    blocked = set(blocked_release_ids or set())
    eligible = [r for r in releases if r.rid not in blocked]

    dominated = find_dominated_releases(eligible)
    active = [r for r in eligible if r.rid not in dominated]

    selected = choose_album_families(active)
    # Only recording groups not excluded by the active checkboxes are included.
    # When a release is manually blocked, groups that also exist on another
    # eligible release remain in this universe and are reassigned automatically.
    all_groups: Set[int] = set()
    for rel in active:
        all_groups |= rel.groups
    extra, missing = greedy_cover(all_groups, active, selected)
    selected |= extra
    if missing:
        for gid in sorted(missing):
            containing = [r for r in active if gid in r.groups]
            if containing:
                chosen = min(
                    containing,
                    key=lambda r: (
                        r.included_track_count,
                        -_explicit_rank(r),
                        -source_rank(r),
                        0 if r.root_kind == "existing" else 1,
                    ),
                )
                selected.add(chosen.rid)

    selected = stabilize_equivalent_sources(active, selected)
    selected = enforce_existing_precedence(active, selected)
    selected = prune_redundant_selected(active, selected)

    # Now that the whole retained set exists, minimize total included tracks.
    # Bonus tracks on one edition have zero value here if another retained
    # release already supplies those same recording groups.
    selected = minimize_collection_track_count(active, selected)
    selected = prune_redundant_selected(active, selected)

    # Quality of a CD rip must never create duplicate identity or override a
    # different edition. Only exact-equivalent CD rips reach this pass.
    selected = prefer_better_cd_rips(active, selected)

    # Absolute last stage: when clean/explicit releases are otherwise exactly
    # identical, retain explicit and move the clean copy.
    selected = prefer_explicit_exact_equivalents(active, selected)

    # Defensive invariant: a manually blocked release must never leak back in
    # through a later preference/stabilization pass.
    return selected - blocked


def review_candidates(tracks: List[Track]) -> List[Tuple[int, int, str]]:
    # v0.4+: no manual track-by-track review. Uncertain matches remain separate
    # recording groups and are therefore retained automatically.
    return []

def format_track(t: Track) -> str:
    dur = "?:??"
    if t.duration > 0:
        m = int(t.duration) // 60
        s = int(round(t.duration)) % 60
        dur = f"{m}:{s:02d}"
    bits = [t.display_title, dur]
    if t.mbid:
        bits.append(f"MBID={t.mbid}")
    if t.isrc:
        bits.append(f"ISRC={t.isrc}")
    if t.explicit != "unknown":
        bits.append(t.explicit)
    if t.virtual_from_cue:
        bits.append(f"CUE image track {t.cue_track_number:02d}")
    return " | ".join(bits)


def prepare_analysis(
    existing: Optional[Path],
    recycle: Path,
    progress_cb,
) -> Tuple[List[Release], List[Track]]:
    """Run the common stages needed before the pattern review."""
    progress_cb("Checking dependencies...", 0, 1)
    _migrate_legacy_app_data()
    _ensure_app_data_dirs()
    bootstrap_winget()
    _ffmpeg, ffprobe = ensure_ffmpeg()
    progress_cb("Checking dependencies...", 1, 1)

    progress_cb("Scanning release folders...", 0, 1)
    releases: List[Release] = []
    if existing is not None:
        releases = discover_releases(existing, "existing", 0)
    releases += discover_releases(recycle, "recycle", len(releases))
    progress_cb("Scanning release folders...", 1, 1)

    tracks = [t for r in releases for t in r.tracks]
    errors: List[str] = []
    probe_workers = min(len(tracks) or 1, _probe_workers())
    progress_cb(f"Reading tags and durations ({probe_workers} workers)...", 0, max(1, len(tracks)))
    with ThreadPoolExecutor(max_workers=probe_workers) as ex:
        futures = {ex.submit(probe_track, ffprobe, t): t for t in tracks}
        done = 0
        for fut in as_completed(futures):
            t = futures[fut]
            try:
                fut.result()
            except Exception as e:
                errors.append(f"Probe error: {t.path}: {e}")
            done += 1
            progress_cb(f"Reading tags and durations ({probe_workers} workers)...", done, len(tracks))

    finalize_release_metadata(releases)
    score_cd_rip_logs(releases, progress_cb, errors)
    verify_cuetools_image_families(releases, progress_cb, errors)

    # Store probe/log/verification failures on the releases list wrapper is not possible, so the
    # prepared analysis returns them separately through a temporary track tag.
    if errors and tracks:
        tracks[0].tags["__ANALYZER_PREPARE_ERRORS__"] = json.dumps(errors, ensure_ascii=False)
    return releases, tracks


def analyze_prepared(
    releases: List[Release],
    tracks: List[Track],
    use_fingerprint: bool,
    progress_cb,
    exclude_remixes: bool = True,
    exclude_live: bool = True,
    excluded_pattern_keys: Optional[Set[str]] = None,
    comparison_log_path: Optional[Path] = None,
    personal_keep_rules: Optional[List[Dict[str, str]]] = None,
) -> Tuple[List[Release], List[Track], Dict[int, List[int]], Set[int], List[Tuple[int, int, str]], List[str]]:
    errors: List[str] = []
    if tracks:
        packed_errors = tracks[0].tags.pop("__ANALYZER_PREPARE_ERRORS__", "")
        if packed_errors:
            try:
                errors.extend(json.loads(packed_errors))
            except Exception:
                pass

    # Existing global options run first. The pattern review can only exclude
    # additional material; a checked pattern does not override Save Remixes/Live.
    configure_exclusions(releases, exclude_remixes, exclude_live, personal_keep_rules)
    apply_pattern_exclusions(releases, set(excluded_pattern_keys or set()))
    for track in tracks:
        track.base_excluded_from_coverage = bool(track.exclude_from_coverage)
        track.manual_skip_rule = ""
    refresh_heuristic_release_types(releases)

    fpcalc = ensure_fpcalc() if use_fingerprint else None
    if use_fingerprint and fpcalc:
        # Fingerprint every audio file. Coverage exclusions still affect only
        # optimization through Release.groups; fingerprints are also needed for
        # safe intra-release duplicate cleanup inside retained releases.
        fingerprint_tracks = list(tracks)
        fp_workers = min(len(fingerprint_tracks) or 1, _fingerprint_workers())
        label = f"Generating Chromaprint fingerprints ({fp_workers} workers)..."
        progress_cb(label, 0, max(1, len(fingerprint_tracks)))
        with ThreadPoolExecutor(max_workers=fp_workers) as ex:
            futures = {ex.submit(chromaprint_fingerprint, fpcalc, t): t for t in fingerprint_tracks}
            done = 0
            for fut in as_completed(futures):
                t = futures[fut]
                try:
                    t.fingerprint, t.fingerprint_duration = fut.result()
                except Exception as e:
                    errors.append(f"Fingerprint error: {t.path}: {e}")
                done += 1
                progress_cb(label, done, len(fingerprint_tracks))

    groups, merge_notes = merge_equivalent_tracks(
        tracks,
        progress_cb,
        comparison_log_path,
    )
    errors.extend(merge_notes)
    progress_cb("Applying saved track skips...", 0, 1)
    apply_persistent_track_skips(tracks)
    progress_cb("Applying saved track skips...", 1, 1)
    progress_cb("Optimizing release set...", 0, 1)
    selected = optimize_collection(releases, groups)
    progress_cb("Optimizing release set...", 1, 1)
    reviews = review_candidates(tracks)
    progress_cb("Building automatic action plan...", 1, 1)
    return releases, tracks, groups, selected, reviews, errors


def analyze(
    existing: Optional[Path],
    recycle: Path,
    use_fingerprint: bool,
    progress_cb,
    exclude_remixes: bool = True,
    exclude_live: bool = True,
    excluded_pattern_keys: Optional[Set[str]] = None,
    logging_enabled: bool = False,
    personal_keep_rules: Optional[List[Dict[str, str]]] = None,
) -> Tuple[List[Release], List[Track], Dict[int, List[int]], Set[int], List[Tuple[int, int, str]], List[str]]:
    releases, tracks = prepare_analysis(existing, recycle, progress_cb)
    comparison_log_path = _new_comparison_log_path(recycle) if (use_fingerprint and logging_enabled) else None
    return analyze_prepared(
        releases,
        tracks,
        use_fingerprint,
        progress_cb,
        exclude_remixes,
        exclude_live,
        excluded_pattern_keys,
        comparison_log_path,
        personal_keep_rules,
    )


def report_text(existing: Optional[Path], recycle: Path, releases: List[Release], tracks: List[Track], groups: Dict[int, List[int]], selected: Set[int], reviews, notes) -> str:
    by_id = {r.rid: r for r in releases}
    existing_groups = set().union(*(r.groups for r in releases if r.root_kind == "existing")) if releases else set()
    selected_groups = set().union(*(r.groups for r in releases if r.rid in selected)) if selected else set()

    lines: List[str] = []
    lines.append("Duplicate / Edition Analyzer")
    lines.append(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append(f"Existing discography: {existing if existing is not None else 'Not used (Recycle-only mode)'}")
    lines.append(f"Recycle/update: {recycle}")
    lines.append("")
    lines.append("RULE PRIORITY")
    lines.append("1. Preserve ideally every unique recording/version.")
    lines.append("2. Keep every album represented.")
    lines.append("3. Apply Save Remixes / Save Live recordings as selection filters; Personal Picks can explicitly restore chosen remix/live recordings.")
    lines.append("4. Prefer CD/physical source over equivalent WEB content.")
    lines.append("5. Among otherwise exact-identical CD rips, prefer the higher hey-bro-check-log EAC/XLD score.")
    lines.append("6. Prefer the existing processed copy when content/source/log quality are equivalent.")
    lines.append("7. Then minimize total included track count across the whole retained collection; edition bonus tracks add no value when already covered elsewhere.")
    lines.append("8. Clean/explicit is neutral during optimization; ITUNESADVISORY 1 beats 0 only as the absolute final tie-break for otherwise exact-equivalent releases.")
    lines.append("9. Uncertain audio matches stay separate and are retained automatically.")
    lines.append("")
    lines.append("SUMMARY")
    lines.append(f"Releases scanned: {len(releases)}")
    lines.append(f"Audio files scanned: {len(tracks)}")
    lines.append(f"High-confidence recording groups: {len(groups)}")
    lines.append(f"Proposed retained releases: {len(selected)}")
    lines.append(f"Proposed retained included audio files: {sum(by_id[x].included_track_count for x in selected)}")
    lines.append(f"Skipped remix/live/pattern files inside retained releases: {sum(by_id[x].ignored_track_count for x in selected)}")
    personal_kept = [t for t in tracks if t.personal_keep_rule and not t.exclude_from_coverage]
    lines.append(f"Personal-pick track matches included: {len(personal_kept)}")
    lines.append("Manual review required: no")
    lines.append("")

    lines.append("PROPOSED RELEASE PLAN")
    lines.append("=====================")
    for rel in sorted(releases, key=lambda r: (r.root_kind, str(r.path).lower())):
        if rel.rid in selected:
            if rel.root_kind == "recycle" and (rel.groups - existing_groups):
                status = "NEW"
                reason = "Selected because it contributes material not already covered by the existing discography and/or is part of the minimum-duplication solution."
            else:
                status = "KEEP"
                reason = "Selected by album-coverage / minimum-file optimization."
        else:
            if rel.groups <= selected_groups:
                status = "REDUNDANT"
                covers = []
                for gid in sorted(rel.groups):
                    candidates = [r for r in releases if r.rid in selected and gid in r.groups]
                    if candidates:
                        best = min(candidates, key=lambda r: (r.included_track_count, -_explicit_rank(r), -r.source_quality, 0 if r.root_kind == "existing" else 1))
                        covers.append(best.path.name)
                unique_covers = []
                for x in covers:
                    if x not in unique_covers:
                        unique_covers.append(x)
                reason = "All high-confidence recording groups are covered by retained releases"
                if unique_covers:
                    reason += ": " + "; ".join(unique_covers[:8])
            else:
                status = "KEEP" if rel.root_kind == "existing" else "NEW"
                reason = "Conservative fallback: content was not proven covered elsewhere, so it is retained."
        if len(rel.source_paths) > 1:
            lines.append(f"[{status}] {rel.path.parent} / {rel.title} [{len(rel.source_paths)} disc folders]")
        else:
            lines.append(f"[{status}] {rel.path}")
        lines.append(f"  Type: {rel.release_type} ({rel.type_source}); family: {rel.family or '?'}")
        if rel.has_cd_image and rel.has_rip_log:
            src = "CD IMAGE+LOG+CUE"
        elif rel.has_cd_image:
            src = "CD IMAGE+CUE"
        else:
            src = "CD+LOG+CUE" if rel.has_cue and rel.has_rip_log else "CUE" if rel.has_cue else "WEB/AudioChecker" if rel.has_audiochecker else "WEB/unknown"
        lines.append(
            f"  Source: {src}; included tracks: {rel.included_track_count}; "
            f"skipped by options: {rel.ignored_track_count}; tracks: {rel.track_count}"
        )
        if rel.has_cd_image:
            image_files = sorted({t.path.name for t in rel.tracks if t.virtual_from_cue})
            lines.append(
                f"  CD image: {len(image_files)} image file(s), {rel.cd_image_track_count} CUE track(s)"
            )
        if rel.has_cue and any(r.has_cd_image and r.family == rel.family for r in releases):
            lines.append(f"  CUETools verification: {cuetools_cd_quality_text(rel)}")
        if rel.rip_log_paths:
            lines.append(f"  CD rip log quality: {cd_rip_log_quality_text(rel)}")
        lines.append(f"  Reason: {reason}")
        lines.append("")

    lines.append("AUTOMATIC MATCHING POLICY")
    lines.append("=========================")
    lines.append("Strong audio matches are grouped automatically. Uncertain matches remain separate and are retained automatically; no track-by-track user review is required.")
    lines.append("")

    lines.append("HIGH-CONFIDENCE DUPLICATE GROUPS")
    lines.append("================================")
    dup_count = 0
    for gid, ids in sorted(groups.items()):
        if len(ids) < 2:
            continue
        dup_count += 1
        lines.append(f"Group {gid + 1}:")
        for i in ids:
            t = tracks[i]
            r = by_id[t.release_id]
            mark = "KEEP" if r.rid in selected else "DROP-CANDIDATE"
            lines.append(f"  [{mark}] {r.path.name} -> {format_track(t)}")
        lines.append("")
    if dup_count == 0:
        lines.append("None.")
        lines.append("")

    if notes:
        lines.append("SCAN NOTES / ERRORS")
        lines.append("===================")
        for n in notes:
            lines.append(n)
        lines.append("")

    lines.append("IMPORTANT")
    lines.append("This is a proposal only. No files were changed, moved, or deleted.")
    lines.append("Chromaprint fingerprint similarity plus duration is the duplicate-identity signal. CUE-image tracks are fingerprinted as their CUE time segments. Titles, filenames, MBIDs and ISRCs are not used to prove duplicates.")
    lines.append("Filename/title similarity does not participate in duplicate identity.")
    return "\n".join(lines) + "\n"



@dataclass
class ReleaseDecision:
    release_id: int
    action: str
    reason: str
    essential_tracks: List[str] = field(default_factory=list)
    related_release_ids: List[int] = field(default_factory=list)
    decision_factors: List[str] = field(default_factory=list)


def _selected_group_union(releases: List[Release], selected: Set[int], exclude: Optional[int] = None) -> Set[int]:
    out: Set[int] = set()
    for r in releases:
        if r.rid in selected and r.rid != exclude:
            out |= r.groups
    return out


def _preferred_existing_cover_for_recycle(rel: Release, releases: List[Release]) -> Optional[Release]:
    """Return an existing release that makes this recycle release redundant.

    This is a final action-layer safeguard based on audio fingerprint coverage
    and source preference. Folder/file names are not duplicate evidence.
    """
    if rel.root_kind != "recycle" or rel.excluded_only:
        return None
    candidates: List[Release] = []
    for er in releases:
        if er.root_kind != "existing" or er.excluded_only:
            continue
        if er.release_type == "album" and rel.release_type == "album" and not _related_album_releases(er, rel):
            continue
        if not _release_covers(er, rel):
            continue
        if (_explicit_rank(er), source_rank(er)) < (_explicit_rank(rel), source_rank(rel)):
            continue

        # When the two are strict exact-equivalent CD rips and both logs were
        # fully scored, a better recycle rip is allowed to replace an older
        # existing copy.
        if _same_release_exact_cd_content(er, rel):
            er_quality = cd_rip_quality_key(er)
            rel_quality = cd_rip_quality_key(rel)
            if er_quality is not None and rel_quality is not None and rel_quality > er_quality:
                continue

        candidates.append(er)
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda er: (
            _explicit_rank(er),
            source_rank(er),
            er.included_track_count,
        ),
    )


def build_release_decisions(
    releases: List[Release],
    tracks: List[Track],
    selected: Set[int],
    reviews,
    blocked_release_ids: Optional[Set[int]] = None,
) -> List[ReleaseDecision]:
    selected_rels = [r for r in releases if r.rid in selected]
    selected_groups = _selected_group_union(releases, selected)

    existing_groups: Set[int] = set()
    for r in releases:
        if r.root_kind == "existing":
            existing_groups |= r.groups

    decisions: List[ReleaseDecision] = []
    blocked = set(blocked_release_ids or set())

    for rel in releases:
        if rel.rid in blocked:
            covered_groups = rel.groups & selected_groups
            uncovered_groups = rel.groups - selected_groups

            orphan_titles: List[str] = []
            seen_orphans: Set[str] = set()
            for track in rel.tracks:
                if track.exclude_from_coverage or track.group_id not in uncovered_groups:
                    continue
                key = normalize_title(track.display_title)
                if key not in seen_orphans:
                    seen_orphans.add(key)
                    orphan_titles.append(track.display_title)

            selected_by_id = {other.rid: other for other in selected_rels}
            cover_ids = sorted(
                (
                    other.rid
                    for other in selected_rels
                    if other.rid != rel.rid and bool(rel.groups & other.groups)
                ),
                key=lambda rid: (
                    -len(rel.groups & selected_by_id[rid].groups),
                    selected_by_id[rid].path.name.casefold(),
                ),
            )

            action = "REMOVE" if rel.root_kind == "existing" else "SKIP"
            if uncovered_groups:
                reason = (
                    "Manually removed in Decision Map and collection re-optimized. "
                    f"WARNING: {len(uncovered_groups)} recording group(s) are not available "
                    "from any other retained release."
                )
            else:
                reason = (
                    "Manually removed in Decision Map and collection re-optimized. "
                    "All included recordings were reassigned to other retained releases."
                )

            decisions.append(
                ReleaseDecision(
                    release_id=rel.rid,
                    action=action,
                    reason=reason,
                    essential_tracks=orphan_titles,
                    related_release_ids=cover_ids,
                    decision_factors=[
                        "Manual Decision Map removal is an explicit user constraint.",
                        f"Recording groups reassigned elsewhere: {len(covered_groups)}.",
                        f"Recording groups with no retained replacement: {len(uncovered_groups)}.",
                    ],
                )
            )
            continue

        # A release containing only tracks excluded by the active checkboxes is
        # automatically removed/skipped. Mixed releases can still be retained for
        # unique included audio.
        if rel.excluded_only:
            action = "REMOVE" if rel.root_kind == "existing" else "SKIP"
            kinds = []
            if any(t.is_remix for t in rel.tracks):
                kinds.append("remix")
            if any(t.is_live for t in rel.tracks):
                kinds.append("live")
            if any(t.manual_skip_rule for t in rel.tracks):
                kinds.append("saved track skip")
            pattern_keys = sorted({t.excluded_by_pattern for t in rel.tracks if t.excluded_by_pattern})
            if pattern_keys:
                kinds.append("pattern: " + "; ".join(pattern_keys))
            label = "/".join(kinds) if kinds else "excluded"
            decisions.append(
                ReleaseDecision(
                    release_id=rel.rid,
                    action=action,
                    reason=f"Excluded-only release ({label}) by current checkbox settings.",
                    essential_tracks=[],
                    decision_factors=[
                        f"Included tracks after options: {rel.included_track_count}",
                        f"Skipped tracks by options/patterns: {rel.ignored_track_count}",
                    ],
                )
            )
            continue

        # Final hard safeguard: if an existing processed release covers this
        # recycle copy by audio groups and is not worse in source quality, it wins.
        existing_cover = _preferred_existing_cover_for_recycle(rel, releases)
        if existing_cover is not None:
            decisions.append(
                ReleaseDecision(
                    release_id=rel.rid,
                    action="SKIP",
                    reason=f"Covered by preferred existing release: {existing_cover.path.name}",
                    essential_tracks=[],
                    related_release_ids=[existing_cover.rid],
                    decision_factors=[
                        "Existing processed copy has equivalent fingerprint-group coverage.",
                        "Existing copy is not worse under source / explicit / CD-rip-quality preference rules.",
                    ],
                )
            )
            continue

        other_selected_groups = _selected_group_union(releases, selected, exclude=rel.rid)
        essential_groups = rel.groups - other_selected_groups if rel.rid in selected else set()

        essential_tracks: List[str] = []
        seen_titles: Set[str] = set()
        for t in rel.tracks:
            if t.group_id in essential_groups:
                key = normalize_title(t.display_title)
                if key not in seen_titles:
                    seen_titles.add(key)
                    essential_tracks.append(t.display_title)

        if rel.rid in selected:
            if rel.root_kind == "existing":
                action = "KEEP"
                if essential_tracks:
                    reason = f"Keep: {len(essential_tracks)} recording(s) are not covered by any other retained release."
                elif rel.release_type == "album":
                    reason = "Keep: required album representation in the minimum-file solution."
                else:
                    reason = "Keep: selected by the automatic minimum-file coverage solution."
            else:
                replaced = [
                    r for r in releases
                    if r.root_kind == "existing"
                    and r.rid not in selected
                    and r.groups
                    and r.groups <= rel.groups
                    and (
                        (r.release_type == "album" and rel.release_type == "album" and r.family == rel.family)
                        or normalize_title(r.title) == normalize_title(rel.title)
                    )
                ]
                new_groups = rel.groups - existing_groups
                if replaced:
                    action = "REPLACE"
                    reason = "Use this recycle release instead of: " + "; ".join(r.path.name for r in replaced[:4])
                else:
                    action = "ADD"
                    if essential_tracks:
                        preview = ", ".join(essential_tracks[:4])
                        if len(essential_tracks) > 4:
                            preview += f", +{len(essential_tracks)-4} more"
                        reason = (
                            f"Add: {len(essential_tracks)} recording(s) are supplied only by this "
                            "retained release in the current plan"
                        )
                        if preview:
                            reason += f": {preview}"
                    elif rel.release_type == "album":
                        reason = (
                            "Add: this is the selected edition representing the album after "
                            "collection-wide optimization; its included recordings are covered "
                            "elsewhere in the retained set."
                        )
                    else:
                        reason = "Add: selected by the global minimum-file coverage solution."
        else:
            covered = (bool(rel.groups) and rel.groups <= selected_groups) or (not rel.groups and rel.excluded_only)
            if covered:
                action = "REMOVE" if rel.root_kind == "existing" else "SKIP"
                covers: List[str] = []
                for gid in sorted(rel.groups):
                    candidates = [r for r in selected_rels if gid in r.groups]
                    if candidates:
                        best = min(
                            candidates,
                            key=lambda r: (r.included_track_count, -_explicit_rank(r), -source_rank(r), 0 if r.root_kind == "existing" else 1),
                        )
                        if best.path.name not in covers:
                            covers.append(best.path.name)
                reason = "All recordings are covered by retained releases."
                if covers:
                    reason += " Covered by: " + "; ".join(covers[:5])
            else:
                # Defensive fail-safe. If the optimizer ever produces a non-selected
                # release with uncovered groups, do not ask the user to investigate;
                # retain it automatically so unique material cannot be lost.
                action = "KEEP" if rel.root_kind == "existing" else "ADD"
                reason = "Conservative fallback: contains material not proven covered elsewhere, so it is retained automatically."

        related_release_ids: List[int] = []
        factors: List[str] = []

        if rel.rid in selected:
            if essential_tracks:
                factors.append(f"{len(essential_tracks)} recording(s) are unique to this retained release within the final set.")
            elif rel.release_type == "album":
                factors.append("Album representation is required even though its recordings are covered elsewhere.")
            else:
                factors.append("Chosen by the global minimum-track/minimum-release coverage solution.")

            personal_matches = [
                t.display_title for t in rel.tracks
                if t.personal_keep_rule and not t.exclude_from_coverage
            ]
            if personal_matches:
                factors.append(f"Personal Picks restored {len(personal_matches)} track(s) that global remix/live options would otherwise skip.")

            new_groups_for_factor = rel.groups - existing_groups
            if rel.root_kind == "recycle" and new_groups_for_factor:
                factors.append(
                    f"{len(new_groups_for_factor)} included recording group(s) are not present in the pre-analysis existing discography."
                )

            if action == "REPLACE":
                related_release_ids = [
                    r.rid for r in releases
                    if r.root_kind == "existing"
                    and r.rid not in selected
                    and r.groups
                    and r.groups <= rel.groups
                    and (
                        (r.release_type == "album" and rel.release_type == "album" and r.family == rel.family)
                        or normalize_title(r.title) == normalize_title(rel.title)
                    )
                ]
        else:
            if covered:
                cover_ids: List[int] = []
                for gid in sorted(rel.groups):
                    candidates = [r for r in selected_rels if gid in r.groups]
                    if not candidates:
                        continue
                    best = min(
                        candidates,
                        key=lambda r: (
                            r.included_track_count,
                            -_explicit_rank(r),
                            -source_rank(r),
                            0 if r.root_kind == "existing" else 1,
                        ),
                    )
                    if best.rid not in cover_ids:
                        cover_ids.append(best.rid)
                related_release_ids = cover_ids
                factors.append(f"All {len(rel.groups)} included recording group(s) are covered by retained releases.")
            else:
                factors.append("Conservative safety fallback: at least one recording group was not proven covered.")

        factors.append(
            f"Included tracks: {rel.included_track_count}; skipped by remix/live/pattern options: {rel.ignored_track_count}."
        )

        decisions.append(
            ReleaseDecision(
                release_id=rel.rid,
                action=action,
                reason=reason,
                essential_tracks=essential_tracks,
                related_release_ids=related_release_ids,
                decision_factors=factors,
            )
        )

    return decisions

def action_summary(decisions: List[ReleaseDecision]) -> Dict[str, int]:
    counts = Counter(d.action for d in decisions)
    return {k: counts.get(k, 0) for k in ("ADD", "REPLACE", "REMOVE", "SKIP", "KEEP")}


def _release_source_description(rel: Release) -> str:
    if rel.has_cd_image and rel.has_rip_log:
        return "CD image + CUE + rip log"
    if rel.has_cd_image:
        return "CD image + CUE"
    if rel.has_cue and rel.has_rip_log:
        return "CD + CUE + rip log"
    if rel.has_cue:
        return "CUE-based CD"
    if rel.has_audiochecker:
        return "WEB / AudioChecker"
    return "WEB / unknown"


def _manual_track_skips_path() -> Path:
    _migrate_legacy_app_data()
    return _state_dir() / "manual_track_skips.json"


def _track_fingerprint_hash(track: Track) -> str:
    if not track.fingerprint:
        return ""
    digest = hashlib.sha256()
    for value in track.fingerprint:
        digest.update(struct.pack("<I", int(value) & 0xFFFFFFFF))
    return digest.hexdigest()


def _load_manual_track_skip_rules() -> List[Dict[str, object]]:
    path = _manual_track_skips_path()
    try:
        if not path.is_file():
            return []
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = data.get("rules", []) if isinstance(data, dict) else []
        return [dict(row) for row in rows if isinstance(row, dict)]
    except Exception:
        return []


def _save_manual_track_skip_rules(rules: List[Dict[str, object]]) -> None:
    _atomic_write_json(
        _manual_track_skips_path(),
        {
            "app": APP_NAME,
            "version": APP_VERSION,
            "updated": datetime.now().isoformat(timespec="seconds"),
            "rules": rules,
        },
    )


def _manual_skip_rule_matches_track(rule: Dict[str, object], track: Track) -> bool:
    fp_hash = _track_fingerprint_hash(track)
    fingerprint_hashes = {str(x) for x in rule.get("fingerprint_hashes", []) if str(x)}
    if fp_hash and fp_hash in fingerprint_hashes:
        return True

    mbid = _normalized_identifier(track.mbid)
    mbids = {_normalized_identifier(str(x)) for x in rule.get("mbids", []) if str(x)}
    if mbid and mbid in mbids:
        return True

    isrc = _normalized_identifier(track.isrc)
    isrcs = {_normalized_identifier(str(x)) for x in rule.get("isrcs", []) if str(x)}
    base = _base_title_identity(track.display_title)
    bases = {str(x) for x in rule.get("base_titles", []) if str(x)}
    if isrc and isrc in isrcs and base and base in bases:
        return True

    return False


def apply_persistent_track_skips(tracks: List[Track]) -> int:
    """Apply saved user track exclusions after audio groups have been built."""
    for track in tracks:
        track.manual_skip_rule = ""
        track.exclude_from_coverage = bool(track.base_excluded_from_coverage)

    rules = _load_manual_track_skip_rules()
    if not rules:
        return 0

    group_members: Dict[int, List[Track]] = defaultdict(list)
    for track in tracks:
        if track.group_id >= 0:
            group_members[track.group_id].append(track)

    applied_groups: Set[int] = set()
    for rule in rules:
        rule_id = str(rule.get("id", "")).strip()
        if not rule_id:
            continue
        matched_groups: Set[int] = set()
        direct_matches: List[Track] = []
        for track in tracks:
            if _manual_skip_rule_matches_track(rule, track):
                if track.group_id >= 0:
                    matched_groups.add(track.group_id)
                else:
                    direct_matches.append(track)

        for group_id in matched_groups:
            applied_groups.add(group_id)
            for member in group_members.get(group_id, []):
                member.manual_skip_rule = rule_id
                member.exclude_from_coverage = True

        for track in direct_matches:
            track.manual_skip_rule = rule_id
            track.exclude_from_coverage = True

    return len(applied_groups)


def add_persistent_track_skip(track: Track, tracks: List[Track]) -> str:
    members = (
        [candidate for candidate in tracks if candidate.group_id == track.group_id]
        if track.group_id >= 0
        else [track]
    )
    fingerprint_hashes = sorted({
        value for value in (_track_fingerprint_hash(member) for member in members) if value
    })
    mbids = sorted({
        _normalized_identifier(member.mbid) for member in members if _normalized_identifier(member.mbid)
    })
    isrcs = sorted({
        _normalized_identifier(member.isrc) for member in members if _normalized_identifier(member.isrc)
    })
    base_titles = sorted({
        _base_title_identity(member.display_title)
        for member in members
        if _base_title_identity(member.display_title)
    })

    identity_payload = "|".join(fingerprint_hashes + mbids + isrcs + base_titles)
    if not identity_payload:
        identity_payload = (
            f"{_base_title_identity(track.display_title)}|"
            f"{normalize_artist(track.artist)}|{track.duration:.3f}"
        )
    rule_id = "skip-" + hashlib.sha256(identity_payload.encode("utf-8")).hexdigest()[:20]

    rules = _load_manual_track_skip_rules()
    existing = next((row for row in rules if str(row.get("id", "")) == rule_id), None)
    if existing is None:
        rules.append(
            {
                "id": rule_id,
                "label": track.display_title,
                "created": datetime.now().isoformat(timespec="seconds"),
                "fingerprint_hashes": fingerprint_hashes,
                "mbids": mbids,
                "isrcs": isrcs,
                "base_titles": base_titles,
            }
        )
        _save_manual_track_skip_rules(rules)

    apply_persistent_track_skips(tracks)
    return rule_id


def remove_persistent_track_skip(rule_id: str, tracks: List[Track]) -> None:
    rules = [
        row
        for row in _load_manual_track_skip_rules()
        if str(row.get("id", "")).strip() != str(rule_id).strip()
    ]
    _save_manual_track_skip_rules(rules)
    apply_persistent_track_skips(tracks)


def _decision_snapshot_path() -> Path:
    _migrate_legacy_app_data()
    return _state_dir() / "last_decision_map.json"


def _save_decision_snapshot(items: List[Dict[str, object]]) -> None:
    try:
        _atomic_write_json(
            _decision_snapshot_path(),
            {
                "app": APP_NAME,
                "version": APP_VERSION,
                "generated": datetime.now().isoformat(timespec="seconds"),
                "releases": items,
            },
        )
    except Exception:
        pass


def _load_decision_snapshot() -> List[Dict[str, object]]:
    path = _decision_snapshot_path()
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            releases = data.get("releases", []) if isinstance(data, dict) else []
            if isinstance(releases, list):
                return [item for item in releases if isinstance(item, dict)]
    except Exception:
        pass
    return []


def _duration_display(seconds: float) -> str:
    if seconds <= 0:
        return "?:??"
    total = int(round(seconds))
    return f"{total // 60}:{total % 60:02d}"


def _track_distinction_summary(
    track: Track,
    candidates: List[Track],
    by_release_id: Dict[int, Release],
) -> str:
    """Explain why same/similar titled tracks remain separate recording groups."""
    choices = [
        other
        for other in candidates
        if other is not track
        and other.release_id != track.release_id
        and other.group_id >= 0
        and other.group_id != track.group_id
    ]
    if not choices:
        return ""

    choices.sort(
        key=lambda other: (
            0 if identity_title(other.display_title) == identity_title(track.display_title) else 1,
            abs((track.duration or 0.0) - (other.duration or 0.0)),
            other.display_title.casefold(),
        )
    )
    other = choices[0]
    other_release = by_release_id.get(other.release_id)
    other_name = other_release.path.name if other_release is not None else other.album or "another release"
    audio_match, _sim = fingerprint_auto_match(track, other)
    metadata_conflict = _metadata_match_conflict(track, other) if audio_match else ""

    artists_a = _artist_signature(track.artist)
    artists_b = _artist_signature(other.artist)
    delta = abs((track.duration or 0.0) - (other.duration or 0.0))

    if audio_match and metadata_conflict:
        if artists_a and artists_b and artists_a != artists_b:
            return (
                f"Same audio as '{other.display_title}' on {other_name}, but kept separate because "
                f"artist credit differs ({track.artist or '?'} vs {other.artist or '?'})"
                + (" and ISRC differs." if track.isrc and other.isrc and track.isrc != other.isrc else ".")
            )
        return (
            f"Same audio as '{other.display_title}' on {other_name}, but kept separate by metadata safety: "
            f"{metadata_conflict}."
        )

    if not audio_match:
        details: List[str] = []
        if artists_a and artists_b and artists_a != artists_b:
            details.append(f"artist credit differs ({track.artist or '?'} vs {other.artist or '?'})")
        if delta >= 1.0:
            details.append(
                f"length {_duration_display(track.duration)} vs {_duration_display(other.duration)} "
                f"({delta:.1f}s difference)"
            )
        if track.isrc and other.isrc and track.isrc != other.isrc:
            details.append("ISRC differs")
        if details:
            return (
                f"Different audio from '{other.display_title}' on {other_name}: "
                + "; ".join(details)
                + "; Chromaprint did not match."
            )
        return (
            f"Same visible metadata/length as '{other.display_title}' on {other_name}, "
            "but Chromaprint did not match."
        )

    return ""


def build_decision_snapshot(
    releases: List[Release],
    tracks: List[Track],
    selected: Set[int],
    decisions: List[ReleaseDecision],
    blocked_release_ids: Optional[Set[int]] = None,
) -> List[Dict[str, object]]:
    """Build a compact explanation model for the visual Decision Map."""
    by_id = {r.rid: r for r in releases}
    by_decision = {d.release_id: d for d in decisions}
    selected_rels = [r for r in releases if r.rid in selected]
    selected_groups = _selected_group_union(releases, selected)
    blocked = set(blocked_release_ids or set())

    all_group_carriers: Dict[int, Set[int]] = defaultdict(set)
    eligible_group_carriers: Dict[int, Set[int]] = defaultdict(set)
    for carrier in releases:
        for gid in carrier.groups:
            all_group_carriers[gid].add(carrier.rid)
            if carrier.rid not in blocked:
                eligible_group_carriers[gid].add(carrier.rid)

    track_global_index = {id(track): index for index, track in enumerate(tracks)}
    same_title_index: Dict[str, List[Track]] = defaultdict(list)
    for candidate in tracks:
        key = _base_title_identity(candidate.display_title)
        if key:
            same_title_index[key].append(candidate)

    snapshots: List[Dict[str, object]] = []

    for rel in releases:
        decision = by_decision[rel.rid]
        retained = decision.action in {"KEEP", "ADD", "REPLACE"}
        manual_removed = rel.rid in blocked

        track_titles_by_group: Dict[int, List[str]] = defaultdict(list)
        for track in rel.tracks:
            if track.exclude_from_coverage or track.group_id < 0:
                continue
            title = track.display_title
            if title not in track_titles_by_group[track.group_id]:
                track_titles_by_group[track.group_id].append(title)

        coverage_rows: List[Dict[str, object]] = []
        if not retained and rel.groups:
            coverage_by_release: Dict[int, Set[int]] = defaultdict(set)
            for gid in sorted(rel.groups):
                candidates = [r for r in selected_rels if gid in r.groups]
                if not candidates:
                    continue
                best = min(
                    candidates,
                    key=lambda r: (
                        r.included_track_count,
                        -_explicit_rank(r),
                        -source_rank(r),
                        0 if r.root_kind == "existing" else 1,
                    ),
                )
                coverage_by_release[best.rid].add(gid)

            for cover_id, gids in sorted(
                coverage_by_release.items(),
                key=lambda item: (-len(item[1]), by_id[item[0]].path.name.casefold()),
            ):
                cover = by_id[cover_id]
                examples: List[str] = []
                for gid in sorted(gids):
                    for title in track_titles_by_group.get(gid, []):
                        if title not in examples:
                            examples.append(title)
                        if len(examples) >= 5:
                            break
                    if len(examples) >= 5:
                        break
                coverage_rows.append(
                    {
                        "release_id": cover_id,
                        "name": cover.path.name,
                        "action": by_decision.get(cover_id).action if cover_id in by_decision else "KEEP",
                        "groups": len(gids),
                        "examples": examples,
                    }
                )

        essential_groups = set()
        if retained:
            essential_groups = rel.groups - _selected_group_union(releases, selected, exclude=rel.rid)

        essential_examples: List[str] = []
        for gid in sorted(essential_groups):
            for title in track_titles_by_group.get(gid, []):
                if title not in essential_examples:
                    essential_examples.append(title)
                if len(essential_examples) >= 12:
                    break
            if len(essential_examples) >= 12:
                break

        personal_matches = [
            {
                "title": t.display_title,
                "rule": t.personal_keep_rule,
            }
            for t in rel.tracks
            if t.personal_keep_rule and not t.exclude_from_coverage
        ]

        ignored_counts = {
            "remix": sum(1 for t in rel.tracks if t.exclude_from_coverage and t.is_remix),
            "live": sum(1 for t in rel.tracks if t.exclude_from_coverage and t.is_live),
            "pattern": sum(1 for t in rel.tracks if t.exclude_from_coverage and bool(t.excluded_by_pattern)),
            "manual": sum(1 for t in rel.tracks if bool(t.manual_skip_rule)),
        }

        quality_bits: List[str] = []
        if rel.has_cue:
            quality_bits.append(f"CUETools: {cuetools_cd_quality_text(rel)}")
        if rel.rip_log_paths:
            quality_bits.append(f"Rip log: {cd_rip_log_quality_text(rel)}")

        related: List[Dict[str, object]] = []
        for related_id in decision.related_release_ids:
            other = by_id.get(related_id)
            if other is None:
                continue
            related.append(
                {
                    "release_id": other.rid,
                    "name": other.path.name,
                    "action": by_decision.get(other.rid).action if other.rid in by_decision else "",
                    "source": _release_source_description(other),
                    "included_tracks": other.included_track_count,
                }
            )

        other_selected_groups = _selected_group_union(releases, selected, exclude=rel.rid)
        tracklist: List[Dict[str, object]] = []
        for fallback_number, track in enumerate(rel.tracks, start=1):
            included = not track.exclude_from_coverage and track.group_id >= 0
            eligible_carriers = eligible_group_carriers.get(track.group_id, set())
            available_elsewhere = bool(
                included and any(rid != rel.rid for rid in eligible_carriers)
            )
            covering_releases = [
                other
                for other in selected_rels
                if other.rid != rel.rid and track.group_id >= 0 and track.group_id in other.groups
            ]
            covered_by_other_retained = bool(covering_releases)
            orphaned = bool(
                manual_removed
                and included
                and not available_elsewhere
            )
            unique_to_release = bool(
                retained and included and track.group_id in essential_groups
            )
            base_key = _base_title_identity(track.display_title)
            distinction = ""
            if included and not covered_by_other_retained and base_key:
                distinction = _track_distinction_summary(
                    track,
                    same_title_index.get(base_key, []),
                    by_id,
                )
            track_number = _track_number_key(track)
            tracklist.append(
                {
                    "number": track_number if track_number is not None else fallback_number,
                    "title": track.display_title,
                    "artist": track.artist,
                    "duration": _duration_display(track.duration),
                    "duration_seconds": round(track.duration, 3),
                    "path": str(track.path),
                    "track_global_index": track_global_index.get(id(track), -1),
                    "group_id": track.group_id,
                    "included": included,
                    "excluded": bool(track.exclude_from_coverage),
                    "manual_skip": bool(track.manual_skip_rule),
                    "manual_skip_rule": track.manual_skip_rule,
                    "available_elsewhere": available_elsewhere,
                    "covered_by_other_retained": covered_by_other_retained,
                    "covered_by_names": [other.path.name for other in covering_releases[:4]],
                    "unique_to_release": unique_to_release,
                    "orphaned": orphaned,
                    "distinction": distinction,
                }
            )

        affected_ids: Set[int] = set()
        for gid in rel.groups:
            affected_ids |= all_group_carriers.get(gid, set())
        affected_ids.discard(rel.rid)

        affected: List[Dict[str, object]] = []
        for other_id in affected_ids:
            other = by_id.get(other_id)
            if other is None:
                continue
            overlap = rel.groups & other.groups
            if not overlap:
                continue
            examples: List[str] = []
            for gid in sorted(overlap):
                for title in track_titles_by_group.get(gid, []):
                    if title not in examples:
                        examples.append(title)
                    if len(examples) >= 5:
                        break
                if len(examples) >= 5:
                    break
            other_decision = by_decision.get(other.rid)
            affected.append(
                {
                    "release_id": other.rid,
                    "name": other.path.name,
                    "action": other_decision.action if other_decision is not None else "",
                    "outcome": (
                        "RETAINED"
                        if other_decision is not None
                        and other_decision.action in {"KEEP", "ADD", "REPLACE"}
                        else "MANUALLY REMOVED"
                        if other.rid in blocked
                        else "DUPLICATE"
                    ),
                    "shared_groups": len(overlap),
                    "examples": examples,
                    "manual_removed": other.rid in blocked,
                }
            )
        affected.sort(
            key=lambda row: (
                -int(row.get("shared_groups", 0)),
                str(row.get("name", "")).casefold(),
            )
        )

        # Show exact/same-coverage alternatives as supporting context without
        # pretending that metadata alone created the duplicate relationship.
        alternatives: List[Dict[str, object]] = []
        for other in releases:
            if other.rid == rel.rid or not rel.groups or not other.groups:
                continue
            same_family = (
                (rel.release_type == "album" and other.release_type == "album" and rel.family and rel.family == other.family)
                or normalize_title(rel.title) == normalize_title(other.title)
            )
            if not same_family:
                continue
            if rel.groups == other.groups:
                alternatives.append(
                    {
                        "release_id": other.rid,
                        "name": other.path.name,
                        "action": by_decision.get(other.rid).action if other.rid in by_decision else "",
                        "source": _release_source_description(other),
                        "included_tracks": other.included_track_count,
                        "root_kind": other.root_kind,
                    }
                )
        alternatives = alternatives[:8]

        outcome = "MANUALLY REMOVED" if manual_removed else ("RETAINED" if retained else "DUPLICATE")
        snapshots.append(
            {
                "release_id": rel.rid,
                "name": rel.path.name,
                "path": str(rel.path),
                "root_kind": rel.root_kind,
                "action": decision.action,
                "outcome": outcome,
                "reason": decision.reason,
                "release_type": rel.release_type,
                "family": rel.family,
                "source": _release_source_description(rel),
                "included_tracks": rel.included_track_count,
                "ignored_tracks": rel.ignored_track_count,
                "physical_tracks": rel.track_count,
                "recording_groups": len(rel.groups),
                "decision_factors": list(decision.decision_factors),
                "essential_tracks": list(decision.essential_tracks),
                "essential_examples": essential_examples,
                "personal_matches": personal_matches[:12],
                "ignored_counts": ignored_counts,
                "quality": quality_bits,
                "coverage": coverage_rows,
                "related": related,
                "alternatives": alternatives,
                "selected_group_coverage_complete": bool(rel.groups and rel.groups <= selected_groups),
                "manual_removed": manual_removed,
                "orphan_count": sum(1 for row in tracklist if bool(row.get("orphaned"))),
                "tracklist": tracklist,
                "affected": affected,
            }
        )

    return sorted(
        snapshots,
        key=lambda item: (
            0 if item.get("manual_removed") else 1 if item.get("outcome") == "DUPLICATE" else 2,
            str(item.get("name", "")).casefold(),
        ),
    )



LOSSLESS_CODECS = {"flac", "alac", "wavpack", "ape", "tta", "tak"}
LOSSLESS_EXTS = {".flac", ".wav", ".ape", ".wv"}


@dataclass
class IntraReleaseDuplicate:
    release_id: int
    redundant: Path
    keep: Path
    reason: str


def _track_number_key(track: Track) -> Optional[int]:
    if track.virtual_from_cue and track.cue_track_number:
        return track.cue_track_number
    raw = tag_lookup(track.tags, "tracknumber", "track", "trackno")
    match = re.search(r"\d+", raw or "")
    if match:
        return int(match.group())
    match = re.match(r"^\s*(\d{1,3})(?:\s*[-._)]\s*|\s+)", track.path.name)
    return int(match.group(1)) if match else None


def _track_codec_quality(track: Track) -> Tuple[int, int, int, int, int, int, int]:
    codec = (track.codec_name or "").lower()
    ext = track.path.suffix.lower()
    lossless = codec in LOSSLESS_CODECS or codec.startswith("pcm_") or (not codec and ext in LOSSLESS_EXTS)

    # FLAC/ALAC/WavPack/APE/PCM are equivalent lossless families here; the
    # technical stream parameters decide first, then a deterministic container
    # preference keeps FLAC when everything else is equal.
    codec_preference = {
        "flac": 60,
        "alac": 55,
        "wavpack": 50,
        "ape": 45,
        "tta": 44,
        "tak": 43,
        "pcm_s24le": 42,
        "pcm_s16le": 41,
        "opus": 35,
        "aac": 30,
        "vorbis": 25,
        "mp3": 20,
    }.get(codec, 10)
    ext_preference = {
        ".flac": 9, ".m4a": 8, ".wv": 7, ".ape": 6, ".wav": 5,
        ".opus": 4, ".ogg": 3, ".mp3": 2, ".aac": 1,
    }.get(ext, 0)

    return (
        1 if lossless else 0,
        track.sample_rate,
        track.bit_depth,
        track.channels,
        track.bit_rate if not lossless else 0,
        codec_preference,
        ext_preference,
    )


def _logical_title_keys(track: Track) -> Set[str]:
    """Possible logical-title identities used only as an intra-release safety gate.

    Duplicate identity is still the audio group. Using both tags and filename
    prevents a bad TITLE tag from blocking cleanup of obvious duplicate files.
    """
    keys: Set[str] = set()
    for value in (
        track.display_title,
        strip_track_number(track.path.stem),
        track.title,
    ):
        key = identity_title(value or "")
        if key:
            keys.add(key)
    return keys


def _same_logical_track(a: Track, b: Track) -> bool:
    if a.path.parent.resolve() != b.path.parent.resolve():
        return False
    if a.group_id < 0 or a.group_id != b.group_id:
        return False

    number_a = _track_number_key(a)
    number_b = _track_number_key(b)
    # Track position remains a hard safety gate. If one side has a number and
    # the other does not, keep both instead of guessing.
    if number_a is not None and number_b is not None:
        if number_a != number_b:
            return False
    elif number_a is not None or number_b is not None:
        return False

    # Accept when any reliable title source agrees: embedded TITLE, normalized
    # display title, or filename stem. This catches cases such as
    # "01 - Mask Off (...).flac" vs "01 Mask Off (...).flac" even when one
    # embedded tag is inconsistent.
    keys_a = _logical_title_keys(a)
    keys_b = _logical_title_keys(b)
    return bool(keys_a and keys_b and (keys_a & keys_b))


def plan_intra_release_duplicates(
    releases: List[Release],
    decisions: List["ReleaseDecision"],
) -> List[IntraReleaseDuplicate]:
    """Plan redundant audio files inside retained releases.

    Duplicate identity still comes exclusively from the existing audio group.
    Title/track number are only safety gates preventing intentional repeated
    recordings from being removed from different track positions.
    """
    action_by_id = {d.release_id: d.action for d in decisions}
    retained_actions = {"KEEP", "ADD", "REPLACE"}
    planned: List[IntraReleaseDuplicate] = []

    for rel in releases:
        if action_by_id.get(rel.rid) not in retained_actions:
            continue

        # Never remove files from a CUE-based rip automatically because a CUE
        # sheet may reference an exact filename.
        if rel.has_cue:
            continue

        candidates = [t for t in rel.tracks if t.group_id >= 0 and t.path.exists()]
        consumed: Set[Path] = set()

        for i, first in enumerate(candidates):
            if first.path in consumed:
                continue
            same = [first]
            for second in candidates[i + 1:]:
                if second.path in consumed:
                    continue
                if _same_logical_track(first, second):
                    same.append(second)

            if len(same) < 2:
                continue

            keep = max(
                same,
                key=lambda t: (
                    _track_codec_quality(t),
                    t.file_size,
                    -len(t.path.name),
                    str(t.path).lower(),
                ),
            )
            for duplicate in same:
                if duplicate.path == keep.path:
                    continue
                consumed.add(duplicate.path)
                planned.append(
                    IntraReleaseDuplicate(
                        release_id=rel.rid,
                        redundant=duplicate.path,
                        keep=keep.path,
                        reason=(
                            "Same retained release, same logical track position/title "
                            "(tag and/or filename), and same high-confidence audio group. "
                            f"Kept {keep.path.name} ({keep.codec_name or keep.path.suffix.lower()}); "
                            f"moved {duplicate.path.name} ({duplicate.codec_name or duplicate.path.suffix.lower()})."
                        ),
                    )
                )

    return planned


def _duplicates_root(recycle: Path) -> Path:
    """Return <artist>_duplicates as a sibling of the selected artist folder."""
    return recycle.parent / f"{recycle.name}_duplicates"


def _last_manifest_path() -> Path:
    _migrate_legacy_app_data()
    path = _state_dir() / "last_move.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _is_ancestor(parent: Path, child: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return parent.resolve() != child.resolve()
    except Exception:
        return False


def _release_paths(rel: Release) -> List[Path]:
    return rel.source_paths


def _remove_empty_dirs(root: Optional[Path]) -> None:
    if root is None or not root.is_dir():
        return
    for current, dirs, files in os.walk(root, topdown=False):
        path = Path(current)
        if path == root:
            continue
        try:
            if not any(path.iterdir()):
                path.rmdir()
        except OSError:
            pass


def _automatic_move_set(releases: List[Release], decisions: List[ReleaseDecision]) -> List[Tuple[Release, ReleaseDecision]]:
    by_id = {r.rid: r for r in releases}
    chosen: List[Tuple[Release, ReleaseDecision]] = []
    for d in decisions:
        r = by_id[d.release_id]
        if (r.root_kind == "recycle" and d.action == "SKIP") or (r.root_kind == "existing" and d.action == "REMOVE"):
            chosen.append((r, d))

    retained = [by_id[d.release_id] for d in decisions if d.action in {"KEEP", "ADD", "REPLACE"}]
    for r, _d in chosen:
        for source in _release_paths(r):
            for keep in retained:
                for kept_path in _release_paths(keep):
                    if _is_ancestor(source, kept_path):
                        raise RuntimeError(
                            "Move plan conflict:\n\n"
                            f"Remove candidate: {source}\nRetained release: {kept_path}"
                        )

    result: List[Tuple[Release, ReleaseDecision]] = []
    moved_roots: List[Path] = []
    for r, d in sorted(chosen, key=lambda x: min(len(p.parts) for p in _release_paths(x[0]))):
        sources = _release_paths(r)
        if any(any(_is_ancestor(parent, source) for parent in moved_roots) for source in sources):
            continue
        result.append((r, d))
        moved_roots.extend(sources)
    return result


def apply_automatic_plan(
    existing: Optional[Path],
    recycle: Path,
    releases: List[Release],
    decisions: List[ReleaseDecision],
    intra_duplicates: Optional[List[IntraReleaseDuplicate]] = None,
    progress_cb=None,
) -> Dict[str, object]:
    moves = _automatic_move_set(releases, decisions)
    intra_duplicates = list(intra_duplicates or plan_intra_release_duplicates(releases, decisions))
    duplicates = _duplicates_root(recycle)

    # Mirror the original path below the selected root. Multi-disc sibling
    # releases move as one logical decision but preserve every physical folder.
    planned: List[Tuple[Release, ReleaseDecision, Path, Path]] = []
    target_map: Dict[str, Path] = {}
    for release, decision in moves:
        root = release.scan_root or (existing if release.root_kind == "existing" else recycle)
        if root is None:
            raise RuntimeError(f"Missing scan root for: {release.path}")
        for source in _release_paths(release):
            try:
                relative = source.relative_to(root)
            except ValueError:
                raise RuntimeError(f"Release is outside its scan root:\n{source}\n{root}")
            target_base = duplicates / "!Remixes" if release.has_remixes else duplicates
            target = target_base / relative
            key = os.path.normcase(str(target.resolve(strict=False)))
            if key in target_map:
                raise RuntimeError(
                    "Destination collision:\n\n"
                    f"{target_map[key]}\n{source}\n\nDestination: {target}"
                )
            target_map[key] = source
            if target.exists():
                raise RuntimeError(
                    "Destination already exists:\n\n"
                    f"{target}\n\nResolve the conflict and run again."
                )
            planned.append((release, decision, source, target))

    by_id = {r.rid: r for r in releases}
    planned_files: List[Tuple[IntraReleaseDuplicate, Path]] = []
    for item in intra_duplicates:
        release = by_id.get(item.release_id)
        if release is None:
            continue
        root = release.scan_root or (existing if release.root_kind == "existing" else recycle)
        if root is None:
            raise RuntimeError(f"Missing scan root for intra-release duplicate: {item.redundant}")
        try:
            relative = item.redundant.relative_to(root)
        except ValueError:
            raise RuntimeError(f"Duplicate file is outside its scan root:\n{item.redundant}\n{root}")

        root_label = "Existing" if release.root_kind == "existing" else "Recycle"
        target = duplicates / "!Duplicate Files" / root_label / relative
        key = os.path.normcase(str(target.resolve(strict=False)))
        if key in target_map:
            raise RuntimeError(
                "Destination collision:\n\n"
                f"{target_map[key]}\n{item.redundant}\n\nDestination: {target}"
            )
        target_map[key] = item.redundant
        if target.exists():
            raise RuntimeError(
                "Destination already exists:\n\n"
                f"{target}\n\nResolve the conflict and run again."
            )
        planned_files.append((item, target))

    duplicates.mkdir(parents=True, exist_ok=True)
    completed: List[Tuple[Path, Path]] = []
    manifest: Dict[str, object] = {
        "app": APP_NAME,
        "version": APP_VERSION,
        "created": datetime.now().isoformat(timespec="seconds"),
        "duplicates_root": str(duplicates),
        "existing_root": str(existing) if existing is not None else "",
        "recycle_root": str(recycle),
        "moves": [],
    }

    try:
        if moves and not planned:
            raise RuntimeError("Redundant releases were found, but no move operations were planned.")

        if progress_cb:
            progress_cb("Moving release folders...", 0, max(1, len(planned)))

        for move_index, (release, decision, source, target) in enumerate(planned, 1):
            if not source.exists():
                raise RuntimeError(f"Move source missing:\n\n{source}")
            target.parent.mkdir(parents=True, exist_ok=True)

            try:
                os.replace(str(source), str(target))
            except OSError:
                shutil.move(str(source), str(target))

            if source.exists() or not target.exists():
                raise RuntimeError(
                    "Move failed:\n\n"
                    f"Source: {source}\nTarget: {target}\n\n"
                    "Completed moves rolled back."
                )

            completed.append((source, target))
            manifest["moves"].append({
                "move_type": "release",
                "release_id": release.rid,
                "action": decision.action,
                "original": str(source),
                "moved_to": str(target),
                "remix_bucket": bool(release.has_remixes),
                "reason": decision.reason,
            })
            if progress_cb:
                progress_cb("Moving release folders...", move_index, max(1, len(planned)))

        if progress_cb:
            progress_cb("Moving duplicate files inside retained releases...", 0, max(1, len(planned_files)))

        for file_index, (item, target) in enumerate(planned_files, 1):
            source = item.redundant
            if not source.exists():
                raise RuntimeError(f"Duplicate-file source missing:\n\n{source}")
            if not item.keep.exists():
                raise RuntimeError(
                    "Chosen survivor is missing; refusing intra-release cleanup:\n\n"
                    f"Keep: {item.keep}\nRedundant: {source}"
                )
            target.parent.mkdir(parents=True, exist_ok=True)

            try:
                os.replace(str(source), str(target))
            except OSError:
                shutil.move(str(source), str(target))

            if source.exists() or not target.exists():
                raise RuntimeError(
                    "Duplicate-file move failed:\n\n"
                    f"Source: {source}\nTarget: {target}\n\n"
                    "Completed moves rolled back."
                )

            completed.append((source, target))
            manifest["moves"].append({
                "move_type": "intra_release_file",
                "release_id": item.release_id,
                "action": "DEDUP",
                "original": str(source),
                "moved_to": str(target),
                "kept": str(item.keep),
                "remix_bucket": False,
                "reason": item.reason,
            })
            if progress_cb:
                progress_cb("Moving duplicate files inside retained releases...", file_index, max(1, len(planned_files)))

        # Remove organizational folders left empty by moved releases/files.
        _remove_empty_dirs(recycle)
        _remove_empty_dirs(existing)

        _last_manifest_path().write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        for original, target in reversed(completed):
            try:
                if target.exists() and not original.exists():
                    original.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(target), str(original))
            except Exception:
                pass
        raise

    counts = action_summary(decisions)
    remaining_recycle = sum(
        1 for d in decisions
        if next(r for r in releases if r.rid == d.release_id).root_kind == "recycle"
        and d.action in {"ADD", "REPLACE", "KEEP"}
    )
    remix_release_ids = {release.rid for release, _decision in moves if release.has_remixes}
    return {
        "duplicates": duplicates,
        "moved": len(moves),
        "moved_folders": len(planned),
        "intra_duplicate_files": len(planned_files),
        "remix_moved": len(remix_release_ids),
        "remaining_recycle": remaining_recycle,
        "add": counts["ADD"],
        "replace": counts["REPLACE"],
        "removed_current": counts["REMOVE"],
        "skipped_recycle": counts["SKIP"],
    }


def undo_last_run() -> Tuple[int, List[str]]:
    manifest_path = _last_manifest_path()
    if not manifest_path.is_file():
        raise RuntimeError("No undo manifest found.")
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    moves = data.get("moves") or []
    restored = 0
    conflicts: List[str] = []
    for item in reversed(moves):
        original = Path(item["original"])
        saved = Path(item["moved_to"])
        if not saved.exists():
            # Already restored (or manually removed from the duplicate bucket).
            # If the original exists, this item is complete rather than a conflict.
            continue
        if original.exists():
            conflicts.append(str(original))
            continue
        original.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(saved), str(original))
        restored += 1

    # Remove now-empty mirrored helper folders, but preserve any older content.
    dup_root = Path(data.get("duplicates_root") or "")
    _remove_empty_dirs(dup_root)
    try:
        if dup_root.is_dir() and not any(dup_root.iterdir()):
            dup_root.rmdir()
    except Exception:
        pass
    if not conflicts:
        try:
            manifest_path.unlink(missing_ok=True)
        except Exception:
            pass
    return restored, conflicts


class DecisionExplorerWindow(tk.Toplevel):
    """Modern release-only dependency map with drill-down details."""

    def __init__(
        self,
        master,
        snapshots: List[Dict[str, object]],
        allow_apply: bool = False,
        summary_text: str = "",
        releases: Optional[List[Release]] = None,
        tracks: Optional[List[Track]] = None,
        groups: Optional[Dict[int, List[int]]] = None,
        selected: Optional[Set[int]] = None,
        reviews=None,
        decisions: Optional[List[ReleaseDecision]] = None,
        blocked_release_ids: Optional[Set[int]] = None,
        allow_reanalyze: bool = True,
    ):
        super().__init__(master)
        self.title(f"{APP_NAME} - Release Map")
        self.geometry("1440x900")
        self.minsize(980, 640)
        self.resizable(True, True)
        self.configure(background=DARK_BG)
        _enable_dark_titlebar(self)

        self.snapshots = list(snapshots)
        self.releases = list(releases) if releases is not None else None
        self.tracks = list(tracks) if tracks is not None else None
        self.groups = groups if groups is not None else None
        self.selected = set(selected or set())
        self.reviews = list(reviews or [])
        self.decisions = list(decisions or [])
        self.blocked_release_ids = set(blocked_release_ids or set())
        self.can_edit = bool(
            allow_apply
            and self.releases is not None
            and self.tracks is not None
            and self.groups is not None
            and selected is not None
        )
        self.allow_reanalyze = allow_reanalyze
        self.result: Optional[str] = None
        self.baseline_actions = {
            int(item.get("release_id", -1)): str(item.get("action", ""))
            for item in snapshots
        }
        self.by_snapshot_id: Dict[int, Dict[str, object]] = {
            int(item.get("release_id", -1)): item for item in self.snapshots
        }
        self.selected_release_id = self._initial_release_id()
        self.selected_track_global_index: Optional[int] = None
        self.details_open = False
        self.maximized = False
        self.base_summary_text = summary_text

        self.search_var = tk.StringVar()
        self.summary_var = tk.StringVar()
        self.release_title_var = tk.StringVar()
        self.release_meta_var = tk.StringVar()
        self.path_var = tk.StringVar()
        self.reason_var = tk.StringVar()
        self.track_info_var = tk.StringVar(value="Select a track for details.")
        self.details_button_var = tk.StringVar(value="More details")

        outer = ttk.Frame(self)
        outer.pack(fill="both", expand=True, padx=14, pady=12)

        toolbar = ttk.Frame(outer)
        toolbar.pack(fill="x", pady=(0, 8))
        ttk.Label(toolbar, text="Release Map", font=("Segoe UI", 15, "bold")).pack(side="left")

        self.release_choices = self._release_choice_values()
        self.release_choice_lookup = {label: rid for label, rid in self.release_choices}
        self.release_search = ttk.Combobox(
            toolbar,
            textvariable=self.search_var,
            values=[label for label, _rid in self.release_choices],
            state="normal",
            width=58,
        )
        self.release_search.pack(side="left", padx=(16, 8), fill="x", expand=True)
        self.release_search.bind("<<ComboboxSelected>>", self._search_release)
        self.release_search.bind("<Return>", self._search_release)
        ToolTip(self.release_search, "Type part of a release name and press Enter, or choose a release.")

        ttk.Button(toolbar, text="Center selected", command=self._fit_map).pack(side="left", padx=(0, 6))
        ttk.Button(toolbar, text="Maximize", command=self._toggle_maximize).pack(side="left", padx=(0, 6))
        if self.allow_reanalyze:
            ttk.Button(toolbar, text="Analyze again", command=self._reanalyze).pack(side="right")
        if self.can_edit:
            ttk.Button(toolbar, text="Apply plan", command=self._apply).pack(side="right", padx=(0, 6))
        ttk.Button(toolbar, text="Close", command=self._close).pack(side="right", padx=(0, 6))

        ttk.Label(
            outer,
            textvariable=self.summary_var,
            style="Help.TLabel",
            wraplength=1360,
            justify="left",
        ).pack(fill="x", pady=(0, 8))

        self.panes = tk.PanedWindow(
            outer,
            orient="vertical",
            background="#3f3f46",
            sashwidth=8,
            sashrelief="flat",
            bd=0,
            relief="flat",
        )
        self.panes.pack(fill="both", expand=True)

        map_frame = ttk.Frame(self.panes)
        details_frame = ttk.Frame(self.panes)
        self.panes.add(map_frame, minsize=240)
        self.panes.add(details_frame, minsize=300)

        self.canvas = tk.Canvas(
            map_frame,
            background="#111113",
            highlightthickness=1,
            highlightbackground="#3f3f46",
            borderwidth=0,
        )
        xscroll = ttk.Scrollbar(map_frame, orient="horizontal", command=self.canvas.xview)
        yscroll = ttk.Scrollbar(map_frame, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(xscrollcommand=xscroll.set, yscrollcommand=yscroll.set)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        yscroll.grid(row=0, column=1, sticky="ns")
        xscroll.grid(row=1, column=0, sticky="ew")
        map_frame.rowconfigure(0, weight=1)
        map_frame.columnconfigure(0, weight=1)
        self.canvas.bind("<MouseWheel>", self._map_mousewheel)
        self.canvas.bind("<Shift-MouseWheel>", self._map_shift_mousewheel)
        self.canvas.bind("<ButtonPress-2>", lambda e: self.canvas.scan_mark(e.x, e.y))
        self.canvas.bind("<B2-Motion>", lambda e: self.canvas.scan_dragto(e.x, e.y, gain=1))

        detail_header = ttk.Frame(details_frame)
        detail_header.pack(fill="x", pady=(2, 5))
        title_col = ttk.Frame(detail_header)
        title_col.pack(side="left", fill="x", expand=True)
        ttk.Label(
            title_col,
            textvariable=self.release_title_var,
            font=("Segoe UI", 12, "bold"),
        ).pack(anchor="w")
        ttk.Label(
            title_col,
            textvariable=self.release_meta_var,
            style="Help.TLabel",
        ).pack(anchor="w", pady=(2, 0))

        release_actions = ttk.Frame(detail_header)
        release_actions.pack(side="right")
        self.remove_release_btn = ttk.Button(
            release_actions,
            text="Remove release",
            command=self._toggle_manual_release,
        )
        if self.can_edit:
            self.remove_release_btn.pack(side="right", padx=(6, 0))
        ttk.Button(release_actions, text="Open folder", command=self._open_release_folder).pack(
            side="right", padx=(6, 0)
        )
        ttk.Button(release_actions, text="Copy path", command=self._copy_release_path).pack(
            side="right", padx=(6, 0)
        )

        path_row = ttk.Frame(details_frame)
        path_row.pack(fill="x", pady=(0, 6))
        ttk.Label(path_row, text="Path:", style="Help.TLabel").pack(side="left", padx=(0, 6))
        self.path_entry = ttk.Entry(path_row, textvariable=self.path_var, state="readonly")
        self.path_entry.pack(side="left", fill="x", expand=True)

        reason_box = tk.Frame(details_frame, background="#1b1b1f", bd=0)
        reason_box.pack(fill="x", pady=(0, 6))
        tk.Label(
            reason_box,
            text="Why this release is in the current plan",
            background="#1b1b1f",
            foreground="#a1a1aa",
            font=("Segoe UI", 9, "bold"),
            anchor="w",
        ).pack(fill="x", padx=10, pady=(8, 2))
        tk.Label(
            reason_box,
            textvariable=self.reason_var,
            background="#1b1b1f",
            foreground="#f4f4f5",
            font=("Segoe UI", 10),
            justify="left",
            anchor="w",
            wraplength=1320,
        ).pack(fill="x", padx=10, pady=(0, 8))

        more_row = ttk.Frame(details_frame)
        more_row.pack(fill="x", pady=(0, 5))
        ttk.Button(
            more_row,
            textvariable=self.details_button_var,
            command=self._toggle_details,
        ).pack(side="left")

        self.more_details = tk.Text(
            details_frame,
            height=5,
            wrap="word",
            background="#18181b",
            foreground="#d4d4d8",
            insertbackground="#f4f4f5",
            selectbackground="#264f78",
            relief="flat",
            borderwidth=0,
            padx=10,
            pady=8,
            font=("Segoe UI", 9),
            state="disabled",
        )

        track_bar = ttk.Frame(details_frame)
        track_bar.pack(fill="x", pady=(3, 5))
        ttk.Label(track_bar, text="Tracks", style="Section.TLabel").pack(side="left")
        ttk.Label(
            track_bar,
            text="Yellow = unique to this retained release. Red = manual removal would lose it.",
            style="Help.TLabel",
        ).pack(side="left", padx=(12, 0))
        self.track_skip_btn = ttk.Button(
            track_bar,
            text="Skip track",
            command=self._toggle_track_skip,
        )
        if self.can_edit:
            self.track_skip_btn.pack(side="right")

        track_frame = ttk.Frame(details_frame)
        track_frame.pack(fill="both", expand=True)
        self.track_tree = ttk.Treeview(
            track_frame,
            columns=("number", "title", "artist", "duration", "status"),
            show="headings",
            style="Analyzer.Treeview",
            selectmode="browse",
        )
        self.track_tree.heading("number", text="#")
        self.track_tree.heading("title", text="Track")
        self.track_tree.heading("artist", text="Artist")
        self.track_tree.heading("duration", text="Length")
        self.track_tree.heading("status", text="Why / coverage")
        self.track_tree.column("number", width=44, minwidth=38, stretch=False, anchor="center")
        self.track_tree.column("title", width=360, minwidth=180, stretch=True)
        self.track_tree.column("artist", width=220, minwidth=130, stretch=True)
        self.track_tree.column("duration", width=72, minwidth=60, stretch=False, anchor="center")
        self.track_tree.column("status", width=520, minwidth=250, stretch=True)
        track_scroll = ttk.Scrollbar(track_frame, orient="vertical", command=self.track_tree.yview)
        self.track_tree.configure(yscrollcommand=track_scroll.set)
        self.track_tree.pack(side="left", fill="both", expand=True)
        track_scroll.pack(side="right", fill="y")
        self.track_tree.tag_configure("unique", background="#423513", foreground="#ffe08a")
        self.track_tree.tag_configure("orphan", background="#4a1f24", foreground="#ffb4bc")
        self.track_tree.tag_configure("manual", foreground="#c4b5fd")
        self.track_tree.tag_configure("excluded", foreground="#a1a1aa")
        self.track_tree.bind("<<TreeviewSelect>>", self._select_track)

        tk.Label(
            details_frame,
            textvariable=self.track_info_var,
            background=DARK_BG,
            foreground="#d4d4d8",
            font=("Segoe UI", 9),
            justify="left",
            anchor="w",
            wraplength=1320,
        ).pack(fill="x", pady=(6, 0))

        self.protocol("WM_DELETE_WINDOW", self._close)
        self.after(50, self._initialize_layout)

    def _initial_release_id(self) -> int:
        retained = [
            int(item.get("release_id", -1))
            for item in self.snapshots
            if str(item.get("outcome", "")) == "RETAINED"
        ]
        if retained:
            return retained[0]
        if self.snapshots:
            return int(self.snapshots[0].get("release_id", -1))
        return -1

    def _release_choice_values(self) -> List[Tuple[str, int]]:
        rows: List[Tuple[str, int]] = []
        for item in sorted(self.snapshots, key=lambda x: str(x.get("name", "")).casefold()):
            rid = int(item.get("release_id", -1))
            action = str(item.get("action", ""))
            rows.append((f"[{action}] {item.get('name', '')}", rid))
        return rows

    def _initialize_layout(self) -> None:
        try:
            total = max(700, self.panes.winfo_height())
            self.panes.sash_place(0, 0, max(260, int(total * 0.46)))
        except Exception:
            pass
        self._update_summary()
        self._select_release_id(self.selected_release_id)

    def _map_mousewheel(self, event) -> None:
        self.canvas.yview_scroll(-1 if event.delta > 0 else 1, "units")

    def _map_shift_mousewheel(self, event) -> None:
        self.canvas.xview_scroll(-1 if event.delta > 0 else 1, "units")

    def _toggle_maximize(self) -> None:
        try:
            if self.state() == "zoomed":
                self.state("normal")
                self.maximized = False
            else:
                self.state("zoomed")
                self.maximized = True
        except Exception:
            pass

    def _search_release(self, _event=None) -> None:
        raw = self.search_var.get().strip()
        if not raw:
            return
        rid = self.release_choice_lookup.get(raw)
        if rid is None:
            needle = normalize_title(raw)
            for label, candidate_id in self.release_choices:
                if needle and needle in normalize_title(label):
                    rid = candidate_id
                    break
        if rid is not None:
            self._select_release_id(rid)

    def _select_release_id(self, release_id: int) -> None:
        if release_id not in self.by_snapshot_id:
            return
        self.selected_release_id = release_id
        self.selected_track_global_index = None
        item = self.by_snapshot_id[release_id]
        self.release_title_var.set(str(item.get("name", "")))
        changed = self.baseline_actions.get(release_id) not in (None, str(item.get("action", "")))
        changed_text = " | changed by your edits" if changed else ""
        self.release_meta_var.set(
            f"{item.get('outcome', '')} | {item.get('action', '')} | {item.get('source', '')}"
            f" | {item.get('included_tracks', 0)} included tracks{changed_text}"
        )
        self.path_var.set(str(item.get("path", "")))
        self.reason_var.set(str(item.get("reason", "")))
        self._fill_more_details(item)
        self._fill_tracklist(item)
        self._update_release_action(item)
        self._draw_release_network(item)

    def _draw_release_network(self, item: Dict[str, object]) -> None:
        self.canvas.delete("all")
        connected = list(item.get("affected", []) or [])
        connected.sort(
            key=lambda row: (
                -int(row.get("shared_groups", 0) or 0),
                str(row.get("name", "")).casefold(),
            )
        )

        center_x = 900
        center_y = 520
        center_width = 330
        center_height = 110

        positions: List[Tuple[Dict[str, object], float, float]] = []
        if connected:
            index = 0
            ring = 0
            while index < len(connected):
                ring += 1
                radius_x = 520 + (ring - 1) * 400
                radius_y = 320 + (ring - 1) * 220
                ring_count = min(12 + (ring - 1) * 6, len(connected) - index)
                for slot in range(ring_count):
                    angle = (2.0 * math.pi * slot / max(1, ring_count)) - math.pi / 2.0
                    x = center_x + math.cos(angle) * radius_x
                    y = center_y + math.sin(angle) * radius_y
                    positions.append((connected[index], x, y))
                    index += 1

        for row, x, y in positions:
            self.canvas.create_line(
                center_x,
                center_y,
                x,
                y,
                fill="#3f3f46",
                width=1,
            )

        self._release_node(
            center_x - center_width / 2,
            center_y - center_height / 2,
            center_width,
            center_height,
            int(item.get("release_id", -1)),
            str(item.get("name", "")),
            str(item.get("action", "")),
            int(item.get("recording_groups", 0) or 0),
            selected=True,
            changed=self.baseline_actions.get(int(item.get("release_id", -1))) not in (
                None,
                str(item.get("action", "")),
            ),
        )

        for row, x, y in positions:
            rid = int(row.get("release_id", -1))
            action = str(row.get("action", ""))
            self._release_node(
                x - 145,
                y - 44,
                290,
                88,
                rid,
                str(row.get("name", "")),
                action,
                int(row.get("shared_groups", 0) or 0),
                selected=False,
                changed=self.baseline_actions.get(rid) not in (None, action),
            )

        if not connected:
            self.canvas.create_text(
                center_x,
                center_y + 90,
                text="No other included release shares this release's current recording groups.",
                fill="#a1a1aa",
                font=("Segoe UI", 10),
                anchor="n",
            )

        bbox = self.canvas.bbox("all")
        if bbox:
            self.canvas.configure(
                scrollregion=(bbox[0] - 120, bbox[1] - 120, bbox[2] + 120, bbox[3] + 120)
            )
        self._fit_map()

    def _release_node(
        self,
        x: float,
        y: float,
        width: float,
        height: float,
        release_id: int,
        name: str,
        action: str,
        shared_or_groups: int,
        selected: bool,
        changed: bool,
    ) -> None:
        tag = f"release_{release_id}_{int(x)}_{int(y)}"
        outline = "#5b9bd5" if selected else "#52525b"
        fill = "#203044" if selected else "#202024"
        if action in {"SKIP", "REMOVE"}:
            fill = "#2d2022"
            outline = "#7f4a50"
        elif action in {"ADD", "REPLACE", "KEEP"} and not selected:
            fill = "#1d2a22"
            outline = "#42644d"
        if changed:
            outline = "#d19a4a"

        self.canvas.create_rectangle(
            x, y, x + width, y + height,
            fill=fill,
            outline=outline,
            width=2 if selected or changed else 1,
            tags=(tag,),
        )
        prefix = "* " if changed else ""
        display_name = textwrap.shorten(name, width=44 if selected else 38, placeholder="...")
        self.canvas.create_text(
            x + 12, y + 10,
            anchor="nw",
            text=prefix + display_name,
            fill="#f4f4f5",
            font=("Segoe UI", 10, "bold" if selected else "normal"),
            width=width - 24,
            tags=(tag,),
        )
        label = (
            f"{action} | {shared_or_groups} recording groups"
            if selected
            else f"{action} | {shared_or_groups} shared groups"
        )
        self.canvas.create_text(
            x + 12, y + height - 26,
            anchor="nw",
            text=label,
            fill="#a1a1aa",
            font=("Segoe UI", 9),
            width=width - 24,
            tags=(tag,),
        )
        self.canvas.tag_bind(tag, "<Button-1>", lambda _e, rid=release_id: self._select_release_id(rid))
        self.canvas.tag_bind(tag, "<Enter>", lambda _e: self.canvas.configure(cursor="hand2"))
        self.canvas.tag_bind(tag, "<Leave>", lambda _e: self.canvas.configure(cursor=""))

    def _fit_map(self) -> None:
        self.canvas.update_idletasks()
        bbox = self.canvas.bbox("all")
        if not bbox:
            return
        x0, y0, x1, y1 = bbox[0] - 80, bbox[1] - 80, bbox[2] + 80, bbox[3] + 80
        self.canvas.configure(scrollregion=(x0, y0, x1, y1))
        try:
            view_w = max(1, self.canvas.winfo_width())
            view_h = max(1, self.canvas.winfo_height())
            region_w = max(view_w, x1 - x0)
            region_h = max(view_h, y1 - y0)
            target_left = 900 - view_w / 2
            target_top = 520 - view_h / 2
            x_fraction = 0.0 if region_w <= view_w else (target_left - x0) / (region_w - view_w)
            y_fraction = 0.0 if region_h <= view_h else (target_top - y0) / (region_h - view_h)
            self.canvas.xview_moveto(max(0.0, min(1.0, x_fraction)))
            self.canvas.yview_moveto(max(0.0, min(1.0, y_fraction)))
        except Exception:
            pass

    def _fill_tracklist(self, item: Dict[str, object]) -> None:
        self.track_tree.delete(*self.track_tree.get_children())
        for row in item.get("tracklist", []) or []:
            if bool(row.get("manual_skip")):
                status = "Skipped by you (saved)"
                tags = ("manual",)
            elif bool(row.get("excluded")):
                status = "Skipped by active options"
                tags = ("excluded",)
            elif bool(row.get("orphaned")):
                status = "UNIQUE - removing this release would lose it"
                tags = ("orphan",)
            elif bool(row.get("unique_to_release")):
                status = "UNIQUE to this retained release"
                tags = ("unique",)
            elif bool(row.get("covered_by_other_retained")):
                names = row.get("covered_by_names", []) or []
                status = "Covered by retained release"
                if names:
                    status += ": " + "; ".join(names[:2])
                tags = ()
            elif bool(row.get("available_elsewhere")):
                status = "Available on another release"
                tags = ()
            else:
                status = "Included"
                tags = ()

            distinction = str(row.get("distinction", "")).strip()
            if distinction and status in {"Included", "UNIQUE to this retained release"}:
                status = status + " | " + distinction

            iid = str(row.get("track_global_index", -1))
            self.track_tree.insert(
                "",
                "end",
                iid=iid if iid != "-1" else None,
                values=(
                    row.get("number", ""),
                    row.get("title", ""),
                    row.get("artist", ""),
                    row.get("duration", ""),
                    status,
                ),
                tags=tags,
            )
        self.track_info_var.set("Select a track for details.")
        if self.can_edit:
            self.track_skip_btn.configure(text="Skip track", state="disabled")

    def _select_track(self, _event=None) -> None:
        selection = self.track_tree.selection()
        if not selection:
            return
        try:
            index = int(selection[0])
        except Exception:
            return
        self.selected_track_global_index = index
        row = None
        item = self.by_snapshot_id.get(self.selected_release_id, {})
        for candidate in item.get("tracklist", []) or []:
            if int(candidate.get("track_global_index", -1)) == index:
                row = candidate
                break
        if row is None:
            return

        pieces = [str(row.get("title", ""))]
        distinction = str(row.get("distinction", "")).strip()
        if distinction:
            pieces.append(distinction)
        elif bool(row.get("unique_to_release")):
            pieces.append("This recording group is supplied only by this retained release in the current plan.")
        elif bool(row.get("covered_by_other_retained")):
            names = row.get("covered_by_names", []) or []
            pieces.append("Same recording is retained elsewhere" + (": " + "; ".join(names[:3]) if names else "."))
        if bool(row.get("manual_skip")):
            pieces.append("You chose to skip this recording. That choice is saved for future analyses.")
        self.track_info_var.set("  ".join(pieces))

        if self.can_edit and self.tracks is not None and 0 <= index < len(self.tracks):
            track = self.tracks[index]
            if track.manual_skip_rule:
                self.track_skip_btn.configure(text="Restore track", state="normal")
            elif bool(row.get("excluded")):
                self.track_skip_btn.configure(text="Already skipped by options", state="disabled")
            else:
                self.track_skip_btn.configure(text="Skip track", state="normal")

    def _toggle_track_skip(self) -> None:
        if not self.can_edit or self.tracks is None or self.selected_track_global_index is None:
            return
        index = self.selected_track_global_index
        if not (0 <= index < len(self.tracks)):
            return
        track = self.tracks[index]
        if track.manual_skip_rule:
            remove_persistent_track_skip(track.manual_skip_rule, self.tracks)
        else:
            add_persistent_track_skip(track, self.tracks)
        self._reoptimize(preferred_release_id=self.selected_release_id, preferred_track_index=index)

    def _update_release_action(self, item: Dict[str, object]) -> None:
        if not self.can_edit:
            return
        rid = int(item.get("release_id", -1))
        if rid in self.blocked_release_ids:
            self.remove_release_btn.configure(text="Undo release removal", state="normal")
        elif str(item.get("outcome", "")) == "RETAINED":
            self.remove_release_btn.configure(text="Remove release", state="normal")
        else:
            self.remove_release_btn.configure(text="Already not retained", state="disabled")

    def _toggle_manual_release(self) -> None:
        if not self.can_edit:
            return
        rid = self.selected_release_id
        item = self.by_snapshot_id.get(rid)
        if item is None:
            return
        if rid in self.blocked_release_ids:
            self.blocked_release_ids.remove(rid)
        elif str(item.get("outcome", "")) == "RETAINED":
            self.blocked_release_ids.add(rid)
        else:
            return
        self._reoptimize(preferred_release_id=rid)

    def _reoptimize(
        self,
        preferred_release_id: Optional[int] = None,
        preferred_track_index: Optional[int] = None,
    ) -> None:
        if not self.can_edit or self.releases is None or self.tracks is None or self.groups is None:
            return
        self.selected = optimize_collection(self.releases, self.groups, self.blocked_release_ids)
        self.decisions = build_release_decisions(
            self.releases,
            self.tracks,
            self.selected,
            self.reviews,
            self.blocked_release_ids,
        )
        self.snapshots = build_decision_snapshot(
            self.releases,
            self.tracks,
            self.selected,
            self.decisions,
            self.blocked_release_ids,
        )
        _save_decision_snapshot(self.snapshots)
        self.by_snapshot_id = {
            int(item.get("release_id", -1)): item for item in self.snapshots
        }
        self.release_choices = self._release_choice_values()
        self.release_choice_lookup = {label: rid for label, rid in self.release_choices}
        self.release_search.configure(values=[label for label, _rid in self.release_choices])
        self._update_summary()
        self._select_release_id(
            preferred_release_id if preferred_release_id in self.by_snapshot_id else self._initial_release_id()
        )
        if preferred_track_index is not None:
            iid = str(preferred_track_index)
            if self.track_tree.exists(iid):
                self.track_tree.selection_set(iid)
                self.track_tree.see(iid)
                self._select_track()

    def _fill_more_details(self, item: Dict[str, object]) -> None:
        lines: List[str] = []
        for factor in item.get("decision_factors", []) or []:
            lines.append("• " + str(factor))
        for quality in item.get("quality", []) or []:
            lines.append("• " + str(quality))
        ignored = item.get("ignored_counts", {}) or {}
        if any(int(ignored.get(key, 0) or 0) for key in ("remix", "live", "pattern", "manual")):
            lines.append(
                "• Skipped tracks: "
                f"remix={ignored.get('remix', 0)}, live={ignored.get('live', 0)}, "
                f"pattern={ignored.get('pattern', 0)}, saved-by-you={ignored.get('manual', 0)}"
            )
        alternatives = item.get("alternatives", []) or []
        if alternatives:
            lines.append("• Same-coverage alternatives: " + "; ".join(str(row.get("name", "")) for row in alternatives[:6]))
        text = "\n".join(lines) if lines else "No additional decision details."
        self.more_details.configure(state="normal")
        self.more_details.delete("1.0", "end")
        self.more_details.insert("1.0", text)
        self.more_details.configure(state="disabled")

    def _toggle_details(self) -> None:
        if self.details_open:
            self.more_details.pack_forget()
            self.details_button_var.set("More details")
            self.details_open = False
        else:
            self.more_details.pack(fill="x", pady=(0, 6), before=self.track_tree.master)
            self.details_button_var.set("Hide details")
            self.details_open = True

    def _open_release_folder(self) -> None:
        path = Path(self.path_var.get())
        try:
            if os.name == "nt":
                os.startfile(path)
            else:
                subprocess.Popen(["xdg-open", str(path)])
        except Exception as exc:
            messagebox.showerror(APP_NAME, f"Could not open folder:\n{exc}", parent=self)

    def _copy_release_path(self) -> None:
        try:
            self.clipboard_clear()
            self.clipboard_append(self.path_var.get())
            self.update_idletasks()
        except Exception:
            pass

    def _update_summary(self) -> None:
        manual_release_count = len(self.blocked_release_ids)
        manual_track_count = len(_load_manual_track_skip_rules())
        changed_count = sum(
            1
            for item in self.snapshots
            if self.baseline_actions.get(int(item.get("release_id", -1))) not in (
                None, str(item.get("action", ""))
            )
        )
        orphan_count = sum(
            int(item.get("orphan_count", 0) or 0)
            for item in self.snapshots
            if item.get("manual_removed")
        )
        parts = [self.base_summary_text] if self.base_summary_text else []
        if manual_release_count:
            parts.append(f"Manually removed releases: {manual_release_count}")
        if manual_track_count:
            parts.append(f"Saved skipped tracks: {manual_track_count}")
        if changed_count:
            parts.append(f"Decisions changed: {changed_count}")
        if orphan_count:
            parts.append(f"Uncovered unique recordings: {orphan_count}")
        self.summary_var.set(" | ".join(parts) if parts else "Release map ready.")

    def _orphan_rows(self) -> List[Tuple[str, str]]:
        rows: List[Tuple[str, str]] = []
        for item in self.snapshots:
            if not item.get("manual_removed"):
                continue
            for row in item.get("tracklist", []) or []:
                if row.get("orphaned"):
                    rows.append((str(item.get("name", "")), str(row.get("title", ""))))
        return rows

    def _apply(self) -> None:
        orphan_rows = self._orphan_rows()
        if orphan_rows:
            preview = "\n".join(
                f"- {release_name}: {track_title}"
                for release_name, track_title in orphan_rows[:12]
            )
            if len(orphan_rows) > 12:
                preview += f"\n- +{len(orphan_rows) - 12} more"
            if not messagebox.askyesno(
                APP_NAME,
                (
                    f"{len(orphan_rows)} included recording(s) have no other allowed release after "
                    f"your manual release removals:\n\n{preview}\n\nApply the plan anyway?"
                ),
                parent=self,
            ):
                return
        self.result = "apply"
        self.destroy()

    def _reanalyze(self) -> None:
        self.result = "reanalyze"
        self.destroy()

    def _close(self) -> None:
        self.result = "close"
        self.destroy()


class DoneWindow(tk.Toplevel):
    def __init__(
        self,
        master,
        recycle: Path,
        result: Dict[str, object],
        decision_callback=None,
    ):
        super().__init__(master)
        self.title(f"{APP_NAME} - Done")
        self.resizable(False, False)
        self.configure(background=DARK_BG)
        _enable_dark_titlebar(self)
        self.recycle = recycle
        self.duplicates = Path(str(result["duplicates"]))
        self.decision_callback = decision_callback

        frame = ttk.Frame(self)
        frame.pack(fill="both", expand=True, padx=18, pady=18)

        ttk.Label(frame, text="Completed", font=("Segoe UI", 15, "bold")).pack(anchor="w")
        ttk.Label(
            frame,
            text=(
                f"Recycle releases kept: {result['remaining_recycle']}\n"
                f"Redundant releases moved: {result['moved']}\n"
                f"Duplicate files removed inside retained releases: {result['intra_duplicate_files']}\n"
                f"Moved under !Remixes: {result['remix_moved']}\n"
                f"Added: {result['add']}   Replaced: {result['replace']}   "
                f"Recycle skipped: {result['skipped_recycle']}   Existing removed: {result['removed_current']}"
            ),
            justify="left",
        ).pack(anchor="w", pady=(8, 10))
        ttk.Label(frame, text=f"Duplicates:\n{self.duplicates}", justify="left").pack(anchor="w", pady=(0, 14))

        buttons = ttk.Frame(frame)
        buttons.pack(fill="x")
        ttk.Button(buttons, text="Open recycle", command=lambda: os.startfile(self.recycle)).pack(side="left")
        ttk.Button(buttons, text="Open duplicates", command=lambda: os.startfile(self.duplicates)).pack(side="left", padx=8)
        ttk.Button(buttons, text="Undo last run", command=self.undo).pack(side="left", padx=8)
        if self.decision_callback is not None:
            ttk.Button(buttons, text="Release Map...", command=self.open_decision_map).pack(side="left", padx=8)
        ttk.Button(buttons, text="Close", command=self.destroy).pack(side="right")

        self.transient(master)
        self.grab_set()
        self.focus_force()

    def open_decision_map(self):
        if self._running:
            return

        context = self._live_decision_context
        if context is not None:
            snapshots = list(context.get("snapshots", []) or [])
        else:
            snapshots = self._decision_snapshot or _load_decision_snapshot()

        if not snapshots:
            messagebox.showinfo(APP_NAME, "No analyzed release decisions are available yet.", parent=self)
            return

        if context is not None:
            dialog = DecisionExplorerWindow(
                self,
                snapshots,
                allow_apply=True,
                summary_text=str(context.get("summary_text", "")),
                releases=context.get("releases"),
                tracks=context.get("tracks"),
                groups=context.get("groups"),
                selected=set(context.get("selected", set())),
                reviews=context.get("reviews"),
                decisions=context.get("decisions"),
                blocked_release_ids=set(context.get("blocked_release_ids", set())),
                allow_reanalyze=True,
            )
        else:
            dialog = DecisionExplorerWindow(
                self,
                snapshots,
                allow_apply=False,
                summary_text="Last saved analysis result.",
                allow_reanalyze=True,
            )

        self.wait_window(dialog)

        self._decision_snapshot = list(dialog.snapshots)
        _save_decision_snapshot(self._decision_snapshot)

        if context is not None:
            context["snapshots"] = list(dialog.snapshots)
            context["selected"] = set(dialog.selected)
            context["decisions"] = list(dialog.decisions)
            context["blocked_release_ids"] = set(dialog.blocked_release_ids)

        if dialog.result == "reanalyze":
            self._live_decision_context = None
            self.after(50, self.start)
            return

        if dialog.result == "apply" and context is not None:
            self._apply_live_decision_context(context)
            return

        self.status_var.set("Analysis complete - plan not applied.")

    def _apply_live_decision_context(self, context: Dict[str, object]) -> None:
        existing = context.get("existing")
        recycle = context.get("recycle")
        releases = context.get("releases")
        decisions = list(context.get("decisions", []) or [])
        if not isinstance(recycle, Path) or not isinstance(releases, list):
            messagebox.showerror(APP_NAME, "The current analysis context is no longer available.", parent=self)
            return

        counts = action_summary(decisions)
        intra_duplicates = plan_intra_release_duplicates(releases, decisions)
        to_move = counts["SKIP"] + counts["REMOVE"] + len(intra_duplicates)
        if to_move == 0:
            self.status_var.set("Analysis complete - no moves in current plan.")
            self._append_activity("Current plan contains no filesystem moves.")
            return

        self.run_btn.configure(state="disabled")
        self.progress_var.set(0)
        self.progress_detail_var.set("")
        self.status_var.set("Applying moves")
        self._last_progress_stage = ""
        self._append_activity("Applying moves")
        self._set_running(True)
        threading.Thread(
            target=self.apply_worker,
            args=(existing, recycle, releases, decisions, intra_duplicates),
            daemon=True,
        ).start()

    def undo_main(self):
        if self._running:
            return
        if not messagebox.askyesno(APP_NAME, "Undo last run?", parent=self):
            return
        try:
            restored, conflicts = undo_last_run()
        except Exception as exc:
            messagebox.showerror(APP_NAME, str(exc), parent=self)
            return
        if conflicts:
            messagebox.showwarning(APP_NAME, f"Restored: {restored}\nConflicts: {len(conflicts)}", parent=self)
        else:
            messagebox.showinfo(APP_NAME, f"Restored: {restored}", parent=self)

    def save_settings(self):
        _save_app_settings(
            self.existing_var.get(),
            self.recycle_var.get(),
            self.save_remixes_var.get(),
            self.save_live_var.get(),
            self.logging_var.get(),
            self.pattern_preferences,
            self.personal_keep_rules,
        )

    def on_close(self):
        self.save_settings()
        self.destroy()

    def browse(self, var: tk.StringVar):
        initial = var.get().strip()
        kwargs = {"title": "Select folder"}
        if initial and Path(initial).is_dir():
            kwargs["initialdir"] = initial
        path = filedialog.askdirectory(**kwargs)
        if path:
            var.set(path)
            self.save_settings()

    def clear_existing(self):
        self.existing_var.set("")
        self.save_settings()

    def _append_activity(self, text: str):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.activity.configure(state="normal")
        self.activity.insert("end", f"{timestamp}  {text}\n")
        self.activity.see("end")
        self.activity.configure(state="disabled")

    def _clear_activity(self):
        self.activity.configure(state="normal")
        self.activity.delete("1.0", "end")
        self.activity.configure(state="disabled")

    @staticmethod
    def _format_elapsed(seconds: float) -> str:
        seconds = max(0, int(seconds))
        hours, rem = divmod(seconds, 3600)
        minutes, secs = divmod(rem, 60)
        if hours:
            return f"{hours}:{minutes:02d}:{secs:02d}"
        return f"{minutes:02d}:{secs:02d}"

    def _heartbeat(self):
        if not self._running:
            return
        elapsed = self._format_elapsed(time.monotonic() - self._run_started_at)
        current = self.progress_detail_var.get()
        base = current.split(" | Elapsed ", 1)[0] if current else ""
        self.progress_detail_var.set(f"{base} | Elapsed {elapsed}" if base else f"Elapsed {elapsed}")
        self.after(1000, self._heartbeat)

    def _set_running(self, running: bool):
        self._running = running
        if running:
            self._run_started_at = time.monotonic()
            self._heartbeat()

    def update_progress(self, text: str, current: int, total: int):
        def apply_update():
            pct = 0 if total <= 0 else (current / total) * 100
            stage = text.rstrip(".")
            if stage != self._last_progress_stage:
                self._last_progress_stage = stage
                self._append_activity(stage)
            self.status_var.set(stage)
            self.progress_var.set(pct)
            count = f"{current:,} / {total:,}" if total > 0 else ""
            elapsed = self._format_elapsed(time.monotonic() - self._run_started_at) if self._running else "00:00"
            self.progress_detail_var.set(
                f"{count} ({pct:.0f}%) | Elapsed {elapsed}" if count else f"Elapsed {elapsed}"
            )
        self.after(0, apply_update)

    def start(self):
        existing_text = self.existing_var.get().strip()
        existing = Path(existing_text) if existing_text else None
        recycle_text = self.recycle_var.get().strip()
        recycle = Path(recycle_text) if recycle_text else None

        if recycle is None or not recycle.is_dir():
            messagebox.showerror(APP_NAME, "Invalid Recycle / update folder.")
            return
        if existing is not None and not existing.is_dir():
            messagebox.showerror(APP_NAME, "Invalid Existing discography folder.")
            return

        if existing is not None:
            try:
                if existing.resolve() == recycle.resolve() or _is_ancestor(existing, recycle) or _is_ancestor(recycle, existing):
                    messagebox.showerror(APP_NAME, "Existing and Recycle folders must be separate and non-nested.")
                    return
            except Exception:
                pass

        self.save_settings()
        self._live_decision_context = None
        self.run_btn.configure(state="disabled")
        self.progress_var.set(0)
        self.progress_detail_var.set("")
        self.status_var.set("Scanning phrases and track patterns")
        self._last_progress_stage = ""
        self._clear_activity()
        self._append_activity("Started")
        if self.logging_var.get():
            self._append_activity("Logging enabled")
        if self.personal_keep_rules:
            self._append_activity(f"Personal Picks: {len(self.personal_keep_rules)} rule(s)")
        self._set_running(True)
        threading.Thread(
            target=self.preflight_worker,
            args=(
                existing,
                recycle,
                self.save_remixes_var.get(),
                self.save_live_var.get(),
                self.logging_var.get(),
            ),
            daemon=True,
        ).start()

    def preflight_worker(
        self,
        existing: Optional[Path],
        recycle: Path,
        save_remixes: bool,
        save_live: bool,
        logging_enabled: bool,
    ):
        try:
            releases, tracks = prepare_analysis(existing, recycle, self.update_progress)
            patterns = collect_track_patterns(tracks)
            phrase_candidates = detect_personal_pick_phrases_from_tracks(
                tracks,
                include_remixes=not save_remixes,
                include_live=not save_live,
            )
            self.after(
                0,
                lambda releases=releases, tracks=tracks, patterns=patterns, phrase_candidates=phrase_candidates: self.review_personal_phrases(
                    existing,
                    recycle,
                    save_remixes,
                    save_live,
                    logging_enabled,
                    releases,
                    tracks,
                    patterns,
                    phrase_candidates,
                ),
            )
        except Exception as exc:
            error = str(exc)
            self.after(0, lambda error=error: self.failed(error))

    def review_personal_phrases(
        self,
        existing: Optional[Path],
        recycle: Path,
        save_remixes: bool,
        save_live: bool,
        logging_enabled: bool,
        releases: List[Release],
        tracks: List[Track],
        patterns: List[Dict[str, object]],
        phrase_candidates: List[Tuple[str, int, List[str]]],
    ):
        self._set_running(False)

        if phrase_candidates:
            dialog = PhraseReviewWindow(self, phrase_candidates, self.personal_keep_rules)
            self.wait_window(dialog)
            if dialog.result is None:
                self.run_btn.configure(state="normal")
                self.status_var.set("Cancelled")
                self.progress_detail_var.set("")
                self._append_activity("Cancelled during Personal Picks review")
                return

            existing_keys = {
                _personal_pick_normalize(str(item.get("value", "")))
                for item in self.personal_keep_rules
                if isinstance(item, dict)
            }
            added = 0
            for phrase in dialog.result:
                key = _personal_pick_normalize(phrase)
                if key and key not in existing_keys:
                    self.personal_keep_rules.append({"mode": "contains", "value": phrase})
                    existing_keys.add(key)
                    added += 1

            if added:
                self.personal_picks_btn.configure(text=self._personal_picks_button_text())
                self.save_settings()
                self._append_activity(f"Personal Picks: added {added} phrase(s)")
            else:
                self._append_activity("Personal Picks review complete: no new phrases added")
        else:
            self._append_activity("No skipped live/remix phrase candidates detected")

        self.review_patterns(
            existing,
            recycle,
            save_remixes,
            save_live,
            logging_enabled,
            releases,
            tracks,
            patterns,
        )

    def review_patterns(
        self,
        existing: Optional[Path],
        recycle: Path,
        save_remixes: bool,
        save_live: bool,
        logging_enabled: bool,
        releases: List[Release],
        tracks: List[Track],
        patterns: List[Dict[str, object]],
    ):
        self._set_running(False)

        excluded_pattern_keys: Set[str] = set()
        if patterns:
            dialog = PatternReviewWindow(self, patterns, self.pattern_preferences)
            self.wait_window(dialog)
            if dialog.result is None:
                self.run_btn.configure(state="normal")
                self.status_var.set("Cancelled")
                self.progress_detail_var.set("")
                self._append_activity("Cancelled before audio comparison")
                return

            self.pattern_preferences.update(dialog.result)
            excluded_pattern_keys = {key for key, keep in dialog.result.items() if not keep}
            self.save_settings()
            self._append_activity(
                f"Pattern review complete: {len(patterns)} pattern(s), "
                f"{len(excluded_pattern_keys)} excluded"
            )
        else:
            self._append_activity("No version-style track patterns detected")

        self.status_var.set("Continuing analysis")
        self.progress_var.set(0)
        self.progress_detail_var.set("")
        self._last_progress_stage = ""
        self._set_running(True)
        threading.Thread(
            target=self.worker_prepared,
            args=(
                existing,
                recycle,
                releases,
                tracks,
                save_remixes,
                save_live,
                logging_enabled,
                excluded_pattern_keys,
                [dict(item) for item in self.personal_keep_rules],
            ),
            daemon=True,
        ).start()

    def worker_prepared(
        self,
        existing: Optional[Path],
        recycle: Path,
        releases: List[Release],
        tracks: List[Track],
        save_remixes: bool,
        save_live: bool,
        logging_enabled: bool,
        excluded_pattern_keys: Set[str],
        personal_keep_rules: List[Dict[str, str]],
    ):
        try:
            comparison_log_path = _new_comparison_log_path(recycle) if logging_enabled else None
            result = analyze_prepared(
                releases,
                tracks,
                True,
                self.update_progress,
                not save_remixes,
                not save_live,
                excluded_pattern_keys,
                comparison_log_path,
                personal_keep_rules,
            )
            self.after(0, lambda result=result: self.done(existing, recycle, result))
        except Exception as exc:
            error = str(exc)
            self.after(0, lambda error=error: self.failed(error))

    def done(self, existing: Optional[Path], recycle: Path, result):
        self._set_running(False)
        self.run_btn.configure(state="normal")
        self.progress_var.set(100)
        self.progress_detail_var.set("100%")
        self._append_activity("Analysis complete")

        releases, tracks, groups, selected, reviews, notes = result
        comparison_log = next(
            (n.split("COMPARISON LOG:", 1)[1].strip() for n in notes if n.startswith("COMPARISON LOG:")),
            "",
        )
        if comparison_log:
            self._append_activity(f"Comparison log: {comparison_log}")

        blocked_release_ids: Set[int] = set()
        decisions = build_release_decisions(
            releases,
            tracks,
            selected,
            reviews,
            blocked_release_ids,
        )
        counts = action_summary(decisions)
        recycle_kept = sum(
            1 for d in decisions
            if next(r for r in releases if r.rid == d.release_id).root_kind == "recycle"
            and d.action in {"ADD", "REPLACE", "KEEP"}
        )
        initial_intra_duplicates = plan_intra_release_duplicates(releases, decisions)

        self._decision_snapshot = build_decision_snapshot(
            releases,
            tracks,
            selected,
            decisions,
            blocked_release_ids,
        )
        _save_decision_snapshot(self._decision_snapshot)
        self.decision_map_btn.configure(state="normal")
        self.status_var.set("Analysis complete - review Release Map")
        self._append_activity(
            f"Release Map ready: {len(self._decision_snapshot)} release(s), "
            f"{counts['SKIP'] + counts['REMOVE']} marked duplicate"
        )

        summary_parts = [
            f"Retained recycle releases: {recycle_kept}",
            f"Recycle releases marked duplicate: {counts['SKIP']}",
        ]
        if existing is not None:
            summary_parts.append(f"Existing releases marked duplicate: {counts['REMOVE']}")
        if initial_intra_duplicates:
            summary_parts.append(f"Duplicate files inside retained releases: {len(initial_intra_duplicates)}")
        if comparison_log:
            summary_parts.append("Detailed comparison logging is enabled for this run.")

        self._live_decision_context = {
            "existing": existing,
            "recycle": recycle,
            "releases": releases,
            "tracks": tracks,
            "groups": groups,
            "selected": set(selected),
            "reviews": list(reviews),
            "decisions": list(decisions),
            "blocked_release_ids": set(blocked_release_ids),
            "snapshots": list(self._decision_snapshot),
            "summary_text": " | ".join(summary_parts),
        }
        self.open_decision_map()

    def apply_worker(
        self,
        existing: Optional[Path],
        recycle: Path,
        releases: List[Release],
        decisions: List[ReleaseDecision],
        intra_duplicates: List[IntraReleaseDuplicate],
    ):
        try:
            result = apply_automatic_plan(
                existing,
                recycle,
                releases,
                decisions,
                intra_duplicates,
                self.update_progress,
            )
            self.after(0, lambda: self.applied(recycle, result))
        except Exception as exc:
            error = str(exc)
            self.after(0, lambda error=error: self.failed(error))

    def applied(self, recycle: Path, result: Dict[str, object]):
        self._set_running(False)
        self._live_decision_context = None
        self.run_btn.configure(state="normal")
        self.progress_var.set(100)
        self.progress_detail_var.set("100%")
        self.status_var.set("Complete")
        self._append_activity("Moves complete")
        DoneWindow(self, recycle, result, self.open_decision_map)

    def failed(self, error: str):
        self._set_running(False)
        self.run_btn.configure(state="normal")
        self.status_var.set("Failed")
        self._append_activity(f"Failed: {error}")
        messagebox.showerror(APP_NAME, error, parent=self)


def _startup_crash_log_path() -> Path:
    _migrate_legacy_app_data()
    return _logs_dir() / "Duplicate Edition Analyzer - Crash.log"


def _report_startup_crash(exc: BaseException) -> None:
    details = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    path = _startup_crash_log_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            f"{APP_NAME} {APP_VERSION}\n"
            f"Startup failed: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
            f"{details}",
            encoding="utf-8",
        )
    except Exception:
        pass

    try:
        error_root = tk.Tk()
        error_root.withdraw()
        messagebox.showerror(
            APP_NAME,
            "Startup failed.\n\n"
            f"{type(exc).__name__}: {exc}\n\n"
            f"Crash log:\n{path}",
            parent=error_root,
        )
        error_root.destroy()
    except Exception:
        pass


def main():
    try:
        app = App()
        # Make sure a newly created root is visible and brought forward even when
        # Windows restores focus/state oddly for a .pyw launch.
        app.after(100, app.deiconify)
        app.after(150, app.lift)
        app.mainloop()
    except BaseException as exc:
        _report_startup_crash(exc)


if __name__ == "__main__":
    try:
        import multiprocessing
        multiprocessing.freeze_support()
    except Exception:
        pass
    main()