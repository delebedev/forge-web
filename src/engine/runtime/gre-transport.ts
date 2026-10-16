import {
  DraftPlayResponseSchema,
  GreStartRequestInputSchema,
  MatchCapacityResponseSchema,
} from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
import type { WebComponents } from '@shared/api/contracts'
import { apiFetch } from '@shared/api/client'
import type { GreStartConfig } from './start'

export type GreStartResponse = WebComponents['schemas']['DraftPlayResponse']

export type GreCloseCategory =
  'transient' | 'terminated' | 'unavailable' | 'denied' | 'completed' | 'abandoned'

export type GreSocketClose = {
  code: number
  reason: string
  wasClean: boolean
}

export type GreConnectionClose = Pick<GreSocketClose, 'code'> & { category: GreCloseCategory }

export class GreStartError extends Error {
  readonly status: number
  readonly category: 'capacity' | 'deployment' | 'server'
  readonly retryAfterSeconds?: number

  constructor(
    message: string,
    status: number,
    category: 'capacity' | 'deployment' | 'server',
    retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'GreStartError'
    this.status = status
    this.category = category
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function classifyGreClose(
  close: GreSocketClose | undefined,
  gameOver: boolean,
): GreCloseCategory {
  if (gameOver) {
    return 'completed'
  }
  if (close?.code === 1000 && close.reason === 'match_completed') {
    return 'completed'
  }
  if (close?.code === 1000 && close.reason === 'match_abandoned') {
    return 'abandoned'
  }
  if (close?.code === 1000 && close.reason === 'match_expired') {
    return 'unavailable'
  }
  if (close?.code === 1011 && close.reason === 'match_engine_failed') {
    return 'terminated'
  }
  if (
    close?.code === 1003 &&
    (close.reason === 'match_unavailable' || close.reason === 'match_id_required')
  ) {
    return 'unavailable'
  }
  if (close?.code === 1008 && close.reason === 'match_access_denied') {
    return 'denied'
  }
  return 'transient'
}

export type GreTransportHandlers = {
  onOpen: () => void
  onMessage: (bytes: Uint8Array) => void
  onClose: (close: GreSocketClose) => void
  onError: () => void
}

export async function startGreMatch(
  config: GreStartConfig,
  signal?: AbortSignal,
  onTiming?: (timing: Record<string, string | number>) => void,
): Promise<GreStartResponse> {
  const body = GreStartRequestInputSchema.parse(startRequestBody(config))
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }
  const started = performance.now()
  const res = await apiFetch('/api/gre/start', init)
  try {
    const serverMs = Number(res.headers.get('Server-Timing')?.match(/app;dur=([\d.]+)/)?.[1])
    onTiming?.({
      status: res.status,
      http_ms: Math.round(performance.now() - started),
      backend_release: res.headers.get('X-Backend-Release') ?? 'unknown',
      ...(Number.isFinite(serverMs) ? { server_ms: serverMs } : {}),
    })
  } catch {
    /* Optional telemetry must not change the request outcome. */
  }
  if (!res.ok) {
    const parsed = MatchCapacityResponseSchema.safeParse(await res.json().catch(() => null))
    const payload = parsed.success ? parsed.data : null
    const explicitCapacity = res.status === 503 && payload?.code === 'match_capacity'
    const deployment = res.status === 503 && payload?.code === 'deployment_in_progress'
    const retryAfter = Number(payload?.retryAfterSeconds ?? res.headers?.get('Retry-After'))
    const retryAfterSeconds =
      Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(600, Math.ceil(retryAfter)) : 5
    throw new GreStartError(
      deployment
        ? 'New games are paused for a few minutes while Forge gets a quick update. Games already underway can finish normally. This can take up to 10 minutes.'
        : explicitCapacity
          ? 'All game slots are busy. Please try again shortly.'
          : `Start game failed: ${res.status}`,
      res.status,
      deployment ? 'deployment' : explicitCapacity ? 'capacity' : 'server',
      deployment || explicitCapacity ? retryAfterSeconds : undefined,
    )
  }
  return await readJson(res, DraftPlayResponseSchema)
}

export async function abandonGreMatch(matchId: string): Promise<{ ok: boolean; status: number }> {
  const res = await apiFetch('/api/gre/abandon', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId }),
  })
  return { ok: res.ok, status: res.status }
}

/** Keep client route labels out of the request while forwarding supported game variants. */
export function startRequestBody(config: GreStartConfig) {
  const {
    matchId,
    wireMatchId,
    seat1Deck,
    seat2Deck,
    challengeId,
    candidateId,
    puzzle,
    spectatorMode,
    seed,
  } = config
  return {
    matchId,
    wireMatchId,
    seat1Deck,
    seat2Deck,
    challengeId,
    candidateId,
    puzzle,
    spectatorMode,
    seed,
    ...(['commander', 'brawl', 'oathbreaker'].includes(config.gameType ?? '')
      ? { gameVariant: config.gameType }
      : {}),
  }
}

export class GreTransport {
  private socket: WebSocket

  constructor(handlers: GreTransportHandlers, matchId = '') {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBase =
      import.meta.env.DEV && __WEBDOOR_WS_BASE__
        ? __WEBDOOR_WS_BASE__
        : `${protocol}//${location.host}`
    const params = new URLSearchParams()
    if (matchId) {
      params.set('matchId', matchId)
    }
    const query = params.size > 0 ? `?${params}` : ''
    const socket = new WebSocket(`${wsBase}/gre${query}`)
    socket.binaryType = 'arraybuffer'
    socket.addEventListener('open', handlers.onOpen)
    socket.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        handlers.onMessage(new Uint8Array(event.data))
      }
    })
    socket.addEventListener('close', (event) =>
      handlers.onClose({ code: event.code, reason: event.reason, wasClean: event.wasClean }),
    )
    socket.addEventListener('error', handlers.onError)
    this.socket = socket
  }

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN
  }

  get isConnecting(): boolean {
    return this.socket.readyState === WebSocket.CONNECTING
  }

  send(bytes: Uint8Array): void {
    this.socket.send(bytes)
  }

  close(): void {
    this.socket.close()
  }
}
