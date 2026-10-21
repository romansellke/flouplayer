"""TIDAL: logging in, searching, albums and artists -- played by the Linn device itself.

Flou Player only uses TIDAL to find music. Playing works the way the Linn app
does it: a tidal:// URI goes into the device's own playlist (see playlist.py)
and the device streams the track with the TIDAL account stored on it (Linn
Account / Linn app). So nothing is streamed through this app, and stream URLs
never expire under the device's feet.

The login is TIDAL's device login (open a link, confirm, done) via the
`tidalapi` package; the tokens are kept in ~/.cache/flou_player/tidal.json.
"""
from __future__ import annotations
import json
import os
import threading
import time
import xml.etree.ElementTree as ET
from typing import Any, Optional

from fastapi import APIRouter, HTTPException

from app.state import CACHE_DIR, devices
from app.upnp import peer_service

router=APIRouter()

SESSION_FILE=CACHE_DIR/"tidal.json"
# The URI a Linn/OpenHome device resolves itself with its stored TIDAL login.
# NOTE: the form Linn's apps put into the playlist; not publicly documented.
# If a device refuses it, compare with the URI of a TIDAL track the Linn app
# added to the queue (Diagnostics -> Device info, or the queue's metadata).
TRACK_URI="tidal://track?version=1&trackId={id}"
COVER_SIZE=320

_lock=threading.Lock()
_session:Any=None
_login:dict[str,Any]={}   # the device login in progress: link, code, expiry, future

def _tidalapi():
    try:
        import tidalapi
    except ImportError:
        raise HTTPException(503,"TIDAL support needs the 'tidalapi' package (pip install -r requirements.txt)")
    return tidalapi

def _save(s):
    CACHE_DIR.mkdir(parents=True,exist_ok=True)
    data={"token_type":s.token_type,"access_token":s.access_token,"refresh_token":s.refresh_token,"is_pkce":bool(getattr(s,"is_pkce",False))}
    tmp=SESSION_FILE.with_suffix(".tmp")
    with open(os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),"w") as f: json.dump(data,f)   # tokens: readable by the user only
    tmp.replace(SESSION_FILE)

def _load():
    """The saved session, or None. Loading refreshes an expired access token."""
    try: data=json.loads(SESSION_FILE.read_text(encoding="utf-8"))
    except Exception: return None
    s=_tidalapi().Session()
    try:
        ok=s.load_oauth_session(data.get("token_type") or "Bearer",data.get("access_token"),data.get("refresh_token"),is_pkce=bool(data.get("is_pkce")))
    except Exception:
        return None
    if not ok: return None
    if s.access_token!=data.get("access_token"): _save(s)
    return s

def _session_or_none():
    global _session
    with _lock:
        fut=_login.get("future")
        if fut and fut.done():   # the device login finished (or ran out)
            s=_login.pop("session"); _login.clear()
            try:
                fut.result()
                if s.check_login(): _save(s); _session=s
            except Exception as e:
                _login["error"]=str(e) or "The login link expired"
        if _session is None and SESSION_FILE.exists(): _session=_load()
        return _session

def _need_session():
    s=_session_or_none()
    if not s: raise HTTPException(401,"Not logged in to TIDAL")
    return s

def _call(fn):
    """Runs a TIDAL request; keeps a refreshed token and turns errors into HTTP errors."""
    s=_need_session(); before=s.access_token
    try: out=fn(s)
    except HTTPException: raise
    except Exception as e:
        raise HTTPException(502,f"TIDAL request failed: {e}")
    if s.access_token!=before:
        with _lock: _save(s)
    return out

# ---------- JSON for the page ----------
def _image(obj,size=COVER_SIZE):
    try: return obj.image(size)
    except Exception: return ""   # no cover/picture

def _year(album):
    d=getattr(album,"release_date",None) or getattr(album,"tidal_release_date",None)
    return d.year if d else None

def _clock(sec):
    sec=int(sec or 0); return f"{sec//3600}:{sec%3600//60:02d}:{sec%60:02d}"

def didl(t,cover=""):
    """DIDL-Lite for a TIDAL track, so the device and other control apps show title, artist and cover."""
    ns={"dc":"http://purl.org/dc/elements/1.1/","upnp":"urn:schemas-upnp-org:metadata-1-0/upnp/"}
    root=ET.Element("DIDL-Lite",{"xmlns":"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/","xmlns:dc":ns["dc"],"xmlns:upnp":ns["upnp"]})
    item=ET.SubElement(root,"item",{"id":f"tidal-{t.id}","parentID":"tidal","restricted":"1"})
    def add(tag,text):
        if text: ET.SubElement(item,tag).text=str(text)
    add("dc:title",t.name)
    add("upnp:artist",t.artist.name if t.artist else "")
    add("upnp:album",t.album.name if t.album else "")
    add("upnp:albumArtURI",cover)
    add("upnp:originalTrackNumber",getattr(t,"track_num",None))
    add("upnp:class","object.item.audioItem.musicTrack")
    res=ET.SubElement(item,"res",{"protocolInfo":"tidal:*:*:*","duration":_clock(t.duration)})
    res.text=TRACK_URI.format(id=t.id)
    return ET.tostring(root,encoding="unicode")

def track_json(t,cover=None):
    if cover is None: cover=_image(t.album) if t.album else ""
    return {"id":str(t.id),"title":t.name or "","artist":t.artist.name if t.artist else "","album":t.album.name if t.album else "",
            "album_id":str(t.album.id) if t.album else "","track_number":getattr(t,"track_num",None),"disc":getattr(t,"volume_num",None),
            "duration":int(t.duration or 0),"quality":getattr(t,"audio_quality","") or "","album_art":cover,
            "available":bool(getattr(t,"available",True)),"uri":TRACK_URI.format(id=t.id),"metadata":didl(t,cover)}

def album_json(a):
    return {"id":str(a.id),"title":a.name or "","artist":a.artist.name if a.artist else "","year":_year(a),
            "tracks":getattr(a,"num_tracks",None),"quality":getattr(a,"audio_quality","") or "","album_art":_image(a)}

def artist_json(a):
    return {"id":str(a.id),"name":a.name or "","picture":_image(a)}

# ---------- Login ----------
@router.get("/api/tidal/status")
def status():
    try: s=_session_or_none()
    except HTTPException as e:
        return {"available":False,"logged_in":False,"error":e.detail}
    out={"available":True,"logged_in":bool(s)}
    if s:
        u=s.user
        out["user"]=getattr(u,"username",None) or getattr(u,"email",None) or getattr(u,"first_name",None) or str(getattr(u,"id",""))
    with _lock:
        if _login.get("future"):
            out["login"]={"url":_login["url"],"code":_login["code"],"expires_in":max(0,int(_login["expires"]-time.time()))}
        if _login.get("error"): out["error"]=_login["error"]
    return out

@router.post("/api/tidal/login")
def login():
    """Starts TIDAL's device login: the page shows the link, the user confirms it in a browser."""
    tidalapi=_tidalapi()
    with _lock:
        if _login.get("future") and not _login["future"].done():
            return status()
        s=tidalapi.Session()
        try: link,fut=s.login_oauth()
        except Exception as e:
            raise HTTPException(502,f"Could not start the TIDAL login: {e}")
        url=link.verification_uri_complete
        _login.clear()
        _login.update(session=s,future=fut,code=link.user_code,expires=time.time()+float(link.expires_in),
                      url=url if url.startswith("http") else "https://"+url)
    return status()

@router.post("/api/tidal/logout")
def logout():
    global _session
    with _lock:
        _session=None; _login.clear()
        SESSION_FILE.unlink(missing_ok=True)
    return {"ok":True}

# ---------- Browsing ----------
@router.get("/api/tidal/search")
def search(q:str,limit:int=25):
    q=q.strip()
    if not q: return {"artists":[],"albums":[],"tracks":[]}
    def run(s):
        tidalapi=_tidalapi()
        r=s.search(q,models=[tidalapi.Artist,tidalapi.Album,tidalapi.Track],limit=max(1,min(limit,100)))
        return {"artists":[artist_json(a) for a in r["artists"]],"albums":[album_json(a) for a in r["albums"]],"tracks":[track_json(t) for t in r["tracks"]]}
    return _call(run)

@router.get("/api/tidal/albums/{album_id}")
def album(album_id:str):
    def run(s):
        a=s.album(album_id); cover=_image(a)
        return {"album":album_json(a),"tracks":[track_json(t,cover) for t in a.tracks()]}
    return _call(run)

@router.get("/api/tidal/artists/{artist_id}")
def artist(artist_id:str):
    def run(s):
        a=s.artist(artist_id); albums=[]
        for get in (a.get_albums,a.get_albums_ep_singles):
            try: albums+=get()
            except Exception: pass   # an artist without EPs/singles answers with an error
        return {"artist":artist_json(a),"albums":[album_json(x) for x in albums]}
    return _call(run)

# ---------- The device's own TIDAL login ----------
@router.get("/api/devices/{device_id}/tidal")
def device_tidal(device_id:str):
    """Whether the output device has a TIDAL account (OpenHome Credentials service, id "tidal.com")."""
    d=devices.get(device_id)
    if not d: raise HTTPException(404,"Device not found")
    cred=peer_service(d,[":credentials:"])
    if not cred: return {"supported":False}
    try: r=cred.Get(Id="tidal.com")
    except Exception as e:
        return {"supported":False,"error":str(e)}
    user=r.get("UserName") or ""; enabled=str(r.get("Enabled")).lower() in ("1","true")
    status=(r.get("Status") or "").strip()
    return {"supported":True,"user":user,"enabled":enabled,"status":status,"ready":bool(user) and enabled and not status}
