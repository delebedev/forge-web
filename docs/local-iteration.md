# Local iteration

Start a fresh product server from the selected worktree at the beginning of an
iteration session. Keep backend and Vite running across agent turns while the
player gives feedback. Stop them when the session is finished. Keep the
worktree-local database and decks between sessions.

## Select and start

For changes spanning Forge Web and Leyline, use the
[coupled fix workflow](#coupled-leyline-fixes).

Use `git worktree list` and the PR head branch to identify the checkout. Read
that checkout's `AGENTS.md`, not another branch's copy. Run `bun run bootstrap`
for a fresh checkout. Run commands from its root. Prerequisites and the
server-free Storybook path are in [README.md](../README.md#quick-start).
Bootstrap resolves the pinned HTTPS submodules without requiring sibling
repositories. Existing sibling clones are optional download caches.
Copy `.env.example` to `.env.local` once for local fixed-login and state defaults;
Export that file in the server terminal and generate a fresh auth secret
as shown below. Do not use these fixed-login settings on a reachable deployment.

Browser execution is the only gameplay host. Unsupported browsers show an error and retry. Run `bun run browser:assets`
once per worktree, and again after changing the engine or catalog, to serve the
browser release from Vite. The build requires Java 17 alongside Java 21.

The backend serves product APIs and catalog data. It does not run games. Start these in durable terminals or a process supervisor:

```bash
set -a
. ./.env.local
set +a
export LEYLINE_WEB_AUTH_SECRET="$(openssl rand -hex 32)"
bun run server
```

```bash
bun run dev --host 127.0.0.1 --port 5173 --strictPort
bun run dev:seed
```

Keep the auth secret stable across backend restarts in the same session.
The browser runs games without engine animation sleeps and owns presentation timing.
Additional-cost choices use Forge descriptions in GRE text parameters.
Native prompt ids remain a browser compatibility fallback.

## Coupled Leyline fixes

Use one Forge Web worktree and a feature branch inside its `leyline/` submodule.
Bootstrap before creating that branch; bootstrap restores the committed pin.
Follow each repository's instructions and install the Leyline purity hooks for
the submodule clone before editing. Implement and test both changes together.
Push the Leyline branch before committing its SHA as the Forge Web pin, then
open both PRs so review and CI can run concurrently.

Land Leyline with a regular merge commit (`gh pr merge --merge`) for this
workflow; it preserves the pinned SHA. This requires merge commits enabled in
Leyline's repository settings. After fetching Leyline `origin/main`, verify the
pin contains the final reviewed changes and is reachable from `origin/main`
before landing Forge Web. Rebase or review fixes that change the Leyline SHA
require a pin update and affected checks. Keep the shared checkout until both
PRs have landed. No tag is needed.

When repository settings permit only squash merges, land Leyline first and pin
the resulting commit from `origin/main`. Verify its tree matches the reviewed
and tested candidate, then run the affected Web checks on that final pin. Do not
publish an intermediate local merge SHA or change repository merge settings to
preserve it.

## Player counters

Player counter totals use persistent Counter annotations and their seat identity. Transient additions and removals remain game events rather than displayed totals. The player plate shows named positive totals near life, including Poison and Energy. Emblem inspection remains available with card art hidden.

## Game log

Open **Game log** from the table controls to inspect recent casts, land plays,
supported zone transitions, damage, and life changes. Entries show the latest
events first and retain up to 100 events for the current match. Hidden card
identities remain unnamed. Reconnecting preserves history while a new match
clears it.

The authored burn scenario exercises the Browser flow:
`bun run gre -- -g 'game log explains'`.
Set `PRIORITY_DEMO_VIDEO=1` to produce a desktop proof clip with card art hidden.

## Remote browser feedback

A Tailscale proxy may keep the same URL between sessions. Its upstream must
point to this session's frontend. Vite forwards product API requests to the backend.
Gameplay stays in the browser worker. Add the exact hostname to `VITE_ALLOWED_HOSTS`.
Use tailnet-only Serve, not Funnel.

Before handing over, verify frontend, proxied API, and a live GRE interaction
through the shared URL. Report the worktree, revision, URL, and dev login.
An HTTP 502 with working Tailscale usually means the local upstream stopped.

## Feedback loop

- Frontend edits hot reload. Backend edits require a restart of product APIs. Browser games stay in their workers.
- Sign in as the provisioned account. Refresh the deck library after seeding.
- Reload the page after a catalog change or backend restart.
- Board options → Hide card art uses the same artwork suppression as Storybook and persists per browser. It keeps card names, rules, mechanics and geometry visible for screenshots.
- Board sizing persists per browser. Reset uses the current frontend defaults.
- Connection details beside the cog exposes traffic, errors, and logs.
- Verify pointer hit targets with actual pointer clicks. Accessibility actions
  can activate controls even when an invisible overlay intercepts mouse input.
- Use focused tests while iterating, then `bun run check`, `bun run build`,
  `bun run server:check`, and `bun run runtime:check` at the merge boundary.

Managed Playwright commands accept `FORGE_WEB_PLAYWRIGHT_FRONTEND_PORT` and
`FORGE_WEB_PLAYWRIGHT_BACKEND_PORT` for parallel worktrees. The product suite
also accepts `FORGE_WEB_PLAYWRIGHT_PREVIEW_PORT` for its built frontend. Choose
distinct ports per active stack. Values are validated before startup, listeners
use strict ports, and each run starts its own servers and state directory.

```bash
FORGE_WEB_PLAYWRIGHT_FRONTEND_PORT=15214 FORGE_WEB_PLAYWRIGHT_BACKEND_PORT=18214 bun run gre -- -g 'Citadel exposes'
```

Gameplay proof specs can import `test`, `recordDemos`, and `readyForVideo` from
`e2e/demo-test.ts`. Set `PRIORITY_DEMO_VIDEO=1`, then add the page to
`readyForVideo` only after Hide card art is enabled and the scenario is ready.
The fixture attaches an MP4 using the existing screenshot-frame recorder.

There is no unified `dev up` / `dev down` command yet.

## Board state fixes

Run `bun run storybook` and open **Gameplay / Objects / Attachments** for attachments and
counter badges. Its bounded stage control folds authored GRE messages through
the production accumulator and projection. Use the other focused gameplay
stories for layout and prompt iteration without a backend; the curation rules
and static verification commands live in [storybook.md](storybook.md).

Update the relevant story fixture when pinning another useful visual state.
Verify the matching live interaction before treating a story as proof of game
behavior. Keep actual power/toughness engine-authoritative: counter badges
explain the totals and must never add to them again.

## Commander casting

Commanders remain beside the hand while in the command zone, marked `CMD`,
even without mana or during the opponent turn. The rail uses command-zone
objects and Commander designations for visibility, and exact legal actions for
casting. It follows the new object identity after a commander returns.

Start the server with `LEYLINE_WEB_DEV_TOOLS=true`. The flag exposes fixture
metadata and authored puzzle text reads; it defaults to false.
Development frontend builds show the Challenges navigation. Validate starts a local
browser engine on first use and reports validation issues. Play launches the authored
text on the standard local board. Generation and engine trials are not product APIs.

After signing in locally, open `/dev/puzzle/commander-return-self-bolt`. Cast
Lightning Bolt at Arabella, accept the command-zone return, and click her card
in the rail to recast. The fixture starts with one commander cast, so recasting
spends four mana including tax. This uses the pinned engine's existing puzzle.

Run both the puzzle lifecycle and a normal Commander opening with:

```bash
bun run gre -- -g 'commander returns after self-bolt|Commander match offers'
```

The browser checks click the visible rail cards and save screenshots in the
Playwright output directory.

For empty opponent priority stops, use `/dev/puzzle/priority-cycling-unpayable`
and `/dev/puzzle/priority-cycling-payable`. With no mana, Shark Typhoon's cycling
must not interrupt the opponent turn. With two Islands, it must offer a response
at upkeep. `opponent cycling priority` browser checks compare the web settings
with the engine's native defaults and retain the decoded engine emissions.

## Library reordering and optional shuffle

Optional shuffles after library reordering show **Shuffle the library?** with
Accept and Decline. Decline retains the chosen order; accepting leaves the
shuffle to the engine before resolution continues. The seeded Ponder branches
exercise actual pointer choices, draw identity, card conservation and continued
play with `bun run gre -- e2e/gre-optional-shuffle.spec.ts`.

## Top-library casting

Cards with a legal library action appear beside the hand with a `TOP` source
label. Click the card to submit its exact supplied action. Inspection through
Library remains available while the engine permits it.

The Citadel check casts Grizzly Bears for two life, advances to Forest, then
removes the Citadel and verifies that library actions and inspection disappear.
Run it in Browser execution with:

```bash
bun run gre -- -g 'Citadel exposes'
```

Set `PRIORITY_DEMO_VIDEO=1` to retain desktop video with Hide card art enabled.

## Hand inspection and adjusted costs

Cards exposed by hand-inspection effects appear in the opponent hand fan and
can be inspected in the existing card viewer. Concealed cards retain their
slots. Removing the permission closes stale inspection surfaces and conceals
the identities. The authored Telepathy scenario checks this lifecycle, delayed
images, continued play and a new-match reset in Browser execution.

The gameplay cost scenarios cover zero and two multikicker payments, K’rrik
life payment for Flashback with cancellation and retry, and Strong Back equip
reduction with all lands tapped. Run the focused desktop flows with:

```bash
bun run gre -- -g 'known opponent hand is inspectable|Multikicker accepts|Krrik flashback|Strong Back permits'
```

Set `PRIORITY_DEMO_VIDEO=1` to retain clips with Hide card art enabled.

## Combat damage choices

Damage may be split freely among multiple blocking creatures, including zero on
one blocker. The draft must assign the attacker's entire damage total. Creature
rows show lethal thresholds, not unconditional minimum assignments. Assigning
trample damage to the defender still requires lethal damage on every blocker,
including the reduced lethal threshold from deathtouch.

## Phasing

Open `/dev/puzzle/phasing-kaito-cycle`, cast Kaito Shizuki, then pass through the
opponent turn. Kaito remains in place as a subdued card labeled Phased out, with his name and
loyalty visible. Hover and keyboard focus still inspect him, but gameplay actions
are unavailable. At the next upkeep he returns to normal with the same identity
and loyalty. His -2 ability can then create a Ninja.
The desktop `Kaito phases out` GRE check exercises this cycle; set
`PRIORITY_DEMO_VIDEO=1` to retain a video with Hide card art enabled.
