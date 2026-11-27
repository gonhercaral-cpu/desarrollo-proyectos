#!/bin/sh
set -eu
[ "$#" -eq 1 ] || { echo "Uso: sh build-release.sh DIRECTORIO_DE_SALIDA" >&2; exit 2; }
src=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$1"
out=$(CDPATH='' cd -- "$1" && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
version=1.1.0
bundle="as-print-agent-$version"
mkdir -p "$stage/$bundle"
for item in agent.py printers.test job-status.test install.sh enable-service.py README.md; do
  cp "$src/$item" "$stage/$bundle/$item"
done
# Canonical file order, modes, ownership and timestamps make the portable archive reproducible.
python3 - "$stage" "$bundle" "$out/$bundle.tar.gz" <<'PYARCHIVE'
import gzip
import sys
import tarfile
from pathlib import Path

root, bundle, filename = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
with open(filename, "wb") as target, gzip.GzipFile(filename="", fileobj=target, mode="wb", mtime=0) as zipped:
    with tarfile.open(fileobj=zipped, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for path in sorted((root / bundle).iterdir()):
            info = tarfile.TarInfo(bundle + "/" + path.name)
            info.mode = 0o755 if path.name == "install.sh" else 0o644
            info.size = path.stat().st_size
            with path.open("rb") as stream:
                archive.addfile(info, stream)
PYARCHIVE
if [ "$(uname -s)" = Darwin ]; then
  lib="$stage/pkg/usr/local/lib/as-print-agent"
  mkdir -p "$lib" "$stage/pkg/usr/local/bin"
  cp "$src/agent.py" "$src/printers.test" "$src/job-status.test" "$src/enable-service.py" "$lib/"
  cat > "$stage/pkg/usr/local/bin/as-print-agent" <<'LAUNCH'
#!/bin/sh
exec python3 /usr/local/lib/as-print-agent/agent.py "$@"
LAUNCH
  chmod 0755 "$stage/pkg/usr/local/bin/as-print-agent"
  pkgbuild --root "$stage/pkg" --identifier org.desarrolloproyectos.as-print-agent --version "$version" \
    --install-location / "$out/$bundle-macos.pkg"
fi
python3 - "$out" "$bundle" <<'PYSUMS'
import hashlib
import sys
from pathlib import Path

out, prefix = Path(sys.argv[1]), sys.argv[2]
files = [out / (prefix + ".tar.gz")]
if sys.platform == "darwin":
    files.append(out / (prefix + "-macos.pkg"))
lines = [hashlib.sha256(path.read_bytes()).hexdigest() + "  " + path.name for path in files]
(out / "SHA256SUMS").write_text("\n".join(lines) + "\n")
print("\n".join(lines))
PYSUMS
