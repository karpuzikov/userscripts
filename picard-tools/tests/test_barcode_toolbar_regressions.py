"""Barcode / UPC button lifecycle tests. No Picard / Qt runtime required."""
from __future__ import annotations

import ast
from pathlib import Path
import unittest


SOURCE = (Path(__file__).resolve().parents[2] / "__init__.py").read_text(encoding="utf-8")
TREE = ast.parse(SOURCE)


def source_function(name):
    fn = next(node for node in TREE.body if isinstance(node, ast.FunctionDef) and node.name == name)
    return ast.unparse(fn)


namespace = {}
exec(source_function("_place_barcode_action"), namespace)
place = namespace["_place_barcode_action"]


class FakeAction:
    def __init__(self, text):
        self._text = text

    def text(self):
        return self._text


class FakeToolbar:
    def __init__(self, *actions):
        self.items = list(actions)

    def actions(self):
        return list(self.items)

    def addAction(self, action):
        self.items.append(action)

    def insertAction(self, before, action):
        self.items.insert(self.items.index(before), action)


class ToolbarLifecycleTests(unittest.TestCase):
    def test_insert_after_native_lookup(self):
        native = FakeAction("&Lookup")
        later = FakeAction("Save")
        button = FakeAction("Barcode / UPC Lookup")
        toolbar = FakeToolbar(native, later)
        self.assertTrue(place(toolbar, button))
        self.assertEqual(toolbar.actions(), [native, button, later])

    def test_repeat_is_idempotent(self):
        button = FakeAction("Barcode / UPC Lookup")
        toolbar = FakeToolbar(FakeAction("Lookup"))
        self.assertTrue(place(toolbar, button))
        self.assertFalse(place(toolbar, button))
        self.assertEqual(toolbar.actions().count(button), 1)

    def test_recreated_toolbar_restores_action(self):
        button = FakeAction("Barcode / UPC Lookup")
        first = FakeToolbar(FakeAction("Lookup"))
        self.assertTrue(place(first, button))
        fresh = FakeToolbar(FakeAction("Lookup"))
        self.assertTrue(place(fresh, button))
        self.assertEqual(fresh.actions().count(button), 1)

    def test_no_native_lookup_still_visible(self):
        button = FakeAction("Barcode / UPC Lookup")
        toolbar = FakeToolbar(FakeAction("Save"))
        self.assertTrue(place(toolbar, button))
        self.assertEqual(toolbar.actions()[-1], button)

    def test_plugin_lifecycle_hooks(self):
        enable = source_function("enable")
        disable = source_function("disable")
        self.assertIn("register_tools_menu_action(BarcodeLookupToolsAction)", enable)
        self.assertIn("_BarcodeToolbarWatcher(api)", enable)
        self.assertIn("_BARCODE_TOOLBAR_WATCHER.stop()", disable)
        self.assertIn("_LOOKUP_API = None", disable)

    def test_toolbar_monitor_and_fallback_menu_present(self):
        watcher = next(n for n in TREE.body if isinstance(n, ast.ClassDef) and n.name == "_BarcodeToolbarWatcher")
        watcher_source = ast.unparse(watcher)
        self.assertIn("QEvent.Type.ChildAdded", watcher_source)
        self.assertIn("self.check_timer.timeout.connect(self.refresh)", watcher_source)
        self.assertIn("self.window.removeEventFilter(self)", watcher_source)
        menu = next(n for n in TREE.body if isinstance(n, ast.ClassDef) and n.name == "BarcodeLookupToolsAction")
        self.assertIn("_barcode_only_lookup(self.api, objects)", ast.unparse(menu))

    def test_barcode_matcher_retained(self):
        for name in ("_barcode_forms", "_barcodes_match", "_start_barcode_batch_lookup", "_barcode_only_lookup"):
            self.assertTrue(any(isinstance(n, ast.FunctionDef) and n.name == name for n in TREE.body))


if __name__ == "__main__":
    unittest.main()
