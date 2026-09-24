import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from drivev_installer_core import (  # noqa: E402
    BackupSession,
    can_use_pinned_scripthook,
    classify_drivev_oivs,
    detect_edition,
    identify_zip_package,
    legacy_mods_loader_satisfied,
    oiv_install_command,
    oiv_declared_gameversion,
    oiv_uninstall_command,
    safe_extract_zip,
    set_enb_ignore_damage_limits_text,
    gta5mods_latest_version_path,
    gta5mods_direct_url,
    scripthook_zip_url,
    enb_latest_version_url,
    enb_zip_url,
    content_disposition_filename,
    package_cache_name,
    package_id_from_cache_name,
    parse_steam_library_paths,
    candidate_game_paths,
    load_user_settings,
    save_user_settings,
)


class CoreTests(unittest.TestCase):
    def test_pinned_scripthook_only_for_matching_known_build(self):
        self.assertTrue(can_use_pinned_scripthook(None, "1.0.3889.0"))
        self.assertTrue(can_use_pinned_scripthook("1.0.3889.0", "1.0.3889.0"))
        self.assertFalse(can_use_pinned_scripthook("1.0.4000.0", "1.0.3889.0"))

    def test_detect_edition(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td)
            (p / "GTA5.exe").write_bytes(b"")
            self.assertEqual(detect_edition(p), "Legacy")
            (p / "GTA5_Enhanced.exe").write_bytes(b"")
            self.assertEqual(detect_edition(p), "Enhanced")

    def test_enb_ignore_damage_limits_is_set_inside_fix_section(self):
        original = "[ENGINE]\nForceVSync=false\n[FIX]\nIgnoreDamageLimits=false\nOther=true\n"
        patched = set_enb_ignore_damage_limits_text(original)
        self.assertIn("[FIX]\nIgnoreDamageLimits=true\nOther=true", patched)
        self.assertNotIn("IgnoreDamageLimits=false", patched)

    def test_enb_ignore_damage_limits_adds_fix_section_when_missing(self):
        patched = set_enb_ignore_damage_limits_text("[ENGINE]\nForceVSync=false\n")
        self.assertTrue(patched.endswith("[FIX]\nIgnoreDamageLimits=true\n"))

    def test_safe_extract_rejects_zip_slip(self):
        with tempfile.TemporaryDirectory() as td:
            z = Path(td) / "bad.zip"
            with zipfile.ZipFile(z, "w") as f:
                f.writestr("../escape.txt", "bad")
            with self.assertRaises(ValueError):
                safe_extract_zip(z, Path(td) / "out")

    def test_classify_drivev_oivs(self):
        names = [
            "Install.oiv",
            "Optional/Traffic Edits.oiv",
            "Optional/AI Driving Improvements.oiv",
            "Uninstall.oiv",
            "Optional/WOV Patch.oiv",
        ]
        c = classify_drivev_oivs(names)
        self.assertEqual(c["main"], "Install.oiv")
        self.assertEqual(c["traffic"], ["Optional/Traffic Edits.oiv"])
        self.assertEqual(c["ai"], ["Optional/AI Driving Improvements.oiv"])
        self.assertNotIn("Uninstall.oiv", c["installable"])

    def test_identify_zip_packages_from_members(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            cases = {
                "trainer.zip": (["TrainerV.asi", "trainerv.ini"], "simple_trainer"),
                "inverse.zip": (["InversePower.asi", "InversePower.ini"], "inverse_power"),
                "openrpf.zip": (["OpenRPF.asi", "dsound.dll"], "openrpf"),
                "rageopenv.zip": (["RageOpenV.asi", "readme.txt"], "rageopenv"),
                "enb.zip": (["WrapperVersion/d3d11.dll", "WrapperVersion/enblocal.ini"], "enb"),
                "drive.zip": (["Install.oiv", "Installation readme.txt"], "drivev"),
            }
            for filename, (members, expected) in cases.items():
                z = td / filename
                with zipfile.ZipFile(z, "w") as f:
                    for m in members:
                        f.writestr(m, b"x")
                self.assertEqual(identify_zip_package(z), expected)

    def test_legacy_mods_loader_satisfied_by_existing_or_package(self):
        with tempfile.TemporaryDirectory() as td:
            game = Path(td)
            self.assertFalse(legacy_mods_loader_satisfied(game, set()))
            self.assertTrue(legacy_mods_loader_satisfied(game, {"rageopenv"}))
            (game / "OpenIV.asi").write_bytes(b"x")
            self.assertTrue(legacy_mods_loader_satisfied(game, set()))
            (game / "OpenIV.asi").unlink()
            (game / "RageOpenV.asi").write_bytes(b"x")
            self.assertTrue(legacy_mods_loader_satisfied(game, set()))

    def test_backup_copy_and_restore(self):
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            game = td / "game"
            src = td / "src.dll"
            state = td / "state"
            game.mkdir()
            src.write_bytes(b"new")
            target = game / "x.dll"
            target.write_bytes(b"old")

            session = BackupSession(game, state)
            session.copy_with_backup(src, target)
            session.save()
            self.assertEqual(target.read_bytes(), b"new")
            BackupSession.restore_from_manifest(session.manifest_path)
            self.assertEqual(target.read_bytes(), b"old")

    def test_oiv_command_uses_validated_game_path_without_second_picker(self):
        cmd = oiv_install_command(Path("C:/Tools/CodeWalker.OIVInstaller.exe"), Path("C:/m.oiv"), Path("D:/GTAV"))
        self.assertEqual(cmd[1], "--install")
        self.assertIn("--game", cmd)
        # CodeWalker re-prompts for packages whose assembly.xml has GameVersion.Any
        # unless --force is supplied. Our wrapper validates the selected GTA folder
        # and edition before invoking CodeWalker, so force only suppresses that
        # redundant second folder picker.
        self.assertIn("--force", cmd)

    def test_explicit_gameversion_keeps_codewalker_compatibility_guard(self):
        with tempfile.TemporaryDirectory() as td:
            oiv = Path(td) / "versioned.oiv"
            with zipfile.ZipFile(oiv, "w") as zf:
                zf.writestr("assembly.xml", "<package><metadata><gameversion>Legacy</gameversion></metadata></package>")
            self.assertEqual(oiv_declared_gameversion(oiv), "legacy")
            cmd = oiv_install_command(Path("C:/Tools/CodeWalker.OIVInstaller.exe"), oiv, Path("D:/GTAV"))
            self.assertNotIn("--force", cmd)

    def test_oiv_uninstall_command_uses_package_name_and_never_reprompts_for_game_path(self):
        with tempfile.TemporaryDirectory() as td:
            oiv = Path(td) / "DriveV.oiv"
            with zipfile.ZipFile(oiv, "w") as zf:
                zf.writestr(
                    "assembly.xml",
                    "<package><metadata><name>Drive V</name></metadata></package>",
                )
            cmd = oiv_uninstall_command(
                Path("C:/Tools/CodeWalker.OIVInstaller.exe"), oiv, Path("D:/GTAV")
            )
            self.assertEqual(cmd[:3], [
                "C:/Tools/CodeWalker.OIVInstaller.exe", "--uninstall", "Drive V"
            ])
            self.assertIn("--game", cmd)
            self.assertNotIn("--uninstall-oiv", cmd)
            self.assertNotIn("--vanilla", cmd)

    def test_gta5mods_latest_download_uses_highest_version_id(self):
        page = """
        <a href="/vehicles/drive-v/download/190000">old</a>
        <a href="/vehicles/drive-v/download/194629">new</a>
        <a href="/vehicles/drive-v/download/192500">middle</a>
        """
        self.assertEqual(gta5mods_latest_version_path(page), "/vehicles/drive-v/download/194629")

    def test_gta5mods_direct_url_decodes_html_entities(self):
        page = 'x https://files.gta5-mods.com/uploads/a/file.zip?x=1&amp;y=2 z'
        self.assertEqual(
            gta5mods_direct_url(page),
            'https://files.gta5-mods.com/uploads/a/file.zip?x=1&y=2',
        )

    def test_scripthook_resolver_chooses_highest_version(self):
        page = """
        <a href="/files/ScriptHookV_1.0.3751.0.zip">a</a>
        <a href="/files/ScriptHookV_1.0.3889.0.zip">b</a>
        """
        self.assertEqual(
            scripthook_zip_url(page, 'https://dev-c.com/gtav/scripthookv/'),
            'https://dev-c.com/files/ScriptHookV_1.0.3889.0.zip',
        )

    def test_enb_resolver_uses_highest_numeric_version_and_zip(self):
        index = """
        <a href="mod_gta5_v0489.htm">old</a>
        <a href="mod_gta5_v0492.htm">new</a>
        """
        version = enb_latest_version_url(index, 'https://enbdev.com/download_mod_gta5.htm')
        self.assertEqual(version, 'https://enbdev.com/mod_gta5_v0492.htm')
        self.assertEqual(
            enb_zip_url('<a href="files/enbseries_gta5_v0492.zip">download</a>', version),
            'https://enbdev.com/files/enbseries_gta5_v0492.zip',
        )

    def test_content_disposition_filename_is_sanitized_to_basename(self):
        self.assertEqual(
            content_disposition_filename('attachment; filename="folder\\DriveV.zip"'),
            'DriveV.zip',
        )

    def test_package_cache_prefix_round_trip(self):
        cached = package_cache_name('drivev', 'Drive V 7.4.rar')
        self.assertEqual(cached, 'drivev__Drive V 7.4.rar')
        self.assertEqual(package_id_from_cache_name(cached), 'drivev')
        self.assertIsNone(package_id_from_cache_name('random.zip'))

    def test_package_cache_name_removes_windows_invalid_characters(self):
        self.assertEqual(package_cache_name('drivev', 'bad:name?.zip'), 'drivev__bad_name_.zip')

    def test_parse_steam_library_paths_supports_other_drives(self):
        vdf = r'''
        "libraryfolders"
        {
            "0" { "path" "C:\\Program Files (x86)\\Steam" }
            "1" { "path" "D:\\SteamLibrary" }
            "2" { "path" "E:\\Games\\Steam" }
        }
        '''
        paths = parse_steam_library_paths(vdf)
        self.assertIn(Path(r"D:\SteamLibrary"), paths)
        self.assertIn(Path(r"E:\Games\Steam"), paths)

    def test_candidate_game_paths_checks_each_drive_and_steam_library(self):
        roots = [Path("C:/"), Path("D:/"), Path("E:/")]
        steam = [Path("F:/SteamLibrary")]
        candidates = candidate_game_paths(roots, steam_libraries=steam)
        as_lower = {str(p).replace("\\", "/").lower() for p in candidates}
        self.assertIn("d:/steam/steamapps/common/grand theft auto v", as_lower)
        self.assertIn("e:/epic games/gtav", as_lower)
        self.assertIn("f:/steamlibrary/steamapps/common/grand theft auto v", as_lower)

    def test_user_settings_round_trip_remembers_game_path(self):
        with tempfile.TemporaryDirectory() as td:
            settings = Path(td) / "settings.json"
            save_user_settings(settings, {"game_path": r"D:\Games\Grand Theft Auto V"})
            loaded = load_user_settings(settings)
            self.assertEqual(loaded["game_path"], r"D:\Games\Grand Theft Auto V")

    def test_user_settings_corrupt_file_falls_back_empty(self):
        with tempfile.TemporaryDirectory() as td:
            settings = Path(td) / "settings.json"
            settings.write_text("{broken", encoding="utf-8")
            self.assertEqual(load_user_settings(settings), {})


if __name__ == "__main__":
    unittest.main(verbosity=2)