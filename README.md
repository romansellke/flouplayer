# Flou Player

A local, standalone, iTunes-style desktop app for browsing and playing music
from MinimServer through a Linn/OpenHome output device (e.g. a Majik DSM4).
Runs as its own application window -- no browser tab needed.

Flou Player runs on Linux (tested target: Linux Mint).

## Install as an app (recommended)

1. Open a terminal in the project folder.
2. `./packaging/install.sh`

This builds Flou Player once into a self-contained app (Python, Qt and all
dependencies bundled -- needs internet access for the build, takes a few
minutes and about 500 MB of disk space) and adds **Flou Player** to your
application menu with its icon. From then on, start it from the menu like
any other app: no terminal, no Python setup.

- **After updating the code** (e.g. `git pull`): `./packaging/install.sh --rebuild`
- **Remove it again:** `./packaging/install.sh --uninstall`
  (keeps your library cache and settings)
- Build only, without installing: `./packaging/build.sh`
  (result in `build/dist/flou-player/`)

Only one Flou Player runs at a time: starting it again (from the menu,
`flou-player` or `./run.command`) just brings the open window to the front.

The app is installed for your user only, under `~/.local/share/flou-player`;
no `sudo` needed. Build it on the machine you run it on.

## Run from source (for development)

1. Open a terminal in the project folder.
2. One-time only: `chmod +x run.command`
3. `./run.command`

The first run creates a virtual environment and installs dependencies (needs
internet access briefly), then opens the app in its own window. Later runs
skip the install step and start straight away (it only runs again when
`requirements.txt` changes).

## Network

Your computer and the MinimServer/Linn device must be on the same local
network (SSDP/UPnP discovery does not cross subnets/VLANs). It doesn't
matter whether MinimServer, the output device and Flou Player are three
separate machines -- everything is found and controlled purely over the
network.

## Troubleshooting

### If `run.command` or the build fails on `venv`

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
remove the PyQt5/PyQtWebEngine lines from `requirements.txt` and start
it with `PYWEBVIEW_GUI=gtk ./run.command`.

If the window opens but stays blank or renders oddly, you can try the
other backend the same way: `PYWEBVIEW_GUI=gtk ./run.command` (default: `qt`).

### If the app crashes ("Segmentation fault")

Closing the window used to be able to crash the app on exit (a Qt
WebEngine teardown-order problem); Flou Player now shuts the web engine
down in the right order itself, so this should no longer happen.

On Linux the window's web engine (Qt WebEngine) runs its GPU code inside
the app process, so a graphics driver problem can take the whole app down.
Flou Player therefore renders in software by default; if you want GPU
acceleration back, start it with `FLOU_GPU=1 ./run.command` (or
`FLOU_GPU=1 flou-player` for the installed app).

If it still crashes, the details (which part of the app was running at
that moment) are written to `~/.cache/flou_player/crash.log` -- please
include that file when reporting the problem.

## Features

- SSDP discovery of UPnP devices
- Standalone desktop window (via `pywebview`) instead of a browser tab
- Selection of media server and output device, in a toolbar below the main header
- **Device icons**: the media server and output device dropdowns show each device's own icon, taken from its UPnP device description (as the Linn app does); devices without one get a generic symbol
- **Fast, parallel library scan**: prefers a plain by-folder view (if the server offers one) instead of all the artist/album/genre views at once, and runs the network requests across several threads in parallel instead of one after another
- **Album Artist → Artist → Album → Year** columns with a correct match count (album count for Album Artist/Artist/Year, track count for Album). Album Artist shows the tag exactly as delivered by the server -- tracks without an album-artist tag don't appear under any Album Artist entry.
- **Deduplication** by the actual playback URL (in case server-side duplicates remain despite the by-folder view)
- **All albums at a glance**: with nothing selected in the column browser, the whole library is listed; the album list is built in chunks as you scroll, so even very large libraries stay responsive
- **Now-playing indicator**: the currently playing track shows a ▶ icon instead of its track number and is highlighted
- **Jump to now playing**: the "▶ Now Playing" button above the album list (or Ctrl/⌘+L) scrolls to the current track and highlights it; if it's hidden by the current filters or search, the view switches to its album first
- **Auto-advance**: once a track finishes, the next one from the currently displayed track list starts automatically (detected via position polling; manually stopping playback does not trigger this)
- **Elapsed-time display** in the LCD-style readout (elapsed/total), updated via polling
- **Sample rate/bitrate** per track in the track list (where supplied by the server as a `res` attribute)
- **Finer volume control**: prefers the OpenHome Volume service (typical for Linn devices) with a real dB readout; falls back to the standard UPnP 0-100% range if unavailable. **Not verified against real hardware -- the dB scaling may need adjusting.**
- **Persistent library cache**: the scanned library is saved to disk (`~/.cache/flou_player/library.json`) and reloaded automatically on startup -- no need to rescan every time you open the app. Click "Load library" whenever you want to refresh it (e.g. after adding new music).
- Clearly distinguishable controls: filled blue buttons, white dropdowns with an arrow, text fields with a search icon
- **Local playback**: the output device dropdown always includes "This computer (local speakers)" -- picking it plays audio directly through the laptop's own sound output (via the app window's built-in HTML5 audio, no UPnP renderer needed). Useful for testing or listening without the Majik DSM4. FLAC (incl. hi-res), WAV, MP3 and Ogg play directly. Formats the built-in web engine (Qt WebEngine) can't decode itself -- AAC/ALAC (`.m4a`), and others ffmpeg can read -- are converted to FLAC on the fly by the app (via PyAV/ffmpeg; lossless for ALAC, hi-res stays hi-res). Seeking isn't possible within such converted tracks. Raw PCM streams (`audio/L16`) can't be played locally. If the server offers several variants of a track, the app picks one it can play directly; auto-advance skips tracks it can't play at all.
- **Selectable track-list columns**: a "Columns" button above the track list lets you toggle Quality/Time/Artist/Album Artist/Genre/Year on or off; the choice is remembered between launches (stored in the app window's web profile under `~/.local/share/flou-player/webview`).
- **Scrollable track list**: the header, toolbar, column browser and sidebars stay fixed, only the album/track list scrolls (like the iTunes original)
- Responsive layout: sidebars hide on narrow windows, columns stack on very narrow windows
- iTunes-style album-centric view with cover art and a track table
- Search within the loaded library
- Play, pause, stop, next, previous and volume via standard UPnP services
- Albums are grouped by album name **and** album artist, so same-named albums by different artists stay separate
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
