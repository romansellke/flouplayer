"""Device events (app/events.py): subscribing to a fake player, its NOTIFYs over real HTTP, the readings answering
from them, the fallback when no event arrives, renewing and cancelling, and the page's event stream."""

import json
import socket
import threading
import time

import httpx
import pytest
import requests
import uvicorn
from fastapi.testclient import TestClient

import app.main as m
from app import devices as devices_api
from app import events
from app import state as app_state
from tests.fakes import linn_player

client = TestClient(m.app, base_url="http://127.0.0.1:8765")


class Resp:
    def __init__(self, status=200, headers=None):
        self.status_code = status
        self.headers = headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))


class FakeGena:
    """Answers SUBSCRIBE/UNSUBSCRIBE like a device and remembers each subscription's callback address."""

    def __init__(self):
        self.calls = []
        self.callbacks = {}  # service name -> (callback url, sid)
        self.n = 0
        self.refuse = False

    def __call__(self, method, url, headers):
        self.calls.append((method, url, dict(headers)))
        name = url.rsplit("/", 1)[-1]
        if self.refuse:
            return Resp(500)
        if method == "SUBSCRIBE" and "CALLBACK" in headers:
            self.n += 1
            sid = f"uuid:sub-{self.n}"
            self.callbacks[name] = (headers["CALLBACK"].strip("<>"), sid)
            return Resp(200, {"SID": sid, "TIMEOUT": "Second-300"})
        if method == "SUBSCRIBE":
            return Resp(200, {"SID": headers["SID"], "TIMEOUT": "Second-300"})
        return Resp(200)

    def methods(self):
        return [(c[0], c[1].rsplit("/", 1)[-1], "SID" in c[2]) for c in self.calls]


def propertyset(**values):
    props = "".join(f"<e:property><{k}>{v}</{k}></e:property>" for k, v in values.items())
    return f'<?xml version="1.0"?><e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">{props}</e:propertyset>'


def wait_for(cond, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.02)
    return False


@pytest.fixture
def evented(monkeypatch):
    """A Linn-style player on this computer's loopback address whose OpenHome services offer events."""
    gena = FakeGena()
    monkeypatch.setattr(events, "gena_request", gena)
    monkeypatch.setattr(events, "hub", events.Hub())
    monkeypatch.setattr(events, "EVENT_PORT", 0)
    monkeypatch.setattr(events, "TICK_SECONDS", 0.02)
    oh, av, state = linn_player(host="127.0.0.1")
    for s in oh.services:
        s._url_base = "http://127.0.0.1:55178/"
        s._event_sub_url = "/evt/" + s.service_type.split(":")[-2]
    devices_api._publish_devices({oh.udn: oh, av.udn: av})
    yield oh, state, gena
    events.hub.stop_all()
    app_state.devices.clear()


def notify(gena, service, sid=None, **values):
    url, real_sid = gena.callbacks[service]
    return requests.request(
        "NOTIFY",
        url,
        data=propertyset(**values).encode(),
        headers={"SID": sid or real_sid, "NT": "upnp:event", "NTS": "upnp:propchange", "SEQ": "0"},
        timeout=3,
    )


def start(oh, gena):
    w = events.hub.watch(oh.udn, oh)
    assert wait_for(lambda: len(gena.callbacks) == len(events.SERVICES))
    return w


ALL = {
    "Playlist": dict(
        TransportState="Paused",
        Id=6,
        IdArray="AAAABQAAAAY=",  # ids 5 and 6
        Repeat="true",
        Shuffle="false",
        TracksMax=1000,
    ),
    "Time": dict(TrackCount=3, Duration=240, Seconds=100),
    "Info": dict(
        CodecName="ALAC",
        SampleRate=96000,
        BitDepth=24,
        BitRate=4608000,
        Lossless="true",
        Metadata="",
        Metatext="",
    ),
    "Product": dict(SourceIndex=0, Standby="true"),
    "Volume": dict(Volume=55, Mute="1"),
}


def test_subscribes_to_the_players_services_with_a_callback_on_this_computer(evented):
    oh, _, gena = evented
    start(oh, gena)
    assert sorted(gena.callbacks) == sorted(events.SERVICES)
    url, _ = gena.callbacks["Playlist"]
    assert url.startswith(f"http://127.0.0.1:{events.hub.port}/") and len(url) > 40  # a secret path per subscription
    sub = next(c for c in gena.calls if c[1].endswith("/Playlist"))
    assert sub[1] == "http://127.0.0.1:55178/evt/Playlist" and sub[2]["NT"] == "upnp:event"


def test_the_readings_answer_from_the_events_without_asking_the_device(evented):
    oh, state, gena = evented
    start(oh, gena)
    for name, values in ALL.items():
        assert notify(gena, name, **values).status_code == 200
    get = lambda p: client.get(f"/api/devices/{oh.udn}/{p}").json()  # noqa: E731
    get("queue")  # reads which source is the Playlist once (remembered for minutes)
    get("volume")  # and the volume range (fixed for a device)
    for s in oh.services:
        s.calls.clear()

    q = get("queue")
    assert q["state"] == "Paused" and q["current_id"] == 6 and q["repeat"] is True and q["shuffle"] is False
    assert q["seconds"] == 100 and q["duration"] == 240 and q["active"] is True and q["source"] == 0
    assert [e["id"] for e in q["entries"]] == [5, 6]
    assert "entries" not in get(f"queue?token={q['token']}")  # same list: no ReadList
    v = get("volume")
    assert v["raw"] == 55 and v["muted"] is True
    assert get("standby") == {"supported": True, "standby": True}
    assert get("sources?light=true") == {"current": 0}
    st = get("stream")
    assert (st["codec"], st["sample_rate"], st["bit_depth"], st["lossless"]) == ("ALAC", 96000, 24, True)

    asked = {(s.service_type.split(":")[-2], c[0]) for s in oh.services for c in s.calls}
    assert asked == {("Playlist", "ReadList")}  # only the entries of a list not seen before


def test_a_new_value_in_an_event_shows_up_at_once(evented):
    oh, _, gena = evented
    start(oh, gena)
    for name, values in ALL.items():
        notify(gena, name, **values)
    notify(gena, "Playlist", Id=5, TransportState="Playing")
    q = client.get(f"/api/devices/{oh.udn}/queue").json()
    assert q["current_id"] == 5 and q["state"] == "Playing"


def test_without_a_first_event_the_subscription_is_dropped_and_the_device_asked_again(evented, monkeypatch):
    oh, _, gena = evented
    monkeypatch.setattr(events, "FIRST_EVENT_SECONDS", 0.2)
    w = start(oh, gena)
    assert wait_for(lambda: sum(1 for c in gena.methods() if c[0] == "UNSUBSCRIBE") == len(events.SERVICES))
    msg = w.message()
    assert msg["status"] == "polling" and "firewall" in msg["reason"]
    oh.service("Playlist").calls.clear()
    assert client.get(f"/api/devices/{oh.udn}/queue").json()["current_id"] == 5  # the fake's own answer
    assert ("Id", {}) in oh.service("Playlist").calls


def test_a_failed_subscribe_leaves_the_readings_to_the_device(evented):
    oh, _, gena = evented
    gena.refuse = True
    w = events.hub.watch(oh.udn, oh)
    assert wait_for(lambda: w.message()["status"] == "polling")
    assert "subscribing failed" in w.message()["reason"]
    assert client.get(f"/api/devices/{oh.udn}/volume").json()["raw"] == 40


def test_a_notify_with_a_wrong_sid_or_from_another_address_is_refused(evented):
    oh, _, gena = evented
    start(oh, gena)
    assert notify(gena, "Volume", sid="uuid:someone-else", Volume=1).status_code == 412
    path = gena.callbacks["Volume"][0].split(str(events.hub.port), 1)[1]
    sid = gena.callbacks["Volume"][1]
    assert events.hub.notify(path, sid, propertyset(Volume=1).encode(), "192.168.1.99") == 412
    assert events.hub.notify("/nope", sid, propertyset(Volume=1).encode(), "127.0.0.1") == 412
    assert requests.get(gena.callbacks["Volume"][0], timeout=3).status_code == 405
    assert events.live_values(oh.udn, "Volume") is None  # nothing was taken


def test_a_notify_with_a_dtd_is_refused():
    with pytest.raises(ValueError):
        events.parse_propertyset(b'<!DOCTYPE x [<!ENTITY a "aaaa">]><e:propertyset/>')


def test_subscriptions_are_renewed_and_cancelled_once_nobody_watches(evented, monkeypatch):
    oh, _, gena = evented
    monkeypatch.setattr(events, "RENEW_MAX_SECONDS", 0.1)
    monkeypatch.setattr(events, "LINGER_SECONDS", 0.6)
    start(oh, gena)
    for name, values in ALL.items():
        notify(gena, name, **values)
    assert wait_for(lambda: ("SUBSCRIBE", "Volume", True) in gena.methods())  # a renewal carries the SID
    assert wait_for(lambda: oh.udn not in events.hub.watches)
    assert sorted(c[1] for c in gena.methods() if c[0] == "UNSUBSCRIBE") == sorted(events.SERVICES)
    assert events.live_values(oh.udn, "Volume") is None


def test_time_events_only_count_as_a_change_on_a_new_track_or_a_seek():
    sub = events._Sub("Time", None)
    sub.vars, sub.at = {"Seconds": "100", "Duration": "240", "TrackCount": "3"}, 50.0
    jumped = lambda now, **new: events.Watch._time_jumped(sub, {k: str(v) for k, v in new.items()}, now)  # noqa: E731
    assert not jumped(51.0, Seconds=101)  # the clock running
    assert not jumped(51.0, Seconds=100)  # paused
    assert jumped(51.0, Seconds=30)  # a seek back
    assert jumped(51.0, Seconds=0, TrackCount=4, Duration=200)  # the next track


def test_the_clock_runs_on_between_time_events(evented):
    oh, _, gena = evented
    start(oh, gena)
    notify(gena, "Time", TrackCount=3, Duration=240, Seconds=100)
    w = events.hub.watches[oh.udn]
    w.subs["Time"].at -= 5.5
    seconds, duration = events.live_time(oh.udn, playing=True)
    assert 105.5 <= seconds < 105.7 and duration == 240  # to a fraction of a second, not cut to whole ones
    assert events.live_time(oh.udn, playing=False) == (100, 240)


def test_a_device_without_events_answers_the_stream_with_400():
    oh, av, _ = linn_player()
    devices_api._publish_devices({oh.udn: oh, av.udn: av})
    try:
        r = client.get(f"/api/devices/{oh.udn}/events")
        assert r.status_code == 400
    finally:
        app_state.devices.clear()


@pytest.fixture
def live_server():
    """The real app on a free local port (the test client can't read an endless event stream)."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(m.app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    assert wait_for(lambda: server.started, 5)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    t.join(5)


def test_the_page_hears_of_each_change_through_the_event_stream(evented, live_server):
    oh, _, gena = evented
    with httpx.stream("GET", f"{live_server}/api/devices/{oh.udn}/events", timeout=5) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        lines = (json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: "))
        assert next(lines)["changed"] == []
        assert wait_for(lambda: len(gena.callbacks) == len(events.SERVICES))
        notify(gena, "Volume", Volume=60, Mute="0")
        msg = next(m for m in lines if m["changed"])
        assert msg["changed"] == ["Volume"] and msg["status"] == "live" and "Volume" in msg["live"]
    w = events.hub.watches[oh.udn]
    assert wait_for(lambda: not w.listeners)  # the page left: the watch lingers, then ends
