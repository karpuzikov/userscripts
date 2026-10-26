"""MBID-scoped overrides for the shared Picard Current Artist Names Everywhere plugin."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from current_artist_names import (  # noqa: E402
    _build_maps,
    _migrate_legacy_exceptions,
    _parse_exceptions,
    normalize_track_artist_names,
)


YE = "164f0d73-1234-4e2c-8743-d77bf2191051"
OTHER = "00000000-0000-4000-8000-000000000001"


class FakeMetadata(dict):
    def rawitems(self):
        for key, value in list(self.items()):
            yield key, list(value) if isinstance(value, (tuple, list)) else [value]


class FakeLogger:
    def debug(self, *args):
        pass


class FakeAPI:
    logger = FakeLogger()

    def __init__(self, rules):
        self.plugin_config = {"artist_name_exceptions": rules}


def artist_credit(mbid=YE, name="Ye (formerly Kanye West)", credited="Ye"):
    return {
        "artist-credit": [
            {
                "name": credited,
                "artist": {
                    "id": mbid,
                    "name": name,
                    "sort-name": "West, Kanye" if mbid == YE else name,
                    "aliases": [
                        {"name": "Ye"},
                        {"name": "Kanye West"} if mbid == YE else {"name": name},
                    ],
                },
            }
        ]
    }


class MBIDOverrideTests(unittest.TestCase):
    def test_unknown_artist_punctuation_alias_never_corrupts_hyphens(self):
        """Regression: Yeezus JP date/catalog became 2013[unknown]07..."""
        unknown = {
            "artist-credit": [{
                "name": "-",
                "artist": {
                    "id": "125ec42a-7229-4250-afc5-e057484327fe",
                    "name": "[unknown]",
                    "aliases": [{"name": "-"}, {"name": "—"}],
                },
            }],
        }
        fields = {
            "artist": "-",
            "date": "2013-07-10",
            "originaldate": "2013-07-10",
            "catalognumber": "UICD-6205",
            "title": "Yeezus - Bonus Track",
            "comment": "Japan - 2013-07-10",
        }
        metadata = FakeMetadata(fields)
        normalize_track_artist_names(FakeAPI(""), metadata, unknown)
        for tag, expected in fields.items():
            with self.subTest(tag=tag):
                self.assertEqual(metadata[tag], expected)

    def test_dates_and_catalog_numbers_are_never_rewritten_by_name_aliases(self):
        artist = {
            "artist-credit": [{
                "name": "Actual Artist",
                "artist": {
                    "id": OTHER,
                    "name": "Canonical Artist",
                    "aliases": [{"name": "UICD"}, {"name": "Jul"}],
                },
            }]
        }
        metadata = FakeMetadata({
            "artist": "Actual Artist",
            "title": "Actual Artist on Jul",
            "date": "Jul-10",
            "originaldate": "Jul-10",
            "release_date": "Jul-10",
            "catalognumber": "UICD-6205",
        })
        normalize_track_artist_names(FakeAPI(""), metadata, artist)
        self.assertEqual(metadata["artist"], ["Canonical Artist"])
        self.assertEqual(metadata["title"], ["Canonical Artist on Canonical Artist"])
        self.assertEqual(metadata["date"], "Jul-10")
        self.assertEqual(metadata["originaldate"], "Jul-10")
        self.assertEqual(metadata["release_date"], "Jul-10")
        self.assertEqual(metadata["catalognumber"], "UICD-6205")

    def test_word_containing_alias_can_still_change_artist_hyphen(self):
        node = {
            "artist-credit": [{
                "name": "AC-DC",
                "artist": {
                    "id": OTHER,
                    "name": "AC/DC",
                    "aliases": [{"name": "AC-DC"}],
                },
            }]
        }
        metadata = FakeMetadata({"artist": "AC-DC", "title": "AC-DC - Live"})
        normalize_track_artist_names(FakeAPI(""), metadata, node)
        self.assertEqual(metadata["artist"], ["AC/DC"])
        self.assertEqual(metadata["title"], ["AC/DC - Live"])

    def test_accepts_only_valid_artist_mbids(self):
        self.assertEqual(
            _parse_exceptions(
                "Ye => Kanye West\n"
                + YE.upper() + " => Kanye West\n"
                + "not-an-mbid => Wrong\n"
                + OTHER + " => Other\n"
            ),
            {YE: "Kanye West", OTHER: "Other"},
        )

    def test_migrates_only_known_ye_default(self):
        before = "Ye => Kanye West\nOther artist => Keep untouched\n"
        self.assertEqual(
            _migrate_legacy_exceptions(before),
            YE + " => Kanye West\nOther artist => Keep untouched\n",
        )
        self.assertEqual(_migrate_legacy_exceptions(before.replace("Ye => Kanye West", YE + " => Kanye West")), YE + " => Kanye West\nOther artist => Keep untouched\n")

    def test_migration_does_not_reformat_existing_rules(self):
        original = "Other artist => Preferred\\r\\n" + YE + " => Kanye West\\r\\n"
        self.assertEqual(_migrate_legacy_exceptions(original), original)
        with_legacy = "Other artist => Preferred\\r\\nYe => Kanye West\\r\\n"
        expected = "Other artist => Preferred\\r\\n" + YE + " => Kanye West\\r\\n"
        self.assertEqual(_migrate_legacy_exceptions(with_legacy), expected)

    def test_override_uses_matching_artist_id_not_name(self):
        metadata = FakeMetadata({
            "artist": "Ye", "albumartist": "Ye",
            "title": "Ye with Ye", "artists": ["Ye"],
            "artistsort": "West, Kanye",
            "musicbrainz_artistid": YE,
        })
        normalize_track_artist_names(
            FakeAPI(YE + " => Kanye West"), metadata, artist_credit()
        )
        self.assertEqual(metadata["artist"], ["Kanye West"])
        self.assertEqual(metadata["albumartist"], ["Kanye West"])
        self.assertEqual(metadata["artists"], ["Kanye West"])
        self.assertEqual(metadata["title"], ["Kanye West with Kanye West"])
        self.assertEqual(metadata["artistsort"], ["Kanye West"])
        self.assertEqual(metadata["musicbrainz_artistid"], YE)

    def test_wrong_artist_id_does_not_trigger_override(self):
        metadata = FakeMetadata({"artist": "Ye", "title": "Ye"})
        normalize_track_artist_names(
            FakeAPI(YE + " => Kanye West"), metadata,
            artist_credit(mbid=OTHER, name="Ye", credited="Ye")
        )
        self.assertEqual(metadata["artist"], "Ye")
        self.assertEqual(metadata["title"], "Ye")

    def test_missing_artist_id_never_triggers_override(self):
        node = artist_credit()
        node["artist-credit"][0]["artist"].pop("id")
        metadata = FakeMetadata({"artist": "Ye"})
        normalize_track_artist_names(FakeAPI(YE + " => Kanye West"), metadata, node)
        self.assertEqual(metadata["artist"], ["Ye (formerly Kanye West)"])

    def test_legacy_name_only_rule_is_ignored(self):
        metadata = FakeMetadata({"artist": "Ye"})
        normalize_track_artist_names(FakeAPI("Ye => Kanye West"), metadata, artist_credit())
        self.assertEqual(metadata["artist"], ["Ye (formerly Kanye West)"])

    def test_same_name_different_artist_is_protected(self):
        first = artist_credit(mbid=YE, name="Ye", credited="Ye")
        second = artist_credit(mbid=OTHER, name="Ye", credited="Ye")
        names, _, protected, _ = _build_maps(
            first, second, exceptions={YE: "Kanye West"}
        )
        self.assertNotIn("Ye", names)
        self.assertIn("Ye", protected)

    def test_alias_of_artist_with_matching_mbid_uses_preferred_name(self):
        metadata = FakeMetadata({"artist": "Kanye", "title": "Kanye"})
        node = artist_credit()
        node["artist-credit"][0]["artist"]["aliases"].append({"name": "Kanye"})
        normalize_track_artist_names(
            FakeAPI(YE + " => Kanye West"), metadata, node
        )
        self.assertEqual(metadata["artist"], ["Kanye West"])
        self.assertEqual(metadata["title"], ["Kanye West"])


if __name__ == "__main__":
    unittest.main()
