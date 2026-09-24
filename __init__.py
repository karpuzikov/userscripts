# SPDX-License-Identifier: MIT
"""Git-updatable Picard 3 wrapper for the original tagging script."""

from picard.plugin3.api import ScriptParser

PLUGIN_PRIORITY = -100
SCRIPT = r"""$if($eq(%_primaryreleasetype%,ep),$if($not($endswith(%album%, - EP)),$set(album,%album% - EP)))
$if($eq(%_primaryreleasetype%,single),$if($not($endswith(%album%, - Single)),$set(album,%album% - Single)))"""


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
