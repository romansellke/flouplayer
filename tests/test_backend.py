"""Backend tests: the FastAPI endpoints against fake UPnP devices (no network, no hardware)."""
import json

import pytest
import upnpclient
from fastapi.testclient import TestClient

import app as app_pkg
import app.main as m
from app import devices as devices_api, state as app_state
from tests.fakes import linn_player, media_server

client = TestClient(m.app)

TRACK = ('<item id="t1" parentID="a1"><dc:title>Song</dc:title><upnp:artist>Artist</upnp:artist><upnp:album>Album</upnp:album>'
         '<upnp:class>object.item.audioItem.musicTrack</upnp:class>'
         '<res protocolInfo="http-get:*:audio/flac:*" duration="0:03:00">http://x/t1.flac</res></item>')
FOLDER = '<container id="a1" parentID="0" childCount="1"><dc:title>Albums</dc:title><upnp:class>object.container</upnp:class></container>'


@pytest.fixture
def player():
    oh, av, state = linn_player()
    devices_api._publish_devices({oh.udn: oh, av.udn: av})
    yield oh, state
    app_state.devices.clear()


def get(path):
    return client.get(path)


def control(device, action, value=None):
    return client.post("/api/control", json={"device_id": device.udn, "action": action, "value": value})


# ---------- discovery ----------

def test_discover_presents_a_linn_player_once_and_remembers_it(monkeypatch):
    oh, av, _ = linn_player()
    srv = media_server()
    monkeypatch.setattr(upnpclient, "discover", lambda timeout=4: [oh, av, srv])
    r = client.get("/api/discover").json()["devices"]
    names = sorted(d["name"] for d in r)
    assert names == ["Linn Majik DSM", "Music Server"]          # the sibling "UPnP AV" device is hidden
    by_name = {d["name"]: d for d in r}
    assert by_name["Music Server"]["server"] and not by_name["Music Server"]["renderer"]
    assert by_name["Linn Majik DSM"]["renderer"]
    known = json.loads(app_state.KNOWN_DEVICES_FILE.read_text())
    assert set(known) == {oh.udn, av.udn, srv.udn}               # incl. the sibling, needed later for the OpenHome services


def test_restore_reconnects_by_url_and_skips_dead_devices(monkeypatch):
    oh, av, _ = linn_player()
    srv = media_server()
    gone = "http://192.168.1.99:1/gone.xml"
    app_state.KNOWN_DEVICES_FILE.write_text(json.dumps({oh.udn: oh.location, av.udn: av.location, srv.udn: srv.location, "uuid:gone": gone}))
    by_url = {d.location: d for d in (oh, av, srv)}

    def fake_device(location):
        if location not in by_url:
            raise OSError("unreachable")
        return by_url[location]

    monkeypatch.setattr(upnpclient, "Device", fake_device)
    r = client.post("/api/devices/restore").json()["devices"]
    assert sorted(d["name"] for d in r) == ["Linn Majik DSM", "Music Server"]
    assert set(app_state.devices) == {oh.udn, av.udn, srv.udn}


def test_restore_without_saved_devices_is_empty():
    app_state.KNOWN_DEVICES_FILE.unlink(missing_ok=True)
    assert client.post("/api/devices/restore").json() == {"devices": []}


def test_unknown_device_is_404():
    assert get("/api/devices/nope/sources").status_code == 404
    assert client.post("/api/control", json={"device_id": "nope", "action": "play"}).status_code == 404


# ---------- OpenHome extras ----------

def test_sources_lists_visible_sources_and_the_current_one(player):
    oh, state = player
    r = get(f"/api/devices/{oh.udn}/sources").json()
    assert [s["name"] for s in r["sources"]] == ["Playlist", "Radio"]     # the hidden one is left out
    assert r["current"] == 0
    state["source"] = 1
    assert get(f"/api/devices/{oh.udn}/sources?light=true").json() == {"current": 1}


def test_pins_skip_empty_slots_and_keep_the_slot_number(player):
    oh, _ = player
    r = get(f"/api/devices/{oh.udn}/pins").json()
    assert r["supported"] is True
    assert [(p["slot"], p["title"]) for p in r["pins"]] == [(0, "Classic FM"), (2, "Playlist 1")]


def test_stream_details_from_the_info_service(player):
    oh, _ = player
    r = get(f"/api/devices/{oh.udn}/stream").json()
    assert (r["codec"], r["sample_rate"], r["bit_depth"], r["bit_rate"]) == ("FLAC", 44100, 16, 1011000)


def test_capabilities_unknown_stays_none_and_false_is_reported(player):
    oh, _ = player
    r = get(f"/api/devices/{oh.udn}/capabilities").json()
    assert (r["can_pause"], r["can_skip_next"], r["can_skip_previous"]) == (False, False, True)


def test_firmware_reports_an_available_update(player):
    oh, _ = player
    r = get(f"/api/devices/{oh.udn}/firmware").json()
    assert r["version"] == "4.99.491" and r["update"]["version"] == "4.100.502"


def test_standby_state_and_toggle(player):
    oh, state = player
    assert get(f"/api/devices/{oh.udn}/standby").json() == {"supported": True, "standby": False}
    assert control(oh, "standby", 1).status_code == 200
    assert state["standby"] is True
    assert get(f"/api/devices/{oh.udn}/standby").json()["standby"] is True
    control(oh, "standby", 0)
    assert state["standby"] is False


def test_mute_sends_a_string_not_a_bool(player):
    """upnpclient validates boolean arguments as strings: a real bool fails with
    "'bool' object has no attribute 'lower'" (this was a real bug)."""
    oh, state = player
    assert control(oh, "mute", 1).status_code == 200
    assert state["muted"] is True
    sent = oh.service("Volume").calls[-1][1]["Value"]
    assert isinstance(sent, str)
    assert get(f"/api/devices/{oh.udn}/volume").json()["muted"] is True


def test_source_and_pin_wake_a_sleeping_device(player):
    oh, state = player
    state["standby"] = True
    assert control(oh, "set_source", 1).status_code == 200
    assert state["standby"] is False and state["source"] == 1
    state["standby"] = True
    assert control(oh, "invoke_pin", 2).status_code == 200
    assert state["standby"] is False and state["pin_calls"] == [2]


# ---------- transport ----------

def test_transport_buttons_use_the_openhome_transport_service(player):
    oh, _ = player
    for action, expected in (("play", "Play"), ("pause", "Pause"), ("stop", "Stop"), ("next", "SkipNext"), ("previous", "SkipPrevious")):
        assert control(oh, action).status_code == 200
        assert oh.service("Transport").calls[-1][0] == expected


def test_transport_falls_back_to_avtransport(player, monkeypatch):
    oh, _ = player
    monkeypatch.setitem(oh.service("Transport").actions, "Play", lambda: (_ for _ in ()).throw(OSError("701")))
    assert control(oh, "play").status_code == 200
    av = app_state.devices[oh.udn.replace("-oh", "-av")].services[0]
    assert av.calls[-1][0] == "Play"


# ---------- plain UPnP AV renderers (Marantz/HEOS, Sonos) ----------

def av_only_renderer(actions):
    from tests.fakes import FakeDevice, FakeService
    av = FakeService("urn:upnp-org:serviceId:AVTransport", "urn:schemas-upnp-org:service:AVTransport:1", actions)
    dev = FakeDevice("uuid:sonos", "http://192.168.1.60:1400/xml/device_description.xml", "Sonos Arc", [av])
    devices_api._publish_devices({dev.udn: dev})
    return dev, av


def play(dev, uri="http://x/t.flac", metadata="<DIDL-Lite/>"):
    return client.post("/api/control", json={"device_id": dev.udn, "action": "set_uri", "uri": uri, "metadata": metadata})


def test_set_uri_retries_without_metadata_when_the_renderer_refuses_it():
    def set_uri(InstanceID, CurrentURI, CurrentURIMetaData):
        if CurrentURIMetaData: raise upnpclient.UPNPError(712, "Format of metadata invalid", None)
        return {}
    dev, av = av_only_renderer({"Stop": {}, "SetAVTransportURI": set_uri, "Play": {}})
    assert play(dev).status_code == 200
    assert [c[0] for c in av.calls] == ["Stop", "SetAVTransportURI", "SetAVTransportURI", "Play"]
    assert av.calls[2][1]["CurrentURIMetaData"] == ""


def test_av_calls_send_a_utf8_charset_content_type():
    """HEOS/Sonos answer upnpclient's bare text/xml with 400 Bad Request."""
    dev, av = av_only_renderer({"Stop": {}, "SetAVTransportURI": {}, "Play": {}})
    assert play(dev).status_code == 200
    assert av.headers == {"Content-Type": 'text/xml; charset="utf-8"'}


def test_set_uri_falls_back_to_a_minimal_didl_before_no_metadata():
    seen = []
    def set_uri(InstanceID, CurrentURI, CurrentURIMetaData):
        seen.append(CurrentURIMetaData)
        if len(seen) < 2: raise upnpclient.UPNPError(712, "Format of metadata invalid", None)
        return {}
    dev, av = av_only_renderer({"SetAVTransportURI": set_uri, "Play": {}})
    full = ('<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" '
            'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="9" parentID="3"><dc:title>A &amp; B</dc:title>'
            '<upnp:class>object.item.audioItem.musicTrack</upnp:class><res protocolInfo="http-get:*:audio/flac:*">http://x/t.flac</res></item></DIDL-Lite>')
    assert play(dev, metadata=full).status_code == 200
    assert len(seen) == 2 and seen[0] == full
    assert 'parentID="-1"' in seen[1] and "A &amp; B" in seen[1] and "http-get:*:audio/flac:*" in seen[1]


def test_set_uri_names_the_http_refusal(monkeypatch):
    import requests
    monkeypatch.setattr("app.control.time.sleep", lambda s: None)
    resp = requests.Response(); resp.status_code = 400; resp.reason = "Bad Request"; resp.url = "http://192.168.2.111:8080/AVTransport/ctrl"; resp._content = b"<html>bad</html>"
    def bad(**kw): raise requests.exceptions.HTTPError("400 Client Error", response=resp)
    dev, av = av_only_renderer({"SetAVTransportURI": bad, "Play": {}})
    detail = play(dev).json()["detail"]
    assert "HTTP 400 Bad Request from http://192.168.2.111:8080/AVTransport/ctrl" in detail and "bad" in detail


def test_set_uri_retries_play_while_the_renderer_loads(monkeypatch):
    monkeypatch.setattr("app.control.time.sleep", lambda s: None)
    tries = []
    def pl(InstanceID, Speed):
        tries.append(1)
        if len(tries) < 3: raise upnpclient.UPNPError(701, "Transition not available", None)
        return {}
    dev, av = av_only_renderer({"SetAVTransportURI": {}, "Play": pl})   # no Stop action: ignored
    assert play(dev).status_code == 200 and len(tries) == 3


def test_set_uri_reports_the_upnp_error_code(monkeypatch):
    monkeypatch.setattr("app.control.time.sleep", lambda s: None)
    def bad(**kw): raise upnpclient.UPNPError(714, "Illegal MIME-type", None)
    dev, av = av_only_renderer({"SetAVTransportURI": bad, "Play": {}})
    r = play(dev)
    assert r.status_code == 502 and "SetAVTransportURI failed" in r.json()["detail"] and "714" in r.json()["detail"]


# ---------- library ----------

def test_browse_pages_through_a_folder():
    srv = media_server(tree={"0": [FOLDER], "a1": [TRACK]})
    devices_api._publish_devices({srv.udn: srv})
    root = client.post("/api/browse", json={"device_id": srv.udn, "object_id": "0"}).json()
    assert [(i["type"], i["title"]) for i in root["items"]] == [("container", "Albums")]
    tracks = client.post("/api/browse", json={"device_id": srv.udn, "object_id": "a1"}).json()
    t = tracks["items"][0]
    assert (t["title"], t["artist"], t["album"]) == ("Song", "Artist", "Album")
    assert t["resources"][0]["uri"] == "http://x/t1.flac"


def test_scan_collects_all_tracks_and_caches_them():
    srv = media_server(tree={"0": [FOLDER], "a1": [TRACK]})
    devices_api._publish_devices({srv.udn: srv})
    r = client.post("/api/scan", json={"device_id": srv.udn, "object_id": "0"}).json()
    assert r["count"] == 1 and r["tracks"][0]["title"] == "Song"
    assert client.get("/api/library/cached").json()["count"] == 1
    assert client.delete("/api/library/cached").status_code == 200
    assert client.get("/api/library/cached").status_code == 404


def audio(i, title="Song", album="Album", uri=None, cls="object.item.audioItem.musicTrack", duration="0:03:00"):
    return (f'<item id="{i}" parentID="x"><dc:title>{title}</dc:title><upnp:artist>Artist</upnp:artist><upnp:album>{album}</upnp:album>'
            f'<upnp:class>{cls}</upnp:class><res protocolInfo="http-get:*:audio/flac:*" duration="{duration}">{uri or "http://x/" + i}</res></item>')


def folder(i, title):
    return f'<container id="{i}" parentID="0"><dc:title>{title}</dc:title><upnp:class>object.container</upnp:class></container>'


def scan(srv):
    devices_api._publish_devices({srv.udn: srv})
    return client.post("/api/scan", json={"device_id": srv.udn, "object_id": "0"})


def test_scan_merges_the_same_track_listed_under_different_ids_and_urls():
    """Jellyfin-style: every view lists the track again with its own object id and stream URL."""
    srv = media_server(tree={"0": [folder("a", "Genres"), folder("b", "Artists")],
                             "a": [audio("t1", uri="http://x/a/1"), audio("t2", title="Other", uri="http://x/a/2")],
                             "b": [audio("t1b", uri="http://x/b/1"), audio("t2b", title="Other", uri="http://x/b/2")]})
    r = scan(srv).json()
    assert r["count"] == 2 and r["stats"]["merged_by_tags"] == 2 and r["stats"]["folders"] == 3


def test_scan_merges_a_track_whose_views_differ_in_artist_number_and_duration_format():
    def t(i, artist, number, duration):
        return (f'<item id="{i}" parentID="x"><dc:title>Song</dc:title><upnp:artist>{artist}</upnp:artist><upnp:album>Album</upnp:album>'
                f'<upnp:originalTrackNumber>{number}</upnp:originalTrackNumber><upnp:class>object.item.audioItem.musicTrack</upnp:class>'
                f'<res protocolInfo="http-get:*:audio/flac:*" duration="{duration}">http://x/{i}</res></item>')
    srv = media_server(tree={"0": [folder("a", "Genres"), folder("b", "Composers")],
                             "a": [t("1", "Band", "1", "0:03:00")], "b": [t("2", "Band feat. X", "", "0:03:00.000")]})
    assert scan(srv).json()["count"] == 1


def test_scan_prefers_a_flat_songs_view_or_the_album_view_over_walking_every_view():
    srv = media_server(tree={"0": [folder("g", "Genres"), folder("s", "Songs"), folder("r", "Artists")],
                             "g": [audio("g1", title="Only in genre", uri="g")], "r": [audio("r1", title="Only in artist", uri="r")],
                             "s": [audio("t1", uri="u1")]})
    r = scan(srv).json()
    assert r["count"] == 1 and r["scan_root"] == "Songs" and "Genres" in r["stats"]["root_folders"]
    srv = media_server(tree={"0": [folder("g", "Genres"), folder("al", "Albums")], "g": [audio("g1", title="Genre only", uri="g")], "al": [audio("t1", uri="u1")]})
    assert scan(srv).json()["scan_root"] == "Albums"


def test_scan_keeps_tracks_that_only_differ_in_number_or_album():
    srv = media_server(tree={"0": [folder("a", "Albums")],
                             "a": [audio("t1", uri="u1"), audio("t2", album="Other", uri="u2"), audio("t3", duration="0:04:00", uri="u3")]})
    assert scan(srv).json()["count"] == 3


def test_scan_recognises_a_bracketed_folder_view_name():
    srv = media_server(tree={"0": [folder("a", "[Folders]"), folder("g", "Genres")], "a": [audio("t1")], "g": [audio("g1", title="Genre only", uri="g")]})
    r = scan(srv).json()
    assert r["count"] == 1 and r["scan_root"] == "[Folders]"


def test_scan_skips_videos():
    srv = media_server(tree={"0": [folder("a", "Folders")], "a": [audio("v", cls="object.item.videoItem.movie"), audio("t1")]})
    assert scan(srv).json()["count"] == 1


def test_scan_finds_a_folder_view_one_level_down():
    srv = media_server(tree={"0": [folder("m", "Music"), folder("v", "Movies")],
                             "m": [folder("ma", "Albums"), folder("mf", "Folders")],
                             "mf": [audio("t1")], "ma": [audio("t1x", uri="other"), audio("t9", title="Never")]})
    r = scan(srv).json()
    assert r["count"] == 1 and r["scan_root"] == "Music / Folders"


def test_scan_stops_in_a_tree_that_loops_with_new_ids():
    """A container that lists itself again under a fresh object id must not run away."""
    tree = {"0": [folder("n0", "Loop")], "n0": [audio("t1")]}
    for n in range(60):
        tree[f"n{n}"] = tree.get(f"n{n}", []) + [folder(f"n{n + 1}", "Loop")]
    r = scan(media_server(tree=tree)).json()
    assert r["count"] == 1 and r["stats"]["loops_skipped"] >= 1


def test_a_running_scan_can_be_cancelled(monkeypatch):
    import threading
    srv = media_server(tree={"0": [folder("a", "Albums")], "a": [audio("t1")]})
    devices_api._publish_devices({srv.udn: srv})
    gate = threading.Event()
    client.delete("/api/library/cached")
    from app import library
    orig = library.browse_all
    def slow(s, oid):
        if oid == "a": gate.wait(5)
        return orig(s, oid)
    monkeypatch.setattr(library, "browse_all", slow)
    result = {}
    th = threading.Thread(target=lambda: result.update(r=client.post("/api/scan", json={"device_id": srv.udn, "object_id": "0"})))
    th.start()
    for _ in range(100):
        if app_state.scan_state["running"]: break
        threading.Event().wait(0.02)
    assert client.post("/api/scan/cancel").json()["was_running"] is True
    gate.set(); th.join(10)
    assert result["r"].status_code == 409 and not app_state.scan_state["running"]
    assert client.get("/api/library/cached").status_code == 404


# ---------- misc ----------

def test_about_reports_the_package_version():
    r = client.get("/api/app/about").json()
    assert r["version"] == app_pkg.__version__
    assert r["name"] == "Flou Player"
    assert "changelog" in r and "source" in r


# ---------- the device queue (OpenHome Playlist) ----------

def queue(device, **kw):
    return client.post(f"/api/devices/{device.udn}/queue", json=kw)


def test_queue_lists_the_entries_and_the_state(player):
    oh, _ = player
    r = get(f"/api/devices/{oh.udn}/queue").json()
    assert [e["id"] for e in r["entries"]] == [5, 6]
    assert r["state"] == "Playing" and r["current_id"] == 5 and r["active"] is True
    assert (r["seconds"], r["duration"]) == (42, 180)
    # with the current token the slow entry list is left out
    assert "entries" not in get(f"/api/devices/{oh.udn}/queue?token={r['token']}").json()


def test_queue_shuffle_and_repeat_send_strings_not_bools(player):
    """Same upnpclient quirk as mute: booleans must go out as strings."""
    oh, state = player
    assert queue(oh, action="shuffle", value=True).status_code == 200
    assert queue(oh, action="repeat", value=True).status_code == 200
    assert state["shuffle"] is True and state["repeat"] is True
    pl = oh.service("Playlist")
    assert all(isinstance(kw["Value"], str) for name, kw in pl.calls if name in ("SetShuffle", "SetRepeat"))


def test_queue_replace_clears_inserts_in_order_and_plays_the_first(player):
    oh, state = player
    items = [{"uri": "http://x/a.flac", "metadata": ""}, {"uri": "http://x/b.flac", "metadata": ""}]
    assert queue(oh, action="replace", items=items, play=True).status_code == 200
    assert [uri for _, uri in state["inserted"]] == ["http://x/a.flac", "http://x/b.flac"]
    assert len(state["queue"]) == 2 and state["seeked"] == [state["queue"][0]]


def test_queue_switches_the_device_to_its_playlist_source_first(player):
    oh, state = player
    state["source"] = 1                                      # Radio is active
    assert queue(oh, action="insert", items=[{"uri": "http://x/a.flac", "metadata": ""}]).status_code == 200
    assert state["source"] == 0


def test_queue_unknown_action_and_missing_service(player):
    oh, _ = player
    assert queue(oh, action="nope").status_code == 400
    srv = media_server()
    devices_api._publish_devices({srv.udn: srv})
    assert client.get(f"/api/devices/{srv.udn}/queue").status_code == 400


# ---------- the app itself ----------

def test_ping_identifies_the_app_and_the_page_is_not_cached():
    r = client.get("/api/app/ping").json()
    assert r["app"] == m.APP_ID and r["build"] == m.BUILD_ID
    page = client.get("/")
    assert page.status_code == 200 and "Flou Player" in page.text
    assert page.headers["cache-control"] == "no-cache"
    assert client.get("/static/core.js").headers["cache-control"] == "no-cache"


def test_transcode_only_accepts_http_urls():
    assert client.get("/api/transcode", params={"url": "file:///etc/passwd"}).status_code == 400
