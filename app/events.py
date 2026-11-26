"""Device events (UPnP GENA): the output device says when something changes, instead of being asked every 2 seconds.

Asking a Linn/OpenHome player for its state (queue, position, volume, standby, ...) takes several SOAP requests
every few seconds, each over a new connection. An older or busy device answers some of them late or not at all,
and the display then lags behind what is playing. Control apps like Linn's subscribe to the device's events
instead: the device sends what changed the moment it changes. This module does the same:

- The page opens `GET /api/devices/{id}/events` (Server-Sent Events) for the output device it shows. The first
  page watching a device starts a `Watch`: it subscribes to the device's OpenHome Playlist, Time, Info, Product
  and Volume services (UPnP SUBSCRIBE with a callback address), renews the subscriptions, and cancels them a
  little while after the last page stopped watching.
- The device sends NOTIFY requests with the changed state variables to a small HTTP server on this computer's
  network address (the app's own server only listens on 127.0.0.1, which the device can't reach). Only NOTIFYs
  from the watched device's address, to the secret path of a live subscription, with its SID, are taken.
- While a service's subscription is live, the readings (queue, position, volume, source, standby, stream) answer
  from the values it sent -- no request to the device at all -- and the page is told at once which service
  changed, so it reads again immediately instead of at its next poll.
- When events don't work (the device doesn't offer them, or a firewall drops its NOTIFY requests, so the first
  event never arrives), everything works as before by asking the device; the subscription is tried again later.
"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import socket
import threading
import time
import xml.etree.ElementTree as ET
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urljoin, urlparse

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.state import devices
from app.upnp import local_name, peer_devices

router = APIRouter()

SERVICES = ("Playlist", "Time", "Info", "Product", "Volume")
# The port the device sends its events to. Fixed, so it can be opened in a firewall; taken by something else,
# any free port is used instead. FLOU_EVENT_PORT=0 always picks a free one.
EVENT_PORT = int(os.environ.get("FLOU_EVENT_PORT", "8766"))
SUBSCRIBE_SECONDS = 300  # what we ask for; the device may grant another time
RENEW_MAX_SECONDS = 60  # renew at least this often: a device that went away is noticed by then
REQUEST_TIMEOUT = 4  # SUBSCRIBE / renew / UNSUBSCRIBE
FIRST_EVENT_SECONDS = 6  # a device sends all its values right after subscribing; nothing by then: blocked
RETRY_SECONDS = 30  # after a failed SUBSCRIBE (device away, busy)
BLOCKED_RETRY_SECONDS = 300  # after subscribing worked but no event arrived (a firewall): try again much later
LINGER_SECONDS = 30  # keep the subscriptions after the last page stopped watching (a reload, a short switch)
KEEPALIVE_SECONDS = 15
TICK_SECONDS = 1.0
MAX_BODY = 1 << 20  # a NOTIFY with the whole playlist's IdArray stays far below this


def gena_request(method, url, headers):
    """One SUBSCRIBE/UNSUBSCRIBE request. upnpclient has these too, but without a timeout."""
    return requests.request(method, url, headers=headers, timeout=REQUEST_TIMEOUT)


def local_address_for(host):
    """This computer's address on the network that leads to `host` (no packet is sent)."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.connect((host, 9))
        return s.getsockname()[0]


def find_service(d, name):
    """The OpenHome service `name` of a device or its siblings -- by exact type, so "Playlist" is never
    the PlaylistManager."""
    for dev in peer_devices(d):
        for s in dev.services:
            t = (getattr(s, "service_type", "") or "").lower()
            if "openhome" in t and f":service:{name.lower()}:" in t:
                return s
    return None


def parse_propertyset(body: bytes) -> dict:
    """The state variables of a NOTIFY body: {name: text}."""
    if b"<!DOCTYPE" in body or b"<!ENTITY" in body:
        raise ValueError("DTDs are not accepted")
    root = ET.fromstring(body)
    out = {}
    for prop in root:
        if not isinstance(prop.tag, str) or local_name(prop.tag) != "property":
            continue
        for var in prop:
            if isinstance(var.tag, str):
                out[local_name(var.tag)] = var.text or ""
    return out


def as_bool(v):
    return str(v).strip().lower() in ("1", "true", "yes")


def as_int(v, default=0):
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return default


def token_of(id_array: str) -> int:
    """A queue token for an evented IdArray. Never equal to a token the device's IdArray action gives
    (those stay below 2**32), so switching between the two always reads the entries again."""
    return zlib.crc32(id_array.encode()) + (1 << 32)


class _Sub:
    """One service's subscription and the values its events brought."""

    def __init__(self, name, svc):
        self.name = name
        self.svc = svc
        self.sid = None
        self.path = ""
        self.pending = False  # SUBSCRIBE sent, no answer yet: its first NOTIFY may arrive before the answer
        self.callback_host = ""
        self.subscribed_at = 0.0
        self.renew_at = 0.0
        self.retry_at = 0.0
        self.live = False
        self.vars = {}
        self.at = 0.0  # when the last event arrived
        self.error = ""

    def url(self):
        return urljoin(getattr(self.svc, "_url_base", "") or "", getattr(self.svc, "_event_sub_url", "") or "")


class Watch:
    """The subscriptions to one output device, kept while a page watches it (and LINGER_SECONDS longer)."""

    def __init__(self, hub, device_id, d):
        self.hub = hub
        self.device_id = device_id
        self.host = urlparse(getattr(d, "location", "") or "").hostname or ""
        try:  # NOTIFYs are compared with the device's address, which a description URL may give as a name
            self.host = socket.gethostbyname(self.host) if self.host else ""
        except OSError:
            pass
        self.subs = {}
        for name in SERVICES:
            svc = find_service(d, name)
            if svc is not None and getattr(svc, "_event_sub_url", None):
                self.subs[name] = _Sub(name, svc)
        self.lock = threading.Lock()
        self.listeners = []  # (loop, asyncio.Queue) per open event stream
        self.idle_since = time.monotonic()
        self.stopped = threading.Event()
        self.status = "starting"
        self.thread = threading.Thread(target=self._run, name=f"events {device_id}", daemon=True)

    # ---- the page side
    def message(self, changed=()):
        with self.lock:
            live = sorted(n for n, s in self.subs.items() if s.live)
            reason = next((s.error for s in self.subs.values() if s.error), "")
        return {"status": self.status, "live": live, "reason": reason, "changed": sorted(set(changed))}

    def add_listener(self):
        """A queue for one event stream, or None if this watch has just ended (then start a new one)."""
        q = asyncio.Queue()
        with self.lock:
            if self.stopped.is_set():
                return None
            self.listeners.append((asyncio.get_running_loop(), q))
            self.idle_since = None
        return q

    def remove_listener(self, q):
        with self.lock:
            self.listeners = [x for x in self.listeners if x[1] is not q]
            if not self.listeners:
                self.idle_since = time.monotonic()

    def announce(self, changed=()):
        msg = self.message(changed)
        with self.lock:
            targets = list(self.listeners)
        for loop, q in targets:
            try:
                loop.call_soon_threadsafe(q.put_nowait, msg)
            except RuntimeError:
                pass  # that page's event loop is gone

    # ---- the device side
    def values(self, name):
        """A copy of the service's evented values and when they came, or None while it isn't live."""
        with self.lock:
            s = self.subs.get(name)
            if not s or not s.live:
                return None
            return dict(s.vars), s.at

    def notify(self, path, sid, body, client_ip):
        """A NOTIFY for one of our paths. Returns the HTTP status to answer."""
        with self.lock:
            sub = next((s for s in self.subs.values() if s.path == path), None)
            if sub is None or client_ip != self.host:
                return 412
            if sid != sub.sid and not (sub.pending and sub.sid is None):
                return 412
        try:
            new = parse_propertyset(body)
        except (ET.ParseError, ValueError):
            return 400
        now = time.monotonic()
        with self.lock:
            if sub.path != path:  # resubscribed meanwhile
                return 412
            changed = sub.name != "Time" or self._time_jumped(sub, new, now)
            first = not sub.live
            sub.vars.update(new)
            sub.at = now
            sub.live = True
            sub.error = ""
        if first:
            self._set_status()
        if changed or first:
            self.announce([sub.name])
        return 200

    @staticmethod
    def _time_jumped(sub, new, now):
        """Time events come every second while playing; the page only needs to hear of a new track or a seek,
        the clock between them it runs by itself."""
        old = sub.vars
        if any(k in new and new[k] != old.get(k) for k in ("Duration", "TrackCount")):
            return True
        if "Seconds" not in new or "Seconds" not in old:
            return "Seconds" in new
        expected = as_int(old["Seconds"]) + (now - sub.at)
        return abs(as_int(new["Seconds"]) - expected) > 2.5

    def _set_status(self):
        with self.lock:
            live = any(s.live for s in self.subs.values())
            trying = any(s.pending or (s.sid and not s.live) for s in self.subs.values())
            status = "live" if live else ("starting" if trying else "polling")
            changed = status != self.status
            self.status = status
        if changed:
            self.announce()

    def _subscribe(self, sub, now):
        callback_host = local_address_for(self.host)
        path = "/" + secrets.token_urlsafe(18)
        with self.lock:
            sub.path, sub.sid, sub.pending, sub.live, sub.vars = path, None, True, False, {}
        try:
            r = gena_request(
                "SUBSCRIBE",
                sub.url(),
                {
                    "CALLBACK": f"<http://{callback_host}:{self.hub.port}{path}>",
                    "NT": "upnp:event",
                    "TIMEOUT": f"Second-{SUBSCRIBE_SECONDS}",
                },
            )
            r.raise_for_status()
            sid = r.headers.get("SID") or r.headers.get("sid")
            if not sid:
                raise ValueError("the device answered without a SID")
        except Exception as e:
            with self.lock:
                sub.pending, sub.path, sub.retry_at = False, "", now + RETRY_SECONDS
                sub.error = f"{sub.name}: subscribing failed ({e})"
            return
        with self.lock:
            sub.sid, sub.pending, sub.callback_host = sid, False, callback_host
            sub.subscribed_at = now
            sub.renew_at = now + min(_granted(r), RENEW_MAX_SECONDS)

    def _renew(self, sub, now):
        if local_address_for(self.host) != sub.callback_host:  # this computer's address changed
            self._cancel(sub)
            self._subscribe(sub, now)
            return
        try:
            r = gena_request("SUBSCRIBE", sub.url(), {"SID": sub.sid, "TIMEOUT": f"Second-{SUBSCRIBE_SECONDS}"})
            r.raise_for_status()
            with self.lock:
                sub.renew_at = now + min(_granted(r), RENEW_MAX_SECONDS)
        except Exception:
            # The device forgot us (restarted) or is gone: subscribe anew; that failing makes the values unusable.
            self._subscribe(sub, now)

    def _cancel(self, sub):
        with self.lock:
            sid, url = sub.sid, sub.url()
            sub.sid, sub.path, sub.pending, sub.live, sub.vars = None, "", False, False, {}
        if sid:
            try:
                gena_request("UNSUBSCRIBE", url, {"SID": sid})
            except Exception:
                pass

    def _tend(self, sub, now):
        if sub.sid is None and not sub.pending:
            if now >= sub.retry_at:
                self._subscribe(sub, now)
        elif sub.sid and not sub.live and now - sub.subscribed_at > FIRST_EVENT_SECONDS:
            self._cancel(sub)
            with self.lock:
                sub.retry_at = now + BLOCKED_RETRY_SECONDS
                sub.error = (
                    f"the device accepted the subscription but its events don't reach this computer "
                    f"(a firewall blocking TCP port {self.hub.port}?)"
                )
        elif sub.sid and now >= sub.renew_at:
            self._renew(sub, now)

    def _run(self):
        while not self.stopped.is_set():
            now = time.monotonic()
            with self.lock:
                if self.idle_since is not None and now - self.idle_since > LINGER_SECONDS:
                    self.stopped.set()  # under the lock: no page can join a watch that is ending
                    break
            for sub in list(self.subs.values()):
                try:
                    self._tend(sub, now)
                except Exception as e:
                    with self.lock:
                        sub.error = f"{sub.name}: {e}"
                        sub.retry_at = now + RETRY_SECONDS
            self._set_status()
            self.stopped.wait(TICK_SECONDS)
        self.stop()

    def stop(self):
        self.stopped.set()
        self.hub.forget(self)
        for sub in list(self.subs.values()):
            self._cancel(sub)


def _granted(r):
    t = (r.headers.get("TIMEOUT") or r.headers.get("timeout") or "").lower()
    if t.startswith("second-"):
        n = as_int(t[7:], 0)
        if n > 0:
            return n / 2
    return SUBSCRIBE_SECONDS / 2


class _NotifyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    hub = None  # set by Hub

    def log_message(self, *args):
        pass

    def _answer(self, code):
        self.send_response(code)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _body(self):
        if "chunked" in (self.headers.get("Transfer-Encoding") or "").lower():
            out = b""
            while True:
                size = int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)
                if size == 0:
                    self.rfile.readline()
                    return out
                if len(out) + size > MAX_BODY:
                    raise ValueError("too large")
                out += self.rfile.read(size)
                self.rfile.readline()
        n = as_int(self.headers.get("Content-Length"), -1)
        if n < 0 or n > MAX_BODY:
            raise ValueError("bad length")
        return self.rfile.read(n)

    def do_NOTIFY(self):
        try:
            body = self._body()
        except (ValueError, OSError):
            self.close_connection = True
            self._answer(400)
            return
        self._answer(self.hub.notify(self.path, self.headers.get("SID") or "", body, self.client_address[0]))

    def _refuse(self):
        self.close_connection = True
        self._answer(405)

    do_GET = do_POST = do_PUT = do_HEAD = _refuse


class Hub:
    """The NOTIFY server and the watched devices."""

    def __init__(self):
        self.lock = threading.Lock()
        self.watches = {}
        self.server = None
        self.port = None

    def _ensure_server(self):
        if self.server:
            return
        handler = type("Handler", (_NotifyHandler,), {"hub": self})
        try:
            server = ThreadingHTTPServer(("0.0.0.0", EVENT_PORT), handler)
        except OSError:
            server = ThreadingHTTPServer(("0.0.0.0", 0), handler)
        server.daemon_threads = True
        self.server, self.port = server, server.server_address[1]
        threading.Thread(target=server.serve_forever, name="events server", daemon=True).start()

    def watch(self, device_id, d):
        """The device's Watch, started if needed; None if it has no evented OpenHome services."""
        with self.lock:
            w = self.watches.get(device_id)
            if w and not w.stopped.is_set():
                return w
            w = Watch(self, device_id, d)
            if not w.subs:
                return None
            self._ensure_server()
            self.watches[device_id] = w
        w.thread.start()
        return w

    def forget(self, w):
        with self.lock:
            if self.watches.get(w.device_id) is w:
                del self.watches[w.device_id]

    def values(self, device_id, service):
        with self.lock:
            w = self.watches.get(device_id)
        return w.values(service) if w else None

    def notify(self, path, sid, body, client_ip):
        with self.lock:
            watches = list(self.watches.values())
        for w in watches:
            code = w.notify(path, sid, body, client_ip)
            if code != 412:
                return code
        return 412

    def stop_all(self):
        """Cancels every subscription (at quit), so the devices stop sending events to a port nobody listens on."""
        with self.lock:
            watches = list(self.watches.values())
        threads = [threading.Thread(target=w.stop, daemon=True) for w in watches]
        for t in threads:
            t.start()
        for t in threads:
            t.join(REQUEST_TIMEOUT + 0.5)


hub = Hub()


def live_values(device_id, service, *keys):
    """The service's evented values while its subscription is live and all `keys` are among them, else None.
    The readings use this first and ask the device only when it is None."""
    hit = hub.values(device_id, service)
    if hit is None or any(k not in hit[0] for k in keys):
        return None
    return hit[0]


def live_time(device_id, playing):
    """(seconds, duration) from the Time service's events, or None. Between two events the clock runs on.

    The device sends a Time event the moment its second changes, so the position is known to a fraction of a
    second: the second it reported plus the time since that event (not cut to whole seconds, which would make
    the page's clock jump back by up to a second)."""
    hit = hub.values(device_id, "Time")
    if hit is None or "Seconds" not in hit[0]:
        return None
    vals, at = hit
    duration = as_int(vals.get("Duration"))
    seconds = as_int(vals["Seconds"]) + ((time.monotonic() - at) if playing else 0)
    return round(min(seconds, duration) if duration else seconds, 2), duration


def _sse(msg):
    return f"data: {json.dumps(msg)}\n\n"


@router.get("/api/devices/{device_id}/events")
async def device_events(device_id: str, request: Request):
    """Server-Sent Events for the page: a message whenever one of the device's services changed
    (`changed`), and whenever the state of the events themselves changes (`status`: starting, live or
    polling, with the `live` services and a `reason` when they don't work)."""
    d = devices.get(device_id)
    if not d:
        raise HTTPException(404, "Device not found")
    for _ in range(3):
        w = hub.watch(device_id, d)
        if w is None:
            raise HTTPException(400, "This device offers no OpenHome events")
        q = w.add_listener()
        if q is not None:
            break
    else:
        raise HTTPException(503, "Device events are restarting, try again")

    async def stream():
        try:
            yield _sse(w.message())
            while True:
                try:
                    msg = await asyncio.wait_for(q.get(), KEEPALIVE_SECONDS)
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        return
                    yield ": keepalive\n\n"
                    continue
                changed = set(msg["changed"])
                while not q.empty():  # several at once: one message
                    msg = q.get_nowait()
                    changed |= set(msg["changed"])
                yield _sse({**msg, "changed": sorted(changed)})
        finally:
            w.remove_listener(q)

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )
