from __future__ import annotations
import html, socket, threading, json, time
import concurrent.futures as cf
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse
import xml.etree.ElementTree as ET
import upnpclient
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app=FastAPI(title="Flou Player", version="0.2.0")
app.mount("/static", StaticFiles(directory="app/static"), name="static")
lock=threading.Lock(); devices:dict[str,Any]={}
scan_lock=threading.Lock(); scan_state:dict[str,Any]={"running":False,"count":0,"containers":0}
SCAN_WORKERS=6
# Persistent on-disk cache of the last scanned library, so it survives
# closing and reopening the app -- a rescan is then only needed on request
# (the "Load Library" button), not on every startup.
CACHE_DIR=Path.home()/".cache"/"flou_player"
CACHE_FILE=CACHE_DIR/"library.json"
# Common names for a plain "by folder/file" view, which contains each track
# only ONCE -- unlike the parallel views by artist/album/genre/composer,
# where the same track shows up multiple times.
CANONICAL_CONTAINER_NAMES={"folder","folders","by folder","files","ordner","dateien","verzeichnis","musikordner"}

class Select(BaseModel): device_id:str
class Browse(BaseModel): device_id:str; object_id:str="0"; start:int=0; count:int=500
class Control(BaseModel): device_id:str; action:str; value:Optional[int]=None; uri:Optional[str]=None; metadata:Optional[str]=None; source_index:Optional[int]=None; source_name:Optional[str]=None

def service(device, needles):
    for s in device.services:
        probe=(getattr(s,"service_id","")+" "+getattr(s,"service_type","")).lower()
        if any(n.lower() in probe for n in needles): return s
    return None

def find_volume_service(d):
    """Prefers the OpenHome Volume service (typical for Linn devices):
    it offers real dB resolution via Characteristics()
    (VolumeMilliDbPerStep). Fallback: classic UPnP-AV
    RenderingControl service (0-100 only, no dB)."""
    for s in d.services:
        sid=(getattr(s,"service_id","")+" "+getattr(s,"service_type","")).lower()
        if "openhome" in sid and "volume" in sid: return s,"openhome"
    for s in d.services:
        sid=(getattr(s,"service_id","")+" "+getattr(s,"service_type","")).lower()
        if "renderingcontrol" in sid or "volume" in sid: return s,"avtransport"
    return None,None

def device_json(key,d):
    sv=[getattr(s,"service_id","") for s in d.services]
    is_server=any("contentdirectory" in x.lower() for x in sv)
    is_renderer=any(x in " ".join(sv).lower() for x in ["avtransport","openhome","playlist"])
    return {"id":key,"name":getattr(d,"friendly_name",key),"manufacturer":getattr(d,"manufacturer",None),"model":getattr(d,"model_name",None),"server":is_server,"renderer":is_renderer,"services":sv}

@app.get("/")
def index(): return FileResponse("app/static/index.html")

@app.get("/api/discover")
def discover(timeout:int=4):
    global devices
    try: found=upnpclient.discover(timeout=timeout)
    except Exception as e: raise HTTPException(502,f"SSDP discovery failed: {e}")
    fresh={}
    for d in found:
        key=getattr(d,"udn",None) or getattr(d,"location",None) or str(id(d)); fresh[key]=d
    with lock: devices=fresh
    return {"devices":[device_json(k,d) for k,d in fresh.items()]}

@app.get("/api/devices/{device_id}/services")
def services(device_id:str):
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found. Please search again.")
    return device_json(device_id,d)

@app.get("/api/devices/{device_id}/volume")
def get_volume(device_id:str):
    """Read current volume. For Linn/OpenHome devices (kind 'openhome')
    this returns a real dB reading via the Volume service, otherwise
    (kind 'avtransport') only the standard UPnP 0-100 percentage.
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
            return {"kind":"openhome","raw":raw,"max":vmax,"db":round(db,1),"percent":round(100*raw/vmax)}
        v=vol.GetVolume(InstanceID=0,Channel="Master")
        raw=int(v.get("CurrentVolume",0))
        return {"kind":"avtransport","raw":raw,"max":100,"db":None,"percent":raw}
    except Exception as e:
        raise HTTPException(502,f"Could not read volume: {e}")

@app.get("/api/devices/{device_id}/transport")
def get_transport(device_id:str):
    """Playback state + position (used for the elapsed-time display and
    for automatically advancing to the next track once one has finished)."""
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found")
    av=service(d,["AVTransport"])
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

@app.get("/api/devices/{device_id}/sources")
def list_sources(device_id:str):
    """Lists the switchable sources on the device (OpenHome Product
    service) -- e.g. to find a TIDAL source configured on the Majik DSM4.
    Only available on OpenHome devices; not verified against real hardware."""
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found")
    prod=service(d,["product"])
    if not prod: raise HTTPException(400,"No OpenHome Product service on this device -- source switching not possible")
    try:
        count=int(prod.SourceCount().get("Value",0))
    except Exception as e:
        raise HTTPException(502,f"Could not read sources: {e}")
    out=[]
    for i in range(count):
        try:
            r=prod.Source(Index=i)
            out.append({"index":i,"system_name":r.get("SystemName",""),"type":r.get("Type",""),"name":r.get("Name",""),"visible":r.get("Visible",True)})
        except Exception:
            continue
    return {"sources":out}

def local_name(tag): return tag.split('}',1)[-1]
def child_text(node,name):
    for c in node.iter():
        if local_name(c.tag)==name: return c.text or ""
    return ""

def artist_fields(node):
    """upnp:artist can legitimately appear more than once per item, each
    with a different @role attribute (e.g. role="Performer" vs
    role="AlbumArtist") -- some servers use that instead of (or as well
    as) a dedicated <upnp:albumArtist> element. Looking only for an
    element literally named "albumArtist" misses the role-based
    convention entirely and silently returns nothing for every track."""
    plain_artist=""; album_artist=""
    for c in node.iter():
        name=local_name(c.tag)
        if name=="artist":
            role=(c.attrib.get("role") or "").strip().lower()
            if role in ("albumartist","album artist"):
                if not album_artist: album_artist=c.text or ""
            else:
                if not plain_artist: plain_artist=c.text or ""
        elif name=="albumArtist" and not album_artist:
            album_artist=c.text or ""
    return plain_artist, album_artist

def parse_didl(xml):
    if not xml: return []
    try: root=ET.fromstring(xml)
    except ET.ParseError: return []
    out=[]
    for n in list(root):
        typ=local_name(n.tag); resources=[]
        for c in n:
            if local_name(c.tag)=="res": resources.append({"uri":c.text or "","protocol":c.attrib.get("protocolInfo",""),"duration":c.attrib.get("duration",""),"sample_rate":c.attrib.get("sampleFrequency",""),"bits_per_sample":c.attrib.get("bitsPerSample",""),"bitrate":c.attrib.get("bitrate","")})
        artist,album_artist=artist_fields(n)
        out.append({"type":typ,"id":n.attrib.get("id",""),"parent_id":n.attrib.get("parentID",""),"title":child_text(n,"title"),"artist":artist,"album_artist":album_artist,"album":child_text(n,"album"),"genre":child_text(n,"genre"),"date":child_text(n,"date"),"track_number":child_text(n,"originalTrackNumber"),"album_art":child_text(n,"albumArtURI"),"class":child_text(n,"class"),"resources":resources,"metadata":ET.tostring(n,encoding="unicode")})
    return out

def browse_all(s, object_id):
    """Fetch all children of a container (with pagination). A blocking
    network call -- parallelised across a thread pool during a scan."""
    items=[]; start=0
    while True:
        try:
            r=s.Browse(ObjectID=object_id,BrowseFlag="BrowseDirectChildren",Filter="*",StartingIndex=start,RequestedCount=200,SortCriteria="")
        except Exception as e:
            raise RuntimeError(f"Browse failed (ObjectID={object_id}): {e}")
        items.extend(parse_didl(r.get("Result","")))
        number_returned=int(r.get("NumberReturned",0) or 0)
        total_matches=int(r.get("TotalMatches",0) or 0)
        start+=number_returned
        if number_returned==0 or start>=total_matches: break
    return items

def pick_scan_root(s, root_object_id):
    """Looks under root_object_id for a plain by-folder view (each file
    only once). If found, ONLY that is scanned -- on servers like
    MinimServer (which also organise things in parallel by
    artist/album/genre/composer) this saves most of the network requests
    and avoids duplicates from the start, instead of filtering them out
    afterwards."""
    try:
        items=browse_all(s, root_object_id)
    except Exception:
        return root_object_id, None
    for i in items:
        if i["type"]=="container" and i["title"].strip().lower() in CANONICAL_CONTAINER_NAMES:
            return i["id"], i["title"]
    return root_object_id, None

def load_cached_library():
    try:
        with open(CACHE_FILE,"r",encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def save_cached_library(data):
    # Caching is a convenience, never a reason to fail the request that
    # produced the data -- swallow any disk error.
    try:
        CACHE_DIR.mkdir(parents=True,exist_ok=True)
        with open(CACHE_FILE,"w",encoding="utf-8") as f:
            json.dump(data,f)
    except Exception:
        pass

@app.get("/api/library/cached")
def get_cached_library():
    """Returns the last scanned library from disk, if any -- lets the app
    show the library again right after starting, without a fresh scan."""
    cached=load_cached_library()
    if not cached: raise HTTPException(404,"No cached library yet")
    return cached

@app.delete("/api/library/cached")
def clear_cached_library():
    try:
        CACHE_FILE.unlink(missing_ok=True)
    except Exception as e:
        raise HTTPException(500,f"Could not clear cache: {e}")
    return {"ok":True}

class ScanReq(BaseModel):
    device_id: str
    object_id: str = "0"

@app.get("/api/scan/progress")
def scan_progress():
    """Polled by the frontend while /api/scan is running, so it's visible
    that the scan is still working (and not stuck) -- for large libraries
    a full scan can take a while."""
    with scan_lock:
        return dict(scan_state)

@app.post("/api/scan")
def scan(req: ScanReq):
    """Scans the ContentDirectory from object_id (preferring a single
    by-folder view, see pick_scan_root) and returns a flat list of all
    audio items. Network requests to individual folders run in parallel
    across a thread pool (SCAN_WORKERS at a time) instead of strictly one
    after another -- with many small folders this is the biggest speed
    gain, since the wait time per request (network latency) then overlaps
    instead of adding up."""
    d=devices.get(req.device_id)
    if not d: raise HTTPException(404,"Media server not found")
    s=service(d,["ContentDirectory"])
    if not s: raise HTTPException(400,"No ContentDirectory service present")

    scan_root,scan_root_name=pick_scan_root(s,req.object_id)

    tracks=[]; visited={scan_root}; seen_uris=set()
    with scan_lock: scan_state.update(running=True,count=0,containers=0)

    try:
        with cf.ThreadPoolExecutor(max_workers=SCAN_WORKERS) as executor:
            pending={executor.submit(browse_all,s,scan_root)}
            while pending:
                done,pending=cf.wait(pending,return_when=cf.FIRST_COMPLETED)
                for fut in done:
                    try:
                        items=fut.result()
                    except Exception:
                        continue  # skip a single failed folder rather than aborting the whole scan
                    with scan_lock: scan_state["containers"]+=1
                    for i in items:
                        if i["type"]=="container":
                            if i["id"] not in visited:
                                visited.add(i["id"])
                                pending.add(executor.submit(browse_all,s,i["id"]))
                        elif i["type"]=="item" and i["resources"]:
                            uri=i["resources"][0]["uri"]
                            if uri in seen_uris: continue
                            seen_uris.add(uri)
                            tracks.append(i)
                            with scan_lock: scan_state["count"]=len(tracks)
    finally:
        with scan_lock: scan_state["running"]=False

    result={"tracks":tracks,"count":len(tracks),"scan_root":scan_root_name or "all views (Artist/Album/Genre/...)","scanned_at":time.time()}
    save_cached_library(result)
    return result

@app.post("/api/browse")
def browse(req:Browse):
    d=devices.get(req.device_id)
    if not d: raise HTTPException(404,"Media server not found")
    s=service(d,["ContentDirectory"])
    if not s: raise HTTPException(400,"No ContentDirectory service present")
    try:r=s.Browse(ObjectID=req.object_id,BrowseFlag="BrowseDirectChildren",Filter="*",StartingIndex=req.start,RequestedCount=req.count,SortCriteria="")
    except Exception as e: raise HTTPException(502,f"Browse failed: {e}")
    return {"items":parse_didl(r.get("Result","")),"number_returned":int(r.get("NumberReturned",0)),"total_matches":int(r.get("TotalMatches",0)),"update_id":r.get("UpdateID")}

@app.post("/api/control")
def control(req:Control):
    d=devices.get(req.device_id)
    if not d: raise HTTPException(404,"Output device not found")
    av=service(d,["AVTransport"])
    try:
        if req.action=="play": av.Play(InstanceID=0,Speed="1")
        elif req.action=="pause": av.Pause(InstanceID=0)
        elif req.action=="stop": av.Stop(InstanceID=0)
        elif req.action in ("next","previous"): getattr(av,req.action.capitalize())(InstanceID=0)
        elif req.action=="set_uri": av.SetAVTransportURI(InstanceID=0,CurrentURI=req.uri or "",CurrentURIMetaData=req.metadata or ""); av.Play(InstanceID=0,Speed="1")
        elif req.action=="volume":
            vol,kind=find_volume_service(d)
            if not vol: raise HTTPException(400,"No volume service on this device")
            if kind=="openhome": vol.SetVolume(Value=max(0,req.value or 0))
            else: vol.SetVolume(InstanceID=0,Channel="Master",DesiredVolume=max(0,min(100,req.value or 0)))
        elif req.action=="set_source":
            prod=service(d,["product"])
            if not prod: raise HTTPException(400,"No OpenHome Product service on this device")
            if req.source_name: prod.SetSourceIndexByName(Value=req.source_name)
            elif req.source_index is not None: prod.SetSourceIndex(Value=req.source_index)
            else: raise HTTPException(400,"source_index or source_name required")
        else: raise HTTPException(400,"Unknown action")
    except HTTPException: raise
    except Exception as e: raise HTTPException(502,f"Control command failed: {e}")
    return {"ok":True}
