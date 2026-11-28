"""The desktop window: hiding its title bar, drawing with the graphics card, and the window actions a hidden
title bar no longer offers.

The window itself is opened by desktop.py (pywebview); this module only keeps the settings in `window.json` and
answers the page. desktop.py sets `controller` once the window is open; without it (the page in a normal
browser, the tests) the page offers neither the settings nor the window buttons and shortcuts.

Both settings are fixed when the window opens, so a change takes effect at the next start.

The graphics card is off by default: Qt WebEngine runs Chromium's GPU code inside the app process, so a driver
problem crashes the whole app. So that a bad driver can't lock someone out, a start with the graphics card
leaves a marker file that only a clean exit removes: is it still there at the next start, that start crashed (or
was killed), and Flou Player draws without the graphics card again and says so.
"""

from __future__ import annotations

import json
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.state import CACHE_DIR

router = APIRouter()

SETTINGS_FILE = CACHE_DIR / "window.json"
GPU_MARKER = CACHE_DIR / "gpu-start"
ACTIONS = ("close", "minimize", "maximize", "fullscreen")

# Set by desktop.py: an object with a `frameless` attribute (how the window was opened) and the methods
# close(), minimize(), toggle_maximize(), toggle_fullscreen() and move(x, y).
controller = None
# Set by start_gpu() when the last start with the graphics card didn't end cleanly; shown in the settings.
gpu_fell_back = False
gpu_forced = False  # FLOU_GPU decides, not the setting


def _load() -> dict:
    try:
        s = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        return s if isinstance(s, dict) else {}
    except (OSError, ValueError):
        return {}


def hide_title_bar() -> bool:
    """The saved wish: open the window without a title bar."""
    return _load().get("hide_title_bar") is True


def use_gpu() -> bool:
    """The saved wish: draw the window with the graphics card."""
    return _load().get("use_gpu") is True


def _save(**changes):
    s = {k: v for k, v in _load().items() if k in ("hide_title_bar", "use_gpu")}
    s.update(changes)
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(s), encoding="utf-8")
    tmp.replace(SETTINGS_FILE)


def start_gpu(env: str | None) -> bool:
    """Whether this start draws with the graphics card (desktop.py, before the window opens).

    FLOU_GPU=1 or FLOU_GPU=0 decide on their own. Otherwise the setting does, unless the last start with the
    graphics card didn't end cleanly: then it is switched off again."""
    global gpu_fell_back, gpu_forced
    gpu_forced = env in ("0", "1")
    if gpu_forced:
        return env == "1"
    if not use_gpu():
        return False
    if GPU_MARKER.exists():
        gpu_fell_back = True
        _save(use_gpu=False)
        GPU_MARKER.unlink(missing_ok=True)
        return False
    try:
        GPU_MARKER.parent.mkdir(parents=True, exist_ok=True)
        GPU_MARKER.touch()
    except OSError:
        pass
    return True


def clean_exit():
    """Flou Player ends as it should (desktop.py): the start with the graphics card went well."""
    try:
        GPU_MARKER.unlink(missing_ok=True)
    except OSError:
        pass


def _state():
    c = controller
    return {
        "available": c is not None,  # the page runs in Flou Player's own window
        "hide_title_bar": hide_title_bar(),  # the saved settings
        "use_gpu": use_gpu(),
        "frameless": bool(c and c.frameless),  # how this window was opened
        "gpu": bool(c and getattr(c, "gpu", False)),
        "gpu_fell_back": gpu_fell_back,
        "gpu_forced": gpu_forced,
    }


class WindowSettings(BaseModel):
    hide_title_bar: bool | None = None
    use_gpu: bool | None = None


class WindowAction(BaseModel):
    action: str


class WindowMove(BaseModel):
    x: int
    y: int


@router.get("/api/app/window")
def get_window():
    return _state()


@router.post("/api/app/window")
def set_window(req: WindowSettings):
    global gpu_fell_back
    changes = req.model_dump(exclude_none=True)
    if changes:
        _save(**changes)
    if "use_gpu" in changes:
        gpu_fell_back = False  # chosen again: the note about the crash has been read
    return _state()


@router.post("/api/app/window/action")
def window_action(req: WindowAction):
    """close, minimize, maximize (or back) and fullscreen (on or off) for the app window."""
    c = controller
    if c is None:
        raise HTTPException(409, "Not running in Flou Player's own window")
    if req.action not in ACTIONS:
        raise HTTPException(400, f"Unknown window action: {req.action}")
    if req.action == "close":
        threading.Timer(0.2, c.close).start()  # answer first: closing ends the process
    elif req.action == "minimize":
        c.minimize()
    elif req.action == "maximize":
        c.toggle_maximize()
    else:
        c.toggle_fullscreen()
    return {"ok": True}


@router.post("/api/app/window/move")
def window_move(req: WindowMove):
    """Moves the window to screen position (x, y): without a title bar, the page drags it by its top bar."""
    c = controller
    if c is None:
        raise HTTPException(409, "Not running in Flou Player's own window")
    c.move(req.x, req.y)
    return {"ok": True}
