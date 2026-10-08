"""Regression checks for Picard album capitalization and embedded scripts.

Run from the repository root:
    python -m unittest discover -s picard-tools/tests -p "test_*.py"
These pure-Python tests do not replace a final interactive Picard 3 test.
"""
from __future__ import annotations

import ast
from pathlib import Path
import sys
import unittest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
from musicbrainz_title_capitalization import (  # noqa: E402
    _canonical_release_suffix,
    _language_mode,
    capitalize_release_title,
    musicbrainz_english_title_case,
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
        self.assertIn("Bun up , Bun Up", legacy)
        self.assertIn("la noche|vai sentando", legacy)


if __name__ == "__main__":
    unittest.main()
