# Curated full games

The three public replays start from normal shuffled decks and opening hands and continue to a normal terminal result. They use complete authored starter decks, not puzzle positions, player submissions or production games. The exact deck texts, formats and seeds are in `src/features/replay/curated-replays.json`. “Play these decks” opens those same complete decks for a fresh game.

Generated October 17, 2026 with Forge Web `7cd21a6`, Leyline `49969416cd8772b2469ac1a5e33d42334a9b04b4`, Forge `89a3a0b8f166d4a8a35f02e12e0e9d09dbe9e09d`, Java 21 and seed 42. Both seats used Forge AI. Red Burn won on turn 35, Atraxa won on turn 18, and White Lifegain won on turn 32. No external match data was used.

A temporary local harness launched each pair of full decks through `InProcessMatchRuntime` in AI-versus-AI mode, with ordinary mulligans and no puzzle definition. After the normal authentication and connection handshake, the engine played to completion. The existing replay writer supplied visible GRE batches and card metadata from the same catalog. The harness is not part of the product or retained server functionality.

The public bundles contain visible GRE messages, card metadata and completeness status. Operator context, transport envelopes, player submissions, top-level match and release context are omitted. Stack ability identities also include their source card’s published ability text. Generated card identities, rules and indexed image URLs let playback run without a metadata API. Artwork still loads from its normal external host. The manifest in `assets.json` records file hashes, sizes and frame-batch counts.

To replace a sample, run complete authored decks from normal opening hands to a normal result, export the same version-1 transcript shape with local card metadata, and inspect the resulting full game. Update the versioned public asset and manifest entry together. Verify complete beginning-to-end playback, seeking, inspection and the fresh-game deck handoff. Do not replace a sample with a partial game, a prepared puzzle position, or unrelated content under the same versioned identity.
