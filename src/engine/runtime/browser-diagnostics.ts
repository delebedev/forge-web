import { decodeMessage } from '@engine/wire/gre-proto'
import { isRecord } from '@engine/state/gre-state'
import {
  sanitizeBrowserFailureSnapshot,
  type BrowserFailureSnapshot,
} from '@shared/browser-failure-snapshot'

const MAX_COMMANDS = 32

export class BrowserDiagnostics {
  private commands: BrowserFailureSnapshot['commands'] = []
  private activeEntry: BrowserFailureSnapshot['commands'][number] | undefined
  private lastOutput: BrowserFailureSnapshot['lastOutput']
  private origin = performance.now()

  reset(): void {
    this.commands = []
    this.lastOutput = undefined
    this.activeEntry = undefined
    this.origin = performance.now()
  }

  command(id: number, operation: string, event: string): void {
    if (event === 'start') {
      this.activeEntry = this.commands.find((c) => c.id === id && c.event === 'enqueue')
    }
    if ((event === 'reply' || event === 'error') && this.activeEntry?.id === id) {
      this.activeEntry = undefined
    }
    this.commands.push({ id, operation, event, atMs: this.time() })
    if (this.commands.length > MAX_COMMANDS) {
      // Preserve the active input even when queued metadata fills the recent window.
      this.commands.splice(this.commands[0] === this.activeEntry ? 1 : 0, 1)
    }
  }

  async input(id: number, bytes: Uint8Array): Promise<void> {
    const entry = this.commands.find((c) => c.id === id && c.event === 'enqueue')
    if (!entry) {
      return
    }
    try {
      const wrapper = await decodeMessage('ClientToMatchServiceMessage', bytes)
      if (!(wrapper['payload'] instanceof Uint8Array)) {
        return
      }
      const message = await decodeMessage('ClientToGREMessage', wrapper['payload'])
      for (const key of ['type', 'gameStateId', 'respId'] as const) {
        if (typeof message[key] === 'number') {
          entry[key] = message[key]
        }
      }
    } catch {
      /* Diagnostic decoding never gates an action. */
    }
  }

  output(messages: Record<string, unknown>[]): void {
    for (const message of messages) {
      const state = isRecord(message['gameStateMessage']) ? message['gameStateMessage'] : message
      this.lastOutput = {
        type: Number(message['type']),
        gameStateId: Number(state['gameStateId'] ?? message['gameStateId']),
        msgId: Number(message['msgId']),
        atMs: this.time(),
      }
    }
  }

  snapshot(runtime: unknown = { runtime: 'unavailable' }): BrowserFailureSnapshot {
    return sanitizeBrowserFailureSnapshot({
      ...(isRecord(runtime) ? runtime : {}),
      atMs: this.time(),
      commands: this.commands,
      lastOutput: this.lastOutput,
    })!
  }

  private time(): number {
    return Math.max(0, Math.round(performance.now() - this.origin))
  }
}
