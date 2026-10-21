#!/usr/bin/env bash
set -euo pipefail
output="$(realpath -m "$1")"
mkdir -p "$output"
collector="$(realpath tests/collect-native-codecs.py)"
for ubuntu in 22.04 24.04 26.04; do
  mkdir -p "$output/$ubuntu"
  docker run --rm -e DEBIAN_FRONTEND=noninteractive -e LC_ALL=C \
    -v "$collector:/collector.py:ro" -v "$output/$ubuntu:/out" ubuntu:"$ubuntu" \
    bash -euc 'apt-get update; apt-get install -y --no-install-recommends python3; python3 /collector.py /out'
done
