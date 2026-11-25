#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != --no-build ]]; then
  ./leyline/gradlew :server:installDist
fi

# The product server stores accounts, decks, courses and replays; gameplay and card
# rules run in the browser engine. Its distribution must carry no engine code.
lib_dir=server/build/install/server/lib
if [[ ! -f "$lib_dir/server.jar" ]]; then
  echo "Product distribution is missing: $lib_dir/server.jar" >&2
  exit 1
fi
archives=$(find "$lib_dir" -type f -name '*.jar' -print)
while IFS= read -r archive; do
  name=${archive##*/}
  case "$name" in
    domain.jar | engine.jar | gre-proto.jar | card-presentation*.jar | forge-*.jar | leyline-*.jar | native*.jar | web.jar | protobuf-*.jar)
      echo "Product distribution includes an engine module: $name" >&2
      exit 1
      ;;
  esac
  engine=$(jar tf "$archive" | grep -E '^(leyline/|forge/(game|ai|deck|card|item)/|forge/web/cards/)' | head -1 || true)
  if [[ -n "$engine" ]]; then
    echo "Product distribution includes engine classes: $name:$engine" >&2
    exit 1
  fi
done <<< "$archives"

echo 'Product distribution contains no Leyline, Forge or card-presentation code.'
