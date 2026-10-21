"""Helpers for talking to UPnP devices: finding services (also on a player's sibling devices), icons, device JSON."""
from __future__ import annotations
from urllib.parse import urljoin, urlparse

from app.state import devices, _merged_primary

def service(device, needles):
    for s in device.services:
        probe=(getattr(s,"service_id","")+" "+getattr(s,"service_type","")).lower()
        if any(n.lower() in probe for n in needles): return s
    return None

class StrictSoap:
    """Wraps a UPnP service so every action goes out with `Content-Type: text/xml; charset="utf-8"`.
    upnpclient sends a bare `text/xml`, which Marantz/Denon (HEOS) and Sonos answer with
    "400 Bad Request" before looking at the action at all."""
    HEADERS={"Content-Type":'text/xml; charset="utf-8"'}
    def __init__(self,svc): self._svc=svc
    def __getattr__(self,name):
        attr=getattr(self._svc,name)
        if name[:1].isupper() and callable(attr): return lambda **kw: attr(http_headers=self.HEADERS,**kw)
        return attr

def av_transport(d):
    """The AVTransport service of a device or its siblings, or None."""
    svc=peer_service(d,["AVTransport"])
    return StrictSoap(svc) if svc else None

def _host(d):
    return urlparse(getattr(d,"location","") or "").hostname

def peer_devices(d):
    """The device itself plus any other discovered device on the same IP.
    Linn/OpenHome players publish several UPnP devices (e.g. the OpenHome
    one and a separate MediaRenderer); the OpenHome services (Playlist,
    Product, Volume, Time) may sit on a different one than the entry the
    user selected."""
    h=_host(d)
    return [d]+[o for o in list(devices.values()) if o is not d and h and _host(o)==h]

def peer_service(d, needles):
    for dev in peer_devices(d):
        s=service(dev,needles)
        if s: return s
    return None

def find_volume_service(d):
    """Prefers the OpenHome Volume service (typical for Linn devices):
    it offers real dB resolution via Characteristics()
    (VolumeMilliDbPerStep). Fallback: classic UPnP-AV
    RenderingControl service (0-100 only, no dB) -- wrapped in StrictSoap
    like AVTransport, since it is what HEOS and Sonos players offer."""
    for dev in peer_devices(d):
        for s in dev.services:
            sid=(getattr(s,"service_id","")+" "+getattr(s,"service_type","")).lower()
            if "openhome" in sid and "volume" in sid: return s,"openhome"
    for s in d.services:
        sid=(getattr(s,"service_id","")+" "+getattr(s,"service_type","")).lower()
        if "renderingcontrol" in sid or "volume" in sid: return StrictSoap(s),"renderingcontrol"
    return None,None

def device_icon(d):
    """Picks an icon URL from the device description's <iconList> (the
    icons UPnP control points like the Linn app show for each device).
    upnpclient already downloaded and kept that XML during discovery, so
    no extra request is needed. Prefers PNG (often transparent) at a size
    close to 64px; returns an absolute http(s) URL or None."""
    root=getattr(d,"_root_xml",None)
    if root is None: return None
    dev=next((c for c in root if isinstance(c.tag,str) and local_name(c.tag)=="device"),None)
    icon_list=next((c for c in (dev if dev is not None else []) if isinstance(c.tag,str) and local_name(c.tag)=="iconList"),None)
    if icon_list is None: return None
    best=None; best_score=None
    for icon in icon_list:
        f={local_name(c.tag):(c.text or "").strip() for c in icon if isinstance(c.tag,str)}
        if not f.get("url"): continue
        try: size=int(f.get("width") or 0)
        except ValueError: size=0
        score=(0 if "png" in f.get("mimetype","").lower() else 1, abs((size or 64)-64))
        if best_score is None or score<best_score: best,best_score=f["url"],score
    if not best: return None
    url=urljoin(getattr(d,"_url_base","") or getattr(d,"location",""),best)
    return url if urlparse(url).scheme in ("http","https") else None

def device_json(key,d):
    # A merged player (see discover) reports the services of all its sibling devices.
    sv=[getattr(s,"service_id","") for dev in peer_devices(d) if dev is d or key in _merged_primary for s in dev.services]
    is_server=any("contentdirectory" in x.lower() for x in sv)
    is_renderer=any(x in " ".join(sv).lower() for x in ["avtransport","openhome","playlist"])
    return {"id":key,"name":getattr(d,"friendly_name",key),"manufacturer":getattr(d,"manufacturer",None),"model":getattr(d,"model_name",None),"server":is_server,"renderer":is_renderer,"icon":device_icon(d),"services":sv}

def _has_openhome_product(d):
    return any("openhome" in (getattr(s,"service_type","") or "").lower() and ":product:" in (getattr(s,"service_type","") or "").lower() for s in d.services)

def _openhome_service(d, name):
    return peer_service(d,[f"openhome-org:service:{name}"]) or peer_service(d,[f"openhome-org:serviceId:{name}"])

def _wake(d):
    """A device in standby ignores source and pin requests -- wake it first."""
    prod=_openhome_service(d,"Product")
    try:
        if prod and prod.Standby().get("Value"): prod.SetStandby(Value="0")
    except Exception: pass

def local_name(tag): return tag.split('}',1)[-1]
