"""
Standalone desktop entry point for Flou Player.

Runs the existing FastAPI app (app/main.py) in a background thread, exactly
as before, but instead of telling the person to open a browser tab, it opens
a native application window (via pywebview) pointed at the local server.
From the user's perspective this is a normal desktop app with its own
window and no visible browser chrome -- nothing else about the app changes.

Why pywebview: it's a thin wrapper around the operating system's own web
rendering engine (WebKitGTK on Linux, WebView2 on Windows, WKWebView on
macOS), so it reuses 100% of the existing HTML/CSS/JS frontend unchanged.
"""
import sys
import threading
import time

import uvicorn
import webview

from app.main import app

HOST = "127.0.0.1"
PORT = 8765

# On Linux, pywebview tries GTK first and only falls back to Qt if GTK's
# Python bindings ('gi') aren't installed -- which prints a harmless but
# alarming-looking traceback along the way. We install the Qt backend
# (PyQt5/PyQtWebEngine) specifically, so just tell it to use Qt directly
# and skip the GTK probe entirely. On macOS/Windows, leave it on auto
# (None) so it uses the natural native backend (Cocoa/EdgeChromium)
# instead of requiring Qt there too.
GUI_BACKEND = "qt" if sys.platform.startswith("linux") else None


def run_server():
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


def wait_for_server(url: str, timeout: float = 10.0) -> bool:
    """Polls the server until it responds or the timeout is hit, so the
    window doesn't open onto a blank page during the brief startup window."""
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=0.5)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def main() -> None:
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    url = f"http://{HOST}:{PORT}"
    wait_for_server(url)

    try:
        webview.create_window("Flou Player", url, width=1280, height=820, min_size=(900, 600))
        webview.start(gui=GUI_BACKEND)
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


if __name__ == "__main__":
    main()
