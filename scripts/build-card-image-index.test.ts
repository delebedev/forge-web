import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildIndex } from './build-card-image-index'

type ArtworkRow = [normal: string, back: string | null]

function readIndex(path: string): {
  rows: Map<string, ArtworkRow>
  metadata: Map<string, string>
} {
  const database = new Database(path, { readonly: true })
  try {
    const rows = new Map<string, ArtworkRow>(
      database
        .query<
          { lookup_name: string; is_token: number; normal_url: string; back_url: string | null },
          []
        >('SELECT lookup_name, is_token, normal_url, back_url FROM card_images')
        .all()
        .map((row) => [`${row.lookup_name}:${row.is_token}`, [row.normal_url, row.back_url]]),
    )
    const metadata = new Map<string, string>(
      database
        .query<{ key: string; value: string }, []>('SELECT key, value FROM metadata')
        .all()
        .map((row) => [row.key, row.value]),
    )
    return { rows, metadata }
  } finally {
    database.close()
  }
}

function withOutput(run: (output: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'card-image-index-'))
  return run(join(directory, 'images.sqlite')).finally(() =>
    rmSync(directory, { recursive: true, force: true }),
  )
}

test('builds normal token and face lookups', async () => {
  const cards = [
    {
      id: 'spell-old',
      name: 'Treasure',
      layout: 'normal',
      released_at: '2024-01-01',
      image_uris: { normal: 'https://cards.scryfall.io/normal/spell.jpg' },
    },
    {
      id: 'token-new',
      name: 'Treasure',
      layout: 'token',
      released_at: '2025-01-01',
      image_uris: {
        normal: 'https://cards.scryfall.io/normal/token.jpg',
        art_crop: 'https://cards.scryfall.io/art_crop/token.jpg',
      },
    },
    {
      id: 'two-face',
      name: 'Front // Back',
      layout: 'transform',
      released_at: '2025-02-01',
      card_faces: [
        { name: 'Front', image_uris: { normal: 'https://cards.scryfall.io/normal/front.jpg' } },
        { name: 'Back', image_uris: { normal: 'https://cards.scryfall.io/normal/back.jpg' } },
      ],
    },
    {
      id: 'adventure',
      name: 'Creature // Adventure',
      layout: 'adventure',
      released_at: '2025-03-01',
      image_uris: { normal: 'https://cards.scryfall.io/normal/adventure.jpg' },
      card_faces: [{ name: 'Creature' }, { name: 'Adventure' }],
    },
    {
      id: 'double-faced-token',
      name: 'Incubator // Phyrexian',
      layout: 'double_faced_token',
      released_at: '2025-04-01',
      card_faces: [
        {
          name: 'Incubator',
          image_uris: { normal: 'https://cards.scryfall.io/normal/incubator.jpg' },
        },
        {
          name: 'Phyrexian',
          image_uris: { normal: 'https://cards.scryfall.io/normal/phyrexian.jpg' },
        },
      ],
    },
  ]

  await withOutput(async (output) => {
    expect(await buildIndex(cards, output, 'fixture', '2025-02-01')).toBe(11)
    const { rows, metadata } = readIndex(output)

    expect(rows.get('treasure:0')).toEqual(['https://cards.scryfall.io/normal/spell.jpg', null])
    expect(rows.get('treasure:1')).toEqual(['https://cards.scryfall.io/normal/token.jpg', null])
    expect(rows.get('front:0')).toEqual([
      'https://cards.scryfall.io/normal/front.jpg',
      'https://cards.scryfall.io/normal/back.jpg',
    ])
    expect(rows.get('back:0')).toEqual(['https://cards.scryfall.io/normal/back.jpg', null])
    expect(rows.get('front // back:0')).toEqual([
      'https://cards.scryfall.io/normal/front.jpg',
      'https://cards.scryfall.io/normal/back.jpg',
    ])
    expect(rows.get('creature:0')).toEqual(['https://cards.scryfall.io/normal/adventure.jpg', null])
    expect(rows.get('adventure:0')).toEqual([
      'https://cards.scryfall.io/normal/adventure.jpg',
      null,
    ])
    expect(rows.get('incubator:1')).toEqual([
      'https://cards.scryfall.io/normal/incubator.jpg',
      'https://cards.scryfall.io/normal/phyrexian.jpg',
    ])
    expect(metadata.get('schema_version')).toBe('1')
    expect(metadata.get('source_uri')).toBe('fixture')
    expect(metadata.get('source_updated_at')).toBe('2025-02-01')
    expect(metadata.get('generated_at')).toMatch(/\+00:00$/)
  })
})

test('newest printing wins for a name', async () => {
  const cards = [
    {
      id: 'new-printing',
      name: 'Lightning Bolt',
      layout: 'normal',
      released_at: '2026-11-01',
      image_uris: { normal: 'https://cards.scryfall.io/normal/new.jpg' },
    },
    {
      id: 'old-printing',
      name: 'Lightning Bolt',
      layout: 'normal',
      released_at: '2010-07-01',
      image_uris: { normal: 'https://cards.scryfall.io/normal/old.jpg' },
    },
  ]

  await withOutput(async (output) => {
    expect(await buildIndex(cards, output, 'fixture', '2026-11-01')).toBe(1)
    expect(readIndex(output).rows.get('lightning bolt:0')).toEqual([
      'https://cards.scryfall.io/normal/new.jpg',
      null,
    ])
  })
})
