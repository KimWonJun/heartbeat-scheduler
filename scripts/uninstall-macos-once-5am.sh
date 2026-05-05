#!/bin/sh
set -eu

LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
RUNTIME_DIR="$HOME/.cli-heartbeat-scheduler/app"

for LABEL in \
  com.local.cli-heartbeat-scheduler.claude-5am-once \
  com.local.cli-heartbeat-scheduler.codex-5am-once
do
  PLIST_PATH="$LAUNCH_AGENTS/$LABEL.plist"
  launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
  rm -f "$PLIST_PATH"
  echo "removed $LABEL"
done

rm -rf "$RUNTIME_DIR"
echo "removed $RUNTIME_DIR"
