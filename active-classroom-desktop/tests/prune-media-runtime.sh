#!/usr/bin/env bash
set -euo pipefail
appdir="$(realpath "${1:?AppDir requerido}")"
plugins="$appdir/usr/lib/gstreamer-1.0"
test -d "$plugins"
# WebKitGTK 4.1 uses libsoup3 and its own HTTP media source. Ubuntu 22's
# The bundled WebRTC plugin pulls libsoup2 through libnice/GUPnP; scanning it
# inside WebKit aborts the process. No WebRTC is used by our offline projector.
# Reject every incompatible plugin dependency, including indirect dependencies.
while IFS= read -r -d '' plugin; do
  dependencies="$(LD_PRELOAD= LD_LIBRARY_PATH="$appdir/usr/lib" ldd "$plugin")"
  if grep -q 'libsoup-2.4' <<< "$dependencies"; then
    echo "MEDIA_RUNTIME_REMOVE $(basename "$plugin") incompatible libsoup2"
    rm -- "$plugin"
  fi
done < <(find "$plugins" -maxdepth 1 -type f -name '*.so' -print0)
# Media stays on the packaged codec/decoder ABI. Never mix host plugin registries.
for required in libgstplayback.so libgstisomp4.so libgstlibav.so libgstvideoparsersbad.so; do test -f "$plugins/$required"; done
