# Database migrations

`openPlayerDatabase` in `server/platform/db.ts` checks the schema before constructing stores or starting HTTP. SQL
migrations live in `server/migrations` and are embedded in the compiled server by
`server/platform/resources.ts`. Never edit a migration that may have run.

Startup runs every embedded script newer than the recorded history in version order, in one transaction, and
records each in `flyway_schema_history` with Flyway's checksum, which the earlier Flyway-based release also reads.
A fresh database runs every script. Checksums of applied scripts are not recomputed. Startup refuses a nonempty
database without history, history with a failed row, and history from a newer release.

A schema change adds its `V<n>__description.sql` and lists it in `server/platform/resources.ts`. Saved decks and course
documents store card names; the server does not check them against a card catalog.

SQLite migrations are transactional, but SQLite does not coordinate concurrent writers starting up. Start one
candidate backend at a time. Rehearse normal startup against a database copy with the exact release binary, then
verify migration history and retained rows before downtime.
