#!/usr/bin/env bash
set -euo pipefail
version="$1"
report="$2"
mkdir -p "$report"
mapfile -t packages < <(find src-tauri/target/release/bundle/deb -maxdepth 1 -name '*.deb' -type f)
mapfile -t images < <(find src-tauri/target/release/bundle/appimage -maxdepth 1 -name '*.AppImage' -type f)
test "${#packages[@]}" -eq 1
test "${#images[@]}" -eq 1
deb="$(realpath "${packages[0]}")"
image="$(realpath "${images[0]}")"
scripts="$(realpath tests)"
# Inspect the packaged ABI, launcher and files before any signing secret is used.
dpkg-deb --info "$deb" > "$report/deb-control.txt"
dpkg-deb --contents "$deb" > "$report/deb-files.txt"
previous="$(mktemp --suffix=.deb)"
fixtures="$(mktemp -d)"
cp /usr/bin/gst-launch-1.0 "$fixtures/gst-launch"
ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=size=320x180:rate=24 -f lavfi -i sine=frequency=440 \
  -t 2 -c:v libx264 -pix_fmt yuv420p -profile:v baseline -c:a aac "$fixtures/h264-aac.mp4"
curl --fail --location --retry 3 -o "$previous" https://github.com/gonhercaral-cpu/desarrollo-proyectos/releases/download/active-classroom-v1.0.12/Active.Classroom_1.0.12_amd64.deb
echo "fb11b42dfddaedaf2f4b49902bf23da5f2d9b89edd14fd64e95a399d3a881572  $previous" | sha256sum --check
for ubuntu in ${CLASSROOM_PACKAGE_OS:-22.04 24.04 26.04}; do
  for installer in apt gdebi; do
    name="classroom-package-${ubuntu//./-}-$installer-${GITHUB_RUN_ID:-local}"
    tag="classroom-package-test:${ubuntu//./-}-${GITHUB_RUN_ID:-local}"
    docker create --name "$name" -v "$deb:/package/classroom.deb:ro" \
      -v "$scripts:/tests:ro" ubuntu:"$ubuntu" \
      bash -euc 'bash /tests/linux-package-install.sh /package/classroom.deb "$1" "$2"; if [[ "$1" == apt ]]; then dpkg -i /package/classroom.deb; apt-get install -y --no-install-recommends xvfb xauth x11-utils dbus-x11 weston procps; fi' -- "$installer" "$version"
    docker start --attach "$name" | tee "$report/ubuntu-$ubuntu-$installer.log"
    test "$(docker inspect --format '{{.State.ExitCode}}' "$name")" = 0
    if [[ "$installer" == apt ]]; then
      docker commit "$name" "$tag" >/dev/null
      # Network disconnected: a smoke launch cannot activate/register a CI device
      # against production. No actual classroom data is mounted into containers.
      docker run --rm --network none -v "$image:/package/classroom.AppImage:ro" \
        -v "$scripts:/tests:ro" -v "$fixtures:/fixtures:ro" "$tag" bash /tests/linux-appimage-smoke.sh /package/classroom.AppImage \
        | tee "$report/ubuntu-$ubuntu-appimage.log"
      docker image rm "$tag" >/dev/null
    fi
    docker rm "$name" >/dev/null
  done
  if [[ "$ubuntu" != 26.04 ]]; then
    docker run --rm -v "$previous:/package/previous.deb:ro" -v "$deb:/package/next.deb:ro" \
      -v "$scripts:/tests:ro" ubuntu:"$ubuntu" \
      bash /tests/linux-package-upgrade.sh /package/previous.deb /package/next.deb "$version" \
      | tee "$report/ubuntu-$ubuntu-upgrade.log"
  fi
done
rm "$previous"
echo 'PACKAGE_VALIDATION clean_ubuntu=22.04,24.04,26.04 apt=true gdebi=true dpkg=true appimage=true'
