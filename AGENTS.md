# forge-web

React 19 browser UI and Kotlin product server over the pinned Leyline runtime.
Bootstrap fresh clones with `bun run bootstrap`. From the desired base
checkout, create ready sibling worktrees with `just ws <branch>`.

## Routing

- **Product language:** read `CONTEXT.md` before naming product concepts or
  writing player-facing copy.
- **UI composition:** read `DESIGN.md` before changing a public journey or
  visual structure.
- **Public controls:** before adding or styling a form control or dialog, check
  `src/shared/ui/` and `DESIGN.md`'s Actions and fields section. Keep gameplay
  controls feature-local.
- **Scope:** check `docs/catalog.yaml` before planning product work.
- **Frontend code:** read `docs/architecture-constraints.md` before editing
  components, stores, generated types, or imports.
- **Data flow:** read `docs/architecture.md` and `docs/frontend-routes.md` before
  changing routes, state ownership, navigation, or transports.
- **Prompt families:** before adding a prompt or changing its lifetime, read
  [ADR-006](docs/adr/006-family-owned-prompt-controls.md). Keep request rules and
  drafts in the family; prove shared lifetime changes through central expiry,
  source, rejection, and publication tests.
- **Local feedback:** follow `docs/local-iteration.md` when starting servers,
  selecting a worktree, seeding decks, or sharing a browser preview.
- **Coupled Leyline fixes:** follow `docs/local-iteration.md#coupled-leyline-fixes`
  for changes spanning this repo and its Leyline submodule.
- **Storybook:** read `docs/storybook.md` before adding or changing stories,
  interaction checks, or visual coverage.
- **Browser tests:** read `docs/e2e-selectors.md` before adding selectors or
  journeys. For scripted debug-bridge tests, consult
  `src/shared/debug/gre-debug-bridge.ts`.
- **Browser driver:** read `tools/browser-driver/AGENTS.md` before running
  autonomous gameplay, evaluating puzzle candidates, or changing the driver.
- **Analytics:** read `docs/analytics.md` before changing tracking, replay, or
  privacy behavior.
- **SEO:** read `docs/seo.md` before changing public HTML, metadata, or routes.
- **Challenges:** read `docs/specs/forgeweb-challenges.md` before changing the
  challenge product.

## Delivery authority

- **Delivery authority.** Implementation requests authorize task branches/worktrees, scoped commits, non-destructive pushes, PR creation, and in-scope CI repair. Ordinary implementation ends at a review-ready PR; reviews and audits remain read-only unless fixes are requested.
- **Merge authority.** “Ship it”, “land it”, or “fix and merge” authorizes merging the identified task after required checks and review findings are handled. An explicitly authorized recurring workflow may grant the same authority. “Let me look”, “prepare a PR”, or another review hold blocks merging and auto-merge until explicitly released. Silence is never approval; deliver the PR without repeatedly asking to merge.
- **Decision boundaries.** Resolve routine implementation choices. Ask for materially different product outcomes, scope or access expansion, destructive loss of work/data, or unapproved spending/operational impact. Shared state alone is not a blocker. Preserve unrelated work; isolate it rather than stopping.
- **Deployment.** Merge authority does not imply production deployment authority. Check automatic release/deployment effects before merging and proceed only when covered by the request or standing service policy.

## Completion

Start with focused tests. At the PR boundary run:

```bash
bun run check
bun run build
bun run server:check
bun run runtime:check
```

UI changes require visual verification at the affected viewport. Use
`bun run product:smoke` for product-path coverage. Record acceptance evidence
with a desktop browser by default. Mobile and tablet checks are on demand only.
Inspect Chromatic diffs against the PR scope and rendered UI. Fix unintended
regressions and continue when changes are expected. Escalate only when you cannot
confidently judge a visual change. Pending Chromatic UI Tests or UI Review
approval alone does not block PR completion; rendering errors still require a fix.
The legacy `challenge:video` command hardcodes iPhone; use it only for an
explicitly requested mobile recording. Work on a feature branch
and merge through a PR; keep `main` releasable.

## PR evidence

Attach a useful desktop screenshot or short video when it shows a
player-visible result that the diff and CI cannot show. Use an authored local
scenario with synthetic account and deck data. Inspect the media before upload;
attach only media free of customer identifiers, credentials, private hostnames,
and internal diagnostics. Enable **Hide card art** before capturing game-board
media.

Present screenshots in a two-column table: a short description of the state and
visible result on the left, the screenshot on the right. Use **Before** and
**After** rows when comparison clarifies the change, with the same scenario and
viewport. Otherwise show only new states, one annotated row per screenshot.

Keep original customer submissions, production replays, and logs in the private
issue. A locally recreated report scenario that meets the checks above may
appear in both the private issue and the public PR. Attach media with
`gh pr create --attach` or `gh pr edit --attach`; an attachment is optional when
tests and the diff already explain the outcome.
