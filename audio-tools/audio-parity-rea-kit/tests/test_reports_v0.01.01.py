"""Automatic report regression tests (independent algorithms are NOT original parity)."""
import importlib.machinery
import importlib.util
import tempfile
import unittest
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOADER = importlib.machinery.SourceFileLoader(
    "audio_suite_reports_v00101", str(ROOT / "Audio_Analysis_Suite_v0.01.01.pyw"))
SPEC = importlib.util.spec_from_loader(LOADER.name, LOADER)
APP = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = APP
LOADER.exec_module(APP)


class ReportTests(unittest.TestCase):
    def test_reference_layout_23_rows(self):
        reference = (ROOT / "Reference" / "Audio Tests_log.txt").read_bytes()
        rows = []
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td) / "Audio Tests"
            folder.mkdir()
            for line in reference.decode("utf-8").splitlines():
                if line.count("|") != 7 or "File Name" in line:
                    continue
                name, ext, sr, bits, peak, lufs, dr = [
                    x.strip() for x in line.split("|")[:-1]]
                rows.append(APP.Result(
                    path=str(folder / (name + ext)), status="Done",
                    rate=int(float(sr[:-1]) * 1000), channels=2,
                    dr=int(dr), lufs=float(lufs), peak=float(peak),
                    word_length=bits))
            self.assertEqual(len(rows), 23)
            produced = APP.dr_folder_report(folder, rows)
            lines = produced.decode("utf-8").splitlines()
            expected = reference.decode("utf-8").splitlines()
            self.assertEqual(lines[3:30], expected[3:30])
            self.assertIn("Experimental EP/Album DR: 1", lines)
            self.assertNotIn("Official EP/Album DR: 1", lines)
            self.assertNotIn(b"\n", produced.replace(b"\r\n", b""))
            self.assertFalse(produced.startswith(b"\xef\xbb\xbf"))

    def test_default_names_collision_and_repeat(self):
        with tempfile.TemporaryDirectory() as td:
            folder = Path(td) / "Album"
            folder.mkdir()
            audio = folder / "01 Audio.flac"
            audio.write_bytes(b"unchanged")
            record = APP.Result(str(audio), status="Done", rate=44100,
                channels=2, dr=-1, lufs=5.16, peak=1.93, word_length="16")
            saved = APP.write_album_reports([record], True, True)
            self.assertEqual([p.name for p in saved],
                ["Album_log.txt", "audiochecker.log"])
            self.assertEqual(saved, APP.write_album_reports([record], True, True))
            self.assertEqual(audio.read_bytes(), b"unchanged")
            self.assertIn(b"    +1.93", saved[0].read_bytes())
            self.assertIn(b"       -1", saved[0].read_bytes())
            saved[0].write_bytes(b"ORIGINAL DR")
            saved[1].write_bytes(b"ORIGINAL AUDIOCHECKER")
            fallback = APP.write_album_reports([record], True, True)
            self.assertEqual([p.name for p in fallback],
                ["Album_log (Audio Analysis Suite).txt",
                 "audiochecker (Audio Analysis Suite).log"])
            self.assertEqual(saved[0].read_bytes(), b"ORIGINAL DR")
            self.assertEqual(saved[1].read_bytes(), b"ORIGINAL AUDIOCHECKER")
            self.assertEqual(fallback, APP.write_album_reports([record], True, True))

    def test_rejected_and_cancelled_groups(self):
        with tempfile.TemporaryDirectory() as td:
            folders = [Path(td) / "Album A", Path(td) / "Album B"]
            for f in folders: f.mkdir()
            records = [APP.Result(str(f / "short.wav"), status="Rejected",
                                  detail="DR rejected: shorter than 10 seconds") for f in folders]
            written = APP.write_album_reports(records, True, False, partial=True)
            self.assertEqual(len(written), 2)
            for p in written:
                self.assertIn(b"Number of EP/Album Files: 0", p.read_bytes())
                self.assertIn(b"Partial analysis", p.read_bytes())
                self.assertFalse((p.parent / "audiochecker.log").exists())


if __name__ == "__main__":
    unittest.main()
