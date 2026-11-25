CREATE TABLE roadmap_items (
    id TEXT NOT NULL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('considering', 'planned', 'building', 'shipped')),
    note TEXT NULL,
    status_updated_at TEXT NULL,
    sort_order INTEGER NOT NULL,
    visible BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE roadmap_votes (
    item_id TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES web_players(player_id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, player_id)
);

INSERT INTO roadmap_items (id, title, description, status, note, sort_order) VALUES
('play-stability', 'More reliable matches', 'Reduce stalls and unexpected interruptions so you can finish the match you started.', 'building', NULL, 10),
('card-interactions', 'More complete card interactions', 'Make more card abilities and in-game choices playable from start to finish.', 'building', NULL, 20),
('puzzle-gameplay', 'More exciting puzzles', 'Solve puzzles with richer situations and more meaningful choices.', 'building', NULL, 30),
('draft-and-play', 'Draft and play', 'Draft a deck, then play a match against AI.', 'considering', NULL, 40),
('saved-decks', 'Import and save decks', 'Bring a deck list into Forge Web and keep it ready for another game.', 'shipped', NULL, 50),
('daily-puzzle', 'Daily puzzle', 'Open a short puzzle from the public table, with no sign-in required.', 'shipped', NULL, 60);
