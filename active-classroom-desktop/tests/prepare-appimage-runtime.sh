#!/usr/bin/env bash
set -euo pipefail
image="$(realpath "$1")"
codecs="$(realpath "$2")"
appdir="$(dirname "$image")/Active Classroom.AppDir"
test -d "$appdir"
# Preserve the official AppImage ELF marker, desktop integration and resources.
# Do not ship a second WebKit/GTK/GStreamer core or its library override hooks.
native="$(mktemp -d)/Active Classroom.AppDir"
mkdir -p "$native/usr/bin" "$native/usr/lib/active-classroom"
cp "$appdir/usr/bin/active-classroom" "$native/usr/bin/active-classroom"
cp -a "$appdir/usr/share" "$native/usr/share"
while IFS= read -r -d '' file; do cp -a "$file" "$native/"; done < <(find "$appdir" -maxdepth 1 \( -name '*.desktop' -o -name '*.png' -o -name '*.svg' -o -name '.DirIcon' \) -print0)
cp src-tauri/packaging/system-media.sh "$native/usr/lib/active-classroom/system-media.sh"
cp -a "$codecs" "$native/usr/lib/active-classroom/codecs"
cp src-tauri/packaging/appimage-launcher.sh "$native/AppRun"
chmod 755 "$native/AppRun" "$native/usr/bin/active-classroom"
test -z "$(find "$native" -name 'libwebkit*.so*' -o -name 'libgtk-3.so*' -o -name 'libgstreamer-1.0.so*')"
tool="${XDG_CACHE_HOME:-$HOME/.cache}/tauri/linuxdeploy-plugin-appimage.AppImage"
test -x "$tool"
output="$(mktemp -d)/normalized.AppImage"
# Reuse Tauri's already downloaded official output plugin; no separate runtime,
# update server, signing key or Linux deployment infrastructure is introduced.
ARCH=x86_64 LDAI_OUTPUT="$output" APPIMAGE_EXTRACT_AND_RUN=1 \
  "$tool" --appimage-extract-and-run --appdir "$native"
test -s "$output"
mv "$output" "$image"
