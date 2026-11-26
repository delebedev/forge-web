# Card images

Artwork is resolved locally. The repository ships one name-keyed image index, and
both the product server and the browser engine read it; neither asks
`api.scryfall.com` at request time. Image bytes themselves still load from
`cards.scryfall.io` — this is not an offline image bundle.

## What the index is

`server/assets/card-images.sqlite` holds one row per artwork
identity:

- `card_images(lookup_name, is_token, normal_url, back_url)` — the primary key
  is the lower-cased card name plus the token flag, so a card and a token that
  share a name keep separate artwork. `back_url` is set only for the front face
  of a two-faced card.
- `metadata(key, value)` — `schema_version`, the Scryfall bulk file's
  `source_uri` and `source_updated_at`, and `generated_at`.

Scryfall's newest printing of a name wins. Face names are indexed alongside the
combined `Front // Back` name, and a card whose top-level `image_uris` is absent
gets a combined-name row pointing at its first face.

## Where it is used

- **Product server:** `CardImageIndex` in `server/card-images.ts`
  loads the bundled file and resolves a name plus token flag to `normal` or
  `back` artwork. A lookup that misses under the caller's token flag falls back
  to the same name under the other flag; the flag is a hint, not a reason to
  hide artwork the name has. `findArtwork` also borrows the original
  illustration for Arena's `A-` rebalanced names, which Scryfall does not
  publish; only the artwork is borrowed, and the rebalanced face keeps its own
  name, mana cost and rules.
- **Browser engine:** `scripts/build/build-browser-catalog.py` projects the same
  database into `card-images.json.gz` during `bun run browser:assets`, adds the
  same `A-` aliases, and the browser release manifest hashes the result. The
  worker verifies and loads it at initialization, then fills each card's
  `imageUrl` from the local map. Forge card identity and rules metadata remain
  authoritative — image lookup never substitutes a different gameplay card.

- **Product UI:** card surfaces outside gameplay load `card-images.json.gz`
  with the static card index (`card-index.json.gz`, built by the
  `browser-engine` `cardIndex` task) and verify both against the release
  manifest. Once loaded, `scryfallUrl` resolves artwork from this map; a surface
  that renders before the index loads still uses the server image route.

A missing identity yields no URL and never falls back to the Scryfall API. A
missing or mismatched release asset fails browser engine initialization like
any other engine asset.

## When to refresh

Refresh the index when:

- a set releases and its cards show no artwork,
- a token name has no row, or
- a card was added to the catalog after the index's `source_updated_at`.

The index is built from Scryfall's public `oracle-cards` bulk file, so a card
that Scryfall has not published yet cannot be indexed until it does.

## Refresh command

```bash
bun run cards:index
bun run browser:assets
```

`bun run cards:index` downloads the current Oracle bulk file, streams it, and
rewrites `server/assets/card-images.sqlite` atomically. To reuse an
already-downloaded file instead of downloading again, pass `--input` with a
`.jsonl.gz` bulk file or a JSON array of Oracle cards, plus the export's own
publication date:

```bash
bun scripts/build/build-card-image-index.ts --input /path/oracle-cards-20261122220157.jsonl.gz \
  --source-updated-at 2026-11-22T22:01:57.207+00:00
```

A local copy's mtime says when the file was written, not when Scryfall published
it, so `--source-updated-at` is required with `--input`, and it must be an ISO
8601 date. Take it from the input export itself: the bulk filename embeds its
publication time (`oracle-cards-20261122220157.jsonl.gz`). Use
`api.scryfall.com/bulk-data/oracle-cards` (`updated_at`) only when its
`jsonl_download_uri` is the file you passed; that endpoint always describes the
current export, so an older local copy would otherwise be dated later than its
data. `--source-uri` records the Scryfall download URI when it differs from the
local path.

`bun run browser:assets` then rebuilds the browser catalog, image map and
release manifest from the new file.

## Verifying a refresh

```bash
bun test scripts/build/build-card-image-index.test.ts
sqlite3 server/assets/card-images.sqlite \
  "select count(*) from card_images; select * from metadata;"
```

Sanity bounds: the file stays around 6 MB, a set release adds a few hundred
rows, and a five-fold jump means the generator indexed something it should not
have. `source_uri` must name the bulk file that was read, and
`source_updated_at` must move forward. Then load a Browser (Local) match and
confirm the new cards render decoded artwork with no `/api/public/cards/image`
or `api.scryfall.com` requests; a rebalanced card renders its original
illustration beside rebalanced face copy, and a missing identity stays playable
without an image.
