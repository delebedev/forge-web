/**
 * Where GRE frames come from.
 *
 * `GreStore` folds `GREToClientMessage` values; it does not care how they
 * arrived. A source owns the arrival mechanism — socket lifecycle, wire decode,
 * byte accounting — and reports batches to a sink. One batch is one arrival
 * event, which is what makes the store publish once per arrival rather than once
 * per message.
 *
 * `onReset` exists so a source can rewind the fold. A socket never calls it; a
 * source that can seek backwards replays from an empty state instead of trying
 * to invert a diff.
 */
import { decodeMessage, type ProtoObject } from '@engine/wire/gre-proto'
import { asArray, isRecord } from '@engine/state/gre-state'
import { GreTransport, type GreSocketClose } from './gre-transport'

export type GreFrameBatch = {
  /** Wire bytes received. Zero when no socket produced the batch. */
  byteLength: number
  /** Decoded messages in arrival order. May be empty. */
  messages: ProtoObject[]
  /** True when the batch was an authenticate response rather than game traffic. */
  authenticated?: boolean
}

export type GreFailurePhase = 'decode' | 'apply' | 'transport'

export interface GreFrameSink {
  onOpen(): void
  onBatch(batch: GreFrameBatch): void
  /** Discard folded state and fold again from empty. */
  onReset(): void
  onClose(close?: GreSocketClose): void
  onError(error?: unknown, phase?: GreFailurePhase): void
}

export interface GreFrameSource {
  start(sink: GreFrameSink): void
  stop(): void
  readonly isOpen: boolean
  readonly isConnecting?: boolean
  send(bytes: Uint8Array): void
  /**
   * Whether anything reaches a peer when `send` is called.
   *
   * Two things hang off this. A source with a peer must be greeted with
   * auth/connect before frames flow, and greeting one without would report
   * outbound traffic that never left. And prompt lifetime depends on it: the
   * client normally dismisses a request by answering it, so a source that
   * cannot answer needs the store to expire requests some other way.
   */
  readonly canSend: boolean
}

/** Live match traffic over the `/gre` websocket. */
export class SocketFrameSource implements GreFrameSource {
  readonly canSend = true
  private transport: GreTransport | null = null
  private generation = 0
  private matchId: string

  constructor(matchId = '') {
    this.matchId = matchId
  }

  start(sink: GreFrameSink): void {
    const generation = ++this.generation
    this.transport = new GreTransport(
      {
        onOpen: () => sink.onOpen(),
        onMessage: (bytes) => {
          void this.deliver(sink, bytes, generation)
        },
        onClose: (close) => sink.onClose(close),
        onError: () => {
          if (this.generation === generation) {
            sink.onError(undefined, 'transport')
          }
        },
      },
      this.matchId,
    )
  }

  stop(): void {
    this.generation++
    this.transport?.close()
    this.transport = null
  }

  get isOpen(): boolean {
    return this.transport?.isOpen ?? false
  }

  get isConnecting(): boolean {
    return this.transport?.isConnecting ?? false
  }

  send(bytes: Uint8Array): void {
    this.transport?.send(bytes)
  }

  /**
   * A frame that fails to decode is reported as an error with an empty batch,
   * so its bytes still register and the store still publishes. Swallowing it
   * silently would leave the match stalled with no visible cause.
   */
  private async deliver(sink: GreFrameSink, bytes: Uint8Array, generation: number): Promise<void> {
    const byteLength = bytes.byteLength
    const batch: GreFrameBatch = { byteLength, messages: [] }
    let failure: { error: unknown; phase: GreFailurePhase } | undefined
    try {
      const wrapper = await decodeMessage('MatchServiceToClientMessage', bytes)
      if (isRecord(wrapper['authenticateResponse'])) {
        batch.authenticated = true
      } else {
        const event = wrapper['greToClientEvent']
        batch.messages = isRecord(event)
          ? asArray(event['greToClientMessages']).filter(isRecord)
          : []
      }
    } catch (error) {
      failure = { error, phase: 'decode' }
    }
    if (this.generation !== generation) {
      return
    }
    try {
      sink.onBatch(batch)
    } catch (error) {
      failure = { error, phase: 'apply' }
    }
    if (failure && this.generation === generation) {
      sink.onError(failure.error, failure.phase)
    }
  }
}
