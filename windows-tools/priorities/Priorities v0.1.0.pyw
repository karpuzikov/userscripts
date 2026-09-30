import ctypes
import itertools
import json
import os
import random
import shutil
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import tkinter as tk
from tkinter import messagebox, ttk


APP_NAME = "Priorities"
APP_VERSION = "0.1.0"
PROGRAM_DATA_DIR_NAME = "Priorities"

DARK_BG = "#101214"
DARK_PANEL = "#171a1d"
DARK_FIELD = "#0c0e10"
DARK_BORDER = "#30353a"
DARK_FG = "#f2f2f2"
DARK_MUTED = "#a8adb3"
DARK_ACCENT = "#2f81f7"
DARK_ACCENT_HOVER = "#388bfd"


def _documents_dir() -> Path:
    """Resolve the actual Windows Documents library, including redirection."""
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


def _app_dir() -> Path:
    return _documents_dir() / "Karpuzikov Tools" / PROGRAM_DATA_DIR_NAME


def _state_dir() -> Path:
    return _app_dir() / "state"


def _results_dir() -> Path:
    return _app_dir() / "results"


def _settings_path() -> Path:
    return _app_dir() / "settings.json"


def _session_path() -> Path:
    return _state_dir() / "current_session.json"


def _crash_log_path() -> Path:
    return _app_dir() / "logs" / "Priorities - Crash.log"


def _ensure_dirs() -> None:
    for path in (_app_dir(), _state_dir(), _results_dir(), _crash_log_path().parent):
        path.mkdir(parents=True, exist_ok=True)


def _atomic_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _load_json(path: Path, default):
    try:
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
            return data
    except Exception:
        pass
    return default


def _enable_dark_titlebar(window) -> None:
    if os.name != "nt":
        return
    try:
        hwnd = window.winfo_id()
        value = ctypes.c_int(1)
        # DWMWA_USE_IMMERSIVE_DARK_MODE: 20 on current Windows, 19 on older builds.
        for attr in (20, 19):
            try:
                ctypes.windll.dwmapi.DwmSetWindowAttribute(
                    hwnd, attr, ctypes.byref(value), ctypes.sizeof(value)
                )
                break
            except Exception:
                continue
    except Exception:
        pass


def _apply_dark_theme(root: tk.Tk) -> None:
    root.configure(background=DARK_BG)
    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except Exception:
        pass

    style.configure(".", background=DARK_BG, foreground=DARK_FG, font=("Segoe UI", 9))
    style.configure("TFrame", background=DARK_BG)
    style.configure("Panel.TFrame", background=DARK_PANEL)
    style.configure("TLabel", background=DARK_BG, foreground=DARK_FG)
    style.configure("Muted.TLabel", background=DARK_BG, foreground=DARK_MUTED)
    style.configure("Panel.TLabel", background=DARK_PANEL, foreground=DARK_FG)
    style.configure("Title.TLabel", background=DARK_BG, foreground=DARK_FG, font=("Segoe UI", 15, "bold"))
    style.configure("Heading.TLabel", background=DARK_BG, foreground=DARK_FG, font=("Segoe UI", 10, "bold"))
    style.configure(
        "TButton",
        background="#24292e",
        foreground=DARK_FG,
        bordercolor=DARK_BORDER,
        focusthickness=1,
        focuscolor=DARK_ACCENT,
        padding=(10, 7),
    )
    style.map(
        "TButton",
        background=[("active", "#30363d"), ("pressed", "#21262d"), ("disabled", "#1b1e21")],
        foreground=[("disabled", "#6e7681")],
    )
    style.configure(
        "Choice.TButton",
        font=("Segoe UI", 12, "bold"),
        padding=(18, 22),
        background="#20252a",
    )
    style.map(
        "Choice.TButton",
        background=[("active", "#2a3138"), ("pressed", "#1b2025")],
    )
    style.configure(
        "Accent.TButton",
        background=DARK_ACCENT,
        foreground="#ffffff",
        font=("Segoe UI", 9, "bold"),
    )
    style.map(
        "Accent.TButton",
        background=[("active", DARK_ACCENT_HOVER), ("pressed", "#1f6feb")],
    )
    style.configure(
        "Horizontal.TProgressbar",
        background=DARK_ACCENT,
        troughcolor=DARK_FIELD,
        bordercolor=DARK_BORDER,
        lightcolor=DARK_ACCENT,
        darkcolor=DARK_ACCENT,
    )


def _clean_items(text: str) -> Tuple[List[str], int]:
    items: List[str] = []
    seen = set()
    removed = 0
    for raw in text.splitlines():
        item = raw.strip()
        if not item:
            continue
        key = item.casefold()
        if key in seen:
            removed += 1
            continue
        seen.add(key)
        items.append(item)
    return items, removed


def _all_pairs(count: int) -> List[Tuple[int, int]]:
    pairs = list(itertools.combinations(range(count), 2))
    # Avoid systematic input-order bias while preserving every pair exactly once.
    random.SystemRandom().shuffle(pairs)
    return pairs


def _wins_matrix(count: int, choices: List[List[int]]) -> List[List[int]]:
    matrix = [[0] * count for _ in range(count)]
    for winner, loser in choices:
        if 0 <= winner < count and 0 <= loser < count and winner != loser:
            matrix[winner][loser] = 1
    return matrix


def _score_order(order: List[int], matrix: List[List[int]]) -> int:
    score = 0
    for pos, a in enumerate(order):
        for b in order[pos + 1:]:
            score += matrix[a][b]
    return score


def _exact_kemeny_order(items: List[str], matrix: List[List[int]]) -> Tuple[List[int], int]:
    """Exact best-fit pairwise order for modest lists using subset DP."""
    n = len(items)
    size = 1 << n
    dp = [-1] * size
    parent = [-1] * size
    dp[0] = 0

    # If item i is appended at the end of subset S, every earlier item j agrees
    # with the order when j directly beat i.
    gain = [[0] * size for _ in range(n)]
    for i in range(n):
        for mask in range(1, size):
            low = mask & -mask
            j = low.bit_length() - 1
            gain[i][mask] = gain[i][mask ^ low] + matrix[j][i]

    for mask in range(1, size):
        candidates = []
        bits = mask
        while bits:
            low = bits & -bits
            i = low.bit_length() - 1
            prev = mask ^ low
            value = dp[prev] + gain[i][prev]
            wins_i = sum(matrix[i])
            candidates.append((value, wins_i, items[i].casefold(), i))
            bits ^= low
        best = max(candidates, key=lambda x: (x[0], x[1], x[2]))
        dp[mask] = best[0]
        parent[mask] = best[3]

    order_rev: List[int] = []
    mask = size - 1
    while mask:
        i = parent[mask]
        order_rev.append(i)
        mask ^= 1 << i
    order = list(reversed(order_rev))
    return order, dp[size - 1]


def _heuristic_kemeny_order(items: List[str], matrix: List[List[int]]) -> Tuple[List[int], int]:
    """Fast best-fit order for larger lists."""
    n = len(items)
    wins = [sum(row) for row in matrix]
    order = sorted(range(n), key=lambda i: (-wins[i], items[i].casefold()))

    improved = True
    while improved:
        improved = False
        best_score = _score_order(order, matrix)
        best_order = order
        for old_pos in range(n):
            item = order[old_pos]
            base = order[:old_pos] + order[old_pos + 1:]
            for new_pos in range(n):
                candidate = base[:new_pos] + [item] + base[new_pos:]
                score = _score_order(candidate, matrix)
                if score > best_score:
                    best_score = score
                    best_order = candidate
        if best_order != order:
            order = best_order
            improved = True

    return order, _score_order(order, matrix)


def _build_result_text(items: List[str], choices: List[List[int]]) -> str:
    n = len(items)
    total = n * (n - 1) // 2
    matrix = _wins_matrix(n, choices)
    wins = [sum(row) for row in matrix]
    losses = [(n - 1) - wins[i] for i in range(n)]

    if n <= 18:
        order, consistent = _exact_kemeny_order(items, matrix)
        method = "Exact best-fit pairwise hierarchy (Kemeny optimum)"
    else:
        order, consistent = _heuristic_kemeny_order(items, matrix)
        method = "Best-fit pairwise hierarchy (heuristic; list too large for exact optimization)"

    contradictions = total - consistent
    created = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    lines = [
        "PRIORITIES - FINAL HIERARCHY",
        f"Generated: {created}",
        "",
        "HOW TO INTERPRET",
        "- Rank 1 is the highest priority.",
        "- Earlier items have higher overall priority than later items.",
        "- Every possible pair was compared exactly once.",
        "- DIRECT PAIRWISE PREFERENCES are authoritative if a preference cycle makes the linear hierarchy imperfect.",
        "",
        f"Items: {n}",
        f"Pairwise comparisons: {total}",
        f"Ranking method: {method}",
        f"Pairwise decisions consistent with final order: {consistent}/{total}",
        f"Contradictions caused by preference cycles: {contradictions}",
        "",
        "HIERARCHY",
    ]

    for rank, idx in enumerate(order, 1):
        lines.append(f"{rank}. {items[idx]}")

    lines.extend(["", "PAIRWISE SCORECARD"])
    for rank, idx in enumerate(order, 1):
        lines.append(f"{rank}. {items[idx]} | wins={wins[idx]} | losses={losses[idx]}")

    lines.extend(["", "DIRECT PAIRWISE PREFERENCES - AUTHORITATIVE"])
    ranking_position = {idx: pos for pos, idx in enumerate(order)}
    ordered_choices = sorted(
        choices,
        key=lambda pair: (
            min(ranking_position.get(pair[0], n), ranking_position.get(pair[1], n)),
            max(ranking_position.get(pair[0], n), ranking_position.get(pair[1], n)),
        ),
    )
    for winner, loser in ordered_choices:
        lines.append(f"- {items[winner]} > {items[loser]}")

    lines.extend([
        "",
        "AI INSTRUCTION",
        "Use the HIERARCHY as the user's overall priority order.",
        "If a specific pair conflicts with the linear hierarchy because of a preference cycle,",
        "use the corresponding DIRECT PAIRWISE PREFERENCE as the user's explicit choice for that pair.",
    ])
    return "\n".join(lines) + "\n"


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        _ensure_dirs()
        self.title(f"{APP_NAME} {APP_VERSION}")
        self.geometry("920x690")
        self.minsize(780, 600)
        _apply_dark_theme(self)
        self.after(0, lambda: _enable_dark_titlebar(self))

        self.session: Optional[dict] = None
        self.current_result_path: Optional[Path] = None

        self.container = ttk.Frame(self)
        self.container.pack(fill="both", expand=True)
        self.show_input()

    def _clear(self) -> None:
        for child in self.container.winfo_children():
            child.destroy()

    def _session_exists(self) -> bool:
        data = _load_json(_session_path(), {})
        return (
            isinstance(data, dict)
            and isinstance(data.get("items"), list)
            and isinstance(data.get("pairs"), list)
            and int(data.get("index", 0)) < len(data.get("pairs", []))
        )

    def show_input(self) -> None:
        self._clear()
        frame = ttk.Frame(self.container)
        frame.pack(fill="both", expand=True, padx=22, pady=20)

        ttk.Label(frame, text="Priorities", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            frame,
            text="Enter one item per line. Start compares every possible pair so the final hierarchy reflects your own choices.",
            style="Muted.TLabel",
            wraplength=850,
            justify="left",
        ).pack(anchor="w", pady=(5, 14))

        ttk.Label(frame, text="Items to compare", style="Heading.TLabel").pack(anchor="w", pady=(0, 6))

        self.input_text = tk.Text(
            frame,
            background=DARK_FIELD,
            foreground=DARK_FG,
            insertbackground=DARK_FG,
            selectbackground=DARK_ACCENT,
            selectforeground="#ffffff",
            relief="solid",
            borderwidth=1,
            highlightthickness=1,
            highlightbackground=DARK_BORDER,
            highlightcolor=DARK_ACCENT,
            font=("Segoe UI", 10),
            wrap="word",
            undo=True,
        )
        self.input_text.pack(fill="both", expand=True)

        settings = _load_json(_settings_path(), {})
        previous = str(settings.get("last_input", "") or "")
        if previous:
            self.input_text.insert("1.0", previous)

        bottom = ttk.Frame(frame)
        bottom.pack(fill="x", pady=(12, 0))

        self.count_var = tk.StringVar(value="0 items")
        ttk.Label(bottom, textvariable=self.count_var, style="Muted.TLabel").pack(side="left")

        if self._session_exists():
            ttk.Button(bottom, text="Resume comparison", command=self.resume_session).pack(side="right", padx=(8, 0))

        ttk.Button(bottom, text="Start comparison", style="Accent.TButton", command=self.start_new).pack(side="right")
        self.input_text.bind("<<Modified>>", self._input_changed)
        self.input_text.edit_modified(False)
        self._update_count()
        self.input_text.focus_set()

    def _input_changed(self, _event=None) -> None:
        if self.input_text.edit_modified():
            self.input_text.edit_modified(False)
            self._update_count()

    def _update_count(self) -> None:
        items, removed = _clean_items(self.input_text.get("1.0", "end"))
        comparisons = len(items) * (len(items) - 1) // 2
        suffix = f" | {removed} duplicate line(s) ignored" if removed else ""
        self.count_var.set(f"{len(items)} items | {comparisons} comparisons{suffix}")

    def _save_settings(self, text: str) -> None:
        _atomic_json(_settings_path(), {"last_input": text})

    def start_new(self) -> None:
        raw = self.input_text.get("1.0", "end").strip()
        items, removed = _clean_items(raw)
        if len(items) < 2:
            messagebox.showerror(APP_NAME, "Enter at least two different items.", parent=self)
            return

        total = len(items) * (len(items) - 1) // 2
        if total > 300:
            if not messagebox.askyesno(
                APP_NAME,
                f"{len(items)} items require {total} pairwise choices.\n\nStart anyway?",
                parent=self,
            ):
                return

        if self._session_exists():
            if not messagebox.askyesno(
                APP_NAME,
                "An unfinished comparison already exists.\n\nReplace it with this new list?",
                parent=self,
            ):
                return

        self._save_settings(raw)
        self.session = {
            "app": APP_NAME,
            "version": APP_VERSION,
            "created": datetime.now().isoformat(timespec="seconds"),
            "items": items,
            "pairs": [list(pair) for pair in _all_pairs(len(items))],
            "index": 0,
            "choices": [],
        }
        self._save_session()
        self.show_comparison()

    def resume_session(self) -> None:
        data = _load_json(_session_path(), {})
        if not isinstance(data, dict):
            messagebox.showerror(APP_NAME, "Saved comparison state could not be loaded.", parent=self)
            return
        self.session = data
        self.show_comparison()

    def _save_session(self) -> None:
        if self.session is not None:
            _atomic_json(_session_path(), self.session)

    def show_comparison(self) -> None:
        if not self.session:
            self.show_input()
            return

        items = self.session["items"]
        pairs = self.session["pairs"]
        index = int(self.session.get("index", 0))
        if index >= len(pairs):
            self.finish()
            return

        left_idx, right_idx = pairs[index]
        total = len(pairs)

        self._clear()
        frame = ttk.Frame(self.container)
        frame.pack(fill="both", expand=True, padx=22, pady=20)

        ttk.Label(frame, text="Which one has higher priority?", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            frame,
            text="Pick one. Every item will be compared against every other item exactly once.",
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(5, 16))

        progress = ttk.Progressbar(frame, maximum=max(1, total), value=index, mode="determinate")
        progress.pack(fill="x")
        ttk.Label(
            frame,
            text=f"Comparison {index + 1} of {total} | {total - index - 1} remaining",
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(5, 18))

        choices = ttk.Frame(frame)
        choices.pack(fill="both", expand=True)
        choices.columnconfigure(0, weight=1)
        choices.columnconfigure(1, weight=1)
        choices.rowconfigure(0, weight=1)

        left_button = ttk.Button(
            choices,
            text=items[left_idx],
            style="Choice.TButton",
            command=lambda: self.choose(left_idx, right_idx),
        )
        left_button.grid(row=0, column=0, sticky="nsew", padx=(0, 8))

        right_button = ttk.Button(
            choices,
            text=items[right_idx],
            style="Choice.TButton",
            command=lambda: self.choose(right_idx, left_idx),
        )
        right_button.grid(row=0, column=1, sticky="nsew", padx=(8, 0))

        bottom = ttk.Frame(frame)
        bottom.pack(fill="x", pady=(16, 0))
        ttk.Button(bottom, text="Back to list", command=self.back_to_input).pack(side="left")
        undo = ttk.Button(bottom, text="Undo last choice", command=self.undo_choice)
        undo.pack(side="left", padx=(8, 0))
        if index <= 0:
            undo.configure(state="disabled")
        ttk.Label(
            bottom,
            text="Keyboard: Left / 1 = left, Right / 2 = right, Backspace = undo",
            style="Muted.TLabel",
        ).pack(side="right")

        self.bind("<Left>", lambda _e: self.choose(left_idx, right_idx))
        self.bind("1", lambda _e: self.choose(left_idx, right_idx))
        self.bind("<Right>", lambda _e: self.choose(right_idx, left_idx))
        self.bind("2", lambda _e: self.choose(right_idx, left_idx))
        self.bind("<BackSpace>", lambda _e: self.undo_choice())
        left_button.focus_set()

    def choose(self, winner: int, loser: int) -> None:
        if not self.session:
            return
        index = int(self.session.get("index", 0))
        pairs = self.session.get("pairs", [])
        if index >= len(pairs):
            return

        expected = set(pairs[index])
        if {winner, loser} != expected:
            return

        self.session.setdefault("choices", []).append([winner, loser])
        self.session["index"] = index + 1
        self._save_session()

        if self.session["index"] >= len(pairs):
            self.finish()
        else:
            self.show_comparison()

    def undo_choice(self) -> None:
        if not self.session:
            return
        index = int(self.session.get("index", 0))
        choices = self.session.get("choices", [])
        if index <= 0 or not choices:
            return
        choices.pop()
        self.session["index"] = index - 1
        self._save_session()
        self.show_comparison()

    def back_to_input(self) -> None:
        if self.session:
            self._save_session()
        self.show_input()

    def finish(self) -> None:
        if not self.session:
            return

        items = list(self.session.get("items", []))
        choices = list(self.session.get("choices", []))
        expected = len(items) * (len(items) - 1) // 2
        if len(choices) != expected:
            self.show_comparison()
            return

        text = _build_result_text(items, choices)
        stamp = datetime.now().strftime("%Y-%m-%d-%H-%M")
        _results_dir().mkdir(parents=True, exist_ok=True)
        result_path = _results_dir() / f"Priorities Result {stamp}.txt"
        suffix = 2
        while result_path.exists():
            result_path = _results_dir() / f"Priorities Result {stamp} ({suffix}).txt"
            suffix += 1
        result_path.write_text(text, encoding="utf-8")
        self.current_result_path = result_path

        try:
            _session_path().unlink(missing_ok=True)
        except Exception:
            pass

        self.session = None
        self.show_result(text)

    def show_result(self, result_text: str) -> None:
        self._clear()
        frame = ttk.Frame(self.container)
        frame.pack(fill="both", expand=True, padx=22, pady=20)

        ttk.Label(frame, text="Priority hierarchy complete", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            frame,
            text="The result below is plain text designed to be pasted directly into an AI conversation.",
            style="Muted.TLabel",
        ).pack(anchor="w", pady=(5, 12))

        output = tk.Text(
            frame,
            background=DARK_FIELD,
            foreground=DARK_FG,
            insertbackground=DARK_FG,
            selectbackground=DARK_ACCENT,
            selectforeground="#ffffff",
            relief="solid",
            borderwidth=1,
            highlightthickness=1,
            highlightbackground=DARK_BORDER,
            font=("Cascadia Mono", 9),
            wrap="none",
        )
        output.pack(fill="both", expand=True)
        output.insert("1.0", result_text)
        output.configure(state="disabled")

        bottom = ttk.Frame(frame)
        bottom.pack(fill="x", pady=(12, 0))

        if self.current_result_path:
            ttk.Label(
                bottom,
                text=str(self.current_result_path),
                style="Muted.TLabel",
            ).pack(side="left")

        ttk.Button(bottom, text="New comparison", command=self.show_input).pack(side="right")
        ttk.Button(
            bottom,
            text="Open results folder",
            command=lambda: os.startfile(_results_dir()) if os.name == "nt" else None,
        ).pack(side="right", padx=(0, 8))
        ttk.Button(
            bottom,
            text="Copy result",
            style="Accent.TButton",
            command=lambda: self.copy_result(result_text),
        ).pack(side="right", padx=(0, 8))

    def copy_result(self, result_text: str) -> None:
        self.clipboard_clear()
        self.clipboard_append(result_text)
        self.update_idletasks()
        messagebox.showinfo(APP_NAME, "Result copied to clipboard.", parent=self)


def _report_crash(exc: BaseException) -> None:
    try:
        _ensure_dirs()
        details = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        _crash_log_path().write_text(
            f"{APP_NAME} {APP_VERSION}\n"
            f"Crash: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
            f"{details}",
            encoding="utf-8",
        )
    except Exception:
        pass


def main() -> None:
    try:
        app = App()
        app.after(100, app.deiconify)
        app.after(150, app.lift)
        app.mainloop()
    except BaseException as exc:
        _report_crash(exc)


if __name__ == "__main__":
    main()
