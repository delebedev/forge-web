# Product analytics contract

Product analytics is optional. Tracking failures must never interrupt auth,
deck editing or a match action. Local previews and development
routes remain excluded by the browser filter.

The tracker collects Core Web Vitals through Umami's `data-performance` opt-in.
The tracker URL carries the deployed Umami version as a cache-busting marker;
bump it when Umami upgrades. The analytics filter URL has a separate marker;
bump it whenever that filter changes. Performance payloads pass through the
same production-host filter and URL normalization as pageviews and custom
events. Operator smoke sessions do not emit performance payloads because Umami
3.3.1 does not persist their `tag` or `data` fields.

Session replay and heatmaps use Umami's recorder for a stable 10% browser-session
sample on public entry pages and for authenticated players who enter deck or
play routes. Restored accounts and supported guest players follow the same
policy. Local previews, development routes, and operator smoke tabs remain
excluded. Conditional loading delays recorder-backed heatmaps until the browser
becomes eligible; the ordinary Umami tracker and Core Web Vitals still load at
page start. Umami's server-side five-minute duration cap, masking limits, and
native replay sample rate still apply after loading. Inputs remain masked and
authentication tokens remain in HttpOnly cookies. Replays may contain exact SPA
URLs, deck names, card lists, and DOM attributes; these are accepted product
telemetry for the restricted operator account. Do not place email addresses,
login codes, or other credentials in non-input DOM text or attributes. The
recorder has no stop/restart API, so eligibility controls when collection starts
for the remainder of that page load.

Replay and heatmap expiry is managed by the operator deployment, independently
of the recorder duration cap. Saved replay retention follows the operator
policy.

Match replay journals are separate product diagnostics. They contain one
player seat's match traffic and submitted gameplay choices, exclude GRE
authentication handshakes, and are available only through the operator route.
Normal journals expire after 7 days; report-pinned journals expire after 30
days. Both periods and the 512 MiB total / 32 MiB per-match bounds are
server-configurable.

Replay storage has one dedicated worker for uploads, operator reads, pinning and
retention maintenance. Requests suspend while it works, with at most eight
admitted requests. Saturation returns HTTP 503 with `Retry-After: 10` rather
than blocking product HTTP threads. Uploads account for replay, metadata and pin
growth together without scanning or compacting other journals. Exhausted quota
rejects delivery explicitly and never evicts a retained or pinned replay.
Browser snapshots are gzip-compressed at rest; the per-match limit applies to
decoded JSON, while total quota counts stored bytes including metadata and pins.
Operator exports remain ordinary JSON. Plain snapshots remain readable and are
migrated by maintenance without changing their retention age.
Maintenance starts in the background at application startup, reconciles on-disk
usage in one linear sweep and compacts at most 16 journals per pass. While a
migration backlog remains, passes yield for one second; otherwise they run hourly.
Unreadable pins preserve their journals rather than permitting expiry. Failed
replay removal preserves its pin and retention metadata. Health reads the last published byte count
without joining the worker. The replay directory is exclusively server-owned;
external changes are reflected at startup or the next maintenance pass.

Browser-local replay journals use the same viewer format but originate in the
player tab because no server match transport exists. The client retains a
20 MB complete prefix and sends ordered chunks every ten seconds during an
authenticated match. The server acknowledges sequence numbers, deduplicates
retries, and stores the journal under the same retention and pinning policy.
Uploads never gate game actions. A blocked upload, abruptly closed tab, or
truncated prefix leaves an incomplete replay; client-supplied events are not
proof that the engine accepted a submitted action. Public browser challenges
do not upload journals.

Historical server lifecycle rows remain stored unchanged. The product no longer
creates, completes or recovers server match outcomes during startup.

The authenticated player UUID is the stable opaque account identifier. Session
restore, login, guest creation, logout, and account replacement must update the
analytics identity at the auth store boundary. Custom events also carry the UUID
as `account_id`; browser and request-bound server error reports retain only this
UUID as their user ID. Profile fields, email addresses, IP addresses, and deck
names must never be sent.

Every custom event carries `release`, `rollout`, and `traffic`. Match lifecycle
events carry `match_id` and `deck_id` when a persisted deck launched the match.
Deck events use IDs, formats, counts, and operation names rather than deck or
card names.

| Event | Event-specific properties |
|---|---|
| `login` | `method`, `success`, optional bounded `reason` |
| `game-start` | `mode`, `gameType`, `match_id`, optional `format`, `deck_id` |
| `game-start-failed` | start fields when known, bounded `reason` |
| `game-complete` | start fields, `result`, `durationSec`, `turn`, `lossReason` |
| `game-left` (historical) | start fields, `phase`, `turn`, bounded `abandon_result`, optional HTTP `status`. Current leave events use `browser-lifecycle` with `stage=left`. |
| `game-first-action` | start fields, bounded numeric `actionType` |
| `turn-milestone` | start fields, `turn` in `1`, `5`, `10`, `20` |
| `game-recovery` | `execution=browser`, opaque match/attempt IDs and browser context, bounded `outcome` (`started`, `succeeded`, `failed`, `cancelled`), terminal `duration_ms` |
| `deck-paste` | `cardCount`, `inputLength`, `lineCount` |
| `deck-search` | `queryLength`, bounded `outcome`, optional `resultCount`, `status` |
| `deck-saved` | `deck_id`, `operation`, `format`, `cardCount` |
| `deck-deleted` | `deck_id` |
| `bug-report-opened` | `report_id`, `source` (`header`, `sidebar`, or `board`), optional `match_id`, `deck_id`, `close_category`, numeric `close_code`, `connection_status` |
| `whats-new-opened` | `source` (`landing`, `header`, or `auto`), `latest_date` (ISO publication date or empty) |
| `whats-new-closed` | `source` (`landing`, `header`, or `auto`), `latest_date` from that opening |
| `challenge-opened`, `challenge-restart`, `challenge-first-action`, `challenge-solved`, `challenge-failed` | Bounded `challengeId`; first action includes numeric `actionType`, terminal events include `result` |

Generated puzzle UUIDs use the `generated` challenge ID in these events; the
per-puzzle identity remains in the private feedback store.

Browser-local lifecycle events use the ordinary `game-*` names with
`execution=browser`. The separate `browser-lifecycle` event carries opaque
`attempt_id` and `match_id`, `frontend_build`, `engine_build`, game type,
format, and seed. Its bounded stages are `attempt`, `worker-online`, `initializing`,
`runtime-ready`, `engine-ready`, `catalog-ready`, `match-started`,
`board-ready`, `cancelled`, `left`, `retry`, and `failed`. Failures carry a
bounded reason, operation, failure kind, and last successful stage. A command
deadline also carries bounded command phase, queue duration, host-timer
lateness, and heartbeat state. These distinguish a command that failed to
dispatch from one that started and stopped progressing. The attempt
and startup stages also carry bounded `warmup` (`none`, `partial`, `complete`,
or `failed`), aggregate `warmup_bytes`, and `warmup_duration_ms`. Segment
Play-to-first-engine-stage duration by warmup and engine build; do not interpret
requested bytes as transferred bytes when browser HTTP-cache transfer sizes are
unavailable. The attempt
identity joins the local game start to its browser attempt. Startup failures remain
local and explicit. Events never include a decklist, card name, GRE payload,
or browser error text.

Same-tab recovery starts a fresh attempt with `retry` and `reason=recovery`,
then reports the ordinary startup, match-started and board-ready stages.
Cancelling recovery reports `cancelled`; the failed attempt keeps its own terminal event.

Count distinct `attempt_id` values for the browser launch funnel and distinct
`match_id` values for game outcomes. Keep known cancellation, startup failure,
runtime failure, and completion separate. A page close, tracker block, or loss
of connectivity can still leave a launch without a terminal event despite the
best-effort page-exit signal; report that as an unknown interruption rather than
inferring failure. Compare browser-local and
server-backed cohorts only after separating mode, format, release, and browser
support status.

A prepared bug form has one UUID `report_id`, which may be reused while its
page context remains mounted. Primary opens send that value in the
`bug-report-opened` event, and every form URL carries it in hidden parameters
together with `account_id`, `match_id`, `deck_id`, `release`, `source`,
and `traffic` when available. Bounded connection-close context stays on the
analytics event. Form opening and submission are independent records; support
investigation treats the analytics join by `report_id` as authoritative.

## Event migration

The event names below are the contract for comparing dashboards across client
revisions. A removed event has no live caller and must not be interpreted as a
zero count in the current release.

| Historical event | Disposition | Current caller | Product question |
|---|---|---|---|
| `deck-paste` | Keep | `DeckImportDialog` after a valid parse | Does pasted-deck import reach a usable deck? |
| `format-select` | Remove | Format remains on `game-start` and `deck-saved` | Which formats produce saved decks and launched games? |
| `game-start` | Keep | `GreStore.recordGameStart` after match creation | Which player matches launch? |
| `game-start-failed` | Remove | Browser failures use `browser-lifecycle` and diagnostic reports | Why does local startup fail? |
| `game-complete` | Keep | `GreStore.recordGameComplete` on terminal state | Which player matches finish, and how? |
| `game-concede`, `game-left` | Remove | Local lifecycle reports explicit leave | Where do players leave active matches? |
| `prompt-response` | Replace with `game-first-action` | `GreStore.sendPerformAction` after the first sent non-pass action | Does a player progress from connection to actual play? |
| `turn-milestone` | Keep, bounded | `GreStore.applyGsmPayload` at turns 1, 5, 10, and 20 | How deep do unfinished player matches progress? |
| `login` | Keep | `LoginPage` after code verification | Does passwordless login succeed, and why does it fail? |
| `challenge-opened` | Restore for browser links | `BrowserChallenge` on opening a curated link | Which challenge attempts open? |
| `challenge-first-action` | Restore for browser links | `GreStore` after the first non-pass action | Which opened challenges reach interaction? |
| `challenge-stack-opened` | Remove | The duplicate challenge action seam was removed | Which challenge attempts exercise the stack interaction? |
| `spectator-start` | Remove | Public watch reads saved games | Historical live spectator launches |
| `spectator-complete` | Remove | Public watch reads saved games | Historical live spectator outcomes |

`game-first-action` excludes pass-priority actions, spectators, and puzzles.
Turn milestones exclude spectators and puzzles, emit once per current match, and
retain their emitted set across an in-page reconnect.
The in-page deduplication state resets after a full reload, so match-level
engagement analysis counts distinct `match_id` values rather than raw events.

## Journey health

`journey-attempt` and `journey-result` share a random `operation_id`, `boundary`,
mode/game type, and the opaque match ID when known. Results add `outcome`
(`success`, `failure`, `timeout`, `cancelled`), a bounded `reason`, and monotonic
`duration_ms`. They contain no card names, input text, or GRE payloads.

`action-response` observations remain browser-local and are not sent to Better
Stack or Umami. Browser startup/readiness and recovery use `browser-lifecycle`
and `game-recovery`. The former server launch/reconnect boundaries are retired.

- `action-response`: a sent player action or prompt answer through the next
  newer authoritative state/request. This measures observable progress, not
  causality of a particular frame or completion of the whole AI turn. Bootstrap,
  settings, and checkpoint messages are excluded. Illegal requests fail the
  pending measurement. There is no sampling; overlapping measurements cancel
  the older one as `superseded`.
- `journey-disconnected`: one event per unexpected frame-source loss incident before
  game over, including `disconnect_id`, match and release context, bounded
  `close_category`, numeric `close_code`, and `connection_status`. Retry closes
  remain part of the original incident. Intentional leave and explicit match
  completion do not emit it. Arbitrary frame-source error text is never sent.

Report disconnect incidents by distinct `disconnect_id`, affected matches by
distinct `match_id`, and reconnect attempts separately by `operation_id`.
Observation deadlines are 60 seconds for readiness and 30 seconds for action
progress. They never abort a request, change priority, or otherwise control the
match. Disconnects fail pending observations; explicit leave cancels them.
A tab closed or a blocked analytics request can leave an unmatched attempt.
Report those separately from known failures. Background timer throttling can
extend observed durations. Cancelled observations are not failures or latency
samples. Browser metrics are observational, not an availability SLA.

`Server-Timing: app;dur=<milliseconds>` measures HTTP route processing before
response transfer. `X-Backend-Release` identifies the backend independently of
the frontend release. Missing measurements and older releases are unavailable,
not zero. Compare like boundaries, modes, and formats with sample sizes; small
cohorts and different decks do not establish a release regression.

Production operator checks enter with `?traffic=smoke`; this marks only that
tab's session storage and persists across navigation. Use a fresh tab for
ordinary player traffic. The analytics filter removes query parameters from
pageview URLs and excludes untaggable Core Web Vitals from these smoke sessions.

Browser engine failures attach a payload-free diagnostic snapshot to the error
report and authenticated match journal. A 32-entry command buffer stays in page
memory during play: enqueue/start/reply/error, command ID, operation, elapsed
worker-relative time and numeric input type/state/response IDs. The latest delivered output
keeps numeric type/state/message IDs and arrival time. No diagnostic events are
uploaded during healthy play.

Before retiring a failed worker, the host requests one JVM snapshot through a parked native-promise listener outside the
serialized command queue and waits at most one second. It includes receive
elapsed time, explicit lock/action/horizon/coordinator/delivery phase markers,
time in the current phase and JVM heap totals. Thread introspection is not used
because the browser runtime cannot provide reliable stacks or thread states.
GRE payloads, card names and decks are excluded. An unanswered or unsupported snapshot is
explicitly marked timed-out or unavailable; it cannot postpone retirement
indefinitely. A phase marker is a failure-time scope observation, not a progress timeline or
proof that a particular wait caused the failure. Existing replay retention,
operator access and error-report budgets apply.

Terminal browser reports additionally identify the innermost Java exception and
its first stack frame, so different causes do not share a generic termination
fingerprint. Numeric card projection context (group ID, field and value) is
included when available. Parsed browser/OS families and versions and the worker's
runtime loader version accompany the existing engine/frontend build identities.
The full user agent and exception messages are not copied into these diagnostic
fields. Version claims are the browser's advertised versions and the selected
loader channel, not independently verified runtime builds. Existing once-per-attempt
deduplication and the three-report page budget remain unchanged.

Caught frame failures retain their original exception and distinguish transport,
decoding and state application. Generic browser reports inherit the active
match, execution and known build identities at capture time; leaving the match
clears that scope. A frame-source error without an exception remains a message
rather than receiving a fabricated stack.

Unexpected API failures include only a generated route template, method when
known, status and validated backend release. Response decoding reports omit
response values and validation messages. Expected authentication and validation responses remain routine. These additional diagnostic
reports share a ten-report page budget and deduplicate owned exception objects.

Browser replay delivery reports its first collection, HTTP or network failure
per match without blocking play. Later gameplay reports can include the latest
upload state and acknowledged sequence. Busy uploads are not failures; a
successful retry clears the failure state. Delivery acknowledgements establish
only the uploaded prefix, not a complete or reproducible game.
