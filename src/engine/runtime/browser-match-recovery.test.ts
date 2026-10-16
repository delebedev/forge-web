import { expect, it } from 'bun:test'
import {
  buildGreWrapper,
  decodeMessage,
  encodeMessage,
  type ProtoObject,
} from '@engine/wire/gre-proto'
import { buildBootstrapMessages } from '@engine/wire/gre-bootstrap'
import { BrowserReplayCollector } from '@engine/replay/browser-replay-collector'
import { BrowserMatchSource } from './browser-match-source'
import type { BrowserEngine } from './browser-engine'
import { replayBrowserMatch } from './browser-match-recovery'

const config = {
  execution: 'browser' as const,
  gameType: 'constructed' as const,
  matchId: 'new-match',
  seed: 42,
  engineBuild: 'same-engine',
  seat1Deck: '1 Forest',
  seat2Deck: '1 Forest',
}
const request = (state: number, msg: number): ProtoObject => ({
  type: 2,
  gameStateId: state,
  msgId: msg,
  actionsAvailableReq: { actions: [{ actionType: 5 }] },
})
async function frame(messages: ProtoObject[]) {
  const bytes = await encodeMessage('MatchServiceToClientMessage', {
    greToClientEvent: { greToClientMessages: messages },
  })
  const decoded = await decodeMessage('MatchServiceToClientMessage', bytes)
  const normalized = (decoded['greToClientEvent'] as ProtoObject)[
    'greToClientMessages'
  ] as ProtoObject[]
  return { payload: btoa(String.fromCharCode(...bytes)), messages: normalized }
}
async function fixture(
  diverge = false,
  wrongBoard = false,
  resync: 'full' | 'diff' | 'no-connect' | 'split' = 'full',
) {
  const board = (state: number, life = 20): ProtoObject => ({
    type: 1,
    gameStateId: state,
    gameStateMessage: {
      type: 1,
      gameStateId: state,
      players: [{ systemSeatNumber: 1, lifeTotal: life }],
      turnInfo: { turnNumber: 2, activePlayer: 1, priorityPlayer: 1 },
    },
  })
  const first = await frame([board(3), request(3, 7)])
  const second = await frame([board(9), request(9, 11)])
  const response = await buildGreWrapper({
    type: 15,
    gameStateId: 3,
    respId: 7,
    performActionResp: { actions: [{ actionType: 5 }] },
  })
  const final = await buildGreWrapper({
    type: 15,
    gameStateId: 9,
    respId: 11,
    performActionResp: { actions: [{ actionType: 5 }] },
  })
  const collector = new BrowserReplayCollector({ ...config, matchId: 'old-match' })
  for (const bytes of await buildBootstrapMessages('old-match', 1)) {
    collector.outgoing(bytes)
  }
  collector.incoming(first.messages)
  collector.outgoing(response)
  collector.incoming(second.messages)
  collector.outgoing(final)
  const sent: Uint8Array[] = []
  const source = new BrowserMatchSource({ send() {} }, 'new-match')
  const engine = {
    releaseId: 'same-engine',
    sendAndWait: async (_source: unknown, bytes: Uint8Array, silent: boolean) => {
      sent.push(bytes)
      if (!silent && sent.length === 5) {
        const prompt = request(10, 14)
        if (diverge) {
          prompt['actionsAvailableReq'] = { actions: [{ actionType: 4 }] }
        }
        const currentBoard = board(10, wrongBoard ? 19 : 20)
        if (resync === 'diff') {
          ;(currentBoard['gameStateMessage'] as ProtoObject)['type'] = 2
        }
        if (resync === 'split') {
          source.receiveFrame((await frame([{ type: 7, msgId: 12, connectResp: {} }])).payload)
        }
        source.receiveFrame(
          (
            await frame([
              ...(resync === 'no-connect' || resync === 'split'
                ? []
                : [{ type: 7, msgId: 12, connectResp: {} }]),
              currentBoard,
              prompt,
            ])
          ).payload,
        )
      }
    },
  } as unknown as BrowserEngine
  return {
    engine,
    match: { source, matchId: 'new-match' },
    journal: collector.snapshot('failure'),
    sent,
    final,
  }
}

it('replays only through the previous decision and retains a complete continuation journal', async () => {
  const f = await fixture()
  const recovered = await replayBrowserMatch(
    f.engine,
    f.match,
    config,
    f.journal,
    AbortSignal.timeout(1000),
  )
  expect(f.sent).toHaveLength(5)
  expect(f.sent.some((bytes) => Buffer.from(bytes).equals(Buffer.from(f.final)))).toBe(false)
  expect(recovered.batches.at(-1)?.messages.at(-1)?.['msgId']).toBe(14)
  expect(recovered.collector.snapshot('continued').responses).toHaveLength(5)
  expect(recovered.collector.snapshot('continued').matchId).toBe('new-match')
  expect(recovered.collector.snapshot('continued').responses?.slice(0, 2)).toEqual(
    f.sent.slice(0, 2).map((bytes) => ({
      encoding: 'base64',
      payload: btoa(String.fromCharCode(...bytes)),
    })),
  )
  const connect = await decodeMessage('ClientToMatchServiceMessage', f.sent[1]!)
  const routing = await decodeMessage(
    'ClientToMatchDoorConnectRequest',
    connect['payload'] as Uint8Array,
  )
  expect(routing['matchId']).toBe('new-match')
})

it('accepts full state and a choice delivered after a separate connection response', async () => {
  const f = await fixture(false, false, 'split')
  const recovered = await replayBrowserMatch(
    f.engine,
    f.match,
    config,
    f.journal,
    AbortSignal.timeout(1000),
  )
  expect(recovered.batches).toHaveLength(2)
  expect(recovered.request['msgId']).toBe(14)
})

it('rejects a different prompt instead of enabling stale decisions', async () => {
  const f = await fixture(true)
  await expectFailure(
    replayBrowserMatch(f.engine, f.match, config, f.journal, AbortSignal.timeout(1000)),
    'differs',
  )
})

it('refuses an incomplete prefix and an engine version change before sending', async () => {
  const f = await fixture()
  f.journal.status!.truncated = true
  await expectFailure(
    replayBrowserMatch(f.engine, f.match, config, f.journal, AbortSignal.timeout(1000)),
    'incomplete',
  )
  f.journal.status!.truncated = false
  f.journal.context!.engineBuild = 'other-engine'
  await expectFailure(
    replayBrowserMatch(f.engine, f.match, config, f.journal, AbortSignal.timeout(1000)),
    'different engine',
  )
  expect(f.sent).toHaveLength(0)
})

it('rejects a changed board even when legal choices match', async () => {
  const f = await fixture(false, true)
  await expectFailure(
    replayBrowserMatch(f.engine, f.match, config, f.journal, AbortSignal.timeout(1000)),
    'differs',
  )
})

it('requires a connection resync and full state before enabling choices', async () => {
  for (const resync of ['diff', 'no-connect'] as const) {
    const f = await fixture(false, false, resync)
    await expectFailure(
      replayBrowserMatch(f.engine, f.match, config, f.journal, AbortSignal.timeout(1000)),
      'differs',
    )
  }
})

it('aborts before advancing saved input', async () => {
  const f = await fixture()
  const abort = new AbortController()
  abort.abort(new Error('Cancelled'))
  await expectFailure(
    replayBrowserMatch(f.engine, f.match, config, f.journal, abort.signal),
    'Cancelled',
  )
  expect(f.sent).toHaveLength(0)
})

async function expectFailure(promise: Promise<unknown>, text: string) {
  const error: unknown = await promise.then(
    () => null,
    (error: unknown) => error,
  )
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toContain(text)
}
