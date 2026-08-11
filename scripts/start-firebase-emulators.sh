#!/usr/bin/env bash

set -euo pipefail

readonly PROJECT_ID="sistema-desarrollo-proyectos"
readonly DATA_DIR=".firebase/emulator-data"
readonly CLI_CONFIG_DIR=".firebase/cli-config"

mkdir -p "${DATA_DIR}" "${CLI_CONFIG_DIR}"

firebase_args=(
  emulators:start
  --project "${PROJECT_ID}"
  --only auth,firestore,storage,functions
  --export-on-exit="${DATA_DIR}"
)

if [[ -f "${DATA_DIR}/firebase-export-metadata.json" ]]; then
  firebase_args+=(--import="${DATA_DIR}")
fi

XDG_CONFIG_HOME="${CLI_CONFIG_DIR}" exec firebase "${firebase_args[@]}"
