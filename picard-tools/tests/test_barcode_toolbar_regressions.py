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

    def test_retire_cleared_orphan_and_preserve_current_toolbar(self):
        action = FakeAction("Barcode / UPC Lookup")
        current = FakeToolbar(action, FakeAction("Lookup"))
        current.object_name = "main_toolbar"
        orphan = FakeToolbar()  # Picard cleared the toolbar before removing it.
        orphan.object_name = "main_toolbar"
        orphan.floating = True
        other = FakeToolbar(FakeAction("Search"))
        other.object_name = "search_toolbar"

        class Window:
            toolbar = current

        scope = {
            "_BARCODE_TOOLBAR_ACTION": action,
            "_barcode_toolbars": lambda window: [orphan, current, other],
        }
        exec(source_function("_retire_replaced_barcode_toolbar"), scope)
        exec(source_function("_retire_obsolete_picard_toolbars"), scope)
        retired = scope["_retire_obsolete_picard_toolbars"](Window())
        self.assertEqual(retired, [orphan])
        self.assertTrue(orphan.hidden)
        self.assertTrue(orphan.deleted_later)
        self.assertFalse(getattr(current, "deleted_later", False))
        self.assertFalse(getattr(other, "deleted_later", False))
        self.assertIn(action, current.actions())

    def test_direct_reference_cleanup_when_toolbar_is_not_enumerable(self):
        action = FakeAction("Barcode")
        previous = FakeToolbar(action)
        current = FakeToolbar(FakeAction("Lookup"))
        scope = {"_BARCODE_TOOLBAR_ACTION": action}
        exec(source_function("_retire_replaced_barcode_toolbar"), scope)
        dispose = scope["_retire_replaced_barcode_toolbar"]
        self.assertTrue(dispose(previous, current))
        self.assertTrue(previous.deleted_later)
        self.assertTrue(previous.hidden)
        self.assertNotIn(action, previous.actions())
        self.assertFalse(dispose(current, current))
        self.assertFalse(dispose(None, current))
        self.assertFalse(getattr(current, "deleted_later", False))

    def test_barcode_toolbar_is_docked_and_cannot_float(self):
        class QtStub:
            class ToolBarArea:
                TopToolBarArea = object()

        class Toolbar(FakeToolbar):
            def setFloatable(self, setting):
                self.floatable = setting

        class Window:
            def __init__(self):
                self.docked = []

            def addToolBar(self, area, toolbar):
                self.docked.append(toolbar)
                toolbar.floating = False

        scope = {"QtCore": type("Core", (), {"Qt": QtStub})}
        exec(source_function("_dock_barcode_toolbar"), scope)
        dock = scope["_dock_barcode_toolbar"]
        window = Window()
        floating = Toolbar(FakeAction("Barcode"))
        floating.floating = True
        dock(window, floating)
        self.assertEqual(window.docked, [floating])
        self.assertFalse(floating.floatable)
        self.assertFalse(floating.isFloating())
        docked = Toolbar(FakeAction("Lookup"))
        dock(window, docked)
        self.assertEqual(window.docked, [floating])
        self.assertFalse(docked.floatable)

    def test_watcher_tracks_toolbar_instances_by_direct_reference(self):
        watcher = next(node for node in TREE.body if isinstance(node, ast.ClassDef)
                       and node.name == "_BarcodeToolbarWatcher")
        body = ast.unparse(watcher)
        self.assertIn("self.observed_toolbar = toolbar", body)
        self.assertIn("_retire_replaced_barcode_toolbar(previous, toolbar)", body)
        self.assertIn("QEvent.Type.ChildRemoved", body)
        self.assertIn("_retire_obsolete_picard_toolbars(self.window)", body)

    def test_close_does_not_reattach_while_confirmation_is_open(self):
        watcher = next(node for node in TREE.body if isinstance(node, ast.ClassDef)
                       and node.name == "_BarcodeToolbarWatcher")
        body = ast.unparse(watcher)
        self.assertIn("QEvent.Type.Close", body)
        self.assertIn("self.app.activeModalWidget() is not None", body)
        self.assertIn("if not self.window.isActiveWindow()", body)
        self.assertNotIn("QTimer.singleShot(0, self.resume_if_close_cancelled)\n        elif",
                         body)
        self.assertNotIn("self.close_toolbars = _detach_barcode_action(self.window)", body)
        self.assertNotIn("_restore_hidden_barcode_toolbars", body)
        installer = source_function("_install_barcode_lookup_button")
        self.assertIn("_dock_barcode_toolbar(window, toolbar)", installer)
        self.assertIn("watcher.observe_toolbar(toolbar)", installer)
        self.assertIn("_retire_obsolete_picard_toolbars(api.tagger.window)",
                      source_function("disable"))

    def test_resume_only_after_confirmation_is_cancelled(self):
        class FakeWindow:
            visible = True
            active = True

            def isVisible(self):
                return self.visible

            def isActiveWindow(self):
                return self.active

        class FakeApp:
            modal = None

            def activeModalWidget(self):
                return self.modal

        # Exercise the exact watcher method body without importing Qt.
        watcher = next(node for node in TREE.body if isinstance(node, ast.ClassDef)
                       and node.name == "_BarcodeToolbarWatcher")
        method = next(node for node in watcher.body if isinstance(node, ast.FunctionDef)
                      and node.name == "resume_if_close_cancelled")
        fn = ast.unparse(method)
        namespace = {"_LOOKUP_API": object()}
        exec(fn, namespace)
        fn = namespace["resume_if_close_cancelled"]

        class Timer:
            def __init__(self):
                self.starts = 0

            def start(self):
                self.starts += 1

        class FakeWatcher:
            pass

        context = FakeWatcher()
        context.api = namespace["_LOOKUP_API"]
        context.closing = True
        context.window = FakeWindow()
        context.app = FakeApp()
        context.check_timer = Timer()
        context.refresh_count = 0
        context.refresh = lambda: setattr(context, "refresh_count",
                                          context.refresh_count + 1)

        context.app.modal = object()
        fn(context)
        self.assertTrue(context.closing)
        self.assertEqual(context.check_timer.starts, 0)

        context.app.modal = None
        context.window.active = False
        fn(context)
        self.assertTrue(context.closing)

        context.window.visible = False
        context.window.active = True
        fn(context)
        self.assertTrue(context.closing)

        context.window.visible = True
        fn(context)
        self.assertFalse(context.closing)
        self.assertEqual(context.check_timer.starts, 1)
        self.assertEqual(context.refresh_count, 1)

    def test_barcode_matcher_retained(self):
        for name in ("_barcode_forms", "_barcodes_match", "_start_barcode_batch_lookup", "_barcode_only_lookup"):
            self.assertTrue(any(isinstance(n, ast.FunctionDef) and n.name == name for n in TREE.body))


if __name__ == "__main__":
    unittest.main()
