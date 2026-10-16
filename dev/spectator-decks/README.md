# Spectator deck pool

`pool.txt` is the public landing-page rotation. Order is behavior: each deck
plays the next entry, and the final entry wraps to the first.

| Deck | Forge source | Character |
| --- | --- | --- |
| Pulverize | Scourge theme deck (2003) | Morph, landcycling, and mana-value payoffs |
| The Spikes | Stronghold theme deck (1998) | Movable counters, activated abilities, and life gain |
| Time Drain | Urza's Legacy theme deck (1999) | Cycling, free spells, countermagic, and creature lands |
| Tombstone | Urza's Saga theme deck (1998) | Cycling, sacrifice, and graveyard recursion |

The source files live under
`leyline/forge/forge-gui/res/adventure/Shandalar Old Border/decks/starter/precon/`.
Pool copies keep the original main deck and omit printing suffixes.

To change the pool:

1. Add a 60-card Forge deck copy and place it in `pool.txt`.
2. Run `bun run spectator:smoke`; every ordered pairing must finish naturally.
3. Run the landing browser smoke and inspect a complete game before release.

Keep failures visible. Reorder or remove a deck that times out, stalls, throws,
or logs an error; do not quarantine cards in a public spectator deck.
