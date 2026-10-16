# Daily release notes

Every successful **Publish Forge Web** deployment automatically triggers
**Daily release notes**. It inventories the shipped Forge Web and Leyline changes,
generates one Qwen 3.8 Flash entry, validates it and publishes it to
`https://forgeweb.app/whats-new.md`. No review or approval blocks publication.
Forge upstream history is not included. No agent-session changelog is required.

Public entries are grouped by the London calendar day when production verification
completed. Later deployments regenerate that day's accumulated entry, retaining
previously published outcomes. Several deploys produce one daily entry. Same-day
updates do not retrigger the popup for players who have already read that date.
The UI fetches the feed when the app loads. Already-open tabs need a reload.

Every source needs a player, internal or uncertain classification. Public bullets
may cite only player sources. Validation checks accounting, source references and
retention of published notes. It does not prove factual correctness. Descriptions
and diff excerpts are bounded and truncation is marked. Public release attachments
contain only deployment/checkpoint metadata, source IDs, carried public text, and the validated public candidate. Source descriptions,
diffs, internal explanations, model responses, usage and retries remain temporary
runner files and are not uploaded.

Publication validates the feed on the VPS, preserves the previous bytes, replaces
it atomically and verifies the public checksum. Only then is the GitHub release
published. If generation or validation fails, the current feed stays live and the
notes action fails visibly. The application deployment remains successful.
An internal-only day does not create an empty public entry. Retries of already-generated snapshots
reuse stored copy without a model call.

## Feedback afterward

**Like**, **dislike** and **BS** are feedback to an agent after publication, never
CI inputs or gates. Record useful preferences and factual corrections in
`scripts/release-notes/taste.json` through ordinary code changes. For example:

```sh
python3 scripts/release_notes.py feedback dislike --text 'Rejected wording' --reason 'Why it misses'
```

The prompt uses those examples on future deployments. Keep only examples that
teach distinct preferences. Stylistic feedback guides wording. Factual corrections
constrain claims.

## Recovery

Rerun **Daily release notes** on `main`, mode **publish**, with the successful
deployment run ID. Already-generated snapshots reuse their stored copy, including
when retrying after a publisher failure. An older snapshot cannot replace a newer
published snapshot for that day. Deployment checkpoint artifacts are retained for
90 days; each draft manifest also retains the deployment metadata. Historical Markdown
and the initial September 30 production checkpoint remain bootstrap inputs.

The OpenRouter repository secret is `OPEN_ROUTER_API_KEY`. The publisher uses the
`production-release` environment's restricted static SSH key and pinned host key,
with the narrow command `notes OLD_SHA256 NEW_SHA256`. Mode **verify** republishes
current public bytes unchanged to check the key and checksum without a model call.
