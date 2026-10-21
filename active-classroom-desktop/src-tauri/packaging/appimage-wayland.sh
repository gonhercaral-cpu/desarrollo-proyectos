#!/usr/bin/env sh
# Packaging hook only. Preserve native Wayland when launcher defaults change.
# CI validates the bundled GTK/WebKit stack on both backends.
if [ -n "${WAYLAND_DISPLAY:-}" ] && [ "${XDG_SESSION_TYPE:-}" = wayland ]; then
  export GDK_BACKEND=wayland
fi
