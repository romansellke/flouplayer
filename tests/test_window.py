"""The desktop window's title bar setting and window actions (app/window.py), with a stand-in for the window."""

import time

import pytest
from fastapi.testclient import TestClient

import app.main as m
from app import window

client = TestClient(m.app, base_url="http://127.0.0.1:8765")


class FakeWindow:
    def __init__(self, frameless=False, gpu=False):
        self.frameless = frameless
        self.gpu = gpu
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
    monkeypatch.setattr(window, "GPU_MARKER", tmp_path / "gpu-start")
    monkeypatch.setattr(window, "gpu_fell_back", False)
    monkeypatch.setattr(window, "gpu_forced", False)
    w = FakeWindow()
    monkeypatch.setattr(window, "controller", w)
    return w


def test_without_the_app_window_nothing_is_offered(monkeypatch, tmp_path):
    monkeypatch.setattr(window, "SETTINGS_FILE", tmp_path / "window.json")
    monkeypatch.setattr(window, "controller", None)
    assert client.get("/api/app/window").json() == {
        "available": False,
        "hide_title_bar": False,
        "use_gpu": False,
        "frameless": False,
        "gpu": False,
        "gpu_fell_back": False,
        "gpu_forced": False,
    }
    assert client.post("/api/app/window/action", json={"action": "close"}).status_code == 409
    assert client.post("/api/app/window/move", json={"x": 1, "y": 2}).status_code == 409


def test_hiding_the_title_bar_is_saved_for_the_next_start(fake_window):
    r = client.post("/api/app/window", json={"hide_title_bar": True}).json()
    assert r["hide_title_bar"] is True and r["frameless"] is False  # this window still has its bar
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


def test_the_graphics_card_setting_is_saved_beside_the_title_bar(fake_window):
    client.post("/api/app/window", json={"hide_title_bar": True})
    r = client.post("/api/app/window", json={"use_gpu": True}).json()
    assert r["use_gpu"] is True and r["gpu"] is False  # from the next start
    assert window.use_gpu() is True and window.hide_title_bar() is True  # one doesn't overwrite the other


def test_a_start_with_the_graphics_card_that_crashed_switches_it_off_again(fake_window):
    assert window.start_gpu(None) is False  # off by default
    window._save(use_gpu=True)
    assert window.start_gpu(None) is True and window.GPU_MARKER.exists()
    window.clean_exit()  # closed as it should
    assert not window.GPU_MARKER.exists()
    assert window.start_gpu(None) is True
    # ... and this time it crashes: the marker stays, the next start draws without the graphics card
    assert window.start_gpu(None) is False
    assert window.use_gpu() is False and not window.GPU_MARKER.exists()
    assert client.get("/api/app/window").json()["gpu_fell_back"] is True
    client.post("/api/app/window", json={"use_gpu": True})  # chosen again
    assert client.get("/api/app/window").json()["gpu_fell_back"] is False


def test_flou_gpu_decides_over_the_setting(fake_window):
    window._save(use_gpu=True)
    assert window.start_gpu("0") is False and window.gpu_forced is True
    assert window.start_gpu("1") is True and not window.GPU_MARKER.exists()  # no fallback for a forced start
    window._save(use_gpu=False)
    assert window.start_gpu("1") is True
