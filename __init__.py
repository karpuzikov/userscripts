# SPDX-License-Identifier: MIT
"""Karpuzikov Picard Scripts - Picard 3.0 Git-updatable script collection."""

import re

from PyQt6 import QtCore, QtGui, QtWidgets

from picard.plugin3.api import OptionsPage, ScriptParser

from .current_artist_names import (
    normalize_album_artist_names,
    normalize_track_artist_names,
)


PLUGIN_PRIORITY = -10000

_BARCODE_TOOLBAR_ACTION = None
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


def _start_barcode_lookup(api, files, barcode):
    if not files or not barcode:
        return

    api.tagger.window.set_statusbar_message(
        "Looking up exact barcode %(barcode)s...",
        {"barcode": barcode},
        translate=None,
    )

    holder = {}

    def handler(document, http, error):
        task = holder.get("task")
        if task in _PENDING_BARCODE_TASKS:
            _PENDING_BARCODE_TASKS.remove(task)
        _barcode_lookup_finished(api, files, barcode, document, http, error)

    query_limit = api.global_config.setting["query_limit"]
    task = api.mb_api.find_releases(
        handler,
        barcode=barcode,
        limit=query_limit,
    )
    holder["task"] = task
    _PENDING_BARCODE_TASKS.append(task)


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

    direct_files = []
    other_objects = []
    for obj in objects:
        if hasattr(obj, "filename") and hasattr(obj, "metadata"):
            direct_files.append(obj)
        else:
            other_objects.append(obj)

    started = 0
    file_groups = {}
    for file_obj in direct_files:
        barcode = _barcode_from_file(file_obj)
        if barcode:
            file_groups.setdefault(barcode, []).append(file_obj)

    for barcode, files in file_groups.items():
        _start_barcode_lookup(api, files, barcode)
        started += 1

    for obj in other_objects:
        files = _files_for_object(obj)
        barcode = _common_barcode(files)
        if barcode:
            _start_barcode_lookup(api, files, barcode)
            started += 1

    if not started:
        api.tagger.window.set_statusbar_message(
            "No usable Barcode / UPC tag found in the selection",
            translate=None,
            timeout=5000,
        )


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


def _install_barcode_lookup_button(api):
    global _BARCODE_TOOLBAR_ACTION, _LOOKUP_API

    if _BARCODE_TOOLBAR_ACTION is not None:
        return

    _LOOKUP_API = api

    window = api.tagger.window
    action = QtGui.QAction(
        _make_barcode_icon(window),
        "Barcode / UPC Lookup",
        window,
    )
    action.setIconText("Barcode Lookup")
    action.setToolTip("Lookup selected items by exact Barcode or UPC only")
    action.setStatusTip("Lookup selected items by exact Barcode or UPC only")
    action.triggered.connect(lambda _checked=False: _run_barcode_lookup_button(api))

    toolbar_actions = window.toolbar.actions()
    native_lookup = next(
        (
            existing
            for existing in toolbar_actions
            if existing.text().replace("&", "").strip() == "Lookup"
        ),
        None,
    )

    if native_lookup is not None:
        index = toolbar_actions.index(native_lookup)
        if index + 1 < len(toolbar_actions):
            window.toolbar.insertAction(toolbar_actions[index + 1], action)
        else:
            window.toolbar.addAction(action)
    else:
        window.toolbar.addAction(action)

    _BARCODE_TOOLBAR_ACTION = action
    api.logger.info("Strict Barcode / UPC Lookup toolbar button enabled")


def disable():
    global _BARCODE_TOOLBAR_ACTION, _LOOKUP_API

    api = _LOOKUP_API

    if api is not None:
        for task in list(_PENDING_BARCODE_TASKS):
            try:
                api.tagger.webservice.abort_task(task)
            except Exception:
                pass
        _PENDING_BARCODE_TASKS.clear()

        if _BARCODE_TOOLBAR_ACTION is not None:
            try:
                api.tagger.window.toolbar.removeAction(_BARCODE_TOOLBAR_ACTION)
                _BARCODE_TOOLBAR_ACTION.deleteLater()
            except Exception:
                pass

    _BARCODE_TOOLBAR_ACTION = None
    _LOOKUP_API = None


FEATURES = (
    ("current_artist_names", "Current Artist Names Everywhere"),
)


SCRIPTS = (
    ("move_featured_artists", "Move Featured Artists to Title", "$set(_feat_title,$rsearch(%artist%,\\\\s+\\\\\\(?\\(f\\(ea\\)?t\\\\.[^\\)]*\\)))\n$set(_feat_title,$rreplace(%_feat_title%,^f\\(ea\\)?t\\\\.,ft.))\n$set(artist,$rreplace(%artist%,\\\\s+\\\\\\(?f\\(ea\\)?t\\\\.[^\\)]*\\\\\\)?,))\n$set(albumartist,$rreplace(%albumartist%,\\\\s+\\\\\\(?f\\(ea\\)?t\\\\.[^\\)]*\\\\\\)?,))\n$set(title,$if(%_feat_title%,%title% \\(%_feat_title%\\),%title%))"),
    ("unicode_to_ascii", "Unicode to ASCII", "$foreach(title; album; artist; albumartist; artistsort; albumartistsort; discsubtitle; work; composer; composersort; lyricist; conductor; arranger; remixer; producer; mixer; djmixer; engineer; director; grouping; comment,\n$set(%_loop_value%,$replace($get(%_loop_value%),\n‘,' ,’,', ‚,', ‛,',\n“,'\"', ”,'\"', „,'\"', ‟,'\"',\n‐,-, ‑,-, ‒,-, –,-, —,-, ―,-, −,-,\n…, ..., ·,., •,*, ‧,.,\n×, &, ÷,/, ⁄,/,\n＆, &, ＋,+, ＝,=,\n（,(, ）,), ［,[, ］,], ｛,{, ｝,},\n：,:, ；,;, ！,!, ？,?, ，,\\,, ．,.,\n／,/, ＼,\\\\, ｜,|,\n＜,<, ＞,>, ＿,_,\n©,(c), ®,(R), ™,TM, №,No.,\n , ,  , ,   , ,\n))\n)"),
    ("format_multiple_artists", "Format Multiple Artists", "$setmulti(_mainartists,%artists%)\n$foreach(%artists%,$if($not($in(%artist%,%_loop_value%)),$setmulti(_mainartists,$replacemulti(%_mainartists%,%_loop_value%,))))\n$set(_artistcount,$lenmulti(%_mainartists%))\n$if($eq(%_artistcount%,1),$set(artist,$getmulti(%_mainartists%,0)),$if($eq(%_artistcount%,2),$set(artist,$join(%_mainartists%, & )),$if($gt(%_artistcount%,2),$set(artist,$join($slice(%_mainartists%,0,-1),\\, ) & $getmulti(%_mainartists%,-1)))))\n$unset(_mainartists)\n$unset(_artistcount)"),
    ("add_ep_single_suffix", "Add EP/Single Suffix", "$if($eq(%_primaryreleasetype%,ep),$if($not($endswith(%album%, - EP)),$set(album,%album% - EP)))\n$if($eq(%_primaryreleasetype%,single),$if($not($endswith(%album%, - Single)),$set(album,%album% - Single)))"),
    ("english_title_capitalization", "English Title Capitalization", "$foreach(title; album,\n$set(_case,$title($get(%_loop_value%)))\n$set(_case,$replace(%_case%, A , a , An , an , The , the , And , and , But , but , Or , or , Nor , nor , For , for , Yet , yet , So , so , As , as , At , at , By , by , In , in , Of , of , On , on , To , to , From , from , Versus , versus , Vs. , vs. , V. , v. , Etc. , etc. ))\n$if($rsearch(%_case%,\\sas\\s.*\\sas\\s),$set(_case,$replace(%_case%, as , As )))\n$set(_case,$replace(%_case%, as I , As I , as You , As You , as He , As He , as She , As She , as We , As We , as They , As They , as It , As It , as This , As This , as That , As That , as These , As These , as Those , As Those ))\n$set(_case,$replace(%_case%, Am but , Am But , Are but , Are But , Is but , Is But , Was but , Was But , Were but , Were But , Be but , Be But , Been but , Been But , Ain't but , Ain't But ))\n$set(_case,$replace(%_case%, Am so , Am So , Are so , Are So , Is so , Is So , Was so , Was So , Were so , Were So , Be so , Be So , Been so , Been So , Feel so , Feel So , Feels so , Feels So , Felt so , Felt So , Look so , Look So , Looks so , Looks So , Seem so , Seem So , Seems so , Seems So ))\n$set(_case,$replace(%_case%, Break in , Break In , Check in , Check In , Come in , Come In , Drop in , Drop In , Fill in , Fill In , Get in , Get In , Give in , Give In , Join in , Join In , Let in , Let In , Move in , Move In , Tune in , Tune In , Turn in , Turn In , Walk in , Walk In , Bring on , Bring On , Carry on , Carry On , Come on , Come On , Get on , Get On , Go on , Go On , Hold on , Hold On , Keep on , Keep On , Move on , Move On , Pass on , Pass On , Put on , Put On , Take on , Take On , Turn on , Turn On , Try on , Try On , Come by , Come By , Drop by , Drop By , Get by , Get By , Go by , Go By , Pass by , Pass By , Stand by , Stand By , Stop by , Stop By , Swing by , Swing By , Walk by , Walk By ))\n$set(_case,$replace(%_case%, O' , o' , 'N' , 'n' ))\n$set(_case,$replace(%_case%,: a ,: A ,: an ,: An ,: the ,: The ,: and ,: And ,: but ,: But ,: or ,: Or ,: nor ,: Nor ,: for ,: For ,: yet ,: Yet ,: so ,: So ,: as ,: As ,: at ,: At ,: by ,: By ,: in ,: In ,: of ,: Of ,: on ,: On ,: to ,: To ,: from ,: From ,: versus ,: Versus ,: vs. ,: Vs. ,: v. ,: V. ,: etc. ,: Etc. ))\n$set(_case,$replace(%_case%,! a ,! A ,! an ,! An ,! the ,! The ,! and ,! And ,! but ,! But ,! or ,! Or ,! nor ,! Nor ,! for ,! For ,! yet ,! Yet ,! so ,! So ,! as ,! As ,! at ,! At ,! by ,! By ,! in ,! In ,! of ,! Of ,! on ,! On ,! to ,! To ,! from ,! From ))\n$set(_case,$replace(%_case%,? a ,? A ,? an ,? An ,? the ,? The ,? and ,? And ,? but ,? But ,? or ,? Or ,? nor ,? Nor ,? for ,? For ,? yet ,? Yet ,? so ,? So ,? as ,? As ,? at ,? At ,? by ,? By ,? in ,? In ,? of ,? Of ,? on ,? On ,? to ,? To ,? from ,? From ))\n$set(_case,$replace(%_case%, - a , - A , - an , - An , - the , - The , - and , - And , - but , - But , - or , - Or , - nor , - Nor , - for , - For , - yet , - Yet , - so , - So , - as , - As , - at , - At , - by , - By , - in , - In , - of , - Of , - on , - On , - to , - To , - from , - From ))\n$set(%_loop_value%,%_case%)\n)\n$unset(_case)"),

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
            "disable one copy. If a tagging script is also enabled under Options > Scripting, "
            "disable one copy to avoid running it twice."
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


def process_track(api, track, metadata, track_node, release_node=None):
    if api.plugin_config["current_artist_names"]:
        normalize_track_artist_names(api, metadata, track_node, release_node)
    _run_scripts(api, metadata)


def enable(api):
    for key, _label in FEATURES:
        api.plugin_config.register_option(key, False)
    for key, _label, _script in SCRIPTS:
        api.plugin_config.register_option(key, False)
    api.register_options_page(ScriptsOptionsPage)
    api.register_album_metadata_processor(process_album, priority=PLUGIN_PRIORITY)
    api.register_track_metadata_processor(process_track, priority=PLUGIN_PRIORITY)
    _install_barcode_lookup_button(api)
