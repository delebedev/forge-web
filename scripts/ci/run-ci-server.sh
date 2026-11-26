#!/usr/bin/env bash
set -euo pipefail
: "${FORGE_WEB_SERVER_DIST:?Set the tested server distribution directory}"
node scripts/ci/runtime-artifact.mjs verify server "$FORGE_WEB_SERVER_DIST"
chmod +x "$FORGE_WEB_SERVER_DIST/bin/server"
exec "$FORGE_WEB_SERVER_DIST/bin/server"
