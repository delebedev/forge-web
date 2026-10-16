CREATE TABLE match_outcomes (
    match_id TEXT NOT NULL PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT NULL,
    release TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('play', 'puzzle', 'spectator')),
    public_match BOOLEAN NOT NULL,
    format TEXT NULL,
    outcome TEXT NULL CHECK (outcome IS NULL OR outcome IN (
        'completed', 'explicit_abandon', 'expired', 'launch_failed', 'engine_failed',
        'deployment_interrupted', 'server_shutdown', 'server_cancelled', 'interrupted_unknown'
    ))
);

CREATE INDEX match_outcomes_started_at ON match_outcomes (started_at);
