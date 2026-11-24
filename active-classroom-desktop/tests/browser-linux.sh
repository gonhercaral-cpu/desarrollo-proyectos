#!/usr/bin/env bash
set -euo pipefail

# Test-only hosts entry; production navigation policy stays unchanged.
if ! getent hosts classroom-browser.test >/dev/null; then
  printf '127.0.0.1 classroom-browser.test\n' | sudo tee -a /etc/hosts >/dev/null
fi
cargo build --locked --manifest-path src-tauri/Cargo.toml --example browser_acceptance
# The installed launcher already applies this policy before starting WebKit.
export MALLOC_MMAP_THRESHOLD_="${MALLOC_MMAP_THRESHOLD_:-131072}"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT
export CLASSROOM_BROWSER_CLIP="$fixture_root/clip.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=320x180:rate=15 -f lavfi -i sine=frequency=440:sample_rate=44100 -t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart "$CLASSROOM_BROWSER_CLIP"
export XDG_CONFIG_HOME="$fixture_root/config" XDG_DATA_HOME="$fixture_root/data" XDG_CACHE_HOME="$fixture_root/cache"
mkdir -p "$XDG_CONFIG_HOME" "$fixture_root/downloads"
printf 'XDG_DOWNLOAD_DIR="%s/downloads"\n' "$fixture_root" > "$XDG_CONFIG_HOME/user-dirs.dirs"
for browser_scale in 1 2; do
  XDG_SESSION_TYPE=x11 GDK_BACKEND=x11 GDK_SCALE="$browser_scale" xvfb-run -a -s "-screen 0 3200x2400x24" dbus-run-session -- timeout 105s src-tauri/target/debug/examples/browser_acceptance
done

export XDG_RUNTIME_DIR="$fixture_root/runtime"
mkdir -m 700 "$XDG_RUNTIME_DIR"
for browser_scale in 1 2; do
export CLASSROOM_BROWSER_SCALE="$browser_scale"
xvfb-run -a -s "-screen 0 3200x2400x24" dbus-run-session -- bash -euo pipefail -c '
  weston --backend=x11-backend.so --use-pixman --output-count=2 --width=$((800*CLASSROOM_BROWSER_SCALE)) --height=$((600*CLASSROOM_BROWSER_SCALE)) \
    --socket=wayland-browser --idle-time=0 --no-config --log="$XDG_RUNTIME_DIR/weston.log" &
  compositor=$!
  trap '\''kill "$compositor" 2>/dev/null || true; cat "$XDG_RUNTIME_DIR/weston.log"'\'' EXIT
  for attempt in $(seq 1 100); do
    test -S "$XDG_RUNTIME_DIR/wayland-browser" && break
    kill -0 "$compositor"
    sleep 0.1
  done
  test -S "$XDG_RUNTIME_DIR/wayland-browser"
  # Keep both nested output windows unobscured for compositor pixel evidence.
  for output in 0 1; do
    for attempt in $(seq 1 100); do
      host_window=$(xdotool search --name "^Weston Compositor - screen${output}$" | head -1) && break
      sleep 0.1
    done
    test -n "$host_window"
    xdotool windowmove "$host_window" $((output*1600)) 0
  done
  export GDK_SCALE="$CLASSROOM_BROWSER_SCALE"
  export WAYLAND_DISPLAY=wayland-browser GDK_BACKEND=wayland XDG_SESSION_TYPE=wayland CLASSROOM_BROWSER_PROJECT=1
  timeout 105s src-tauri/target/debug/examples/browser_acceptance
'
done
test ! -e "$fixture_root/downloads/escape.bin"
printf 'BROWSER_LINUX_ACCEPTANCE_OK\n'
