# Authentication boundaries

The product API issues opaque cookie sessions after an emailed one-time code, or
creates a separate guest identity. Guest access remains available. Existing valid
sessions are reused by the guest endpoint without creating another identity.

Login codes expire after ten minutes, allow five incorrect attempts, and have a
30-second resend cooldown. Sessions expire after 30 idle days or 90 absolute days.
The deployed HTTPS proxy must add Secure to the HttpOnly, SameSite=Lax cookie.
Only enable `FORGE_WEB_TRUST_PROXY_HEADERS` behind a proxy that supplies trustworthy
client addresses. Public callers must not be able to choose those addresses.

## Abuse budgets

Authentication budgets count **attempts**, before database writes or email sends.
An email has one normalized identity across IPs; changing emails cannot escape an
IP budget, and changing both cannot escape the process-wide budget. Each action
has separate counters, so requesting a code does not spend verification allowance.
Existing session validation, deck APIs and replay admission do not use these budgets.

Defaults per action:

| Action | Per email / minute | Per IP / minute | Global / minute | Per email / hour | Per IP / hour | Global / hour |
|---|---:|---:|---:|---:|---:|---:|
| Request code | 10 | 100 | 1,000 | 10 | 100 | 1,000 |
| Verify code | 10 | 100 | 1,000 | — | — | — |
| Create guest | — | 10 | 1,000 | — | 100 | 1,000 |

These are generous shared-IP allowances, not per-browser quotas. Cooldown,
failed-send and invalid-code attempts also count. An exhausted allowance returns
429 without creating a challenge, sending mail, or creating a guest. Invalid email
shape or excessive length returns 400 before persistence or sending. Verification
also bounds code length. Surrounding whitespace and email case are normalized.

`LEYLINE_WEB_RATE_LIMIT` and `LEYLINE_WEB_RATE_LIMIT_WINDOW_MS` retain their defaults
of 10 and 60,000. They control the short email and guest-IP allowances; the rate
limit value also controls the hourly email allowance. Aggregate defaults are owned
by `AuthRateLimitConfig`. `LEYLINE_WEB_RATE_LIMIT_ENABLED=false` disables all these
budgets for controlled development/tests, not public deployment.

Budget admission is atomic: a limiter-rejected request spends none of the other
allowances, so an already-throttled caller cannot exhaust the global budget.

The in-memory limiter uses monotonic time and constant-space fixed-window counters.
There are at most 4,096 keys. Expired identities are reclaimed on subsequent traffic,
at most once per second. Saturation rejects new keys without evicting active limits.
Checks are synchronized. A fixed-window boundary permits adjacent bursts, and a
process restart resets counters. Multiple API processes would need coordinated
budgets. These controls bound application work; they are not a substitute for
trusted forwarding, provider-side spending limits or network-layer protection.
