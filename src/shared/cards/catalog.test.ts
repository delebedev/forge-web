import { httpCardMeta } from '@shared/api/http-test-fixtures'
import { afterEach, expect, test } from 'bun:test'
import { grpIdsToNames, hydrateLinkedFaces, webDraftCards } from './catalog'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test('name hydration does not request ability metadata', async () => {
  let requestedUrl = ''
  globalThis.fetch = ((input: Parameters<typeof fetch>[0]) => {
    requestedUrl = String(input)
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ 42: httpCardMeta(42, { name: 'Named Card' }) }),
    } as Response)
  }) as unknown as typeof fetch

  const names = await grpIdsToNames([42])

  expect(requestedUrl).toEndWith('/api/public/cards/by-grpids?ids=42')
  expect(names).toEqual(new Map([[42, 'Named Card']]))
})

test('limited card hydration preserves pack order and metadata', async () => {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          43: httpCardMeta(43, {
            name: 'Blue Card',
            manaCost: '{1}{U}{U}',
            types: 'Creature',
            rarity: 'Uncommon',
            rulesText: 'Flying',
            power: '2',
            toughness: '3',
          }),
          44: httpCardMeta(44, {
            name: 'Red Card',
            manaCost: '{R}',
            types: 'Instant',
            rarity: 'Common',
          }),
        }),
    } as Response)) as unknown as typeof fetch

  const cards = await webDraftCards([44, 43])

  expect(cards.map((card) => card.name)).toEqual(['Red Card', 'Blue Card'])
  expect(cards[1]?.colors).toEqual(['U'])
  expect(cards[1]?.typeLine).toBe('Creature')
  expect(cards[1]?.rulesText).toBe('Flying')
  expect(cards[1]?.power).toBe('2')
  expect(cards[1]?.toughness).toBe('3')
})

test('catalog hydration resolves split faces through their aggregate parent', async () => {
  const parent = httpCardMeta(510, {
    name: 'Left // Right',
    faceLayout: 'Split',
    linkedFaceGrpIds: [511, 512],
  })
  const left = httpCardMeta(511, {
    name: 'Left',
    types: 'Instant',
    rulesText: 'Draw a card.',
    linkedFaceGrpIds: [510],
  })
  const right = httpCardMeta(512, {
    name: 'Right',
    types: 'Instant',
    rulesText: 'Gain 3 life.',
    manaCost: '{W}',
    linkedFaceGrpIds: [510],
  })
  const requests: string[] = []
  const cards = await hydrateLinkedFaces({ 511: left }, async (path) => {
    requests.push(path)
    return new Response(JSON.stringify(path.endsWith('ids=510') ? { 510: parent } : { 512: right }))
  })
  expect(requests).toEqual([
    '/api/public/cards/by-grpids?ids=510',
    '/api/public/cards/by-grpids?ids=512',
  ])
  expect(cards[0]?.linkedFaces).toEqual([right])
})

test('limited catalog cards retain layout and linked face rules', async () => {
  const creature = httpCardMeta(520, {
    name: 'Adventurer',
    types: 'Creature',
    faceLayout: 'Adventure',
    linkedFaceGrpIds: [521],
  })
  const adventure = httpCardMeta(521, {
    name: 'Quest',
    types: 'Sorcery',
    manaCost: '{G}',
    rulesText: 'Draw a card.',
  })
  globalThis.fetch = (async (input) =>
    new Response(
      JSON.stringify(String(input).endsWith('ids=520') ? { 520: creature } : { 521: adventure }),
    )) as typeof fetch
  const [card] = await webDraftCards([520])
  expect(card?.faceLayout).toBe('Adventure')
  expect(card?.linkedFaces).toEqual([adventure])
})
