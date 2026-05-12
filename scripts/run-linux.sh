#!/bin/sh
set -eu

PROJECT_DIR="$1"
CONFIG_PATH="$2"
JOB_ID="$3"
UNIT_NAME="$4"
SERVICE_PATH="$5"
TIMER_PATH="$6"
SYSTEMD_USER_DIR="$7"
MODE="${8:-persistent}"
NODE_BIN="${NODE_BIN:-node}"

cd "$PROJECT_DIR"
set +e
"$NODE_BIN" src/index.js run --job "$JOB_ID" --config "$CONFIG_PATH"
STATUS=$?
set -e

if [ "$MODE" = "once" ]; then
  systemctl --user disable --now "${UNIT_NAME}.timer" >/dev/null 2>&1 || true
  rm -f "$TIMER_PATH" "$SERVICE_PATH"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi

exit "$STATUS"
