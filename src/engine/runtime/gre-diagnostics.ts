import type { MessageTypeEntry, TrafficStats } from '@engine/state/gre-state'

/** Log feed, message-type feed, traffic byte counters, and error count for a GRE session.
 *  Owned as its own unit so gre-store.ts doesn't have to interleave
 *  diagnostics bookkeeping with protocol handling. */
export class GreDiagnostics {
  logs: string[] = []
  errorCount = 0
  messageTypeFeed: MessageTypeEntry[] = []
  lastMessage = 'none'
  trafficStats: TrafficStats = {
    sentBytes: 0,
    recvBytes: 0,
    sentMessages: 0,
    recvMessages: 0,
  }

  private nextMessageTypeId = 1

  reset(): void {
    this.logs = []
    this.errorCount = 0
    this.messageTypeFeed = []
    this.lastMessage = 'none'
    this.trafficStats = {
      sentBytes: 0,
      recvBytes: 0,
      sentMessages: 0,
      recvMessages: 0,
    }
    this.nextMessageTypeId = 1
  }

  log(message: string): void {
    this.logs = [`${new Date().toLocaleTimeString()} ${message}`, ...this.logs].slice(0, 80)
  }

  recordTraffic(direction: 'in' | 'out', byteLength: number): void {
    this.trafficStats = {
      sentBytes: this.trafficStats.sentBytes + (direction === 'out' ? byteLength : 0),
      recvBytes: this.trafficStats.recvBytes + (direction === 'in' ? byteLength : 0),
      sentMessages: this.trafficStats.sentMessages + (direction === 'out' ? 1 : 0),
      recvMessages: this.trafficStats.recvMessages + (direction === 'in' ? 1 : 0),
    }
  }

  addMessageType(type: string, direction: 'in' | 'out'): void {
    const entry: MessageTypeEntry = {
      id: this.nextMessageTypeId++,
      time: new Date().toLocaleTimeString(),
      direction,
      type,
    }
    this.messageTypeFeed = [...this.messageTypeFeed, entry].slice(-100)
  }
}
