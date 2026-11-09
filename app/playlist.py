"""The device-side queue (OpenHome Playlist service): reading and changing it."""

from __future__ import annotations
import time
import xml.etree.ElementTree as ET
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.didl import child_text, parse_didl
from app.state import devices
from app.upnp import peer_devices, peer_service

router = APIRouter()


# ---------- OpenHome Playlist (device-side queue) ----------
# Linn/OpenHome devices keep their own playlist (the "Playlist" source).
# Tracks are inserted by URI + DIDL metadata, and the device then plays,
# advances (gaplessly) and remembers the queue by itself.
# NOTE: written against the public OpenHome Playlist/Time/Product service
# definitions; tested on a Linn Majik DSM (play, gapless advance, pause).
def find_playlist_service(d):
    for dev in peer_devices(d):
        for s in dev.services:
            t = (getattr(s, "service_type", "") or "").lower()
            if "openhome" in t and ":playlist:" in t:
                return s
    return None


def _service_types(d):
    return sorted({getattr(s, "service_type", "") for dev in peer_devices(d) for s in dev.services})


def _no_playlist(d):
    return HTTPException(
        400,
        "No OpenHome Playlist service on this device (services found: "
        + ", ".join(t.rsplit(":", 2)[-2] if t.count(":") >= 2 else t for t in _service_types(d))
        + ")",
    )


def _val(r, key="Value"):
    return r.get(key) if isinstance(r, dict) else r


def _id_array(pl):
    r = pl.IdArray()
    raw = r.get("Array") or b""  # an empty playlist comes back as None/""
    if isinstance(raw, str):
        import base64

        raw = base64.b64decode(raw)
    return [int.from_bytes(raw[i : i + 4], "big") for i in range(0, len(raw) - 3, 4)], r.get("Token")


def _read_entries(pl, ids):
    if not ids:
        return []
    xml = pl.ReadList(IdList=" ".join(map(str, ids))).get("TrackList") or ""
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return []
    by_id = {}
    for e in root:
        try:
            eid = int(child_text(e, "Id"))
        except ValueError:
            continue
        meta = parse_didl(child_text(e, "Metadata"))
        m = meta[0] if meta else {}
        by_id[eid] = {
            "id": eid,
            "uri": child_text(e, "Uri"),
            "title": m.get("title") or child_text(e, "Uri"),
            "artist": m.get("artist", ""),
            "album": m.get("album", ""),
            "album_art": m.get("album_art", ""),
            "duration": (m.get("resources") or [{}])[0].get("duration", ""),
        }
    return [by_id[i] for i in ids if i in by_id]


# Which source is the Playlist hardly ever changes, but reading it costs a SourceCount plus a Source per entry.
# The queue poll (every 2 s) only asks "is the Playlist the active source?", so it uses the index remembered on the
# service for a while. Changing the queue always reads it afresh (_activate_playlist).
PLAYLIST_INDEX_TTL = 300


def _playlist_source_index(prod, cached=False):
    hit = getattr(prod, "_flou_playlist_index", None)
    if cached and hit and time.monotonic() - hit[0] < PLAYLIST_INDEX_TTL:
        return hit[1]
    idx = _read_playlist_source_index(prod)
    try:
        prod._flou_playlist_index = (time.monotonic(), idx)
    except Exception:
        pass
    return idx


def _read_playlist_source_index(prod):
    count = int(prod.SourceCount().get("Value", 0))
    for i in range(count):
        try:
            if prod.Source(Index=i).get("Type", "").lower() == "playlist":
                return i
        except Exception:
            continue
    return None


def _playlist_active(d):
    """(is the Playlist the active source, index of the active source or None). One SourceIndex read serves both."""
    prod = peer_service(d, ["product"])
    if not prod:
        return True, None  # no Product service: assume the Playlist is usable directly
    try:
        now = int(prod.SourceIndex().get("Value", -1))
        return now == _playlist_source_index(prod, cached=True), now
    except Exception:
        return False, None


def _activate_playlist(d):
    prod = peer_service(d, ["product"])
    if not prod:
        return
    idx = _playlist_source_index(prod)
    if idx is None:
        raise HTTPException(400, "This device has no Playlist source")
    if int(prod.SourceIndex().get("Value", -1)) != idx:
        prod.SetSourceIndex(Value=idx)


# Repeat and shuffle change when somebody presses them, not with the track: the queue poll (every 2 s) reads them
# again only after this long. A request without a token (the app's own changes and its first read) always asks the device.
MODES_TTL = 10


def _modes(pl, fresh=False):
    hit = getattr(pl, "_flou_modes", None)
    if hit and not fresh and time.monotonic() - hit[0] < MODES_TTL:
        return hit[1]
    modes = (bool(_val(pl.Repeat())), bool(_val(pl.Shuffle())))
    try:
        pl._flou_modes = (time.monotonic(), modes)
    except Exception:
        pass
    return modes


@router.get("/api/devices/{device_id}/queue")
def get_queue(device_id: str, token: Optional[int] = None):
    """The device's playlist. If `token` still matches the device's current
    IdArray token, the (slow) entry list is omitted -- only live state."""
    d = devices.get(device_id)
    if not d:
        raise HTTPException(404, "Device not found")
    pl = find_playlist_service(d)
    if not pl:
        raise _no_playlist(d)
    try:
        ids, tok = _id_array(pl)
        active, source = _playlist_active(d)
        out = {
            "supported": True,
            "token": tok,
            "active": active,
            "source": source,
            "state": _val(pl.TransportState()),
            "current_id": int(_val(pl.Id()) or 0),
        }
        try:
            out["repeat"], out["shuffle"] = _modes(pl, fresh=token is None)
        except Exception:
            pass
        tm = peer_service(d, ["time"])
        if tm:
            try:
                t = tm.Time()
                out["seconds"] = int(t.get("Seconds", 0))
                out["duration"] = int(t.get("Duration", 0))
            except Exception:
                pass
        if token is None or str(token) != str(tok):
            out["entries"] = _read_entries(pl, ids)
        return out
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Could not read playlist: {e}")


class QueueItem(BaseModel):
    uri: str
    metadata: str = ""


class QueueReq(BaseModel):
    action: str
    id: Optional[int] = None
    items: list[QueueItem] = []
    play: bool = False
    value: Optional[bool] = None
    seconds: Optional[int] = None
    start: int = 0


@router.post("/api/devices/{device_id}/queue")
def queue_action(device_id: str, req: QueueReq):
    d = devices.get(device_id)
    if not d:
        raise HTTPException(404, "Device not found")
    pl = find_playlist_service(d)
    if not pl:
        raise _no_playlist(d)
    a = req.action
    try:
        if a == "insert":
            _activate_playlist(d)
            ids, _ = _id_array(pl)
            after = ids[-1] if ids else 0
            first = None
            for it in req.items:
                after = int(_val(pl.Insert(AfterId=after, Uri=it.uri, Metadata=it.metadata), "NewId"))
                if first is None:
                    first = after
            if req.play and first is not None:
                pl.SeekId(Value=first)
        elif a == "replace":  # clear, insert, play from the first (or the `start`-th)
            _activate_playlist(d)
            pl.DeleteAll()
            after = 0
            new = []
            for it in req.items:
                after = int(_val(pl.Insert(AfterId=after, Uri=it.uri, Metadata=it.metadata), "NewId"))
                new.append(after)
            if new:
                pl.SeekId(
                    Value=new[min(max(req.start, 0), len(new) - 1)]
                )  # start: play from that track, the ones before stay for Previous
        elif a == "delete":
            if req.id is None:
                raise HTTPException(400, "id required")
            pl.DeleteId(Value=req.id)
        elif a == "clear":
            pl.DeleteAll()
        elif a == "seek":
            if req.id is None:
                raise HTTPException(400, "id required")
            _activate_playlist(d)
            pl.SeekId(Value=req.id)
        elif a in ("play", "pause", "stop", "next", "previous"):
            _activate_playlist(d)
            getattr(pl, a.capitalize())()
        elif a == "seek_time":
            pl.SeekSecondAbsolute(Value=max(0, req.seconds or 0))
        elif a == "shuffle":
            pl.SetShuffle(Value="1" if req.value else "0")  # upnpclient wants booleans as strings
        elif a == "repeat":
            pl.SetRepeat(Value="1" if req.value else "0")
        else:
            raise HTTPException(400, f"Unknown action: {a}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Playlist action failed: {e}")
    return {"ok": True}
