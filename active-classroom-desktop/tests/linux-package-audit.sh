#!/usr/bin/env bash
# Diagnostic only: verify the previously published bytes before changing packaging.
set -euo pipefail
deb="$1"
mode="$2"
. /etc/os-release
export DEBIAN_FRONTEND=noninteractive LC_ALL=C
apt-get update
dpkg-deb -I "$deb"
dpkg-deb -c "$deb"
apt-cache policy policykit-1 pkexec libsecret-tools
if [[ "$mode" == packagekit ]]; then
  apt-get install -y --no-install-recommends packagekit-tools dbus
  mkdir -p /run/dbus
  dbus-daemon --system --fork --nopidfile
  # Use the installed system D-Bus service. Starting a second daemon races
  # auto-activation and corrupts the diagnostic with a locked SQLite database.
  pkcon backend-details
  set +e
  timeout 240s pkcon --noninteractive --allow-untrusted install-local "$deb" 2>&1 | tee /tmp/installation.log
  status=${PIPESTATUS[0]}
  set -e
else
  set +e
  apt-get install -y --no-install-recommends "$deb" 2>&1 | tee /tmp/installation.log
  status=${PIPESTATUS[0]}
  set -e
fi
if [[ "$VERSION_ID" == 26.04 ]]; then
  test "$status" -ne 0
  grep -q 'policykit-1' /tmp/installation.log
  echo "PACKAGE_AUDIT os=$VERSION_ID mode=$mode obsolete_policykit_reproduced=true"
else
  test "$status" -eq 0
  dpkg-query -W -f='${Status}\n' active-classroom
  apt-get check
  ldd /usr/bin/active-classroom
  ! ldd /usr/bin/active-classroom | grep -q 'not found'
  echo "PACKAGE_AUDIT os=$VERSION_ID mode=$mode installed=true"
fi
