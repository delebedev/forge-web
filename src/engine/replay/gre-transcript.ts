/**
 * A frame source that plays a saved game transcript instead of a live match.
 *
 * The bundle is a list of arrival batches in the order the game produced them,
 * so stepping through it reproduces the same sequence of publishes a match
 * would have caused. Nothing is sent: the source has no socket, so the store's
 * send path is inert without needing a mode flag.
 *
 * Seeking backwards re-folds from the first batch rather than trying to invert a
 * diff. The fold is pure and a whole game is a few hundred batches, so this is
 * both cheaper to reason about and exact.
 */
import { greNormalizer, type EnumMiss, type GreNormalizer } from './gre-enum-names'
import type { GreFrameSink, GreFrameSource } from '@engine/runtime/gre-frame-source'
import type { CardMeta } from '@engine/state/gre-state'
import { normalizeCardImageUrl } from '@shared/cards/scryfall'

export type TranscriptBundle = {
  version: number
  label: string
  /** Where the transcript came from, carried through for display only. */
  source: string
  viewerSeatId: number
  matchId?: string
  release?: string
  batches: { messages: unknown[] }[]
  /** grpId (as a string key) to card metadata, so no card lookup is needed. */
  cards: Record<string, Partial<CardMeta>>
  /** Reserved for the client's own submissions; unused today. */
  responses?: unknown[]
  /** Ordered transport activity, including player submissions. */
  events?: TranscriptEvent[]
  status?: TranscriptStatus
  context?: TranscriptContext
}

export type TranscriptContext = {
  execution: 'browser'
  attemptId?: string
  matchId?: string
  gameType?: string
  seed?: number
  seat1Deck?: string
  seat2Deck?: string
  frontendBuild?: string
  engineBuild?: string
}

export type TranscriptEvent = {
  seq: number
  timeMs: number
  direction: 'outbound' | 'inbound' | string
  seatId: number
  batchIndex: number
  messages?: unknown[]
  message?: unknown
}

export type TranscriptStatus = {
  complete: boolean
  reason: string
  truncated: boolean
  reportId?: string | null
  pinnedUntilMs?: number | null
}

export type TranscriptPosition = {
  /** Frames applied so far. 0 is the empty board before the first frame. */
  index: number
  total: number
  playing: boolean
  /** Which arrival the current frame belongs to, and how many there are. */
  batchIndex: number
  batchTotal: number
}

/**
 * One frame, plus the arrival it came in.
 *
 * Stepping is per frame, not per arrival: a single arrival in a transcript can
 * carry fifty game states, and applying them together makes the interesting
 * moment — a spell on the stack, a creature dying — invisible between two
 * renders. The arrival index is kept so grouping information is still available
 * to anything that needs to know what landed together.
 */
export type TranscriptFrame = { message: unknown; batchIndex: number }

export function transcriptFrames(bundle: TranscriptBundle): TranscriptFrame[] {
  const frames: TranscriptFrame[] = []
  bundle.batches.forEach((batch, batchIndex) => {
    for (const message of batch.messages) {
      frames.push({ message, batchIndex })
    }
  })
  return frames
}

export function parseTranscriptBundle(raw: unknown): TranscriptBundle {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Transcript bundle is not an object')
  }
  const bundle = raw as Partial<TranscriptBundle>
  if (!Array.isArray(bundle.batches)) {
    throw new Error('Transcript bundle has no batches')
  }
  if (bundle.batches.length === 0 && bundle.status?.complete !== false) {
    throw new Error('Transcript bundle has no batches')
  }
  return {
    version: typeof bundle.version === 'number' ? bundle.version : 1,
    label: typeof bundle.label === 'string' ? bundle.label : 'transcript',
    source: typeof bundle.source === 'string' ? bundle.source : 'unknown',
    viewerSeatId:
      typeof bundle.viewerSeatId === 'number' && bundle.viewerSeatId > 0 ? bundle.viewerSeatId : 1,
    matchId: typeof bundle.matchId === 'string' ? bundle.matchId : undefined,
    release: typeof bundle.release === 'string' ? bundle.release : undefined,
    batches: bundle.batches.map((batch) => ({
      messages: Array.isArray(batch?.messages) ? batch.messages : [],
    })),
    cards: typeof bundle.cards === 'object' && bundle.cards !== null ? bundle.cards : {},
    responses: Array.isArray(bundle.responses) ? bundle.responses : [],
    events: Array.isArray(bundle.events)
      ? bundle.events.filter(
          (event): event is TranscriptEvent => typeof event === 'object' && event !== null,
        )
      : [],
    status: typeof bundle.status === 'object' && bundle.status !== null ? bundle.status : undefined,
    context:
      typeof bundle.context === 'object' && bundle.context !== null ? bundle.context : undefined,
  }
}

/** Card metadata as the store wants it, filled out from a bundle's card map. */
export function transcriptCardMeta(bundle: TranscriptBundle): Map<number, CardMeta> {
  const cards = new Map<number, CardMeta>()
  for (const [key, value] of Object.entries(bundle.cards)) {
    const grpId = Number(key)
    if (!Number.isFinite(grpId) || grpId <= 0) {
      continue
    }
    cards.set(grpId, {
      grpId,
      name: value.name ?? null,
      manaCost: value.manaCost ?? null,
      power: value.power ?? null,
      toughness: value.toughness ?? null,
      types: value.types ?? null,
      subtypes: value.subtypes ?? null,
      imageUrl: normalizeCardImageUrl(value.name ?? null, value.imageUrl ?? null),
      keywords: value.keywords ?? [],
    })
  }
  return cards
}

export class TranscriptFrameSource implements GreFrameSource {
  readonly canSend = false
  readonly bundle: TranscriptBundle
  readonly frames: TranscriptFrame[]
  private sink: GreFrameSink | null = null
  private normalizer: GreNormalizer | null = null
  private index = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private stepMs: number
  private onPosition: (position: TranscriptPosition) => void
  /** Enum names no descriptor value matched. Empty for a well-formed bundle. */
  readonly misses: EnumMiss[] = []

  constructor(
    bundle: TranscriptBundle,
    options: { stepMs?: number; onPosition?: (position: TranscriptPosition) => void } = {},
  ) {
    this.bundle = bundle
    this.frames = transcriptFrames(bundle)
    this.stepMs = options.stepMs ?? 120
    this.onPosition = options.onPosition ?? (() => {})
  }

  /** Always true: a transcript is readable, so the store treats it as connected. */
  get isOpen(): boolean {
    return true
  }

  get position(): TranscriptPosition {
    const current = this.frames[Math.max(0, this.index - 1)]
    return {
      index: this.index,
      total: this.frames.length,
      playing: this.timer != null,
      batchIndex: current?.batchIndex ?? 0,
      batchTotal: this.bundle.batches.length,
    }
  }

  start(sink: GreFrameSink): void {
    this.sink = sink
    void this.ready().then(() => {
      sink.onOpen()
      this.publishPosition()
    })
  }

  stop(): void {
    this.pause()
    this.sink = null
  }

  /** A transcript has nowhere to send. Recorded as a no-op, not an error. */
  send(): void {}

  async ready(): Promise<void> {
    this.normalizer ??= await greNormalizer()
  }

  play(): void {
    if (this.timer != null || this.index >= this.frames.length) {
      return
    }
    this.timer = setInterval(() => {
      if (this.index >= this.frames.length) {
        this.pause()
        return
      }
      this.stepForward()
    }, this.stepMs)
    this.publishPosition()
  }

  pause(): void {
    if (this.timer != null) {
      clearInterval(this.timer)
    }
    this.timer = null
    this.publishPosition()
  }

  toggle(): void {
    if (this.timer != null) {
      this.pause()
    } else {
      this.play()
    }
  }

  stepForward(): void {
    if (this.index >= this.frames.length) {
      return
    }
    this.applyFrame(this.index)
    this.index += 1
    this.publishPosition()
  }

  stepBack(): void {
    this.seek(this.index - 1)
  }

  /** Re-fold from empty up to `index` frames applied. */
  seek(index: number): void {
    const target = Math.max(0, Math.min(index, this.frames.length))
    this.pause()
    this.sink?.onReset()
    this.misses.length = 0
    for (let i = 0; i < target; i++) {
      this.applyFrame(i)
    }
    this.index = target
    this.publishPosition()
  }

  /** Move to just after the first frame carrying `gameStateId`. */
  seekToGameStateId(gameStateId: number): void {
    const found = this.frames.findIndex(
      (frame) => (frame.message as { gameStateId?: unknown } | null)?.gameStateId === gameStateId,
    )
    if (found >= 0) {
      this.seek(found + 1)
    }
  }

  private applyFrame(index: number): void {
    const sink = this.sink
    const normalizer = this.normalizer
    const frame = this.frames[index]
    if (!sink || !normalizer || !frame) {
      return
    }
    const result = normalizer.normalize(frame.message)
    this.misses.push(...result.misses)
    sink.onBatch({ byteLength: 0, messages: [result.message] })
  }

  private publishPosition(): void {
    this.onPosition(this.position)
  }
}
