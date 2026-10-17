import type { Page } from '@playwright/test'
import type { TranscriptBundle } from '../src/engine/replay/gre-transcript'
import { decodeMessage, enumValue } from '../src/engine/wire/gre-proto'
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') {
      return
    }
    errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/** Read the same ordered browser journal used for replay and recovery. */
export async function readBrowserJournal(page: Page): Promise<TranscriptBundle | null> {
  return page.evaluate(async () => {
    const modulePath = '/src/engine/runtime/gre-store.ts'
    const { greStore } = await import(modulePath)
    return greStore.browserReplaySnapshot()
  })
}

/** Decode native submissions from the current match's ordered browser journal. */
export async function observeGreResponses(page: Page, field: 'distributionResp' | 'optionalResp') {
  const greType = await enumValue('ClientToMatchServiceMessageType', 'ClientToGremessage')
  const responses: Record<string, unknown>[] = []
  let lastSeq = -1
  return {
    responses,
    settle: async () => {
      const journal = await readBrowserJournal(page)
      if (!journal) {
        throw new Error('Browser response journal is unavailable')
      }
      if (journal.status?.truncated) {
        throw new Error('Browser response journal is truncated')
      }
      for (const event of journal.events ?? []) {
        if (event.seq <= lastSeq) {
          continue
        }
        const payload = (event.message as { payload?: string })?.payload
        if (event.direction === 'inbound' && payload) {
          const wrapper = await decodeMessage(
            'ClientToMatchServiceMessage',
            Buffer.from(payload, 'base64'),
          )
          if (wrapper['clientToMatchServiceMessageType'] === greType) {
            const response = await decodeMessage(
              'ClientToGREMessage',
              wrapper['payload'] as Uint8Array,
            )
            if (response[field]) {
              responses.push(response)
            }
          }
        }
        lastSeq = event.seq
      }
    },
  }
}
