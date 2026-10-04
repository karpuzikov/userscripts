# Duplicate / Edition Analyzer
# Automatic discography optimizer: performs track-by-track comparison, reports actions, never deletes files.

from __future__ import annotations

import hashlib
import importlib
import itertools
import json
import math
import os
import pickle
import re
import shutil
import struct
import statistics
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
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, ThreadPoolExecutor, as_completed, wait
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

APP_NAME = "Duplicate / Edition Analyzer"
APP_VERSION = "0.22.0"
PROGRAM_DATA_DIR_NAME = "Duplicate Edition Analyzer"
PYSIDE6_VERSION = "6.11.2"
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
FFMPEG_DIRECT_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
CUETOOLS_PACKAGE_ID = "gchudov.CUETools"

GITHUB_REPOSITORY = "karpuzikov/userscripts"
SELF_UPDATE_TAG_PREFIX = "duplicate-edition-analyzer-v"
SELF_UPDATE_API = f"https://api.github.com/repos/{GITHUB_REPOSITORY}/releases?per_page=30"
SELF_UPDATE_CHECK_TIMEOUT = 1.5
SELF_UPDATE_DOWNLOAD_TIMEOUT = 120
STANDALONE_BUNDLE_REVISION = 7

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


def _is_frozen_build() -> bool:
    return bool(getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"))


def _bundle_root() -> Path:
    if _is_frozen_build():
        return Path(getattr(sys, "_MEIPASS"))
    return Path(__file__).resolve().parent


def _bundled_path(*parts: str) -> Path:
    return _bundle_root().joinpath("bundled", *parts)


def _version_key(value: str) -> Tuple[int, ...]:
    nums = [int(part) for part in re.findall(r"\d+", str(value or ""))]
    return tuple(nums or [0])


def _github_json(url: str, timeout: float):
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": f"Duplicate-Edition-Analyzer/{APP_VERSION}",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _download_file(url: str, destination: Path, timeout: float) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": f"Duplicate-Edition-Analyzer/{APP_VERSION}"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response, destination.open("wb") as handle:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().lower()


def _find_self_update() -> Optional[Dict[str, str]]:
    """Return the newest standalone DEA release newer than this build."""
    if not _is_frozen_build() or os.name != "nt":
        return None
    try:
        releases = _github_json(SELF_UPDATE_API, SELF_UPDATE_CHECK_TIMEOUT)
    except Exception:
        return None
    if not isinstance(releases, list):
        return None

    current = _version_key(APP_VERSION)
    candidates: List[Tuple[Tuple[int, ...], Dict[str, str]]] = []
    for release in releases:
        if not isinstance(release, dict) or release.get("draft"):
            continue
        tag = str(release.get("tag_name", "") or "")
        if not tag.startswith(SELF_UPDATE_TAG_PREFIX):
            continue
        version = tag[len(SELF_UPDATE_TAG_PREFIX):].lstrip("v")
        if _version_key(version) <= current:
            continue

        exe_name = f"Duplicate Edition Analyzer {version}.exe"
        sha_name = exe_name + ".sha256"
        github_exe_name = exe_name.replace(" ", ".")
        github_sha_name = sha_name.replace(" ", ".")
        assets = {
            str(asset.get("name", "")): str(asset.get("browser_download_url", ""))
            for asset in (release.get("assets") or [])
            if isinstance(asset, dict)
        }
        exe_url = assets.get(exe_name, "") or assets.get(github_exe_name, "")
        sha_url = assets.get(sha_name, "") or assets.get(github_sha_name, "")
        if not exe_url or not sha_url:
            continue
        candidates.append(
            (
                _version_key(version),
                {
                    "version": version,
                    "exe_name": exe_name,
                    "exe_url": exe_url,
                    "sha_url": sha_url,
                    "release_url": str(release.get("html_url", "") or ""),
                },
            )
        )

    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def _schedule_self_update(update: Dict[str, str]) -> bool:
    """Download, verify, and replace this EXE after the current process exits."""
    if not _is_frozen_build() or os.name != "nt":
        return False

    current_exe = Path(sys.executable).resolve()
    target_exe = current_exe.with_name(str(update["exe_name"]))
    update_root = _temp_dir() / "self-update"
    update_root.mkdir(parents=True, exist_ok=True)
    staged_exe = update_root / (str(update["exe_name"]) + ".download")
    staged_sha = update_root / (str(update["exe_name"]) + ".sha256")

    try:
        _download_file(str(update["sha_url"]), staged_sha, SELF_UPDATE_DOWNLOAD_TIMEOUT)
        _download_file(str(update["exe_url"]), staged_exe, SELF_UPDATE_DOWNLOAD_TIMEOUT)
        expected = staged_sha.read_text(encoding="utf-8", errors="replace").strip().split()[0].lower()
        if not re.fullmatch(r"[0-9a-f]{64}", expected):
            return False
        if _sha256_file(staged_exe) != expected:
            return False
    except Exception:
        return False

    script = update_root / "install-update.cmd"
    script.write_text(
        "@echo off\r\n"
        "setlocal\r\n"
        f"set \"OLD={current_exe}\"\r\n"
        f"set \"NEW={staged_exe}\"\r\n"
        f"set \"TARGET={target_exe}\"\r\n"
        f"set \"PID={os.getpid()}\"\r\n"
        ":wait\r\n"
        "tasklist /FI \"PID eq %PID%\" 2>NUL | find \"%PID%\" >NUL\r\n"
        "if not errorlevel 1 (\r\n"
        "  timeout /t 1 /nobreak >NUL\r\n"
        "  goto wait\r\n"
        ")\r\n"
        "if exist \"%TARGET%\" del /F /Q \"%TARGET%\" >NUL 2>&1\r\n"
        "move /Y \"%NEW%\" \"%TARGET%\" >NUL\r\n"
        "if errorlevel 1 exit /b 1\r\n"
        "if /I not \"%OLD%\"==\"%TARGET%\" del /F /Q \"%OLD%\" >NUL 2>&1\r\n"
        "start \"\" \"%TARGET%\"\r\n"
        "del /F /Q \"%~f0\" >NUL 2>&1\r\n"
        "endlocal\r\n",
        encoding="utf-8",
    )

    try:
        flags = (
            getattr(subprocess, "CREATE_NO_WINDOW", 0)
            | getattr(subprocess, "DETACHED_PROCESS", 0)
            | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        )
        subprocess.Popen(
            ["cmd.exe", "/c", str(script)],
            creationflags=flags,
            close_fds=True,
        )
        return True
    except Exception:
        return False


def _startup_self_update() -> bool:
    """Fast metadata check; only an available update makes startup do more work."""
    update = _find_self_update()
    if not update:
        return False
    return _schedule_self_update(update)


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


def _json_ui_default(value):
    """Safe JSON fallback for values crossing the Qt WebEngine bridge."""
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, set):
        try:
            return sorted(value)
        except Exception:
            return list(value)
    raise TypeError(
        f"Object of type {type(value).__name__} is not JSON serializable"
    )


def _json_ui_dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=_json_ui_default)


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
# mastering/pressing. Identity is based on Chromaprint evidence only; tagged/file
# duration and identifiers such as ISRC are not identity authority.
FP_MASTERING_SCORE = 7.5
FP_MASTERING_GOOD_FRACTION = 0.80
FP_MASTERING_MEDIAN_MAX = 7.0
FP_MASTERING_P90_MAX = 14
FP_MASTERING_MIN_OVERLAP = 0.92

FP_SILENCE_MIN_FRAMES = 120

# Candidate prefilter is fingerprint-first. Weak fingerprint-token overlap is
# still tested without requiring similar duration. Same-base-title tracks are
# also fully compared acoustically regardless of reported duration.
FP_CANDIDATE_STRONG_SHARED_TOKENS = 64
FP_CANDIDATE_WEAK_SHARED_TOKENS = 24

# v0.21.0: small bounded batches prevent ProcessPoolExecutor.map() from hiding
# progress behind giant chunks. The queue stays deep enough to keep all workers busy.
COMPARE_BATCH_SIZE = 32
COMPARE_PENDING_BATCHES_PER_WORKER = 3

# Dynamic-range/mastering comparison is a quality tie-break only. It never
# creates duplicate identity; recording identity remains fingerprint authority.
CD_RIP_LOG_ACCEPTABLE_MIN = 80

DYNAMIC_RANGE_CACHE_VERSION = 1
DYNAMIC_RANGE_EPSILON = 1e-6
DYNAMIC_RANGE_MIN_COVERAGE = 0.80
DYNAMIC_RANGE_WORKERS = 4

MANUAL_REVIEW_SCORE_MAX = 9.0
MANUAL_REVIEW_GOOD_MIN = 0.72
MANUAL_REVIEW_OVERLAP_MIN = 0.85
MANUAL_REVIEW_MEDIAN_MAX = 8.0
MANUAL_REVIEW_P90_MAX = 16


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
CHILLOUT_MIX_RE = re.compile(r"\bchillout\s+mix(?:es)?\b", re.I)
TEMPO_EFFECT_REMIX_RE = re.compile(
    r"\b(?:sped\s*up|speed\s*up|slowed(?:\s*down)?|reverb(?:ed)?|redux)\b",
    re.I,
)

# A mix credited/named after a person, DJ, producer, or act is a remix.
# Ordinary functional/style mix labels remain non-remix unless another rule says otherwise.
STANDARD_NON_REMIX_MIX_RE = re.compile(
    r"^(?:"
    r"original|extended|vip|v\.i\.p|radio|album|single|main|vocal|instrumental|studio|full|"
    r"ambient|downtempo|garage|house|trance|dance|full continuous|"
    r"7|12|7 dance|12 dance"
    r")\s+mix(?:\s*#?\d+)?$",
    re.I,
)
GENERIC_MIX_WORDS = {
    "original", "extended", "vip", "radio", "album", "single", "main", "vocal",
    "instrumental", "studio", "full", "ambient", "downtempo",
    "garage", "house", "trance", "dance", "continuous", "mix", "new", "big",
    "smooth", "roll", "evolution",
}


def _mix_descriptor_candidates(text: str, allow_bare: bool = True) -> List[str]:
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

    # Also catch a bare descriptor only when explicitly allowed. Full track titles
    # such as "Club Rocker (Play & Win Mix)" must not become phrase candidates.
    if allow_bare and re.fullmatch(r".+\bmix(?:\s*#?\d+)?", source, re.I):
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
        or CHILLOUT_MIX_RE.search(normalized)
        or TEMPO_EFFECT_REMIX_RE.search(normalized)
    ):
        return True
    return any(_is_named_person_mix_descriptor(part) for part in _mix_descriptor_candidates(normalized))


def is_live_text(text: str) -> bool:
    return bool(LIVE_TRACK_RE.search(ascii_punctuation(text or "")))


REMIX_CHILD_EDIT_RE = re.compile(
    r"^(?P<credit>.+?)\s+(?:radio\s+(?:edit|version)|extended\s+(?:mix|version|edit)|"
    r"single\s+(?:edit|version)|club\s+(?:edit|version))$",
    re.I,
)


def _descriptor_parts(text: str) -> List[str]:
    source = normalize_space(ascii_punctuation(text or ""))
    return [
        normalize_space(part)
        for part in re.findall(r"[\(\[]([^\)\]]+)[\)\]]", source)
        if normalize_space(part)
    ]


def _remix_credit_key_from_explicit_descriptor(text: str) -> str:
    value = normalize_space(ascii_punctuation(text or "")).strip("()[] ")
    match = re.match(r"^(.*?)\s+(?:remix(?:ed)?|rmx|dub)\b", value, re.I)
    if match:
        return re.sub(r"[^a-z0-9]+", "", normalize_title(match.group(1)))
    if _is_named_person_mix_descriptor(value):
        prefix = re.sub(r"\s+mix(?:\s*#?\d+)?(?:\s+by\s+.+)?\s*$", "", value, flags=re.I)
        return re.sub(r"[^a-z0-9]+", "", normalize_title(prefix))
    return ""


def _remix_credit_key_from_child_edit(text: str) -> str:
    value = normalize_space(ascii_punctuation(text or "")).strip("()[] ")
    match = REMIX_CHILD_EDIT_RE.fullmatch(value)
    if not match:
        return ""
    return re.sub(r"[^a-z0-9]+", "", normalize_title(match.group("credit")))


def _contextual_remix_track_ids(releases: List["Release"]) -> Set[int]:
    """Infer edit-of-remix children only from explicit sibling evidence.

    Example: on a remix release containing both "Sebastien Remix" and
    "Sebastien Radio Edit", the radio edit inherits the Remix family.
    """
    result: Set[int] = set()
    for release in releases:
        release_text = f"{release.title} {release.path.name}"
        if not REMIX_RELEASE_RE.search(ascii_punctuation(release_text)):
            continue

        explicit_by_base: Dict[str, Set[str]] = defaultdict(set)
        for track in release.tracks:
            base_key = _base_title_identity(track.display_title)
            if not base_key:
                continue
            for part in _descriptor_parts(track.display_title):
                key = _remix_credit_key_from_explicit_descriptor(part)
                if key:
                    explicit_by_base[base_key].add(key)

        for track in release.tracks:
            base_key = _base_title_identity(track.display_title)
            if not base_key or not explicit_by_base.get(base_key):
                continue
            for part in _descriptor_parts(track.display_title):
                key = _remix_credit_key_from_child_edit(part)
                if key and key in explicit_by_base[base_key]:
                    result.add(id(track))
                    break
    return result


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


def _has_explicit_feature_credit(text: str) -> bool:
    """Detect an explicit featured-artist credit, never a remixer credit."""
    source = normalize_space(ascii_punctuation(text or ""))
    return bool(
        re.search(
            r"(?:^|[\s\(\[\{,;:/-])(?:feat(?:uring)?|ft)\.?\s+[^\]\)\}\n]+",
            source,
            re.I,
        )
    )


def _track_has_featured_artist_credit(track: "Track") -> bool:
    """True only for explicit feat./ft./featuring credits.

    Check title, filename text and the ARTIST tag because different sources put
    the featured performer in different fields. Plain multi-artist credits and
    remixer names are intentionally not enough.
    """
    return any(
        _has_explicit_feature_credit(value)
        for value in (
            track.display_title,
            strip_track_number(track.path.stem),
            track.artist,
        )
        if value
    )


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


def _definitive_acoustic_identity(
    sim: Optional[Tuple[float, float, float, int, float, float, int]]
) -> bool:
    """True only for effectively carbon-copy Chromaprint evidence.

    This deliberately ignores ISRC, MusicBrainz IDs and duration.
    """
    if not sim:
        return False
    score, good, overlap, _shift, excellent, median, p90 = sim
    return bool(
        overlap >= 0.995
        and score <= 0.25
        and good >= 0.995
        and excellent >= 0.995
        and median <= 0.5
        and p90 <= 1
    )


def _semantic_version_conflict(a: Track, b: Track) -> bool:
    """Different stated version families are unique and never auto-merged."""
    va = _descriptor_family_set(_semantic_version_descriptors(a.display_title))
    vb = _descriptor_family_set(_semantic_version_descriptors(b.display_title))
    if not va and not vb:
        return False
    return va != vb


def _manual_review_audio_candidate(
    sim: Optional[Tuple[float, float, float, int, float, float, int]]
) -> bool:
    """Narrow near-match window for rare human review."""
    if not sim:
        return False
    score, good, overlap, _shift, _excellent, median, p90 = sim
    return bool(
        overlap >= MANUAL_REVIEW_OVERLAP_MIN
        and score <= MANUAL_REVIEW_SCORE_MAX
        and good >= MANUAL_REVIEW_GOOD_MIN
        and median <= MANUAL_REVIEW_MEDIAN_MAX
        and p90 <= MANUAL_REVIEW_P90_MAX
    )


def _review_pair_payload(
    a: int,
    b: int,
    tracks: List[Track],
    reason: str,
    sim: Optional[Tuple[float, float, float, int, float, float, int]],
) -> Dict[str, object]:
    first = tracks[a]
    second = tracks[b]
    row: Dict[str, object] = {
        "key": f"{min(a,b)}:{max(a,b)}",
        "track_a_index": a,
        "track_b_index": b,
        "reason": reason,
        "title_a": first.display_title,
        "title_b": second.display_title,
        "artist_a": first.artist,
        "artist_b": second.artist,
        "path_a": str(first.path),
        "path_b": str(second.path),
        "release_id_a": first.release_id,
        "release_id_b": second.release_id,
    }
    if sim:
        score, good, overlap, shift, excellent, median, p90 = sim
        row.update({
            "score": round(score, 4),
            "good": round(good, 4),
            "overlap": round(overlap, 4),
            "shift": int(shift),
            "excellent": round(excellent, 4),
            "median": round(median, 4),
            "p90": int(p90),
        })
    return row


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


def _is_unusual_live_remix_phrase(text: str) -> bool:
    """Return only exception phrases worth asking the user about.

    Ordinary "Artist Remix", "Artist Mix", Hybrid Mix, Dub, Redux, Sped Up,
    Slowed, etc. are already confidently handled by the normal classifiers and
    must not flood the Personal Picks review.
    """
    value = normalize_space(ascii_punctuation(text or "")).strip("()[] ")
    if not value:
        return False

    # Live venue/session wording can carry a reusable human preservation choice.
    if is_live_text(value):
        ordinary_live = re.fullmatch(
            r"(?:live|live version|live mix|unplugged|session|sessions)",
            value,
            re.I,
        )
        return ordinary_live is None

    # All conventional remix/mix/dub and tempo/effect descriptors are handled
    # automatically and are therefore not unusual review material.
    if re.search(r"\b(?:remix(?:es|ed)?|rmx|mix(?:es)?|dub|redux)\b", value, re.I):
        return False
    if TEMPO_EFFECT_REMIX_RE.search(value):
        return False
    return False


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
            raw_parts.extend(_mix_descriptor_candidates(source, allow_bare=False))

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

        # The review is shown only for enabled remix analysis and only surfaces
        # unusual phrase families; it no longer resurrects globally disabled audio.
        if track_is_remix and not track_is_live and not include_remixes:
            continue
        if track_is_live and not track_is_remix and not include_live:
            continue
        if track_is_remix and track_is_live and not (include_remixes or include_live):
            continue

        raw_parts = [normalize_space(x) for x in re.findall(r"[\(\[]([^\)\]]+)[\)\]]", source)]
        raw_parts.extend(_mix_descriptor_candidates(source, allow_bare=False))

        for pattern in (
            r"\bLive\s+(?:From|At)\s+.+$",
            r"\b[^()\[\]]{0,80}\b(?:Session|Sessions|Unplugged)\b[^()\[\]]*$",
            r"(?:\s+-\s+)([^-]+\b(?:Remix|Rmx|Redux|Dub|Sped\s*Up|Speed\s*Up|Slowed(?:\s*Down)?|Reverb(?:ed)?)\b.*)$",
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
            if not _is_unusual_live_remix_phrase(family):
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
    """Classify wanted audio before every expensive analysis stage.

    Unchecked Remix/Live categories are hard early eliminations. The ONLY
    Save-Remixes exception is a remix carrying an explicit featured-artist
    credit. Personal Picks may still be recorded for UI/history purposes, but
    they do not resurrect audio eliminated by the global Remix/Live switches.
    """
    tracks = [track for rel in releases for track in rel.tracks]
    rules = list(personal_keep_rules or [])
    contextual_remix_ids = _contextual_remix_track_ids(releases)

    for track in tracks:
        classification_text = f"{track.display_title} {strip_track_number(track.path.stem)}"
        track.is_remix = bool(
            is_remix_text(classification_text)
            or id(track) in contextual_remix_ids
        )
        track.is_live = is_live_text(classification_text)
        track.remix_feature_exception = bool(
            track.is_remix and _track_has_featured_artist_credit(track)
        )
        track.personal_keep_rule = ""
        track.excluded_by_pattern = ""
        track.group_id = -1

        remix_eliminated = bool(
            exclude_remixes
            and track.is_remix
            and not track.remix_feature_exception
        )
        live_eliminated = bool(exclude_live and track.is_live)

        # A featured remix remains wanted when Save Remixes is OFF, but a track
        # that is ALSO Live still obeys Save Live independently.
        track.exclude_from_coverage = remix_eliminated or live_eliminated

        if rules:
            matched_rule = _personal_pick_match(track, rules)
            if matched_rule:
                track.personal_keep_rule = matched_rule

        # Robustness for reused prepared state: an early-eliminated track must
        # carry no old acoustic/mastering state into later stages.
        if track.exclude_from_coverage:
            track.fingerprint = tuple()
            track.fingerprint_duration = 0.0
            track.group_id = -1
            track.dynamic_lufs = None
            track.dynamic_lra = None
            track.dynamic_true_peak_dbfs = None
            track.dynamic_rms_dbfs = None
            track.dynamic_crest_db = None
            track.dynamic_score = None


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


def _find_ffmpeg_pair_under(root: Path) -> Optional[Tuple[str, str]]:
    """Find ffmpeg.exe + ffprobe.exe under one dependency/package tree."""
    if not root.exists():
        return None

    direct_candidates = [
        root,
        root / "bin",
    ]
    for folder in direct_candidates:
        ffmpeg = folder / "ffmpeg.exe"
        ffprobe = folder / "ffprobe.exe"
        if ffmpeg.is_file() and ffprobe.is_file():
            return str(ffmpeg), str(ffprobe)

    try:
        for ffmpeg in root.rglob("ffmpeg.exe"):
            ffprobe = ffmpeg.with_name("ffprobe.exe")
            if ffprobe.is_file():
                return str(ffmpeg), str(ffprobe)
    except OSError:
        pass
    return None


def _locate_ffmpeg_pair() -> Optional[Tuple[str, str]]:
    """Locate FFmpeg from the standalone bundle, app data, or system installs."""
    bundled = _find_ffmpeg_pair_under(_bundled_path("ffmpeg"))
    if bundled:
        return bundled

    ffmpeg = locate_executable("ffmpeg")
    ffprobe = locate_executable("ffprobe")
    if ffmpeg and ffprobe:
        return ffmpeg, ffprobe

    # App-owned dependency is deterministic and survives PATH/WinGet-link issues.
    local_pair = _find_ffmpeg_pair_under(_dependencies_dir() / "FFmpeg")
    if local_pair:
        return local_pair

    # WinGet packages do not always create Links visible to the already-running
    # process. Search the package store directly before declaring installation
    # failure.
    local_app = os.environ.get("LOCALAPPDATA")
    if local_app:
        packages = Path(local_app) / "Microsoft" / "WinGet" / "Packages"
        if packages.exists():
            try:
                for package_dir in packages.iterdir():
                    name = package_dir.name.casefold()
                    if "ffmpeg" not in name:
                        continue
                    pair = _find_ffmpeg_pair_under(package_dir)
                    if pair:
                        return pair
            except OSError:
                pass

    # A few common machine-wide/manual locations are cheap to check.
    for env_name in ("ProgramFiles", "ProgramFiles(x86)"):
        base = os.environ.get(env_name)
        if not base:
            continue
        for folder_name in ("FFmpeg", "ffmpeg"):
            pair = _find_ffmpeg_pair_under(Path(base) / folder_name)
            if pair:
                return pair

    return None


def _install_ffmpeg_app_local() -> Tuple[str, str]:
    """Install FFmpeg inside the analyzer's isolated dependencies directory."""
    if os.name != "nt":
        raise RuntimeError("Automatic app-local FFmpeg installation is supported on Windows only.")

    target = _dependencies_dir() / "FFmpeg"
    target.mkdir(parents=True, exist_ok=True)
    _temp_dir().mkdir(parents=True, exist_ok=True)
    archive_path = _temp_dir() / "ffmpeg-release-essentials.zip"

    # Clean only our own incomplete dependency directory before extracting a
    # fresh copy. Never touch a system/WinGet installation.
    try:
        for child in list(target.iterdir()):
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                try:
                    child.unlink()
                except OSError:
                    pass
    except OSError:
        pass

    try:
        urllib.request.urlretrieve(FFMPEG_DIRECT_URL, archive_path)
        with zipfile.ZipFile(archive_path, "r") as archive:
            archive.extractall(target)
    except Exception as exc:
        raise RuntimeError(f"Direct FFmpeg download/extraction failed: {exc}") from exc
    finally:
        try:
            archive_path.unlink(missing_ok=True)
        except Exception:
            pass

    pair = _find_ffmpeg_pair_under(target)
    if not pair:
        raise RuntimeError(
            "FFmpeg archive was downloaded, but ffmpeg.exe/ffprobe.exe were not found after extraction."
        )
    return pair

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
    """Ensure FFmpeg/FFprobe are usable; standalone builds never install at runtime."""
    pair = _locate_ffmpeg_pair()
    if _is_frozen_build():
        if pair:
            return pair
        raise RuntimeError("Bundled FFmpeg/FFprobe are missing from this standalone build.")

    # Source/development mode retains the automatic dependency fallback.
    bootstrap_winget()
    installed = pair is not None

    winget_error = ""
    try:
        _winget_install_or_update(FFMPEG_PACKAGE_ID, installed=installed)
    except Exception as exc:
        winget_error = str(exc)

    # Re-scan PATH, WinGet package storage and app-local dependencies. This is
    # important because a successful WinGet install may not update the current
    # process environment or create a WinGet Links shim.
    pair = _locate_ffmpeg_pair()
    if pair:
        return pair

    # WinGet is preferred, but it is not allowed to be a single point of
    # failure. Fall back to the official Gyan Windows essentials build and keep
    # it isolated inside this program's own dependencies directory.
    try:
        return _install_ffmpeg_app_local()
    except Exception as direct_exc:
        details = []
        if winget_error:
            details.append(f"WinGet: {winget_error}")
        details.append(str(direct_exc))
        raise RuntimeError(
            "FFmpeg/FFprobe are required and automatic setup failed. "
            + " | ".join(details)
        ) from direct_exc


def locate_cuetools_arcue() -> Optional[str]:
    """Find CUETools' console AccurateRip/CTDB verifier."""
    bundled_root = _bundled_path("cuetools")
    if bundled_root.is_dir():
        try:
            bundled = next(bundled_root.rglob("CUETools.ARCUE.exe"), None)
            if bundled:
                return str(bundled)
        except OSError:
            pass

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
    """Use bundled CUETools in standalone mode; source mode may use WinGet."""
    arc = locate_cuetools_arcue()
    if _is_frozen_build():
        return arc
    bootstrap_winget()
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
    except Exception as exc:
        if _is_frozen_build():
            raise RuntimeError(
                "Bundled hey-bro-check-log is missing or failed to load: " + str(exc)
            ) from exc

    # Source/development mode keeps the dependency isolated from normal Python.
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
    dynamic_lufs: Optional[float] = None
    dynamic_lra: Optional[float] = None
    dynamic_true_peak_dbfs: Optional[float] = None
    dynamic_rms_dbfs: Optional[float] = None
    dynamic_crest_db: Optional[float] = None
    dynamic_score: Optional[float] = None
    virtual_from_cue: bool = False
    cue_path: Optional[Path] = None
    cue_track_number: int = 0
    cue_start_seconds: float = 0.0
    cue_end_seconds: float = 0.0
    cue_title: str = ""
    cue_performer: str = ""
    cue_album: str = ""

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
    def counted_track_count(self) -> int:
        """Tracks that actually participate in recording-group coverage."""
        return sum(
            1
            for t in self.tracks
            if not t.exclude_from_coverage and t.group_id >= 0
        )

    @property
    def retained_audio_file_count(self) -> int:
        """Physical audio files retained when this whole release folder is kept."""
        return len({os.path.normcase(str(t.path)) for t in self.tracks})

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
        if track.cue_track_number:
            track.tags["TRACKNUMBER"] = str(track.cue_track_number)
    else:
        track.duration = full_duration
        track.title = tag_lookup(track.tags, "title") or strip_track_number(track.path.stem)
        track.artist = tag_lookup(track.tags, "artist")
        track.album = tag_lookup(track.tags, "album")

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
    bundled = _bundled_path("chromaprint", "fpcalc.exe")
    if bundled.is_file():
        return str(bundled)

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
    bundled = _bundled_path("chromaprint", "fpcalc.exe")
    if bundled.is_file():
        return str(bundled)
    if _is_frozen_build():
        raise RuntimeError("Bundled Chromaprint/fpcalc is missing from this standalone build.")

    # Source/development mode can still bootstrap the dependency.
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
        pair = _locate_ffmpeg_pair()
        if pair:
            ffmpeg, _ffprobe = pair
        else:
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
    # duration1/duration2 are intentionally not used for identity. They remain
    # in the signature only for compatibility with existing callers/logging.
    _ = (duration1, duration2)
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

    mastering_match = (
        overlap >= FP_MASTERING_MIN_OVERLAP
        and score <= FP_MASTERING_SCORE
        and good >= FP_MASTERING_GOOD_FRACTION
        and median <= FP_MASTERING_MEDIAN_MAX
        and p90 <= FP_MASTERING_P90_MAX
    )

    if not strict_match and not mastering_match:
        return False, sim

    # Distinguish a carbon copy from a radio/extended/edit relationship using
    # fingerprint content itself, not reported duration. If less than 94% of
    # the longer fingerprint is aligned, any unmatched acoustic content must
    # be silence for the files to remain the same recording.
    a0 = max(shift, 0)
    b0 = max(-shift, 0)
    aligned_frames = max(0, min(len(fp1) - a0, len(fp2) - b0))
    acoustic_coverage = aligned_frames / max(1, len(fp1), len(fp2))
    if acoustic_coverage < 0.94 and not _unmatched_fingerprint_is_silence(fp1, fp2, shift):
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


def _compare_pair_batch_worker(batch: List[Tuple[int, int, int]]):
    """Compare a small batch and return it as soon as the batch finishes."""
    result = []
    for pair_index, a, b in batch:
        fp1, d1 = _COMPARE_TRACK_DATA[a]
        fp2, d2 = _COMPARE_TRACK_DATA[b]
        matched, sim = fingerprint_auto_match_values(fp1, d1, fp2, d2)
        result.append((pair_index, a, b, matched, sim))
    return result

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
    """Explain every acoustic threshold involved in one fingerprint decision."""
    # Durations are logged for diagnostics only and are not part of the decision.
    duration_delta = abs(duration1 - duration2)
    details: Dict[str, object] = {
        "worker_matched": bool(matched),
        "duration_delta_seconds_diagnostic_only": round(duration_delta, 6),
    }
    if not sim:
        details.update({
            "similarity_available": False,
            "accepted_by": [],
            "strict_pass": False,
            "mastering_pass": False,
            "content_gate_triggered": False,
            "content_gate_pass": False,
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
    mastering_checks = {
        "overlap": overlap >= FP_MASTERING_MIN_OVERLAP,
        "score": score <= FP_MASTERING_SCORE,
        "good_fraction": good >= FP_MASTERING_GOOD_FRACTION,
        "median": median <= FP_MASTERING_MEDIAN_MAX,
        "p90": p90 <= FP_MASTERING_P90_MAX,
    }
    strict_pass = all(strict_checks.values())
    mastering_pass = all(mastering_checks.values())
    preliminary_pass = strict_pass or mastering_pass

    a0 = max(shift, 0)
    b0 = max(-shift, 0)
    aligned_frames = max(0, min(len(fp1) - a0, len(fp2) - b0))
    acoustic_coverage = aligned_frames / max(1, len(fp1), len(fp2))
    content_gate_triggered = bool(preliminary_pass and acoustic_coverage < 0.94)
    unmatched_is_silence: Optional[bool] = None
    content_gate_pass = True
    if content_gate_triggered:
        unmatched_is_silence = _unmatched_fingerprint_is_silence(fp1, fp2, shift)
        content_gate_pass = bool(unmatched_is_silence)

    rejection_reasons: List[str] = []
    if not preliminary_pass:
        strict_failed = [name for name, passed in strict_checks.items() if not passed]
        mastering_failed = [name for name, passed in mastering_checks.items() if not passed]
        rejection_reasons.append("strict failed: " + ", ".join(strict_failed))
        rejection_reasons.append("mastering failed: " + ", ".join(mastering_failed))
    elif not content_gate_pass:
        rejection_reasons.append("acoustic content gate failed: unmatched fingerprint content is not silence")

    accepted_by: List[str] = []
    if strict_pass:
        accepted_by.append("strict")
    if mastering_pass:
        accepted_by.append("mastering")

    derived_final_match = bool(preliminary_pass and content_gate_pass)
    details.update({
        "similarity_available": True,
        "score": round(score, 6),
        "good_fraction": round(good, 6),
        "excellent_fraction": round(excellent, 6),
        "overlap": round(overlap, 6),
        "acoustic_coverage": round(acoustic_coverage, 6),
        "median": round(median, 6),
        "p90": int(p90),
        "shift": int(shift),
        "strict_checks": strict_checks,
        "strict_pass": strict_pass,
        "mastering_checks": mastering_checks,
        "mastering_pass": mastering_pass,
        "accepted_by": accepted_by,
        "content_gate_triggered": content_gate_triggered,
        "unmatched_is_silence": unmatched_is_silence,
        "content_gate_pass": content_gate_pass,
        "definitive_acoustic_identity": _definitive_acoustic_identity(sim),
        "derived_final_match": derived_final_match,
        "decision_consistent": bool(matched) == derived_final_match,
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
        "identity_title": identity_title(track.display_title),
        "base_title_identity": _base_title_identity(track.display_title),
        "content_qualifiers": sorted(content_qualifiers(track.display_title)),
        "version_descriptors": sorted(_version_descriptors(track.display_title)),
        "semantic_version_descriptors": sorted(_semantic_version_descriptors(track.display_title)),
        "featured_credit_signature": sorted(_featured_credit_signature(track.display_title)),
        "artist_signature": sorted(_artist_signature(track.artist)),
        "is_remix": track.is_remix,
        "is_live": track.is_live,
        "remix_feature_exception": track.remix_feature_exception,
        "excluded_from_coverage": track.exclude_from_coverage,
        "personal_keep_rule": track.personal_keep_rule,
        "virtual_from_cue": track.virtual_from_cue,
        "cue_path": str(track.cue_path) if track.cue_path else "",
        "cue_track_number": track.cue_track_number,
        "cue_start_seconds": round(track.cue_start_seconds, 6),
        "cue_end_seconds": round(track.cue_end_seconds, 6),
        "dynamic_lufs": track.dynamic_lufs,
        "dynamic_lra": track.dynamic_lra,
        "dynamic_true_peak_dbfs": track.dynamic_true_peak_dbfs,
        "dynamic_rms_dbfs": track.dynamic_rms_dbfs,
        "dynamic_crest_db": track.dynamic_crest_db,
        "dynamic_score": track.dynamic_score,
    }


def merge_equivalent_tracks(
    tracks: List[Track],
    progress_cb=None,
    comparison_log_path: Optional[Path] = None,
) -> Tuple[Dict[int, List[int]], List[str]]:
    """Group recordings from audio fingerprints with a conservative metadata veto.

    Candidate discovery is fingerprint-first: strong/weak token overlap plus
    same-base-title acoustic comparison. ISRC and duration do not create, accept,
    reject, or merge a duplicate candidate.
    """
    uf = UnionFind(len(tracks))
    notes: List[str] = []

    # Early-eliminated Remix/Live/pattern tracks are intentionally absent from
    # every acoustic candidate route. Keep global indices so reporting and
    # Release Map references remain stable.
    analysis_indices = [
        i for i, track in enumerate(tracks)
        if not track.exclude_from_coverage
    ]
    analysis_index_set = set(analysis_indices)
    tokens: List[Set[int]] = [
        _fingerprint_tokens(track.fingerprint)
        if i in analysis_index_set
        else set()
        for i, track in enumerate(tracks)
    ]

    token_tracks: Dict[int, List[int]] = defaultdict(list)
    indexed = sum(1 for i in analysis_indices if tokens[i])
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

    # Primary fingerprint-token routes. Duration is deliberately not consulted.
    for pair, shared in pair_counts.items():
        if shared >= FP_CANDIDATE_STRONG_SHARED_TOKENS:
            candidate_reasons[pair].add("fingerprint_tokens_strong")
        elif shared >= FP_CANDIDATE_WEAK_SHARED_TOKENS:
            candidate_reasons[pair].add("fingerprint_tokens_weak")

    # Same-base-title tracks always receive the full acoustic test regardless
    # of their reported/tagged/file duration.
    title_index: Dict[str, List[int]] = defaultdict(list)
    for i, track in enumerate(tracks):
        if track.exclude_from_coverage or not track.fingerprint:
            continue
        key = _base_title_identity(track.display_title)
        if key:
            title_index[key].append(i)

    for ids in title_index.values():
        for a, b in itertools.combinations(sorted(set(ids)), 2):
            candidate_reasons[(a, b)].add("same_base_title")

    candidate_pairs = sorted(candidate_reasons)
    total_candidates = len(candidate_pairs)
    total_possible = indexed * (indexed - 1) // 2
    prefilter_rejected = max(0, total_possible - total_candidates)

    log_handle = None
    log_counts: Counter = Counter()
    processed_pair_count = 0
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
                "tracks_eligible_for_analysis": len(analysis_indices),
                "tracks_eliminated_before_comparison": len(tracks) - len(analysis_indices),
                "featured_remix_exceptions": sum(
                    1 for track in tracks
                    if track.remix_feature_exception and not track.exclude_from_coverage
                ),
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
                        "fallbacks": [
                            "same_base_title",
                        ],
                        "duration_used_for_identity": False,
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
                    },
                    "acoustic_content_gate": {
                        "aligned_fingerprint_coverage_min": 0.94,
                        "rule": "below 94% acoustic coverage, unmatched fingerprint content must be silence",
                    },
                    "manual_review_policy": [
                        "different titles with an acoustic match require review",
                        "narrow near-threshold acoustic matches require review",
                        "different semantic version families are unique and skipped before merge",
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
        nonlocal processed_pair_count
        pair = (a, b)
        processed_pair_count += 1
        if log_handle is None:
            return

        first = tracks[a]
        second = tracks[b]
        shared_tokens = int(pair_counts.get(pair, 0))
        duration_delta = abs(first.duration - second.duration)
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
                log_counts["rejected_acoustic_content_gate"] += 1
            else:
                log_counts["rejected_thresholds"] += 1

        row = {
            "record_type": "comparison",
            "pair_index": pair_index,
            "pair_total": total_candidates,
            "candidate": {
                "reasons": reasons,
                "shared_token_buckets": shared_tokens,
                "duration_delta_seconds_diagnostic_only": round(duration_delta, 6),
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

    def log_fast_skip(pair_index: int, a: int, b: int, reason: str) -> None:
        nonlocal processed_pair_count
        processed_pair_count += 1
        log_counts[reason] += 1
        if log_handle is None:
            return
        row = {
            "record_type": "comparison_skip",
            "pair_index": pair_index,
            "pair_total": total_candidates,
            "candidate": {
                "reasons": sorted(candidate_reasons.get((a, b), set())),
                "shared_token_buckets": int(pair_counts.get((a, b), 0)),
            },
            "track_a": _comparison_track_log_data(tracks[a]),
            "track_b": _comparison_track_log_data(tracks[b]),
            "decision": "ALREADY_GROUPED",
            "reason": reason,
        }
        try:
            log_handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        except Exception as exc:
            notes.append(f"Comparison log write error: {exc}")

    def handle_result(done: int, a: int, b: int, audio_matched: bool, sim) -> None:
        definitive_audio = bool(audio_matched and _definitive_acoustic_identity(sim))
        metadata_conflict = (
            _metadata_match_conflict(tracks[a], tracks[b], definitive_audio)
            if audio_matched
            else ""
        )
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
        base_label = f"Comparing audio ({workers} workers)"
        if progress_cb:
            progress_cb(base_label + "...", 0, total_candidates)

        track_data = [(t.fingerprint, t.duration) for t in tracks]
        completed = bytearray(total_candidates)
        done_count = 0
        compare_started = time.monotonic()
        batch_size = COMPARE_BATCH_SIZE
        max_pending = max(1, workers * COMPARE_PENDING_BATCHES_PER_WORKER)

        def report_compare_progress(force: bool = False) -> None:
            if not progress_cb:
                return
            elapsed = max(0.001, time.monotonic() - compare_started)
            rate = done_count / elapsed
            remaining = max(0, total_candidates - done_count)
            if rate > 0:
                eta_seconds = int(remaining / rate)
                hours, rem = divmod(eta_seconds, 3600)
                minutes, seconds = divmod(rem, 60)
                eta = f"{hours:d}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes:02d}:{seconds:02d}"
                label = f"{base_label} | {rate:,.0f}/s | ETA {eta}"
            else:
                label = base_label
            if force or done_count == total_candidates or done_count % max(25, batch_size) == 0:
                progress_cb(label, done_count, total_candidates)

        pair_iter = iter(enumerate(candidate_pairs, 1))

        def next_compare_batch() -> List[Tuple[int, int, int]]:
            nonlocal done_count
            batch: List[Tuple[int, int, int]] = []
            while len(batch) < batch_size:
                try:
                    pair_index, (a, b) = next(pair_iter)
                except StopIteration:
                    break

                # Exact transitive skip: once both tracks are already in the same
                # validated acoustic component, another full similarity test
                # cannot change the final grouping.
                if uf.find(a) == uf.find(b):
                    completed[pair_index - 1] = 1
                    done_count += 1
                    log_fast_skip(pair_index, a, b, "skipped_transitive")
                    if done_count % 256 == 0:
                        report_compare_progress()
                    continue

                # Identical Chromaprint vectors are definitive acoustic identity.
                # Handle these in-process without running the expensive alignment.
                fp_a = tracks[a].fingerprint
                fp_b = tracks[b].fingerprint
                if fp_a and fp_a == fp_b:
                    sim = (0.0, 1.0, 1.0, 0, 1.0, 0.0, 0)
                    handle_result(pair_index, a, b, True, sim)
                    completed[pair_index - 1] = 1
                    done_count += 1
                    log_counts["fast_exact_fingerprint"] += 1
                    if done_count % 256 == 0:
                        report_compare_progress()
                    continue

                batch.append((pair_index, a, b))
            return batch

        parallel_failed = None
        try:
            with ProcessPoolExecutor(
                max_workers=workers,
                initializer=_init_compare_worker,
                initargs=(track_data,),
            ) as ex:
                pending = {}

                while len(pending) < max_pending:
                    batch = next_compare_batch()
                    if not batch:
                        break
                    pending[ex.submit(_compare_pair_batch_worker, batch)] = batch

                while pending:
                    finished, _not_done = wait(tuple(pending), return_when=FIRST_COMPLETED)
                    for fut in finished:
                        pending.pop(fut, None)
                        for pair_index, a, b, audio_matched, sim in fut.result():
                            handle_result(pair_index, a, b, audio_matched, sim)
                            completed[pair_index - 1] = 1
                            done_count += 1
                        report_compare_progress(force=True)

                    while len(pending) < max_pending:
                        batch = next_compare_batch()
                        if not batch:
                            break
                        pending[ex.submit(_compare_pair_batch_worker, batch)] = batch

        except Exception as exc:
            parallel_failed = exc

        if parallel_failed is not None:
            notes.append(f"Parallel comparison unavailable; serial fallback: {parallel_failed}")
            base_label = "Comparing audio (serial fallback)"
            for pair_index, (a, b) in enumerate(candidate_pairs, 1):
                if completed[pair_index - 1]:
                    continue
                if uf.find(a) == uf.find(b):
                    log_fast_skip(pair_index, a, b, "skipped_transitive")
                else:
                    fp_a = tracks[a].fingerprint
                    fp_b = tracks[b].fingerprint
                    if fp_a and fp_a == fp_b:
                        sim = (0.0, 1.0, 1.0, 0, 1.0, 0.0, 0)
                        handle_result(pair_index, a, b, True, sim)
                        log_counts["fast_exact_fingerprint"] += 1
                    else:
                        audio_matched, sim = fingerprint_auto_match(tracks[a], tracks[b])
                        handle_result(pair_index, a, b, audio_matched, sim)
                completed[pair_index - 1] = 1
                done_count += 1
                if done_count % 25 == 0 or done_count == total_candidates:
                    report_compare_progress(force=True)

        report_compare_progress(force=True)
    elif progress_cb:
        progress_cb("Comparing audio...", 1, 1)

    roots: Dict[int, List[int]] = {}
    for i in analysis_indices:
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
                "comparisons_logged": processed_pair_count,
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


def _dynamic_range_cache_path() -> Path:
    return _cache_dir() / "dynamic-range-v1.json"


def _dynamic_range_cache_key(track: Track) -> str:
    try:
        st = track.path.stat()
        size = int(st.st_size)
        mtime_ns = int(st.st_mtime_ns)
    except OSError:
        size = int(track.file_size or 0)
        mtime_ns = 0
    payload = "|".join(
        [
            str(track.path.resolve()),
            str(size),
            str(mtime_ns),
            f"{float(track.cue_start_seconds):.6f}",
            f"{float(track.cue_end_seconds):.6f}",
            str(int(track.cue_track_number or 0)),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8", errors="replace")).hexdigest()


def _load_dynamic_range_cache() -> Dict[str, Dict[str, object]]:
    path = _dynamic_range_cache_path()
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            if (
                isinstance(data, dict)
                and int(data.get("version", 0) or 0) == DYNAMIC_RANGE_CACHE_VERSION
                and isinstance(data.get("entries"), dict)
            ):
                return {
                    str(k): dict(v)
                    for k, v in data["entries"].items()
                    if isinstance(v, dict)
                }
    except Exception:
        pass
    return {}


def _save_dynamic_range_cache(entries: Dict[str, Dict[str, object]]) -> None:
    # Keep the cache bounded while preserving the newest insertion order.
    if len(entries) > 200000:
        entries = dict(list(entries.items())[-200000:])
    _atomic_write_json(
        _dynamic_range_cache_path(),
        {"version": DYNAMIC_RANGE_CACHE_VERSION, "entries": entries},
    )


def _last_float(pattern: str, text: str) -> Optional[float]:
    matches = re.findall(pattern, text, re.I | re.M)
    if not matches:
        return None
    try:
        value = float(matches[-1])
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def _measure_track_dynamic_range(ffmpeg: str, track: Track) -> Dict[str, object]:
    cmd = [ffmpeg, "-hide_banner", "-nostats", "-loglevel", "info"]
    if track.virtual_from_cue and track.cue_start_seconds > 0:
        cmd += ["-ss", f"{max(0.0, track.cue_start_seconds):.6f}"]
    cmd += ["-i", str(track.path)]
    if track.virtual_from_cue and track.duration > 0:
        cmd += ["-t", f"{track.duration:.6f}"]
    cmd += [
        "-map", "0:a:0",
        "-vn",
        "-af", "ebur128=peak=true,astats=metadata=0:reset=0",
        "-f", "null",
        os.devnull,
    ]
    cp = run_hidden(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        errors="replace",
        check=False,
        timeout=900,
    )
    output = (cp.stdout or "") + "\n" + (cp.stderr or "")
    if cp.returncode != 0:
        raise RuntimeError(cp.stderr.strip() or cp.stdout.strip() or "FFmpeg dynamics analysis failed")

    lufs = _last_float(r"\bI:\s*(-?\d+(?:\.\d+)?)\s+LUFS", output)
    lra = _last_float(r"\bLRA:\s*(-?\d+(?:\.\d+)?)\s+LU", output)
    true_peak = _last_float(r"\bPeak:\s*(-?\d+(?:\.\d+)?)\s+dBFS", output)
    rms = _last_float(r"RMS level dB:\s*(-?\d+(?:\.\d+)?)", output)
    crest_ratio = _last_float(r"Crest factor:\s*(\d+(?:\.\d+)?)", output)

    crest_db = None
    if true_peak is not None and rms is not None:
        crest_db = true_peak - rms
    elif crest_ratio is not None and crest_ratio > 0:
        crest_db = 20.0 * math.log10(crest_ratio)

    score = None
    if crest_db is not None:
        score = crest_db + 0.35 * max(0.0, lra or 0.0)

    return {
        "lufs": lufs,
        "lra": lra,
        "true_peak_dbfs": true_peak,
        "rms_dbfs": rms,
        "crest_db": crest_db,
        "score": score,
    }


def _apply_dynamic_metrics(track: Track, metrics: Dict[str, object]) -> None:
    def value(name: str) -> Optional[float]:
        raw = metrics.get(name)
        try:
            number = float(raw)
            return number if math.isfinite(number) else None
        except (TypeError, ValueError):
            return None

    track.dynamic_lufs = value("lufs")
    track.dynamic_lra = value("lra")
    track.dynamic_true_peak_dbfs = value("true_peak_dbfs")
    track.dynamic_rms_dbfs = value("rms_dbfs")
    track.dynamic_crest_db = value("crest_db")
    track.dynamic_score = value("score")


def _mastering_release_signature(rel: Release):
    if rel.excluded_only:
        return None
    sequence = _included_group_sequence(rel)
    if not sequence:
        return None
    identity = (
        ("album", rel.family)
        if rel.release_type == "album" and rel.family
        else ("release", normalize_title(rel.title))
    )
    return (
        source_rank(rel),
        rel.release_type,
        identity,
        tuple(sequence),
        tuple(sorted(_included_group_counter(rel).items())),
    )


def _dynamic_candidate_tracks(releases: List[Release]) -> List[Track]:
    by_signature: Dict[object, List[Release]] = defaultdict(list)
    for rel in releases:
        signature = _mastering_release_signature(rel)
        if signature is not None:
            by_signature[signature].append(rel)

    picked: Dict[int, Track] = {}
    for rels in by_signature.values():
        if len(rels) < 2:
            continue
        for rel in rels:
            for track in rel.tracks:
                if not track.exclude_from_coverage and track.group_id >= 0:
                    picked[id(track)] = track
    return list(picked.values())


def _median_track_metric(rel: Release, attr: str) -> Optional[float]:
    values = [
        float(value)
        for track in rel.tracks
        if not track.exclude_from_coverage
        and track.group_id >= 0
        and (value := getattr(track, attr, None)) is not None
        and math.isfinite(float(value))
    ]
    return float(statistics.median(values)) if values else None


def release_dynamic_summary(rel: Release) -> Dict[str, object]:
    scores = [
        float(t.dynamic_score)
        for t in rel.tracks
        if not t.exclude_from_coverage
        and t.group_id >= 0
        and t.dynamic_score is not None
        and math.isfinite(float(t.dynamic_score))
    ]
    return {
        "count": len(scores),
        "score": float(statistics.median(scores)) if scores else None,
        "lufs": _median_track_metric(rel, "dynamic_lufs"),
        "lra": _median_track_metric(rel, "dynamic_lra"),
        "true_peak_dbfs": _median_track_metric(rel, "dynamic_true_peak_dbfs"),
        "rms_dbfs": _median_track_metric(rel, "dynamic_rms_dbfs"),
        "crest_db": _median_track_metric(rel, "dynamic_crest_db"),
    }


def _dynamic_scores_comparable(a: Release, b: Release) -> bool:
    sa = release_dynamic_summary(a)
    sb = release_dynamic_summary(b)
    minimum_tracks = min(a.counted_track_count, b.counted_track_count)
    required = max(1, int(math.ceil(minimum_tracks * DYNAMIC_RANGE_MIN_COVERAGE)))
    return bool(
        sa["score"] is not None
        and sb["score"] is not None
        and int(sa["count"]) >= required
        and int(sb["count"]) >= required
    )


def _dynamic_scores_materially_different(a: Release, b: Release) -> bool:
    if not _dynamic_scores_comparable(a, b):
        return False
    sa = float(release_dynamic_summary(a)["score"])
    sb = float(release_dynamic_summary(b)["score"])
    return abs(sa - sb) >= DYNAMIC_RANGE_MATERIAL_DELTA


def _same_release_exact_mastering_content(a: Release, b: Release) -> bool:
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
    return bool(
        seq_a
        and seq_a == seq_b
        and _included_group_counter(a) == _included_group_counter(b)
    )


def _rip_integrity_not_worse(candidate: Release, current: Release) -> bool:
    if source_rank(candidate) < 2 or source_rank(current) < 2:
        return True
    candidate_quality = cd_rip_quality_key(candidate)
    current_quality = cd_rip_quality_key(current)
    if current_quality is not None and candidate_quality is None:
        return False
    if current_quality is not None and candidate_quality is not None:
        return candidate_quality >= current_quality
    return True


def equivalent_release_preference_key(rel: Release):
    rip = cd_rip_quality_key(rel) or (0, 0, 0, 0, 0.0, 0)
    dynamic = release_dynamic_summary(rel).get("score")
    dynamic_value = float(dynamic) if dynamic is not None else -1000000.0
    return (
        source_rank(rel),
        rip,
        dynamic_value,
        1 if rel.root_kind == "existing" else 0,
        -rel.retained_audio_file_count,
        -rel.rid,
    )


def prefer_dynamic_mastering_exact_equivalents(
    releases: List[Release],
    selected: Set[int],
) -> Set[int]:
    """Prefer materially more dynamic mastering only after identity/source/rip rules."""
    selected = set(selected)
    changed = True
    while changed:
        changed = False
        for current in [r for r in releases if r.rid in selected]:
            current_summary = release_dynamic_summary(current)
            if current_summary.get("score") is None:
                continue
            better = []
            for candidate in releases:
                if candidate.rid == current.rid:
                    continue
                if not _same_release_exact_mastering_content(current, candidate):
                    continue
                if not _rip_integrity_not_worse(candidate, current):
                    continue
                if not _dynamic_scores_comparable(current, candidate):
                    continue
                candidate_score = float(release_dynamic_summary(candidate)["score"])
                current_score = float(current_summary["score"])
                if candidate_score >= current_score + DYNAMIC_RANGE_MATERIAL_DELTA:
                    better.append(candidate)
            if not better:
                continue
            best = max(
                better,
                key=lambda rel: (
                    float(release_dynamic_summary(rel)["score"]),
                    1 if rel.root_kind == "existing" else 0,
                    -rel.retained_audio_file_count,
                    -rel.rid,
                ),
            )
            selected.discard(current.rid)
            selected.add(best.rid)
            changed = True
            break
    return selected


def _append_dynamic_range_log(
    path: Optional[Path],
    releases: List[Release],
    tracks: List[Track],
) -> None:
    if path is None:
        return
    try:
        with path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(
                json.dumps(
                    {
                        "record_type": "dynamic_range",
                        "generated": datetime.now().isoformat(timespec="seconds"),
                        "material_delta": DYNAMIC_RANGE_MATERIAL_DELTA,
                        "tracks_measured": sum(1 for t in tracks if t.dynamic_score is not None),
                        "releases": [
                            {
                                "release_id": rel.rid,
                                "name": rel.path.name,
                                **release_dynamic_summary(rel),
                            }
                            for rel in releases
                            if release_dynamic_summary(rel).get("score") is not None
                        ],
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    except Exception:
        pass


def analyze_dynamic_range_mastering(
    releases: List[Release],
    progress_cb,
    errors: List[str],
    comparison_log_path: Optional[Path] = None,
) -> None:
    candidates = _dynamic_candidate_tracks(releases)
    if not candidates:
        progress_cb("Analyzing mastering dynamics...", 1, 1)
        return

    ffmpeg, _ffprobe = ensure_ffmpeg()
    cache = _load_dynamic_range_cache()
    pending: List[Tuple[Track, str]] = []
    done = 0
    label = f"Analyzing mastering dynamics ({min(DYNAMIC_RANGE_WORKERS, len(candidates))} workers)..."
    progress_cb(label, 0, len(candidates))

    for track in candidates:
        key = _dynamic_range_cache_key(track)
        cached = cache.get(key)
        if isinstance(cached, dict):
            _apply_dynamic_metrics(track, cached)
            done += 1
            progress_cb(label, done, len(candidates))
        else:
            pending.append((track, key))

    workers = min(DYNAMIC_RANGE_WORKERS, len(pending))
    if pending and workers:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futures = {
                ex.submit(_measure_track_dynamic_range, ffmpeg, track): (track, key)
                for track, key in pending
            }
            for fut in as_completed(futures):
                track, key = futures[fut]
                try:
                    metrics = fut.result()
                    _apply_dynamic_metrics(track, metrics)
                    cache[key] = metrics
                except Exception as exc:
                    errors.append(f"Dynamic range error: {track.path}: {exc}")
                done += 1
                progress_cb(label, done, len(candidates))

    try:
        _save_dynamic_range_cache(cache)
    except Exception as exc:
        errors.append(f"Dynamic range cache error: {exc}")
    _append_dynamic_range_log(comparison_log_path, releases, candidates)


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
            # Skipped tracks never create coverage, but they remain physically
            # inside a retained release folder. Price the whole retained audio
            # payload so equal useful coverage prefers fewer files on disk.
            cost_per = max(1, r.retained_audio_file_count) / len(new)
            q, ex, existing = quality_key(r)
            key = (
                cost_per,
                -len(new),
                -ex,
                -q,
                0 if r.root_kind == "existing" else 1,
                r.retained_audio_file_count,
                r.counted_track_count,
                r.title.lower(),
            )
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
            total_retained_audio_files = sum(r.retained_audio_file_count for r in new_rels)
            total_releases = len(new_rels)
            recycle_count = sum(r.root_kind == "recycle" for r in new_rels)
            score = (
                -core_explicit,
                -core_source,
                -core_existing,
                total_retained_audio_files,
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
                    r.retained_audio_file_count,
                    r.counted_track_count,
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
                best = max(
                    candidates,
                    key=lambda e: (
                        _explicit_rank(e),
                        source_rank(e),
                        -e.retained_audio_file_count,
                    ),
                )
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
                best = max(
                    candidates,
                    key=lambda r: (
                        _explicit_rank(r),
                        source_rank(r),
                        -r.retained_audio_file_count,
                    ),
                )
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

        a_pref = equivalent_release_preference_key(a)
        b_pref = equivalent_release_preference_key(b)
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


def minimize_collection_file_count(releases: List[Release], selected: Set[int]) -> Set[int]:
    """Reduce retained physical audio-file count using whole-collection coverage.

    Coverage still uses only counted recording groups. Cost uses every physical
    audio file that remains because release folders are retained as whole units.
    A swap is allowed only when source class is not worse, every counted group
    remains covered, and retained physical audio-file count strictly decreases.

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
                if candidate.retained_audio_file_count >= current.retained_audio_file_count:
                    continue

                trial = (selected - {current.rid}) | {candidate.rid}
                if not required_groups <= covered(trial):
                    continue

                saved_files = current.retained_audio_file_count - candidate.retained_audio_file_count
                key = (
                    -saved_files,
                    -source_rank(candidate),
                    0 if candidate.root_kind == "existing" else 1,
                    candidate.retained_audio_file_count,
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
                -r.retained_audio_file_count,
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
    if _dynamic_scores_materially_different(a, b):
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



def _optimizer_quality_floor(rel: Release) -> Tuple[int, int]:
    """Source/existing quality floor used by the exact collection solver."""
    return (source_rank(rel), 1 if rel.root_kind == "existing" else 0)


def _optimizer_cost(by_id: Dict[int, Release], selected: Set[int]) -> Tuple[object, ...]:
    """Deterministic DEA objective after coverage/source requirements are fixed."""
    rels = [by_id[rid] for rid in selected]
    return (
        sum(r.retained_audio_file_count for r in rels),
        sum(r.counted_track_count for r in rels),
        len(rels),
        sum(1 for r in rels if r.root_kind == "recycle"),
        tuple(sorted(selected)),
    )


def _exact_component_cover(
    by_id: Dict[int, Release],
    requirements: Set[Tuple[str, int]],
    requirement_providers: Dict[Tuple[str, int], Set[int]],
    release_requirements: Dict[int, Set[Tuple[str, int]]],
    seed_selected: Set[int],
) -> Tuple[Set[int], int]:
    """Solve one independent coverage component exactly with branch-and-bound."""
    component_release_ids: Set[int] = set()
    for req in requirements:
        component_release_ids |= requirement_providers.get(req, set())

    seed = set(seed_selected) & component_release_ids

    def satisfied(selected: Set[int]) -> Set[Tuple[str, int]]:
        out: Set[Tuple[str, int]] = set()
        for rid in selected:
            out |= release_requirements.get(rid, set())
        return out

    best: Optional[Set[int]] = None
    best_cost: Optional[Tuple[object, ...]] = None
    if requirements <= satisfied(seed):
        best = set(seed)
        best_cost = _optimizer_cost(by_id, best)

    mandatory: Set[int] = set()
    changed = True
    while changed:
        changed = False
        already = satisfied(mandatory)
        for req in sorted(requirements - already):
            providers = requirement_providers.get(req, set())
            if not providers:
                raise RuntimeError(f"No eligible provider for optimizer requirement {req!r}")
            if len(providers) == 1:
                rid = next(iter(providers))
                if rid not in mandatory:
                    mandatory.add(rid)
                    changed = True

    mandatory_satisfied = satisfied(mandatory)
    unsatisfied_start = frozenset(requirements - mandatory_satisfied)
    states = 0
    memo: Dict[frozenset, Tuple[int, int, int, int]] = {}

    def partial_key(selected: Set[int]) -> Tuple[int, int, int, int]:
        rels = [by_id[rid] for rid in selected]
        return (
            sum(r.retained_audio_file_count for r in rels),
            sum(r.counted_track_count for r in rels),
            len(rels),
            sum(1 for r in rels if r.root_kind == "recycle"),
        )

    def branch_key(rid: int, unsatisfied: frozenset) -> Tuple[object, ...]:
        rel = by_id[rid]
        newly = len(release_requirements.get(rid, set()) & set(unsatisfied))
        return (
            rel.retained_audio_file_count,
            rel.counted_track_count,
            -newly,
            -source_rank(rel),
            0 if rel.root_kind == "existing" else 1,
            rel.rid,
        )

    def dfs(selected: Set[int], unsatisfied: frozenset) -> None:
        nonlocal best, best_cost, states
        states += 1

        part = partial_key(selected)
        prior = memo.get(unsatisfied)
        if prior is not None and prior < part:
            return
        if prior is None or part < prior:
            memo[unsatisfied] = part

        if best_cost is not None:
            best_prefix = tuple(best_cost[:4])
            if part > best_prefix:
                return

        if not unsatisfied:
            cost = _optimizer_cost(by_id, selected)
            if best_cost is None or cost < best_cost:
                best = set(selected)
                best_cost = cost
            return

        req = min(
            unsatisfied,
            key=lambda item: (
                len(requirement_providers.get(item, set())),
                item[0],
                item[1],
            ),
        )
        providers = sorted(
            requirement_providers.get(req, set()),
            key=lambda rid: branch_key(rid, unsatisfied),
        )

        for rid in providers:
            if rid in selected:
                continue
            new_selected = set(selected)
            new_selected.add(rid)
            newly_satisfied = release_requirements.get(rid, set())
            dfs(new_selected, frozenset(set(unsatisfied) - newly_satisfied))

    dfs(set(mandatory), unsatisfied_start)

    if best is None:
        raise RuntimeError("Exact global optimizer could not satisfy a coverage component")

    return best, states


def exact_global_collection_minimize(
    releases: List[Release],
    seed_selected: Set[int],
    progress_cb=None,
) -> Tuple[Set[int], Dict[str, object]]:
    """Coverage Atlas-style exact global minimization for DEA.

    DEA keeps its own fingerprint identity, album rules, source precedence,
    early Remix/Live policy, and Apply workflow. This solver only replaces the old
    greedy/local collection minimization stage.

    The rule-respecting heuristic seed establishes a source/existing quality
    floor for every currently covered recording and album family. The exact
    search may then choose any globally smaller release combination that keeps
    every active recording group, keeps every active album family represented,
    and never drops below those quality floors.
    """
    by_id = {r.rid: r for r in releases}
    seed_selected = set(seed_selected)

    all_groups: Set[int] = set()
    for rel in releases:
        if not rel.excluded_only:
            all_groups |= rel.groups

    requirement_providers: Dict[Tuple[str, int], Set[int]] = {}
    release_requirements: Dict[int, Set[Tuple[str, int]]] = defaultdict(set)

    for gid in sorted(all_groups):
        seed_carriers = [
            by_id[rid]
            for rid in seed_selected
            if rid in by_id and gid in by_id[rid].groups
        ]
        floor = max(
            (_optimizer_quality_floor(rel) for rel in seed_carriers),
            default=(0, 0),
        )
        req = ("group", gid)
        providers = {
            rel.rid
            for rel in releases
            if gid in rel.groups and _optimizer_quality_floor(rel) >= floor
        }
        if not providers:
            providers = {rel.rid for rel in releases if gid in rel.groups}
        requirement_providers[req] = providers
        for rid in providers:
            release_requirements[rid].add(req)

    album_clusters = _album_clusters(
        [r for r in releases if r.release_type == "album" and not r.excluded_only]
    )
    for cluster_id, cluster in enumerate(album_clusters):
        member_ids = {r.rid for r in cluster}
        seed_members = [
            by_id[rid]
            for rid in seed_selected & member_ids
            if rid in by_id
        ]
        floor = max(
            (_optimizer_quality_floor(rel) for rel in seed_members),
            default=(0, 0),
        )
        req = ("album", cluster_id)
        providers = {
            rel.rid
            for rel in cluster
            if _optimizer_quality_floor(rel) >= floor
        }
        if not providers:
            providers = member_ids
        requirement_providers[req] = providers
        for rid in providers:
            release_requirements[rid].add(req)

    requirements = set(requirement_providers)
    if not requirements:
        stats = {
            "components": 0,
            "states": 0,
            "requirements": 0,
            "recording_groups": 0,
            "album_families": 0,
            "seed_releases": len(seed_selected),
            "selected_releases": 0,
            "seed_files": sum(
                by_id[rid].retained_audio_file_count
                for rid in seed_selected
                if rid in by_id
            ),
            "selected_files": 0,
        }
        return set(), stats

    unvisited = set(requirements)
    components: List[Set[Tuple[str, int]]] = []
    while unvisited:
        start = min(unvisited)
        stack = [start]
        component: Set[Tuple[str, int]] = set()
        while stack:
            req = stack.pop()
            if req in component:
                continue
            component.add(req)
            unvisited.discard(req)
            for rid in requirement_providers.get(req, set()):
                for linked in release_requirements.get(rid, set()):
                    if linked not in component:
                        stack.append(linked)
        components.append(component)

    selected: Set[int] = set()
    total_states = 0
    total_components = len(components)

    for index, component in enumerate(
        sorted(components, key=lambda comp: min(comp)),
        start=1,
    ):
        if progress_cb:
            progress_cb(
                f"Exact global optimization ({index}/{total_components})...",
                index - 1,
                total_components,
            )
        solved, states = _exact_component_cover(
            by_id,
            component,
            requirement_providers,
            release_requirements,
            seed_selected,
        )
        selected |= solved
        total_states += states

    if progress_cb:
        progress_cb(
            f"Exact global optimization ({total_components}/{total_components})...",
            total_components,
            max(1, total_components),
        )

    stats = {
        "components": total_components,
        "states": total_states,
        "requirements": len(requirements),
        "recording_groups": len(all_groups),
        "album_families": len(album_clusters),
        "seed_releases": len(seed_selected),
        "selected_releases": len(selected),
        "seed_files": sum(
            by_id[rid].retained_audio_file_count
            for rid in seed_selected
            if rid in by_id
        ),
        "selected_files": sum(
            by_id[rid].retained_audio_file_count
            for rid in selected
            if rid in by_id
        ),
    }
    return selected, stats


def _append_optimizer_log(path: Optional[Path], stats: Dict[str, object]) -> None:
    if path is None:
        return
    try:
        payload = {
            "record_type": "optimizer",
            "generated": datetime.now().isoformat(timespec="seconds"),
            "algorithm": "exact-global-component-cover-v1",
            **stats,
        }
        with path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        pass


def optimize_collection(
    releases: List[Release],
    groups: Dict[int, List[int]],
    blocked_release_ids: Optional[Set[int]] = None,
    progress_cb=None,
    comparison_log_path: Optional[Path] = None,
) -> Set[int]:
    """Optimize the retained set with exact whole-collection coverage.

    Manual Release Map removals are planning constraints only. Fingerprints and
    recording groups are reused; the expensive audio-analysis stage is not rerun.

    The established DEA heuristic/source passes first produce a valid,
    rule-respecting seed. A Coverage Atlas-style exact component solver then
    minimizes the whole collection without reducing the seed's source/existing
    quality floor for any active recording or album family.
    """
    blocked = set(blocked_release_ids or set())
    eligible = [r for r in releases if r.rid not in blocked]

    dominated = find_dominated_releases(eligible)
    active = [r for r in eligible if r.rid not in dominated]

    selected = choose_album_families(active)

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
                        r.retained_audio_file_count,
                        -source_rank(r),
                        0 if r.root_kind == "existing" else 1,
                        r.counted_track_count,
                        r.rid,
                    ),
                )
                selected.add(chosen.rid)

    selected = stabilize_equivalent_sources(active, selected)
    selected = enforce_existing_precedence(active, selected)
    selected = prune_redundant_selected(active, selected)

    selected, optimizer_stats = exact_global_collection_minimize(
        active,
        selected,
        progress_cb,
    )

    selected = stabilize_equivalent_sources(active, selected)
    selected = enforce_existing_precedence(active, selected)
    selected = prune_redundant_selected(active, selected)

    selected = prefer_better_cd_rips(active, selected)
    selected = prefer_dynamic_mastering_exact_equivalents(active, selected)
    selected = prefer_explicit_exact_equivalents(active, selected)

    selected -= blocked
    optimizer_stats.update(
        {
            "blocked_releases": len(blocked),
            "dominated_releases": len(dominated),
            "active_releases": len(active),
            "final_releases": len(selected),
            "final_files": sum(
                r.retained_audio_file_count
                for r in active
                if r.rid in selected
            ),
        }
    )
    _append_optimizer_log(comparison_log_path, optimizer_stats)
    return selected

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
    if not _is_frozen_build():
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

    # Remix/Live classification happens in analyze_prepared(), after the
    # optional phrase-review UI. CD log/CUETools work is deliberately deferred
    # until then so completely eliminated releases take no further part.
    #
    # Store probe failures for the continuation stage.
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

    # Step 1: classify Remix/Live and eliminate globally unwanted material
    # before any expensive quality/fingerprint/comparison stage.
    progress_cb("Classifying wanted audio...", 0, max(1, len(tracks)))
    configure_exclusions(releases, exclude_remixes, exclude_live, personal_keep_rules)
    apply_pattern_exclusions(releases, set(excluded_pattern_keys or set()))
    for index, track in enumerate(tracks, 1):
        track.base_excluded_from_coverage = bool(track.exclude_from_coverage)
        track.manual_skip_rule = ""
        if track.exclude_from_coverage:
            track.fingerprint = tuple()
            track.fingerprint_duration = 0.0
            track.group_id = -1
        if index % 100 == 0 or index == len(tracks):
            progress_cb("Classifying wanted audio...", index, max(1, len(tracks)))
    if not tracks:
        progress_cb("Classifying wanted audio...", 1, 1)

    refresh_heuristic_release_types(releases)

    # Entirely eliminated releases are retained only as filesystem bookkeeping
    # for the final Apply/move stage. They do not receive quality analysis.
    active_releases = [rel for rel in releases if not rel.excluded_only]
    score_cd_rip_logs(active_releases, progress_cb, errors)
    verify_cuetools_image_families(active_releases, progress_cb, errors)

    fpcalc = ensure_fpcalc() if use_fingerprint else None
    if use_fingerprint and fpcalc:
        fingerprint_tracks = [
            track for track in tracks
            if not track.exclude_from_coverage
        ]
        fp_workers = min(len(fingerprint_tracks) or 1, _fingerprint_workers())
        label = f"Generating Chromaprint fingerprints ({fp_workers} workers)..."
        progress_cb(label, 0, max(1, len(fingerprint_tracks)))
        if fingerprint_tracks:
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
        else:
            progress_cb(label, 1, 1)

    groups, merge_notes = merge_equivalent_tracks(
        tracks,
        progress_cb,
        comparison_log_path,
    )
    errors.extend(merge_notes)
    progress_cb("Applying saved track skips...", 0, 1)
    apply_persistent_track_skips(tracks)
    progress_cb("Applying saved track skips...", 1, 1)

    # Mastering dynamics are measured only for exact-equivalent release
    # candidates. The result is a late quality tie-break, never identity input.
    analyze_dynamic_range_mastering(
        releases,
        progress_cb,
        errors,
        comparison_log_path,
    )

    progress_cb("Optimizing release set...", 0, 1)
    selected = optimize_collection(
        releases,
        groups,
        progress_cb=progress_cb,
        comparison_log_path=comparison_log_path,
    )
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
    lines.append("3. Apply Save Remixes / Save Live recordings before fingerprint analysis. Unchecked Remix/Live material is eliminated immediately; the only Save-Remixes exception is a remix with an explicit featured-artist credit.")
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
    lines.append(f"Proposed retained physical audio files: {sum(by_id[x].retained_audio_file_count for x in selected)}")
    lines.append(f"Counted tracks in retained releases: {sum(by_id[x].counted_track_count for x in selected)}")
    lines.append(f"Skipped remix/live/pattern tracks inside retained releases: {sum(by_id[x].ignored_track_count for x in selected)}")
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
    lines.append("Chromaprint acoustic fingerprint evidence is the duplicate-identity authority. Duration, titles, filenames, MBIDs and ISRCs do not decide identity. CUE-image tracks are fingerprinted as their CUE time segments.")
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

        # Dynamics sits after source/rip integrity and before Existing-copy
        # preference. A materially more dynamic exact-equivalent recycle
        # mastering therefore must not be suppressed by this final safeguard.
        if (
            _same_release_exact_mastering_content(er, rel)
            and _dynamic_scores_comparable(er, rel)
            and _rip_integrity_not_worse(rel, er)
        ):
            er_dynamic = float(release_dynamic_summary(er)["score"])
            rel_dynamic = float(release_dynamic_summary(rel)["score"])
            if rel_dynamic >= er_dynamic + DYNAMIC_RANGE_MATERIAL_DELTA:
                continue

        candidates.append(er)
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda er: (
            source_rank(er),
            cd_rip_quality_key(er) or (0, 0, 0, 0, 0.0, 0),
            float(release_dynamic_summary(er).get("score") or -1000000.0),
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
                        "Existing copy is not worse under source / CD-rip-quality / mastering-dynamics preference rules.",
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
                factors.append(f"Personal Picks matched {len(personal_matches)} currently included track(s).")

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

    base = _base_title_identity(track.display_title)
    bases = {str(x) for x in rule.get("base_titles", []) if str(x)}
    return bool(base and base in bases)


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
    base_titles = sorted({
        _base_title_identity(member.display_title)
        for member in members
        if _base_title_identity(member.display_title)
    })

    identity_payload = "|".join(fingerprint_hashes + base_titles)
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
    metadata_conflict = (
        _metadata_match_conflict(track, other, _definitive_acoustic_identity(_sim))
        if audio_match
        else ""
    )

    if audio_match and metadata_conflict:
        return (
            f"Acoustically similar to '{other.display_title}' on {other_name}, but kept separate by "
            f"non-audio metadata safety because the fingerprint match is not definitive: {metadata_conflict}."
        )

    if not audio_match:
        return (
            f"Different acoustic recording from '{other.display_title}' on {other_name}; "
            "Chromaprint did not meet the duplicate threshold. Duration is diagnostic only."
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
        dynamic_summary = release_dynamic_summary(rel)
        if dynamic_summary.get("score") is not None:
            dyn_parts = [f"Dynamics score {float(dynamic_summary['score']):.2f}"]
            if dynamic_summary.get("lufs") is not None:
                dyn_parts.append(f"{float(dynamic_summary['lufs']):.1f} LUFS")
            if dynamic_summary.get("lra") is not None:
                dyn_parts.append(f"LRA {float(dynamic_summary['lra']):.1f}")
            if dynamic_summary.get("crest_db") is not None:
                dyn_parts.append(f"crest {float(dynamic_summary['crest_db']):.1f} dB")
            quality_bits.append("Mastering: " + " | ".join(dyn_parts))

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
                    "included_tracks": other.counted_track_count,
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
            covering_releases.sort(
                key=lambda other: (
                    other.included_track_count,
                    -_explicit_rank(other),
                    -source_rank(other),
                    0 if other.root_kind == "existing" else 1,
                    other.path.name.casefold(),
                )
            )
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
                    "covered_by_names": [other.path.name for other in covering_releases[:8]],
                    "replacement_source": (
                        covering_releases[0].path.name
                        if manual_removed and included and covering_releases
                        else ""
                    ),
                    "replacement_alternates": (
                        [other.path.name for other in covering_releases[1:8]]
                        if manual_removed and included
                        else []
                    ),
                    "unique_to_release": unique_to_release,
                    "orphaned": orphaned,
                    "distinction": distinction,
                    "base_title_key": base_key,
                    "is_remix": bool(track.is_remix),
                    "is_live": bool(track.is_live),
                    "dynamic_lufs": track.dynamic_lufs,
                    "dynamic_lra": track.dynamic_lra,
                    "dynamic_true_peak_dbfs": track.dynamic_true_peak_dbfs,
                    "dynamic_rms_dbfs": track.dynamic_rms_dbfs,
                    "dynamic_crest_db": track.dynamic_crest_db,
                    "dynamic_score": track.dynamic_score,
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
                        "included_tracks": other.counted_track_count,
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
                "included_tracks": rel.counted_track_count,
                "ignored_tracks": rel.ignored_track_count,
                "physical_tracks": rel.track_count,
                "retained_audio_files": rel.retained_audio_file_count,
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
        "duplicates": str(duplicates),
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



def _qt_dependency_dir() -> Path:
    return _dependencies_dir() / f"pyside6-{PYSIDE6_VERSION}"


def ensure_qt_release_map_dependencies() -> Path:
    """Install the modern Qt UI runtime in this program's isolated dependency folder."""
    deps = _qt_dependency_dir()
    deps_text = str(deps)
    if deps.is_dir() and deps_text not in sys.path:
        sys.path.insert(0, deps_text)

    try:
        importlib.import_module("PySide6")
        importlib.import_module("PySide6.QtWebEngineWidgets")
        return deps
    except Exception as exc:
        if _is_frozen_build():
            raise RuntimeError(
                "Bundled PySide6/Qt WebEngine failed to load: " + str(exc)
            ) from exc

    bootstrap_winget()
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
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--quiet",
            "--upgrade",
            "--target",
            str(deps),
            f"PySide6=={PYSIDE6_VERSION}",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        errors="replace",
        check=False,
    )
    if cp.returncode != 0:
        raise RuntimeError(
            "PySide6 could not be installed automatically: "
            + (cp.stderr.strip() or cp.stdout.strip() or "pip install failed")
        )

    if deps_text not in sys.path:
        sys.path.insert(0, deps_text)
    importlib.invalidate_caches()
    importlib.import_module("PySide6")
    importlib.import_module("PySide6.QtWebEngineWidgets")
    return deps


def _qt_release_map_html() -> str:
    html = r"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Duplicate Edition Analyzer - Release Map</title>
<script src="qrc:///qtwebchannel/qwebchannel.js"></script>
<style>
:root {
  color-scheme:dark;
  --bg:#0b0c0f; --panel:#11141a; --panel2:#171b22; --line:#2a303a;
  --text:#f3f6fb; --muted:#9ca7b8; --blue:#66a9ff; --cyan:#55d7ff;
  --red:#ef4444; --yellow:#f59e0b; --green:#22c55e; --dup:#788393;
}
* { box-sizing:border-box; }
html,body { margin:0; width:100%; height:100%; overflow:hidden; background:var(--bg); color:var(--text);
  font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif; }
body { display:flex; flex-direction:column; }
button,input { font:inherit; }
#toolbar {
  height:56px; min-height:56px; display:flex; align-items:center; gap:8px; padding:0 14px;
  background:#101319; border-bottom:1px solid var(--line); z-index:20;
}
#title { font-weight:750; font-size:17px; margin-right:4px; white-space:nowrap; }
#planCounts { display:flex; align-items:center; gap:5px; white-space:nowrap; }
.planCount {
  height:30px; display:flex; align-items:center; padding:0 8px;
  border:1px solid #333b47; border-radius:7px; background:#161a20;
  color:#c6cfdb; font-size:11px; font-weight:650;
}
#resultCounts.changed { border-color:#527b92; background:#14212a; color:#d9f3ff; }
#resultCounts.pending { border-color:#8a6a25; background:#251f12; color:#f5d98b; }
#search {
  width:min(520px,38vw); height:34px; border:1px solid #37404d; border-radius:8px;
  background:#181c23; color:var(--text); padding:0 11px; outline:none;
}
#search:focus { border-color:var(--blue); box-shadow:0 0 0 2px rgba(102,169,255,.16); }
.btn {
  height:34px; border:1px solid #3a4351; border-radius:8px; background:#1b2028; color:var(--text);
  padding:0 12px; cursor:pointer; transition:.12s ease;
}
.btn:hover:not(:disabled) { background:#252c36; border-color:#596579; }
.btn:disabled { opacity:.38; cursor:default; }
.btn.dirty { border-color:var(--yellow); color:#ffd77a; box-shadow:0 0 0 2px rgba(245,158,11,.16); }
.btn.apply-ready { background:#12351f; border-color:#2f9e55; color:#b8f7c9; box-shadow:0 0 0 2px rgba(34,197,94,.16); }
#modeText {
  min-width:0; max-width:440px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:#b9c4d3; font-size:12px; padding-left:4px;
}
#spacer { flex:1; }
#main { min-height:0; flex:1; display:flex; position:relative; }
#boardViewport {
  position:relative; min-width:0; flex:1; overflow:auto; background:linear-gradient(180deg,#0c0e12,#0a0c0f);
}
#boardContent {
  position:relative; min-width:100%; min-height:100%; width:max-content; padding:14px 18px 24px;
}
#connections { position:absolute; inset:0; pointer-events:none; overflow:visible; z-index:1; }
#columns { position:relative; z-index:2; display:flex; align-items:flex-start; gap:34px; width:max-content; }
.releaseColumn { width:355px; flex:0 0 355px; display:flex; flex-direction:column; gap:3px; }
.releaseRow {
  position:relative; height:34px; display:flex; align-items:center; gap:8px; padding:0 8px;
  border:1px solid transparent; border-radius:6px; color:#e8edf5; cursor:pointer; user-select:none;
  transition:background .10s ease,border-color .10s ease,opacity .10s ease,box-shadow .10s ease;
}
.releaseRow:hover { background:#171c23; border-color:#343d49; }
.releaseRow.selected { background:#18283a; border-color:#68a9f5; box-shadow:0 0 0 1px rgba(104,169,245,.18); }
.releaseRow.duplicate { color:#a9b1be; background:rgba(17,20,25,.56); }
.releaseRow.duplicate .releaseName { color:#a9b1be; }
.releaseRow.ignored {
  color:#ffc1c6; background:rgba(86,29,35,.36); border-color:#843640;
  box-shadow:inset 3px 0 #dc5965;
}
.releaseRow.ignored .releaseName { color:#ffd6da; }
.releaseRow.pendingIgnore {
  color:#f5d98b; background:rgba(90,68,20,.30); border-color:#806423;
  box-shadow:inset 3px 0 #d4a62f;
}
.releaseRow.pendingRestore {
  color:#aee9c0; background:rgba(24,76,43,.26); border-color:#34784d;
  box-shadow:inset 3px 0 #4fb574;
}
.releaseRow.carrier { border-color:#54d6ff; background:#102934; color:#e8fbff; box-shadow:0 0 0 1px rgba(84,214,255,.24); }
.releaseRow.searchMatch { border-color:#f3c969; background:#2a2413; box-shadow:0 0 0 1px rgba(243,201,105,.22); }
.releaseRow.searchDimmed { opacity:.16; }
.releaseRow.dimmed { opacity:.18; }
.folderIcon {
  position:relative; width:16px; height:11px; flex:0 0 16px; border-radius:2px;
  background:#e1b548; box-shadow:inset 0 -1px rgba(0,0,0,.22);
}
.folderIcon:before {
  content:""; position:absolute; left:1px; top:-4px; width:8px; height:5px; border-radius:2px 2px 0 0;
  background:#f2cb62;
}
.releaseName { min-width:0; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12px; }
.releaseMeta { flex:0 0 auto; color:#707b8b; font-size:10px; }
.uniqueBadge,.duplicateBadge,.ignoredBadge,.pendingBadge {
  flex:0 0 auto; min-width:22px; height:20px; padding:0 6px; border-radius:10px;
  display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:800;
}
.uniqueBadge.red { background:var(--red); color:#fff; }
.uniqueBadge.yellow { background:var(--yellow); color:#17130a; }
.uniqueBadge.green { background:var(--green); color:#07140a; }
.uniqueBadge.neutral { background:#64748b; color:#fff; }
.uniqueBadge.gem {
  min-width:20px; padding:0; background:transparent; color:inherit;
  font-size:14px; line-height:20px;
  font-family:"Segoe UI Emoji","Segoe UI Symbol","Segoe UI",sans-serif;
}
.duplicateBadge { border:1px solid #4f5968; color:#9aa5b5; background:#20252d; font-weight:700; }
.ignoredBadge { border:1px solid #ad4a55; color:#ffd5d9; background:#542128; }
.pendingBadge { border:1px solid #8a6a25; color:#f5d98b; background:#302611; }
#details {
  width:0; overflow:hidden; transition:width .16s ease; border-left:0 solid var(--line);
  background:var(--panel); display:flex; flex-direction:column; z-index:10;
}
#details.open { width:min(720px,52vw); border-left-width:1px; }
#detailsInner { width:min(720px,52vw); min-width:520px; height:100%; display:flex; flex-direction:column; }
#emptyDetails { margin:auto; color:var(--muted); text-align:center; padding:30px; }
#detailsHead { position:relative; padding:15px 46px 12px 16px; border-bottom:1px solid var(--line); }
#closeDetailsBtn {
  position:absolute; right:12px; top:11px; width:30px; height:30px; padding:0;
  border:1px solid #38414f; border-radius:7px; background:#171c23; color:#cbd5e1;
  font-size:18px; line-height:26px; cursor:pointer;
}
#closeDetailsBtn:hover { border-color:#697586; background:#222a34; color:#fff; }
#releaseName { font-size:17px; line-height:1.28; font-weight:750; margin-bottom:5px; }
#releaseMeta { color:var(--muted); font-size:12px; margin-bottom:10px; }
#releaseActions { display:flex; gap:8px; margin-bottom:10px; }
#ignoreReleaseBtn { background:#5b2026; border-color:#a33b44; color:#ffe8ea; font-weight:750; }
#ignoreReleaseBtn:hover { background:#742932; border-color:#ff7c86; color:#fff; }
#ignoreReleaseBtn.restore { background:#12351f; border-color:#2f9e55; color:#b8f7c9; }
#ignoreReleaseBtn.restore:hover { background:#19482a; border-color:#53c979; color:#e0ffe8; }
.ignoredNotice {
  margin:0 0 10px; padding:8px 10px; border:1px solid #71313a; border-radius:7px;
  background:#291317; color:#ffc5ca; font-size:11px; line-height:1.4;
}
.pendingNotice {
  margin:0 0 10px; padding:8px 10px; border:1px solid #735a22; border-radius:7px;
  background:#251e0f; color:#f5d98b; font-size:11px; line-height:1.4;
}
#pathRow { display:flex; gap:8px; align-items:center; }
#releasePath {
  flex:1; min-width:0; color:#c7d2e3; background:#0d1015; border:1px solid #303744;
  border-radius:7px; padding:7px 9px; font-family:"Cascadia Mono",Consolas,monospace; font-size:11px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; user-select:text;
}
#reason { margin-top:10px; color:#d4dbe7; font-size:12px; line-height:1.42; }
#tracksTitle {
  padding:11px 16px 7px; font-size:13px; font-weight:750; color:#e4e9f1;
  display:flex; justify-content:space-between; gap:10px;
}
#tracksTitle small { color:#8793a4; font-weight:400; }
#tracks { min-height:0; flex:1; overflow:auto; padding:0 8px 14px; }
.track {
  position:relative; display:grid; grid-template-columns:36px minmax(150px,1fr) 52px 132px minmax(180px,1fr);
  gap:8px; align-items:center; min-height:40px; padding:5px 10px;
  border-bottom:1px solid #232933; border-radius:6px; color:#edf1f7; font-size:12px; cursor:pointer;
}
.track:hover { background:#1a2029; }
.track.unique { background:rgba(245,158,11,.12); box-shadow:inset 3px 0 var(--yellow); }
.track.orphan { background:rgba(239,68,68,.14); box-shadow:inset 3px 0 var(--red); }
.track.activeTrack { background:rgba(85,215,255,.12); box-shadow:inset 3px 0 var(--cyan); }
.track.manual { color:#c4b5fd; }
.track.skipped { opacity:.46; filter:grayscale(.82); }
.track.skipped:hover { opacity:.60; }
.track .num,.track .dur { color:#8793a4; text-align:center; }
.track .titleText { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.trackGem {
  display:inline-flex; align-items:center; justify-content:center; min-width:26px; height:26px;
  font-family:"Segoe UI Emoji","Segoe UI Symbol","Segoe UI",sans-serif; font-size:15px;
}
.track .status { color:#929eae; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.track .status.replacement { color:#8ee7a7; font-weight:650; }
.track .status.missing { color:#ff9da5; font-weight:750; }
.versionsCell { display:flex; justify-content:center; gap:4px; }
.versionsTrack,.remixesTrack,.liveTrack {
  height:26px; border-radius:7px; padding:0 7px; cursor:pointer;
  font-size:10px; font-weight:750; white-space:nowrap;
}
.versionsTrack { border:1px solid #806c34; background:#2a2413; color:#f3d17a; }
.versionsTrack:hover { background:#382f17; border-color:#f3c969; color:#fff0b8; }
.remixesTrack { border:1px solid #644786; background:#21172d; color:#d9b4ff; }
.remixesTrack:hover { background:#2b1c3c; border-color:#b989ef; color:#f0ddff; }
.liveTrack { border:1px solid #346b5d; background:#10251f; color:#98ebce; }
.liveTrack:hover { background:#16352b; border-color:#6ee7b7; color:#d7fff1; }
.altVersions,.altRemixes,.altLive {
  display:none; margin:2px 8px 7px 52px; border-radius:8px; overflow:hidden;
}
.altVersions { border:1px solid #5d522b; background:#18160d; }
.altRemixes { border:1px solid #4e3965; background:#15101c; }
.altLive { border:1px solid #315d52; background:#0f1c18; }
.altVersions.open,.altRemixes.open,.altLive.open { display:block; }
.altVersionsHead,.altRemixesHead,.altLiveHead {
  padding:7px 10px; border-bottom:1px solid #263a46;
  font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.04em;
}
.altVersionsHead { color:#f3d17a; background:#211d0f; border-bottom-color:#4c4324; }
.altRemixesHead { color:#d9b4ff; background:#1d1428; border-bottom-color:#443157; }
.altLiveHead { color:#98ebce; background:#10251f; border-bottom-color:#315d52; }
.altVersion {
  width:100%; display:grid; grid-template-columns:minmax(180px,1fr) 54px 80px minmax(130px,1fr);
  gap:8px; align-items:center; padding:7px 10px; border:0; border-bottom:1px solid #1f303a;
  background:transparent; color:#e6edf5; text-align:left; cursor:pointer; font-size:11px;
}
.altVersion:last-child { border-bottom:0; }
.altVersion:hover { background:#172630; }
.altVersion .altTitle { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:650; }
.altVersion .altDuration { color:#8793a4; text-align:center; }
.altVersion .altState { color:#9ca7b8; white-space:nowrap; }
.altVersion .altState.retained { color:#8ee7a7; }
.altVersion .altState.available { color:#f3d17a; }
.altVersion .altReleases { color:#7f8c9d; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ignoreTrack {
  position:absolute; right:8px; top:5px; height:30px; opacity:0; pointer-events:none;
  border:1px solid #a33b44; border-radius:7px; background:#5b2026; color:#ffe8ea; padding:0 11px;
  font-weight:700; transition:.10s ease; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.35);
}
.track:hover .ignoreTrack { opacity:1; pointer-events:auto; }
.ignoreTrack:hover { border-color:#ff7c86; background:#742932; color:#fff; }
#resultDrawer {
  display:none; border-top:1px solid var(--line); background:#101319; padding:11px 16px 13px;
  max-height:220px; overflow:auto;
}
#resultDrawer.open { display:block; }
#resultTitle { font-weight:750; margin-bottom:7px; }
.resultLine { color:#d9dfeb; font-size:13px; line-height:1.45; margin:3px 0; }
.resultAdd { color:#98f5b3; } .resultRemove { color:#ffaaaa; }
</style>
</head>
<body>
<div id="toolbar">
  <div id="title">Release Map</div>
  <div id="planCounts" title="Tracks = counted tracks in retained releases. Skipped/ignored tracks are not counted.">
    <div class="planCount" id="initialCounts">Initial: --</div>
    <div class="planCount" id="resultCounts">Result: --</div>
  </div>
  <input id="search" placeholder="Find release or track...">
  <button class="btn" id="clearTrackBtn" style="display:none">Clear track highlight</button>
  <div id="modeText">Chronological release board</div>
  <button class="btn" id="reanalyzeBtn" disabled>Re-Analyze</button>
  <button class="btn" id="applyBtn" disabled>Apply</button>
  <div id="spacer"></div>
  <button class="btn" id="closeBtn">Close</button>
</div>
<div id="main">
  <div id="boardViewport">
    <div id="boardContent">
      <svg id="connections"></svg>
      <div id="columns"></div>
    </div>
  </div>
  <aside id="details">
    <div id="detailsInner"><div id="emptyDetails">Click a release to inspect it.</div></div>
  </aside>
</div>
<div id="resultDrawer">
  <div id="resultTitle">Re-Analyze result</div>
  <div id="resultBody"></div>
</div>
<script type="module">
let bridge = null;
let state = null;
let selectedId = null;
let activeTrack = null;
let rowEls = new Map();
let resizeTimer = null;

function esc(v) {
  return String(v == null ? "" : v)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#39;");
}
function badgeClass(n) {
  if (n >= 6) return "green";
  if (n >= 3) return "yellow";
  return "red";
}
function signedCount(n) {
  n=Number(n||0);
  return n>0 ? "+"+n : String(n);
}
function renderPlanCounts() {
  const pc=state&&state.planCounts?state.planCounts:null;
  const initial=pc&&pc.initial?pc.initial:{releases:0,tracks:0};
  const result=pc&&pc.result?pc.result:initial;
  const delta=pc&&pc.delta?pc.delta:{
    releases:Number(result.releases||0)-Number(initial.releases||0),
    tracks:Number(result.tracks||0)-Number(initial.tracks||0)
  };
  const initialEl=document.getElementById("initialCounts");
  const resultEl=document.getElementById("resultCounts");
  initialEl.textContent="Initial: "+initial.releases+" releases / "+initial.tracks+" tracks";
  resultEl.textContent="Result: "+result.releases+" releases ("+signedCount(delta.releases)+") / "
    +result.tracks+" tracks ("+signedCount(delta.tracks)+")"
    +(state&&state.dirty?" - pending Re-Analyze":"");
  const changed=Number(delta.releases)!==0||Number(delta.tracks)!==0;
  resultEl.classList.toggle("changed",changed&&!state.dirty);
  resultEl.classList.toggle("pending",!!(state&&state.dirty));
}
function getNode(id) {
  return (state.nodes || []).find(function(n){ return Number(n.id) === Number(id); });
}
function carriersForGroup(groupId) {
  if (groupId == null || Number(groupId) < 0) return [];
  return (state.nodes || []).filter(function(n) {
    return (n.tracks || []).some(function(t){ return Number(t.groupId) === Number(groupId); });
  });
}
function baseRelationsForRelease(releaseId) {
  const source=getNode(releaseId), versionIds=new Set(), remixIds=new Set(), liveIds=new Set();
  if(!source) return {versions:versionIds,remixes:remixIds,live:liveIds};
  (state.nodes||[]).forEach(function(other){
    if(Number(other.id)===Number(source.id)) return;
    let hasVersion=false, hasRemix=false, hasLive=false;
    (source.tracks||[]).forEach(function(a){
      if(a.excluded || Number(a.groupId)<0 || !a.baseKey) return;
      (other.tracks||[]).forEach(function(b){
        if(b.excluded || Number(b.groupId)<0 || !b.baseKey) return;
        if(a.baseKey!==b.baseKey || Number(a.groupId)===Number(b.groupId)) return;
        const af=String(a.family||"version"), bf=String(b.family||"version");
        if(af==="live" || bf==="live") hasLive=true;
        else if(af==="remix" || bf==="remix") hasRemix=true;
        else hasVersion=true;
      });
    });
    if(hasVersion) versionIds.add(String(other.id));
    else if(hasRemix) remixIds.add(String(other.id));
    else if(hasLive) liveIds.add(String(other.id));
  });
  return {versions:versionIds,remixes:remixIds,live:liveIds};
}
function rowCenter(id) {
  const el = rowEls.get(String(id));
  const content = document.getElementById("boardContent");
  if (!el || !content) return null;
  const a = el.getBoundingClientRect();
  const b = content.getBoundingClientRect();
  return {x:a.left-b.left+a.width/2,y:a.top-b.top+a.height/2};
}
function addCurve(svg,a,b,color,width,opacity,dash) {
  if (!a || !b) return;
  const dx=b.x-a.x, bend=Math.max(42,Math.min(170,Math.abs(dx)*0.42)), sign=dx>=0?1:-1;
  const p=document.createElementNS("http://www.w3.org/2000/svg","path");
  p.setAttribute("d","M "+a.x+" "+a.y+" C "+(a.x+bend*sign)+" "+a.y+", "+(b.x-bend*sign)+" "+b.y+", "+b.x+" "+b.y);
  p.setAttribute("fill","none"); p.setAttribute("stroke",color); p.setAttribute("stroke-width",String(width));
  p.setAttribute("stroke-opacity",String(opacity)); p.setAttribute("stroke-linecap","round");
  if(dash) p.setAttribute("stroke-dasharray",dash);
  svg.appendChild(p);
}
let searchCursor=-1;
let lastSearchQuery="";
function searchMatchesFor(query) {
  const q=String(query||"").trim().toLowerCase();
  if(!q || !state) return [];
  return (state.nodes||[]).filter(function(n){
    if(String(n.name||"").toLowerCase().includes(q)) return true;
    return (n.tracks||[]).some(function(t){
      return String(t.title||"").toLowerCase().includes(q);
    });
  });
}
function applySearchHighlights(resetCursor) {
  const input=document.getElementById("search");
  const q=String(input.value||"").trim().toLowerCase();
  if(resetCursor || q!==lastSearchQuery){ searchCursor=-1; lastSearchQuery=q; }
  const matches=searchMatchesFor(q);
  const ids=new Set(matches.map(function(n){return String(n.id);}));
  rowEls.forEach(function(el,id){
    el.classList.toggle("searchMatch",!!q && ids.has(id));
    el.classList.toggle("searchDimmed",!!q && !ids.has(id));
  });
  if(!activeTrack){
    const mode=document.getElementById("modeText");
    mode.textContent=q
      ? 'Find "'+input.value.trim()+'" - '+matches.length+' release(s)'
      : "Chronological release board";
  }
  return matches;
}
function updateRowHighlights() {
  const carrierIds=new Set();
  if(activeTrack) carriersForGroup(activeTrack.groupId).forEach(function(n){carrierIds.add(String(n.id));});
  rowEls.forEach(function(el,id){
    el.classList.toggle("selected",selectedId!=null && Number(id)===Number(selectedId));
    if(activeTrack){
      const carrier=carrierIds.has(id); el.classList.toggle("carrier",carrier); el.classList.toggle("dimmed",!carrier);
    } else { el.classList.remove("carrier"); el.classList.remove("dimmed"); }
  });
  applySearchHighlights(false);
}
function drawConnections() {
  if(!state) return;
  const svg=document.getElementById("connections"), content=document.getElementById("boardContent");
  const width=Math.max(content.scrollWidth,content.clientWidth), height=Math.max(content.scrollHeight,content.clientHeight);
  svg.setAttribute("width",String(width)); svg.setAttribute("height",String(height));
  svg.setAttribute("viewBox","0 0 "+width+" "+height); svg.innerHTML="";
  const selected=selectedId==null?null:Number(selectedId);
  (state.duplicateLinks||[]).forEach(function(link){
    const touch=selected!=null && (Number(link.duplicate)===selected || Number(link.retained)===selected);
    const opacity=activeTrack?0.06:(selected==null?0.24:(touch?0.72:0.10));
    addCurve(svg,rowCenter(link.duplicate),rowCenter(link.retained),"#758296",touch?2.4:1.15,opacity);
  });
  if(selected!=null && !activeTrack){
    const related=baseRelationsForRelease(selected), source=rowCenter(selected);
    related.versions.forEach(function(id){
      addCurve(svg,source,rowCenter(id),"#f3c969",2.6,0.88,"8 5");
    });
    related.remixes.forEach(function(id){
      addCurve(svg,source,rowCenter(id),"#b989ef",2.2,0.70,"3 6");
    });
    related.live.forEach(function(id){
      addCurve(svg,source,rowCenter(id),"#6ee7b7",2.2,0.72,"10 4 2 4");
    });
  }
  if(activeTrack){
    const source=rowCenter(activeTrack.releaseId);
    carriersForGroup(activeTrack.groupId).forEach(function(n){
      if(Number(n.id)===Number(activeTrack.releaseId)) return;
      addCurve(svg,source,rowCenter(n.id),"#55d7ff",3.3,0.94);
    });
  }
}
function renderBoard() {
  if(!state) return;
  const viewport=document.getElementById("boardViewport"), columns=document.getElementById("columns");
  const usableHeight=Math.max(420,viewport.clientHeight-48), perColumn=Math.max(10,Math.floor(usableHeight/37));
  columns.innerHTML=""; rowEls=new Map();
  const nodes=state.nodes||[];
  for(let start=0;start<nodes.length;start+=perColumn){
    const col=document.createElement("div"); col.className="releaseColumn";
    nodes.slice(start,start+perColumn).forEach(function(n){
      const row=document.createElement("div");
      let rowState=n.kind==="duplicate"?"duplicate":"retained";
      if(n.manualRemoved) rowState+=" ignored";
      else if(n.pendingReleaseIgnore) rowState+=" pendingIgnore";
      else if(n.pendingReleaseRestore) rowState+=" pendingRestore";
      row.className="releaseRow "+rowState;
      row.dataset.id=String(n.id); row.title=n.name;
      const badge=n.manualRemoved
        ?'<span class="ignoredBadge">IGN</span>'
        :(n.pendingReleaseIgnore
          ?'<span class="pendingBadge">PENDING</span>'
          :(n.pendingReleaseRestore
            ?'<span class="pendingBadge">RESTORE</span>'
            :(n.kind==="duplicate"
              ?'<span class="duplicateBadge">DUP</span>'
              :(n.isGem
                ?'<span class="uniqueBadge gem" title="Gem track: '+esc((n.gemTitles||[]).join("; "))+'">💎</span>'
                :(Number(n.uniqueCount)>0
                  ?'<span class="uniqueBadge '+badgeClass(n.uniqueCount)+'">'+n.uniqueCount+'</span>'
                  :"")))));
      const meta=n.manualRemoved?"IGNORED":(n.pendingReleaseIgnore?"PENDING IGNORE":(n.pendingReleaseRestore?"PENDING RESTORE":n.action));
      row.innerHTML='<span class="folderIcon"></span><span class="releaseName">'+esc(n.name)+'</span>'
        +'<span class="releaseMeta">'+esc(meta)+'</span>'+badge;
      row.onclick=function(){
        const details=document.getElementById("details");
        if(selectedId!=null && Number(selectedId)===Number(n.id) && details.classList.contains("open")){
          closeDetails();
          return;
        }
        selectedId=Number(n.id); activeTrack=null; openDetails(n); updateRowHighlights(); drawConnections(); updateTrackMode();
      };
      col.appendChild(row); rowEls.set(String(n.id),row);
    });
    columns.appendChild(col);
  }
  updateRowHighlights(); requestAnimationFrame(drawConnections);
}
function updateTrackMode() {
  const clear=document.getElementById("clearTrackBtn"), mode=document.getElementById("modeText");
  if(activeTrack){
    const carriers=carriersForGroup(activeTrack.groupId); clear.style.display="";
    mode.textContent='"'+activeTrack.title+'" - '+carriers.length+' release(s)';
  } else {
    clear.style.display="none";
    const q=document.getElementById("search").value.trim();
    const matches=searchMatchesFor(q);
    mode.textContent=q ? 'Find "'+q+'" - '+matches.length+' release(s)' : "Chronological release board";
  }
}
function selectTrack(releaseId,track) {
  if(Number(track.groupId)<0) return;
  selectedId=Number(releaseId);
  activeTrack={releaseId:Number(releaseId),groupId:Number(track.groupId),title:String(track.title||"")};
  updateRowHighlights(); drawConnections(); updateTrackMode();
  document.querySelectorAll(".track").forEach(function(el){
    el.classList.toggle("activeTrack",Number(el.dataset.group)===Number(activeTrack.groupId));
  });
}
function alternativesForTrack(t,wantFamily) {
  if(!state || !state.versionFamilies || !t || !t.baseKey) return [];
  const family=state.versionFamilies[t.baseKey]||[];
  return family.filter(function(v){
    return Number(v.groupId)!==Number(t.groupId) && String(v.family||"version")===String(wantFamily);
  });
}
function versionsForTrack(t) { return alternativesForTrack(t,"version"); }
function remixesForTrack(t) { return alternativesForTrack(t,"remix"); }
function liveForTrack(t) { return alternativesForTrack(t,"live"); }
function highlightAlternativeVersion(v) {
  if(!v || Number(v.groupId)<0 || Number(v.releaseId)<0) return;
  activeTrack={
    releaseId:Number(v.releaseId),
    groupId:Number(v.groupId),
    title:String(v.title||"Alternative version")
  };
  updateRowHighlights(); drawConnections(); updateTrackMode();
  document.querySelectorAll(".track").forEach(function(el){
    el.classList.toggle("activeTrack",Number(el.dataset.group)===Number(activeTrack.groupId));
  });
  const row=rowEls.get(String(v.releaseId));
  if(row) row.scrollIntoView({behavior:"smooth",block:"center",inline:"center"});
}
function trackStatus(t,n) {
  if(t.pendingIgnore) return "Pending ignore - Re-Analyze required";
  if(t.manualSkip) return "Ignored by you";
  if(n && n.manualRemoved){
    if(t.excluded) return "Skipped by active options";
    if(t.orphaned || !t.replacementSource) return "NO REPLACEMENT - exact recording is not retained elsewhere";
    const more=(t.replacementAlternates||[]).length;
    return "Sourced from: "+t.replacementSource+(more?" (+"+more+" other retained cop"+(more===1?"y":"ies")+")":"");
  }
  if(t.orphaned) return "Unique - release removal would lose it";
  if(t.isGem) return "Gem - no duplicates or other versions";
  if(t.unique) return "Unique to this retained release";
  if(t.coveredBy && t.coveredBy.length) return "Also on: "+t.coveredBy.slice(0,2).join("; ");
  if(t.excluded) return "Skipped by active options";
  if(t.distinction) return t.distinction;
  return "Included";
}
function closeDetails() {
  selectedId=null;
  activeTrack=null;
  const aside=document.getElementById("details");
  aside.classList.remove("open");
  updateRowHighlights();
  drawConnections();
  updateTrackMode();
}
function openDetails(n) {
  const aside=document.getElementById("details"), inner=document.getElementById("detailsInner");
  let tracks="";
  (n.tracks||[]).forEach(function(t){
    const cls=["track"]; if(t.orphaned) cls.push("orphan"); else if(t.unique) cls.push("unique");
    if(t.excluded) cls.push("skipped");
    if(t.manualSkip||t.pendingIgnore) cls.push("manual");
    if(activeTrack && Number(activeTrack.groupId)===Number(t.groupId)) cls.push("activeTrack");
    let action="";
    if(state.editable && !t.excluded){
      const label=(t.manualSkip||t.pendingIgnore)?"Restore":"Ignore";
      action='<button class="ignoreTrack" data-track="'+t.index+'">'+label+'</button>';
    }
    const versions=versionsForTrack(t), remixes=remixesForTrack(t), live=liveForTrack(t);
    let altButtons="";
    if(t.isGem) altButtons+='<span class="trackGem" title="Gem: no duplicates or other Versions">💎</span>';
    if(versions.length) altButtons+='<button class="versionsTrack" data-track="'+t.index+'">Versions '+versions.length+'</button>';
    if(remixes.length) altButtons+='<button class="remixesTrack" data-track="'+t.index+'">Remixes '+remixes.length+'</button>';
    if(live.length) altButtons+='<button class="liveTrack" data-track="'+t.index+'">Live '+live.length+'</button>';
    const versionsCell='<div class="versionsCell">'+altButtons+'</div>';
    const statusText=trackStatus(t,n);
    const statusClass=(n.manualRemoved&&!t.excluded)
      ?((t.orphaned||!t.replacementSource)?"status missing":"status replacement")
      :"status";
    tracks+='<div class="'+cls.join(" ")+'" data-group="'+t.groupId+'" data-index="'+t.index+'" title="'+esc(statusText)+'">'
      +'<div class="num">'+esc(t.number)+'</div><div class="titleText">'+esc(t.title)+'</div>'
      +'<div class="dur">'+esc(t.duration)+'</div>'+versionsCell+'<div class="'+statusClass+'">'+esc(statusText)+'</div>'+action+'</div>';
    function addAlternativePanel(items,kind){
      if(!items.length) return "";
      let rows="";
      items.forEach(function(v){
        const stateText=v.retained?"Retained":(v.available?"Available":"Ignored");
        const stateClass=v.retained?"retained":(v.available?"available":"");
        const releaseText=(v.retainedReleaseNames&&v.retainedReleaseNames.length?v.retainedReleaseNames:v.releaseNames||[]).slice(0,2).join("; ");
        rows+='<button class="altVersion" data-kind="'+kind+'" data-parent="'+t.index+'" data-group="'+v.groupId+'" data-release="'+v.releaseId+'">'
          +'<span class="altTitle">'+esc(v.title)+'</span><span class="altDuration">'+esc(v.duration||"")+'</span>'
          +'<span class="altState '+stateClass+'">'+esc(stateText)+'</span><span class="altReleases">'+esc(releaseText)+'</span></button>';
      });
      const panelClass=kind==="remix"?"altRemixes":(kind==="live"?"altLive":"altVersions");
      const headClass=kind==="remix"?"altRemixesHead":(kind==="live"?"altLiveHead":"altVersionsHead");
      const heading=kind==="remix"?"Remixes":(kind==="live"?"Live recordings":"Alternative versions - different audio groups, not duplicates");
      return '<div class="'+panelClass+'" data-for="'+t.index+'"><div class="'+headClass+'">'+heading+'</div>'+rows+'</div>';
    }
    tracks+=addAlternativePanel(versions,"version");
    tracks+=addAlternativePanel(remixes,"remix");
    tracks+=addAlternativePanel(live,"live");
  });
  let ignoreRelease="";
  if(state.editable && (n.kind==="retained" || n.manualRemoved || n.pendingReleaseChange)){
    const label=n.releaseBlocked?"Restore release":"Ignore release";
    const cls=n.releaseBlocked?"btn restore":"btn";
    ignoreRelease='<button class="'+cls+'" id="ignoreReleaseBtn">'+label+'</button>';
  }
  let ignoreNotice="";
  if(n.pendingReleaseIgnore){
    ignoreNotice='<div class="pendingNotice"><b>Pending Ignore.</b> Click Re-Analyze to calculate where every included track will be sourced from. No files have been moved.</div>';
  } else if(n.pendingReleaseRestore){
    ignoreNotice='<div class="pendingNotice"><b>Pending Restore.</b> Click Re-Analyze to put this release back into optimization. No files have been moved.</div>';
  } else if(n.manualRemoved){
    ignoreNotice='<div class="ignoredNotice"><b>Ignored by you.</b> This release stays on the map so you can inspect its replacement sources. To undo: click <b>Restore release</b>, then <b>Re-Analyze</b>.</div>';
  }
  const releaseMeta=n.manualRemoved
    ?"IGNORED BY YOU / "+n.action
    :(n.pendingReleaseIgnore
      ?"PENDING IGNORE / "+n.action
      :(n.pendingReleaseRestore
        ?"PENDING RESTORE / "+n.action
        :(n.kind==="duplicate"?"DUPLICATE / "+n.action:n.action)));
  inner.innerHTML='<div id="detailsHead"><button id="closeDetailsBtn" title="Close details" aria-label="Close details">×</button><div id="releaseName">'+esc(n.name)+'</div>'
    +'<div id="releaseMeta">'+esc(releaseMeta)
    +' | '+n.uniqueCount+' unique | '+n.includedTracks+' included</div>'
    +ignoreNotice+'<div id="releaseActions">'+ignoreRelease+'</div><div id="pathRow"><div id="releasePath">'+esc(n.path)+'</div>'
    +'<button class="btn" id="copyPathBtn">Copy</button><button class="btn" id="openFolderBtn">Open folder</button></div>'
    +'<div id="reason">'+esc(
      n.pendingReleaseIgnore
        ?"Pending user Ignore. Re-Analyze has not run yet, so replacement sources below still reflect the previous plan."
        :(n.pendingReleaseRestore
          ?"Pending user Restore. Re-Analyze has not run yet."
          :n.reason)
    )+'</div></div>'
    +'<div id="tracksTitle"><span>Tracks</span><small>Track = exact audio group; Versions, Remixes, and Live recordings are separate families</small></div>'
    +'<div id="tracks">'+tracks+'</div>';
  aside.classList.add("open");
  document.getElementById("closeDetailsBtn").onclick=closeDetails;
  document.getElementById("copyPathBtn").onclick=function(){bridge.copyPath(n.path);};
  document.getElementById("openFolderBtn").onclick=function(){bridge.openFolder(n.path);};
  const rb=document.getElementById("ignoreReleaseBtn"); if(rb) rb.onclick=function(){bridge.toggleRelease(Number(n.id),receiveState);};
  inner.querySelectorAll(".track").forEach(function(el){
    const index=Number(el.dataset.index), track=(n.tracks||[]).find(function(t){return Number(t.index)===index;});
    if(track) el.onclick=function(ev){
      if(ev.target && (
        ev.target.classList.contains("ignoreTrack")
        || ev.target.classList.contains("versionsTrack")
        || ev.target.classList.contains("remixesTrack")
        || ev.target.classList.contains("liveTrack")
      )) return;
      selectTrack(n.id,track);
    };
  });
  inner.querySelectorAll(".ignoreTrack").forEach(function(btn){
    btn.onclick=function(ev){ev.stopPropagation();bridge.toggleTrack(Number(btn.dataset.track),receiveState);};
  });
  inner.querySelectorAll(".versionsTrack").forEach(function(btn){
    btn.onclick=function(ev){
      ev.stopPropagation();
      const panel=inner.querySelector('.altVersions[data-for="'+btn.dataset.track+'"]');
      if(panel) panel.classList.toggle("open");
    };
  });
  inner.querySelectorAll(".remixesTrack").forEach(function(btn){
    btn.onclick=function(ev){
      ev.stopPropagation();
      const panel=inner.querySelector('.altRemixes[data-for="'+btn.dataset.track+'"]');
      if(panel) panel.classList.toggle("open");
    };
  });
  inner.querySelectorAll(".liveTrack").forEach(function(btn){
    btn.onclick=function(ev){
      ev.stopPropagation();
      const panel=inner.querySelector('.altLive[data-for="'+btn.dataset.track+'"]');
      if(panel) panel.classList.toggle("open");
    };
  });
  inner.querySelectorAll(".altVersion").forEach(function(btn){
    btn.onclick=function(ev){
      ev.stopPropagation();
      const parentIndex=Number(btn.dataset.parent);
      const parentTrack=(n.tracks||[]).find(function(t){return Number(t.index)===parentIndex;});
      const pool=btn.dataset.kind==="remix"
        ? remixesForTrack(parentTrack)
        :(btn.dataset.kind==="live" ? liveForTrack(parentTrack) : versionsForTrack(parentTrack));
      const version=(pool||[]).find(function(v){return Number(v.groupId)===Number(btn.dataset.group);});
      if(version) highlightAlternativeVersion(version);
    };
  });
}
function receiveState(raw) {
  state=JSON.parse(raw); renderPlanCounts(); updateButtons(); renderBoard();
  if(selectedId!=null && getNode(selectedId)) openDetails(getNode(selectedId));
  else document.getElementById("details").classList.remove("open");
  updateTrackMode(); renderResult();
}
function updateButtons() {
  const r=document.getElementById("reanalyzeBtn"), a=document.getElementById("applyBtn");
  r.disabled=!state.editable||!state.dirty; r.classList.toggle("dirty",!!state.dirty);
  a.disabled=!state.editable||!state.applyEnabled||!!state.dirty;
  a.classList.toggle("apply-ready",!!state.applyHighlighted&&!state.dirty);
}
function renderResult() {
  const drawer=document.getElementById("resultDrawer"), body=document.getElementById("resultBody");
  if(!state.result||!state.result.show){drawer.classList.remove("open");body.innerHTML="";return;}
  let html=""; (state.result.causes||[]).forEach(function(x){html+='<div class="resultLine">'+esc(x)+'</div>';});
  if(state.result.added&&state.result.added.length) html+='<div class="resultLine resultAdd">THEN added: '+state.result.added.map(esc).join("; ")+'</div>';
  if(state.result.removed&&state.result.removed.length) html+='<div class="resultLine resultRemove">THEN removed: '+state.result.removed.map(esc).join("; ")+'</div>';
  if((!state.result.added||!state.result.added.length)&&(!state.result.removed||!state.result.removed.length))
    html+='<div class="resultLine">THEN no release-selection change.</div>';
  (state.result.replacementSources||[]).forEach(function(group){
    html+='<div class="resultLine"><b>Ignored release remains on map:</b> '+esc(group.release)+'</div>';
    (group.tracks||[]).forEach(function(t){
      if(t.missing){
        html+='<div class="resultLine resultRemove">TRACK: '+esc(t.title)+' -> NO RETAINED REPLACEMENT</div>';
      } else {
        const more=(t.alternates||[]).length;
        html+='<div class="resultLine resultAdd">TRACK: '+esc(t.title)+' -> '+esc(t.source)
          +(more?' (+'+more+' other retained cop'+(more===1?'y':'ies')+')':'')+'</div>';
      }
    });
  });
  if(state.planCounts){
    const pc=state.planCounts, i=pc.initial||{}, r=pc.result||{}, d=pc.delta||{};
    html+='<div class="resultLine">FROM INITIAL: '
      +esc(i.releases)+' releases / '+esc(i.tracks)+' tracks -> '
      +esc(r.releases)+' releases ('+esc(signedCount(d.releases))+') / '
      +esc(r.tracks)+' tracks ('+esc(signedCount(d.tracks))+')</div>';
  }
  body.innerHTML=html; drawer.classList.add("open");
}
document.getElementById("clearTrackBtn").onclick=function(){
  activeTrack=null;updateRowHighlights();drawConnections();updateTrackMode();
  document.querySelectorAll(".track").forEach(function(el){el.classList.remove("activeTrack");});
};
document.getElementById("reanalyzeBtn").onclick=function(){bridge.reanalyze(receiveState);};
document.getElementById("applyBtn").onclick=function(){bridge.apply();};
document.getElementById("closeBtn").onclick=function(){bridge.closeMap();};
document.addEventListener("keydown",function(e){
  if(e.key==="Escape" && document.getElementById("details").classList.contains("open")){
    e.preventDefault();
    closeDetails();
  }
});
document.getElementById("search").addEventListener("input",function(){
  activeTrack=null;
  applySearchHighlights(true);
  drawConnections();
  updateTrackMode();
});
document.getElementById("search").addEventListener("keydown",function(e){
  if(e.key!=="Enter") return;
  const matches=searchMatchesFor(e.target.value);
  if(!matches.length) return;
  searchCursor=(searchCursor+1)%matches.length;
  const n=matches[searchCursor];
  selectedId=Number(n.id);
  activeTrack=null;
  openDetails(n);
  updateRowHighlights();
  drawConnections();
  updateTrackMode();
  const row=rowEls.get(String(n.id));
  if(row)row.scrollIntoView({behavior:"smooth",block:"center",inline:"center"});
});
window.addEventListener("resize",function(){clearTimeout(resizeTimer);resizeTimer=setTimeout(renderBoard,100);});
new ResizeObserver(function(){drawConnections();}).observe(document.getElementById("boardContent"));
new QWebChannel(qt.webChannelTransport,function(channel){bridge=channel.objects.bridge;bridge.getState(receiveState);});
</script>
</body>
</html>"""
    return html


def _release_date_sort_key_for_map(name: str) -> Tuple[int, int, int, str]:
    text = normalize_space(name)
    match = re.match(r"^\s*(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?", text)
    if not match:
        return (9999, 12, 31, text.casefold())
    return (
        int(match.group(1)),
        int(match.group(2) or 0),
        int(match.group(3) or 0),
        text.casefold(),
    )


def _release_map_plan_counts(
    snapshots: List[Dict[str, object]],
) -> Dict[str, int]:
    """Count the current proposed plan, not every row visible on the map."""
    retained = [
        item
        for item in snapshots
        if str(item.get("action", "")) in {"KEEP", "ADD", "REPLACE"}
        and not bool(item.get("manual_removed"))
    ]
    return {
        "releases": len(retained),
        "tracks": sum(
            max(0, int(item.get("included_tracks", 0) or 0))
            for item in retained
        ),
    }


def _release_map_state_for_ui(
    snapshots: List[Dict[str, object]],
    tracks: Optional[List[Track]],
    pending_track_indices: Set[int],
    pending_release_ids: Set[int],
    blocked_release_ids: Set[int],
    editable: bool,
    dirty: bool,
    apply_enabled: bool,
    apply_highlighted: bool,
    initial_plan_counts: Optional[Dict[str, int]] = None,
    result: Optional[Dict[str, object]] = None,
) -> Dict[str, object]:
    visible = [
        item
        for item in snapshots
        if bool(item.get("manual_removed"))
        or any(
            bool(row.get("included"))
            and int(row.get("group_id", -1) or -1) >= 0
            for row in (item.get("tracklist", []) or [])
        )
    ]
    visible.sort(key=lambda item: _release_date_sort_key_for_map(str(item.get("name", ""))))
    visible_ids = {int(item.get("release_id", -1)) for item in visible}

    # Build a display-only catalog of distinct recording groups that share the
    # same base song title. This intentionally does NOT merge those groups.
    # It only lets the Release Map show "other versions" (radio edit, album
    # version, remix, etc.) next to the currently selected track.
    version_group_catalog: Dict[str, Dict[int, Dict[str, object]]] = defaultdict(dict)
    for item in visible:
        rid = int(item.get("release_id", -1))
        release_name = str(item.get("name", ""))
        action = str(item.get("action", ""))
        release_retained = action in {"KEEP", "ADD", "REPLACE"}
        for row in item.get("tracklist", []) or []:
            base_key = (
                str(row.get("base_title_key", "") or "").strip()
                or _base_title_identity(str(row.get("title", "")))
            )
            group_id = int(row.get("group_id", -1) or -1)
            if not base_key or group_id < 0:
                continue
            group = version_group_catalog[base_key].setdefault(
                group_id,
                {
                    "aliases": set(),
                    "durations": [],
                    "families": set(),
                    "carriers": {},
                },
            )
            title = str(row.get("title", "") or "").strip()
            if title:
                group["aliases"].add(title)
            duration = str(row.get("duration", "") or "").strip()
            if duration and duration not in group["durations"]:
                group["durations"].append(duration)
            row_is_live = bool(
                row.get("is_live")
                or is_live_text(str(row.get("title", "")))
            )
            row_is_remix = bool(
                row.get("is_remix")
                or is_remix_text(str(row.get("title", "")))
            )
            if row_is_live:
                group["families"].add("live")
            elif row_is_remix:
                group["families"].add("remix")
            else:
                group["families"].add("version")
            included = bool(row.get("included")) and not bool(row.get("excluded"))
            carrier = group["carriers"].setdefault(
                rid,
                {
                    "id": rid,
                    "name": release_name,
                    "retained": False,
                    "included": False,
                },
            )
            carrier["retained"] = bool(carrier["retained"] or (release_retained and included))
            carrier["included"] = bool(carrier["included"] or included)

    version_families: Dict[str, List[Dict[str, object]]] = {}
    for base_key, groups in version_group_catalog.items():
        if len(groups) <= 1:
            continue
        family_rows: List[Dict[str, object]] = []
        for group_id, raw in groups.items():
            aliases = sorted(
                list(raw.get("aliases", set()) or set()),
                key=lambda value: (len(str(value)), str(value).casefold()),
            )
            carriers = sorted(
                list((raw.get("carriers", {}) or {}).values()),
                key=lambda row: (
                    0 if bool(row.get("retained")) else 1,
                    0 if bool(row.get("included")) else 1,
                    str(row.get("name", "")).casefold(),
                ),
            )
            retained_carriers = [row for row in carriers if bool(row.get("retained"))]
            available_carriers = [row for row in carriers if bool(row.get("included"))]
            preferred = retained_carriers or available_carriers or carriers
            raw_families = set(raw.get("families", set()) or set())
            # If the same exact audio has conflicting labels, prefer a normal
            # Version identity over a special-family alias; exact audio remains
            # one group either way.
            if "version" in raw_families:
                semantic_family = "version"
            elif "live" in raw_families:
                semantic_family = "live"
            else:
                semantic_family = "remix"
            family_rows.append(
                {
                    "groupId": int(group_id),
                    "title": aliases[0] if aliases else "Unknown version",
                    "family": semantic_family,
                    "isRemix": semantic_family == "remix",
                    "isLive": semantic_family == "live",
                    "aliases": aliases[:6],
                    "duration": (raw.get("durations", []) or [""])[0],
                    "releaseId": int(preferred[0].get("id", -1)) if preferred else -1,
                    "releaseIds": [int(row.get("id", -1)) for row in carriers],
                    "releaseNames": [str(row.get("name", "")) for row in carriers[:6]],
                    "retainedReleaseNames": [
                        str(row.get("name", "")) for row in retained_carriers[:6]
                    ],
                    "retained": bool(retained_carriers),
                    "available": bool(available_carriers),
                }
            )
        family_rows.sort(
            key=lambda row: (
                0 if bool(row.get("retained")) else 1,
                0 if bool(row.get("available")) else 1,
                str(row.get("title", "")).casefold(),
                int(row.get("groupId", -1)),
            )
        )
        version_families[base_key] = family_rows

    # Track-level Gem is the single source of truth for both track and release
    # Gem badges. Only Version-family alternatives disqualify it. Remixes and
    # Live recordings are separate families and therefore do not.
    all_version_groups_by_base: Dict[str, Set[int]] = defaultdict(set)
    all_release_carriers_by_group: Dict[int, Set[int]] = defaultdict(set)

    for item in snapshots:
        source_rid = int(item.get("release_id", -1))
        for row in item.get("tracklist", []) or []:
            base_key = (
                str(row.get("base_title_key", "") or "").strip()
                or _base_title_identity(str(row.get("title", "")))
            )
            group_id = int(row.get("group_id", -1) or -1)
            row_is_remix = bool(
                row.get("is_remix")
                or is_remix_text(str(row.get("title", "")))
            )
            row_is_live = bool(
                row.get("is_live")
                or is_live_text(str(row.get("title", "")))
            )
            if group_id >= 0:
                all_release_carriers_by_group[group_id].add(source_rid)
            if base_key and group_id >= 0 and not row_is_remix and not row_is_live:
                all_version_groups_by_base[base_key].add(group_id)
    nodes: List[Dict[str, object]] = []
    for item in visible:
        rid = int(item.get("release_id", -1))
        action = str(item.get("action", ""))
        retained = action in {"KEEP", "ADD", "REPLACE"}
        manual_removed = bool(item.get("manual_removed"))
        release_blocked = rid in blocked_release_ids
        pending_release_change = rid in pending_release_ids
        ui_tracks: List[Dict[str, object]] = []
        unique_count = 0
        gem_titles: List[str] = []
        for row in item.get("tracklist", []) or []:
            track_index = int(row.get("track_global_index", -1))
            unique = bool(row.get("unique_to_release")) if retained else False
            if unique:
                unique_count += 1
            manual_skip = bool(row.get("manual_skip"))
            is_remix = bool(
                row.get("is_remix")
                or is_remix_text(str(row.get("title", "")))
            )
            is_live = bool(
                row.get("is_live")
                or is_live_text(str(row.get("title", "")))
            )
            if tracks is not None and 0 <= track_index < len(tracks):
                manual_skip = bool(tracks[track_index].manual_skip_rule)
                is_remix = bool(tracks[track_index].is_remix)
                is_live = bool(tracks[track_index].is_live)
            semantic_family = "live" if is_live else ("remix" if is_remix else "version")
            base_key = (
                str(row.get("base_title_key", "") or "").strip()
                or _base_title_identity(str(row.get("title", "")))
            )
            group_id = int(row.get("group_id", -1) or -1)
            included = bool(row.get("included")) and not bool(row.get("excluded"))
            track_is_gem = bool(
                retained
                and included
                and group_id >= 0
                and base_key
                and semantic_family == "version"
                and len(all_release_carriers_by_group.get(group_id, set())) == 1
                and len(all_version_groups_by_base.get(base_key, set())) == 1
            )
            if track_is_gem:
                title = str(row.get("title", "") or "").strip()
                if title and title not in gem_titles:
                    gem_titles.append(title)

            ui_tracks.append(
                {
                    "index": track_index,
                    "number": row.get("number", ""),
                    "title": str(row.get("title", "")),
                    "duration": str(row.get("duration", "")),
                    "groupId": group_id,
                    "included": included,
                    "excluded": bool(row.get("excluded")),
                    "isRemix": is_remix,
                    "isLive": is_live,
                    "family": semantic_family,
                    "isGem": track_is_gem,
                    "manualSkip": manual_skip,
                    "pendingIgnore": track_index in pending_track_indices,
                    "unique": unique,
                    "orphaned": bool(row.get("orphaned")),
                    "coveredBy": list(row.get("covered_by_names", []) or []),
                    "replacementSource": str(row.get("replacement_source", "") or ""),
                    "replacementAlternates": list(row.get("replacement_alternates", []) or []),
                    "distinction": str(row.get("distinction", "")),
                    "baseKey": base_key,
                }
            )
        nodes.append(
            {
                "id": rid,
                "name": str(item.get("name", "")),
                "path": str(item.get("path", "")),
                "action": action,
                "kind": "retained" if retained else "duplicate",
                "outcome": str(item.get("outcome", "")),
                "manualRemoved": manual_removed,
                "releaseBlocked": release_blocked,
                "pendingReleaseChange": pending_release_change,
                "pendingReleaseIgnore": bool(pending_release_change and release_blocked),
                "pendingReleaseRestore": bool(pending_release_change and not release_blocked),
                "reason": str(item.get("reason", "")),
                "includedTracks": int(item.get("included_tracks", 0) or 0),
                "uniqueCount": unique_count,
                "isGem": bool(gem_titles),
                "gemTitles": gem_titles[:6],
                "tracks": ui_tracks,
            }
        )

    duplicate_links: List[Dict[str, int]] = []
    seen_links: Set[Tuple[int, int]] = set()
    snapshot_by_id = {int(item.get("release_id", -1)): item for item in visible}
    for item in visible:
        duplicate_id = int(item.get("release_id", -1))
        if str(item.get("action", "")) in {"KEEP", "ADD", "REPLACE"}:
            continue

        targets: List[int] = []
        for row in item.get("coverage", []) or []:
            target = int(row.get("release_id", -1))
            if target in visible_ids:
                targets.append(target)

        if not targets:
            for row in item.get("related", []) or []:
                target = int(row.get("release_id", -1))
                target_item = snapshot_by_id.get(target)
                if (
                    target_item is not None
                    and str(target_item.get("action", "")) in {"KEEP", "ADD", "REPLACE"}
                ):
                    targets.append(target)

        for target in targets:
            key = (duplicate_id, target)
            if key in seen_links or duplicate_id == target:
                continue
            seen_links.add(key)
            duplicate_links.append({"duplicate": duplicate_id, "retained": target})

    current_plan_counts = _release_map_plan_counts(snapshots)
    baseline = dict(initial_plan_counts or current_plan_counts)
    initial_releases = max(0, int(baseline.get("releases", 0) or 0))
    initial_tracks = max(0, int(baseline.get("tracks", 0) or 0))
    current_releases = max(0, int(current_plan_counts.get("releases", 0) or 0))
    current_tracks = max(0, int(current_plan_counts.get("tracks", 0) or 0))

    return {
        "editable": bool(editable),
        "dirty": bool(dirty),
        "applyEnabled": bool(apply_enabled),
        "applyHighlighted": bool(apply_highlighted),
        "planCounts": {
            "initial": {
                "releases": initial_releases,
                "tracks": initial_tracks,
            },
            "result": {
                "releases": current_releases,
                "tracks": current_tracks,
            },
            "delta": {
                "releases": current_releases - initial_releases,
                "tracks": current_tracks - initial_tracks,
            },
        },
        "nodes": nodes,
        "versionFamilies": version_families,
        "duplicateLinks": duplicate_links,
        "result": result or {"show": False, "causes": [], "added": [], "removed": [], "replacementSources": []},
    }


def _qt_release_map_process(session_path: Path, result_path: Path) -> int:
    ensure_qt_release_map_dependencies()
    from PySide6.QtCore import QObject, QTimer, QUrl, Signal, Slot
    from PySide6.QtGui import QDesktopServices
    from PySide6.QtWidgets import QApplication, QMainWindow
    from PySide6.QtWebChannel import QWebChannel
    from PySide6.QtWebEngineWidgets import QWebEngineView

    with session_path.open("rb") as handle:
        session = pickle.load(handle)

    class Bridge(QObject):
        closeRequested = Signal()

        def __init__(self):
            super().__init__()
            self.snapshots = list(session.get("snapshots", []) or [])
            self.releases = session.get("releases")
            self.tracks = session.get("tracks")
            self.groups = session.get("groups")
            self.selected = set(session.get("selected", set()) or set())
            self.reviews = list(session.get("reviews", []) or [])
            self.decisions = list(session.get("decisions", []) or [])
            self.blocked_release_ids = set(session.get("blocked_release_ids", set()) or set())
            self.editable = bool(
                session.get("allow_apply")
                and isinstance(self.releases, list)
                and isinstance(self.tracks, list)
                and isinstance(self.groups, dict)
            )
            self.dirty = False
            self.apply_enabled = bool(self.editable)
            self.apply_highlighted = False
            self.pending_track_indices: Set[int] = set()
            self.pending_release_ids: Set[int] = set()
            self.pending_causes: List[str] = []
            self.result = {"show": False, "causes": [], "added": [], "removed": [], "replacementSources": []}
            supplied_initial = session.get("initial_plan_counts")
            if isinstance(supplied_initial, dict):
                self.initial_plan_counts = {
                    "releases": max(0, int(supplied_initial.get("releases", 0) or 0)),
                    "tracks": max(0, int(supplied_initial.get("tracks", 0) or 0)),
                }
            else:
                self.initial_plan_counts = _release_map_plan_counts(self.snapshots)

        def _state(self) -> str:
            payload = _release_map_state_for_ui(
                self.snapshots,
                self.tracks if isinstance(self.tracks, list) else None,
                self.pending_track_indices,
                self.pending_release_ids,
                self.blocked_release_ids,
                self.editable,
                self.dirty,
                self.apply_enabled,
                self.apply_highlighted,
                self.initial_plan_counts,
                self.result,
            )
            return _json_ui_dumps(payload)

        def _mark_dirty(self, cause: str) -> None:
            self.dirty = True
            self.apply_enabled = False
            self.apply_highlighted = False
            self.result = {"show": False, "causes": [], "added": [], "removed": [], "replacementSources": []}
            if cause:
                self.pending_causes.append(cause)

        @Slot(result=str)
        def getState(self):
            return self._state()

        @Slot(int, result=str)
        def toggleTrack(self, track_index: int):
            if not self.editable or not isinstance(self.tracks, list):
                return self._state()
            if not (0 <= track_index < len(self.tracks)):
                return self._state()
            track = self.tracks[track_index]
            if track.manual_skip_rule:
                label = track.display_title
                remove_persistent_track_skip(track.manual_skip_rule, self.tracks)
                self.pending_track_indices.discard(track_index)
                self._mark_dirty(f'IF track: "{label}" restored')
            else:
                label = track.display_title
                add_persistent_track_skip(track, self.tracks)
                self.pending_track_indices.add(track_index)
                self._mark_dirty(f'IF track: "{label}" ignored')
            return self._state()

        @Slot(int, result=str)
        def toggleRelease(self, release_id: int):
            if not self.editable:
                return self._state()
            release = next((r for r in self.releases if r.rid == release_id), None)
            if release is None:
                return self._state()
            if release_id in self.blocked_release_ids:
                self.blocked_release_ids.remove(release_id)
                self.pending_release_ids.add(release_id)
                self._mark_dirty(f'IF release: "{release.path.name}" restored')
            else:
                self.blocked_release_ids.add(release_id)
                self.pending_release_ids.add(release_id)
                self._mark_dirty(f'IF release: "{release.path.name}" ignored')
            return self._state()

        @Slot(result=str)
        def reanalyze(self):
            if not self.editable or not self.dirty:
                return self._state()
            old_selected = set(self.selected)
            apply_persistent_track_skips(self.tracks)
            self.selected = optimize_collection(
                self.releases,
                self.groups,
                self.blocked_release_ids,
            )
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

            by_id = {r.rid: r for r in self.releases}
            added_ids = sorted(self.selected - old_selected)
            removed_ids = sorted(old_selected - self.selected)
            added = [by_id[rid].path.name for rid in added_ids if rid in by_id]
            removed = [by_id[rid].path.name for rid in removed_ids if rid in by_id]
            replacement_rows: List[Dict[str, object]] = []
            snapshot_by_id = {
                int(item.get("release_id", -1)): item
                for item in self.snapshots
            }
            for release_id in sorted(self.blocked_release_ids):
                snap = snapshot_by_id.get(release_id)
                if not snap or not bool(snap.get("manual_removed")):
                    continue
                rows: List[Dict[str, object]] = []
                for row in snap.get("tracklist", []) or []:
                    if not bool(row.get("included")) or bool(row.get("excluded")):
                        continue
                    source = str(row.get("replacement_source", "") or "")
                    alternates = list(row.get("replacement_alternates", []) or [])
                    rows.append({
                        "title": str(row.get("title", "")),
                        "source": source,
                        "alternates": alternates,
                        "missing": not bool(source),
                    })
                replacement_rows.append({
                    "release": str(snap.get("name", "")),
                    "tracks": rows,
                })

            self.result = {
                "show": True,
                "causes": list(self.pending_causes) or ["IF pending ignore changes applied"],
                "added": added,
                "removed": removed,
                "replacementSources": replacement_rows,
            }
            self.pending_causes.clear()
            self.pending_track_indices.clear()
            self.pending_release_ids.clear()
            self.dirty = False
            self.apply_enabled = True
            self.apply_highlighted = bool(added or removed)
            return self._state()

        @Slot(str)
        def openFolder(self, value: str):
            if value:
                QDesktopServices.openUrl(QUrl.fromLocalFile(value))

        @Slot(str)
        def copyPath(self, value: str):
            QApplication.clipboard().setText(value or "")

        @Slot()
        def apply(self):
            if not self.editable or self.dirty or not self.apply_enabled:
                return
            payload = {
                "action": "apply",
                "snapshots": self.snapshots,
                "selected": self.selected,
                "decisions": self.decisions,
                "blocked_release_ids": self.blocked_release_ids,
                "initial_plan_counts": self.initial_plan_counts,
            }
            with result_path.open("wb") as handle:
                pickle.dump(payload, handle, protocol=pickle.HIGHEST_PROTOCOL)
            self.closeRequested.emit()

        @Slot()
        def closeMap(self):
            with result_path.open("wb") as handle:
                pickle.dump(
                    {
                        "action": "close",
                        "snapshots": self.snapshots,
                        "selected": self.selected,
                        "decisions": self.decisions,
                        "blocked_release_ids": self.blocked_release_ids,
                        "initial_plan_counts": self.initial_plan_counts,
                    },
                    handle,
                    protocol=pickle.HIGHEST_PROTOCOL,
                )
            self.closeRequested.emit()

    app = QApplication.instance() or QApplication(sys.argv[:1])
    app.setApplicationName(APP_NAME)
    window = QMainWindow()
    window.setWindowTitle(f"{APP_NAME} {APP_VERSION} - Release Map")
    window.resize(1500, 920)
    window.setMinimumSize(1050, 680)

    view = QWebEngineView(window)
    channel = QWebChannel(view.page())
    bridge = Bridge()
    channel.registerObject("bridge", bridge)
    view.page().setWebChannel(channel)
    view.setHtml(_qt_release_map_html(), QUrl("https://cdn.jsdelivr.net/"))
    window.setCentralWidget(view)
    bridge.closeRequested.connect(window.close)

    def _window_closed():
        if not result_path.exists():
            try:
                with result_path.open("wb") as handle:
                    pickle.dump(
                        {
                            "action": "close",
                            "snapshots": bridge.snapshots,
                            "selected": bridge.selected,
                            "decisions": bridge.decisions,
                            "blocked_release_ids": bridge.blocked_release_ids,
                            "initial_plan_counts": bridge.initial_plan_counts,
                        },
                        handle,
                        protocol=pickle.HIGHEST_PROTOCOL,
                    )
            except Exception:
                pass
        app.quit()

    window.destroyed.connect(_window_closed)
    window.show()
    return app.exec()


def launch_qt_release_map(session: Dict[str, object]) -> Dict[str, object]:
    ensure_qt_release_map_dependencies()
    _migrate_legacy_app_data()
    temp_root = _temp_dir() / f"release-map-{int(time.time() * 1000)}-{os.getpid()}"
    temp_root.mkdir(parents=True, exist_ok=True)
    session_path = temp_root / "session.pkl"
    result_path = temp_root / "result.pkl"
    with session_path.open("wb") as handle:
        pickle.dump(session, handle, protocol=pickle.HIGHEST_PROTOCOL)

    python_exe = Path(sys.executable)
    if os.name == "nt" and python_exe.name.lower() == "python.exe":
        pythonw = python_exe.with_name("pythonw.exe")
        if pythonw.is_file():
            python_exe = pythonw

    if _is_frozen_build():
        cmd = [
            str(python_exe),
            "--qt-release-map",
            str(session_path),
            str(result_path),
        ]
    else:
        cmd = [
            str(python_exe),
            str(Path(__file__).resolve()),
            "--qt-release-map",
            str(session_path),
            str(result_path),
        ]
    kwargs = {"check": False}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    cp = subprocess.run(cmd, **kwargs)
    try:
        if result_path.is_file():
            with result_path.open("rb") as handle:
                result = pickle.load(handle)
        else:
            result = {"action": "close"}
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)
    if cp.returncode not in (0, None) and result.get("action") == "close":
        raise RuntimeError(f"Release Map exited with code {cp.returncode}.")
    return result



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
        if self.decision_callback is None:
            return
        try:
            self.grab_release()
        except Exception:
            pass
        try:
            self.decision_callback()
        finally:
            try:
                if self.winfo_exists():
                    self.grab_set()
                    self.focus_force()
            except Exception:
                pass

    def undo(self):
        if not messagebox.askyesno(APP_NAME, "Undo last run?", parent=self):
            return
        try:
            restored, conflicts = undo_last_run()
        except Exception as exc:
            messagebox.showerror(APP_NAME, str(exc), parent=self)
            return
        if conflicts:
            messagebox.showwarning(
                APP_NAME,
                f"Restored: {restored}\nConflicts: {len(conflicts)}",
                parent=self,
            )
        else:
            messagebox.showinfo(APP_NAME, f"Restored: {restored}", parent=self)
        self.destroy()



class ToolTip:
    def __init__(self, widget, text: str):
        self.widget = widget
        self.text = text
        self.tip = None
        widget.bind("<Enter>", self._show, add="+")
        widget.bind("<Leave>", self._hide, add="+")
        widget.bind("<ButtonPress>", self._hide, add="+")

    def _show(self, _event=None):
        if self.tip or not self.text:
            return
        try:
            x = self.widget.winfo_rootx() + 14
            y = self.widget.winfo_rooty() + self.widget.winfo_height() + 6
            self.tip = tk.Toplevel(self.widget)
            self.tip.wm_overrideredirect(True)
            self.tip.wm_geometry(f"+{x}+{y}")
            label = tk.Label(
                self.tip,
                text=self.text,
                justify="left",
                background=DARK_FIELD,
                foreground=DARK_FG,
                relief="solid",
                borderwidth=1,
                padx=8,
                pady=5,
                font=("Segoe UI", 9),
            )
            label.pack()
        except Exception:
            self.tip = None

    def _hide(self, _event=None):
        if self.tip is not None:
            try:
                self.tip.destroy()
            except Exception:
                pass
            self.tip = None


class PhraseReviewWindow(tk.Toplevel):
    """Analyze-time review of detected remix/live phrase families."""

    def __init__(
        self,
        master,
        candidates: List[Tuple[str, int, List[str]]],
        existing_rules: List[Dict[str, str]],
    ):
        super().__init__(master)
        self.title(f"{APP_NAME} - Personal Picks Review")
        self.geometry("900x650")
        self.minsize(760, 520)
        self.configure(background=DARK_BG)
        _enable_dark_titlebar(self)
        self.result: Optional[List[str]] = None
        self.candidates = list(candidates)
        self.added: Set[str] = set()

        self.existing = {
            _personal_pick_normalize(str(item.get("value", "")))
            for item in existing_rules
            if isinstance(item, dict) and str(item.get("value", "")).strip()
        }

        outer = ttk.Frame(self)
        outer.pack(fill="both", expand=True, padx=16, pady=14)

        ttk.Label(outer, text="Live / remix phrase review", font=("Segoe UI", 15, "bold")).pack(anchor="w")
        ttk.Label(
            outer,
            text=(
                "Detected from this analysis. Add only the live/remix families you personally want preserved. "
                "Existing Personal Picks are marked automatically. Continue starts the normal duplicate analysis."
            ),
            style="Help.TLabel",
            wraplength=850,
            justify="left",
        ).pack(anchor="w", pady=(5, 10))

        review_toolbar = ttk.Frame(outer)
        review_toolbar.pack(fill="x", pady=(0, 8))
        ttk.Button(
            review_toolbar,
            text="Copy all review text",
            command=self._copy_review_text,
        ).pack(side="left")

        body = ttk.Frame(outer)
        body.pack(fill="both", expand=True)
        canvas = tk.Canvas(body, background=DARK_BG, highlightthickness=0, borderwidth=0)
        scroll = ttk.Scrollbar(body, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        rows = ttk.Frame(canvas)
        window_id = canvas.create_window((0, 0), window=rows, anchor="nw")

        def sync_scroll(_event=None):
            canvas.configure(scrollregion=canvas.bbox("all"))
            canvas.itemconfigure(window_id, width=canvas.winfo_width())

        rows.bind("<Configure>", sync_scroll)
        canvas.bind("<Configure>", sync_scroll)
        canvas.bind("<MouseWheel>", lambda e: canvas.yview_scroll(int(-e.delta / 120), "units"))

        self.buttons: Dict[str, ttk.Button] = {}

        for row_index, (phrase, count, examples) in enumerate(self.candidates):
            key = _personal_pick_normalize(phrase)
            row = ttk.Frame(rows)
            row.grid(row=row_index, column=0, sticky="ew", pady=(0, 10))
            row.columnconfigure(0, weight=1)
            rows.columnconfigure(0, weight=1)

            kinds = []
            if is_live_text(phrase):
                kinds.append("Live")
            if is_remix_text(phrase):
                kinds.append("Remix")
            kind = " / ".join(kinds) if kinds else "Version"

            ttk.Label(
                row,
                text=f"{phrase}  [{kind}]  ({count})",
                font=("Segoe UI", 10, "bold"),
            ).grid(row=0, column=0, sticky="w")

            if examples:
                ttk.Label(
                    row,
                    text="Examples: " + "; ".join(examples[:3]),
                    style="Help.TLabel",
                    wraplength=650,
                    justify="left",
                ).grid(row=1, column=0, sticky="w", pady=(2, 0))

            if key in self.existing:
                ttk.Label(row, text="In keep list", style="Help.TLabel").grid(
                    row=0, column=1, rowspan=2, sticky="e", padx=(12, 0)
                )
            else:
                button = ttk.Button(
                    row,
                    text="Add to keep list",
                    command=lambda p=phrase, k=key: self._add_phrase(p, k),
                )
                button.grid(row=0, column=1, rowspan=2, sticky="e", padx=(12, 0))
                self.buttons[key] = button

            ttk.Button(
                row,
                text="Copy",
                command=lambda p=phrase, c=count, e=list(examples): self._copy_candidate(p, c, e),
            ).grid(row=0, column=2, rowspan=2, sticky="e", padx=(6, 0))

        footer = ttk.Frame(outer)
        footer.pack(fill="x", pady=(12, 0))
        ttk.Button(footer, text="Cancel", command=self._cancel).pack(side="right")
        ttk.Button(footer, text="Continue", command=self._accept).pack(side="right", padx=(0, 8))

        self.protocol("WM_DELETE_WINDOW", self._cancel)
        self.transient(master)
        self.grab_set()
        self.focus_force()

    def _candidate_copy_text(self, phrase: str, count: int, examples: List[str]) -> str:
        kinds: List[str] = []
        if is_live_text(phrase):
            kinds.append("Live")
        if is_remix_text(phrase):
            kinds.append("Remix")
        kind = " / ".join(kinds) if kinds else "Version"
        lines = [f"{phrase} [{kind}] ({count})"]
        if examples:
            lines.append("Examples: " + "; ".join(examples[:3]))
        return "\n".join(lines)

    def _copy_candidate(self, phrase: str, count: int, examples: List[str]) -> None:
        self.clipboard_clear()
        self.clipboard_append(self._candidate_copy_text(phrase, count, examples))
        self.update_idletasks()

    def _copy_review_text(self) -> None:
        text = "\n\n".join(
            self._candidate_copy_text(phrase, count, examples)
            for phrase, count, examples in self.candidates
        )
        self.clipboard_clear()
        self.clipboard_append(text)
        self.update_idletasks()

    def _add_phrase(self, phrase: str, key: str) -> None:
        if not key or key in self.existing or key in self.added:
            return
        self.added.add(key)
        button = self.buttons.get(key)
        if button is not None:
            button.configure(text="Added", state="disabled")

    def _accept(self) -> None:
        self.result = [
            phrase
            for phrase, _count, _examples in self.candidates
            if _personal_pick_normalize(phrase) in self.added
        ]
        self.destroy()

    def _cancel(self) -> None:
        self.result = None
        self.destroy()


class PersonalPicksWindow(tk.Toplevel):
    """Persistent exceptions to the global Remix/Live switches."""

    def __init__(self, master, rules: List[Dict[str, str]]):
        super().__init__(master)
        self.title(f"{APP_NAME} - Personal Picks")
        self.geometry("760x500")
        self.minsize(660, 430)
        self.configure(background=DARK_BG)
        _enable_dark_titlebar(self)
        self.result: Optional[List[Dict[str, str]]] = None
        self.rules: List[Dict[str, str]] = [
            {"mode": str(item.get("mode", "contains")), "value": str(item.get("value", ""))}
            for item in rules
            if isinstance(item, dict) and str(item.get("value", "")).strip()
        ]

        outer = ttk.Frame(self)
        outer.pack(fill="both", expand=True, padx=16, pady=14)

        ttk.Label(outer, text="Personal Picks", font=("Segoe UI", 15, "bold")).pack(anchor="w")
        ttk.Label(
            outer,
            text=(
                "These are exceptions to unchecked Save Remixes / Save Live recordings. "
                "A matched track participates normally in optimization; it does not force a specific release to stay. "
                "Phrase rules ignore case and punctuation, so 'Live From Capitol Studios' also matches year/punctuation variants."
            ),
            style="Help.TLabel",
            wraplength=720,
            justify="left",
        ).pack(anchor="w", pady=(5, 10))

        self.listbox = tk.Listbox(
            outer,
            background="#161616",
            foreground=DARK_FG,
            selectbackground=DARK_ACCENT,
            selectforeground=DARK_FG,
            relief="solid",
            borderwidth=1,
            font=("Segoe UI", 10),
            activestyle="none",
        )
        self.listbox.pack(fill="both", expand=True)
        self.listbox.bind("<Control-c>", self._copy_selected)
        self.listbox.bind("<Control-C>", self._copy_selected)
        self._refresh()

        entry_row = ttk.Frame(outer)
        entry_row.pack(fill="x", pady=(10, 0))
        self.value_var = tk.StringVar()
        entry = ttk.Entry(entry_row, textvariable=self.value_var)
        entry.pack(side="left", fill="x", expand=True)
        entry.bind("<Return>", lambda _e: self._add("contains"))
        ttk.Button(entry_row, text="Add phrase", command=lambda: self._add("contains")).pack(side="left", padx=(8, 0))
        ttk.Button(entry_row, text="Add exact title", command=lambda: self._add("exact")).pack(side="left", padx=(6, 0))

        toolbar = ttk.Frame(outer)
        toolbar.pack(fill="x", pady=(8, 0))
        ttk.Button(toolbar, text="Remove selected", command=self._remove).pack(side="left")
        ttk.Button(toolbar, text="Clear all", command=self._clear).pack(side="left", padx=(8, 0))
        ttk.Button(toolbar, text="Copy all", command=self._copy_all).pack(side="left", padx=(8, 0))

        footer = ttk.Frame(outer)
        footer.pack(fill="x", pady=(12, 0))
        ttk.Button(footer, text="Cancel", command=self._cancel).pack(side="right")
        ttk.Button(footer, text="Save", command=self._accept).pack(side="right", padx=(0, 8))

        self.protocol("WM_DELETE_WINDOW", self._cancel)
        self.transient(master)
        self.grab_set()
        entry.focus_set()

    def _refresh(self) -> None:
        self.listbox.delete(0, "end")
        for item in self.rules:
            mode = "Phrase" if item.get("mode") != "exact" else "Exact title"
            self.listbox.insert("end", f"{mode}: {item.get('value', '')}")

    def _add(self, mode: str) -> None:
        value = self.value_var.get().strip()
        if not value:
            return
        normalized = _personal_pick_normalize(value)
        if not normalized:
            return
        for item in self.rules:
            if (
                str(item.get("mode", "contains")).lower() == mode
                and _personal_pick_normalize(str(item.get("value", ""))) == normalized
            ):
                self.value_var.set("")
                return
        self.rules.append({"mode": mode, "value": value})
        self.value_var.set("")
        self._refresh()
        self.listbox.see("end")

    def _copy_selected(self, _event=None):
        indexes = list(self.listbox.curselection())
        if not indexes:
            return "break"
        lines = [self.listbox.get(index) for index in indexes]
        self.clipboard_clear()
        self.clipboard_append("\n".join(lines))
        self.update_idletasks()
        return "break"

    def _copy_all(self) -> None:
        lines = [self.listbox.get(index) for index in range(self.listbox.size())]
        self.clipboard_clear()
        self.clipboard_append("\n".join(lines))
        self.update_idletasks()

    def _remove(self) -> None:
        indexes = list(self.listbox.curselection())
        for index in reversed(indexes):
            if 0 <= index < len(self.rules):
                del self.rules[index]
        self._refresh()

    def _clear(self) -> None:
        self.rules.clear()
        self._refresh()

    def _accept(self) -> None:
        self.result = [dict(item) for item in self.rules]
        self.destroy()

    def _cancel(self) -> None:
        self.result = None
        self.destroy()


class PatternReviewWindow(tk.Toplevel):
    def __init__(self, master, patterns: List[Dict[str, object]], preferences: Dict[str, bool]):
        super().__init__(master)
        self.title(f"{APP_NAME} - Track Pattern Review")
        self.geometry("860x640")
        self.minsize(720, 480)
        self.configure(background=DARK_BG)
        _enable_dark_titlebar(self)
        self.result: Optional[Dict[str, bool]] = None
        self.vars: Dict[str, tk.BooleanVar] = {}

        outer = ttk.Frame(self)
        outer.pack(fill="both", expand=True, padx=16, pady=14)

        ttk.Label(outer, text="Unusual track pattern review", font=("Segoe UI", 15, "bold")).pack(anchor="w")
        ttk.Label(
            outer,
            text=(
                "Only unusual / non-standard patterns are shown. Standard families are recognized structurally, so prefixes "
                "such as artist/remixer names do not make Radio Edit, Instrumental, Acoustic, Demo, Session, "
                "Extended/VIP/Vocal Mix, 7\"/12\" versions, etc. appear here. "
                "Remix/live tracks stay controlled by Save Remixes / Save Live recordings."
            ),
            style="Help.TLabel",
            wraplength=810,
            justify="left",
        ).pack(anchor="w", pady=(5, 10))

        toolbar = ttk.Frame(outer)
        toolbar.pack(fill="x", pady=(0, 8))
        ttk.Button(toolbar, text="Check all", command=lambda: self._set_all(True)).pack(side="left")
        ttk.Button(toolbar, text="Uncheck all", command=lambda: self._set_all(False)).pack(side="left", padx=(8, 0))

        body = ttk.Frame(outer)
        body.pack(fill="both", expand=True)
        canvas = tk.Canvas(body, background=DARK_BG, highlightthickness=0, borderwidth=0)
        scroll = ttk.Scrollbar(body, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        rows = ttk.Frame(canvas)
        window_id = canvas.create_window((0, 0), window=rows, anchor="nw")

        def sync_scroll(_event=None):
            canvas.configure(scrollregion=canvas.bbox("all"))
            canvas.itemconfigure(window_id, width=canvas.winfo_width())

        rows.bind("<Configure>", sync_scroll)
        canvas.bind("<Configure>", sync_scroll)
        canvas.bind("<MouseWheel>", lambda e: canvas.yview_scroll(int(-e.delta / 120), "units"))

        for row_index, item in enumerate(patterns):
            key = str(item["key"])
            default = bool(preferences.get(key, True))
            var = tk.BooleanVar(value=default)
            self.vars[key] = var

            row = ttk.Frame(rows)
            row.grid(row=row_index, column=0, sticky="ew", pady=(0, 9))
            rows.columnconfigure(0, weight=1)

            count = int(item.get("count", 0))
            label = str(item.get("label", key))
            ttk.Checkbutton(row, text=f"{label} ({count})", variable=var).pack(anchor="w")

            variants = [str(x) for x in item.get("variants", [])]
            examples = [str(x) for x in item.get("examples", [])]
            details = []
            if len(variants) > 1:
                details.append("Variants: " + "; ".join(variants[:6]))
            if examples:
                details.append("Examples: " + "; ".join(examples[:3]))
            if details:
                ttk.Label(
                    row,
                    text=" | ".join(details),
                    style="Help.TLabel",
                    wraplength=790,
                    justify="left",
                ).pack(anchor="w", padx=(24, 0), pady=(2, 0))

        footer = ttk.Frame(outer)
        footer.pack(fill="x", pady=(12, 0))
        ttk.Button(footer, text="Cancel", command=self._cancel).pack(side="right")
        ttk.Button(footer, text="Continue", command=self._accept).pack(side="right", padx=(0, 8))

        self.protocol("WM_DELETE_WINDOW", self._cancel)
        self.transient(master)
        self.grab_set()
        self.focus_force()

    def _set_all(self, value: bool) -> None:
        for var in self.vars.values():
            var.set(value)

    def _accept(self) -> None:
        self.result = {key: bool(var.get()) for key, var in self.vars.items()}
        self.destroy()

    def _cancel(self) -> None:
        self.result = None
        self.destroy()


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"{APP_NAME} {APP_VERSION}")
        self.geometry("920x620")
        self.minsize(820, 560)
        _apply_dark_theme(self)
        saved = _load_app_settings()
        self.existing_var = tk.StringVar(value=saved.get("existing_discography", ""))
        self.recycle_var = tk.StringVar(value=saved.get("recycle_update_folder", ""))

        if "save_remixes" in saved:
            save_remixes = bool(saved.get("save_remixes"))
        else:
            save_remixes = not bool(saved.get("exclude_remixes", True))
        if "save_live" in saved:
            save_live = bool(saved.get("save_live"))
        else:
            save_live = not bool(saved.get("exclude_live", True))

        self.save_remixes_var = tk.BooleanVar(value=save_remixes)
        self.save_live_var = tk.BooleanVar(value=save_live)
        self.logging_var = tk.BooleanVar(value=bool(saved.get("logging_enabled", False)))
        saved_patterns = saved.get("unusual_pattern_preferences_v5", {})
        self.pattern_preferences: Dict[str, bool] = (
            {str(k): bool(v) for k, v in saved_patterns.items()} if isinstance(saved_patterns, dict) else {}
        )
        saved_personal = saved.get("personal_keep_rules_v1", [])
        self.personal_keep_rules: List[Dict[str, str]] = []
        if isinstance(saved_personal, list):
            for item in saved_personal:
                if not isinstance(item, dict):
                    continue
                mode = str(item.get("mode", "contains")).strip().lower()
                value = str(item.get("value", "")).strip()
                if mode in {"contains", "exact"} and value:
                    self.personal_keep_rules.append({"mode": mode, "value": value})
        self.status_var = tk.StringVar(value="Ready")
        self.progress_detail_var = tk.StringVar(value="")
        self.progress_var = tk.DoubleVar(value=0)
        self._running = False
        self._run_started_at = 0.0
        self._last_progress_stage = ""
        self._decision_snapshot: List[Dict[str, object]] = _load_decision_snapshot()
        self._live_release_map_session: Optional[Dict[str, object]] = None
        self._build()
        self.protocol("WM_DELETE_WINDOW", self.on_close)

    def _build(self):
        frm = ttk.Frame(self)
        frm.pack(fill="both", expand=True, padx=16, pady=14)
        frm.columnconfigure(0, weight=1)
        frm.rowconfigure(11, weight=1)

        ttk.Label(frm, text="Existing discography (optional)").grid(row=0, column=0, sticky="w", pady=(0, 3))
        existing_entry = ttk.Entry(frm, textvariable=self.existing_var)
        existing_entry.grid(row=1, column=0, sticky="ew")
        existing_buttons = ttk.Frame(frm)
        existing_buttons.grid(row=1, column=1, padx=(10, 0), sticky="e")
        ttk.Button(existing_buttons, text="Browse...", command=lambda: self.browse(self.existing_var)).pack(side="left")
        ttk.Button(existing_buttons, text="Clear", command=self.clear_existing).pack(side="left", padx=(6, 0))
        ToolTip(existing_entry, "Already processed collection. Leave blank to analyze only the new/update folder.")

        ttk.Label(frm, text="New / update releases").grid(row=2, column=0, sticky="w", pady=(12, 3))
        recycle_entry = ttk.Entry(frm, textvariable=self.recycle_var)
        recycle_entry.grid(row=3, column=0, sticky="ew")
        ttk.Button(frm, text="Browse...", command=lambda: self.browse(self.recycle_var)).grid(
            row=3, column=1, padx=(10, 0), sticky="e"
        )
        ToolTip(recycle_entry, "Folder containing releases to analyze and filter.")

        options = ttk.Frame(frm)
        options.grid(row=4, column=0, columnspan=2, sticky="w", pady=(14, 8))
        remix_cb = ttk.Checkbutton(
            options,
            text="Save Remixes",
            variable=self.save_remixes_var,
            command=self.save_settings,
        )
        remix_cb.pack(side="left")
        live_cb = ttk.Checkbutton(
            options,
            text="Save Live recordings",
            variable=self.save_live_var,
            command=self.save_settings,
        )
        live_cb.pack(side="left", padx=(18, 0))
        self.personal_picks_btn = ttk.Button(
            options,
            text=self._personal_picks_button_text(),
            command=self.edit_personal_picks,
        )
        self.personal_picks_btn.pack(side="left", padx=(18, 0))
        logging_cb = ttk.Checkbutton(
            options,
            text="Logging",
            variable=self.logging_var,
            command=self.save_settings,
        )
        logging_cb.pack(side="left", padx=(18, 0))
        self.open_logs_btn = ttk.Button(
            options,
            text="📁",
            width=3,
            command=self.open_logs_folder,
        )
        self.open_logs_btn.pack(side="left", padx=(4, 0))
        ToolTip(remix_cb, "Checked: remixes are included in comparison and selection. Unchecked: remixes are skipped.")
        ToolTip(live_cb, "Checked: live recordings are included in comparison and selection. Unchecked: live recordings are skipped.")
        ToolTip(self.personal_picks_btn, "Persistent exceptions: matching remix/live tracks are included even when their global checkbox is unchecked.")
        ToolTip(logging_cb, "Checked: write a detailed JSONL log for the audio comparison process.")
        ToolTip(self.open_logs_btn, "Open Duplicate Edition Analyzer logs folder.")

        match_label = ttk.Label(frm, text="Match: Chromaprint (audio only)", style="Help.TLabel")
        match_label.grid(row=5, column=0, columnspan=2, sticky="w", pady=(0, 10))
        ToolTip(match_label, "Titles, filenames, tags, barcodes, and folder names do not decide duplicate identity.")

        ttk.Label(frm, text="Progress", style="Section.TLabel").grid(
            row=6, column=0, columnspan=2, sticky="w", pady=(2, 5)
        )
        ttk.Label(frm, textvariable=self.status_var).grid(
            row=7, column=0, columnspan=2, sticky="w"
        )
        self.progress = ttk.Progressbar(frm, variable=self.progress_var, maximum=100)
        self.progress.grid(row=8, column=0, columnspan=2, sticky="ew", pady=(5, 3))
        ttk.Label(frm, textvariable=self.progress_detail_var, style="Help.TLabel").grid(
            row=9, column=0, columnspan=2, sticky="w"
        )

        ttk.Label(frm, text="Activity", style="Section.TLabel").grid(
            row=10, column=0, columnspan=2, sticky="w", pady=(12, 5)
        )
        self.activity = tk.Text(
            frm,
            height=9,
            wrap="word",
            background="#161616",
            foreground=DARK_FG,
            insertbackground=DARK_FG,
            selectbackground=DARK_ACCENT,
            relief="solid",
            borderwidth=1,
            font=("Cascadia Mono", 9),
            state="disabled",
        )
        self.activity.grid(row=11, column=0, columnspan=2, sticky="nsew")

        actions = ttk.Frame(frm)
        actions.grid(row=12, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        self.run_btn = ttk.Button(actions, text="Analyze", command=self.start)
        self.run_btn.pack(side="left")
        ttk.Button(actions, text="Undo last run", command=self.undo_main).pack(side="left", padx=(8, 0))
        self.decision_map_btn = ttk.Button(
            actions,
            text="Release Map...",
            command=self.open_decision_map,
            state="normal" if self._decision_snapshot else "disabled",
        )
        self.decision_map_btn.pack(side="left", padx=(8, 0))
        ttk.Button(actions, text="Close", command=self.on_close).pack(side="right")


    def _personal_picks_button_text(self) -> str:
        count = len(self.personal_keep_rules)
        return f"Personal Picks... ({count})" if count else "Personal Picks..."

    def edit_personal_picks(self):
        if self._running:
            return
        dialog = PersonalPicksWindow(self, self.personal_keep_rules)
        self.wait_window(dialog)
        if dialog.result is None:
            return
        self.personal_keep_rules = dialog.result
        self.personal_picks_btn.configure(text=self._personal_picks_button_text())
        self.save_settings()

    def _update_live_release_map_session(
        self,
        session: Dict[str, object],
        map_result: Dict[str, object],
    ) -> None:
        session["snapshots"] = list(map_result.get("snapshots", session.get("snapshots", [])) or [])
        session["selected"] = set(map_result.get("selected", session.get("selected", set())) or set())
        session["decisions"] = list(map_result.get("decisions", session.get("decisions", [])) or [])
        session["blocked_release_ids"] = set(
            map_result.get(
                "blocked_release_ids",
                session.get("blocked_release_ids", set()),
            ) or set()
        )
        incoming_initial = map_result.get("initial_plan_counts")
        if isinstance(incoming_initial, dict):
            session["initial_plan_counts"] = {
                "releases": max(0, int(incoming_initial.get("releases", 0) or 0)),
                "tracks": max(0, int(incoming_initial.get("tracks", 0) or 0)),
            }
        self._decision_snapshot = list(session["snapshots"])
        _save_decision_snapshot(self._decision_snapshot)

    def _apply_release_map_result(
        self,
        session: Dict[str, object],
        map_result: Dict[str, object],
    ) -> None:
        self._update_live_release_map_session(session, map_result)
        if map_result.get("action") != "apply":
            self.status_var.set("Analysis complete - plan not applied.")
            return

        existing = session.get("existing")
        recycle = session.get("recycle")
        releases = session.get("releases")
        decisions = list(session.get("decisions", []) or [])
        if not isinstance(recycle, Path) or not isinstance(releases, list):
            messagebox.showerror(
                APP_NAME,
                "The live analysis context is no longer available.",
                parent=self,
            )
            return

        counts = action_summary(decisions)
        intra_duplicates = plan_intra_release_duplicates(releases, decisions)
        to_move = counts["SKIP"] + counts["REMOVE"] + len(intra_duplicates)
        if to_move == 0:
            self.status_var.set("Analysis complete - no moves in current plan.")
            self._append_activity("Current plan contains no filesystem moves.")
            return

        self._live_release_map_session = None
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

    def open_decision_map(self):
        if self._running:
            return

        session = self._live_release_map_session
        if session is None:
            snapshots = self._decision_snapshot or _load_decision_snapshot()
            if not snapshots:
                messagebox.showinfo(
                    APP_NAME,
                    "No analyzed release decisions are available yet.",
                    parent=self,
                )
                return
            session = {
                "snapshots": snapshots,
                "allow_apply": False,
            }

        try:
            self.status_var.set("Opening Release Map")
            map_result = launch_qt_release_map(dict(session))
            if self._live_release_map_session is not None:
                self._apply_release_map_result(self._live_release_map_session, map_result)
            else:
                self.status_var.set("Ready")
        except Exception as exc:
            self.status_var.set("Release Map failed")
            messagebox.showerror(APP_NAME, f"Release Map failed:\n\n{exc}", parent=self)

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

    def open_logs_folder(self):
        _migrate_legacy_app_data()
        path = _logs_dir()
        path.mkdir(parents=True, exist_ok=True)
        try:
            if os.name == "nt":
                os.startfile(str(path))
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(path)])
            else:
                subprocess.Popen(["xdg-open", str(path)])
        except Exception as exc:
            messagebox.showerror(
                APP_NAME,
                f"Could not open logs folder:\n\n{exc}",
                parent=self,
            )

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
        self._live_release_map_session = None
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
            f"Release Map ready: {sum(1 for d in decisions if d.action in {'KEEP','ADD','REPLACE'})} retained release(s)"
        )

        summary_parts = [
            f"Retained recycle releases: {recycle_kept}",
            f"Hidden duplicate recycle releases: {counts['SKIP']}",
        ]
        if existing is not None:
            summary_parts.append(f"Hidden duplicate existing releases: {counts['REMOVE']}")
        if initial_intra_duplicates:
            summary_parts.append(
                f"Duplicate files inside retained releases: {len(initial_intra_duplicates)}"
            )
        if comparison_log:
            summary_parts.append("Detailed comparison logging is enabled.")

        session: Dict[str, object] = {
            "snapshots": list(self._decision_snapshot),
            "initial_plan_counts": _release_map_plan_counts(self._decision_snapshot),
            "allow_apply": True,
            "summary_text": " | ".join(summary_parts),
            "existing": existing,
            "recycle": recycle,
            "releases": releases,
            "tracks": tracks,
            "groups": groups,
            "selected": set(selected),
            "reviews": list(reviews),
            "decisions": list(decisions),
            "blocked_release_ids": set(blocked_release_ids),
        }
        self._live_release_map_session = session

        try:
            self.status_var.set("Opening Release Map")
            map_result = launch_qt_release_map(dict(session))
        except Exception as exc:
            self.status_var.set("Release Map failed")
            messagebox.showerror(APP_NAME, f"Release Map failed:\n\n{exc}", parent=self)
            return

        self._apply_release_map_result(session, map_result)

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
        self._live_release_map_session = None
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



def _qt_main_html() -> str:
    html = r'''<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Duplicate Edition Analyzer</title>
<script src="qrc:///qtwebchannel/qwebchannel.js"></script>
<style>
:root{
  color-scheme:dark;
  --bg:#0b0c0f;--panel:#11141a;--panel2:#171b22;--field:#181c23;--line:#2a303a;
  --text:#f3f6fb;--muted:#9ca7b8;--blue:#66a9ff;--cyan:#55d7ff;--red:#ef4444;
  --yellow:#f59e0b;--green:#22c55e;--shadow:0 14px 42px rgba(0,0,0,.28);
}
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--bg);color:var(--text);
  font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif;font-size:13px}
body{display:flex;flex-direction:column}
button,input{font:inherit}
button{user-select:none}
#topbar{
  min-height:58px;height:58px;display:flex;align-items:center;gap:10px;padding:0 18px;
  background:#101319;border-bottom:1px solid var(--line)
}
#appTitle{font-size:18px;font-weight:780;letter-spacing:-.01em}
#version{color:#8b98a9;font-size:12px}
#statusBadge{
  margin-left:auto;padding:5px 9px;border:1px solid #4b4221;border-radius:999px;
  color:#f3d17a;background:#201c10;font-size:11px;font-weight:700
}
#content{flex:1;min-height:0;display:grid;grid-template-rows:auto auto minmax(180px,1fr);gap:12px;
  padding:14px 18px 12px;overflow:auto}
.card{border:1px solid var(--line);border-radius:10px;background:var(--panel);box-shadow:var(--shadow)}
.cardHead{display:flex;align-items:center;justify-content:space-between;padding:11px 13px 8px}
.cardTitle{font-size:14px;font-weight:760}
.cardHint{color:var(--muted);font-size:11px}
.sources{padding:0 13px 13px}
.sourceBlock+.sourceBlock{margin-top:11px}
.labelRow{display:flex;align-items:baseline;gap:7px;margin-bottom:5px}
.fieldLabel{font-weight:650}
.optional{font-size:11px;color:#788495}
.pathRow{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:7px}
.pathRow.recycle{grid-template-columns:minmax(0,1fr) auto}
.pathInput{
  width:100%;height:34px;border:1px solid #37404d;border-radius:8px;background:var(--field);
  color:var(--text);padding:0 10px;outline:none
}
.pathInput:focus{border-color:var(--blue);box-shadow:0 0 0 2px rgba(102,169,255,.15)}
.btn,.iconBtn{
  height:34px;border:1px solid #3a4351;border-radius:8px;background:#1b2028;color:var(--text);
  padding:0 11px;cursor:pointer;transition:.12s ease
}
.btn:hover:not(:disabled),.iconBtn:hover:not(:disabled){background:#252c36;border-color:#596579}
.btn:disabled,.iconBtn:disabled{opacity:.38;cursor:default}
.btn.primary{background:#17324c;border-color:#3e78aa;color:#dff1ff;font-weight:720}
.btn.primary:hover:not(:disabled){background:#1e4265;border-color:#66a9ff}
.btn.danger{border-color:#8f3d45;background:#3a191d;color:#ffdadd}
.btn.success{border-color:#2d7d49;background:#12351f;color:#b8f7c9}
.iconBtn{width:34px;padding:0;display:inline-flex;align-items:center;justify-content:center}
.options{
  margin-top:13px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:12px;border-top:1px solid #222832
}
.toggle{display:inline-flex;align-items:center;gap:7px;color:#dce3ec;cursor:pointer;white-space:nowrap}
.toggle input{appearance:none;width:34px;height:18px;border-radius:999px;background:#303743;border:1px solid #46505e;
  position:relative;cursor:pointer;transition:.12s}
.toggle input:after{content:"";position:absolute;width:12px;height:12px;left:2px;top:2px;border-radius:50%;
  background:#aab4c1;transition:.12s}
.toggle input:checked{background:#1c5278;border-color:#4b8dbb}
.toggle input:checked:after{left:18px;background:#eaf7ff}
.matcher{margin-left:auto;color:#8f9bab;font-size:11px}
.progressCard{padding:12px 13px}
.progressTop{display:flex;align-items:center;gap:10px}
#progressStatus{font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#progressPercent{margin-left:auto;color:#b7c4d4;font-variant-numeric:tabular-nums}
.progressTrack{height:8px;margin-top:10px;border:1px solid #303844;border-radius:999px;background:#161a20;overflow:hidden}
#progressFill{height:100%;width:0;background:linear-gradient(90deg,#4c93ce,#55d7ff);transition:width .12s ease}
#progressDetail{margin-top:7px;color:var(--muted);font-size:11px;min-height:15px}
.activityCard{min-height:0;display:flex;flex-direction:column}
.activityCard .cardHead{padding-bottom:7px}
#activity{
  flex:1;min-height:120px;margin:0 13px 13px;padding:10px 11px;overflow:auto;border:1px solid #29303a;
  border-radius:8px;background:#0d1014;color:#d6dde6;white-space:pre-wrap;font-family:"Cascadia Mono","Consolas",monospace;
  font-size:12px;line-height:1.45
}
#footer{
  min-height:58px;height:58px;display:flex;align-items:center;gap:8px;padding:0 18px;
  border-top:1px solid var(--line);background:#101319
}
#footerSpacer{flex:1}
#modalBackdrop{
  display:none;position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.62);align-items:center;justify-content:center;padding:26px
}
#modalBackdrop.open{display:flex}
#modal{
  width:min(920px,94vw);max-height:88vh;display:flex;flex-direction:column;border:1px solid #3a4351;border-radius:12px;
  background:#11151b;box-shadow:0 26px 90px rgba(0,0,0,.58);overflow:hidden
}
#modalHead{padding:14px 16px 10px;border-bottom:1px solid #29303a}
#modalTitle{font-size:17px;font-weight:780}
#modalSubtitle{margin-top:4px;color:var(--muted);font-size:12px;line-height:1.45}
#modalBody{padding:12px 16px;overflow:auto;min-height:80px}
#modalFoot{display:flex;align-items:center;gap:8px;padding:11px 16px;border-top:1px solid #29303a}
.modalSpacer{flex:1}
.reviewRow{border:1px solid #29313c;border-radius:8px;padding:10px 11px;background:#151a21;margin-bottom:7px}
.reviewTop{display:flex;align-items:center;gap:10px}
.reviewTitle{font-weight:700;min-width:0;flex:1}
.reviewMeta{color:#9eabbc;font-size:11px;white-space:nowrap}
.reviewDetails{margin-top:4px;color:#8f9bab;font-size:11px;line-height:1.4}
.reviewCheck{width:16px;height:16px;accent-color:#66a9ff}
.picksEntry{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:7px;margin-bottom:10px}
.picksList{border:1px solid #29313c;border-radius:8px;overflow:hidden}
.pickRow{display:grid;grid-template-columns:90px minmax(0,1fr) auto;gap:9px;align-items:center;padding:8px 10px;
  border-bottom:1px solid #242b34;background:#14191f}
.pickRow:last-child{border-bottom:0}
.pickMode{color:#8fbfe4;font-size:11px;font-weight:700}
.pickValue{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{color:#7f8a99;padding:15px;text-align:center}
.msg{line-height:1.55;color:#dce3ec;white-space:pre-wrap}
.doneGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.doneStat{padding:9px 10px;border:1px solid #29313c;border-radius:8px;background:#151a21}
.doneStat b{display:block;font-size:16px;margin-top:2px}
.pathNote{margin-top:10px;padding:9px 10px;border:1px solid #29313c;border-radius:8px;background:#0e1115;
  color:#9eabbc;font-family:"Cascadia Mono","Consolas",monospace;font-size:11px;word-break:break-all}
</style>
</head>
<body>
<div id="topbar">
  <div id="appTitle">Duplicate / Edition Analyzer</div>
  <div id="version">v__APP_VERSION__</div>
  <div id="statusBadge">Under construction ⚠️</div>
</div>

<div id="content">
  <section class="card">
    <div class="cardHead"><div class="cardTitle">Source folders</div><div class="cardHint">Nothing is moved until Apply in Release Map</div></div>
    <div class="sources">
      <div class="sourceBlock">
        <div class="labelRow"><div class="fieldLabel">Existing discography</div><div class="optional">optional</div></div>
        <div class="pathRow">
          <input id="existingPath" class="pathInput" placeholder="Already processed collection">
          <button class="btn" id="browseExisting">Browse...</button>
          <button class="btn" id="clearExisting">Clear</button>
        </div>
      </div>
      <div class="sourceBlock">
        <div class="labelRow"><div class="fieldLabel">New / update releases</div></div>
        <div class="pathRow recycle">
          <input id="recyclePath" class="pathInput" placeholder="Folder containing releases to analyze and filter">
          <button class="btn" id="browseRecycle">Browse...</button>
        </div>
      </div>
      <div class="options">
        <label class="toggle" title="Checked: remixes participate normally. Unchecked: remixes are skipped.">
          <input type="checkbox" id="saveRemixes"><span>Save Remixes</span>
        </label>
        <label class="toggle" title="Checked: live recordings participate normally. Unchecked: live recordings are skipped.">
          <input type="checkbox" id="saveLive"><span>Save Live recordings</span>
        </label>
        <button class="btn" id="personalPicks">Personal Picks...</button>
        <label class="toggle" title="Write detailed JSONL audio-comparison logs.">
          <input type="checkbox" id="logging"><span>Logging</span>
        </label>
        <button class="iconBtn" id="openLogs" title="Open logs folder">📁</button>
        <div class="matcher">Match: Chromaprint (audio only)</div>
      </div>
    </div>
  </section>

  <section class="card progressCard">
    <div class="progressTop"><div id="progressStatus">Ready</div><div id="progressPercent">0%</div></div>
    <div class="progressTrack"><div id="progressFill"></div></div>
    <div id="progressDetail"></div>
  </section>

  <section class="card activityCard">
    <div class="cardHead"><div class="cardTitle">Activity</div><div class="cardHint" id="activityHint"></div></div>
    <div id="activity"></div>
  </section>
</div>

<div id="footer">
  <button class="btn primary" id="analyzeBtn">Analyze</button>
  <button class="btn" id="undoBtn">Undo last run</button>
  <button class="btn" id="mapBtn">Release Map...</button>
  <div id="footerSpacer"></div>
  <button class="btn" id="closeBtn">Close</button>
</div>

<div id="modalBackdrop">
  <div id="modal">
    <div id="modalHead"><div id="modalTitle"></div><div id="modalSubtitle"></div></div>
    <div id="modalBody"></div>
    <div id="modalFoot"></div>
  </div>
</div>

<script>
let bridge=null;
let state=null;
let modalKind="";
let localPicks=[];
let currentDone=null;

function esc(v){
  return String(v==null?"":v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#39;");
}
function formatElapsed(ms){
  let s=Math.max(0,Math.floor(ms/1000));
  const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);const sec=s%60;
  return h? h+":"+String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0")
          : String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0");
}
function currentDetail(){
  if(!state)return "";
  let text=String(state.progressCount||"");
  if(state.running&&state.runStartedEpochMs){
    const elapsed=formatElapsed(Date.now()-Number(state.runStartedEpochMs));
    text+=(text?" | ":"")+"Elapsed "+elapsed;
  }
  return text;
}
function renderState(raw){
  state=typeof raw==="string"?JSON.parse(raw):raw;
  document.getElementById("existingPath").value=state.existingPath||"";
  document.getElementById("recyclePath").value=state.recyclePath||"";
  document.getElementById("saveRemixes").checked=!!state.saveRemixes;
  document.getElementById("saveLive").checked=!!state.saveLive;
  document.getElementById("logging").checked=!!state.logging;
  document.getElementById("personalPicks").textContent=state.personalCount
    ?"Personal Picks... ("+state.personalCount+")":"Personal Picks...";
  document.getElementById("progressStatus").textContent=state.status||"Ready";
  const pct=Math.max(0,Math.min(100,Number(state.progressPct||0)));
  document.getElementById("progressFill").style.width=pct+"%";
  document.getElementById("progressPercent").textContent=Math.round(pct)+"%";
  document.getElementById("progressDetail").textContent=currentDetail();
  const act=(state.activity||[]).join("\n");
  const box=document.getElementById("activity");
  const atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<30;
  box.textContent=act;
  if(atBottom)box.scrollTop=box.scrollHeight;
  document.getElementById("activityHint").textContent=state.running?"Working":"";
  const busy=!!state.running||!!state.reviewPending||!!state.mapOpen;
  document.getElementById("analyzeBtn").disabled=busy;
  document.getElementById("undoBtn").disabled=busy;
  document.getElementById("mapBtn").disabled=busy||!state.mapAvailable;
  ["browseExisting","clearExisting","browseRecycle","saveRemixes","saveLive","personalPicks","logging","openLogs"].forEach(function(id){
    document.getElementById(id).disabled=!!state.running||!!state.reviewPending||!!state.mapOpen;
  });
  document.getElementById("existingPath").disabled=!!state.running||!!state.reviewPending||!!state.mapOpen;
  document.getElementById("recyclePath").disabled=!!state.running||!!state.reviewPending||!!state.mapOpen;
}
setInterval(function(){
  if(state&&state.running)document.getElementById("progressDetail").textContent=currentDetail();
},1000);

function openModal(kind,title,subtitle,bodyHtml,buttonsHtml){
  modalKind=kind;
  document.getElementById("modalTitle").textContent=title||"";
  document.getElementById("modalSubtitle").textContent=subtitle||"";
  document.getElementById("modalBody").innerHTML=bodyHtml||"";
  document.getElementById("modalFoot").innerHTML=buttonsHtml||"";
  document.getElementById("modalBackdrop").classList.add("open");
}
function closeModal(){
  modalKind="";
  document.getElementById("modalBackdrop").classList.remove("open");
}
function messageModal(title,message){
  openModal("message",title,"",'<div class="msg">'+esc(message)+'</div>',
    '<div class="modalSpacer"></div><button class="btn primary" id="msgOk">OK</button>');
  document.getElementById("msgOk").onclick=closeModal;
}
function confirmModal(title,message,yesText,onYes){
  openModal("confirm",title,"",'<div class="msg">'+esc(message)+'</div>',
    '<div class="modalSpacer"></div><button class="btn" id="confirmNo">Cancel</button>'
    +'<button class="btn danger" id="confirmYes">'+esc(yesText||"Continue")+'</button>');
  document.getElementById("confirmNo").onclick=closeModal;
  document.getElementById("confirmYes").onclick=function(){closeModal();onYes();};
}
function phraseReview(data){
  let rows="";
  (data.candidates||[]).forEach(function(c,i){
    rows+='<div class="reviewRow"><div class="reviewTop">'
      +'<input class="reviewCheck phraseKeep" type="checkbox" data-i="'+i+'" '+(c.existing?"checked disabled":"")+'>'
      +'<div class="reviewTitle">'+esc(c.phrase)+'</div><div class="reviewMeta">'+esc(c.kind)+' · '+esc(c.count)+'</div>'
      +'<button class="btn phraseCopy" data-i="'+i+'">Copy</button></div>'
      +(c.examples&&c.examples.length?'<div class="reviewDetails">Examples: '+esc(c.examples.slice(0,3).join("; "))+'</div>':"")
      +'</div>';
  });
  openModal("phrase","Live / remix phrase review",
    "Add only the live/remix families you personally want preserved. Existing Personal Picks are already checked.",
    rows||'<div class="empty">No candidates</div>',
    '<button class="btn" id="copyReview">Copy all review text</button><div class="modalSpacer"></div>'
    +'<button class="btn" id="phraseCancel">Cancel</button><button class="btn primary" id="phraseContinue">Continue</button>');
  document.querySelectorAll(".phraseCopy").forEach(function(btn){
    btn.onclick=function(){
      const c=data.candidates[Number(btn.dataset.i)];
      let t=c.phrase+" ["+c.kind+"] ("+c.count+")";
      if(c.examples&&c.examples.length)t+="\nExamples: "+c.examples.slice(0,3).join("; ");
      bridge.copyText(t);
    };
  });
  document.getElementById("copyReview").onclick=function(){
    const t=(data.candidates||[]).map(function(c){
      let s=c.phrase+" ["+c.kind+"] ("+c.count+")";
      if(c.examples&&c.examples.length)s+="\nExamples: "+c.examples.slice(0,3).join("; ");
      return s;
    }).join("\n\n");
    bridge.copyText(t);
  };
  document.getElementById("phraseCancel").onclick=function(){closeModal();bridge.cancelReview();};
  document.getElementById("phraseContinue").onclick=function(){
    const selected=[];
    document.querySelectorAll(".phraseKeep").forEach(function(cb){
      const c=data.candidates[Number(cb.dataset.i)];
      if(cb.checked&&!c.existing)selected.push(c.phrase);
    });
    closeModal();bridge.submitPhraseReview(JSON.stringify(selected));
  };
}
function patternReview(data){
  let rows="";
  (data.patterns||[]).forEach(function(p,i){
    rows+='<div class="reviewRow"><div class="reviewTop">'
      +'<input class="reviewCheck patternKeep" type="checkbox" data-i="'+i+'" '+(p.keep?"checked":"")+'>'
      +'<div class="reviewTitle">'+esc(p.label)+' ('+esc(p.count)+')</div></div>'
      +((p.variants&&p.variants.length)||(p.examples&&p.examples.length)
        ?'<div class="reviewDetails">'
          +(p.variants&&p.variants.length?'Variants: '+esc(p.variants.slice(0,6).join("; ")):"")
          +((p.variants&&p.variants.length)&&(p.examples&&p.examples.length)?" | ":"")
          +(p.examples&&p.examples.length?'Examples: '+esc(p.examples.slice(0,3).join("; ")):"")
          +'</div>':"")+'</div>';
  });
  openModal("pattern","Unusual track pattern review",
    "Checked patterns are kept. Unchecked patterns are skipped. Remix and Live remain controlled by their own switches.",
    rows||'<div class="empty">No unusual patterns</div>',
    '<button class="btn" id="patternsAll">Check all</button><button class="btn" id="patternsNone">Uncheck all</button>'
    +'<div class="modalSpacer"></div><button class="btn" id="patternCancel">Cancel</button>'
    +'<button class="btn primary" id="patternContinue">Continue</button>');
  document.getElementById("patternsAll").onclick=function(){document.querySelectorAll(".patternKeep").forEach(function(x){x.checked=true;});};
  document.getElementById("patternsNone").onclick=function(){document.querySelectorAll(".patternKeep").forEach(function(x){x.checked=false;});};
  document.getElementById("patternCancel").onclick=function(){closeModal();bridge.cancelReview();};
  document.getElementById("patternContinue").onclick=function(){
    const out={};
    document.querySelectorAll(".patternKeep").forEach(function(cb){
      const p=data.patterns[Number(cb.dataset.i)];out[p.key]=!!cb.checked;
    });
    closeModal();bridge.submitPatternReview(JSON.stringify(out));
  };
}
function renderPickRows(){
  const host=document.getElementById("pickRows");
  if(!host)return;
  if(!localPicks.length){host.innerHTML='<div class="empty">No Personal Picks</div>';return;}
  host.innerHTML=localPicks.map(function(p,i){
    return '<div class="pickRow"><div class="pickMode">'+(p.mode==="exact"?"Exact title":"Phrase")+'</div>'
      +'<div class="pickValue">'+esc(p.value)+'</div><button class="btn pickRemove" data-i="'+i+'">Remove</button></div>';
  }).join("");
  document.querySelectorAll(".pickRemove").forEach(function(btn){
    btn.onclick=function(){localPicks.splice(Number(btn.dataset.i),1);renderPickRows();};
  });
}
function personalPicksModal(raw){
  const data=typeof raw==="string"?JSON.parse(raw):raw;
  localPicks=(data.rules||[]).map(function(x){return {mode:x.mode==="exact"?"exact":"contains",value:String(x.value||"")};});
  openModal("picks","Personal Picks",
    "Exceptions to unchecked Save Remixes / Save Live recordings. Matches participate normally; they do not force a release to stay.",
    '<div class="picksEntry"><input class="pathInput" id="pickInput" placeholder="Phrase or exact track title">'
      +'<button class="btn" id="addPhrase">Add phrase</button><button class="btn" id="addExact">Add exact title</button></div>'
      +'<div class="picksList" id="pickRows"></div>',
    '<button class="btn" id="copyPicks">Copy all</button><button class="btn danger" id="clearPicks">Clear all</button>'
      +'<div class="modalSpacer"></div><button class="btn" id="picksCancel">Cancel</button>'
      +'<button class="btn primary" id="picksSave">Save</button>');
  renderPickRows();
  function add(mode){
    const input=document.getElementById("pickInput"),value=input.value.trim();if(!value)return;
    const key=value.toLowerCase().replace(/[^a-z0-9]+/g,"");
    if(!localPicks.some(function(p){return p.mode===mode&&p.value.toLowerCase().replace(/[^a-z0-9]+/g,"")===key;})){
      localPicks.push({mode:mode,value:value});renderPickRows();
    }
    input.value="";input.focus();
  }
  document.getElementById("addPhrase").onclick=function(){add("contains");};
  document.getElementById("addExact").onclick=function(){add("exact");};
  document.getElementById("pickInput").onkeydown=function(e){if(e.key==="Enter")add("contains");};
  document.getElementById("copyPicks").onclick=function(){
    bridge.copyText(localPicks.map(function(p){return (p.mode==="exact"?"Exact title: ":"Phrase: ")+p.value;}).join("\n"));
  };
  document.getElementById("clearPicks").onclick=function(){localPicks=[];renderPickRows();};
  document.getElementById("picksCancel").onclick=closeModal;
  document.getElementById("picksSave").onclick=function(){
    closeModal();bridge.savePersonalPicks(JSON.stringify(localPicks),renderState);
  };
  document.getElementById("pickInput").focus();
}
function doneModal(data){
  currentDone=data;
  const r=data.result||{};
  const body='<div class="doneGrid">'
    +'<div class="doneStat">Recycle releases kept<b>'+esc(r.remaining_recycle||0)+'</b></div>'
    +'<div class="doneStat">Redundant releases moved<b>'+esc(r.moved||0)+'</b></div>'
    +'<div class="doneStat">Duplicate files removed<b>'+esc(r.intra_duplicate_files||0)+'</b></div>'
    +'<div class="doneStat">Moved under !Remixes<b>'+esc(r.remix_moved||0)+'</b></div>'
    +'</div><div class="reviewDetails" style="margin-top:10px">Added: '+esc(r.add||0)
    +' · Replaced: '+esc(r.replace||0)+' · Recycle skipped: '+esc(r.skipped_recycle||0)
    +' · Existing removed: '+esc(r.removed_current||0)+'</div>'
    +'<div class="pathNote">Duplicates: '+esc(data.duplicates||"")+'</div>';
  openModal("done","Completed","Filesystem changes finished.",body,
    '<button class="btn" id="openRecycleDone">Open recycle</button>'
    +'<button class="btn" id="openDupDone">Open duplicates</button>'
    +'<button class="btn" id="undoDone">Undo last run</button>'
    +'<button class="btn" id="mapDone">Release Map...</button>'
    +'<div class="modalSpacer"></div><button class="btn primary" id="doneClose">Close</button>');
  document.getElementById("openRecycleDone").onclick=function(){bridge.openPath(data.recycle||"");};
  document.getElementById("openDupDone").onclick=function(){bridge.openPath(data.duplicates||"");};
  document.getElementById("undoDone").onclick=function(){
    confirmModal("Undo last run?","Restore files moved by the last Apply operation?","Undo",function(){bridge.undoLastRun();});
  };
  document.getElementById("mapDone").onclick=function(){closeModal();bridge.openReleaseMap();};
  document.getElementById("doneClose").onclick=closeModal;
}
function handleEvent(raw){
  const e=typeof raw==="string"?JSON.parse(raw):raw;
  if(e.type==="error"||e.type==="info"){messageModal(e.title||"Duplicate / Edition Analyzer",e.message||"");return;}
  if(e.type==="phraseReview"){phraseReview(e);return;}
  if(e.type==="patternReview"){patternReview(e);return;}
  if(e.type==="done"){doneModal(e);return;}
}
function syncPaths(){
  if(!bridge)return;
  bridge.setPaths(document.getElementById("existingPath").value,document.getElementById("recyclePath").value);
}

document.getElementById("browseExisting").onclick=function(){bridge.browseFolder("existing",renderState);};
document.getElementById("browseRecycle").onclick=function(){bridge.browseFolder("recycle",renderState);};
document.getElementById("clearExisting").onclick=function(){document.getElementById("existingPath").value="";bridge.setPaths("",document.getElementById("recyclePath").value,renderState);};
document.getElementById("existingPath").onchange=syncPaths;
document.getElementById("recyclePath").onchange=syncPaths;
document.getElementById("saveRemixes").onchange=function(){bridge.setOption("saveRemixes",this.checked,renderState);};
document.getElementById("saveLive").onchange=function(){bridge.setOption("saveLive",this.checked,renderState);};
document.getElementById("logging").onchange=function(){bridge.setOption("logging",this.checked,renderState);};
document.getElementById("openLogs").onclick=function(){bridge.openLogsFolder();};
document.getElementById("personalPicks").onclick=function(){bridge.getPersonalPicks(personalPicksModal);};
document.getElementById("analyzeBtn").onclick=function(){
  bridge.startAnalyze(
    document.getElementById("existingPath").value,
    document.getElementById("recyclePath").value,
    document.getElementById("saveRemixes").checked,
    document.getElementById("saveLive").checked,
    document.getElementById("logging").checked,
    renderState
  );
};
document.getElementById("undoBtn").onclick=function(){
  confirmModal("Undo last run?","Restore files moved by the last Apply operation?","Undo",function(){bridge.undoLastRun();});
};
document.getElementById("mapBtn").onclick=function(){bridge.openReleaseMap();};
document.getElementById("closeBtn").onclick=function(){bridge.closeApp();};

new QWebChannel(qt.webChannelTransport,function(channel){
  bridge=channel.objects.bridge;
  bridge.stateChanged.connect(renderState);
  bridge.eventRaised.connect(handleEvent);
  bridge.getState(renderState);
});
</script>
</body>
</html>'''
    return html.replace("__APP_VERSION__", APP_VERSION)


def _qt_main_app() -> int:
    ensure_qt_release_map_dependencies()
    from PySide6.QtCore import QObject, QUrl, Signal, Slot
    from PySide6.QtGui import QDesktopServices
    from PySide6.QtWidgets import QApplication, QFileDialog, QMainWindow
    from PySide6.QtWebChannel import QWebChannel
    from PySide6.QtWebEngineWidgets import QWebEngineView

    class MainBridge(QObject):
        stateChanged = Signal(str)
        eventRaised = Signal(str)
        closeRequested = Signal()

        def __init__(self):
            super().__init__()
            saved = _load_app_settings()
            self.existing_path = str(saved.get("existing_discography", "") or "")
            self.recycle_path = str(saved.get("recycle_update_folder", "") or "")
            if "save_remixes" in saved:
                self.save_remixes = bool(saved.get("save_remixes"))
            else:
                self.save_remixes = not bool(saved.get("exclude_remixes", True))
            if "save_live" in saved:
                self.save_live = bool(saved.get("save_live"))
            else:
                self.save_live = not bool(saved.get("exclude_live", True))
            self.logging_enabled = bool(saved.get("logging_enabled", False))
            saved_patterns = saved.get("unusual_pattern_preferences_v5", {})
            self.pattern_preferences: Dict[str, bool] = (
                {str(k): bool(v) for k, v in saved_patterns.items()}
                if isinstance(saved_patterns, dict)
                else {}
            )
            saved_personal = saved.get("personal_keep_rules_v1", [])
            self.personal_keep_rules: List[Dict[str, str]] = []
            if isinstance(saved_personal, list):
                for item in saved_personal:
                    if not isinstance(item, dict):
                        continue
                    mode = str(item.get("mode", "contains")).strip().lower()
                    value = str(item.get("value", "")).strip()
                    if mode in {"contains", "exact"} and value:
                        self.personal_keep_rules.append({"mode": mode, "value": value})

            self.status = "Ready"
            self.progress_pct = 0.0
            self.progress_count = ""
            self.activity: List[str] = []
            self.running = False
            self.review_pending = False
            self.map_open = False
            self.run_started_epoch_ms = 0
            self._last_progress_stage = ""
            self._last_emit = 0.0
            self._lock = threading.RLock()
            self._decision_snapshot: List[Dict[str, object]] = _load_decision_snapshot()
            self._live_release_map_session: Optional[Dict[str, object]] = None
            self._pending_analysis: Optional[Dict[str, object]] = None

        def _save_settings(self) -> None:
            _save_app_settings(
                self.existing_path,
                self.recycle_path,
                self.save_remixes,
                self.save_live,
                self.logging_enabled,
                self.pattern_preferences,
                self.personal_keep_rules,
            )

        def _state_payload(self) -> Dict[str, object]:
            with self._lock:
                return {
                    "existingPath": self.existing_path,
                    "recyclePath": self.recycle_path,
                    "saveRemixes": self.save_remixes,
                    "saveLive": self.save_live,
                    "logging": self.logging_enabled,
                    "personalCount": len(self.personal_keep_rules),
                    "status": self.status,
                    "progressPct": round(self.progress_pct, 3),
                    "progressCount": self.progress_count,
                    "activity": list(self.activity[-600:]),
                    "running": self.running,
                    "reviewPending": self.review_pending,
                    "mapOpen": self.map_open,
                    "runStartedEpochMs": self.run_started_epoch_ms,
                    "mapAvailable": bool(self._decision_snapshot),
                }

        def _state_json(self) -> str:
            return _json_ui_dumps(self._state_payload())

        def _emit_state(self, force: bool = True) -> None:
            now = time.monotonic()
            if not force and now - self._last_emit < 0.05:
                return
            self._last_emit = now
            self.stateChanged.emit(self._state_json())

        def _event(self, payload: Dict[str, object]) -> None:
            self.eventRaised.emit(_json_ui_dumps(payload))

        def _append_activity(self, text: str) -> None:
            if not text:
                return
            with self._lock:
                stamp = datetime.now().strftime("%H:%M:%S")
                self.activity.append(f"{stamp}  {text}")
                if len(self.activity) > 600:
                    self.activity = self.activity[-600:]

        def _clear_activity(self) -> None:
            with self._lock:
                self.activity.clear()

        def _set_running(self, running: bool) -> None:
            with self._lock:
                self.running = bool(running)
                if running:
                    self.run_started_epoch_ms = int(time.time() * 1000)
                else:
                    self.run_started_epoch_ms = 0
            self._emit_state()

        def _error(self, message: str, title: str = APP_NAME) -> None:
            with self._lock:
                self.running = False
                self.review_pending = False
                self.map_open = False
                self.status = "Failed"
                self.run_started_epoch_ms = 0
            self._append_activity(f"Failed: {message}")
            self._emit_state()
            self._event({"type": "error", "title": title, "message": message})

        def _info(self, message: str, title: str = APP_NAME) -> None:
            self._event({"type": "info", "title": title, "message": message})

        def _progress(self, text: str, current: int, total: int) -> None:
            pct = 0.0 if total <= 0 else (current / total) * 100.0
            stage = text.rstrip(".")
            stage_key = stage.split(" | ", 1)[0]
            with self._lock:
                if stage_key != self._last_progress_stage:
                    self._last_progress_stage = stage_key
                    self._append_activity(stage_key)
                self.status = stage
                self.progress_pct = pct
                self.progress_count = f"{current:,} / {total:,} ({pct:.0f}%)" if total > 0 else ""
            self._emit_state(force=(current >= total or current == 0))

        @Slot(result=str)
        def getState(self):
            return self._state_json()

        @Slot(str, str, result=str)
        def setPaths(self, existing: str, recycle: str):
            if self.running or self.review_pending or self.map_open:
                return self._state_json()
            self.existing_path = str(existing or "").strip()
            self.recycle_path = str(recycle or "").strip()
            self._save_settings()
            return self._state_json()

        @Slot(str, result=str)
        def browseFolder(self, kind: str):
            if self.running or self.review_pending or self.map_open:
                return self._state_json()
            current = self.existing_path if kind == "existing" else self.recycle_path
            start = current if current and Path(current).is_dir() else str(Path.home())
            title = "Select existing discography" if kind == "existing" else "Select new / update releases"
            chosen = QFileDialog.getExistingDirectory(QApplication.activeWindow(), title, start)
            if chosen:
                if kind == "existing":
                    self.existing_path = chosen
                else:
                    self.recycle_path = chosen
                self._save_settings()
            return self._state_json()

        @Slot(str, bool, result=str)
        def setOption(self, name: str, value: bool):
            if self.running or self.review_pending or self.map_open:
                return self._state_json()
            if name == "saveRemixes":
                self.save_remixes = bool(value)
            elif name == "saveLive":
                self.save_live = bool(value)
            elif name == "logging":
                self.logging_enabled = bool(value)
            self._save_settings()
            return self._state_json()

        @Slot(result=str)
        def getPersonalPicks(self):
            return json.dumps({"rules": self.personal_keep_rules}, ensure_ascii=False)

        @Slot(str, result=str)
        def savePersonalPicks(self, raw: str):
            if self.running or self.review_pending or self.map_open:
                return self._state_json()
            try:
                incoming = json.loads(raw or "[]")
            except Exception:
                incoming = []
            cleaned: List[Dict[str, str]] = []
            seen: Set[Tuple[str, str]] = set()
            if isinstance(incoming, list):
                for item in incoming:
                    if not isinstance(item, dict):
                        continue
                    mode = "exact" if str(item.get("mode", "")).lower() == "exact" else "contains"
                    value = str(item.get("value", "")).strip()
                    key = (mode, _personal_pick_normalize(value))
                    if value and key[1] and key not in seen:
                        seen.add(key)
                        cleaned.append({"mode": mode, "value": value})
            self.personal_keep_rules = cleaned
            self._save_settings()
            return self._state_json()

        @Slot(str)
        def copyText(self, value: str):
            QApplication.clipboard().setText(value or "")

        @Slot()
        def openLogsFolder(self):
            try:
                _migrate_legacy_app_data()
                path = _logs_dir()
                path.mkdir(parents=True, exist_ok=True)
                QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))
            except Exception as exc:
                self._event({"type": "error", "title": APP_NAME, "message": f"Could not open logs folder:\n\n{exc}"})

        @Slot(str)
        def openPath(self, value: str):
            if value:
                QDesktopServices.openUrl(QUrl.fromLocalFile(str(value)))

        @Slot()
        def closeApp(self):
            self._save_settings()
            self.closeRequested.emit()

        @Slot(str, str, bool, bool, bool, result=str)
        def startAnalyze(
            self,
            existing_text: str,
            recycle_text: str,
            save_remixes: bool,
            save_live: bool,
            logging_enabled: bool,
        ):
            if self.running or self.review_pending or self.map_open:
                return self._state_json()

            self.existing_path = str(existing_text or "").strip()
            self.recycle_path = str(recycle_text or "").strip()
            self.save_remixes = bool(save_remixes)
            self.save_live = bool(save_live)
            self.logging_enabled = bool(logging_enabled)
            self._save_settings()

            existing = Path(self.existing_path) if self.existing_path else None
            recycle = Path(self.recycle_path) if self.recycle_path else None
            if recycle is None or not recycle.is_dir():
                self._event({"type": "error", "title": APP_NAME, "message": "Invalid New / update releases folder."})
                return self._state_json()
            if existing is not None and not existing.is_dir():
                self._event({"type": "error", "title": APP_NAME, "message": "Invalid Existing discography folder."})
                return self._state_json()
            if existing is not None:
                try:
                    if (
                        existing.resolve() == recycle.resolve()
                        or _is_ancestor(existing, recycle)
                        or _is_ancestor(recycle, existing)
                    ):
                        self._event({
                            "type": "error",
                            "title": APP_NAME,
                            "message": "Existing and New / update folders must be separate and non-nested.",
                        })
                        return self._state_json()
                except Exception:
                    pass

            self._live_release_map_session = None
            self._pending_analysis = None
            self.review_pending = False
            self.progress_pct = 0.0
            self.progress_count = ""
            self.status = "Scanning phrases and track patterns"
            self._last_progress_stage = ""
            self._clear_activity()
            self._append_activity("Started")
            if self.logging_enabled:
                self._append_activity("Logging enabled")
            if self.personal_keep_rules:
                self._append_activity(f"Personal Picks: {len(self.personal_keep_rules)} rule(s)")
            self._set_running(True)

            threading.Thread(
                target=self._preflight_worker,
                args=(existing, recycle, self.save_remixes, self.save_live, self.logging_enabled),
                daemon=True,
            ).start()
            return self._state_json()

        def _preflight_worker(
            self,
            existing: Optional[Path],
            recycle: Path,
            save_remixes: bool,
            save_live: bool,
            logging_enabled: bool,
        ) -> None:
            try:
                releases, tracks = prepare_analysis(existing, recycle, self._progress)
                patterns = collect_track_patterns(tracks)
                phrase_candidates = (
                    detect_personal_pick_phrases_from_tracks(
                        tracks,
                        include_remixes=True,
                        include_live=save_live,
                    )
                    if save_remixes
                    else []
                )
                self._pending_analysis = {
                    "existing": existing,
                    "recycle": recycle,
                    "save_remixes": save_remixes,
                    "save_live": save_live,
                    "logging_enabled": logging_enabled,
                    "releases": releases,
                    "tracks": tracks,
                    "patterns": patterns,
                }
                self.running = False
                self.run_started_epoch_ms = 0
                self.review_pending = bool(phrase_candidates or patterns)
                self._emit_state()
                if phrase_candidates:
                    existing_keys = {
                        _personal_pick_normalize(str(item.get("value", "")))
                        for item in self.personal_keep_rules
                        if isinstance(item, dict)
                    }
                    rows = []
                    for phrase, count, examples in phrase_candidates:
                        kinds: List[str] = []
                        if is_live_text(phrase):
                            kinds.append("Live")
                        if is_remix_text(phrase):
                            kinds.append("Remix")
                        rows.append({
                            "phrase": phrase,
                            "count": int(count),
                            "examples": [str(x) for x in examples[:3]],
                            "kind": " / ".join(kinds) if kinds else "Version",
                            "existing": _personal_pick_normalize(phrase) in existing_keys,
                        })
                    self._event({"type": "phraseReview", "candidates": rows})
                    return
                self._append_activity("No skipped live/remix phrase candidates detected")
                self._show_pattern_review_or_continue()
            except Exception as exc:
                self._error(str(exc))

        @Slot(str)
        def submitPhraseReview(self, raw: str):
            if not self._pending_analysis:
                return
            try:
                selected = json.loads(raw or "[]")
            except Exception:
                selected = []
            existing_keys = {
                _personal_pick_normalize(str(item.get("value", "")))
                for item in self.personal_keep_rules
                if isinstance(item, dict)
            }
            added = 0
            if isinstance(selected, list):
                for phrase in selected:
                    phrase = str(phrase or "").strip()
                    key = _personal_pick_normalize(phrase)
                    if key and key not in existing_keys:
                        self.personal_keep_rules.append({"mode": "contains", "value": phrase})
                        existing_keys.add(key)
                        added += 1
            if added:
                self._save_settings()
                self._append_activity(f"Personal Picks: added {added} phrase(s)")
            else:
                self._append_activity("Personal Picks review complete: no new phrases added")
            self._show_pattern_review_or_continue()

        def _show_pattern_review_or_continue(self) -> None:
            ctx = self._pending_analysis or {}
            patterns = list(ctx.get("patterns", []) or [])
            if patterns:
                self.review_pending = True
                self._emit_state()
                rows = []
                for item in patterns:
                    key = str(item.get("key", ""))
                    rows.append({
                        "key": key,
                        "label": str(item.get("label", key)),
                        "count": int(item.get("count", 0) or 0),
                        "variants": [str(x) for x in item.get("variants", [])],
                        "examples": [str(x) for x in item.get("examples", [])],
                        "keep": bool(self.pattern_preferences.get(key, True)),
                    })
                self._event({"type": "patternReview", "patterns": rows})
                return
            self._append_activity("No version-style track patterns detected")
            self._begin_prepared_analysis(set())

        @Slot(str)
        def submitPatternReview(self, raw: str):
            if not self._pending_analysis:
                return
            try:
                result = json.loads(raw or "{}")
            except Exception:
                result = {}
            if not isinstance(result, dict):
                result = {}
            cleaned = {str(k): bool(v) for k, v in result.items()}
            self.pattern_preferences.update(cleaned)
            self._save_settings()
            excluded = {key for key, keep in cleaned.items() if not keep}
            self._append_activity(
                f"Pattern review complete: {len(cleaned)} pattern(s), {len(excluded)} excluded"
            )
            self._begin_prepared_analysis(excluded)

        @Slot()
        def cancelReview(self):
            if not self.review_pending:
                return
            self._pending_analysis = None
            self.review_pending = False
            self.running = False
            self.status = "Cancelled"
            self.progress_count = ""
            self._append_activity("Cancelled before audio comparison")
            self._emit_state()

        def _begin_prepared_analysis(self, excluded_pattern_keys: Set[str]) -> None:
            ctx = self._pending_analysis
            if not ctx:
                return
            self.review_pending = False
            self.status = "Continuing analysis"
            self.progress_pct = 0.0
            self.progress_count = ""
            self._last_progress_stage = ""
            self._set_running(True)
            threading.Thread(
                target=self._prepared_worker,
                args=(ctx, set(excluded_pattern_keys)),
                daemon=True,
            ).start()

        def _prepared_worker(self, ctx: Dict[str, object], excluded_pattern_keys: Set[str]) -> None:
            try:
                recycle = ctx["recycle"]
                assert isinstance(recycle, Path)
                logging_enabled = bool(ctx.get("logging_enabled"))
                comparison_log_path = _new_comparison_log_path(recycle) if logging_enabled else None
                result = analyze_prepared(
                    ctx["releases"],
                    ctx["tracks"],
                    True,
                    self._progress,
                    not bool(ctx.get("save_remixes")),
                    not bool(ctx.get("save_live")),
                    excluded_pattern_keys,
                    comparison_log_path,
                    [dict(item) for item in self.personal_keep_rules],
                )
                self._analysis_done(ctx, result)
            except Exception as exc:
                self._error(str(exc))

        def _analysis_done(self, ctx: Dict[str, object], result) -> None:
            self.running = False
            self.run_started_epoch_ms = 0
            self.review_pending = False
            self.progress_pct = 100.0
            self.progress_count = "100%"
            self._append_activity("Analysis complete")

            releases, tracks, groups, selected, reviews, notes = result
            comparison_log = next(
                (
                    n.split("COMPARISON LOG:", 1)[1].strip()
                    for n in notes
                    if n.startswith("COMPARISON LOG:")
                ),
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
                1
                for d in decisions
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
            self.status = "Analysis complete - review Release Map"
            retained_count = sum(
                1 for d in decisions if d.action in {"KEEP", "ADD", "REPLACE"}
            )
            self._append_activity(f"Release Map ready: {retained_count} retained release(s)")

            summary_parts = [
                f"Retained recycle releases: {recycle_kept}",
                f"Hidden duplicate recycle releases: {counts['SKIP']}",
            ]
            existing = ctx.get("existing")
            if existing is not None:
                summary_parts.append(f"Hidden duplicate existing releases: {counts['REMOVE']}")
            if initial_intra_duplicates:
                summary_parts.append(
                    f"Duplicate files inside retained releases: {len(initial_intra_duplicates)}"
                )
            if comparison_log:
                summary_parts.append("Detailed comparison logging is enabled.")

            session: Dict[str, object] = {
                "snapshots": list(self._decision_snapshot),
                "initial_plan_counts": _release_map_plan_counts(self._decision_snapshot),
                "allow_apply": True,
                "summary_text": " | ".join(summary_parts),
                "existing": existing,
                "recycle": ctx.get("recycle"),
                "releases": releases,
                "tracks": tracks,
                "groups": groups,
                "selected": set(selected),
                "reviews": list(reviews),
                "decisions": list(decisions),
                "blocked_release_ids": set(blocked_release_ids),
            }
            self._live_release_map_session = session
            self._pending_analysis = None
            self._emit_state()
            self._launch_release_map()

        def _update_live_release_map_session(
            self,
            session: Dict[str, object],
            map_result: Dict[str, object],
        ) -> None:
            session["snapshots"] = list(
                map_result.get("snapshots", session.get("snapshots", [])) or []
            )
            session["selected"] = set(
                map_result.get("selected", session.get("selected", set())) or set()
            )
            session["decisions"] = list(
                map_result.get("decisions", session.get("decisions", [])) or []
            )
            session["blocked_release_ids"] = set(
                map_result.get(
                    "blocked_release_ids",
                    session.get("blocked_release_ids", set()),
                )
                or set()
            )
            incoming_initial = map_result.get("initial_plan_counts")
            if isinstance(incoming_initial, dict):
                session["initial_plan_counts"] = {
                    "releases": max(0, int(incoming_initial.get("releases", 0) or 0)),
                    "tracks": max(0, int(incoming_initial.get("tracks", 0) or 0)),
                }
            self._decision_snapshot = list(session["snapshots"])
            _save_decision_snapshot(self._decision_snapshot)

        @Slot()
        def openReleaseMap(self):
            if self.running or self.review_pending or self.map_open:
                return
            self._launch_release_map()

        def _launch_release_map(self) -> None:
            if self.map_open:
                return
            session = self._live_release_map_session
            if session is None:
                snapshots = self._decision_snapshot or _load_decision_snapshot()
                if not snapshots:
                    self._info("No analyzed release decisions are available yet.")
                    return
                session = {
                    "snapshots": snapshots,
                    "allow_apply": False,
                }
            self.map_open = True
            self.status = "Opening Release Map"
            self._emit_state()
            threading.Thread(
                target=self._release_map_worker,
                args=(session, self._live_release_map_session is not None),
                daemon=True,
            ).start()

        def _release_map_worker(self, session: Dict[str, object], live: bool) -> None:
            try:
                map_result = launch_qt_release_map(dict(session))
                if live and self._live_release_map_session is not None:
                    self._handle_live_map_result(self._live_release_map_session, map_result)
                else:
                    self.map_open = False
                    self.status = "Ready"
                    self._emit_state()
            except Exception as exc:
                self.map_open = False
                self._error(f"Release Map failed:\n\n{exc}")

        def _handle_live_map_result(
            self,
            session: Dict[str, object],
            map_result: Dict[str, object],
        ) -> None:
            self._update_live_release_map_session(session, map_result)
            self.map_open = False
            if map_result.get("action") != "apply":
                self.status = "Analysis complete - plan not applied."
                self._emit_state()
                return

            existing = session.get("existing")
            recycle = session.get("recycle")
            releases = session.get("releases")
            decisions = list(session.get("decisions", []) or [])
            if not isinstance(recycle, Path) or not isinstance(releases, list):
                self._error("The live analysis context is no longer available.")
                return

            counts = action_summary(decisions)
            intra_duplicates = plan_intra_release_duplicates(releases, decisions)
            to_move = counts["SKIP"] + counts["REMOVE"] + len(intra_duplicates)
            if to_move == 0:
                self.status = "Analysis complete - no moves in current plan."
                self._append_activity("Current plan contains no filesystem moves.")
                self._emit_state()
                return

            self._live_release_map_session = None
            self.progress_pct = 0.0
            self.progress_count = ""
            self.status = "Applying moves"
            self._last_progress_stage = ""
            self._append_activity("Applying moves")
            self._set_running(True)
            try:
                result = apply_automatic_plan(
                    existing,
                    recycle,
                    releases,
                    decisions,
                    intra_duplicates,
                    self._progress,
                )
                self._apply_done(recycle, result)
            except Exception as exc:
                self._error(str(exc))

        def _apply_done(self, recycle: Path, result: Dict[str, object]) -> None:
            self.running = False
            self.run_started_epoch_ms = 0
            self.progress_pct = 100.0
            self.progress_count = "100%"
            self.status = "Complete"
            self._append_activity("Moves complete")
            self._emit_state()
            duplicates = str(result.get("duplicates", ""))
            self._event({
                "type": "done",
                "recycle": str(recycle),
                "duplicates": duplicates,
                "result": result,
            })

        @Slot()
        def undoLastRun(self):
            if self.running or self.review_pending or self.map_open:
                return
            self.status = "Undoing last run"
            self.progress_pct = 0.0
            self.progress_count = ""
            self._append_activity("Undo last run")
            self._set_running(True)
            threading.Thread(target=self._undo_worker, daemon=True).start()

        def _undo_worker(self) -> None:
            try:
                restored, conflicts = undo_last_run()
                self.running = False
                self.run_started_epoch_ms = 0
                self.status = "Ready"
                self.progress_pct = 0.0
                self.progress_count = ""
                self._append_activity(
                    f"Undo complete: restored {restored}, conflicts {len(conflicts)}"
                )
                self._emit_state()
                if conflicts:
                    self._info(
                        f"Restored: {restored}\nConflicts: {len(conflicts)}",
                        "Undo complete",
                    )
                else:
                    self._info(f"Restored: {restored}", "Undo complete")
            except Exception as exc:
                self._error(str(exc))

    app = QApplication.instance() or QApplication(sys.argv[:1])
    app.setApplicationName(APP_NAME)
    window = QMainWindow()
    window.setWindowTitle(f"{APP_NAME} {APP_VERSION}")
    window.resize(1040, 760)
    window.setMinimumSize(880, 640)

    view = QWebEngineView(window)
    channel = QWebChannel(view.page())
    bridge = MainBridge()
    channel.registerObject("bridge", bridge)
    view.page().setWebChannel(channel)
    view.setHtml(_qt_main_html(), QUrl("about:blank"))
    window.setCentralWidget(view)
    bridge.closeRequested.connect(window.close)
    window.show()
    return app.exec()

def _standalone_self_test() -> None:
    """Build-time smoke test for every dependency required by the standalone EXE."""
    if not _is_frozen_build():
        raise RuntimeError("--self-test is intended for the packaged standalone build.")
    ensure_qt_release_map_dependencies()
    ffmpeg, ffprobe = ensure_ffmpeg()
    fpcalc = ensure_fpcalc()
    score_log = ensure_heybrochecklog()
    arcue = ensure_cuetools_arcue()
    required = {
        "ffmpeg": ffmpeg,
        "ffprobe": ffprobe,
        "fpcalc": fpcalc,
        "CUETools.ARCUE": arcue or "",
    }
    missing = [name for name, value in required.items() if not value or not Path(value).is_file()]
    if missing:
        raise RuntimeError("Standalone dependency self-test failed: " + ", ".join(missing))
    if not callable(score_log):
        raise RuntimeError("Standalone dependency self-test failed: hey-bro-check-log")

    checks = [
        ([ffmpeg, "-version"], "ffmpeg"),
        ([ffprobe, "-version"], "ffprobe"),
        ([fpcalc, "-version"], "fpcalc"),
        ([arcue], "CUETools.ARCUE"),
    ]
    for command, label in checks:
        try:
            cp = run_hidden(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                errors="replace",
                check=False,
                timeout=20,
            )
        except Exception as exc:
            raise RuntimeError(
                f"Standalone dependency self-test could not start {label}: {exc}"
            ) from exc
        if label != "CUETools.ARCUE" and cp.returncode != 0:
            raise RuntimeError(
                f"Standalone dependency self-test failed to run {label}: "
                + (cp.stderr.strip() or cp.stdout.strip() or f"exit {cp.returncode}")
            )


    # v0.21.0 feature smoke test: prove the bundled FFmpeg build can execute the
    # exact EBU R128 + astats filter chain used for mastering comparison.
    with tempfile.TemporaryDirectory(prefix="dea-self-test-") as tmp_name:
        tone = Path(tmp_name) / "tone.wav"
        cp = run_hidden(
            [
                ffmpeg,
                "-hide_banner", "-loglevel", "error", "-y",
                "-f", "lavfi", "-i", "sine=frequency=1000:duration=1.5",
                "-c:a", "pcm_s16le",
                str(tone),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            errors="replace",
            check=False,
            timeout=30,
        )
        if cp.returncode != 0 or not tone.is_file():
            raise RuntimeError("Standalone dynamics self-test could not create test audio.")
        metrics = _measure_track_dynamic_range(
            ffmpeg,
            Track(release_id=-1, path=tone, index=1),
        )
        if metrics.get("lufs") is None or metrics.get("score") is None:
            raise RuntimeError("Standalone dynamics self-test returned incomplete metrics.")

    # Keep the phrase-review contract executable, not only documented.
    if _is_unusual_live_remix_phrase("BT Remix"):
        raise RuntimeError("Phrase review self-test failed: ordinary Remix was not suppressed.")
    if _is_unusual_live_remix_phrase("Hybrid Mix"):
        raise RuntimeError("Phrase review self-test failed: ordinary Mix was not suppressed.")
    if not _is_unusual_live_remix_phrase("Live at Wembley"):
        raise RuntimeError("Phrase review self-test failed: unusual live phrase was not surfaced.")


    # v0.21.1: excluded Remix/Live audio must disappear before fingerprints,
    # candidates and groups. The ONLY Save-Remixes exception is an explicit
    # featured-artist credit.
    test_release = Release(
        rid=-100,
        root_kind="recycle",
        path=Path("DEA self-test"),
        title="DEA self-test",
    )
    ordinary_remix = Track(
        release_id=-100,
        path=Path("Song (Example Remix).flac"),
        index=1,
        title="Song (Example Remix)",
        artist="BT",
    )
    featured_title_remix = Track(
        release_id=-100,
        path=Path("Song (Example Remix) (feat. Emma Hewitt).flac"),
        index=2,
        title="Song (Example Remix) (feat. Emma Hewitt)",
        artist="BT",
    )
    featured_artist_remix = Track(
        release_id=-100,
        path=Path("Song (Example Remix).flac"),
        index=3,
        title="Song (Example Remix)",
        artist="BT feat. Emma Hewitt",
    )
    live_track = Track(
        release_id=-100,
        path=Path("Song (Live at Wembley).flac"),
        index=4,
        title="Song (Live at Wembley)",
        artist="BT",
    )
    featured_live_remix = Track(
        release_id=-100,
        path=Path("Song (Example Remix) (Live) (feat. Emma Hewitt).flac"),
        index=5,
        title="Song (Example Remix) (Live) (feat. Emma Hewitt)",
        artist="BT",
    )
    test_release.tracks = [
        ordinary_remix,
        featured_title_remix,
        featured_artist_remix,
        live_track,
        featured_live_remix,
    ]
    configure_exclusions(
        [test_release],
        exclude_remixes=True,
        exclude_live=True,
        personal_keep_rules=[{"mode": "contains", "value": "Example Remix"}],
    )
    if not ordinary_remix.exclude_from_coverage:
        raise RuntimeError("Early exclusion self-test failed: ordinary remix survived.")
    if not featured_title_remix.remix_feature_exception or featured_title_remix.exclude_from_coverage:
        raise RuntimeError("Featured-remix self-test failed: title feature was not preserved.")
    if not featured_artist_remix.remix_feature_exception or featured_artist_remix.exclude_from_coverage:
        raise RuntimeError("Featured-remix self-test failed: ARTIST-tag feature was not preserved.")
    if not live_track.exclude_from_coverage:
        raise RuntimeError("Early exclusion self-test failed: live track survived.")
    if not featured_live_remix.exclude_from_coverage:
        raise RuntimeError("Early exclusion self-test failed: featured remix incorrectly bypassed Save Live.")


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--self-test":
        _standalone_self_test()
        raise SystemExit(0)
    if len(sys.argv) >= 2 and sys.argv[1] == "--version":
        raise SystemExit(0)
    if len(sys.argv) >= 4 and sys.argv[1] == "--qt-release-map":
        raise SystemExit(
            _qt_release_map_process(Path(sys.argv[2]), Path(sys.argv[3]))
        )
    if _is_frozen_build() and _startup_self_update():
        raise SystemExit(0)
    try:
        raise SystemExit(_qt_main_app())
    except SystemExit:
        raise
    except Exception as exc:
        _report_startup_crash(exc)
        raise


if __name__ == "__main__":
    try:
        import multiprocessing
        multiprocessing.freeze_support()
    except Exception:
        pass
    main()