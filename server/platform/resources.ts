// Static imports embed these files in a compiled binary; `bun run` reads them from the repository.
import v1 from '../migrations/V1__product_schema.sql' with { type: 'text' }
import v2 from '../migrations/V2__index_decks_by_player.sql' with { type: 'text' }
import v3 from '../migrations/V3__match_outcomes.sql' with { type: 'text' }
import v4 from '../migrations/V4__generated_puzzles.sql' with { type: 'text' }
import v5 from '../migrations/V5__roadmap.sql' with { type: 'text' }
import v6 from '../migrations/V6__ship_draft_and_play.sql' with { type: 'text' }
import v7 from '../migrations/V7__browser_course_plays.sql' with { type: 'text' }
import v8 from '../migrations/V8__puzzle_rating_device.sql' with { type: 'text' }
import v9 from '../migrations/V9__course_records.sql' with { type: 'text' }
import v10 from '../migrations/V10__drop_engine_tables.sql' with { type: 'text' }
import v11 from '../migrations/V11__keep_match_outcomes.sql' with { type: 'text' }
import v12 from '../migrations/V12__drop_legacy_decks.sql' with { type: 'text' }
import starter0 from '../../content/decks/Pauper Green Stompy.txt' with { type: 'text' }
import starter1 from '../../content/decks/Pauper Red Burn.txt' with { type: 'text' }
import starter2 from '../../content/decks/Pauper Blue Tempo.txt' with { type: 'text' }
import starter3 from '../../content/decks/Pauper White Lifegain.txt' with { type: 'text' }
import starter4 from '../../content/decks/Pauper Black Sacrifice.txt' with { type: 'text' }
import starter5 from '../../content/decks/commander/Atraxa - Counter Growth.txt' with { type: 'text' }
import starter6 from '../../content/decks/commander/Krenko - Goblin Swarm.txt' with { type: 'text' }
import starter7 from '../../content/decks/commander/Teval - Graveyard Lands.txt' with { type: 'text' }
import starter8 from '../../content/decks/commander/Vivi - Spellslinger.txt' with { type: 'text' }
import starter9 from "../../content/decks/commander/Y'shtola - Spell Control.txt" with { type: 'text' }
import cardImagesPath from '../assets/card-images.sqlite' with { type: 'file' }

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
  { script: 'V11__keep_match_outcomes.sql', sql: v11 },
  { script: 'V12__drop_legacy_decks.sql', sql: v12 },
]

export const cardImagesFile: string = cardImagesPath

/** Starter lists in seeding order. */
export const starterDeckFiles: { name: string; text: string }[] = [
  { name: 'Pauper Green Stompy', text: starter0 },
  { name: 'Pauper Red Burn', text: starter1 },
  { name: 'Pauper Blue Tempo', text: starter2 },
  { name: 'Pauper White Lifegain', text: starter3 },
  { name: 'Pauper Black Sacrifice', text: starter4 },
  { name: 'Atraxa - Counter Growth', text: starter5 },
  { name: 'Krenko - Goblin Swarm', text: starter6 },
  { name: 'Teval - Graveyard Lands', text: starter7 },
  { name: 'Vivi - Spellslinger', text: starter8 },
  { name: "Y'shtola - Spell Control", text: starter9 },
]
