import type { Database } from 'bun:sqlite'
import { sessionPlayer } from './auth/routes.ts'
import { isGuestEmail, type WebAuth } from './auth/web-auth.ts'
import { writeTransaction } from './platform/db.ts'
import { empty, json, type Context, type Routes } from './platform/http.ts'
import type { RoadmapItem } from './contract/wire-schemas.ts'

interface ItemRow {
  id: string
  title: string
  description: string
  status: string
  note: string | null
  status_updated_at: string | null
}

export function listRoadmap(db: Database, playerId: string | null): RoadmapItem[] {
  const items = db
    .query(
      'SELECT id, title, description, status, note, status_updated_at FROM roadmap_items WHERE visible = 1 ORDER BY sort_order',
    )
    .all() as ItemRow[]
  const counts = new Map(
    (
      db
        .query('SELECT item_id, COUNT(player_id) AS votes FROM roadmap_votes GROUP BY item_id')
        .all() as {
        item_id: string
        votes: number
      }[]
    ).map((row) => [row.item_id, row.votes]),
  )
  const voted = new Set(
    playerId === null
      ? []
      : (
          db.query('SELECT item_id FROM roadmap_votes WHERE player_id = ?').all(playerId) as {
            item_id: string
          }[]
        ).map((row) => row.item_id),
  )
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    status: item.status,
    note: item.note,
    statusUpdatedAt: item.status_updated_at,
    votes: counts.get(item.id) ?? 0,
    voted: voted.has(item.id),
  }))
}

/** Records or removes a vote; false when the item is hidden, shipped or unknown. */
export function voteRoadmap(
  db: Database,
  itemId: string,
  playerId: string,
  selected: boolean,
): boolean {
  return writeTransaction(db, () => {
    const item = db.query('SELECT status, visible FROM roadmap_items WHERE id = ?').get(itemId) as {
      status: string
      visible: number
    } | null
    if (!item || !item.visible || item.status === 'shipped') {
      return false
    }
    if (selected) {
      db.query('INSERT OR IGNORE INTO roadmap_votes (item_id, player_id) VALUES (?, ?)').run(
        itemId,
        playerId,
      )
    } else {
      db.query('DELETE FROM roadmap_votes WHERE item_id = ? AND player_id = ?').run(
        itemId,
        playerId,
      )
    }
    return true
  })
}

/** A cross-site vote is refused: a present Origin must match the request's scheme and Host. */
function sameOrigin(ctx: Context): boolean {
  const origin = ctx.req.headers.get('Origin')
  if (origin === null) {
    return true
  }
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)/.exec(origin)
  const scheme = ctx.req.headers.get('X-Forwarded-Proto') ?? 'http'
  const host = ctx.req.headers.get('Host')
  return (
    match !== null &&
    match[1]?.toLowerCase() === scheme.toLowerCase() &&
    host !== null &&
    match[2]?.toLowerCase() === host.toLowerCase()
  )
}

export function roadmapRoutes(auth: WebAuth, db: Database): Routes {
  const vote = (selected: boolean) => (ctx: Context) => {
    const player = sessionPlayer(auth, ctx.req)
    if (!player) {
      return empty(401)
    }
    if (isGuestEmail(player.email) || !sameOrigin(ctx)) {
      return empty(403)
    }
    return empty(voteRoadmap(db, ctx.params['itemId'] ?? '', player.playerId, selected) ? 204 : 404)
  }
  return {
    '/api/roadmap': {
      GET: (ctx) => {
        const player = sessionPlayer(auth, ctx.req)
        return json(listRoadmap(db, player && !isGuestEmail(player.email) ? player.playerId : null))
      },
    },
    '/api/roadmap/:itemId/vote': { PUT: vote(true), DELETE: vote(false) },
  }
}
