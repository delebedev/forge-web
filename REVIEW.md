# Review guide

What to flag on a Forge Web pull request, and what to leave alone. It applies
to every reviewer, human or tool. [AGENTS.md](AGENTS.md) routes each owner to
its rules and owns the completion and PR-evidence policy; this file says how to
judge a change against them.

Forge Web is the React browser client and Kotlin product server in front of the
pinned Leyline runtime. The engine owns game rules and legal actions; the
browser presents them.

## How to review

- Treat the PR's **What changes** and **Evidence** sections as claims, not
  proof. Each Claim needs a handle (test, e2e spec, attached screenshot or
  video, or the exercised head) that ran on the reviewed commit, or the gap is
  disclosed. A claim that has no handle and is absent from **Not verified** is
  a finding. Storybook proves authored component state, not live gameplay.
- When the linked issue lists **Done when**, the PR has one Claim per item it
  finishes; tick each Claim against its item. Items under **Left out** are
  deliberately excluded. `Closes` belongs only on the PR that finishes the
  issue; partial or stacked work uses `Refs`.
- Read whole changed files plus their callers, twins and tests. Do not infer a
  bug from a suspicious shape; trace the failing path and state the consequence.
- Read the `AGENTS.md` routing for each touched owner. The usual authorities
  are `docs/architecture-constraints.md` (constraints C1 to C11),
  `docs/architecture.md`, `docs/frontend-routes.md`, ADR-006 for prompts,
  `DESIGN.md` and `CONTEXT.md` for UI and player-facing copy,
  `docs/http-contract.md` for REST contracts, `docs/database-migrations.md` for
  schema changes, and `docs/analytics.md` for tracking and replay.

## Severity

- **Blocking:** fix before merge. Security exposure, data loss and a broadly
  broken shipped path are the extreme of this level, not a separate one.
- **Should fix:** a concrete cost to proof, change cost or clarity. Report it;
  the author may defer it with a stated reason.
- Nothing below that. Where a tool has Important and Nit levels, Blocking is
  Important and Should fix is Nit.

Each finding names the file and line, the failing scenario, its consequence and
the smallest credible fix. One root cause gets one finding. Zero findings is a
valid review.

## Blocking

- **Wrong behavior.** Logic errors, null paths, double handling, leaked
  subscriptions or state. Behavior that contradicts the PR's Claim. Requested
  behavior that is missing or only partly delivered and not listed under Left
  out, including a player-visible flow that does not work end to end.
- **Rules in the browser.** The client decides legality, rebuilds actions from
  card fields or identifiers, or infers a gameplay fact that engine frames own.
  Controls submit the exact `LegalAction` values the engine offered.
- **Prompt lifetime.** Controls not bound to the displayed prompt, or not
  revalidating interaction identity and offered choices before acting. Late
  work that unlocks, publishes over or retires a successor. Retirement,
  cancellation, reconnect, source replacement and teardown that diverge from
  ADR-006. An unsupported prompt hidden instead of kept visible. A shared
  lifetime change without the central expiry, source, rejection and
  publication tests that ADR-006 requires.
- **State ownership.** A second writer for a store field, a component that
  launches games or sends frames itself, or a GRE mutation that does not
  publish through the external-store boundary.
- **Twins that drift.** A change breaks the contract a matched pair shares and
  leaves the counterpart behind: encode and decode, request and response, the
  product server's HTTP responses and the Zod schemas in `wire-schemas.ts`,
  the table model and its migration. A one-sided change that keeps or restores
  the shared contract is fine.
- **Unsafe persistence.** An edited migration that may already have run, or a
  schema change without its new migration.
- **Privacy and public content.** Credentials, customer identifiers, personal
  data, private hostnames or internal diagnostics in source, logs, screenshots,
  video or PR text. Board media with card art visible. Tracking or replay
  changes that break `docs/analytics.md`.
- **Lost access.** A changed interaction that is no longer reachable by
  keyboard or pointer, loses focus, or drops an accessible name.
- **Unproved load-bearing claim.** The only proof of a Claim cannot fail for the
  claimed reason, or a Leyline pin change whose behavior change the PR neither
  names nor proves.

## Should fix

### Scope and seams

- A fix for one prompt, card or screen where the shared owner stays broken. Ask
  for sibling coverage or an explicitly bounded scope.
- Unrelated changes that hide a second product decision, or a submodule pin
  moved as a side effect. Unrequested code is fine when it adds no risk.

### Tests as proof

Name the regression a missing or weak test would catch. Never write "needs more
tests".

- Stale enumerations: a parity test loops over a hand-written list that omits
  the new case.
- Migration loss: calls move, old assertions disappear, the test name stays
  green.
- Missing negative or lifecycle case on the actual regression path; a
  bidirectional fix tested in one direction; order-sensitive behavior asserted
  as unordered contents.
- Wrong layer for the claim: a browser journey for pure logic, or a unit test
  or story claiming live gameplay. Browser selectors follow
  `docs/e2e-selectors.md`.
- Redundant tests guarding the same regression at the same layer while a
  distinct path stays unproved. Trade one for the other.
- Tests coupled to implementation structure, heavy mocks, or setup far larger
  than the assertion.

### Codebase coherence

Before accepting a new component, hook, helper or special case, find the
existing owner of that responsibility. Flag:

- a capability the repository already has, re-implemented under a new name,
  including a public form control or dialog that bypasses `src/shared/ui/`;
- one rule or state transition encoded in two owners;
- a wrapper, abstraction or option with one caller and no invariant to own;
- defensive or compatibility branches for states no caller produces.
  Compatibility belongs only at real version, persistence or API boundaries;
- a half-finished migration that keeps old and new paths or terms alive;
- a caller-side symptom fix that bypasses the owner of the rule;
- breaches of the component constraints: store reads in board leaves, inline
  constants, bulky derived state in component bodies, files growing far past
  the size budget.

Similar syntax alone is not duplication. Ask whether the codebase would get
simpler or harder to change if the next hundred changes followed this pattern.

### Product and documentation

- Player-facing terms that diverge from `CONTEXT.md`, or UI structure that
  diverges from `DESIGN.md`.
- An authority the change made inaccurate, including a `docs/catalog.yaml`
  status that no longer matches player-visible behavior.
- Comments that narrate history or restate the code.

## Do not report

- Anything CI enforces: formatting, lint, type checks, generated CSS types,
  the server parity suite.
- Naming preference, import order, speculative performance, future
  extensibility, or a design-smell label without a concrete cost.
- Issues the change neither introduces nor exposes.
- Mobile or tablet layout, unless the PR targets it.
- Chromatic diffs awaiting approval, unless they show a rendering error or an
  unintended change.
- Generated or third-party content: `src/engine/generated/`,
  `*.module.css.d.ts`, and `leyline/` submodule internals (review only the pin
  change and its stated reason). Review `bun.lock` only for dependency changes
  the manifest does not explain.
- Who or what wrote the code. Judge the change, not its authorship.
