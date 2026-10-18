"""Transport, volume, mute, standby, source and pin commands (POST /api/control)."""
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.state import devices
from app.upnp import _openhome_service, _wake, find_volume_service, peer_service

router=APIRouter()

class Control(BaseModel): device_id:str; action:str; value:Optional[int]=None; uri:Optional[str]=None; metadata:Optional[str]=None

TRANSPORT_ACTIONS={"play":"Play","pause":"Pause","stop":"Stop","next":"SkipNext","previous":"SkipPrevious"}

@router.post("/api/control")
def control(req:Control):
    d=devices.get(req.device_id)
    if not d: raise HTTPException(404,"Output device not found")
    av=peer_service(d,["AVTransport"])
    if not av and req.action in ("play","pause","stop","next","previous","set_uri","seek") \
       and not (req.action in TRANSPORT_ACTIONS and _openhome_service(d,"Transport")):
        raise HTTPException(400,"No AVTransport service on this device")
    # Linn/OpenHome devices have their own Transport service that controls
    # whatever source is active (Radio, AirPlay, Playlist ...); AVTransport
    # answers "701 Transition not available" unless the Playlist is active.
    if req.action in TRANSPORT_ACTIONS:
        ts=_openhome_service(d,"Transport")
        if ts:
            try:
                getattr(ts,TRANSPORT_ACTIONS[req.action])()
                return {"ok":True}
            except Exception:
                if not av: raise HTTPException(502,"Control command failed (OpenHome Transport)")
                # otherwise fall through to AVTransport below
    try:
        if req.action=="play": av.Play(InstanceID=0,Speed="1")
        elif req.action=="pause": av.Pause(InstanceID=0)
        elif req.action=="stop": av.Stop(InstanceID=0)
        elif req.action in ("next","previous"): getattr(av,req.action.capitalize())(InstanceID=0)
        elif req.action=="set_uri": av.SetAVTransportURI(InstanceID=0,CurrentURI=req.uri or "",CurrentURIMetaData=req.metadata or ""); av.Play(InstanceID=0,Speed="1")
        elif req.action=="seek":
            sec=max(0,req.value or 0)
            av.Seek(InstanceID=0,Unit="REL_TIME",Target=f"{sec//3600}:{sec%3600//60:02d}:{sec%60:02d}")
        elif req.action=="volume":
            vol,kind=find_volume_service(d)
            if not vol: raise HTTPException(400,"No volume service on this device")
            if kind=="openhome":
                vmax=int(vol.Characteristics().get("VolumeMax",100)) or 100
                vol.SetVolume(Value=max(0,min(vmax,req.value or 0)))
            else: vol.SetVolume(InstanceID=0,Channel="Master",DesiredVolume=max(0,min(100,req.value or 0)))
        elif req.action=="mute":
            vol,kind=find_volume_service(d)
            if kind!="openhome": raise HTTPException(400,"Mute needs the OpenHome Volume service")
            vol.SetMute(Value="1" if req.value else "0")   # upnpclient wants booleans as strings
        elif req.action=="standby":
            prod=_openhome_service(d,"Product")
            if not prod: raise HTTPException(400,"No OpenHome Product service on this device")
            prod.SetStandby(Value="1" if req.value else "0")   # upnpclient wants booleans as strings
        elif req.action=="set_source":
            prod=_openhome_service(d,"Product")
            if not prod: raise HTTPException(400,"No OpenHome Product service on this device")
            if req.value is None: raise HTTPException(400,"value (source index) required")
            _wake(d)
            prod.SetSourceIndex(Value=req.value)
        elif req.action=="invoke_pin":
            pins=_openhome_service(d,"Pins")
            if not pins: raise HTTPException(400,"No OpenHome Pins service on this device")
            if req.value is None: raise HTTPException(400,"value (pin slot) required")
            _wake(d)
            pins.InvokeIndex(Index=req.value)
        else: raise HTTPException(400,"Unknown action")
    except HTTPException: raise
    except Exception as e: raise HTTPException(502,f"Control command failed: {e}")
    return {"ok":True}
