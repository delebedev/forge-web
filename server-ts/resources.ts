// Static imports embed these files in a compiled binary; `bun run` reads them from the repository.
import v1 from '../server/src/main/resources/db/migration/V1__product_schema.sql' with { type: 'text' }
import v2 from '../server/src/main/resources/db/migration/V2__index_decks_by_player.sql' with { type: 'text' }
import v3 from '../server/src/main/resources/db/migration/V3__match_outcomes.sql' with { type: 'text' }
import v4 from '../server/src/main/resources/db/migration/V4__generated_puzzles.sql' with { type: 'text' }
import v5 from '../server/src/main/resources/db/migration/V5__roadmap.sql' with { type: 'text' }
import v6 from '../server/src/main/resources/db/migration/V6__ship_draft_and_play.sql' with { type: 'text' }
import v7 from '../server/src/main/resources/db/migration/V7__browser_course_plays.sql' with { type: 'text' }
import v8 from '../server/src/main/resources/db/migration/V8__puzzle_rating_device.sql' with { type: 'text' }
import v9 from '../server/src/main/resources/db/migration/V9__course_records.sql' with { type: 'text' }
import v10 from '../server/src/main/resources/db/migration/V10__drop_engine_tables.sql' with { type: 'text' }
import cardImagesPath from '../server/src/main/resources/card-images.sqlite' with { type: 'file' }

export interface MigrationScript {
  script: string
  sql: string
}

export const migrationScripts: MigrationScript[] = [
  { script: 'V1__product_schema.sql', sql: v1 },
  { script: 'V2__index_decks_by_player.sql', sql: v2 },
  { script: 'V3__match_outcomes.sql', sql: v3 },
  { script: 'V4__generated_puzzles.sql', sql: v4 },
  { script: 'V5__roadmap.sql', sql: v5 },
  { script: 'V6__ship_draft_and_play.sql', sql: v6 },
  { script: 'V7__browser_course_plays.sql', sql: v7 },
  { script: 'V8__puzzle_rating_device.sql', sql: v8 },
  { script: 'V9__course_records.sql', sql: v9 },
  { script: 'V10__drop_engine_tables.sql', sql: v10 },
]

export const cardImagesFile: string = cardImagesPath
