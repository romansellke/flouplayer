# Flou Player

A local, standalone, iTunes-style desktop app for browsing and playing music
from MinimServer through a Linn/OpenHome output device (e.g. a Majik DSM4).
Runs as its own application window -- no browser tab needed.

![Flou Player screenshot](docs/screenshot.png)

Flou Player runs on Linux (tested target: Linux Mint; also works on Arch
Linux).

## Highlights

- **Live browsing** of the media server folder by folder, like the Linn app --
  or a **cached** full-library scan with an iTunes-style column browser
  (Album Artist / Artist / Album / Year) and instant search
- Playback on **Linn/OpenHome** devices (and other UPnP renderers) with a
  position bar, dB volume readout and the device's own queue, or on the
  **local speakers** (AAC/ALAC are converted to FLAC on the fly)
- Album covers, selectable track columns, 17 colour themes, Diagnostics and
  About dialogs

## Quick start

```
./packaging/install.sh     # builds and adds "Flou Player" to the application menu
```

or, from source: `./run.command`. Computer, media server and output device
must be on the same local network. Then click **Search devices**, pick a
media server and an output device, and double-click a track.

## Documentation

- [Getting started](docs/getting-started.md) -- requirements, installing,
  running from source, Arch Linux, first start
- [User guide](docs/user-guide.md) -- live and cached library, playback, the
  queue, local playback, themes, keyboard shortcuts
- [Troubleshooting](docs/troubleshooting.md)
- [How it works](docs/how-it-works.md) -- architecture, stored files, known
  limitations

## License

Flou Player is free software, licensed under the GNU General Public License,
version 3 or (at your option) any later version (GPL-3.0-or-later). See
[LICENSE](LICENSE). This matches the GPL v3 licensing of PyQt5, which the
desktop window uses.

## Open-source dependencies

- FastAPI, MIT
- Uvicorn, BSD-3-Clause
- upnpclient, MIT
- pywebview, BSD-3-Clause
- PyAV (`av`), BSD-3-Clause -- bundles ffmpeg libraries (LGPL)
- PyQt5 / PyQtWebEngine, GPL v3 (or commercial license from Riverbank Computing)
- QtPy, MIT

Dependencies are installed from PyPI on first local setup.
