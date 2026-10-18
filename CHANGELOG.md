# Changelog

All notable changes to Flou Player are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/) (see [docs/releasing.md](docs/releasing.md)).

## [Unreleased]

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

[Unreleased]: https://github.com/romansellke/flouplayer/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/romansellke/flouplayer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/romansellke/flouplayer/releases/tag/v0.4.0
