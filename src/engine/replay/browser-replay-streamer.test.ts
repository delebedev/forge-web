import { expect, spyOn, test } from 'bun:test'
import * as reporting from '@shared/reporting'
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

test('replay delivery exposes failure and recovery while reporting once per match', async () => {
  const collector = new BrowserReplayCollector({
    execution: 'browser',
    attemptId: 'attempt',
    matchId: 'match',
    gameType: 'constructed',
  })
  collector.incoming([{ type: 1 }])
  let status = 401
  const report = spyOn(reporting, 'reportDiagnostic').mockImplementation(() => {})
  const streamer = new BrowserReplayStreamer(
    collector,
    'match',
    (async () => new Response(null, { status })) as unknown as typeof fetch,
  )
  try {
    expect(await streamer.flush()).toBe(false)
    expect(streamer.diagnostics()).toEqual({
      replay_state: 'failed',
      replay_ack_seq: 0,
      replay_failure: 'http',
      replay_http_status: 401,
    })
    status = 500
    expect(await streamer.flush()).toBe(false)
    expect(report).toHaveBeenCalledTimes(1)
    status = 200
    expect(await streamer.flush()).toBe(true)
    expect(streamer.diagnostics()).toEqual({ replay_state: 'acknowledged', replay_ack_seq: 1 })
    expect(await streamer.flush()).toBe(true)
    expect(report).toHaveBeenCalledTimes(1)
  } finally {
    streamer.finish('left')
    await new Promise((resolve) => setTimeout(resolve, 0))
    report.mockRestore()
  }
})

test('busy replay delivery is not failure and rejected upload keeps the acknowledged prefix', async () => {
  const collector = new BrowserReplayCollector({
    execution: 'browser',
    attemptId: 'attempt',
    matchId: 'match',
    gameType: 'constructed',
  })
  collector.incoming([{ type: 1 }])
  let reject!: (reason: Error) => void
  const pending = new Promise<Response>((_resolve, fail) => {
    reject = fail
  })
  const report = spyOn(reporting, 'reportDiagnostic').mockImplementation(() => {})
  const streamer = new BrowserReplayStreamer(
    collector,
    'match',
    (() => pending) as unknown as typeof fetch,
  )
  try {
    const first = streamer.flush()
    expect(await streamer.flush()).toBe(false)
    expect(streamer.diagnostics()).toEqual({ replay_state: 'uploading', replay_ack_seq: 0 })
    expect(report).not.toHaveBeenCalled()
    reject(new Error('private network URL'))
    expect(await first).toBe(false)
    expect(streamer.diagnostics()).toEqual({
      replay_state: 'failed',
      replay_ack_seq: 0,
      replay_failure: 'network',
    })
    expect(JSON.stringify(report.mock.calls)).not.toContain('private network URL')
  } finally {
    streamer.finish('left')
    await new Promise((resolve) => setTimeout(resolve, 0))
    report.mockRestore()
  }
})

test('replay collection failure is distinguishable and does not escape', async () => {
  const collector = new BrowserReplayCollector({
    execution: 'browser',
    attemptId: 'attempt',
    matchId: 'match',
    gameType: 'constructed',
  })
  const chunk = spyOn(collector, 'chunk').mockImplementation(() => {
    throw new Error('private card')
  })
  const report = spyOn(reporting, 'reportDiagnostic').mockImplementation(() => {})
  const streamer = new BrowserReplayStreamer(collector, 'match')
  try {
    expect(await streamer.flush()).toBe(false)
    expect(streamer.diagnostics()).toEqual({
      replay_state: 'failed',
      replay_ack_seq: 0,
      replay_failure: 'collection',
    })
    expect(JSON.stringify(report.mock.calls)).not.toContain('private card')
  } finally {
    streamer.finish('left')
    chunk.mockRestore()
    report.mockRestore()
  }
})

test('diagnostic subscriber failures cannot turn acknowledged uploads into network failures', async () => {
  const collector = new BrowserReplayCollector({
    execution: 'browser',
    attemptId: 'attempt',
    matchId: 'match',
    gameType: 'constructed',
  })
  collector.incoming([{ type: 1 }])
  const streamer = new BrowserReplayStreamer(
    collector,
    'match',
    (async (_input: RequestInfo | URL) => new Response(null)) as typeof fetch,
    () => {
      throw new Error('subscriber failed')
    },
  )
  try {
    expect(await streamer.flush()).toBe(true)
    expect(streamer.diagnostics()).toEqual({ replay_state: 'acknowledged', replay_ack_seq: 1 })
  } finally {
    streamer.finish('left')
  }
})
