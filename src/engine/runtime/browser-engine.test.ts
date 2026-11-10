import { describe, expect, it } from 'bun:test'
import { encodeMessage } from '@engine/wire/gre-proto'
import type { GreFrameBatch, GreFrameSink } from './gre-frame-source'
import { BrowserMatchSource, type BrowserEngineEvent } from './browser-match-source'
import { BrowserDiagnostics } from './browser-diagnostics'
import { BrowserEngine, BrowserEngineFailure } from './browser-engine'
import type { BrowserRelease } from './browser-release'
import { sanitizeBrowserFailureSnapshot } from '@shared/browser-failure-snapshot'

type WorkerCommand = { type: string; id?: number; [key: string]: unknown }

class FakeWorker {
  onmessage: ((event: MessageEvent<BrowserEngineEvent>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  commands: WorkerCommand[] = []
  terminated = false
  respond = true
  failNextStart = false
  keywordCoverage: unknown = undefined
  failNextClose = false
  failNextInitialize = false
  respondDiagnostic = true
  diagnosticRequests = 0
  respondHeartbeat = true
  throwHeartbeat = false
  emitCommandStart = true
  heartbeatResponseAfter: number | null = null
  heartbeats = 0
  private matches = 0

  postMessage(command: WorkerCommand): void {
    if (command.type === 'failure-diagnostic') {
      this.diagnosticRequests += 1
      if (!this.respondDiagnostic) {
        return
      }
      queueMicrotask(() =>
        this.emit({
          event: 'failure-diagnostic',
          data: {
            runtime: 'available',
            heapUsed: 123,
            receivePhase: 'CoordinatorWait',
            phaseElapsedMs: 100,
          },
          at: 0,
        }),
      )
      return
    }
    if (command.type === 'heartbeat') {
      this.heartbeats += 1
      if (this.throwHeartbeat) {
        throw new Error('heartbeat post failed')
      }
      if (
        this.respondHeartbeat ||
        (this.heartbeatResponseAfter != null && this.heartbeats >= this.heartbeatResponseAfter)
      ) {
        queueMicrotask(() =>
          this.emit({ event: 'heartbeat', data: { nonce: command['nonce'] }, at: 0 }),
        )
      }
      return
    }
    this.commands.push(command)
    if (command.id == null) {
      return
    }
    queueMicrotask(() => {
      if (this.emitCommandStart) {
        this.emit({
          event: 'command-start',
          data: { id: command.id, type: command.type, queueDurationMs: 0 },
          at: 0,
        })
      }
      if (!this.respond) {
        return
      }
      if (command.type === 'initialize' && this.failNextInitialize) {
        this.failNextInitialize = false
        this.emit({ event: 'reply', data: { id: command.id, error: 'catalog unavailable' }, at: 0 })
        return
      }
      if (command.type === 'start' && this.failNextStart) {
        this.failNextStart = false
        this.emit({ event: 'reply', data: { id: command.id, error: 'launch failed' }, at: 0 })
        return
      }
      if (command.type === 'close' && this.failNextClose) {
        this.failNextClose = false
        this.emit({ event: 'reply', data: { id: command.id, error: 'close failed' }, at: 0 })
        return
      }
      const result =
        command.type === 'start'
          ? {
              matchId: String(command['matchId'] ?? `match-${++this.matches}`),
              effectiveKeywordCoverage: this.keywordCoverage,
            }
          : undefined
      this.emit({ event: 'reply', data: { id: command.id, result }, at: 0 })
    })
  }

  terminate(): void {
    this.terminated = true
  }

  emit(event: BrowserEngineEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<BrowserEngineEvent>)
  }
}

class SerializedWorker {
  onmessage: ((event: MessageEvent<BrowserEngineEvent>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  commands: WorkerCommand[] = []
  terminated = false
  blockSend = false
  heartbeats = 0
  startedTypes: string[] = []
  private queue = Promise.resolve()
  private matches = 0

  postMessage(command: WorkerCommand): void {
    if (command.type === 'failure-diagnostic') {
      queueMicrotask(() =>
        this.emit({
          event: 'failure-diagnostic',
          data: {
            runtime: 'available',
            heapUsed: 123,
            receivePhase: 'CoordinatorWait',
            phaseElapsedMs: 100,
          },
          at: 0,
        }),
      )
      return
    }
    if (command.type === 'heartbeat') {
      this.heartbeats += 1
      queueMicrotask(() =>
        this.emit({ event: 'heartbeat', data: { nonce: command['nonce'] }, at: 0 }),
      )
      return
    }
    this.commands.push(command)
    const enqueuedAt = performance.now()
    this.queue = this.queue.then(async () => {
      this.startedTypes.push(command.type)
      this.emit({
        event: 'command-start',
        data: {
          id: command.id,
          type: command.type,
          queueDurationMs: performance.now() - enqueuedAt,
        },
        at: 0,
      })
      if (command.type === 'send' && this.blockSend) {
        await new Promise(() => undefined)
      }
      const result =
        command.type === 'start'
          ? { matchId: String(command['matchId'] ?? `match-${++this.matches}`) }
          : undefined
      this.emit({ event: 'reply', data: { id: command.id, result }, at: 0 })
    })
  }

  terminate(): void {
    this.terminated = true
  }

  emit(event: BrowserEngineEvent): void {
    this.onmessage?.({ data: event } as MessageEvent<BrowserEngineEvent>)
  }
}

function sink() {
  const batches: GreFrameBatch[] = []
  let errors = 0
  const value: GreFrameSink = {
    onOpen() {},
    onBatch: (batch) => batches.push(batch),
    onReset() {},
    onClose() {},
    onError: () => {
      errors += 1
    },
  }
  return { value, batches, errors: () => errors }
}

function engineWith(worker: FakeWorker): BrowserEngine {
  return new BrowserEngine(
    () => {},
    () => worker as unknown as Worker,
  )
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function stateFrame(worker: Pick<FakeWorker, 'emit'>, matchId: string, gameStateId: number) {
  const bytes = await encodeMessage('MatchServiceToClientMessage', {
    greToClientEvent: {
      greToClientMessages: [{ type: 2, gameStateMessage: { gameStateId } }],
    },
  })
  worker.emit({
    event: 'frame',
    data: { matchId, payload: btoa(String.fromCharCode(...bytes)) },
    at: 0,
  })
}

describe('BrowserEngine', () => {
  it('binds explicit keyword coverage to one match generation and falls back for an old runtime', async () => {
    const worker = new FakeWorker()
    const engine = engineWith(worker)
    worker.keywordCoverage = ['Flying']
    const first = await engine.createMatch('deck 1', 'deck 2', 42)
    expect(first.source.effectiveKeywordCoverage).toEqual(['Flying'])
    worker.keywordCoverage = undefined
    const next = await engine.createMatch('deck 1', 'deck 2', 42)
    expect(first.source.effectiveKeywordCoverage).toBeUndefined()
    expect(next.source.effectiveKeywordCoverage).toBeUndefined()
    worker.keywordCoverage = 'Flying'
    const malformed = await engine.createMatch('deck 1', 'deck 2', 42)
    expect(malformed.source.effectiveKeywordCoverage).toBeUndefined()
    engine.dispose()
    expect(malformed.source.effectiveKeywordCoverage).toBeUndefined()
  })

  it('sends the fixed puzzle content to the worker and reuses it on a warm retry', async () => {
    const worker = new FakeWorker()
    const engine = engineWith(worker)
    const puzzle = { id: 'bolt-at-three-v1', text: '[metadata]\nGoal:Win' }

    await engine.createMatch('', '', 42, 'puzzle', 'first', puzzle)
    await engine.createMatch('', '', 42, 'puzzle', 'retry', puzzle)

    expect(worker.commands.filter((command) => command.type === 'start')).toEqual([
      expect.objectContaining({
        gameType: 'puzzle',
        puzzleId: puzzle.id,
        puzzleText: puzzle.text,
        matchId: 'first',
      }),
      expect.objectContaining({
        gameType: 'puzzle',
        puzzleId: puzzle.id,
        puzzleText: puzzle.text,
        matchId: 'retry',
      }),
    ])
    expect(worker.commands.filter((command) => command.type === 'initialize')).toHaveLength(1)
    engine.dispose()
  })

  it('carries stable match identity and Commander format to the worker', async () => {
    const worker = new FakeWorker()
    const engine = engineWith(worker)

    const match = await engine.createMatch(
      '99 Island\nCommander\n1 Empress Galina',
      '99 Mountain\nCommander\n1 Zo-Zu the Punisher',
      42,
      'commander',
      'browser-stable-id',
    )

    expect(match.matchId).toBe('browser-stable-id')
    expect(worker.commands.at(-1)).toMatchObject({
      type: 'start',
      matchId: 'browser-stable-id',
      gameType: 'commander',
      seed: 42,
    })
    engine.dispose()
  })

  it('suppresses delivery only for requested replay sends and rejects a retired source', async () => {
    const worker = new FakeWorker()
    const engine = engineWith(worker)
    const first = await engine.createMatch('deck 1', 'deck 2', 42)
    await engine.sendAndWait(first.source, new Uint8Array([1]), true)
    await engine.sendAndWait(first.source, new Uint8Array([2]))
    expect(worker.commands.filter((command) => command.type === 'send')).toEqual([
      expect.objectContaining({ payload: 'AQ==', silent: true }),
      expect.objectContaining({ payload: 'Ag==' }),
    ])
    expect(worker.commands.at(-1)?.['silent']).toBeUndefined()
    await engine.createMatch('deck 1', 'deck 2', 42)
    const error: unknown = await engine.sendAndWait(first.source, new Uint8Array([1]), true).then(
      () => null,
      (error: unknown) => error,
    )
    expect(String(error)).toContain('retired')
    engine.dispose()
  })

  it('initializes once and closes the old match before a warm second start', async () => {
    const worker = new FakeWorker()
    const engine = engineWith(worker)

    const first = await engine.createMatch('deck 1', 'deck 2', 42)
    first.source.start(sink().value)
    const second = await engine.createMatch('deck 3', 'deck 4', 43)

    expect(first.matchId).toBe('match-1')
    expect(second.matchId).toBe('match-2')
    expect(worker.commands.map((command) => command.type)).toEqual([
      'initialize',
      'start',
      'close',
      'start',
    ])
    expect(worker.commands.filter((command) => command.type === 'initialize')).toHaveLength(1)
    expect(first.source.isOpen).toBe(false)
    expect(() => first.source.send(new Uint8Array([1]))).toThrow('closed')
  })

  it('bounds lazy production worker ownership across reuse and disposal', async () => {
    const workers: FakeWorker[] = []
    const release: BrowserRelease = {
      schemaVersion: 2,
      releaseId: 'test-release',
      assets: [
        {
          path: 'web/engine-worker.js',
          url: '/browser-engine/objects/test/engine-worker.js',
          bytes: 1,
          sha256: 'test',
        },
      ],
      startupAssets: [],
    }
    const createWorker = () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker as unknown as Worker
    }
    const engine = new BrowserEngine(
      () => {},
      createWorker,
      {},
      () => Promise.resolve(release),
    )
    let resolveRelease!: (release: BrowserRelease) => void
    const pendingRelease = new Promise<BrowserRelease>((resolve) => {
      resolveRelease = resolve
    })
    const disposedEngine = new BrowserEngine(
      () => {},
      createWorker,
      {},
      () => pendingRelease,
    )
    try {
      await engine.createMatch('deck 1', 'deck 2', 42, 'constructed', 'first')
      await engine.createMatch('deck 1', 'deck 2', 43, 'constructed', 'second')

      expect(workers[0]!.commands.filter(({ type }) => type === 'initialize')).toHaveLength(1)

      const disposedStart = disposedEngine.createMatch('deck 1', 'deck 2', 44)
      await Promise.resolve()
      disposedEngine.dispose()
      resolveRelease(release)

      await disposedStart.then(
        () => {
          throw new Error('Expected disposed launch to fail')
        },
        (error: unknown) => expect(error).toHaveProperty('message', 'Browser engine disposed'),
      )
      expect(workers).toHaveLength(1)
    } finally {
      engine.dispose()
      disposedEngine.dispose()
    }
  })

  it('does not deliver a late old-match frame to the second match', async () => {
    const worker = new FakeWorker()
    const engine = engineWith(worker)
    const first = await engine.createMatch('deck 1', 'deck 2', 42)
    const firstSink = sink()
    first.source.start(firstSink.value)
    const bytes = await encodeMessage('MatchServiceToClientMessage', {})
    const second = await engine.createMatch('deck 3', 'deck 4', 43)
    const secondSink = sink()
    second.source.start(secondSink.value)
    const payload = btoa(String.fromCharCode(...bytes))
    worker.emit({ event: 'frame', data: { matchId: first.matchId, payload }, at: 0 })
    worker.emit({ event: 'closed', data: first.matchId, at: 0 })
    worker.emit({ event: 'frame', data: { matchId: second.matchId, payload }, at: 0 })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(firstSink.batches).toHaveLength(0)
    expect(firstSink.errors()).toBe(0)
    expect(secondSink.batches).toHaveLength(1)
    expect(second.source.isOpen).toBe(true)
    expect(() => first.source.start(firstSink.value)).toThrow('retired')
  })

  it('filters stale match errors and keeps command errors away from a healthy source', async () => {
    const worker = new FakeWorker()
    const events: BrowserEngineEvent[] = []
    const engine = new BrowserEngine(
      (event) => events.push(event),
      () => worker as unknown as Worker,
    )
    const first = await engine.createMatch('deck 1', 'deck 2', 42)
    first.source.start(sink().value)
    const second = await engine.createMatch('deck 3', 'deck 4', 43)
    const observer = sink()
    second.source.start(observer.value)

    worker.emit({
      event: 'match-error',
      data: JSON.stringify([first.matchId, 'old failure']),
      at: 0,
    })
    worker.emit({
      event: 'command-error',
      data: { type: 'metadata', message: 'metadata failed' },
      at: 1,
    })
    expect(observer.errors()).toBe(0)
    expect(events.filter((event) => event.event === 'error')).toHaveLength(0)
    expect(events.at(-1)).toEqual({
      event: 'command-error',
      data: { type: 'metadata', message: 'metadata failed' },
      at: 1,
    })

    worker.emit({
      event: 'match-error',
      data: JSON.stringify([second.matchId, 'active failure']),
      at: 2,
    })
    expect(observer.errors()).toBe(1)
    await wait(0)
    const failure = events.at(-1)?.data
    expect(failure).toBeInstanceOf(BrowserEngineFailure)
    expect((failure as BrowserEngineFailure).message).toBe('active failure')
    expect((failure as BrowserEngineFailure).diagnostic).toMatchObject({
      category: 'runtime',
      operation: 'match',
      kind: 'engine-error',
      lastStage: 'match-started',
    })
  })

  it('notifies the active source before an error callback disposes the engine', async () => {
    const worker = new FakeWorker()
    const observer = sink()
    const engine = new BrowserEngine(
      (event) => {
        if (event.event === 'error') {
          engine.dispose()
        }
      },
      () => worker as unknown as Worker,
    )
    const match = await engine.createMatch('deck 1', 'deck 2', 42)
    match.source.start(observer.value)

    worker.emit({
      event: 'match-error',
      data: JSON.stringify([match.matchId, 'active failure']),
      at: 0,
    })

    expect(observer.errors()).toBe(1)
    await wait(0)
    expect(engine.diagnostics().disposed).toBe(true)
  })

  it('delivers queued frames before closing a source', async () => {
    const order: string[] = []
    const source = new BrowserMatchSource({ send() {} }, 'match-1')
    source.start({
      onOpen() {},
      onBatch: () => order.push('frame'),
      onReset() {},
      onClose: () => order.push('close'),
      onError() {},
    })
    const bytes = await encodeMessage('MatchServiceToClientMessage', {})
    source.receiveFrame(btoa(String.fromCharCode(...bytes)))
    source.receiveClose()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(order).toEqual(['frame', 'close'])
    expect(source.isOpen).toBe(false)
    expect(() => source.start(sink().value)).toThrow('retired')
  })

  it('rejects pending and future RPCs when disposed', async () => {
    const worker = new FakeWorker()
    worker.respond = false
    const engine = engineWith(worker)
    const pending = engine.createMatch('deck 1', 'deck 2', 42)
    await Promise.resolve()

    engine.dispose()

    expect(worker.terminated).toBe(true)
    expect(pending).rejects.toThrow('disposed')
  })

  it('rejects worker failures and closes a failed generation before retrying', async () => {
    const worker = new FakeWorker()
    worker.failNextStart = true
    const engine = engineWith(worker)

    expect(engine.createMatch('deck 1', 'deck 2', 42)).rejects.toThrow('launch failed')
    const match = await engine.createMatch('deck 1', 'deck 2', 43)

    expect(match.matchId).toBe('match-1')
    expect(worker.commands.map((command) => command.type)).toEqual([
      'initialize',
      'start',
      'close',
      'start',
    ])
  })

  it('retries a failed close before starting another match', async () => {
    const worker = new FakeWorker()
    const engine = engineWith(worker)
    const first = await engine.createMatch('deck 1', 'deck 2', 42)
    first.source.start(sink().value)
    worker.failNextClose = true

    expect(engine.createMatch('deck 3', 'deck 4', 43)).rejects.toThrow('close failed')
    const match = await engine.createMatch('deck 3', 'deck 4', 43)

    expect(match.matchId).toBe('match-2')
    expect(worker.commands.map((command) => command.type)).toEqual([
      'initialize',
      'start',
      'close',
      'close',
      'start',
    ])
  })

  it('terminates the previous worker before a bounded replacement and ignores its late callbacks', async () => {
    const workers: FakeWorker[] = []
    const events: BrowserEngineEvent[] = []
    const engine = new BrowserEngine(
      (event) => events.push(event),
      () => {
        if (workers.length) {
          expect(workers.at(-1)!.terminated).toBe(true)
        }
        const worker = new FakeWorker()
        workers.push(worker)
        return worker as unknown as Worker
      },
      { maxMatchesPerWorker: 2 },
    )
    const first = await engine.createMatch('a', 'b', 42)
    first.source.start(sink().value)
    const oldCallback = workers[0]!.onmessage!
    await engine.createMatch('a', 'b', 43)
    const third = await engine.createMatch('c', 'd', 44)
    const latest = sink()
    third.source.start(latest.value)
    oldCallback({
      data: { event: 'error', data: 'old failure', at: 0 },
    } as MessageEvent<BrowserEngineEvent>)

    expect(workers).toHaveLength(2)
    expect(workers[1]!.commands.map((command) => command.type)).toEqual(['initialize', 'start'])
    expect(first.source.isRetired).toBe(true)
    expect(latest.errors()).toBe(0)
    expect(engine.diagnostics()).toMatchObject({ generation: 2, matches: 1, failed: false })
    expect(events.filter((event) => event.event === 'engine-recycled')).toHaveLength(1)
    engine.dispose()
  })

  it('retries initialization in a fresh worker after a download failure', async () => {
    const first = new FakeWorker()
    first.failNextInitialize = true
    const second = new FakeWorker()
    const workers = [first, second]
    const engine = new BrowserEngine(
      () => {},
      () => workers.shift() as unknown as Worker,
    )

    expect(engine.createMatch('a', 'b', 42)).rejects.toThrow('catalog unavailable')
    expect(first.terminated).toBe(true)
    await engine.createMatch('a', 'b', 42)
    expect(second.commands.map((command) => command.type)).toEqual(['initialize', 'start'])
    expect(engine.diagnostics().generation).toBe(2)
    engine.dispose()
  })

  it('times out an unresponsive worker and can start a fresh game', async () => {
    const first = new FakeWorker()
    first.respond = false
    const second = new FakeWorker()
    const workers = [first, second]
    const engine = new BrowserEngine(
      () => {},
      () => workers.shift() as unknown as Worker,
      { initializationTimeoutMs: 10 },
    )

    expect(engine.createMatch('a', 'b', 42)).rejects.toThrow('timed out')
    expect(first.terminated).toBe(true)
    expect(engine.diagnostics().failed).toBe(true)
    await engine.createMatch('a', 'b', 42)
    expect(engine.diagnostics().failed).toBe(false)
    engine.dispose()
  })

  it('attributes metadata timeouts to the catalog operation and last successful stage', async () => {
    const worker = new FakeWorker()
    const engine = new BrowserEngine(
      () => {},
      () => worker as unknown as Worker,
      { commandTimeoutMs: 5 },
    )
    await engine.createMatch('a', 'b', 42)
    worker.respond = false

    const failure = await engine.fetchCardMeta([1]).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(BrowserEngineFailure)
    expect((failure as BrowserEngineFailure).diagnostic).toMatchObject({
      category: 'catalog',
      operation: 'metadata',
      kind: 'timeout',
      lastStage: 'match-started',
      commandPhase: 'execution',
      queueDurationMs: 0,
      timerLatenessMs: expect.any(Number),
      heartbeatState: 'responsive',
    })
    engine.dispose()
  })

  it('attributes a queued metadata timeout to the active send command', async () => {
    const worker = new SerializedWorker()
    const events: BrowserEngineEvent[] = []
    const engine = new BrowserEngine(
      (event) => events.push(event),
      () => worker as unknown as Worker,
      { commandTimeoutMs: 50, heartbeatIntervalMs: 2, heartbeatTimeoutMs: 50 },
    )
    const match = await engine.createMatch('a', 'b', 42)
    match.source.start(sink().value)
    worker.blockSend = true

    match.source.send(new Uint8Array([1]))
    const metadata = engine.fetchCardMeta([1]).catch((error: unknown) => error)
    for (const id of [1, 2, 3, 4]) {
      await wait(20)
      await stateFrame(worker, match.matchId, id)
      await match.source.flush()
      expect(engine.diagnostics().failed).toBe(false)
      expect(worker.startedTypes).toEqual(['initialize', 'start', 'send'])
    }
    for (let attempt = 0; attempt < 20 && !worker.terminated; attempt++) {
      await wait(5)
    }

    const failure = await metadata
    expect(failure).toBeInstanceOf(BrowserEngineFailure)
    expect((failure as BrowserEngineFailure).diagnostic).toMatchObject({
      category: 'runtime',
      operation: 'send',
      kind: 'timeout',
      lastStage: 'match-started',
      commandPhase: 'execution',
      heartbeatState: 'responsive',
    })
    expect(worker.startedTypes).toEqual(['initialize', 'start', 'send'])
    expect(worker.heartbeats).toBeGreaterThan(0)
    expect(worker.terminated).toBe(true)
    engine.dispose()
  })

  it('keeps an advancing send alive beyond its deadline, then expires after progress stops', async () => {
    const worker = new FakeWorker()
    const engine = new BrowserEngine(
      () => {},
      () => worker as unknown as Worker,
      {
        commandTimeoutMs: 50,
      },
    )
    const match = await engine.createMatch('a', 'b', 42)
    match.source.start(sink().value)
    worker.respond = false
    const send = engine
      .sendAndWait(match.source, new Uint8Array([1]))
      .catch((error: unknown) => error)
    for (const id of [1, 2, 3, 4]) {
      await wait(20)
      await stateFrame(worker, match.matchId, id)
      await match.source.flush()
      expect(engine.diagnostics().failed).toBe(false)
    }
    const failure = await send
    expect((failure as BrowserEngineFailure).diagnostic).toMatchObject({
      operation: 'send',
      commandPhase: 'execution',
      kind: 'timeout',
    })
    engine.dispose()
  })

  it('does not extend sends for repeated, older or foreign game states', async () => {
    const worker = new FakeWorker()
    const engine = new BrowserEngine(
      () => {},
      () => worker as unknown as Worker,
      {
        commandTimeoutMs: 50,
      },
    )
    const match = await engine.createMatch('a', 'b', 42)
    match.source.start(sink().value)
    await stateFrame(worker, match.matchId, 10)
    await match.source.flush()
    worker.respond = false
    const send = engine
      .sendAndWait(match.source, new Uint8Array([1]))
      .catch((error: unknown) => error)
    const states = [
      [match.matchId, 10],
      [match.matchId, 9],
      ['foreign', 100],
    ] as const
    for (let i = 0; i < 6; i++) {
      const [matchId, id] = states[i % states.length]!
      await wait(10)
      await stateFrame(worker, matchId, id)
      await match.source.flush()
    }
    expect(engine.diagnostics().failed).toBe(true)
    const failure = await send
    expect((failure as BrowserEngineFailure).diagnostic).toMatchObject({
      operation: 'send',
      kind: 'timeout',
    })
    engine.dispose()
  })

  it('game state progress does not extend metadata execution or command dispatch', async () => {
    for (const emitCommandStart of [true, false]) {
      const worker = new FakeWorker()
      const engine = new BrowserEngine(
        () => {},
        () => worker as unknown as Worker,
        {
          commandTimeoutMs: 50,
        },
      )
      const match = await engine.createMatch('a', 'b', 42)
      match.source.start(sink().value)
      worker.respond = false
      worker.emitCommandStart = emitCommandStart
      const metadata = engine.fetchCardMeta([1]).catch((error: unknown) => error)
      for (const id of [1, 2, 3, 4, 5, 6]) {
        await wait(10)
        await stateFrame(worker, match.matchId, id)
        await match.source.flush()
      }
      expect(engine.diagnostics().failed).toBe(true)
      const failure = await metadata
      expect((failure as BrowserEngineFailure).diagnostic).toMatchObject({
        operation: 'metadata',
        kind: 'timeout',
        commandPhase: emitCommandStart ? 'execution' : 'dispatch',
      })
      engine.dispose()
    }
  })

  it('game state progress does not replace a missing worker heartbeat', async () => {
    const worker = new FakeWorker()
    const engine = new BrowserEngine(
      () => {},
      () => worker as unknown as Worker,
      {
        commandTimeoutMs: 100,
        heartbeatIntervalMs: 2,
        heartbeatTimeoutMs: 40,
      },
    )
    const match = await engine.createMatch('a', 'b', 42)
    match.source.start(sink().value)
    worker.respond = false
    worker.respondHeartbeat = false
    const send = engine
      .sendAndWait(match.source, new Uint8Array([1]))
      .catch((error: unknown) => error)
    for (const id of [1, 2, 3]) {
      await wait(10)
      await stateFrame(worker, match.matchId, id)
      await match.source.flush()
    }
    const failure = await send
    expect((failure as BrowserEngineFailure).diagnostic).toMatchObject({
      operation: 'heartbeat',
      kind: 'timeout',
    })
    engine.dispose()
  })

  it('distinguishes a command that never starts from an execution stall', async () => {
    const worker = new FakeWorker()
    const engine = new BrowserEngine(
      () => {},
      () => worker as unknown as Worker,
      { commandTimeoutMs: 5 },
    )
    await engine.createMatch('a', 'b', 42)
    worker.emitCommandStart = false
    worker.respond = false

    const failure = await engine.fetchCardMeta([1]).catch((error: unknown) => error)

    expect((failure as BrowserEngineFailure).diagnostic).toMatchObject({
      operation: 'metadata',
      kind: 'timeout',
      commandPhase: 'dispatch',
    })
    engine.dispose()
  })

  it('rearms a command deadline when the host timer fires late', async () => {
    const worker = new FakeWorker()
    const engine = new BrowserEngine(
      () => {},
      () => worker as unknown as Worker,
      { commandTimeoutMs: 10 },
    )
    const originalNow = Date.now
    let now = 0
    Date.now = () => now
    try {
      await engine.createMatch('a', 'b', 42)
      worker.respond = false
      const metadata = engine.fetchCardMeta([1])
      await Promise.resolve()
      now = 40_000
      await wait(15)

      expect(engine.diagnostics().failed).toBe(false)
      const command = worker.commands.at(-1)!
      worker.emit({ event: 'reply', data: { id: command.id, result: {} }, at: 0 })
      expect(metadata).resolves.toEqual(new Map())
    } finally {
      Date.now = originalNow
      engine.dispose()
    }
  })

  it('stops a failed worker, rejects outstanding calls and retires its match', async () => {
    const first = new FakeWorker()
    const second = new FakeWorker()
    const workers = [first, second]
    const engine = new BrowserEngine(
      () => {},
      () => workers.shift() as unknown as Worker,
    )
    const match = await engine.createMatch('a', 'b', 42)
    const observer = sink()
    match.source.start(observer.value)
    first.respond = false
    const pending = engine.fetchCardMeta([1])
    first.onerror!({ message: 'worker crashed' } as ErrorEvent)

    expect(pending).rejects.toThrow('worker crashed')
    expect(first.terminated).toBe(true)
    expect(observer.errors()).toBe(1)
    expect(match.source.isRetired).toBe(true)
    await engine.createMatch('a', 'b', 43)
    expect(engine.diagnostics().generation).toBe(2)
    engine.dispose()
  })

  it('keeps a responsive active worker healthy while heartbeat pings run', async () => {
    const worker = new FakeWorker()
    const engine = new BrowserEngine(
      () => {},
      () => worker as unknown as Worker,
      { heartbeatIntervalMs: 2, heartbeatTimeoutMs: 10 },
    )
    const match = await engine.createMatch('a', 'b', 42)

    await wait(15)

    expect(worker.heartbeats).toBeGreaterThan(0)
    expect(engine.diagnostics()).toMatchObject({ failed: false, disposed: false })
    expect(match.source.isRetired).toBe(false)
    worker.emit({ event: 'closed', data: match.matchId, at: 0 })
    const idleHeartbeats = worker.heartbeats
    await wait(15)
    expect(worker.heartbeats).toBe(idleHeartbeats)
    expect(engine.diagnostics()).toMatchObject({ failed: false, disposed: false })
    engine.dispose()
  })

  it('retires a worker that misses heartbeat and retries in a fresh generation', async () => {
    const first = new FakeWorker()
    first.respondHeartbeat = false
    const second = new FakeWorker()
    const workers = [first, second]
    const events: BrowserEngineEvent[] = []
    const engine = new BrowserEngine(
      (event) => events.push(event),
      () => workers.shift() as unknown as Worker,
      { heartbeatIntervalMs: 2, heartbeatTimeoutMs: 5 },
    )
    const firstMatch = await engine.createMatch('a', 'b', 42)
    const observer = sink()
    firstMatch.source.start(observer.value)

    for (let attempt = 0; attempt < 50 && !first.terminated; attempt++) {
      await wait(10)
    }

    expect(first.terminated).toBe(true)
    expect(observer.errors()).toBe(1)
    expect(events.at(-1)).toMatchObject({
      event: 'error',
      data: expect.objectContaining({
        message: expect.stringContaining('heartbeat timed out'),
        diagnostic: expect.objectContaining({ operation: 'heartbeat', kind: 'timeout' }),
      }),
    })
    const secondMatch = await engine.createMatch('a', 'b', 43)
    expect(secondMatch.matchId).toBe('match-1')
    expect(engine.diagnostics()).toMatchObject({ generation: 2, matches: 1, failed: false })
    engine.dispose()
  })

  it('clears heartbeat timers on dispose and ignores stale worker heartbeat events', async () => {
    const worker = new FakeWorker()
    const events: BrowserEngineEvent[] = []
    const engine = new BrowserEngine(
      (event) => events.push(event),
      () => worker as unknown as Worker,
      { heartbeatIntervalMs: 2, heartbeatTimeoutMs: 5 },
    )
    await engine.createMatch('a', 'b', 42)
    const oldCallback = worker.onmessage!
    const heartbeatCount = worker.heartbeats

    engine.dispose()
    oldCallback({
      data: { event: 'heartbeat', data: { nonce: 1 }, at: 0 },
    } as MessageEvent<BrowserEngineEvent>)
    await wait(15)

    expect(worker.terminated).toBe(true)
    expect(worker.heartbeats).toBe(heartbeatCount)
    expect(events.filter((event) => event.event === 'error')).toHaveLength(0)
  })

  it('cleans up the heartbeat interval when posting the first ping fails', async () => {
    const worker = new FakeWorker()
    worker.throwHeartbeat = true
    const events: BrowserEngineEvent[] = []
    const engine = new BrowserEngine(
      (event) => events.push(event),
      () => worker as unknown as Worker,
      { heartbeatIntervalMs: 2, heartbeatTimeoutMs: 5 },
    )

    await engine.createMatch('a', 'b', 42)
    await wait(15)

    expect(worker.terminated).toBe(true)
    expect(worker.heartbeats).toBe(1)
    expect(events.at(-1)).toMatchObject({
      event: 'error',
      data: expect.objectContaining({
        message: 'heartbeat post failed',
        diagnostic: expect.objectContaining({ operation: 'heartbeat', kind: 'post-message' }),
      }),
    })
    expect(engine.diagnostics().failed).toBe(true)
    engine.dispose()
  })

  it('replaces a heartbeat whose host deadline fired late', async () => {
    const worker = new FakeWorker()
    worker.respondHeartbeat = false
    worker.heartbeatResponseAfter = 2
    const engine = new BrowserEngine(
      () => {},
      () => worker as unknown as Worker,
      { heartbeatIntervalMs: 2, heartbeatTimeoutMs: 5 },
    )
    const originalNow = Date.now
    let now = 0
    Date.now = () => now
    try {
      await engine.createMatch('a', 'b', 42)
      now = 8
      await wait(10)

      expect(worker.heartbeats).toBeGreaterThan(1)
      expect(engine.diagnostics().failed).toBe(false)
      await wait(2)
      expect(engine.diagnostics().failed).toBe(false)
    } finally {
      Date.now = originalNow
      engine.dispose()
    }
  })
  it('retains correlated payload-free history and inspects a blocked send outside its queue', async () => {
    const worker = new SerializedWorker()
    const events: BrowserEngineEvent[] = []
    const engine = new BrowserEngine(
      (e) => events.push(e),
      () => worker as unknown as Worker,
      { commandTimeoutMs: 10 },
    )
    const match = await engine.createMatch('private deck', 'other deck', 42)
    match.source.start(sink().value)
    const payload = await encodeMessage('ClientToGREMessage', {
      type: 15,
      gameStateId: 91,
      respId: 99,
    })
    const input = await encodeMessage('ClientToMatchServiceMessage', { payload })
    worker.blockSend = true
    match.source.send(input)
    for (let i = 0; i < 40 && !worker.terminated; i++) {
      await wait(5)
    }
    const diagnostic = (events.find((e) => e.event === 'error')!.data as BrowserEngineFailure)
      .diagnostic
    expect(diagnostic.commandId).toBeGreaterThan(0)
    expect(diagnostic.snapshot).toMatchObject({
      runtime: 'available',
      heapUsed: 123,
      receivePhase: 'CoordinatorWait',
      commandId: diagnostic.commandId,
      commandPhase: 'execution',
      failureOperation: 'send',
      failureKind: 'timeout',
    })
    expect(diagnostic.snapshot!.commands).toContainEqual(
      expect.objectContaining({
        id: diagnostic.commandId,
        event: 'enqueue',
        operation: 'send',
        type: 15,
        gameStateId: 91,
        respId: 99,
      }),
    )
    expect(JSON.stringify(diagnostic.snapshot)).not.toContain('private deck')
    expect(events.some((e) => e.event === 'failure-diagnostic')).toBe(false)
    engine.dispose()
  })

  it('collects runtime diagnostics before retiring a host-reported terminal failure', async () => {
    const worker = new FakeWorker()
    const events: BrowserEngineEvent[] = []
    const engine = new BrowserEngine(
      (event) => events.push(event),
      () => worker as unknown as Worker,
    )
    await engine.createMatch('a', 'b', 42)
    worker.emit({
      event: 'worker-online',
      data: { runtimeReady: true, runtimeVersion: '4.3' },
      at: 0,
    })
    const capture = engine.terminateWithFailure('progress stopped', {
      category: 'progress',
      operation: 'progress',
      kind: 'timeout',
      lastStage: 'match-started',
    })
    expect(worker.terminated).toBe(false)
    await capture
    const failure = events.find((event) => event.event === 'error')!.data as BrowserEngineFailure
    expect(failure.diagnostic).toMatchObject({
      operation: 'progress',
      snapshot: { runtime: 'available', runtimeVersion: '4.3', receivePhase: 'CoordinatorWait' },
    })
    expect(worker.terminated).toBe(true)
    engine.dispose()
  })

  it('bounds failure collection when the worker cannot answer and permits a fresh retry', async () => {
    const first = new FakeWorker()
    first.respondDiagnostic = false
    const next = new FakeWorker()
    const workers = [first, next]
    const events: BrowserEngineEvent[] = []
    const engine = new BrowserEngine(
      (e) => events.push(e),
      () => workers.shift() as unknown as Worker,
      { commandTimeoutMs: 5, diagnosticTimeoutMs: 10 },
    )
    await engine.createMatch('a', 'b', 42)
    expect(first.commands.some((c) => c.type === 'failure-diagnostic')).toBe(false)
    first.respond = false
    const error = await engine.fetchCardMeta([1]).catch((e) => e)
    expect(error.diagnostic.snapshot.runtime).toBe('timed-out')
    expect(first.terminated).toBe(true)
    await engine.createMatch('a', 'b', 43)
    expect(next.terminated).toBe(false)
    engine.dispose()
  })
})

it('active input correlation survives a saturated metadata command buffer', async () => {
  const history = new BrowserDiagnostics()
  history.command(1, 'send', 'enqueue')
  const payload = await encodeMessage('ClientToGREMessage', {
    type: 15,
    gameStateId: 91,
    respId: 99,
  })
  await history.input(1, await encodeMessage('ClientToMatchServiceMessage', { payload }))
  history.command(1, 'send', 'start')
  for (let id = 2; id < 100; id++) {
    history.command(id, 'metadata', 'enqueue')
  }
  const snapshot = history.snapshot()
  expect(snapshot.commands).toHaveLength(32)
  expect(snapshot.commands[0]).toMatchObject({ id: 1, type: 15, gameStateId: 91, respId: 99 })
  history.output([{ type: 12, gameStateId: 179, msgId: 188 }])
  expect(history.snapshot().lastOutput).toMatchObject({ type: 12, gameStateId: 179, msgId: 188 })
})

it('keeps initialization clocks separate, rejects stale attribution and resets cached marks', () => {
  const history = new BrowserDiagnostics()
  history.initialize(7, 3, 'test-release', 1)
  history.command(7, 'initialize', 'start')
  const mark = (stage: string, workerElapsedMs: number, commandId = 7, generation = 3) =>
    history.initializeMark(stage, { commandId, generation, workerElapsedMs })
  mark('initializing', 0, 6)
  mark('initializing', 0, 7, 2)
  expect(history.snapshot(undefined, true).initialization!.marks).toHaveLength(0)
  mark('initializing', 0)
  mark('jars-ready', 90000)
  mark('jars-ready', 90001)
  mark('library-return', 80000)
  mark('library-return', 90001)
  mark('facade-ready', 90002)
  const snapshot = history.snapshot({ runtime: 'timed-out' }, true)
  expect(snapshot.initialization!.marks.map((m) => m.stage)).toEqual([
    'initializing',
    'jars-ready',
    'library-return',
    'facade-ready',
  ])
  expect(snapshot.initialization!.marks[1].hostElapsedMs).toBeLessThan(90000)
  expect(snapshot.initialization!.marks[1].workerElapsedMs).toBe(90000)
  expect(history.snapshot().initialization).toBeUndefined()
  expect(
    history.snapshot(
      { initializationResources: { commandId: 6, generation: 3, started: 999 } },
      true,
    ).initialization!.resources,
  ).toBeUndefined()
  history.reset()
  expect(history.snapshot(undefined, true).initialization).toBeUndefined()
  history.initialize(8, 4, 'next-release', 180000)
  mark('initializing', 0)
  expect(history.snapshot(undefined, true).initialization!.marks).toHaveLength(0)
  history.command(8, 'initialize', 'start')
  history.initializeMark('initializing', { commandId: 8, generation: 4, workerElapsedMs: 0 })
  history.command(8, 'initialize', 'reply')
  expect(history.snapshot(undefined, true).initialization).toBeUndefined()
})

it('bounds and sanitizes initialization resources through repeated reporting sanitization', () => {
  const snapshot = sanitizeBrowserFailureSnapshot({
    runtime: 'unavailable',
    initialization: {
      commandId: 7,
      generation: 3,
      releaseId: 'test-release',
      budgetMs: 180000,
      marks: [],
      resources: {
        started: 5,
        completed: 4,
        firstFailure: {
          path: '/lib/test.jar?token=secret#private',
          kind: 'http',
          status: 503,
          workerElapsedMs: 1,
        },
        completedHosted: Array.from({ length: 10 }, () => ({
          path: 'https://user:secret@cjrtnc.leaningtech.com/4.3/runtime.wasm?token=private#secret',
          status: 0,
          workerStartMs: 100,
          durationMs: 5,
        })),
        arbitrary: 'private payload',
      },
    },
  })!
  expect(snapshot.initialization!.resources!.completedHosted).toHaveLength(8)
  expect(snapshot.initialization!.resources!.truncated).toBe(true)
  expect(snapshot.initialization!.resources!.firstFailure).toMatchObject({
    path: '/lib/test.jar',
    kind: 'http',
    status: 503,
  })
  expect(snapshot.initialization!.resources!.completedHosted[0]).toMatchObject({
    path: '/4.3/runtime.wasm',
    status: undefined,
  })
  expect(JSON.stringify(snapshot)).not.toMatch(/secret|private|user|token|arbitrary/)
  expect(sanitizeBrowserFailureSnapshot(snapshot)).toEqual(snapshot)
  expect(JSON.stringify(snapshot).length).toBeLessThan(5000)
  const invalid = sanitizeBrowserFailureSnapshot({
    initialization: {
      ...snapshot.initialization,
      resources: {
        completedHosted: [
          { path: 'https://evil.invalid/4.3/x', workerStartMs: 1, durationMs: 1 },
          { path: '/%FF', workerStartMs: 1, durationMs: 1 },
        ],
      },
    },
  })!
  expect(invalid.initialization!.resources!.completedHosted).toEqual([])
})

for (const libraryReturned of [false, true]) {
  it(`falls back to cached initialization marks ${libraryReturned ? 'after' : 'before'} library return with the unchanged one-second diagnostic wait`, async () => {
    const worker = new FakeWorker()
    worker.respond = false
    worker.respondDiagnostic = false
    const events: BrowserEngineEvent[] = []
    const engine = new BrowserEngine(
      (e) => events.push(e),
      () => worker as unknown as Worker,
      { initializationTimeoutMs: 20 },
    )
    const start = engine
      .createMatch('private deck', 'b', 42)
      .catch((e) => e as BrowserEngineFailure)
    await wait(5)
    const command = worker.commands.find((c) => c.type === 'initialize')!
    for (const [stage, elapsed] of [
      ['initializing', 0],
      ['jars-ready', 10],
      ['library-return', 11],
    ] as const) {
      if (stage === 'library-return' && !libraryReturned) {
        continue
      }
      worker.emit({
        event: stage,
        data: {
          commandId: command.id,
          generation: command['generation'],
          workerElapsedMs: elapsed,
        },
        at: 999999,
      })
    }
    await wait(50)
    expect(worker.terminated).toBe(false)
    expect(events.filter((e) => e.event === 'error')).toHaveLength(0)
    const error = (await start) as BrowserEngineFailure
    expect(error.diagnostic.snapshot).toMatchObject({
      runtime: 'timed-out',
      initialization: {
        commandId: command.id,
        generation: 1,
        budgetMs: 20,
        nominalBudgetRemainingMs: 0,
      },
    })
    expect(error.diagnostic.snapshot!.initialization!.marks.map((m) => m.stage)).toEqual([
      'initializing',
      'jars-ready',
      ...(libraryReturned ? ['library-return'] : []),
    ])
    expect(error.diagnostic.snapshot!.initialization!.hostElapsedMs).toBeGreaterThanOrEqual(1000)
    expect(error.diagnostic.snapshot!.initialization!.resources).toBeUndefined()
    expect(events.filter((e) => e.event === 'error')).toHaveLength(1)
    expect(worker.commands.filter((c) => c.type === 'initialize')).toHaveLength(1)
    expect(worker.diagnosticRequests).toBe(1)
    expect(worker.terminated).toBe(true)
    engine.dispose()
  })
}
