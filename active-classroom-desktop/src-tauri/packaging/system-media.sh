#!/bin/sh
# Native GTK/WebKit/GStreamer stay together. Optional codecs are built by the
# same Ubuntu release, never a second copy of the application framework.
classroom_system_media() {
  classroom_codecs="$1"
  classroom_plugins="${2:-/usr/lib/x86_64-linux-gnu/gstreamer-1.0}"
  classroom_os="${3:-/etc/os-release}"
  unset LD_LIBRARY_PATH LD_PRELOAD GTK_PATH GI_TYPELIB_PATH GIO_MODULE_DIR GIO_EXTRA_MODULES
  unset GST_PLUGIN_PATH GST_PLUGIN_PATH_1_0 GST_PLUGIN_SYSTEM_PATH GST_PLUGIN_SYSTEM_PATH_1_0
  unset GST_PLUGIN_SCANNER GST_PLUGIN_SCANNER_1_0 GST_REGISTRY GST_REGISTRY_1_0
  unset WEBKIT_EXEC_PATH WEBKIT_INJECTED_BUNDLE_PATH GDK_PIXBUF_MODULE_FILE GDK_PIXBUF_MODULEDIR
  if [ -n "${WAYLAND_DISPLAY:-}" ] && [ "${XDG_SESSION_TYPE:-}" = wayland ]; then
    export GDK_BACKEND=wayland
  fi
  classroom_native=yes
  for classroom_plugin in libgstlibav.so libgstvideoparsersbad.so libgstplayback.so libgstisomp4.so libgstopengl.so libgstapp.so; do
    if [ ! -f "$classroom_plugins/$classroom_plugin" ]; then classroom_native=no; fi
  done
  if [ "$classroom_native" = yes ]; then return 0; fi
  classroom_release="$(
    . "$classroom_os"
    case "${UBUNTU_CODENAME:-}" in
      jammy) echo 22.04 ;; noble) echo 24.04 ;; resolute) echo 26.04 ;;
      *) if [ "${ID:-}" = ubuntu ]; then echo "${VERSION_ID:-}"; fi ;;
    esac
  )"
  case "$classroom_release" in 22.04|24.04|26.04) ;; *) echo 'Active Classroom: componentes multimedia del sistema no disponibles.' >&2; return 78 ;; esac
  classroom_codecs="$classroom_codecs/$classroom_release"
  if [ ! -r "$classroom_codecs/gstreamer-version" ]; then return 78; fi
  classroom_required="$(cut -d. -f1,2 "$classroom_codecs/gstreamer-version")"
  classroom_installed="$(dpkg-query -W -f='${Version}' libgstreamer1.0-0 2>/dev/null)"
  classroom_installed="${classroom_installed#*:}"
  classroom_installed="$(printf '%s' "$classroom_installed" | cut -d. -f1,2)"
  if [ "$classroom_required" != "$classroom_installed" ]; then
    echo 'Active Classroom: codecs incompatibles con la versión del sistema.' >&2
    return 78
  fi
  # Prefer every host DSO. Private codecs supply only libraries absent from the
  # original installation; core GLib/GTK/WebKit/GStreamer are never distributed.
  export LD_LIBRARY_PATH="/usr/lib/x86_64-linux-gnu:/lib/x86_64-linux-gnu:$classroom_codecs/lib"
  classroom_extra_plugins=""
  for classroom_plugin in "$classroom_codecs"/plugins/*/*.so; do
    [ -f "$classroom_plugin" ] || continue
    if [ ! -f "$classroom_plugins/${classroom_plugin##*/}" ]; then
      classroom_extra_plugins="${classroom_extra_plugins:+$classroom_extra_plugins:}${classroom_plugin%/*}"
    fi
  done
  export GST_PLUGIN_PATH_1_0="$classroom_extra_plugins"
  export GST_REGISTRY_1_0="${XDG_CACHE_HOME:-$HOME/.cache}/active-classroom/native-gstreamer-$classroom_release.bin"
  mkdir -p "$(dirname "$GST_REGISTRY_1_0")"
}
