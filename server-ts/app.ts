import type { Database } from 'bun:sqlite'
import { authRoutes, sessionPlayer, type WebAuth } from './auth.ts'
import { cardImageRoutes, type CardImageIndex } from './card-images.ts'
import { json, serveRoutes, type HttpOptions, type Routes } from './http.ts'
import { roadmapRoutes } from './roadmap.ts'

export interface WebServices {
  db: Database
  auth: WebAuth
  cardImages: CardImageIndex
  operatorToken: string
}

export function productRoutes(services: WebServices): Routes {
  return {
    '/api/health': { GET: () => json({ status: 'ok' }) },
    ...authRoutes(services.auth, services.operatorToken),
    ...roadmapRoutes(services.auth, services.db),
    ...cardImageRoutes(services.cardImages),
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
