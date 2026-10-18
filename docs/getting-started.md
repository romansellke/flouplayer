# Getting started

## Requirements

- Linux (tested target: Linux Mint; also works on Arch Linux).
- Python 3 with `venv`, and internet access for the one-time setup.
- A UPnP/DLNA media server (e.g. MinimServer) and, for network playback, a
  Linn/OpenHome output device. Neither is required on the same machine as
  Flou Player.
- The computer, the media server and the output device must be on the **same
  local network**: discovery uses SSDP/UPnP, which does not cross
  subnets/VLANs. It makes no difference whether MinimServer, the output
  device and Flou Player run on three separate machines.

## Install as an app (recommended)

1. Open a terminal in the project folder.
2. Run `./packaging/install.sh`

This builds Flou Player once into a self-contained app (Python, Qt and all
dependencies bundled -- needs internet access for the build, takes a few
minutes and about 500 MB of disk space) and adds **Flou Player** to your
application menu with its icon. From then on, start it from the menu like
any other app: no terminal, no Python setup.

| Task | Command |
| --- | --- |
| Update after changing the code (e.g. `git pull`) | `./packaging/install.sh --rebuild` |
| Remove the app (keeps library cache and settings) | `./packaging/install.sh --uninstall` |
| Build only, without installing | `./packaging/build.sh` (result in `build/dist/flou-player/`) |

The app is installed for your user only, under `~/.local/share/flou-player`;
no `sudo` needed. Build it on the machine you run it on.

Only one Flou Player runs at a time: starting it again (from the menu,
`flou-player` or `./run.command`) just brings the open window to the front.

## Run from source (for development)

1. Open a terminal in the project folder.
2. One-time only: `chmod +x run.command`
3. `./run.command`

The first run creates a virtual environment and installs dependencies (needs
internet access briefly), then opens the app in its own window. Later runs
skip the install step and start straight away (it only runs again when
`requirements.txt` changes).

## Arch Linux

Everything above works the same; a few differences to Ubuntu/Mint:

- Python isn't part of a minimal Arch install:
  `sudo pacman -S --needed python git` (`venv` is included, there's no
  separate `python3-venv` package).
- `~/.local/bin` isn't on the `PATH` by default, so the `flou-player`
  terminal command may not be found -- the menu entry works regardless.
- After a system Python upgrade (e.g. 3.14 -> 3.15), `./run.command`
  recreates its virtual environment automatically (one-time reinstall, needs
  internet). The installed app bundles its own Python and keeps working;
  only `./packaging/install.sh --rebuild` builds against the new version.
- If you enabled a firewall (`ufw`/`firewalld`; Arch has none active by
  default), allow incoming UDP traffic from your local network -- SSDP
  discovery (port 1900) gets its answers that way, otherwise no devices are
  found.

## First start

1. Start the app. It opens in its own window.
2. Click **Search devices**, then pick your media server and your output
   device from the two dropdowns. The output list always includes
   **This computer (local speakers)**.
3. In **Live** mode (the default) the server's top level appears right away --
   click through the folders. In **Cached** mode click **Load library** to
   scan the whole server once.
4. Double-click a track to play it.

Flou Player remembers your media server and output device. The next time you
start it, it reconnects to them by itself and selects them again -- no new
search needed. If they don't answer (for example you changed network), it
searches once automatically. **Search devices** is still there to refresh the
list or to pick other devices.

Continue with the [User guide](user-guide.md).
