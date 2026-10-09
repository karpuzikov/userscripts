"""UPC-A / EAN-13 barcode lookup regressions (no Qt runtime required)."""
from __future__ import annotations

import ast
from pathlib import Path
import re
from types import SimpleNamespace
import unittest


SOURCE = (Path(__file__).resolve().parents[2] / "__init__.py").read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)
FUNCTIONS = {
    node.name: node for node in TREE.body
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
}
SCOPE = {"re": re, "_PENDING_BARCODE_TASKS": []}
for name in (
    "_normalize_barcode",
    "_barcode_forms",
    "_barcodes_match",
    "_exact_release_barcode",
    "_start_barcode_batch_lookup",
):
    exec(compile(ast.Module(body=[FUNCTIONS[name]], type_ignores=[]), "<picard-lookup>", "exec"), SCOPE)


class FakeSearchAPI:
    def __init__(self, responder):
        self.responder = responder
        self.calls = []
        self.pending = []
        self.moved = []
        self.status = []
        self.mb_api = SimpleNamespace(find_releases=self.find_releases)
        self.tagger = SimpleNamespace(
            window=SimpleNamespace(set_statusbar_message=lambda *a, **kw: self.status.append((a, kw)))
        )
        self.logger = SimpleNamespace(
            info=lambda *a: None,
            warning=lambda *a: None,
        )

    def find_releases(self, handler, **kwargs):
        self.calls.append(kwargs)
        self.pending.append((handler, kwargs))
        return len(self.calls)

    def drain(self):
        for _ in range(100):
            if not self.pending:
                return
            handler, kwargs = self.pending.pop(0)
            handler({"releases": self.responder(kwargs["query"])}, None, None)
        raise AssertionError("Lookup never completed")


class BarcodeLookupTests(unittest.TestCase):
    FILE_UPC = "602478746901"
    MB_EAN = "0602478746901"
    RELEASE = "7045707b-621d-408c-9e97-3fc0c652ee24"

    def setUp(self):
        SCOPE["_PENDING_BARCODE_TASKS"].clear()

    def run_search(self, responder, files=None, disc_count=""):
        api = FakeSearchAPI(responder)
        SCOPE["_move_files_to_release_by_track_number"] = (
            lambda _api, selected, release_id: api.moved.append((selected, release_id))
        )
        SCOPE["_expected_disc_count"] = lambda selected: disc_count
        selected_files = files if files is not None else [object()]
        SCOPE["_start_barcode_batch_lookup"](api, {self.FILE_UPC: selected_files})
        api.drain()
        return api

    def test_upc_a_matches_same_gtin_stored_as_ean13(self):
        self.assertTrue(SCOPE["_barcodes_match"](self.FILE_UPC, self.MB_EAN))
        self.assertTrue(SCOPE["_barcodes_match"](self.MB_EAN, self.FILE_UPC))
        self.assertFalse(SCOPE["_barcodes_match"](self.FILE_UPC, "0602478746902"))
        self.assertFalse(SCOPE["_barcodes_match"](self.FILE_UPC, "0602478746091"))

    def test_search_requests_both_upc_and_ean_in_first_pass(self):
        api = self.run_search(
            lambda query: [{"id": self.RELEASE, "barcode": self.MB_EAN}]
            if "barcode:" + self.MB_EAN in query else []
        )
        self.assertEqual(len(api.calls), 1)
        query = api.calls[0]["query"]
        self.assertIn("barcode:" + self.FILE_UPC, query)
        self.assertIn("barcode:" + self.MB_EAN, query)
        self.assertEqual(api.moved[0][1], self.RELEASE)

    def test_search_accepts_padded_response_to_unpadded_query(self):
        # MusicBrainz can return a padded GTIN in response to the UPC query.
        api = self.run_search(
            lambda query: [{"id": self.RELEASE, "barcode": self.MB_EAN}]
            if "barcode:" + self.FILE_UPC in query else []
        )
        self.assertEqual(api.moved[0][1], self.RELEASE)

    def test_nonmatching_release_is_never_linked(self):
        api = self.run_search(
            lambda query: [{"id": self.RELEASE, "barcode": "0602478746902"}]
        )
        self.assertEqual(api.moved, [])

    def test_duplicate_resolution_accepts_zero_padded_barcode(self):
        other_id = "00000000-1111-2222-3333-444444444444"
        def results(query):
            if "mediums:1" in query:
                return [{"id": self.RELEASE, "barcode": self.MB_EAN}]
            return [
                {"id": other_id, "barcode": self.FILE_UPC},
                {"id": self.RELEASE, "barcode": self.MB_EAN},
            ]
        api = self.run_search(results, disc_count="1")
        self.assertEqual(api.moved[0][1], self.RELEASE)
        filtered = [c["query"] for c in api.calls if "mediums:1" in c["query"]]
        self.assertEqual(len(filtered), 1)
        self.assertIn("barcode:" + self.MB_EAN, filtered[0])


if __name__ == "__main__":
    unittest.main()
