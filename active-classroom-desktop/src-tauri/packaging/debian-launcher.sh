#!/bin/sh
# Keep the stable autostart/relaunch path and the original Debian bundle marker.
unset APPIMAGE APPDIR ARGV0
export APPIMAGE=/usr/bin/active-classroom
. /usr/lib/active-classroom/system-media.sh
classroom_system_media /usr/lib/active-classroom/codecs || exit "$?"
exec /usr/lib/active-classroom/active-classroom "$@"
