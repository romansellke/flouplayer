#!/bin/bash
# Builds Flou Player as a self-contained Linux app with PyInstaller:
# Python, Qt WebEngine and all dependencies bundled into one folder, so
# the installed app needs no Python, no venv and no internet at runtime.
#
# Result: build/dist/flou-player/flou-player (run packaging/install.sh to
# add it to the application menu). Build on the machine you'll run it on
# (or one with the same or an older Linux release) -- the bundle links
# against the system's C library.
set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"
VENV="$ROOT/build/venv"

# Recreate the build venv after a system Python upgrade (see run.command).
PYVER=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
if [ ! -f "$VENV/bin/activate" ] || [ ! -d "$VENV/lib/python$PYVER" ]; then
  rm -rf "$VENV"
  python3 -m venv "$VENV" || {
    echo "Could not create the build environment."
    echo "On Ubuntu/Linux Mint install the venv package first, e.g.: sudo apt install python3-venv"
    exit 1
  }
fi
source "$VENV/bin/activate"
python3 -m pip install --upgrade pip >/dev/null
python3 -m pip install -r requirements.txt "pyinstaller>=6.0"

# Stamp which commit this build comes from (shown in the About dialog).
# Not tracked by git; without git the app simply shows no source info.
python3 - <<'PY'
import json, subprocess
def git(*a):
    try: return subprocess.run(["git",*a],capture_output=True,text=True,check=True).stdout.strip()
    except Exception: return ""
json.dump({"describe":git("describe","--tags","--always","--dirty"),"commit":git("rev-parse","--short","HEAD"),"date":git("log","-1","--format=%cs")},
          open("app/_buildinfo.json","w"))
PY

# The excluded PyQt5 modules are only pulled in by PyInstaller's hooks
# (QML/Quick/3D/multimedia plugins); the app's window doesn't use them.
# Qt libraries the web engine really links against are still bundled.
pyinstaller --noconfirm --clean \
  --name flou-player \
  --distpath "$ROOT/build/dist" \
  --workpath "$ROOT/build/work" \
  --specpath "$ROOT/build" \
  --add-data "$ROOT/app/static:app/static" \
  --add-data "$ROOT/app/_buildinfo.json:app" \
  --copy-metadata fastapi --copy-metadata uvicorn --copy-metadata upnpclient \
  --copy-metadata av --copy-metadata pywebview --copy-metadata PyQt5 \
  --exclude-module PyQt5.QtQml --exclude-module PyQt5.QtQuick \
  --exclude-module PyQt5.QtQuickWidgets --exclude-module PyQt5.QtPositioning \
  "$ROOT/desktop.py"

echo
echo "Built: build/dist/flou-player/flou-player"
echo "Next:  ./packaging/install.sh   (adds Flou Player to your application menu)"
