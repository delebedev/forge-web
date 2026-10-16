# Contributing to Forge Web

Help improve solo AI play, deck testing, puzzles, limited practice, accessibility,
and documentation. Independent tools and agents are welcome. The engine owns
game rules and legal actions; the browser presents them. Human-versus-human
matchmaking and shared agent coordination infrastructure are outside this scope.

Small fixes can arrive as pull requests. Discuss substantial changes in an
issue before building them. Maintainers choose scope, merges, and releases;
there is no promised response time or release cadence. Fixes use the normal review and test process.

## Start locally

Follow [README.md](README.md#quick-start) for prerequisites, bootstrap, the
seeded development account, and the lighter Storybook path. Follow
[local iteration](docs/local-iteration.md) for ports and engine-backed scenarios.
A fresh clone resolves pinned HTTPS submodules itself. Optional sibling caches
speed downloads but are not part of the build contract. Do not change submodule
pins as a side effect of setup.

Create a feature branch. Keep changes focused and run the tests that exercise
the behavior you changed. Frontend checks include `bun test path/to/file.test.ts`
and `bun run typecheck`; use the existing browser scenario for gameplay changes.
Describe the problem, the resulting behavior, and what you actually verified.
For UI changes, inspect the affected desktop flow. Hide card art before sharing
board screenshots and use synthetic accounts and decks.

Read [AGENTS.md](AGENTS.md) for the code ownership and architecture routes.
Follow the existing module boundaries and controls rather than adding a parallel
framework. Do not include credentials, player reports, personal data, or local
state in source, screenshots, logs, issues, or PR attachments. `.env.local` is
ignored; `.env.example` contains local defaults only.

## Feedback and security

Use GitHub issues for public bugs or ideas without private data. Feedback is
also welcome through [the contact page](https://forgeweb.app/about) or
[hello@forgeweb.app](mailto:hello@forgeweb.app), with no GitHub account required.
Local/fork copies route report links to their About page and do not forward
match or account identifiers to the production form.

Send vulnerabilities privately using [SECURITY.md](SECURITY.md).
