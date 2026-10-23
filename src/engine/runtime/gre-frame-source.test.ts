import type { PromptBinding } from './prompts/family'
import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { httpCardMeta } from '@shared/api/http-test-fixtures'
import type { GreStore } from './gre-store'
import type { ReplacementControls, OptionalActionControls, PaymentControls } from './prompts/family'
import { expect, test } from 'bun:test'
import type { GreFrameSink, GreFrameSource } from './gre-frame-source'
import { availableActions, fullGameState, diffGameState } from './gre-test-frames'
import { decodeMessage } from '@engine/wire/gre-proto'
import { BrowserReplayCollector } from '@engine/replay/browser-replay-collector'
import {
  ACTION_PASS,
  ACTION_ACTIVATE,
  ACTION_PLAY,
  applyGsmToTables,
  deriveLegalActions,
  GAME_STATE_TYPE_FULL,
  ZONE_EXILE,
  ZONE_GRAVEYARD,
  ZONE_HAND,
  ZONE_BATTLEFIELD,
  type Action,
  type CardMeta,
} from '@engine/state/gre-state'
import { hasPlayOf } from '@engine/priority/priority-derive'

/**
 * The store is a frame sink. These tests drive it through the sink contract with
 * no socket involved, which is the same door a source that reads frames from
 * somewhere other than a live match comes through.
 *
 * Enums are NUMBERS here, matching what `gre-proto.ts` hands the store — a
 * string-typed fixture would pass while never firing in production.
 */

class FakeSource implements GreFrameSource {
  effectiveKeywordCoverage?: readonly string[]
  canSend: boolean = false
  sink: GreFrameSink | null = null
  isOpen = true
  isConnecting = false
  sent: Uint8Array[] = []
  stopped = false

  start(sink: GreFrameSink): void {
    this.sink = sink
  }
  stop(): void {
    this.stopped = true
    this.isOpen = false
  }
  send(bytes: Uint8Array): void {
    this.sent.push(bytes)
  }
}

const HAND_ZONE = { zoneId: 31, type: ZONE_HAND, ownerSeatId: 1 }
const BATTLEFIELD_ZONE = { zoneId: 28, type: ZONE_BATTLEFIELD, ownerSeatId: 0 }
const GRAVEYARD_ZONE = { zoneId: 29, type: ZONE_GRAVEYARD, ownerSeatId: 1 }
const EXILE_ZONE = { zoneId: 30, type: ZONE_EXILE, ownerSeatId: 1 }

async function freshStore() {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL('http://localhost'),
  })
  const { GreStore } = await import('./gre-store')
  return new GreStore()
}

test('effective keyword authority survives reset but not source retirement or replacement', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.effectiveKeywordCoverage = ['Flying']
  store.seedCardMeta(
    new Map([
      [
        100,
        {
          grpId: 100,
          name: 'Synthetic flyer',
          keywords: ['Flying'],
          abilities: { 300123: { text: 'Flying', keyword: 'Flying' } },
        },
      ],
    ]),
  )
  store.attachSource(source)
  const frame = fullGameState(1, {
    zones: [{ ...BATTLEFIELD_ZONE, objectInstanceIds: [101] }],
    gameObjects: [{ instanceId: 101, grpId: 100, controllerSeatId: 1 }],
  })
  source.sink!.onBatch({ byteLength: 0, messages: [frame] })
  expect(store.battlefield[0]?.keywords).not.toContain('Flying')
  source.sink!.onReset()
  source.sink!.onBatch({ byteLength: 0, messages: [frame] })
  expect(store.battlefield[0]?.keywords).not.toContain('Flying')
  source.stop()
  expect(store.battlefield[0]?.keywords).toContain('Flying')
  const old = new FakeSource()
  store.attachSource(old)
  old.sink!.onBatch({ byteLength: 0, messages: [frame] })
  expect(store.battlefield[0]?.keywords).toContain('Flying')
  store.disconnect()
})

test('a batch folds every message it carries and publishes exactly once', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  let publications = 0
  store.attachSource(source)
  store.subscribe(() => {
    publications += 1
  })

  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(1, {
        zones: [{ ...HAND_ZONE, objectInstanceIds: [100] }],
        gameObjects: [{ instanceId: 100, grpId: 1, ownerSeatId: 1, controllerSeatId: 1 }],
      }),
      fullGameState(2, {
        zones: [{ ...HAND_ZONE, objectInstanceIds: [100, 101] }],
        gameObjects: [
          { instanceId: 100, grpId: 1, ownerSeatId: 1, controllerSeatId: 1 },
          { instanceId: 101, grpId: 2, ownerSeatId: 1, controllerSeatId: 1 },
        ],
      }),
    ],
  })

  // Two frames folded, one publish: a batch is one arrival event, not two.
  expect(store.gameStateId).toBe(2)
  expect(store.hand.length).toBe(2)
  expect(publications).toBe(1)
})

test('annotation telemetry includes each published persistent annotation once', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  store.attachSource(source)

  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 1,
        gameStateId: 1,
        gameStateMessage: {
          type: GAME_STATE_TYPE_FULL,
          gameStateId: 1,
          annotations: [{ id: 1, type: [34] }],
          persistentAnnotations: [{ id: 2, type: [26] }],
        },
      },
    ],
  })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 1,
        gameStateId: 2,
        gameStateMessage: { gameStateId: 2, annotations: [{ id: 3, type: [16] }] },
      },
    ],
  })

  expect(store.annotationHistory.map(({ seq, types }) => [seq, types])).toEqual([
    [0, [34]],
    [0, [26]],
    [1, [16]],
  ])
})

test('annotation telemetry outlives the bounded presentation ring', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  store.attachSource(source)

  source.sink!.onBatch({
    byteLength: 0,
    messages: Array.from({ length: 40 }, (_, index) => ({
      type: 1,
      gameStateId: index + 1,
      gameStateMessage: {
        type: index === 0 ? GAME_STATE_TYPE_FULL : undefined,
        gameStateId: index + 1,
        annotations: [{ id: index + 1, type: [16] }],
      },
    })),
  })

  expect(store.annotationHistory).toHaveLength(40)
  expect(store.annotationHistory[0]?.seq).toBe(0)
  expect(store.annotationHistory[39]?.seq).toBe(39)
})

test('a current action horizon routes once while the board cursor trails', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  store.attachSource(source)
  store.seedCardMeta(new Map([[7, { grpId: 7, name: 'Plains' }]]))
  store.setDwellPolicy({ dwellFor: (step) => (step.state.gameStateId === 58 ? 100 : 0) })

  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(58, { zones: [{ ...HAND_ZONE, objectInstanceIds: [] }], gameObjects: [] }),
    ],
  })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(59, {
        zones: [{ ...HAND_ZONE, objectInstanceIds: [100] }],
        gameObjects: [
          {
            instanceId: 100,
            grpId: 7,
            ownerSeatId: 1,
            controllerSeatId: 1,
            zoneId: HAND_ZONE.zoneId,
          },
        ],
      }),
    ],
  })
  const action = { actionType: 3, instanceId: 100, shouldStop: true }
  source.sink!.onBatch({
    byteLength: 0,
    messages: [availableActions(59, 60, [action])],
  })

  expect(store.decisionHorizon).toEqual({
    kind: 'actions',
    promptKey: '59:60',
    gameStateId: 59,
    respId: 60,
  })
  expect(store.hand).toHaveLength(0)
  const view = store.legalActions[0]!
  expect(view).toMatchObject({
    grpId: 7,
    zoneType: ZONE_HAND,
    cardName: 'Plains',
    label: 'Play Plains',
  })

  source.isOpen = false
  expect(store.performLegalAction(view)).resolves.toBeUndefined()
  expect(store.legalActions).toHaveLength(1)

  source.isOpen = true
  await Promise.all([store.performLegalAction(view), store.performLegalAction(view)])
  expect(source.sent).toHaveLength(1)
  const wrapper = await decodeMessage('ClientToMatchServiceMessage', source.sent[0]!)
  const response = await decodeMessage('ClientToGREMessage', expectBytes(wrapper['payload']))
  expect(response['gameStateId']).toBe(59)
  expect(response['respId']).toBe(60)
  expect(response['performActionResp']).toEqual({ actions: [action] })
})

test('local disconnect presents a reconnectable fallback without replacing a terminal close', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  store.attachSource(source)

  store.disconnect()
  expect(store.snapshot().connectionClose).toEqual({ category: 'transient', code: 0 })

  const terminal = new FakeSource()
  store.attachSource(terminal)
  terminal.sink!.onClose({ code: 1011, reason: 'match_engine_failed', wasClean: true })
  store.disconnect()
  expect(store.snapshot().connectionClose).toEqual({ category: 'terminated', code: 1011 })
})

test('an action whose source closes during its write can be retried', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  store.attachSource(source)
  source.sink!.onBatch({ byteLength: 0, messages: [actionsRequest(20)] })
  const send = source.send.bind(source)
  source.send = () => {
    source.isOpen = false
    throw new DOMException('Socket closed', 'InvalidStateError')
  }

  expect(store.passPriority()).resolves.toBeUndefined()
  expect(store.legalActions).toHaveLength(1)

  source.isOpen = true
  source.send = send
  await store.passPriority()
  expect(source.sent).toHaveLength(1)
})

test('a mulligan decision interrupted during encoding can be retried after reconnect', async () => {
  const store = await freshStore()
  const stale = new FakeSource()
  stale.canSend = true
  store.attachSource(stale)
  stale.sink!.onBatch({
    byteLength: 0,
    messages: [{ type: 15, gameStateId: 3, msgId: 4, mulliganReq: { mulliganCount: 0 } }],
  })

  const old = store.bindPrompt(store.prompt) as Extract<PromptBinding, { kind: 'mulligan' }>
  const keep = old.controls!.keep()
  const current = new FakeSource()
  current.canSend = true
  store.attachSource(current)
  await keep
  expect(await old.controls!.keep()).toBe(false)
  const rebound = store.bindPrompt(store.prompt)
  if (rebound?.kind !== 'mulligan' || !rebound.controls) {
    throw new Error('Expected opening hand')
  }
  expect(await rebound.controls.keep()).toBe(true)

  expect(stale.sent).toHaveLength(0)
  expect(current.sent).toHaveLength(1)
})

test('non-hand action cards use current zones and the offered face while the board trails', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  store.attachSource(source)
  store.seedCardMeta(
    new Map([
      [7, { grpId: 7, name: 'Front face' }],
      [70, { grpId: 70, name: 'Disturb back', imageUrl: 'back.jpg', types: 'Creature' }],
      [8, { grpId: 8, name: 'Exiled spell' }],
    ]),
  )
  store.setDwellPolicy({ dwellFor: (step) => (step.state.gameStateId === 70 ? 100 : 0) })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [fullGameState(70, { zones: [], gameObjects: [] })],
  })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(71, {
        zones: [
          { ...GRAVEYARD_ZONE, objectInstanceIds: [100] },
          { ...EXILE_ZONE, objectInstanceIds: [101] },
        ],
        gameObjects: [
          {
            instanceId: 100,
            grpId: 7,
            ownerSeatId: 1,
            controllerSeatId: 1,
            zoneId: GRAVEYARD_ZONE.zoneId,
          },
          {
            instanceId: 101,
            grpId: 8,
            ownerSeatId: 1,
            controllerSeatId: 1,
            zoneId: EXILE_ZONE.zoneId,
          },
        ],
      }),
    ],
  })
  const actions = [
    {
      actionType: 1,
      instanceId: 100,
      grpId: 70,
      facetId: 2,
      abilityGrpId: 145173,
      shouldStop: true,
    },
    { actionType: 1, instanceId: 101, grpId: 8 },
  ]
  source.sink!.onBatch({
    byteLength: 0,
    messages: [availableActions(71, 72, actions)],
  })

  expect(store.graveyard).toHaveLength(0)
  expect(store.exile).toHaveLength(0)
  expect(
    store
      .snapshot()
      .nonHandActionCards.map(({ card, action }) => [card.name, card.imageUrl, action.zoneType]),
  ).toEqual([
    ['Disturb back', 'back.jpg', ZONE_GRAVEYARD],
    ['Exiled spell', '', ZONE_EXILE],
  ])
  expect(hasPlayOf(store.snapshot())).toBe(true)
  await store.performLegalAction(store.snapshot().nonHandActionCards[0]!.action)
  const wrapper = await decodeMessage('ClientToMatchServiceMessage', source.sent.at(-1)!)
  const response = await decodeMessage('ClientToGREMessage', expectBytes(wrapper['payload']))
  expect(response['performActionResp']).toEqual({ actions: [actions[0]] })
})

test('an emblem-only full state fetches creator metadata and publishes its effect', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  store.attachSource(source)
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  let publications = 0
  store.subscribe(() => {
    publications += 1
  })
  globalThis.fetch = (async (input) => {
    urls.push(String(input))
    return {
      ok: true,
      json: async () => ({
        700: httpCardMeta(700, {
          name: 'Creator',
          abilities: { 900: { text: 'An emblem effect.', keyword: null, manaCost: null } },
        }),
      }),
    } as Response
  }) as typeof fetch
  try {
    source.sink!.onBatch({
      byteLength: 0,
      messages: [
        fullGameState(80, {
          zones: [{ zoneId: 26, type: 7, ownerSeatId: 0, objectInstanceIds: [131] }],
          gameObjects: [
            {
              instanceId: 131,
              type: 4,
              grpId: 2,
              objectSourceGrpId: 700,
              uniqueAbilities: [{ id: 50, grpId: 900 }],
              zoneId: 26,
              ownerSeatId: 1,
              controllerSeatId: 1,
            },
          ],
        }),
      ],
    })
    const before = publications
    await new Promise((resolve) => setTimeout(resolve, 70))
    expect(urls.some((url) => url.includes('ids=700&'))).toBe(true)
    expect(urls.some((url) => url.includes('ids=2&'))).toBe(false)
    expect(store.snapshot().emblems?.[0]).toMatchObject({
      name: 'Creator',
      typeLine: 'Emblem',
      rulesText: 'An emblem effect.',
    })
    expect(publications).toBeGreaterThan(before)
  } finally {
    globalThis.fetch = originalFetch
    store.disconnect()
  }
})

test('action face grpIds join the metadata fetch set', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  store.attachSource(source)
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = (async (input) => {
    urls.push(String(input))
    return { ok: true, json: async () => ({}) } as Response
  }) as typeof fetch
  try {
    source.sink!.onBatch({
      byteLength: 0,
      messages: [
        fullGameState(80, {
          zones: [{ ...GRAVEYARD_ZONE, objectInstanceIds: [100] }],
          gameObjects: [
            {
              instanceId: 100,
              grpId: 7,
              ownerSeatId: 1,
              controllerSeatId: 1,
              zoneId: GRAVEYARD_ZONE.zoneId,
            },
          ],
        }),
      ],
    })
    source.sink!.onBatch({
      byteLength: 0,
      messages: [availableActions(80, 81, [{ actionType: 1, instanceId: 100, grpId: 70 }])],
    })
    await new Promise((resolve) => setTimeout(resolve, 70))
    expect(urls.some((url) => url.includes('ids=7%2C70') || url.includes('ids=7,70'))).toBe(true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('linked face grpIds join the existing metadata fetch queue once', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  store.attachSource(source)
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = (async (input) => {
    const url = String(input)
    urls.push(url)
    if (url.includes('ids=7')) {
      return {
        ok: true,
        json: async () => ({ 7: httpCardMeta(7, { name: 'Room', linkedFaceGrpIds: [70, 71] }) }),
      } as Response
    }
    return {
      ok: true,
      json: async () => ({
        70: httpCardMeta(70, { name: 'Left', linkedFaceGrpIds: [7] }),
        71: httpCardMeta(71, { name: 'Right', linkedFaceGrpIds: [7] }),
      }),
    } as Response
  }) as typeof fetch
  try {
    source.sink!.onBatch({
      byteLength: 0,
      messages: [
        fullGameState(80, {
          zones: [{ ...GRAVEYARD_ZONE, objectInstanceIds: [100] }],
          gameObjects: [
            {
              instanceId: 100,
              grpId: 7,
              ownerSeatId: 1,
              controllerSeatId: 1,
              zoneId: GRAVEYARD_ZONE.zoneId,
            },
          ],
        }),
      ],
    })
    for (let attempt = 0; attempt < 100 && urls.length < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    expect(urls).toHaveLength(2)
    expect(urls[1]).toMatch(/ids=70(?:%2C|,)71/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('static card-name choices join the metadata fetch set', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  store.attachSource(source)
  const originalFetch = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = (async (input) => {
    urls.push(String(input))
    return {
      ok: true,
      json: async () => ({ '488161': httpCardMeta(488161, { name: 'Named card' }) }),
    } as Response
  }) as typeof fetch
  try {
    source.sink!.onBatch({
      byteLength: 0,
      messages: [
        {
          type: 22,
          gameStateId: 82,
          msgId: 83,
          selectNReq: { minSel: 1, maxSel: 1, listType: 3, staticList: 13, ids: [488161] },
        },
      ],
    })
    await new Promise((resolve) => setTimeout(resolve, 70))
    expect(urls.some((url) => url.includes('ids=488161'))).toBe(true)
    expect(viewFor(store, 'selectN').selectNCandidates).toMatchObject([{ name: 'Named card' }])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('a source that needs no handshake is not greeted', async () => {
  const store = await freshStore()
  const reading = new FakeSource()
  store.attachSource(reading)
  reading.sink!.onOpen()
  await Promise.resolve()

  // Greeting a source with nowhere to send would report outbound traffic that
  // never left, and log a handshake that never happened.
  expect(store.connected).toBe(true)
  expect(store.trafficStats.sentBytes).toBe(0)
  expect(store.logs.some((line) => line.includes('Bootstrap'))).toBe(false)
})

test('an embedded match greets its identity and resolves metadata from its engine', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  const requested: number[][] = []
  store.connectSource(source, {
    matchId: 'embedded-42',
    gameType: 'commander',
    fetchCardMeta: async (ids) => {
      requested.push(ids)
      return new Map([[200_000_001, { grpId: 200_000_001, name: 'Mountain' } as CardMeta]])
    },
  })
  source.sink!.onOpen()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const wrapper = await decodeMessage('ClientToMatchServiceMessage', source.sent[1]!)
  const connect = await decodeMessage(
    'ClientToMatchDoorConnectRequest',
    wrapper['payload'] as Uint8Array,
  )
  expect(connect['matchId']).toBe('embedded-42')
  expect(store.currentGameType).toBe('commander')
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(1, {
        zones: [{ ...HAND_ZONE, objectInstanceIds: [100] }],
        gameObjects: [{ instanceId: 100, grpId: 200_000_001, ownerSeatId: 1, controllerSeatId: 1 }],
      }),
    ],
  })
  await new Promise((resolve) => setTimeout(resolve, 70))
  expect(requested).toEqual([[200_000_001]])
  expect(store.hand[0]?.name).toBe('Mountain')
  store.clearSession()
})

test('completed dungeon metadata hydrates after a fresh game snapshot', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  const requested: number[][] = []
  store.connectSource(source, {
    matchId: 'completed-dungeon',
    fetchCardMeta: async (ids) => {
      requested.push(ids)
      return new Map([[78769, { grpId: 78769, name: 'Lost Mine of Phandelver' } as CardMeta]])
    },
  })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(1, {
        persistentAnnotations: [
          {
            id: 609,
            type: [86],
            affectorId: 1,
            affectedIds: [1],
            details: [
              { key: 'CurrentDungeon', valueString: ['nil'] },
              { key: 'CurrentRoom', valueString: ['nil'] },
              { key: 'AllDungeonsCompleted', valueInt32: [78769] },
            ],
          },
        ],
      }),
    ],
  })
  await new Promise((resolve) => setTimeout(resolve, 70))

  expect(requested).toEqual([[78769]])
  expect(store.snapshot().dungeon?.completed).toEqual(['Lost Mine of Phandelver'])
  store.clearSession()
})

test('a recovered browser source restores only its live request without a second handshake', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  const config = {
    execution: 'browser' as const,
    matchId: 'recovered',
    gameType: 'constructed' as const,
  }
  const collector = new BrowserReplayCollector(config)
  const request = availableActions(32, 33, [{ actionType: ACTION_PASS }])
  try {
    store.connectSource(
      source,
      { ...config, fetchCardMeta: async () => new Map() },
      {
        collector,
        request,
        batches: [
          {
            byteLength: 0,
            messages: [
              { type: 15, gameStateId: 3, msgId: 7, mulliganReq: {} },
              fullGameState(32, {}),
              request,
            ],
          },
        ],
      },
    )
    source.sink!.onOpen()
    await Promise.resolve()
    expect(store.connected).toBe(true)
    expect(store.prompt).toBeNull()
    expect(store.decisionHorizon?.kind).toBe('actions')
    expect(source.sent).toHaveLength(0)
    expect(store.browserReplaySnapshot()?.responses).toHaveLength(0)
    await store.passPriority()
    expect(source.sent).toHaveLength(1)
    expect(store.browserReplaySnapshot()?.responses).toHaveLength(1)
  } finally {
    store.clearSession()
  }
})

test('browser match reaches game over when replay upload fails', async () => {
  const originalFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input))
    throw new Error('Replay endpoint unavailable')
  }) as unknown as typeof fetch
  const store = await freshStore()
  try {
    const source = new FakeSource()
    source.canSend = true
    store.connectSource(source, {
      execution: 'browser',
      attemptId: '22222222-2222-4222-8222-222222222222',
      matchId: 'browser-11111111-1111-4111-8111-111111111111',
      gameType: 'constructed',
      fetchCardMeta: async () => new Map(),
    })
    source.sink!.onOpen()
    source.sink!.onBatch({ byteLength: 1, messages: [fullGameState(1, {})] })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requests.some((url) => url.endsWith('/chunks'))).toBe(true)
    expect(store.connected).toBe(true)
    expect(source.sent.length).toBeGreaterThan(0)
    expect(store.gameStateId).toBe(1)
    source.sink!.onBatch({
      byteLength: 1,
      messages: [{ type: 37, gameStateId: 2, msgId: 2, intermissionReq: {} }],
    })
    expect(store.gameOver).toBe(true)
  } finally {
    store.clearSession()
    globalThis.fetch = originalFetch
  }
})

test('terminal replay completion includes the asynchronous checkpoint after the final game state', async () => {
  const originalFetch = globalThis.fetch
  const uploads: {
    status: number
    complete: boolean
    events: { seq: number; direction: string; message?: { payload: string } }[]
  }[] = []
  let committedComplete = false
  let committedSeq = 0
  globalThis.fetch = (async (_input: RequestInfo | URL, options: RequestInit) => {
    const chunk = JSON.parse(String(options.body))
    const status = committedComplete && chunk.events.length ? 400 : 200
    uploads.push({ status, complete: chunk.status.complete, events: chunk.events })
    if (status === 400) {
      return new Response('Replay is already complete', { status })
    }
    expect(Number((options.headers as Record<string, string>)['X-Replay-After-Seq'])).toBe(
      committedSeq,
    )
    for (const event of chunk.events) {
      expect(event.seq).toBe(++committedSeq)
    }
    committedComplete ||= chunk.status.complete
    return new Response(String(committedSeq))
  }) as typeof fetch
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  try {
    store.connectSource(source, {
      execution: 'browser',
      attemptId: '22222222-2222-4222-8222-222222222222',
      matchId: 'browser-11111111-1111-4111-8111-111111111111',
      gameType: 'draft',
      fetchCardMeta: async () => new Map(),
    })
    source.sink!.onOpen()
    source.sink!.onBatch({ byteLength: 1, messages: [fullGameState(1, {})] })
    await Bun.sleep(0)
    source.sink!.onBatch({
      byteLength: 1,
      messages: [fullGameState(2, { zones: [], gameInfo: { stage: 3, matchState: 3 } })],
    })
    expect(store.gameOver).toBe(true)
    source.sink!.onBatch({
      byteLength: 1,
      messages: [{ type: 37, gameStateId: 2, msgId: 32, intermissionReq: {} }],
    })
    await Bun.sleep(0)
    expect(uploads.filter((upload) => upload.status !== 200)).toEqual([])
    const final = uploads.find((upload) => upload.complete)!
    expect(final).toBeDefined()
    const last = final.events.at(-1)!
    expect(last.direction).toBe('inbound')
    const wrapper = await decodeMessage(
      'ClientToMatchServiceMessage',
      Buffer.from(last.message!.payload, 'base64'),
    )
    expect(
      await decodeMessage('ClientToGREMessage', wrapper['payload'] as Uint8Array),
    ).toMatchObject({ type: 10, respId: 32 })
    expect(committedSeq).toBe(store.browserReplaySnapshot()!.events!.at(-1)!.seq)
  } finally {
    store.clearSession()
    globalThis.fetch = originalFetch
  }
})

for (const fence of ['closed-checkpoint', 'source-close', 'disconnect'] as const) {
  test(`terminal replay drains at ${fence} without a successful checkpoint send`, async () => {
    const originalFetch = globalThis.fetch
    const uploads: { status: { complete: boolean }; events: { seq: number }[] }[] = []
    globalThis.fetch = (async (_input: RequestInfo | URL, options: RequestInit) => {
      const chunk = JSON.parse(String(options.body))
      uploads.push(chunk)
      return new Response(
        String(
          chunk.events.at(-1)?.seq ??
            Number((options.headers as Record<string, string>)['X-Replay-After-Seq']),
        ),
      )
    }) as typeof fetch
    const store = await freshStore()
    const source = new FakeSource()
    source.canSend = true
    try {
      store.connectSource(source, {
        execution: 'browser',
        matchId: 'terminal',
        gameType: 'constructed',
        fetchCardMeta: async () => new Map(),
      })
      source.sink!.onBatch({
        byteLength: 1,
        messages: [fullGameState(1, { zones: [], gameInfo: { stage: 3, matchState: 3 } })],
      })
      await Bun.sleep(0)
      expect(store.gameOver).toBe(true)
      expect(uploads.every((chunk) => !chunk.status.complete)).toBe(true)
      source.isOpen = false
      if (fence === 'closed-checkpoint') {
        source.sink!.onBatch({
          byteLength: 1,
          messages: [{ type: 37, gameStateId: 1, msgId: 32, intermissionReq: {} }],
        })
      } else if (fence === 'source-close') {
        source.sink!.onClose({ code: 1000, reason: 'completed', wasClean: true })
      } else {
        store.disconnect()
      }
      await Bun.sleep(0)
      expect(uploads.some((chunk) => chunk.status.complete)).toBe(true)
      expect(source.sent).toHaveLength(0)
    } finally {
      store.clearSession()
      globalThis.fetch = originalFetch
    }
  })
}

test('an old terminal checkpoint cannot finish a replacement match replay', async () => {
  const originalFetch = globalThis.fetch
  const uploads: { matchId: string; status: { complete: boolean }; events: { seq: number }[] }[] =
    []
  globalThis.fetch = (async (_input: RequestInfo | URL, options: RequestInit) => {
    const chunk = JSON.parse(String(options.body))
    uploads.push(chunk)
    return new Response(
      String(
        chunk.events.at(-1)?.seq ??
          Number((options.headers as Record<string, string>)['X-Replay-After-Seq']),
      ),
    )
  }) as typeof fetch
  const store = await freshStore()
  const oldSource = new FakeSource()
  oldSource.canSend = true
  try {
    store.connectSource(oldSource, {
      execution: 'browser',
      matchId: 'old-terminal',
      fetchCardMeta: async () => new Map(),
    })
    oldSource.sink!.onBatch({
      byteLength: 1,
      messages: [{ type: 37, gameStateId: 1, msgId: 32, intermissionReq: {} }],
    })
    const replacement = new FakeSource()
    replacement.canSend = true
    store.connectSource(replacement, {
      execution: 'browser',
      matchId: 'replacement',
      fetchCardMeta: async () => new Map(),
    })
    replacement.sink!.onBatch({ byteLength: 1, messages: [fullGameState(1, {})] })
    await Bun.sleep(0)
    const current = uploads.filter((chunk) => chunk.matchId === 'replacement')
    expect(current.length).toBeGreaterThan(0)
    expect(current.every((chunk) => !chunk.status.complete)).toBe(true)
    expect(oldSource.sent).toHaveLength(0)
    expect(store.gameOver).toBe(false)
  } finally {
    store.clearSession()
    globalThis.fetch = originalFetch
  }
})

test('metadata from a retired embedded catalog cannot replace the next catalog', async () => {
  const store = await freshStore()
  let resolveOld!: (cards: Map<number, CardMeta>) => void
  const first = new FakeSource()
  store.connectSource(first, {
    matchId: 'first',
    fetchCardMeta: () =>
      new Promise((resolve) => {
        resolveOld = resolve
      }),
  })
  const batch = {
    byteLength: 0,
    messages: [
      fullGameState(1, {
        zones: [{ ...HAND_ZONE, objectInstanceIds: [100] }],
        gameObjects: [{ instanceId: 100, grpId: 200_000_001, ownerSeatId: 1, controllerSeatId: 1 }],
      }),
    ],
  }
  first.sink!.onBatch(batch)
  await new Promise((resolve) => setTimeout(resolve, 70))
  const second = new FakeSource()
  store.connectSource(second, {
    matchId: 'second',
    fetchCardMeta: async () =>
      new Map([[200_000_001, { grpId: 200_000_001, name: 'Forest' } as CardMeta]]),
  })
  second.sink!.onBatch(batch)
  await new Promise((resolve) => setTimeout(resolve, 70))
  resolveOld(new Map([[200_000_001, { grpId: 200_000_001, name: 'Mountain' } as CardMeta]]))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(first.stopped).toBe(true)
  expect(store.hand[0]?.name).toBe('Forest')
  store.clearSession()
})

test('ConnectResp adopts runtime priority settings without overriding them', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  store.attachSource(source)
  const settings = { autoPassOption: 6, stackAutoPassOption: 4 }
  source.sink!.onBatch({ byteLength: 0, messages: [{ type: 7, connectResp: { settings } }] })
  await Promise.resolve()
  expect(source.sent).toHaveLength(0)
  expect(store.prioritySettings).toEqual(settings)
  source.sink!.onBatch({
    byteLength: 0,
    messages: [{ type: 10, setSettingsResp: { settings: { autoPassOption: 7 } } }],
  })
  expect(store.prioritySettings).toEqual({ autoPassOption: 7 })
  store.attachSource(new FakeSource())
  expect(store.prioritySettings).toEqual({})
})

test('an empty batch still publishes, so a non-game frame refreshes diagnostics', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  let publications = 0
  store.attachSource(source)
  store.subscribe(() => {
    publications += 1
  })

  source.sink!.onBatch({ byteLength: 12, messages: [], authenticated: true })

  expect(publications).toBe(1)
  expect(store.logs.some((line) => line.includes('Authenticated'))).toBe(true)
})

test('pending casting options refresh after card metadata arrives', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  store.attachSource(source)
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(1, {
        zones: [],
        gameObjects: [{ instanceId: 100, grpId: 42, ownerSeatId: 1, controllerSeatId: 1 }],
      }),
      {
        type: 46,
        gameStateId: 1,
        msgId: 8,
        castingTimeOptionsReq: {
          castingTimeOptionReq: [
            { ctoId: 3, castingTimeOptionType: 5, affectedId: 100, grpId: 700 },
          ],
        },
      },
    ],
  })

  expect(viewFor(store, 'castingOptions').castingOptions?.[0]?.label).toBe(
    'Pay the additional cost',
  )
  store.seedCardMeta(
    new Map([
      [
        42,
        {
          grpId: 42,
          abilities: { 700: { text: 'Gift a tapped Fish token — {1}', manaCost: '{1}' } },
        },
      ],
    ]),
  )
  expect(viewFor(store, 'castingOptions').castingOptions?.[0]?.label).toBe(
    'Gift a tapped Fish token — {1}',
  )
})

test('exact legal-action identity routes the selected raw command', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  store.attachSource(source)
  const actions: Action[] = [
    { actionType: 1, instanceId: 100, facetId: 44, uniqueAbilityId: 801 },
    { actionType: 1, instanceId: 100, facetId: 44, uniqueAbilityId: 802 },
  ]
  const gsm = fullGameState(1, {
    zones: [{ ...HAND_ZONE, objectInstanceIds: [100] }],
    gameObjects: [{ instanceId: 100, grpId: 10, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [gsm, availableActions(1, 7, actions)],
  })

  const gsmPayload = gsm['gameStateMessage'] as Record<string, unknown>
  const tables = applyGsmToTables(
    { objects: new Map(), zones: new Map(), players: new Map() },
    gsmPayload,
  )
  const views = deriveLegalActions(actions, tables, new Map())
  expect(views).toHaveLength(2)
  expect(views[0] && views[1] && views[0].uniqueAbilityId !== views[1].uniqueAbilityId).toBe(true)
  await store.performLegalAction(views[1]!)

  const outer = await decodeMessage('ClientToMatchServiceMessage', source.sent[0]!)
  const response = await decodeMessage('ClientToGREMessage', outer['payload'] as Uint8Array)
  expect(response['performActionResp']).toMatchObject({
    actions: [{ actionType: 1, instanceId: 100, facetId: 44, uniqueAbilityId: 802 }],
  })
})

test('onReset rewinds the fold to empty so a source can seek backwards', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  store.attachSource(source)

  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(7, {
        zones: [{ ...BATTLEFIELD_ZONE, objectInstanceIds: [200] }],
        gameObjects: [{ instanceId: 200, grpId: 3, ownerSeatId: 1, controllerSeatId: 1 }],
      }),
    ],
  })
  expect(store.gameStateId).toBe(7)
  expect(store.battlefield.length).toBe(1)

  source.sink!.onReset()

  expect(store.gameStateId).toBe(0)
  expect(store.battlefield.length).toBe(0)

  source.sink!.onBatch({
    byteLength: 0,
    messages: [fullGameState(8, { zones: [], gameObjects: [] })],
  })
  expect(store.gameStateId).toBe(8)
})

/**
 * A DeclareBlockersReq is the cheapest real request to raise: the dispatch path
 * needs only the attacker list to build a prompt.
 */
function blockersRequest(gameStateId: number) {
  return {
    type: 28,
    gameStateId,
    msgId: gameStateId,
    declareBlockersReq: { attackers: [{ attackerInstanceId: 100, legalBlockers: [101] }] },
  }
}

function actionsRequest(gameStateId: number, action: Action = { actionType: 5 }) {
  return availableActions(gameStateId, gameStateId + 1, [action])
}

test('a request nobody can answer is dropped once the game moves past it', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  store.attachSource(source)

  source.sink!.onBatch({ byteLength: 0, messages: [blockersRequest(10)] })
  expect(store.prompt).not.toBeNull()

  // Same state id: the request is still the live question.
  source.sink!.onBatch({
    byteLength: 0,
    messages: [fullGameState(10, { zones: [], gameObjects: [] })],
  })
  expect(store.prompt).not.toBeNull()

  // The game advanced, so the decision was made — by whoever recorded this.
  source.sink!.onBatch({
    byteLength: 0,
    messages: [fullGameState(11, { zones: [], gameObjects: [] })],
  })
  expect(store.prompt).toBeNull()
})

test('a live socket keeps its request across state updates', async () => {
  const store = await freshStore()
  const live = new FakeSource()
  live.canSend = true
  store.attachSource(live)

  live.sink!.onBatch({ byteLength: 0, messages: [blockersRequest(10)] })
  expect(store.prompt).not.toBeNull()

  // A live prompt outlives state updates while the player thinks: the game
  // state id advances for annotations and timers on its own. Expiring here
  // would tear the prompt down mid-decision.
  live.sink!.onBatch({
    byteLength: 0,
    messages: [fullGameState(11, { zones: [], gameObjects: [] })],
  })
  live.sink!.onBatch({
    byteLength: 0,
    messages: [fullGameState(12, { zones: [], gameObjects: [] })],
  })

  expect(store.prompt).not.toBeNull()
})

test('a live prompt response keeps the request game state after a later GSM', async () => {
  const store = await freshStore()
  const live = new FakeSource()
  live.canSend = true
  store.attachSource(live)

  live.sink!.onBatch({
    byteLength: 0,
    messages: [{ type: 45, gameStateId: 40, msgId: 41, optionalActionMessage: {} }],
  })
  live.sink!.onBatch({
    byteLength: 0,
    messages: [fullGameState(42, { zones: [], gameObjects: [] })],
  })
  expect(store.prompt?.kind).toBe('optionalAction')

  await choiceControls(store, 'optionalAction').respond(true)

  expect(live.sent).toHaveLength(1)
  const wrapper = await decodeMessage('ClientToMatchServiceMessage', live.sent[0]!)
  const response = await decodeMessage('ClientToGREMessage', expectBytes(wrapper['payload']))
  expect(response).toMatchObject({ gameStateId: 40, respId: 41 })
})

test('a live numeric request becomes a button-ready prompt and submits X', async () => {
  const store = await freshStore()
  const live = new FakeSource()
  live.canSend = true
  store.attachSource(live)

  live.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 43,
        gameStateId: 40,
        msgId: 41,
        numericInputReq: { minValue: 0, maxValue: 3, stepSize: 1, numericInputType: 1 },
      },
    ],
  })
  expect(store.prompt).toMatchObject({
    kind: 'numericInput',
    numericValue: 0,
    numericMin: 0,
    numericMax: 3,
  })

  const binding = store.bindPrompt(store.prompt)
  if (binding?.kind !== 'numericInput' || !binding.controls) {
    throw new Error('Missing numeric controls')
  }
  binding.controls.adjust(1)
  await binding.controls.submit()

  const wrapper = await decodeMessage('ClientToMatchServiceMessage', live.sent[0]!)
  const response = await decodeMessage('ClientToGREMessage', expectBytes(wrapper['payload']))
  expect(response).toMatchObject({
    type: 43,
    gameStateId: 40,
    respId: 41,
    numericInputResp: { numericInputValue: 1 },
  })
})

test('a live replacement request renders exact candidates and writes the selected descriptor to the wire', async () => {
  const store = await freshStore()
  const live = new FakeSource()
  live.canSend = true
  store.attachSource(live)
  store.seedCardMeta(
    new Map<number, CardMeta>([
      [
        201,
        { grpId: 201, name: 'Rest in Peace', abilities: { 401: { text: 'Exile it instead.' } } },
      ],
      [
        202,
        {
          grpId: 202,
          name: 'Kalitas, Traitor of Ghet',
          abilities: { 402: { text: 'Exile it and create a Zombie instead.' } },
        },
      ],
    ]),
  )
  live.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(40, {
        zones: [],
        gameObjects: [
          { instanceId: 101, grpId: 201, ownerSeatId: 1, controllerSeatId: 1 },
          { instanceId: 102, grpId: 202, ownerSeatId: 2, controllerSeatId: 2 },
        ],
      }),
    ],
  })
  const replacements = [
    {
      objectInstance: 101,
      uniqueAbilityId: 301,
      abilityGrpId: 401,
      affectedObject: 103,
      replacementEffectId: 501,
    },
    {
      objectInstance: 102,
      uniqueAbilityId: 302,
      abilityGrpId: 402,
      affectedObject: 103,
      replacementEffectId: 502,
      conferringObjectZcid: 601,
    },
  ]
  live.sink!.onBatch({
    byteLength: 0,
    messages: [{ type: 39, gameStateId: 40, msgId: 41, selectReplacementReq: { replacements } }],
  })

  expect(store.prompt).toMatchObject({
    kind: 'replacement',
    replacementCandidates: [
      { replacementEffectId: 501, sourceInstanceId: 101, name: 'Rest in Peace' },
      { replacementEffectId: 502, sourceInstanceId: 102, name: 'Kalitas, Traitor of Ghet' },
    ],
  })
  await choiceControls(store, 'replacement').choose(502)

  expect(live.sent).toHaveLength(1)
  const wrapper = await decodeMessage('ClientToMatchServiceMessage', live.sent[0]!)
  const response = await decodeMessage('ClientToGREMessage', expectBytes(wrapper['payload']))
  expect(response).toEqual(
    expect.objectContaining({
      type: 39,
      gameStateId: 40,
      respId: 41,
      selectReplacementResp: { replacement: replacements[1] },
    }),
  )
  expect(store.prompt).toBeNull()

  live.sink!.onBatch({
    byteLength: 0,
    messages: [fullGameState(42, { zones: [], gameObjects: [] })],
  })
  expect(store.gameStateId).toBe(42)
  expect(store.prompt).toBeNull()
})

test('a game-over notice is not expired by whatever follows it', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  store.attachSource(source)

  source.sink!.onBatch({
    byteLength: 0,
    messages: [{ type: 37, gameStateId: 20, msgId: 20, intermissionReq: {} }],
  })
  expect(store.prompt?.kind).toBe('gameOver')

  source.sink!.onBatch({
    byteLength: 0,
    messages: [fullGameState(21, { zones: [], gameObjects: [] })],
  })

  expect(store.prompt?.kind).toBe('gameOver')
})

test('a stale source cannot mutate state after another is attached', async () => {
  const store = await freshStore()
  const stale = new FakeSource()
  store.attachSource(stale)
  const staleSink = stale.sink!

  const current = new FakeSource()
  store.attachSource(current)
  current.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(4, {
        zones: [{ ...HAND_ZONE, objectInstanceIds: [100] }],
        gameObjects: [{ instanceId: 100, grpId: 1, ownerSeatId: 1, controllerSeatId: 1 }],
      }),
    ],
  })

  // Attaching stops the source it replaced, but an in-flight delivery can still
  // land afterwards; the generation guard is what makes it inert.
  expect(stale.stopped).toBe(true)
  staleSink.onBatch({
    byteLength: 0,
    messages: [fullGameState(99, { zones: [], gameObjects: [] })],
  })
  staleSink.onReset()

  expect(store.gameStateId).toBe(4)
  expect(store.hand.length).toBe(1)
})

test('replacing the source during action encoding drops the send and releases its gate', async () => {
  const store = await freshStore()
  const stale = new FakeSource()
  stale.canSend = true
  store.attachSource(stale)
  stale.sink!.onBatch({ byteLength: 0, messages: [actionsRequest(40)] })

  const pass = store.passPriority()
  expect(store.legalActions).toHaveLength(0)
  const current = new FakeSource()
  current.canSend = true
  store.attachSource(current)
  await pass

  expect(stale.sent).toHaveLength(0)
  expect(current.sent).toHaveLength(0)
  expect(store.legalActions).toHaveLength(1)
})

test('replacing the source during legal-action encoding cannot send to the replacement', async () => {
  const store = await freshStore()
  const stale = new FakeSource()
  stale.canSend = true
  store.attachSource(stale)
  stale.sink!.onBatch({
    byteLength: 0,
    messages: [actionsRequest(45, { actionType: 3, instanceId: 100 })],
  })

  const action = store.performLegalAction(store.legalActions[0]!)
  const current = new FakeSource()
  current.canSend = true
  store.attachSource(current)
  await action

  expect(stale.sent).toHaveLength(0)
  expect(current.sent).toHaveLength(0)
  expect(store.legalActions).toHaveLength(1)
})

test('replacing the source during generic response encoding cannot send to the replacement', async () => {
  const store = await freshStore()
  const stale = new FakeSource()
  stale.canSend = true
  store.attachSource(stale)
  stale.sink!.onBatch({
    byteLength: 0,
    messages: [{ type: 45, gameStateId: 50, msgId: 51, optionalActionMessage: {} }],
  })

  const response = choiceControls(store, 'optionalAction').respond(true)
  const current = new FakeSource()
  current.canSend = true
  store.attachSource(current)
  current.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 22,
        gameStateId: 52,
        msgId: 53,
        selectNReq: { ids: [1], minSel: 1, maxSel: 1, listType: 1 },
      },
    ],
  })
  await response

  expect(stale.sent).toHaveLength(0)
  expect(current.sent).toHaveLength(0)
  expect(store.prompt?.kind).toBe('selectN')
})

test('replacing the source during payment encoding drops the action and preserves the new prompt', async () => {
  const store = await freshStore()
  const stale = new FakeSource()
  stale.canSend = true
  store.attachSource(stale)
  stale.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 36,
        gameStateId: 50,
        msgId: 51,
        payCostsReq: {
          paymentActions: {
            actions: [
              { actionType: 12, instanceId: 101, grpId: 201, manaPaymentOptions: [{ manaId: 7 }] },
            ],
          },
          paymentSelection: { ids: [7] },
        },
      },
    ],
  })

  const payment = choiceControls(store, 'payCosts').pay(
    viewFor(store, 'payCosts').payCostCandidates![0]!,
  )
  const current = new FakeSource()
  current.canSend = true
  store.attachSource(current)
  current.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 22,
        gameStateId: 52,
        msgId: 53,
        selectNReq: { ids: [1], minSel: 1, maxSel: 1, listType: 1 },
      },
    ],
  })
  expect(await payment).toBe(false)

  expect(stale.sent).toHaveLength(0)
  expect(current.sent).toHaveLength(0)
  expect(store.prompt?.kind).toBe('selectN')
})

test('a sent payment stays gated until authoritative state retires it', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  store.attachSource(source)
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 36,
        gameStateId: 50,
        msgId: 51,
        payCostsReq: {
          paymentActions: { actions: [{ actionType: 12, instanceId: 101 }] },
          paymentSelection: {},
        },
      },
    ],
  })

  expect(
    await choiceControls(store, 'payCosts').pay(viewFor(store, 'payCosts').payCostCandidates![0]!),
  ).toBe(true)
  expect(store.prompt).toMatchObject({ kind: 'payCosts', waiting: true })
  expect(
    await choiceControls(store, 'payCosts').pay(viewFor(store, 'payCosts').payCostCandidates![0]!),
  ).toBe(false)

  source.sink!.onBatch({
    byteLength: 0,
    messages: [fullGameState(51, { zones: [], gameObjects: [] })],
  })
  expect(store.prompt).toBeNull()
})

test('replacing the source during concede encoding cannot concede the replacement', async () => {
  const store = await freshStore()
  const stale = new FakeSource()
  stale.canSend = true
  store.attachSource(stale)

  const concede = store.concede()
  const current = new FakeSource()
  current.canSend = true
  store.attachSource(current)
  await concede

  expect(stale.sent).toHaveLength(0)
  expect(current.sent).toHaveLength(0)
})

test('stale action completion cannot release a newer generation submit', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  store.attachSource(source)
  source.sink!.onBatch({ byteLength: 0, messages: [actionsRequest(50)] })

  const stalePass = store.passPriority()
  source.sink!.onReset()
  source.sink!.onBatch({ byteLength: 0, messages: [actionsRequest(60)] })
  const currentPass = store.passPriority()
  await Promise.all([stalePass, currentPass])

  expect(source.sent).toHaveLength(1)
  expect(store.legalActions).toHaveLength(0)
})

function expectBytes(value: unknown): Uint8Array {
  expect(value).toBeInstanceOf(Uint8Array)
  return value as Uint8Array
}

type AnalyticsEvent = { name: string; data?: Record<string, string | number | boolean> }

function captureAnalytics(): { events: AnalyticsEvent[]; restore(): void } {
  const events: AnalyticsEvent[] = []
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: { getItem: () => null },
      umami: {
        track: (name: string, data?: Record<string, string | number | boolean>) =>
          events.push({ name, data }),
        identify: () => undefined,
      },
    },
  })
  return {
    events,
    restore: () => {
      if (previousWindow) {
        Object.defineProperty(globalThis, 'window', previousWindow)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    },
  }
}

test('GRE records the first sent non-pass action once', async () => {
  const store = await freshStore()
  const analytics = captureAnalytics()
  const originalFetch = globalThis.fetch
  const originalAttach = store.attachSource
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ matchId: 'first-action-match', wireMatchId: 'synthetic-wire' }),
  })) as unknown as typeof fetch
  store.attachSource = () => {}

  try {
    store.connectSource(new FakeSource(), {
      ...{ gameType: 'constructed', deckId: 'deck-1' },
      execution: 'browser',
      matchId: 'first-action-match',
      fetchCardMeta: async () => new Map(),
    })
    store.attachSource = originalAttach
    const source = new FakeSource()
    source.canSend = true
    store.attachSource(source)
    const actions = [
      { actionType: ACTION_PASS },
      { actionType: ACTION_PLAY, instanceId: 100, grpId: 10 },
    ]
    const available = (msgId: number) => availableActions(1, msgId, actions)
    source.sink!.onBatch({
      byteLength: 0,
      messages: [
        fullGameState(1, {
          zones: [{ ...HAND_ZONE, objectInstanceIds: [100] }],
          gameObjects: [{ instanceId: 100, grpId: 10, ownerSeatId: 1, controllerSeatId: 1 }],
        }),
        available(1),
      ],
    })

    await store.passPriority()
    expect(analytics.events.filter(({ name }) => name === 'game-first-action')).toHaveLength(0)
    source.sink!.onBatch({ byteLength: 0, messages: [available(2)] })
    await store.performLegalAction(
      store.legalActions.find(({ actionType }) => actionType === ACTION_PLAY)!,
    )
    source.sink!.onBatch({ byteLength: 0, messages: [available(3)] })
    await store.performLegalAction(
      store.legalActions.find(({ actionType }) => actionType === ACTION_PLAY)!,
    )

    const firstActions = analytics.events.filter(({ name }) => name === 'game-first-action')
    expect(firstActions).toHaveLength(1)
    expect(firstActions[0]?.data).toMatchObject({
      actionType: ACTION_PLAY,
      gameType: 'constructed',
      format: 'constructed',
      match_id: 'first-action-match',
      deck_id: 'deck-1',
    })
  } finally {
    store.attachSource = originalAttach
    globalThis.fetch = originalFetch
    analytics.restore()
  }
})

test('local GRE records bounded turn milestones once across repeated frames', async () => {
  const store = await freshStore()
  const analytics = captureAnalytics()
  const originalFetch = globalThis.fetch
  const originalAttach = store.attachSource
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ matchId: 'milestone-match', wireMatchId: 'synthetic-wire' }),
  })) as unknown as typeof fetch
  store.attachSource = () => {}

  try {
    store.connectSource(new FakeSource(), {
      ...{ gameType: 'commander', deckId: 'deck-1' },
      execution: 'browser',
      matchId: 'milestone-match',
      fetchCardMeta: async () => new Map(),
    })
    const applyGsmPayload = (
      store as unknown as { applyGsmPayload(message: Record<string, unknown>): void }
    ).applyGsmPayload.bind(store)
    const turn = (turnNumber: number) =>
      applyGsmPayload({
        gameStateMessage: {
          type: GAME_STATE_TYPE_FULL,
          gameStateId: turnNumber,
          turnInfo: { turnNumber },
        },
      })
    turn(1)
    turn(1)
    turn(5)
    turn(5)
    turn(6)
    turn(10)
    turn(20)
    turn(20)

    const milestones = analytics.events.filter(({ name }) => name === 'turn-milestone')
    expect(milestones.map(({ data }) => data?.['turn'])).toEqual([1, 5, 10, 20])
    expect(milestones[0]?.data).toMatchObject({
      gameType: 'commander',
      format: 'commander',
      match_id: 'milestone-match',
      deck_id: 'deck-1',
    })
  } finally {
    store.attachSource = originalAttach
    globalThis.fetch = originalFetch
    analytics.restore()
  }
})

test('GRE omits player engagement events for puzzles', async () => {
  const store = await freshStore()
  const analytics = captureAnalytics()
  const originalAttach = store.attachSource
  store.attachSource = () => {}

  try {
    store.connectSource(new FakeSource(), {
      execution: 'browser',
      matchId: 'puzzle-match',
      gameType: 'puzzle',
      fetchCardMeta: async () => new Map(),
    })
    const privateStore = store as unknown as {
      recordFirstPlayerAction(actionType: number): void
      applyGsmPayload(message: Record<string, unknown>): void
    }
    privateStore.recordFirstPlayerAction(ACTION_PLAY)
    privateStore.applyGsmPayload({
      gameStateMessage: { type: GAME_STATE_TYPE_FULL, gameStateId: 1, turnInfo: { turnNumber: 1 } },
    })
    expect(
      analytics.events.filter(
        ({ name }) => name === 'game-first-action' || name === 'turn-milestone',
      ),
    ).toHaveLength(0)

    privateStore.recordFirstPlayerAction(ACTION_PLAY)
    privateStore.applyGsmPayload({
      gameStateMessage: { type: GAME_STATE_TYPE_FULL, gameStateId: 2, turnInfo: { turnNumber: 5 } },
    })
    expect(
      analytics.events.filter(
        ({ name }) => name === 'game-first-action' || name === 'turn-milestone',
      ),
    ).toHaveLength(0)
  } finally {
    store.attachSource = originalAttach
    analytics.restore()
  }
})

test('GRE completion emits one result when normal game-over frames repeat', async () => {
  const store = await freshStore()
  const analytics = captureAnalytics()
  const originalFetch = globalThis.fetch
  const originalAttach = store.attachSource
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ matchId: 'result-match', wireMatchId: 'synthetic-wire' }),
  })) as unknown as typeof fetch
  store.attachSource = () => {}

  try {
    store.connectSource(new FakeSource(), {
      ...{ gameType: 'constructed' as const },
      execution: 'browser',
      matchId: 'complete-match',
      fetchCardMeta: async () => new Map(),
    })
    const applyGsmPayload = (
      store as unknown as { applyGsmPayload(message: Record<string, unknown>): void }
    ).applyGsmPayload.bind(store)
    const gameOver = (gameStateId: number) =>
      applyGsmPayload({
        gameStateMessage: {
          type: GAME_STATE_TYPE_FULL,
          gameStateId,
          gameInfo: { stage: 3, results: [{ scope: 2, result: 2, reason: 1 }] },
        },
      })
    gameOver(1)
    gameOver(2)

    const results = analytics.events.filter(({ name }) => name === 'game-complete')
    expect(results).toHaveLength(1)
    expect(results[0]?.data).toMatchObject({
      mode: 'play',
      gameType: 'constructed',
      result: 'draw',
      puzzle: false,
    })
  } finally {
    store.attachSource = originalAttach
    globalThis.fetch = originalFetch
    analytics.restore()
  }
})

test('omitted combat echo objects retain Flying while re-prompts alone drive provisional attacker and blocker selection', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.effectiveKeywordCoverage = ['Flying']
  source.canSend = true
  store.seedCardMeta(new Map([[10, { grpId: 10, name: 'Granted flyer', keywords: [] }]]))
  store.attachSource(source)
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(1, {
        zones: [{ ...BATTLEFIELD_ZONE, objectInstanceIds: [100, 101] }],
        gameObjects: [
          {
            instanceId: 100,
            grpId: 10,
            zoneId: 28,
            controllerSeatId: 1,
            uniqueAbilities: [{ id: 61, grpId: 8 }],
          },
          { instanceId: 101, grpId: 11, zoneId: 28, controllerSeatId: 2 },
        ],
        persistentAnnotations: [
          {
            id: 1,
            type: [9, 51],
            affectedIds: [100],
            details: [{ key: 'grpid', valueInt32: [8] }],
          },
        ],
      }),
    ],
  })
  let sequence = 2
  for (const selected of [true, false, true, false]) {
    source.sink!.onBatch({
      byteLength: 0,
      messages: [
        diffGameState(sequence, { gameObjects: [] }),
        {
          type: 26,
          msgId: sequence++,
          gameStateId: sequence,
          declareAttackersReq: {
            canSubmitAttackers: true,
            attackers: [
              {
                attackerInstanceId: 100,
                legalDamageRecipients: [{ type: 1, playerSystemSeatId: 2 }],
                ...(selected
                  ? { selectedDamageRecipient: { type: 1, playerSystemSeatId: 2 } }
                  : {}),
              },
            ],
          },
        },
      ],
    })
    expect(viewFor(store.snapshot(), 'attackers').attackers?.[0]?.selected).toBe(selected)
    expect(store.battlefield[0]?.keywords).toContain('Flying')
    source.sink!.onBatch({
      byteLength: 0,
      messages: [
        diffGameState(sequence, { gameObjects: [] }),
        {
          type: 28,
          msgId: sequence++,
          gameStateId: sequence,
          declareBlockersReq: {
            blockers: [
              {
                blockerInstanceId: 100,
                attackerInstanceIds: [101],
                selectedAttackerInstanceIds: selected ? [101] : [],
              },
            ],
          },
        },
      ],
    })
    expect(viewFor(store.snapshot(), 'blockers').blockers?.[0]?.attackers[0]?.selected).toBe(
      selected,
    )
    expect(store.battlefield[0]?.keywords).toContain('Flying')
  }
  store.disconnect()
})

test('prompt controls omit phased-out target and combat candidates and restore their raw offers', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  store.attachSource(source)
  const state = (zoneId: number) =>
    diffGameState(1, {
      zones: [{ ...BATTLEFIELD_ZONE, objectInstanceIds: [100, 101] }],
      gameObjects: [
        { instanceId: 100, grpId: 10, zoneId, ownerSeatId: 1, controllerSeatId: 1 },
        { instanceId: 101, grpId: 11, zoneId: 28, ownerSeatId: 1, controllerSeatId: 1 },
      ],
    })
  source.sink!.onBatch({ byteLength: 0, messages: [state(12)] })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 34,
        msgId: 10,
        gameStateId: 1,
        selectTargetsReq: {
          targets: [
            {
              targetIdx: 0,
              minTargets: 0,
              maxTargets: 2,
              selectedTargets: 0,
              targets: [100, 101].map((targetInstanceId) => ({ targetInstanceId, legalAction: 1 })),
            },
          ],
        },
      },
    ],
  })
  expect(
    viewFor(store.snapshot(), 'targets').candidates?.map((candidate) => candidate.targetInstanceId),
  ).toEqual([101])
  source.sink!.onBatch({ byteLength: 0, messages: [state(28)] })
  expect(
    viewFor(store.snapshot(), 'targets').candidates?.map((candidate) => candidate.targetInstanceId),
  ).toEqual([100, 101])

  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 26,
        msgId: 11,
        gameStateId: 1,
        declareAttackersReq: {
          canSubmitAttackers: true,
          attackers: [100, 101].map((attackerInstanceId) => ({
            attackerInstanceId,
            legalDamageRecipients: [{ type: 1, playerSystemSeatId: 2 }],
            selectedDamageRecipient: { type: 1, playerSystemSeatId: 2 },
          })),
        },
      },
    ],
  })
  source.sink!.onBatch({ byteLength: 0, messages: [state(12)] })
  expect(
    viewFor(store.snapshot(), 'attackers').attackers?.map(
      (candidate) => candidate.attackerInstanceId,
    ),
  ).toEqual([101])
  expect(store.snapshot().prompt?.canSubmit).toBe(false)
  source.sink!.onBatch({ byteLength: 0, messages: [state(28)] })
  expect(viewFor(store.snapshot(), 'attackers').attackers).toHaveLength(2)
  expect(store.snapshot().prompt?.canSubmit).toBe(true)

  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      {
        type: 28,
        msgId: 12,
        gameStateId: 1,
        declareBlockersReq: {
          blockers: [100, 101].map((blockerInstanceId) => ({
            blockerInstanceId,
            attackerInstanceIds: [100, 101],
            selectedAttackerInstanceIds: [100],
          })),
        },
      },
    ],
  })
  source.sink!.onBatch({ byteLength: 0, messages: [state(12)] })
  expect(viewFor(store.snapshot(), 'blockers').blockers).toMatchObject([
    { blockerInstanceId: 101, attackers: [{ attackerInstanceId: 101 }] },
  ])
  expect(store.snapshot().prompt?.canSubmit).toBe(false)
  source.sink!.onBatch({ byteLength: 0, messages: [state(28)] })
  expect(viewFor(store.snapshot(), 'blockers').blockers).toHaveLength(2)
  expect(store.snapshot().prompt?.canSubmit).toBe(true)
})

test('retained legal actions cannot activate a phased-out card while sibling and pass actions remain usable', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  store.attachSource(source)
  const actions: Action[] = [
    { actionType: ACTION_ACTIVATE, instanceId: 100, grpId: 10, uniqueAbilityId: 801 },
    { actionType: ACTION_ACTIVATE, instanceId: 101, grpId: 11, uniqueAbilityId: 802 },
    { actionType: ACTION_PASS },
  ]
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      fullGameState(1, {
        zones: [{ ...BATTLEFIELD_ZONE, objectInstanceIds: [100, 101] }],
        gameObjects: [100, 101].map((instanceId) => ({
          instanceId,
          grpId: instanceId === 100 ? 10 : 11,
          zoneId: 28,
          ownerSeatId: 1,
          controllerSeatId: 1,
        })),
      }),
      availableActions(1, 7, actions),
    ],
  })
  const retained = store.legalActions.find((action) => action.instanceId === 100)!
  const sibling = store.legalActions.find((action) => action.instanceId === 101)!
  const pass = store.legalActions.find((action) => action.actionType === ACTION_PASS)!
  source.sink!.onBatch({
    byteLength: 0,
    messages: [diffGameState(1, { gameObjects: [{ instanceId: 100, zoneId: 12 }] })],
  })
  await store.performLegalAction(retained)
  expect(source.sent).toHaveLength(0)
  await store.performLegalAction(sibling)
  expect(source.sent).toHaveLength(1)
  source.sink!.onBatch({ byteLength: 0, messages: [availableActions(1, 8, actions)] })
  await store.performLegalAction(pass)
  expect(source.sent).toHaveLength(2)
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      diffGameState(1, { gameObjects: [{ instanceId: 100, zoneId: 28 }] }),
      availableActions(1, 9, actions),
    ],
  })
  await store.performLegalAction(retained)
  expect(source.sent).toHaveLength(3)
  const wrapper = await decodeMessage('ClientToMatchServiceMessage', source.sent[2]!)
  const response = await decodeMessage('ClientToGREMessage', wrapper['payload'] as Uint8Array)
  expect(response['performActionResp']).toMatchObject({ actions: [actions[0]] })
})

function choiceControls<K extends 'replacement' | 'optionalAction' | 'payCosts'>(
  store: GreStore,
  kind: K,
) {
  const bound = store.bindPrompt(store.prompt)
  if (bound?.kind !== kind || !bound.controls) {
    throw new Error('Expected choice controls')
  }
  return bound.controls as K extends 'replacement'
    ? ReplacementControls
    : K extends 'payCosts'
      ? PaymentControls
      : OptionalActionControls
}

test('mana choice narrows the exact offered option and rejects a retired color', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  store.attachSource(source)
  const mana = {
    actionType: 4,
    instanceId: 100,
    abilityGrpId: 401,
    manaPaymentOptions: [
      {
        optionIndex: 3,
        mana: [{ color: 1, count: 2, srcInstanceId: 100, manaId: 7, specs: [{ type: 1 }] }],
      },
      {
        optionIndex: 4,
        mana: [{ color: 2, count: 2, srcInstanceId: 100, manaId: 8, specs: [{ type: 1 }] }],
      },
    ],
    manaSelections: [
      {
        instanceId: 100,
        abilityGrpId: 401,
        selectionCount: 1,
        options: [{ selectedColor: 1 }, { selectedColor: 2 }],
      },
    ],
  }
  source.sink!.onBatch({ byteLength: 0, messages: [availableActions(1, 7, [mana])] })
  const blue = store.legalActions.find((view) => view.label.endsWith('(Blue)'))
  expect(blue).toBeDefined()
  await store.performLegalAction(blue!)
  const outer = await decodeMessage('ClientToMatchServiceMessage', source.sent[0]!)
  const response = await decodeMessage('ClientToGREMessage', outer['payload'] as Uint8Array)
  expect(response['performActionResp']).toMatchObject({
    actions: [
      {
        ...mana,
        manaPaymentOptions: [mana.manaPaymentOptions[1]],
        manaSelections: [{ ...mana.manaSelections[0], options: [{ selectedColor: 2 }] }],
      },
    ],
  })
  source.sink!.onBatch({
    byteLength: 0,
    messages: [
      availableActions(1, 8, [
        {
          ...mana,
          manaPaymentOptions: [mana.manaPaymentOptions[0]],
          manaSelections: [{ ...mana.manaSelections[0], options: [{ selectedColor: 1 }] }],
        },
      ]),
    ],
  })
  expect(store.performLegalAction(blue!)).rejects.toThrow('Action is no longer legal')
  expect(source.sent).toHaveLength(1)
})

test('replacing a mana offer during encoding prevents the old color response', async () => {
  const store = await freshStore()
  const source = new FakeSource()
  source.canSend = true
  store.attachSource(source)
  const mana = {
    actionType: 4,
    instanceId: 100,
    manaPaymentOptions: [{ mana: [{ color: 1 }] }, { mana: [{ color: 2 }] }],
    manaSelections: [{ selectionCount: 1, options: [{ selectedColor: 1 }, { selectedColor: 2 }] }],
  }
  source.sink!.onBatch({ byteLength: 0, messages: [availableActions(1, 7, [mana])] })
  const blue = store.legalActions.find((view) => view.label.endsWith('(Blue)'))!
  const pending = store.performLegalAction(blue)
  source.sink!.onBatch({ byteLength: 0, messages: [availableActions(1, 8, [mana])] })
  await pending
  expect(source.sent).toHaveLength(0)
  await store.performLegalAction(store.legalActions.find((view) => view.label.endsWith('(Blue)'))!)
  expect(source.sent).toHaveLength(1)
  source.sink!.onBatch({ byteLength: 0, messages: [availableActions(1, 9, [mana, { ...mana }])] })
  expect(store.performLegalAction(blue)).rejects.toThrow('Action is no longer legal')
  expect(source.sent).toHaveLength(1)
})
