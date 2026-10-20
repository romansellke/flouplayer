"""Shared test setup.

HOME is pointed at a temporary directory *before* the app is imported, so the
tests never read or write the real ~/.cache/flou_player (library cache, known
devices).
"""
import os
import sys
import tempfile

# Playwright looks for its browsers under HOME: keep pointing it at the real
# download folder, or the UI tests would silently skip.
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", os.path.expanduser(
    "~/Library/Caches/ms-playwright" if sys.platform == "darwin" else "~/.cache/ms-playwright"))
_HOME = tempfile.mkdtemp(prefix="flou-test-home-")
os.environ["HOME"] = _HOME

# ---------- UI tests (Playwright) ----------
import functools
import http.server
import json
import pathlib
import threading

import pytest

STATIC_ROOT = pathlib.Path(__file__).resolve().parent.parent / "app"   # serves /static/index.html


@pytest.fixture(scope="session")
def base_url():
    """The static UI files on a local port (no backend: the API is mocked per test)."""
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(STATIC_ROOT))
    handler.log_message = lambda *a, **k: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}/static/index.html"
    server.shutdown()


@pytest.fixture(scope="session")
def _browser():
    sync_playwright = pytest.importorskip("playwright.sync_api").sync_playwright
    with sync_playwright() as p:
        exe = os.environ.get("FLOU_TEST_CHROMIUM")   # optional: use an existing Chromium
        try:
            b = p.chromium.launch(executable_path=exe) if exe else p.chromium.launch()
        except Exception as e:                        # browser not installed
            if os.environ.get("CI"):                  # in CI a missing browser is an error, not a reason to skip
                raise
            pytest.skip(f"Chromium not available for the UI tests: {e}")
        yield b
        b.close()


class MockApi:
    """Answers the page's /api/... requests. routes: {"substring of the URL": json | callable(request) -> json}.
    The first matching route wins; everything else is 404. POST bodies are collected in `posts`."""

    def __init__(self):
        self.routes = {}
        self.posts = []
        self.requests = []

    def handle(self, route):
        req = route.request
        url = req.url.split("/api/", 1)[1]
        self.requests.append(f"{req.method} {url}")
        if req.method == "POST" and req.post_data and not url.startswith("media/"):   # media/state: background reporting, not a user action
            try:
                self.posts.append(json.loads(req.post_data))
            except ValueError:
                pass
        for needle, answer in self.routes.items():
            if needle in url:
                body = answer(req) if callable(answer) else answer
                if isinstance(body, tuple):                   # (status, json): an error answer
                    return route.fulfill(status=body[0], json=body[1])
                return route.fulfill(json=body)
        route.fulfill(status=404, json={"detail": "not mocked"})

    def actions(self):
        """The control actions posted so far, e.g. ['play', 'seek:40'], and clear them."""
        out = [p["action"] + (f":{p['value']}" if p.get("value") is not None else "") for p in self.posts if "action" in p]
        self.posts.clear()
        return out


@pytest.fixture
def api():
    return MockApi()


@pytest.fixture
def page(_browser, api, base_url):
    ctx = _browser.new_context(viewport={"width": 1500, "height": 700})
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)))
    pg.route("**/api/**", api.handle)
    pg.base_url = base_url
    yield pg
    ctx.close()
    assert not pg.errors, f"JavaScript errors on the page: {pg.errors}"


def open_app(page):
    page.goto(page.base_url)
    page.wait_for_load_state("domcontentloaded")
    return page
