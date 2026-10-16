#!/usr/bin/env bash
set -euo pipefail
: "${FORGE_WEB_SERVER_DIST:?Set the tested server distribution directory}"
node scripts/runtime-artifact.mjs verify server-21 "$FORGE_WEB_SERVER_DIST"
export JAVA_OPTS="-Xmx1024m"
chmod +x "$FORGE_WEB_SERVER_DIST/bin/server"
exec "$FORGE_WEB_SERVER_DIST/bin/server"
