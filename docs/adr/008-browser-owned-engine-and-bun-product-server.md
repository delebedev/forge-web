# ADR-008: Browser-Owned Engine and Bun Product Server

## Status

Accepted

## Context

Forge Web began with a Kotlin server that ran the pinned Leyline engine, held
each match and streamed GRE frames to the browser over a WebSocket. The browser
later gained its own build of the same engine, compiled for Java 17 and run in
a Web Worker. Once that worker could start constructed, Commander, limited and
puzzle matches, the server engine was a second gameplay host with its own
transport, capacity limits and failure modes.

The remaining server responsibilities (accounts, saved decks, course records,
roadmap votes, puzzle ratings and replay uploads) do not need Forge or Leyline.

## Decision

Every match runs in the player's browser. The browser worker is the only
gameplay host. An unsupported browser shows a retryable error; there is no
server fallback. Replays reuse the same board through a read-only frame source.

The product server is TypeScript on Bun under `server/`. It imports nothing from
Leyline, constructs no games and serves only product HTTP routes. The Zod
schemas in `server/contract/wire-schemas.ts` are the single HTTP contract. The
server keeps the Flyway-compatible migration history of the database it
inherited.

## Consequences

- A Leyline pin change ships as a frontend release, never a server deploy.
- The server builds and tests without a JDK or the Leyline submodule.
- Game rules, legality and AI cost the player's device, not server capacity.
- Engine startup time and browser support become product concerns, covered by
  the browser lifecycle analytics and the browser support preflight.
- Rule enforcement is not authoritative against a modified client. Solo play,
  puzzles and limited progression trust the browser outcome.
- Gameplay has no WebSocket transport and no server-side match state.
