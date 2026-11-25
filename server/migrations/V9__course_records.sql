CREATE TABLE course_records (
    player_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    revision INT NOT NULL,
    document TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (player_id, event_name)
);

-- Copies draft and sealed courses that have a pool. Drafts still picking have no pool and are not copied.
-- Their documents carry no seed, picks or catalog version, so they resume at deck building or games.
INSERT INTO course_records (player_id, event_name, revision, document, updated_at)
SELECT
    c.player_id,
    c.event_name,
    1,
    json_object(
        'kind', CASE WHEN substr(c.event_name, 1, 7) = 'Sealed_' THEN 'sealed' ELSE 'draft' END,
        'set', substr(
            substr(c.event_name, instr(c.event_name, '_') + 1),
            1,
            instr(substr(c.event_name, instr(c.event_name, '_') + 1), '_') - 1
        ),
        'seed', NULL,
        'picks', json('[]'),
        'catalogVersion', NULL,
        'pool', json(c.card_pool),
        'deck', CASE
            WHEN c.deck IS NULL THEN NULL
            ELSE json_object(
                'mainDeck', json(json_extract(c.deck, '$.mainDeck')),
                'sideboard', json(json_extract(c.deck, '$.sideboard'))
            )
        END,
        'botDecks', (
            SELECT json_group_array(json(r.main_json))
            FROM (
                SELECT main_json
                FROM draft_pod_results
                WHERE session_id = (
                    SELECT s.id
                    FROM draft_sessions s
                    WHERE s.player_id = c.player_id AND s.event_name = c.event_name AND s.status = 'Completed'
                    LIMIT 1
                )
                ORDER BY seat_index
            ) r
        ),
        'wins', c.wins,
        'losses', c.losses,
        'phase', CASE c.module
            WHEN 'DeckSelect' THEN 'deck_build'
            WHEN 'CreateMatch' THEN 'games'
            ELSE 'finished'
        END
    ),
    strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
FROM courses c
WHERE (substr(c.event_name, 1, 7) = 'Sealed_' OR substr(c.event_name, 1, 11) = 'QuickDraft_')
    AND c.card_pool <> '[]';
