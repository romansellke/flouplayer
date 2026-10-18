# How it works

## Architecture

- **Backend** (the `app/` package, see [Development](development.md#backend-files)): a FastAPI app served locally by Uvicorn. It
  discovers UPnP devices over SSDP, talks to the media server's
  ContentDirectory service (browsing and scanning) and controls the output
  device (AVTransport, and the OpenHome Volume, Playlist, Time, Product, Pins
  and Info services via `upnpclient`). It also converts tracks the built-in player
  can't decode to FLAC on the fly (PyAV/ffmpeg).
- **Frontend** (`app/static/`): plain HTML, CSS and JavaScript, no build step.
  The script is split into several files by topic (see
  [Development](development.md#frontend-files)).
- **Desktop window** (`desktop.py`): starts the backend and opens the page in
  its own native window with `pywebview` (Qt WebEngine by default), so no
  browser tab is needed. It also enforces a single running instance and
  writes the crash log.
- **Packaging** (`packaging/`): builds the self-contained app and installs
  the menu entry.

## Where things are stored

| What | Where |
| --- | --- |
| Library cache (Cached mode) | `~/.cache/flou_player/library.json` |
| Known media servers and players (for reconnecting at startup) | `~/.cache/flou_player/devices.json` |
| Crash log | `~/.cache/flou_player/crash.log` |
| Installed app | `~/.local/share/flou-player` |
| Window settings (theme, visible columns, cover size, Live/Cached choice, collapsed browser, chosen media server and output device) | the app window's web profile under `~/.local/share/flou-player/webview` |

## Library scan (Cached mode)

The scan prefers a plain by-folder view if the server offers one (each file
only once), instead of walking all the artist/album/genre views, and runs
the network requests across several threads in parallel. Tracks are
deduplicated by their actual playback URL. Albums are grouped by album name
**and** album artist, so same-named albums by different artists stay
separate; this depends on the server's DIDL-Lite metadata.

## Known limitations

- A full library scan makes many network requests and can still take a while
  on very large or deeply nested libraries, even though it is parallelised.
  The app shows the number of tracks found so far during the scan.
- The OpenHome queue (Queue tab), the dB volume readout, and mute, source,
  pins and stream quality are **not verified against real hardware** and may need adjusting. For non-OpenHome UPnP
  renderers, playback uses AVTransport.
- Only one media server is loaded at a time. The *Source* dropdown switches
  the output device's own inputs, not the media server.
- In Live mode, Next/Previous step through the folder that is currently open,
  and the search only filters that folder.
- No code from proprietary apps such as mconnect was used.

## License and dependencies

Flou Player is free software under the GNU General Public License, version 3
or (at your option) any later version. See [LICENSE](../LICENSE). Open-source
dependencies: FastAPI (MIT), Uvicorn (BSD-3-Clause), upnpclient (MIT),
pywebview (BSD-3-Clause), PyAV (BSD-3-Clause, bundles LGPL ffmpeg libraries),
PyQt5/PyQtWebEngine (GPL v3, or commercial from Riverbank Computing) and QtPy
(MIT). They are installed from PyPI on first setup.
