import { Database } from 'bun:sqlite'
import { BadRequest, empty, type Routes } from './platform/http.ts'
import { Logger } from './platform/log.ts'

const log = new Logger('forge.web.server.cards.CardImageIndex')
const TOKEN_SUFFIX = ' Token'
const REBALANCED_NAME_PREFIX = 'A-'
const CDN_PREFIX = 'https://cards.scryfall.io/'

interface ImageUrls {
  normal: string
  back: string | null
}

const keyOf = (name: string, token: boolean) => `${token ? 1 : 0}:${name}`

export class CardImageIndex {
  private readonly reported = new Set<string>()
  private readonly images: Map<string, ImageUrls>
  private readonly reportMisses: boolean
  private readonly maxReportedMisses: number

  constructor(images: Map<string, ImageUrls>, reportMisses: boolean, maxReportedMisses = 10_000) {
    this.images = images
    this.reportMisses = reportMisses
    this.maxReportedMisses = maxReportedMisses
  }

  static empty(): CardImageIndex {
    return new CardImageIndex(new Map(), false)
  }

  /** Loads the bundled index; a broken index logs an error and leaves artwork unavailable. */
  static async load(file: string): Promise<CardImageIndex> {
    try {
      const db = Database.deserialize(await Bun.file(file).bytes(), true)
      try {
        return CardImageIndex.fromDatabase(db)
      } finally {
        db.close()
      }
    } catch (cause) {
      log.error(
        'Card image index failed to load',
        { event: 'card_image.index_load_failed', reason: (cause as Error).name },
        cause,
      )
      return CardImageIndex.empty()
    }
  }

  static fromDatabase(db: Database): CardImageIndex {
    const version = db.query("SELECT value FROM metadata WHERE key = 'schema_version'").get() as {
      value: string
    } | null
    if (version?.value !== '1') {
      throw new Error('Unsupported card image index schema')
    }
    const images = new Map<string, ImageUrls>()
    const rows = db
      .query('SELECT lookup_name, is_token, normal_url, back_url FROM card_images')
      .all() as {
      lookup_name: string
      is_token: number
      normal_url: string
      back_url: string | null
    }[]
    for (const row of rows) {
      for (const url of [row.normal_url, row.back_url]) {
        if (url !== null && !url.startsWith(CDN_PREFIX)) {
          throw new Error('Card image index contains a non-Scryfall CDN URL')
        }
      }
      images.set(keyOf(row.lookup_name, row.is_token === 1), {
        normal: row.normal_url,
        back: row.back_url,
      })
    }
    return new CardImageIndex(images, true)
  }

  find(cardName: string, backFace = false): string | null {
    return this.url(cardName, this.resolve(cardName), backFace)
  }

  /**
   * Artwork for a composed face. A rebalanced `A-` card has no printing of its own, so it borrows its
   * original's illustration; full-card images stay on `find` because the printed rules can differ.
   */
  findArtwork(cardName: string, backFace = false): string | null {
    const source = cardName.startsWith(REBALANCED_NAME_PREFIX)
      ? cardName.slice(REBALANCED_NAME_PREFIX.length)
      : null
    return this.url(
      cardName,
      this.resolve(cardName) ?? (source === null ? null : this.resolve(source)),
      backFace,
    )
  }

  private url(cardName: string, image: ImageUrls | null, backFace: boolean): string | null {
    if (image === null) {
      this.reportMiss(cardName)
      return null
    }
    return backFace ? (image.back ?? image.normal) : image.normal
  }

  private key(cardName: string) {
    const token = cardName.endsWith(TOKEN_SUFFIX)
    const name = (token ? cardName.slice(0, -TOKEN_SUFFIX.length) : cardName).trim().toLowerCase()
    return { name, token }
  }

  /** A token-named lookup falls back to the card row and back, since the suffix is only a hint. */
  private resolve(cardName: string): ImageUrls | null {
    const { name, token } = this.key(cardName)
    return this.images.get(keyOf(name, token)) ?? this.images.get(keyOf(name, !token)) ?? null
  }

  private reportMiss(cardName: string) {
    if (!this.reportMisses) {
      return
    }
    const { name, token } = this.key(cardName)
    const key = keyOf(name, token)
    // Names come from a public route, so the set of reported misses is bounded.
    if (this.reported.has(key) || this.reported.size >= this.maxReportedMisses) {
      return
    }
    this.reported.add(key)
    log.warn('Card image lookup failed', {
      event: 'card_image.lookup_failed',
      card_name: name,
      token,
    })
  }
}

/** Redirects a card name to its artwork, for surfaces that render before the card index loads. */
export function cardImageRoutes(index: CardImageIndex): Routes {
  return {
    '/api/public/cards/image': {
      GET: (ctx) => {
        const query = ctx.url.searchParams
        const name = query.get('name')
        if (!name?.trim()) {
          throw new BadRequest('name is required')
        }
        const cardName = name.slice(0, 200)
        const backFace = query.get('face') === 'back'
        const artCrop = query.get('version') === 'art_crop'
        const artwork = artCrop
          ? index.findArtwork(cardName, backFace)
          : index.find(cardName, backFace)
        if (artwork === null) {
          return empty(404)
        }
        return empty(302, {
          'Cache-Control': 'public, max-age=86400',
          Location: artCrop ? artwork.replaceAll('/normal/', '/art_crop/') : artwork,
        })
      },
    },
  }
}
