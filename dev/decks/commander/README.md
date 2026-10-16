# Commander: 2025 archetypes

Five 100-card Commander lists provisioned by `bun run dev:seed`. They use only
names resolved by the pinned Forge card catalog. These are high-power
casual starting points for head-to-head play at 40 life, not cEDH tournament lists.
The card choices are from 2025 or earlier. Catalog availability does not guarantee
that every interaction works in browser play.

[EDHREC's November 26, 2025 report](https://edhrec.com/articles/a-statistical-look-at-almost-a-year-in-commander-2025)
anchors the archetype selection: Y'shtola, Vivi, Teval and Krenko were among its
ten most built commanders in 2025; Atraxa remained a widely built established
commander. This is a dated popularity reference, not an end-of-December ranking.

| Deck | Plan | Origin |
| --- | --- | --- |
| Atraxa — Counter Growth | Counters, proliferate, protected creature threats | Locally curated |
| Krenko — Goblin Swarm | Goblin tokens, haste, sacrifice and damage | Adapted from a November 2025 list |
| Teval — Graveyard Lands | Self-mill, land recursion, reanimation | Locally curated |
| Vivi — Spellslinger | Cantrips, spell damage, mana and draw engines | Adapted from an October 2025 list |
| Y'shtola — Spell Control | Interaction, life drain and draw | Adapted from a December 2025 list |

`sources.json` records exact source links, dates and fixture hashes.
`adaptations.json` records substitutions made during the original Arena-catalog curation.
The two locally curated lists have no external deck-list author. The other three
are adaptations, not unchanged historical exports. The original curation excluded
Edgar Markov and The Ur-Dragon because their commanders were absent from that catalog.

Persist command cards in `commandZone`, main cards in `mainDeck`, and use format
`Commander`. Never put the commander in the 99. The seed script preserves
existing names, so later fixture revisions do not overwrite user-edited decks.
