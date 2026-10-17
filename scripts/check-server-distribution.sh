#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != --no-build ]]; then
  ./leyline/gradlew :server:installDist
fi

lib_dir=server/build/install/server/lib
for module in domain.jar engine.jar gre-proto.jar; do
  if [[ ! -f "$lib_dir/$module" ]]; then
    echo "Product distribution is missing $module" >&2
    exit 1
  fi
done

while IFS= read -r archive; do
  name=${archive##*/}
  if [[ "$name" == leyline-*.jar || "$name" == native.jar || "$name" == native-* ]]; then
    echo "Product distribution includes a Leyline application module: $name" >&2
    exit 1
  fi
  if [[ "$name" == web.jar || "$name" == web-* ]]; then
    echo "Product distribution includes legacy Leyline web module: $name" >&2
    exit 1
  fi
  if [[ "$name" == jetty-* || "$name" == alpn-api-* || "$name" == javax.servlet-* ]]; then
    echo "Product distribution includes a headless web dependency: $name" >&2
    exit 1
  fi

  listing=$(jar tf "$archive")
  application_entry=$(printf '%s\n' "$listing" | grep -E '^(leyline/LeylineMainKt\.class$|leyline/native/)' | head -1 || true)
  if [[ -n "$application_entry" ]]; then
    echo "Product distribution includes a Leyline application class: $name:$application_entry" >&2
    exit 1
  fi
  legacy=$(printf '%s\n' "$listing" | grep -E '^(leyline/web/|leyline/WebMainKt\.class$|leyline/config/WebSettings\.class$)' | head -1 || true)
  if [[ -n "$legacy" ]]; then
    echo "Product distribution includes legacy Leyline web head: $name:$legacy" >&2
    exit 1
  fi
  gameplay=$(printf '%s\n' "$listing" | grep -E '^forge/web/server/(match/(MatchReplayWriter|BrowserGreTransport|BrowserMatchLauncher|MatchRoutesKt|SpectatorRoutesKt|DevPuzzleCandidates)|puzzles/(PuzzlePipeline|PuzzleTrialTrace)|persistence/(MatchOutcome|MatchStartRecord|SqliteMatchOutcomeStore|NoOpMatchOutcomeRecorder))' | head -1 || true)
  if [[ -n "$gameplay" ]]; then
    echo "Product distribution includes a removed gameplay entrypoint: $name:$gameplay" >&2
    exit 1
  fi
done < <(find "$lib_dir" -type f -name '*.jar' -print)

echo 'Product distribution contains reusable Leyline modules without Web gameplay entrypoints.'
