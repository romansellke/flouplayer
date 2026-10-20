"""Device discovery, reconnecting to known devices, and per-device readings (services, volume, transport position)."""
from __future__ import annotations
import concurrent.futures as cf
import json
import os

import upnpclient
from fastapi import APIRouter, HTTPException

from app.state import CACHE_DIR, KNOWN_DEVICES_FILE, _merged_primary, devices, lock
from app.upnp import _has_openhome_product, _host, device_json, av_transport, find_volume_service, peer_devices

router=APIRouter()

@router.get("/api/discover")
def discover(timeout:int=4):
    # SSDP answers are UDP and get lost now and then (the number of devices
    # found varied between searches), so run two passes at once and merge.
    found=[]; error=None
    with cf.ThreadPoolExecutor(max_workers=2) as ex:
        for fut in [ex.submit(upnpclient.discover,timeout=timeout) for _ in range(2)]:
            try: found+=fut.result()
            except Exception as e: error=e
    if not found and error: raise HTTPException(502,f"SSDP discovery failed: {error}")
    fresh={}
    for d in found:
        key=getattr(d,"udn",None) or getattr(d,"location",None) or str(id(d)); fresh[key]=d
    result=_publish_devices(fresh)
    _save_known_devices(fresh)
    return result

def _publish_devices(fresh):
    """Makes `fresh` the current device list and returns it as JSON."""
    # Update the shared dict in place (other modules hold a reference to it): new entries first, then drop
    # the ones that are gone, so a concurrent request never sees an empty list.
    with lock:
        devices.update(fresh)
        for k in [k for k in devices if k not in fresh]: devices.pop(k,None)
    # Linn/OpenHome players show up as several UPnP devices on one IP (the
    # OpenHome one and a separate "UPnP AV" MediaRenderer). Present each
    # player once -- as the OpenHome device -- and let the lookups reach
    # the sibling devices' services through peer_devices().
    hidden=set(); primaries=set()
    by_host={}
    for k,d in fresh.items(): by_host.setdefault(_host(d),[]).append((k,d))
    for h,group in by_host.items():
        if not h or len(group)<2: continue
        prim=next(((k,d) for k,d in group if _has_openhome_product(d)),None)
        if not prim: continue
        primaries.add(prim[0])
        for k,d in group:
            if k!=prim[0] and not any("contentdirectory" in getattr(sv,"service_id","").lower() for sv in d.services): hidden.add(k)
    _merged_primary.clear(); _merged_primary.update(primaries)
    return {"devices":[device_json(k,d) for k,d in fresh.items() if k not in hidden]}

def _is_relevant(d):
    probe=" ".join((getattr(s,"service_id","")+" "+getattr(s,"service_type","")).lower() for s in d.services)
    return any(x in probe for x in ("contentdirectory","avtransport","openhome"))
def _save_known_devices(fresh):
    # Like the library cache: a convenience, never a reason to fail the request.
    try:
        CACHE_DIR.mkdir(parents=True,exist_ok=True)
        data={k:getattr(d,"location","") for k,d in fresh.items() if getattr(d,"location","") and _is_relevant(d)}
        tmp=KNOWN_DEVICES_FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data),encoding="utf-8"); os.replace(tmp,KNOWN_DEVICES_FILE)
    except Exception: pass

@router.post("/api/devices/restore")
def restore_devices():
    """Reconnects to the devices found last time by their description URL --
    fast, and no search needed. Devices that don't answer are skipped;
    returns an empty list when nothing is known or nothing answers."""
    try: known=json.loads(KNOWN_DEVICES_FILE.read_text(encoding="utf-8"))
    except Exception: return {"devices":[]}
    if not isinstance(known,dict) or not known: return {"devices":[]}
    ex=cf.ThreadPoolExecutor(max_workers=6)
    futs={ex.submit(upnpclient.Device,loc):k for k,loc in known.items() if isinstance(loc,str)}
    done,_=cf.wait(futs,timeout=8)
    ex.shutdown(wait=False)   # don't wait for devices that are gone
    fresh={}
    for f in done:
        try:
            d=f.result(); fresh[getattr(d,"udn",None) or futs[f]]=d
        except Exception: pass
    if not fresh: return {"devices":[]}
    return _publish_devices(fresh)

@router.get("/api/devices/{device_id}/services")
def services(device_id:str):
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found. Please search again.")
    out=device_json(device_id,d)
    out["peers"]=[{"name":getattr(x,"friendly_name",""),"location":getattr(x,"location",""),"service_types":sorted(getattr(sv,"service_type","") for sv in x.services)} for x in peer_devices(d)]
    return out

@router.get("/api/devices/{device_id}/volume")
def get_volume(device_id:str):
    """Read current volume. For Linn/OpenHome devices (kind 'openhome')
    this returns a real dB reading via the Volume service, otherwise
    (kind 'renderingcontrol') only the standard UPnP 0-100 percentage.
    NOTE: the exact scaling (VolumeMilliDbPerStep) has not been verified
    against real hardware -- if the dB values look obviously wrong,
    please report it."""
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found")
    vol,kind=find_volume_service(d)
    if not vol: raise HTTPException(400,"No volume service on this device")
    try:
        if kind=="openhome":
            ch=vol.Characteristics()
            raw=int(vol.Volume().get("Value",0))
            vmax=int(ch.get("VolumeMax",100)) or 100
            unity=int(ch.get("VolumeUnity",0))
            milli_db_per_step=int(ch.get("VolumeMilliDbPerStep",100))
            db=(raw-unity)*milli_db_per_step/1000.0
            try: muted=bool(vol.Mute().get("Value"))
            except Exception: muted=None   # not every device exposes Mute
            return {"kind":"openhome","raw":raw,"max":vmax,"unity":unity,"db_per_step":milli_db_per_step/1000.0,"db":round(db,1),"percent":round(100*raw/vmax),"muted":muted}
        v=vol.GetVolume(InstanceID=0,Channel="Master")
        raw=int(v.get("CurrentVolume",0))
        return {"kind":"renderingcontrol","raw":raw,"max":100,"db":None,"percent":raw}
    except Exception as e:
        raise HTTPException(502,f"Could not read volume: {e}")

@router.get("/api/devices/{device_id}/transport")
def get_transport(device_id:str):
    """Playback state + position (used for the elapsed-time display and
    for automatically advancing to the next track once one has finished)."""
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found")
    av=av_transport(d)
    if not av: raise HTTPException(400,"No AVTransport service on this device")
    try:
        pos=av.GetPositionInfo(InstanceID=0)
    except Exception as e:
        raise HTTPException(502,f"Position query failed: {e}")
    try:
        info=av.GetTransportInfo(InstanceID=0)
        state_str=info.get("CurrentTransportState","")
    except Exception:
        state_str=""
    return {"state":state_str,"rel_time":pos.get("RelTime",""),"duration":pos.get("TrackDuration","")}
