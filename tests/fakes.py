"""Stand-ins for upnpclient devices, so the backend can be tested without a network."""
import base64


class FakeService:
    """A UPnP service whose actions are plain callables: svc.Standby() calls
    actions["Standby"](). Calls are recorded in `calls` as (action, kwargs)."""

    def __init__(self, service_id, service_type, actions=None):
        self.service_id = service_id
        self.service_type = service_type
        self.actions = actions or {}
        self.calls = []

    def __getattr__(self, name):
        if name.startswith("_") or name not in self.actions:
            raise AttributeError(name)

        def call(http_headers=None, **kwargs):   # like upnpclient, every action takes optional headers
            self.calls.append((name, kwargs))
            self.headers = http_headers
            result = self.actions[name]
            return result(**kwargs) if callable(result) else result

        return call


def oh(name, version=1, actions=None):
    """An OpenHome service."""
    return FakeService(f"urn:av-openhome-org:serviceId:{name}", f"urn:av-openhome-org:service:{name}:{version}", actions)


class FakeDevice:
    def __init__(self, udn, location, friendly_name, services, model_name=""):
        self.udn = udn
        self.location = location
        self.friendly_name = friendly_name
        self.manufacturer = "Fake"
        self.model_name = model_name
        self.services = services

    def service(self, name):
        return next(s for s in self.services if s.service_type.split(":")[-2] == name)


def linn_player(host="192.168.1.21", **overrides):
    """A Linn-style player: an OpenHome device plus the sibling 'UPnP AV' renderer on the same IP."""
    state = {"standby": False, "source": 0, "muted": False, "volume": 40, "pin_calls": [], "queue": [5, 6], "repeat": False, "shuffle": False, "seeked": [], "inserted": []}
    state.update(overrides)
    product = oh("Product", 4, {
        "Standby": lambda: {"Value": state["standby"]},
        "SetStandby": lambda Value: state.update(standby=Value in ("1", "true")) or {},
        "SourceIndex": lambda: {"Value": state["source"]},
        "SourceCount": {"Value": 3},
        "Source": lambda Index: [
            {"SystemName": "Playlist", "Type": "Playlist", "Name": "Playlist", "Visible": True},
            {"SystemName": "Radio", "Type": "Radio", "Name": "Radio", "Visible": True},
            {"SystemName": "Hidden", "Type": "Analog", "Name": "Hidden", "Visible": False},
        ][Index],
        "SetSourceIndex": lambda Value: state.update(source=Value) or {},
    })
    volume = oh("Volume", 4, {
        "Characteristics": {"VolumeMax": 100, "VolumeUnity": 80, "VolumeMilliDbPerStep": 500},
        "Volume": lambda: {"Value": state["volume"]},
        "Mute": lambda: {"Value": state["muted"]},
        "SetMute": lambda Value: state.update(muted=Value in ("1", "true")) or {},
        "SetVolume": lambda Value: state.update(volume=Value) or {},
    })
    transport = oh("Transport", 1, {
        "Play": {}, "Pause": {}, "Stop": {}, "SkipNext": {}, "SkipPrevious": {},
        "StreamInfo": {"CanPause": False},
        "ModeInfo": {"CanSkipNext": False, "CanSkipPrevious": True},
    })
    info = oh("Info", 1, {"Details": {"Duration": 0, "BitRate": 1011000, "BitDepth": 16, "SampleRate": 44100, "Lossless": True, "CodecName": "FLAC"}})
    pins = oh("Pins", 1, {
        "GetDeviceMax": {"DeviceMax": 4},
        "GetIdArray": {"Token": 1, "IdArray": "[5, 0, 7, 0]"},
        "ReadList": {"List": '[{"id": 5, "title": "Classic FM", "artworkUri": "http://x/a.png"}, {"id": 0}, {"id": 7, "title": "Playlist 1", "artworkUri": ""}, {"id": 0}]'},
        "InvokeIndex": lambda Index: state["pin_calls"].append(Index) or {},
    })
    update = FakeService("urn:linn-co-uk:serviceId:Update", "urn:linn-co-uk:service:Update:4", {
        "GetSoftwareStatus": {"SoftwareStatus": '{"status": "update_available", "current_software": {"version": "4.99.491", "channel": "release"},'
                                                '"update_info": {"updates": [{"version": "4.100.502", "date": "07 Jun 2023", "description": "x"}]}}'},
    })
    def entry(i):
        return f"<Entry><Id>{i}</Id><Uri>http://x/{i}.flac</Uri><Metadata></Metadata></Entry>"

    def insert(AfterId, Uri, Metadata):
        new = max(state["queue"] + [0]) + 1
        state["queue"].insert(state["queue"].index(AfterId) + 1 if AfterId in state["queue"] else 0, new)
        state["inserted"].append((AfterId, Uri))
        return {"NewId": new}

    playlist = oh("Playlist", 1, {
        "IdArray": lambda: {"Token": len(state["queue"]), "Array": base64.b64encode(b"".join(i.to_bytes(4, "big") for i in state["queue"])).decode()},
        "ReadList": lambda IdList: {"TrackList": "<TrackList>" + "".join(entry(int(i)) for i in IdList.split()) + "</TrackList>"},
        "TransportState": {"Value": "Playing"}, "Id": {"Value": 5},
        "Repeat": lambda: {"Value": state["repeat"]}, "Shuffle": lambda: {"Value": state["shuffle"]},
        "SetRepeat": lambda Value: state.update(repeat=Value in ("1", "true")) or {},
        "SetShuffle": lambda Value: state.update(shuffle=Value in ("1", "true")) or {},
        "Insert": insert,
        "DeleteAll": lambda: state["queue"].clear() or {},
        "SeekId": lambda Value: state["seeked"].append(Value) or {},
        "DeleteId": lambda Value: state["queue"].remove(Value) or {},
        "Play": {}, "Pause": {}, "Stop": {}, "Next": {}, "Previous": {}, "SeekSecondAbsolute": {},
    })
    time = oh("Time", 1, {"Time": {"TrackCount": 1, "Duration": 180, "Seconds": 42}})
    openhome = FakeDevice(f"uuid:{host}-oh", f"http://{host}:55178/oh/device.xml", "Linn Majik DSM", [product, volume, transport, info, pins, update, playlist, time])
    avt = FakeService("urn:upnp-org:serviceId:AVTransport", "urn:schemas-upnp-org:service:AVTransport:1", {
        "Play": {}, "Pause": {}, "Stop": {}, "Next": {}, "Previous": {},
        "GetPositionInfo": {"RelTime": "0:00:10", "TrackDuration": "0:03:00"},
        "GetTransportInfo": {"CurrentTransportState": "PLAYING"},
    })
    av = FakeDevice(f"uuid:{host}-av", f"http://{host}:55178/av/device.xml", "Linn Majik DSM :UPnP AV", [avt])
    return openhome, av, state


def media_server(host="192.168.1.50", tree=None):
    """A ContentDirectory server whose tree is {object_id: [DIDL-Lite <item>/<container> xml fragments]}."""
    tree = tree or {}

    def browse(ObjectID, BrowseFlag="BrowseDirectChildren", Filter="*", StartingIndex=0, RequestedCount=500, SortCriteria=""):
        items = tree.get(ObjectID, [])
        page = items[StartingIndex:StartingIndex + RequestedCount]
        xml = ('<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" '
               'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">' + "".join(page) + "</DIDL-Lite>")
        return {"Result": xml, "NumberReturned": len(page), "TotalMatches": len(items), "UpdateID": 1}

    cd = FakeService("urn:upnp-org:serviceId:ContentDirectory", "urn:schemas-upnp-org:service:ContentDirectory:1", {"Browse": browse})
    return FakeDevice(f"uuid:{host}-ms", f"http://{host}:9790/ms/device.xml", "Music Server", [cd], model_name="MinimServer")
