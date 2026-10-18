# Troubleshooting

## No devices are found

- Computer, media server and output device must be on the same local network
  (same subnet/VLAN) -- SSDP discovery does not cross routers.
- With a firewall (`ufw`/`firewalld`), allow incoming UDP traffic from your
  local network (SSDP uses port 1900), otherwise the answers never arrive.
- Click **Search devices** again; the Diagnostics dialog (list button in
  the header) logs what was found.

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
