import { expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { warmBrowserRelease } from './browser-release'

it('retries a failed manifest before sharing a verified startup warmup', async () => {
  const content = new TextEncoder().encode('runtime')
  const sha256 = createHash('sha256').update(content).digest('hex')
  const requests: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    requests.push(url)
    if (requests.length === 1) {
      return new Response('{}', { status: 503 })
    }
    return url.endsWith('release.json')
      ? Response.json({
          schemaVersion: 2,
          releaseId: 'release',
          startupAssets: ['lib/runtime.jar'],
          assets: [
            {
              path: 'lib/runtime.jar',
              url: `/browser-engine/objects/${sha256}/runtime.jar`,
              bytes: content.byteLength,
              sha256,
            },
          ],
        })
      : new Response(content)
  }) as typeof fetch

  const signal = new AbortController().signal
  expect(await warmBrowserRelease(signal).catch((error: unknown) => error)).toMatchObject({
    message: 'Release manifest download failed (503)',
  })
  const [first, second] = await Promise.all([
    warmBrowserRelease(signal),
    warmBrowserRelease(signal),
  ])

  expect(first).toEqual(second)
  expect(first).toMatchObject({ status: 'complete', bytes: content.byteLength })
  expect(requests).toHaveLength(3)
  expect(requests.slice(0, 2)).toEqual([
    '/browser-engine/release.json',
    '/browser-engine/release.json',
  ])
})
