# Changelog

All notable changes to Flou Player are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/) (see [docs/releasing.md](docs/releasing.md)).

## [Unreleased]

### Added
- **Server-wide search in Live mode**: Enter in the search field searches the
  whole media server (ContentDirectory Search, e.g. MinimServer) for albums and
  tracks by title, artist or album; the results open like a folder. Typing
  still filters the open folder.

### Changed
- Header icons: Library health now has a tag icon, Diagnostics the pulse icon.

### Fixed
- Live search results list each album's tracks in track order (the server
  returns them by relevance).
- In Live mode the search field lined up a few pixels too far right (an empty
  library button box was still taking space); it now aligns with the tabs.
- The search could not be reset: the search field has a **×** (and **Esc**)
  that clears the text and, in Live mode, leaves a server search back to the
  folder that was open before.

## [0.18.0] - 2026-10-20

### Added
- **Media keys** and the panel's player controls (MPRIS, Linux): play/pause,
  next, previous and stop from the keyboard, the sound menu or player widgets,
  also with the window in the background; the panel shows the current track
  and cover.
- **Clear library** button next to "Load library": deletes the saved library
  from disk and empties the list (the music on the server is not touched).
- **Cancel** button while a library scan is running; a cancelled scan keeps
  nothing.
- The Diagnostics log records every library scan: tracks and folders found,
  duration, what was skipped (same URL, same tags, not audio, looping or too
  deep folders), unreadable folders, and cancel/clear actions.
- Getting-started guide: step-by-step instructions for downloading the code from
  GitHub and installing it, and a troubleshooting section for devices that are
  found but do not play (Marantz/HEOS, Sonos) with a table of UPnP error codes.
- The **Queue** tab has a tooltip explaining that the queue lives on the output device (OpenHome Playlist) and what it does.

### Changed
- Docs: the device queue and Pause are now marked as tested on a Linn Majik DSM.
- Double-click on a Linn/OpenHome device plays through the device's own queue:
  the album replaces the queue and plays from the clicked track, gapless and
  on its own even when Flou Player is closed. Other devices play the single
  track as before; if the queue fails, Flou Player falls back to that too.
- Live mode hides Clear library (and Cancel); the Queue tab is set apart from Live/Library by a divider.
- The Live and Library (cached) modes are now tabs next to Queue; the separate Live/Cached switch is gone.
- Load library, Cancel and Clear library are now one joined button group.

### Fixed
- Pause now also reaches the device when it accepts the OpenHome pause but keeps
  playing, and the Pause button is only greyed out for sources that really cannot pause (e.g. radio), not for the device queue or our own list.
- Active buttons (Live/Library/Queue tab, Library health, mute, the
  selected facet and health check) are now filled with the theme's accent
  colour, so they stand out in every theme. The playing track gets a coloured
  side bar.
- Playing on Marantz/Denon (HEOS) and Sonos failed with "400 Bad Request ...
  /AVTransport/ctrl": the SOAP requests are now sent as
  `text/xml; charset="utf-8"` (upnpclient omits the charset), and the track
  metadata falls back to a minimal rebuilt DIDL before being dropped. HTTP-level
  refusals now name the status, URL and the device's answer in the error. Not
  tried on real hardware.
- Playing on plain UPnP AV renderers (Marantz, Sonos): the player is stopped
  first, a refused DIDL metadata is retried without it, *Play* is retried a few
  times when the device answers "701 Transition not available" while it loads,
  and errors show the UPnP code and description (for example
  `SetAVTransportURI failed: UPnP error 714 (Illegal MIME-type)`) instead of a
  bare tuple. Not tried on real hardware.
- A scan could run away on servers whose folder tree loops (a folder listing
  itself again under a new object id) and report tens of thousands of tracks
  for a library of a thousand. The scan now stops descending when a folder
  title repeats along the path, when the tree gets too deep, or when thousands
  of folders in a row bring no new track (the result then carries a warning).
- Tracks were found many times on servers like Jellyfin, which list the same
  file under several views with different object ids and stream URLs. Tracks
  are now also merged by title, album, artist, track number and duration.
- Without a by-folder view the scan walked every view (Artist, Genre, Composer
  ...) and still counted a library of 1400 files as 13000 tracks, because the
  copies differed in artist, track number or duration format. It now prefers a
  flat "Songs"/"Tracks" view, then the "Albums" view, and merges copies by title,
  album and duration in seconds. The Diagnostics log lists the server's top-level
  folders.
- A server that simply lists every track in several views (Artist, Genre ...)
  no longer gets a scan "error" when the scan ends after thousands of folders
  without a new track: that is now a plain log note, and the error and the toast
  stay for real loops. View names such as "[Folders]" are matched ignoring
  brackets and spaces.
- Videos and photos on servers that mix them into the music tree are no longer
  counted as tracks.
- A "Folders" view one level down (Jellyfin: Music > Folders) is now found and
  scanned alone instead of walking every view.

## [0.17.0] - 2026-10-19

### Added
- **Interface zoom**: Ctrl/⌘+Plus, Ctrl/⌘+Minus and Ctrl/⌘+0 scale the whole
  window from 75 % to 300 % (remembered), for screens where everything looks
  tiny.
- `FLOU_SCALE=1.5` forces a Qt scale factor for the app window.

### Fixed
- On HiDPI screens under GNOME the app window came up far too small: Qt's
  automatic screen scaling is now switched on (unless you set it yourself).
  This could not be tried on a GNOME desktop here, so the zoom is the fallback.

## [0.16.1] - 2026-10-19

### Changed
- The Health view is opened from a pulse icon in the header icon bar instead of
  a third tab next to Library and Queue; the icon is highlighted while it is
  open and toggles back to the library.

## [0.16.0] - 2026-10-19

### Added
- **Library health**: a Health tab that checks the scanned library for
  incomplete or inconsistent tags -- Album Artist without Artist (and the other
  way round), albums with neither, missing album titles, no or partial cover
  art, missing / repeated / skipped track numbers, duplicate titles, an album
  split into versions with and without Album Artist, names that differ only by
  spelling, mixed lossless and lossy tracks, and missing year, genre or format
  information. Click a check for the affected albums, click an album to jump to
  it, *Copy list* copies the findings as tab-separated text.

## [0.15.1] - 2026-10-19

### Added
- A "How this was built" note in the README and in `docs/how-it-works.md`, and
  a line in the About dialog: the app was developed with AI assistance (Claude
  Code (Anthropic)) under the direction of the author, and many device features
  are not verified on hardware other than the author's.

### Added
- Tests for Ctrl+←/→ (next/previous track) in the cached library, with a filter
  active, and in Live mode.

## [0.15.0] - 2026-10-18

### Added
- **Keyboard shortcut overview**: press Ctrl/⌘+/ or F1 (or click the keyboard
  button in the header) for an overlay listing all shortcuts; Esc closes it.
  While it is open the playback keys are ignored.

## [0.14.2] - 2026-10-18

### Changed
- Volume readout: the step number is now bold and larger, with the dB value
  after it in smaller type, instead of "33 · -48.1 dB" in one line.

## [0.14.1] - 2026-10-18

### Changed
- The volume readout now shows the device's volume **step first**, as the Linn
  does, and the dB value after it (`33 · -48.1 dB`), instead of only the dB
  value. The dB part is calculated from the device's own characteristics and
  is an indication, not a measurement. Devices without dB values keep showing a
  percentage.

## [0.14.0] - 2026-10-18

### Added
- **Quality filter** above the album list: show only Hi-Res, CD quality,
  Lossless (both) or Lossy tracks, in the cached library and in Live mode. The
  quality is derived from the format and the sample rate / bit depth the server
  reports.

### Changed
- README: new screenshot of the Cached mode.

## [0.13.0] - 2026-10-18

### Changed
- The albums in the cached library are now ordered by **Album Artist**, then by
  album title, instead of alphabetically by album title. Untagged albums are
  sorted by their artist, albums without any artist last.

## [0.12.3] - 2026-10-18

### Fixed
- **Shuffle** and **Repeat** in the Queue tab: the command failed with
  "'bool' object has no attribute 'lower'" (the UPnP client wants booleans as
  strings, as with Mute). Found while writing tests for the queue.

### Changed
- Internal: the backend `main.py` (900 lines) is split into modules by topic
  (`devices`, `openhome`, `control`, `library`, `transcode`, `playlist`, ...);
  the API is unchanged (same 27 routes). The build ID now also covers all
  backend files. See [docs/development.md](docs/development.md#backend-files).
- More tests: the device queue, the app's ping/page endpoints and transcoding's
  URL check.

## [0.12.2] - 2026-10-18

### Changed
- Internal: the 1450-line `app.js` is split into ten files by topic (`core.js`,
  `devices.js`, `library.js`, `playback.js`, `live.js`, ...); no change in
  behaviour. See [docs/development.md](docs/development.md#frontend-files).

## [0.12.1] - 2026-10-18

### Added
- **Automated tests** (`pytest`): the backend endpoints against fake UPnP
  devices, and the page in headless Chromium with a mocked API, plus a GitHub
  Actions workflow that runs them on every pull request. See
  [docs/development.md](docs/development.md).

### Fixed
- In Live mode, going back (Backspace or the path bar) or opening another
  folder while a folder was still loading left the view stuck on "Loading ..."
  (found by the new tests).

## [0.12.0] - 2026-10-18

### Changed
- The status text (for example "13064 tracks (cached, ...)" or the live
  server's name) moved from the toolbar to a status line at the very bottom of
  the window. The search field now uses the freed space in the toolbar.

## [0.11.0] - 2026-10-18

### Added
- **Keyboard control** of playback: Space for play/pause, Shift+←/→ to seek,
  Ctrl+←/→ for previous/next, Ctrl+↑/↓ for volume, Ctrl+M for mute and Ctrl+.
  for stop. Plain arrow keys and letters stay free for scrolling and the
  column type-ahead; the shortcuts are ignored while typing in a field, while
  a dialog is open and on focused buttons and sliders.

## [0.10.2] - 2026-10-18

### Fixed
- The remembered media server and output device still weren't shown in the
  dropdowns: the actual fix announced for 0.10.1 (redrawing the dropdown after
  the remembered device is applied) had been left out of that release by
  mistake. It is in now.
- If a remembered device doesn't come back at startup (slow, or you changed
  network), the app now searches once automatically, and the Diagnostics log
  says which remembered device was or wasn't found.

## [0.10.1] - 2026-10-18

### Fixed
- Remembering the media server and output device (0.10.0) didn't work: the
  restored choice was set internally but the dropdowns still showed "Select
  media server" / "Select output device", and picking the remembered device was
  ignored because it already counted as selected. The dropdowns now show the
  restored choice.

## [0.10.0] - 2026-10-18

### Added
- The chosen **media server and output device are remembered**. At startup the
  app reconnects to the devices it knew by their description URL (no network
  search) and selects them again; in Live mode the server's top level opens
  right away. If none of them answers, it falls back to one automatic search.
  *Search devices* still refreshes the list.

### Changed
- README: new screenshots of the Live and the Cached mode.

## [0.9.0] - 2026-10-18

### Added
- **Standby / wake** button next to the Source dropdown (OpenHome devices); it
  shows and follows the device's state.
- The transport buttons **grey out what the active source can't do** (pause
  and skip on live radio), based on the device's capabilities.
- **Firmware status** (installed version, update available or not) in the
  Diagnostics *Device info* and in the copied report. Read-only.

## [0.8.0] - 2026-10-18

### Changed
- The **Source** dropdown and the **Pins** button moved from the header into
  the toolbar, right next to the output device they belong to.
- The pins button shows a pushpin instead of a star.

## [0.7.0] - 2026-10-18

### Changed
- In the track list the **Album Artist** now stands next to the cover (for
  albums without that tag, the artist if all tracks share one), and the
  separate Album Artist column is gone. The **Artist** column is hidden by
  default and can be switched on under *Columns*. The column choice starts
  fresh with these defaults.

### Fixed
- The **Now Playing** button did nothing in Live mode once you had left the
  playing track's folder; it now opens that folder and scrolls to the track.
- Tracks started from the device queue (**▶ Play all**, **+ Queue**) now get
  the ▶ marker and enable the Now Playing button too, by matching the queue
  entry to the library track.

## [0.6.0] - 2026-10-18

### Changed
- The **Now Playing panel is gone**: it mostly repeated the title display. The
  library now uses the full window width. The title display in the header
  shows a small cover (click for full size) next to title, artist and album,
  with the stream quality as a third line; the Diagnostics button (with its
  error badge) moved next to the About button.
- The status text ("Now playing", "Not connected") was dropped.

### Fixed
- Play, pause, stop, next and previous failed with "701 Transition not
  available" while the device was on a source other than its Playlist (Radio,
  AirPlay, an input). They now go to the device's own OpenHome Transport
  service, which controls whatever source is active; next/previous also act on
  the device itself in that case instead of stepping through the track list.

## [0.5.1] - 2026-10-18

### Changed
- The Source dropdown and the pins moved from the Now Playing panel into the
  header, next to the volume slider; pins are a star button with a menu.

### Fixed
- **Mute** failed on every click with "'bool' object has no attribute 'lower'":
  the UPnP client wants boolean arguments as strings.
- Switching **source** or playing a **pin** did nothing while the device was in
  standby; the device is now woken first.
- The Source dropdown could snap back to the old source right after a change,
  before the device had switched. Switching a source or playing a pin now also
  shows a short confirmation.
- Device search sometimes missed the media server: the SSDP replies are UDP and
  get lost now and then, so the search now runs two passes at once and merges
  the results.
- The About dialog and the Diagnostics report showed no dependency versions in
  the installed app; the build now bundles the package metadata.

## [0.5.0] - 2026-10-18

### Added
- **Source selection** for Linn/OpenHome devices: a Source dropdown in the Now
  Playing panel switches between the device's inputs (Playlist, Radio, Analog,
  Songcast, HDMI ...) and follows changes made from other controllers.
- **Pins**: the device's pins (favourite radio stations, playlists, inputs) are
  listed in the Now Playing panel; a click plays one.
- **Mute** button next to the volume slider (OpenHome devices); it follows the
  device's mute state.
- **Stream quality from the device** (codec, sample rate, bit depth, bit rate)
  under the title in the Now Playing panel, also for sources that don't come
  from the media server, such as radio.
- Documentation for all of the above.

### Changed
- README: explains why Flou Player exists as an alternative to the Linn app.
- The screenshot is shown only in the README, no longer in the docs pages.

> The new device features follow the OpenHome service definitions (Product,
> Pins, Info, Volume) and are **not verified against real hardware**.

## [0.4.0] - 2026-10-18

### Added
- **Live browsing** of the media server, folder by folder like the Linn app,
  next to the cached full-library scan; a `Live | Cached` switch in the
  toolbar (Live is the default).
- New app icon: a Phi on the blue tile with a champagne-gold stroke.
- Documentation under `docs/` (getting started, user guide, troubleshooting,
  how it works, releasing) and a fresh screenshot.
- Version handling: `CHANGELOG.md`, `packaging/release.sh`, and the About
  dialog now shows the version, build, source commit and a changelog link.

### Changed
- The Library/Queue tabs moved into the toolbar, so the library panel and the
  Now Playing panel start at the same height.
- Long track titles no longer push the track list below the cover; the list
  scrolls sideways instead.
- The README is shorter and points to the documentation.

### Removed
- Unused source-switching code in the backend.

## [0.3.0] and earlier

No changelog was kept before 0.4.0; see the
[git history](https://github.com/romansellke/flouplayer/commits/main). By 0.3.0
Flou Player had: SSDP discovery of media servers and Linn/OpenHome output
devices; a scanned, disk-cached library with an Album Artist/Artist/Album/Year
column browser and search; local playback with on-the-fly FLAC conversion;
the OpenHome queue tab; a position/seek bar and a live dB volume readout; a
Diagnostics log and About dialog; 17 colour themes; installable Linux app
packaging; and the GPL-3.0-or-later license.

[Unreleased]: https://github.com/romansellke/flouplayer/compare/v0.18.0...HEAD
[0.18.0]: https://github.com/romansellke/flouplayer/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/romansellke/flouplayer/compare/v0.16.1...v0.17.0
[0.16.1]: https://github.com/romansellke/flouplayer/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/romansellke/flouplayer/compare/v0.15.1...v0.16.0
[0.15.1]: https://github.com/romansellke/flouplayer/compare/v0.15.0...v0.15.1
[0.15.0]: https://github.com/romansellke/flouplayer/compare/v0.14.2...v0.15.0
[0.14.2]: https://github.com/romansellke/flouplayer/compare/v0.14.1...v0.14.2
[0.14.1]: https://github.com/romansellke/flouplayer/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/romansellke/flouplayer/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/romansellke/flouplayer/compare/v0.12.3...v0.13.0
[0.12.3]: https://github.com/romansellke/flouplayer/compare/v0.12.2...v0.12.3
[0.12.2]: https://github.com/romansellke/flouplayer/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/romansellke/flouplayer/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/romansellke/flouplayer/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/romansellke/flouplayer/compare/v0.10.2...v0.11.0
[0.10.2]: https://github.com/romansellke/flouplayer/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/romansellke/flouplayer/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/romansellke/flouplayer/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/romansellke/flouplayer/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/romansellke/flouplayer/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/romansellke/flouplayer/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/romansellke/flouplayer/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/romansellke/flouplayer/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/romansellke/flouplayer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/romansellke/flouplayer/releases/tag/v0.4.0
