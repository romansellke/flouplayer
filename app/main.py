"""Flou Player backend: creates the FastAPI app and wires up the parts.

The endpoints live in the other modules of this package:
devices (search, reconnect, readings), openhome (sources, pins, standby, ...),
control (transport/volume/... commands), library (browse, scan, cache),
transcode (local playback), playlist (the device queue), tidal (TIDAL search,
played by the device) and media (media keys / MPRIS).
"""
from __future__ import annotations
import contextlib
import json
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__, control, devices as devices_api, library, media, openhome, playlist, tidal, transcode

# Resolve static files relative to this module, not the current working
# directory, so the app also works when started from another folder.
STATIC_DIR=Path(__file__).resolve().parent/"static"
@contextlib.asynccontextmanager
async def lifespan(_app):
    await media.start_mpris()   # media keys / panel player controls (Linux, if a session D-Bus is there)
    yield
    await media.stop_mpris()

app=FastAPI(title="Flou Player", version=__version__, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Only the app's own page (and scripts on this computer) may use the backend. It listens on 127.0.0.1
# only, but any web page open in a browser can still send requests there: a form post or an <img> from
# another site, or a foreign host name pointed at 127.0.0.1 (DNS rebinding) to read the answers too.
# So the Host must be a loopback name, and a request the browser marks as coming from elsewhere is refused.
LOCAL_HOSTS={"127.0.0.1","localhost","::1"}

def is_local_request(headers):
    host=(headers.get("host") or "").lower()
    if urlsplit("//"+host).hostname not in LOCAL_HOSTS: return False
    origin=headers.get("origin")
    if origin is not None and urlsplit(origin.lower()).netloc!=host: return False   # "null" included
    return headers.get("sec-fetch-site") not in ("cross-site","same-site")   # same-site: another port on this computer

@app.middleware("http")
async def only_local(request,call_next):
    if not is_local_request(request.headers):
        return JSONResponse({"detail":"Flou Player only answers its own window."},status_code=403)
    return await call_next(request)

@app.middleware("http")
async def no_cache_ui(request,call_next):
    """The app window keeps a persistent web profile; without this it can
    serve old index.html/style.css/script files after an update."""
    resp=await call_next(request)
    if request.url.path=="/" or request.url.path.startswith("/static/"):
        resp.headers["Cache-Control"]="no-cache"
    return resp

@app.get("/")
def index(): return FileResponse(STATIC_DIR/"index.html")

APP_ID="flou-player"
def _build_id():
    """Fingerprint of the code/UI this process serves, so a newly started
    Flou Player can tell whether the instance already running is outdated."""
    import hashlib
    h=hashlib.sha1()
    for f in sorted(Path(__file__).resolve().parent.glob("*.py"))+sorted(STATIC_DIR.rglob("*")):
        if f.is_file(): h.update(f.name.encode()); h.update(f.read_bytes())
    return h.hexdigest()[:12]
BUILD_ID=_build_id()

REPO_URL="https://github.com/romansellke/flouplayer"

def _source_info():
    """Which commit this copy was built from: packaging/build.sh stamps
    app/_buildinfo.json into the installed app; a source checkout asks git.
    Either may be missing (e.g. a plain download) -- then there is no info."""
    import subprocess
    here=Path(__file__).resolve().parent
    try:
        info=json.loads((here/"_buildinfo.json").read_text(encoding="utf-8"))
        if isinstance(info,dict): return {k:str(info.get(k) or "") for k in ("describe","commit","date")}
    except Exception: pass
    def git(*a):
        return subprocess.run(["git","-C",str(here.parent),*a],capture_output=True,text=True,timeout=3,check=True).stdout.strip()
    try:
        return {"describe":git("describe","--tags","--always","--dirty"),"commit":git("rev-parse","--short","HEAD"),"date":git("log","-1","--format=%cs")}
    except Exception:
        return {"describe":"","commit":"","date":""}
SOURCE_INFO=_source_info()

@app.get("/api/app/about")
def about():
    import platform, importlib.metadata as md
    deps={}
    for name in ["fastapi","uvicorn","upnpclient","av","tidalapi","pywebview","PyQt5","dbus-fast"]:
        try: deps[name]=md.version(name)
        except Exception: pass
    return {"name":"Flou Player","version":__version__,"build":BUILD_ID,"source":SOURCE_INFO,"license":"GPL-3.0-or-later","python":platform.python_version(),
            "platform":platform.platform(),"repo":REPO_URL,"changelog":REPO_URL+"/blob/main/CHANGELOG.md","dependencies":deps}

@app.get("/api/app/ping")
def ping():
    """Lets a newly started Flou Player recognise an already running one
    on the same port (see desktop.py)."""
    return {"app":APP_ID,"build":BUILD_ID}

for _module in (devices_api, openhome, control, library, transcode, playlist, tidal, media):
    app.include_router(_module.router)

