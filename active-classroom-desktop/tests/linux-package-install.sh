#!/usr/bin/env bash
# Each invocation runs in a fresh Ubuntu container, with no classroom user data.
set -euo pipefail
deb="$1"
mode="$2"
version="$3"
. /etc/os-release
export DEBIAN_FRONTEND=noninteractive LC_ALL=C
apt-get update
apt-get install -y --no-install-recommends file binutils desktop-file-utils
control="$(mktemp -d)"
dpkg-deb --control "$deb" "$control"
dpkg-deb -I "$deb"
dpkg-deb -c "$deb"
test "$(dpkg-deb -f "$deb" Package)" = active-classroom
test "$(dpkg-deb -f "$deb" Architecture)" = amd64
test "$(dpkg-deb -f "$deb" Version)" = "$version"
dpkg-deb -f "$deb" Maintainer | grep -Eq '^.+ <[^<>[:space:]]+@[^<>[:space:]]+>$'
test "$(file --brief --mime-type "$deb")" = application/vnd.debian.binary-package
! dpkg-deb -f "$deb" Depends | grep -q 'policykit-1'
dpkg-deb -f "$deb" Depends | grep -q 'pkexec'
for script in preinst postinst prerm postrm; do
  test ! -f "$control/$script" # No interactive or destructive maintainer scripts.
done
if [[ "$mode" == gdebi ]]; then
  apt-get install -y --no-install-recommends gdebi-core
  timeout 300s gdebi --non-interactive "$deb"
else
  # Use the exact recommended user flow; codecs are part of the package,
  # including for graphical installers which do not install Recommends.
  apt-get install -y "$deb"
fi
test "$(dpkg-query -W -f='${Status}' active-classroom)" = 'install ok installed'
apt-get check
test -z "$(dpkg --audit)"
test -x /usr/bin/active-classroom
test "$(stat -c '%a:%U:%G' /usr/bin/active-classroom)" = '755:root:root'
desktop='/usr/share/applications/Active Classroom.desktop'
desktop-file-validate "$desktop"
grep -qx 'Terminal=false' "$desktop"
grep -qx 'Exec=active-classroom' "$desktop"
grep -qx 'Icon=active-classroom' "$desktop"
grep -qx 'Categories=Education;' "$desktop"
test -s /usr/share/icons/hicolor/512x512/apps/active-classroom.png
test "$(file --brief --mime-type /usr/share/icons/hicolor/512x512/apps/active-classroom.png)" = image/png
binary=/usr/lib/active-classroom/active-classroom
test -x "$binary"
test "$(stat -c '%a:%U:%G' "$binary")" = '755:root:root'
grep -a -q '__TAURI_BUNDLE_TYPE_VAR_DEB' "$binary"
grep -qx 'exec /usr/lib/active-classroom/active-classroom "$@"' /usr/bin/active-classroom
test -z "$(find /usr/lib/active-classroom -name 'libwebkit*.so*' -o -name 'libgtk-3.so*' -o -name 'libgstreamer-1.0.so*')"
ldd "$binary" | tee /tmp/classroom-ldd.txt
! grep -q 'not found' /tmp/classroom-ldd.txt
# Loader smoke: resolves every DSO and symbol version without entering app main,
# creating a device or sending a request to the production backend.
/lib64/ld-linux-x86-64.so.2 --list "$binary"
readelf --version-info "$binary" > /tmp/classroom-abi.txt
glibc="$(grep -oE 'GLIBC_[0-9]+(\.[0-9]+)+' /tmp/classroom-abi.txt | sort -Vu | tail -1 | cut -d_ -f2)"
glibcxx="$( (grep -oE 'GLIBCXX_[0-9]+(\.[0-9]+)+' /tmp/classroom-abi.txt || true) | sort -Vu | tail -1 | cut -d_ -f2)"
dpkg --compare-versions "$glibc" le 2.35
if [[ -n "$glibcxx" ]]; then dpkg --compare-versions "$glibcxx" le 3.4.30; fi
for command in secret-tool gdbus pkexec; do test -x "/usr/bin/$command"; done
. /usr/lib/active-classroom/system-media.sh
classroom_system_media /usr/lib/active-classroom/codecs
for plugin in libgstplayback.so libgstisomp4.so libgstvideoparsersbad.so libgstlibav.so libgstopengl.so; do
  path="$(find /usr/lib/active-classroom/codecs/"$VERSION_ID" -name "$plugin" -print -quit)"
  test -s "$path"
  ldd "$path" > /tmp/classroom-codec-ldd.txt
  ! grep -q 'not found' /tmp/classroom-codec-ldd.txt
done
mkdir -p /home/classroom-ci/.config/com.activeclassroom.desktop
echo 'activation-and-settings-sentinel' > /home/classroom-ci/.config/com.activeclassroom.desktop/preserved
dpkg -r active-classroom
test ! -e /usr/bin/active-classroom
test ! -e "$binary"
test ! -e "$desktop"
test ! -e /usr/share/icons/hicolor/512x512/apps/active-classroom.png
# Dpkg installation on a base whose declared dependencies have been resolved.
dpkg -i "$deb"
apt-get check
test -z "$(dpkg --audit)"
dpkg -r active-classroom
grep -qx 'activation-and-settings-sentinel' /home/classroom-ci/.config/com.activeclassroom.desktop/preserved
echo "PACKAGE_INSTALL os=$VERSION_ID installer=$mode version=$version apt_check=true dpkg=true loader=true launcher=true uninstall=true glibc=$glibc glibcxx=${glibcxx:-none}"
