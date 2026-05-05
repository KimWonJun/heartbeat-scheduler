#!/bin/sh
set -eu

SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME_DIR="${RUNTIME_DIR:-$HOME/.cli-heartbeat-scheduler/app}"
PROJECT_DIR="$RUNTIME_DIR"
CONFIG_PATH="${CONFIG_PATH:-$PROJECT_DIR/config.5am-once.json}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
RUNNER="$PROJECT_DIR/scripts/run-once-macos.sh"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/.cli-heartbeat-scheduler/logs"

mkdir -p "$LAUNCH_AGENTS" "$LOG_DIR"
rm -rf "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR"
cp -R "$SOURCE_DIR/src" "$RUNTIME_DIR/src"
cp -R "$SOURCE_DIR/scripts" "$RUNTIME_DIR/scripts"
cp "$SOURCE_DIR/package.json" "$RUNTIME_DIR/package.json"
cp "$SOURCE_DIR/config.5am-once.json" "$RUNTIME_DIR/config.5am-once.json"
chmod +x "$RUNNER"

install_job() {
  JOB_ID="$1"
  LABEL="$2"
  PLIST_PATH="$LAUNCH_AGENTS/$LABEL.plist"

  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$RUNNER</string>
    <string>$PROJECT_DIR</string>
    <string>$CONFIG_PATH</string>
    <string>$JOB_ID</string>
    <string>$LABEL</string>
    <string>$PLIST_PATH</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_BIN</key>
    <string>$NODE_BIN</string>
    <key>PATH</key>
    <string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.nvm/versions/node/v24.13.0/bin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>5</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/$JOB_ID.launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/$JOB_ID.launchd.err.log</string>
</dict>
</plist>
EOF

  launchctl bootout "gui/$(id -u)" "$PLIST_PATH" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  echo "installed $LABEL -> $PLIST_PATH"
}

install_job "claude-5am-once" "com.local.cli-heartbeat-scheduler.claude-5am-once"
install_job "codex-5am-once" "com.local.cli-heartbeat-scheduler.codex-5am-once"

echo "scheduled one-shot jobs for the next 05:00 local time"
