CREATE TABLE players (
    player_id TEXT NOT NULL PRIMARY KEY,
    screen_name TEXT NOT NULL,
    preferences TEXT DEFAULT '{}' NOT NULL,
    inventory TEXT DEFAULT '{}' NOT NULL,
    cosmetics TEXT DEFAULT '{}' NOT NULL,
    rank_info TEXT DEFAULT '{}' NOT NULL,
    created_at TEXT DEFAULT 'datetime(''now'')' NOT NULL
);

CREATE TABLE decks (
    deck_id TEXT NOT NULL PRIMARY KEY,
    player_id TEXT NOT NULL,
    name TEXT NOT NULL,
    tile_name TEXT DEFAULT '' NOT NULL,
    format TEXT DEFAULT 'Standard' NOT NULL,
    is_favorite BOOLEAN DEFAULT 0 NOT NULL,
    cards TEXT DEFAULT '{}' NOT NULL,
    updated_at TEXT DEFAULT 'datetime(''now'')' NOT NULL
);

CREATE TABLE courses (
    id TEXT NOT NULL PRIMARY KEY,
    player_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    module TEXT NOT NULL,
    wins INT DEFAULT 0 NOT NULL,
    losses INT DEFAULT 0 NOT NULL,
    card_pool TEXT DEFAULT '[]' NOT NULL,
    card_pool_by_collation TEXT DEFAULT '[]' NOT NULL,
    deck TEXT NULL,
    deck_summary TEXT NULL,
    CONSTRAINT chk_courses_signed_integer_wins CHECK (wins BETWEEN -2147483648 AND 2147483647),
    CONSTRAINT chk_courses_signed_integer_losses CHECK (losses BETWEEN -2147483648 AND 2147483647)
);

CREATE TABLE draft_sessions (
    id TEXT NOT NULL PRIMARY KEY,
    player_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    status TEXT NOT NULL,
    pack_number INT DEFAULT 0 NOT NULL,
    pick_number INT DEFAULT 0 NOT NULL,
    draft_pack TEXT DEFAULT '[]' NOT NULL,
    picked_cards TEXT DEFAULT '[]' NOT NULL,
    CONSTRAINT chk_draft_sessions_signed_integer_pack_number CHECK (pack_number BETWEEN -2147483648 AND 2147483647),
    CONSTRAINT chk_draft_sessions_signed_integer_pick_number CHECK (pick_number BETWEEN -2147483648 AND 2147483647)
);

CREATE TABLE draft_pod_results (
    session_id TEXT NOT NULL,
    seat_index INT NOT NULL,
    main_json TEXT NOT NULL,
    PRIMARY KEY (session_id, seat_index),
    CONSTRAINT chk_draft_pod_results_signed_integer_seat_index CHECK (seat_index BETWEEN -2147483648 AND 2147483647)
);

CREATE TABLE product_metadata (
    key TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE web_players (
    player_id TEXT NOT NULL PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX web_players_email ON web_players (email);

CREATE TABLE web_login_challenges (
    id TEXT NOT NULL PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at TEXT NULL,
    attempt_count INT DEFAULT 0 NOT NULL,
    request_ip_hash TEXT NULL,
    user_agent TEXT NULL,
    CONSTRAINT chk_web_login_challenges_signed_integer_attempt_count CHECK (attempt_count BETWEEN -2147483648 AND 2147483647)
);
CREATE INDEX web_login_challenges_email ON web_login_challenges (email);

CREATE TABLE web_sessions (
    id TEXT NOT NULL PRIMARY KEY,
    player_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    idle_expires_at TEXT NOT NULL,
    absolute_expires_at TEXT NOT NULL,
    revoked_at TEXT NULL,
    ip_hash TEXT NULL,
    user_agent TEXT NULL
);
CREATE INDEX web_sessions_player_id ON web_sessions (player_id);
CREATE UNIQUE INDEX web_sessions_token_hash ON web_sessions (token_hash);
