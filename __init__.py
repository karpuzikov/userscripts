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
                        for original_barcode in form_targets.get(release_barcode, ()):
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

            duplicate_queries.append(
                "(barcode:%s AND mediums:%s)" % (barcode, disc_count)
            )
            duplicate_targets.setdefault(barcode, set()).add(barcode)

        request_queries(
            duplicate_queries,
            duplicate_targets,
            state["disc_matches"],
            finish,
        )

    def start_fallback():
        missing = [
            barcode
            for barcode in barcodes
            if not state["matches"][barcode]
        ]
        if not missing:
            resolve_duplicates()
            return

        form_targets = {}
        fallback_queries = []

        for barcode in missing:
            for form in sorted(_barcode_forms(barcode) - {barcode}):
                form_targets.setdefault(form, set()).add(barcode)
                fallback_queries.append("barcode:%s" % form)

        def after_fallback():
            resolve_duplicates()

        request_queries(
            fallback_queries,
            form_targets,
            state["matches"],
            after_fallback,
        )

    exact_targets = {barcode: {barcode} for barcode in barcodes}
    exact_queries = ["barcode:%s" % barcode for barcode in barcodes]
    request_queries(
        exact_queries,
        exact_targets,
        state["matches"],
        start_fallback,
    )



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
    window = getattr(api.tagger, "window", None)
    toolbar = getattr(window, "toolbar", None) if window is not None else None
    if toolbar is None:
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
    """Notice Picard 3's full toolbar replacement after Options > Toolbar."""

    def __init__(self, api):
        window = api.tagger.window
        super().__init__(window)
        self.api = api
        self.window = window
        self.pending = False
        self.window.installEventFilter(self)

        # Also repairs a toolbar cleared in place (no ChildAdded event).
        self.check_timer = QtCore.QTimer(self)
        self.check_timer.setInterval(4000)
        self.check_timer.timeout.connect(self.refresh)
        self.check_timer.start()
        self.schedule()

    def eventFilter(self, watched, event):
        if watched is self.window and event.type() in (
            QtCore.QEvent.Type.ChildAdded,
            QtCore.QEvent.Type.WindowActivate,
        ):
            # ChildAdded fires before Picard assigns its new toolbar field.
            self.schedule()
        return False

    def schedule(self):
        if not self.pending:
            self.pending = True
            QtCore.QTimer.singleShot(0, self.refresh)

    def refresh(self):
        self.pending = False
        if _LOOKUP_API is not self.api:
            return
        try:
            _install_barcode_lookup_button(self.api)
        except (AttributeError, RuntimeError) as exc:
            # Picard can be replacing the toolbar during this event.
            self.api.logger.warning("Barcode Lookup toolbar temporarily unavailable: %s", exc)

    def stop(self):
        self.check_timer.stop()
        self.window.removeEventFilter(self)


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
        for task in list(_PENDING_BARCODE_TASKS):
            try:
                api.tagger.webservice.abort_task(task)
            except Exception:
                pass
        _PENDING_BARCODE_TASKS.clear()

        if _BARCODE_TOOLBAR_ACTION is not None:
            try:
                toolbar = getattr(api.tagger.window, "toolbar", None)
                if toolbar is not None:
                    toolbar.removeAction(_BARCODE_TOOLBAR_ACTION)
                _BARCODE_TOOLBAR_ACTION.deleteLater()
            except RuntimeError:
                pass

    _BARCODE_TOOLBAR_ACTION = None


FEATURES = (
    ("current_artist_names", "Current Artist Names Everywhere"),
    ("musicbrainz_title_capitalization", "MusicBrainz Title Capitalization"),
)


SCRIPTS = (
    ("move_featured_artists", "Move Featured Artists to Title", "$set(_feat_title,$rsearch(%artist%,\\\\s+\\\\\\(?\\(f\\(ea\\)?t\\\\.[^\\)]*\\)))\n$set(_feat_title,$rreplace(%_feat_title%,^f\\(ea\\)?t\\\\.,ft.))\n$set(artist,$rreplace(%artist%,\\\\s+\\\\\\(?f\\(ea\\)?t\\\\.[^\\)]*\\\\\\)?,))\n$set(albumartist,$rreplace(%albumartist%,\\\\s+\\\\\\(?f\\(ea\\)?t\\\\.[^\\)]*\\\\\\)?,))\n$set(title,$if(%_feat_title%,%title% \\(%_feat_title%\\),%title%))"),
    ("unicode_to_ascii", "Unicode to ASCII", "$foreach(title; album; artist; albumartist; artistsort; albumartistsort; discsubtitle; work; composer; composersort; lyricist; conductor; arranger; remixer; producer; mixer; djmixer; engineer; director; grouping; comment,\n$set(%_loop_value%,$replace($get(%_loop_value%),\n‘,' ,’,', ‚,', ‛,',\n“,'\"', ”,'\"', „,'\"', ‟,'\"',\n‐,-, ‑,-, ‒,-, –,-, —,-, ―,-, −,-,\n…, ..., ·,., •,*, ‧,.,\n×, &, ÷,/, ⁄,/,\n＆, &, ＋,+, ＝,=,\n（,(, ）,), ［,[, ］,], ｛,{, ｝,},\n：,:, ；,;, ！,!, ？,?, ，,\\,, ．,.,\n／,/, ＼,\\\\, ｜,|,\n＜,<, ＞,>, ＿,_,\n©,(c), ®,(R), ™,TM, №,No.,\n , ,  , ,   , ,\n))\n)"),
    ("format_multiple_artists", "Format Multiple Artists", "$setmulti(_mainartists,%artists%)\n$foreach(%artists%,$if($not($in(%artist%,%_loop_value%)),$setmulti(_mainartists,$replacemulti(%_mainartists%,%_loop_value%,))))\n$set(_artistcount,$lenmulti(%_mainartists%))\n$if($eq(%_artistcount%,1),$set(artist,$getmulti(%_mainartists%,0)),$if($eq(%_artistcount%,2),$set(artist,$join(%_mainartists%, & )),$if($gt(%_artistcount%,2),$set(artist,$join($slice(%_mainartists%,0,-1),\\, ) & $getmulti(%_mainartists%,-1)))))\n$unset(_mainartists)\n$unset(_artistcount)\n\n$if($gt($lenmulti(%albumartists%),0),\n$setmulti(_mainalbumartists,%albumartists%)\n$foreach(%albumartists%,$if($not($in(%albumartist%,%_loop_value%)),$setmulti(_mainalbumartists,$replacemulti(%_mainalbumartists%,%_loop_value%,))))\n$set(_albumartistcount,$lenmulti(%_mainalbumartists%))\n$if($eq(%_albumartistcount%,1),$set(albumartist,$getmulti(%_mainalbumartists%,0)),$if($eq(%_albumartistcount%,2),$set(albumartist,$join(%_mainalbumartists%, & )),$if($gt(%_albumartistcount%,2),$set(albumartist,$join($slice(%_mainalbumartists%,0,-1),\\, ) & $getmulti(%_mainalbumartists%,-1)))))\n$unset(_mainalbumartists)\n$unset(_albumartistcount)\n)"),
    ("add_ep_single_suffix", "Add EP/Single Suffix", "$if($eq($lower(%_primaryreleasetype%),ep),\n$while($or($endswith($lower($trim(%album%)), - ep),$endswith($lower($trim(%album%)), ep)),\n$if($endswith($lower($trim(%album%)), - ep),\n$set(album,$left($trim(%album%),$sub($len($trim(%album%)),5))),\n$set(album,$left($trim(%album%),$sub($len($trim(%album%)),3)))))\n$if($and($trim(%album%),$ne($lower($trim(%album%)),ep)),$set(album,$trim(%album%) - EP)))\n$if($eq($lower(%_primaryreleasetype%),single),\n$while($or($endswith($lower($trim(%album%)), - single),$endswith($lower($trim(%album%)), single)),\n$if($endswith($lower($trim(%album%)), - single),\n$set(album,$left($trim(%album%),$sub($len($trim(%album%)),9))),\n$set(album,$left($trim(%album%),$sub($len($trim(%album%)),7)))))\n$if($and($trim(%album%),$ne($lower($trim(%album%)),single)),$set(album,$trim(%album%) - Single)))\n"),
    ("english_title_capitalization", "English Title Capitalization", "$if($and(\n$or($not(%language%),$eq($lower(%language%),eng),$eq($lower(%language%),en),$eq($lower(%language%),english)),\n$not($rsearch($lower(%album%),la noche|vai sentando))\n),\n$foreach(title; album,\n$set(_case,$title($get(%_loop_value%)))\n$set(_case,$replace(%_case%, A , a , An , an , The , the , And , and , But , but , Or , or , Nor , nor , For , for , Yet , yet , So , so , As , as , At , at , By , by , In , in , Of , of , On , on , To , to , From , from , Versus , versus , Vs. , vs. , V. , v. , Etc. , etc. ))\n$if($rsearch(%_case%,\\sas\\s.*\\sas\\s),$set(_case,$replace(%_case%, as , As )))\n$set(_case,$replace(%_case%, as I , As I , as You , As You , as He , As He , as She , As She , as We , As We , as They , As They , as It , As It , as This , As This , as That , As That , as These , As These , as Those , As Those ))\n$set(_case,$replace(%_case%, Am but , Am But , Are but , Are But , Is but , Is But , Was but , Was But , Were but , Were But , Be but , Be But , Been but , Been But , Ain't but , Ain't But ))\n$set(_case,$replace(%_case%, Am so , Am So , Are so , Are So , Is so , Is So , Was so , Was So , Were so , Were So , Be so , Be So , Been so , Been So , Feel so , Feel So , Feels so , Feels So , Felt so , Felt So , Look so , Look So , Looks so , Looks So , Seem so , Seem So , Seems so , Seems So ))\n$set(_case,$replace(%_case%, Bun up , Bun Up , Break in , Break In , Check in , Check In , Come in , Come In , Drop in , Drop In , Fill in , Fill In , Get in , Get In , Give in , Give In , Join in , Join In , Let in , Let In , Move in , Move In , Tune in , Tune In , Turn in , Turn In , Walk in , Walk In , Bring on , Bring On , Carry on , Carry On , Come on , Come On , Get on , Get On , Go on , Go On , Hold on , Hold On , Keep on , Keep On , Move on , Move On , Pass on , Pass On , Put on , Put On , Take on , Take On , Turn on , Turn On , Try on , Try On , Come by , Come By , Drop by , Drop By , Get by , Get By , Go by , Go By , Pass by , Pass By , Stand by , Stand By , Stop by , Stop By , Swing by , Swing By , Walk by , Walk By ))\n$set(_case,$replace(%_case%, O' , o' , 'N' , 'n' ))\n$set(_case,$replace(%_case%,: a ,: A ,: an ,: An ,: the ,: The ,: and ,: And ,: but ,: But ,: or ,: Or ,: nor ,: Nor ,: for ,: For ,: yet ,: Yet ,: so ,: So ,: as ,: As ,: at ,: At ,: by ,: By ,: in ,: In ,: of ,: Of ,: on ,: On ,: to ,: To ,: from ,: From ,: versus ,: Versus ,: vs. ,: Vs. ,: v. ,: V. ,: etc. ,: Etc. ))\n$set(_case,$replace(%_case%,! a ,! A ,! an ,! An ,! the ,! The ,! and ,! And ,! but ,! But ,! or ,! Or ,! nor ,! Nor ,! for ,! For ,! yet ,! Yet ,! so ,! So ,! as ,! As ,! at ,! At ,! by ,! By ,! in ,! In ,! of ,! Of ,! on ,! On ,! to ,! To ,! from ,! From ))\n$set(_case,$replace(%_case%,? a ,? A ,? an ,? An ,? the ,? The ,? and ,? And ,? but ,? But ,? or ,? Or ,? nor ,? Nor ,? for ,? For ,? yet ,? Yet ,? so ,? So ,? as ,? As ,? at ,? At ,? by ,? By ,? in ,? In ,? of ,? Of ,? on ,? On ,? to ,? To ,? from ,? From ))\n$set(_case,$replace(%_case%, - a , - A , - an , - An , - the , - The , - and , - And , - but , - But , - or , - Or , - nor , - Nor , - for , - For , - yet , - Yet , - so , - So , - as , - As , - at , - At , - by , - By , - in , - In , - of , - Of , - on , - On , - to , - To , - from , - From ))\n$set(%_loop_value%,%_case%)\n)\n$unset(_case)\n)\n"),

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
