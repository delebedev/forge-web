# Database migrations

`PlayerDatabase.open` runs Flyway before constructing stores or starting HTTP. SQL migrations live in
`server/src/main/resources/db/migration` and run in version order. Add a new `V<n>__description.sql` for every schema change;
never edit a migration that may have run. Flyway validates checksums and rejects history from a newer release.

Fresh databases start at V1. Normal startup refuses a nonempty database without Flyway history. Card names and catalog
membership remain a separate startup validation in `bindCardCatalog`.

Schema changes update the Exposed table model and add a new SQL migration together. Flyway history is the schema
authority.

SQLite migrations are transactional, but SQLite does not coordinate concurrent Flyway processes. Start one candidate
backend at a time. Rehearse normal startup against a database copy with the exact release image, then verify migration
history and retained rows before downtime.
