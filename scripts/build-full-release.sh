#!/usr/bin/env bash
set -euo pipefail

[[ $# == 1 && "$1" = /* && ! -e "$1" ]] || {
  echo 'Usage: build-full-release.sh NEW_ABSOLUTE_OUTPUT_DIRECTORY' >&2
  exit 2
}
output=$1
[[ -s dist/index.html && -s dist/browser-engine/release.json && -x server/build/install/server/bin/server ]] || {
  echo 'Build the web and server distributions first' >&2
  exit 1
}

mkdir -p "$output/payload/leyline/forge/forge-gui"
cp -R dist "$output/payload/static"
cp -R server/build/install/server "$output/payload/server"
python3 scripts/package_runtime.py leyline/forge/forge-gui/res "$output/payload/leyline/forge/forge-gui/res"
mkdir -p "$output/payload/leyline/data"
cp -R leyline/data/puzzles leyline/data/draft-models "$output/payload/leyline/data/"
chmod -R a+rX "$output/payload"
COPYFILE_DISABLE=1 tar --exclude='*.map' -czf "$output/full.tar.gz" -C "$output" payload
echo "Full release artifact: $output/full.tar.gz"
