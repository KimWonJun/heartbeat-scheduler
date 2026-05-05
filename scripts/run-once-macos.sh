#!/bin/sh
set -eu

PROJECT_DIR="$1"
CONFIG_PATH="$2"
JOB_ID="$3"
LABEL="$4"
PLIST_PATH="$5"
NODE_BIN="${NODE_BIN:-node}"

cd "$PROJECT_DIR"
set +e
"$NODE_BIN" src/index.js run --job "$JOB_ID" --config "$CONFIG_PATH"
STATUS=$?
set -e

rm -f "$PLIST_PATH"
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true

exit "$STATUS"
