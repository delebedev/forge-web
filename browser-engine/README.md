# Browser-local engine

The signed-in product can run the pinned Forge engine in one Web Worker through
the existing React game board. CheerpJ 4.3 supplies the Java 17 runtime.
Browser-local gameplay needs no server match slot, gameplay API request, or
WebSocket; the product shell, release assets, and card art still load over HTTP.

The build contains the complete Forge card-script catalog, tokens and editions.
Decks arrive as Forge decklists with main and sideboard entries. The catalog is
installed once per worker and card definitions are loaded on demand. A worker
serves at most five game starts; the next start, or the first start after a
runtime failure, replaces it so repeated games do not accumulate indefinitely.
A start whose deck is rejected does not count.

## Integrated alpha release

`bun run browser-alpha:build` writes schema-2 `dist/browser-engine/release.json`.
It maps each logical file to a content-addressed URL and generates the exact
same-origin startup set from the worker metadata, classpath, and selected
catalog files. The lobby and worker consume that one manifest. Every file is
checked for size and SHA-256 before use.

On supported browsers, the signed-in play lobby downloads the startup set at
bounded concurrency. Save-Data suppresses automatic warmup. Failures remain non-fatal and Play retries through ordinary
HTTP caching. Hosted CheerpJ files stay lazy.
Reloading or leaving a game ends it.

All play runs in the browser engine; there is no server engine to fall back to.
Unsupported browsers and failed engine startups show a retryable error. Roll
back by atomically restoring the preceding application root.

Current desktop Chrome is the qualification target. Edge remains best-effort
until its full qualification matrix has been run.

## Build

Bootstrap normally with `bun run bootstrap`, then install Java 17 alongside the
normal Java 21 toolchain. `bun run browser:assets` builds the catalog, the
pruned JVM distribution and the release manifest under `public/browser-engine/`.
This directory is a standalone Gradle build over the Leyline composite build;
run its tasks with `./leyline/gradlew -p browser-engine <task>`. JVM tests run
with `./leyline/gradlew -p browser-engine check -PruntimeJavaVersion=17`.

| Package | Owns |
| --- | --- |
| `forge.web.browser.runtime` | Worker facade, native callbacks, diagnostics and card metadata |
| `forge.web.browser.cards` | Card projection, Web decklists and deck validation |
| `forge.web.browser.limited` | Draft, sealed and print sheets |
| `forge.web.browser.catalog` | Build-time catalog and card index generators |

`worker/` holds the Web Worker script and CheerpJ preload list that the release
copies into `web/`.

Revalidate HTML and `release.json`. Serve `/browser-engine/objects/` as public,
long-lived, immutable content. Retain objects from the current and immediately previous manifest so stale tabs
remain usable through one deployment. Serve `.wasm` as `application/wasm`.

Generated catalog and library files are ignored by Git. `browserPrune=true`
removes server and database dependencies, Forge persistence and download
helpers, and compile-time annotations from the browser distribution without
removing card rules.

## Draft and sealed

The worker's `draft`, `draft-complete` and `sealed` commands exchange card names.
A draft keeps no session: each call replays `{set, seed, picks, catalogVersion}`
under a seeded Forge random generator, so a recycled or reloaded worker resumes
it with the same packs, bot picks and bot decks. The catalog carries draft
rankings for the offered sets. Boosters build each edition's print sheets on
demand instead of loading every card script.

`node tools/limited-timing.mjs --runs 3` times a full FDN draft, its bot decks
and a sealed pool on cold workers in desktop Chrome after `bun run browser:assets`.

## Boundaries

The engine validates decklist size and sections, retires unresponsive workers,
and lets a player download a local diagnostic report after a failure.

Refreshing ends the current game. The engine has no saved-match recovery,
offline guarantee or multiplayer authority. Worker recycling limits accumulation
between games but is not a hard tab-memory cap. Only current desktop Chrome is
qualified.

CheerpJ is loaded from its hosted runtime and credited on the About page. Hosted
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
