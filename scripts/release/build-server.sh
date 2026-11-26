#!/usr/bin/env bash
# Compiles the product server for the host, or for the Bun target given as $1.
# Full releases package this directory as payload/server.
set -euo pipefail
out=server/build/install/server
rm -rf "$out"
# bun build --compile can leave its temporary executable in the working directory.
trap 'rm -f ./.*.bun-build' EXIT
bun build --compile ${1:+"--target=$1"} server/main.ts --outfile "$out/bin/server"
