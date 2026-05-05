#!/bin/sh
set -eu

LAUNCH_AGENTS="$HOME/Library/LaunchAgents"

for LABEL in \
  com.local.cli-heartbeat-scheduler.claude-910am-test-once \
  com.local.cli-heartbeat-scheduler.codex-910am-test-once
do
  PLIST_PATH="$LAUNCH_AGENTS/$LABEL.plist"
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  rm -f "$PLIST_PATH"
  echo "removed $LABEL"
done
