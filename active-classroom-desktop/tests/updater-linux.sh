#!/usr/bin/env bash
set -euo pipefail
# Isolated homes and unlocked Secret Service; no host/user classroom data.
export XDG_DATA_HOME="$(mktemp -d)"
export XDG_CONFIG_HOME="$(mktemp -d)"
export GDK_BACKEND=x11 WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
export CI=true
xvfb-run -a dbus-run-session -- bash -euo pipefail -c '
  openssl rand -hex 32 | gnome-keyring-daemon --unlock --components=secrets
  node tests/updater-linux.mjs
'
