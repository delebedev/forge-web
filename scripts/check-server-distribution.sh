#!/usr/bin/env bash
# Checks that the compiled product server starts on an empty state directory and reports healthy.
set -euo pipefail

if [[ "${1:-}" != --no-build ]]; then
  bun run server:build
fi

binary=server/build/install/server/bin/server
if [[ ! -x "$binary" ]]; then
  echo "Product server binary is missing: $binary" >&2
  exit 1
fi

state=$(mktemp -d)
port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
LEYLINE_WEB_PORT=$port LEYLINE_WEB_AUTH_SECRET=runtime-check-auth-secret-1234567890 \
  LEYLINE_PATHS_STATE="$state" LEYLINE_PATHS_ARTIFACTS="$state/logs" \
  "$binary" > "$state/server.log" 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; rm -rf "$state"' EXIT

for _ in $(seq 1 100); do
  if health=$(curl --silent --fail "http://127.0.0.1:$port/api/health"); then
    echo "Product server is healthy: $health"
    exit 0
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
echo 'Product server did not become healthy:' >&2
cat "$state/server.log" >&2
exit 1
