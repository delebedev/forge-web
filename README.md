# forge-web

Forge Web is a browser workbench for solo play against Forge AI, deck testing,
puzzles, and limited practice. The pinned Leyline rules and AI run locally in
a browser worker. A Bun product server supplies accounts, saved decks, catalog
queries, validation, draft generation and course progress. It is an independent,
unofficial project with no human-versus-human matchmaking.

## Quick start

```bash
git clone https://github.com/delebedev/forge-web.git
cd forge-web
bun run bootstrap
```

[Local iteration](docs/local-iteration.md) owns the prerequisites, starting the
server and Vite, the seeded development account, worktrees and the
Storybook-only path.

## Product surfaces

- `/` and `/watch` — continuous playback of curated saved games.
- `/challenge/:id` — a direct, curated browser puzzle link with anonymous play.
- `/challenges` — development-only scenario editor, not a public puzzle gallery.
- `/play/*` — authenticated constructed and limited play.
- `/decks` — deck browser and editor.

## Repository

- `src/` — React application and GRE client.
- `server/` — product server (TypeScript on Bun), authentication, persistence, and replays.
- `e2e/` — browser journeys and screenshots.
- `content/decks/` — starter decks the product ships and development seeds.
- `docs/` — product, architecture, and development documentation.
- `leyline/` — pinned game runtime and protocol implementation.

## Contributing

Code, puzzles, documentation, and independent agents are welcome. Small fixes
can arrive directly as pull requests; discuss substantial ideas first. See
[CONTRIBUTING.md](CONTRIBUTING.md) for setup and scope. Participation is optional,
and maintainers choose what to review, merge, and release without a response SLA.

Feedback does not require GitHub: use [the contact page](https://forgeweb.app/about)
or [email the maintainer](mailto:hello@forgeweb.app). Local copies do not embed
production feedback forms. Report vulnerabilities using [SECURITY.md](SECURITY.md).

## Documentation

- [Design direction](DESIGN.md)
- [Feature catalog](docs/catalog.yaml)
- [Architecture](docs/architecture.md)
- [Routes and transports](docs/frontend-routes.md)
- [Analytics and privacy](docs/analytics.md)
- [Authentication boundaries and abuse budgets](docs/authentication.md)
- [Challenges](docs/challenges.md)
- [Card images](docs/card-images.md)

## Verification

```bash
bun run check
bun run build
bun run server:check
bun run runtime:check
```

`bun run check` includes every unit test through `bun run test`. The replay
lifecycle file runs exactly once in a separate Bun process with
`BUN_JSC_useConcurrentJIT=false`; its strict weak-reference assertions are unchanged.
Bun 1.3.11 reproduces extra native-rooted collectors with concurrent JIT enabled,
but the exact native retaining mechanism is unresolved. The isolated process
keeps JIT enabled and compilation synchronous. Ordinary tests and production keep
their default JIT settings. Ordinary results are preserved in
`test-results/unit/junit.xml` before the isolated run writes `test-results/junit.xml`.

## License

Original Forge Web source is [GPL-3.0-only](LICENSE). Dependencies, fonts,
sounds, and game content retain their own terms; see [NOTICE](NOTICE).
