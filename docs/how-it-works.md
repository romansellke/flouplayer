# How it works

## How this was built

Flou Player was developed with AI assistance: almost all code was written by
Claude Code (Anthropic) under the direction of the author, who tests it on a
Linn Majik DSM with MinimServer. The automated tests
([Development](development.md#tests)) run against simulated devices; many
device features follow the OpenHome specifications and have not been verified
on other hardware.

## Architecture

- **Backend** (the `app/` package, see [Development](development.md#backend-files)): a FastAPI app served locally by Uvicorn. It
  discovers UPnP devices over SSDP, talks to the media server's
  ContentDirectory service (browsing and scanning) and controls the output
  device (AVTransport, and the OpenHome Volume, Playlist, Time, Product, Pins
  and Info services via `upnpclient`). It follows the output device through its
  events (see [Device events](#device-events)). It also converts tracks the built-in player
  can't decode to FLAC on the fly (PyAV/ffmpeg).
- **TIDAL** (`app/tidal.py`): logs in to TIDAL and searches it with
  `tidalapi`. Nothing is streamed through Flou Player: see
  [TIDAL](#tidal) below.
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
| Library cache (Library mode) | `~/.cache/flou_player/library.json` |
| Known media servers and players (for reconnecting at startup) | `~/.cache/flou_player/devices.json` |
| TIDAL login (access and refresh token, readable by your user only) | `~/.cache/flou_player/tidal.json` |
| Media keys / panel player controls (MPRIS) on or off | `~/.cache/flou_player/media.json` |
| Crash log | `~/.cache/flou_player/crash.log` |
| Installed app | `~/.local/share/flou-player` |
| Window settings (theme, visible columns, cover size, Live/Library choice, collapsed browser, folded Radio search bar, chosen media server and output device) | the app window's web profile under `~/.local/share/flou-player/webview` |

## Device events

Flou Player learns what the output device does the way the Linn app does: the
device tells it. When the window shows a Linn/OpenHome output device, the
backend (`app/events.py`) subscribes to the device's Playlist, Time, Info,
Product and Volume services (UPnP eventing, "GENA"):

1. The subscription gives the device a callback address on this computer:
   a small HTTP server on **TCP port 8766** (another free port if 8766 is
   taken; `FLOU_EVENT_PORT` sets it). The app's own server only listens on
   127.0.0.1, which the device can't reach.
2. The device sends all its values right away, and then every change the
   moment it happens (`NOTIFY`). Only requests from the device's own address,
   to the secret path and with the SID of a current subscription, are taken.
3. While a service's events arrive, the readings the window makes (queue,
   current track, position, volume, mute, standby, source, stream details)
   are answered from them without asking the device. The window is told at
   once which service changed (Server-Sent Events,
   `/api/devices/{id}/events`) and reads it again right away, instead of at
   its next poll. Position events (every second while playing) are only
   passed on for a new track or a seek; the clock runs on by itself.
4. The subscriptions are renewed every minute and cancelled half a minute
   after the window stopped showing the device, and when the app quits.

If the device's first event doesn't arrive within a few seconds (a firewall
on this computer blocks incoming connections, see
[Troubleshooting](troubleshooting.md#the-display-follows-the-device-only-every-few-seconds)),
or the device refuses the subscription, nothing changes from before: the
window asks the device every few seconds. Diagnostics shows which way it
works ("Device events: on" or "not available"). Subscribing is tried again
later.

## Library scan (Library mode)

The scan prefers a plain by-folder view if the server offers one (each file
only once), instead of walking all the artist/album/genre views, and runs
the network requests across several threads in parallel. Tracks are
deduplicated by their actual playback URL, and -- for servers that list a
file again in other views under another URL -- by title, album and length.
Without a length from the server nothing is merged by tags: title and album
alone would take different tracks for the same one. Albums are grouped by album name
**and** album artist, so same-named albums by different artists stay
separate; this depends on the server's DIDL-Lite metadata.

## TIDAL

Flou Player uses TIDAL only to *find* music; the Linn/OpenHome device plays
it, the same way the Linn app does it:

1. **Login.** TIDAL's device login (the one TVs use): Flou Player asks TIDAL
   for a link and a code, you confirm them in a browser, and Flou Player
   keeps the tokens in `~/.cache/flou_player/tidal.json`. An expired access
   token is renewed with the refresh token and saved again. **Log out**
   deletes the file.
2. **Search and browse** go to TIDAL's API (artists, albums, tracks, an
   album's tracks, an artist's albums and EPs/singles).
3. **Playing** puts each track into the device's own playlist (OpenHome
   Playlist, like the library's queue) as the URI
   `tidal://track?version=1&trackId=<id>`, with DIDL-Lite metadata (title,
   artist, album, cover, length) so the device and other control apps show
   the track properly.
4. **The device resolves the URI itself** with the TIDAL account stored on
   it (added in the Linn app / Linn Account) and streams from TIDAL. So the
   quality is whatever the device's own account allows, playback continues
   with Flou Player closed, and there are no stream URLs that expire.

Flou Player's TIDAL login and the device's are separate: Flou Player's is
only for searching, the device's for playing. The TIDAL view reads the
device's login from the OpenHome **Credentials** service (id `tidal.com`)
and says whether it is there and working.

## Radio

Like TIDAL, Flou Player only *finds* stations; the Linn/OpenHome device plays
them.

1. **Search** asks the community directory radio-browser.info (by name or by
   genre, most listened first, stations marked broken are left out). It needs
   no login. Several mirror servers are tried in turn. **Browse** lists the
   directory's countries, genres and languages with their station counts
   (`/api/radio/facets`, cached for an hour); picking one searches with that
   filter, alone or combined with words (then matched against the name).
2. **Favourites and your own stream URLs** are kept in
   `~/.cache/flou_player/radio.json`. Only `http://` and `https://` URLs are
   accepted.
3. **Playing** puts the stream URL into the device's playlist as a live item
   (`object.item.audioItem.audioBroadcast`, DIDL-Lite with name and logo).
   The device fetches the stream itself, so playback continues with Flou
   Player closed. Pause and seeking don't apply to live streams.

## Known limitations

- A full library scan makes many network requests and can still take a while
  on very large or deeply nested libraries, even though it is parallelised.
  The app shows the number of tracks found so far during the scan.
- Device events follow the UPnP and OpenHome eventing specifications and are
  tested against simulated devices only so far.
- The OpenHome queue (Queue button and double-click playback) and Pause are
  tested on a Linn Majik DSM. The dB volume readout, mute, source, pins and
  stream quality are **not verified against real hardware** yet and may need adjusting. For non-OpenHome UPnP
  renderers, playback uses AVTransport.
- TIDAL needs a Linn/OpenHome output device signed in to TIDAL; it can't
  play on "This computer" or on other UPnP renderers. The `tidal://` URI
  format is not publicly documented (tested on a Linn Majik DSM).
  Favourites and your own TIDAL playlists are not shown yet.
- Radio needs a Linn/OpenHome output device; it can't play on "This computer"
  yet. Whether a device accepts `https://` streams depends on its firmware;
  use the station's `http://` URL as an own stream URL if one doesn't play.
  Not tested on real hardware yet.
- Only one media server is loaded at a time. The *Source* dropdown switches
  the output device's own inputs, not the media server.
- In Live mode, Next/Previous step through the folder that is currently open
  (or the search results). Typing filters that folder; Enter uses the media
  server's own search, so what it finds depends on the server.
- No code from proprietary apps such as mconnect or the Linn app was used.

## License and dependencies

Flou Player is free software under the GNU General Public License, version 3
or (at your option) any later version. See [LICENSE](../LICENSE). Open-source
dependencies: FastAPI (MIT), Uvicorn (BSD-3-Clause), upnpclient (MIT),
tidalapi (LGPL-3.0-or-later, TIDAL login and search), pywebview (BSD-3-Clause), dbus-fast (MIT, Linux media keys), PyAV (BSD-3-Clause, bundles LGPL ffmpeg libraries),
PyQt5/PyQtWebEngine (GPL v3, or commercial from Riverbank Computing) and QtPy
(MIT). They are installed from PyPI on first setup.
