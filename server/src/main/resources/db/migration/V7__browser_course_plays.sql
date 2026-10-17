CREATE TABLE course_plays (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    seat1_deck TEXT NOT NULL,
    seat2_deck TEXT NOT NULL,
    won BOOLEAN,
    retired BOOLEAN NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX course_plays_pending ON course_plays(course_id) WHERE won IS NULL AND retired = 0;
