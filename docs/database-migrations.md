# Database migrations

`openPlayerDatabase` in `server/db.ts` checks the schema before constructing stores or starting HTTP. SQL
migrations live in `server/migrations` and are embedded in the compiled server by
`server/resources.ts`. Never edit a migration that may have run.

A fresh database runs every script in version order and records each in `flyway_schema_history` with Flyway's
checksum, which the earlier Flyway-based release also reads. An existing database starts only when
its history ends at the newest embedded version and every row succeeded; checksums are not recomputed. Startup
refuses a nonempty database without history and history from a newer or older release.

The server has no runner for scripts newer than V10 yet. A schema change adds its `V<n>__description.sql`, lists it
in `server/resources.ts`, and extends `migrate` to apply pending scripts and write their history rows in the same
table. Saved decks and course documents store card names; the server does not check them against a card catalog.

SQLite migrations are transactional, but SQLite does not coordinate concurrent writers starting up. Start one
candidate backend at a time. Rehearse normal startup against a database copy with the exact release binary, then
verify migration history and retained rows before downtime.
