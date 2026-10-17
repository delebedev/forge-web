import { expect, test } from 'bun:test'
import {
  TranscriptFrameSource,
  parseTranscriptBundle,
  transcriptCardMeta,
  transcriptFrames,
  type TranscriptBundle,
} from './gre-transcript'
import { GAME_STATE_TYPE_FULL } from '@engine/state/gre-state'

const BUNDLE_PATH = 'dev/transcripts/sample.greplay.json'

function bundleOf(batches: { messages: unknown[] }[]): TranscriptBundle {
  return {
    version: 1,
    label: 'test',
    source: 'test',
    viewerSeatId: 1,
    batches,
    cards: {},
    responses: [],
  }
}

function gsm(gameStateId: number, hand: number[]) {
  return {
    type: 'GREMessageType_GameStateMessage',
    gameStateId,
    gameStateMessage: {
      type: gameStateId === 1 ? 'Full' : 'Diff',
      gameStateId,
      zones: [{ zoneId: 31, type: 'ZoneType_Hand', ownerSeatId: 1, objectInstanceIds: hand }],
      gameObjects: hand.map((instanceId) => ({
        instanceId,
        grpId: instanceId,
        ownerSeatId: 1,
        controllerSeatId: 1,
      })),
    },
  }
}

async function storeWithSource(bundle: TranscriptBundle) {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('http://localhost'),
  })
  const { GreStore } = await import('@engine/runtime/gre-store')
  const store = new GreStore()
  const source = new TranscriptFrameSource(bundle)
  await source.ready()
  store.attachSource(source)
  return { store, source }
}

test('stepping is per frame, not per arrival', async () => {
  // One arrival carrying three states: stepping it as a unit would skip two.
  const bundle = bundleOf([
    { messages: [gsm(1, [100]), gsm(2, [100, 101]), gsm(3, [100, 101, 102])] },
  ])
  const { store, source } = await storeWithSource(bundle)

  expect(source.position.total).toBe(3)
  expect(source.position.batchTotal).toBe(1)

  source.stepForward()
  expect(store.gameStateId).toBe(1)
  expect(store.hand.length).toBe(1)

  source.stepForward()
  expect(store.gameStateId).toBe(2)
  expect(store.hand.length).toBe(2)
})

test('a frame reports which arrival it came in', async () => {
  const bundle = bundleOf([
    { messages: [gsm(1, [100])] },
    { messages: [gsm(2, [100, 101]), gsm(3, [100])] },
  ])
  const { source } = await storeWithSource(bundle)

  source.stepForward()
  expect(source.position.batchIndex).toBe(0)
  source.stepForward()
  expect(source.position.batchIndex).toBe(1)
  source.stepForward()
  expect(source.position.batchIndex).toBe(1)
})

test('seeking backwards re-folds from empty rather than inverting a diff', async () => {
  const bundle = bundleOf([
    { messages: [gsm(1, [100]), gsm(2, [100, 101]), gsm(3, [100, 101, 102])] },
  ])
  const { store, source } = await storeWithSource(bundle)

  source.seek(3)
  expect(store.hand.length).toBe(3)

  source.seek(1)
  expect(store.gameStateId).toBe(1)
  expect(store.hand.length).toBe(1)

  // Forward again from the rewound position lands on the same state as before,
  // which is what makes scrubbing repeatable.
  source.seek(3)
  expect(store.hand.length).toBe(3)
})

test('seek clamps instead of throwing at either end', async () => {
  const { source } = await storeWithSource(bundleOf([{ messages: [gsm(1, [100])] }]))

  source.seek(-5)
  expect(source.position.index).toBe(0)
  source.seek(99)
  expect(source.position.index).toBe(1)
})

test('seekToGameStateId lands just after the frame that carried it', async () => {
  const bundle = bundleOf([
    { messages: [gsm(1, [100]), gsm(2, [100, 101]), gsm(3, [100, 101, 102])] },
  ])
  const { store, source } = await storeWithSource(bundle)

  source.seekToGameStateId(2)

  expect(source.position.index).toBe(2)
  expect(store.gameStateId).toBe(2)
})

test('a transcript source sends nothing, so the store cannot answer a prompt', async () => {
  const { store, source } = await storeWithSource(bundleOf([{ messages: [gsm(1, [100])] }]))
  source.stepForward()

  await store.passPriority()

  expect(store.trafficStats.sentBytes).toBe(0)
  expect(store.trafficStats.sentMessages).toBe(0)
})

test('a malformed bundle is rejected with a reason, not silently emptied', () => {
  expect(() => parseTranscriptBundle(null)).toThrow('not an object')
  expect(() => parseTranscriptBundle({ batches: [] })).toThrow('no batches')
})

test('an incomplete zero-frame export keeps its failure and submitted choices', () => {
  const bundle = parseTranscriptBundle({
    version: 2,
    batches: [],
    status: { complete: false, reason: 'storage_quota_exhausted', truncated: true },
    events: [
      {
        seq: 4,
        timeMs: 5,
        direction: 'inbound',
        seatId: 1,
        batchIndex: 0,
        message: { type: 'MulliganResp' },
      },
    ],
  })

  expect(bundle.status).toEqual({
    complete: false,
    reason: 'storage_quota_exhausted',
    truncated: true,
  })
  expect(bundle.events?.[0]?.message).toEqual({ type: 'MulliganResp' })
})

test('bundle card metadata fills the store cache shape', () => {
  const cards = transcriptCardMeta({
    ...bundleOf([{ messages: [] }]),
    cards: { '77': { name: 'Test Card', manaCost: '{1}{G}' } },
  })

  expect(cards.get(77)).toEqual({
    grpId: 77,
    name: 'Test Card',
    manaCost: '{1}{G}',
    power: null,
    toughness: null,
    types: null,
    subtypes: null,
    imageUrl: null,
    keywords: [],
  })
})

test('the sample transcript folds into a populated board', async () => {
  const bundle = parseTranscriptBundle(await Bun.file(BUNDLE_PATH).json())
  const { store, source } = await storeWithSource(bundle)
  store.setViewerSeat(bundle.viewerSeatId)

  source.seek(transcriptFrames(bundle).length)

  expect(source.misses).toEqual([])
  expect(store.gameStateId).toBeGreaterThan(0)
  expect(store.turnNumber).toBeGreaterThan(1)
  // Zones, not names: the committed bundle bakes no card metadata, so this is
  // the part that must hold with no card lookup reachable.
  const permanents = [...store.battlefield, ...store.opponentBattlefield]
  expect(permanents.length).toBeGreaterThan(0)
  expect(store.viewer.lifeTotal).toBeLessThan(store.viewer.startingLifeTotal)
  expect(store.viewer.graveyardCount).toBeGreaterThan(0)
})

test('seeded metadata is what turns grpId labels into names', async () => {
  const bundle = parseTranscriptBundle(await Bun.file(BUNDLE_PATH).json())
  const { store, source } = await storeWithSource(bundle)
  source.seek(transcriptFrames(bundle).length)

  // Unseeded cards use a neutral label until their details arrive.
  const before = [...store.battlefield, ...store.opponentBattlefield]
  expect(before.length).toBeGreaterThan(0)
  expect(before.every((card) => card.name === 'Card')).toBe(true)

  const grpId = before[0]!.grpId
  store.seedCardMeta(
    new Map([
      [
        grpId,
        {
          grpId,
          name: 'Seeded Card',
          manaCost: null,
          power: null,
          toughness: null,
          types: null,
          subtypes: null,
          imageUrl: null,
          keywords: [],
        },
      ],
    ]),
  )

  const after = [...store.battlefield, ...store.opponentBattlefield].find(
    (card) => card.grpId === grpId,
  )
  expect(after?.name).toBe('Seeded Card')
})

test('the sample transcript is a pure-source bundle that bakes no card data', async () => {
  const bundle = parseTranscriptBundle(await Bun.file(BUNDLE_PATH).json())
  const frames = transcriptFrames(bundle)
  const fulls = frames.filter((frame) => {
    const message = frame.message as { gameStateMessage?: { type?: unknown } }
    return (
      message.gameStateMessage?.type === 'Full' ||
      message.gameStateMessage?.type === GAME_STATE_TYPE_FULL
    )
  })

  expect(fulls.length).toBeGreaterThan(0)
  expect(bundle.viewerSeatId).toBeGreaterThan(0)
  // A committed bundle carries no resolved card metadata; see the exporter for
  // why baking a name map is a local-only affordance.
  expect(bundle.cards).toEqual({})
  expect(bundle.source).toBe('simclient')
})

test('replay card inspection retains rules, ability text and linked faces without a lookup', () => {
  const bundle = bundleOf([])
  bundle.cards['7'] = {
    name: 'Authored card',
    rulesText: 'Create a token.',
    loyalty: '3',
    abilities: { 42: { text: 'Create a token.' } },
    linkedFaceGrpIds: [8],
    mechanicHelp: [],
  }
  const card = transcriptCardMeta(bundle).get(7)
  expect(card?.rulesText).toBe('Create a token.')
  expect(card?.abilities).toEqual({ 42: { text: 'Create a token.' } })
  expect(card?.linkedFaceGrpIds).toEqual([8])
  expect(card?.loyalty).toBe('3')
})
