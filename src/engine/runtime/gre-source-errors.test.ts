import { describe, expect, test } from 'bun:test'
import { encodeMessage } from '@engine/wire/gre-proto'
import { BrowserMatchSource } from './browser-match-source'
import { type GreFrameBatch, type GreFrameSink } from './gre-frame-source'

for (const execution of ['browser'] as const) {
  describe(`${execution} GRE failures`, () => {
    async function withSource(
      consume: (batch: GreFrameBatch) => void,
      check: (source: {
        receive(bytes: Uint8Array): Promise<void>
        stop(): void
        errors: unknown[][]
      }) => Promise<void>,
    ) {
      const errors: unknown[][] = []
      const sink: GreFrameSink = {
        onOpen() {},
        onReset() {},
        onClose() {},
        onBatch: consume,
        onError: (...args: unknown[]) => errors.push(args),
      }
      if (execution === 'browser') {
        const source = new BrowserMatchSource({ send() {} }, 'synthetic-match')
        source.start(sink)
        try {
          await check({
            errors,
            stop: () => source.stop(),
            receive: (bytes) => {
              source.receiveFrame(btoa(String.fromCharCode(...bytes)))
              return source.flush()
            },
          })
        } finally {
          source.stop()
        }
        return
      }
    }

    test('malformed frames retain the decoder cause and count bytes once', async () => {
      const batches: GreFrameBatch[] = []
      await withSource(
        (batch) => batches.push(batch),
        async ({ receive, errors }) => {
          await receive(new Uint8Array([255]))
          expect(batches).toEqual([{ byteLength: 1, messages: [] }])
          expect(errors).toHaveLength(1)
          expect(errors[0]?.[0]).toBeInstanceOf(Error)
          expect(errors[0]?.[1]).toBe('decode')
        },
      )
    })

    test('a throwing consumer retains its cause without a second empty batch', async () => {
      const cause = new Error('synthetic fold failed')
      let batches = 0
      const bytes = await encodeMessage('MatchServiceToClientMessage', {})
      await withSource(
        () => {
          batches += 1
          throw cause
        },
        async ({ receive, errors }) => {
          await receive(bytes)
          expect(errors).toEqual([[cause, 'apply']])
          expect(batches).toBe(1)
        },
      )
    })

    test('retirement suppresses queued decoder failures', async () => {
      let batches = 0
      await withSource(
        () => {
          batches += 1
        },
        async ({ receive, stop, errors }) => {
          const pending = receive(new Uint8Array([255]))
          stop()
          await pending
          expect(errors).toEqual([])
          expect(batches).toBe(0)
        },
      )
    })
  })
}
