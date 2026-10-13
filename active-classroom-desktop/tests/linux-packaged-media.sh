#!/usr/bin/env bash
set -euo pipefail
image="$(realpath "$1")"
distribution="$2"
backend="$3"
directory="$(mktemp -d)"
export XDG_CACHE_HOME="$directory/cache" XDG_CONFIG_HOME="$directory/config" XDG_DATA_HOME="$directory/data"
mkdir -p "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME"
if [[ "$distribution" == deb ]]; then
  cp -a /usr/lib/active-classroom "$directory/runtime"
else
  (cd "$directory" && "$image" --appimage-extract >/dev/null)
  mv "$directory/squashfs-root" "$directory/runtime"
fi
# Same production libraries/hooks/plugins, same production Rust server and TS
# renderers. Replace only the entrypoint to exercise local media without auth.
cp /fixtures/media_playback "$directory/runtime/usr/bin/active-classroom"
chmod 755 "$directory/runtime/usr/bin/active-classroom"
export CLASSROOM_TEST_RUNTIME="$directory/runtime/AppRun"
export CLASSROOM_TEST_BACKEND="$backend"
export ACTIVE_CLASSROOM_MEDIA_FIXTURE=/fixtures/h264-aac.mp4 ACTIVE_CLASSROOM_MEDIA_SCRIPT=/fixtures/media.js
# CI-only: nested sandbox namespaces and a hardware GPU are unavailable.
export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
xvfb-run -a -s '-screen 0 1920x1200x24' dbus-run-session -- bash -euo pipefail <<'EOF'
export XDG_RUNTIME_DIR="$(mktemp -d)"
chmod 700 "$XDG_RUNTIME_DIR"
compositor=""
cleanup() { if [[ -n "$compositor" ]]; then kill "$compositor" 2>/dev/null || true; fi; }
trap cleanup EXIT
if [[ "$CLASSROOM_TEST_BACKEND" == wayland ]]; then
  weston --backend=x11-backend.so --socket=classroom-media-wayland --output-count=2 --width=1920 --height=1080 --use-pixman > "$XDG_CACHE_HOME/weston.log" 2>&1 &
  compositor=$!
  for attempt in $(seq 1 100); do [[ -S "$XDG_RUNTIME_DIR/classroom-media-wayland" ]] && break; sleep .1; done
  test -S "$XDG_RUNTIME_DIR/classroom-media-wayland"
  export WAYLAND_DISPLAY=classroom-media-wayland XDG_SESSION_TYPE=wayland GDK_BACKEND=wayland
else
  export GDK_BACKEND=x11
fi
timeout 300s "$CLASSROOM_TEST_RUNTIME" </dev/null
EOF
echo "PACKAGED_MEDIA distribution=$distribution backend=$backend actual_h264_aac=true bounded_memory=true offline=true"
