#!/usr/bin/env bash
# Preflight de tareas: sincroniza sin descartar trabajo local ni reescribir historia.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
git fetch origin --prune --tags

if ! git merge-base --is-ancestor origin/main HEAD; then
  if ! git merge-base --is-ancestor HEAD origin/main; then
    echo "La rama tiene trabajo propio y una base atrasada. Integra origin/main preservando ese trabajo antes de implementar." >&2
    exit 1
  fi
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Conserva los cambios locales antes de adelantar el checkout. No se modificó su contenido." >&2
    exit 1
  fi
  git merge --ff-only origin/main
fi

latest_tag="$(gh api 'repos/{owner}/{repo}/releases/latest' --jq '.tag_name')"
if [[ ! "$latest_tag" =~ ^active-classroom-v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "No se pudo identificar una versión estable de Active Classroom: $latest_tag" >&2
  exit 1
fi
if ! git merge-base --is-ancestor "refs/tags/$latest_tag" HEAD; then
  echo "La base aún no contiene $latest_tag. Integra la versión publicada antes de implementar." >&2
  exit 1
fi
echo "Base verificada: contiene origin/main y $latest_tag."
