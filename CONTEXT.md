# Forge Web

Forge Web is a browser game for playing Magic, watching matches, and solving puzzles. These terms describe its player experience and support workflow.

## Language

### People and identity

**Player**:
A person who plays or watches Forge Web. Use this for the product audience, including signed-in players and guests.
_Avoid_: Customer, user, WebPlayer

**Account**:
A returning player's email-linked identity for saved content and match ownership.
_Avoid_: player, WebPlayer, session

**Guest**:
A player using an anonymous identity instead of email sign-in. A guest can play a challenge without an account.
_Avoid_: anonymous account, unauthenticated player

**Session**:
A period of access under one player identity, whether signed in or guest. It is independent of any match the player starts.
_Avoid_: match, game session

**Operator**:
A person with privileged access to player and match diagnostics. Operator access is separate from a player's account.
_Avoid_: admin, support account

### Play and content

**Deck**:
A collection of cards selected for play, either supplied as a starter deck or saved by a player. Saved decks can include main, sideboard, and command-zone cards.
_Avoid_: decklist, card pool

**Match**:
One instance of a game, from its initial position through its outcome or abandonment. Player and puzzle matches run locally in the browser. A replay is a completed game viewed from its saved transcript.
_Avoid_: session, room

**Puzzle**:
A defined game position with an objective for the player to achieve.
_Avoid_: challenge, match

**Challenge**:
A player-facing puzzle offered for play, including public puzzles and curated development puzzles. Retrying a challenge starts a fresh attempt at its puzzle.
_Avoid_: puzzle fixture, match

**Browser execution**:
A match whose game rules run in the player's browser.
_Avoid_: local game, offline play

**Server execution**:
A match whose game rules run on the Forge Web server.
_Avoid_: remote game, online play

### Support

**Report**:
A problem raised by a player, identified separately from a match. Its identity can associate feedback with a match replay.
_Avoid_: replay, match outcome

**Match Replay**:
A read-only account of one match's visible game events and submitted choices for support inspection. It is distinct from browser-session analytics replay.
_Avoid_: session replay, game recording
