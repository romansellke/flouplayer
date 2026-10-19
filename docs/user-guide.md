# User guide

## The window

- **Header:** transport buttons (previous, play, pause, stop, next), volume
  slider with the volume readout (step and dB) and mute button, the LCD-style display of the current track
  (small cover, title, artist and album, and the stream quality -- click the
  cover to see it full size), the Diagnostics and About buttons and the
  theme picker. Under it, the **position bar**:
  elapsed time at the left, remaining time at the right, a thick seek bar
  with a time grid in between (a tick every minute, every 5/10 minutes for
  long tracks).
- **Toolbar:** the Library/Queue tabs, the Live/Cached switch, **Search
  devices**, the media server and output device dropdowns (with each
  device's own icon, taken from its UPnP description), the **Source**
  dropdown and **Pins** button of the output device (OpenHome devices),
  **Load library**
  and the search field.
- **Status line** (very bottom of the window): what is loaded -- in Cached mode
  the number of tracks and when the library was scanned, in Live mode the
  media server being browsed.
- **Main area:** the library (column browser plus album list) or the queue,
  using the full window width. On very narrow windows the header wraps and
  the columns stack.

## Live or cached library

The **Live | Cached** switch in the toolbar chooses how the library is shown.
The choice is remembered.

### Live (default)

Browses the media server folder by folder, like the Linn app. Whatever
structure the server offers -- Artists, Albums, Genres, Folders, ... -- is
what you see.

- Click a folder card to open it. The path bar above the list shows where
  you are; click any part of it to jump back, or press **Backspace** /
  **Alt+←** to go one folder up.
- A folder that contains tracks is shown as an album block with cover and
  track table.
- The search field filters the current folder only.
- Large folders load in steps of 300 entries; use **Load more** at the end.
- Nothing is scanned or stored: the view is always current and starts
  instantly.

Next/Previous step through the folder that is currently open. *Now Playing*
returns to the folder a playing track was started from, as long as you
browsed it in this session.

### Cached

Scans the whole library once and keeps it on disk, which allows the
iTunes-style column browser and instant searching across everything.

1. Select the media server and click **Load library**. The scan runs in
   parallel; the number of tracks found so far is shown while it works.
2. The result is saved to `~/.cache/flou_player/library.json` and reloaded
   automatically on the next start. Click **Load library** again whenever
   you want to refresh it, for example after adding new music.

## Browsing the cached library

- **Column browser:** Album Artist, Artist, Album and Year. Each column only
  shows values that still match the other selections, with a correct count
  (albums for Album Artist/Artist/Year, tracks for Album). "All ..." resets
  a column. Album Artist shows the tag exactly as the server delivers it --
  tracks without an album-artist tag don't appear under any Album Artist
  entry.
- **Type-ahead:** click a column and type letters to jump to the first entry
  starting with them; Enter selects it, Escape clears the highlight.
- **Collapse the browser** with the **Browser** button (Ctrl/⌘+B) to give
  the album list the full height. The current selection keeps filtering
  while hidden; the state is remembered.
- **Quality filter:** the dropdown above the album list shows only tracks of
  one audio quality -- *Hi-Res* (lossless above 16 bit or 48 kHz), *CD quality*
  (lossless up to 16 bit and 48 kHz), *Lossless* (both) or *Lossy* (MP3, AAC,
  Ogg, ...). It works in the cached library (the columns and counts follow it)
  and in Live mode (within the open folder), together with the search. The
  quality comes from the file's format and the sample rate / bit depth the
  server reports; tracks where it can't be told appear only under *All
  qualities*.
- **Album order:** albums are sorted by Album Artist (the name shown next to
  the cover; for albums without that tag the artist, if all tracks share one),
  then by album title. Albums with no artist information at all come last.
- **All albums at a glance:** with nothing selected, the whole library is
  listed. The list is built in chunks as you scroll, so very large libraries
  stay responsive. Only the album list scrolls -- header, toolbar, column
  browser stay fixed.
- **Search** (Ctrl/⌘+F) filters on title, artist, album artist, album, genre
  and year of the loaded library.
- Albums are grouped by album name **and** album artist, so same-named albums
  by different artists stay separate. Duplicates (same playback URL) are
  removed.

## The album list

- **Covers slider:** scales the album covers (remembered). Clicking any cover
  -- in the list or in Now Playing -- opens it full size (click or Esc to
  close).
- **Album Artist** stands next to the cover, with the album title and year
  (for an album without that tag, the artist if all its tracks share one).
- **Columns button:** toggles Quality, Bitrate, Time, Artist, Genre and Year
  in the track table (remembered). Quality and Time are on by default; the
  Artist column is hidden by default, since the Album Artist is already shown
  next to the cover. The Quality column shows the sample rate and bit depth,
  where the server supplies them.
- **Now playing:** the playing track shows a ▶ instead of its track number and
  is highlighted. This also works for tracks started from the device queue.
  The **▶ Now Playing** button (Ctrl/⌘+L) scrolls to the track; if the current
  filters or search hide it (cached library), or you have since left its
  folder (Live), it first switches back to its album or folder.
- **Right-click** a track or an album to inspect its raw metadata.
- Long track titles don't wrap under the cover: the track table scrolls
  sideways instead.

## Playing music

- **Double-click** a track to play it on the selected output device. When a
  track ends, the next one from the currently displayed list starts
  automatically (detected by polling the position; stopping playback
  yourself does not trigger this).
- Play, pause, stop, next, previous and the **position bar** work through
  the standard UPnP services. On Linn/OpenHome devices the transport buttons
  use the device's own Transport service, so they also work while another
  source (Radio, AirPlay, an input) is active; then next/previous skip on
  the device rather than in the track list. Seeking works on UPnP renderers, the device
  queue and local playback.
- The LCD shows elapsed and total time, updated by polling.

### Volume

The slider prefers the OpenHome Volume service (typical for Linn devices). Its
label shows the device's volume **step, as the Linn shows it** (bold and
larger), followed by the **dB** it works out to in smaller type, for example
**33** -48.1 dB. The dB value is calculated from the
device's own characteristics (the step where the gain is 0 dB, and the size of
a step) and is an indication, not a measurement. Without that service the
slider falls back to the standard UPnP 0-100% range. Changes are ramped in small steps, so clicks and fast
drags don't cause sudden jumps; the mouse wheel moves one step at a time
(Shift = 5), and the slider follows changes made from other controllers.

### Local playback

Choose **This computer (local speakers)** as the output device to play
through the computer's own sound output, using the app window's built-in
HTML5 audio. No UPnP renderer is needed, which is handy for testing.

- FLAC (including hi-res), WAV, MP3 and Ogg play directly.
- AAC/ALAC (`.m4a`) and other formats ffmpeg can read are converted to FLAC
  on the fly (PyAV/ffmpeg; lossless for ALAC, hi-res stays hi-res).
  Seeking isn't possible within such converted tracks.
- Raw PCM streams (`audio/L16`) can't be played locally.
- If the server offers several variants of a track, the app picks one it can
  play directly. Auto-advance skips tracks it can't play at all.

## Library health

The **Health** tab checks the scanned library (Cached mode; load it first) for
incomplete or inconsistent tags. The list on the left shows each check with the
number of albums it found (a ✓ means nothing found; orange = probably wrong,
blue = good to know). Click a check to see the albums, and click a row to jump
to that album in the library. **Re-check** runs the checks again, **Copy list**
copies the selected check as tab-separated text (for a spreadsheet).

| Check | Finds |
| --- | --- |
| Album Artist, but Artist missing | tracks with an Album Artist tag but no Artist |
| Artist, but Album Artist missing | albums with Artists but no Album Artist tag at all |
| Neither Artist nor Album Artist | albums without any artist information |
| Album title missing | tracks without an album title |
| No cover art / Cover art on some tracks only | albums without cover, or with cover on some tracks |
| Track numbers missing, duplicated or with gaps | albums with incomplete or repeated numbering |
| Same title twice in one album | possible duplicate files |
| Same album with and without Album Artist | the album exists twice because only some tracks have the tag |
| Names that differ only by spelling | "The Beatles" / "Beatles", capitalisation, punctuation |
| Lossless and lossy tracks mixed | albums mixing both |
| Year missing / Different years within one album | years not set, or inconsistent |
| Genre missing | albums without a genre |
| Only one track | singles or incomplete albums |
| No format information | tracks without sample rate and bit depth |

Albums are told apart by title *and* Album Artist, as everywhere in the app.
The checks only read the tags the media server delivers; nothing is changed.
Fix the tags at the source (for example with a tag editor), then rescan.

## The queue (OpenHome playlist)

On Linn/OpenHome devices the device's own playlist has its own **Queue** tab
(Ctrl/⌘+Q toggles it).

- Lists the tracks with cover, artist, album, length and total time, with
  Shuffle, Repeat and Clear. Double-click a track to jump to it; `×` removes
  it.
- Add from the library with **+** on a track, **+ Queue** on an album, **▶**
  on an album (replaces the queue and plays), or **▶ Play all** /
  **+ Queue all** for everything currently shown.
- While the queue is the active source, the transport buttons control it and
  the device advances by itself.

> The queue has **not been verified against real hardware**.

## Device controls: mute, source, pins, stream quality

These work on Linn/OpenHome output devices and appear only where the device
offers them (not for the local speakers or plain UPnP renderers).

- **Mute:** the speaker button next to the volume slider. It shows the
  device's real mute state, also when it was changed from another controller.
- **Source:** the *Source* dropdown in the toolbar, right of the output
  device, lists the device's inputs (for example Playlist, Radio, Analog,
  Songcast, HDMI) and switches to the one you pick. It follows changes made from other
  controllers. Choosing *Playlist* returns to the queue.
- **Pins:** the pushpin button right of the Source dropdown opens the list of pins
  you set up on the device (favourite radio stations, playlists, inputs).
  Click one to play it; the list closes again (Esc or a click elsewhere also
  closes it). The list refreshes about once a minute and whenever you select the
  device.
- **Stream quality:** as a third line in the title display, codec, sample rate, bit depth and bit
  rate as the *device* reports them (for example
  `FLAC · 44.1 kHz · 16 bit · 1011 kbps`). It also works for sources that
  don't come from the media server, such as radio. Hidden while nothing is
  playing.
- **Standby:** the power button left of the Source dropdown puts the device
  into standby or wakes it up. It is highlighted while the device is on and
  grey in standby, and follows changes made elsewhere. Picking a source or a
  pin wakes a sleeping device by itself.
- **What the source allows:** the transport buttons grey out what the active
  source can't do -- for example pause and skip on live radio. Where the device
  doesn't say, buttons stay enabled. Next/previous are only greyed when the
  device does the skipping (a non-Playlist source or the device queue), not
  when the app steps through its own track list.
- **Firmware:** *Device info* in the Diagnostics dialog, and the copied
  report, show the installed firmware version and whether an update is
  available. Flou Player never installs updates.

> Like the queue, these are written against the OpenHome service definitions
> (Product, Pins, Info, Transport, Update, Volume) and have **not been verified against real
> hardware**. Please report what you see in the Diagnostics dialog (*Device
> info*) if something doesn't show up.

## Themes

The palette button in the header switches between 17 colour themes (Dracula,
Nord, Catppuccin Mocha, Tokyo Night, ...). The choice is remembered.

## Diagnostics and About

- **Diagnostics** (list button in the header, with a badge for unseen errors): a timestamped log of the
  last 300 entries with errors in red and a badge for unseen errors; an
  errors-only filter; **Device info**, which lists the firmware and all
  services of the selected player; and **Copy report** (versions, device services and log)
  for bug reports.
- **About** (info button, top right): version, build, Python/system and
  dependency versions, and the project link.

## Keyboard shortcuts

Press **Ctrl/⌘+/** or **F1** (or click the keyboard button in the header) for
an overview of all shortcuts inside the app; **Esc** closes it.

**Playback** -- these work anywhere in the window, except while you are typing
in a field, while a dialog is open, or while the focus is on a button or slider
(which keep their own keys):

| Shortcut | Action |
| --- | --- |
| Space | Play / pause (on a source that can't pause, such as live radio: stop) |
| Shift+← / Shift+→ | Seek 10 seconds back / forward |
| Ctrl/⌘+← / Ctrl/⌘+→ | Previous / next track |
| Ctrl/⌘+↑ / Ctrl/⌘+↓ | Volume up / down (add Shift for 5 steps) |
| Ctrl/⌘+M | Mute / unmute |
| Ctrl/⌘+. | Stop |

The plain arrow keys stay free for scrolling the album list, and plain letters
for the column type-ahead.

**Navigation, library and general**

| Shortcut | Action |
| --- | --- |
| Ctrl/⌘+F | Focus the search field |
| Ctrl/⌘+L | Jump to the playing track |
| Ctrl/⌘+B | Show / hide the column browser |
| Ctrl/⌘+Q | Switch between Library and Queue |
| Backspace / Alt+← | One folder up (Live mode) |
| Esc | Close a dialog or the full-size cover |
| A-Z in a column | Type-ahead in the column browser (Enter selects, Esc clears) |
| Ctrl/⌘+/ / F1 | Show the shortcut overview |
| Mouse wheel on the volume slider | One volume step (Shift = 5) |
