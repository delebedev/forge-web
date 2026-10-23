import type {
  GreFailurePhase,
  GreFrameBatch,
  GreFrameSink,
  GreFrameSource,
} from './gre-frame-source'
import { decodeMessage } from '@engine/wire/gre-proto'
import { asArray, isRecord } from '@engine/state/gre-state'

export type BrowserEngineEvent = { event: string; data?: unknown; at: number }

export interface BrowserMatchHost {
  observeBatch?(messages: Record<string, unknown>[]): void
  send(source: BrowserMatchSource, bytes: Uint8Array): void
}

/** A generation-bound GRE source backed by a shared browser JVM. */
export class BrowserMatchSource implements GreFrameSource {
  readonly canSend = true
  private sink: GreFrameSink | null = null
  private open = false
  private closed = false
  private retired = false
  private delivery = Promise.resolve()
  private readonly host: BrowserMatchHost
  readonly matchId: string
  private readonly keywordCoverage?: readonly string[]

  constructor(
    host: BrowserMatchHost,
    matchId: string,
    effectiveKeywordCoverage?: readonly string[],
  ) {
    this.host = host
    this.matchId = matchId
    this.keywordCoverage = effectiveKeywordCoverage && Object.freeze([...effectiveKeywordCoverage])
  }

  start(sink: GreFrameSink): void {
    if (this.retired || this.closed) {
      throw new Error('Browser match source is retired')
    }
    this.sink = sink
    this.open = true
    sink.onOpen()
  }

  stop(): void {
    this.retired = true
    this.open = false
    this.sink = null
  }

  get isOpen(): boolean {
    return this.open
  }
  get effectiveKeywordCoverage(): readonly string[] | undefined {
    return this.retired || this.closed ? undefined : this.keywordCoverage
  }
  get isRetired(): boolean {
    return this.retired
  }

  send(bytes: Uint8Array): void {
    if (!this.open || this.retired) {
      throw new Error('Browser match source is closed')
    }
    this.host.send(this, bytes)
  }

  receiveFrame(encoded: string): void {
    if (this.retired || this.closed) {
      return
    }
    this.delivery = this.delivery.then(() => this.deliver(encoded))
  }

  flush(): Promise<void> {
    return this.delivery
  }

  receiveError(): void {
    if (!this.retired) {
      this.sink?.onError(undefined, 'transport')
    }
  }

  receiveClose(): void {
    if (this.retired || this.closed) {
      return
    }
    this.closed = true
    this.open = false
    this.delivery = this.delivery.then(() => {
      if (!this.retired) {
        this.sink?.onClose()
      }
    })
  }

  private async deliver(encoded: string): Promise<void> {
    if (this.retired) {
      return
    }
    let batch: GreFrameBatch = { byteLength: 0, messages: [] }
    let failure: { error: unknown; phase: GreFailurePhase } | undefined
    try {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
      batch.byteLength = bytes.byteLength
      const wrapper = await decodeMessage('MatchServiceToClientMessage', bytes)
      const event = wrapper['greToClientEvent']
      batch = {
        byteLength: bytes.byteLength,
        authenticated: isRecord(wrapper['authenticateResponse']),
        messages: isRecord(event) ? asArray(event['greToClientMessages']).filter(isRecord) : [],
      }
    } catch (error) {
      failure = { error, phase: 'decode' }
    }
    if (this.retired) {
      return
    }
    try {
      this.host.observeBatch?.(batch.messages)
      this.sink?.onBatch(batch)
    } catch (error) {
      failure = { error, phase: 'apply' }
    }
    if (failure && !this.retired) {
      this.sink?.onError(failure.error, failure.phase)
    }
  }
}
