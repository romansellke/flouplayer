"""Internet radio: searching stations, favourites and your own stream URLs -- played by the Linn device itself.

Flou Player only looks stations up (radio-browser.info, a free community directory, no login).
Playing works like TIDAL (see tidal.py): the station's stream URL goes into the device's own
playlist (see playlist.py) as a live item, and the device fetches the stream itself. So nothing
is streamed through this app and playback goes on when Flou Player is closed.

Favourites and own URLs are kept in ~/.cache/flou_player/radio.json.
"""
from __future__ import annotations
import hashlib
import json
import threading
import xml.etree.ElementTree as ET
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.state import CACHE_DIR

router=APIRouter()

FAVOURITES_FILE=CACHE_DIR/"radio.json"
# radio-browser.info runs several mirrors; the first one that answers is used.
DIRECTORY_HOSTS=["de1.api.radio-browser.info","de2.api.radio-browser.info","nl1.api.radio-browser.info","at1.api.radio-browser.info"]
USER_AGENT="FlouPlayer/1 (+https://github.com/romansellke/flouplayer)"   # the directory asks for a real one
TIMEOUT=6
MIME={"mp3":"audio/mpeg","aac":"audio/aac","aac+":"audio/aac","ogg":"audio/ogg","flac":"audio/flac","opus":"audio/ogg","alac":"audio/mp4"}

_lock=threading.Lock()

def _get(path,params):
    """GET from the directory; mirrors are tried in turn."""
    last=None
    for host in DIRECTORY_HOSTS:
        try:
            req=Request(f"https://{host}/json/{path}?{urlencode(params)}",headers={"User-Agent":USER_AGENT})
            with urlopen(req,timeout=TIMEOUT) as r: return json.load(r)
        except Exception as e: last=e
    raise HTTPException(502,f"The radio directory (radio-browser.info) is not reachable: {last}")

def _valid_url(url):
    p=urlsplit(url or "")
    return p.scheme in ("http","https") and bool(p.hostname)

def didl(name,url,codec="",logo=""):
    """DIDL-Lite for a station: a live item, so the device and other control apps show name and logo."""
    ns={"dc":"http://purl.org/dc/elements/1.1/","upnp":"urn:schemas-upnp-org:metadata-1-0/upnp/"}
    root=ET.Element("DIDL-Lite",{"xmlns":"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/","xmlns:dc":ns["dc"],"xmlns:upnp":ns["upnp"]})
    item=ET.SubElement(root,"item",{"id":"radio-"+hashlib.sha1(url.encode()).hexdigest()[:12],"parentID":"radio","restricted":"1"})
    def add(tag,text):
        if text: ET.SubElement(item,tag).text=str(text)
    add("dc:title",name)
    add("upnp:albumArtURI",logo if _valid_url(logo) else "")
    add("upnp:class","object.item.audioItem.audioBroadcast")
    res=ET.SubElement(item,"res",{"protocolInfo":"http-get:*:"+MIME.get((codec or "").lower(),"audio/mpeg")+":*"})
    res.text=url
    return ET.tostring(root,encoding="unicode")

def station_json(id,name,url,codec="",bitrate=0,country="",tags="",logo=""):
    name=(name or "").strip() or url
    return {"id":id,"name":name,"url":url,"codec":codec or "","bitrate":int(bitrate or 0),"country":country or "","tags":tags or "",
            "logo":logo if _valid_url(logo) else "","uri":url,"metadata":didl(name,url,codec,logo)}

def _from_directory(s):
    return station_json(s.get("stationuuid") or hashlib.sha1((s.get("url_resolved") or "").encode()).hexdigest()[:12],s.get("name"),
                        s.get("url_resolved") or s.get("url"),s.get("codec"),s.get("bitrate"),s.get("country"),
                        ",".join((s.get("tags") or "").split(",")[:3]),s.get("favicon"))

# ---------- Favourites ----------
def _read():
    try:
        data=json.loads(FAVOURITES_FILE.read_text(encoding="utf-8"))
        return [s for s in data if isinstance(s,dict) and _valid_url(s.get("url"))] if isinstance(data,list) else []
    except (OSError,ValueError): return []

def _write(stations):
    CACHE_DIR.mkdir(parents=True,exist_ok=True)
    tmp=FAVOURITES_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps([{k:s.get(k,"") for k in ("id","name","url","codec","bitrate","country","tags","logo")} for s in stations]),encoding="utf-8")
    tmp.replace(FAVOURITES_FILE)

class Station(BaseModel):
    name:str=""; url:str; id:str=""; codec:str=""; bitrate:int=0; country:str=""; tags:str=""; logo:str=""

@router.get("/api/radio/favourites")
def favourites():
    with _lock: return {"stations":[station_json(**{k:s.get(k,"") for k in ("id","name","url","codec","bitrate","country","tags","logo")}) for s in _read()]}

@router.post("/api/radio/favourites")
def add_favourite(st:Station):
    """Adds a station (from the search) or an own stream URL (no id: one is made from the URL)."""
    url=st.url.strip()
    if not _valid_url(url): raise HTTPException(400,"The stream URL must start with http:// or https://")
    new=station_json(st.id or "own-"+hashlib.sha1(url.encode()).hexdigest()[:12],st.name,url,st.codec,st.bitrate,st.country,st.tags,st.logo)
    with _lock:
        stations=[s for s in _read() if s["url"]!=url and s["id"]!=new["id"]]
        _write(stations+[new])
    return {"ok":True,"station":new}

@router.delete("/api/radio/favourites/{station_id}")
def remove_favourite(station_id:str):
    with _lock: _write([s for s in _read() if s["id"]!=station_id])
    return {"ok":True}

# ---------- Searching ----------
def _haystack(s,by):
    fields=("name",) if by=="name" else ("tags",) if by=="tag" else ("name","tags","country","state","language")
    return " ".join(str(s.get(f) or "") for f in fields).lower()

@router.get("/api/radio/search")
def search(q:str,by:str="name",limit:int=40):
    """Stations by name, genre (tag) or both ("all": also country, state and language), the most listened first.

    Several words are all required, in any order, so a half-remembered name works: the directory is asked for
    the longest word and the other words filter the answer. Stations that don't work are left out."""
    words=q.lower().split()
    if not words: return {"stations":[]}
    limit=max(1,min(limit,100))
    key=max(words,key=len)
    fields=["tag"] if by=="tag" else ["name","tag"] if by=="all" else ["name"]
    raw=[]
    for field in fields:
        raw+=_get("stations/search",{"limit":100 if len(words)>1 or by=="all" else limit,"hidebroken":"true","order":"clickcount","reverse":"true",field:key})
    raw.sort(key=lambda s:-int(s.get("clickcount") or 0))
    out=[]; seen=set()
    for s in raw:
        hay=_haystack(s,by)
        if not all(w in hay for w in words): continue
        st=_from_directory(s)
        if _valid_url(st["url"]) and st["url"] not in seen: seen.add(st["url"]); out.append(st)
    return {"stations":out[:limit]}
