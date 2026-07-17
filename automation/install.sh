#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: install.sh <codex|claude>" >&2
  exit 2
}

AGENT="${1:-}"
case "$AGENT" in
  codex|claude) ;;
  *) usage ;;
esac

REPO="$(git rev-parse --show-toplevel)"
NODE_BIN="$(dirname "$(command -v node)")"
AGENT_BIN="$(dirname "$(command -v "$AGENT")")"
BIN_PATH="$NODE_BIN:$AGENT_BIN:/usr/bin:/bin"
SRC="$REPO/automation/com.karp-wiki.autoingest.$AGENT.plist"
DEST="$HOME/Library/LaunchAgents/com.karp-wiki.autoingest.$AGENT.plist"

escape_sed() {
  sed 's/[\\&|]/\\&/g'
}

mkdir -p "$(dirname "$DEST")"
sed \
  -e "s|__REPO__|$(printf '%s' "$REPO" | escape_sed)|g" \
  -e "s|__PATH__|$(printf '%s' "$BIN_PATH" | escape_sed)|g" \
  "$SRC" > "$DEST"
plutil -lint "$DEST" >/dev/null
launchctl unload "$DEST" 2>/dev/null || true
launchctl load "$DEST"
echo "installed + loaded: $DEST"
