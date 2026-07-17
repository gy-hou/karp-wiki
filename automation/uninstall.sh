#!/usr/bin/env bash
set -euo pipefail

AGENT="${1:-}"
case "$AGENT" in
  codex|claude) ;;
  *) echo "usage: uninstall.sh <codex|claude>" >&2; exit 2 ;;
esac

DEST="$HOME/Library/LaunchAgents/com.karp-wiki.autoingest.$AGENT.plist"
launchctl unload "$DEST" 2>/dev/null || true
rm -f "$DEST"
echo "uninstalled: $DEST"
