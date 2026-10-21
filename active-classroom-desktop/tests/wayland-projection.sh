#!/usr/bin/env bash
set -euo pipefail

cargo build --locked --manifest-path src-tauri/Cargo.toml --example wayland_projection
export XDG_RUNTIME_DIR="$(mktemp -d)"
chmod 700 "$XDG_RUNTIME_DIR"
# Weston is a Wayland compositor. Xvfb hosts its two virtual X11 outputs only;
# the Tauri client must connect through GDK Wayland, never X11/XWayland.
xvfb-run -a dbus-run-session -- bash -euo pipefail -c '
  weston --backend=x11-backend.so --use-pixman --output-count=2 --width=800 --height=600 \
    --socket=wayland-projection --idle-time=0 --no-config --log="$XDG_RUNTIME_DIR/weston.log" &
  compositor=$!
  trap '\''kill "$compositor" 2>/dev/null || true; cat "$XDG_RUNTIME_DIR/weston.log"'\'' EXIT
  for attempt in $(seq 1 100); do
    test -S "$XDG_RUNTIME_DIR/wayland-projection" && break
    kill -0 "$compositor"
    sleep 0.1
  done
  test -S "$XDG_RUNTIME_DIR/wayland-projection"
  export WAYLAND_DISPLAY=wayland-projection GDK_BACKEND=wayland XDG_SESSION_TYPE=wayland
  timeout 35s src-tauri/target/debug/examples/wayland_projection
'
