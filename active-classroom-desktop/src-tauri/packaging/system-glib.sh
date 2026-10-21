#!/bin/sh
# Keep the host GLib/Secret Service ABI for absolute /usr/bin/gdbus and
# /usr/bin/secret-tool calls. GTK/WebKit/GStreamer remain packaged. Loading
# Ubuntu 22.04's private GLib into Ubuntu 24.04's GDBus breaks newer symbols.
classroom_system_libraries=""
classroom_system_roots=""
for classroom_library in glib-2.0 gobject-2.0 gio-2.0 gmodule-2.0 gthread-2.0 secret-1; do
  classroom_library_path="/usr/lib/x86_64-linux-gnu/lib$classroom_library.so.0"
  if [ -r "$classroom_library_path" ]; then
    classroom_system_roots="$classroom_system_roots $classroom_library_path"
    case ":${LD_PRELOAD:-}:" in
      *":$classroom_library_path:"*) ;;
      *) classroom_system_libraries="${classroom_system_libraries:+$classroom_system_libraries:}$classroom_library_path" ;;
    esac
  fi
done
# GLib's host dependencies must also stay together: newer GIO requires newer
# libmount/PCRE/etc. All roots are fixed, trusted system libraries, never files
# from user content. Clear bundle overrides while querying the system loader.
classroom_system_dependencies="$(LD_LIBRARY_PATH= LD_PRELOAD= /usr/bin/ldd $classroom_system_roots 2>/dev/null | awk '/=> \// { print $3 }' | sort -u)"
for classroom_library_path in $classroom_system_dependencies; do
  case "$classroom_library_path" in
    */libc.so.*|*/libm.so.*|*/libdl.so.*|*/libpthread.so.*|*/librt.so.*|*/ld-linux*) continue ;;
  esac
  case ":${LD_PRELOAD:-}:" in
    *":$classroom_library_path:"*) ;;
    *) classroom_system_libraries="${classroom_system_libraries:+$classroom_system_libraries:}$classroom_library_path" ;;
  esac
done
if [ -n "$classroom_system_libraries" ]; then
  export LD_PRELOAD="$classroom_system_libraries${LD_PRELOAD:+:$LD_PRELOAD}"
fi
unset classroom_library classroom_library_path classroom_system_libraries classroom_system_roots classroom_system_dependencies
