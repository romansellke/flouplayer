"""Backend tests: the FastAPI endpoints against fake UPnP devices (no network, no hardware)."""
import json

import pytest
from fastapi.testclient import TestClient

import app as app_pkg
import app.main as m
from tests.fakes import FakeDevice, linn_player, media_server

client = TestClient(m.app)

TRACK = ('<item id="t1" parentID="a1"><dc:title>Song</dc:title><upnp:artist>Artist</upnp:artist><upnp:album>Album</upnp:album>'
         '<upnp:class>object.item.audioItem.musicTrack</upnp:class>'
         '<res protocolInfo="http-get:*:audio/flac:*" duration="0:03:00">http://x/t1.flac</res></item>')
FOLDER = '<container id="a1" parentID="0" childCount="1"><dc:title>Albums</dc:title><upnp:class>object.container</upnp:class></container>'


@pytest.fixture
def player():
    oh, av, state = linn_player()
    m._publish_devices({oh.udn: oh, av.udn: av})
    yield oh, state
    m.devices.clear()


def get(path):
    return client.get(path)


def control(device, action, value=None):
    return client.post("/api/control", json={"device_id": device.udn, "action": action, "value": value})


# ---------- discovery ----------

def test_discover_presents_a_linn_player_once_and_remembers_it(monkeypatch):
    oh, av, _ = linn_player()
    srv = media_server()
    monkeypatch.setattr(m.upnpclient, "discover", lambda timeout=4: [oh, av, srv])
    r = client.get("/api/discover").json()["devices"]
    names = sorted(d["name"] for d in r)
    assert names == ["Linn Majik DSM", "Music Server"]          # the sibling "UPnP AV" device is hidden
    by_name = {d["name"]: d for d in r}
    assert by_name["Music Server"]["server"] and not by_name["Music Server"]["renderer"]
    assert by_name["Linn Majik DSM"]["renderer"]
    known = json.loads(m.KNOWN_DEVICES_FILE.read_text())
    assert set(known) == {oh.udn, av.udn, srv.udn}               # incl. the sibling, needed later for the OpenHome services


def test_restore_reconnects_by_url_and_skips_dead_devices(monkeypatch):
    oh, av, _ = linn_player()
    srv = media_server()
    gone = "http://192.168.1.99:1/gone.xml"
    m.KNOWN_DEVICES_FILE.write_text(json.dumps({oh.udn: oh.location, av.udn: av.location, srv.udn: srv.location, "uuid:gone": gone}))
    by_url = {d.location: d for d in (oh, av, srv)}

    def fake_device(location):
        if location not in by_url:
            raise OSError("unreachable")
        return by_url[location]

    monkeypatch.setattr(m.upnpclient, "Device", fake_device)
    r = client.post("/api/devices/restore").json()["devices"]
    assert sorted(d["name"] for d in r) == ["Linn Majik DSM", "Music Server"]
    assert set(m.devices) == {oh.udn, av.udn, srv.udn}


def test_restore_without_saved_devices_is_empty():
    m.KNOWN_DEVICES_FILE.unlink(missing_ok=True)
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
    av = m.devices[oh.udn.replace("-oh", "-av")].services[0]
    assert av.calls[-1][0] == "Play"


# ---------- library ----------

def test_browse_pages_through_a_folder():
    srv = media_server(tree={"0": [FOLDER], "a1": [TRACK]})
    m._publish_devices({srv.udn: srv})
    root = client.post("/api/browse", json={"device_id": srv.udn, "object_id": "0"}).json()
    assert [(i["type"], i["title"]) for i in root["items"]] == [("container", "Albums")]
    tracks = client.post("/api/browse", json={"device_id": srv.udn, "object_id": "a1"}).json()
    t = tracks["items"][0]
    assert (t["title"], t["artist"], t["album"]) == ("Song", "Artist", "Album")
    assert t["resources"][0]["uri"] == "http://x/t1.flac"


def test_scan_collects_all_tracks_and_caches_them():
    srv = media_server(tree={"0": [FOLDER], "a1": [TRACK]})
    m._publish_devices({srv.udn: srv})
    r = client.post("/api/scan", json={"device_id": srv.udn, "object_id": "0"}).json()
    assert r["count"] == 1 and r["tracks"][0]["title"] == "Song"
    assert client.get("/api/library/cached").json()["count"] == 1
    assert client.delete("/api/library/cached").status_code == 200
    assert client.get("/api/library/cached").status_code == 404


# ---------- misc ----------

def test_about_reports_the_package_version():
    r = client.get("/api/app/about").json()
    assert r["version"] == app_pkg.__version__
    assert r["name"] == "Flou Player"
    assert "changelog" in r and "source" in r
