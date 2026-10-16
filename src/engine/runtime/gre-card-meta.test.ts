import { httpCardMeta } from '@shared/api/http-test-fixtures'
import { afterEach, expect, test } from 'bun:test'
import { fetchGreCardMeta, parseGreCardMeta } from './gre-card-meta'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('card metadata parses localized ability presentation', async () => {
  let requestedUrl = ''
  globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
    requestedUrl = String(input)
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          42: httpCardMeta(42, {
            name: 'Modal Card',
            setCode: 'NEO',
            rarity: 'MythicRare',
            loyalty: '3',
            defense: '4',
            faceLayout: 'Modal',
            rulesText: 'Choose one —\n• First mode\n• Second mode',
            linkedFaceGrpIds: [43, 44],
            mechanicHelp: [
              {
                keyword: 'Ninjutsu',
                title: 'Ninjutsu',
                description: 'Return an unblocked attacker you control to hand.',
                cost: '{2}{B}',
              },
            ],
            abilities: {
              7: { text: 'First mode', manaCost: '{1}{U}', keyword: null },
              8: { text: 'Second mode', keyword: 'Flanking', manaCost: null },
            },
          }),
        }),
    } as Response)
  }) as unknown as typeof fetch

  const metadata = await fetchGreCardMeta([42])

  expect(requestedUrl).toEndWith('/api/public/cards/by-grpids?ids=42&abilities=true')
  expect(metadata.get(42)?.abilities).toEqual({
    7: { text: 'First mode', manaCost: '{1}{U}' },
    8: { text: 'Second mode', manaCost: null, keyword: 'Flanking' },
  })
  expect(metadata.get(42)?.rulesText).toBe('Choose one —\n• First mode\n• Second mode')
  expect(metadata.get(42)?.linkedFaceGrpIds).toEqual([43, 44])
  expect(metadata.get(42)).toMatchObject({
    loyalty: '3',
    defense: '4',
    faceLayout: 'Modal',
    setCode: 'NEO',
    rarity: 'MythicRare',
  })
  expect(metadata.get(42)?.mechanicHelp).toEqual([
    {
      keyword: 'Ninjutsu',
      title: 'Ninjutsu',
      description: 'Return an unblocked attacker you control to hand.',
      cost: '{2}{B}',
    },
  ])
})

test('presentation normalization omits malformed ability entries', () => {
  const metadata = parseGreCardMeta({
    42: {
      setCode: 4,
      rarity: [],
      mechanicHelp: [
        { keyword: 'Menace', title: 'Menace' },
        { keyword: 4, title: 'Bad', description: 'Bad' },
      ],
      abilities: {
        bad: { text: 'Bad id' },
        7: { text: 12 },
        8: { text: 'Usable', manaCost: 3 },
      },
    },
  })
  expect(metadata.get(42)?.abilities).toEqual({ 8: { text: 'Usable', manaCost: null } })
  expect(metadata.get(42)?.mechanicHelp).toEqual([])
  expect(metadata.get(42)).toMatchObject({ setCode: null, rarity: null })
})

test('HTTP metadata rejects incompatible fields before normalization', async () => {
  globalThis.fetch = (async () =>
    Response.json({
      42: httpCardMeta(42, { name: 'Card' }),
      43: { name: 7 },
    })) as unknown as typeof fetch
  const failure = await fetchGreCardMeta([42, 43]).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(Error)
})
