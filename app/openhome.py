"""OpenHome device features: sources, pins, stream details, capabilities, standby and firmware."""
from __future__ import annotations
import json

from fastapi import APIRouter, HTTPException

from app.state import devices
from app.upnp import _openhome_service, peer_service

router=APIRouter()

# ---------- OpenHome extras: sources, pins, what the device is really playing ----------
# Written against the public OpenHome Product/Pins/Info service definitions
# (cross-checked with the openhomedevice library); not verified against
# real hardware.

@router.get("/api/devices/{device_id}/sources")
def list_sources(device_id:str, light:bool=False):
    """The device's selectable sources (Playlist, Radio, Analog, Songcast,
    HDMI ...) and the current one -- OpenHome Product service. With
    light=true only the current index is read (cheap enough to poll)."""
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found")
    prod=_openhome_service(d,"Product")
    if not prod: raise HTTPException(400,"No OpenHome Product service on this device -- source switching not possible")
    try:
        current=int(prod.SourceIndex().get("Value",-1))
        if light: return {"current":current}
        count=int(prod.SourceCount().get("Value",0))
    except Exception as e:
        raise HTTPException(502,f"Could not read sources: {e}")
    out=[]
    for i in range(count):
        try:
            r=prod.Source(Index=i)
            if r.get("Visible",True): out.append({"index":i,"type":r.get("Type",""),"name":r.get("Name","")})
        except Exception:
            continue
    return {"current":current,"sources":out}

@router.get("/api/devices/{device_id}/pins")
def list_pins(device_id:str):
    """The device's pins (favourites: radio stations, playlists, inputs)
    -- OpenHome Pins service. supported=false where there is none."""
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found")
    pins=_openhome_service(d,"Pins")
    if not pins: return {"supported":False,"pins":[]}
    try:
        slots=int(pins.GetDeviceMax().get("DeviceMax",0))
        ids=json.loads(pins.GetIdArray().get("IdArray") or "[]")
        meta=json.loads(pins.ReadList(Ids=json.dumps(ids)).get("List") or "[]") if ids else []
    except Exception as e:
        raise HTTPException(502,f"Could not read pins: {e}")
    out=[]
    for i,p in enumerate(meta[:slots] if slots else meta):
        if isinstance(p,dict) and (p.get("id") or 0)>0:
            out.append({"slot":i,"title":p.get("title") or "","artwork":p.get("artworkUri") or ""})
    return {"supported":True,"pins":out}

@router.get("/api/devices/{device_id}/stream")
def stream_details(device_id:str):
    """What the device itself reports about the stream it is playing
    (OpenHome Info service): codec, sample rate, bit depth, bit rate.
    All fields are empty/zero when nothing is playing."""
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found")
    info=_openhome_service(d,"Info")
    if not info: return {"supported":False}
    try:
        r=info.Details()
    except Exception as e:
        raise HTTPException(502,f"Could not read stream details: {e}")
    num=lambda k:int(r.get(k) or 0)
    return {"supported":True,"codec":(r.get("CodecName") or "").strip(),"sample_rate":num("SampleRate"),"bit_depth":num("BitDepth"),"bit_rate":num("BitRate"),"lossless":bool(r.get("Lossless"))}

@router.get("/api/devices/{device_id}/capabilities")
def capabilities(device_id:str):
    """What the active source allows (OpenHome Transport service): pause and
    skipping are unavailable on e.g. live radio. Each value is None when the
    device doesn't say."""
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found")
    ts=_openhome_service(d,"Transport")
    if not ts: return {"supported":False}
    out={"supported":True,"can_pause":None,"can_skip_next":None,"can_skip_previous":None}
    try:
        v=ts.StreamInfo().get("CanPause")
        if v is not None: out["can_pause"]=bool(v)
        m=ts.ModeInfo()
        for k,key in (("can_skip_next","CanSkipNext"),("can_skip_previous","CanSkipPrevious")):
            if m.get(key) is not None: out[k]=bool(m.get(key))
    except Exception as e:
        raise HTTPException(502,f"Could not read capabilities: {e}")
    return out

@router.get("/api/devices/{device_id}/standby")
def get_standby(device_id:str):
    """Whether the device is in standby (OpenHome Product service)."""
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found")
    prod=_openhome_service(d,"Product")
    if not prod: return {"supported":False}
    try: return {"supported":True,"standby":bool(prod.Standby().get("Value"))}
    except Exception as e: raise HTTPException(502,f"Could not read standby state: {e}")

@router.get("/api/devices/{device_id}/firmware")
def firmware(device_id:str):
    """Installed firmware and whether an update is available (Linn Update
    service). Read-only: updates are never started from here."""
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found")
    up=peer_service(d,["linn-co-uk:service:update"]) or peer_service(d,["linn-co-uk:serviceId:update"])
    if not up: return {"supported":False}
    try: st=json.loads(up.GetSoftwareStatus().get("SoftwareStatus") or "{}")
    except Exception as e: raise HTTPException(502,f"Could not read firmware status: {e}")
    cur=st.get("current_software") or {}
    ups=(st.get("update_info") or {}).get("updates") or []
    new=ups[0] if ups and isinstance(ups[0],dict) else None
    return {"supported":True,"status":st.get("status") or "","version":cur.get("version") or "","channel":cur.get("channel") or "",
            "update":({"version":new.get("version") or "","date":new.get("date") or "","description":new.get("description") or ""} if new else None)}
