# Development and tests

## Running from source

See [Getting started](getting-started.md#run-from-source-for-development):
`./run.command` creates a virtual environment and starts the app.

## Frontend files

The page has no build step: `index.html` loads these scripts one after the
other (in this order) as plain scripts that share one global scope, so a
function or `const` declared in an earlier file can be used by later ones --
and by code that runs at load time only if it is declared in an *earlier*
file. Keep that order in mind when you move code between files.

| File | Contents |
| --- | --- |
| `core.js` | State, the diagnostics log, the API helper, small helpers (toast, busy button, escaping, ...) |
| `devices.js` | Device search and the media server / output device dropdowns |
| `dialogs.js` | Metadata inspector, About, cover size and the full-size cover |
| `library.js` | The cached library: scan, columns, column browser, type-ahead, album list, search |
| `playback.js` | Local audio, playing a track, jump to the playing track, transport buttons, volume, position bar, position polling |
| `queue.js` | The device queue (OpenHome Playlist) |
| `health.js` | Library health: the checks (`analyzeLibrary`, a pure function) and the Health view |
| `live.js` | Live browsing and the Live and Library tabs |
| `openhome.js` | OpenHome device controls: mute, standby, source, pins, stream quality, capabilities, firmware |
| `remember.js` | Remembering the chosen devices and reconnecting at startup |
| `keyboard.js` | Keyboard shortcuts |

## Backend files

The backend is the Python package `app/`. `main.py` only creates the FastAPI
app and includes one router per topic; the rest is split like this:

| File | Contents |
| --- | --- |
| `main.py` | The app, static files, `/` and the About/ping endpoints, build ID and source info |
| `state.py` | Shared state: the discovered devices (one dict, updated in place), locks, and where the app keeps its files |
| `upnp.py` | Helpers for UPnP devices: finding services (also on a player's sibling devices), icons, device JSON |
| `didl.py` | DIDL-Lite parsing and walking a ContentDirectory |
| `devices.py` | Device search, reconnecting to known devices, services/volume/position readings |
| `openhome.py` | OpenHome features: sources, pins, stream details, capabilities, standby, firmware |
| `control.py` | `POST /api/control`: transport, volume, mute, standby, source, pin |
| `library.py` | Browsing a folder, scanning the whole library, the on-disk cache |
| `transcode.py` | Converting formats the built-in player can't decode, for local playback |
| `playlist.py` | The device queue (OpenHome Playlist) |

Modules share the device list through `app.state.devices`; change it in place
(never rebind it), because other modules hold a reference to the same dict.

## Tests

The tests live in `tests/` and use [pytest](https://pytest.org). Install the
test dependencies once, next to the app's own:

```
pip install -r requirements.txt -r requirements-dev.txt
playwright install chromium      # only needed for the browser tests
```

Run everything with `pytest`, or a part of it:

```
pytest tests/test_backend.py     # fast, no browser
pytest -m ui                     # only the browser tests
pytest -k keyboard               # by name
```

### What is tested

- **Backend** (`tests/test_backend.py`): the FastAPI endpoints against fake
  UPnP devices (`tests/fakes.py`) -- a media server with a folder tree, and a
  Linn-style player with its OpenHome services (Product, Volume, Transport,
  Info, Pins, Update) plus the sibling "UPnP AV" device. Covers device search
  and reconnecting, browsing and scanning, sources, pins, stream details,
  capabilities, standby, mute, firmware and the transport fallback. No network
  and no hardware are involved, and `HOME` is redirected to a temporary
  directory so your real library cache and known devices are never touched.
- **Browser** (`tests/test_ui.py`): the real page and script in headless
  Chromium with the API mocked (`MockApi` in `tests/conftest.py`). Covers the
  device dropdowns and remembering them, live browsing, Now Playing, the
  cover/Artist column layout, keyboard control, the OpenHome device controls,
  the layout and the About dialog. The tests also fail on any JavaScript
  error in the page.

These tests check that the app does what it is meant to against *fakes*; they
cannot replace trying it on a real Linn device. The fakes follow the OpenHome
service definitions, as the features themselves do.

### Writing a browser test

```python
def test_something(page, api):
    api.routes["/standby"] = {"supported": True, "standby": False}   # URL substring -> JSON
    open_app(page)
    page.click("#powerBtn")
    assert api.actions() == ["standby:1"]     # control requests the page sent
```

Route keys are substrings of the request path after `/api/` (for example
`browse`, `/volume`, `devices/restore`); the first match wins and everything
else answers 404. If Chromium is installed elsewhere, point
`FLOU_TEST_CHROMIUM` at the executable.

### Continuous integration

`.github/workflows/tests.yml` runs the whole suite on every pull request and
on pushes to `main`.
