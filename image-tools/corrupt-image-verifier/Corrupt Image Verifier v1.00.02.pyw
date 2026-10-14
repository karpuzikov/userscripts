# Corrupt Image Verifier v1.0.2
# Windows GUI tool: recursively verifies image files and moves confirmed-corrupt
# files to a sibling "<source>_CORRUPTED" folder while preserving relative paths.

import os
import sys
import shutil
import subprocess
import threading
import queue
import traceback
import warnings
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

APP_NAME = "Corrupt Image Verifier"
APP_VERSION = "1.0.2"

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
Image = None
UnidentifiedImageError = Exception
ImageFile = None

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
    global PIL_READY, HEIF_READY, Image, UnidentifiedImageError, ImageFile

    try:
        from PIL import Image as _Image, UnidentifiedImageError as _UIE, ImageFile as _ImageFile
        Image, UnidentifiedImageError, ImageFile = _Image, _UIE, _ImageFile
        PIL_READY = True
    except Exception:
        try:
            _run_hidden(
                [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "Pillow", "pillow-heif"],
                timeout=300,
            )
            from PIL import Image as _Image, UnidentifiedImageError as _UIE, ImageFile as _ImageFile
            Image, UnidentifiedImageError, ImageFile = _Image, _UIE, _ImageFile
            PIL_READY = True
        except Exception:
            PIL_READY = False
            return False

    try:
        import pillow_heif
        pillow_heif.register_heif_opener()
        HEIF_READY = True
    except Exception:
        try:
            _run_hidden(
                [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "pillow-heif"],
                timeout=300,
            )
            import pillow_heif
            pillow_heif.register_heif_opener()
            HEIF_READY = True
        except Exception:
            HEIF_READY = False

    ImageFile.LOAD_TRUNCATED_IMAGES = False
    return True

def human_bytes(n):
    n = float(n)
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    for unit in units:
        if n < 1024.0 or unit == units[-1]:
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.2f} {unit}"
        n /= 1024.0

def classify_exception(exc):
    text = str(exc).strip() or exc.__class__.__name__
    low = text.lower()

    unsupported_markers = (
        "cannot identify image file",
        "cannot open",
        "not installed",
        "support not installed",
        "decoder",
        "unsupported",
        "unknown file format",
        "no decode delegate",
    )
    corruption_markers = (
        "truncated",
        "broken data stream",
        "image file is truncated",
        "corrupt",
        "crc error",
        "checksum",
        "unexpected end",
        "end of file",
        "premature end",
        "invalid",
        "bad marker",
        "broken",
        "not enough image data",
        "tile cannot extend",
        "decoder error",
    )

    if any(m in low for m in corruption_markers):
        return "corrupt", text
    if any(m in low for m in unsupported_markers):
        return "unsupported", text

    # If Pillow recognized/opened a supported format but decoding later failed,
    # treat that as corruption. Callers can override with stage info.
    return "error", text

def verify_image(path):
    """
    Returns (status, reason)
      good        = successfully opened, verified and fully decoded
      corrupt     = confirmed malformed/truncated/invalid image
      unsupported = recognized by extension but decoder support unavailable/unknown
      error       = I/O/permission/other non-corruption failure
    """
    try:
        st = path.stat()
    except OSError as exc:
        return "error", f"File access failed: {exc}"

    if st.st_size == 0:
        return "corrupt", "Empty file (0 bytes)"

    if not PIL_READY:
        return "error", "Pillow is unavailable"

    # Stage 1: structural verification.
    opened_once = False
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            with Image.open(path) as im:
                opened_once = True
                fmt = (im.format or "").upper()

                # If HEIC/HEIF is encountered without its optional decoder,
                # do not mislabel it as corrupt.
                if path.suffix.lower() in {".heic", ".heif"} and not HEIF_READY:
                    return "unsupported", "HEIC/HEIF decoder is unavailable"

                im.verify()
    except UnidentifiedImageError as exc:
        return "unsupported", str(exc) or "Image format was not recognized"
    except PermissionError as exc:
        return "error", f"Permission denied: {exc}"
    except OSError as exc:
        status, reason = classify_exception(exc)
        if opened_once and status in {"error", "unsupported"}:
            # Once Pillow has recognized the image and verify() fails, this is
            # overwhelmingly a malformed image rather than an unsupported type.
            return "corrupt", reason
        return status, reason
    except Exception as exc:
        status, reason = classify_exception(exc)
        if opened_once and status != "error":
            return "corrupt", reason
        return status, reason

    # Stage 2: full pixel decode, including all frames/pages.
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            with Image.open(path) as im:
                frame = 0
                while True:
                    try:
                        im.seek(frame)
                    except EOFError:
                        break
                    # Force complete decoding of this frame.
                    im.load()
                    frame += 1

                # Some single-frame plugins do not raise EOF until seek(1).
                if frame == 0:
                    im.load()

        return "good", ""
    except UnidentifiedImageError as exc:
        return "corrupt", str(exc) or "Image became unreadable during decode"
    except PermissionError as exc:
        return "error", f"Permission denied: {exc}"
    except OSError as exc:
        status, reason = classify_exception(exc)
        # It already passed structural verification and was recognized;
        # a later decoder failure is a confirmed corruption.
        if status in {"corrupt", "error", "unsupported"}:
            return "corrupt", reason
        return status, reason
    except Exception as exc:
        return "corrupt", str(exc).strip() or exc.__class__.__name__

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

def move_preserving_structure(source_root, file_path):
    source_root = source_root.resolve()
    file_path = file_path.resolve()
    rel = file_path.relative_to(source_root)

    dest_root = source_root.parent / f"{source_root.name}_CORRUPTED"
    dest = dest_root / rel
    dest.parent.mkdir(parents=True, exist_ok=True)

    # Preserve the exact relative path/name. If an older destination copy exists,
    # replace it only after successfully staging the new corrupt file.
    temp = dest.with_name(dest.name + ".moving")
    try:
        if temp.exists():
            temp.unlink()

        # copy2 + byte comparison gives safer behavior than blindly deleting source
        # after a cross-filesystem move.
        shutil.copy2(file_path, temp)

        if not same_file_contents(file_path, temp):
            try:
                temp.unlink()
            except OSError:
                pass
            raise OSError("Destination verification failed: copied bytes do not match source")

        os.replace(temp, dest)
        file_path.unlink()
        return dest
    except Exception:
        try:
            if temp.exists():
                temp.unlink()
        except OSError:
            pass
        raise

def collect_images(source_root):
    source_root = source_root.resolve()
    corrupted_root = source_root.parent / f"{source_root.name}_CORRUPTED"

    files = []
    for root, dirs, names in os.walk(source_root, followlinks=False):
        root_path = Path(root)

        # Defensive exclusion if the destination somehow resolves inside source.
        dirs[:] = [
            d for d in dirs
            if (root_path / d).resolve() != corrupted_root.resolve()
        ]

        for name in names:
            p = root_path / name
            if p.suffix.lower() in IMAGE_EXTENSIONS:
                files.append(p)
    return files

def default_workers():
    cpu = os.cpu_count() or 4
    # Full decoding can hit disk hard; 4-8 concurrent files generally keeps HDD/SSD
    # utilization high without excessive random-seek thrashing.
    return max(4, min(8, cpu // 2 if cpu > 8 else cpu))

def format_elapsed(seconds):
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"

def launch_gui():
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox
    import time
    import ctypes

    # Match Duplicate Edition Analyzer's established UI language.
    BG = "#1e1e1e"
    PANEL = "#252526"
    FIELD = "#2d2d30"
    BUTTON = "#333337"
    BUTTON_ACTIVE = "#3f3f46"
    FG = "#f0f0f0"
    MUTED = "#b8b8b8"
    BORDER = "#4a4a4f"
    ACCENT = "#5b9bd5"
    ERROR = "#e57373"
    WARNING = "#e6b450"

    def enable_dark_title_bar(window):
        if os.name != "nt":
            return
        try:
            window.update_idletasks()
            hwnd = ctypes.windll.user32.GetParent(window.winfo_id())
            value = ctypes.c_int(1)
            # DWMWA_USE_IMMERSIVE_DARK_MODE: 20 on current Windows 10/11,
            # 19 on some older builds.
            for attr in (20, 19):
                try:
                    if ctypes.windll.dwmapi.DwmSetWindowAttribute(
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
            self.root.geometry("920x620")
            self.root.minsize(820, 560)
            self.root.configure(bg=BG)

            self.style = ttk.Style(self.root)
            try:
                self.style.theme_use("clam")
            except Exception:
                pass
            self.configure_styles()

            self.q = queue.Queue()
            self.running = False
            self.stop_event = threading.Event()
            self.start_time = None

            self.source_var = tk.StringVar()
            self.dest_var = tk.StringVar(value="Select a source folder")
            self.status_var = tk.StringVar(value="Ready")
            self.progress_var = tk.DoubleVar(value=0)

            self.good = self.corrupt = self.moved = self.unsupported = self.errors = 0
            self.total = self.done = 0
            self.bytes_scanned = 0
            self.bytes_moved = 0

            self.build_ui()
            self.root.after(50, lambda: enable_dark_title_bar(self.root))
            self.root.after(100, self.process_queue)

        def configure_styles(self):
            s = self.style

            s.configure(
                ".",
                background=BG,
                foreground=FG,
                font=("Segoe UI", 9),
                bordercolor=BORDER,
                lightcolor=BORDER,
                darkcolor=BORDER,
                troughcolor=FIELD,
                focuscolor=ACCENT,
            )

            s.configure("TFrame", background=BG)
            s.configure("Panel.TFrame", background=PANEL)

            s.configure("TLabel", background=BG, foreground=FG)
            s.configure("Muted.TLabel", background=BG, foreground=MUTED, font=("Segoe UI", 9))
            s.configure("Panel.TLabel", background=PANEL, foreground=FG)
            s.configure("PanelMuted.TLabel", background=PANEL, foreground=MUTED, font=("Segoe UI", 9))
            s.configure("Title.TLabel", background=BG, foreground=FG, font=("Segoe UI", 15, "bold"))
            s.configure("Section.TLabel", background=BG, foreground=FG, font=("Segoe UI", 10, "bold"))
            s.configure("StatName.TLabel", background=PANEL, foreground=MUTED, font=("Segoe UI", 9))
            s.configure("StatValue.TLabel", background=PANEL, foreground=FG, font=("Segoe UI", 10, "bold"))

            s.configure(
                "TEntry",
                fieldbackground=FIELD,
                foreground=FG,
                insertcolor=FG,
                bordercolor=BORDER,
                lightcolor=BORDER,
                darkcolor=BORDER,
                padding=5,
            )
            s.map(
                "TEntry",
                fieldbackground=[("disabled", PANEL)],
                foreground=[("disabled", MUTED)],
                bordercolor=[("focus", ACCENT)],
            )

            s.configure(
                "TButton",
                background=BUTTON,
                foreground=FG,
                bordercolor=BORDER,
                lightcolor=BUTTON,
                darkcolor=BUTTON,
                padding=(10, 6),
                relief="flat",
            )
            s.map(
                "TButton",
                background=[
                    ("active", BUTTON_ACTIVE),
                    ("pressed", FIELD),
                    ("disabled", PANEL),
                ],
                foreground=[("disabled", "#777777")],
                bordercolor=[("focus", ACCENT)],
            )

            s.configure(
                "Accent.TButton",
                background=ACCENT,
                foreground="#ffffff",
                bordercolor=ACCENT,
                lightcolor=ACCENT,
                darkcolor=ACCENT,
                padding=(10, 6),
                relief="flat",
            )
            s.map(
                "Accent.TButton",
                background=[("active", "#6ba8dc"), ("pressed", "#4e8fc8"), ("disabled", PANEL)],
                foreground=[("disabled", "#777777")],
            )

            s.configure(
                "Horizontal.TProgressbar",
                background=ACCENT,
                troughcolor=FIELD,
                bordercolor=BORDER,
                lightcolor=ACCENT,
                darkcolor=ACCENT,
                thickness=12,
            )

        def build_ui(self):
            outer = ttk.Frame(self.root, padding=14)
            outer.pack(fill="both", expand=True)

            title_row = ttk.Frame(outer)
            title_row.pack(fill="x")
            ttk.Label(title_row, text=APP_NAME, style="Title.TLabel").pack(side="left")
            ttk.Label(
                title_row,
                text=f"v{APP_VERSION}",
                style="Muted.TLabel",
            ).pack(side="left", padx=(8, 0), pady=(4, 0))

            ttk.Label(
                outer,
                text="Verify image integrity and move confirmed corrupt files while preserving the original folder structure.",
                style="Muted.TLabel",
            ).pack(anchor="w", pady=(2, 14))

            ttk.Label(outer, text="Source", style="Section.TLabel").pack(anchor="w", pady=(0, 5))

            source_frame = ttk.Frame(outer)
            source_frame.pack(fill="x")

            self.source_entry = ttk.Entry(source_frame, textvariable=self.source_var)
            self.source_entry.pack(side="left", fill="x", expand=True)

            self.browse_btn = ttk.Button(source_frame, text="Browse", command=self.browse)
            self.browse_btn.pack(side="left", padx=(8, 0))

            destination_panel = ttk.Frame(outer, style="Panel.TFrame", padding=(10, 8))
            destination_panel.pack(fill="x", pady=(10, 0))
            ttk.Label(destination_panel, text="Corrupted folder", style="PanelMuted.TLabel").pack(side="left")
            ttk.Label(destination_panel, textvariable=self.dest_var, style="Panel.TLabel").pack(
                side="left", padx=(10, 0)
            )

            action_frame = ttk.Frame(outer)
            action_frame.pack(fill="x", pady=(12, 10))

            self.start_btn = ttk.Button(
                action_frame,
                text="Scan and Move",
                command=self.start,
                style="Accent.TButton",
            )
            self.start_btn.pack(side="left")

            self.stop_btn = ttk.Button(action_frame, text="Stop", command=self.stop, state="disabled")
            self.stop_btn.pack(side="left", padx=(8, 0))

            self.progress = ttk.Progressbar(outer, variable=self.progress_var, maximum=100)
            self.progress.pack(fill="x", pady=(0, 7))

            ttk.Label(outer, textvariable=self.status_var, style="Muted.TLabel").pack(anchor="w")

            stats_panel = ttk.Frame(outer, style="Panel.TFrame", padding=10)
            stats_panel.pack(fill="x", pady=(12, 12))

            self.stats_vars = {
                "Checked": tk.StringVar(value="0"),
                "Good": tk.StringVar(value="0"),
                "Corrupted": tk.StringVar(value="0"),
                "Moved": tk.StringVar(value="0"),
                "Unsupported": tk.StringVar(value="0"),
                "Errors": tk.StringVar(value="0"),
            }

            for i, (label, var) in enumerate(self.stats_vars.items()):
                cell = ttk.Frame(stats_panel, style="Panel.TFrame")
                cell.grid(row=0, column=i, sticky="nsew", padx=(0 if i == 0 else 10, 0))
                ttk.Label(cell, text=label, style="StatName.TLabel").pack(anchor="center")
                ttk.Label(cell, textvariable=var, style="StatValue.TLabel").pack(anchor="center", pady=(2, 0))
                stats_panel.columnconfigure(i, weight=1)

            ttk.Label(outer, text="Details", style="Section.TLabel").pack(anchor="w", pady=(0, 5))

            log_frame = ttk.Frame(outer)
            log_frame.pack(fill="both", expand=True)

            self.log = tk.Text(
                log_frame,
                wrap="none",
                height=16,
                state="disabled",
                font=("Cascadia Mono", 9),
                bg="#161616",
                fg=FG,
                insertbackground=FG,
                selectbackground=ACCENT,
                selectforeground="#ffffff",
                relief="flat",
                borderwidth=1,
                highlightthickness=1,
                highlightbackground=BORDER,
                highlightcolor=ACCENT,
                padx=8,
                pady=8,
            )
            self.log.tag_configure("corrupt", foreground=ERROR)
            self.log.tag_configure("warning", foreground=WARNING)
            self.log.tag_configure("muted", foreground=MUTED)

            y = ttk.Scrollbar(log_frame, orient="vertical", command=self.log.yview)
            x = ttk.Scrollbar(log_frame, orient="horizontal", command=self.log.xview)
            self.log.configure(yscrollcommand=y.set, xscrollcommand=x.set)

            self.log.grid(row=0, column=0, sticky="nsew")
            y.grid(row=0, column=1, sticky="ns")
            x.grid(row=1, column=0, sticky="ew")
            log_frame.rowconfigure(0, weight=1)
            log_frame.columnconfigure(0, weight=1)

        def browse(self):
            folder = filedialog.askdirectory(title="Select source image folder")
            if folder:
                self.source_var.set(folder)
                source = Path(folder)
                self.dest_var.set(str(source.parent / f"{source.name}_CORRUPTED"))

        def log_line(self, text, tag=None):
            self.log.configure(state="normal")
            if tag:
                self.log.insert("end", text + "\n", tag)
            else:
                self.log.insert("end", text + "\n")
            self.log.see("end")
            self.log.configure(state="disabled")

        def set_controls(self, running):
            self.running = running
            self.start_btn.configure(state="disabled" if running else "normal")
            self.browse_btn.configure(state="disabled" if running else "normal")
            self.source_entry.configure(state="disabled" if running else "normal")
            self.stop_btn.configure(state="normal" if running else "disabled")

        def start(self):
            source_text = self.source_var.get().strip()
            if not source_text:
                messagebox.showerror(APP_NAME, "Select a source folder first.")
                return

            source = Path(source_text)
            if not source.is_dir():
                messagebox.showerror(APP_NAME, "The selected source folder does not exist.")
                return

            self.stop_event.clear()
            self.set_controls(True)
            self.progress_var.set(0)
            self.start_time = time.monotonic()
            self.good = self.corrupt = self.moved = self.unsupported = self.errors = 0
            self.total = self.done = 0
            self.bytes_scanned = self.bytes_moved = 0
            for var in self.stats_vars.values():
                var.set("0")

            self.log.configure(state="normal")
            self.log.delete("1.0", "end")
            self.log.configure(state="disabled")

            self.status_var.set("Scanning folders...")
            threading.Thread(target=self.worker, args=(source,), daemon=True).start()

        def stop(self):
            self.stop_event.set()
            self.status_var.set("Stopping after current files finish...")

        def worker(self, source):
            try:
                files = collect_images(source)
                self.q.put(("scan_ready", len(files)))

                if not files:
                    self.q.put(("finished", source, False))
                    return

                workers = default_workers()
                with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="ImageCheck") as pool:
                    future_map = {pool.submit(verify_image, p): p for p in files}

                    for future in as_completed(future_map):
                        if self.stop_event.is_set():
                            for f in future_map:
                                f.cancel()
                            break

                        p = future_map[future]
                        try:
                            size = p.stat().st_size
                        except OSError:
                            size = 0

                        try:
                            status, reason = future.result()
                        except Exception as exc:
                            status, reason = "error", f"{exc}"

                        moved_to = None
                        move_error = None

                        if status == "corrupt":
                            try:
                                moved_to = move_preserving_structure(source, p)
                            except Exception as exc:
                                move_error = str(exc)

                        self.q.put(("result", p, size, status, reason, moved_to, move_error))

                self.q.put(("finished", source, self.stop_event.is_set()))
            except Exception as exc:
                self.q.put(("fatal", str(exc), traceback.format_exc()))

        def process_queue(self):
            try:
                while True:
                    item = self.q.get_nowait()
                    kind = item[0]

                    if kind == "scan_ready":
                        self.total = item[1]
                        self.status_var.set(f"Found {self.total:,} image file(s). Verifying...")

                    elif kind == "result":
                        _, p, size, status, reason, moved_to, move_error = item
                        self.done += 1
                        self.bytes_scanned += size

                        if status == "good":
                            self.good += 1
                        elif status == "corrupt":
                            self.corrupt += 1
                            if moved_to is not None:
                                self.moved += 1
                                self.bytes_moved += size
                                self.log_line(f"[CORRUPTED -> MOVED] {p}", "corrupt")
                                self.log_line(f"  Reason: {reason}", "muted")
                                self.log_line(f"  To:     {moved_to}", "muted")
                            else:
                                self.errors += 1
                                self.log_line(f"[CORRUPTED -> MOVE FAILED] {p}", "corrupt")
                                self.log_line(f"  Reason: {reason}", "muted")
                                self.log_line(f"  Error:  {move_error}", "corrupt")
                        elif status == "unsupported":
                            self.unsupported += 1
                            self.log_line(f"[UNSUPPORTED - LEFT IN PLACE] {p}", "warning")
                            self.log_line(f"  Reason: {reason}", "muted")
                        else:
                            self.errors += 1
                            self.log_line(f"[ERROR - LEFT IN PLACE] {p}", "corrupt")
                            self.log_line(f"  Reason: {reason}", "muted")

                        pct = (self.done / self.total * 100) if self.total else 0
                        self.progress_var.set(pct)

                        elapsed = time.monotonic() - self.start_time if self.start_time else 0
                        rate = self.done / elapsed if elapsed > 0 else 0
                        self.status_var.set(
                            f"Checked {self.done:,}/{self.total:,} ({pct:.1f}%) | "
                            f"{rate:.1f} files/s | {human_bytes(self.bytes_scanned)} read"
                        )

                        self.stats_vars["Checked"].set(f"{self.done:,}")
                        self.stats_vars["Good"].set(f"{self.good:,}")
                        self.stats_vars["Corrupted"].set(f"{self.corrupt:,}")
                        self.stats_vars["Moved"].set(f"{self.moved:,}")
                        self.stats_vars["Unsupported"].set(f"{self.unsupported:,}")
                        self.stats_vars["Errors"].set(f"{self.errors:,}")

                    elif kind == "finished":
                        _, source, stopped = item
                        self.set_controls(False)
                        elapsed = time.monotonic() - self.start_time if self.start_time else 0

                        if stopped:
                            self.status_var.set(
                                f"Stopped. Checked {self.done:,}/{self.total:,}. "
                                f"Moved {self.moved:,} corrupted file(s)."
                            )
                        else:
                            self.progress_var.set(100 if self.total else 0)
                            self.status_var.set(
                                f"Finished in {format_elapsed(elapsed)}. "
                                f"Checked {self.done:,}; corrupted {self.corrupt:,}; moved {self.moved:,}."
                            )
                            destination = source.parent / f"{source.name}_CORRUPTED"
                            messagebox.showinfo(
                                APP_NAME,
                                "Verification complete.\n\n"
                                f"Checked: {self.done:,}\n"
                                f"Good: {self.good:,}\n"
                                f"Corrupted: {self.corrupt:,}\n"
                                f"Moved: {self.moved:,}\n"
                                f"Unsupported: {self.unsupported:,}\n"
                                f"Errors: {self.errors:,}\n"
                                f"Data checked: {human_bytes(self.bytes_scanned)}\n"
                                f"Corrupt data moved: {human_bytes(self.bytes_moved)}\n"
                                f"Elapsed: {format_elapsed(elapsed)}\n\n"
                                f"Corrupted folder:\n{destination}",
                            )

                    elif kind == "fatal":
                        _, error, tb = item
                        self.set_controls(False)
                        self.status_var.set("Failed.")
                        self.log_line("[FATAL ERROR]", "corrupt")
                        self.log_line(tb, "muted")
                        messagebox.showerror(APP_NAME, error)

            except queue.Empty:
                pass

            self.root.after(100, self.process_queue)

    root = tk.Tk()
    try:
        root.call("tk", "scaling", 1.0)
    except Exception:
        pass
    App(root)
    root.mainloop()

def main():
    # This is a Python GUI tool, so Python itself is already present.
    # Dependencies are bootstrapped automatically with pip when missing.
    if not ensure_dependencies():
        try:
            import tkinter as tk
            from tkinter import messagebox
            root = tk.Tk()
            root.withdraw()
            messagebox.showerror(
                APP_NAME,
                "Pillow could not be loaded or installed automatically.\n\n"
                "Check your internet connection and Python installation, then run the tool again.",
            )
            root.destroy()
        except Exception:
            pass
        return

    launch_gui()

if __name__ == "__main__":
    main()