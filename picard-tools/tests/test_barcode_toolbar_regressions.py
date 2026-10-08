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

    def removeAction(self, action):
        self.items.remove(action)

    def isFloating(self):
        return getattr(self, 'floating', False)

    def isVisible(self):
        return getattr(self, 'visible', True)

    def hide(self):
        self.visible = False
        self.hidden = True

    def show(self):
        self.visible = True
        self.restored = True

    def objectName(self):
        return getattr(self, "object_name", "")

    def deleteLater(self):
        self.deleted_later = True


class ToolbarLifecycleTests(unittest.TestCase):
    def test_first_action_avoids_right_edge_overflow(self):
        native = FakeAction("&Lookup")
        earlier = FakeAction("Save")
        later = FakeAction("Cluster")
        button = FakeAction("Barcode / UPC Lookup")
        toolbar = FakeToolbar(earlier, native, later)
        self.assertTrue(place(toolbar, button))
        self.assertEqual(toolbar.actions(), [button, earlier, native, later])

    def test_promotes_existing_later_action(self):
        native = FakeAction("Lookup")
        button = FakeAction("Barcode / UPC Lookup")
        toolbar = FakeToolbar(native, button, FakeAction("Save"))
        self.assertTrue(place(toolbar, button))
        self.assertEqual(toolbar.actions()[0], button)
        self.assertEqual(toolbar.actions().count(button), 1)
        self.assertFalse(place(toolbar, button))

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
        self.assertEqual(fresh.actions()[0], button)

    def test_no_native_lookup_still_visible(self):
        button = FakeAction("Barcode / UPC Lookup")
        toolbar = FakeToolbar(FakeAction("Save"))
        self.assertTrue(place(toolbar, button))
        self.assertEqual(toolbar.actions()[0], button)

    def test_empty_toolbar(self):
        button = FakeAction("Barcode / UPC Lookup")
        toolbar = FakeToolbar()
        self.assertTrue(place(toolbar, button))
        self.assertEqual(toolbar.actions(), [button])

    def test_short_label_and_tools_fallback(self):
        installer = source_function("_install_barcode_lookup_button")
        self.assertIn("setIconText('Barcode')", installer)
        self.assertIn("setToolTip(", installer)
        self.assertIn("BarcodeLookupToolsAction", SOURCE)

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

    def test_orphaned_cleared_toolbar_is_disposed_even_without_barcode_action(self):
        action = FakeAction("Barcode / UPC Lookup")
        active = FakeToolbar(action, FakeAction("Lookup"))
        active.object_name = "main_toolbar"
        old = FakeToolbar()  # Picard's create_action_toolbar() called clear().
        old.object_name = "main_toolbar"
        old.floating = True
        orphan_with_action = FakeToolbar(action)
        orphan_with_action.object_name = "main_toolbar"
        other = FakeToolbar(FakeAction("Search"))
        other.object_name = "search_toolbar"
        floating_user_toolbar = FakeToolbar(FakeAction("Other"))
        floating_user_toolbar.object_name = "other_plugin_toolbar"
        floating_user_toolbar.floating = True

        class Window:
            toolbar = active

        scope = {
            "_barcode_toolbars": lambda window: [
                old, active, orphan_with_action, other, floating_user_toolbar
            ],
            "_BARCODE_TOOLBAR_ACTION": action,
        }
        exec(source_function("_retire_obsolete_picard_toolbars"), scope)
        retired = scope["_retire_obsolete_picard_toolbars"](Window())
        self.assertEqual(retired, [old, orphan_with_action])
        for bar in retired:
            self.assertTrue(bar.hidden)
            self.assertTrue(bar.deleted_later)
        self.assertNotIn(action, orphan_with_action.actions())
        self.assertIn(action, active.actions())
        for bar in (active, other, floating_user_toolbar):
            self.assertFalse(getattr(bar, "deleted_later", False))
            self.assertTrue(bar.isVisible())

    def test_toolbar_replacement_retires_previous_active_toolbar(self):
        action = FakeAction("Barcode")
        former = FakeToolbar(action)
        former.object_name = "main_toolbar"
        current = FakeToolbar(FakeAction("Lookup"))
        current.object_name = "main_toolbar"

        class Window:
            toolbar = former

        window = Window()
        scope = {
            "_barcode_toolbars": lambda window: [former, current],
            "_BARCODE_TOOLBAR_ACTION": action,
        }
        exec(source_function("_retire_obsolete_picard_toolbars"), scope)
        self.assertEqual(scope["_retire_obsolete_picard_toolbars"](window), [current])
        self.assertFalse(getattr(former, "deleted_later", False))

        # Simulate Picard replacing window.toolbar and clearing the former one.
        current.deleted_later = False
        current.visible = True
        window.toolbar = current
        former.items.clear()
        self.assertEqual(scope["_retire_obsolete_picard_toolbars"](window), [former])
        self.assertTrue(former.deleted_later)
        self.assertFalse(current.deleted_later)

    def test_retirement_runs_during_close_rebuild_disable_and_quit(self):
        watcher = next(node for node in TREE.body
                       if isinstance(node, ast.ClassDef) and node.name == "_BarcodeToolbarWatcher")
        text = ast.unparse(watcher)
        self.assertIn("_retire_obsolete_picard_toolbars(self.window)", text)
        self.assertIn("QEvent.Type.ChildRemoved", text)
        self.assertIn("def refresh(self)", text)
        self.assertIn("def on_quit(self)", text)
        self.assertIn("QEvent.Type.Close", text)
        self.assertIn("_retire_obsolete_picard_toolbars(api.tagger.window)",
                      source_function("disable"))

    def test_shutdown_detaches_all_old_and_floating_barcode_actions(self):
        action = FakeAction("Barcode / UPC Lookup")
        current = FakeToolbar(FakeAction("Lookup"), action)
        older = FakeToolbar(action)
        older.floating = True
        unrelated = FakeToolbar(FakeAction("Other plugin"))
        helpers = {
            "_BARCODE_TOOLBAR_ACTION": action,
            "_barcode_toolbars": lambda window: [current, older, unrelated],
        }
        exec(source_function("_detach_barcode_action"), helpers)
        exec(source_function("_hide_floating_barcode_toolbars"), helpers)
        exec(source_function("_restore_hidden_barcode_toolbars"), helpers)
        affected = helpers["_detach_barcode_action"](object())
        self.assertEqual(affected, [current, older])
        self.assertNotIn(action, current.actions())
        self.assertNotIn(action, older.actions())
        self.assertEqual(unrelated.actions()[0].text(), "Other plugin")
        hidden = helpers["_hide_floating_barcode_toolbars"](affected)
        self.assertEqual(hidden, [older])
        self.assertTrue(older.hidden)
        self.assertFalse(getattr(current, "hidden", False))
        helpers["_restore_hidden_barcode_toolbars"](hidden)
        self.assertTrue(older.isVisible())
        self.assertTrue(older.restored)
        self.assertFalse(getattr(current, "restored", False))

    def test_close_event_never_reinstalls_toolbar_during_exit(self):
        watcher = next(node for node in TREE.body
                       if isinstance(node, ast.ClassDef) and node.name == "_BarcodeToolbarWatcher")
        body = ast.unparse(watcher)
        self.assertIn("QEvent.Type.Close", body)
        self.assertIn("QEvent.Type.Hide", body)
        self.assertIn("self.app.aboutToQuit.connect(self.on_quit)", body)
        self.assertIn("_detach_barcode_action(self.window)", body)
        self.assertIn("if self.closing or _LOOKUP_API is not self.api:", body)
        self.assertIn("resume_if_close_cancelled", body)
        self.assertIn("self.window.isVisible()", body)
        self.assertIn("_restore_hidden_barcode_toolbars(self.hidden_toolbars)", body)
        installer = source_function("_install_barcode_lookup_button")
        self.assertIn("_BARCODE_TOOLBAR_WATCHER.closing", installer)
        self.assertIn("_detach_barcode_action(api.tagger.window)", source_function("disable"))

    def test_barcode_matcher_retained(self):
        for name in ("_barcode_forms", "_barcodes_match", "_start_barcode_batch_lookup", "_barcode_only_lookup"):
            self.assertTrue(any(isinstance(n, ast.FunctionDef) and n.name == name for n in TREE.body))


if __name__ == "__main__":
    unittest.main()
