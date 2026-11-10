#!/usr/bin/env bash
# Prepara solo el proceso hijo; no instala herramientas ni cambia el shell del usuario.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Uso: bash scripts/con-entorno-macos.sh <comando> [argumentos...]" >&2
  exit 2
fi

task_repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

task_prepend_path() {
  [[ -d "$1" ]] || return 0
  case "${PATH:-}" in
    "$1"|"$1":*) ;;
    *) export PATH="$1${PATH:+:$PATH}" ;;
  esac
}

if [[ -n "${HOME:-}" ]]; then
  task_prepend_path "${HOME}/.local/bin"
fi
if [[ "$(uname -s)" == "Darwin" ]]; then
  task_brew_prefixes=()
  if [[ -n "${HOMEBREW_PREFIX:-}" ]]; then
    task_brew_prefixes+=("${HOMEBREW_PREFIX}")
  fi
  if [[ "$(uname -m)" == "arm64" ]]; then
    task_brew_prefixes+=(/opt/homebrew /usr/local)
  else
    task_brew_prefixes+=(/usr/local /opt/homebrew)
  fi
  for task_brew_prefix in "${task_brew_prefixes[@]}"; do
    [[ -d "$task_brew_prefix" ]] || continue
    task_prepend_path "${task_brew_prefix}/bin"
    task_prepend_path "${task_brew_prefix}/opt/python@3.12/libexec/bin"
    task_prepend_path "${task_brew_prefix}/opt/node@24/bin"
    if [[ -z "${JAVA_HOME:-}" && -d "${task_brew_prefix}/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home" ]]; then
      export JAVA_HOME="${task_brew_prefix}/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
    fi
    break
  done
  if [[ -n "${JAVA_HOME:-}" ]]; then
    task_prepend_path "${JAVA_HOME}/bin"
  fi
  if [[ -x /Applications/LibreOffice.app/Contents/MacOS/soffice ]]; then
    task_prepend_path /Applications/LibreOffice.app/Contents/MacOS
  fi
fi

# Una worktree puede compartir las herramientas ignoradas del checkout principal.
# Git resuelve el directorio común; no dependemos del nombre o ubicación de ese checkout.
task_repo_dirs=("$task_repo_dir")
if task_common_dir="$(git -C "$task_repo_dir" rev-parse --git-common-dir 2>/dev/null)"; then
  if [[ "$task_common_dir" != /* ]]; then
    task_common_dir="${task_repo_dir}/${task_common_dir}"
  fi
  if task_common_root="$(cd "${task_common_dir}/.." 2>/dev/null && pwd -P)"; then
    if [[ "$task_common_root" != "$task_repo_dir" ]]; then
      task_repo_dirs+=("$task_common_root")
    fi
  fi
fi

for task_tools_root in "${task_repo_dirs[@]}"; do
  task_firebase_bin="${task_tools_root}/.orquestacion/tools/firebase/node_modules/.bin"
  [[ -x "${task_firebase_bin}/firebase" ]] || continue
  task_prepend_path "$task_firebase_bin"
  # Solo Firebase por nombre adopta el perfil existente asociado a ese CLI.
  # Un XDG_CONFIG_HOME explícito, incluso vacío, pertenece al usuario.
  if [[ "$1" == "firebase" && -z "${XDG_CONFIG_HOME+x}" && -d "${task_tools_root}/.firebase/cli-config" ]]; then
    export XDG_CONFIG_HOME="${task_tools_root}/.firebase/cli-config"
  fi
  break
done

exec "$@"
