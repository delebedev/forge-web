#!/usr/bin/env bash
set -euo pipefail

[[ $# == 1 && "$1" = /* && ! -e "$1" ]] || {
  echo 'Usage: build-full-release.sh NEW_ABSOLUTE_OUTPUT_DIRECTORY' >&2
  exit 2
}
output=$1
server=server/build/install/server/bin/server
[[ -s dist/index.html && -s dist/browser-engine/release.json && -x "$server" ]] || {
  echo 'Build the web and server distributions first' >&2
  exit 1
}
# The production host is linux-arm64: a 64-bit ELF with machine type 0xb7.
header=$(od -An -tx1 -N20 "$server" | tr -d ' \n')
[[ $header == 7f454c4602* && ${header:36:4} == b700 ]] || {
  echo 'The server binary is not linux-arm64; run bun run server:build:release' >&2
  exit 1
}

mkdir -p "$output/payload"
cp -R dist "$output/payload/static"
cp -R server/build/install/server "$output/payload/server"
chmod -R a+rX "$output/payload"
COPYFILE_DISABLE=1 tar --exclude='*.map' -czf "$output/full.tar.gz" -C "$output" payload
echo "Full release artifact: $output/full.tar.gz"
