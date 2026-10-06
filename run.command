#!/bin/bash
set -e
cd "$(dirname "$0")"

# (Re)create the venv if it's missing or was made with another Python
# version -- e.g. after a system Python upgrade on a rolling-release
# distribution like Arch, which leaves the old venv's packages unusable.
PYVER=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
if [ ! -f .venv/bin/activate ] || [ ! -d ".venv/lib/python$PYVER" ]; then
  rm -rf .venv
  python3 -m venv .venv
  if [ ! -f .venv/bin/activate ]; then
    echo "Could not create the virtual environment."
    echo "On Ubuntu/Linux Mint this usually means the 'python3-venv' package is missing."
    echo "Check your Python version:  python3 --version"
    echo "Then install it, e.g.:      sudo apt install python3-venv"
    echo "(or a version-specific one, e.g. python3.12-venv -- match the version shown above)"
    exit 1
  fi
fi

source .venv/bin/activate

# Only (re)install when requirements.txt changed since the last successful
# install, so later launches start straight away without network access.
STAMP=.venv/.requirements-installed
if ! cmp -s requirements.txt "$STAMP"; then
  python3 -m pip install --upgrade pip >/dev/null
  python3 -m pip install -r requirements.txt
  cp requirements.txt "$STAMP"
fi

# Standalone desktop window -- no browser tab. See README.md if PyQt5 fails
# to install on your system.
status=0
python3 desktop.py || status=$?
if [ "$status" -ge 128 ]; then
  echo
  echo "Flou Player crashed (signal $((status - 128)))."
  echo "Details were written to: ~/.cache/flou_player/crash.log"
  echo "Please include that file when reporting the crash."
fi
exit "$status"
