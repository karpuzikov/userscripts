# SPDX-License-Identifier: MIT
"""Git-updatable Picard 3 wrapper for the original tagging script."""

from picard.plugin3.api import ScriptParser

PLUGIN_PRIORITY = -100
SCRIPT = r"""$set(_case,$title(%title%))
$set(_case,$replace(%_case%, A , a , An , an , The , the , And , and , But , but , Or , or , Nor , nor , As , as , At , at , For , for , Of , of , To , to , Cum , cum , Mid , mid , Per , per , Qua , qua , Re , re , Via , via , With , with , Without , without ))
$set(_case,$replace(%_case%,: a ,: A ,: an ,: An ,: the ,: The ,: and ,: And ,: but ,: But ,: or ,: Or ,: nor ,: Nor ,: as ,: As ,: at ,: At ,: for ,: For ,: of ,: Of ,: to ,: To ,: cum ,: Cum ,: mid ,: Mid ,: per ,: Per ,: qua ,: Qua ,: re ,: Re ,: via ,: Via ,: with ,: With ,: without ,: Without ))
$set(_case,$replace(%_case%,! a ,! A ,! an ,! An ,! the ,! The ,? a ,? A ,? an ,? An ,? the ,? The ))
$set(title,%_case%)
$unset(_case)"""


def _run(api, metadata):
    try:
        ScriptParser().eval(SCRIPT, metadata)
    except Exception:
        api.logger.exception("Failed to run embedded tagging script")


def process_album(api, album, metadata, release_node):
    _run(api, metadata)


def process_track(api, track, metadata, track_node, release_node=None):
    _run(api, metadata)


def enable(api):
    api.register_album_metadata_processor(process_album, priority=PLUGIN_PRIORITY)
    api.register_track_metadata_processor(process_track, priority=PLUGIN_PRIORITY)
