# Install a built Terminator (or Terminator Preview) without ever quitting or reopening it.
# The new copy is assembled outside /Applications (macOS blocks writing inside an installed app), then moved in whole
# once the app is not running. If it is running, this waits until you quit it yourself; then open it from the Dock.
set -e
cd "$(dirname "$0")/.."
NAME="${1:-Terminator}"
SRC="release/$NAME-darwin-arm64/$NAME.app"; DEST="/Applications/$NAME.app"; STAGE="Updates/staging-$NAME"
[ -d "$SRC" ] || { echo "Build $SRC first."; exit 1; }
rm -rf "$STAGE" && mkdir -p "$STAGE" && ditto "$SRC" "$STAGE/$NAME.app"
running(){ pgrep -f "/Applications/$NAME.app/Contents/MacOS/" >/dev/null; }
if running; then echo "Update ready. Quit $NAME when it suits you; it installs right after (waiting up to 8 h)."; fi
# Wait until it is closed; if it is reopened in the same moment, keep waiting for the next quit.
for i in $(seq 1 57600); do if ! running; then sleep 1; running || break; fi; sleep 0.5; done
running && { echo "Still running after 8 h; update left in $STAGE."; exit 1; }
TS=$(date +%Y%m%d-%H%M%S)
[ -d "$DEST" ] && mv "$DEST" "Updates/$NAME previous $TS.app"
mv "$STAGE/$NAME.app" "$DEST" && rm -rf "$STAGE"
# Keep only the newest previous copy (for rolling back); older ones are deleted.
ls -1d "Updates/$NAME previous "*.app 2>/dev/null | sort | sed '$d' | while IFS= read -r old; do rm -rf -- "$old"; done
echo "INSTALLED $DEST (previous version in Updates/$NAME previous $TS.app). Open it from the Dock or Finder."
