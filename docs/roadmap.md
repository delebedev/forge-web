# Public roadmap

`/roadmap` reads curated items and account votes from the product `player.db`.
Flyway V5 seeds the first set once; changing that migration later would break
existing databases. An operator can add or edit `roadmap_items` rows directly.
The page reads them on every visit. `visible = 0` hides an item without erasing
its votes.

Use `considering`, `planned`, `building`, or `shipped` for `status`. Set
`status_updated_at` to a UTC ISO timestamp when moving an item; `note` is a
single short editorial line. `sort_order` controls order within each section.
Shipped items keep their historical votes but no longer accept new ones.
