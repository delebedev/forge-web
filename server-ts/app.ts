import type { Database } from 'bun:sqlite'
import { authRoutes, sessionPlayer, type WebAuth } from './auth.ts'
import { cardImageRoutes, type CardImageIndex } from './card-images.ts'
import { courseRecordRoutes, type CourseRecordStore } from './course-records.ts'
import { deckRoutes, type DeckStore } from './decks.ts'
import { json, serveRoutes, type HttpOptions, type Routes } from './http.ts'
import { puzzleRoutes } from './puzzles.ts'
import { roadmapRoutes } from './roadmap.ts'

export interface WebServices {
  db: Database
  auth: WebAuth
  cardImages: CardImageIndex
  decks: DeckStore
  courseRecords: CourseRecordStore
  operatorToken: string
}

export function productRoutes(services: WebServices): Routes {
  return {
    '/api/health': { GET: () => json({ status: 'ok' }) },
    ...authRoutes(services.auth, services.operatorToken),
    ...roadmapRoutes(services.auth, services.db),
    ...cardImageRoutes(services.cardImages),
    ...puzzleRoutes(services.auth, services.db),
    ...courseRecordRoutes(services.auth, services.courseRecords),
    ...deckRoutes(services.auth, services.decks),
  }
}

export function startHttpServer(
  services: WebServices,
  options: Omit<HttpOptions, 'playerOf'> & { hostname: string; port: number },
) {
  const { routes, fetch } = serveRoutes(productRoutes(services), {
    ...options,
    playerOf: (req) => {
      try {
        return sessionPlayer(services.auth, req)?.playerId ?? null
      } catch {
        return null
      }
    },
  })
  return Bun.serve({ hostname: options.hostname, port: options.port, routes, fetch })
}
