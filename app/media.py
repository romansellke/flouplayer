"""Media keys and the desktop's player controls (MPRIS on Linux).

The page knows what is playing and how to control it (local speakers, a UPnP
renderer or the device queue), so it stays in charge: it reports the current
track to /api/media/state, and picks up commands (play/pause, next, ...) from
/api/media/command. On Linux the backend publishes that as an MPRIS player on
the session D-Bus, which is what the media keys, the panel's sound menu and
GNOME/Cinnamon/KDE player widgets talk to. Without D-Bus (or dbus-fast) the
endpoints still work, there is just nobody to send commands.
"""
from __future__ import annotations
import asyncio
import collections
import logging
import sys
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

router=APIRouter()
log=logging.getLogger("flou.media")

COMMANDS={"play","pause","play_pause","stop","next","previous"}

class MediaState(BaseModel):
    status:str="Stopped"            # Playing / Paused / Stopped (MPRIS PlaybackStatus)
    title:str=""; artist:str=""; album:str=""; art_url:str=""
    length:float=0                  # seconds, 0 = unknown
    position:float=0
    track_id:str=""
    can_next:bool=True; can_previous:bool=True; can_pause:bool=True

class Bridge:
    """Current state + pending commands, shared by the page and the MPRIS service (one asyncio loop)."""
    def __init__(self):
        self.state=MediaState()
        self.commands=collections.deque(maxlen=20)
        self.waiters:list[asyncio.Future]=[]
        self.listeners=[]           # called with the changed property names after a state update

    def send(self,cmd:str):
        if cmd not in COMMANDS: return
        while self.waiters:         # hand it straight to a page that is waiting ...
            w=self.waiters.pop(0)
            if not w.done(): w.set_result(cmd); return
        self.commands.append(cmd)   # ... or keep it for the next poll

    async def next_command(self,timeout:float)->Optional[str]:
        if self.commands: return self.commands.popleft()
        fut=asyncio.get_running_loop().create_future()
        self.waiters.append(fut)
        try: return await asyncio.wait_for(fut,timeout)
        except asyncio.TimeoutError: return None
        finally:
            if fut in self.waiters: self.waiters.remove(fut)

    def update(self,new:MediaState):
        old=self.state; self.state=new
        changed=[k for k in MediaState.model_fields if getattr(old,k)!=getattr(new,k)]
        for fn in self.listeners:
            try: fn(changed)
            except Exception as e: log.debug("media listener failed: %s",e)

bridge=Bridge()

@router.post("/api/media/state")
async def set_state(s:MediaState):   # async: runs on the loop the D-Bus connection lives on
    bridge.update(s)
    return {"ok":True}

@router.get("/api/media/command")
async def get_command(wait:float=25):
    """Long poll: returns the next command as soon as there is one, or null after `wait` seconds."""
    return {"command":await bridge.next_command(max(0.0,min(wait,30.0)))}

@router.post("/api/media/command/{cmd}")
async def post_command(cmd:str):
    """For testing and scripts: the same as pressing a media key."""
    bridge.send(cmd)
    return {"ok":cmd in COMMANDS}

# ---------- MPRIS (Linux, session D-Bus) ----------
BUS_NAME="org.mpris.MediaPlayer2.flouplayer"
OBJ_PATH="/org/mpris/MediaPlayer2"
_bus=None

def build_interfaces(b:Bridge):
    """The two MPRIS interfaces, bound to the bridge. Separate from the bus so tests can call them directly."""
    from dbus_fast.service import ServiceInterface, method, dbus_property, PropertyAccess
    from dbus_fast import Variant

    class Root(ServiceInterface):
        def __init__(self): super().__init__("org.mpris.MediaPlayer2")
        @method()
        def Raise(self): pass
        @method()
        def Quit(self): pass
        @dbus_property(access=PropertyAccess.READ)
        def CanQuit(self)->"b": return False
        @dbus_property(access=PropertyAccess.READ)
        def CanRaise(self)->"b": return False
        @dbus_property(access=PropertyAccess.READ)
        def HasTrackList(self)->"b": return False
        @dbus_property(access=PropertyAccess.READ)
        def Identity(self)->"s": return "Flou Player"
        @dbus_property(access=PropertyAccess.READ)
        def DesktopEntry(self)->"s": return "flou-player"
        @dbus_property(access=PropertyAccess.READ)
        def SupportedUriSchemes(self)->"as": return []
        @dbus_property(access=PropertyAccess.READ)
        def SupportedMimeTypes(self)->"as": return []

    def metadata(s:MediaState):
        tid="/org/flouplayer/track/"+("".join(c if c.isalnum() else "_" for c in s.track_id) or "none")
        m={"mpris:trackid":Variant("o",tid)}
        if s.title: m["xesam:title"]=Variant("s",s.title)
        if s.artist: m["xesam:artist"]=Variant("as",[s.artist])
        if s.album: m["xesam:album"]=Variant("s",s.album)
        if s.art_url: m["mpris:artUrl"]=Variant("s",s.art_url)
        if s.length: m["mpris:length"]=Variant("x",int(s.length*1_000_000))
        return m

    class Player(ServiceInterface):
        def __init__(self): super().__init__("org.mpris.MediaPlayer2.Player")
        @method()
        def Next(self): b.send("next")
        @method()
        def Previous(self): b.send("previous")
        @method()
        def Pause(self): b.send("pause")
        @method()
        def PlayPause(self): b.send("play_pause")
        @method()
        def Stop(self): b.send("stop")
        @method()
        def Play(self): b.send("play")
        @method()
        def Seek(self,offset:"x"): pass
        @method()
        def SetPosition(self,track_id:"o",position:"x"): pass
        @method()
        def OpenUri(self,uri:"s"): pass
        @dbus_property(access=PropertyAccess.READ)
        def PlaybackStatus(self)->"s": return b.state.status
        @dbus_property(access=PropertyAccess.READ)
        def Rate(self)->"d": return 1.0
        @dbus_property(access=PropertyAccess.READ)
        def MinimumRate(self)->"d": return 1.0
        @dbus_property(access=PropertyAccess.READ)
        def MaximumRate(self)->"d": return 1.0
        @dbus_property(access=PropertyAccess.READ)
        def Metadata(self)->"a{sv}": return metadata(b.state)
        @dbus_property(access=PropertyAccess.READ)
        def Volume(self)->"d": return 1.0
        @dbus_property(access=PropertyAccess.READ)
        def Position(self)->"x": return int(b.state.position*1_000_000)
        @dbus_property(access=PropertyAccess.READ)
        def CanGoNext(self)->"b": return b.state.can_next
        @dbus_property(access=PropertyAccess.READ)
        def CanGoPrevious(self)->"b": return b.state.can_previous
        @dbus_property(access=PropertyAccess.READ)
        def CanPlay(self)->"b": return True
        @dbus_property(access=PropertyAccess.READ)
        def CanPause(self)->"b": return b.state.can_pause
        @dbus_property(access=PropertyAccess.READ)
        def CanSeek(self)->"b": return False
        @dbus_property(access=PropertyAccess.READ)
        def CanControl(self)->"b": return True

    root,player=Root(),Player()
    # Which MPRIS properties follow from which state fields (Position is polled by clients, not signalled).
    deps={"PlaybackStatus":{"status"},"Metadata":{"title","artist","album","art_url","length","track_id"},
          "CanGoNext":{"can_next"},"CanGoPrevious":{"can_previous"},"CanPause":{"can_pause"}}
    def on_change(changed):
        props={p:getattr(player,p) for p,f in deps.items() if f & set(changed)}
        if props: player.emit_properties_changed(props)
    b.listeners.append(on_change)
    return root,player

async def start_mpris():
    """Publish the MPRIS player; quietly does nothing where that isn't possible."""
    global _bus
    if not sys.platform.startswith("linux") or _bus is not None: return
    try:
        from dbus_fast.aio import MessageBus
        from dbus_fast import BusType
        bus=await MessageBus(bus_type=BusType.SESSION).connect()
        root,player=build_interfaces(bridge)
        bus.export(OBJ_PATH,root); bus.export(OBJ_PATH,player)
        await bus.request_name(BUS_NAME)
        _bus=bus
        log.info("MPRIS player published as %s",BUS_NAME)
    except Exception as e:      # no dbus-fast, no session bus (e.g. over SSH), ...
        log.info("MPRIS not available: %s",e)

async def stop_mpris():
    global _bus
    if _bus is not None:
        try: _bus.disconnect()
        except Exception: pass
        _bus=None
