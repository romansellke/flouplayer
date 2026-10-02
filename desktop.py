"""
Standalone desktop entry point for Flou Player.

Runs the existing FastAPI app (app/main.py) in a background thread, exactly
as before, but instead of telling the person to open a browser tab, it opens
a native application window (via pywebview) pointed at the local server.
From the user's perspective this is a normal desktop app with its own
window and no visible browser chrome -- nothing else about the app changes.

Why pywebview: it's a thin wrapper around a web rendering engine (Qt
WebEngine here), so it reuses 100% of the existing HTML/CSS/JS frontend
unchanged. Flou Player targets Linux only.

Also the entry point of the packaged app (see packaging/build.sh).
"""
import faulthandler
import os
import sys
import threading
import time
from pathlib import Path

# Crash log: a segfault inside Qt/Chromium kills the process without any
# Python traceback. faulthandler writes the Python stack of every thread
# to this file when that happens, so a crash can actually be diagnosed.
CRASH_LOG = Path.home() / ".cache" / "flou_player" / "crash.log"
CRASH_LOG_MAX_BYTES = 256 * 1024


def enable_crash_log():
    try:
        CRASH_LOG.parent.mkdir(parents=True, exist_ok=True)
        if CRASH_LOG.exists() and CRASH_LOG.stat().st_size > CRASH_LOG_MAX_BYTES:
            CRASH_LOG.unlink()
        f = open(CRASH_LOG, "a", buffering=1, encoding="utf-8")
        f.write(f"\n=== Flou Player started {time.strftime('%Y-%m-%d %H:%M:%S')} (pid {os.getpid()}) ===\n")
        faulthandler.enable(file=f, all_threads=True)
        return f  # keep the file object alive for the whole process lifetime
    except OSError:
        faulthandler.enable()
        return None


_crash_log_file = enable_crash_log()

# Qt WebEngine runs Chromium's GPU code as a thread *inside* this Python
# process on Linux, so a GPU driver problem crashes the whole app with a
# segfault. This UI gains nothing from GPU acceleration, so render in
# software by default. Must be set before Qt WebEngine is loaded.
# Set FLOU_GPU=1 to keep GPU acceleration on.
if os.environ.get("FLOU_GPU") != "1":
    _flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
    if "--disable-gpu" not in _flags.split():
        os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (_flags + " --disable-gpu").strip()

import uvicorn  # noqa: E402
import webview  # noqa: E402

from app.main import APP_ID, STATIC_DIR, app  # noqa: E402

HOST = "127.0.0.1"
PORT = 8765

# pywebview tries GTK first and only falls back to Qt if GTK's Python
# bindings ('gi') aren't installed -- which prints a harmless but
# alarming-looking traceback along the way. We install the Qt backend
# (PyQt5/PyQtWebEngine) specifically, so use Qt directly.
GUI_BACKEND = os.environ.get("PYWEBVIEW_GUI") or "qt"

APP_ICON = STATIC_DIR / "icon.svg"
# pywebview defaults to a private (incognito) web profile, which throws
# away localStorage -- e.g. the chosen track-list columns -- on every
# restart. Keep a persistent profile instead.
WEBVIEW_STORAGE = Path.home() / ".local" / "share" / "flou-player" / "webview"


server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=PORT, log_level="warning"))


def run_server():
    server.run()


def wait_for_server(thread: threading.Thread, timeout: float = 10.0) -> bool:
    """Waits until OUR server is actually listening, so the window doesn't
    open onto a blank page during the brief startup window. Checking the
    server itself (not just whether something answers on the port) matters:
    if the port were taken, the window would otherwise silently talk to
    whatever else is there -- and fail with "Failed to fetch" once that goes
    away."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if server.started:
            return True
        if not thread.is_alive():
            return False
        time.sleep(0.1)
    return False


def running_instance() -> str:
    """'flou' if Flou Player already runs on PORT, 'other' if another
    program uses the port, '' if the port is free."""
    import json
    import socket
    import urllib.request

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        if s.connect_ex((HOST, PORT)) != 0:
            return ""
    try:
        with urllib.request.urlopen(f"http://{HOST}:{PORT}/api/app/ping", timeout=2) as r:
            if json.load(r).get("app") == APP_ID:
                return "flou"
    except Exception:
        pass
    return "other"


def focus_running_instance() -> None:
    import urllib.request

    try:
        req = urllib.request.Request(f"http://{HOST}:{PORT}/api/app/focus", method="POST")
        urllib.request.urlopen(req, timeout=2).close()
    except Exception:
        pass


@app.post("/api/app/focus")
def focus_window():
    """Called by a second launch: bring the existing window to the front
    instead of opening a second one."""
    for w in webview.windows:
        w.restore()
        w.show()
        # Toggling "always on top" is the most reliable way to raise a
        # window on X11 without the window manager's focus-stealing rules.
        w.on_top = True
        w.on_top = False
    return {"ok": True}


def show_error(message: str) -> None:
    """Shows a startup error as a dialog -- started from the app menu there
    is no terminal to print to."""
    print(f"[Flou Player] {message}", flush=True)
    try:
        from qtpy.QtWidgets import QApplication, QMessageBox

        qt_app = QApplication.instance() or QApplication(sys.argv)  # noqa: F841
        QMessageBox.critical(None, "Flou Player", message)
    except Exception:
        pass


def shutdown_and_exit() -> None:
    """Ends the process right after the window has been closed.

    Clicking the window's X makes pywebview only *schedule* the web page
    for deletion (deleteLater) and then stop the Qt event loop, so the
    page is never actually deleted. Python's interpreter shutdown then
    tears down the web profile, the page and the QApplication in no
    particular order -- and a QtWebEngine page outliving its profile
    segfaults (seen as a crash on the main thread with "<no Python frame>"
    in crash.log). So: delete the pending page now, while its profile is
    still alive, give Chromium a moment to flush its storage (settings in
    localStorage), and then exit without running interpreter shutdown.
    """
    try:
        from qtpy.QtCore import QCoreApplication, QEvent

        qt_app = QCoreApplication.instance()
        if qt_app is not None:
            QCoreApplication.sendPostedEvents(None, QEvent.DeferredDelete)
            deadline = time.time() + 0.5
            while time.time() < deadline:
                qt_app.processEvents()
                time.sleep(0.02)
    except Exception:
        pass
    sys.stdout.flush()
    sys.stderr.flush()
    if _crash_log_file:
        _crash_log_file.flush()
    os._exit(0)


def main() -> None:
    # Single instance: a second launch (e.g. from the menu while the app is
    # already open) brings the existing window to the front instead of
    # opening a window without a server of its own.
    other = running_instance()
    if other == "flou":
        print("[Flou Player] Already running -- showing the existing window.")
        focus_running_instance()
        return
    if other == "other":
        show_error(f"Flou Player can't start: port {PORT} is already used by another program.")
        sys.exit(1)

    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    url = f"http://{HOST}:{PORT}"
    if not wait_for_server(server_thread):
        show_error(f"Flou Player's background service didn't start on {url}.")
        sys.exit(1)

    try:
        webview.create_window("Flou Player", url, width=1280, height=820, min_size=(900, 600))
        WEBVIEW_STORAGE.mkdir(parents=True, exist_ok=True)
        webview.start(gui=GUI_BACKEND, icon=str(APP_ICON), private_mode=False, storage_path=str(WEBVIEW_STORAGE))
    except Exception as exc:
        # If the native window can't come up for some reason (missing system
        # libraries, no display backend available, etc.), don't leave the
        # person with nothing -- fall back to opening it in their normal
        # browser, same as before this file existed.
        print(f"[Flou Player] Could not open the native window ({exc}).")
        print(f"[Flou Player] Falling back to your default browser at {url}")
        import webbrowser

        webbrowser.open(url)
        print("[Flou Player] Server is running. Press Ctrl+C here to stop it.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
    else:
        # The window was closed normally.
        shutdown_and_exit()


if __name__ == "__main__":
    main()
