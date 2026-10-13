#!/usr/bin/env bash
set -euo pipefail
appdir="$(realpath "${1:?AppDir requerido}")"
work="${RUNNER_TEMP:-/tmp}/classroom-gstreamer-core-fd-zero"
source="$work/gstreamer-1.20.3"
plugin="$work/build/plugins/elements/libgstcoreelements.so"
mkdir -p "$work"
if [[ ! -f "$plugin" ]]; then
  curl --fail --location --retry 3 -o "$work/source.tar.xz" https://gstreamer.freedesktop.org/src/gstreamer/gstreamer-1.20.3.tar.xz
  echo "607daf64bbbd5fb18af9d17e21c0d22c4d702fffe83b23cb22d1b1af2ca23a2a  $work/source.tar.xz" | sha256sum --check
  tar -xf "$work/source.tar.xz" -C "$work"
  meson setup "$work/build" "$source" --buildtype=release --wrap-mode=nofallback \
    -Dtests=disabled -Dexamples=disabled -Dbenchmarks=disabled -Dtools=disabled -Dintrospection=disabled -Ddoc=disabled -Dlibunwind=disabled -Dlibdw=disabled -Dnls=disabled
  ninja -C "$work/build" gst/gstenumtypes.h
  # Prove the vendor bug before changing the sole invalid descriptor guard.
  # Vendor/generated headers + installed core SONAME avoid replacing the
  # runner's LLVM/libunwind dev packages. No additional runtime dependency.
  gcc -O2 -DHAVE_FSEEKO -I"$source" -I"$work/build" -I"$source/plugins/elements" tests/gstreamer-fd-zero.c "$source/plugins/elements/gstsparsefile.c" $(pkg-config --cflags --libs glib-2.0 gobject-2.0 gmodule-2.0) -l:libgstreamer-1.0.so.0 -o "$work/baseline"
  "$work/baseline" baseline
  python3 - "$source/plugins/elements/gstsparsefile.c" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1]); source = path.read_text()
old = 'g_return_val_if_fail (fd != 0, FALSE);'
assert source.count(old) == 1, 'Vendor guard changed; audit before packaging'
path.write_text(source.replace(old, 'g_return_val_if_fail (fd >= 0, FALSE);'))
PY
  gcc -O2 -DHAVE_FSEEKO -I"$source" -I"$work/build" -I"$source/plugins/elements" tests/gstreamer-fd-zero.c "$source/plugins/elements/gstsparsefile.c" $(pkg-config --cflags --libs glib-2.0 gobject-2.0 gmodule-2.0) -l:libgstreamer-1.0.so.0 -o "$work/fixed"
  "$work/fixed"
  ninja -C "$work/build" plugins/elements/libgstcoreelements.so
  patchelf --remove-rpath "$plugin"
fi
test -s "$plugin"
cp "$plugin" "$appdir/usr/lib/gstreamer-1.0/libgstcoreelements.so"
mkdir -p "$appdir/usr/share/doc/active-classroom-gstreamer"
cp "$source/COPYING" "$appdir/usr/share/doc/active-classroom-gstreamer/COPYING"
cp tests/build-coreelements.sh tests/gstreamer-fd-zero.c "$appdir/usr/share/doc/active-classroom-gstreamer/"
echo 'MEDIA_RUNTIME_CORE version=1.20.3 patch=valid_fd_zero codecs_unchanged=true'
