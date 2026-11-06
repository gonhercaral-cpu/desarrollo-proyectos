#!/usr/bin/env bash
set -euo pipefail
# The application title contains UTF-8. Xlib cannot decode WM_NAME in Docker's
# default ASCII locale, even when the actual window is visible and healthy.
export LANG=C.UTF-8 LC_ALL=C.UTF-8
if [[ "${1:-}" != --session ]]; then
  image="$1"
  useradd --create-home --shell /bin/bash classroom-image
  cp "$image" /tmp/classroom-test.AppImage
  chmod 755 /tmp/classroom-test.AppImage
  extract="$(mktemp -d)"
  (cd "$extract" && /tmp/classroom-test.AppImage --appimage-extract >/dev/null)
  media_smoke() {
  local root="$1" distribution="$2"
  . "$root/system-media.sh"
  classroom_system_media "$root/codecs"
  test -z "${LD_PRELOAD:-}"
  test -z "$(find "$root" -name 'libwebkit*.so*' -o -name 'libgtk-3.so*' -o -name 'libgstreamer-1.0.so*')"
  # Same system framework and optional OS-matched codec selection as the product.
  /fixtures/gst-launch -q filesrc location=/fixtures/h264-aac.mp4 ! qtdemux name=demux \
    demux.video_0 ! queue ! h264parse ! avdec_h264 ! fakesink \
    demux.audio_0 ! queue ! aacparse ! avdec_aac ! fakesink
  echo "PACKAGE_MEDIA distribution=$distribution framework=system h264=true aac=true"
  }
  media_smoke "$extract/squashfs-root/usr/lib/active-classroom" appimage
  grep -a -q '__TAURI_BUNDLE_TYPE_VAR_APP' "$extract/squashfs-root/usr/bin/active-classroom"
  media_smoke /usr/lib/active-classroom deb
  # No FUSE device exists in Docker. This is the official runtime fallback;
  # the unchanged production AppImage is still the executable under test.
  export CLASSROOM_CI_KEYRING_PASSWORD="$(head -c 32 /dev/urandom | base64)"
  for distribution in deb appimage; do
  for backend in x11 wayland; do
    runuser -u classroom-image -- env HOME=/home/classroom-image \
      CLASSROOM_CI_KEYRING_PASSWORD="$CLASSROOM_CI_KEYRING_PASSWORD" \
      xvfb-run -a -s '-screen 0 1920x1200x24' dbus-run-session -- \
      bash "$0" --session "$backend" "$distribution"
  done
  done
  exit 0
fi
backend="$2"
distribution="$3"
if [[ "$distribution" == deb ]]; then launcher=(/usr/bin/active-classroom);
else launcher=(/tmp/classroom-test.AppImage --appimage-extract-and-run); fi
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" XDG_CACHE_HOME="$HOME/.cache" XDG_STATE_HOME="$HOME/.local/state"
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
log="$XDG_CACHE_HOME/$distribution-$backend.log"
"${launcher[@]}" > "$log" 2>&1 &
first=$!
application_pids() {
  local process executable owner
  owner="$(id -u)"
  for process in /proc/[0-9]*; do
    [[ "$(stat -c '%u' "$process" 2>/dev/null || true)" == "$owner" ]] || continue
    executable="$(readlink "$process/exe" 2>/dev/null || true)"
    # AppRun may use a relative argv[0]; Linux also truncates comm to 15 bytes.
    # Identify the executable itself, without exposing identity/helper arguments.
    if [[ "${executable##*/}" == active-classroom ]]; then printf '%s\n' "${process##*/}"; fi
  done
}
cleanup() {
  result=$?
  if [[ "$result" -ne 0 ]]; then
    echo "PACKAGE_RUNTIME_FAILURE distribution=$distribution backend=$backend DISPLAY=${DISPLAY:-unset} GDK_BACKEND=${GDK_BACKEND:-unset}"
    tail -n 120 "$log" || true
    tail -n 80 "$XDG_CACHE_HOME/second-$backend.log" 2>/dev/null || true
    cat "$XDG_CACHE_HOME/windows.txt" 2>/dev/null || true
    ps -u "$(id -u)" -o pid,comm
    while read -r process; do
      # Only a public library path is selected. Helper output containing the
      # temporary CI credential is discarded; stderr diagnoses linker failures.
      library_path="$(tr '\0' '\n' < "/proc/$process/environ" | sed -n 's/^LD_LIBRARY_PATH=//p')"
      preload="$(tr '\0' '\n' < "/proc/$process/environ" | sed -n 's/^LD_PRELOAD=//p')"
      LD_LIBRARY_PATH="$library_path" LD_PRELOAD="$preload" /usr/bin/gdbus call --session --timeout 5 --dest org.freedesktop.secrets --object-path /org/freedesktop/secrets/aliases/default --method org.freedesktop.DBus.Properties.Get org.freedesktop.Secret.Collection Locked || true
      LD_LIBRARY_PATH="$library_path" LD_PRELOAD="$preload" /usr/bin/secret-tool search --all application com.activeclassroom.desktop credential device-v1 >/dev/null || true
    done < <(application_pids)
  fi
  while read -r process; do kill "$process" 2>/dev/null || true; done < <(application_pids)
  kill "$first" 2>/dev/null || true
  if [[ -n "${compositor:-}" ]]; then kill "$compositor" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'echo "APPIMAGE_FAILED_CHECK line=$LINENO status=$?"' ERR
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
timeout 20s "${launcher[@]}" > "$XDG_CACHE_HOME/second-$backend.log" 2>&1
echo "APPIMAGE_SECOND_EXIT backend=$backend success=true"
mapfile -t applications < <(application_pids)
echo "APPIMAGE_INSTANCE_COUNT backend=$backend count=${#applications[@]}"
test "${#applications[@]}" -eq 1
preload="$(tr '\0' '\n' < "/proc/${applications[0]}/environ" | sed -n 's/^LD_PRELOAD=//p')"
test -z "$preload"
grep -Eq '/(usr/)?lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so' "/proc/${applications[0]}/maps"
if [[ "$distribution" == deb ]]; then
  # Check only these public packaging values, never print arbitrary environment.
  tr '\0' '\n' < "/proc/${applications[0]}/environ" | grep -qx 'APPIMAGE=/usr/bin/active-classroom'
fi
# Native identity store: private regular files owned by this user, never printed.
# Same HOME across the four invocations, so the fingerprint must not change.
native_file() {
  local path="$1" mode="$2" attributes
  test -f "$path"
  test ! -L "$path"
  test -s "$path"
  attributes="$(stat -c '%F %a %u %h' "$path")"
  test "$attributes" = "regular file $mode $(id -u) 1"
}
native_directory() {
  local path="$1"
  test -d "$path"
  test ! -L "$path"
  test "$(stat -c '%a %u' "$path")" = "700 $(id -u)"
}
native_hash() {
  local value
  value="$(sha256sum "$1" | cut -d' ' -f1)" || return 1
  [[ "$value" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s' "$value"
}
state_directory="$XDG_STATE_HOME/active-classroom-identity"
key_directory="$XDG_CONFIG_HOME/active-classroom-identity"
cipher="$state_directory/vault-v1.enc"
marker="$state_directory/identity.json"
key="$key_directory/vault-v1.key"
native_directory "$state_directory"
native_directory "$key_directory"
native_file "$cipher" 600
native_file "$key" 600
native_file "$marker" 600
# Key: ACVK0001 + ready byte 1 + 32 random bytes. Cipher: ACIV0001 + IV/ciphertext.
test "$(stat -c '%s' "$key")" -eq 41
test "$(head -c 8 "$key")" = ACVK0001
test "$(od -An -tu1 -j8 -N1 "$key" | tr -d ' ')" = 1
test "$(stat -c '%s' "$cipher")" -ge 36
test "$(stat -c '%s' "$cipher")" -le 16384
test "$(head -c 8 "$cipher")" = ACIV0001
# Public marker: compact (whitespace-insensitive) known serde format, not printed.
grep -Eq '^\{"version":2,"deviceId":"[0-9a-f]{32}"(,"cacheDeviceId":"[0-9a-f]{32}")?,"collection":"/org/activeclassroom/identity/vault"\}$' < <(tr -d ' \t\r\n' < "$marker")
cipher_hash="$(native_hash "$cipher")" || exit 1
key_hash="$(native_hash "$key")" || exit 1
marker_hash="$(native_hash "$marker")" || exit 1
identity="$cipher_hash-$key_hash-$marker_hash"
test "${#identity}" -eq 194
if [[ -f "$XDG_CACHE_HOME/identity.sha256" ]]; then
  test "$(cat "$XDG_CACHE_HOME/identity.sha256")" = "$identity"
else
  printf '%s\n' "$identity" > "$XDG_CACHE_HOME/identity.sha256"
fi
if [[ "$backend" == wayland ]]; then test "$(grep -c '"wl_output"' "$log")" -ge 2; fi
echo "PACKAGE_RUNTIME distribution=$distribution backend=$backend actual_window=true single_instance=true identity_preserved=true offline=true"
