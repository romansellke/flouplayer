"""DIDL-Lite parsing and walking a media server's ContentDirectory."""
from __future__ import annotations
import copy
import xml.etree.ElementTree as ET

from app.upnp import local_name

# Common names for a plain "by folder/file" view, which contains each track
# only ONCE -- unlike the parallel views by artist/album/genre/composer,
# where the same track shows up multiple times.
CANONICAL_CONTAINER_NAMES={"folder","folders","by folder","files","ordner","dateien","verzeichnis","musikordner"}

DIDL_NS="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"
for _prefix,_uri in {"dc":"http://purl.org/dc/elements/1.1/","upnp":"urn:schemas-upnp-org:metadata-1-0/upnp/","dlna":"urn:schemas-dlna-org:metadata-1-0/"}.items():
    ET.register_namespace(_prefix,_uri)

def didl_document(node):
    """Wraps a single parsed <item> back into a complete DIDL-Lite
    document, as renderers expect for CurrentURIMetaData. Serialising
    the bare element instead yields no <DIDL-Lite> root and
    ElementTree's generic ns0:/ns2: prefixes, which many renderers
    (Linn/OpenHome among them) don't accept."""
    node=copy.deepcopy(node)
    for el in node.iter():
        if el.tag.startswith("{"+DIDL_NS+"}"): el.tag=local_name(el.tag)
    root=ET.Element("DIDL-Lite",{"xmlns":DIDL_NS}); root.append(node)
    return ET.tostring(root,encoding="unicode")
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
        out.append({"type":typ,"id":n.attrib.get("id",""),"parent_id":n.attrib.get("parentID",""),"title":child_text(n,"title"),"artist":artist,"album_artist":album_artist,"album":child_text(n,"album"),"genre":child_text(n,"genre"),"date":child_text(n,"date"),"track_number":child_text(n,"originalTrackNumber"),"album_art":child_text(n,"albumArtURI"),"class":child_text(n,"class"),"resources":resources,"metadata":didl_document(n)})
    return out

def is_audio(item):
    """Servers like Jellyfin put videos and photos into the same tree; only
    audio belongs in the music library. An item without a class counts as audio."""
    cls=(item.get("class") or "").lower()
    return not (cls.startswith("object.item.videoitem") or cls.startswith("object.item.imageitem"))

def track_key(item):
    """Identity of a track independent of where the server lists it. Servers
    that show the same file under several views (or give each view its own
    object id / stream URL) would otherwise deliver every track many times.
    None when the tags are too thin to tell tracks apart safely."""
    title=(item.get("title") or "").strip().lower()
    album=(item.get("album") or "").strip().lower()
    artist=(item.get("album_artist") or item.get("artist") or "").strip().lower()
    if not title or not (album or artist): return None
    duration=(item["resources"][0].get("duration") or "") if item.get("resources") else ""
    return (title,album,artist,(item.get("track_number") or "").strip(),duration)

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
        # TotalMatches may legitimately be 0 when the server can't compute
        # it -- then keep paging until a page comes back empty.
        if number_returned==0 or (total_matches>0 and start>=total_matches): break
    return items

def pick_scan_root(s, root_object_id):
    """Looks under root_object_id for a plain by-folder view (each file
    only once) -- directly, or one level down (Jellyfin: Music > Folders).
    If found, ONLY that is scanned -- on servers like MinimServer (which
    also organise things in parallel by artist/album/genre/composer) this
    saves most of the network requests and avoids duplicates from the
    start, instead of filtering them out afterwards."""
    try:
        items=browse_all(s, root_object_id)
    except Exception:
        return root_object_id, None
    containers=[i for i in items if i["type"]=="container"]
    for i in containers:
        if i["title"].strip().lower() in CANONICAL_CONTAINER_NAMES:
            return i["id"], i["title"]
    for parent in containers[:10]:
        try:
            children=browse_all(s, parent["id"])
        except Exception:
            continue
        for i in children:
            if i["type"]=="container" and i["title"].strip().lower() in CANONICAL_CONTAINER_NAMES:
                return i["id"], f'{parent["title"]} / {i["title"]}'
    return root_object_id, None
