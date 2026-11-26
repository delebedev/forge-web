import type { Database } from 'bun:sqlite'
import { deviceId, sessionPlayer } from './auth/routes.ts'
import { type WebAuth } from './auth/web-auth.ts'
import { javaInstant, writeTransaction } from './platform/db.ts'
import { empty, json, readJson, requireRequest, type Routes } from './platform/http.ts'
import { InMemoryRateLimiter } from './platform/rate-limit.ts'
import {
  PuzzleRatingRequestInputSchema,
  type GeneratedPuzzle,
  type PuzzleRatingRequest,
} from './contract/wire-schemas.ts'

/** A rating with the contract's defaults applied: no comment and no actions. */
export interface PuzzleRating extends Omit<PuzzleRatingRequest, 'comment' | 'actions'> {
  comment: string | null
  actions: string[]
}

function withDefaults(request: PuzzleRatingRequest): PuzzleRating {
  return { ...request, comment: request.comment ?? null, actions: request.actions ?? [] }
}

const HOUR_MS = 3_600_000
const COLUMNS = 'id, title, text, created_at AS createdAt'

export function listPuzzles(db: Database, limit = 20): GeneratedPuzzle[] {
  return db
    .query(
      `SELECT ${COLUMNS} FROM generated_puzzles WHERE active = 1 ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as GeneratedPuzzle[]
}

export function findPuzzle(db: Database, id: string): GeneratedPuzzle | null {
  return db
    .query(`SELECT ${COLUMNS} FROM generated_puzzles WHERE id = ? AND active = 1`)
    .get(id) as GeneratedPuzzle | null
}

/** One rating per puzzle and device; rating again replaces it. */
export function ratePuzzle(
  db: Database,
  puzzleId: string,
  device: string,
  playerId: string | null,
  rating: PuzzleRating,
  now: () => number = Date.now,
): void {
  requireRequest(['fun', 'meh', 'bad'].includes(rating.reaction), 'Unknown reaction')
  requireRequest(['won', 'lost'].includes(rating.outcome), 'Unknown outcome')
  requireRequest(rating.comment === null || rating.comment.length <= 1000, 'Comment is too long')
  requireRequest(
    rating.actions.length <= 100 && rating.actions.every((action) => action.length <= 200),
    'Action chain is too long',
  )
  writeTransaction(db, () => {
    requireRequest(findPuzzle(db, puzzleId) !== null, 'Unknown puzzle')
    db.query('DELETE FROM puzzle_ratings WHERE puzzle_id = ? AND device_id = ?').run(
      puzzleId,
      device,
    )
    db.query(
      `INSERT INTO puzzle_ratings (id, puzzle_id, device_id, player_id, reaction, comment, outcome, actions_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      crypto.randomUUID(),
      puzzleId,
      device,
      playerId,
      rating.reaction,
      rating.comment,
      rating.outcome,
      JSON.stringify(rating.actions),
      javaInstant(now()),
    )
  })
}

export function puzzleRoutes(
  auth: WebAuth,
  db: Database,
  limiter = new InMemoryRateLimiter(),
): Routes {
  return {
    '/api/puzzles': { GET: () => json(listPuzzles(db)) },
    '/api/puzzles/:puzzleId': {
      GET: (ctx) => {
        const puzzle = findPuzzle(db, ctx.params['puzzleId'] ?? '')
        return puzzle ? json(puzzle) : empty(404)
      },
    },
    '/api/puzzles/:puzzleId/ratings': {
      POST: async (ctx) => {
        const device = deviceId(ctx)
        // Ratings need no account, so one address and the whole server have hourly budgets.
        const allowed = limiter.check(
          { key: `rating:ip:${ctx.ip}`, limit: 30, windowMs: HOUR_MS },
          { key: 'rating:global', limit: 1_000, windowMs: HOUR_MS },
        )
        if (!allowed) {
          return empty(429)
        }
        const puzzleId = ctx.params['puzzleId'] ?? ''
        if (findPuzzle(db, puzzleId) === null) {
          return empty(404)
        }
        const playerId = sessionPlayer(auth, ctx.req)?.playerId ?? null
        ratePuzzle(
          db,
          puzzleId,
          device,
          playerId,
          withDefaults(await readJson(ctx, PuzzleRatingRequestInputSchema)),
        )
        return empty(204)
      },
    },
  }
}
