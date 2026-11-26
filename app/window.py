"""The desktop window: hiding its title bar, and the window actions a hidden title bar no longer offers.

The window itself is opened by desktop.py (pywebview); this module only keeps the setting in `window.json` and
answers the page. desktop.py sets `controller` once the window is open; without it (the page in a normal
browser, the tests) the page offers neither the setting nor the window buttons and shortcuts.

Whether the title bar shows is fixed when the window opens, so a change takes effect at the next start.
"""

from __future__ import annotations

import json
import threading

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.state import CACHE_DIR

router = APIRouter()

SETTINGS_FILE = CACHE_DIR / "window.json"
ACTIONS = ("close", "minimize", "maximize", "fullscreen")

# Set by desktop.py: an object with a `frameless` attribute (how the window was opened) and the methods
# close(), minimize(), toggle_maximize(), toggle_fullscreen() and move(x, y).
controller = None


def hide_title_bar() -> bool:
    """The saved wish: open the window without a title bar."""
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8")).get("hide_title_bar") is True
    except (OSError, ValueError, AttributeError):
        return False


def _save(hide: bool):
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = SETTINGS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"hide_title_bar": hide}), encoding="utf-8")
    tmp.replace(SETTINGS_FILE)


def _state():
    c = controller
    return {
        "available": c is not None,  # the page runs in Flou Player's own window
        "hide_title_bar": hide_title_bar(),  # the saved setting
        "frameless": bool(c and c.frameless),  # how this window was opened
    }


class WindowSettings(BaseModel):
    hide_title_bar: bool


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
    _save(req.hide_title_bar)
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
