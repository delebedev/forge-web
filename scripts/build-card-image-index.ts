/**
 * Build the card-image index from Scryfall Oracle bulk data.
 *
 * The index is the name-and-token keyed artwork table shipped by both the
 * product server and the browser asset build. Regenerate it when Scryfall
 * publishes a set whose cards are not yet indexed; see
 * [docs/card-images.md](../docs/card-images.md).
 */
import { Database } from 'bun:sqlite'
import { mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { createReadStream } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'

const BULK_METADATA_URL = 'https://api.scryfall.com/bulk-data/oracle-cards'
const REQUEST_HEADERS = {
  Accept: 'application/json;q=0.9,*/*;q=0.8',
  'User-Agent': 'forge-web-card-images/1.0 (https://forgeweb.app)',
}

/** One name-and-token keyed artwork row for a single Oracle card, faces included. */
export type CandidateRow = [
  name: string,
  token: number,
  normal: string,
  back: string | null,
  sourceId: string,
  releasedAt: string,
]

type Selected = { normal: string; back: string | null; sourceId: string; releasedAt: string }

function normalImageUrl(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const normal = (value as Record<string, unknown>)['normal']
  return typeof normal === 'string' ? normal : null
}

export function candidateRows(card: Record<string, unknown>): CandidateRow[] {
  const name = card['name']
  if (typeof name !== 'string') {
    return []
  }

  const layout = String(card['layout'] ?? '')
  const token = Number(layout === 'token' || layout.endsWith('_token'))
  const sourceId = String(card['id'] ?? '')
  const releasedAt = String(card['released_at'] ?? '')
  const normal = normalImageUrl(card['image_uris'])
  const rows: CandidateRow[] = normal ? [[name, token, normal, null, sourceId, releasedAt]] : []

  const faces = card['card_faces']
  if (Array.isArray(faces)) {
    const faceRows: Array<[name: string, normal: string, ownImage: boolean]> = []
    for (const face of faces) {
      if (typeof face !== 'object' || face === null) {
        continue
      }
      const record = face as Record<string, unknown>
      const faceName = record['name']
      if (typeof faceName !== 'string') {
        continue
      }
      const faceNormal = normalImageUrl(record['image_uris'])
      if (faceNormal !== null) {
        faceRows.push([faceName, faceNormal, true])
      } else if (normal !== null) {
        faceRows.push([faceName, normal, false])
      }
    }
    if (faceRows.length > 0) {
      const back = faceRows.length > 1 && faceRows[1][2] ? faceRows[1][1] : null
      faceRows.forEach(([faceName, faceNormal], index) => {
        rows.push([faceName, token, faceNormal, index === 0 ? back : null, sourceId, releasedAt])
      })
      if (normal === null) {
        rows.push([name, token, faceRows[0][1], back, sourceId, releasedAt])
      }
    }
  }
  return rows
}

/**
 * Write the index to `output` and return its artwork identity count.
 *
 * Accepts sync and async card sources so a downloaded bulk file can stream
 * through without materializing every card.
 */
export async function buildIndex(
  cards: Iterable<unknown> | AsyncIterable<unknown>,
  output: string,
  sourceUri: string,
  sourceUpdatedAt: string,
): Promise<number> {
  const selected = new Map<string, Map<number, Selected>>()
  for await (const value of cards) {
    if (typeof value !== 'object' || value === null) {
      continue
    }
    for (const [name, token, normal, back, sourceId, releasedAt] of candidateRows(
      value as Record<string, unknown>,
    )) {
      const key = name.trim().toLowerCase()
      let byToken = selected.get(key)
      if (byToken === undefined) {
        byToken = new Map()
        selected.set(key, byToken)
      }
      const previous = byToken.get(token)
      // Newest printing wins so a name maps to its current illustration.
      if (
        previous === undefined ||
        releasedAt > previous.releasedAt ||
        (releasedAt === previous.releasedAt && sourceId > previous.sourceId)
      ) {
        byToken.set(token, { normal, back, sourceId, releasedAt })
      }
    }
  }

  mkdirSync(dirname(output), { recursive: true })
  const temporary = `${output}.${crypto.randomUUID()}.tmp`
  try {
    const database = new Database(temporary, { create: true })
    try {
      database.exec(`
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        CREATE TABLE metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE card_images (
          lookup_name TEXT NOT NULL,
          is_token INTEGER NOT NULL CHECK (is_token IN (0, 1)),
          normal_url TEXT NOT NULL,
          back_url TEXT,
          PRIMARY KEY (lookup_name, is_token)
        ) WITHOUT ROWID;
      `)
      const insertMetadata = database.prepare('INSERT INTO metadata(key, value) VALUES (?, ?)')
      const insertImage = database.prepare(
        'INSERT INTO card_images(lookup_name, is_token, normal_url, back_url) VALUES (?, ?, ?, ?)',
      )
      database.transaction(() => {
        for (const [key, value] of [
          ['schema_version', '1'],
          ['source_uri', sourceUri],
          ['source_updated_at', sourceUpdatedAt],
          ['generated_at', new Date().toISOString().replace('Z', '+00:00')],
        ]) {
          insertMetadata.run(key, value)
        }
        for (const [lookupName, byToken] of selected) {
          for (const [token, row] of byToken) {
            insertImage.run(lookupName, token, row.normal, row.back)
          }
        }
      })()
      database.exec('ANALYZE')
    } finally {
      database.close()
    }
    renameSync(temporary, output)
  } finally {
    rmSync(temporary, { force: true })
  }
  return [...selected.values()].reduce((count, byToken) => count + byToken.size, 0)
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: REQUEST_HEADERS })
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}`)
  }
  return await response.json()
}

async function* jsonLines(source: Readable): AsyncGenerator<unknown> {
  const lines = createInterface({ input: source.pipe(createGunzip()) })
  for await (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) {
      yield JSON.parse(trimmed) as unknown
    }
  }
}

const OPTIONS = new Set(['--input', '--output', '--source-uri', '--source-updated-at'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

export type Options = {
  input?: string
  output?: string
  sourceUri?: string
  sourceUpdatedAt?: string
}

/**
 * Parse `--name value` pairs. Every option takes a value, so a name followed by
 * another name has no operand and is reported rather than read as a path.
 */
export function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    if (name === undefined || !OPTIONS.has(name)) {
      throw new Error(`Unknown option ${String(name)}`)
    }
    const value = argv[index + 1]
    if (value === undefined || OPTIONS.has(value)) {
      throw new Error(`${name} requires a value`)
    }
    if (name === '--source-updated-at' && !ISO_DATE.test(value)) {
      throw new Error(`${name} must be an ISO 8601 date, got ${value}`)
    }
    if (values.has(name)) {
      throw new Error(`${name} is given more than once`)
    }
    values.set(name, value)
  }
  return {
    input: values.get('--input'),
    output: values.get('--output'),
    sourceUri: values.get('--source-uri'),
    sourceUpdatedAt: values.get('--source-updated-at'),
  }
}

/** A local bulk file is either gzip-compressed JSON Lines or a JSON array. */
function localCards(path: string): Iterable<unknown> | AsyncIterable<unknown> {
  if (path.endsWith('.gz')) {
    return jsonLines(createReadStream(path))
  }
  const cards = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!Array.isArray(cards)) {
    throw new Error(`${path} is not a JSON array of Oracle cards`)
  }
  return cards
}

const repo = resolve(import.meta.dir, '..')

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const output = resolve(options.output ?? resolve(repo, 'server/card-images.sqlite'))
  const input = options.input

  let cards: Iterable<unknown> | AsyncIterable<unknown>
  let sourceUri: string
  let sourceUpdatedAt: string
  if (input === undefined) {
    const metadata = (await fetchJson(BULK_METADATA_URL)) as Record<string, unknown>
    const downloadUri = metadata['jsonl_download_uri']
    if (typeof downloadUri !== 'string') {
      throw new Error('Scryfall bulk metadata did not contain jsonl_download_uri')
    }
    const response = await fetch(downloadUri, { headers: REQUEST_HEADERS })
    if (!response.ok || response.body === null) {
      throw new Error(`GET ${downloadUri} failed with ${response.status}`)
    }
    sourceUri = downloadUri
    sourceUpdatedAt = String(metadata['updated_at'] ?? '')
    cards = jsonLines(Readable.from(response.body as AsyncIterable<Uint8Array>))
  } else {
    const path = resolve(input)
    // A local copy's mtime says when it was written, not when Scryfall published
    // it, so the export's own date has to be supplied rather than inferred.
    if (options.sourceUpdatedAt === undefined) {
      throw new Error('--source-updated-at is required with --input')
    }
    sourceUpdatedAt = options.sourceUpdatedAt
    sourceUri = options.sourceUri ?? path
    cards = localCards(path)
  }

  const count = await buildIndex(cards, output, sourceUri, sourceUpdatedAt)
  console.log(`Wrote ${count} image identities to ${output}`)
}

if (import.meta.main) {
  await main()
}
