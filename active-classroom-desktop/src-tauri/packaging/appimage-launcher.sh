#!/bin/sh
classroom_appdir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
. "$classroom_appdir/usr/lib/active-classroom/system-media.sh"
if ! classroom_system_media "$classroom_appdir/usr/lib/active-classroom/codecs"; then
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --title='Active Classroom' --text='Este sistema necesita componentes multimedia compatibles. Usa el instalador .deb de Active Classroom.'
  fi
  exit 78
fi
exec "$classroom_appdir/usr/bin/active-classroom" "$@"
