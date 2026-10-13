#!/bin/sh
# Keep the host GLib/Secret Service ABI for absolute /usr/bin/gdbus and
# /usr/bin/secret-tool calls. GTK/WebKit/GStreamer remain packaged. Loading
# Ubuntu 22.04's private GLib into Ubuntu 24.04's GDBus breaks newer symbols.
classroom_system_libraries=""
for classroom_library in glib-2.0 gobject-2.0 gio-2.0 gmodule-2.0 gthread-2.0 secret-1; do
  classroom_library_path="/usr/lib/x86_64-linux-gnu/lib$classroom_library.so.0"
  if [ -r "$classroom_library_path" ]; then
    case ":${LD_PRELOAD:-}:" in
      *":$classroom_library_path:"*) ;;
      *) classroom_system_libraries="${classroom_system_libraries:+$classroom_system_libraries:}$classroom_library_path" ;;
    esac
  fi
done
if [ -n "$classroom_system_libraries" ]; then
  export LD_PRELOAD="$classroom_system_libraries${LD_PRELOAD:+:$LD_PRELOAD}"
fi
unset classroom_library classroom_library_path classroom_system_libraries
