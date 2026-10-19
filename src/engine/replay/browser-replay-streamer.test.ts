import { expect, spyOn, test } from 'bun:test'
import * as reporting from '@shared/reporting'
import { BrowserReplayCollector } from './browser-replay-collector'
import { BrowserReplayStreamer, type ReplayClock } from './browser-replay-streamer'

class Clock implements ReplayClock {
  timestamp = Date.parse('2026-10-19T12:00:00Z')
  private id = 0
  readonly tasks = new Map<ReturnType<typeof setTimeout>, { at: number; callback: () => void }>()
  now = () => this.timestamp
  random = () => 0
  schedule = (callback: () => void, delay: number) => {
    const id = ++this.id as unknown as ReturnType<typeof setTimeout>
    this.tasks.set(id, { at: this.timestamp + delay, callback })
    return id
  }
  cancel = (id: ReturnType<typeof setTimeout>) => {
    this.tasks.delete(id)
  }
  async advance(ms: number) {
    this.timestamp += ms
    for (const [id, task] of [...this.tasks]) {
      if (task.at <= this.timestamp) {
        this.tasks.delete(id)
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
  const body = JSON.parse(String(options.body))
  return new Response(
    String(
      body.events.at(-1)?.seq ??
        Number((options.headers as Record<string, string>)['X-Replay-After-Seq']),
    ),
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('committed-but-response-lost retries the exact body before later observations and metadata', async () => {
  const journal = collector()
  const time = new Clock()
  journal.incoming([{ type: 1 }])
  const sent: { after: string; body: string }[] = []
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    async function (this: unknown, _url, options) {
      expect(this).toBe(globalThis)
      sent.push({
        after: (options!.headers as Record<string, string>)['X-Replay-After-Seq']!,
        body: String(options!.body),
      })
      if (sent.length === 1) {
        throw new Error('response lost after server commit')
      }
      return ack(options!)
    } as typeof fetch,
    undefined,
    time,
  )
  expect(await streamer.flush()).toBe(false)
  journal.outgoing(Uint8Array.of(1))
  journal.metadata([{ grpId: 7, name: 'Synthetic' }] as Parameters<typeof journal.metadata>[0])
  expect(await streamer.flush('feedback', 'report-1')).toBe(false)
  expect(sent).toHaveLength(1)
  await time.advance(10_000)
  expect(sent[1]).toEqual(sent[0])
  expect(sent[2]!.after).toBe('1')
  expect(JSON.parse(sent[2]!.body)).toMatchObject({
    events: [{ seq: 2 }],
    cards: { '7': { grpId: 7 } },
    status: { reason: 'feedback', reportId: 'report-1' },
  })
  expect(streamer.diagnostics()).toEqual({ replay_state: 'acknowledged', replay_ack_seq: 2 })
  streamer.finish('left')
  await Bun.sleep(0)
  expect(time.tasks.size).toBe(0)
})

for (const status of [429, 503]) {
  for (const date of [false, true]) {
    test(`${status} honors ${date ? 'HTTP date' : 'seconds'} Retry-After and recovers a prolonged backlog`, async () => {
      const journal = collector()
      const time = new Clock()
      const sent: RequestInit[] = []
      let available = false
      const report = spyOn(reporting, 'reportDiagnostic').mockImplementation(() => {})
      const streamer = new BrowserReplayStreamer(
        journal,
        'browser-test',
        (async (_url, options) => {
          sent.push(options!)
          return available
            ? ack(options!)
            : new Response(null, {
                status,
                headers: {
                  'Retry-After': date ? new Date(time.now() + 60_000).toUTCString() : '60',
                },
              })
        }) as typeof fetch,
        undefined,
        time,
      )
      try {
        journal.incoming([{ type: 1 }])
        expect(await streamer.flush()).toBe(false)
        for (let index = 0; index < 6; index++) {
          journal.incoming([{ type: 2, payload: 'x'.repeat(1_000_000) }])
        }
        expect(await streamer.flush('feedback', 'report-1')).toBe(false)
        await time.advance(59_999)
        expect(sent).toHaveLength(1)
        available = true
        await time.advance(1)
        expect(String(sent[1]!.body)).toBe(String(sent[0]!.body))
        expect(sent.length).toBeGreaterThan(3)
        expect(
          sent.every(
            (request) => new TextEncoder().encode(String(request.body)).length <= 4 * 1024 * 1024,
          ),
        ).toBe(true)
        const accepted = sent.slice(1).flatMap((request) => JSON.parse(String(request.body)).events)
        expect(accepted.map((event: { seq: number }) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7])
        expect(streamer.diagnostics()).toEqual({ replay_state: 'acknowledged', replay_ack_seq: 7 })
        expect(report).toHaveBeenCalledTimes(1)
        // A successful retry resets exponential backoff, not the once-per-match report budget.
        available = false
        journal.incoming([{ type: 3 }])
        await streamer.flush()
        available = true
        await time.advance(60_000)
        expect(streamer.diagnostics().replay_ack_seq).toBe(8)
      } finally {
        streamer.finish('left')
        await Bun.sleep(0)
        report.mockRestore()
      }
    })
  }
}

for (const value of ['', 'not-an-ack', '-1', '0', '2', '9007199254740993']) {
  test(`invalid acknowledgement ${JSON.stringify(value)} never advances the prefix`, async () => {
    const journal = collector()
    journal.incoming([{ type: 1 }])
    const time = new Clock()
    let valid = false
    const sent: string[] = []
    const streamer = new BrowserReplayStreamer(
      journal,
      'browser-test',
      (async (_url, options) => {
        sent.push(String(options!.body))
        return valid ? ack(options!) : new Response(value)
      }) as typeof fetch,
      undefined,
      time,
    )
    expect(await streamer.flush()).toBe(false)
    expect(streamer.diagnostics()).toMatchObject({
      replay_ack_seq: 0,
      replay_failure: 'acknowledgement',
    })
    valid = true
    await time.advance(10_000)
    expect(sent[1]).toBe(sent[0])
    expect(streamer.diagnostics().replay_ack_seq).toBe(1)
    streamer.finish('left')
  })
}

test('busy calls coalesce feedback and completion without awaiting diagnostic I/O', async () => {
  const journal = collector()
  journal.incoming([{ type: 1 }])
  const first = deferred<Response>()
  const time = new Clock()
  const sent: RequestInit[] = []
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_url, options) => {
      sent.push(options!)
      return sent.length === 1 ? first.promise : ack(options!)
    }) as typeof fetch,
    undefined,
    time,
  )
  const pending = streamer.flush('feedback', 'report-1')
  journal.incoming([{ type: 2 }])
  expect(await streamer.flush()).toBe(false)
  expect(streamer.diagnostics()).toEqual({ replay_state: 'uploading', replay_ack_seq: 0 })
  streamer.finish('completed')
  expect(sent).toHaveLength(1)
  first.resolve(ack(sent[0]!))
  expect(await pending).toBe(true)
  expect(sent.map((request) => JSON.parse(String(request.body)).status)).toEqual([
    { reason: 'feedback', complete: false, truncated: false, reportId: 'report-1' },
    { reason: 'completed', complete: true, truncated: false, reportId: 'report-1' },
  ])
  expect(streamer.diagnostics().replay_ack_seq).toBe(2)
  expect(time.tasks.size).toBe(0)
})

test('retired matches retry transient final delivery independently, without notifying a replacement', async () => {
  const journal = collector('old-match')
  journal.incoming([{ type: 1 }])
  const time = new Clock()
  let available = false
  const sent: string[] = []
  let notifications = 0
  const streamer = new BrowserReplayStreamer(
    journal,
    'old-match',
    (async (url, options) => {
      sent.push(String(url))
      return available
        ? ack(options!)
        : new Response(null, { status: 503, headers: { 'Retry-After': '10' } })
    }) as typeof fetch,
    () => {
      notifications++
    },
    time,
  )
  streamer.finish('completed')
  await Bun.sleep(0)
  expect(streamer.diagnostics().replay_ack_seq).toBe(0)
  const replacement = new BrowserReplayStreamer(
    collector('new-match'),
    'new-match',
    undefined,
    undefined,
    time,
  )
  available = true
  await time.advance(10_000)
  expect(sent).toHaveLength(2)
  expect(sent.every((url) => url.includes('old-match'))).toBe(true)
  expect(notifications).toBe(0)
  expect(streamer.diagnostics().replay_ack_seq).toBe(1)
  replacement.finish('left')
})

test('final retries expire, obey long guidance, and do not leave an unbounded timer owner', async () => {
  const time = new Clock()
  let calls = 0
  const streamer = new BrowserReplayStreamer(
    collector(),
    'browser-test',
    (async (_input: RequestInfo | URL) => {
      calls++
      return new Response(null, { status: 429, headers: { 'Retry-After': '3600' } })
    }) as typeof fetch,
    undefined,
    time,
  )
  streamer.finish('completed')
  await Bun.sleep(0)
  expect(calls).toBe(1)
  expect(time.tasks.size).toBe(0)
  await time.advance(3_600_000)
  expect(await streamer.flush('feedback')).toBe(false)
  expect(calls).toBe(1)
})

test('a late acknowledgement cannot start more terminal backlog requests past the lifetime', async () => {
  const time = new Clock()
  const journal = collector()
  for (let index = 0; index < 2; index++) {
    journal.incoming([{ type: 1, payload: 'x'.repeat(2_200_000) }])
  }
  let calls = 0
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_url, options) => {
      calls++
      time.timestamp += 1_800_001
      return ack(options!)
    }) as typeof fetch,
    undefined,
    time,
  )
  streamer.finish('completed')
  await Bun.sleep(0)
  expect(calls).toBe(1)
  expect(streamer.diagnostics()).toMatchObject({ replay_ack_seq: 1, replay_failure: 'expired' })
  expect(journal.snapshot('feedback').events).toHaveLength(2)
  expect(time.tasks.size).toBe(0)
})

test('retry jitter spreads a synchronized cohort without violating the server minimum', async () => {
  const time = new Clock()
  time.random = () => 0.5
  let calls = 0
  const journal = collector()
  journal.incoming([{ type: 1 }])
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_input: RequestInfo | URL) => {
      calls++
      return new Response(null, { status: 429, headers: { 'Retry-After': '60' } })
    }) as typeof fetch,
    undefined,
    time,
  )
  expect(await streamer.flush()).toBe(false)
  await time.advance(60_000)
  expect(calls).toBe(1)
  await time.advance(999)
  expect(calls).toBe(1)
  await time.advance(1)
  expect(calls).toBe(2)
  streamer.finish('left')
})

test('transient backoff grows between failures and resets after acknowledgement', async () => {
  const journal = collector()
  journal.incoming([{ type: 1 }])
  const time = new Clock()
  let available = false
  let calls = 0
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_url, options) => {
      calls++
      return available
        ? ack(options!)
        : new Response(null, { status: 503, headers: { 'Retry-After': '1' } })
    }) as typeof fetch,
    undefined,
    time,
  )
  expect(await streamer.flush()).toBe(false)
  await time.advance(10_000)
  expect(calls).toBe(2)
  await time.advance(19_999)
  expect(calls).toBe(2)
  available = true
  await time.advance(1)
  expect(streamer.diagnostics().replay_ack_seq).toBe(1)
  available = false
  journal.incoming([{ type: 2 }])
  expect(await streamer.flush()).toBe(false)
  available = true
  await time.advance(10_000)
  expect(streamer.diagnostics().replay_ack_seq).toBe(2)
  streamer.finish('left')
})

test('the response body must complete before its numeric acknowledgement is trusted', async () => {
  const journal = collector()
  journal.incoming([{ type: 1 }])
  const time = new Clock()
  let complete!: () => void
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      complete = () => {
        controller.enqueue(new TextEncoder().encode('1'))
        controller.close()
      }
    },
  })
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_input: RequestInfo | URL) => new Response(body)) as typeof fetch,
    undefined,
    time,
  )
  const pending = streamer.flush()
  await Bun.sleep(0)
  expect(streamer.diagnostics()).toEqual({ replay_state: 'uploading', replay_ack_seq: 0 })
  expect(await streamer.flush()).toBe(false)
  complete()
  expect(await pending).toBe(true)
  expect(streamer.diagnostics().replay_ack_seq).toBe(1)
  // No pending final marker is needed for this transport-only probe.
  streamer.finish('streaming')
})

test('permanent 413 fails once and retains evidence instead of retrying unchanged requests', async () => {
  const journal = collector()
  journal.incoming([{ type: 1 }])
  const time = new Clock()
  let calls = 0
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_input: RequestInfo | URL) => {
      calls++
      return new Response(null, { status: 413 })
    }) as typeof fetch,
    undefined,
    time,
  )
  expect(await streamer.flush()).toBe(false)
  expect(streamer.diagnostics()).toMatchObject({ replay_ack_seq: 0, replay_http_status: 413 })
  await time.advance(60_000)
  expect(await streamer.flush('feedback')).toBe(false)
  expect(calls).toBe(1)
  expect(time.tasks.size).toBe(0)
  expect(journal.snapshot('feedback').events).toHaveLength(1)
})

test('an indivisible oversized event exposes a payload failure without diagnostic I/O', async () => {
  const journal = collector()
  journal.incoming([{ type: 1, payload: 'x'.repeat(4 * 1024 * 1024) }])
  const time = new Clock()
  let calls = 0
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_input: RequestInfo | URL) => {
      calls++
      return new Response('1')
    }) as typeof fetch,
    undefined,
    time,
  )
  expect(await streamer.flush('feedback')).toBe(false)
  expect(streamer.diagnostics()).toMatchObject({
    replay_state: 'failed',
    replay_ack_seq: 0,
    replay_failure: 'payload',
  })
  expect(calls).toBe(0)
  expect(time.tasks.size).toBe(0)
  expect(journal.snapshot('feedback').events).toHaveLength(1)
})

test('response-body failure retries the immutable request and never leaks exception text', async () => {
  const journal = collector()
  journal.incoming([{ type: 1 }])
  const time = new Clock()
  const report = spyOn(reporting, 'reportDiagnostic').mockImplementation(() => {})
  let calls = 0
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_url, options) => {
      calls++
      if (calls > 1) {
        return ack(options!)
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('private URL'))
          },
        }),
      )
    }) as typeof fetch,
    undefined,
    time,
  )
  try {
    expect(await streamer.flush()).toBe(false)
    expect(streamer.diagnostics()).toMatchObject({ replay_ack_seq: 0, replay_failure: 'network' })
    expect(JSON.stringify(report.mock.calls)).not.toContain('private URL')
    await time.advance(10_000)
    expect(streamer.diagnostics().replay_ack_seq).toBe(1)
  } finally {
    streamer.finish('left')
    report.mockRestore()
  }
})

test('collection and subscriber failures cannot escape into gameplay or start retry storms', async () => {
  const journal = collector()
  const time = new Clock()
  const chunk = spyOn(journal, 'chunk').mockImplementation(() => {
    throw new Error('private card')
  })
  const report = spyOn(reporting, 'reportDiagnostic').mockImplementation(() => {})
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    undefined,
    () => {
      throw new Error('subscriber')
    },
    time,
  )
  try {
    expect(await streamer.flush()).toBe(false)
    expect(streamer.diagnostics()).toMatchObject({ replay_failure: 'collection' })
    expect(time.tasks.size).toBe(0)
    expect(JSON.stringify(report.mock.calls)).not.toContain('private card')
  } finally {
    streamer.finish('left')
    chunk.mockRestore()
    report.mockRestore()
  }
})

test('a flush yields ownership after eight chunks and resumes the remaining prefix', async () => {
  const journal = collector()
  for (let index = 0; index < 9; index++) {
    journal.incoming([{ type: 1, payload: 'x'.repeat(2_200_000) }])
  }
  const time = new Clock()
  const sent: RequestInit[] = []
  const streamer = new BrowserReplayStreamer(
    journal,
    'browser-test',
    (async (_url, options) => {
      sent.push(options!)
      return ack(options!)
    }) as typeof fetch,
    undefined,
    time,
  )
  expect(await streamer.flush('completed', 'report-test')).toBe(true)
  expect(sent).toHaveLength(8)
  expect(streamer.diagnostics().replay_ack_seq).toBe(8)
  expect(sent.every((request) => !JSON.parse(String(request.body)).status.complete)).toBe(true)
  await time.advance(0)
  expect(sent).toHaveLength(9)
  expect(streamer.diagnostics().replay_ack_seq).toBe(9)
  expect(JSON.parse(String(sent[8]!.body)).status).toMatchObject({
    complete: true,
    reportId: 'report-test',
  })
  streamer.finish('completed')
})
