import { httpCardMeta } from '@shared/api/http-test-fixtures'
import { afterEach, expect, it, spyOn } from 'bun:test'
import { GreSessionStore } from './gre-session'
import { BrowserEngine } from './browser-engine'
import type { BrowserEngineEvent } from './browser-match-source'
import { greStore } from './gre-store'
import type { GreFrameSink, GreFrameSource } from './gre-frame-source'
import { fullGameState } from './gre-test-frames'
import { ZONE_HAND } from '@engine/state/gre-state'
import { parseGreCardMeta } from './gre-card-meta'
import * as router from '@app/router'
import * as analytics from '@shared/analytics'
import * as reporting from '@shared/reporting'
import { BrowserReplayCollector } from '@engine/replay/browser-replay-collector'

afterEach(() => {
  greStore.clearSession()
})

it('keeps public browser challenges off the replay upload path', async () => {
  const upload = spyOn(greStore, 'uploadBrowserReplay')
  const session = new GreSessionStore({
    execution: 'browser',
    gameType: 'puzzle',
    challengeId: 'bolt-at-three-v1',
  })
  try {
    expect(await session.uploadBrowserReplay('feedback')).toBe(false)
    expect(upload).not.toHaveBeenCalled()
  } finally {
    upload.mockRestore()
  }
})

it('replaces browser metadata and state when starting another browser game', async () => {
  let sink: GreFrameSink | null = null
  const source: GreFrameSource = {
    isOpen: true,
    canSend: false,
    start: (next) => {
      sink = next
    },
    stop: () => {},
    send: () => {},
  }
  const frame = fullGameState(1, {
    zones: [{ zoneId: 31, type: ZONE_HAND, ownerSeatId: 1, objectInstanceIds: [100] }],
    gameObjects: [{ instanceId: 100, grpId: 42, ownerSeatId: 1, controllerSeatId: 1 }],
  })
  const previousFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input))
    return Response.json({
      42: httpCardMeta(42, { name: 'Forest', imageUrl: 'https://cards.scryfall.io/forest.jpg' }),
    })
  }) as typeof fetch
  const session = new GreSessionStore({ execution: 'browser', gameType: 'constructed' })
  try {
    greStore.connectSource(source, {
      execution: 'browser',
      matchId: 'browser-old',
      fetchCardMeta: async () => parseGreCardMeta({ 42: { name: 'Browser card' } }),
    })
    sink!.onBatch({ byteLength: 0, messages: [frame] })
    await Bun.sleep(70)
    expect(greStore.hand[0]?.name).toBe('Browser card')
    session.start({ execution: 'browser', gameType: 'constructed' }, false)
    expect(greStore.hand).toHaveLength(0)
    greStore.attachSource(source)
    sink!.onBatch({ byteLength: 0, messages: [frame] })
    await Bun.sleep(70)
    expect(
      requests.some((url) => url.endsWith('/api/public/cards/by-grpids?ids=42&abilities=true')),
    ).toBe(true)
    expect(greStore.hand[0]?.name).toBe('Forest')
  } finally {
    session.clear()
    globalThis.fetch = previousFetch
  }
})

it('owns browser launches, retries, and disposal without server match requests', async () => {
  class SessionWorker {
    onmessage: ((event: MessageEvent<BrowserEngineEvent>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    onmessageerror: (() => void) | null = null
    commands: Array<{ type: string; id?: number; [key: string]: unknown }> = []
    terminated = false

    postMessage(command: { type: string; id?: number; [key: string]: unknown }): void {
      if (command.type === 'heartbeat') {
        queueMicrotask(() =>
          this.onmessage?.({
            data: { event: 'heartbeat', data: { nonce: command['nonce'] }, at: 0 },
          } as MessageEvent<BrowserEngineEvent>),
        )
        return
      }
      this.commands.push(command)
      if (command.id == null) {
        return
      }
      if (command.type === 'initialize') {
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              event: 'jars-progress',
              data: { loadedBytes: 2_097_152, totalBytes: 31_457_280 },
              at: 0,
            },
          } as MessageEvent<BrowserEngineEvent>),
        )
      }
      const result = command.type === 'start' ? { matchId: command['matchId'] } : undefined
      queueMicrotask(() =>
        this.onmessage?.({
          data: { event: 'reply', data: { id: command.id, result }, at: 0 },
        } as MessageEvent<BrowserEngineEvent>),
      )
    }

    terminate(): void {
      this.terminated = true
    }
  }

  const previousFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requests.push(String(input))
    throw new Error('Unexpected server request')
  }) as unknown as typeof fetch
  const navigate = spyOn(router, 'reactNavigate').mockImplementation(() => {})
  const worker = new SessionWorker()
  const session = new GreSessionStore(
    null,
    (onEvent) =>
      new BrowserEngine(onEvent, () => worker as unknown as Worker, {
        heartbeatIntervalMs: 60_000,
      }),
  )
  const statuses: string[] = []
  const unsubscribe = session.subscribe(() => statuses.push(session.snapshot().browserStatus))

  try {
    session.startBrowser({
      gameType: 'commander',
      seat1Deck: '99 Island\nCommander\n1 Empress Galina',
      seat2Deck: '99 Mountain\nCommander\n1 Zo-Zu the Punisher',
      seed: 42,
    })
    const first = session.config!
    await session.connectBrowser(first)
    expect(statuses).toContain('Loading game rules · 2 of 30 MB')

    expect(greStore.currentMatchId).toBe(first.matchId!)
    expect(greStore.currentGameType).toBe('commander')
    expect(worker.commands.find((command) => command.type === 'start')).toMatchObject({
      matchId: first.matchId,
      gameType: 'commander',
      seed: 42,
    })

    expect(await session.playAgain()).toBe(true)
    const second = session.config!
    expect(second.attemptId).not.toBe(first.attemptId)
    expect(second.matchId).not.toBe(first.matchId)
    expect(second.seed).not.toBe(first.seed)
    await session.connectBrowser(second)
    expect(worker.commands.map(({ type }) => type).filter((type) => type !== 'send')).toEqual([
      'initialize',
      'start',
      'close',
      'start',
    ])

    const navigationCount = navigate.mock.calls.length
    session.startBrowser(
      {
        gameType: 'puzzle',
        challengeId: 'bolt-at-three-v1',
        puzzleText: '[metadata]\nGoal:Win',
        seed: 42,
      },
      false,
    )
    await session.connectBrowser(session.config!)
    expect(navigate).toHaveBeenCalledTimes(navigationCount)
    expect(worker.commands.filter((command) => command.type === 'start').at(-1)).toMatchObject({
      type: 'start',
      gameType: 'puzzle',
      puzzleId: 'bolt-at-three-v1',
      puzzleText: '[metadata]\nGoal:Win',
    })
    expect(await session.playAgain()).toBe(true)
    await session.connectBrowser(session.config!)
    expect(worker.commands.filter((command) => command.type === 'initialize')).toHaveLength(1)
    expect(worker.commands.filter((command) => command.type === 'start').at(-1)).toMatchObject({
      type: 'start',
      gameType: 'puzzle',
      puzzleId: 'bolt-at-three-v1',
    })

    expect(await session.leave()).toBe(true)
    expect(worker.terminated).toBe(true)
    expect(
      requests.every((url) => url.includes('/browser-replays/') && url.endsWith('/chunks')),
    ).toBe(true)
  } finally {
    unsubscribe()
    session.clear()
    globalThis.fetch = previousFetch
    navigate.mockRestore()
  }
})

it('routes native start rejection through browser failure recovery', async () => {
  class RejectingWorker {
    onmessage: ((event: MessageEvent<BrowserEngineEvent>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    onmessageerror: (() => void) | null = null
    terminated = false

    postMessage(command: { type: string; id?: number; nonce?: number }): void {
      if (command.type === 'failure-diagnostic') {
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              event: 'failure-diagnostic',
              data: { runtime: 'available', heapUsed: 123 },
              at: 0,
            },
          } as MessageEvent<BrowserEngineEvent>),
        )
      } else if (command.type === 'heartbeat') {
        queueMicrotask(() =>
          this.onmessage?.({
            data: { event: 'heartbeat', data: { nonce: command.nonce }, at: 0 },
          } as MessageEvent<BrowserEngineEvent>),
        )
      } else if (command.id != null) {
        queueMicrotask(() =>
          this.onmessage?.({
            data: {
              event: 'reply',
              data: {
                id: command.id,
                ...(command.type === 'start' ? { error: 'Native start rejected' } : {}),
              },
              at: 0,
            },
          } as MessageEvent<BrowserEngineEvent>),
        )
      }
    }

    terminate(): void {
      this.terminated = true
    }
  }

  const navigate = spyOn(router, 'reactNavigate').mockImplementation(() => {})
  const retained = spyOn(greStore, 'retainBrowserFailure')
  const worker = new RejectingWorker()
  const session = new GreSessionStore(
    null,
    (onEvent) => new BrowserEngine(onEvent, () => worker as unknown as Worker),
  )

  try {
    session.startBrowser({
      gameType: 'constructed',
      seat1Deck: '60 Forest',
      seat2Deck: '60 Mountain',
      seed: 42,
    })
    const failure = await session.connectBrowser(session.config!).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('Native start rejected')
    expect(session.snapshot().browserPhase).toBe('failed')
    expect(session.snapshot().browserError).toBe('Native start rejected')
    expect(worker.terminated).toBe(true)
    expect(retained).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: 'available', heapUsed: 123, failureOperation: 'start' }),
    )
  } finally {
    session.clear()
    retained.mockRestore()
    navigate.mockRestore()
  }
})

it('retires streaming before failure upload when the engine is already disposed', async () => {
  const navigate = spyOn(router, 'reactNavigate').mockImplementation(() => {})
  const session = new GreSessionStore(null)
  const delivery: string[] = []
  let activeHealth = true
  const health = spyOn(greStore, 'reportingContext').mockImplementation(() =>
    activeHealth
      ? {
          match_id: 'retired-match',
          execution: 'browser',
          replay_state: 'failed',
          replay_ack_seq: 7,
          replay_failure: 'http',
          replay_http_status: 503,
        }
      : undefined,
  )
  const reported = spyOn(reporting, 'reportBrowserFailure').mockImplementation(() => {})
  const disconnect = spyOn(greStore, 'disconnect').mockImplementation(() => {
    delivery.push('disconnect')
    activeHealth = false
  })
  const upload = spyOn(greStore, 'uploadBrowserReplay').mockImplementation(async (reason) => {
    delivery.push(reason)
    return true
  })

  try {
    session.startBrowser({
      gameType: 'constructed',
      seat1Deck: '60 Forest',
      seat2Deck: '60 Mountain',
      seed: 42,
    })
    delivery.length = 0
    activeHealth = true
    const engine = new BrowserEngine(() => {})
    engine.dispose()
    const retired = session as unknown as {
      browserEngine: BrowserEngine
      failBrowser(error: Error): Promise<void>
    }
    retired.browserEngine = engine
    await retired.failBrowser(new Error('Recovery timed out'))
    expect(session.snapshot().browserPhase).toBe('failed')
    expect(session.snapshot().browserError).toBe('Recovery timed out')
    expect(delivery).toEqual(['disconnect', 'worker'])
    expect(reported.mock.calls[0]?.[3]).toMatchObject({
      replay_state: 'failed',
      replay_ack_seq: 7,
      replay_failure: 'http',
      replay_http_status: 503,
    })
    expect(greStore.reportingContext()).toBeUndefined()
  } finally {
    reported.mockRestore()
    health.mockRestore()
    disconnect.mockRestore()
    upload.mockRestore()
    session.clear()
    navigate.mockRestore()
  }
})

it('preserves the recovery timeout reason and diagnostic after abort retires the engine', async () => {
  const navigate = spyOn(router, 'reactNavigate').mockImplementation(() => {})
  const lifecycle = spyOn(analytics, 'trackBrowserLifecycle')
  let disposed = false
  let rejectLaunch: (error: Error) => void = () => {}
  const engine = {
    createMatch: () =>
      new Promise((_resolve, reject) => {
        rejectLaunch = reject
      }),
    dispose: () => {
      disposed = true
      rejectLaunch(new Error('Browser engine disposed'))
    },
    diagnostics: () => ({ failed: false, disposed }),
  } as unknown as BrowserEngine
  const session = new GreSessionStore(null, () => engine)
  try {
    session.startBrowser({
      gameType: 'constructed',
      seat1Deck: '60 Forest',
      seat2Deck: '60 Mountain',
      seed: 42,
    })
    const pending = session as unknown as {
      browserPhase: string
      browserRecovery: ReturnType<BrowserReplayCollector['snapshot']>
      browserRecoveryController: AbortController
    }
    pending.browserPhase = 'failed'
    pending.browserRecovery = new BrowserReplayCollector(session.config!).snapshot('failure')
    const recovery = session.recoverBrowser()
    pending.browserRecoveryController.abort(new Error('Recovery took too long.'))
    expect(await recovery).toBe(false)
    expect(session.snapshot()).toMatchObject({
      browserPhase: 'failed',
      browserError: 'Recovery took too long.',
    })
    expect(lifecycle).toHaveBeenCalledWith(
      'failed',
      expect.anything(),
      expect.objectContaining({
        reason: 'runtime',
        operation: 'match',
        kind: 'timeout',
      }),
    )
  } finally {
    session.clear()
    lifecycle.mockRestore()
    navigate.mockRestore()
  }
})

it('routes synchronous worker construction failure through browser failure recovery', async () => {
  const navigate = spyOn(router, 'reactNavigate').mockImplementation(() => {})
  const session = new GreSessionStore(null, () => {
    throw new Error('Worker construction failed')
  })

  try {
    session.startBrowser({
      gameType: 'constructed',
      seat1Deck: '60 Forest',
      seat2Deck: '60 Mountain',
      seed: 42,
    })

    expect(session.connectBrowser(session.config!)).rejects.toThrow('Worker construction failed')
    expect(session.snapshot()).toMatchObject({
      browserPhase: 'failed',
      browserError: 'Worker construction failed',
    })
  } finally {
    session.clear()
    navigate.mockRestore()
  }
})

it('cancels a pending browser launch and ignores its late reply', async () => {
  class PendingWorker {
    onmessage: ((event: MessageEvent<BrowserEngineEvent>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    onmessageerror: (() => void) | null = null
    startId: number | null = null
    terminated = false

    postMessage(command: { type: string; id?: number }): void {
      if (command.type === 'initialize' && command.id != null) {
        queueMicrotask(() => {
          this.onmessage?.({
            data: { event: 'release-ready', data: { releaseId: 'release-1' }, at: 0 },
          } as MessageEvent<BrowserEngineEvent>)
          this.onmessage?.({
            data: { event: 'reply', data: { id: command.id }, at: 0 },
          } as MessageEvent<BrowserEngineEvent>)
        })
      } else if (command.type === 'start' && command.id != null) {
        this.startId = command.id
      }
    }

    terminate(): void {
      this.terminated = true
    }
  }

  const worker = new PendingWorker()
  const attachSource = spyOn(greStore, 'attachSource')
  const navigate = spyOn(router, 'reactNavigate').mockImplementation(() => {})
  const session = new GreSessionStore(
    null,
    (onEvent) =>
      new BrowserEngine(onEvent, () => worker as unknown as Worker, {
        heartbeatIntervalMs: 60_000,
      }),
  )
  const controller = new AbortController()

  try {
    session.startBrowser({
      gameType: 'constructed',
      seat1Deck: '60 Forest',
      seat2Deck: '60 Mountain',
      seed: 42,
    })
    const config = session.config!
    const launch = session.connectBrowser(config, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(session.config).toBe(config)
    expect(worker.startId).not.toBeNull()
    const lateHandler = worker.onmessage

    controller.abort()
    expect(launch).rejects.toMatchObject({ name: 'Error' })
    expect(worker.terminated).toBe(true)
    expect(session.snapshot().browserPhase).toBe('lost')

    lateHandler?.({
      data: {
        event: 'reply',
        data: { id: worker.startId, result: { matchId: session.config!.matchId } },
        at: 0,
      },
    } as MessageEvent<BrowserEngineEvent>)
    expect(attachSource).not.toHaveBeenCalled()
    expect(greStore.currentMatchId).toBe('')
  } finally {
    session.clear()
    attachSource.mockRestore()
    navigate.mockRestore()
  }
})

it('records cancellation while browser startup is still pending', async () => {
  const events: Array<{ name: string; data?: Record<string, unknown> }> = []
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: { getItem: () => null },
      umami: {
        identify: () => undefined,
        track: (name: string, data?: Record<string, unknown>) => events.push({ name, data }),
      },
    },
  })
  const navigate = spyOn(router, 'reactNavigate').mockImplementation(() => {})
  let rejectLaunch!: (reason: unknown) => void
  const pending = new Promise<never>((_resolve, reject) => {
    rejectLaunch = reject
  })
  const engine = {
    createMatch: () => pending,
    dispose: () => rejectLaunch(new DOMException('Browser launch aborted', 'AbortError')),
  } as unknown as BrowserEngine
  const session = new GreSessionStore(null, () => engine)
  const controller = new AbortController()

  try {
    session.startBrowser({
      gameType: 'constructed',
      seat1Deck: '60 Forest',
      seat2Deck: '60 Mountain',
      seed: 42,
    })
    const launch = session.connectBrowser(session.config!, controller.signal)
    controller.abort()

    expect(launch).rejects.toMatchObject({ name: 'AbortError' })
    expect(
      events
        .filter(({ name }) => name === 'browser-lifecycle')
        .map(({ data }) => ({ stage: data?.['stage'], reason: data?.['reason'] })),
    ).toEqual([
      { stage: 'attempt', reason: undefined },
      { stage: 'cancelled', reason: 'route-unmount' },
    ])
  } finally {
    session.clear()
    navigate.mockRestore()
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
})

it('restores a refreshed browser match as lost instead of starting it again', () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: () =>
        JSON.stringify({
          execution: 'browser',
          attemptId: 'attempt-before-refresh',
          matchId: 'browser-before-refresh',
          gameType: 'constructed',
          seat1Deck: '60 Forest',
          seat2Deck: '60 Mountain',
          seed: 42,
        }),
    },
  })
  try {
    const restored = new GreSessionStore()

    expect(restored.snapshot()).toMatchObject({
      browserPhase: 'lost',
      config: { execution: 'browser', matchId: 'browser-before-refresh' },
    })
  } finally {
    if (previousStorage) {
      Object.defineProperty(globalThis, 'sessionStorage', previousStorage)
    } else {
      Reflect.deleteProperty(globalThis, 'sessionStorage')
    }
  }
})

it('course startup and refresh retry locally with the same receipt, while completed play returns to the course', async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  })
  const navigate = spyOn(router, 'reactNavigate').mockImplementation(() => {})
  try {
    for (const failure of ['startup', 'refresh']) {
      const session = new GreSessionStore(null, () => {
        throw new Error('Worker unavailable')
      })
      session.startBrowser(
        {
          gameType: 'draft',
          coursePlayId: 'pending-receipt',
          seat1Deck: '40 Mountain',
          seat2Deck: '40 Forest',
          returnPath: '/play/limited',
          seed: 42,
        },
        false,
      )
      const first = session.config!
      if (failure === 'startup') {
        expect(await session.connectBrowser(first).catch((error: unknown) => error)).toMatchObject({
          message: 'Worker unavailable',
        })
        expect(session.snapshot().browserPhase).toBe('failed')
      } else {
        session.reload()
        expect(session.snapshot().browserPhase).toBe('lost')
      }
      expect(await session.playAgain()).toBe(true)
      expect(session.config).toMatchObject({
        coursePlayId: 'pending-receipt',
        seat1Deck: '40 Mountain',
        seat2Deck: '40 Forest',
      })
      expect(session.config!.matchId).not.toBe(first.matchId)
      expect(session.snapshot().browserPhase).toBe('idle')
      Object.defineProperty(greStore, 'gameOver', { configurable: true, value: true })
      try {
        expect(await session.playAgain()).toBe(true)
        expect(session.config).toBeNull()
        expect(navigate).toHaveBeenLastCalledWith('/play/limited')
      } finally {
        Reflect.deleteProperty(greStore, 'gameOver')
      }
    }
  } finally {
    navigate.mockRestore()
    if (previousStorage) {
      Object.defineProperty(globalThis, 'sessionStorage', previousStorage)
    } else {
      Reflect.deleteProperty(globalThis, 'sessionStorage')
    }
  }
})
