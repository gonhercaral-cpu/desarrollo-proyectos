#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" != --session ]]; then
  image="$1"
  useradd --create-home --shell /bin/bash classroom-image
  cp "$image" /tmp/classroom-test.AppImage
  chmod 755 /tmp/classroom-test.AppImage
  extract="$(mktemp -d)"
  (cd "$extract" && /tmp/classroom-test.AppImage --appimage-extract >/dev/null)
  appdir="$extract/squashfs-root"
  test -s "$(find "$appdir" -name 'libwebkit2gtk-4.1.so*' -print -quit)"
  test -s "$(find "$appdir" -name 'libgtk-3.so*' -print -quit)"
  plugins="$(dirname "$(find "$appdir" -name libgstlibav.so -print -quit)")"
  test -s "$plugins/libgstlibav.so"
  test -s "$plugins/libgstisomp4.so"
  test -s "$plugins/libgstvideoparsersbad.so"
  scanner="$(find "$appdir" -name gst-plugin-scanner -print -quit)"
  test -x "$scanner"
  # SDK-matched gst-launch from the Ubuntu 22.04 builder. Only plugins/libraries
  # from this AppImage are allowed; host codecs cannot hide a broken bundle.
  GST_PLUGIN_SYSTEM_PATH_1_0="$plugins" GST_PLUGIN_PATH_1_0="$plugins" \
    GST_PLUGIN_SCANNER_1_0="$scanner" GST_REGISTRY=/tmp/classroom-bundled-gst.bin \
    LD_LIBRARY_PATH="$appdir/usr/lib:$appdir/usr/lib/x86_64-linux-gnu" \
    /fixtures/gst-launch -q filesrc location=/fixtures/h264-aac.mp4 ! qtdemux name=demux \
    demux.video_0 ! queue ! h264parse ! avdec_h264 ! fakesink \
    demux.audio_0 ! queue ! aacparse ! avdec_aac ! fakesink
  echo 'APPIMAGE_MEDIA bundled_plugins_only=true h264=true aac=true'
  # No FUSE device exists in Docker. This is the official runtime fallback;
  # the unchanged production AppImage is still the executable under test.
  export CLASSROOM_CI_KEYRING_PASSWORD="$(head -c 32 /dev/urandom | base64)"
  for backend in x11 wayland; do
    runuser -u classroom-image -- env HOME=/home/classroom-image \
      CLASSROOM_CI_KEYRING_PASSWORD="$CLASSROOM_CI_KEYRING_PASSWORD" \
      xvfb-run -a -s '-screen 0 1920x1200x24' dbus-run-session -- \
      bash "$0" --session "$backend"
  done
  exit 0
fi
backend="$2"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" XDG_CACHE_HOME="$HOME/.cache"
export XDG_RUNTIME_DIR="$(mktemp -d)"
chmod 700 "$XDG_RUNTIME_DIR"
mkdir -p "$XDG_CACHE_HOME"
export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export GDK_BACKEND="$backend" XDG_SESSION_TYPE="$backend"
printf '%s\n' "$CLASSROOM_CI_KEYRING_PASSWORD" | gnome-keyring-daemon --unlock --components=secrets
if [[ "$backend" == wayland ]]; then
  weston --backend=x11-backend.so --use-pixman --output-count=2 --width=1366 --height=768 \
    --socket=wayland-package --idle-time=0 --no-config --log="$XDG_RUNTIME_DIR/weston.log" &
  compositor=$!
  for attempt in $(seq 1 100); do test -S "$XDG_RUNTIME_DIR/wayland-package" && break; sleep .1; done
  test -S "$XDG_RUNTIME_DIR/wayland-package"
  export WAYLAND_DISPLAY=wayland-package WAYLAND_DEBUG=1
fi
log="$XDG_CACHE_HOME/appimage-$backend.log"
/tmp/classroom-test.AppImage --appimage-extract-and-run > "$log" 2>&1 &
first=$!
cleanup() {
  result=$?
  if [[ "$result" -ne 0 ]]; then
    echo "APPIMAGE_FAILURE backend=$backend DISPLAY=${DISPLAY:-unset} GDK_BACKEND=${GDK_BACKEND:-unset}"
    tail -n 120 "$log" || true
    cat "$XDG_CACHE_HOME/windows.txt" 2>/dev/null || true
    ps -u "$(id -u)" -o pid,comm
  fi
  pkill -u "$(id -u)" -f '/usr/bin/active-classroom( |$)' 2>/dev/null || true
  kill "$first" 2>/dev/null || true
  if [[ -n "${compositor:-}" ]]; then kill "$compositor" 2>/dev/null || true; fi
}
trap cleanup EXIT
ready=false
for attempt in $(seq 1 120); do
  if ! kill -0 "$first" 2>/dev/null; then cat "$log"; exit 1; fi
  if [[ "$backend" == x11 ]]; then
    xwininfo -root -tree > "$XDG_CACHE_HOME/windows.txt"
    if grep -q 'Active Classroom' "$XDG_CACHE_HOME/windows.txt"; then ready=true; break; fi
  elif grep -q 'set_title("Active Classroom' "$log"; then ready=true; break; fi
  sleep .2
done
test "$ready" = true
sleep 10
kill -0 "$first"
! grep -Eq 'symbol lookup error|GLIBC_[0-9.]+.*not found|error while loading shared libraries' "$log"
timeout 20s /tmp/classroom-test.AppImage --appimage-extract-and-run > "$XDG_CACHE_HOME/second-$backend.log" 2>&1
mapfile -t applications < <(pgrep -u "$(id -u)" -f '/usr/bin/active-classroom( |$)')
test "${#applications[@]}" -eq 1
identity="$(secret-tool lookup application com.activeclassroom.desktop credential device-v1 | sha256sum | cut -d' ' -f1)"
if [[ -f "$XDG_CACHE_HOME/identity.sha256" ]]; then
  test "$(cat "$XDG_CACHE_HOME/identity.sha256")" = "$identity"
else
  printf '%s\n' "$identity" > "$XDG_CACHE_HOME/identity.sha256"
fi
if [[ "$backend" == wayland ]]; then test "$(grep -c '"wl_output"' "$log")" -ge 2; fi
echo "APPIMAGE_SMOKE backend=$backend actual_window=true single_instance=true identity_preserved=true offline=true"
