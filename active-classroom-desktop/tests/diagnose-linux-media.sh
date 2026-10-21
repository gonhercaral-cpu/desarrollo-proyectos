#!/usr/bin/env bash
set -euo pipefail
runtime="$(realpath "$1")"
report="$2"
mkdir -p "$report"
fixtures="$(mktemp -d)"
scripts="$(realpath tests)"
deb="$runtime/Active.Classroom_1.0.17_amd64.deb"
image="$runtime/Active-Classroom-1.0.17-x86_64.AppImage"
test -f "$deb" && test -f "$image"
# GitHub ZIP downloads preserve bytes, not executable mode. The workflow has
# already verified the source certificate and hashes before entering this script.
chmod 755 "$image"
# The fixture compiles current public Rust/TS. Previously validated packages
# supply only their unchanged native runtime. No certificate is issued here.
ACTIVE_CLASSROOM_MEDIA_PERFORMANCE=1 ACTIVE_CLASSROOM_MEDIA_EXPORT="$fixtures" npm run test:media:linux
name="classroom-media-probe-${GITHUB_RUN_ID}"
tag="classroom-media-probe:${GITHUB_RUN_ID}"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; docker image rm "$tag" >/dev/null 2>&1 || true' EXIT
docker create --name "$name" -v "$deb:/package/classroom.deb:ro" -v "$scripts:/tests:ro" ubuntu:22.04 \
  bash -euc 'bash /tests/linux-package-install.sh /package/classroom.deb apt 1.0.17; dpkg -i /package/classroom.deb; apt-get install -y --no-install-recommends xvfb xauth x11-utils dbus-x11 weston procps'
docker start --attach "$name" | tee "$report/install.log"
test "$(docker inspect --format '{{.State.ExitCode}}' "$name")" = 0
docker commit "$name" "$tag" >/dev/null
docker rm "$name" >/dev/null
for attempt in 1 2 3; do
  # Trace the engine independently of renderer opt-in frame diagnostics.
  # Public synthetic media only; no identity, tokens or classroom paths.
  status=0
  docker run --rm --network none -v "$image:/package/classroom.AppImage:ro" \
    -v "$scripts:/tests:ro" -v "$fixtures:/fixtures:ro" -v "$report:/reports" \
    -e GST_DEBUG=webkitmediaplayer:5,webkitwebsrc:4,queue2:5,GST_STATES:4 \
    -e "GST_DEBUG_FILE=/reports/gstreamer-$attempt-%p.log" -e GST_DEBUG_NO_COLOR=1 \
    "$tag" bash -c 'df -Pk /tmp /var/tmp; bash /tests/linux-packaged-media.sh /package/classroom.AppImage appimage x11; status=$?; df -Pk /tmp /var/tmp; exit "$status"' \
    | tee "$report/native-$attempt.log" || status=$?
  # Keep per-process traces separate and redact short-lived local grants.
  mapfile -t logs < <(find "$report" -maxdepth 1 -type f \( -name "gstreamer-$attempt-*.log" -o -name "native-$attempt.log" \))
  if (( ${#logs[@]} )); then sed -E -i 's#http://127\.0\.0\.1:[0-9]+/media/[a-f0-9]{64}#LOCAL_MEDIA#g' "${logs[@]}"; fi
  if (( status )); then exit "$status"; fi
done
