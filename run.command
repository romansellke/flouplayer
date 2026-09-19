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
python3 -m pip install --upgrade pip >/dev/null
python3 -m pip install -r requirements.txt

# Standalone desktop window -- no browser tab. See README.md if PyQt5 fails
# to install on your system.
python3 desktop.py
