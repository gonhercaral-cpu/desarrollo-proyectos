#!/bin/sh
# Same application binary and preferences, with its packaged GTK/media runtime.
# Tauri's official autostart/relaunch helpers use APPIMAGE as the stable launch
# path. The executable's Debian bundle marker controls updater format separately.
unset APPIMAGE APPDIR ARGV0
export APPIMAGE=/usr/bin/active-classroom
exec /usr/lib/active-classroom/AppRun "$@"
