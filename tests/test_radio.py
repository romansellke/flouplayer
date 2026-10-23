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


def test_search_with_several_words_in_any_order_and_across_fields(directory):
    by_name = client.get("/api/radio/search?q=fm%20jazz").json()["stations"]
    assert [s["name"] for s in by_name] == ["Jazz <FM>"]                  # the directory is asked for the longest word only
    assert directory[0][1]["name"] == "jazz"
    assert client.get("/api/radio/search?q=jazz%20nonsense").json() == {"stations": []}
    assert client.get("/api/radio/search?q=germany%20swing&by=name").json() == {"stations": []}   # country/tags are not the name
    everything = client.get("/api/radio/search?q=germany%20swing&by=all").json()["stations"]
    assert [s["name"] for s in everything] == ["Jazz <FM>"]               # name, genre, country all count
    assert {"name", "tag"} <= {k for _, p in directory for k in p}      # "everything" asks for both name and genre


def test_search_by_country_genre_and_language_filters(directory):
    r = client.get("/api/radio/search?country=Germany&tag=jazz&language=german").json()["stations"]      # no words: only the filters
    assert [s["name"] for s in r] == ["Jazz <FM>"]
    params = directory[0][1]
    assert (params["country"], params["countryExact"], params["tag"], params["tagExact"], params["language"], params["languageExact"]) \
        == ("Germany", "true", "jazz", "true", "german", "true")
    assert "name" not in params
    client.get("/api/radio/search?q=fm&by=tag&country=Germany")                         # words next to a filter are matched against the name
    assert directory[1][1]["name"] == "fm" and "tagExact" not in directory[1][1] and len(directory) == 2


def test_search_by_stream_quality(directory):
    client.get("/api/radio/search?bitrate_min=256&codec=FLAC")                        # quality alone is enough to search
    p = directory[0][1]
    assert p["bitrateMin"] == 256 and p["codec"] == "FLAC" and "codecExact" not in p and "name" not in p
    client.get("/api/radio/search?q=jazz&by=tag")                                     # no quality asked: nothing is added
    assert "bitrateMin" not in directory[1][1] and "codec" not in directory[1][1]


def test_facets_are_listed_cached_and_small_ones_left_out(monkeypatch):
    calls = []
    monkeypatch.setattr(radio, "_facet_cache", {})
    monkeypatch.setattr(radio, "_get", lambda path, params: calls.append(path) or [
        {"name": "jazz", "stationcount": 120}, {"name": "rare", "stationcount": 1}, {"name": "", "stationcount": 50}])
    assert client.get("/api/radio/facets?kind=tag").json() == {"items": [{"name": "jazz", "count": 120}]}
    client.get("/api/radio/facets?kind=tag")
    assert calls == ["tags"]                                                             # the second answer comes from the cache
    assert client.get("/api/radio/facets?kind=country").json()["items"][1]["name"] == "rare"   # countries: even one station counts
    assert client.get("/api/radio/facets?kind=nonsense").status_code == 400


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
