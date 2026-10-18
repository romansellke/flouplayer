"""The media server library: browsing a folder, scanning everything, and the on-disk cache of the last scan."""
from __future__ import annotations
import concurrent.futures as cf
import json
import os
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.didl import browse_all, parse_didl, pick_scan_root
from app.state import CACHE_DIR, CACHE_FILE, SCAN_WORKERS, devices, scan_lock, scan_state
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

@router.get("/api/scan/progress")
def scan_progress():
    """Polled by the frontend while /api/scan is running, so it's visible
    that the scan is still working (and not stuck) -- for large libraries
    a full scan can take a while."""
    with scan_lock:
        return dict(scan_state)

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

    # Only one scan at a time -- they'd share scan_state and the cache file.
    with scan_lock:
        if scan_state["running"]: raise HTTPException(409,"A library scan is already running")
        scan_state.update(running=True,count=0,containers=0)

    try:
        scan_root,scan_root_name=pick_scan_root(s,req.object_id)
        tracks=[]; visited={scan_root}; seen_uris=set()
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

@router.post("/api/browse")
def browse(req:Browse):
    d=devices.get(req.device_id)
    if not d: raise HTTPException(404,"Media server not found")
    s=service(d,["ContentDirectory"])
    if not s: raise HTTPException(400,"No ContentDirectory service present")
    try:r=s.Browse(ObjectID=req.object_id,BrowseFlag="BrowseDirectChildren",Filter="*",StartingIndex=req.start,RequestedCount=req.count,SortCriteria="")
    except Exception as e: raise HTTPException(502,f"Browse failed: {e}")
    return {"items":parse_didl(r.get("Result","")),"number_returned":int(r.get("NumberReturned",0)),"total_matches":int(r.get("TotalMatches",0)),"update_id":r.get("UpdateID")}
