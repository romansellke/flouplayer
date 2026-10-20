"""Shared state of the backend: the discovered devices, locks, and where the app keeps its files."""
from __future__ import annotations
import threading
from pathlib import Path
from typing import Any

lock=threading.Lock(); devices:dict[str,Any]={}
scan_lock=threading.Lock(); scan_state:dict[str,Any]={"running":False,"cancel":False,"count":0,"containers":0}
SCAN_WORKERS=6
# Guards against servers whose tree has no end (a container that lists itself
# again under a new object id): too deep, a title repeating along the path, or
# very many folders in a row without a single new track stops the descent.
SCAN_MAX_DEPTH=12
SCAN_STALL_CONTAINERS=3000

# Persistent on-disk cache of the last scanned library, so it survives
# closing and reopening the app -- a rescan is then only needed on request
# (the "Load Library" button), not on every startup.
CACHE_DIR=Path.home()/".cache"/"flou_player"
CACHE_FILE=CACHE_DIR/"library.json"
KNOWN_DEVICES_FILE=CACHE_DIR/"devices.json"   # media servers and players found last time, to reconnect without a search
_merged_primary=set()  # keys of device entries that stand for a whole multi-device player
