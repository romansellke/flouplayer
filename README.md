# Flou Player

A local, standalone, iTunes-style desktop app for browsing and playing music
from MinimServer through a Linn/OpenHome output device (e.g. a Majik DSM4).
Runs as its own application window -- no browser tab needed.

## Setup (macOS and Linux, incl. Linux Mint)

1. Unzip the archive.
2. Open a terminal in the folder.
3. One-time only: `chmod +x run.command`
4. `./run.command`

The first run creates a virtual environment and installs dependencies (needs
internet access briefly), then opens the app in its own window. Later runs
skip the install step and start straight away.

Your computer and the MinimServer/Linn device must be on the same local
network (SSDP/UPnP discovery does not cross subnets/VLANs). It doesn't
matter whether MinimServer, the output device and Flou Player are three
separate machines -- everything is found and controlled purely over the
network.

### If `run.command` fails on `venv`

On Ubuntu/Linux Mint this usually means the `python3-venv` package isn't
installed. Check your Python version with `python3 --version`, then run
`sudo apt install python3-venv` (or a version-specific package such as
`python3.12-venv`, matching the version shown), and run `./run.command`
again.

### If PyQt5 fails to install (desktop window)

Flou Player opens its window using `pywebview`, which needs a Qt or GTK
backend to render the page. `requirements.txt` pulls in PyQt5 +
PyQtWebEngine for this, which normally installs via pip alone. If that
fails on your system, the alternative is the GTK backend:

```
sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
```

(package name may be `gir1.2-webkit2-4.0` on older distributions), then
remove the PyQt5/PyQtWebEngine lines from `requirements.txt` and run
`./run.command` again -- pywebview will fall back to GTK automatically.

If the window opens but stays blank or renders oddly, you can force a
specific backend: `PYWEBVIEW_GUI=qt ./run.command` (or `gtk`).

## Features

- SSDP discovery of UPnP devices
- Standalone desktop window (via `pywebview`) instead of a browser tab
- Selection of media server and output device, in a toolbar below the main header
- **Fast, parallel library scan**: prefers a plain by-folder view (if the server offers one) instead of all the artist/album/genre views at once, and runs the network requests across several threads in parallel instead of one after another
- **Album Artist → Artist → Album → Year** columns with a correct match count (album count for Album Artist/Artist/Year, track count for Album). Album Artist falls back to the track artist when the server didn't tag a separate album artist, so every album is browsable there, not just tagged compilations.
- **Deduplication** by the actual playback URL (in case server-side duplicates remain despite the by-folder view)
- Built-in brake: on very large, unfiltered result sets, the app asks you to narrow things down instead of rendering the entire library at once
- **Now-playing indicator**: the currently playing track shows a ▶ icon instead of its track number and is highlighted
- **Auto-advance**: once a track finishes, the next one from the currently displayed track list starts automatically (detected via position polling; manually stopping playback does not trigger this)
- **Elapsed-time display** in the LCD-style readout (elapsed/total), updated via polling
- **Sample rate/bitrate** per track in the track list (where supplied by the server as a `res` attribute)
- **Finer volume control**: prefers the OpenHome Volume service (typical for Linn devices) with a real dB readout; falls back to the standard UPnP 0-100% range if unavailable. **Not verified against real hardware -- the dB scaling may need adjusting.**
- **Persistent library cache**: the scanned library is saved to disk (`~/.cache/flou_player/library.json`) and reloaded automatically on startup -- no need to rescan every time you open the app. Click "Load library" whenever you want to refresh it (e.g. after adding new music).
- Clearly distinguishable controls: filled blue buttons, white dropdowns with an arrow, text fields with a search icon
- **Local playback**: the output device dropdown always includes "This computer (local speakers)" -- picking it plays audio directly through the laptop's own sound output (via the app window's built-in HTML5 audio, no UPnP renderer needed). Useful for testing or listening without the Majik DSM4. Note: codec support depends on the underlying web engine (Qt WebEngine on Linux) -- common formats (MP3/AAC/WAV) work reliably; FLAC support can vary by system.
- **Selectable track-list columns**: a "Columns" button above the track list lets you toggle Quality/Time/Artist/Album Artist/Genre/Year on or off; the choice is remembered between launches (stored in the app's local browser storage).
- **Scrollable track list**: the header, toolbar, column browser and sidebars stay fixed, only the album/track list scrolls (like the iTunes original)
- Responsive layout: sidebars hide on narrow windows, columns stack on very narrow windows
- iTunes-style album-centric view with cover art and a track table
- Search within the loaded library
- Play, pause, stop, next, previous and volume via standard UPnP services
- Hand a track to the output device and play it
- Diagnostics view of the services found on each device

## How to use it

1. Start the app (`./run.command`) -- it opens in its own window.
2. Click **"Search devices"**, then pick your media server and output device from the two dropdowns.
3. Click **"Load library"** -- this recursively scans the whole media server library (can take a moment for very large collections).
4. Narrow down by Album Artist/Artist/Album/Year at the top left -- each column only shows the values that still match, and clicking "All ..." resets that column.
5. Matching albums appear below with cover art; double-click a track to play it on the selected output device.

## Known limitations

- A full library scan makes many network requests and can still take a while on very large/deeply nested libraries, even though it's now parallelised. The app keeps showing the number of tracks found so far during the scan.
- OpenHome playlist/queue isn't fully implemented yet; playback uses AVTransport.
- There is no source switcher (MinimServer/TIDAL) anymore -- only one media server is loaded at a time via "Load library".
- Album grouping depends on the server's DIDL-Lite metadata.
- No code from proprietary apps such as mconnect was used.

## Open-source dependencies

- FastAPI, MIT
- Uvicorn, BSD-3-Clause
- upnpclient, MIT
- pywebview, BSD-3-Clause
- PyQt5 / PyQtWebEngine, GPL v3 (or commercial license from Riverbank Computing)

Dependencies are installed from PyPI on first local setup.
