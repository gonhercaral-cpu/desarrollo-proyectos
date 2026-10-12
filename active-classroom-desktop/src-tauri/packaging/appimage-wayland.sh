#!/usr/bin/env sh
# Packaging hook only. linuxdeploy's GTK hook otherwise forces X11 even in a
# Wayland session. CI validates the bundled GTK/WebKit stack on both backends.
if [ -n "${WAYLAND_DISPLAY:-}" ] && [ "${XDG_SESSION_TYPE:-}" = wayland ]; then
  export GDK_BACKEND=wayland
fi
