# Duplicate / Edition Analyzer
# Automatic discography optimizer: performs track-by-track comparison, reports actions, never deletes files.

from __future__ import annotations

import itertools
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import traceback
import time
import unicodedata
import urllib.request
import zipfile
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

APP_NAME = "Duplicate / Edition Analyzer"
APP_VERSION = "0.7.6"
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

CHROMAPRINT_VERSION = "1.6.1"
CHROMAPRINT_URL = f"https://github.com/acoustid/chromaprint/releases/download/v{CHROMAPRINT_VERSION}/chromaprint-fpcalc-{CHROMAPRINT_VERSION}-windows-x86_64.zip"


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


def _common_settings_path() -> Path:
    return _documents_dir() / "Karpuzikov Tools" / "settings.json"


def _load_common_settings() -> dict:
    path = _common_settings_path()
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except Exception:
        pass
    return {}


def _save_common_settings(data: dict) -> None:
    path = _common_settings_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)
    except Exception:
        # Settings persistence must never prevent the analyzer from running.
        pass


def _load_app_settings() -> dict:
    store = _load_common_settings()
    apps = store.get("apps", {})
    app = apps.get("duplicate_edition_analyzer", {}) if isinstance(apps, dict) else {}
    return app if isinstance(app, dict) else {}


def _save_app_settings(existing_discography: str, recycle_update: str, exclude_remixes: bool = True, exclude_live: bool = True) -> None:
    store = _load_common_settings()
    apps = store.setdefault("apps", {})
    if not isinstance(apps, dict):
        apps = {}
        store["apps"] = apps
    apps["duplicate_edition_analyzer"] = {
        "existing_discography": existing_discography.strip(),
        "recycle_update_folder": recycle_update.strip(),
        "exclude_remixes": bool(exclude_remixes),
        "exclude_live": bool(exclude_live),
    }
    _save_common_settings(store)
FP_AUTO_SCORE = 5.0
FP_AUTO_GOOD_FRACTION = 0.90
FP_AUTO_EXCELLENT_FRACTION = 0.70
FP_AUTO_MEDIAN_MAX = 4.0
FP_AUTO_P90_MAX = 10
FP_MIN_OVERLAP = 0.85
FP_SILENCE_MIN_FRAMES = 120

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


def ascii_punctuation(text: str) -> str:
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


REMIX_TRACK_RE = re.compile(r"\b(?:remix(?:es|ed)?|dub)\b", re.I)
CLUB_MIX_RE = re.compile(r"\bclub\s+mix(?:es)?\b", re.I)
LIVE_TRACK_RE = re.compile(r"\blive\b", re.I)
REMIX_RELEASE_RE = re.compile(r"\bremix(?:es|ed)?\b", re.I)
VERSION_LABEL_RE = re.compile(r"[\(\[]\s*([^\)\]]*?\bversion)\s*[\)\]]", re.I)


def is_remix_text(text: str) -> bool:
    # "Mix" by itself is not enough to classify a remix. Explicit Remix/Dub
    # markers and Club Mix/Club Mixes are remix material. Original Mix,
    # Extended Mix, 12" Mix and 7" Mix remain wanted versions.
    normalized = ascii_punctuation(text or "")
    return bool(REMIX_TRACK_RE.search(normalized) or CLUB_MIX_RE.search(normalized))

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
    value = re.sub(r"[\[(]\s*[^)\]]*\b(?:remix(?:es|ed)?|dub|club\s+mix(?:es)?)\b[^)\]]*[\])]", " ", value, flags=re.I)
    value = re.sub(r"\b(?:remix(?:es|ed)?|dub|club\s+mix(?:es)?)\b", " ", value, flags=re.I)
    return re.sub(r"[^a-z0-9]+", "", normalize_title(value))


def configure_exclusions(releases: List["Release"], exclude_remixes: bool, exclude_live: bool) -> None:
    """Classify optional exclusions without changing audio-only duplicate identity.

    A remix with newly added featured performer(s) is protected from the remix
    exclusion. If no matching non-remix base version is present, a remix with an
    explicit featured credit is kept conservatively.
    """
    tracks = [track for rel in releases for track in rel.tracks]

    for track in tracks:
        track.is_remix = is_remix_text(track.display_title)
        track.is_live = is_live_text(track.display_title)
        track.remix_feature_exception = False

    non_remix_features: Dict[str, List[Set[str]]] = defaultdict(list)
    for track in tracks:
        if track.is_remix:
            continue
        key = remix_base_title_key(track.display_title)
        if key:
            non_remix_features[key].append(featured_artists(track))

    for track in tracks:
        remix_excluded = exclude_remixes and track.is_remix
        if remix_excluded:
            remix_features = featured_artists(track)
            if remix_features:
                key = remix_base_title_key(track.display_title)
                base_feature_sets = non_remix_features.get(key, [])
                same_features_exist = any(remix_features <= base for base in base_feature_sets)
                if not same_features_exist:
                    track.remix_feature_exception = True
                    remix_excluded = False

        track.exclude_from_coverage = remix_excluded or (exclude_live and track.is_live)

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
    advisory = tag_lookup(tags, "itunesadvisory", "rtng", "advisory")
    if advisory:
        av = advisory.strip().lower()
        if av in {"1", "explicit", "yes", "true"}:
            return "explicit"
        if av in {"2", "clean"}:
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
    if re.search(r"\bep\b|remix(?:es)?", x):
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


def ensure_ffmpeg() -> Tuple[str, str]:
    ffmpeg = locate_executable("ffmpeg")
    ffprobe = locate_executable("ffprobe")
    if ffmpeg and ffprobe:
        return ffmpeg, ffprobe

    winget = bootstrap_winget()
    if winget:
        run_hidden([
            winget, "install", "--id", "Gyan.FFmpeg", "-e", "--source", "winget",
            "--accept-package-agreements", "--accept-source-agreements", "--silent"
        ], check=False)
        ffmpeg = locate_executable("ffmpeg")
        ffprobe = locate_executable("ffprobe")
    if not (ffmpeg and ffprobe):
        raise RuntimeError("FFmpeg/FFprobe are required and could not be installed automatically.")
    return ffmpeg, ffprobe


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

    @property
    def display_title(self) -> str:
        return self.title or strip_track_number(self.path.stem)


@dataclass
class Release:
    rid: int
    root_kind: str
    path: Path
    title: str
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

    @property
    def track_count(self) -> int:
        return len(self.tracks)

    @property
    def wanted_track_count(self) -> int:
        return sum(1 for t in self.tracks if not t.exclude_from_coverage)

    @property
    def groups(self) -> Set[int]:
        return {t.group_id for t in self.tracks if t.group_id >= 0 and not t.exclude_from_coverage}

    @property
    def excluded_only(self) -> bool:
        return bool(self.tracks) and all(t.exclude_from_coverage for t in self.tracks)

    @property
    def has_remixes(self) -> bool:
        # Used only for duplicate destination routing. A package explicitly titled
        # Remixes belongs under !Remixes even when it also contains wanted versions.
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
        ffprobe, "-v", "error", "-show_entries", "format=duration:format_tags", "-of", "json", str(track.path)
    ]
    cp = run_hidden(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace", check=False)
    if cp.returncode != 0:
        raise RuntimeError(cp.stderr.strip() or "ffprobe failed")
    data = json.loads(cp.stdout or "{}")
    fmt = data.get("format") or {}
    track.duration = float(fmt.get("duration") or 0.0)
    tags = fmt.get("tags") or {}
    track.tags = {str(k): str(v) for k, v in tags.items()}
    track.title = tag_lookup(track.tags, "title") or strip_track_number(track.path.stem)
    track.artist = tag_lookup(track.tags, "artist")
    track.album = tag_lookup(track.tags, "album")
    track.mbid = tag_lookup(track.tags, "musicbrainztrackid", "musicbrainzrecordingid", "musicbrainz track id")
    track.isrc = tag_lookup(track.tags, "isrc")
    track.explicit = explicit_state(track.tags, track.title, track.path.name, track.album)


def locate_fpcalc() -> Optional[str]:
    p = locate_executable("fpcalc")
    if p:
        return p
    candidates = []
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
    for c in candidates:
        if c.exists():
            return str(c)
    return None


def ensure_fpcalc() -> str:
    fpcalc = locate_fpcalc()
    if fpcalc:
        return fpcalc
    if os.name != "nt":
        raise RuntimeError("fpcalc/Chromaprint is required.")

    # Respect the common dependency-bootstrap rule first. Chromaprint itself is
    # downloaded from the official AcoustID/Chromaprint release if not already available.
    bootstrap_winget()
    local = Path(os.environ.get("LOCALAPPDATA") or Path.home())
    target = local / "Karpuzikov" / "Discography Builder" / f"Chromaprint-{CHROMAPRINT_VERSION}"
    target.mkdir(parents=True, exist_ok=True)
    exe = target / "fpcalc.exe"
    if exe.exists():
        return str(exe)

    zip_path = target / "chromaprint.zip"
    try:
        urllib.request.urlretrieve(CHROMAPRINT_URL, zip_path)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(target)
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
    cmd = [fpcalc, "-length", "0", "-raw", "-json", str(track.path)]
    cp = run_hidden(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace", check=False)
    if cp.returncode not in (0, 3):
        raise RuntimeError(cp.stderr.strip() or "fpcalc failed")
    data = json.loads((cp.stdout or "{}").strip())
    fp = tuple(int(x) & 0xFFFFFFFF for x in (data.get("fingerprint") or []))
    if not fp:
        raise RuntimeError("fpcalc returned an empty fingerprint")
    return fp, float(data.get("duration") or track.duration or 0.0)


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

    Alignment is unrestricted so long leading/trailing silence or padding does not
    hide an otherwise identical recording.
    """
    if not fp1 or not fp2 or min(len(fp1), len(fp2)) < 20:
        return None

    positions = defaultdict(list)
    for i, value in enumerate(fp1):
        positions[(value >> 20) & 0xFFF].append(i)

    histogram = Counter()
    for j, value in enumerate(fp2):
        for i in positions.get((value >> 20) & 0xFFF, ()):
            histogram[i - j] += 1

    shifts = [x[0] for x in histogram.most_common(7)] or [0]
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


def fingerprint_auto_match(a: Track, b: Track) -> Tuple[bool, Optional[Tuple[float, float, float, int, float, float, int]]]:
    """High-confidence audio-only identity test.

    Filenames, titles, MBIDs and ISRCs never decide equivalence here. A strict
    Chromaprint match is required. Large duration differences are accepted only
    when the unmatched fingerprint region is silence/padding, which preserves
    extended/live/language variants while allowing hidden-track silence trims.
    """
    sim = fingerprint_similarity(a.fingerprint, b.fingerprint)
    if not sim:
        return False, None

    score, good, overlap, shift, excellent, median, p90 = sim
    if overlap < FP_MIN_OVERLAP:
        return False, sim
    if score > FP_AUTO_SCORE or good < FP_AUTO_GOOD_FRACTION:
        return False, sim
    if excellent < FP_AUTO_EXCELLENT_FRACTION or median > FP_AUTO_MEDIAN_MAX or p90 > FP_AUTO_P90_MAX:
        return False, sim

    longer = max(a.duration, b.duration, 1.0)
    shorter = min(a.duration, b.duration, longer)
    length_ratio = shorter / longer
    if length_ratio < 0.94 or abs(a.duration - b.duration) > max(12.0, 0.06 * longer):
        if not _unmatched_fingerprint_is_silence(a.fingerprint, b.fingerprint, shift):
            return False, sim

    return True, sim

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


DISC_FOLDER_RE = re.compile(r"^(?:cd|disc|disk)\\s*[-_. ]*\\d+\\b|^bonus\\s+(?:cd|disc|disk)\\b", re.I)


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
    """Whether an audio-containing parent is one release split into disc folders."""
    if not audio_children:
        return False
    return all(DISC_FOLDER_RE.search(child.name.strip()) for child in audio_children)


def _discover_release_containers(root: Path) -> List[Path]:
    """Recursively find actual release folders at any nesting depth.

    A folder with audio directly inside is a release. A parent whose audio-bearing
    children are CD/Disc folders is one multi-disc release. Other folders are
    treated as organizational containers and searched recursively.
    """
    containers: List[Path] = []

    def walk(folder: Path) -> None:
        direct_audio = _direct_audio_files(folder)
        audio_children = _audio_child_dirs(folder)

        if direct_audio:
            containers.append(folder)
            return

        if _is_multidisc_release_container(folder, audio_children):
            containers.append(folder)
            return

        try:
            children = sorted((p for p in folder.iterdir() if p.is_dir()), key=lambda p: p.name.lower())
        except OSError:
            return
        for child in children:
            audio, _ = _release_tree_files(child)
            if audio:
                walk(child)

    walk(root)
    return containers


def discover_releases(root: Path, root_kind: str, start_id: int) -> List[Release]:
    """Discover releases recursively while preserving multi-disc album folders."""
    releases: List[Release] = []
    rid = start_id

    for p in _discover_release_containers(root):
        audio, all_files = _release_tree_files(p)
        if not audio:
            continue
        title = release_title_from_folder(p.name)
        cue = any(f.suffix.lower() == ".cue" for f in all_files)
        logs = [f for f in all_files if f.suffix.lower() == ".log"]
        audiochecker = any(f.name.lower() == "audiochecker.log" for f in logs)
        rip_log = any(f.name.lower() != "audiochecker.log" for f in logs)
        quality = 100 if cue and rip_log else 75 if cue else 50 if audiochecker else 40
        rel = Release(
            rid=rid, root_kind=root_kind, path=p, title=title,
            source_quality=quality, has_cue=cue, has_rip_log=rip_log, has_audiochecker=audiochecker
        )
        for i, ap in enumerate(audio, 1):
            rel.tracks.append(Track(release_id=rid, path=ap, index=i))
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


def merge_equivalent_tracks(tracks: List[Track]) -> Tuple[Dict[int, List[int]], List[str]]:
    """Group recordings from audio fingerprints only.

    Track names/titles and metadata are intentionally not used as acceptance or
    rejection criteria. If the audio evidence is not strong enough, tracks stay
    separate so unique material is preserved.
    """
    uf = UnionFind(len(tracks))
    notes: List[str] = []
    tokens: List[Set[int]] = [_fingerprint_tokens(t.fingerprint) for t in tracks]

    candidate_pairs: Set[Tuple[int, int]] = set()
    for a, b in itertools.combinations(range(len(tracks)), 2):
        ta, tb = tracks[a], tracks[b]
        if not ta.fingerprint or not tb.fingerprint:
            continue
        if len(tokens[a] & tokens[b]) >= 3:
            candidate_pairs.add((a, b))

    for a, b in sorted(candidate_pairs):
        ta, tb = tracks[a], tracks[b]
        matched, sim = fingerprint_auto_match(ta, tb)
        if matched:
            uf.union(a, b)
            score, good, overlap, shift, excellent, median, p90 = sim
            notes.append(
                f"AUDIO MATCH: {ta.path.name} <-> {tb.path.name}; "
                f"score={score:.2f}, good={good:.0%}, excellent={excellent:.0%}, "
                f"overlap={overlap:.0%}, median={median:.1f}, p90={p90}, shift={shift}"
            )

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


def quality_key(rel: Release) -> Tuple[int, int, int]:
    # Explicit/clean is intentionally neutral until a real detector exists.
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
            # Remixes are skipped entirely for coverage/cost. Among otherwise
            # equivalent coverage, explicit and better source medium win.
            cost_per = max(1, r.wanted_track_count) / len(new)
            q, ex, existing = quality_key(r)
            key = (cost_per, -len(new), -ex, -q, 0 if r.root_kind == "existing" else 1, r.wanted_track_count, r.track_count, r.title.lower())
            if best_key is None or key < best_key:
                best_key = key
                best = r
        if best is None:
            break
        chosen.add(best.rid)
        missing -= best.groups
    return chosen, missing


def _explicit_rank(rel: Release) -> int:
    """Neutral placeholder until explicit/clean detection is implemented."""
    return 1


def _core_album_preference(combo: Tuple[Release, ...], core_groups: Set[int]) -> Tuple[int, int, int]:
    """Score equivalent album core content without rewarding duplicates.

    Priority for equivalent wanted content: source medium, then an
    already-processed existing release. Explicit/clean is currently ignored.
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


def choose_album_families(releases: List[Release]) -> Set[int]:
    selected: Set[int] = set()
    albums = [r for r in releases if r.release_type == "album" and not r.excluded_only]
    fams: Dict[str, List[Release]] = {}
    for r in albums:
        fams.setdefault(r.family or normalize_title(r.title), []).append(r)

    by_id = {r.rid: r for r in releases}
    for family in sorted(fams):
        candidates = fams[family]
        if any(r.rid in selected for r in candidates):
            continue
        universe: Set[int] = set().union(*(r.groups for r in candidates)) if candidates else set()
        core_groups: Set[int] = set(candidates[0].groups) if candidates else set()
        for r in candidates[1:]:
            core_groups &= r.groups

        best_selection: Optional[Set[int]] = None
        best_score = None
        max_combo = len(candidates) if len(candidates) <= 8 else 1
        combos: Iterable[Tuple[Release, ...]]
        if len(candidates) <= 8:
            combos = itertools.chain.from_iterable(itertools.combinations(candidates, n) for n in range(1, max_combo + 1))
        else:
            combos = ((r,) for r in candidates)

        for combo in combos:
            base = set(selected) | {r.rid for r in combo}
            covered = set().union(*(by_id[x].groups for x in base)) if base else set()
            missing = universe - covered
            ext_pool = [r for r in releases if r.family != family or r.release_type != "album"]
            extra, remain = greedy_cover(missing, ext_pool, base)
            if remain:
                continue
            new_ids = ({r.rid for r in combo} | extra) - selected
            new_rels = [by_id[x] for x in new_ids]

            # Important ordering:
            # 1) all wanted album/bonus coverage is already guaranteed here;
            # 2) CD/physical source wins over WEB for equivalent album core;
            # 3) existing processed copy wins equal-source ties;
            # 4) only then minimize duplicated wanted files/releases.
            # Explicit/clean is currently ignored until detection exists.
            core_explicit, core_source, core_existing = _core_album_preference(combo, core_groups)
            total_wanted_files = sum(r.wanted_track_count for r in new_rels)
            total_releases = len(new_rels)
            recycle_count = sum(r.root_kind == "recycle" for r in new_rels)
            total_physical_files = sum(r.track_count for r in new_rels)
            score = (
                -core_explicit,
                -core_source,
                -core_existing,
                total_wanted_files,
                total_releases,
                recycle_count,
                total_physical_files,
            )
            if best_score is None or score < best_score:
                best_score = score
                best_selection = set(new_ids)

        if best_selection is None:
            # Defensive fallback: keep the best source edition. Remix extras do
            # not make an otherwise preferable CD edition lose to WEB.
            chosen = min(
                candidates,
                key=lambda r: (
                    -_explicit_rank(r),
                    -source_rank(r),
                    0 if r.root_kind == "existing" else 1,
                    r.wanted_track_count,
                    r.track_count,
                ),
            )
            selected.add(chosen.rid)
        else:
            selected |= best_selection
    return selected



def _duration_compatible(a: Track, b: Track) -> bool:
    longer = max(a.duration, b.duration, 1.0)
    return abs(a.duration - b.duration) <= max(12.0, 0.06 * longer)


def _release_track_match(a: Track, b: Track) -> bool:
    if a.exclude_from_coverage or b.exclude_from_coverage:
        return False
    if a.group_id >= 0 and a.group_id == b.group_id:
        return True
    matched, _sim = fingerprint_auto_match(a, b)
    return matched


def _release_covers(covering: Release, target: Release) -> bool:
    """Whether covering contains every wanted track from target using audio only."""
    target_tracks = [t for t in target.tracks if not t.exclude_from_coverage]
    covering_tracks = [t for t in covering.tracks if not t.exclude_from_coverage]
    if not target_tracks:
        return True
    if len(covering_tracks) < len(target_tracks):
        return False
    used: Set[int] = set()
    for t in target_tracks:
        matches = [
            (i, c) for i, c in enumerate(covering_tracks)
            if i not in used and _release_track_match(c, t)
        ]
        if not matches:
            return False
        i, _c = min(
            matches,
            key=lambda pair: (
                0 if pair[1].group_id >= 0 and pair[1].group_id == t.group_id else 1,
                abs(pair[1].duration - t.duration),
            ),
        )
        used.add(i)
    return True


def _release_barcodes(rel: Release) -> Set[str]:
    values: Set[str] = set()
    if rel.tracks:
        tag = tag_lookup(rel.tracks[0].tags, "barcode", "upc", "ean")
        digits = re.sub(r"\D", "", tag)
        if 8 <= len(digits) <= 14:
            values.add(digits)
    return values


def _related_album_releases(a: Release, b: Release) -> bool:
    """Album-family grouping only; track duplicate identity remains audio-only."""
    if a.release_type != "album" or b.release_type != "album":
        return False
    if a.family and b.family and a.family == b.family:
        return True
    return bool(_release_barcodes(a) & _release_barcodes(b))


def _structural_track_match(a: Track, b: Track) -> bool:
    # Historical compatibility wrapper: never use titles/filenames for identity.
    return _release_track_match(a, b)


def _structural_release_covers(covering: Release, target: Release) -> bool:
    # Historical compatibility wrapper: coverage is audio-only.
    return _release_covers(covering, target)



def _content_preference(rel: Release) -> Tuple[int, int, int]:
    """Preference after wanted content equivalence has already been established."""
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
                # Same wanted content: source decides; existing wins ties. Explicit/clean is ignored.
                if er_quality >= rr_quality:
                    selected.add(er.rid)
                    selected.discard(rr.rid)
                else:
                    selected.add(rr.rid)
                    selected.discard(er.rid)
            else:
                # Existing is a wanted-content superset. If its source is not worse,
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
                best = max(candidates, key=lambda e: (_explicit_rank(e), source_rank(e), e.wanted_track_count, -e.track_count))
                selected.discard(rr.rid)
                selected.add(best.rid)
                changed = True
                break
        if changed:
            continue

        # The reverse is allowed only when recycle is objectively better on
        # source quality and covers the existing release's wanted content.
        for er in [r for r in releases if r.root_kind == "existing" and r.rid in selected]:
            candidates = [
                r for r in releases
                if r.root_kind == "recycle" and r.rid not in selected
                and _related_album_releases(er, r)
                and _release_covers(r, er)
                and (_explicit_rank(r), source_rank(r)) > (_explicit_rank(er), source_rank(er))
            ]
            if candidates:
                best = max(candidates, key=lambda r: (_explicit_rank(r), source_rank(r), r.wanted_track_count, -r.track_count))
                selected.discard(er.rid)
                selected.add(best.rid)
                changed = True
                break

    return selected


def _semantically_covered_by_selected(rel: Release, selected_rels: List[Release]) -> bool:
    if not rel.groups and not rel.wanted_track_count:
        return True
    related = [r for r in selected_rels if _related_album_releases(r, rel)]
    return any(_release_covers(r, rel) for r in related)


def find_dominated_releases(releases: List[Release]) -> Set[int]:
    """Resolve obvious same-album duplicates before global optimization.

    Rules:
    - If two related album releases have equivalent wanted content, prefer:
      CD/physical > WEB, existing > recycle.
    - If one related album release is a wanted-content superset of the other,
      it may replace the subset when its source class is not worse.
    - Explicit/clean is ignored until a real detector is implemented.
    - Tracks excluded by the active remix/live checkboxes are ignored by wanted coverage.
    """
    dominated: Set[int] = set()
    albums = [r for r in releases if r.release_type == "album" and not r.remix_only]

    for a, b in itertools.combinations(albums, 2):
        if not _related_album_releases(a, b):
            continue

        a_covers_b = _release_covers(a, b)
        b_covers_a = _release_covers(b, a)
        if not a_covers_b and not b_covers_a:
            continue

        a_es = (_explicit_rank(a), source_rank(a))
        b_es = (_explicit_rank(b), source_rank(b))

        if a_covers_b and b_covers_a:
            # Same wanted content: existing is the final tie-break after
            # source quality. Deterministic rid breaks absolute ties.
            a_pref = (_explicit_rank(a), source_rank(a), 1 if a.root_kind == "existing" else 0, -a.rid)
            b_pref = (_explicit_rank(b), source_rank(b), 1 if b.root_kind == "existing" else 0, -b.rid)
            if a_pref > b_pref:
                dominated.add(b.rid)
            elif b_pref > a_pref:
                dominated.add(a.rid)
            continue

        if a_covers_b and not b_covers_a:
            # A contains all wanted material from B plus more. Do not discard a
            # better-source subset (e.g. CD subset vs WEB deluxe), but when
            # source class is equal or better the superset makes B redundant.
            if a_es >= b_es:
                dominated.add(b.rid)
            continue

        if b_covers_a and not a_covers_b:
            if b_es >= a_es:
                dominated.add(a.rid)

    return dominated

def optimize_collection(releases: List[Release], groups: Dict[int, List[int]]) -> Set[int]:
    dominated = find_dominated_releases(releases)
    active = [r for r in releases if r.rid not in dominated]

    selected = choose_album_families(active)
    # Only recording groups not excluded by the active checkboxes are wanted.
    # This is critical: a semantically duplicate recycle copy must not create
    # synthetic "missing" groups just because fingerprint grouping was stricter.
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
                        r.wanted_track_count,
                        -_explicit_rank(r),
                        -source_rank(r),
                        0 if r.root_kind == "existing" else 1,
                        r.track_count,
                    ),
                )
                selected.add(chosen.rid)

    selected = stabilize_equivalent_sources(active, selected)
    selected = enforce_existing_precedence(releases, selected)
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
    if t.mbid:
        bits.append(f"MBID={t.mbid}")
    if t.isrc:
        bits.append(f"ISRC={t.isrc}")
    if t.explicit != "unknown":
        bits.append(t.explicit)
    return " | ".join(bits)


def analyze(existing: Optional[Path], recycle: Path, use_fingerprint: bool, progress_cb, exclude_remixes: bool = True, exclude_live: bool = True) -> Tuple[List[Release], List[Track], Dict[int, List[int]], Set[int], List[Tuple[int, int, str]], List[str]]:
    bootstrap_winget()
    ffmpeg, ffprobe = ensure_ffmpeg()
    fpcalc = ensure_fpcalc() if use_fingerprint else None
    releases: List[Release] = []
    if existing is not None:
        releases = discover_releases(existing, "existing", 0)
    releases += discover_releases(recycle, "recycle", len(releases))
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

    # Exclusions depend on tags/titles, so classify them before the expensive
    # fingerprint stage. Tracks excluded from wanted coverage do not need a
    # fingerprint at all. Feature-remix exceptions remain included and are
    # therefore still fingerprinted.
    finalize_release_metadata(releases)
    configure_exclusions(releases, exclude_remixes, exclude_live)

    if use_fingerprint and fpcalc:
        fingerprint_tracks = [t for t in tracks if not t.exclude_from_coverage]
        fp_workers = min(len(fingerprint_tracks) or 1, _fingerprint_workers())
        skipped = len(tracks) - len(fingerprint_tracks)
        label = f"Generating Chromaprint fingerprints ({fp_workers} workers"
        if skipped:
            label += f", {skipped} excluded tracks skipped"
        label += ")..."
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
    groups, merge_notes = merge_equivalent_tracks(tracks)
    errors.extend(merge_notes)
    selected = optimize_collection(releases, groups)
    reviews = review_candidates(tracks)
    progress_cb("Building automatic action plan...", 1, 1)
    return releases, tracks, groups, selected, reviews, errors


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
    lines.append("3. Apply the selected remix/live exclusion checkboxes to wanted coverage.")
    lines.append("4. Prefer CD/physical source over equivalent WEB content.")
    lines.append("5. Prefer the existing processed copy when source/content are equivalent.")
    lines.append("6. Then minimize duplicated wanted tracks/files and release count.")
    lines.append("7. Explicit/clean is not evaluated until a detector is implemented.")
    lines.append("8. Uncertain audio matches stay separate and are retained automatically.")
    lines.append("")
    lines.append("SUMMARY")
    lines.append(f"Releases scanned: {len(releases)}")
    lines.append(f"Audio files scanned: {len(tracks)}")
    lines.append(f"High-confidence recording groups: {len(groups)}")
    lines.append(f"Proposed retained releases: {len(selected)}")
    lines.append(f"Proposed retained audio files: {sum(by_id[x].track_count for x in selected)}")
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
                        best = min(candidates, key=lambda r: (r.wanted_track_count, -_explicit_rank(r), -r.source_quality, 0 if r.root_kind == "existing" else 1, r.track_count))
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
        lines.append(f"[{status}] {rel.path}")
        lines.append(f"  Type: {rel.release_type} ({rel.type_source}); family: {rel.family or '?'}")
        src = "CD+LOG+CUE" if rel.has_cue and rel.has_rip_log else "CUE" if rel.has_cue else "WEB/AudioChecker" if rel.has_audiochecker else "WEB/unknown"
        lines.append(f"  Source: {src}; tracks: {rel.track_count}")
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
    lines.append("Track equivalence is decided from audio fingerprints only. Filenames/titles/MBIDs/ISRCs do not create duplicate matches. Long silence/padding is ignored when the remaining audio is a strict match.")
    lines.append("If audio evidence is insufficient, tracks remain separate and are retained.")
    return "\n".join(lines) + "\n"



@dataclass
class ReleaseDecision:
    release_id: int
    action: str
    reason: str
    essential_tracks: List[str] = field(default_factory=list)


def _selected_group_union(releases: List[Release], selected: Set[int], exclude: Optional[int] = None) -> Set[int]:
    out: Set[int] = set()
    for r in releases:
        if r.rid in selected and r.rid != exclude:
            out |= r.groups
    return out


def _preferred_existing_cover_for_recycle(rel: Release, releases: List[Release]) -> Optional[Release]:
    """Return an existing release that makes this recycle release redundant.

    This is a final action-layer safeguard. Release identity may use album/folder
    grouping, but track equivalence itself is audio-fingerprint based only.
    """
    if rel.root_kind != "recycle" or rel.excluded_only:
        return None
    candidates: List[Release] = []
    for er in releases:
        if er.root_kind != "existing" or er.excluded_only:
            continue
        if not _folder_related_releases(er, rel):
            continue
        if not _release_covers(er, rel):
            continue
        if (_explicit_rank(er), source_rank(er)) < (_explicit_rank(rel), source_rank(rel)):
            continue
        candidates.append(er)
    if not candidates:
        return None
    return max(
        candidates,
        key=lambda er: (
            _explicit_rank(er),
            source_rank(er),
            er.wanted_track_count,
            -er.track_count,
        ),
    )


def build_release_decisions(releases: List[Release], tracks: List[Track], selected: Set[int], reviews) -> List[ReleaseDecision]:
    selected_rels = [r for r in releases if r.rid in selected]
    selected_groups = _selected_group_union(releases, selected)

    existing_groups: Set[int] = set()
    for r in releases:
        if r.root_kind == "existing":
            existing_groups |= r.groups

    decisions: List[ReleaseDecision] = []

    for rel in releases:
        # A release containing only tracks excluded by the active checkboxes is
        # automatically removed/skipped. Mixed releases remain eligible for any
        # wanted audio they still contain.
        if rel.excluded_only:
            action = "REMOVE" if rel.root_kind == "existing" else "SKIP"
            kinds = []
            if any(t.is_remix for t in rel.tracks):
                kinds.append("remix")
            if any(t.is_live for t in rel.tracks):
                kinds.append("live")
            label = "/".join(kinds) if kinds else "excluded"
            decisions.append(
                ReleaseDecision(
                    release_id=rel.rid,
                    action=action,
                    reason=f"Excluded-only release ({label}) by current checkbox settings.",
                    essential_tracks=[],
                )
            )
            continue

        # Final hard safeguard: if an existing processed release audio-covers
        # this recycle copy and is not worse in source quality, the recycle copy
        # is redundant.
        existing_cover = _preferred_existing_cover_for_recycle(rel, releases)
        if existing_cover is not None:
            decisions.append(
                ReleaseDecision(
                    release_id=rel.rid,
                    action="SKIP",
                    reason=f"Covered by preferred existing release: {existing_cover.path.name}",
                    essential_tracks=[],
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
                    if new_groups:
                        new_titles: List[str] = []
                        seen: Set[str] = set()
                        for t in rel.tracks:
                            if t.group_id in new_groups:
                                k = normalize_title(t.display_title)
                                if k not in seen:
                                    seen.add(k)
                                    new_titles.append(t.display_title)
                        preview = ", ".join(new_titles[:4])
                        if len(new_titles) > 4:
                            preview += f", +{len(new_titles)-4} more"
                        reason = f"Add: {len(new_groups)} recording(s) are not present in the current discography"
                        if preview:
                            reason += f": {preview}"
                    elif rel.release_type == "album":
                        reason = "Add: chosen album edition minimizes duplicated files while keeping the album represented."
                    else:
                        reason = "Add: selected by the automatic minimum-file coverage solution."
        else:
            covered = (bool(rel.groups) and rel.groups <= selected_groups) or _semantically_covered_by_selected(rel, selected_rels)
            if covered:
                action = "REMOVE" if rel.root_kind == "existing" else "SKIP"
                covers: List[str] = []
                for gid in sorted(rel.groups):
                    candidates = [r for r in selected_rels if gid in r.groups]
                    if candidates:
                        best = min(
                            candidates,
                            key=lambda r: (r.wanted_track_count, -_explicit_rank(r), -source_rank(r), 0 if r.root_kind == "existing" else 1, r.track_count),
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

        decisions.append(
            ReleaseDecision(
                release_id=rel.rid,
                action=action,
                reason=reason,
                essential_tracks=essential_tracks,
            )
        )

    return decisions

def action_summary(decisions: List[ReleaseDecision]) -> Dict[str, int]:
    counts = Counter(d.action for d in decisions)
    return {k: counts.get(k, 0) for k in ("ADD", "REPLACE", "REMOVE", "SKIP", "KEEP")}



def _duplicates_root(recycle: Path) -> Path:
    """Return <artist>_duplicates as a sibling of the selected artist folder."""
    return recycle.parent / f"{recycle.name}_duplicates"


def _last_manifest_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Karpuzikov" / "Duplicate Edition Analyzer"
    base.mkdir(parents=True, exist_ok=True)
    return base / "last_move.json"


def _is_ancestor(parent: Path, child: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return parent.resolve() != child.resolve()
    except Exception:
        return False


def _automatic_move_set(releases: List[Release], decisions: List[ReleaseDecision]) -> List[Tuple[Release, ReleaseDecision]]:
    by_id = {r.rid: r for r in releases}
    chosen: List[Tuple[Release, ReleaseDecision]] = []
    for d in decisions:
        r = by_id[d.release_id]
        if (r.root_kind == "recycle" and d.action == "SKIP") or (r.root_kind == "existing" and d.action == "REMOVE"):
            chosen.append((r, d))

    retained = [by_id[d.release_id] for d in decisions if d.action in {"KEEP", "ADD", "REPLACE"}]
    for r, _d in chosen:
        for keep in retained:
            if _is_ancestor(r.path, keep.path):
                raise RuntimeError(
                    "Automatic filtering stopped because a removable release folder contains a retained release folder:\n\n"
                    f"Remove candidate: {r.path}\nRetained release: {keep.path}\n\n"
                    "Nothing was changed."
                )

    result: List[Tuple[Release, ReleaseDecision]] = []
    for r, d in sorted(chosen, key=lambda x: len(x[0].path.parts)):
        if any(_is_ancestor(parent.path, r.path) for parent, _ in result):
            continue
        result.append((r, d))
    return result


def apply_automatic_plan(existing: Optional[Path], recycle: Path, releases: List[Release], decisions: List[ReleaseDecision]) -> Dict[str, object]:
    moves = _automatic_move_set(releases, decisions)
    duplicates = _duplicates_root(recycle)

    # Preserve original release-folder names exactly. Preflight every target so
    # a collision aborts before anything is moved.
    planned: List[Tuple[Release, ReleaseDecision, Path]] = []
    target_map: Dict[str, Path] = {}
    for release, decision in moves:
        subdir = Path("!Remixes") if release.has_remixes else Path()
        target = duplicates / subdir / release.path.name
        key = os.path.normcase(str(target.resolve(strict=False)))
        if key in target_map:
            raise RuntimeError(
                "Two release folders would have the same destination and folders may not be renamed:\n\n"
                f"{target_map[key]}\n{release.path}\n\nDestination: {target}\n\nNothing was changed."
            )
        target_map[key] = release.path
        if target.exists():
            raise RuntimeError(
                "A duplicate destination already exists and folders may not be renamed:\n\n"
                f"{target}\n\nMove or remove that existing folder first, then run the analyzer again. Nothing was changed."
            )
        planned.append((release, decision, target))

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
            raise RuntimeError("The analyzer found redundant releases, but no move operations were planned. Nothing was changed.")

        for release, decision, target in planned:
            source = release.path
            if not source.exists():
                raise RuntimeError(
                    "A release selected for moving no longer exists at the scanned path:\n\n"
                    f"{source}\n\nNothing was changed after rolling back completed moves."
                )
            target.parent.mkdir(parents=True, exist_ok=True)

            # For the normal sibling-folder case this is an atomic same-volume rename.
            # Fall back to shutil.move only when Windows/filesystem semantics require it.
            try:
                os.replace(str(source), str(target))
            except OSError:
                shutil.move(str(source), str(target))

            if source.exists() or not target.exists():
                raise RuntimeError(
                    "A release move did not complete successfully:\n\n"
                    f"Source: {source}\nTarget: {target}\n\n"
                    "Nothing else will be moved; completed moves will be rolled back."
                )

            completed.append((source, target))
            manifest["moves"].append({
                "action": decision.action,
                "original": str(source),
                "moved_to": str(target),
                "remix_bucket": bool(release.has_remixes),
                "reason": decision.reason,
            })

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
    remix_moved = sum(1 for release, _decision, _target in planned if release.has_remixes)
    return {
        "duplicates": duplicates,
        "moved": len(completed),
        "remix_moved": remix_moved,
        "remaining_recycle": remaining_recycle,
        "add": counts["ADD"],
        "replace": counts["REPLACE"],
        "removed_current": counts["REMOVE"],
        "skipped_recycle": counts["SKIP"],
    }


def undo_last_run() -> Tuple[int, List[str]]:
    manifest_path = _last_manifest_path()
    if not manifest_path.is_file():
        raise RuntimeError("No previous move manifest was found.")
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    moves = data.get("moves") or []
    restored = 0
    conflicts: List[str] = []
    for item in reversed(moves):
        original = Path(item["original"])
        saved = Path(item["moved_to"])
        if original.exists():
            conflicts.append(str(original))
            continue
        if not saved.exists():
            continue
        original.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(saved), str(original))
        restored += 1

    # Only remove empty helper folders; never remove older duplicate contents.
    dup_root = Path(data.get("duplicates_root") or "")
    for candidate in [dup_root / "!Remixes", dup_root]:
        try:
            if candidate.is_dir() and not any(candidate.iterdir()):
                candidate.rmdir()
        except Exception:
            pass
    if not conflicts:
        try:
            manifest_path.unlink(missing_ok=True)
        except Exception:
            pass
    return restored, conflicts


class DoneWindow(tk.Toplevel):
    def __init__(self, master, recycle: Path, result: Dict[str, object]):
        super().__init__(master)
        self.title(f"{APP_NAME} - Done")
        self.resizable(False, False)
        self.configure(background=DARK_BG)
        _enable_dark_titlebar(self)
        self.recycle = recycle
        self.duplicates = Path(str(result["duplicates"]))

        frame = ttk.Frame(self)
        frame.pack(fill="both", expand=True, padx=18, pady=18)

        ttk.Label(frame, text="DONE", font=("Segoe UI", 15, "bold")).pack(anchor="w")
        ttk.Label(
            frame,
            text=(
                f"Recycle releases left to process: {result['remaining_recycle']}\n"
                f"Redundant releases moved: {result['moved']}\n"
                f"Moved under !Remixes: {result['remix_moved']}\n"
                f"ADD: {result['add']}   REPLACE: {result['replace']}   "
                f"SKIPPED: {result['skipped_recycle']}   CURRENT REMOVED: {result['removed_current']}"
            ),
            justify="left",
        ).pack(anchor="w", pady=(8, 10))
        ttk.Label(frame, text=f"Duplicates folder:\n{self.duplicates}", justify="left").pack(anchor="w", pady=(0, 14))

        buttons = ttk.Frame(frame)
        buttons.pack(fill="x")
        ttk.Button(buttons, text="Open filtered recycle", command=lambda: os.startfile(self.recycle)).pack(side="left")
        ttk.Button(buttons, text="Open duplicates", command=lambda: os.startfile(self.duplicates)).pack(side="left", padx=8)
        ttk.Button(buttons, text="Undo", command=self.undo).pack(side="left", padx=8)
        ttk.Button(buttons, text="Close", command=self.destroy).pack(side="right")

        self.transient(master)
        self.grab_set()
        self.focus_force()

    def undo(self):
        if not messagebox.askyesno(APP_NAME, "Restore every release moved by this run?", parent=self):
            return
        try:
            restored, conflicts = undo_last_run()
        except Exception as exc:
            messagebox.showerror(APP_NAME, str(exc), parent=self)
            return
        if conflicts:
            messagebox.showwarning(
                APP_NAME,
                f"Restored {restored} release(s). {len(conflicts)} path conflict(s) were not overwritten.",
                parent=self,
            )
        else:
            messagebox.showinfo(APP_NAME, f"Restored {restored} release(s).", parent=self)
        self.destroy()


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"{APP_NAME} {APP_VERSION}")
        self.geometry("800x390")
        self.minsize(760, 370)
        _apply_dark_theme(self)
        saved = _load_app_settings()
        self.existing_var = tk.StringVar(value=saved.get("existing_discography", ""))
        self.recycle_var = tk.StringVar(value=saved.get("recycle_update_folder", ""))
        self.exclude_remixes_var = tk.BooleanVar(value=bool(saved.get("exclude_remixes", True)))
        self.exclude_live_var = tk.BooleanVar(value=bool(saved.get("exclude_live", True)))
        self.status_var = tk.StringVar(value="Choose Recycle / update. Existing discography is optional.")
        self.progress_var = tk.DoubleVar(value=0)
        self._build()
        self.protocol("WM_DELETE_WINDOW", self.on_close)

    def _build(self):
        pad = {"padx": 12, "pady": 7}
        frm = ttk.Frame(self)
        frm.pack(fill="both", expand=True, padx=14, pady=14)

        ttk.Label(frm, text="Existing discography (ALAC) - optional").grid(row=0, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.existing_var).grid(row=1, column=0, sticky="ew", padx=12)
        existing_buttons = ttk.Frame(frm)
        existing_buttons.grid(row=1, column=1, padx=8, sticky="e")
        ttk.Button(existing_buttons, text="Browse...", command=lambda: self.browse(self.existing_var)).pack(side="left")
        ttk.Button(existing_buttons, text="Clear", command=self.clear_existing).pack(side="left", padx=(6, 0))

        ttk.Label(frm, text="Recycle / update folder").grid(row=2, column=0, sticky="w", **pad)
        ttk.Entry(frm, textvariable=self.recycle_var).grid(row=3, column=0, sticky="ew", padx=12)
        ttk.Button(frm, text="Browse...", command=lambda: self.browse(self.recycle_var)).grid(row=3, column=1, padx=8)

        options = ttk.Frame(frm)
        options.grid(row=4, column=0, columnspan=2, sticky="w", padx=12, pady=(10, 2))
        ttk.Checkbutton(options, text="Exclude remixes", variable=self.exclude_remixes_var, command=self.save_settings).pack(side="left")
        ttk.Checkbutton(options, text="Exclude live versions", variable=self.exclude_live_var, command=self.save_settings).pack(side="left", padx=(18, 0))

        ttk.Label(
            frm,
            text="Duplicate identity is audio-only (strict Chromaprint). Titles/filenames do not decide matches.",
        ).grid(row=5, column=0, columnspan=2, sticky="w", padx=12, pady=(4, 4))

        self.progress = ttk.Progressbar(frm, variable=self.progress_var, maximum=100)
        self.progress.grid(row=6, column=0, columnspan=2, sticky="ew", padx=12, pady=(14, 5))
        ttk.Label(frm, textvariable=self.status_var).grid(row=7, column=0, columnspan=2, sticky="w", padx=12)

        self.run_btn = ttk.Button(frm, text="Analyze & Filter Automatically", command=self.start)
        self.run_btn.grid(row=8, column=0, sticky="w", padx=12, pady=16)
        ttk.Button(frm, text="Close", command=self.on_close).grid(row=8, column=1, sticky="e", padx=8, pady=16)
        frm.columnconfigure(0, weight=1)

    def save_settings(self):
        _save_app_settings(self.existing_var.get(), self.recycle_var.get(), self.exclude_remixes_var.get(), self.exclude_live_var.get())

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

    def update_progress(self, text: str, current: int, total: int):
        pct = 0 if total <= 0 else (current / total) * 100
        self.after(0, lambda: (self.status_var.set(f"{text} {current}/{total}"), self.progress_var.set(pct)))

    def start(self):
        existing_text = self.existing_var.get().strip()
        existing = Path(existing_text) if existing_text else None
        recycle_text = self.recycle_var.get().strip()
        recycle = Path(recycle_text) if recycle_text else None

        if recycle is None or not recycle.is_dir():
            messagebox.showerror(APP_NAME, "Select a valid Recycle / update folder.")
            return
        if existing is not None and not existing.is_dir():
            messagebox.showerror(APP_NAME, "Existing discography is optional, but the entered path is not a valid folder. Clear it or choose a valid folder.")
            return

        if existing is not None:
            try:
                if existing.resolve() == recycle.resolve() or _is_ancestor(existing, recycle) or _is_ancestor(recycle, existing):
                    messagebox.showerror(APP_NAME, "Existing and Recycle roots must be separate folders, not nested inside each other.")
                    return
            except Exception:
                pass

        self.save_settings()
        self.run_btn.configure(state="disabled")
        self.progress_var.set(0)
        threading.Thread(target=self.worker, args=(existing, recycle, self.exclude_remixes_var.get(), self.exclude_live_var.get()), daemon=True).start()

    def worker(self, existing: Optional[Path], recycle: Path, exclude_remixes: bool, exclude_live: bool):
        try:
            result = analyze(existing, recycle, True, self.update_progress, exclude_remixes, exclude_live)
            self.after(0, lambda: self.done(existing, recycle, result))
        except Exception as e:
            self.after(0, lambda: self.failed(str(e)))

    def done(self, existing: Optional[Path], recycle: Path, result):
        self.run_btn.configure(state="normal")
        self.progress_var.set(100)
        releases, tracks, groups, selected, reviews, notes = result
        decisions = build_release_decisions(releases, tracks, selected, reviews)
        counts = action_summary(decisions)
        recycle_kept = sum(
            1 for d in decisions
            if next(r for r in releases if r.rid == d.release_id).root_kind == "recycle"
            and d.action in {"ADD", "REPLACE", "KEEP"}
        )
        to_move = counts["SKIP"] + counts["REMOVE"]
        self.status_var.set("Analysis complete. Ready to filter automatically.")

        if to_move == 0:
            messagebox.showinfo(
                APP_NAME,
                f"Done. No redundant release folders need to be moved.\nRecycle releases to process: {recycle_kept}",
                parent=self,
            )
            return

        confirm_text = (
            "Apply changes?\n\n"
            f"Keep in recycle: {recycle_kept}\n"
            f"Move recycle duplicates: {counts['SKIP']}\n"
        )
        if existing is not None:
            confirm_text += f"Move existing duplicates: {counts['REMOVE']}\n"
        confirm_text += (
            f"\nDestination:\n{_duplicates_root(recycle)}\n"
            "Remix duplicates: !Remixes"
        )
        confirm = messagebox.askyesno(
            APP_NAME,
            confirm_text,
            parent=self,
        )
        if not confirm:
            self.status_var.set("No changes made.")
            return

        self.run_btn.configure(state="disabled")
        self.status_var.set("Applying automatic filter...")
        threading.Thread(
            target=self.apply_worker,
            args=(existing, recycle, releases, decisions),
            daemon=True,
        ).start()

    def apply_worker(self, existing: Optional[Path], recycle: Path, releases: List[Release], decisions: List[ReleaseDecision]):
        try:
            result = apply_automatic_plan(existing, recycle, releases, decisions)
            self.after(0, lambda: self.applied(recycle, result))
        except Exception as e:
            self.after(0, lambda: self.failed(str(e)))

    def applied(self, recycle: Path, result: Dict[str, object]):
        self.run_btn.configure(state="normal")
        self.status_var.set("Done. Recycle folder filtered automatically.")
        DoneWindow(self, recycle, result)

    def failed(self, error: str):
        self.run_btn.configure(state="normal")
        self.status_var.set("Failed")
        messagebox.showerror(APP_NAME, error, parent=self)


def _startup_crash_log_path() -> Path:
    return _documents_dir() / "Karpuzikov Tools" / "Duplicate Edition Analyzer - Crash.log"


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
            "The program failed to start.\n\n"
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
        app.after(100, app.deiconify)
        app.after(150, app.lift)
        app.mainloop()
    except BaseException as exc:
        _report_startup_crash(exc)


if __name__ == "__main__":
    main()
