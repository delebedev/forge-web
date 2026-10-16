import type { Page } from '@playwright/test'
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

/** Observes outgoing envelopes; callers own scenario actions and response assertions. */
export async function observeGreResponses(page: Page, field: 'distributionResp' | 'optionalResp') {
  const greType = await enumValue('ClientToMatchServiceMessageType', 'ClientToGremessage')
  const responses: Record<string, unknown>[] = []
  const decodes: Promise<void>[] = []
  const errors: unknown[] = []
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/gre?')) {
      return
    }
    socket.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') {
        return
      }
      decodes.push(
        (async () => {
          const wrapper = await decodeMessage('ClientToMatchServiceMessage', payload)
          if (wrapper['clientToMatchServiceMessageType'] !== greType) {
            return
          }
          const response = await decodeMessage(
            'ClientToGREMessage',
            wrapper['payload'] as Uint8Array,
          )
          if (response[field]) {
            responses.push(response)
          }
        })().catch((error) => {
          errors.push(error)
        }),
      )
    })
  })
  return {
    responses,
    settle: async () => {
      let cursor = 0
      while (cursor < decodes.length) {
        const pending = decodes.slice(cursor)
        cursor = decodes.length
        await Promise.all(pending)
      }
      if (errors.length) {
        throw errors[0]
      }
    },
  }
}
