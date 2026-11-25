# Frontend Route Map

One React root renders every route. `src/app/main.ts` loads `src/app/mount.tsx`,
which mounts `RouterProvider` and `ShellRoot`. `src/app/router.tsx` matches
`location.pathname` against the `ROUTES` table in `src/app/routes.ts`, and
`ShellRoot` dispatches on the resolved route name. Every navigation is
client-side.

## Routes

| Path | Component | Auth? | Purpose |
|---|---|---|---|
| `/` | `LandingPage` | no | Public homepage with curated full-game replay |
| `/about` | `AboutPage` | no | Marketing/info page |
| `/roadmap` | `RoadmapPage` | no | Curated public feature board; voting needs an account |
| `/login` | `LoginPage` | no | Login/signup forms, replay backdrop |
| `/play/game` | `GameSetupRoute` → `GameSetup` | no | Constructed setup: deck, format, opponent; saved decks need an account |
| `/play/limited` | `LimitedRoute` → `LimitedView` | account | Draft/sealed mode picker, `?mode=draft\|sealed` |
| `/challenges` | `ChallengesView` | dev | Curated puzzle browser; production returns 404 |
| `/challenges/:id` | `ChallengesView` → `GrePlay` | dev | Launch a curated puzzle on the standard match route |
| `/challenge/:challengeId` | `BrowserChallenge` → `GrePlay` | no | Daily bundled puzzle rotation and shared generated puzzle pool |
| `/watch` | `CuratedWatch` | no | Curated full-game replays with automatic playback and card inspection |
| `/watch/:replayId` | `CuratedWatch` | no | Allowlisted static replay; fresh-game deck handoff |
| `/play/replay` | `ReplayView` | dev | Local operator transcript viewer with completeness and submitted-choice inspection; production returns 404 |
| `/decks` | `DecksView` | account | Deck browser: list + detail pane + filters |
| `/decks/:deckId` | `DecksView` | account | Auto-select a deck by its stable ID |
| `/match/:id` | `MatchRoute` → `GrePlay` | no | Active GRE match route with stored launch config |
| `/dev/puzzle/:id` | `DevLoader` | dev | Auto-boot puzzle |
| `/dev/game` | `DevLoader` | dev | Auto-boot constructed with default deck |
| `/*` | `NotFoundPage` | no | 404 fallback |

Roadmap curation and status changes are described in [roadmap.md](roadmap.md).

`/play/puzzle` and `/play/puzzle/:id` carry no `ROUTES` entry: `PUZZLES_ENABLED`
is off and the puzzle components are deleted, so those pathnames fall through
to the 404 case like any other unmatched path.

## Layout Structure

```
ShellRoot
├─ landing, about, login, not-found, dev — standalone
└─ AppShell (game, replay, match, decks, limited, challenges; only decks and limited need an account)
   ├─ TopBar or LobbyHeader (navigation, account, and match controls)
   └─ Content
      ├─ /play/* routes: padded glass panel
      └─ /match/*: full-bleed game board (no panel chrome)

/match/* layout:
└─ GrePlay (GRE protocol board, prompts, actions, and diagnostics)
```

`ShellRoot` renders `ChallengesView` for the launcher and concrete challenge
ids. Selecting an id starts `greSession` with puzzle context, then the normal
match route renders `GrePlay`, `Board`, and `PromptDock`. The launcher also owns
an editable candidate draft. Validation returns an immutable owner-scoped id;
trial and play refer to that id instead of resending edited text.

The singular `/challenge/:challengeId` route is separate. The public Daily
Puzzle link selects one of eight bundled positions by UTC day. `/challenge/random`
selects from the server's accepted shared pool; UUID links load the accepted
`.pzl` by id. Bundled versioned IDs remain direct and shareable.
All positions start the pinned Forge browser worker in place; no server-backed
match is needed. Retry reuses the worker and position. The owner can generate
a vetted Next puzzle, while other players select a different pool entry. A
terminal generated puzzle can be rated without an account, once per device.

## Stores

Each store is a plain TypeScript class with an explicit `subscribe`/`notify`
shape, read by React through a `createExternalStore` + `useSyncExternalStore`
seams (`src/engine/runtime/hooks.ts`, feature-local hook modules, and `src/features/gre/priority-runtime.ts`).
Single-writer pattern — one store owns each signal.

| Store | File | Owns | Drives |
|---|---|---|---|
| `authStore` | `src/shared/auth/auth.ts` | Cookie session state, player identity | Auth gate, API credentials |
| `greStore` | `src/engine/runtime/gre-store.ts` | GRE state, prompts, actions, connection status | GRE board, diagnostics |
| `greSession` | `src/engine/runtime/gre-session.ts` | Active match config, resume/leave lifecycle | `MatchRoute`, `DevLoader`, cross-route launch |
| `draftStore` | `src/features/limited/draft-store.ts` | Pack, pool, round/pick, draft phase | `DraftPicking`, `LimitedDeckBuilder` |
| `sealedStore` | `src/features/limited/sealed-store.ts` | Pool, sealed phase | `LimitedDeckBuilder` |
| `decksStore` | `src/features/decks/decks-store.ts` | Account-scoped library, complete selected deck, filters, save/delete aftermath | `DecksView`, `DeckEditor` |
| `challengesStore` | `src/features/challenges/challenges-store.ts` | Curated challenge list and selection | `ChallengesView` |

## Navigation flows

### Constructed game
```
/play/game → pick deck (DeckPickerModal) → pick opponent → Start
  → greSession.startBrowser() → router.navigate('/match/constructed')
  → browser worker starts the match → GRE projection → hydrate
```

All games execute locally. Missing browser capabilities and startup failures show
an explicit error and browser retry. There is no alternate server host.

### Development challenge
```
/challenges/:id → resolve GET /api/dev/challenges + GET /api/dev/puzzles/{id}
  → greSession.startBrowser({puzzleText}) → router.navigate('/match/puzzle')
  → worker starts the puzzle → hydrate GrePlay
```

The puzzle supplies its initial state and objective only. `greStore` remains the
sole match-state and action owner. Restart awaits retirement of the current
match before launching the exact same puzzle. Return clears the match and opens
the launcher. `/dev/puzzle/:id` resolves fixture metadata through
`GET /api/dev/puzzles/{puzzleId}` and uses the same match path.

Editable candidates validate authored text in a dedicated browser worker. First
validation explicitly initializes the local engine. Play launches that exact text.
Generation and server engine trials have no product route.

### Draft
```
/play/limited?mode=draft → pick set → Start Draft
  → draftStore.startDraft() → worker `draft` {set, seed, picks: []} → PUT /api/course-records/{event}
  → pick cards (3 rounds) → worker `draft` with the new pick → PUT per pick
  → complete → worker `draft-complete` → pool + bot decks → deck_build phase → LimitedDeckBuilder
  → confirm deck → PUT the deck → {seat1Deck, seat2Deck, courseEvent, courseGame}
  → greSession.startBrowser({seat1Deck, seat2Deck, courseEvent, courseGame, gameType: 'draft'})
  → terminal result → PUT the course's wins/losses
```

### Sealed
```
/play/limited?mode=sealed → pick set → Open Packs
  → sealedStore.startSealed() → worker `sealed` {set, seed} → PUT /api/course-records/{event}
  → deck_build phase → LimitedDeckBuilder (pool pre-populated)
  → confirm deck → PUT the deck → {seat1Deck, seat2Deck, courseEvent, courseGame}
  → greSession.startBrowser({seat1Deck, seat2Deck, courseEvent, courseGame, gameType: 'sealed'})
  → terminal result → PUT the course's wins/losses

Refresh mid-draft or mid-build: {draft,sealed}Store.tryResume() → GET /api/course-records
→ replay the saved picks or reopen the saved pool.
```

### Play saved deck
```
/decks → select saved draft/sealed deck → Play button
  → hydrate both complete decks → browser-local launch → router.navigate('/match/draft')
```

### Constructed deck builder
```
/decks → "New" button → DeckEditor (full-width, mode='edit')
  → search the card index → click to add
  → adjust lands (+/-) → name deck → Save
  → library save → POST /api/decks → committed list and selected deck → browse

/decks → "Import" button → DeckImportDialog (modal)
  → paste decklist → Check deck (browser engine `decklist` command, card fields from the card index)
  → see structured preview → name deck → "Open in Editor"
  → DeckEditor pre-populated → edit → Save

/decks → select user-owned deck → detail pane → Edit button
  → complete selected value → DeckEditor draft → library save (PUT /api/decks/{id})
```

**Key components:**
- `DeckEditor.tsx` — full-width editor (CMC columns + card search + land controls + stats bar)
- `shared/cards/DeckImportDialog.tsx` — shared parse, commander selection, and validation dialog
- `decks-store.ts` — account and selection correlation, card index hydration, committed mutation results
- `deck-value.ts` — complete deck values and presentation projections

## Gameplay boundary

Gameplay frames stay between the browser worker and `greStore`.
There is no product gameplay WebSocket. Draft/sealed generation and course
progress use REST. Static watch streams use saved transcripts.

## Auth & persistence

### localStorage
| Key | Purpose |
|---|---|
| `forge:game:playerDeck` | Last selected player deck |
| `forge:game:opponentDeck` | Last selected opponent deck |
| `forge:gre:priority-flag:hideStack` | Saved stack-display preference |
| `forge.dismissedPuzzleLoadIds` | Dismissed puzzle intros |
| `forge.deviceId` | Random device id for replay uploads, puzzle ratings and telemetry |

### sessionStorage

| Key | Purpose |
|---|---|
| `forge:gre:lastMatchConfig` | Current tab's local launch config; refresh ends the game and offers restart; cleared on retirement |

Draft/sealed refresh-resume reads course state from
`GET /api/course-records` instead of a stored session ID.

## Auth gate (ShellRoot)

1. `authStore` probes `/api/auth/me` with credentials on startup, except for the
   public browser challenge route.
2. Dev mode can bootstrap a session through fake email-code endpoints.
3. `decks` and `limited` need an account. Without a session, `ShellRoot` renders
   the sign-in prompt in place at the requested URL once `authStore` is ready,
   and nothing before then. Every other route renders without an account.
4. The sign-in heading names what the account is for at that destination, and
   the description lists what an account keeps: decks, draft and sealed runs,
   and roadmap votes.
5. `LoginPage` navigates to the allowlisted destination after sign-in:
   `returnTo`, else the current path. `loginReturnPath` allows `/roadmap`,
   `/decks`, `/decks/:deckId`, `/play/limited` with its mode, and the curated
   replay handoff; anything else returns to `/play/game`. `authStore.logout()`
   navigates to `/login`.
6. Without an account, game setup offers starter decks and pasted decklists for
   one game; saving an import needs an account.

## Storybook

`bun run storybook` opens the curated, server-free gameplay catalogue on
localhost:6006. See [storybook.md](storybook.md) for its admission rules,
viewport inspection, and static verification workflow. Live setup, limited,
deck, puzzle, game, and replay routes remain the engine-backed verification
surface.

### Commander import and persistence

The shared `src/shared/cards/DeckImportDialog.tsx` owns parsing, commander
selection, validation, errors, and pending requests for lobby and library imports.
The library opens the editor with the resolved deck. The lobby requires a playable
deck for its selected format, then saves and selects it. Saved Commander decks
require one eligible commander or a compatible pair on both create and update.
Unmarked imports can select an optional second commander. Server validation and
Browser execution use Forge Commander validation for pairing and the combined
color identity of both commanders, including the mainboard and sideboard. The parser returns
mainboard, sideboard and commandZone independently; companions remain rejected.
POST /api/decks creates an account deck, PUT /api/decks/{deckId} updates it in
place. Reads return commandZone. The editor preserves and displays commanders
while editing the mainboard. Copy Decklist includes every persisted section.

The library owns list/detail loading and save/delete aftermath; callers do not invalidate or refetch after mutations. Authentication changes clear account-owned values immediately. Editors retain exact card identities and all sections, and drafts cannot cross account identities. See [ADR-007](adr/007-own-complete-decks-in-the-library.md).

The lobby filters library decks by presence of commandZone and sends that zone
in the Commander launch list. Browser storage remembers a selection; the account
database owns saved decks. Five starter lists based on 2025 archetypes
are provisioned with the ordinary dev seed command.

## Curated watch

The landing table and `/watch` play allowlisted complete games from `public/replays/` through `TranscriptFrameSource` and the production board. They do not initialize the browser engine or start a server match. Each game starts from normal opening hands and plays through its terminal outcome. After a short result dwell, the next game starts automatically. Public viewing has no playback controls, timeline, picker or live-status claim. Card inspection stays available. Playback and pending rotation pause when the page or table is hidden, and stop on unmount. The current matchup's `Play these decks` link opens `/play/game?replay=<known-id>` for a fresh game using those complete decks. The operator file picker, arbitrary `?src` loading and full playback controls remain development-only at `/play/replay`. Exact deck inputs and provenance live in `dev/replays/README.md`.
