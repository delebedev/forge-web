import { expect, test } from 'bun:test'
import { BrowserReplayCollector } from './browser-replay-collector'

test('browser replay keeps ordered batches, responses, metadata, and launch context', () => {
  const collector = new BrowserReplayCollector({
    execution: 'browser',
    attemptId: 'attempt-1',
    matchId: 'browser-1',
    gameType: 'commander',
    seed: 42,
    seat1Deck: '99 Island\nCommander\n1 Empress Galina',
    seat2Deck: '99 Mountain\nCommander\n1 Zo-Zu the Punisher',
    frontendBuild: 'frontend-1',
    engineBuild: 'engine-1',
  })

  collector.incoming([{ type: 1, gameStateId: 1 }])
  collector.outgoing(Uint8Array.of(1, 2, 3))
  collector.metadata([
    {
      grpId: 7,
      name: 'Empress Galina',
      manaCost: null,
      power: '1',
      toughness: '3',
      types: 'Creature',
      subtypes: 'Merfolk Wizard',
      imageUrl: null,
      keywords: [],
    },
  ])
  const bundle = collector.snapshot('feedback', 'report-1')

  expect(bundle.context).toMatchObject({
    attemptId: 'attempt-1',
    matchId: 'browser-1',
    gameType: 'commander',
    seed: 42,
  })
  expect(bundle.batches).toEqual([{ messages: [{ type: 1, gameStateId: 1 }] }])
  expect(bundle.responses).toEqual([{ encoding: 'base64', payload: 'AQID' }])
  expect(bundle.cards['7']?.name).toBe('Empress Galina')
  expect(bundle.events?.map(({ direction }) => direction)).toEqual(['outbound', 'inbound'])
  expect(bundle.status).toMatchObject({
    reason: 'feedback',
    reportId: 'report-1',
    truncated: false,
  })
})

test('browser replay preserves a viewable prefix and marks truncation at its memory bound', () => {
  const collector = new BrowserReplayCollector(
    {
      execution: 'browser',
      attemptId: 'attempt-1',
      matchId: 'browser-1',
      gameType: 'constructed',
    },
    80,
  )

  collector.incoming([{ type: 1 }])
  collector.incoming([{ type: 1, payload: 'x'.repeat(200) }])
  collector.incoming([{ type: 2 }])
  const bundle = collector.snapshot('worker')

  expect(bundle.batches).toEqual([{ messages: [{ type: 1 }] }])
  expect(bundle.status?.truncated).toBe(true)
})

test('failure diagnostics survive a full journal prefix without entering normal chunks', () => {
  const collector = new BrowserReplayCollector({ execution: 'browser', matchId: 'browser-1' }, 1)
  collector.incoming([{ type: 1 }])
  expect(collector.snapshot('streaming').events).toEqual([])
  collector.diagnostic({
    runtime: 'timed-out',
    commands: [{ id: 3, operation: 'send', event: 'start', atMs: 12 }],
  })
  const bundle = collector.chunk(0, 0, 0, 'runtime')
  expect(bundle.events![0]).toMatchObject({
    seq: 1,
    direction: 'diagnostic',
    message: { runtime: 'timed-out' },
  })
  expect(bundle.status!.truncated).toBe(true)
})
