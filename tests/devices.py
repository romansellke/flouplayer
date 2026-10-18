"""Device JSON as the API returns it, for the mocked UI tests."""


def device(id, name, model="", server=False, renderer=False):
    return {"id": id, "name": name, "model": model, "manufacturer": "Fake", "server": server, "renderer": renderer, "icon": "", "services": []}


SERVER = device("srv1", "Music Server", "MinimServer", server=True)
SERVER2 = device("srv2", "Other Server", "X", server=True)
PLAYER = device("ren1", "Linn", "Majik", renderer=True)
