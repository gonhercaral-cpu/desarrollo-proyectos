#!/usr/bin/env bash
set -euo pipefail
old="$1"
next="$2"
version="$3"
. /etc/os-release
export DEBIAN_FRONTEND=noninteractive LC_ALL=C
apt-get update
apt-get install -y "$old"
test "$(dpkg-query -W -f='${Version}' active-classroom)" = 1.0.12
mkdir -p /home/classroom-upgrade/.config/com.activeclassroom.desktop \
  /home/classroom-upgrade/.local/share/com.activeclassroom.desktop/offline-v1
echo settings > /home/classroom-upgrade/.config/com.activeclassroom.desktop/preserved
echo offline-cache > /home/classroom-upgrade/.local/share/com.activeclassroom.desktop/offline-v1/preserved
# The official updater uses dpkg, not apt. No dependency workaround is allowed
# here: new mandatory dependencies must already resolve for existing installs.
dpkg -i "$next"
apt-get check
test -z "$(dpkg --audit)"
test "$(dpkg-query -W -f='${Version}' active-classroom)" = "$version"
/lib64/ld-linux-x86-64.so.2 --list /usr/lib/active-classroom/active-classroom
. /usr/lib/active-classroom/system-media.sh
classroom_system_media /usr/lib/active-classroom/codecs
# The old updater's dpkg-only installation needs no new mandatory codec packages.
test -s "$(find /usr/lib/active-classroom/codecs/"$VERSION_ID" -name libgstlibav.so -print -quit)"
grep -qx settings /home/classroom-upgrade/.config/com.activeclassroom.desktop/preserved
grep -qx offline-cache /home/classroom-upgrade/.local/share/com.activeclassroom.desktop/offline-v1/preserved
echo "PACKAGE_UPGRADE os=$VERSION_ID from=1.0.12 to=$version official_dpkg_flow=true settings_preserved=true cache_preserved=true"
