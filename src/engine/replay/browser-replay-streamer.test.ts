import { expect, test } from 'bun:test'
import { BrowserReplayCollector } from './browser-replay-collector'
import { BrowserReplayStreamer } from './browser-replay-streamer'

test('browser replay retries failed chunks without interrupting capture', async () => {
  const matchId = 'browser-11111111-1111-4111-8111-111111111111'
  const collector = new BrowserReplayCollector({
    execution: 'browser',
    attemptId: '22222222-2222-4222-8222-222222222222',
    matchId,
    gameType: 'constructed',
  })
  const sent: { after: string; events: number[] }[] = []
  let available = false
  const upload = async function (this: unknown, _url: string, options: RequestInit) {
    expect(this).toBe(globalThis)
    const chunk = JSON.parse(String(options.body))
    sent.push({
      after: (options.headers as Record<string, string>)['X-Replay-After-Seq'],
      events: chunk.events.map((event: { seq: number }) => event.seq),
    })
    if (!available) {
      throw new Error('Replay storage unavailable')
    }
    return { ok: true } as Response
  } as typeof fetch
  const streamer = new BrowserReplayStreamer(collector, matchId, upload)
  try {
    collector.incoming([{ type: 1 }])
    expect(await streamer.flush()).toBe(false)
    collector.outgoing(Uint8Array.of(1))
    available = true
    expect(await streamer.flush()).toBe(true)
    collector.incoming([{ type: 2 }])
    expect(await streamer.flush()).toBe(true)
    expect(sent).toEqual([
      { after: '0', events: [1] },
      { after: '0', events: [1, 2] },
      { after: '2', events: [3] },
    ])
  } finally {
    streamer.finish('left')
  }
})

test('completion follows an in-flight feedback upload', async () => {
  const matchId = 'browser-11111111-1111-4111-8111-111111111111'
  const collector = new BrowserReplayCollector({
    execution: 'browser',
    attemptId: '22222222-2222-4222-8222-222222222222',
    matchId,
    gameType: 'constructed',
  })
  collector.incoming([{ type: 1 }])
  let releaseFirst!: () => void
  const firstResponse = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const sent: { reason: string; reportId?: string; complete: boolean; truncated: boolean }[] = []
  const upload = async (_url: string, options: RequestInit) => {
    const chunk = JSON.parse(String(options.body))
    sent.push(chunk.status)
    if (sent.length === 1) {
      await firstResponse
    }
    return { ok: true } as Response
  }
  const streamer = new BrowserReplayStreamer(collector, matchId, upload as typeof fetch)
  const feedback = streamer.flush('feedback', 'report-1')
  streamer.finish('completed')
  releaseFirst()
  expect(await feedback).toBe(true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(sent).toEqual([
    { reason: 'feedback', reportId: 'report-1', complete: false, truncated: false },
    { reason: 'completed', complete: true, truncated: false },
  ])
})

test('metadata added after first upload reaches an idle in-progress replay', async () => {
  const matchId = 'browser-11111111-1111-4111-8111-111111111111'
  const collector = new BrowserReplayCollector({
    execution: 'browser',
    attemptId: '22222222-2222-4222-8222-222222222222',
    matchId,
    gameType: 'constructed',
  })
  const sent: { events: unknown[]; cards: Record<string, unknown> }[] = []
  const upload = async (_url: string, options: RequestInit) => {
    sent.push(JSON.parse(String(options.body)))
    return { ok: true } as Response
  }
  const streamer = new BrowserReplayStreamer(collector, matchId, upload as typeof fetch)
  try {
    collector.incoming([{ type: 1 }])
    expect(await streamer.flush()).toBe(true)
    collector.metadata([{ grpId: 42, name: 'Test card' }] as Parameters<
      typeof collector.metadata
    >[0])
    expect(await streamer.flush()).toBe(true)
    expect(sent).toHaveLength(2)
    expect(sent[1]?.events).toEqual([])
    expect(sent[1]?.cards).toHaveProperty('42')
  } finally {
    streamer.finish('left')
  }
})
