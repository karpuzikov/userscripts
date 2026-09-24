# SPDX-License-Identifier: MIT
"""Karpuzikov Picard Scripts - Picard 3.0 Git-updatable script collection."""

from PyQt6 import QtWidgets

from picard.plugin3.api import OptionsPage, ScriptParser


PLUGIN_PRIORITY = -10000

SCRIPTS = (
    ("move_featured_artists", "Move Featured Artists to Title", "$set(_feat_title,$rsearch(%artist%,\\\\s+\\\\\\(?\\(f\\(ea\\)?t\\\\.[^\\)]*\\)))\n$set(_feat_title,$rreplace(%_feat_title%,^f\\(ea\\)?t\\\\.,ft.))\n$set(artist,$rreplace(%artist%,\\\\s+\\\\\\(?f\\(ea\\)?t\\\\.[^\\)]*\\\\\\)?,))\n$set(albumartist,$rreplace(%albumartist%,\\\\s+\\\\\\(?f\\(ea\\)?t\\\\.[^\\)]*\\\\\\)?,))\n$set(title,$if(%_feat_title%,%title% \\(%_feat_title%\\),%title%))"),
    ("unicode_to_ascii", "Unicode to ASCII", "$foreach(title; album; artist; albumartist; artistsort; albumartistsort; discsubtitle; work; composer; composersort; lyricist; conductor; arranger; remixer; producer; mixer; djmixer; engineer; director; grouping; comment,\n$set(%_loop_value%,$replace($get(%_loop_value%),\n‘,' ,’,', ‚,', ‛,',\n“,'\"', ”,'\"', „,'\"', ‟,'\"',\n‐,-, ‑,-, ‒,-, –,-, —,-, ―,-, −,-,\n…, ..., ·,., •,*, ‧,.,\n×, &, ÷,/, ⁄,/,\n＆, &, ＋,+, ＝,=,\n（,(, ）,), ［,[, ］,], ｛,{, ｝,},\n：,:, ；,;, ！,!, ？,?, ，,\\,, ．,.,\n／,/, ＼,\\\\, ｜,|,\n＜,<, ＞,>, ＿,_,\n©,(c), ®,(R), ™,TM, №,No.,\n , ,  , ,   , ,\n))\n)"),
    ("format_multiple_artists", "Format Multiple Artists", "$setmulti(_mainartists,%artists%)\n$foreach(%artists%,$if($not($in(%artist%,%_loop_value%)),$setmulti(_mainartists,$replacemulti(%_mainartists%,%_loop_value%,))))\n$set(_artistcount,$lenmulti(%_mainartists%))\n$if($eq(%_artistcount%,1),$set(artist,$getmulti(%_mainartists%,0)),$if($eq(%_artistcount%,2),$set(artist,$join(%_mainartists%, & )),$if($gt(%_artistcount%,2),$set(artist,$join($slice(%_mainartists%,0,-1),\\, ) & $getmulti(%_mainartists%,-1)))))\n$unset(_mainartists)\n$unset(_artistcount)"),
    ("add_ep_single_suffix", "Add EP/Single Suffix", "$if($eq(%_primaryreleasetype%,ep),$if($not($endswith(%album%, - EP)),$set(album,%album% - EP)))\n$if($eq(%_primaryreleasetype%,single),$if($not($endswith(%album%, - Single)),$set(album,%album% - Single)))"),
    ("english_title_capitalization", "English Title Capitalization", "$set(_case,$title(%title%))\n$set(_case,$replace(%_case%, A , a , An , an , The , the , And , and , But , but , Or , or , Nor , nor , As , as , At , at , For , for , Of , of , To , to , Cum , cum , Mid , mid , Per , per , Qua , qua , Re , re , Via , via , With , with , Without , without ))\n$set(_case,$replace(%_case%,: a ,: A ,: an ,: An ,: the ,: The ,: and ,: And ,: but ,: But ,: or ,: Or ,: nor ,: Nor ,: as ,: As ,: at ,: At ,: for ,: For ,: of ,: Of ,: to ,: To ,: cum ,: Cum ,: mid ,: Mid ,: per ,: Per ,: qua ,: Qua ,: re ,: Re ,: via ,: Via ,: with ,: With ,: without ,: Without ))\n$set(_case,$replace(%_case%,! a ,! A ,! an ,! An ,! the ,! The ,? a ,? A ,? an ,? An ,? the ,? The ))\n$set(title,%_case%)\n$unset(_case)"),
)


class ScriptsOptionsPage(OptionsPage):
    NAME = "karpuzikov_picard_scripts"
    TITLE = "Karpuzikov Picard Scripts"
    PARENT = "plugins"

    def __init__(self):
        super().__init__()

        layout = QtWidgets.QVBoxLayout(self)

        info = QtWidgets.QLabel(
            "Enable the tagging scripts you want this plugin to run. "
            "If you also imported the same .txt script under Options > Scripting, "
            "disable one copy to avoid running it twice."
        )
        info.setWordWrap(True)
        layout.addWidget(info)

        self.checkboxes = {}
        for key, label, _script in SCRIPTS:
            checkbox = QtWidgets.QCheckBox(label)
            self.checkboxes[key] = checkbox
            layout.addWidget(checkbox)

        layout.addStretch()

    def load(self):
        for key, checkbox in self.checkboxes.items():
            checkbox.setChecked(self.api.plugin_config.get(key, False))

    def save(self):
        for key, checkbox in self.checkboxes.items():
            self.api.plugin_config[key] = checkbox.isChecked()


def _run_scripts(api, metadata):
    for key, label, script in SCRIPTS:
        if not api.plugin_config.get(key, False):
            continue

        try:
            ScriptParser().eval(script, metadata)
        except Exception:
            api.logger.exception('Failed to run tagging script "%s"', label)


def process_album(api, album, metadata, release_node):
    _run_scripts(api, metadata)


def process_track(api, track, metadata, track_node, release_node=None):
    _run_scripts(api, metadata)


def enable(api):
    for key, _label, _script in SCRIPTS:
        api.plugin_config.register_option(key, False)

    api.register_options_page(ScriptsOptionsPage)
    api.register_album_metadata_processor(process_album, priority=PLUGIN_PRIORITY)
    api.register_track_metadata_processor(process_track, priority=PLUGIN_PRIORITY)
