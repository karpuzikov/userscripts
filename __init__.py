# SPDX-License-Identifier: MIT
"""Git-updatable Picard 3 wrapper for the original tagging script."""

from picard.plugin3.api import ScriptParser

PLUGIN_PRIORITY = -100
SCRIPT = r"""$setmulti(_mainartists,%artists%)
$foreach(%artists%,$if($not($in(%artist%,%_loop_value%)),$setmulti(_mainartists,$replacemulti(%_mainartists%,%_loop_value%,))))
$set(_artistcount,$lenmulti(%_mainartists%))
$if($eq(%_artistcount%,1),$set(artist,$getmulti(%_mainartists%,0)),$if($eq(%_artistcount%,2),$set(artist,$join(%_mainartists%, & )),$if($gt(%_artistcount%,2),$set(artist,$join($slice(%_mainartists%,0,-1),\, ) & $getmulti(%_mainartists%,-1)))))
$unset(_mainartists)
$unset(_artistcount)"""


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
