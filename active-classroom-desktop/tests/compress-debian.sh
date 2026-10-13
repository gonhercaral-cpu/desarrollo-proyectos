#!/usr/bin/env bash
set -euo pipefail
mapfile -t packages < <(find src-tauri/target/release/bundle/deb -maxdepth 1 -name '*.deb' -type f)
test "${#packages[@]}" -eq 1
package="$(realpath "${packages[0]}")"
directory="$(mktemp -d)"
before="$(stat -c '%s' "$package")"
dpkg-deb --raw-extract "$package" "$directory/root"
# Ubuntu 22.04 supports XZ. Reduce the bundled runtime download without changing
# updater timeouts, dependencies, package content or maintainer scripts.
dpkg-deb --root-owner-group -Zxz -z9 --build "$directory/root" "$directory/compact.deb"
mv "$directory/compact.deb" "$package"
echo "DEBIAN_COMPRESSION format=xz before=$before after=$(stat -c '%s' "$package")"
