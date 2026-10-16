# Browser-local engine

The signed-in product can run the pinned Forge engine in one Web Worker through
the existing React game board. CheerpJ 4.3 supplies the Java 17 runtime.
Browser-local gameplay needs no server match slot, gameplay API request, or
WebSocket; the product shell, release assets, and card art still load over HTTP.

The build contains the complete Forge card-script catalog, tokens, editions,
and two starter decks. Players can also paste Forge decklists with main and
sideboard entries. The catalog is installed once per worker and card definitions
are loaded on demand. A worker is replaced after five game starts or after a
runtime failure so repeated games do not accumulate indefinitely.

## Integrated alpha release

`bun run browser-alpha:build` writes schema-2 `dist/browser-engine/release.json`.
It maps each logical file to a content-addressed URL and generates the exact
same-origin startup set from the worker metadata, classpath, and selected
catalog files. The lobby and worker consume that one manifest. Every file is
checked for size and SHA-256 before use.

On supported browsers, the signed-in play lobby downloads the startup set at
bounded concurrency. Save-Data suppresses automatic warmup. Failures remain non-fatal and Play retries through ordinary
HTTP caching before falling back to a server. Hosted CheerpJ files stay lazy.
Reloading or leaving a game ends it.

Browser execution is the default on supported browsers. Capability checks select
server play when required browser APIs are unavailable; a failed engine startup
also falls back to the server. Players can choose server play explicitly. Roll
back by atomically restoring the preceding application root.

Current desktop Chrome is the qualification target. Edge remains best-effort
until its full qualification matrix has been run.

## Standalone build and run

Bootstrap normally with `bun run bootstrap`, then install Java 17 alongside the
normal Java 21 toolchain. From the repository root:

```sh
python3 scripts/build-browser-catalog.py
./leyline/gradlew :browser-engine:browserDistribution :browser-engine:catalogIndex -PruntimeJavaVersion=17 -PbrowserPrune=true
bun run browser:build
bun run browser:preview
```

Open `http://127.0.0.1:5179/`. Serve `dist-browser/` from the root of a dedicated
HTTPS origin and replace its root atomically. Revalidate HTML and release.json.
Serve `/browser-engine/objects/` and Vite's hashed assets as public, long-lived,
immutable content. Retain objects from the current and immediately previous
manifest so stale tabs remain usable through one deployment. Serve `.wasm` as
`application/wasm`.

Generated catalog and library files are ignored by Git. `browserPrune=true`
removes server and database dependencies, Forge persistence and download
helpers, and compile-time annotations from the browser distribution without
removing card rules.

## Boundaries

The launcher supports human-versus-AI and AI-versus-AI games. It validates
decklist size and sections, retires unresponsive workers, and lets a player
download a local diagnostic report after a failure.

Refreshing ends the current game. The build has no account service,
saved-match recovery, offline guarantee, multiplayer authority, or graphical
deck editor. Worker recycling limits accumulation between games but is not a
hard tab-memory cap. Only current desktop Chrome is qualified.

CheerpJ is loaded from its hosted runtime and credited in the launcher. Hosted
use and any self-hosted or offline distribution must comply with the vendor's
[licensing terms](https://cheerpj.com/docs/licensing).

## Failure diagnostics

The host retains bounded command correlation and the latest output IDs locally.
Terminal worker failures request a parked JVM diagnostic thread through a native promise outside the
command queue before retirement, with a one-second host deadline. It reads
explicit receive phase and elapsed time without acquiring the match lock, plus
receive elapsed time and JVM heap totals. The snapshot travels only with a
failure report and authenticated replay journal. An unresponsive runtime
preserves host context with an explicit unavailable/timed-out result. CheerpJ
thread inspection cannot provide reliable stacks or thread states, so the probe
uses the pinned runtime's phase markers. No polling or normal diagnostic logs
are added.
