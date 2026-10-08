# Corrupt Image Verifier v1.1.7 NATIVE TEST
# Windows GUI tool: recursively verifies image files and moves confirmed-corrupt
# files to sibling "<source>_CORRUPTED" folders while preserving relative paths.

import ctypes
import errno
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import traceback
import warnings
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

APP_NAME = "Corrupt Image Verifier"
APP_VERSION = "1.1.7-NATIVE-TEST"
APP_STATUS = "Under construction ⚠️"

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".jpe", ".jfif",
    ".png", ".apng",
    ".gif",
    ".webp",
    ".bmp", ".dib",
    ".tif", ".tiff",
    ".ico",
    ".jp2", ".j2k", ".jpf", ".jpx", ".jpm",
    ".heic", ".heif",
    ".avif",
    ".pcx", ".tga", ".ppm", ".pgm", ".pbm", ".pnm",
    ".dds",
}

PIL_READY = False
HEIF_READY = False
TIFFFILE_READY = False
tifffile = None
Image = None
UnidentifiedImageError = Exception
ImageFile = None

UNDO_LOCK = threading.Lock()
DRIVE_INFO_CACHE = {}


def _hidden_startupinfo():
    if os.name != "nt":
        return None
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = 0
    return si


def _run_hidden(cmd, timeout=None):
    return subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        startupinfo=_hidden_startupinfo(),
        creationflags=(subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0),
    )



def ensure_dependencies():
    """Use application-isolated Python packages; do not modify global site-packages.

    winget manages Windows applications, not Pillow/tifffile Python wheels.
    Check for winget availability but install wheel dependencies with Python pip
    into this application's own Documents folder only.
    """
    global PIL_READY, HEIF_READY, TIFFFILE_READY, tifffile, Image, UnidentifiedImageError, ImageFile
    packages_dir = app_data_dir() / "dependencies" / "python"
    packages_dir.mkdir(parents=True, exist_ok=True)
    if str(packages_dir) not in sys.path:
        sys.path.insert(0, str(packages_dir))

    def install_missing(package):
        cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
               "--target", str(packages_dir), "--upgrade", package]
        result = _run_hidden(cmd, timeout=600)
        if result.returncode:
            raise RuntimeError(
                f"Unable to install {package} in the application dependencies folder: "
                + (result.stderr or result.stdout)[-800:]
            )
        import importlib
        importlib.invalidate_caches()

    # A missing winget is noted, never silently treated as an image error.
    # Python packages have no equivalent winget package, so pip --target is used.
    winget_available = bool(shutil.which("winget") or shutil.which("winget.exe"))
    try:
        from PIL import Image as _Image, UnidentifiedImageError as _UIE, ImageFile as _ImageFile
    except ImportError:
        install_missing("Pillow")
        from PIL import Image as _Image, UnidentifiedImageError as _UIE, ImageFile as _ImageFile
    Image, UnidentifiedImageError, ImageFile = _Image, _UIE, _ImageFile
    PIL_READY = True
    ImageFile.LOAD_TRUNCATED_IMAGES = False

    try:
        import tifffile as _tifffile
    except ImportError:
        try:
            install_missing("tifffile")
            import tifffile as _tifffile
        except Exception:
            _tifffile = None
    tifffile = _tifffile
    TIFFFILE_READY = tifffile is not None

    try:
        import pillow_heif
    except ImportError:
        try:
            install_missing("pillow-heif")
            import pillow_heif
        except Exception:
            pillow_heif = None
    if pillow_heif is not None:
        try:
            pillow_heif.register_heif_opener()
            HEIF_READY = True
        except Exception:
            HEIF_READY = False
    return PIL_READY

def get_documents_dir():
    """Resolve Windows Documents safely, including redirected/OneDrive Documents."""
    if os.name == "nt":
        try:
            import winreg
            key_path = r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key_path) as key:
                value, _ = winreg.QueryValueEx(key, "Personal")
            value = os.path.expandvars(str(value)).strip()
            if value:
                return Path(value)
        except Exception:
            pass

        profile = os.environ.get("USERPROFILE")
        if profile:
            return Path(profile) / "Documents"

    home = Path.home()
    docs = home / "Documents"
    return docs if docs.exists() else home


def app_data_dir():
    return get_documents_dir() / "Karpuzikov Tools" / APP_NAME


def undo_manifest_path():
    return app_data_dir() / "undo" / "last_run.json"


def _atomic_write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


def load_undo_manifest():
    path = undo_manifest_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("moves"), list):
            return data
    except Exception:
        pass
    return None


def has_undo_moves():
    data = load_undo_manifest()
    return bool(data and data.get("moves"))


def record_undo_move(run_id, sources, original, moved_to):
    """Persist every successful move immediately so Undo survives crashes/restarts."""
    with UNDO_LOCK:
        path = undo_manifest_path()
        data = load_undo_manifest()
        if not data or data.get("run_id") != run_id:
            if data and data.get("moves"):
                history = path.parent / "history"
                history.mkdir(parents=True, exist_ok=True)
                past_id = "".join(ch for ch in str(data.get("run_id", "previous"))
                                  if ch.isalnum() or ch in "-_.")
                _atomic_write_json(history / (past_id + ".json"), data)
            data = {
                "version": 2,
                "run_id": run_id,
                "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                "sources": [str(p) for p in sources],
                "moves": [],
            }
        data["moves"].append({
            "original": str(original),
            "moved_to": str(moved_to),
        })
        _atomic_write_json(path, data)


def retract_undo_move(original, moved_to):
    """Discard a pending move record if the original was never removed."""
    with UNDO_LOCK:
        path = undo_manifest_path()
        data = load_undo_manifest()
        if not data:
            return
        data["moves"] = [
            m for m in data["moves"]
            if not (m.get("original") == str(original)
                    and m.get("moved_to") == str(moved_to))
        ]
        if data["moves"]:
            _atomic_write_json(path, data)
        else:
            path.unlink(missing_ok=True)


def save_remaining_undo_moves(data, remaining):
    with UNDO_LOCK:
        path = undo_manifest_path()
        if remaining:
            data = dict(data)
            data["moves"] = remaining
            _atomic_write_json(path, data)
        else:
            try:
                path.unlink()
            except FileNotFoundError:
                pass


def human_bytes(n):
    n = float(n)
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    for unit in units:
        if n < 1024.0 or unit == units[-1]:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.2f} {unit}"
        n /= 1024.0


def _signature_issue(path):
    """Return a concise signature problem for formats with reliable magic bytes.

    This is only used after Pillow already failed to identify the file, so a
    mismatched extension on an otherwise decodable image is not treated as
    corruption.
    """
    ext = path.suffix.lower()
    try:
        with path.open("rb") as fh:
            head = fh.read(32)
    except OSError:
        return None

    checks = {
        ".jpg": (head.startswith(b"\xff\xd8"), "Invalid JPEG signature (missing FF D8 start marker)"),
        ".jpeg": (head.startswith(b"\xff\xd8"), "Invalid JPEG signature (missing FF D8 start marker)"),
        ".jpe": (head.startswith(b"\xff\xd8"), "Invalid JPEG signature (missing FF D8 start marker)"),
        ".jfif": (head.startswith(b"\xff\xd8"), "Invalid JPEG signature (missing FF D8 start marker)"),
        ".png": (head.startswith(b"\x89PNG\r\n\x1a\n"), "Invalid PNG signature"),
        ".apng": (head.startswith(b"\x89PNG\r\n\x1a\n"), "Invalid PNG/APNG signature"),
        ".gif": (head.startswith((b"GIF87a", b"GIF89a")), "Invalid GIF signature"),
        ".bmp": (head.startswith(b"BM"), "Invalid BMP signature"),
        ".dib": (True, ""),  # DIB files do not carry the BMP file header.
        ".tif": (head.startswith((b"II*\x00", b"MM\x00*")), "Invalid TIFF signature"),
        ".tiff": (head.startswith((b"II*\x00", b"MM\x00*")), "Invalid TIFF signature"),
        ".webp": (len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP", "Invalid WebP signature"),
        ".ico": (head.startswith(b"\x00\x00\x01\x00"), "Invalid ICO signature"),
        ".dds": (head.startswith(b"DDS "), "Invalid DDS signature"),
        ".pcx": (head.startswith(b"\x0a"), "Invalid PCX signature"),
        ".ppm": (head[:2] in {b"P3", b"P6"}, "Invalid PPM signature"),
        ".pgm": (head[:2] in {b"P2", b"P5"}, "Invalid PGM signature"),
        ".pbm": (head[:2] in {b"P1", b"P4"}, "Invalid PBM signature"),
        ".pnm": (head[:2] in {b"P1", b"P2", b"P3", b"P4", b"P5", b"P6"}, "Invalid PNM signature"),
    }

    if ext in {".jp2", ".j2k", ".jpf", ".jpx", ".jpm"}:
        jp2_box = b"\x00\x00\x00\x0cjP  \r\n\x87\n"
        codestream = b"\xffO\xffQ"
        ok = head.startswith(jp2_box) or head.startswith(codestream)
        return None if ok else "Invalid JPEG 2000 signature"

    item = checks.get(ext)
    if not item:
        return None
    ok, reason = item
    return None if ok else reason


def _looks_like_iso_bmff_image(path):
    """Best-effort HEIF/AVIF container check used only for decoder classification."""
    try:
        with path.open("rb") as fh:
            head = fh.read(64)
    except OSError:
        return False
    if len(head) < 12 or head[4:8] != b"ftyp":
        return False
    brands = {b"avif", b"avis", b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"}
    return any(head[i:i+4] in brands for i in range(8, len(head) - 3, 4))



def verify_tiff_with_tifffile(path):
    """Never condemn a TIFF solely on unsupported or failed decoder behavior."""
    if not TIFFFILE_READY or tifffile is None:
        return "unsupported", "TIFF fallback decoder (tifffile) is unavailable"
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            with tifffile.TiffFile(path) as tif:
                if not tif.pages:
                    return "warning", "TIFF has no accessible image pages"
                decoded_any = False
                for page in tif.pages:
                    segments = 0
                    for decoded, _indices, _shape in page.segments(maxworkers=1):
                        segments += 1
                        if decoded is not None:
                            decoded_any = True
                    if not segments and getattr(page, "size", 0):
                        page.asarray()
                        decoded_any = True
                if not decoded_any:
                    return "warning", "TIFF contains no decoded pixel data"
        return "good", "Validated by TIFF fallback decoder"
    except PermissionError as exc:
        return "error", f"Permission denied: {exc}"
    except OSError as exc:
        if isinstance(exc, (FileNotFoundError, IsADirectoryError)):
            return "error", str(exc)
        return "error", f"TIFF I/O failure: {exc}"
    except Exception as exc:
        reason = str(exc).strip() or exc.__class__.__name__
        if any(t in reason.lower() for t in (
            "requires imagecodecs", "requires the 'imagecodecs' package",
            "unsupported", "not implemented", "cannot decode", "codec",
        )):
            return "unsupported", reason
        return "warning", f"TIFF decoder could not establish corruption: {reason}"


def classify_exception(exc):
    reason = str(exc).strip() or exc.__class__.__name__
    low = reason.lower()
    if isinstance(exc, (PermissionError, FileNotFoundError, IsADirectoryError)):
        return "error", reason
    if any(t in low for t in ("not installed", "unsupported", "decoder not available",
                               "no decode delegate", "requires imagecodecs")):
        return "unsupported", reason
    if any(t in low for t in ("truncated", "broken", "crc", "invalid", "checksum",
                               "cannot identify", "premature end", "not enough data",
                               "end of file", "corrupt", "decompression bomb")):
        return "warning", reason
    return "error", reason


def _jpeg_missing_eoi(path):
    """Recognizable JPEG with a missing terminal FF D9 marker."""
    try:
        with path.open("rb") as handle:
            if handle.read(2) != b"\xff\xd8":
                return False
            handle.seek(-2, os.SEEK_END)
            return handle.read(2) != b"\xff\xd9"
    except (OSError, ValueError):
        return False


def detect_visual_anomaly(im):
    """Flag JPEG-like horizontal pixel damage for review; heuristic, not proof.

    Deliberate glitch art, collages, and sharply divided colored graphics can
    resemble damaged images. This function must NEVER classify a file as corrupt.
    Pillow-only implementation, capped at a small preview for scan performance.
    """
    if im.width < 128 or im.height < 128:
        return ""
    w = min(160, im.width)
    h = min(384, max(96, round(im.height * w / im.width)))
    resampling = getattr(Image, "Resampling", Image)
    small = im.convert("RGB").resize((w, h), resample=resampling.BOX)
    data = small.tobytes()
    stride = w * 3
    sat_by_row = []
    jumps = [0.0]
    for row in range(h):
        a = row * stride
        sat = 0
        for k in range(a, a + stride, 3):
            red, green, blue = data[k], data[k + 1], data[k + 2]
            hi = max(red, green, blue)
            lo = min(red, green, blue)
            if hi > 20 and (hi - lo) * 100 >= hi * 85:
                sat += 1
        sat_by_row.append(sat / w)
        if row:
            b = a - stride
            jumps.append(
                sum(abs(data[a + k] - data[b + k]) for k in range(stride)) / stride
            )
    start, end = round(h * 0.18), round(h * 0.82)
    for boundary in sorted(range(start, end), key=lambda y: jumps[y], reverse=True):
        seam = jumps[boundary]
        if seam < 32:
            break
        before = sum(sat_by_row[:boundary]) / boundary
        after = sum(sat_by_row[boundary:]) / (h - boundary)
        if abs(before - after) < 0.48 or max(before, after) < 0.74:
            continue
        return (
            "VISUAL DAMAGE SUSPECTED - abrupt horizontal band "
            f"({seam:.0f} RGB levels at {boundary / h:.0%} height); "
            f"unusual color/saturation shift ({before:.0%} to {after:.0%}). "
            "Review image visually; not automatically moved."
        )
    return ""


def verify_image(path):
    """Return good, warning, unsupported, error, or confirmed corrupt.

    Only objective zero-byte data or an unrecognized invalid signature may be
    marked corrupt. Decoder failure alone is never enough to move a file.
    """
    path = Path(path)
    try:
        st = path.stat()
        if not path.is_file():
            return "error", "Not a regular file"
        if path.is_symlink():
            return "error", "Symbolic links are never modified"
    except OSError as exc:
        return "error", f"File access failed: {exc}"
    if st.st_size == 0:
        return "corrupt", "Empty image file (0 bytes)"
    if not PIL_READY:
        return "error", "Pillow decoder is unavailable"
    ext = path.suffix.lower()
    if ext in {".heic", ".heif"} and not HEIF_READY:
        return "unsupported", "HEIC/HEIF decoder is unavailable"
    jpeg_family = ext in {".jpg", ".jpeg", ".jpe", ".jfif"}
    missing_eoi = jpeg_family and _jpeg_missing_eoi(path)
    visual_issue = ""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as im:
                pixels = im.width * im.height
                limit = getattr(Image, "MAX_IMAGE_PIXELS", None)
                if limit is not None and pixels > limit:
                    return "warning", f"LARGE IMAGE - LEFT IN PLACE ({pixels:,} pixels)"
                im.verify()
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as im:
                frame = 0
                while True:
                    try:
                        im.seek(frame)
                    except EOFError:
                        break
                    im.load()
                    frame += 1
                if frame == 0:
                    im.load()
                if jpeg_family:
                    visual_issue = detect_visual_anomaly(im)
        if missing_eoi:
            return "warning", "JPEG missing final FF D9 marker; fully decodable"
        if visual_issue:
            return "warning", visual_issue
        return "good", ""
    except (Image.DecompressionBombWarning, Image.DecompressionBombError):
        return "warning", "LARGE IMAGE - LEFT IN PLACE (decompression-bomb protection)"
    except PermissionError as exc:
        return "error", f"Permission denied: {exc}"
    except UnidentifiedImageError as exc:
        if ext in {".tif", ".tiff"} and _signature_issue(path) is None:
            return verify_tiff_with_tifffile(path)
        if ext in {".heic", ".heif", ".avif"} and _looks_like_iso_bmff_image(path):
            return "unsupported", "Recognized container; image decoder unavailable or failed"
        issue = _signature_issue(path)
        if issue:
            return "corrupt", issue
        return "warning", f"Image decoder could not identify contents: {exc}"
    except OSError as exc:
        if ext in {".tif", ".tiff"} and _signature_issue(path) is None:
            return verify_tiff_with_tifffile(path)
        if missing_eoi:
            return "warning", "JPEG missing FF D9; image retained for manual review"
        return classify_exception(exc)
    except Exception as exc:
        if ext in {".tif", ".tiff"} and _signature_issue(path) is None:
            return verify_tiff_with_tifffile(path)
        return classify_exception(exc)

def same_file_contents(a, b, chunk=4 * 1024 * 1024):
    try:
        if a.stat().st_size != b.stat().st_size:
            return False
        with a.open("rb") as fa, b.open("rb") as fb:
            while True:
                ca = fa.read(chunk)
                cb = fb.read(chunk)
                if ca != cb:
                    return False
                if not ca:
                    return True
    except OSError:
        return False



def _copy_noclobber(src, dest):
    """Verify a private staging copy and publish without overwriting anything."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    stage = dest.with_name(dest.name + ".stage-" + uuid.uuid4().hex)
    try:
        with stage.open("xb") as out, src.open("rb") as inp:
            shutil.copyfileobj(inp, out, length=4 * 1024 * 1024)
        shutil.copystat(src, stage)
        if not same_file_contents(src, stage):
            raise OSError("Byte-for-byte staging verification failed")
        try:
            # Atomic, no-clobber publication when hardlinks are supported.
            os.link(stage, dest)
        except FileExistsError:
            raise
        except OSError:
            if os.name == "nt":
                # Windows rename rejects an existing destination and is atomic.
                os.rename(stage, dest)
                return
            # Non-Windows unsupported-link fallback; create exclusively.
            created = False
            try:
                with dest.open("xb") as out, stage.open("rb") as inp:
                    created = True
                    shutil.copyfileobj(inp, out, length=4 * 1024 * 1024)
                if not same_file_contents(stage, dest):
                    raise OSError("Byte-for-byte publication verification failed")
            except Exception:
                if created:
                    dest.unlink(missing_ok=True)
                raise
    finally:
        try:
            stage.unlink(missing_ok=True)
        except OSError:
            pass


def move_preserving_structure(source_root, file_path, run_id=None, sources=None, expected=None):
    source_root = Path(source_root).resolve()
    file_path = Path(file_path)
    if file_path.is_symlink():
        raise OSError("Symlink was not moved")
    original = file_path.resolve(strict=True)
    rel = original.relative_to(source_root)
    dest_root = source_root.parent / f"{source_root.name}_CORRUPTED"
    dest = dest_root / rel
    if dest.exists() or dest.is_symlink():
        raise FileExistsError("Destination collision - existing quarantined file left untouched")
    if expected is not None:
        now = original.stat()
        if (now.st_size, now.st_mtime_ns) != expected:
            raise OSError("Source changed since scan - left in place")
    _copy_noclobber(original, dest)
    try:
        if expected is not None:
            now = original.stat()
            if (now.st_size, now.st_mtime_ns) != expected:
                raise OSError("Source changed during copy - left in place")
        # Persist undo BEFORE unlinking the original to close the recovery gap.
        if run_id is not None:
            record_undo_move(run_id, sources or [source_root], original, dest)
        original.unlink()
    except Exception:
        # In case original remains, do not leave an unrecorded destination.
        if original.exists():
            dest.unlink(missing_ok=True)
            if run_id is not None:
                retract_undo_move(original, dest)
        raise
    return dest


def restore_moved_file(original, moved_to):
    original, moved_to = Path(original), Path(moved_to)
    if not moved_to.is_file():
        return False, "Moved file no longer exists"
    if original.exists() or original.is_symlink():
        return False, "Original path already exists; nothing was overwritten"
    try:
        _copy_noclobber(moved_to, original)
        moved_to.unlink()
        return True, ""
    except Exception as exc:
        return False, str(exc)

def cleanup_empty_parents(path, stop_at):
    path = Path(path)
    stop_at = Path(stop_at)
    try:
        current = path.parent
        stop_resolved = stop_at.resolve()
        while current.exists():
            try:
                if current.resolve() == stop_resolved:
                    if not any(current.iterdir()):
                        current.rmdir()
                    break
                if any(current.iterdir()):
                    break
                parent = current.parent
                current.rmdir()
                current = parent
            except OSError:
                break
    except Exception:
        pass


def collect_images(source_root):
    source_root = source_root.resolve()
    corrupted_root = source_root.parent / f"{source_root.name}_CORRUPTED"

    files = []
    corrupted_resolved = corrupted_root.resolve()
    for root, dirs, names in os.walk(source_root, followlinks=False):
        root_path = Path(root)
        kept_dirs = []
        for d in dirs:
            try:
                if (root_path / d).resolve() == corrupted_resolved:
                    continue
            except OSError:
                pass
            if d.upper().endswith("_CORRUPTED"):
                continue
            kept_dirs.append(d)
        dirs[:] = kept_dirs

        for name in names:
            p = root_path / name
            if p.suffix.lower() in IMAGE_EXTENSIONS:
                files.append(p)
    return files


def _powershell_executable():
    for candidate in ("pwsh.exe", "powershell.exe"):
        path = shutil.which(candidate)
        if path:
            return path
    return None


def _storage_type(media_type, bus_type, spindle_speed, friendly_name):
    media = (media_type or "").strip().lower()
    bus = (bus_type or "").strip().lower()
    name = (friendly_name or "").strip().lower()

    if "ssd" in media:
        return "NVMe SSD" if "nvme" in bus else "SSD"
    if "hdd" in media:
        return "HDD"
    if "nvme" in bus:
        return "NVMe SSD"

    try:
        speed = int(float(spindle_speed))
        if speed > 0:
            return "HDD"
    except (TypeError, ValueError):
        pass

    if "nvme" in name:
        return "NVMe SSD"
    if "ssd" in name or "solid state" in name:
        return "SSD"
    if "hdd" in name:
        return "HDD"
    return "Unknown"


def detect_drive_info(path):
    path = Path(path).resolve()
    anchor = path.anchor or str(path)
    cache_key = anchor.upper()
    cached = DRIVE_INFO_CACHE.get(cache_key)
    if cached:
        return dict(cached)

    fallback = {
        "drive": anchor.rstrip("\\/") or anchor,
        "disk_number": None,
        "disk_key": cache_key,
        "friendly_name": "Unknown drive",
        "bus_type": "Unknown",
        "media_type": "Unknown",
        "storage_type": "Unknown",
    }

    if os.name != "nt" or len(path.drive) < 2 or path.drive[1] != ":":
        DRIVE_INFO_CACHE[cache_key] = fallback
        return dict(fallback)

    ps = _powershell_executable()
    if not ps:
        DRIVE_INFO_CACHE[cache_key] = fallback
        return dict(fallback)

    letter = path.drive[0].upper()
    script = rf"""
$ErrorActionPreference = 'SilentlyContinue'
$part = Get-Partition -DriveLetter '{letter}' | Select-Object -First 1
$disk = $null
if ($part) {{ $disk = $part | Get-Disk }}
$pd = $null
if ($disk) {{
    $pd = Get-PhysicalDisk | Where-Object {{ [string]$_.DeviceId -eq [string]$disk.Number }} | Select-Object -First 1
    if (-not $pd) {{
        $pd = Get-PhysicalDisk | Where-Object {{ $_.FriendlyName -eq $disk.FriendlyName }} | Select-Object -First 1
    }}
}}
[pscustomobject]@{{
    Drive = '{letter}:'
    DiskNumber = $(if ($disk) {{ [int]$disk.Number }} else {{ $null }})
    FriendlyName = $(if ($disk) {{ [string]$disk.FriendlyName }} else {{ '' }})
    BusType = $(if ($disk) {{ [string]$disk.BusType }} else {{ '' }})
    MediaType = $(if ($pd) {{ [string]$pd.MediaType }} else {{ '' }})
    SpindleSpeed = $(if ($pd) {{ [string]$pd.SpindleSpeed }} else {{ '' }})
}} | ConvertTo-Json -Compress
"""

    try:
        result = _run_hidden([ps, "-NoProfile", "-NonInteractive", "-Command", script], timeout=12)
        if result.returncode != 0 or not result.stdout.strip():
            raise RuntimeError(result.stderr.strip() or "PowerShell drive query failed")
        data = json.loads(result.stdout.strip())
        disk_number = data.get("DiskNumber")
        friendly = str(data.get("FriendlyName") or "Unknown drive")
        bus = str(data.get("BusType") or "Unknown")
        media = str(data.get("MediaType") or "Unknown")
        spindle = data.get("SpindleSpeed")
        storage_type = _storage_type(media, bus, spindle, friendly)
        disk_key = f"disk:{disk_number}" if disk_number is not None else f"drive:{letter}:"

        info = {
            "drive": f"{letter}:",
            "disk_number": disk_number,
            "disk_key": disk_key,
            "friendly_name": friendly,
            "bus_type": bus,
            "media_type": media,
            "storage_type": storage_type,
        }
        DRIVE_INFO_CACHE[cache_key] = info
        return dict(info)
    except Exception:
        fallback["drive"] = f"{letter}:"
        fallback["disk_key"] = f"drive:{letter}:"
        DRIVE_INFO_CACHE[cache_key] = fallback
        return dict(fallback)


def preferred_workers_for_drive(info):
    """Aggressive drive-aware defaults; final allocation is globally capped by CPU count."""
    cpu = max(4, os.cpu_count() or 4)
    storage = info.get("storage_type", "Unknown")

    if storage == "HDD":
        return 4
    if storage == "NVMe SSD":
        return min(24, max(14, cpu * 2))
    if storage == "SSD":
        return min(18, max(10, cpu))
    return min(10, max(6, cpu // 2))


def _minimum_workers_for_drive(info):
    storage = info.get("storage_type", "Unknown")
    if storage == "HDD":
        return 4
    if storage == "NVMe SSD":
        return 8
    if storage == "SSD":
        return 6
    return 4


def allocate_drive_workers(unique_drive_infos):
    """
    Allocate workers per physical drive.

    Different physical drives run in parallel. Multiple source folders on the same
    disk share one pool. A global CPU-based cap prevents 5+ SSDs from creating an
    unbounded number of decoder threads while still allowing far more than the old
    single 4-8 worker pool.
    """
    infos = {k: dict(v) for k, v in unique_drive_infos.items()}
    if not infos:
        return {}

    requested = {k: preferred_workers_for_drive(v) for k, v in infos.items()}
    minimums = {k: min(requested[k], _minimum_workers_for_drive(v)) for k, v in infos.items()}

    cpu = max(4, os.cpu_count() or 4)
    global_cap = max(32, min(128, cpu * 4))
    requested_total = sum(requested.values())
    if requested_total <= global_cap:
        return requested

    min_total = sum(minimums.values())
    if min_total >= global_cap:
        # Extremely many drives: preserve at least one worker per drive.
        allocation = {k: 1 for k in infos}
        remaining = max(0, global_cap - len(allocation))
        order = sorted(
            infos,
            key=lambda k: {"NVMe SSD": 3, "SSD": 2, "Unknown": 1, "HDD": 0}.get(
                infos[k].get("storage_type", "Unknown"), 1
            ),
            reverse=True,
        )
        i = 0
        while remaining > 0 and order:
            key = order[i % len(order)]
            if allocation[key] < requested[key]:
                allocation[key] += 1
                remaining -= 1
            i += 1
        return allocation

    expandable = sum(requested[k] - minimums[k] for k in infos)
    budget = global_cap - min_total
    allocation = dict(minimums)
    if expandable > 0:
        for k in infos:
            share = (requested[k] - minimums[k]) / expandable
            allocation[k] += int(budget * share)

    # Spend any remaining slots according to storage priority and unmet request.
    remaining = global_cap - sum(allocation.values())
    order = sorted(
        infos,
        key=lambda k: (
            {"NVMe SSD": 3, "SSD": 2, "Unknown": 1, "HDD": 0}.get(infos[k].get("storage_type", "Unknown"), 1),
            requested[k] - allocation[k],
        ),
        reverse=True,
    )
    while remaining > 0:
        progressed = False
        for k in order:
            if remaining <= 0:
                break
            if allocation[k] < requested[k]:
                allocation[k] += 1
                remaining -= 1
                progressed = True
        if not progressed:
            break

    return allocation


def format_elapsed(seconds):
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def is_same_or_child(path, possible_parent):
    try:
        Path(path).resolve().relative_to(Path(possible_parent).resolve())
        return True
    except (ValueError, OSError):
        return False


def launch_gui():
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox
    import time

    BG = "#25282d"
    PANEL = "#30343b"
    FIELD = "#30343b"
    BUTTON = "#343941"
    BUTTON_ACTIVE = "#424a55"
    FG = "#eef0f3"
    MUTED = "#abb3bd"
    BORDER = "#454c56"
    ACCENT = "#70acff"
    ERROR = "#ffcc66"
    WARNING = "#ffcc66"
    SUCCESS = "#f4f1e8"

    def enable_dark_title_bar(window):
        if os.name != "nt":
            return
        try:
            from ctypes import wintypes
            window.update_idletasks()
            user32 = ctypes.windll.user32
            dwmapi = ctypes.windll.dwmapi
            user32.GetParent.argtypes = [wintypes.HWND]
            user32.GetParent.restype = wintypes.HWND
            dwmapi.DwmSetWindowAttribute.argtypes = [
                wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD
            ]
            dwmapi.DwmSetWindowAttribute.restype = ctypes.c_long
            hwnd = user32.GetParent(wintypes.HWND(window.winfo_id()))
            if not hwnd:
                hwnd = wintypes.HWND(window.winfo_id())
            value = ctypes.c_int(1)
            for attr in (20, 19):
                try:
                    if dwmapi.DwmSetWindowAttribute(
                        hwnd, attr, ctypes.byref(value), ctypes.sizeof(value)
                    ) == 0:
                        break
                except Exception:
                    pass
        except Exception:
            pass

    class App:
        def __init__(self, root):
            self.root = root
            self.root.title(f"{APP_NAME} v{APP_VERSION}")
            self.root.geometry("1040x720")
            self.root.minsize(900, 620)
            self.root.configure(bg=BG)

            self.style = ttk.Style(self.root)
            try:
                self.style.theme_use("clam")
            except Exception:
                pass
            self.configure_styles()

            self.q = queue.Queue()
            self.running = False
            self.undo_running = False
            self.stop_event = threading.Event()
            self.start_time = None
            self.sources = []
            self.worker_plan = {}
            self.current_run_id = None
            self.review_candidates = []
            self.scan_completed = False
            self.mode = "idle"
            self.discovered = 0
            self.worker_count = 0
            self.drive_count = 0
            self.review_by_iid = {}
            self.visual_checked = 0
            self.visual_suspects = 0

            self.status_var = tk.StringVar(value="Ready")
            self.progress_var = tk.DoubleVar(value=0)
            self.plan_var = tk.StringVar(value="Add one or more source folders.")
            self.stage_var = tk.StringVar(value="STAGE: READY")
            self.detail_progress_var = tk.StringVar(value="Discovered: 0 | Checked: 0/0 | Elapsed: 00:00 | 0.0 files/s | 0 workers / 0 drives")

            self.good = self.warning = self.corrupt = self.moved = self.unsupported = self.errors = 0
            self.total = self.done = 0
            self.bytes_scanned = 0
            self.bytes_moved = 0

            self.build_ui()
            self.refresh_undo_button()
            self.root.after(50, lambda: enable_dark_title_bar(self.root))
            self.root.after(100, self.process_queue)

        def configure_styles(self):
            """Compact native-control layout inspired by ReNamer's workflow."""
            style = self.style
            base = ("Segoe UI", 9)
            style.configure(".", background=BG, foreground=FG, font=base)
            style.configure("TFrame", background=BG)
            style.configure("TLabel", background=BG, foreground=FG, font=base)
            style.configure("TButton", background=BUTTON, foreground=FG,
                            bordercolor=BORDER, font=base, padding=(8, 4))
            style.configure("Toolbar.TButton", background=BUTTON, foreground=FG,
                            bordercolor=BORDER, font=base, padding=(9, 5))
            style.map("Toolbar.TButton",
                      background=[("pressed", "#395778"), ("active", BUTTON_ACTIVE)],
                      foreground=[("disabled", "#88909d")])
            style.configure("Ascii.Treeview", background=PANEL, fieldbackground=PANEL,
                            foreground=FG, font=base, rowheight=24, borderwidth=0)
            style.map("Ascii.Treeview",
                      background=[("selected", "#31577c")],
                      foreground=[("selected", "#ffffff")])
            style.configure("Ascii.Treeview.Heading", background="#363b43",
                            foreground=FG, font=("Segoe UI", 9, "bold"),
                            relief="flat", borderwidth=1, bordercolor=BORDER)
            style.map("Ascii.Treeview.Heading",
                      background=[("active", "#414952")])
            style.configure("TNotebook", background=BG, borderwidth=0)
            style.configure("TNotebook.Tab", background=PANEL, foreground=FG,
                            font=base, padding=(11, 6))
            style.map("TNotebook.Tab", background=[("selected", "#3d444f")],
                      foreground=[("selected", FG)])
            style.configure("TProgressbar", troughcolor="#1e2024",
                            background="#5691ce", borderwidth=0)
            style.configure("Vertical.TScrollbar", background=BUTTON,
                            troughcolor=BG, arrowcolor=FG)
            style.configure("Horizontal.TScrollbar", background=BUTTON,
                            troughcolor=BG, arrowcolor=FG)

        def _ascii_button(self, parent, text, command, width=None, state="normal"):
            return ttk.Button(parent, text=text, command=command, width=width,
                              state=state, style="Toolbar.TButton", takefocus=True)

        def _ascii_label(self, parent, text=None, textvariable=None,
                         size=9, bold=False, fg=None, **kwargs):
            return ttk.Label(parent, text=text, textvariable=textvariable,
                             font=("Segoe UI", size, "bold" if bold else "normal"),
                             foreground=fg or FG, **kwargs)

        def update_ascii_progress(self, *_):
            # Kept as an API compatibility hook: the new UI uses a native progressbar.
            pass

        def build_ui(self):
            self.root.geometry("1000x660")
            self.root.minsize(750, 430)

            # Native application menu, like ReNamer.
            menu = tk.Menu(self.root)
            m_file = tk.Menu(menu, tearoff=0)
            m_file.add_command(label="Add Folder...", command=self.add_source,
                               accelerator="Ctrl+O")
            m_file.add_command(label="Check File...", command=self.quick_check_file,
                               accelerator="Ctrl+F")
            m_file.add_command(label="Scan Images", command=self.start,
                               accelerator="F5")
            m_file.add_separator()
            m_file.add_command(label="Exit", command=self.root.destroy)
            menu.add_cascade(label="File", menu=m_file)
            m_view = tk.Menu(menu, tearoff=0)
            m_view.add_command(label="Results", command=lambda: self.notebook.select(self.results_tab))
            m_view.add_command(label="Activity", command=lambda: self.notebook.select(self.activity_tab))
            menu.add_cascade(label="View", menu=m_view)
            m_help = tk.Menu(menu, tearoff=0)
            m_help.add_command(label="About", command=lambda: messagebox.showinfo(
                APP_NAME, f"{APP_NAME} {APP_VERSION}\n{APP_STATUS}\n"
                          "Scan first; review warnings; only confirmed candidates can move."
            ))
            menu.add_cascade(label="Help", menu=m_help)
            self.root.configure(menu=menu)
            self.root.bind_all("<Control-o>", lambda _e: self.add_source())
            self.root.bind_all("<Control-f>", lambda _e: self.quick_check_file())
            self.root.bind_all("<F5>", lambda _e: self.start() if not self.running else None)

            # Single compact workflow toolbar; no decorative cards or oversized header.
            bar = ttk.Frame(self.root, padding=(6, 6))
            bar.pack(side="top", fill="x")
            self.add_btn = self._ascii_button(bar, "+ Add Folder", self.add_source)
            self.add_btn.pack(side="left", padx=(0, 4))
            self.remove_btn = self._ascii_button(bar, "Remove", self.remove_selected_sources)
            self.remove_btn.pack(side="left", padx=(0, 4))
            self.clear_btn = self._ascii_button(bar, "Clear", self.clear_sources)
            self.clear_btn.pack(side="left", padx=(0, 12))
            self.check_btn = self._ascii_button(bar, "Check File", self.quick_check_file)
            self.check_btn.pack(side="left", padx=(0, 4))
            self.start_btn = self._ascii_button(bar, "Scan", self.start)
            self.start_btn.pack(side="left", padx=(0, 4))
            self.stop_btn = self._ascii_button(bar, "Stop", self.stop, state="disabled")
            self.stop_btn.pack(side="left", padx=(0, 12))
            self.move_btn = self._ascii_button(bar, "Move Confirmed", self.start_move,
                                               state="disabled")
            self.move_btn.pack(side="left", padx=(0, 4))
            self.undo_btn = self._ascii_button(bar, "Undo", self.start_undo)
            self.undo_btn.pack(side="left")

            # Bottom status bar is always visible, independent of window resizing.
            footer = ttk.Frame(self.root, padding=(8, 3))
            footer.pack(side="bottom", fill="x")
            self.stats_vars = {
                "Checked": tk.StringVar(value="0"),
                "Good": tk.StringVar(value="0"),
                "Confirmed": tk.StringVar(value="0"),
                "Warnings": tk.StringVar(value="0"),
                "Moved": tk.StringVar(value="0"),
                "Unsupported": tk.StringVar(value="0"),
                "Errors": tk.StringVar(value="0"),
            }
            for name, variable in self.stats_vars.items():
                ttk.Label(footer, text=f"{name}:").pack(side="left", padx=(0, 2))
                ttk.Label(footer, textvariable=variable).pack(side="left", padx=(0, 10))
            stagebar = ttk.Frame(self.root, padding=(8, 3))
            stagebar.pack(side="bottom", fill="x")
            self.progress = ttk.Progressbar(stagebar, variable=self.progress_var,
                                            maximum=100, length=125)
            self.progress.pack(side="right", padx=(8, 0))
            ttk.Label(stagebar, textvariable=self.stage_var).pack(side="left", padx=(0, 8))
            self.status_label = ttk.Label(stagebar, textvariable=self.status_var)
            self.status_label.pack(side="left", fill="x", expand=True)
            ttk.Label(self.root, textvariable=self.detail_progress_var,
                      padding=(8, 1)).pack(side="bottom", fill="x")

            # Splitter lets the user resize source and file panes (ReNamer pattern).
            self.panes = ttk.Panedwindow(self.root, orient="vertical")
            self.panes.pack(side="top", fill="both", expand=True, padx=7, pady=(0, 4))
            sources_pane = ttk.Frame(self.panes)
            self.panes.add(sources_pane, weight=1)
            source_title = ttk.Frame(sources_pane)
            source_title.pack(fill="x", pady=(2, 4))
            ttk.Label(source_title, text="Sources", font=("Segoe UI", 9, "bold")).pack(side="left")
            ttk.Label(source_title, textvariable=self.plan_var).pack(side="right")
            source_table = ttk.Frame(sources_pane)
            source_table.pack(fill="both", expand=True)
            columns = ("open", "path", "drive", "type", "workers")
            self.source_tree = ttk.Treeview(source_table, columns=columns,
                                             show="headings", height=3,
                                             selectmode="extended", style="Ascii.Treeview")
            for key, title, width in (
                ("open", "Open", 56),
                ("path", "Source folder", 580),
                ("drive", "Drive", 65),
                ("type", "Type", 75),
                ("workers", "Workers", 75),
            ):
                self.source_tree.heading(key, text=title)
                self.source_tree.column(key, width=width, minwidth=56 if key == "open" else 66,
                                         stretch=key == "path",
                                         anchor="center" if key != "path" else "w")
            sy = ttk.Scrollbar(source_table, orient="vertical", command=self.source_tree.yview)
            self.source_tree.configure(yscrollcommand=sy.set)
            self.source_tree.pack(side="left", fill="both", expand=True)
            sy.pack(side="right", fill="y")
            self.bind_open_column(self.source_tree)

            lower = ttk.Frame(self.panes)
            self.panes.add(lower, weight=5)
            self.notebook = ttk.Notebook(lower)
            self.notebook.pack(fill="both", expand=True)
            self.results_tab = ttk.Frame(self.notebook)
            self.activity_tab = ttk.Frame(self.notebook)
            self.notebook.add(self.results_tab, text="Scan results")
            self.notebook.add(self.activity_tab, text="Activity")

            review_bar = ttk.Frame(self.results_tab, padding=(4, 5))
            review_bar.pack(fill="x")
            self.preview_btn = self._ascii_button(
                review_bar, "Preview selected", self.preview_selected_image)
            self.preview_btn.pack(side="left", padx=(0, 6))
            self.mark_btn = self._ascii_button(
                review_bar, "Confirm visual damage", self.confirm_visual_damage,
                state="disabled")
            self.mark_btn.pack(side="left", padx=(0, 8))
            self._ascii_label(review_bar, text="Visual warnings require manual confirmation",
                              fg=MUTED).pack(side="left")

            result_frame = ttk.Frame(self.results_tab)
            result_frame.pack(fill="both", expand=True)
            result_columns = ("open", "status", "path", "reason")
            self.result_tree = ttk.Treeview(result_frame, columns=result_columns,
                                            show="headings", style="Ascii.Treeview",
                                            selectmode="extended")
            for key, title, width in (
                ("open", "Open", 56),
                ("status", "State", 200),
                ("path", "File", 340),
                ("reason", "Details", 440),
            ):
                self.result_tree.heading(key, text=title)
                self.result_tree.column(key, width=width,
                                        minwidth=55 if key == "open" else 120,
                                        stretch=key in {"path", "reason"},
                                        anchor="center" if key == "open" else "w")
            ry = ttk.Scrollbar(result_frame, orient="vertical",
                               command=self.result_tree.yview)
            rx = ttk.Scrollbar(result_frame, orient="horizontal",
                               command=self.result_tree.xview)
            self.result_tree.configure(yscrollcommand=ry.set, xscrollcommand=rx.set)
            self.result_tree.grid(row=0, column=0, sticky="nsew")
            ry.grid(row=0, column=1, sticky="ns")
            rx.grid(row=1, column=0, sticky="ew")
            result_frame.rowconfigure(0, weight=1)
            result_frame.columnconfigure(0, weight=1)
            self.bind_open_column(self.result_tree)

            activity_frame = ttk.Frame(self.activity_tab)
            activity_frame.pack(fill="both", expand=True)
            self.log = tk.Text(activity_frame, wrap="none", state="disabled",
                               font=("Consolas", 9), bg=PANEL, fg=FG,
                               insertbackground=FG, selectbackground="#31577c",
                               selectforeground="#ffffff", borderwidth=0,
                               highlightthickness=1, highlightcolor=ACCENT,
                               highlightbackground=BORDER, takefocus=1,
                               padx=6, pady=5)
            for tag, color in (("corrupt", "#ff9b72"), ("warning", "#ffcc80"),
                               ("success", "#90d6ac"), ("muted", MUTED)):
                self.log.tag_configure(tag, foreground=color)
            ly = ttk.Scrollbar(activity_frame, orient="vertical", command=self.log.yview)
            self.log.configure(yscrollcommand=ly.set)
            self.log.pack(side="left", fill="both", expand=True)
            ly.pack(side="right", fill="y")


        def open_location(self, path):
            target = Path(path)
            try:
                if os.name == "nt":
                    if target.is_dir():
                        os.startfile(str(target))
                    else:
                        subprocess.Popen(["explorer.exe", "/select,", str(target)])
                elif sys.platform == "darwin":
                    subprocess.Popen(["open", str(target if target.is_dir() else target.parent)])
                else:
                    subprocess.Popen(["xdg-open", str(target if target.is_dir() else target.parent)])
            except Exception as exc:
                messagebox.showerror(APP_NAME, "Unable to open the selected location. Check filesystem access.")

        def preview_selected_image(self):
            selection = self.result_tree.selection()
            if not selection:
                messagebox.showinfo(APP_NAME, "Select an image in Scan Results first.")
                return
            path = Path(self.result_tree.set(selection[0], "path"))
            if not path.is_file():
                messagebox.showwarning(APP_NAME, "The image is unavailable at this location.")
                return
            try:
                if os.name == "nt":
                    os.startfile(str(path))
                elif sys.platform == "darwin":
                    subprocess.Popen(["open", str(path)])
                else:
                    subprocess.Popen(["xdg-open", str(path)])
            except Exception as exc:
                messagebox.showerror(APP_NAME, "Unable to preview the selected image. Check its file association and access.")

        def confirm_visual_damage(self):
            """User confirmation promotes visual warnings, never an automatic decision."""
            if not self.scan_completed or self.running or self.undo_running:
                return
            chosen = []
            for iid in self.result_tree.selection():
                finding = self.review_by_iid.get(iid)
                if finding and finding["status"] == "warning" and finding["reason"].startswith(
                    "VISUAL DAMAGE SUSPECTED"
                ):
                    chosen.append((iid, finding))
            if not chosen:
                messagebox.showinfo(
                    APP_NAME, "Select one or more VISUAL DAMAGE SUSPECTED rows first."
                )
                return
            if not messagebox.askyesno(
                APP_NAME,
                f"Confirm visible damage in {len(chosen)} selected image(s)?\n\n"
                "These images passed standard JPEG decoding. This manual confirmation "
                "makes them eligible for a SEPARATE Move Confirmed Corrupt action. "
                "No files will move now."
            ):
                return
            for iid, finding in chosen:
                self.review_candidates.append({
                    "path": finding["path"],
                    "source": finding["source"],
                    "size": finding["size"],
                    "mtime": finding["mtime"],
                    "iid": iid,
                    "manual_confirmed": True,
                })
                self.review_by_iid[iid]["status"] = "manual_confirmed"
                self.result_tree.set(iid, "status", "CONFIRMED CORRUPT (MANUAL)")
                self.warning -= 1
                self.corrupt += 1
                self.log_path("[USER CONFIRMED VISUAL DAMAGE] ", finding["path"], "warning")
            self.stats_vars["Confirmed"].set(f"{self.corrupt:,}")
            self.stats_vars["Warnings"].set(f"{self.warning:,}")
            self.status_var.set(
                f"{len(chosen):,} visual suspect(s) confirmed by user. "
                "Review and select Move Confirmed Corrupt to quarantine."
            )
            self.refresh_move_button()

        def bind_open_column(self, tree):
            def mouse_open(ev):
                if tree.identify_region(ev.x, ev.y) == "cell" and tree.identify_column(ev.x) == "#1":
                    iid = tree.identify_row(ev.y)
                    if iid:
                        self.open_location(tree.set(iid, "path"))
            def keyboard_open(_ev):
                selected = tree.selection()
                if selected:
                    self.open_location(tree.set(selected[0], "path"))
                    return "break"
            tree.bind("<ButtonRelease-1>", mouse_open)
            tree.bind("<Return>", keyboard_open)
            tree.bind("<space>", keyboard_open)

        def log_line(self, text, tag=None):
            self.log.configure(state="normal")
            self.log.insert("end", text + "\n", tag or ())
            self.log.see("end")
            self.log.configure(state="disabled")

        def log_path(self, label, path, tag=None):
            """Shared clickable open control adjacent to every log filesystem path."""
            self.log.configure(state="normal")
            self.log.insert("end", label, tag or ())
            name = f"location_{len(self.log.tag_names())}_{self.log.index('end-1c').replace('.', '_')}"
            self.log.insert("end", "[DIR] ", (name,))
            self.log.tag_configure(name, foreground=FG, underline=1)
            self.log.tag_bind(name, "<Button-1>", lambda _e, p=str(path): self.open_location(p))
            self.log.insert("end", str(path) + "\n", tag or ())
            self.log.see("end")
            self.log.configure(state="disabled")

        def clear_log(self):
            self.log.configure(state="normal")
            self.log.delete("1.0", "end")
            self.log.configure(state="disabled")

        def clear_scan_review(self):
            self.review_candidates.clear()
            self.scan_completed = False
            self.review_by_iid.clear()
            if hasattr(self, "result_tree"):
                for iid in self.result_tree.get_children():
                    self.result_tree.delete(iid)
            if hasattr(self, "notebook"):
                self.notebook.tab(self.results_tab, text="Scan results")
            if hasattr(self, "move_btn"):
                self.move_btn.configure(state="disabled")
            if hasattr(self, "mark_btn"):
                self.mark_btn.configure(state="disabled")

        def refresh_move_button(self):
            eligible = self.scan_completed and bool(self.review_candidates)
            self.move_btn.configure(state="normal" if eligible and not (
                self.running or self.undo_running) else "disabled")
            visual_warnings = self.scan_completed and any(
                f["status"] == "warning" and f["reason"].startswith("VISUAL DAMAGE SUSPECTED")
                for f in self.review_by_iid.values()
            )
            self.mark_btn.configure(
                state="normal" if visual_warnings and not (
                    self.running or self.undo_running) else "disabled"
            )

        def update_progress_detail(self):
            elapsed = max(0.0, time.monotonic() - self.start_time) if self.start_time else 0.0
            rate = self.done / elapsed if elapsed > 0 else 0.0
            self.detail_progress_var.set(
                f"Discovered: {self.discovered:,} | Checked: {self.done:,}/{self.total:,} | "
                f"Elapsed: {format_elapsed(elapsed)} | {rate:.1f} files/s | "
                f"{self.worker_count} workers / {self.drive_count} drives"
            )


        def quick_check_file(self):
            """Direct check of one user-chosen file; always shows result including GOOD."""
            if self.running or self.undo_running:
                return
            filename = filedialog.askopenfilename(
                title="Check one image file",
                filetypes=[("Image files", "*.jpg *.jpeg *.jpe *.jfif *.png *.tif *.tiff *.heic *.heif *.webp *.bmp *.gif *.avif"),
                           ("All files", "*.*")]
            )
            if not filename:
                return
            image_path = Path(filename)
            self.clear_scan_review()
            self.mode = "quick"
            self.progress_var.set(0)
            self.start_time = time.monotonic()
            self.total, self.done = 1, 0
            self.discovered = 1
            self.worker_count = 1
            self.drive_count = 1
            self.stage_var.set("CHECK FILE")
            self.status_var.set("Checking the selected image, including visible artifacts...")
            self.set_controls(running=True)
            def check():
                try:
                    status, reason = verify_image(image_path)
                except Exception as exc:
                    status, reason = "error", exc.__class__.__name__
                self.q.put(("quick_result", image_path, status, reason))
            threading.Thread(target=check, daemon=True).start()

        def add_source(self):
            folder = filedialog.askdirectory(title="Add source image folder")
            if not folder:
                return
            path = Path(folder).resolve()
            if not path.is_dir():
                messagebox.showerror(APP_NAME, "The selected source folder does not exist.")
                return
            if path.name.upper().endswith("_CORRUPTED"):
                messagebox.showerror(APP_NAME, "Quarantine folders cannot be added as scan sources.")
                return

            # Avoid duplicate or nested scans. If a broader parent is added, replace
            # any already-listed child sources with that parent.
            for item in self.sources:
                if path == item["path"]:
                    self.source_tree.selection_set(item["iid"])
                    return
                if is_same_or_child(path, item["path"]):
                    messagebox.showinfo(
                        APP_NAME,
                        "That folder is already covered by an existing source. "
                        "Select its row and use OPEN to inspect it.",
                    )
                    return

            child_items = [item for item in self.sources if is_same_or_child(item["path"], path)]
            for item in child_items:
                self.source_tree.delete(item["iid"])
                self.sources.remove(item)

            info = detect_drive_info(path)
            self.clear_scan_review()
            iid = self.source_tree.insert("", "end", values=("[DIR]", str(path), info["drive"], info["storage_type"], "..."))
            self.sources.append({"path": path, "info": info, "iid": iid})
            self.recalculate_worker_plan()

        def remove_selected_sources(self):
            selected = set(self.source_tree.selection())
            if not selected:
                return
            self.sources = [item for item in self.sources if item["iid"] not in selected]
            self.clear_scan_review()
            for iid in selected:
                self.source_tree.delete(iid)
            self.recalculate_worker_plan()

        def clear_sources(self):
            for iid in self.source_tree.get_children():
                self.source_tree.delete(iid)
            self.sources.clear()
            self.clear_scan_review()
            self.recalculate_worker_plan()

        def recalculate_worker_plan(self):
            unique = {}
            for item in self.sources:
                unique[item["info"]["disk_key"]] = item["info"]
            self.worker_plan = allocate_drive_workers(unique)
            for item in self.sources:
                workers = self.worker_plan.get(item["info"]["disk_key"], 0)
                self.source_tree.item(
                    item["iid"],
                    values=("[DIR]", str(item["path"]), item["info"]["drive"], item["info"]["storage_type"], workers),
                )

            if not self.sources:
                self.plan_var.set("Add one or more source folders.")
                return
            total_workers = sum(self.worker_plan.values())
            self.plan_var.set(
                f"{len(self.sources)} source(s) | {len(unique)} physical drive(s) | {total_workers} total worker(s)"
            )

        def refresh_undo_button(self):
            enabled = has_undo_moves() and not self.running and not self.undo_running
            self.undo_btn.configure(state="normal" if enabled else "disabled")

        def set_controls(self, running=False, undo_running=False):
            self.running = running
            self.undo_running = undo_running
            busy = running or undo_running
            normal_state = "disabled" if busy else "normal"
            self.start_btn.configure(state=normal_state)
            self.add_btn.configure(state=normal_state)
            self.remove_btn.configure(state=normal_state)
            self.clear_btn.configure(state=normal_state)
            self.stop_btn.configure(state="normal" if running else "disabled")
            self.check_btn.configure(state=normal_state)
            self.refresh_undo_button()
            self.refresh_move_button()

        def start(self):
            if not self.sources:
                messagebox.showerror(APP_NAME, "Add at least one source folder first.")
                return

            missing = [item["path"] for item in self.sources if not item["path"].is_dir()]
            if missing:
                messagebox.showerror(APP_NAME, "A source folder no longer exists. "
                                     "Select its row and use OPEN to inspect it.")
                return

            self.recalculate_worker_plan()
            self.stop_event.clear()
            self.set_controls(running=True)
            self.progress_var.set(0)
            self.start_time = time.monotonic()
            self.current_run_id = datetime.now().astimezone().strftime("%Y-%m-%dT%H-%M-%S.%f%z")
            self.good = self.warning = self.corrupt = self.moved = self.unsupported = self.errors = 0
            self.total = self.done = 0
            self.bytes_scanned = self.bytes_moved = 0
            for var in self.stats_vars.values():
                var.set("0")
            self.clear_log()

            self.mode = "scan"
            self.clear_scan_review()
            self.visual_checked = 0
            self.visual_suspects = 0
            self.discovered = 0
            self.worker_count = sum(self.worker_plan.values())
            self.drive_count = len(self.worker_plan)
            self.stage_var.set("STAGE: DISCOVERING IMAGES")
            self.update_progress_detail()
            self.status_var.set("Discovering images across physical drives...")
            source_snapshot = [
                {"path": item["path"], "info": dict(item["info"])} for item in self.sources
            ]
            plan_snapshot = dict(self.worker_plan)
            threading.Thread(
                target=self.worker,
                args=(source_snapshot, plan_snapshot, self.current_run_id),
                daemon=True,
            ).start()

        def stop(self):
            self.stop_event.set()
            self.status_var.set("Stopping after current files finish...")

        def _collect_drive_group(self, records):
            collected = []
            for record in records:
                if self.stop_event.is_set():
                    break
                root = record["path"]
                for p in collect_images(root):
                    collected.append((root, p))
            return collected


        def worker(self, source_records, worker_plan, run_id):
            """Read-only scan; no disk modifications under any classification."""
            executors = []
            try:
                sources = [record["path"] for record in source_records]
                by_drive_sources, drive_infos = {}, {}
                for record in source_records:
                    key = record["info"]["disk_key"]
                    by_drive_sources.setdefault(key, []).append(record)
                    drive_infos[key] = record["info"]

                all_items = []
                with ThreadPoolExecutor(
                    max_workers=max(1, len(by_drive_sources)), thread_name_prefix="DriveScan"
                ) as scan_pool:
                    futures = {
                        scan_pool.submit(self._collect_drive_group, records): key
                        for key, records in by_drive_sources.items()
                    }
                    for future in as_completed(futures):
                        key = futures[future]
                        items = future.result()
                        all_items.extend((key, root, p) for root, p in items)
                        self.q.put(("drive_scan_ready", drive_infos[key], len(items),
                                    worker_plan.get(key, 1)))

                if self.stop_event.is_set():
                    self.q.put(("scan_finished", True))
                    return

                self.q.put(("scan_ready", len(all_items)))
                if not all_items:
                    self.q.put(("scan_finished", False))
                    return

                by_drive_files = {}
                for key, source_root, p in all_items:
                    by_drive_files.setdefault(key, []).append((source_root, p))

                future_map = {}
                for key, items in by_drive_files.items():
                    executor = ThreadPoolExecutor(
                        max_workers=max(1, worker_plan.get(key, 1)),
                        thread_name_prefix=f"ImageCheck-{key}"
                    )
                    executors.append(executor)
                    for source_root, p in items:
                        future_map[executor.submit(verify_image, p)] = (source_root, p, key)

                for future in as_completed(future_map):
                    if self.stop_event.is_set():
                        for f in future_map:
                            f.cancel()
                        break
                    source_root, p, key = future_map[future]
                    try:
                        st = p.stat()
                        size = st.st_size
                        mtime = st.st_mtime_ns
                    except OSError:
                        size = mtime = None
                    try:
                        status, reason = future.result()
                    except Exception as exc:
                        status, reason = "error", str(exc)
                    self.q.put(("result", source_root, p, size, mtime, status, reason, key))

                stopped = self.stop_event.is_set()
                for executor in executors:
                    executor.shutdown(wait=True, cancel_futures=stopped)
                executors.clear()
                self.q.put(("scan_finished", stopped))
            except Exception as exc:
                self.q.put(("fatal", str(exc), traceback.format_exc()))
            finally:
                for executor in executors:
                    try:
                        executor.shutdown(wait=False, cancel_futures=True)
                    except Exception:
                        pass

        def start_move(self):
            if not self.scan_completed or not self.review_candidates or self.running or self.undo_running:
                return
            count = len(self.review_candidates)
            if not messagebox.askyesno(
                APP_NAME,
                f"Move {count:,} CONFIRMED CORRUPT image(s) into their respective "
                "*_CORRUPTED sibling folders?\n\n"
                "Original relative paths are preserved. Existing destinations are "
                "never overwritten. Each file is checked again before moving."
            ):
                return
            pending = list(self.review_candidates)
            sources = [record["path"] for record in self.sources]
            run_id = datetime.now().astimezone().strftime("%Y-%m-%dT%H-%M-%S.%f%z")
            self.stop_event.clear()
            self.mode = "move"
            self.set_controls(running=True)
            self.start_time = time.monotonic()
            self.total, self.done = len(pending), 0
            self.progress_var.set(0)
            self.stage_var.set("STAGE: MOVING CONFIRMED CORRUPT")
            self.status_var.set("Verifying each candidate again before moving...")
            threading.Thread(
                target=self.move_worker, args=(pending, sources, run_id), daemon=True
            ).start()

        def move_worker(self, candidates, sources, run_id):
            try:
                for candidate in candidates:
                    if self.stop_event.is_set():
                        break
                    p = candidate["path"]
                    source_root = candidate["source"]
                    moved_to, reason = None, ""
                    try:
                        if p.is_symlink():
                            raise OSError("Symbolic link - left in place")
                        st = p.stat()
                        if (st.st_size, st.st_mtime_ns) != (
                            candidate["size"], candidate["mtime"]
                        ):
                            raise OSError("Image changed since scan - left in place; scan again")
                        status, new_reason = verify_image(p)
                        user_confirmed_suspect = (
                            candidate.get("manual_confirmed")
                            and status == "warning"
                            and new_reason.startswith("VISUAL DAMAGE SUSPECTED")
                        )
                        if status != "corrupt" and not user_confirmed_suspect:
                            raise OSError(f"Recheck is {status.upper()}: {new_reason}")
                        moved_to = move_preserving_structure(
                            source_root, p, run_id=run_id, sources=sources,
                            expected=(candidate["size"], candidate["mtime"])
                        )
                        reason = new_reason
                    except Exception as exc:
                        reason = str(exc)
                    self.q.put(("move_result", candidate, moved_to, reason))
                self.q.put(("move_finished", self.stop_event.is_set()))
            except Exception as exc:
                self.q.put(("fatal", str(exc), traceback.format_exc()))

        def start_undo(self):
            manifest = load_undo_manifest()
            if not manifest or not manifest.get("moves"):
                self.refresh_undo_button()
                return

            count = len(manifest["moves"])
            if not messagebox.askyesno(
                APP_NAME,
                f"Restore {count:,} file(s) moved by the last run?\n\n"
                "Existing files at original paths will not be overwritten.",
            ):
                return

            self.stop_event.clear()
            self.set_controls(undo_running=True)
            self.progress_var.set(0)
            self.clear_log()
            self.stage_var.set("STAGE: RESTORING LAST RUN")
            self.start_time = time.monotonic()
            self.total, self.done = count, 0
            self.status_var.set(f"Undoing last run: 0/{count:,}...")
            threading.Thread(target=self.undo_worker, args=(manifest,), daemon=True).start()

        def undo_worker(self, manifest):
            moves = list(manifest.get("moves", []))
            remaining = []
            restored = 0
            failed = 0

            for index, move in enumerate(reversed(moves), start=1):
                original = Path(move.get("original", ""))
                moved_to = Path(move.get("moved_to", ""))
                ok, reason = restore_moved_file(original, moved_to)
                if ok:
                    restored += 1
                    # The corrupted root is derived from the original source path stored
                    # in the manifest. Clean only empty directories after a restore.
                    source_root = None
                    for src in manifest.get("sources", []):
                        src_path = Path(src)
                        try:
                            original.resolve().relative_to(src_path.resolve())
                            source_root = src_path
                            break
                        except (ValueError, OSError):
                            continue
                    if source_root:
                        corrupted_root = source_root.parent / f"{source_root.name}_CORRUPTED"
                        cleanup_empty_parents(moved_to, corrupted_root)
                    self.q.put(("undo_result", True, original, moved_to, "", index, len(moves)))
                else:
                    failed += 1
                    remaining.append(move)
                    self.q.put(("undo_result", False, original, moved_to, reason, index, len(moves)))

            # Preserve unresolved entries in original chronological order.
            remaining_set = {(m.get("original"), m.get("moved_to")) for m in remaining}
            remaining_ordered = [
                m for m in moves if (m.get("original"), m.get("moved_to")) in remaining_set
            ]
            save_remaining_undo_moves(manifest, remaining_ordered)
            self.q.put(("undo_finished", restored, failed))


        def process_queue(self):
            try:
                for _ in range(250):
                    item = self.q.get_nowait()
                    kind = item[0]

                    if kind == "quick_result":
                        _, path, status, reason = item
                        self.done = 1
                        self.progress_var.set(100)
                        states = {
                            "good": "GOOD",
                            "warning": "WARNING - LEFT IN PLACE",
                            "unsupported": "UNSUPPORTED - LEFT IN PLACE",
                            "error": "ERROR - LEFT IN PLACE",
                            "corrupt": "CONFIRMED CORRUPT",
                        }
                        self.set_controls()
                        state = states.get(status, "ERROR - LEFT IN PLACE")
                        reason = str(reason).replace(str(path), "[this image]")
                        iid = self.result_tree.insert(
                            "", "end", values=("[DIR]", state, str(path), reason)
                        )
                        self.result_tree.selection_set(iid)
                        self.result_tree.see(iid)
                        self.notebook.select(self.results_tab)
                        self.notebook.tab(self.results_tab, text="File check result (1)")
                        self.stage_var.set("CHECK COMPLETE")
                        self.status_var.set(
                            f"Individual-file check: {state}. "
                            "File was not moved. For quarantine, add its folder and scan."
                        )
                        self.stats_vars["Checked"].set("1")
                        for key in ("Good", "Warnings", "Confirmed", "Unsupported", "Errors"):
                            self.stats_vars[key].set("1" if
                                (key == "Good" and status == "good") or
                                (key == "Warnings" and status == "warning") or
                                (key == "Confirmed" and status == "corrupt") or
                                (key == "Unsupported" and status == "unsupported") or
                                (key == "Errors" and status == "error")
                                else "0")
                        self.log_path(f"[{state}] ", path, "muted")
                        self.log_line(f"  Reason: {reason or 'Full decode and visual checks passed'}", "muted")

                    elif kind == "drive_scan_ready":
                        _, info, count, workers = item
                        self.discovered += count
                        self.log_line(
                            f"[DRIVE] {info['drive']} | {info['storage_type']} | "
                            f"{workers} worker(s) | {count:,} discovered", "muted"
                        )
                        self.update_progress_detail()

                    elif kind == "scan_ready":
                        self.total = item[1]
                        self.stage_var.set("STAGE: VERIFYING IMAGES (READ ONLY)")
                        self.status_var.set(
                            f"Discovered {self.total:,} image(s). No files are moved during scanning."
                        )

                    elif kind == "result":
                        _, source_root, p, size, mtime, status, reason, key = item
                        self.done += 1
                        if p.suffix.lower() in {".jpg", ".jpeg", ".jpe", ".jfif"} and status in {"good", "warning", "corrupt"}:
                            self.visual_checked += 1
                        if str(reason).startswith("VISUAL DAMAGE SUSPECTED"):
                            self.visual_suspects += 1
                        self.bytes_scanned += size or 0
                        labels = {
                            "corrupt": "CONFIRMED CORRUPT",
                            "warning": "WARNING - LEFT IN PLACE",
                            "unsupported": "UNSUPPORTED - LEFT IN PLACE",
                            "error": "ERROR - LEFT IN PLACE",
                        }
                        if status == "good":
                            self.good += 1
                        elif status == "corrupt":
                            self.corrupt += 1
                        elif status == "warning":
                            self.warning += 1
                        elif status == "unsupported":
                            self.unsupported += 1
                        else:
                            status = "error"
                            self.errors += 1
                        if status != "good":
                            reason = str(reason).replace(str(p), "[this image]")
                            state = labels.get(status, "ERROR - LEFT IN PLACE")
                            iid = self.result_tree.insert(
                                "", "end", values=("[DIR]", state, str(p), reason)
                            )
                            if size is not None and mtime is not None:
                                self.review_by_iid[iid] = {
                                    "path": p, "source": source_root, "size": size,
                                    "mtime": mtime, "status": status, "reason": reason
                                }
                            if status == "corrupt" and size is not None and mtime is not None:
                                self.review_candidates.append({
                                    "path": p, "source": source_root, "size": size,
                                    "mtime": mtime, "iid": iid,
                                })
                            self.log_path(f"[{state}] ", p, "corrupt" if status == "corrupt" else "warning")
                            self.log_line(f"  Reason: {reason}", "muted")
                        pct = self.done / self.total * 100 if self.total else 0
                        self.progress_var.set(pct)
                        self.update_progress_detail()
                        self.stats_vars["Checked"].set(f"{self.done:,}")
                        self.stats_vars["Good"].set(f"{self.good:,}")
                        self.stats_vars["Confirmed"].set(f"{self.corrupt:,}")
                        self.stats_vars["Warnings"].set(f"{self.warning:,}")
                        self.stats_vars["Moved"].set(f"{self.moved:,}")
                        self.stats_vars["Unsupported"].set(f"{self.unsupported:,}")
                        self.stats_vars["Errors"].set(f"{self.errors:,}")
                        self.status_var.set(
                            f"Verified {self.done:,}/{self.total:,} | {self.corrupt:,} candidate(s)"
                        )

                    elif kind == "scan_finished":
                        stopped = item[1]
                        self.scan_completed = not stopped
                        self.set_controls()
                        elapsed = time.monotonic() - self.start_time if self.start_time else 0
                        if stopped:
                            self.stage_var.set("STAGE: SCAN STOPPED")
                            self.status_var.set("Scan stopped. Run Scan Images again before moving.")
                        else:
                            self.stage_var.set("STAGE: REVIEW RESULTS")
                            self.progress_var.set(100 if self.total else 0)
                            self.status_var.set(
                                f"Scan complete in {format_elapsed(elapsed)}. "
                                f"{self.corrupt:,} confirmed, {self.warning:,} warning(s), "
                                f"{self.unsupported:,} unsupported; "
                                f"{self.visual_suspects:,} visual suspect(s)."
                            )
                            self.log_line(
                                f"[VISUAL JPEG AUDIT] {self.visual_checked:,} JPEGs checked; "
                                f"{self.visual_suspects:,} visual suspect(s).", "muted"
                            )
                            self.notebook.tab(self.results_tab, text=f"Scan results ({len(self.result_tree.get_children()):,})")
                        self.refresh_move_button()

                    elif kind == "move_result":
                        _, candidate, moved_to, reason = item
                        self.done += 1
                        iid = candidate["iid"]
                        self.review_candidates = [
                            c for c in self.review_candidates if c["iid"] != iid
                        ]
                        reason = str(reason).replace(str(candidate["path"]), "[this image]")
                        if moved_to is not None:
                            self.moved += 1
                            self.bytes_moved += candidate["size"]
                            self.result_tree.item(iid, values=(
                                "[DIR]", "MOVED - UNDO AVAILABLE", str(moved_to), reason
                            ))
                            self.log_path("[MOVED] ", moved_to, "success")
                        else:
                            self.errors += 1
                            self.result_tree.item(iid, values=(
                                "[DIR]", "MOVE SKIPPED - LEFT IN PLACE",
                                str(candidate["path"]), reason
                            ))
                            self.log_path("[MOVE SKIPPED] ", candidate["path"], "warning")
                            self.log_line(f"  Reason: {reason}", "muted")
                        pct = self.done / self.total * 100 if self.total else 0
                        self.progress_var.set(pct)
                        self.stats_vars["Moved"].set(f"{self.moved:,}")
                        self.stats_vars["Errors"].set(f"{self.errors:,}")
                        self.status_var.set(
                            f"Move/recheck {self.done:,}/{self.total:,} | moved {self.moved:,}"
                        )
                        self.update_progress_detail()

                    elif kind == "move_finished":
                        stopped = item[1]
                        self.scan_completed = False
                        self.set_controls()
                        self.stage_var.set("STAGE: MOVE STOPPED" if stopped else "STAGE: MOVE FINISHED")
                        self.status_var.set(
                            f"Moved {self.moved:,}; not moved {self.done - self.moved:,}. "
                            "Run Scan Images again to recheck remaining files."
                        )
                        self.refresh_undo_button()

                    elif kind == "undo_result":
                        _, ok, original, moved_to, reason, index, total = item
                        pct = index / total * 100 if total else 0
                        self.progress_var.set(pct)
                        if ok:
                            self.log_path("[RESTORED] ", original, "success")
                        else:
                            self.log_path("[UNDO SKIPPED] ", original, "warning")
                            self.log_path("  From: ", moved_to, "muted")
                            safe_reason = str(reason).replace(str(original), "[original]").replace(
                                str(moved_to), "[quarantine]"
                            )
                            self.log_line(f"  Reason: {safe_reason}", "muted")
                        self.status_var.set(
                            f"Undoing last run: {index:,}/{total:,} ({pct:.1f}%)"
                        )

                    elif kind == "undo_finished":
                        _, restored, failed = item
                        self.clear_scan_review()
                        self.set_controls()
                        self.stage_var.set("STAGE: UNDO FINISHED")
                        self.progress_var.set(100 if restored or failed else 0)
                        self.status_var.set(
                            f"Undo complete. Restored {restored:,}; unresolved {failed:,}."
                        )
                        self.refresh_undo_button()

                    elif kind == "fatal":
                        _, error, tb = item
                        self.set_controls()
                        self.stage_var.set("STAGE: ERROR")
                        self.status_var.set("Failed. See the diagnostic log.")
                        log_path = _write_startup_error_log(tb)
                        if log_path:
                            self.log_path("[DIAGNOSTIC LOG] ", log_path, "warning")
                        self.log_line("[ERROR] Operation failed; see diagnostic log.", "corrupt")
                        self.refresh_undo_button()
                        messagebox.showerror(APP_NAME, "Operation failed. See the diagnostic log.")
            except queue.Empty:
                pass
            except Exception:
                _write_startup_error_log(traceback.format_exc())
                self.stage_var.set("STAGE: ERROR")
                self.status_var.set("Internal UI error; see startup-error.log in app logs.")
            finally:
                self.update_progress_detail()
                self.root.after(100, self.process_queue)

    root = tk.Tk()
    App(root)
    root.mainloop()


def _write_startup_error_log(text):
    """Best-effort startup diagnostics for .pyw launches where no console is visible."""
    candidates = []
    try:
        candidates.append(app_data_dir() / "logs")
    except Exception:
        pass
    try:
        import tempfile
        candidates.append(Path(tempfile.gettempdir()) / APP_NAME)
    except Exception:
        pass

    for folder in candidates:
        try:
            folder.mkdir(parents=True, exist_ok=True)
            path = folder / "startup-error.log"
            path.write_text(text, encoding="utf-8")
            return path
        except Exception:
            pass
    return None


def _show_startup_error(exc, tb):
    log_path = _write_startup_error_log(tb)
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        if messagebox.askyesno(
            APP_NAME, "The application could not start.\nOpen its diagnostic log location?"
        ) and log_path:
            if os.name == "nt":
                subprocess.Popen(["explorer.exe", "/select,", str(log_path)])
            else:
                subprocess.Popen(["xdg-open", str(log_path.parent)])
        root.destroy()
    except Exception:
        pass


def main():
    try:
        if not ensure_dependencies():
            raise RuntimeError(
                "Pillow could not be loaded or installed automatically. "
                "Check your internet connection and Python installation."
            )
        launch_gui()
    except Exception as exc:
        _show_startup_error(exc, traceback.format_exc())


if __name__ == "__main__":
    main()