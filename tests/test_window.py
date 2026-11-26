"""The desktop window's title bar setting and window actions (app/window.py), with a stand-in for the window."""

import time

import pytest
from fastapi.testclient import TestClient

import app.main as m
from app import window

client = TestClient(m.app, base_url="http://127.0.0.1:8765")


class FakeWindow:
    def __init__(self, frameless=False):
        self.frameless = frameless
        self.calls = []

    def close(self):
        self.calls.append("close")

    def minimize(self):
        self.calls.append("minimize")

    def toggle_maximize(self):
        self.calls.append("maximize")

    def toggle_fullscreen(self):
        self.calls.append("fullscreen")

    def move(self, x, y):
        self.calls.append(("move", x, y))


@pytest.fixture
def fake_window(monkeypatch, tmp_path):
    monkeypatch.setattr(window, "SETTINGS_FILE", tmp_path / "window.json")
    w = FakeWindow()
    monkeypatch.setattr(window, "controller", w)
    return w


def test_without_the_app_window_nothing_is_offered(monkeypatch, tmp_path):
    monkeypatch.setattr(window, "SETTINGS_FILE", tmp_path / "window.json")
    monkeypatch.setattr(window, "controller", None)
    assert client.get("/api/app/window").json() == {"available": False, "hide_title_bar": False, "frameless": False}
    assert client.post("/api/app/window/action", json={"action": "close"}).status_code == 409
    assert client.post("/api/app/window/move", json={"x": 1, "y": 2}).status_code == 409


def test_hiding_the_title_bar_is_saved_for_the_next_start(fake_window):
    r = client.post("/api/app/window", json={"hide_title_bar": True}).json()
    assert r == {"available": True, "hide_title_bar": True, "frameless": False}  # this window still has its bar
    assert window.hide_title_bar() is True  # what desktop.py reads when it opens the window
    client.post("/api/app/window", json={"hide_title_bar": False})
    assert window.hide_title_bar() is False


def test_a_broken_settings_file_means_the_title_bar_shows(fake_window):
    window.SETTINGS_FILE.write_text("not json")
    assert window.hide_title_bar() is False


def test_window_actions_reach_the_window(fake_window):
    for action in ("minimize", "maximize", "fullscreen"):
        assert client.post("/api/app/window/action", json={"action": action}).status_code == 200
    assert client.post("/api/app/window/move", json={"x": 120, "y": -4}).status_code == 200
    assert client.post("/api/app/window/action", json={"action": "close"}).status_code == 200
    deadline = time.monotonic() + 2
    while "close" not in fake_window.calls and time.monotonic() < deadline:
        time.sleep(0.02)  # closing waits for the answer to go out first
    assert fake_window.calls == ["minimize", "maximize", "fullscreen", ("move", 120, -4), "close"]
    assert client.post("/api/app/window/action", json={"action": "explode"}).status_code == 400
