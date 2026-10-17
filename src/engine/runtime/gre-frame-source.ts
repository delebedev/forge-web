/**
 * Where GRE frames come from.
 *
 * `GreStore` folds `GREToClientMessage` values; it does not care how they
 * arrived. A source owns the arrival mechanism — worker lifecycle, wire decode,
 * byte accounting — and reports batches to a sink. One batch is one arrival
 * event, which is what makes the store publish once per arrival rather than once
 * per message.
 *
 * `onReset` exists so a source can rewind the fold. A source that seeks backwards replays from an empty state instead of trying
 * to invert a diff.
 */
import type { ProtoObject } from '@engine/wire/gre-proto'
import type { GreSourceClose } from './gre-connection'

export type GreFrameBatch = {
  /** Wire bytes received. Zero for already decoded batches. */
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
  onClose(close?: GreSourceClose): void
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
