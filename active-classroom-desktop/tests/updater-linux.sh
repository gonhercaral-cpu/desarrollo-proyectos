#!/usr/bin/env bash
set -euo pipefail
# Isolated homes and unlocked Secret Service; no host/user classroom data.
export XDG_DATA_HOME="$(mktemp -d)"
export XDG_CONFIG_HOME="$(mktemp -d)"
export XDG_RUNTIME_DIR="$(mktemp -d)"
chmod 700 "$XDG_RUNTIME_DIR"
export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export CI=true
xvfb-run -a dbus-run-session -- bash -euo pipefail -c '
  weston --backend=x11-backend.so --use-pixman --output-count=2 --width=1366 --height=768 \
    --socket=wayland-startup --idle-time=0 --no-config --log="$XDG_RUNTIME_DIR/weston.log" &
  compositor=$!
  trap '\''kill "$compositor" 2>/dev/null || true; cat "$XDG_RUNTIME_DIR/weston.log"'\'' EXIT
  for attempt in $(seq 1 100); do
    test -S "$XDG_RUNTIME_DIR/wayland-startup" && break
    kill -0 "$compositor"
    sleep 0.1
  done
  test -S "$XDG_RUNTIME_DIR/wayland-startup"
  export WAYLAND_DISPLAY=wayland-startup GDK_BACKEND=wayland XDG_SESSION_TYPE=wayland
  openssl rand -hex 32 | gnome-keyring-daemon --unlock --components=secrets
  node tests/updater-linux.mjs
'
