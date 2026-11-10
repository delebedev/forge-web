# forge-web

Forge Web is a browser workbench for solo play against Forge AI, deck testing,
puzzles, and limited practice. The pinned Leyline rules and AI run locally in
a browser worker. A Kotlin product server supplies accounts, saved decks, catalog
queries, validation, draft generation and course progress. It is an independent,
unofficial project with no human-versus-human matchmaking.

## Quick start

Requires Git, Node.js 24, Bun 1.3+, JDK 21, Maven 3.9+, Python 3, and
[just](https://just.systems/). Install JDK 17 as well for browser execution.
Ensure Java installations are discoverable by Gradle. macOS and Linux are the
current development targets. Bootstrap downloads the pinned submodules and
build dependencies. Sibling caches are optional; production credentials are
not required.

```bash
git clone https://github.com/delebedev/forge-web.git
cd forge-web
bun run bootstrap
cp .env.example .env.local
set -a
. ./.env.local
set +a
export LEYLINE_WEB_AUTH_SECRET="$(openssl rand -hex 32)"
bun run server
```

In a second terminal:

```bash
bun run dev --host 127.0.0.1 --port 5173 --strictPort
```

Once the server is ready, seed the development account:

```bash
bun run dev:seed
```

Open the URL printed by Vite. The seeded development account is
`player@example.test` with code `123456`. See
[Local iteration](docs/local-iteration.md) for worktrees, alternate ports, and
remote browser feedback. Fixed login codes are for local development only.
Keep `.env.local` and your state directory out of Git.

For UI work without a backend or engine build:

```bash
bun install --frozen-lockfile
bun run storybook
```

Open the printed URL and choose a Shared UI or Gameplay story. Storybook uses
authored scenarios; it does not prove engine behavior. For full browser play,
run `bun run browser:assets` after bootstrap and whenever the runtime changes.
Server execution can be used without those browser assets.

## Product surfaces

- `/` — public AI-versus-AI spectator feed.
- `/challenge/:id` — a direct, curated browser puzzle link with anonymous play.
- `/challenges` — development-only scenario editor, not a public puzzle gallery.
- `/play/*` — authenticated constructed and limited play.
- `/decks` — deck browser and editor.

## Repository

- `src/` — React application and GRE client.
- `server/` — product server, authentication, persistence, and content.
- `e2e/` — browser journeys and screenshots.
- `dev/decks/` — development deck fixtures.
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
- [Challenges](docs/specs/forgeweb-challenges.md)
- [Changelog](CHANGELOG.md)

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
