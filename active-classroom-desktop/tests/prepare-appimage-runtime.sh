#!/usr/bin/env bash
set -euo pipefail
image="$(realpath "$1")"
appdir="$(dirname "$image")/Active Classroom.AppDir"
test -d "$appdir"
mkdir -p "$appdir/apprun-hooks"
# Tauri's AppImage bundler copies only data/usr into AppDir. Keep custom files
# under usr in DebConfig-compatible mappings, then place runtime hooks at the
# actual AppRun hook location before final AppImage packaging/signing.
for hook in system-glib appimage-wayland; do
  case "$hook" in
    system-glib) name=zz-active-classroom-system-glib.sh ;;
    appimage-wayland) name=zz-active-classroom-wayland.sh ;;
  esac
  cp "src-tauri/packaging/$hook.sh" "$appdir/usr/lib/active-classroom/packaging/$hook.sh"
  cp "$appdir/usr/lib/active-classroom/packaging/$hook.sh" "$appdir/apprun-hooks/$name"
done
node scripts/patch-apprun.mjs "$appdir/AppRun"
bash tests/prune-media-runtime.sh "$appdir"
bash tests/build-coreelements.sh "$appdir"
# Separate the packaged registry from host codecs and earlier package versions.
cat >> "$appdir/apprun-hooks/linuxdeploy-plugin-gstreamer.sh" <<'EOF'

export GST_REGISTRY_1_0="${XDG_CACHE_HOME:-$HOME/.cache}/active-classroom/packaged-gstreamer.bin"
mkdir -p "$(dirname "$GST_REGISTRY_1_0")"
EOF
tool="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/linuxdeploy-plugin-appimage.AppImage"
test -x "$tool"
output="$(mktemp -d)/normalized.AppImage"
# Reuse Tauri's already downloaded official output plugin; no separate runtime,
# update server, signing key or Linux deployment infrastructure is introduced.
ARCH=x86_64 LDAI_OUTPUT="$output" APPIMAGE_EXTRACT_AND_RUN=1 \
  "$tool" --appimage-extract-and-run --appdir "$appdir"
test -s "$output"
mv "$output" "$image"
