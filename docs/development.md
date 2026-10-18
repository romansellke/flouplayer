# Development and tests

## Running from source

See [Getting started](getting-started.md#run-from-source-for-development):
`./run.command` creates a virtual environment and starts the app.

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
