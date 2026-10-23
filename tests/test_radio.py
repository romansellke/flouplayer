"""Radio endpoints against a fake station directory (no network)."""
import pytest
from fastapi.testclient import TestClient

import app.main as m
from app import radio
from app.didl import parse_didl

client = TestClient(m.app, base_url="http://127.0.0.1:8765")   # the backend only answers local requests

STATIONS = [
    {"stationuuid": "u1", "name": "Jazz <FM>", "url_resolved": "https://jazz.example/stream.aac", "codec": "AAC", "bitrate": 128,
     "country": "Germany", "tags": "jazz,blues,soul,swing", "favicon": "http://img/jazz.png"},
    {"stationuuid": "u2", "name": "Dup", "url_resolved": "https://jazz.example/stream.aac", "codec": "AAC", "bitrate": 64},
    {"stationuuid": "u3", "name": "Broken URL", "url_resolved": "", "url": "ftp://x"},
]


@pytest.fixture
def directory(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(radio, "_get", lambda path, params: calls.append((path, params)) or STATIONS)
    monkeypatch.setattr(radio, "FAVOURITES_FILE", tmp_path / "radio.json")
    monkeypatch.setattr(radio, "CACHE_DIR", tmp_path)
    return calls


def test_search_returns_playable_stations_with_live_item_metadata(directory):
    r = client.get("/api/radio/search?q=jazz").json()["stations"]
    assert len(r) == 1                                        # duplicate URL and non-http URL left out
    s = r[0]
    assert (s["name"], s["uri"], s["codec"], s["bitrate"]) == ("Jazz <FM>", "https://jazz.example/stream.aac", "AAC", 128)
    assert s["tags"] == "jazz,blues,soul"
    meta = parse_didl(s["metadata"])[0]
    assert meta["title"] == "Jazz <FM>" and meta["album_art"] == "http://img/jazz.png"
    assert "audioBroadcast" in s["metadata"] and "audio/aac" in s["metadata"]
    assert directory[0][1]["name"] == "jazz" and directory[0][1]["hidebroken"] == "true"


def test_search_by_genre_and_empty_query(directory):
    client.get("/api/radio/search?q=jazz&by=tag")
    assert directory[0][1]["tag"] == "jazz" and "name" not in directory[0][1]
    assert client.get("/api/radio/search?q=%20").json() == {"stations": []}
    assert len(directory) == 1


def test_favourites_add_own_url_and_remove(directory):
    assert client.get("/api/radio/favourites").json() == {"stations": []}
    own = client.post("/api/radio/favourites", json={"name": "Mine", "url": "http://host:8000/live"}).json()["station"]
    assert own["id"].startswith("own-") and own["uri"] == "http://host:8000/live"
    client.post("/api/radio/favourites", json={"name": "Mine again", "url": "http://host:8000/live"})   # same URL: replaced
    assert [s["name"] for s in client.get("/api/radio/favourites").json()["stations"]] == ["Mine again"]
    client.delete("/api/radio/favourites/" + own["id"])
    assert client.get("/api/radio/favourites").json()["stations"] == []


def test_only_http_urls_are_accepted(directory):
    assert client.post("/api/radio/favourites", json={"url": "file:///etc/passwd"}).status_code == 400
    assert client.post("/api/radio/favourites", json={"url": "nonsense"}).status_code == 400


def test_a_broken_favourites_file_is_ignored(directory, tmp_path):
    (tmp_path / "radio.json").write_text("{not json")
    assert client.get("/api/radio/favourites").json() == {"stations": []}
