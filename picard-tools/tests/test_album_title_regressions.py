"""Regression checks for Picard album capitalization and embedded scripts.

Run from the repository root:
    python -m unittest discover -s picard-tools/tests -p "test_*.py"
These pure-Python tests do not replace a final interactive Picard 3 test.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path
import sys
import unittest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
from musicbrainz_title_capitalization import (  # noqa: E402
    _canonical_release_suffix,
    _language_mode,
    capitalize_release_title,
    capitalize_track_title,
    normalize_europe_release_country,
    _is_digital_release,
    musicbrainz_english_title_case,
    standardize_title_case,
    _is_digital_medium,
)


class _Logger:
    def debug(self, *args, **kwargs):
        pass


class _API:
    logger = _Logger()


class PicardAlbumRegressions(unittest.TestCase):
    def format_release(self, original, mb_title, lang):
        metadata = {"album": original, "language": lang}
        node = {"title": mb_title, "text-representation": {"language": lang}}
        capitalize_release_title(_API(), metadata, node)
        return metadata["album"]

    def test_spanish_single_has_one_canonical_suffix(self):
        self.assertEqual(
            self.format_release("La Noche - Single", "LA NOCHE", "spa"),
            "La noche - Single",
        )

    def test_spanish_title_overrides_incorrect_english_metadata(self):
        self.assertEqual(
            self.format_release("La Noche - Single", "LA NOCHE (extended mix)", "eng"),
            "La noche - Single",
        )
        self.assertEqual(
            self.format_release(
                "La Noche (Extended Mix) - Single",
                "LA NOCHE (extended mix)",
                "eng",
            ),
            "La noche (Extended Mix) - Single",
        )

    def test_english_phrasal_up(self):
        self.assertEqual(
            self.format_release("Bun Up the Dance - Single", "Bun Up the Dance", "eng"),
            "Bun Up the Dance - Single",
        )
        self.assertEqual(musicbrainz_english_title_case("Bun up the Dance"), "Bun Up the Dance")

    def test_portuguese_title_overrides_incorrect_english_metadata(self):
        self.assertEqual(
            self.format_release("Vai sentando - Single", "Vai sentando", "eng"),
            "Vai sentando - Single",
        )

    def test_suffix_case_and_repetition(self):
        for original, expected in (
            ("La noche - single", "La noche - Single"),
            ("La noche - single - Single", "La noche - Single"),
            ("La noche - SINGLE - single", "La noche - Single"),
            ("Example - ep - EP", "Example - EP"),
            ("Example - EP", "Example - EP"),
        ):
            with self.subTest(original=original):
                self.assertEqual(_canonical_release_suffix(original), expected)
                self.assertEqual(
                    _canonical_release_suffix(_canonical_release_suffix(original)),
                    expected,
                )

    def test_suffix_script_handles_bare_endings_and_versioned_parity(self):
        source = (REPO / "picard-tools" / "scripts" / "Add_EP_Single_Suffix.txt").read_text(encoding="utf-8")
        versioned = (REPO / "picard-tools" / "scripts" / "Add_EP_Single_Suffix_v1.0.2.txt").read_text(encoding="utf-8")
        self.assertEqual(source, versioned)
        for kind, n in (("ep", 3), ("single", 7)):
            with self.subTest(kind=kind):
                self.assertIn(f"$endswith($lower($trim(%album%)), - {kind})", source)
                self.assertIn(f"$endswith($lower($trim(%album%)), {kind})", source)
                self.assertIn(f"$sub($len($trim(%album%)),{n})", source)
                self.assertIn(f"$ne($lower($trim(%album%)),{kind})", source)

    def test_suffix_script_in_picard_runtime(self):
        try:
            from picard.metadata import Metadata
            from picard.script import ScriptParser
        except ImportError:
            self.skipTest("Picard runtime unavailable; run inside Picard's Python environment")
        source = (REPO / "picard-tools" / "scripts" / "Add_EP_Single_Suffix.txt").read_text(encoding="utf-8")
        examples = (
            ("ep", "Gypsyhook EP", "Gypsyhook - EP"),
            ("ep", "Gypsyhook - EP", "Gypsyhook - EP"),
            ("ep", "Gypsyhook EP - EP", "Gypsyhook - EP"),
            ("ep", "Gypsyhook - EP - EP", "Gypsyhook - EP"),
            ("ep", "Gypsyhook - ep", "Gypsyhook - EP"),
            ("ep", "EP", "EP"),
            ("single", "Song Single", "Song - Single"),
            ("single", "Song Single - Single", "Song - Single"),
            ("single", "Song - Single", "Song - Single"),
            ("single", "Single", "Single"),
            ("album", "Gypsyhook EP", "Gypsyhook EP"),
        )
        for kind, input_title, expected in examples:
            with self.subTest(kind=kind, title=input_title):
                metadata = Metadata()
                metadata["album"] = input_title
                metadata["~primaryreleasetype"] = kind
                ScriptParser().eval(source, metadata)
                self.assertEqual(metadata["album"], expected)
                ScriptParser().eval(source, metadata)
                self.assertEqual(metadata["album"], expected)

    def test_ambiguous_english_title_not_reclassified(self):
        node = {"title": "La La Land", "text-representation": {"language": "eng"}}
        self.assertEqual(_language_mode({"album": "La La Land"}, node), "english")

    def test_manual_scripts_are_identical_to_embedded_scripts(self):
        module = ast.parse((REPO / "__init__.py").read_text(encoding="utf-8"))
        values = {}
        for statement in module.body:
            if isinstance(statement, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "SCRIPTS"
                for target in statement.targets
            ):
                values = {
                    entry.elts[0].value: entry.elts[2].value
                    for entry in statement.value.elts
                }
        for key, filename in (
            ("add_ep_single_suffix", "Add_EP_Single_Suffix.txt"),
            ("english_title_capitalization", "English_Title_Capitalization.txt"),
            ("unicode_to_ascii", "Unicode_to_ASCII.txt"),
            ("move_featured_artists", "Move_Featured_Artists_to_Title.txt"),
            ("format_multiple_artists", "Format_Multiple_Artists.txt"),
        ):
            self.assertIn(key, values)
            text = (REPO / "picard-tools" / "scripts" / filename).read_text(encoding="utf-8")
            self.assertEqual(values[key], text)
        suffix = values["add_ep_single_suffix"]
        self.assertIn("$lower($trim(%album%))", suffix)
        self.assertIn("$while(", suffix)
        self.assertIn(" - Single", suffix)
        self.assertIn(" - EP", suffix)
        legacy = values["english_title_capitalization"]
        self.assertIn("$replace(%_case%, Bun up , Bun Up )", legacy)
        self.assertIn("la noche|vai sentando", legacy)





    def test_single_credited_name_does_not_match_shorter_partial_name(self):
        try:
            from picard.metadata import Metadata
            from picard.script import ScriptParser
        except ImportError:
            self.skipTest("Picard runtime unavailable; run inside Picard's Python environment")
        source = (REPO / "picard-tools" / "scripts" / "Format_Multiple_Artists.txt").read_text(encoding="utf-8")
        metadata = Metadata()
        metadata["artists"] = ["A", "AB"]
        metadata["artist"] = "AB"
        metadata["albumartists"] = ["DJ", "DJ B"]
        metadata["albumartist"] = "DJ B"
        ScriptParser().eval(source, metadata)
        self.assertEqual(metadata["artist"], "AB")
        self.assertEqual(metadata["albumartist"], "DJ B")
        ScriptParser().eval(source, metadata)
        self.assertEqual(metadata["artist"], "AB")
        self.assertEqual(metadata["albumartist"], "DJ B")

    def test_move_featured_credit_does_not_duplicate_existing_title_credit(self):
        try:
            from picard.metadata import Metadata
            from picard.script import ScriptParser
        except ImportError:
            self.skipTest("Picard runtime unavailable; run inside Picard's Python environment")
        source = (REPO / "picard-tools" / "scripts" / "Move_Featured_Artists_to_Title.txt").read_text(encoding="utf-8")
        for initial_title, expected_title in (
            ("Song", "Song (ft. Guest)"),
            ("Song (ft. Guest)", "Song (ft. Guest)"),
            ("Song (feat. Guest)", "Song (feat. Guest)"),
        ):
            with self.subTest(title=initial_title):
                metadata = Metadata()
                metadata["artist"] = "Main feat. Guest"
                metadata["albumartist"] = "Main"
                metadata["title"] = initial_title
                ScriptParser().eval(source, metadata)
                self.assertEqual(metadata["title"], expected_title)
                self.assertEqual(metadata["artist"], "Main")
                ScriptParser().eval(source, metadata)
                self.assertEqual(metadata["title"], expected_title)

    def test_artist_format_runs_before_unicode_normalization(self):
        module = ast.parse((REPO / "__init__.py").read_text(encoding="utf-8"))
        order = []
        for statement in module.body:
            if isinstance(statement, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "SCRIPTS"
                for target in statement.targets
            ):
                order = [entry.elts[0].value for entry in statement.value.elts]
        self.assertLess(order.index("move_featured_artists"), order.index("format_multiple_artists"))
        self.assertLess(order.index("format_multiple_artists"), order.index("unicode_to_ascii"))
        self.assertLess(order.index("unicode_to_ascii"), order.index("add_ep_single_suffix"))

    def test_digital_release_deletes_country_without_changing_physical(self):
        for medium, expected in (
            ("Digital Media", None),
            ("digital media", None),
            ("2×Digital Media", None),
            ("2x Digital Media", None),
            ("CD", "EU"),
            ("Vinyl", "EU"),
            ("CD + Digital Media", "EU"),
            ("(unknown)", "EU"),
            ("", "EU"),
        ):
            with self.subTest(medium=medium):
                metadata = {"media": medium, "releasecountry": "XE",
                            "album": "Sample", "title": "Sample", "language": "eng"}
                node = {"title": "Sample", "text-representation": {"language": "eng"}}
                capitalize_release_title(_API(), metadata, node)
                capitalize_track_title(_API(), metadata, {}, node)
                self.assertEqual(metadata.get("releasecountry"), expected)

    def test_release_node_uses_all_medium_formats(self):
        sample = {"media": "Digital Media", "releasecountry": "US"}
        both_digital = {"media": [{"format": "Digital Media"},
                                  {"format": "Digital Media"}]}
        mixed = {"media": [{"format": "Digital Media"},
                           {"format": "CD"}]}
        missing = {"media": [{"format": "Digital Media"}, {}]}
        self.assertTrue(_is_digital_release(sample, both_digital))
        self.assertFalse(_is_digital_release(sample, mixed))
        self.assertFalse(_is_digital_release(sample, missing))
        normalize_europe_release_country(sample, mixed)
        self.assertEqual(sample["releasecountry"], "US")
        normalize_europe_release_country(sample, both_digital)
        self.assertNotIn("releasecountry", sample)

    def test_digital_file_country_is_marked_for_deletion(self):
        class TrackedMetadata(dict):
            def __init__(self, values):
                super().__init__(values)
                self.deleted_tags = []

            def delete(self, name):
                self.deleted_tags.append(name)
                self.pop(name, None)

        metadata = TrackedMetadata({"media": "Digital Media", "releasecountry": "XE"})
        normalize_europe_release_country(metadata)
        self.assertEqual(metadata.deleted_tags, ["releasecountry"])
        self.assertNotIn("releasecountry", metadata)
        # Picard must still mark old file tags for deletion when the value was
        # previously removed from metadata by another tagging step.
        normalize_europe_release_country(metadata)
        self.assertEqual(metadata.deleted_tags, ["releasecountry", "releasecountry"])

    def test_digital_release_clears_country_in_picard_runtime(self):
        try:
            from picard.metadata import Metadata
            from picard.script import ScriptParser
        except ImportError:
            self.skipTest("Picard runtime unavailable; run inside Picard's Python environment")
        source = (REPO / "picard-tools" / "scripts" /
                  "English_Title_Capitalization.txt").read_text(encoding="utf-8")
        for media, expected in (("Digital Media", ""), ("2×Digital Media", ""),
                                ("CD", "EU"), ("Vinyl", "EU")):
            with self.subTest(media=media):
                metadata = Metadata()
                metadata["media"] = media
                metadata["releasecountry"] = "XE"
                metadata["album"] = "Sample"
                metadata["title"] = "Sample"
                metadata["language"] = "eng"
                ScriptParser().eval(source, metadata)
                self.assertEqual(metadata.get("releasecountry", ""), expected)
                ScriptParser().eval(source, metadata)
                self.assertEqual(metadata.get("releasecountry", ""), expected)

    def test_vs_dot_remains_lowercase_for_all_language_modes(self):
        for mode in ("english", "french", "sentence", "unknown"):
            for title in (
                "Gypsyhook Vs. Dmndays",
                "Gypsyhook VS. Dmndays",
                "Gypsyhook vs. Dmndays",
                "Vs. Opponent",
                "Song (Artist VS. Other)",
            ):
                with self.subTest(mode=mode, title=title):
                    expected = standardize_title_case(title, mode)
                    self.assertIn("vs.", expected)
                    self.assertNotIn("Vs.", expected)
                    self.assertNotIn("VS.", expected)
                    self.assertEqual(standardize_title_case(expected, mode), expected)
        self.assertEqual(
            musicbrainz_english_title_case("Gypsyhook Vs. Dmndays"),
            "Gypsyhook vs. Dmndays",
        )
        self.assertEqual(standardize_title_case("Vs. Opponent", "english"),
                         "vs. Opponent")
        self.assertEqual(standardize_title_case("Vsauce vs. Opponent", "english"),
                         "Vsauce vs. Opponent")

    def test_vs_dot_never_changes_unrelated_abbreviations(self):
        for title in ("V.S. the World", "Versus the World", "Gypsyhook vs Dmndays"):
            with self.subTest(title=title):
                changed = standardize_title_case(title, "unknown")
                self.assertEqual(changed, title)

    def test_vs_standalone_script_contains_last_pass(self):
        source = (REPO / "picard-tools" / "scripts" /
                  "English_Title_Capitalization.txt").read_text(encoding="utf-8")
        normalize = r"$set(_case,$rreplace(%_case%,\\b[Vv][Ss]\\.,vs.))"
        self.assertIn(normalize, source)
        self.assertLess(source.index(normalize), source.index("$set(%_loop_value%,%_case%)"))
        self.assertIn("$delete(releasecountry)", source)

    def test_vs_standalone_picard_script_runtime(self):
        try:
            from picard.metadata import Metadata
            from picard.script import ScriptParser
        except ImportError:
            self.skipTest("Picard runtime unavailable; run inside Picard's Python environment")
        source = (REPO / "picard-tools" / "scripts" /
                  "English_Title_Capitalization.txt").read_text(encoding="utf-8")
        for title in ("Gypsyhook Vs. Dmndays",
                      "Gypsyhook VS. Dmndays",
                      "Gypsyhook vs. Dmndays"):
            with self.subTest(title=title):
                data = Metadata()
                data["album"] = title
                data["title"] = title
                data["language"] = "eng"
                data["media"] = "CD"
                data["releasecountry"] = "XE"
                ScriptParser().eval(source, data)
                self.assertEqual(data["album"], "Gypsyhook vs. Dmndays")
                self.assertEqual(data["title"], "Gypsyhook vs. Dmndays")
                self.assertEqual(data["releasecountry"], "EU")
                ScriptParser().eval(source, data)
                self.assertEqual(data["title"], "Gypsyhook vs. Dmndays")

    def test_digital_media_count_prefix_regex(self):
        for raw in ("Digital Media", "digital media",
                    "2x Digital Media", "2×Digital Media",
                    "3 x Digital Media", " 2x Digital Media "):
            with self.subTest(raw=raw):
                self.assertTrue(_is_digital_medium(raw))
        for raw in ("CD", "2x Vinyl", "Digital Media + CD", "", "Digital"):
            with self.subTest(raw=raw):
                self.assertFalse(_is_digital_medium(raw))

    def test_region_code_europe_display_preference(self):
        # Only exact XE in releasecountry becomes EU; do not modify other tags.
        for source, wanted in (("XE", "EU"), ("EU", "EU"),
                               ("US", "US"), ("XW", "XW")):
            with self.subTest(country=source):
                metadata = {"releasecountry": source, "album": "Test", "title": "Test"}
                release = {"title": "Test", "text-representation": {"language": "eng"}}
                capitalize_release_title(_API(), metadata, release)
                capitalize_track_title(_API(), metadata, {}, release)
                self.assertEqual(metadata["releasecountry"], wanted)
        metadata = {"releasecountry": ["XE", "US", "EU"]}
        normalize_europe_release_country(metadata)
        self.assertEqual(metadata["releasecountry"], ["EU", "US", "EU"])
        normalize_europe_release_country(metadata)
        self.assertEqual(metadata["releasecountry"], ["EU", "US", "EU"])

    def test_english_capitalization_region_code_script(self):
        source = (REPO / "picard-tools" / "scripts" /
                  "English_Title_Capitalization.txt").read_text(encoding="utf-8")
        self.assertIn("$eq(%releasecountry%,XE),$set(releasecountry,EU)", source)
        self.assertIn("$is_multi(%releasecountry%)", source)
        self.assertIn("$delete(releasecountry)", source)
        self.assertIn("$rsearch($lower(%media%),", source)

    def test_region_code_in_picard_scripting_runtime(self):
        try:
            from picard.metadata import Metadata
            from picard.script import ScriptParser
        except ImportError:
            self.skipTest("Picard runtime unavailable; run inside Picard's Python environment")
        source = (REPO / "picard-tools" / "scripts" /
                  "English_Title_Capitalization.txt").read_text(encoding="utf-8")
        metadata = Metadata()
        metadata["releasecountry"] = "XE"
        metadata["album"] = "Test"
        metadata["title"] = "Test"
        metadata["language"] = "eng"
        ScriptParser().eval(source, metadata)
        self.assertEqual(metadata["releasecountry"], "EU")
        ScriptParser().eval(source, metadata)
        self.assertEqual(metadata["releasecountry"], "EU")

    def test_published_script_versions_match_stable_sources(self):
        for stable, versioned in (
            ("Unicode_to_ASCII.txt", "Unicode_to_ASCII_v1.0.1.txt"),
            ("English_Title_Capitalization.txt", "English_Title_Capitalization_v1.1.6.txt"),
            ("Add_EP_Single_Suffix.txt", "Add_EP_Single_Suffix_v1.0.2.txt"),
            ("Format_Multiple_Artists.txt", "Format_Multiple_Artists_v1.0.2.txt"),
            ("Move_Featured_Artists_to_Title.txt", "Move_Featured_Artists_to_Title_v1.0.1.txt"),
        ):
            with self.subTest(stable=stable):
                folder = REPO / "picard-tools" / "scripts"
                self.assertEqual((folder / stable).read_bytes(), (folder / versioned).read_bytes())

    def test_manual_script_function_arity(self):
        # Scan Picard's escaped commas and nested function arguments; catches
        # the former invalid "$replace(text,search,replace,...)" idiom.
        script_files = (
            "Unicode_to_ASCII.txt",
            "English_Title_Capitalization.txt",
            "Move_Featured_Artists_to_Title.txt",
            "Format_Multiple_Artists.txt",
            "Add_EP_Single_Suffix.txt",
        )
        arity = {
            "replace": {3}, "rreplace": {3}, "rsearch": {2, 3},
            "map": {2, 3}, "foreach": {2, 3},
            "set": {2}, "setmulti": {2, 3}, "if": {2, 3},
        }
        for filename in script_files:
            source = (REPO / "picard-tools" / "scripts" / filename).read_text(encoding="utf-8")
            for match in re.finditer(r"\$([a-z_]+)\(", source):
                name = match.group(1)
                if name not in arity:
                    continue
                index, nesting, args = match.end(), 1, 1
                while index < len(source) and nesting:
                    char = source[index]
                    if char == "\\":
                        index += 2
                        continue
                    if char == "(":
                        nesting += 1
                    elif char == ")":
                        nesting -= 1
                    elif char == "," and nesting == 1:
                        args += 1
                    index += 1
                with self.subTest(file=filename, name=name, offset=match.start()):
                    self.assertEqual(nesting, 0)
                    self.assertIn(args, arity[name])

    def test_unicode_ascii_hyphen_rule_and_non_destructive_scope(self):
        source = (REPO / "picard-tools" / "scripts" / "Unicode_to_ASCII.txt").read_text(encoding="utf-8")
        self.assertIn("[‐‑‒–—―−],-", source)
        self.assertIn("$is_multi(%composer%)", source)
        self.assertIn("$map(%composer%", source)
        self.assertIn("$if(%artist%", source)
        self.assertNotIn("$replace(%_loop_value%,‐,-,‑", source)

    def test_unicode_ascii_picard_runtime(self):
        try:
            from picard.metadata import Metadata
            from picard.script import ScriptParser
        except ImportError:
            self.skipTest("Picard runtime unavailable; run inside Picard's Python environment")
        source = (REPO / "picard-tools" / "scripts" / "Unicode_to_ASCII.txt").read_text(encoding="utf-8")
        cases = (
            ("artist", "Skrillex, Diplo, G‐DRAGON & CL", "Skrillex, Diplo, G-DRAGON & CL"),
            ("artist", "Skrillex, Diplo, G-DRAGON & CL", "Skrillex, Diplo, G-DRAGON & CL"),
            ("title", "“Bun Up” — G‑DRAGON", '"Bun Up" - G-DRAGON'),
            ("title", "Beyoncé; Café", "Beyoncé; Café"),
            ("title", "One Two", "One Two"),
        )
        for tag, before, after in cases:
            with self.subTest(tag=tag, input=before):
                metadata = Metadata()
                metadata[tag] = before
                ScriptParser().eval(source, metadata)
                self.assertEqual(metadata[tag], after)
                ScriptParser().eval(source, metadata)
                self.assertEqual(metadata[tag], after)



if __name__ == "__main__":
    unittest.main()
