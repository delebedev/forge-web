import type { GreFrameSink, GreFrameSource } from './gre-frame-source'
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

  constructor(host: BrowserMatchHost, matchId: string) {
    this.host = host
    this.matchId = matchId
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
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
    this.delivery = this.delivery
      .then(() => this.deliver(bytes))
      .catch(() => {
        if (!this.retired) {
          this.sink?.onError()
        }
      })
  }

  flush(): Promise<void> {
    return this.delivery
  }

  receiveError(): void {
    if (!this.retired) {
      this.sink?.onError()
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

  private async deliver(bytes: Uint8Array): Promise<void> {
    if (this.retired) {
      return
    }
    const wrapper = await decodeMessage('MatchServiceToClientMessage', bytes)
    if (this.retired) {
      return
    }
    const event = wrapper['greToClientEvent']
    const messages = isRecord(event) ? asArray(event['greToClientMessages']).filter(isRecord) : []
    this.host.observeBatch?.(messages)
    this.sink?.onBatch({
      byteLength: bytes.byteLength,
      authenticated: isRecord(wrapper['authenticateResponse']),
      messages,
    })
  }
}
