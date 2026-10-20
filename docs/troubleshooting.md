# Troubleshooting

## No devices are found

- Computer, media server and output device must be on the same local network
  (same subnet/VLAN) -- SSDP discovery does not cross routers.
- With a firewall (`ufw`/`firewalld`), allow incoming UDP traffic from your
  local network (SSDP uses port 1900), otherwise the answers never arrive.
- Click **Search devices** again; the Diagnostics dialog (list button in
  the header) logs what was found.

## A device is found but nothing plays (Marantz, Denon/HEOS, Sonos, ...)

Flou Player was written for Linn/OpenHome players. Other renderers (a Marantz
SR6010 receiver, a Sonos Arc, ...) are controlled through the plain UPnP AV
standard (AVTransport), and they are much pickier. Flou Player therefore stops
the renderer first, sends the track, retries without the track's metadata if
the device refuses it, and retries *Play* a few times while the device loads
the stream. This could not be tried on such hardware here, so if playback
still fails, the error message tells what the device objected to. Open
**Diagnostics** (list button in the header) after a failed attempt; the entry
reads like `SetAVTransportURI failed: UPnP error 714 (Illegal MIME-type)`:

If the message is instead `400 Client Error: Bad Request for url: .../AVTransport/ctrl`
(older versions), the device refused the request on the HTTP level, before
any UPnP error: Marantz/Denon (HEOS) and Sonos want the SOAP request sent as
`text/xml; charset="utf-8"`, which Flou Player now does, and they dislike
vendor extras in the track metadata (it now retries with a minimal one).

| Code | Meaning | What to try |
| --- | --- | --- |
| 701 | Transition not available | The device is busy with another input (TV/HDMI, AirPlay, Spotify ...). Switch it to network / Sonos-app playback, stop what it plays, and try again. |
| 714 | Illegal MIME-type | The device does not play that file format (for example FLAC above 96 kHz or DSD). Try an MP3 or a 16-bit FLAC to check. |
| 716 / 717 | Resource not found / unsupported protocol | The device cannot reach the media server's address. Check that both are on the same network and that no firewall or VLAN is between them. |
| 712 / 402 | Bad metadata or arguments | Report it with the Diagnostics text. |

When you report a problem, please copy the report (**Copy report** in
Diagnostics) and press **Device info** first, so the services of the device
are in it.

Note that **Sonos** speakers are made to be controlled by the Sonos app and
only accept a limited set of formats (no hi-res above 48 kHz on the Arc).
Also check that the receiver (Marantz) has network standby / "network control"
switched on, otherwise it does not answer while it is off.

## `run.command` or the build fails on `venv`

On Ubuntu/Linux Mint this usually means the `python3-venv` package isn't
installed. Check your Python version with `python3 --version`, then run
`sudo apt install python3-venv` (or a version-specific package such as
`python3.12-venv`, matching the version shown), and run `./run.command`
again.

## PyQt5 fails to install (desktop window)

Flou Player opens its window using `pywebview`, which needs a Qt or GTK
backend to render the page. `requirements.txt` pulls in PyQt5 +
PyQtWebEngine for this, which normally installs via pip alone. If that fails
on your system, use the GTK backend instead:

```
sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1
```

(the package may be called `gir1.2-webkit2-4.0` on older distributions), then
remove the PyQt5/PyQtWebEngine lines from `requirements.txt` and start with
`PYWEBVIEW_GUI=gtk ./run.command`.

## Everything looks tiny (GNOME, HiDPI screens)

Flou Player takes the desktop's screen scaling from Qt. Two things help if the
window comes up too small:

- **Zoom the interface:** **Ctrl/⌘+Plus** and **Ctrl/⌘+Minus** scale the
  whole window (75 % to 300 %), **Ctrl/⌘+0** resets it. The level is
  remembered.
- **Force a scale factor** for the window, e.g. `FLOU_SCALE=2 ./run.command`
  (or `FLOU_SCALE=2 flou-player` for the installed app). Qt's automatic
  scaling is switched on by default; if you set `QT_SCALE_FACTOR` or
  `QT_AUTO_SCREEN_SCALE_FACTOR` yourself, yours wins -- except that
  `FLOU_SCALE` overrides `QT_SCALE_FACTOR`.

If the window is too small *and* blurry, the desktop is probably scaling an
unscaled X11 window; `FLOU_SCALE` with the factor of your screen fixes that.

## The window is blank or renders oddly

Try the other backend: `PYWEBVIEW_GUI=gtk ./run.command` (default: `qt`).

## The app crashes ("Segmentation fault")

Closing the window used to be able to crash the app on exit (a Qt WebEngine
teardown-order problem); Flou Player now shuts the web engine down in the
right order itself, so this should no longer happen.

On Linux the window's web engine (Qt WebEngine) runs its GPU code inside the
app process, so a graphics driver problem can take the whole app down. Flou
Player therefore renders in software by default. To get GPU acceleration
back, start it with `FLOU_GPU=1 ./run.command` (or `FLOU_GPU=1 flou-player`
for the installed app).

If it still crashes, the details (which part of the app was running at that
moment) are written to `~/.cache/flou_player/crash.log` -- please include
that file when reporting the problem.

## A track doesn't play on the local speakers

The built-in web engine plays FLAC, WAV, MP3 and Ogg directly. AAC/ALAC
(`.m4a`) and other formats ffmpeg can read are converted to FLAC on the fly
(seeking isn't possible in such tracks). Raw PCM streams (`audio/L16`) can't
be played locally. See [Local playback](user-guide.md#local-playback).

## Reporting a bug

Open the **Diagnostics** dialog and use **Copy report** (versions, device
services and the log) and paste it into the issue. The **About** dialog (info
button, top right) shows the version and build.
