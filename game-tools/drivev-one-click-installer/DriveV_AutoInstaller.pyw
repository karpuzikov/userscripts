from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import urllib.error
import webbrowser
import zipfile
from urllib.parse import unquote, urljoin, urlparse
from pathlib import Path

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
except ImportError as exc:
    raise SystemExit("Tkinter is required. Use the standard Windows Python installer with Tcl/Tk enabled.") from exc

# Embedded installer core - kept in this .pyw so the app has no helper .py dependency.
import json
import os
import shutil
import tempfile
import zipfile
import xml.etree.ElementTree as ET
import html
import re
from email.message import Message
from urllib.parse import urljoin
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


def gta5mods_version_paths(page_html: str) -> list[tuple[int, str]]:
    matches = re.findall(
        r"href\s*=\s*['\"](?P<path>/[a-z0-9%_.-]+/[a-z0-9%_.-]+/download/(?P<id>\d+))['\"]",
        page_html,
        flags=re.IGNORECASE,
    )
    versions: dict[int, str] = {}
    for path, version_id in matches:
        versions[int(version_id)] = html.unescape(path)
    return [(version_id, versions[version_id]) for version_id in sorted(versions)]


def gta5mods_latest_version_path(page_html: str) -> str | None:
    versions = gta5mods_version_paths(page_html)
    return versions[-1][1] if versions else None


def gta5mods_direct_url(version_html: str) -> str | None:
    match = re.search(
        r"https://files\.gta5-mods\.com/[^'\"<>\s]+",
        version_html,
        flags=re.IGNORECASE,
    )
    return html.unescape(match.group(0)) if match else None


def scripthook_zip_url(page_html: str, page_url: str) -> str | None:
    matches = re.findall(
        r"href\s*=\s*['\"]([^'\"]*ScriptHookV_([0-9.]+)\.zip(?:\?[^'\"]*)?)['\"]",
        page_html,
        flags=re.IGNORECASE,
    )
    if not matches:
        return None

    def version_key(item: tuple[str, str]) -> tuple[int, ...]:
        return tuple(int(x) for x in item[1].split('.') if x.isdigit())

    href, _ = max(matches, key=version_key)
    return urljoin(page_url, html.unescape(href))


def enb_latest_version_url(index_html: str, base_url: str) -> str | None:
    matches = re.findall(
        r"href\s*=\s*['\"]([^'\"]*mod_gta5_v(\d+)\.htm)['\"]",
        index_html,
        flags=re.IGNORECASE,
    )
    if not matches:
        return None
    href, _ = max(matches, key=lambda item: int(item[1]))
    return urljoin(base_url, html.unescape(href))


def enb_zip_url(version_html: str, version_url: str) -> str | None:
    links = re.findall(
        r"href\s*=\s*['\"]([^'\"]+\.zip(?:\?[^'\"]*)?)['\"]",
        version_html,
        flags=re.IGNORECASE,
    )
    if not links:
        return None
    return urljoin(version_url, html.unescape(links[-1]))


def content_disposition_filename(value: str | None) -> str | None:
    if not value:
        return None
    msg = Message()
    msg['content-disposition'] = value
    filename = msg.get_filename()
    if not filename:
        return None
    return filename.replace('\\', '/').split('/')[-1]


def package_cache_name(package_id: str, source_filename: str) -> str:
    safe_id = package_id.strip().lower()
    if not re.fullmatch(r'[a-z0-9_-]+', safe_id):
        raise ValueError(f'Invalid package id: {package_id!r}')
    source = source_filename.replace('\\', '/').split('/')[-1]
    source = ''.join('_' if (ord(ch) < 32 or ch in '<>:\"/\\|?*') else ch for ch in source)
    source = source.rstrip(' .')
    if not source:
        source = 'download.zip'
    return f'{safe_id}__{source}'


def package_id_from_cache_name(filename: str | os.PathLike) -> str | None:
    base = Path(filename).name
    if '__' not in base:
        return None
    package_id = base.split('__', 1)[0].strip().lower()
    return package_id if re.fullmatch(r'[a-z0-9_-]+', package_id) else None


def parse_steam_library_paths(vdf_text: str) -> list[Path]:
    """Return Steam library roots from libraryfolders.vdf without requiring a VDF parser."""
    paths: list[Path] = []
    seen: set[str] = set()
    for raw in re.findall(r'"path"\s*"([^"]+)"', vdf_text, flags=re.IGNORECASE):
        value = raw.replace('\\\\', '\\').strip()
        if not value:
            continue
        p = Path(value)
        key = str(p).rstrip('\\/').lower()
        if key not in seen:
            seen.add(key)
            paths.append(p)
    return paths


def candidate_game_paths(
    drive_roots: Iterable[os.PathLike | str],
    steam_libraries: Iterable[os.PathLike | str] = (),
    extra_locations: Iterable[os.PathLike | str] = (),
) -> list[Path]:
    """Build fast GTA V candidates for all drives/launchers without recursively scanning disks."""
    out: list[Path] = []

    root_relatives = [
        ("Grand Theft Auto V",),
        ("Grand Theft Auto V Enhanced",),
        ("Games", "Grand Theft Auto V"),
        ("Games", "Grand Theft Auto V Enhanced"),
        ("Games", "GTAV"),
        ("Games", "GTAVEnhanced"),
        ("Steam", "steamapps", "common", "Grand Theft Auto V"),
        ("Steam", "steamapps", "common", "Grand Theft Auto V Enhanced"),
        ("SteamLibrary", "steamapps", "common", "Grand Theft Auto V"),
        ("SteamLibrary", "steamapps", "common", "Grand Theft Auto V Enhanced"),
        ("Epic Games", "GTAV"),
        ("Epic Games", "GTAVEnhanced"),
        ("Rockstar Games", "Grand Theft Auto V"),
        ("Rockstar Games", "Grand Theft Auto V Enhanced"),
        ("Program Files", "Rockstar Games", "Grand Theft Auto V"),
        ("Program Files", "Rockstar Games", "Grand Theft Auto V Enhanced"),
        ("Program Files (x86)", "Steam", "steamapps", "common", "Grand Theft Auto V"),
        ("Program Files (x86)", "Steam", "steamapps", "common", "Grand Theft Auto V Enhanced"),
    ]
    for root in drive_roots:
        base = Path(root)
        for parts in root_relatives:
            out.append(base.joinpath(*parts))

    for library in steam_libraries:
        lib = Path(library)
        out.append(lib / "steamapps" / "common" / "Grand Theft Auto V")
        out.append(lib / "steamapps" / "common" / "Grand Theft Auto V Enhanced")

    out.extend(Path(p) for p in extra_locations if str(p).strip())

    seen: set[str] = set()
    deduped: list[Path] = []
    for p in out:
        key = str(p).rstrip('\\/').lower()
        if key not in seen:
            seen.add(key)
            deduped.append(p)
    return deduped


def load_user_settings(path: os.PathLike | str) -> dict:
    p = Path(path)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError, UnicodeError):
        return {}


def save_user_settings(path: os.PathLike | str, settings: dict) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(settings, indent=2, ensure_ascii=False)
    fd, temp_name = tempfile.mkstemp(prefix=p.name + ".", suffix=".tmp", dir=str(p.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_name, p)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def set_enb_ignore_damage_limits_text(text: str) -> str:
    lines = text.splitlines()
    fix_index = next((i for i, line in enumerate(lines) if line.strip().lower() == "[fix]"), None)
    setting = "IgnoreDamageLimits=true"
    if fix_index is None:
        if lines and lines[-1].strip():
            lines.append("")
        lines.extend(["[FIX]", setting])
        return "\n".join(lines) + "\n"

    end = len(lines)
    for i in range(fix_index + 1, len(lines)):
        stripped = lines[i].strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            end = i
            break

    for i in range(fix_index + 1, end):
        if lines[i].strip().lower().replace(" ", "").startswith("ignoredamagelimits="):
            prefix = lines[i][: len(lines[i]) - len(lines[i].lstrip())]
            lines[i] = prefix + setting
            return "\n".join(lines) + "\n"

    lines.insert(fix_index + 1, setting)
    return "\n".join(lines) + "\n"


def can_use_pinned_scripthook(exe_version: str | None, supported_patch: str) -> bool:
    return exe_version is None or exe_version == supported_patch


def detect_edition(game_path: os.PathLike | str) -> str | None:
    p = Path(game_path)
    if (p / "GTA5_Enhanced.exe").is_file():
        return "Enhanced"
    if (p / "GTA5.exe").is_file():
        return "Legacy"
    return None


def safe_extract_zip(zip_path: os.PathLike | str, destination: os.PathLike | str) -> Path:
    zip_path = Path(zip_path)
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with zipfile.ZipFile(zip_path) as zf:
        for member in zf.infolist():
            candidate = (destination / member.filename).resolve()
            try:
                candidate.relative_to(root)
            except ValueError as exc:
                raise ValueError(f"Unsafe path in ZIP: {member.filename}") from exc
        zf.extractall(destination)
    return destination


def _normalized_member_names(zip_path: Path) -> list[str]:
    try:
        with zipfile.ZipFile(zip_path) as zf:
            return [n.replace("\\", "/").lower() for n in zf.namelist() if not n.endswith("/")]
    except (zipfile.BadZipFile, OSError):
        return []


def identify_zip_package(zip_path: os.PathLike | str) -> str | None:
    p = Path(zip_path)
    names = _normalized_member_names(p)
    if not names:
        return None
    bases = {Path(n).name.lower() for n in names}
    joined = "\n".join(names)

    if "codewalker.oivinstaller.exe" in bases or any("oivinstaller" in b and b.endswith(".exe") for b in bases):
        return "oiv_installer"
    if "openrpf.asi" in bases:
        return "openrpf"
    if "rageopenv.asi" in bases:
        return "rageopenv"
    if "scripthookv.dll" in bases and ("dinput8.dll" in bases or "nativetrainer.asi" in bases):
        return "script_hook_v"
    if "trainerv.asi" in bases:
        return "simple_trainer"
    if "inversepower.asi" in bases:
        return "inverse_power"
    if any(n.endswith("wrapperversion/d3d11.dll") for n in names) or (
        "d3d11.dll" in bases and "enblocal.ini" in bases
    ):
        return "enb"
    if "fxdecal_bangs" in joined and "fxdecal_scrapes" in joined:
        return "scratches"

    oivs = [n for n in names if n.endswith(".oiv")]
    if oivs:
        lower_name = p.name.lower()
        if "drive" in lower_name or any(Path(n).name.lower() in {"install.oiv", "drivev.oiv", "drive v.oiv"} for n in oivs):
            return "drivev"
    return None


def legacy_mods_loader_satisfied(game_path: os.PathLike | str, available_packages: Iterable[str]) -> bool:
    game = Path(game_path)
    existing = any((game / name).is_file() for name in ("OpenIV.asi", "RageOpenV.asi"))
    return existing or "rageopenv" in set(available_packages)


def classify_drivev_oivs(paths: Iterable[str]) -> dict[str, object]:
    raw = [str(x).replace("\\", "/") for x in paths]
    installable = [x for x in raw if x.lower().endswith(".oiv") and "uninstall" not in x.lower()]
    traffic = [x for x in installable if "traffic" in x.lower()]
    ai = [x for x in installable if any(k in x.lower() for k in ("ai driving", "driving improvement", "improved ai", "ai improvement"))]
    wov = [x for x in installable if "wov" in x.lower() or "world of variety" in x.lower()]
    optionals = set(traffic + ai + wov)
    main_candidates = [x for x in installable if x not in optionals and "optional" not in x.lower()]
    if not main_candidates:
        main_candidates = [x for x in installable if x not in optionals]
    main = None
    if main_candidates:
        preferred = [x for x in main_candidates if Path(x).name.lower() in {"install.oiv", "drivev.oiv", "drive v.oiv"}]
        main = preferred[0] if preferred else main_candidates[0]
    return {
        "main": main,
        "traffic": traffic,
        "ai": ai,
        "wov": wov,
        "installable": installable,
    }


def oiv_declared_gameversion(oiv_path: os.PathLike | str) -> str | None:
    """Return explicit Legacy/Enhanced target from assembly.xml, else None.

    CodeWalker deliberately shows a second folder picker when an OIV has no
    gameversion. Our wrapper has already validated the GTA folder, so for only
    those ambiguous packages we suppress that redundant prompt with --force.
    Explicitly versioned OIVs retain CodeWalker's compatibility guard.
    """
    path = Path(oiv_path)
    if not path.is_file():
        return None
    try:
        with zipfile.ZipFile(path) as zf:
            assembly_name = next((n for n in zf.namelist() if Path(n).name.lower() == "assembly.xml"), None)
            if not assembly_name:
                return None
            root = ET.fromstring(zf.read(assembly_name))
            for node in root.iter():
                if node.tag.split("}")[-1].lower() == "gameversion":
                    value = (node.text or "").strip().lower()
                    if value in {"legacy", "enhanced"}:
                        return value
            return None
    except (OSError, zipfile.BadZipFile, ET.ParseError):
        return None


def oiv_install_command(executable: os.PathLike | str, oiv_path: os.PathLike | str, game_path: os.PathLike | str) -> list[str]:
    cmd = [str(executable), "--install", str(oiv_path), "--game", str(game_path)]
    if oiv_declared_gameversion(oiv_path) is None:
        cmd.append("--force")
    return cmd


def oiv_package_name(oiv_path: os.PathLike | str) -> str:
    """Read the package metadata name from an OIV assembly.xml."""
    path = Path(oiv_path)
    try:
        with zipfile.ZipFile(path) as zf:
            assembly_name = next((n for n in zf.namelist() if Path(n).name.lower() == "assembly.xml"), None)
            if not assembly_name:
                raise ValueError(f"OIV has no assembly.xml: {path}")
            root = ET.fromstring(zf.read(assembly_name))
            for node in root.iter():
                if node.tag.split("}")[-1].lower() == "name":
                    value = (node.text or "").strip()
                    if value:
                        return value
    except (OSError, zipfile.BadZipFile, ET.ParseError) as exc:
        raise ValueError(f"Could not read OIV package metadata: {path}") from exc
    raise ValueError(f"OIV metadata has no package name: {path}")


def oiv_uninstall_command(executable: os.PathLike | str, oiv_path: os.PathLike | str, game_path: os.PathLike | str) -> list[str]:
    # CodeWalker's --uninstall-oiv path re-runs its GameVersion.Any safety
    # prompt, even when --game was already supplied. Resolve the same package
    # name ourselves and use --uninstall, which reverts the recorded backup
    # session directly and therefore reuses the already validated game path.
    package_name = oiv_package_name(oiv_path)
    return [str(executable), "--uninstall", package_name, "--game", str(game_path)]


def list_zip_oivs(zip_path: os.PathLike | str) -> list[str]:
    with zipfile.ZipFile(zip_path) as zf:
        return [n for n in zf.namelist() if n.lower().endswith(".oiv")]


def find_files(root: os.PathLike | str, filename: str) -> list[Path]:
    root = Path(root)
    wanted = filename.lower()
    return [p for p in root.rglob("*") if p.is_file() and p.name.lower() == wanted]


def atomic_copy(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, dir=dst.parent, prefix=dst.name + ".tmp-") as tf:
        tmp = Path(tf.name)
    try:
        shutil.copy2(src, tmp)
        os.replace(tmp, dst)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


@dataclass
class BackupRecord:
    target: str
    existed: bool
    backup: str | None


class BackupSession:
    def __init__(self, game_path: os.PathLike | str, state_root: os.PathLike | str):
        self.game_path = Path(game_path).resolve()
        self.state_root = Path(state_root).resolve()
        self.session_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.session_dir = self.state_root / self.session_id
        self.backup_dir = self.session_dir / "loose-files"
        self.manifest_path = self.session_dir / "loose-backup.json"
        self.records: list[BackupRecord] = []
        self.session_dir.mkdir(parents=True, exist_ok=True)

    def _target_key(self, target: Path) -> Path:
        target = target.resolve()
        try:
            return target.relative_to(self.game_path)
        except ValueError:
            return Path("external") / target.drive.replace(":", "") / Path(*target.parts[1:])

    def copy_with_backup(self, source: os.PathLike | str, target: os.PathLike | str) -> None:
        src = Path(source)
        dst = Path(target)
        if not src.is_file():
            raise FileNotFoundError(src)
        existed = dst.exists()
        backup_rel = None
        if existed:
            key = self._target_key(dst)
            backup = self.backup_dir / key
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dst, backup)
            backup_rel = str(backup.relative_to(self.session_dir))
        self.records.append(BackupRecord(str(dst.resolve()), existed, backup_rel))
        atomic_copy(src, dst)

    def save(self) -> Path:
        payload = {
            "format": 1,
            "game_path": str(self.game_path),
            "created_utc": datetime.now(timezone.utc).isoformat(),
            "records": [r.__dict__ for r in self.records],
        }
        self.manifest_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        latest = self.state_root / "latest-loose-backup.txt"
        latest.write_text(str(self.manifest_path), encoding="utf-8")
        return self.manifest_path

    @staticmethod
    def restore_from_manifest(manifest_path: os.PathLike | str) -> None:
        manifest_path = Path(manifest_path)
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        session_dir = manifest_path.parent
        for item in reversed(payload.get("records", [])):
            target = Path(item["target"])
            if item["existed"]:
                backup = session_dir / item["backup"]
                if not backup.is_file():
                    raise FileNotFoundError(f"Backup missing: {backup}")
                atomic_copy(backup, target)
            else:
                target.unlink(missing_ok=True)


def newest_backup_manifest(state_root: os.PathLike | str) -> Path | None:
    state_root = Path(state_root)
    latest = state_root / "latest-loose-backup.txt"
    if latest.is_file():
        p = Path(latest.read_text(encoding="utf-8").strip())
        if p.is_file():
            return p
    manifests = sorted(state_root.glob("*/loose-backup.json"), reverse=True)
    return manifests[0] if manifests else None

APP_DIR = Path(__file__).resolve().parent
MANIFEST = json.loads(r"""{
  "as_of": "2026-09-15",
  "packages": {
    "drivev": {
      "name": "Drive V",
      "version": "7.4",
      "required_legacy": true,
      "required_enhanced": true,
      "page": "https://www.gta5-mods.com/vehicles/drive-v-realistic-driving-car-handling"
    },
    "oiv_installer": {
      "name": "CodeWalker OIV Package Installer",
      "version": "2.1.1",
      "required_legacy": true,
      "required_enhanced": true,
      "page": "https://www.gta5-mods.com/tools/oiv-package-installer"
    },
    "script_hook_v": {
      "name": "Script Hook V",
      "version": "3889.0 / 1158.13",
      "required_legacy": true,
      "required_enhanced": true,
      "page": "https://dev-c.com/gtav/scripthookv/",
      "direct_url": "https://dev-c.com/files/ScriptHookV_3889.0_1158.13.zip",
      "supported_legacy_patch": "1.0.3889.0",
      "supported_enhanced_patch": "1.0.1158.13"
    },
    "simple_trainer": {
      "name": "Simple Trainer for GTA V",
      "version": "18.4",
      "required_legacy": true,
      "required_enhanced": true,
      "page": "https://www.gta5-mods.com/scripts/simple-trainer-for-gtav"
    },
    "inverse_power": {
      "name": "InversePower",
      "version": "2.0.0",
      "required_legacy": true,
      "required_enhanced": true,
      "page": "https://www.gta5-mods.com/scripts/inversepower"
    },
    "rageopenv": {
      "name": "RageOpenV",
      "version": "1.0",
      "required_legacy": false,
      "required_enhanced": false,
      "conditional_legacy": "required_if_OpenIV.asi_is_absent",
      "page": "https://www.gta5-mods.com/tools/rageopenv"
    },
    "openrpf": {
      "name": "OpenRPF",
      "version": "0.3",
      "required_legacy": false,
      "required_enhanced": true,
      "page": "https://www.gta5-mods.com/tools/openrpf-openiv-asi-for-gta-v-enhanced"
    },
    "enb": {
      "name": "ENBSeries for GTA V",
      "version": "0.492",
      "required_legacy": true,
      "required_enhanced": false,
      "experimental_enhanced": true,
      "page": "https://enbdev.com/download_mod_gta5.htm"
    },
    "scratches": {
      "name": "Subtle Scratches (and Dents)",
      "version": "1.3",
      "required_legacy": false,
      "recommended_legacy": true,
      "required_enhanced": false,
      "experimental_enhanced": true,
      "page": "https://www.gta5-mods.com/misc/subtle-scratches-and-dents"
    }
  },
  "installer_version": "2.0.5",
  "download_mode": "automatic"
}""")
PACKAGES_DIR = APP_DIR / "Packages"
WORK_DIR = APP_DIR / "_work"
TOOLS_DIR = APP_DIR / "_tools"
PACKAGE_ORDER = [
    "drivev", "oiv_installer", "script_hook_v", "simple_trainer",
    "inverse_power", "rageopenv", "openrpf", "enb", "scratches"
 ]

HTTP_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DriveV-AutoInstaller/2.1.0"
ARCHIVE_SUFFIXES = {".zip", ".rar", ".7z"}
SETTINGS_ROOT = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))) / "DriveV_AutoInstaller"
SETTINGS_FILE = SETTINGS_ROOT / "settings.json"


def _request(url: str, referer: str | None = None) -> urllib.request.Request:
    headers = {
        "User-Agent": HTTP_USER_AGENT,
        "Accept": "*/*",
        "Accept-Encoding": "identity",
    }
    if referer:
        headers["Referer"] = referer
    return urllib.request.Request(url, headers=headers)


def http_get_text(url: str, referer: str | None = None, timeout: int = 60) -> str:
    with urllib.request.urlopen(_request(url, referer), timeout=timeout) as response:
        raw = response.read()
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def resolve_package_download(kind: str, logger) -> tuple[str, str | None]:
    entry = MANIFEST["packages"][kind]
    page = entry["page"]

    if kind == "script_hook_v":
        logger("Resolving current Script Hook V download…")
        try:
            text = http_get_text(page)
            direct = scripthook_zip_url(text, page)
            if direct:
                return direct, page
        except Exception as exc:
            logger(f"Live Script Hook V resolution failed; trying pinned official URL: {exc}")
        direct = entry.get("direct_url")
        if direct:
            return direct, page
        raise RuntimeError("Could not resolve Script Hook V from dev-c.com.")

    if kind == "enb":
        logger("Resolving current ENBSeries GTA V download…")
        index = http_get_text(page)
        version_page = enb_latest_version_url(index, page)
        if not version_page:
            # ENB's index sometimes omits older products from the HTML served to automated clients.
            version_page = "http://enbdev.com/mod_gta5_v0492.htm"
        version_html = http_get_text(version_page, page)
        direct = enb_zip_url(version_html, version_page)
        if not direct:
            raise RuntimeError("ENBSeries download link could not be resolved from enbdev.com.")
        return direct, version_page

    if "gta5-mods.com" in urlparse(page).netloc.lower():
        logger(f"Resolving current {entry['name']} download from GTA5-Mods…")
        page_html = http_get_text(page)
        version_path = gta5mods_latest_version_path(page_html)
        if not version_path:
            raise RuntimeError(f"No GTA5-Mods download version found for {entry['name']}.")
        version_page = urljoin(page, version_path)
        version_html = http_get_text(version_page, page)
        direct = gta5mods_direct_url(version_html)
        if not direct:
            raise RuntimeError(f"{entry['name']} is not hosted on files.gta5-mods.com; automatic download is unavailable.")
        return direct, version_page

    direct = entry.get("direct_url")
    if direct:
        return direct, page
    raise RuntimeError(f"No automatic source configured for {entry['name']}.")


def download_package(kind: str, logger, attempts: int = 3) -> Path:
    PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        part: Path | None = None
        try:
            url, referer = resolve_package_download(kind, logger)
            logger(f"Downloading {MANIFEST['packages'][kind]['name']} ({attempt}/{attempts})…")
            with urllib.request.urlopen(_request(url, referer), timeout=120) as response:
                final_url = response.geturl()
                filename = content_disposition_filename(response.headers.get("Content-Disposition"))
                if not filename:
                    filename = Path(unquote(urlparse(final_url).path)).name or f"{kind}.zip"
                if not Path(filename).suffix:
                    filename += ".zip"
                target = PACKAGES_DIR / package_cache_name(kind, filename)
                part = target.with_name(target.name + ".part")
                total_raw = response.headers.get("Content-Length")
                total = int(total_raw) if total_raw and total_raw.isdigit() else None
                content_type = (response.headers.get("Content-Type") or "").lower()
                if "text/html" in content_type:
                    raise RuntimeError(f"Server returned HTML instead of an archive for {kind}.")
                read = 0
                next_pct = 10
                with part.open("wb") as f:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        f.write(chunk)
                        read += len(chunk)
                        if total:
                            pct = int(read * 100 / total)
                            if pct >= next_pct:
                                logger(f"{MANIFEST['packages'][kind]['name']}: {min(pct, 100)}%")
                                next_pct += 10
                if read < 1024:
                    raise RuntimeError(f"Downloaded file is unexpectedly small ({read} bytes).")
                os.replace(part, target)
                if not cached_package_valid(target):
                    target.unlink(missing_ok=True)
                    raise RuntimeError(f"Downloaded file failed archive/executable validation: {target.name}")
                logger(f"Downloaded and validated {target.name} ({read / 1024 / 1024:.1f} MB)")
                return target
        except Exception as exc:
            last_error = exc
            if part:
                part.unlink(missing_ok=True)
            if attempt < attempts:
                logger(f"Download attempt failed: {exc}; retrying…")
                time.sleep(2 ** (attempt - 1))
    raise RuntimeError(f"Failed to download {MANIFEST['packages'][kind]['name']}: {last_error}")


def find_7zip() -> Path | None:
    for name in ("7z.exe", "7z"):
        found = shutil.which(name)
        if found:
            return Path(found)
    if os.name == "nt":
        for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
            if base:
                p = Path(base) / "7-Zip" / "7z.exe"
                if p.is_file():
                    return p
    return None


def ensure_7zip(logger) -> Path | None:
    seven = find_7zip()
    if seven:
        return seven
    if os.name == "nt" and shutil.which("winget"):
        logger("7-Zip is needed for this archive; installing 7-Zip automatically…")
        proc = subprocess.run(
            ["winget", "install", "-e", "--id", "7zip.7zip", "--silent",
             "--accept-package-agreements", "--accept-source-agreements"],
            text=True, capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if proc.returncode == 0:
            return find_7zip()
    return None


def extract_archive(package: Path, destination: Path, logger) -> Path:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True, exist_ok=True)
    if package.suffix.lower() == ".zip":
        return safe_extract_zip(package, destination)

    # Windows 11 ships bsdtar; it can handle many RAR/7z archives. Use it first.
    tar = shutil.which("tar")
    if tar:
        proc = subprocess.run([tar, "-xf", str(package), "-C", str(destination)], text=True, capture_output=True,
                              creationflags=(subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
        if proc.returncode == 0:
            return destination
        shutil.rmtree(destination, ignore_errors=True)
        destination.mkdir(parents=True, exist_ok=True)

    seven = ensure_7zip(logger)
    if not seven:
        raise RuntimeError(f"Cannot extract {package.name}: neither Windows tar nor 7-Zip is available.")
    proc = subprocess.run([str(seven), "x", "-y", f"-o{destination}", str(package)], text=True, capture_output=True,
                          creationflags=(subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
    if proc.returncode != 0:
        raise RuntimeError(f"7-Zip failed to extract {package.name}: {proc.stderr.strip() or proc.stdout.strip()}")
    return destination


def log_line(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(time.strftime("%Y-%m-%d %H:%M:%S") + "  " + text + "\n")


def downloads_dir() -> Path:
    home = Path.home()
    return home / "Downloads"


def fixed_drive_roots() -> list[Path]:
    """Return Windows fixed/removable drive roots (C:\\, D:\\, ...)."""
    if os.name != "nt":
        return []
    roots: list[Path] = []
    try:
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        for index in range(26):
            if not (mask & (1 << index)):
                continue
            root = f"{chr(ord('A') + index)}:\\"
            drive_type = ctypes.windll.kernel32.GetDriveTypeW(root)
            # DRIVE_REMOVABLE=2, DRIVE_FIXED=3. External SSD/HDD game drives can be type 2.
            if drive_type in (2, 3):
                roots.append(Path(root))
    except Exception:
        pass
    return roots


def _registry_value(hive, key_path: str, value_names: tuple[str, ...]) -> str | None:
    try:
        import winreg
        with winreg.OpenKey(hive, key_path) as key:
            for name in value_names:
                try:
                    value, _ = winreg.QueryValueEx(key, name)
                    if value:
                        return str(value)
                except OSError:
                    continue
    except OSError:
        pass
    return None


def steam_library_roots(drive_roots: list[Path]) -> list[Path]:
    roots: list[Path] = []
    if os.name == "nt":
        try:
            import winreg
            reg_specs = [
                (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Valve\Steam"),
                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam"),
                (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam"),
            ]
            for hive, key in reg_specs:
                value = _registry_value(hive, key, ("SteamPath", "InstallPath"))
                if value:
                    roots.append(Path(value))
        except Exception:
            pass

    for drive in drive_roots:
        roots.extend([
            drive / "Steam",
            drive / "SteamLibrary",
            drive / "Program Files" / "Steam",
            drive / "Program Files (x86)" / "Steam",
        ])

    # Read each known Steam libraryfolders.vdf; it contains libraries on every drive.
    expanded = list(roots)
    for root in list(roots):
        vdf = root / "steamapps" / "libraryfolders.vdf"
        try:
            expanded.extend(parse_steam_library_paths(vdf.read_text(encoding="utf-8", errors="replace")))
        except OSError:
            pass

    seen: set[str] = set()
    result: list[Path] = []
    for root in expanded:
        key = str(root).rstrip("\\/").lower()
        if key not in seen:
            seen.add(key)
            result.append(root)
    return result


def epic_manifest_locations() -> list[Path]:
    if os.name != "nt":
        return []
    locations: list[Path] = []
    program_data = Path(os.environ.get("ProgramData", r"C:\ProgramData"))
    manifest_dir = program_data / "Epic" / "EpicGamesLauncher" / "Data" / "Manifests"
    try:
        manifests = list(manifest_dir.glob("*.item"))
    except OSError:
        manifests = []
    for item in manifests:
        try:
            data = json.loads(item.read_text(encoding="utf-8-sig"))
            location = data.get("InstallLocation")
            if location:
                locations.append(Path(location))
        except (OSError, json.JSONDecodeError, UnicodeError):
            continue
    return locations


def registry_game_locations() -> list[Path]:
    if os.name != "nt":
        return []
    out: list[Path] = []
    try:
        import winreg
        registry_names = ["Grand Theft Auto V", "Grand Theft Auto V Enhanced"]
        hives = [winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER]
        prefixes = [r"SOFTWARE\Rockstar Games", r"SOFTWARE\WOW6432Node\Rockstar Games"]
        for hive in hives:
            for prefix in prefixes:
                for game in registry_names:
                    value = _registry_value(hive, prefix + "\\" + game, ("InstallFolder", "InstallPath"))
                    if value:
                        out.append(Path(value))
    except Exception:
        pass
    return out


def common_game_paths() -> list[Path]:
    drives = fixed_drive_roots()
    steam = steam_library_roots(drives)
    extras = epic_manifest_locations() + registry_game_locations()

    # Keep environment-specific Program Files paths too; useful on unusual Windows layouts.
    for env_name in ("ProgramFiles", "ProgramFiles(x86)"):
        value = os.environ.get(env_name)
        if value:
            base = Path(value)
            extras.extend([
                base / "Rockstar Games" / "Grand Theft Auto V",
                base / "Rockstar Games" / "Grand Theft Auto V Enhanced",
                base / "Steam" / "steamapps" / "common" / "Grand Theft Auto V",
                base / "Steam" / "steamapps" / "common" / "Grand Theft Auto V Enhanced",
            ])

    return candidate_game_paths(drives, steam_libraries=steam, extra_locations=extras)


def detect_games() -> list[Path]:
    found: list[Path] = []
    seen: set[str] = set()
    for p in common_game_paths():
        if detect_edition(p):
            try:
                key = str(p.resolve()).lower()
            except OSError:
                key = str(p).lower()
            if key not in seen:
                seen.add(key)
                found.append(p)
    return found


class VS_FIXEDFILEINFO(ctypes.Structure):
    _fields_ = [
        ("dwSignature", ctypes.c_uint32),
        ("dwStrucVersion", ctypes.c_uint32),
        ("dwFileVersionMS", ctypes.c_uint32),
        ("dwFileVersionLS", ctypes.c_uint32),
        ("dwProductVersionMS", ctypes.c_uint32),
        ("dwProductVersionLS", ctypes.c_uint32),
        ("dwFileFlagsMask", ctypes.c_uint32),
        ("dwFileFlags", ctypes.c_uint32),
        ("dwFileOS", ctypes.c_uint32),
        ("dwFileType", ctypes.c_uint32),
        ("dwFileSubtype", ctypes.c_uint32),
        ("dwFileDateMS", ctypes.c_uint32),
        ("dwFileDateLS", ctypes.c_uint32),
    ]


def get_file_version(path: Path) -> str | None:
    if os.name != "nt" or not path.is_file():
        return None
    try:
        size = ctypes.windll.version.GetFileVersionInfoSizeW(str(path), None)
        if not size:
            return None
        buf = ctypes.create_string_buffer(size)
        if not ctypes.windll.version.GetFileVersionInfoW(str(path), 0, size, buf):
            return None
        value = ctypes.c_void_p()
        length = ctypes.c_uint()
        if not ctypes.windll.version.VerQueryValueW(buf, "\\", ctypes.byref(value), ctypes.byref(length)):
            return None
        if not value.value or length.value < ctypes.sizeof(VS_FIXEDFILEINFO):
            return None
        ffi = ctypes.cast(value, ctypes.POINTER(VS_FIXEDFILEINFO)).contents
        if ffi.dwSignature != 0xFEEF04BD:
            return None
        ms, ls = ffi.dwFileVersionMS, ffi.dwFileVersionLS
        return f"{ms >> 16}.{ms & 0xffff}.{ls >> 16}.{ls & 0xffff}"
    except Exception:
        return None


def scan_packages() -> dict[str, Path]:
    found: dict[str, Path] = {}
    search_roots = [PACKAGES_DIR]
    candidates: list[Path] = []
    allowed = ARCHIVE_SUFFIXES | {".oiv", ".exe"}
    for root in search_roots:
        if not root.exists():
            continue
        iterator = root.rglob("*") if root == PACKAGES_DIR else root.glob("*")
        candidates.extend(p for p in iterator if p.is_file() and p.suffix.lower() in allowed)
    candidates.sort(key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)

    for p in candidates:
        lower = p.name.lower()
        kind = package_id_from_cache_name(p.name)
        if kind not in MANIFEST["packages"]:
            kind = None
        if not kind and p.suffix.lower() == ".zip":
            kind = identify_zip_package(p)
        elif not kind and p.suffix.lower() == ".exe" and "oivinstaller" in lower:
            kind = "oiv_installer"
        elif not kind and p.suffix.lower() == ".oiv" and ("drive" in lower or lower == "install.oiv"):
            kind = "drivev"
        if kind and kind not in found:
            found[kind] = p
    return found

def package_required(kind: str, edition: str) -> bool:
    entry = MANIFEST["packages"][kind]
    return bool(entry.get("required_" + edition.lower(), False))


def desired_packages(game: Path, edition: str, available: dict[str, Path] | None = None) -> list[str]:
    available = available or {}
    wanted = [kind for kind in PACKAGE_ORDER if package_required(kind, edition)]
    if edition == "Legacy":
        if not legacy_mods_loader_satisfied(game, available.keys()) and "rageopenv" not in wanted:
            wanted.append("rageopenv")
    return [kind for kind in PACKAGE_ORDER if kind in wanted]


def effective_drivev_options(edition: str, install_traffic: bool, install_ai: bool) -> tuple[bool, bool]:
    # The user's checkbox choices are authoritative on both Legacy and Enhanced.
    return bool(install_traffic), bool(install_ai)


def cached_package_valid(path: Path) -> bool:
    try:
        if not path.is_file() or path.stat().st_size < 1024:
            return False
        suffix = path.suffix.lower()
        if suffix in {".zip", ".oiv"}:
            if not zipfile.is_zipfile(path):
                return False
            with zipfile.ZipFile(path) as zf:
                return zf.testzip() is None
        if suffix == ".exe":
            with path.open("rb") as f:
                return f.read(2) == b"MZ"
        if suffix in {".rar", ".7z"}:
            return True
        return False
    except (OSError, zipfile.BadZipFile):
        return False


def ensure_packages(game: Path, edition: str, logger) -> dict[str, Path]:
    packages = scan_packages()
    for kind in desired_packages(game, edition, packages):
        cached = packages.get(kind)
        if cached and cached_package_valid(cached):
            logger(f"Using validated cache for {MANIFEST['packages'][kind]['name']}: {cached.name}")
            continue
        if cached:
            logger(f"Cached {MANIFEST['packages'][kind]['name']} is invalid; redownloading…")
            cached.unlink(missing_ok=True)
            packages.pop(kind, None)
        packages[kind] = download_package(kind, logger)
    return packages


def prepare_zip(package: Path, label: str) -> Path:
    target = WORK_DIR / label
    return extract_archive(package, target, lambda _msg: None)

def find_case_insensitive(root: Path, names: set[str]) -> dict[str, Path]:
    wanted = {n.lower(): n for n in names}
    result: dict[str, Path] = {}
    for p in root.rglob("*"):
        if p.is_file() and p.name.lower() in wanted and p.name.lower() not in result:
            result[p.name.lower()] = p
    return result


def install_named_files(extracted: Path, game: Path, session: BackupSession, names: list[str], logger) -> list[str]:
    found = find_case_insensitive(extracted, {n.lower() for n in names})
    copied = []
    for name in names:
        src = found.get(name.lower())
        if src:
            dst = game / name
            session.copy_with_backup(src, dst)
            copied.append(name)
            logger(f"Installed {name}")
    return copied


def copy_tree_with_backup(src_root: Path, dst_root: Path, session: BackupSession, logger, skip_names: set[str] | None = None):
    skip_names = {x.lower() for x in (skip_names or set())}
    for src in src_root.rglob("*"):
        if not src.is_file() or src.name.lower() in skip_names:
            continue
        rel = src.relative_to(src_root)
        dst = dst_root / rel
        session.copy_with_backup(src, dst)
        logger(f"Installed {rel}")


def patch_enb_ignore_damage_limits(path: Path) -> bool:
    if not path.is_file():
        return False
    text = path.read_text(encoding="utf-8", errors="replace")
    path.write_text(set_enb_ignore_damage_limits_text(text), encoding="utf-8")
    return True


def locate_oiv_installer(package: Path) -> Path:
    if package.suffix.lower() == ".exe":
        return package
    root = prepare_zip(package, "oiv-installer")
    exes = [p for p in root.rglob("*.exe") if "oivinstaller" in p.name.lower()]
    if not exes:
        raise RuntimeError("CodeWalker OIV Package Installer executable was not found in its archive.")
    return exes[0]


def extract_drivev(package: Path) -> tuple[Path, dict[str, object]]:
    if package.suffix.lower() == ".oiv":
        root = WORK_DIR / "drivev"
        if root.exists():
            shutil.rmtree(root)
        root.mkdir(parents=True, exist_ok=True)
        dst = root / package.name
        shutil.copy2(package, dst)
        return root, classify_drivev_oivs([dst.name])
    root = prepare_zip(package, "drivev")
    oivs = [str(p.relative_to(root)).replace("\\", "/") for p in root.rglob("*.oiv")]
    return root, classify_drivev_oivs(oivs)


def run_checked(cmd: list[str], logger) -> None:
    logger("Running: " + " ".join(f'"{x}"' if " " in x else x for x in cmd))
    proc = subprocess.run(cmd, text=True, capture_output=True, creationflags=(subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0))
    if proc.stdout.strip():
        logger(proc.stdout.strip())
    if proc.stderr.strip():
        logger(proc.stderr.strip())
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {proc.returncode}: {Path(cmd[0]).name}")


def download_script_hook(destination: Path, logger) -> Path:
    url = MANIFEST["packages"]["script_hook_v"]["direct_url"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    logger("Downloading Script Hook V from AB Software Development...")
    req = urllib.request.Request(url, headers={"User-Agent": "DriveV-AutoInstaller/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r, destination.open("wb") as f:
        shutil.copyfileobj(r, f)
    with zipfile.ZipFile(destination) as zf:
        if "bin/ScriptHookV.dll" not in {n.replace("\\", "/") for n in zf.namelist()}:
            raise RuntimeError("Downloaded Script Hook V archive does not contain bin/ScriptHookV.dll.")
    logger("Script Hook V download validated as a readable ZIP.")
    return destination


def retain_oiv(oiv: Path, state_root: Path, index: int) -> Path:
    target_dir = state_root / "installed-oivs"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{index:02d}-{oiv.name}"
    shutil.copy2(oiv, target)
    return target


def install_stack(game: Path, packages: dict[str, Path], install_traffic: bool, install_ai: bool, logger) -> dict:
    edition = detect_edition(game)
    if not edition:
        raise RuntimeError("Selected folder is not a GTA V Legacy or Enhanced game directory.")

    state_root = game / "_DriveV_AutoInstaller"
    backup_root = state_root / "backups"
    log_path = state_root / "install.log"
    session = BackupSession(game, backup_root)
    logger(f"Target: {game} ({edition})")

    oiv_exe = locate_oiv_installer(packages["oiv_installer"])
    logger(f"Using OIV installer: {oiv_exe}")

    # Script Hook V. Legacy uses dinput8.dll from ScriptHookV as the ASI loader.
    # Enhanced uses OpenRPF's loader files instead.
    sh_zip = packages["script_hook_v"]
    sh_root = prepare_zip(sh_zip, "script-hook-v")
    sh_names = ["ScriptHookV.dll"] + (["dinput8.dll"] if edition == "Legacy" else [])
    copied = install_named_files(sh_root, game, session, sh_names, logger)
    if "ScriptHookV.dll" not in copied:
        raise RuntimeError("ScriptHookV.dll was not found in the Script Hook V package.")
    if edition == "Legacy" and "dinput8.dll" not in copied:
        raise RuntimeError("dinput8.dll was not found in the Script Hook V package; Legacy ASI loading would not work.")

    # RPF mods-folder loader. Existing OpenIV.asi/RageOpenV.asi is preserved.
    if edition == "Legacy":
        if (game / "OpenIV.asi").is_file():
            logger("Using existing OpenIV.asi as Legacy mods-folder loader.")
        elif (game / "RageOpenV.asi").is_file():
            logger("Using existing RageOpenV.asi as Legacy mods-folder loader.")
        else:
            rage_root = prepare_zip(packages["rageopenv"], "rageopenv")
            rage_copied = install_named_files(rage_root, game, session, ["RageOpenV.asi"], logger)
            if "RageOpenV.asi" not in rage_copied:
                raise RuntimeError("RageOpenV.asi was not found in the RageOpenV package.")
        (game / "mods").mkdir(exist_ok=True)

    # Simple Trainer
    trainer_root = prepare_zip(packages["simple_trainer"], "simple-trainer")
    trainer_copied = install_named_files(trainer_root, game, session, ["TrainerV.asi", "trainerv.ini"], logger)
    if "TrainerV.asi" not in trainer_copied:
        raise RuntimeError("TrainerV.asi was not found in Simple Trainer package.")

    # InversePower
    inv_root = prepare_zip(packages["inverse_power"], "inverse-power")
    inv_copied = install_named_files(inv_root, game, session, ["InversePower.asi", "InversePower.ini"], logger)
    if "InversePower.asi" not in inv_copied:
        raise RuntimeError("InversePower.asi was not found in InversePower package.")

    # Enhanced loader
    if edition == "Enhanced":
        openrpf_root = prepare_zip(packages["openrpf"], "openrpf")
        openrpf_copied = install_named_files(openrpf_root, game, session, ["OpenRPF.asi", "dsound.dll", "xinput1_4.dll"], logger)
        if "OpenRPF.asi" not in openrpf_copied:
            raise RuntimeError("OpenRPF.asi was not found in OpenRPF package.")
        (game / "mods").mkdir(exist_ok=True)

    # Drive V and recommended InversePower settings if included by the author.
    drive_root, classes = extract_drivev(packages["drivev"])
    recommended_ini = [p for p in drive_root.rglob("InversePower.ini") if p.is_file()]
    if recommended_ini:
        session.copy_with_backup(recommended_ini[0], game / "InversePower.ini")
        logger("Applied Drive V's bundled InversePower.ini settings.")
    else:
        logger("Drive V archive did not contain a standalone InversePower.ini; keeping InversePower package settings.")

    main_rel = classes.get("main")
    if not main_rel:
        raise RuntimeError("Could not identify Drive V's main .oiv package.")
    selected_rels: list[str] = [str(main_rel)]
    if install_traffic:
        selected_rels += list(classes.get("traffic", []))
    if install_ai:
        selected_rels += list(classes.get("ai", []))

    retained: list[str] = []
    for idx, rel in enumerate(selected_rels, 1):
        oiv = drive_root / rel
        if not oiv.is_file():
            raise RuntimeError(f"Drive V OIV missing after extraction: {rel}")
        run_checked(oiv_install_command(oiv_exe, oiv, game), logger)
        retained_oiv = retain_oiv(oiv, state_root, idx)
        retained.append(str(retained_oiv))
        logger(f"Installed Drive V OIV: {rel}")

    # Legacy-only ENB. This follows Drive V's explicit d3d11+d3d12 instruction.
    if edition == "Legacy" and "enb" in packages:
        enb_root = prepare_zip(packages["enb"], "enb")
        dlls = [p for p in enb_root.rglob("d3d11.dll") if p.is_file() and "wrapper" in str(p.parent).lower()]
        if not dlls:
            dlls = [p for p in enb_root.rglob("d3d11.dll") if p.is_file()]
        if not dlls:
            raise RuntimeError("ENB package does not contain d3d11.dll.")
        wrapper_dir = dlls[0].parent
        copy_tree_with_backup(wrapper_dir, game, session, logger, skip_names={"d3d12.dll"})
        session.copy_with_backup(dlls[0], game / "d3d12.dll")
        logger("Installed ENB wrapper and duplicated d3d11.dll as d3d12.dll per Drive V instructions.")
        patch_enb_ignore_damage_limits(game / "enblocal.ini")
        logger("Set IgnoreDamageLimits=true in enblocal.ini.")

    scratches_status = "not_automated"
    if edition == "Legacy" and "scratches" in packages:
        logger("Subtle Scratches is not automated by this installer; leaving any cached package untouched.")

    session_manifest = session.save()
    install_state = {
        "format": 1,
        "edition": edition,
        "game": str(game),
        "oiv_installer": str(oiv_exe),
        "installed_oivs": retained,
        "loose_backup_manifest": str(session_manifest),
        "scratches_status": scratches_status,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    (state_root / "install-state.json").write_text(json.dumps(install_state, indent=2), encoding="utf-8")
    log_line(log_path, "Install completed")
    return install_state


def uninstall_stack(game: Path, logger) -> None:
    state_root = game / "_DriveV_AutoInstaller"
    state_file = state_root / "install-state.json"
    if not state_file.is_file():
        raise RuntimeError("No Drive V Auto Installer state was found for this game folder.")
    state = json.loads(state_file.read_text(encoding="utf-8"))
    oiv_exe = Path(state["oiv_installer"])
    if not oiv_exe.is_file():
        current = scan_packages().get("oiv_installer")
        if current:
            oiv_exe = locate_oiv_installer(current)
        else:
            raise RuntimeError("CodeWalker OIV Package Installer is required to reverse the OIV edits.")
    for raw in reversed(state.get("installed_oivs", [])):
        oiv = Path(raw)
        if oiv.is_file():
            run_checked(oiv_uninstall_command(oiv_exe, oiv, game), logger)
            logger(f"Uninstalled OIV: {oiv.name}")
    manifest = Path(state["loose_backup_manifest"])
    BackupSession.restore_from_manifest(manifest)
    logger("Restored wrapper-managed loose files from backup.")
    state_file.rename(state_root / ("install-state.uninstalled-" + time.strftime("%Y%m%d-%H%M%S") + ".json"))


class InstallerApp(tk.Tk):
    def __init__(self, restore_mode: bool = False):
        super().__init__()
        self.title("Drive V One-Click Installer — Legacy + Enhanced")
        self.geometry("900x690")
        self.minsize(760, 600)
        self.restore_mode = restore_mode
        self.packages: dict[str, Path] = {}
        self.msg_queue: queue.Queue = queue.Queue()
        self.worker: threading.Thread | None = None

        self.game_var = tk.StringVar()
        settings = load_user_settings(SETTINGS_FILE)
        saved_game = str(settings.get("game_path", "")).strip()
        if saved_game and detect_edition(Path(saved_game)):
            self.game_var.set(saved_game)
        else:
            games = detect_games()
            if games:
                self.game_var.set(str(games[0]))

        self.traffic_var = tk.BooleanVar(value=True)
        self.ai_var = tk.BooleanVar(value=True)

        self._build()
        self.after(100, self._drain_queue)
        self.protocol("WM_DELETE_WINDOW", self.on_close)
        self.rescan()

    def _build(self):
        pad = {"padx": 10, "pady": 6}
        header = ttk.Label(self, text="Drive V — one-click auto installer", font=("Segoe UI", 16, "bold"))
        header.pack(anchor="w", padx=12, pady=(12, 2))
        ttk.Label(self, text="Story mode only. Missing components are downloaded automatically from their official pages.").pack(anchor="w", padx=12)

        path_frame = ttk.Frame(self)
        path_frame.pack(fill="x", **pad)
        ttk.Label(path_frame, text="GTA V folder:").pack(side="left")
        self.game_entry = ttk.Entry(path_frame, textvariable=self.game_var)
        self.game_entry.pack(side="left", fill="x", expand=True, padx=8)
        self.game_entry.bind("<FocusOut>", lambda _event: self.remember_game_path())
        ttk.Button(path_frame, text="Browse…", command=self.browse_game).pack(side="left")
        ttk.Button(path_frame, text="Detect", command=self.detect_game_button).pack(side="left", padx=(6, 0))

        self.edition_label = ttk.Label(self, text="Edition: —")
        self.edition_label.pack(anchor="w", padx=12)

        opts = ttk.Frame(self)
        opts.pack(fill="x", padx=12, pady=5)
        self.traffic_check = ttk.Checkbutton(opts, text="Drive V optional traffic edits", variable=self.traffic_var)
        self.traffic_check.pack(side="left")
        self.ai_check = ttk.Checkbutton(opts, text="Drive V AI driving improvements", variable=self.ai_var)
        self.ai_check.pack(side="left", padx=20)

        ttk.Label(self, text="Packages", font=("Segoe UI", 11, "bold")).pack(anchor="w", padx=12, pady=(10, 2))
        columns = ("status", "version", "source")
        self.tree = ttk.Treeview(self, columns=columns, show="tree headings", height=10)
        self.tree.heading("#0", text="Component")
        self.tree.heading("status", text="Status")
        self.tree.heading("version", text="Target")
        self.tree.heading("source", text="Detected file")
        self.tree.column("#0", width=230)
        self.tree.column("status", width=100)
        self.tree.column("version", width=115)
        self.tree.column("source", width=390)
        self.tree.pack(fill="x", padx=12, pady=4)

        btns = ttk.Frame(self)
        btns.pack(fill="x", padx=12, pady=5)
        ttk.Button(btns, text="Refresh status", command=self.rescan).pack(side="left")
        ttk.Button(btns, text="Pre-download now", command=self.acquire_missing).pack(side="left", padx=6)

        self.warning_var = tk.StringVar(value="")
        ttk.Label(self, textvariable=self.warning_var, foreground="#cc6600", wraplength=850).pack(anchor="w", padx=12, pady=4)

        action = ttk.Frame(self)
        action.pack(fill="x", padx=12, pady=7)
        self.install_btn = ttk.Button(action, text="INSTALL / UPDATE — AUTO-DOWNLOAD", command=self.start_install)
        self.install_btn.pack(side="left")
        self.uninstall_btn = ttk.Button(action, text="UNINSTALL / RESTORE", command=self.start_uninstall)
        self.uninstall_btn.pack(side="left", padx=8)

        ttk.Label(self, text="Log", font=("Segoe UI", 11, "bold")).pack(anchor="w", padx=12)
        self.log = tk.Text(self, height=12, wrap="word", state="disabled")
        self.log.pack(fill="both", expand=True, padx=12, pady=(2, 12))

        if self.restore_mode:
            self.after(400, self.start_uninstall)

    def logger(self, text: str):
        self.msg_queue.put(("log", text))

    def _drain_queue(self):
        try:
            while True:
                typ, payload = self.msg_queue.get_nowait()
                if typ == "log":
                    self.log.configure(state="normal")
                    self.log.insert("end", str(payload) + "\n")
                    self.log.see("end")
                    self.log.configure(state="disabled")
                elif typ == "done":
                    self._set_busy(False)
                    messagebox.showinfo("Drive V Auto Installer", payload)
                    self.rescan()
                elif typ == "error":
                    self._set_busy(False)
                    messagebox.showerror("Drive V Auto Installer", payload)
        except queue.Empty:
            pass
        self.after(100, self._drain_queue)

    def _set_busy(self, busy: bool):
        state = "disabled" if busy else "normal"
        self.install_btn.configure(state=state)
        self.uninstall_btn.configure(state=state)

    def selected_game(self) -> Path | None:
        raw = self.game_var.get().strip().strip('"')
        if not raw:
            return None
        return Path(raw)

    def update_edition(self):
        game = self.selected_game()
        edition = detect_edition(game) if game else None
        version = None
        if game and edition:
            exe = game / ("GTA5_Enhanced.exe" if edition == "Enhanced" else "GTA5.exe")
            version = get_file_version(exe)
        self.edition_label.configure(text=f"Edition: {edition or 'not detected'}" + (f"   Executable: {version}" if version else ""))
        if edition == "Enhanced":
            self.traffic_check.configure(state="normal")
            self.ai_check.configure(state="normal")
            self.warning_var.set("Enhanced: Traffic edits and AI driving improvements are available. Your checkbox selections will be installed as selected.")
        elif edition == "Legacy":
            self.traffic_check.configure(state="normal")
            self.ai_check.configure(state="normal")
            loader = "existing OpenIV.asi/RageOpenV.asi" if game and legacy_mods_loader_satisfied(game, set()) else "RageOpenV package required"
            self.warning_var.set(f"Legacy: Drive V + required stack are one-click; mods loader: {loader}. No manual downloads are required.")
        else:
            self.traffic_check.configure(state="normal")
            self.ai_check.configure(state="normal")
            self.warning_var.set("Select the folder containing GTA5.exe or GTA5_Enhanced.exe.")
        return edition

    def remember_game_path(self):
        game = self.selected_game()
        if game and detect_edition(game):
            save_user_settings(SETTINGS_FILE, {"game_path": str(game)})
            return True
        return False

    def on_close(self):
        self.remember_game_path()
        self.destroy()

    def browse_game(self):
        p = filedialog.askdirectory(title="Select GTA V game folder")
        if p:
            self.game_var.set(p)
            self.remember_game_path()
            self.update_edition()
            self.rescan()

    def detect_game_button(self):
        games = detect_games()
        if not games:
            messagebox.showwarning("Detect GTA V", "No standard GTA V installation path was detected. Use Browse.")
            return
        self.game_var.set(str(games[0]))
        self.remember_game_path()
        self.update_edition()
        self.rescan()

    def rescan(self):
        self.packages = scan_packages()
        edition = self.update_edition()
        for item in self.tree.get_children():
            self.tree.delete(item)
        for kind in PACKAGE_ORDER:
            entry = MANIFEST["packages"][kind]
            required = package_required(kind, edition) if edition else False
            if kind == "scratches" and edition == "Legacy":
                status = "optional / not automated"
            elif kind == "rageopenv" and edition == "Legacy":
                game = self.selected_game()
                if game and legacy_mods_loader_satisfied(game, set()):
                    status = "existing loader"
                else:
                    status = "CACHED" if kind in self.packages else "AUTO-DOWNLOAD"
            elif edition == "Enhanced" and kind in {"enb", "scratches", "rageopenv"}:
                status = "not used on Enhanced" if kind in {"enb", "scratches"} else "not needed"
            else:
                status = "CACHED" if kind in self.packages else ("AUTO-DOWNLOAD" if required else "optional")
            source = str(self.packages.get(kind, ""))
            self.tree.insert("", "end", iid=kind, text=entry["name"], values=(status, entry.get("version", ""), source))

    def open_packages(self):
        PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(PACKAGES_DIR)
        else:
            webbrowser.open(PACKAGES_DIR.as_uri())

    def acquire_missing(self):
        if self.worker and self.worker.is_alive():
            return
        game = self.selected_game()
        edition = self.update_edition()
        if not game or not edition:
            messagebox.showwarning("Game folder", "Select a valid GTA V folder first.")
            return