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
The owner sees Generate next; it starts a vetted server job and shows its
progress before opening the accepted puzzle. Other players get another puzzle
from the pool. If the pool is empty or unavailable, the bundled browser
challenges remain playable as a fallback. The worker's versioned assets can be
cached; the release manifest revalidates. Browser play is not part of the
generation gate.

Bundled challenges have one authored catalog: `public/challenges/*.pzl`.
`bun run challenge:manifest` derives the frontend manifest from each file's
metadata, and builds reject a stale manifest. Do not maintain a parallel
TypeScript list.

## Generated puzzle pipeline (server)

The product server keeps an owner-triggered generation job and a shared accepted
puzzle pool in `player.db`. Set `OPEN_ROUTER_API_KEY` and
`FORGE_WEB_PUZZLE_GENERATOR_EMAIL` to enable generation; otherwise the pool
remains readable but no job can start. One job runs at a time. Its polling
status reports idea, building, engine test, shortcut check, and ready/failure.
The browser session cookie is explicitly SameSite=Lax, and the billable
generation POST rejects a cross-origin Origin header.

The job samples 20 Forge cards, asks Jev to rank seeds, asks Gemini Flash via
OpenRouter for one `.pzl` per tried seed, then loads and executes each candidate
in the headless engine. Publication requires a won main trial and a lost control
trial with the featured card removed. An observed control win rejects the
candidate. The loaded candidate must declare a one-turn Win goal. Both trials
store bounded decisions and GRE event summaries; Jev
receives these plus the puzzle position for an advisory interest assessment.
The control is a necessity probe, not exhaustive shortcut search. Model and
prompt version, failed drafts, validation, trials, and assessment remain in
the private generation ledger. A job has a 60-second budget and returns a
failure status rather than a weak fallback puzzle.

SQLite is the source of truth for accepted puzzles that can be added without a
web release. Checked-in `.pzl` files are the small offline fallback and browser
regression set. Remote publication must use an owner-only validation route; it
must not write directly to `player.db`.

`GET /api/puzzles` and `GET /api/puzzles/{id}` expose accepted positions.
`GET /api/puzzles/capabilities` tells the UI whether the current session may
generate. The owner can start `POST /api/puzzles/generate` and poll
`GET /api/puzzles/runs/{id}`. Authenticated players can submit one of `fun`,
`meh`, or `bad`, optional comment, terminal outcome, and bounded action labels
to `POST /api/puzzles/{id}/ratings`. The current browser rating submits an
empty action list; it does not yet serialize the player's move trace.

## Development launcher

Challenges is a development-only launcher for pinned Leyline puzzle fixtures. It
exists to exercise real game states and prompt families through the product
board. It is unavailable in production.

## Entry and catalog

`LEYLINE_WEB_DEV_TOOLS=true` enables the server catalog and explicit routes. The
frontend flag defaults to false. The frontend development build exposes Challenges
in desktop navigation.

- `/challenges` lists a small curated set of useful fixtures.
- `/challenges/:id` selects a curated fixture and starts it.
- `/dev/puzzle/:id` preserves direct access to any existing fixture.
- `GET /api/dev/challenges` returns curated fixture identity and display metadata.
- `GET /api/dev/puzzles/{puzzleId}` returns metadata for a direct fixture link.

Fixture metadata supplies the name, engine goal, turn limit, and supporting
description. The launcher also accepts editable puzzle text. Validation loads
the exact text through the engine and returns an opaque candidate id only when
the puzzle is valid. Editing the text clears that id and any earlier validation
or trial result.

Validated candidates are immutable, owner scoped, and held in bounded memory.
The developer may run a bounded engine trial or play the candidate directly;
a lost or inconclusive trial remains a trial result and does not make a loaded
puzzle invalid. Candidate validation, trial, and launch routes are installed
only when `LEYLINE_WEB_DEV_TOOLS=true`.

## Match ownership

A challenge starts `greSession` with a puzzle initial state plus
`label`, `objective`, and `/challenges` return context. The normal
`/match/puzzle` route renders `GrePlay`, the classic `Board`, and `PromptDock`.
`greStore` remains the only board state and action owner.

Candidate play passes only its server-owned candidate id into the same launch
path. Restart resolves that id to the same validated text and creates a fresh
match from the same initial position.

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
