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
    normalize_album_artist_names,
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
    def test_jay_z_producer_credit_from_relationship_mbid(self):
        """Regression: Shawn Carter producer must honor Jay-Z's artist MBID."""
        jay_z = "f82bcf78-5b69-4622-a5ef-73800768d9ac"
        producer = {
            "type": "producer",
            "target-type": "artist",
            "target-credit": "Shawn Carter",
            "artist": {
                "id": jay_z,
                "name": "JAY-Z",
                "sort-name": "JAY-Z",
                "aliases": [{"name": "Shawn Carter"}],
            },
        }
        track = {"recording": {"relations": [producer]}}
        metadata = FakeMetadata({
            "producer": ["Shawn Carter", "Another Producer"],
            "artist": "Unrelated Artist",
            "musicbrainz_artistid": [OTHER],
            "albumartist": "Unrelated Album Artist",
            "musicbrainz_albumartistid": [OTHER],
            "title": "Shawn Carter (Original Mix)",
            "album": "Shawn Carter",
            "catalognumber": "SC-123",
            "date": "2010-01-02",
        })
        rules = jay_z + " => Jay-Z"
        for _ in range(3):
            normalize_track_artist_names(FakeAPI(rules), metadata, track, {})
        self.assertEqual(metadata["producer"], ["Jay-Z", "Another Producer"])
        self.assertEqual(metadata["title"], "Shawn Carter (Original Mix)")
        self.assertEqual(metadata["album"], "Shawn Carter")
        self.assertEqual(metadata["artist"], "Unrelated Artist")
        self.assertEqual(metadata["albumartist"], "Unrelated Album Artist")
        self.assertEqual(metadata["catalognumber"], "SC-123")
        self.assertEqual(metadata["date"], "2010-01-02")

    def test_producer_must_not_be_inferred_from_other_track_mbid(self):
        jay_z = "f82bcf78-5b69-4622-a5ef-73800768d9ac"
        producer = {"type": "producer", "target-type": "artist",
                    "target-credit": "Shawn Carter",
                    "artist": {"id": jay_z, "name": "JAY-Z"}}
        release = {"artist-credit": [], "media": [{"tracks": [
            {"recording": {"relations": [producer]}}
        ]}]}
        track = {"recording": {"relations": []}}
        metadata = FakeMetadata({
            "producer": ["Shawn Carter"],
            "musicbrainz_artistid": [jay_z],
            "title": "Shawn Carter",
        })
        normalize_track_artist_names(FakeAPI(jay_z + " => Jay-Z"),
                                     metadata, track, release)
        # A related artist on a different track does not own this producer.
        self.assertEqual(metadata["producer"], ["Shawn Carter"])
        self.assertEqual(metadata["title"], "Shawn Carter")

    def test_release_producer_relationship_applies_on_release_and_track(self):
        jay_z = "f82bcf78-5b69-4622-a5ef-73800768d9ac"
        release = {"relations": [{
            "type": "producer", "target-type": "artist",
            "target-credit": "Shawn Carter",
            "artist": {"id": jay_z, "name": "JAY-Z"},
        }]}
        for track in (None, {"recording": {"relations": []}}):
            with self.subTest(track=track):
                metadata = FakeMetadata({"producer": "Shawn Carter"})
                api = FakeAPI(jay_z + " => Jay-Z")
                if track is None:
                    normalize_album_artist_names(api, metadata, release)
                else:
                    normalize_track_artist_names(api, metadata, track, release)
                self.assertEqual(metadata["producer"], ["Jay-Z"])

    def test_producer_alias_ambiguity_does_not_guess_identity(self):
        jay_z = "f82bcf78-5b69-4622-a5ef-73800768d9ac"
        different = "00000000-0000-4000-8000-000000000004"
        relations = [
            {"type": "producer", "target-type": "artist",
             "target-credit": "Shawn Carter",
             "artist": {"id": jay_z, "name": "JAY-Z"}},
            {"type": "producer", "target-type": "artist",
             "target-credit": "Shawn Carter",
             "artist": {"id": different, "name": "Another Artist"}},
        ]
        metadata = FakeMetadata({"producer": ["Shawn Carter"]})
        normalize_track_artist_names(
            FakeAPI(jay_z + " => Jay-Z"), metadata,
            {"recording": {"relations": relations}}, {})
        self.assertEqual(metadata["producer"], ["Shawn Carter"])

    def test_writer_composer_and_performer_mbid_relationships(self):
        jay_z = "f82bcf78-5b69-4622-a5ef-73800768d9ac"
        def rel(role):
            return {
                "type": role, "target-type": "artist",
                "target-credit": "Shawn Carter",
                "artist": {"id": jay_z, "name": "JAY-Z"},
            }
        track = {"recording": {"relations": [
            {"type": "performance", "target-type": "work",
             "work": {"relations": [rel("writer"), rel("composer")]}},
            rel("vocal"),
            rel("mix"),
            rel("producer"),
        ]}}
        metadata = FakeMetadata({
            "writer": ["Shawn Carter"],
            "~writersort": ["Shawn Carter"],
            "composer": ["Shawn Carter"],
            "composersort": ["Shawn Carter"],
            "performer:vocal": ["Shawn Carter"],
            "mixer": ["Shawn Carter"],
            "producer": ["Shawn Carter"],
            "title": "Shawn Carter",
        })
        normalize_track_artist_names(FakeAPI(jay_z + " => Jay-Z"),
                                     metadata, track, {})
        for tag in ("writer", "~writersort", "composer", "composersort",
                    "performer:vocal", "mixer", "producer"):
            with self.subTest(tag=tag):
                self.assertEqual(metadata[tag], ["Jay-Z"])
        self.assertEqual(metadata["title"], "Shawn Carter")

    def test_composer_id_explicit_mbid_without_relation_node(self):
        jay_z = "f82bcf78-5b69-4622-a5ef-73800768d9ac"
        node = {"artist-credit": [{
            "name": "Shawn Carter", "artist": {
                "id": jay_z, "name": "JAY-Z",
                "aliases": [{"name": "Shawn Carter"}],
            },
        }]}
        metadata = FakeMetadata({
            "composer": ["Shawn Carter"],
            "musicbrainz_composerid": [jay_z],
            "musicbrainz_artistid": [OTHER],
            "title": "Shawn Carter",
        })
        normalize_track_artist_names(FakeAPI(jay_z + " => Jay-Z"),
                                     metadata, node, {})
        self.assertEqual(metadata["composer"], ["Jay-Z"])
        self.assertEqual(metadata["title"], "Shawn Carter")

    def test_camron_alias_apostrophes_do_not_expand_inside_name(self):
        """Late Registration: Cam'ron must never become Cam'ron'ron."""
        camron = "ea6b7199-901d-4c0e-8242-6d7bc2bf62b7"
        node = {
            "artist-credit": [{
                "name": "Cam'ron",
                "artist": {
                    "id": camron,
                    "name": "Cam’ron",
                    "aliases": [
                        {"name": "Cam"},
                        {"name": "Cam'ron"},
                        {"name": "Camron"},
                        {"name": "Killa Cam"},
                    ],
                },
            }]
        }
        cases = (
            ("Cam'ron", "Cam'ron"),
            ("Cam’ron", "Cam’ron"),
            ("Cam feat. Juelz Santana", "Cam’ron feat. Juelz Santana"),
            ("Cam'ron feat. Juelz Santana", "Cam'ron feat. Juelz Santana"),
            ("Cam’s song", "Cam’s song"),
            ("Cam's song", "Cam's song"),
            ("Camera and Cam", "Camera and Cam’ron"),
        )
        for original, expected in cases:
            with self.subTest(original=original):
                metadata = FakeMetadata({
                    "artist": original,
                    "title": original,
                    "album": "Late Registration",
                    "musicbrainz_artistid": camron,
                })
                for _ in range(3):
                    normalize_track_artist_names(FakeAPI(""), metadata, node)
                self.assertEqual(metadata["artist"], [expected] if expected != original else original)
                self.assertEqual(metadata["title"], [expected] if expected != original else original)
                self.assertEqual(metadata["album"], "Late Registration")
                self.assertNotIn("ron'ron", str(metadata).lower())
                self.assertNotIn("ron’ron", str(metadata).lower())

    def test_camron_apostrophe_variant_also_works_for_standalone_plugin(self):
        import ast
        import re
        root = Path(__file__).resolve().parents[2]
        source = (root / "picard-tools" / "current-artist-names" /
                  "__init__.py").read_text(encoding="utf-8")
        module = ast.parse(source)
        function = next(
            node for node in module.body
            if isinstance(node, ast.FunctionDef) and node.name == "_make_pattern"
        )
        namespace = {"re": re}
        exec(compile(ast.Module(body=[function], type_ignores=[]),
                     "<standalone-pattern>", "exec"), namespace)
        pattern = namespace["_make_pattern"]
        self.assertIsNone(pattern("Cam").search("Cam'ron"))
        self.assertIsNone(pattern("Cam").search("Cam’ron"))
        self.assertIsNotNone(pattern("Cam").search("Cam and friends"))
        self.assertIsNotNone(pattern("Cam'ron").search("Cam'ron feat. Juelz"))
        self.assertIn("old_name.replace(\"’\", \"'\")", source)
        self.assertNotIn("for variant in {current_name.replace", source)

    def test_unicode_to_ascii_script_owns_apostrophe_conversion(self):
        """Apostrophe normalization must be opt-in and never recursive."""
        root = Path(__file__).resolve().parents[2]
        unicode_script = (root / "picard-tools" / "scripts" /
                          "Unicode_to_ASCII.txt").read_text(encoding="utf-8")
        self.assertIn("[‘’‚‛],'", unicode_script)
        try:
            from picard.metadata import Metadata
            from picard.script import ScriptParser
        except ImportError:
            self.skipTest("Picard runtime unavailable")
        data = Metadata()
        data["artist"] = "Cam’ron"
        data["albumartist"] = "Cam’ron"
        data["title"] = "Featuring Cam’ron"
        ScriptParser().eval(unicode_script, data)
        self.assertEqual(data["artist"], "Cam'ron")
        self.assertEqual(data["albumartist"], "Cam'ron")
        self.assertEqual(data["title"], "Featuring Cam'ron")

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

    def test_yeezus_god_credit_is_preserved_in_title_and_artists(self):
        unknown_mbid = "125ec42a-7229-4250-afc5-e057484327fe"
        node = {
            "artist-credit": [
                {
                    "name": "Kanye West",
                    "artist": {
                        "id": YE, "name": "Ye",
                        "aliases": [{"name": "Kanye West"}],
                    },
                },
                {
                    "name": "God",
                    "artist": {
                        "id": unknown_mbid, "name": "[unknown]",
                        "aliases": [{"name": "God"}, {"name": "-"}],
                    },
                },
            ]
        }
        fields = {
            "title": "I Am a God (ft. God)",
            "artist": "Kanye West feat. God",
            "artists": ["Kanye West", "God"],
            "date": "2013-07-10",
            "catalognumber": "UICD-6205",
        }
        metadata = FakeMetadata(fields)
        for _ in range(2):
            normalize_track_artist_names(FakeAPI(YE + " => Kanye West"), metadata, node)
        for tag, expected in fields.items():
            with self.subTest(tag=tag):
                self.assertEqual(metadata[tag], expected)

    def test_other_names_are_normalized_while_unknown_is_untouched(self):
        node = {
            "artist-credit": [
                {"name": "Ubiquitous", "artist": {
                    "id": OTHER, "name": "Ubi", "aliases": [{"name": "Ubiquitous"}]}},
                {"name": "God", "artist": {
                    "id": "125ec42a-7229-4250-afc5-e057484327fe",
                    "name": "[unknown]", "aliases": [{"name": "God"}]}},
            ]
        }
        metadata = FakeMetadata({
            "artist": "Ubiquitous & God", "artists": ["Ubiquitous", "God"],
            "title": "Ubiquitous (ft. God)",
        })
        normalize_track_artist_names(FakeAPI(""), metadata, node)
        self.assertEqual(metadata["artist"], ["Ubi & God"])
        self.assertEqual(metadata["artists"], ["Ubi", "God"])
        self.assertEqual(metadata["title"], ["Ubi (ft. God)"])

    def test_symbol_only_ye_dollar_group_mbid_override(self):
        group = "58daf317-be5f-439f-a04d-0d6727f1a3b2"
        preferred = "Kanye West & Ty Dolla $ign"
        rules = group + " => " + preferred
        node = {
            "artist-credit": [{
                "name": "¥$",
                "artist": {
                    "id": group,
                    "name": "¥$",
                    "sort-name": "¥$",
                    "aliases": [{"name": "¥$"}],
                },
            }],
            "title": "VULTURES 1",
        }
        data = FakeMetadata({
            "album": "VULTURES 1",
            "title": "¥$ Theme",
            "artist": "¥$",
            "artists": ["¥$"],
            "artistsort": "¥$",
            "albumartist": "¥$",
            "albumartists": ["¥$"],
            "albumartistsort": "¥$",
            "musicbrainz_artistid": [group],
            "musicbrainz_albumartistid": [group],
            "comment": "¥$",
            "date": "2024-02-09",
            "catalognumber": "¥$-2024",
        })
        for _ in range(2):
            normalize_album_artist_names(FakeAPI(rules), data, node)
            normalize_track_artist_names(FakeAPI(rules), data, node, node)
        for field in ("artist", "artists", "artistsort",
                      "albumartist", "albumartists", "albumartistsort"):
            with self.subTest(tag=field):
                self.assertEqual(data[field], [preferred])
        for field, expected in (
            ("album", "VULTURES 1"),
            ("title", "¥$ Theme"),
            ("comment", "¥$"),
            ("date", "2024-02-09"),
            ("catalognumber", "¥$-2024"),
        ):
            with self.subTest(tag=field):
                self.assertEqual(data[field], expected)
        self.assertEqual(data["musicbrainz_artistid"], [group])
        self.assertEqual(data["musicbrainz_albumartistid"], [group])

    def test_symbol_only_artist_override_at_credit_boundaries(self):
        group = "58daf317-be5f-439f-a04d-0d6727f1a3b2"
        node = {"artist-credit": [{
            "name": "¥$", "artist": {"id": group, "name": "¥$"},
        }]}
        rules = group + " => Kanye West & Ty Dolla $ign"
        cases = (
            ("¥$ feat. North West", "Kanye West & Ty Dolla $ign feat. North West"),
            ("¥$ & Rich the Kid", "Kanye West & Ty Dolla $ign & Rich the Kid"),
            ("Rich the Kid & ¥$", "Rich the Kid & Kanye West & Ty Dolla $ign"),
            ("¥$, North West", "Kanye West & Ty Dolla $ign, North West"),
            ("Mixed¥$Credit", "Mixed¥$Credit"),
            ("¥$-Remix", "¥$-Remix"),
            ("A $ign of ¥$money", "A $ign of ¥$money"),
        )
        for original, expected in cases:
            with self.subTest(artist=original):
                data = FakeMetadata({
                    "artist": original, "musicbrainz_artistid": [group],
                    "title": original,
                })
                normalize_track_artist_names(FakeAPI(rules), data, node)
                self.assertEqual(data.get("artist"), [expected] if expected != original else original)
                self.assertEqual(data["title"], original)

    def test_symbol_only_artist_override_must_match_artist_role_mbid(self):
        group = "58daf317-be5f-439f-a04d-0d6727f1a3b2"
        other = "00000000-0000-4000-8000-000000000003"
        node = {"artist-credit": [{
            "name": "¥$", "artist": {"id": group, "name": "¥$"},
        }]}
        data = FakeMetadata({
            "artist": "¥$",
            "albumartist": "¥$",
            "musicbrainz_artistid": [other],
            "musicbrainz_albumartistid": [group],
            "album": "¥$",
            "title": "¥$",
        })
        normalize_track_artist_names(FakeAPI(group + " => Kanye West & Ty Dolla $ign"), data, node)
        self.assertEqual(data["artist"], "¥$")
        self.assertEqual(data["albumartist"], ["Kanye West & Ty Dolla $ign"])
        self.assertEqual(data["album"], "¥$")
        self.assertEqual(data["title"], "¥$")

    def test_kids_see_ghosts_mbid_only_rewrites_artist_credits(self):
        group = "793e220b-64f8-46d9-954d-e033dbcfeef4"
        rules = group + " => Kanye West & Kid Cudi"
        node = {
            "artist-credit": [{
                "name": "KIDS SEE GHOSTS",
                "artist": {
                    "id": group,
                    "name": "KIDS SEE GHOSTS",
                    "aliases": [{"name": "Kids See Ghosts"}],
                },
            }],
            "title": "Kids See Ghosts",
        }
        data = FakeMetadata({
            "album": "Kids See Ghosts",
            "title": "Kids See Ghosts",
            "albumsort": "Kids See Ghosts",
            "artist": "KIDS SEE GHOSTS",
            "artists": ["KIDS SEE GHOSTS"],
            "albumartist": "KIDS SEE GHOSTS",
            "albumartists": ["KIDS SEE GHOSTS"],
            "musicbrainz_artistid": [group],
            "musicbrainz_albumartistid": [group],
            "comment": "Kids See Ghosts",
            "date": "2018-06-08",
        })
        for _ in range(2):
            normalize_album_artist_names(FakeAPI(rules), data, node)
            normalize_track_artist_names(FakeAPI(rules), data, node, node)
        for field in ("album", "title", "albumsort", "comment"):
            self.assertEqual(data[field], "Kids See Ghosts", field)
        for field in ("artist", "albumartist", "artists", "albumartists"):
            self.assertEqual(data[field], ["Kanye West & Kid Cudi"], field)
        self.assertEqual(data["musicbrainz_artistid"], [group])
        self.assertEqual(data["musicbrainz_albumartistid"], [group])
        self.assertEqual(data["date"], "2018-06-08")

    def test_override_requires_matching_role_mbid_in_metadata(self):
        group = "793e220b-64f8-46d9-954d-e033dbcfeef4"
        unrelated_id = "00000000-0000-4000-8000-000000000002"
        node = {
            "artist-credit": [{
                "name": "KIDS SEE GHOSTS",
                "artist": {"id": group, "name": "KIDS SEE GHOSTS"},
            }]
        }
        data = FakeMetadata({
            "artist": "KIDS SEE GHOSTS",
            "albumartist": "KIDS SEE GHOSTS",
            "artists": ["KIDS SEE GHOSTS"],
            "album": "KIDS SEE GHOSTS",
            "title": "KIDS SEE GHOSTS",
            "musicbrainz_artistid": [unrelated_id],
            "musicbrainz_albumartistid": [group],
        })
        normalize_track_artist_names(
            FakeAPI(group + " => Kanye West & Kid Cudi"), data, node, node
        )
        self.assertEqual(data["artist"], "KIDS SEE GHOSTS")
        self.assertEqual(data["artists"], ["KIDS SEE GHOSTS"])
        self.assertEqual(data["albumartist"], ["Kanye West & Kid Cudi"])
        self.assertEqual(data["album"], "KIDS SEE GHOSTS")
        self.assertEqual(data["title"], "KIDS SEE GHOSTS")

    def test_override_requires_artist_role_id_even_if_node_has_artist(self):
        group = "793e220b-64f8-46d9-954d-e033dbcfeef4"
        node = {
            "artist-credit": [{
                "name": "KIDS SEE GHOSTS",
                "artist": {"id": group, "name": "KIDS SEE GHOSTS"},
            }]
        }
        data = FakeMetadata({"artist": "KIDS SEE GHOSTS", "title": "Kids See Ghosts"})
        normalize_track_artist_names(
            FakeAPI(group + " => Kanye West & Kid Cudi"), data, node
        )
        self.assertEqual(data["artist"], "KIDS SEE GHOSTS")
        self.assertEqual(data["title"], "Kids See Ghosts")

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
        original = "Other artist => Preferred\r\n" + YE + " => Kanye West\r\n"
        self.assertEqual(_migrate_legacy_exceptions(original), original)
        with_legacy = "Other artist => Preferred\r\nYe => Kanye West\r\n"
        expected = "Other artist => Preferred\r\n" + YE + " => Kanye West\r\n"
        self.assertEqual(_migrate_legacy_exceptions(with_legacy), expected)

    def test_override_uses_matching_artist_id_not_name(self):
        metadata = FakeMetadata({
            "artist": "Ye", "albumartist": "Ye",
            "title": "Ye with Ye", "artists": ["Ye"],
            "artistsort": "West, Kanye",
            "musicbrainz_artistid": YE,
            "musicbrainz_albumartistid": YE,
        })
        normalize_track_artist_names(
            FakeAPI(YE + " => Kanye West"), metadata, artist_credit()
        )
        self.assertEqual(metadata["artist"], ["Kanye West"])
        self.assertEqual(metadata["albumartist"], ["Kanye West"])
        self.assertEqual(metadata["artists"], ["Kanye West"])
        self.assertEqual(metadata["title"], "Ye with Ye")
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
        metadata = FakeMetadata({"artist": "Kanye", "title": "Kanye", "musicbrainz_artistid": YE})
        node = artist_credit()
        node["artist-credit"][0]["artist"]["aliases"].append({"name": "Kanye"})
        normalize_track_artist_names(
            FakeAPI(YE + " => Kanye West"), metadata, node
        )
        self.assertEqual(metadata["artist"], ["Kanye West"])
        self.assertEqual(metadata["title"], "Kanye")


if __name__ == "__main__":
    unittest.main()
