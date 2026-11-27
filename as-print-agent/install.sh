#!/bin/sh
set -eu
umask 077
base=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
for required in python3 lp lpstat lpoptions ipptool qpdf; do
  command -v "$required" >/dev/null || { echo "Instala $required antes de continuar." >&2; exit 1; }
done
python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' || { echo "Se requiere Python 3.9 o superior." >&2; exit 1; }
folder="$HOME/.local/lib/as-print-agent"
mkdir -p "$folder" "$HOME/.local/bin"
for item in agent.py printers.test job-status.test enable-service.py; do
  install -m 0644 "$base/$item" "$folder/$item.new"
  mv "$folder/$item.new" "$folder/$item"
done
cat > "$HOME/.local/bin/as-print-agent.new" <<'LAUNCH'
#!/bin/sh
exec python3 "$HOME/.local/lib/as-print-agent/agent.py" "$@"
LAUNCH
chmod 0755 "$HOME/.local/bin/as-print-agent.new"
mv "$HOME/.local/bin/as-print-agent.new" "$HOME/.local/bin/as-print-agent"
echo "Instalado. Ejecuta ~/.local/bin/as-print-agent diagnose."
