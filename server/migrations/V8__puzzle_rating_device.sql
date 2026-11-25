ALTER TABLE puzzle_ratings ADD COLUMN device_id TEXT NULL;
CREATE UNIQUE INDEX puzzle_ratings_puzzle_device ON puzzle_ratings(puzzle_id, device_id);
