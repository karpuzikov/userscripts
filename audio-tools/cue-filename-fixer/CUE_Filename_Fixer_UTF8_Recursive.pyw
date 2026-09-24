# -*- coding: utf-8 -*-
import re
import shutil
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox

AUDIO_EXTS = {
    ".m4a", ".mp4", ".flac", ".wav", ".aiff", ".aif", ".ape", ".wv",
    ".mp3", ".ogg", ".opus", ".aac", ".tta", ".tak", ".alac", ".caf"
}

FILE_RE = re.compile(
    r'^(?P<indent>\s*)FILE\s+"(?P<name>[^"]+)"(?P<tail>\s+\S+.*)$',
    re.IGNORECASE
)

LEADING_NUMBER_RE = re.compile(r'^\s*0*(\d+)(?=\D|$)')


def read_text_auto(path: Path) -> str:
    data = path.read_bytes()

    for enc in ("utf-8-sig", "utf-8", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass

    for enc in (
        "cp1251", "cp1252", "cp932", "shift_jis", "euc_jp",
        "gb18030", "big5", "euc_kr", "cp1255", "iso-8859-8"
    ):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass

    return data.decode("latin-1")


def track_number_from_name(name: str):
    m = LEADING_NUMBER_RE.match(Path(name).name)
    return int(m.group(1)) if m else None


def collect_audio_files(folder: Path):
    files = []

    for p in folder.iterdir():
        if not p.is_file():
            continue

        if p.suffix.lower() not in AUDIO_EXTS:
            continue

        n = track_number_from_name(p.name)
        if n is not None:
            files.append((n, p))

    return files


def choose_match(track_no: int, old_name: str, candidates):
    same_track = [p for n, p in candidates if n == track_no]

    if not same_track:
        return None

    old_ext = Path(old_name).suffix.lower()
    same_ext = [p for p in same_track if p.suffix.lower() == old_ext]
    pool = same_ext if same_ext else same_track

    if len(pool) == 1:
        return pool[0]

    old_prefix_match = re.match(r'^\s*(\d+)', Path(old_name).name)
    if old_prefix_match:
        old_prefix = old_prefix_match.group(1)

        same_prefix = []
        for p in pool:
            m = re.match(r'^\s*(\d+)', p.name)
            if m and m.group(1) == old_prefix:
                same_prefix.append(p)

        if len(same_prefix) == 1:
            return same_prefix[0]

    names = "\n".join(f"  • {p.name}" for p in pool)
    raise RuntimeError(
        f"Для трека {track_no:02d} найдено несколько подходящих файлов:\n{names}"
    )


def fix_cue(cue_path: Path):
    text = read_text_auto(cue_path)
    audio_files = collect_audio_files(cue_path.parent)

    if not audio_files:
        return "skipped", 0, "В папке CUE нет пронумерованных аудиофайлов."

    lines = text.splitlines(keepends=True)
    changed = 0
    missing = []
    out = []

    for line in lines:
        newline = ""
        body = line

        if body.endswith("\r\n"):
            body, newline = body[:-2], "\r\n"
        elif body.endswith("\n") or body.endswith("\r"):
            body, newline = body[:-1], body[-1]

        m = FILE_RE.match(body)

        if not m:
            out.append(line)
            continue

        old_name = m.group("name")
        track_no = track_number_from_name(old_name)

        if track_no is None:
            out.append(line)
            continue

        match = choose_match(track_no, old_name, audio_files)

        if match is None:
            missing.append(f"{track_no:02d}: {old_name}")
            out.append(line)
            continue

        new_body = f'{m.group("indent")}FILE "{match.name}"{m.group("tail")}'
        out.append(new_body + newline)

        if match.name != old_name:
            changed += 1

    if missing:
        return (
            "error",
            0,
            "Не найдены аудиофайлы для:\n" + "\n".join(missing)
        )

    if changed == 0:
        return "unchanged", 0, "Изменения не требуются."

    backup = cue_path.with_suffix(cue_path.suffix + ".bak")

    # Не затираем старый backup.
    if backup.exists():
        i = 1
        while True:
            candidate = cue_path.with_name(cue_path.name + f".bak{i}")
            if not candidate.exists():
                backup = candidate
                break
            i += 1

    shutil.copy2(cue_path, backup)

    # UTF-8 without BOM.
    cue_path.write_text("".join(out), encoding="utf-8", newline="")

    return "fixed", changed, f"Исправлено строк FILE: {changed}"


def main():
    root = tk.Tk()
    root.withdraw()
    root.update()

    folder_name = filedialog.askdirectory(
        title="Выберите папку для поиска CUE-файлов"
    )

    if not folder_name:
        root.destroy()
        return

    root_folder = Path(folder_name)

    cue_files = sorted(
        p for p in root_folder.rglob("*")
        if p.is_file() and p.suffix.lower() == ".cue"
    )

    if not cue_files:
        messagebox.showinfo(
            "Готово",
            "В выбранной папке и её подпапках CUE-файлы не найдены."
        )
        root.destroy()
        return

    fixed_files = 0
    fixed_lines = 0
    unchanged_files = 0
    skipped_files = 0
    errors = []

    for cue_path in cue_files:
        try:
            status, changed, info = fix_cue(cue_path)

            if status == "fixed":
                fixed_files += 1
                fixed_lines += changed
            elif status == "unchanged":
                unchanged_files += 1
            elif status == "skipped":
                skipped_files += 1
            elif status == "error":
                errors.append(f"{cue_path}\n{info}")

        except Exception as e:
            errors.append(f"{cue_path}\n{e}")

    report = (
        f"Найдено CUE: {len(cue_files)}\n"
        f"Исправлено CUE: {fixed_files}\n"
        f"Исправлено строк FILE: {fixed_lines}\n"
        f"Без изменений: {unchanged_files}\n"
        f"Пропущено: {skipped_files}\n"
        f"Ошибок: {len(errors)}"
    )

    if errors:
        error_log = root_folder / "CUE_Fix_Errors.txt"
        error_log.write_text(
            "\n\n" + ("\n\n" + "=" * 80 + "\n\n").join(errors),
            encoding="utf-8"
        )

        report += (
            f"\n\nПодробности ошибок сохранены в:\n{error_log}"
        )

    messagebox.showinfo("Готово", report)
    root.destroy()


if __name__ == "__main__":
    main()