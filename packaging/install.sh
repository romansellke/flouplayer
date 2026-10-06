#!/bin/bash
# Installs the app built by packaging/build.sh for the current user (no
# sudo needed) and adds it to the application menu with its icon.
#
#   ./packaging/install.sh             build (if needed) and install
#   ./packaging/install.sh --rebuild   rebuild first, e.g. after an update
#   ./packaging/install.sh --uninstall remove it again (keeps your library cache)
set -e
cd "$(dirname "$0")/.."

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
INSTALL_DIR="$DATA_HOME/flou-player"
APP_DIR="$INSTALL_DIR/app"
ICON="$INSTALL_DIR/flou-player.svg"
DESKTOP_FILE="$DATA_HOME/applications/flou-player.desktop"
BIN_LINK="$HOME/.local/bin/flou-player"

if [ "$1" = "--uninstall" ]; then
  rm -rf "$APP_DIR" "$ICON" "$DESKTOP_FILE"
  [ -L "$BIN_LINK" ] && rm -f "$BIN_LINK"
  update-desktop-database "$DATA_HOME/applications" >/dev/null 2>&1 || true
  echo "Flou Player removed. (Library cache and settings were kept: ~/.cache/flou_player, $INSTALL_DIR/webview)"
  exit 0
fi

if [ "$1" = "--rebuild" ] || [ ! -x build/dist/flou-player/flou-player ]; then
  ./packaging/build.sh
fi

# Replace the previous install as a whole, so no stale files linger.
mkdir -p "$INSTALL_DIR" "$DATA_HOME/applications" "$HOME/.local/bin"
rm -rf "$APP_DIR.new"
cp -a build/dist/flou-player "$APP_DIR.new"
rm -rf "$APP_DIR"
mv "$APP_DIR.new" "$APP_DIR"
cp app/static/icon.svg "$ICON"
ln -sfn "$APP_DIR/flou-player" "$BIN_LINK"

cat > "$DESKTOP_FILE" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Flou Player
GenericName=Music Player
Comment=Browse and play your MinimServer library on Linn/OpenHome devices
Exec="$APP_DIR/flou-player"
Icon=$ICON
Terminal=false
Categories=AudioVideo;Audio;Player;
Keywords=music;upnp;minimserver;linn;openhome;
DESKTOP
chmod +x "$DESKTOP_FILE"
update-desktop-database "$DATA_HOME/applications" >/dev/null 2>&1 || true

echo
echo "Flou Player is installed -- find it in your application menu."
case ":$PATH:" in
  *":$HOME/.local/bin:"*) echo "(It can also be started with: flou-player)" ;;
  *) echo "(To also start it with 'flou-player' from a terminal, add ~/.local/bin to your PATH.)" ;;
esac
