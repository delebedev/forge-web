# Frontend Route Map

One React root renders every route. `src/app/main.ts` loads `src/app/mount.tsx`,
which mounts `RouterProvider` and `ShellRoot`. `src/app/router.tsx` matches
`location.pathname` against the `ROUTES` table in `src/app/routes.ts`, and
`ShellRoot` dispatches on the resolved route name. Every navigation is
client-side.

## Routes

| Path | Component | Auth? | Purpose |
|---|---|---|---|
| `/` | `LandingPage` | no | Public homepage, AI-vs-AI spectator feed |
| `/about` | `AboutPage` | no | Marketing/info page |
| `/roadmap` | `RoadmapPage` | no | Curated public feature board and account votes |
| `/login` | `LoginPage` | no | Login/signup forms, spectator backdrop |
| `/play/game` | `GameSetupRoute` → `GameSetup` | yes | Constructed setup: deck, format, opponent |
| `/play/limited` | `LimitedRoute` → `LimitedView` | yes | Draft/sealed mode picker, `?mode=draft\|sealed` |
| `/challenges` | `ChallengesView` | dev | Curated puzzle browser; production returns 404 |
| `/challenges/:id` | `ChallengesView` → `GrePlay` | dev | Launch a curated puzzle on the standard match route |
| `/challenge/:challengeId` | `BrowserChallenge` → `GrePlay` | no | Daily bundled puzzle rotation and shared generated puzzle pool |
| `/play/replay` | `ReplayView` | dev | Local operator transcript viewer with completeness and submitted-choice inspection; production returns 404 |
| `/decks` | `DecksView` | yes | Deck browser: list + detail pane + filters |
| `/decks/:deckId` | `DecksView` | yes | Auto-select a deck by its stable ID |
| `/match/:id` | `MatchRoute` → `GrePlay` | yes | Active GRE match route with stored launch config |
| `/dev/puzzle/:id` | `DevLoader` | dev | Auto-boot puzzle, bypasses auth |
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
└─ AppShell (game, replay, match, decks, limited, challenges; development routes bypass auth)
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
terminal generated puzzle can be rated after a guest session is established.

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

Supported browsers use browser execution by default. Play on server, missing
browser capabilities, or a failed browser startup select server execution through
`POST /api/gre/start` and the GRE WebSocket.

### Development challenge
```
/challenges/:id → authStore.ensureSession() → POST /api/auth/guest if needed
  → resolve GET /api/dev/challenges → greSession.start()
  → POST /api/gre/start → GRE WS connect
  → router.navigate('/match/puzzle') → hydrate GrePlay
```

The puzzle supplies its initial state and objective only. `greStore` remains the
sole match-state and action owner. Restart awaits retirement of the current
match before launching the exact same puzzle. Return clears the match and opens
the launcher. `/dev/puzzle/:id` resolves fixture metadata through
`GET /api/dev/puzzles/{puzzleId}` and uses the same match path.

Editable candidates use `POST /api/dev/puzzle-candidates` to validate and retain
the exact draft. `POST /api/dev/puzzle-candidates/{candidateId}/trial` runs a
bounded engine trial. Play starts the ordinary puzzle match with `candidateId`;
it does not depend on a winning trial result.

### Draft
```
/play/limited?mode=draft → pick set → Start Draft
  → draftStore.startDraft() → POST /api/draft/start → {draftPack, pickedCards}
  → pick cards (3 rounds) → POST /api/draft/pick per pick
  → status: Completed → deck_build phase → LimitedDeckBuilder
  → confirm deck → submit → POST /api/draft/deck → {deckId}
  → POST /api/draft/play → {matchId, wireMatchId}
  → GRE joins by matchId (GreStore.resumeGame) → router.navigate('/match/draft')
```

### Sealed
```
/play/limited?mode=sealed → pick set → Open Packs
  → sealedStore.startSealed() → POST /api/sealed/start → {cardPool}
  → deck_build phase → LimitedDeckBuilder (pool pre-populated)
  → confirm deck → submit → POST /api/sealed/deck → {deckId}
  → POST /api/sealed/play → {matchId, wireMatchId}
  → GRE joins by matchId (GreStore.resumeGame) → router.navigate('/match/sealed')

Refresh mid-build: sealedStore.tryResume() → GET /api/courses → restore the
course with a pool but no deckId yet (no session WebSocket to reconnect).
```

### Play saved deck
```
/decks → select saved draft/sealed deck → Play button
  → GRE launch with saved deck ID → router.navigate('/match/draft')
```

### Constructed deck builder
```
/decks → "New" button → DeckEditor (full-width, mode='edit')
  → search cards (GET /api/cards/search) → click to add
  → adjust lands (+/-) → name deck → Save
  → library save → POST /api/decks → committed list and selected deck → browse

/decks → "Import" button → DeckImportDialog (modal)
  → paste decklist → Parse (POST /api/cards/parse-decklist)
  → see structured preview → name deck → "Open in Editor"
  → DeckEditor pre-populated → edit → Save

/decks → select user-owned deck → detail pane → Edit button
  → complete selected value → DeckEditor draft → library save (PUT /api/decks/{id})
```

**Key components:**
- `DeckEditor.tsx` — full-width editor (CMC columns + card search + land controls + stats bar)
- `shared/cards/DeckImportDialog.tsx` — shared parse, commander selection, and validation dialog
- `decks-store.ts` — account and selection correlation, metadata hydration, committed mutation results
- `deck-value.ts` — complete deck values and presentation projections

## WS transports

The only WebSocket in this app is the GRE match runtime — draft and sealed
are REST-only (course API), no session WebSocket.

| Endpoint | Owner | Auth | Recovery |
|---|---|---|---|
| `/gre?matchId={matchId}` | `greStore` | session cookie | GRE reconnect state (sessionStorage) |

## Auth & persistence

### localStorage
| Key | Purpose |
|---|---|
| `forge:game:playerDeck` | Last selected player deck |
| `forge:game:opponentDeck` | Last selected opponent deck |
| `forge:gre:priority-flag:hideStack` | Saved stack-display preference |
| `forge.dismissedPuzzleLoadIds` | Dismissed puzzle intros |

### sessionStorage

| Key | Purpose |
|---|---|
| `forge:gre:lastMatchConfig` | Current tab's GRE launch config for refresh resume; cleared when the match is retired |

Draft/sealed deck-building refresh-resume reads course state from
`GET /api/courses` instead of a stored session ID.

## Auth gate (ShellRoot)

1. `authStore` probes `/api/auth/me` with credentials on startup, except for the
   public browser challenge route.
2. Development challenge routes reuse an account session or mint an anonymous guest session
   through `/api/auth/guest`.
3. Dev mode can bootstrap a session through fake email-code endpoints.
4. `ShellRoot` renders nothing for authenticated `AppShell` routes (`game`,
   `match`, `decks`, `limited`) until `authStore.isAuthenticated` is true — it
   does not auto-redirect an unauthenticated visit to `/login`; the other
   routes (`landing`, `about`, `login`, `not-found`, `challenges`, `dev`) render
   regardless of auth state. Replay remains `AppShell`-hosted but bypasses the
   auth gate and is limited to development builds by `REPLAY_ENABLED`.
5. `LoginPage` navigates to `/play/game` once `authStore` resolves authenticated (on mount or after a successful login); `authStore.logout()` navigates to `/login`.

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
