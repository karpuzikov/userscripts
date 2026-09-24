import importlib.machinery
import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader("drivev_gui", str(ROOT / "DriveV_AutoInstaller.pyw"))
spec = importlib.util.spec_from_loader(loader.name, loader)
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)


class DownloaderLogicTests(unittest.TestCase):
    def test_gta5mods_resolution_uses_version_page_and_file_host(self):
        original = mod.http_get_text
        page = mod.MANIFEST["packages"]["drivev"]["page"]
        try:
            def fake(url, referer=None, timeout=60):
                if url == page:
                    return '<a href="/vehicles/drive-v-realistic-driving-car-handling/download/194629">Download</a>'
                if url.endswith('/download/194629'):
                    self.assertEqual(referer, page)
                    return 'https://files.gta5-mods.com/uploads/a/drivev.zip'
                raise AssertionError(url)
            mod.http_get_text = fake
            direct, referer = mod.resolve_package_download("drivev", lambda _: None)
            self.assertEqual(direct, 'https://files.gta5-mods.com/uploads/a/drivev.zip')
            self.assertTrue(referer.endswith('/download/194629'))
        finally:
            mod.http_get_text = original

    def test_legacy_desired_stack_quarantines_scratches_and_includes_loader(self):
        with tempfile.TemporaryDirectory() as td:
            game = Path(td)
            wanted = mod.desired_packages(game, "Legacy", {})
            for item in ("drivev", "oiv_installer", "script_hook_v", "simple_trainer", "inverse_power", "enb", "rageopenv"):
                self.assertIn(item, wanted)
            self.assertNotIn("scratches", wanted)
            self.assertNotIn("openrpf", wanted)

    def test_enhanced_desired_stack_excludes_legacy_only_resources(self):
        with tempfile.TemporaryDirectory() as td:
            wanted = mod.desired_packages(Path(td), "Enhanced", {})
            for item in ("drivev", "oiv_installer", "script_hook_v", "simple_trainer", "inverse_power", "openrpf"):
                self.assertIn(item, wanted)
            for item in ("enb", "scratches", "rageopenv"):
                self.assertNotIn(item, wanted)

    def test_drivev_optional_modules_follow_user_selection_on_both_editions(self):
        self.assertEqual(mod.effective_drivev_options("Enhanced", True, True), (True, True))
        self.assertEqual(mod.effective_drivev_options("Enhanced", True, False), (True, False))
        self.assertEqual(mod.effective_drivev_options("Legacy", True, False), (True, False))

    def test_enhanced_option_lockout_wording_is_gone_from_gui_source(self):
        source = (ROOT / "DriveV_AutoInstaller.pyw").read_text(encoding="utf-8").lower()
        self.assertNotIn("reliability" + " mode", source)
        self.assertNotIn('self.traffic_check.configure(state="disabled")', source)
        self.assertNotIn('self.ai_check.configure(state="disabled")', source)

    def test_invalid_cached_zip_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "drivev__broken.zip"
            p.write_bytes(b"not a zip" * 200)
            self.assertFalse(mod.cached_package_valid(p))


if __name__ == "__main__":
    unittest.main(verbosity=2)