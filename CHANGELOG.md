# Changelog

All notable changes to Flou Player are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/) (see [docs/releasing.md](docs/releasing.md)).

## [Unreleased]

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

[Unreleased]: https://github.com/romansellke/flouplayer/compare/v0.12.0...HEAD
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
