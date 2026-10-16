# Browser driver

Keep browser orchestration and semantic UI execution here. Leyline owns puzzle
loading, engine trials, and copilot decisions; reuse the normal gameplay board.

## Run

1. Select the checkout and backend using [local iteration](../../docs/local-iteration.md).
   Confirm dev tools are enabled and the chosen entry has the required player
   session. Use real Node for standalone Playwright, Bun for repository scripts.
2. Run `node --experimental-strip-types tools/browser-driver/cli.ts --help`
   from the checkout root. Choose the workload, finite time/action budgets, and
   a fresh output directory. The driver opens its own browser; a match URL
   needs that match owner's session and does not attach to an existing tab.
3. Run headed through visible entry and gameplay controls. Retain the report
   and terminal screenshot; retain trace/video when timing, missing controls,
   or a demo require the interaction sequence. Finish with a terminal verdict
   or an explicit bounded failure, including the last observed position.
4. Inspect the report and relevant visual evidence. Count win/loss/draw only
   from the authoritative terminal state; preserve other failure classifications.
   Separate engine loading, engine-trial success, and browser success; a loss
   or timeout alone establishes neither invalidity nor unsolvability.
   Report the observed objective or interaction, input, local source revision,
   observed backend release (or unknown), outcome, and evidence paths.

For generated candidates, inspect [generate.ts](generate.ts) for invocation and
provider configuration. Retain the original `.pzl` and `.generation.json`;
save edits as new candidates and evaluate each through the candidate entry.
Treat generation as a proposal until the engine loads it. A successful solution
establishes that path, not difficulty, uniqueness, or fun.

## Improve

1. Reproduce the first failing decision from the retained input and report.
   Identify the owner: candidate, advisor, runtime, UI, driver, or environment.
   Preserve the proposal, visible controls, and before/after prompt identities
   so the owning ticket explains the mismatch.
2. Change the reusable behavior for that decision family. Before changing
   selectors, read [selector contracts](../../docs/e2e-selectors.md). Keep move
   selection in the advisor and scenario setup in fixtures.
3. For behavior changes, add a focused regression and rerun the failing live
   interaction plus a nearby control with the same driver. For new gesture
   support, include a browser fixture where a missing or stale control must
   fail before acting. Close the ticket only when its observed failure is
   resolved; attach evidence and retain any unexercised limits.

## Trust boundary

- **Whitebox advice:** consult the active match's Forge AI through its live
  GameBridge. Describe results as engine-informed UI execution. Copilot
  reconstruction from a client snapshot and visual judgment need separate
  verification. Try engine evaluates its own disposable match.
- **Visible execution:** use actionable DOM controls for every gameplay action.
  Read `__greState()` only for match/prompt identity, progress, and outcome.
  Never force clicks, submit GRE responses, call the debug action bridge, or
  add puzzle-specific move sequences to make a run pass.
- **Freshness:** match advice to the exact live prompt before each gesture.
  Reconsult changed prompts within the run budget. Stop explicitly when an
  intent or entity cannot be represented by the visible controls.
