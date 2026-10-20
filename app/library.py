"""The media server library: browsing a folder, scanning everything, and the on-disk cache of the last scan."""
from __future__ import annotations
import concurrent.futures as cf
import json
import os
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.didl import browse_all, is_audio, parse_didl, pick_scan_root, track_key
from app.state import CACHE_DIR, CACHE_FILE, SCAN_MAX_DEPTH, SCAN_STALL_CONTAINERS, SCAN_WORKERS, devices, scan_lock, scan_state
from app.upnp import service

router=APIRouter()

class Browse(BaseModel): device_id:str; object_id:str="0"; start:int=0; count:int=500

def load_cached_library():
    try:
        with open(CACHE_FILE,"r",encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def save_cached_library(data):
    # Caching is a convenience, never a reason to fail the request that
    # produced the data -- swallow any disk error.
    # Write to a temp file and swap it in, so a crash mid-write can't
    # leave a truncated library.json behind.
    tmp=CACHE_FILE.with_suffix(".json.tmp")
    try:
        CACHE_DIR.mkdir(parents=True,exist_ok=True)
        with open(tmp,"w",encoding="utf-8") as f:
            json.dump(data,f)
        os.replace(tmp,CACHE_FILE)
    except Exception:
        try: tmp.unlink(missing_ok=True)
        except Exception: pass

@router.get("/api/library/cached")
def get_cached_library():
    """Returns the last scanned library from disk, if any -- lets the app
    show the library again right after starting, without a fresh scan."""
    cached=load_cached_library()
    if not cached: raise HTTPException(404,"No cached library yet")
    return cached

@router.delete("/api/library/cached")
def clear_cached_library():
    try:
        CACHE_FILE.unlink(missing_ok=True)
    except Exception as e:
        raise HTTPException(500,f"Could not clear cache: {e}")
    return {"ok":True}

class ScanReq(BaseModel):
    device_id: str
    object_id: str = "0"

def system_update_id(s):
    """The server's SystemUpdateID: a counter it raises whenever its content changes
    (MinimServer: after a rescan of the music folders). None if it doesn't say."""
    try:
        v=s.GetSystemUpdateID()
        v=v.get("Id") if isinstance(v,dict) else v
        return int(v)
    except Exception:
        return None

@router.get("/api/library/changed")
def library_changed(device_id:str):
    """Whether the media server's content changed since the saved library was scanned,
    so the app can offer a fresh scan instead of the user guessing."""
    cached=load_cached_library()
    if not cached or cached.get("system_update_id") is None: return {"known":False}
    if cached.get("device_id") not in (None,device_id): return {"known":False}   # scanned from another server
    d=devices.get(device_id)
    s=service(d,["ContentDirectory"]) if d else None
    now=system_update_id(s) if s else None
    if now is None: return {"known":False}
    return {"known":True,"changed":now!=cached["system_update_id"],"update_id":now}

@router.get("/api/scan/progress")
def scan_progress():
    """Polled by the frontend while /api/scan is running, so it's visible
    that the scan is still working (and not stuck) -- for large libraries
    a full scan can take a while."""
    with scan_lock:
        return dict(scan_state)

@router.post("/api/scan/cancel")
def scan_cancel():
    """Stops a running scan; nothing of it is kept or cached."""
    with scan_lock:
        if scan_state["running"]: scan_state["cancel"]=True
        return {"ok":True,"was_running":scan_state["running"]}

@router.post("/api/scan")
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

    # Read before scanning: whatever changes during the scan then still counts as "changed" next time.
    update_id=system_update_id(s)

    # Only one scan at a time -- they'd share scan_state and the cache file.
    with scan_lock:
        if scan_state["running"]: raise HTTPException(409,"A library scan is already running")
        scan_state.update(running=True,cancel=False,count=0,containers=0)

    cancelled=stalled=False
    stats={"folders":0,"failed_folders":[],"duplicates":0,"merged_by_tags":0,"non_audio":0,"loops_skipped":0,"too_deep":0}
    started=time.time()
    try:
        scan_root,scan_root_name,root_titles=pick_scan_root(s,req.object_id)
        stats["root_folders"]=root_titles[:40]
        tracks=[]; visited={scan_root}; seen_uris=set(); seen_keys=set(); idle=0
        with cf.ThreadPoolExecutor(max_workers=SCAN_WORKERS) as executor:
            # each pending folder carries the titles leading to it, to spot a tree that loops
            pending={executor.submit(browse_all,s,scan_root):(scan_root_name or "",)}
            while pending:
                done,_=cf.wait(pending,return_when=cf.FIRST_COMPLETED)
                for fut in done:
                    path=pending.pop(fut)
                    try:
                        items=fut.result()
                    except Exception as e:
                        if len(stats["failed_folders"])<20: stats["failed_folders"].append(f'{"/".join(path) or "root"}: {e}')
                        continue  # skip a single failed folder rather than aborting the whole scan
                    with scan_lock: scan_state["containers"]+=1
                    idle+=1; stats["folders"]+=1
                    for i in items:
                        if i["type"]=="container":
                            title=i["title"].strip().lower()
                            if i["id"] in visited: continue
                            if len(path)>=SCAN_MAX_DEPTH: stats["too_deep"]+=1; continue
                            if [p.lower() for p in path].count(title)>=2: stats["loops_skipped"]+=1; continue
                            visited.add(i["id"])
                            pending[executor.submit(browse_all,s,i["id"])]=path+(i["title"],)
                        elif i["type"]=="item" and i["resources"] and not is_audio(i):
                            stats["non_audio"]+=1
                        elif i["type"]=="item" and i["resources"]:
                            uri=i["resources"][0]["uri"]
                            key=track_key(i)
                            if uri in seen_uris: stats["duplicates"]+=1; continue
                            if key and key in seen_keys: stats["merged_by_tags"]+=1; continue
                            seen_uris.add(uri)
                            if key: seen_keys.add(key)
                            tracks.append(i); idle=0
                            with scan_lock: scan_state["count"]=len(tracks)
                with scan_lock: cancelled=scan_state["cancel"]
                stalled=idle>=SCAN_STALL_CONTAINERS
                if cancelled or stalled:
                    for fut in pending: fut.cancel()
                    break
    finally:
        with scan_lock: scan_state.update(running=False,cancel=False)

    stats.update(seconds=round(time.time()-started,1),stalled=stalled,scan_root=scan_root_name or "")
    if cancelled: raise HTTPException(409,"The scan was cancelled")

    result={"tracks":tracks,"count":len(tracks),"scan_root":scan_root_name or "all views (Artist/Album/Genre/...)","scanned_at":time.time(),"stats":stats,
            "device_id":req.device_id,"system_update_id":update_id}
    if stalled:
        looped=stats["loops_skipped"] or stats["too_deep"]
        result["warning"]=("The scan stopped early: the server kept listing folders without new tracks (a loop in its tree?)." if looped
                           else "The scan ended after thousands of folders without a new track: the server lists the tracks again in its other views (Artist, Genre ...).")
    save_cached_library(result)
    return result

class SearchReq(BaseModel): device_id:str; query:str; start:int=0; count:int=200

SEARCH_FIELDS=("dc:title","upnp:artist","upnp:album","dc:creator")

def _quote(q):
    return '"'+q.replace("\\","\\\\").replace('"','\\"')+'"'

@router.post("/api/search")
def search(req:SearchReq):
    """Search the whole media server (ContentDirectory Search), for Live mode.
    Returns matching albums (first page only) followed by matching tracks; the
    counts refer to the tracks, so "Load more" pages through them."""
    d=devices.get(req.device_id)
    if not d: raise HTTPException(404,"Media server not found")
    s=service(d,["ContentDirectory"])
    if not s: raise HTTPException(400,"No ContentDirectory service present")
    q=req.query.strip()
    if not q: raise HTTPException(400,"Empty search")
    try: caps=(s.GetSearchCapabilities().get("SearchCaps") or "").strip()
    except Exception: caps=""
    fields=[f for f in SEARCH_FIELDS if caps=="*" or f in caps.split(",")]
    if not fields: raise HTTPException(400,"This media server doesn't support searching -- browse the folders, or use the Library tab.")
    any_field=" or ".join(f"{f} contains {_quote(q)}" for f in fields)
    def run(criteria,start,count):
        r=s.Search(ContainerID="0",SearchCriteria=criteria,Filter="*",StartingIndex=start,RequestedCount=count,SortCriteria="")
        return parse_didl(r.get("Result","")),int(r.get("NumberReturned",0) or 0),int(r.get("TotalMatches",0) or 0)
    albums=[]
    if req.start==0:
        album_fields=" or ".join(f"{f} contains {_quote(q)}" for f in fields if f in ("dc:title","upnp:artist"))
        if album_fields:
            try: albums=[a for a in run(f'upnp:class derivedfrom "object.container.album" and ({album_fields})',0,100)[0] if a.get("type")=="container"]
            except Exception: albums=[]   # some servers only search items: then just tracks
    try: tracks,returned,total=run(f'upnp:class derivedfrom "object.item.audioItem" and ({any_field})',req.start,req.count)
    except Exception as e: raise HTTPException(502,f"Search failed: {e}")
    return {"items":albums+tracks,"number_returned":returned,"total_matches":total}

@router.post("/api/browse")
def browse(req:Browse):
    d=devices.get(req.device_id)
    if not d: raise HTTPException(404,"Media server not found")
    s=service(d,["ContentDirectory"])
    if not s: raise HTTPException(400,"No ContentDirectory service present")
    try:r=s.Browse(ObjectID=req.object_id,BrowseFlag="BrowseDirectChildren",Filter="*",StartingIndex=req.start,RequestedCount=req.count,SortCriteria="")
    except Exception as e: raise HTTPException(502,f"Browse failed: {e}")
    return {"items":parse_didl(r.get("Result","")),"number_returned":int(r.get("NumberReturned",0)),"total_matches":int(r.get("TotalMatches",0)),"update_id":r.get("UpdateID")}
