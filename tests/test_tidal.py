"""TIDAL endpoints against a fake tidalapi session (no network, no TIDAL account)."""
import datetime
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient

import app.main as m
from app import devices as devices_api, state as app_state, tidal
from app.didl import parse_didl
from tests.fakes import linn_player, oh

client = TestClient(m.app, base_url="http://127.0.0.1:8765")   # the backend only answers local requests


class Pic:
    def __init__(self, url): self.url = url
    def image(self, size=320): return self.url


def fake_album(i=1, cover="http://img/a.jpg"):
    a = Pic(cover)
    a.id, a.name, a.artist, a.num_tracks, a.audio_quality = i, "Blue & Green", NS(name="Miles"), 2, "LOSSLESS"
    a.release_date = datetime.datetime(1959, 8, 17)
    return a


def fake_track(i, album=None, available=True):
    return NS(id=i, name=f"Song <{i}>", artist=NS(name="Miles"), album=album or fake_album(), duration=185,
              track_num=i, volume_num=1, audio_quality="HI_RES_LOSSLESS", available=available)


class FakeSession:
    def __init__(self):
        self.access_token = "tok"
        self.user = NS(username="miles@example.org", id=1)
        self.searches = []

    def search(self, q, models=None, limit=50):
        self.searches.append((q, limit))
        artist = Pic("http://img/m.jpg"); artist.id, artist.name = 7, "Miles"
        return {"artists": [artist], "albums": [fake_album()], "tracks": [fake_track(11)]}

    def album(self, album_id):
        a = fake_album(int(album_id))
        a.tracks = lambda: [fake_track(1, a), fake_track(2, a, available=False)]
        return a

    def artist(self, artist_id):
        a = Pic(""); a.id, a.name = int(artist_id), "Miles"
        a.get_albums = lambda: [fake_album(1)]
        def no_singles(): raise RuntimeError("404")
        a.get_albums_ep_singles = no_singles
        return a


@pytest.fixture
def session(monkeypatch):
    s = FakeSession()
    monkeypatch.setattr(tidal, "_session", s)
    yield s


def test_without_a_login_browsing_is_refused(monkeypatch):
    monkeypatch.setattr(tidal, "_session", None)
    assert client.get("/api/tidal/status").json()["logged_in"] is False
    assert client.get("/api/tidal/search?q=miles").status_code == 401


def test_search_returns_artists_albums_and_tracks_ready_for_the_device_queue(session):
    r = client.get("/api/tidal/search?q=miles").json()
    assert [a["name"] for a in r["artists"]] == ["Miles"] and r["artists"][0]["picture"] == "http://img/m.jpg"
    assert r["albums"][0] == {"id": "1", "title": "Blue & Green", "artist": "Miles", "year": 1959, "tracks": 2,
                              "quality": "LOSSLESS", "album_art": "http://img/a.jpg"}
    t = r["tracks"][0]
    assert t["uri"] == "tidal://track?version=1&trackId=11" and t["duration"] == 185
    # the metadata is valid DIDL-Lite (escaped) that the queue can read back
    meta = parse_didl(t["metadata"])[0]
    assert (meta["title"], meta["artist"], meta["album"], meta["album_art"]) == ("Song <11>", "Miles", "Blue & Green", "http://img/a.jpg")
    assert meta["resources"][0]["uri"] == t["uri"] and meta["resources"][0]["duration"] == "0:03:05"


def test_empty_search_does_not_ask_tidal(session):
    assert client.get("/api/tidal/search?q=%20").json() == {"artists": [], "albums": [], "tracks": []}
    assert session.searches == []


def test_album_and_artist(session):
    r = client.get("/api/tidal/albums/5").json()
    assert r["album"]["id"] == "5" and [t["available"] for t in r["tracks"]] == [True, False]
    r = client.get("/api/tidal/artists/7").json()
    assert r["artist"]["name"] == "Miles" and [a["id"] for a in r["albums"]] == ["1"]   # no EPs/singles is not an error


def test_tidal_errors_become_502(session, monkeypatch):
    def boom(*a, **k): raise RuntimeError("down")
    monkeypatch.setattr(session, "search", boom)
    r = client.get("/api/tidal/search?q=x")
    assert r.status_code == 502 and "down" in r.json()["detail"]


def test_a_refreshed_token_is_saved_with_private_permissions(session, monkeypatch):
    session.token_type, session.refresh_token, session.is_pkce = "Bearer", "ref", False
    def refreshing(*a, **k):
        session.access_token = "new"
        return {"artists": [], "albums": [], "tracks": []}
    monkeypatch.setattr(session, "search", refreshing)
    client.get("/api/tidal/search?q=x")
    assert '"new"' in tidal.SESSION_FILE.read_text()
    assert tidal.SESSION_FILE.stat().st_mode & 0o077 == 0
    client.post("/api/tidal/logout")
    assert not tidal.SESSION_FILE.exists() and tidal._session is None


def test_device_tidal_login_is_read_from_the_credentials_service():
    player, av, _ = linn_player()
    cred = {"UserName": "miles", "Enabled": True, "Status": ""}
    player.services.append(oh("Credentials", 1, {"Get": lambda Id: dict(cred) if Id == "tidal.com" else {}}))
    devices_api._publish_devices({player.udn: player, av.udn: av})
    try:
        assert client.get(f"/api/devices/{player.udn}/tidal").json()["ready"] is True
        cred["Status"] = "Login failed"
        r = client.get(f"/api/devices/{player.udn}/tidal").json()
        assert r["ready"] is False and r["status"] == "Login failed"
    finally:
        app_state.devices.clear()


def test_a_device_without_credentials_service():
    player, av, _ = linn_player()
    devices_api._publish_devices({player.udn: player, av.udn: av})
    try:
        assert client.get(f"/api/devices/{player.udn}/tidal").json() == {"supported": False}
    finally:
        app_state.devices.clear()


def test_device_login_shows_link_and_code_then_logs_in(monkeypatch):
    import concurrent.futures
    import tidalapi
    fut = concurrent.futures.Future()
    created = []

    class LoginSession(FakeSession):
        token_type, refresh_token, is_pkce = "Bearer", "ref", False
        def __init__(self):
            super().__init__(); created.append(self)
        def login_oauth(self):
            return NS(verification_uri_complete="link.tidal.com/ABCDE", user_code="ABCDE", expires_in=300), fut
        def check_login(self): return True

    monkeypatch.setattr(tidal, "_session", None)
    monkeypatch.setattr(tidalapi, "Session", LoginSession)
    r = client.post("/api/tidal/login").json()
    assert r["logged_in"] is False and r["login"]["url"] == "https://link.tidal.com/ABCDE" and r["login"]["code"] == "ABCDE"
    assert client.post("/api/tidal/login").json()["login"]["code"] == "ABCDE" and len(created) == 1   # a second click reuses the running login
    fut.set_result(None)                                                          # confirmed in the browser
    r = client.get("/api/tidal/status").json()
    assert r["logged_in"] is True and r["user"] == "miles@example.org" and "login" not in r
    assert tidal.SESSION_FILE.exists()
    client.post("/api/tidal/logout")


def test_an_expired_device_login_reports_the_error(monkeypatch):
    import concurrent.futures
    import tidalapi
    fut = concurrent.futures.Future()

    class LoginSession(FakeSession):
        def login_oauth(self):
            return NS(verification_uri_complete="https://link.tidal.com/X", user_code="X", expires_in=1), fut

    monkeypatch.setattr(tidal, "_session", None)
    monkeypatch.setattr(tidalapi, "Session", LoginSession)
    client.post("/api/tidal/login")
    fut.set_exception(TimeoutError("You took too long to log in"))
    r = client.get("/api/tidal/status").json()
    assert r["logged_in"] is False and "login" not in r and "too long" in r["error"]
