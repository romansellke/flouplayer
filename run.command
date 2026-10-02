#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -f .venv/bin/activate ]; then
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
python3 desktop.py
