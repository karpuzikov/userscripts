# SPDX-License-Identifier: MIT
"""Karpuzikov Picard Scripts - Picard 3.0 Git-updatable script collection."""

import re

from PyQt6 import QtCore, QtGui, QtWidgets

from picard.plugin3.api import BaseAction, OptionsPage, ScriptParser

from .current_artist_names import (
    normalize_album_artist_names,
    normalize_track_artist_names,
)
from .musicbrainz_title_capitalization import (
    capitalize_release_title,
    capitalize_track_title,
)


PLUGIN_PRIORITY = -10000

_BARCODE_TOOLBAR_ACTION = None
_BARCODE_TOOLBAR_WATCHER = None
_LOOKUP_API = None
_PENDING_BARCODE_TASKS = []


def _normalize_barcode(value):
    if value is None:
        return ""
    barcode = re.sub(r"[\s-]+", "", str(value).strip())
    if not barcode.isdigit():
        return ""
    if not 8 <= len(barcode) <= 14:
        return ""
    return barcode


def _barcode_forms(value):
    barcode = _normalize_barcode(value)
    if not barcode:
        return set()

    forms = {barcode}
    trimmed = barcode.lstrip("0")

    if trimmed:
        removed = len(barcode) - len(trimmed)
        if 0 < removed <= 3:
            forms.add(trimmed)

        for zeros in range(1, 4):
            candidate = ("0" * zeros) + trimmed
            if 8 <= len(candidate) <= 14:
                forms.add(candidate)

    return forms


def _barcodes_match(left, right):
    left_forms = _barcode_forms(left)
    right_forms = _barcode_forms(right)
    return bool(left_forms and right_forms and left_forms.intersection(right_forms))


def _metadata_tag_values(metadata, wanted_tag):
    if metadata is None:
        return []

    wanted_tag = wanted_tag.lower()
    values = []

    try:
        items = list(metadata.rawitems())
    except Exception:
        try:
            items = [(tag, metadata.getall(tag)) for tag in list(metadata)]
        except Exception:
            return values

    for tag, raw_values in items:
        tag_name = str(tag).lower().lstrip("~")
        if tag_name != wanted_tag:
            continue

        if isinstance(raw_values, (list, tuple)):
            values.extend(raw_values)
        else:
            values.append(raw_values)

    return values


def _barcode_from_file(file_obj):
    # Only use the file's own tags as the barcode source.
    metadata_sources = (
        getattr(file_obj, "orig_metadata", None),
        getattr(file_obj, "metadata", None),
    )

    for wanted_tag in ("barcode", "upc"):
        for metadata in metadata_sources:
            for value in _metadata_tag_values(metadata, wanted_tag):
                barcode = _normalize_barcode(value)
                if barcode:
                    return barcode

    return ""


def _files_for_object(obj):
    if hasattr(obj, "filename") and hasattr(obj, "metadata"):
        return [obj]

    iterator = getattr(obj, "iterfiles", None)
    if callable(iterator):
        try:
            return list(iterator())
        except Exception:
            pass

    files = getattr(obj, "files", None)
    if files is not None:
        try:
            return list(files)
        except Exception:
            pass

    return []


def _common_barcode(files):
    barcodes = {_barcode_from_file(file_obj) for file_obj in files}
    barcodes.discard("")
    if len(barcodes) == 1:
        return next(iter(barcodes))
    return ""


def _normalize_track_position(value):
    if value is None:
        return ""
    value = str(value).strip()
    if not value:
        return ""
    if "/" in value:
        value = value.split("/", 1)[0].strip()
    if value.isdigit():
        return str(int(value))
    return value.casefold()


def _file_track_position(file_obj):
    metadata_sources = (
        getattr(file_obj, "orig_metadata", None),
        getattr(file_obj, "metadata", None),
    )

    def first_value(tag):
        for metadata in metadata_sources:
            for value in _metadata_tag_values(metadata, tag):
                normalized = _normalize_track_position(value)
                if normalized:
                    return normalized
        return ""

    return first_value("discnumber"), first_value("tracknumber")


def _expected_disc_count(files):
    counts = set()

    for file_obj in files:
        metadata_sources = (
            getattr(file_obj, "orig_metadata", None),
            getattr(file_obj, "metadata", None),
        )

        found = ""
        for metadata in metadata_sources:
            for value in _metadata_tag_values(metadata, "totaldiscs"):
                normalized = _normalize_track_position(value)
                if normalized and normalized.isdigit() and int(normalized) > 0:
                    found = normalized
                    break
            if found:
                break

        if found:
            counts.add(found)

    if len(counts) == 1:
        return next(iter(counts))
    return ""


def _move_files_to_release_by_track_number(api, files, release_id):
    album = api.tagger.load_album(release_id)

    def place_files():
        exact = {}
        by_tracknumber = {}

        for track in album.tracks:
            discnumber = _normalize_track_position(track.metadata["discnumber"]) or "1"
            tracknumber = _normalize_track_position(track.metadata["tracknumber"])
            if not tracknumber:
                continue
            exact.setdefault((discnumber, tracknumber), []).append(track)
            by_tracknumber.setdefault(tracknumber, []).append(track)

        for file_obj in files:
            discnumber, tracknumber = _file_track_position(file_obj)
            if not tracknumber:
                api.logger.info(
                    "Barcode lookup resolved release %s, but file has no track number: %s",
                    release_id,
                    getattr(file_obj, "filename", ""),
                )
                continue

            candidates = []
            if discnumber:
                candidates = exact.get((discnumber, tracknumber), [])
            if not candidates:
                candidates = by_tracknumber.get(tracknumber, [])

            if len(candidates) == 1:
                file_obj.move(candidates[0])
                api.logger.info(
                    "Barcode lookup matched %s -> release %s, disc %s, track %s",
                    getattr(file_obj, "filename", ""),
                    release_id,
                    discnumber or candidates[0].metadata["discnumber"],
                    tracknumber,
                )
            elif not candidates:
                api.logger.info(
                    "Barcode lookup resolved release %s, but track %s was not found for %s",
                    release_id,
                    tracknumber,
                    getattr(file_obj, "filename", ""),
                )
            else:
                api.logger.info(
                    "Barcode lookup resolved release %s, but track %s is ambiguous without a disc number for %s",
                    release_id,
                    tracknumber,
                    getattr(file_obj, "filename", ""),
                )

        album.update()

    album.run_when_loaded(place_files)


def _exact_release_barcode(release):
    if not isinstance(release, dict):
        return ""
    return _normalize_barcode(release.get("barcode"))


def _barcode_lookup_finished(api, files, barcode, document, http, error):
    if error:
        api.logger.warning("Barcode lookup failed for %s", barcode)
        api.tagger.window.set_statusbar_message(
            "Barcode %(barcode)s lookup failed",
            {"barcode": barcode},
            translate=None,
            timeout=5000,
        )
        return

    try:
        releases = list((document or {}).get("releases") or [])
    except Exception:
        releases = []

    # Never trust the search result alone. Verify the actual barcode field on
    # every candidate before Picard is allowed to link anything.
    exact_matches = [
        release
        for release in releases
        if _barcodes_match(barcode, _exact_release_barcode(release))
    ]

    if not exact_matches:
        api.logger.info("No exact MusicBrainz barcode match for %s", barcode)
        api.tagger.window.set_statusbar_message(
            "No exact MusicBrainz release found for barcode %(barcode)s",
            {"barcode": barcode},
            translate=None,
            timeout=5000,
        )
        return

    if len(exact_matches) > 1:
        api.logger.info(
            "Barcode %s has %d exact MusicBrainz release matches; nothing linked",
            barcode,
            len(exact_matches),
        )
        api.tagger.window.set_statusbar_message(
            "Barcode %(barcode)s has multiple exact matches - nothing linked",
            {"barcode": barcode},
            translate=None,
            timeout=5000,
        )
        return

    release_id = exact_matches[0].get("id")
    if not release_id:
        api.logger.warning("Exact barcode match for %s has no release ID", barcode)
        return

    api.logger.info("Barcode %s exactly matched MusicBrainz release %s", barcode, release_id)
    api.tagger.window.set_statusbar_message(
        "Barcode %(barcode)s exactly matched a MusicBrainz release",
        {"barcode": barcode},
        translate=None,
    )
    api.tagger.move_files_to_album(files, release_id)


def _start_barcode_batch_lookup(api, file_groups):
    file_groups = {
        barcode: files
        for barcode, files in file_groups.items()
        if barcode and files
    }
    if not file_groups:
        return

    barcodes = list(file_groups)
    api.tagger.window.set_statusbar_message(
        "Looking up %(count)d unique barcodes...",
        {"count": len(barcodes)},
        translate=None,
    )

    state = {
        "matches": {barcode: {} for barcode in barcodes},
        "disc_matches": {barcode: {} for barcode in barcodes},
        "pending": 0,
        "errors": 0,
    }

    def add_release(target, barcode, release):
        release_id = release.get("id")
        if release_id:
            target[barcode][release_id] = release

    def finish():
        matched = 0
        missing = 0
        duplicates = 0

        for barcode, files in file_groups.items():
            releases = list(state["matches"][barcode].values())
            if not releases:
                missing += 1
                api.logger.info("No exact MusicBrainz barcode match for %s", barcode)
                continue

            chosen = None

            if len(releases) > 1:
                duplicates += 1
                disc_releases = list(state["disc_matches"][barcode].values())
                if disc_releases:
                    # Disc-count filtering resolved the barcode enough to pick
                    # from matching releases. If more than one remains, use the
                    # first MusicBrainz result as requested.
                    chosen = disc_releases[0]
                else:
                    # No usable disc-count distinction: use the first result.
                    chosen = releases[0]
            else:
                chosen = releases[0]

            _move_files_to_release_by_track_number(api, files, chosen["id"])
            matched += 1

        api.tagger.window.set_statusbar_message(
            "Barcode lookup: %(matched)d matched, %(missing)d not found, %(duplicates)d duplicate barcodes resolved",
            {
                "matched": matched,
                "missing": missing,
                "duplicates": duplicates,
            },
            translate=None,
            timeout=7000,
        )

    def request_queries(query_items, form_targets, target_store, done):
        chunks = [
            query_items[index:index + 50]
            for index in range(0, len(query_items), 50)
        ]
        if not chunks:
            done()
            return

        state["pending"] = len(chunks)
        candidate_barcodes = {
            original
            for originals in form_targets.values()
            for original in originals
        }

        for chunk in chunks:
            holder = {}
            query = " OR ".join(chunk)

            def handler(document, http, error, chunk=chunk, holder=holder):
                task = holder.get("task")
                if task in _PENDING_BARCODE_TASKS:
                    _PENDING_BARCODE_TASKS.remove(task)

                if error:
                    state["errors"] += 1
                else:
                    try:
                        releases = list((document or {}).get("releases") or [])
                    except Exception:
                        releases = []

                    for release in releases:
                        release_barcode = _exact_release_barcode(release)
                        if not release_barcode:
                            continue
                        # MusicBrainz may return GTIN-13 with a leading zero
                        # for a search made with its 12-digit UPC-A form.
                        # Compare barcode *equivalence*, not identical strings.
                        for original_barcode in candidate_barcodes:
                            if _barcodes_match(original_barcode, release_barcode):
                                add_release(target_store, original_barcode, release)

                state["pending"] -= 1
                if state["pending"] == 0:
                    done()

            task = api.mb_api.find_releases(
                handler,
                search=True,
                advanced_search=True,
                query=query,
                limit=100,
            )
            holder["task"] = task
            _PENDING_BARCODE_TASKS.append(task)

    def resolve_duplicates():
        duplicate_queries = []
        duplicate_targets = {}

        for barcode, releases_by_id in state["matches"].items():
            if len(releases_by_id) <= 1:
                continue

            disc_count = _expected_disc_count(file_groups[barcode])
            if not disc_count:
                continue

            for form in _barcode_forms(barcode):
                duplicate_queries.append(
                    "(barcode:%s AND mediums:%s)" % (form, disc_count)
                )
                duplicate_targets.setdefault(form, set()).add(barcode)

        request_queries(
            duplicate_queries,
            duplicate_targets,
            state["disc_matches"],
            finish,
        )

    # Search UPC-A / EAN-13 equivalents in the first pass, rather than
    # requiring a failed first request before trying a padded code.
    form_targets = {}
    for barcode in barcodes:
        for form in _barcode_forms(barcode):
            form_targets.setdefault(form, set()).add(barcode)

    queries = ["barcode:%s" % form for form in sorted(form_targets)]
    request_queries(queries, form_targets, state["matches"], resolve_duplicates)


def _start_barcode_lookup(api, files, barcode):
    _start_barcode_batch_lookup(api, {barcode: files})


def _expand_lookup_objects(objects):
    expanded = []
    for obj in objects:
        if isinstance(obj, list) and not hasattr(obj, "filename"):
            expanded.extend(list(obj))
        else:
            expanded.append(obj)
    return expanded


def _barcode_only_lookup(api, objects):
    objects = _expand_lookup_objects(list(objects))

    files = []
    seen = set()

    for obj in objects:
        if hasattr(obj, "filename") and hasattr(obj, "metadata"):
            candidates = [obj]
        else:
            candidates = _files_for_object(obj)

        for file_obj in candidates:
            marker = id(file_obj)
            if marker in seen:
                continue
            seen.add(marker)
            files.append(file_obj)

    file_groups = {}
    for file_obj in files:
        barcode = _barcode_from_file(file_obj)
        if barcode:
            file_groups.setdefault(barcode, []).append(file_obj)

    if not file_groups:
        api.tagger.window.set_statusbar_message(
            "No usable Barcode / UPC tag found in the selection",
            translate=None,
            timeout=5000,
        )
        return

    _start_barcode_batch_lookup(api, file_groups)

def _run_barcode_lookup_button(api):
    objects = list(api.tagger.window.selected_objects)
    if not objects:
        api.tagger.window.set_statusbar_message(
            "Select files or clusters to look up by Barcode / UPC",
            translate=None,
            timeout=3000,
        )
        return
    _barcode_only_lookup(api, objects)


def _make_barcode_icon(widget):
    pixmap = QtGui.QPixmap(22, 22)
    pixmap.fill(QtCore.Qt.GlobalColor.transparent)

    painter = QtGui.QPainter(pixmap)
    color = widget.palette().color(QtGui.QPalette.ColorRole.WindowText)
    painter.setPen(QtCore.Qt.PenStyle.NoPen)
    painter.setBrush(color)

    bars = (
        (3, 2), (6, 1), (8, 2), (12, 1), (14, 2), (18, 1),
    )
    for x, width in bars:
        painter.drawRect(x, 4, width, 14)

    painter.end()
    return QtGui.QIcon(pixmap)


class BarcodeLookupToolsAction(BaseAction):
    """Persistent Picard 3 Tools menu fallback for the toolbar shortcut."""

    TITLE = "Barcode / UPC Lookup"

    def callback(self, objects):
        _barcode_only_lookup(self.api, objects)


def _barcode_toolbars(window):
    """Find current, replaced and floating Picard toolbars."""
    candidates = []
    if window is not None:
        try:
            candidates.append(getattr(window, "toolbar", None))
            candidates.extend(window.findChildren(QtWidgets.QToolBar))
        except RuntimeError:
            pass
    app = QtWidgets.QApplication.instance()
    if app is not None:
        candidates.extend(app.topLevelWidgets())
    seen = set()
    for toolbar in candidates:
        if isinstance(toolbar, QtWidgets.QToolBar) and id(toolbar) not in seen:
            seen.add(id(toolbar))
            yield toolbar


def _detach_barcode_action(window):
    """Remove Barcode from every native toolbar, including obsolete floaters."""
    action = _BARCODE_TOOLBAR_ACTION
    if action is None:
        return []
    affected = []
    for toolbar in _barcode_toolbars(window):
        try:
            if action in toolbar.actions():
                toolbar.removeAction(action)
                affected.append(toolbar)
        except RuntimeError:
            continue
    return affected


def _retire_replaced_barcode_toolbar(toolbar, current):
    """Dispose the previously observed Actions toolbar by direct reference.

    Qt can remove or clear a toolbar before it appears in a widget enumeration;
    objectName and QAction-based searches are not sufficient.
    """
    if toolbar is None or toolbar is current:
        return False
    try:
        if (
            _BARCODE_TOOLBAR_ACTION is not None
            and _BARCODE_TOOLBAR_ACTION in toolbar.actions()
        ):
            toolbar.removeAction(_BARCODE_TOOLBAR_ACTION)
        toolbar.hide()
        toolbar.deleteLater()
        return True
    except RuntimeError:
        return False


def _retire_obsolete_picard_toolbars(window):
    """Dispose detached Actions toolbars, including those already cleared."""
    current = getattr(window, "toolbar", None) if window is not None else None
    removed = []
    for toolbar in _barcode_toolbars(window):
        try:
            if toolbar is current or toolbar.objectName() != "main_toolbar":
                continue
            if _retire_replaced_barcode_toolbar(toolbar, current):
                removed.append(toolbar)
        except RuntimeError:
            continue
    return removed


def _dock_barcode_toolbar(window, toolbar):
    """Keep Barcode in Picard's owned, docked Actions toolbar."""
    # An independent QToolBar counts as a Qt top-level window and can prevent
    # QApplication from exiting when the Picard main window is closed.
    if toolbar.isFloating():
        window.addToolBar(QtCore.Qt.ToolBarArea.TopToolBarArea, toolbar)
    toolbar.setFloatable(False)


def _place_barcode_action(toolbar, action):
    """Keep Barcode Lookup first, before actions that may overflow at narrow widths."""
    actions = toolbar.actions()
    if actions and actions[0] == action:
        return False
    if action in actions:
        # Promote any action previously inserted after native Lookup.
        toolbar.removeAction(action)
        actions = toolbar.actions()
    if actions:
        toolbar.insertAction(actions[0], action)
    else:
        toolbar.addAction(action)
    return True


def _install_barcode_lookup_button(api):
    """Keep the shortcut on the CURRENT Picard toolbar after it is rebuilt."""
    global _BARCODE_TOOLBAR_ACTION, _LOOKUP_API

    if _LOOKUP_API is not api:
        return False
    if _BARCODE_TOOLBAR_WATCHER is not None and _BARCODE_TOOLBAR_WATCHER.closing:
        return False
    window = getattr(api.tagger, "window", None)
    toolbar = getattr(window, "toolbar", None) if window is not None else None
    if toolbar is None:
        return False

    try:
        _dock_barcode_toolbar(window, toolbar)
        watcher = _BARCODE_TOOLBAR_WATCHER
        if watcher is not None:
            watcher.observe_toolbar(toolbar)
    except RuntimeError:
        # Picard can rebuild the toolbar between the event and this callback.
        return False

    if _BARCODE_TOOLBAR_ACTION is None:
        action = QtGui.QAction(
            _make_barcode_icon(window),
            "Barcode / UPC Lookup",
            window,
        )
        action.setObjectName("karpuzikov_barcode_upc_lookup")
        action.setIconText("Barcode")
        action.setToolTip("Match by exact Barcode/UPC, then disc count and track number")
        action.setStatusTip("Match by exact Barcode/UPC, then disc count and track number")
        action.triggered.connect(lambda _checked=False: _run_barcode_lookup_button(api))
        _BARCODE_TOOLBAR_ACTION = action

    inserted = _place_barcode_action(toolbar, _BARCODE_TOOLBAR_ACTION)
    if inserted:
        api.logger.info("Barcode / UPC Lookup restored on Picard Actions toolbar")
    return True


class _BarcodeToolbarWatcher(QtCore.QObject):
    """Keep Barcode docked; dispose replaced toolbars before they become floaters."""

    def __init__(self, api):
        window = api.tagger.window
        super().__init__(window)
        self.api = api
        self.window = window
        self.pending = False
        self.closing = False
        self.observed_toolbar = None
        self.window.installEventFilter(self)
        self.app = QtWidgets.QApplication.instance()
        if self.app is not None:
            self.app.aboutToQuit.connect(self.on_quit)

        self.check_timer = QtCore.QTimer(self)
        self.check_timer.setInterval(4000)
        self.check_timer.timeout.connect(self.refresh)
        self.check_timer.start()
        self.schedule()

    def observe_toolbar(self, toolbar):
        previous = self.observed_toolbar
        if previous is toolbar:
            return
        self.observed_toolbar = toolbar
        _retire_replaced_barcode_toolbar(previous, toolbar)

    def eventFilter(self, watched, event):
        if watched is not self.window:
            return False
        event_type = event.type()
        if event_type == QtCore.QEvent.Type.Close:
            self.closing = True
            self.check_timer.stop()
            _retire_obsolete_picard_toolbars(self.window)
            # IMPORTANT: do NOT detach the active toolbar or queue a
            # zero-delay restoration here. Picard's closeEvent may open a
            # modal confirmation; zero-delay callbacks run in its nested event
            # loop BEFORE the Close event is accepted.
            QtCore.QTimer.singleShot(250, self.resume_if_close_cancelled)
        elif event_type == QtCore.QEvent.Type.WindowActivate and self.closing:
            # Returning from a cancelled confirmation should reactivate Picard.
            QtCore.QTimer.singleShot(0, self.resume_if_close_cancelled)
        elif not self.closing and event_type in (
            QtCore.QEvent.Type.ChildAdded,
            QtCore.QEvent.Type.ChildRemoved,
            QtCore.QEvent.Type.WindowActivate,
        ):
            self.schedule()
        return False

    def resume_if_close_cancelled(self):
        if _LOOKUP_API is not self.api or not self.closing:
            return
        try:
            if not self.window.isVisible():
                return
            # Do not restore anything while Picard's quit confirmation (or
            # any other nested modal dialog) is still running.
            if self.app is not None and self.app.activeModalWidget() is not None:
                return
            if not self.window.isActiveWindow():
                return
        except RuntimeError:
            return
        self.closing = False
        self.check_timer.start()
        self.refresh()

    def on_quit(self):
        self.closing = True
        self.check_timer.stop()
        _retire_obsolete_picard_toolbars(self.window)
        # The active non-floating toolbar remains owned by Picard's window;
        # Qt destroys it along with the window.

    def schedule(self):
        if not self.closing and not self.pending:
            self.pending = True
            QtCore.QTimer.singleShot(0, self.refresh)

    def refresh(self):
        self.pending = False
        if self.closing or _LOOKUP_API is not self.api:
            return
        try:
            _retire_obsolete_picard_toolbars(self.window)
            _install_barcode_lookup_button(self.api)
        except (AttributeError, RuntimeError) as exc:
            self.api.logger.warning("Barcode Lookup toolbar temporarily unavailable: %s", exc)

    def stop(self):
        self.closing = True
        self.check_timer.stop()
        self.observed_toolbar = None
        if self.app is not None:
            try:
                self.app.aboutToQuit.disconnect(self.on_quit)
            except (TypeError, RuntimeError):
                pass
        try:
            self.window.removeEventFilter(self)
        except RuntimeError:
            pass


def disable():
    global _BARCODE_TOOLBAR_ACTION, _BARCODE_TOOLBAR_WATCHER, _LOOKUP_API

    api = _LOOKUP_API
    _LOOKUP_API = None  # Block queued reattachment callbacks after disable.

    if _BARCODE_TOOLBAR_WATCHER is not None:
        try:
            _BARCODE_TOOLBAR_WATCHER.stop()
            _BARCODE_TOOLBAR_WATCHER.deleteLater()
        except RuntimeError:
            pass
        _BARCODE_TOOLBAR_WATCHER = None

    if api is not None:
        # Plugin disable must also clean up cleared orphan toolbars.
        try:
            _retire_obsolete_picard_toolbars(api.tagger.window)
        except RuntimeError:
            pass
        for task in list(_PENDING_BARCODE_TASKS):
            try:
                api.tagger.webservice.abort_task(task)
            except Exception:
                pass
        _PENDING_BARCODE_TASKS.clear()

        if _BARCODE_TOOLBAR_ACTION is not None:
            try:
                _detach_barcode_action(api.tagger.window)
                _BARCODE_TOOLBAR_ACTION.deleteLater()
            except RuntimeError:
                pass

    _BARCODE_TOOLBAR_ACTION = None


FEATURES = (
    ("current_artist_names", "Current Artist Names Everywhere"),
    ("musicbrainz_title_capitalization", "MusicBrainz Title Capitalization"),
)


SCRIPTS = (
    ("move_featured_artists", "Move Featured Artists to Title", "$set(_feat_title,$rsearch(%artist%,\\\\s+\\\\\\(?\\(f\\(ea\\)?t\\\\.[^\\)]*\\)))\n$set(_feat_title,$rreplace(%_feat_title%,^f\\(ea\\)?t\\\\.,ft.))\n$set(artist,$rreplace(%artist%,\\\\s+\\\\\\(?f\\(ea\\)?t\\\\.[^\\)]*\\\\\\)?,))\n$set(albumartist,$rreplace(%albumartist%,\\\\s+\\\\\\(?f\\(ea\\)?t\\\\.[^\\)]*\\\\\\)?,))\n$if($and(%_feat_title%,$not($in($replace($lower(%title%),feat.,ft.),$lower(%_feat_title%)))),$set(title,%title% \\(%_feat_title%\\)))\n$unset(_feat_title)"),
    ("format_multiple_artists", "Format Multiple Artists", "$setmulti(_mainartists,%artists%)\n$foreach(%artists%,$if($not($if($inmulti(%artists%,%artist%),$eq(%artist%,%_loop_value%),$in(%artist%,%_loop_value%))),$setmulti(_mainartists,$replacemulti(%_mainartists%,%_loop_value%,))))\n$set(_artistcount,$lenmulti(%_mainartists%))\n$if($eq(%_artistcount%,1),$set(artist,$getmulti(%_mainartists%,0)),$if($eq(%_artistcount%,2),$set(artist,$join(%_mainartists%, & )),$if($gt(%_artistcount%,2),$set(artist,$join($slice(%_mainartists%,0,-1),\\, ) & $getmulti(%_mainartists%,-1)))))\n$unset(_mainartists)\n$unset(_artistcount)\n\n$if($gt($lenmulti(%albumartists%),0),\n$setmulti(_mainalbumartists,%albumartists%)\n$foreach(%albumartists%,$if($not($if($inmulti(%albumartists%,%albumartist%),$eq(%albumartist%,%_loop_value%),$in(%albumartist%,%_loop_value%))),$setmulti(_mainalbumartists,$replacemulti(%_mainalbumartists%,%_loop_value%,))))\n$set(_albumartistcount,$lenmulti(%_mainalbumartists%))\n$if($eq(%_albumartistcount%,1),$set(albumartist,$getmulti(%_mainalbumartists%,0)),$if($eq(%_albumartistcount%,2),$set(albumartist,$join(%_mainalbumartists%, & )),$if($gt(%_albumartistcount%,2),$set(albumartist,$join($slice(%_mainalbumartists%,0,-1),\\, ) & $getmulti(%_mainalbumartists%,-1)))))\n$unset(_mainalbumartists)\n$unset(_albumartistcount)\n)\n"),
    ("unicode_to_ascii", "Unicode to ASCII", "$if(%title%,$if($is_multi(%title%),$setmulti(title,$map(%title%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(title,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%title%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%album%,$if($is_multi(%album%),$setmulti(album,$map(%album%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(album,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%album%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%artist%,$if($is_multi(%artist%),$setmulti(artist,$map(%artist%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(artist,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%artist%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%albumartist%,$if($is_multi(%albumartist%),$setmulti(albumartist,$map(%albumartist%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(albumartist,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%albumartist%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%artistsort%,$if($is_multi(%artistsort%),$setmulti(artistsort,$map(%artistsort%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(artistsort,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%artistsort%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%albumartistsort%,$if($is_multi(%albumartistsort%),$setmulti(albumartistsort,$map(%albumartistsort%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(albumartistsort,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%albumartistsort%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%discsubtitle%,$if($is_multi(%discsubtitle%),$setmulti(discsubtitle,$map(%discsubtitle%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(discsubtitle,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%discsubtitle%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%work%,$if($is_multi(%work%),$setmulti(work,$map(%work%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(work,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%work%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%composer%,$if($is_multi(%composer%),$setmulti(composer,$map(%composer%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(composer,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%composer%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%composersort%,$if($is_multi(%composersort%),$setmulti(composersort,$map(%composersort%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(composersort,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%composersort%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%lyricist%,$if($is_multi(%lyricist%),$setmulti(lyricist,$map(%lyricist%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(lyricist,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%lyricist%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%conductor%,$if($is_multi(%conductor%),$setmulti(conductor,$map(%conductor%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(conductor,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%conductor%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%arranger%,$if($is_multi(%arranger%),$setmulti(arranger,$map(%arranger%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(arranger,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%arranger%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%remixer%,$if($is_multi(%remixer%),$setmulti(remixer,$map(%remixer%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(remixer,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%remixer%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%producer%,$if($is_multi(%producer%),$setmulti(producer,$map(%producer%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(producer,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%producer%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%mixer%,$if($is_multi(%mixer%),$setmulti(mixer,$map(%mixer%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(mixer,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%mixer%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%djmixer%,$if($is_multi(%djmixer%),$setmulti(djmixer,$map(%djmixer%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(djmixer,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%djmixer%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%engineer%,$if($is_multi(%engineer%),$setmulti(engineer,$map(%engineer%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(engineer,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%engineer%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%director%,$if($is_multi(%director%),$setmulti(director,$map(%director%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(director,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%director%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%grouping%,$if($is_multi(%grouping%),$setmulti(grouping,$map(%grouping%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(grouping,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%grouping%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n$if(%comment%,$if($is_multi(%comment%),$setmulti(comment,$map(%comment%,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%_loop_value%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))),$set(comment,$replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($replace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace($rreplace(%comment%,[‘’‚‛],'),[“”„‟],\"),[‐‑‒–—―−],-),[·‧．],.),[×＆],&),[÷⁄／],/),[   ], ),…,...),•,*),＋,+),＝,=),（,\\(),）,\\)),［,[),］,]),｛,{),｝,}),：,:),；,;),！,!),？,?),，,\\,),＼,\\\\),｜,|),＜,<),＞,>),＿,_),©,\\(c\\)),®,\\(R\\)),™,TM),№,No.))))\n"),
    ("add_ep_single_suffix", "Add EP/Single Suffix", "$if($eq($lower(%_primaryreleasetype%),ep),\n$while($or($endswith($lower($trim(%album%)), - ep),$endswith($lower($trim(%album%)), ep)),\n$if($endswith($lower($trim(%album%)), - ep),\n$set(album,$left($trim(%album%),$sub($len($trim(%album%)),5))),\n$set(album,$left($trim(%album%),$sub($len($trim(%album%)),3)))))\n$if($and($trim(%album%),$ne($lower($trim(%album%)),ep)),$set(album,$trim(%album%) - EP)))\n$if($eq($lower(%_primaryreleasetype%),single),\n$while($or($endswith($lower($trim(%album%)), - single),$endswith($lower($trim(%album%)), single)),\n$if($endswith($lower($trim(%album%)), - single),\n$set(album,$left($trim(%album%),$sub($len($trim(%album%)),9))),\n$set(album,$left($trim(%album%),$sub($len($trim(%album%)),7)))))\n$if($and($trim(%album%),$ne($lower($trim(%album%)),single)),$set(album,$trim(%album%) - Single)))\n"),
    ("english_title_capitalization", "English Title Capitalization", "$if($and(\n$or($not(%language%),$eq($lower(%language%),eng),$eq($lower(%language%),en),$eq($lower(%language%),english),$and($or($eq($lower(%language%),und),$eq($lower(%language%),mul)),$rsearch($lower(%album%),^the[ ]+))),\n$not($rsearch($lower(%album%),la noche|vai sentando))\n),\n$foreach(title; album,\n$set(_case_core,$rreplace($trim($get(%_loop_value%)), - [Ss][Ii][Nn][Gg][Ll][Ee]$| - [Ee][Pp]$,))\n$if($eq(%_case_core%,$upper(%_case_core%)),$set(_case,$title($lower($get(%_loop_value%)))),$set(_case,$title($get(%_loop_value%))))\n$set(_case,$replace(%_case%, A , a ))\n$set(_case,$replace(%_case%, An , an ))\n$set(_case,$replace(%_case%, The , the ))\n$set(_case,$replace(%_case%, And , and ))\n$set(_case,$replace(%_case%, But , but ))\n$set(_case,$replace(%_case%, Or , or ))\n$set(_case,$replace(%_case%, Nor , nor ))\n$set(_case,$replace(%_case%, For , for ))\n$set(_case,$replace(%_case%, Yet , yet ))\n$set(_case,$replace(%_case%, So , so ))\n$set(_case,$replace(%_case%, As , as ))\n$set(_case,$replace(%_case%, At , at ))\n$set(_case,$replace(%_case%, By , by ))\n$set(_case,$replace(%_case%, In , in ))\n$set(_case,$replace(%_case%, Of , of ))\n$set(_case,$replace(%_case%, On , on ))\n$set(_case,$replace(%_case%, To , to ))\n$set(_case,$replace(%_case%, From , from ))\n$set(_case,$replace(%_case%, Versus , versus ))\n$set(_case,$replace(%_case%, Vs. , vs. ))\n$set(_case,$replace(%_case%, V. , v. ))\n$set(_case,$replace(%_case%, Etc. , etc. ))\n$if($rsearch(%_case%,\\sas\\s.*\\sas\\s),$set(_case,$replace(%_case%, as , As )))\n$set(_case,$replace(%_case%, as I , As I ))\n$set(_case,$replace(%_case%, as You , As You ))\n$set(_case,$replace(%_case%, as He , As He ))\n$set(_case,$replace(%_case%, as She , As She ))\n$set(_case,$replace(%_case%, as We , As We ))\n$set(_case,$replace(%_case%, as They , As They ))\n$set(_case,$replace(%_case%, as It , As It ))\n$set(_case,$replace(%_case%, as This , As This ))\n$set(_case,$replace(%_case%, as That , As That ))\n$set(_case,$replace(%_case%, as These , As These ))\n$set(_case,$replace(%_case%, as Those , As Those ))\n$set(_case,$replace(%_case%, Am but , Am But ))\n$set(_case,$replace(%_case%, Are but , Are But ))\n$set(_case,$replace(%_case%, Is but , Is But ))\n$set(_case,$replace(%_case%, Was but , Was But ))\n$set(_case,$replace(%_case%, Were but , Were But ))\n$set(_case,$replace(%_case%, Be but , Be But ))\n$set(_case,$replace(%_case%, Been but , Been But ))\n$set(_case,$replace(%_case%, Ain't but , Ain't But ))\n$set(_case,$replace(%_case%, Am so , Am So ))\n$set(_case,$replace(%_case%, Are so , Are So ))\n$set(_case,$replace(%_case%, Is so , Is So ))\n$set(_case,$replace(%_case%, Was so , Was So ))\n$set(_case,$replace(%_case%, Were so , Were So ))\n$set(_case,$replace(%_case%, Be so , Be So ))\n$set(_case,$replace(%_case%, Been so , Been So ))\n$set(_case,$replace(%_case%, Feel so , Feel So ))\n$set(_case,$replace(%_case%, Feels so , Feels So ))\n$set(_case,$replace(%_case%, Felt so , Felt So ))\n$set(_case,$replace(%_case%, Look so , Look So ))\n$set(_case,$replace(%_case%, Looks so , Looks So ))\n$set(_case,$replace(%_case%, Seem so , Seem So ))\n$set(_case,$replace(%_case%, Seems so , Seems So ))\n$set(_case,$replace(%_case%, Bun up , Bun Up ))\n$set(_case,$replace(%_case%, Break in , Break In ))\n$set(_case,$replace(%_case%, Check in , Check In ))\n$set(_case,$replace(%_case%, Come in , Come In ))\n$set(_case,$replace(%_case%, Drop in , Drop In ))\n$set(_case,$replace(%_case%, Fill in , Fill In ))\n$set(_case,$replace(%_case%, Get in , Get In ))\n$set(_case,$replace(%_case%, Give in , Give In ))\n$set(_case,$replace(%_case%, Join in , Join In ))\n$set(_case,$replace(%_case%, Let in , Let In ))\n$set(_case,$replace(%_case%, Move in , Move In ))\n$set(_case,$replace(%_case%, Tune in , Tune In ))\n$set(_case,$replace(%_case%, Turn in , Turn In ))\n$set(_case,$replace(%_case%, Walk in , Walk In ))\n$set(_case,$replace(%_case%, Bring on , Bring On ))\n$set(_case,$replace(%_case%, Carry on , Carry On ))\n$set(_case,$replace(%_case%, Come on , Come On ))\n$set(_case,$replace(%_case%, Get on , Get On ))\n$set(_case,$replace(%_case%, Go on , Go On ))\n$set(_case,$replace(%_case%, Hold on , Hold On ))\n$set(_case,$replace(%_case%, Keep on , Keep On ))\n$set(_case,$replace(%_case%, Move on , Move On ))\n$set(_case,$replace(%_case%, Pass on , Pass On ))\n$set(_case,$replace(%_case%, Put on , Put On ))\n$set(_case,$replace(%_case%, Take on , Take On ))\n$set(_case,$replace(%_case%, Turn on , Turn On ))\n$set(_case,$replace(%_case%, Try on , Try On ))\n$set(_case,$replace(%_case%, Come by , Come By ))\n$set(_case,$replace(%_case%, Drop by , Drop By ))\n$set(_case,$replace(%_case%, Get by , Get By ))\n$set(_case,$replace(%_case%, Go by , Go By ))\n$set(_case,$replace(%_case%, Pass by , Pass By ))\n$set(_case,$replace(%_case%, Stand by , Stand By ))\n$set(_case,$replace(%_case%, Stop by , Stop By ))\n$set(_case,$replace(%_case%, Swing by , Swing By ))\n$set(_case,$replace(%_case%, Walk by , Walk By ))\n$set(_case,$replace(%_case%, O' , o' ))\n$set(_case,$replace(%_case%, 'N' , 'n' ))\n$set(_case,$replace(%_case%,: a ,: A ))\n$set(_case,$replace(%_case%,: an ,: An ))\n$set(_case,$replace(%_case%,: the ,: The ))\n$set(_case,$replace(%_case%,: and ,: And ))\n$set(_case,$replace(%_case%,: but ,: But ))\n$set(_case,$replace(%_case%,: or ,: Or ))\n$set(_case,$replace(%_case%,: nor ,: Nor ))\n$set(_case,$replace(%_case%,: for ,: For ))\n$set(_case,$replace(%_case%,: yet ,: Yet ))\n$set(_case,$replace(%_case%,: so ,: So ))\n$set(_case,$replace(%_case%,: as ,: As ))\n$set(_case,$replace(%_case%,: at ,: At ))\n$set(_case,$replace(%_case%,: by ,: By ))\n$set(_case,$replace(%_case%,: in ,: In ))\n$set(_case,$replace(%_case%,: of ,: Of ))\n$set(_case,$replace(%_case%,: on ,: On ))\n$set(_case,$replace(%_case%,: to ,: To ))\n$set(_case,$replace(%_case%,: from ,: From ))\n$set(_case,$replace(%_case%,: versus ,: Versus ))\n$set(_case,$replace(%_case%,: vs. ,: Vs. ))\n$set(_case,$replace(%_case%,: v. ,: V. ))\n$set(_case,$replace(%_case%,: etc. ,: Etc. ))\n$set(_case,$replace(%_case%,! a ,! A ))\n$set(_case,$replace(%_case%,! an ,! An ))\n$set(_case,$replace(%_case%,! the ,! The ))\n$set(_case,$replace(%_case%,! and ,! And ))\n$set(_case,$replace(%_case%,! but ,! But ))\n$set(_case,$replace(%_case%,! or ,! Or ))\n$set(_case,$replace(%_case%,! nor ,! Nor ))\n$set(_case,$replace(%_case%,! for ,! For ))\n$set(_case,$replace(%_case%,! yet ,! Yet ))\n$set(_case,$replace(%_case%,! so ,! So ))\n$set(_case,$replace(%_case%,! as ,! As ))\n$set(_case,$replace(%_case%,! at ,! At ))\n$set(_case,$replace(%_case%,! by ,! By ))\n$set(_case,$replace(%_case%,! in ,! In ))\n$set(_case,$replace(%_case%,! of ,! Of ))\n$set(_case,$replace(%_case%,! on ,! On ))\n$set(_case,$replace(%_case%,! to ,! To ))\n$set(_case,$replace(%_case%,! from ,! From ))\n$set(_case,$replace(%_case%,? a ,? A ))\n$set(_case,$replace(%_case%,? an ,? An ))\n$set(_case,$replace(%_case%,? the ,? The ))\n$set(_case,$replace(%_case%,? and ,? And ))\n$set(_case,$replace(%_case%,? but ,? But ))\n$set(_case,$replace(%_case%,? or ,? Or ))\n$set(_case,$replace(%_case%,? nor ,? Nor ))\n$set(_case,$replace(%_case%,? for ,? For ))\n$set(_case,$replace(%_case%,? yet ,? Yet ))\n$set(_case,$replace(%_case%,? so ,? So ))\n$set(_case,$replace(%_case%,? as ,? As ))\n$set(_case,$replace(%_case%,? at ,? At ))\n$set(_case,$replace(%_case%,? by ,? By ))\n$set(_case,$replace(%_case%,? in ,? In ))\n$set(_case,$replace(%_case%,? of ,? Of ))\n$set(_case,$replace(%_case%,? on ,? On ))\n$set(_case,$replace(%_case%,? to ,? To ))\n$set(_case,$replace(%_case%,? from ,? From ))\n$set(_case,$replace(%_case%, - a , - A ))\n$set(_case,$replace(%_case%, - an , - An ))\n$set(_case,$replace(%_case%, - the , - The ))\n$set(_case,$replace(%_case%, - and , - And ))\n$set(_case,$replace(%_case%, - but , - But ))\n$set(_case,$replace(%_case%, - or , - Or ))\n$set(_case,$replace(%_case%, - nor , - Nor ))\n$set(_case,$replace(%_case%, - for , - For ))\n$set(_case,$replace(%_case%, - yet , - Yet ))\n$set(_case,$replace(%_case%, - so , - So ))\n$set(_case,$replace(%_case%, - as , - As ))\n$set(_case,$replace(%_case%, - at , - At ))\n$set(_case,$replace(%_case%, - by , - By ))\n$set(_case,$replace(%_case%, - in , - In ))\n$set(_case,$replace(%_case%, - of , - Of ))\n$set(_case,$replace(%_case%, - on , - On ))\n$set(_case,$replace(%_case%, - to , - To ))\n$set(_case,$replace(%_case%, - from , - From ))\n$if($eq(%_case_core%,$upper(%_case_core%)),\n$set(_case,$rreplace(%_case%,\\\\b[Dd][Jj]\\\\b,DJ))\n$set(_case,$rreplace(%_case%,\\\\b[Vv][Ii][Pp]\\\\b,VIP))\n$set(_case,$rreplace(%_case%,\\\\b[Ee][Dd][Mm]\\\\b,EDM))\n$set(_case,$rreplace(%_case%,\\\\b[Bb][Bb][Cc]\\\\b,BBC))\n$set(_case,$rreplace(%_case%,\\\\b[Uu][Kk]\\\\b,UK))\n$set(_case,$rreplace(%_case%,\\\\b[Uu][Ss][Aa]\\\\b,USA))\n$set(_case,$rreplace(%_case%,\\\\b[Ee][Pp]\\\\b,EP))\n$set(_case,$rreplace(%_case%,\\\\b[Ll][Pp]\\\\b,LP))\n)\n$set(_case,$rreplace(%_case%, - Ep$,- EP))\n$set(_case,$rreplace(%_case%,\\\\b[Vv][Ss]\\\\.,vs.))\n$set(_case,$rreplace(%_case%,\\\\b3[Oo][Hh][ ]*![ ]*3\\\\b,3OH!3))\n$set(%_loop_value%,%_case%)\n)\n$unset(_case)\n$unset(_case_core)\n)\n$if($rsearch($lower(%media%),^[0-9]*[x×]?[ ]*digital media$),$delete(releasecountry),$if($is_multi(%releasecountry%),$setmulti(releasecountry,$map(%releasecountry%,$if($eq(%_loop_value%,XE),EU,%_loop_value%))),$if($eq(%releasecountry%,XE),$set(releasecountry,EU))))\n"),

)


class ScriptsOptionsPage(OptionsPage):
    NAME = "karpuzikov_picard_scripts"
    TITLE = "Karpuzikov Picard Scripts"
    PARENT = "plugins"

    def __init__(self):
        super().__init__()

        layout = QtWidgets.QVBoxLayout(self)

        info = QtWidgets.QLabel(
            "Enable the Picard tools you want this plugin to run. "
            "If Current Artist Names Everywhere is also installed as a standalone plugin, "
            "disable one copy. Do not enable both MusicBrainz Title Capitalization and the "
            "legacy English Title Capitalization script. If a tagging script is also enabled "
            "under Options > Scripting, disable one copy to avoid running it twice."
        )
        info.setWordWrap(True)
        layout.addWidget(info)

        self.checkboxes = {}
        for key, label in FEATURES:
            checkbox = QtWidgets.QCheckBox(label)
            self.checkboxes[key] = checkbox
            layout.addWidget(checkbox)

        for key, label, _script in SCRIPTS:
            checkbox = QtWidgets.QCheckBox(label)
            self.checkboxes[key] = checkbox
            layout.addWidget(checkbox)


        layout.addStretch()

    def load(self):
        for key, checkbox in self.checkboxes.items():
            checkbox.setChecked(self.api.plugin_config[key])

    def save(self):
        for key, checkbox in self.checkboxes.items():
            self.api.plugin_config[key] = checkbox.isChecked()


def _run_scripts(api, metadata):
    for key, label, script in SCRIPTS:
        if not api.plugin_config[key]:
            continue

        try:
            ScriptParser().eval(script, metadata)
        except Exception:
            api.logger.exception('Failed to run tagging script "%s"', label)


def process_album(api, album, metadata, release_node):
    if api.plugin_config["current_artist_names"]:
        normalize_album_artist_names(api, metadata, release_node)
    _run_scripts(api, metadata)
    if api.plugin_config["musicbrainz_title_capitalization"]:
        capitalize_release_title(api, metadata, release_node)


def process_track(api, track, metadata, track_node, release_node=None):
    if api.plugin_config["current_artist_names"]:
        normalize_track_artist_names(api, metadata, track_node, release_node)
    _run_scripts(api, metadata)
    if api.plugin_config["musicbrainz_title_capitalization"]:
        capitalize_track_title(api, metadata, track_node, release_node)


def enable(api):
    for key, _label in FEATURES:
        api.plugin_config.register_option(key, False)
    for key, _label, _script in SCRIPTS:
        api.plugin_config.register_option(key, False)
    api.register_options_page(ScriptsOptionsPage)
    api.register_album_metadata_processor(process_album, priority=PLUGIN_PRIORITY)
    api.register_track_metadata_processor(process_track, priority=PLUGIN_PRIORITY)
    global _LOOKUP_API, _BARCODE_TOOLBAR_WATCHER
    _LOOKUP_API = api
    api.register_tools_menu_action(BarcodeLookupToolsAction)
    _BARCODE_TOOLBAR_WATCHER = _BarcodeToolbarWatcher(api)
    _install_barcode_lookup_button(api)
