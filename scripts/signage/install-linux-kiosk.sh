#!/usr/bin/env bash
set -Eeuo pipefail

# Installer best-effort para Digital Signage en Linux modo quiosco.
# Soporta Debian/Ubuntu/Raspberry Pi OS cuando apt esta disponible.
# No borra archivos del sistema ni modifica React/Firebase.

APP_NAME="aes-signage"
CONFIG_DIR="${HOME}/.config/${APP_NAME}"
AUTOSTART_DIR="${HOME}/.config/autostart"
BIN_DIR="${HOME}/.local/bin"
ENV_FILE="${CONFIG_DIR}/player.env"
LAUNCHER_FILE="${BIN_DIR}/aes-signage-kiosk"
DESKTOP_FILE="${AUTOSTART_DIR}/aes-signage.desktop"

PLAYER_URL=""
DEVICE_NAME=""
SKIP_INSTALL="false"

log() {
  printf '[aes-signage] %s\n' "$*"
}

warn() {
  printf '[aes-signage][warn] %s\n' "$*" >&2
}

die() {
  printf '[aes-signage][error] %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Uso:
  install-linux-kiosk.sh --url "https://DOMINIO/signage/player/DEVICE_TOKEN" [--name "Pantalla Recepcion"] [--no-install]

Opciones:
  --url          URL completa del reproductor.
  --name         Nombre local opcional.
  --no-install   No instalar paquetes, solo crear configuracion/autostart.
  -h, --help     Mostrar ayuda.
USAGE
}

shell_quote() {
  local value="${1:-}"
  printf "'%s'" "${value//\'/\'\\\'\'}"
}

require_linux() {
  [[ "$(uname -s)" == "Linux" ]] || die "Este script debe ejecutarse en Linux."
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --url)
        PLAYER_URL="${2:-}"
        shift 2
        ;;
      --name)
        DEVICE_NAME="${2:-}"
        shift 2
        ;;
      --no-install)
        SKIP_INSTALL="true"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Argumento no reconocido: $1"
        ;;
    esac
  done
}

prompt_missing_values() {
  if [[ -z "${PLAYER_URL}" ]]; then
    read -r -p "URL completa del reproductor: " PLAYER_URL
  fi

  if [[ -z "${DEVICE_NAME}" ]]; then
    read -r -p "Nombre local del dispositivo (opcional): " DEVICE_NAME || true
  fi
}

validate_player_url() {
  [[ "${PLAYER_URL}" =~ ^https?://.+/signage/player/.+ ]] || die "URL invalida. Debe verse como https://DOMINIO/signage/player/DEVICE_TOKEN"
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

can_sudo() {
  [[ "${EUID}" -eq 0 ]] || has_command sudo
}

apt_has_package() {
  local package_name="$1"
  has_command apt-cache || return 1
  apt-cache policy "${package_name}" 2>/dev/null | grep -q 'Candidate: [^(]'
}

install_packages_best_effort() {
  [[ "${SKIP_INSTALL}" == "false" ]] || {
    log "Instalacion de paquetes omitida por --no-install."
    return
  }

  if ! has_command apt-get; then
    warn "apt-get no disponible. Instala Chromium manualmente."
    return
  fi

  if ! can_sudo; then
    warn "sudo no disponible. Instala Chromium manualmente o ejecuta con permisos adecuados."
    return
  fi

  local sudo_cmd=()
  if [[ "${EUID}" -ne 0 ]]; then
    sudo_cmd=(sudo)
  fi

  local packages=()
  if ! has_command chromium && ! has_command chromium-browser; then
    if apt_has_package chromium; then
      packages+=(chromium)
    elif apt_has_package chromium-browser; then
      packages+=(chromium-browser)
    else
      warn "No encontre paquete chromium/chromium-browser en apt."
    fi
  fi

  if ! has_command unclutter && apt_has_package unclutter; then
    packages+=(unclutter)
  fi

  if [[ "${#packages[@]}" -eq 0 ]]; then
    log "Dependencias ya presentes o no disponibles por apt."
    return
  fi

  log "Instalando paquetes: ${packages[*]}"
  "${sudo_cmd[@]}" apt-get update
  "${sudo_cmd[@]}" apt-get install -y "${packages[@]}"
}

detect_browser_command() {
  if has_command chromium; then
    printf 'chromium'
    return
  fi

  if has_command chromium-browser; then
    printf 'chromium-browser'
    return
  fi

  if has_command google-chrome; then
    printf 'google-chrome'
    return
  fi

  printf 'chromium'
}

write_config() {
  mkdir -p "${CONFIG_DIR}" "${AUTOSTART_DIR}" "${BIN_DIR}"
  chmod 700 "${CONFIG_DIR}"

  cat > "${ENV_FILE}" <<EOF
# Configuracion local de Digital Signage.
# Edita PLAYER_URL si reasignas este equipo a otro dispositivo.
PLAYER_URL=$(shell_quote "${PLAYER_URL}")
DEVICE_NAME=$(shell_quote "${DEVICE_NAME}")
EOF

  chmod 600 "${ENV_FILE}"
  log "Config creado: ${ENV_FILE}"
}

write_launcher() {
  local browser_cmd
  browser_cmd="$(detect_browser_command)"

  cat > "${LAUNCHER_FILE}" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="\${HOME}/.config/${APP_NAME}/player.env"
if [[ ! -f "\${ENV_FILE}" ]]; then
  echo "Falta configuracion: \${ENV_FILE}" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "\${ENV_FILE}"

if [[ -z "\${PLAYER_URL:-}" ]]; then
  echo "PLAYER_URL vacio en \${ENV_FILE}" >&2
  exit 1
fi

if command -v xset >/dev/null 2>&1; then
  xset s off || true
  xset s noblank || true
  xset -dpms || true
fi

if command -v unclutter >/dev/null 2>&1; then
  unclutter -idle 0.8 -root >/dev/null 2>&1 &
fi

BROWSER_BIN="${browser_cmd}"
if ! command -v "\${BROWSER_BIN}" >/dev/null 2>&1; then
  if command -v chromium-browser >/dev/null 2>&1; then
    BROWSER_BIN="chromium-browser"
  elif command -v chromium >/dev/null 2>&1; then
    BROWSER_BIN="chromium"
  elif command -v google-chrome >/dev/null 2>&1; then
    BROWSER_BIN="google-chrome"
  else
    echo "No encontre Chromium. Instala chromium o chromium-browser." >&2
    exit 1
  fi
fi

exec "\${BROWSER_BIN}" \\
  --kiosk \\
  --no-first-run \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --autoplay-policy=no-user-gesture-required \\
  --user-data-dir="\${HOME}/.config/${APP_NAME}/chromium-profile" \\
  "\${PLAYER_URL}"
EOF

  chmod 755 "${LAUNCHER_FILE}"
  log "Launcher creado: ${LAUNCHER_FILE}"
}

write_autostart() {
  cat > "${DESKTOP_FILE}" <<EOF
[Desktop Entry]
Type=Application
Name=Active English School Digital Signage
Comment=Digital Signage kiosk player
Exec=${LAUNCHER_FILE}
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

  chmod 644 "${DESKTOP_FILE}"
  log "Autostart creado: ${DESKTOP_FILE}"
}

print_next_steps() {
  cat <<EOF

Listo.

Prueba manual:
  ${LAUNCHER_FILE}

Reinicia sesion grafica para probar autostart.

Editar config:
  nano ${ENV_FILE}

Revertir manual:
  rm -f ${DESKTOP_FILE}
  rm -f ${LAUNCHER_FILE}
  rm -f ${ENV_FILE}

EOF
}

main() {
  require_linux
  parse_args "$@"
  prompt_missing_values
  validate_player_url
  install_packages_best_effort
  write_config
  write_launcher
  write_autostart
  print_next_steps
}

main "$@"
