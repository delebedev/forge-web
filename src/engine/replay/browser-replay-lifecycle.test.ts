import { expect, test } from 'bun:test'
import { BrowserReplayCollector } from './browser-replay-collector'
import { BrowserReplayStreamer, type ReplayClock } from './browser-replay-streamer'
import { RetiredReplayDeliveries, MAX_RETIRED_REPLAY_BYTES } from './retired-replay-deliveries'

class Clock implements ReplayClock {
  nowMs = 0
  id = 0
  tasks = new Map<number, { callback: () => void; at: number }>()
  now = () => this.nowMs
  random = () => 0
  schedule = (callback: () => void, delay: number) => {
    const id = ++this.id
    this.tasks.set(id, { callback, at: this.nowMs + delay })
    return id as unknown as ReturnType<typeof setTimeout>
  }
  cancel = (id: ReturnType<typeof setTimeout>) => {
    this.tasks.delete(id as unknown as number)
  }
  async advance(ms: number) {
    this.nowMs += ms
    for (const [id, task] of [...this.tasks]) {
      if (task.at <= this.nowMs && this.tasks.delete(id)) {
        task.callback()
      }
    }
    await Bun.sleep(0)
  }
}

function collector(matchId = 'browser-test') {
  return new BrowserReplayCollector({
    execution: 'browser',
    matchId,
    attemptId: 'test-attempt',
    gameType: 'constructed',
  })
}

function ack(options: RequestInit) {
  const chunk = JSON.parse(String(options.body))
  return new Response(
    String(
      chunk.events.at(-1)?.seq ??
        Number((options.headers as Record<string, string>)['X-Replay-After-Seq']),
    ),
  )
}

test('feedback during a completed multi-chunk upload cannot replace terminal completion', async () => {
  const journal = collector()
  for (let index = 0; index < 2; index++) {
    journal.incoming([{ type: 1, payload: 'x'.repeat(2_200_000) }])
  }
  const time = new Clock()
  const requests: RequestInit[] = []
  let release!: (response: Response) => void
  const first = new Promise<Response>((resolve) => {
    release = resolve
  })
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_url, options) => {
      requests.push(options!)
      return requests.length === 1 ? first : ack(options!)
    }) as typeof fetch,
    undefined,
    time,
  )
  streamer.finish('completed')
  expect(await streamer.flush('feedback', 'report-test')).toBe(false)
  release(ack(requests[0]!))
  await Bun.sleep(0)
  expect(streamer.diagnostics().replay_ack_seq).toBe(2)
  expect(JSON.parse(String(requests.at(-1)!.body)).status).toMatchObject({
    complete: true,
    reason: 'completed',
    reportId: 'report-test',
  })
  expect(time.tasks.size).toBe(0)
})

test('feedback after completed delivery sends a complete status-only report association', async () => {
  const journal = collector()
  journal.incoming([{ type: 1 }])
  const time = new Clock()
  const requests: RequestInit[] = []
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_url, options) => {
      requests.push(options!)
      return ack(options!)
    }) as typeof fetch,
    undefined,
    time,
  )
  streamer.finish('completed')
  await Bun.sleep(0)
  expect(await streamer.flush('feedback', 'report-test')).toBe(true)
  const chunk = JSON.parse(String(requests.at(-1)!.body))
  expect(chunk.events).toEqual([])
  expect(chunk.status).toMatchObject({
    complete: true,
    reason: 'completed',
    reportId: 'report-test',
  })
})

function retiredCohort(time: Clock, retired: RetiredReplayDeliveries) {
  const streamers: BrowserReplayStreamer[] = []
  const references: WeakRef<BrowserReplayCollector>[] = []
  let calls = 0
  const upload = (async (_input: RequestInfo | URL) => {
    calls++
    return new Response(null, { status: 503, headers: { 'Retry-After': '10' } })
  }) as typeof fetch
  for (let index = 0; index < 40; index++) {
    const journal = collector(`browser-${index}`)
    journal.incoming([{ type: 1 }])
    references.push(new WeakRef(journal))
    const streamer = new BrowserReplayStreamer(
      journal,
      `browser-${index}`,
      upload,
      () => {
        throw new Error('retired callback must be released')
      },
      time,
      retired,
    )
    streamers.push(streamer)
    streamer.finish('left')
  }
  return { streamers, references, calls: () => calls }
}

test('forty failed retirements bound retained collectors and future retries across matches', async () => {
  const time = new Clock()
  const retired = new RetiredReplayDeliveries()
  const { streamers, references, calls } = retiredCohort(time, retired)
  await Bun.sleep(0)
  Bun.gc(true)
  await Bun.sleep(0)
  Bun.gc(true)
  expect(references.flatMap((ref, index) => (ref.deref() ? [index] : []))).toEqual([38, 39])
  expect(
    streamers.filter((streamer) => streamer.diagnostics().replay_failure === 'abandoned'),
  ).toHaveLength(38)
  expect(retired.diagnostics()).toMatchObject({ matches: 2, abandoned: 38 })
  const before = calls()
  await time.advance(10_000)
  expect(calls() - before).toBeLessThanOrEqual(2)
  for (const streamer of streamers) {
    streamer.abandon()
  }
  expect(retired.diagnostics().matches).toBe(0)
})

test('terminal retry guidance beyond the lifetime expires without an external flush', async () => {
  const journal = collector()
  journal.incoming([{ type: 1 }])
  const time = new Clock()
  let calls = 0
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_input: RequestInfo | URL) => {
      calls++
      return new Response(null, { status: 503, headers: { 'Retry-After': '3600' } })
    }) as typeof fetch,
    undefined,
    time,
  )
  streamer.finish('completed')
  await Bun.sleep(0)
  await time.advance(1_800_000)
  expect(streamer.diagnostics()).toMatchObject({
    replay_state: 'failed',
    replay_failure: 'expired',
    replay_ack_seq: 0,
  })
  expect(time.tasks.size).toBe(0)
  expect(calls).toBe(1)
})

test('byte pressure includes newly prepared bodies and evicts the oldest retired journal', async () => {
  const time = new Clock()
  const retired = new RetiredReplayDeliveries()
  const streamers = []
  for (let index = 0; index < 2; index++) {
    const journal = collector(`large-${index}`)
    for (let event = 0; event < 7; event++) {
      journal.incoming([{ type: 1, payload: 'x'.repeat(2_200_000) }])
    }
    const streamer = new BrowserReplayStreamer(
      journal,
      `large-${index}`,
      (async (_input: RequestInfo | URL) => new Response(null, { status: 503 })) as typeof fetch,
      undefined,
      time,
      retired,
    )
    streamer.finish('completed')
    streamers.push(streamer)
  }
  await Bun.sleep(0)
  expect(streamers[0]!.diagnostics().replay_failure).toBe('abandoned')
  expect(streamers[1]!.diagnostics().replay_failure).toBe('http')
  expect(retired.diagnostics().matches).toBe(1)
  expect(retired.diagnostics().bytes).toBeLessThanOrEqual(MAX_RETIRED_REPLAY_BYTES)
  streamers[1]!.abandon()
  expect(retired.diagnostics()).toMatchObject({ matches: 0, bytes: 0 })
})

test('retirement releases the match callback but preserves an active collector and match identity', async () => {
  const time = new Clock()
  const retired = new RetiredReplayDeliveries()
  const journal = collector('active-match')
  journal.incoming([{ type: 1 }])
  const requests: { url: string; body: string }[] = []
  function subscriber() {
    const token = { privateMatchState: 'synthetic' }
    return {
      callback: () => {
        void token.privateMatchState
      },
      weak: new WeakRef(token),
    }
  }
  const observer = subscriber()
  const weak = observer.weak
  const streamer = new BrowserReplayStreamer(
    journal,
    'active-match',
    (async (url, options) => {
      requests.push({ url: String(url), body: String(options!.body) })
      return ack(options!)
    }) as typeof fetch,
    observer.callback,
    time,
    retired,
  )
  observer.callback = () => {}
  streamer.finish('left')
  await Bun.sleep(0)
  Bun.gc(true)
  expect(weak.deref()).toBeUndefined()
  expect(retired.diagnostics().matches).toBe(0)
  journal.diagnostic({ runtime: 'timed-out', commands: [] })
  expect(await streamer.flush('worker')).toBe(true)
  expect(streamer.diagnostics().replay_ack_seq).toBe(2)
  expect(requests.every((request) => request.url.includes('active-match'))).toBe(true)
  expect(JSON.parse(requests.at(-1)!.body).events[0].direction).toBe('diagnostic')
  expect(journal.snapshot('recovery').events).toHaveLength(2)
  expect(retired.diagnostics().matches).toBe(0)
})

test('expiry aborts an in-flight retired request and ignores any later acknowledgement', async () => {
  const time = new Clock()
  const retired = new RetiredReplayDeliveries()
  const journal = collector()
  journal.incoming([{ type: 1 }])
  let signal: AbortSignal | undefined
  let release!: (response: Response) => void
  const response = new Promise<Response>((resolve) => {
    release = resolve
  })
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_url, options) => {
      signal = options!.signal!
      return response
    }) as typeof fetch,
    undefined,
    time,
    retired,
  )
  streamer.finish('completed')
  await time.advance(1_800_000)
  expect(signal!.aborted).toBe(true)
  expect(streamer.diagnostics()).toMatchObject({ replay_failure: 'expired', replay_ack_seq: 0 })
  expect(retired.diagnostics()).toMatchObject({ matches: 0, bytes: 0, expired: 1 })
  release(new Response('1'))
  await Bun.sleep(0)
  expect(streamer.diagnostics()).toMatchObject({ replay_failure: 'expired', replay_ack_seq: 0 })
  expect(time.tasks.size).toBe(0)
})

test('persistent storage rejection reaches its autonomous deadline after bounded retries', async () => {
  const time = new Clock()
  const retired = new RetiredReplayDeliveries()
  const journal = collector()
  journal.incoming([{ type: 1 }])
  let calls = 0
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_input: RequestInfo | URL) => {
      calls++
      return new Response(null, { status: 503, headers: { 'Retry-After': '10' } })
    }) as typeof fetch,
    undefined,
    time,
    retired,
  )
  streamer.finish('completed')
  await Bun.sleep(0)
  for (let step = 0; step < 20 && time.tasks.size; step++) {
    const next = Math.min(...[...time.tasks.values()].map((task) => task.at))
    await time.advance(next - time.now())
  }
  expect(time.now()).toBe(1_800_000)
  expect(calls).toBe(10)
  expect(streamer.diagnostics()).toMatchObject({ replay_failure: 'expired', replay_ack_seq: 0 })
  expect(retired.diagnostics()).toMatchObject({ matches: 0, bytes: 0, expired: 1 })
  expect(time.tasks.size).toBe(0)
})

test('feedback during a completed retry keeps the immutable prefix and final completion', async () => {
  const time = new Clock()
  const retired = new RetiredReplayDeliveries()
  const journal = collector()
  for (let index = 0; index < 2; index++) {
    journal.incoming([{ type: 1, payload: 'x'.repeat(2_200_000) }])
  }
  const requests: RequestInit[] = []
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_url, options) => {
      requests.push(options!)
      return requests.length === 1 ? new Response(null, { status: 503 }) : ack(options!)
    }) as typeof fetch,
    undefined,
    time,
    retired,
  )
  streamer.finish('completed')
  await Bun.sleep(0)
  expect(await streamer.flush('feedback', 'report-test')).toBe(false)
  await time.advance(10_000)
  expect(String(requests[1]!.body)).toBe(String(requests[0]!.body))
  expect(streamer.diagnostics().replay_ack_seq).toBe(2)
  expect(JSON.parse(String(requests.at(-1)!.body)).status).toMatchObject({
    complete: true,
    reportId: 'report-test',
  })
  expect(retired.diagnostics().matches).toBe(0)
})

function largeBusyCohort(time: Clock, retired: RetiredReplayDeliveries) {
  return [0, 1].map((index) => {
    const journal = collector(`growth-${index}`)
    for (const bytes of [3_000_000, 3_000_000, 3_000_000, 3_000_000, 1_000_000]) {
      journal.incoming([{ type: 1, payload: 'x'.repeat(bytes) }])
    }
    let release!: (response: Response) => void
    const first = new Promise<Response>((resolve) => {
      release = resolve
    })
    const sent: RequestInit[] = []
    const streamer = new BrowserReplayStreamer(
      journal,
      `growth-${index}`,
      (async (_url, options) => {
        sent.push(options!)
        return sent.length === 1 ? first : new Response(null, { status: 503 })
      }) as typeof fetch,
      undefined,
      time,
      retired,
    )
    streamer.finish('left')
    return { journal, streamer, release, sent }
  })
}

test('a coalesced busy flush rechecks late collector growth and cannot reschedule an eviction', async () => {
  const time = new Clock()
  const retired = new RetiredReplayDeliveries()
  const cohort = largeBusyCohort(time, retired)
  expect(retired.diagnostics().matches).toBe(2)
  expect(retired.diagnostics().bytes).toBeLessThanOrEqual(MAX_RETIRED_REPLAY_BYTES)
  cohort[0]!.journal.incoming([{ type: 2, payload: 'y'.repeat(2_000_000) }])
  expect(await cohort[0]!.streamer.flush('feedback', 'report-growth')).toBe(false)
  expect(retired.diagnostics()).toMatchObject({ matches: 1, abandoned: 1 })
  expect(retired.diagnostics().bytes).toBeLessThanOrEqual(MAX_RETIRED_REPLAY_BYTES)
  expect(cohort[0]!.sent[0]!.signal!.aborted).toBe(true)
  for (const item of cohort) {
    item.release(new Response(null, { status: 503 }))
  }
  await Bun.sleep(0)
  await time.advance(10_000)
  expect(cohort[0]!.streamer.diagnostics()).toMatchObject({
    replay_failure: 'abandoned',
    replay_ack_seq: 0,
  })
  expect(cohort[0]!.sent).toHaveLength(1)
  expect(cohort[1]!.sent).toHaveLength(2)
  expect(String(cohort[1]!.sent[0]!.body)).toBe(String(cohort[1]!.sent[1]!.body))
  for (const item of cohort) {
    item.streamer.abandon()
  }
  expect(retired.diagnostics().matches).toBe(0)
  expect(time.tasks.size).toBe(0)
})

test('a transient response rechecks unannounced collector growth before scheduling its retry', async () => {
  const time = new Clock()
  const retired = new RetiredReplayDeliveries()
  const cohort = largeBusyCohort(time, retired)
  cohort[0]!.journal.incoming([{ type: 2, payload: 'y'.repeat(2_000_000) }])
  for (const item of cohort) {
    item.release(new Response(null, { status: 503 }))
  }
  await Bun.sleep(0)
  expect(retired.diagnostics()).toMatchObject({ matches: 1, abandoned: 1 })
  expect(retired.diagnostics().bytes).toBeLessThanOrEqual(MAX_RETIRED_REPLAY_BYTES)
  expect(cohort[0]!.streamer.diagnostics()).toMatchObject({
    replay_failure: 'abandoned',
    replay_ack_seq: 0,
  })
  await time.advance(10_000)
  expect(cohort[0]!.sent).toHaveLength(1)
  expect(cohort[1]!.sent).toHaveLength(2)
  for (const item of cohort) {
    item.streamer.abandon()
  }
  expect(time.tasks.size).toBe(0)
})
