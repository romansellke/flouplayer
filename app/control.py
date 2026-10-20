"""Transport, volume, mute, standby, source and pin commands (POST /api/control)."""
from __future__ import annotations
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.state import devices
from app.didl import parse_didl
from app.upnp import _openhome_service, _wake, av_transport, find_volume_service

router=APIRouter()

class Control(BaseModel): device_id:str; action:str; value:Optional[int]=None; uri:Optional[str]=None; metadata:Optional[str]=None

def upnp_error(e):
    """"714 Illegal MIME-type" instead of upnpclient's bare tuple -- the code is what tells a
    renderer's refusal apart from a network problem."""
    a=getattr(e,"args",())
    if len(a)>=2 and isinstance(a[0],int): return f"UPnP error {a[0]} ({a[1]})"
    resp=getattr(e,"response",None)
    if resp is not None:   # HTTP-level refusal: the device did not even take the SOAP message
        body=" ".join((resp.text or "").split())[:200]
        return f"HTTP {resp.status_code} {resp.reason or ''} from {resp.url}"+(f" -- {body}" if body else "")
    return str(e) or e.__class__.__name__

def minimal_didl(metadata):
    """A bare DIDL-Lite item (title, class, one resource) rebuilt from the server's full metadata.
    HEOS and Sonos reject some vendor elements/namespaces that servers add; they only need these."""
    try: item=parse_didl(metadata)[0]
    except Exception: return ""
    res=(item.get("resources") or [{}])[0]
    if not res.get("uri"): return ""
    esc=lambda v: (v or "").replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace('"',"&quot;")
    return ('<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" '
            'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1">'
            f'<dc:title>{esc(item["title"])}</dc:title><upnp:class>{esc(item["class"] or "object.item.audioItem.musicTrack")}</upnp:class>'
            f'<res protocolInfo="{esc(res["protocol"] or "http-get:*:audio/mpeg:*")}">{esc(res["uri"])}</res></item></DIDL-Lite>')

def set_uri_and_play(av,uri,metadata):
    """Starts a track on a plain UPnP AV renderer (Marantz/HEOS, Sonos, ...). These are pickier than
    Linn players: some refuse the DIDL metadata (retried without it), and some answer Play right after
    SetAVTransportURI with 701 until they have loaded the stream (retried a few times)."""
    try: av.Stop(InstanceID=0)   # a renderer still on another input or track often refuses a new URI otherwise
    except Exception: pass
    # the server's own metadata first, then a minimal rebuilt one, then none at all
    attempts=[metadata] if metadata else []
    if metadata and minimal_didl(metadata): attempts.append(minimal_didl(metadata))
    attempts.append("")
    errors=[]
    for md in attempts:
        try:
            av.SetAVTransportURI(InstanceID=0,CurrentURI=uri,CurrentURIMetaData=md); break
        except Exception as e:
            errors.append(f'{"original metadata" if md==metadata and md else "minimal metadata" if md else "no metadata"}: {upnp_error(e)}')
    else:
        raise RuntimeError("SetAVTransportURI failed -- "+"; ".join(errors))
    last=None
    for attempt in range(4):
        try:
            av.Play(InstanceID=0,Speed="1"); return
        except Exception as e:
            last=e
            if attempt<3: time.sleep(0.4)
    raise RuntimeError(f"Play failed after setting the track: {upnp_error(last)}")

TRANSPORT_ACTIONS={"play":"Play","pause":"Pause","stop":"Stop","next":"SkipNext","previous":"SkipPrevious"}

@router.post("/api/control")
def control(req:Control):
    d=devices.get(req.device_id)
    if not d: raise HTTPException(404,"Output device not found")
    av=av_transport(d)
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
        elif req.action=="set_uri": set_uri_and_play(av,req.uri or "",req.metadata or "")
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
    except Exception as e: raise HTTPException(502,f"Control command failed: {upnp_error(e) if not isinstance(e,RuntimeError) else e}")
    return {"ok":True}
