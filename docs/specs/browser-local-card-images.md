# Browser-local card image lookup

Browser (Local) resolves card image URLs without a product-server lookup or a
runtime request to `api.scryfall.com`. Artwork bytes still load from
`cards.scryfall.io`; this is not an offline image bundle.

The browser asset build projects the bundled `card-images.sqlite` into a
compressed, name-and-token-keyed JSON file. The existing browser release
manifest hashes that file. The worker verifies and loads it during browser
engine initialization, then fills each card's `imageUrl` from the local map.
The Forge card identity and rules metadata remain authoritative; image lookup
never substitutes a different gameplay card.

A missing image identity yields no URL and never falls back to the Scryfall API.
A missing or mismatched release asset fails initialization like other browser
engine assets.

Arena names a rebalanced card with an `A-` prefix, and Scryfall publishes no
printing under that name. The browser asset build aliases each rebalanced name
to the original printing's illustration, and the product server resolves the
same artwork for composed faces and art crops. Only the artwork is borrowed:
the engine's face copy keeps the rebalanced name, mana cost, and rules text, and
a full-card request keeps its own printing. Token artwork coverage remains a
separate index improvement.

Acceptance: a Browser (Local) match renders decoded card artwork after visible
gameplay actions, with no `/api/public/cards/image` or `api.scryfall.com`
requests. A rebalanced card renders its original illustration beside rebalanced
face copy. A missing indexed identity remains playable without an image. The
standalone browser build contains the same verified asset and needs no product
server for image lookup.

## Refresh

`scripts/build-card-image-index.py` regenerates
`server/src/main/resources/card-images.sqlite` from Scryfall's public
`oracle-cards` bulk data. Run it when a set releases and its cards have no
image:

```bash
python3 scripts/build-card-image-index.py
python3 -m unittest scripts/test_build_card_image_index.py
bun run browser:assets
```

One `(name, is_token)` artwork identity per card name, newest printing first,
with face names indexed as well. `metadata` records the bulk file's URI and
`updated_at` alongside the schema version, so a stale index is traceable. The
file stays around 6 MB; regenerating after a set release adds a few hundred
rows, and a five-fold jump means the generator indexed something it should not
have.
