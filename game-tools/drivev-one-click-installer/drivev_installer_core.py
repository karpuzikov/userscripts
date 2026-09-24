from __future__ import annotations

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