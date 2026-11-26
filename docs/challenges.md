# Challenges

## Public puzzle experience

The public header labels the entry **Daily Puzzle** and links to one bundled
challenge selected by UTC day. A small New badge becomes Done after the player
wins that day's puzzle. Completion is browser-local and best-effort; blocked
storage keeps the state for the current page. Victory returns to the public
table instead of suggesting another puzzle. Defeat still offers another attempt
or challenge.

Accepted `/challenge/:id` links remain shareable, and `/challenge/random`
continues to select an accepted generated puzzle or bundled fallback. Each route
loads its `.pzl` into the Forge browser worker and uses the normal board and
puzzle win condition. Retry restarts the position. After victory or defeat,
players can select one of three ratings and optionally leave a comment.
Next opens another puzzle from the pool. If the pool is empty or unavailable,
the bundled browser challenges remain playable as a fallback. The worker's
versioned assets can be cached; the release manifest revalidates.

Bundled challenges have one authored catalog: `public/challenges/*.pzl`.
`bun run challenge:manifest` derives the frontend manifest from each file's
metadata, and builds reject a stale manifest. Do not maintain a parallel
TypeScript list.

## Generated puzzle pool (server)

The product server keeps the shared accepted puzzle pool in `player.db`. Nothing
generates or adds puzzles, so the pool is frozen. `GET /api/puzzles` and
`GET /api/puzzles/{id}` expose its positions.

Any player can submit one of `fun`, `meh`, or `bad`, optional comment, terminal
outcome, and bounded action labels to `POST /api/puzzles/{id}/ratings`. The
request carries the browser's device id in `X-Device-Id`; one device keeps one
rating per puzzle, and rating again replaces it. A signed-in rating also records
the account. One client address may send 30 ratings an hour and the server
1,000; more return 429. The current browser rating submits an empty action list;
it does not yet serialize the player's move trace.

## Development launcher

Challenges is a development-only launcher for pinned Leyline puzzle fixtures. It
exists to exercise real game states and prompt families through the product
board. It is unavailable in production.

## Entry and catalog

The Vite dev server serves Leyline fixtures at `/dev/puzzles/<id>.pzl`; release
builds and the product server do not. The frontend development build exposes
Challenges in desktop navigation.

- `/challenges` lists a small curated set of useful fixtures.
- `/challenges/:id` selects a curated fixture and starts it.
- `/dev/puzzle/:id` preserves direct access to any existing fixture.
Each fixture's `[metadata]` section supplies the name, engine goal, turn limit, and supporting
description. The launcher also accepts editable puzzle text. Validation loads
the exact text in a dedicated browser worker. Editing the text clears any
earlier validation, and a validated candidate can be played directly.

## Match ownership

A challenge starts `greSession` with a puzzle initial state plus
`label`, `objective`, and `/challenges` return context. The normal
`/match/puzzle` route renders `GrePlay`, the classic `Board`, and `PromptDock`.
`greStore` remains the only board state and action owner.

Candidate play passes its validated text into the same launch path. Restart
creates a fresh match from that text.

The board shows the objective during play. Restart first confirms retirement of
the active match, then launches the same initial fixture. A retirement failure
keeps the current match visible and reports the error. Return retires the match
and opens the launcher. Terminal Restart and Return use the same lifecycle.

Challenges has no separate card renderer, stack, target controls, or gameplay
action adapter. Every prompt family available on the normal board is available
to a puzzle fixture.

## Verification

The development journey selects a launcher entry, reaches the standard board,
uses normal prompt controls, reaches an outcome, restarts to the exact initial
position, and returns to the launcher. Production requests for the catalog,
fixture metadata, and arbitrary puzzle starts remain unavailable.
