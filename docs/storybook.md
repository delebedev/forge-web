# Storybook catalogue

Storybook is operational and is the default server-free iteration surface for
Forge Web gameplay UI.
Run it with `bun run storybook`, or build the static catalogue with:

```sh
bun run build-storybook
```

For remote feedback, use Tailscale Serve with a dedicated HTTPS port pointing
at the loopback Storybook server. Keep it tailnet-only and supervise the server
for the feedback session. Set the exact hostname through the same
`VITE_ALLOWED_HOSTS` variable as the product preview:

```sh
VITE_ALLOWED_HOSTS=<tailnet-host> STORYBOOK_PUBLIC_PORT=6010 bun run storybook -- --host 127.0.0.1 --port 16010 --exact-port --ci
tailscale serve --bg --https=6010 http://127.0.0.1:16010
```

Use distinct local and HTTPS ports so Storybook's port check does not conflict
with Tailscale. `STORYBOOK_PUBLIC_PORT` routes hot reload through HTTPS.

Verify the manager, preview iframe, font assets and hot-reload WebSocket through
the HTTPS URL before sharing it. Do not remove a checkout while its supervisor
still points to it. The machine-specific supervisor lives outside the repository.

Stories render production components with authored, typed inputs. Use the
viewport toolbar for desktop, phone portrait, and phone landscape inspection.
Use 1440×900 as the single desktop viewport. Add viewport modes deliberately
when they cover a supported layout or an existing regression case.
Use the Card art toolbar toggle to inspect card layouts without images.
Phone views expose current constraints; they do not establish mobile support.

Prefer configuration over duplication: use bounded args and Controls for
variants of the same layout or interaction contract, and Chromatic modes for
variants requiring visual coverage. Add a story only for a distinct contract
that an existing story cannot express clearly. Prefer an ordinary state and
one deliberate stress case. Keep protocol fields, callbacks, and raw snapshots
out of Controls. Storybook Actions reports fixture callbacks; those
callbacks may demonstrate a supplied choice but never invent legality or a game
outcome.

Co-locate a story with the feature it exercises. Keep shared fixtures small,
typed, deterministic, and local to the catalogue. Update the relevant story in
the same change as its component. Consolidate superseded variants and leave
test-only cases in focused tests when they add no useful visual example.

## Visual review with Chromatic

Chromatic is optional and disabled by default. To enable it, set the GitHub
Actions repository variable `CHROMATIC_ENABLED` to `true` and create a Chromatic
project for this repository. Keep its project token in the
`CHROMATIC_PROJECT_TOKEN` GitHub Actions secret and in a local environment
variable when running manually. Never put the token in source or command history.

```sh
bun run build-storybook
bun run chromatic --storybook-build-dir storybook-static
```

The Chromatic workflow runs on relevant pushes to `main` and `codex/**`, or
manually. It captures desktop views at 1440px with card art hidden. Layout families
and text fit also cover hand and thumbnail sizes. Midgame also captures phone
portrait and landscape views; mechanic help covers single and dense
configurations. Casting, selection, and X payment modes cover their distinct
interaction branches. These modes do not add entries to the sidebar. The Motion
group checks ordinary and reduced-motion playback.

Full visual runs are the default. Chromatic unlocks TurboSnap after ten
successful CI builds; then `onlyChanged` can be enabled in the config file. The
Storybook build emits dependency statistics for that option. Visual differences
do not fail the workflow; rendering errors still fail. Builds on `main`
automatically accept changes to keep the baseline current after merge. PR branch
changes remain available for agent review under the completion policy in
`AGENTS.md`.

Keep component interaction checks in story `play` functions, visual baselines
in Chromatic, and engine-backed product journeys in Playwright. Each check has
one owner; there is no separate Storybook browser or screenshot suite.

## Navigation

- **Gameplay**: whole-board scenarios, legal actions, decisions, objects, motion,
  replay, and session state. Attachments and emblems share the Objects group.
- **Cards**: isolated card rendering and mechanic help.
- **Shared UI**: buttons, fields, and modals used outside gameplay.

Keep the sidebar ordered from the ordinary board through focused interactions,
then isolated components. Use explicit meta IDs to preserve story links and
browser-test references when display titles or groups change. New stories belong
under one of these roots; add a subgroup only when it identifies a distinct
surface worth finding independently.

## Card catalogue

`Cards / Rendering` keeps six distinct checks:

| Story | Question | Control |
| --- | --- | --- |
| Ordinary types | Frame materials, colors, stats, and token treatment | Size |
| Layout families | Each structural recipe, including linked faces | Size |
| Dynamic states | Current stats, progression, gained keywords, and hidden identity | Size |
| Gameplay chrome | Playable and selected highlights in the production wrapper | Fixed production variants |
| Production sizes | Compare the five size roles side by side | Specimen: short, dense, mana-heavy |
| Text fit | Rules inset, density, title fitting, and six-pip costs | Size |

Use the shared production size roles rather than adding another size-specific
story. Typography uses the chosen production fonts; font auditions are temporary
experiments. Ordinary examples cover visible frame differences, not every rules
keyword that uses the same layout. Mechanic help has one Panel story with a
Density control for single, several, and dense examples alongside the inspected
card.

Storybook proves rendering and local interaction only. Use live development
routes and engine-backed browser checks for game behavior.
