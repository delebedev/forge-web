CREATE TABLE puzzle_generation_runs (
    id TEXT NOT NULL PRIMARY KEY,
    owner_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    sampled_cards_json TEXT NOT NULL,
    attempts_json TEXT NOT NULL,
    puzzle_id TEXT NULL,
    error TEXT NULL
);

CREATE TABLE generated_puzzles (
    id TEXT NOT NULL PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE REFERENCES puzzle_generation_runs(id),
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE puzzle_ratings (
    id TEXT NOT NULL PRIMARY KEY,
    puzzle_id TEXT NOT NULL REFERENCES generated_puzzles(id),
    player_id TEXT NULL,
    reaction TEXT NOT NULL CHECK (reaction IN ('fun', 'meh', 'bad')),
    comment TEXT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('won', 'lost')),
    actions_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX puzzle_ratings_puzzle_id ON puzzle_ratings(puzzle_id);
