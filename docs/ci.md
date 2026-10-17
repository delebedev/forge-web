# CI and publication

Web CI runs for every push to `main`. Main requires every regular gate. PRs select build scope and browser proof
breadth independently from their changed paths. A manual Web CI
dispatch always runs the full suite.

After a squash or native stack merge, main can reuse a successful internal PR run when its
`ci-proof` artifact names the same Git tree and all regular gates. Only full-breadth proof can be reused. Representative PR proof never bypasses
main regression checks.
For a merged native stack, lookup prefers its final PR after verifying the stack
is closed and its tip shares the associated PR’s exact merge commit and repository.
Tree identity includes tracked build configuration and submodule pins. It is
read from the tested checkout, including GitHub's temporary PR merge commit.
Different content, partial coverage, missing or expired proof, and lookup or
download errors cause a full main run. The main CI gate records the source run
when proof is reused. SHA-bearing release builds are still produced from main.

Publish Forge Web waits up to 45 minutes for successful main Web CI at its exact
commit, including the CI gate. Failed or cancelled CI blocks publication.
Publication builds with production configuration, uploads private source maps,
validates the new server distribution and packages the release. Source tests,
curated autoplay games, release-classifier tests and packaging tests belong
to Web CI.

The production release classifier still compares the cumulative diff against
the live backend. Candidate-image preflight, backups, cutover and public health
verification remain deployment responsibilities. Their operating procedure is
owned by the deployment runbook.

Full-breadth Web CI runs all Bun unit tests, Python script tests, native Node
checks, server and shared card-presentation tests, Java 17 browser-engine tests,
SEO and distribution checks. Product and local gameplay journeys
run in parallel lanes. They cover login, deck import and editing, match setup,
challenges, catalog mechanics, priority and recovery. Login,
import, deck editing, setup, news and desktop challenge journeys share one
isolated product server and Vite instance. Each test gets a fresh browser
context; gameplay tests retire their local workers. Catalog checks retain their
catalog-only configuration.

Browser Local combines the validated Java 17 assets with the UI job's tested
frontend distribution for the generated
puzzle journey and one bundled combat puzzle. The complete bundled challenge
sweep, daily completion, retry, load recovery and phone checks run in extended
qualification.

Extended gameplay qualification runs weekly and by manual dispatch. Desktop
Chrome checks browser game setup, card inspection, startup failure/retry, worker recovery,
bounded Commander tax and keyword inspection scenarios on a hosted runner.
It also checks the imported mechanic fixture corpus. Those extended checks are separate from the PR gate. Failures still fail their
qualification job and keep traces or diagnostic artifacts. The imported corpus includes intentional Web
skips and is not yet a green baseline. The Sidewinder full-control setup,
Selvala Wild and narrow-board input checks also remain in qualification until
their failures are classified and repaired. These failures do not certify
release readiness.

Screenshot and video authoring, live telemetry delivery and additional device
viewports remain explicit local helpers. The live telemetry check sends real events to
external sinks. Worker recycling is covered by deterministic lifecycle tests. Full-game and
long-soak CI checks are absent; run exploratory gameplay when investigating a specific issue.
Draft runs in the product browser suite; Sealed remains
parked without an active browser journey.

## PR browser proof

PRs retain all source checks and Java 21/17 build validation. Known product-source
changes and Leyline pin updates run representative browser proof. Main and manual
runs retain the complete regular product, catalog, GRE suites.
Browser Local still runs its generated and bundled startup/action smoke on both.

`scripts/ci-browser-selection.mjs` resolves the following authored test calls to
Playwright file/line selectors. Template calls select every generated case at
that location. Missing or ambiguous representatives and missing comparison
history expand the affected suite to full coverage.

| Claim | PR case | Main regression coverage |
| --- | --- | --- |
| Real login and persisted session | email code login persists after reload | all authentication cases |
| Deck import, editing and selection | deck library controls; playable deck import and launch | full product suite, including Draft, challenges, curated watch and local recovery |
| Server opening and action | first land | all regular GRE cases |
| Combat and catalog identity | attacker submission; Jungle Lion cast and combat damage | full catalog and GRE combat cases |
| Reconnect ownership | socket loss restores opening and played board | complete recovery suite |
| Terminal outcome | lethal burn | full outcome and retirement cases |
| Costs in both execution heads | sacrifice/discard offered-branch call, four generated cases | complete life/kicker/offspring matrix |
| Browser Local startup and action | existing generated/bundled puzzle smoke | same required smoke, extended qualification unchanged |

Every new or changed managed spec runs its entire regular suite file on PRs,
without a smoke tag. This includes generated test matrices. Existing explicit
`@mechanic` and `@qualification` exclusions remain in their qualification lanes;
they are not representative-selection tags. Shared test helpers, puzzle
fixtures, runtime/build configuration, workflow/selector changes and unknown
paths force full browser breadth. Unknown new spec families force full
breadth and still need registration in the managed Playwright configuration.

The monolithic priority spec intentionally limits selectivity: a change anywhere
in it runs every regular priority case. This favors reliable inclusion over
hunk-based test inference. The UI and builder remain independent; a failed source
or build prerequisite prevents browser execution. Artifact verification, traces,
logs and the required `CI gate` remain required.

Broad sweeps move to main rather than disappearing. Publication still waits for
the full exact-main gate. This trades some premerge regression breadth for shorter
PR workloads; no measured latency saving is claimed before a current burst sample.

### Runtime scheduling and cancellation

The product runtime lane runs the complete selected `gre-priority` spec
after product journeys. The Browser cost-choice matrix stays
in gameplay to avoid moving its repeated initialization into the product lane.
The gameplay runtime lane runs catalog and all remaining selected GRE specs. Both lanes
verify the same sealed Browser runtime because each contains Browser Local
cases. Partitioning happens after representative or changed-file selection;
changing the relocated spec still runs every regular case in that file.
Missing relocated files or unknown partition selectors fail CI rather than
certifying an empty workload. No case moves out of the required gate.

The full main baseline [37375352185](https://github.com/delebedev/forge-web/actions/runs/37375352185)
contains 96 GRE cases, partitioned into 30 product-lane and 66 gameplay-lane
cases with no overlap. Its product/drain test bodies total 151.547 seconds,
and catalog/GRE bodies total 868.821 seconds. The relocated priority spec accounts
for 183.826 seconds, projecting 335.373 and 684.995 seconds of test bodies.
The attempted priority-plus-cost-choice partition in run
[37383552090](https://github.com/delebedev/forge-web/actions/runs/37383552090)
hit Browser initialization deadlines and ordinary progression bounds. Those
failures are retained as measurement evidence, not a speedup claim.
These are scheduling inputs, not measured improvements: startup, Browser
initialization and runner ordering also contribute to elapsed time.

Reporting and the required gate use `!cancelled()` rather than job-level
`always()`. They remain eligible after test/build failure, so failed jobs still
fail the gate and publish available diagnostics. Ordinary cancellation stops
obsolete reporting instead of retaining the concurrency slot. The only
cancellation-resistant step is stopping build JVMs, bounded to one minute.
Cancelled runs do not produce a successful proof receipt. This follows
[GitHub's cancellation guidance](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows).

## Build and test pyramid

UI validation runs on the dedicated `forge-web-ui` runner (1 CPU / 3 GiB).
One `forge-web-heavy` builder prepares pinned Forge dependencies once, then
validates and packages Java 21 server and Java 17 Browser Local distributions.
Gradle caches task outputs using its tracked input fingerprints. The shared
Leyline/card-presentation outputs and root Gradle project caches are separated
by Java target. Included-build task history remains shared, so switching targets
can still rerun some shared-module compilation. Browser tests use the same
pruning setting as the shipped distribution. Root configuration
caching is enabled; OpenAPI response cleanup keeps no live Project reference.
CI uses the compiler inside the Gradle process and stops Gradle after assembly.
Dependency/build caches remain in the heavy runner's dedicated Gradle volume;
Bun's package cache is shared and installs still enforce `bun.lock`.

After UI and builder success, the two heavy runners execute product, gameplay
and Browser Local lanes. Their distributions are sealed with the tested Git
tree, Leyline pin, Java variant, producer run/attempt and every file's SHA-256.
Consumers
reject missing, stale, damaged or differently targeted artifacts. Failed-job
reruns may reuse successful artifacts from an earlier attempt of the same run
and tree; artifacts from another run or a future attempt are rejected. Tar archives
preserve launcher permissions. Product/GRE jobs launch the distribution directly
with a 1 GiB heap and isolated suite state, without Gradle or Kotlin daemons.
The product built-page checks reuse the tested UI bundle instead of rebuilding.

A builder co-locates both targets to avoid occupying both heavy slots for build
setup. This deliberately makes product browser tests wait for Java 17 validation
too. Reconsider separate builders if measured build time dominates the graph.
The source and builder jobs run independently; failed source checks prevent all
engine-backed browser work. Conservative path classification stays in place.

| Required claim                                                                              | Owner / proof layer                                      |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Formatting, lint, types, reducers, stores, prompt rules, bootstrap helpers                  | UI deterministic checks                                  |
| HTTP contracts, persistence, product composition, packaging                                 | Java 21 tests, OpenAPI export and distribution checks    |
| Java 17 engine adapter and shipped dependency graph                                         | Java 17 tests with browser pruning                       |
| Authored replacement descriptor, pointer input and retirement                               | Vite-only transport integration; no engine or real login |
| Real login, deck library/import, Draft, lobby-to-game, curated watch and challenge entry | Product browser lane                                     |
| Real action, priority, combat, reconnect, terminal outcome and replay                       | GRE browser lane                                         |
| Catalog identity and representative mechanics                                               | Isolated catalog browser lane                            |
| Browser Local startup and one generated/bundled puzzle action                               | Browser Local smoke                                      |
| Exhaustive mechanic corpus and additional device qualification                  | Weekly/manual qualification                              |

Bounded lethal-burn and concession scenarios prove terminal outcomes and retired
controls. Normal deck launch, opening, first action and restart remain browser journeys.
Action-focused checks use authored starting positions instead of shuffled deck traversal.
The catalog combat case retains the opponent turn needed for summoning sickness.
Draft completes one real course, resumes its saved pool and launches a match;
reset and duplicate-click behavior use a small authored HTTP fixture in the UI lane.
The authored transport case retains every pointer/descriptor assertion with an
auth fixture instead of paying for a real account login. CI waits on observable state rather than presentation sleeps. No retries are added and distinct gameplay claims remain.

`build:ci` omits the duplicate TypeScript pass only within the UI job after
`check`. Normal `build` retains it for local and release callers. Java artifacts
are built for every full-scope revision; an uncertain path never bypasses checks.
Proof schema 3 records browser breadth and prevents partial or old graph receipts
from authorizing full main reuse.

Each substantial CI command emits duration, credential-free process-role RSS,
and cgroup memory/CPU/swap counters under `test-results/ci`. Managed browser
suites also emit per-test JSON and JUnit with suite-specific paths. Runner samples
measure the whole job container; counters are cumulative, so compare before/after
values and report queue/startup separately from execution using workflow metadata.

The Test report job publishes a run summary after the gate, including failed or
reused-proof runs. It shows reported outcomes by suite, job queue and occupancy
times, command durations, sampled memory versus limits, CPU consumption and
memory event deltas. Earlier successful producer attempts remain identified on
partial reruns. Retry delay is included in trigger-to-gate time and marked as
such. Gradle cached outcomes and repeated OpenAPI export checks are labelled;
they are not presented as newly executed or unique tests. Extended qualification,
coverage and historical flake rates are outside this report.

Rollback the workflow and proof logic together; stop routing UI to the small
runner before retiring it. Keep existing caches and the required `CI gate` name.
Production publication still requires successful CI for the exact main SHA.
