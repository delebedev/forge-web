import { expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import { warmBrowserRelease } from './browser-release'

it('warms the generated startup set once and verifies its bytes', async () => {
  const content = new TextEncoder().encode('runtime')
  const sha256 = createHash('sha256').update(content).digest('hex')
  const requests: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    requests.push(url)
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
  const [first, second] = await Promise.all([
    warmBrowserRelease(signal),
    warmBrowserRelease(signal),
  ])

  expect(first).toEqual(second)
  expect(first).toMatchObject({ status: 'complete', bytes: content.byteLength })
  expect(requests).toHaveLength(2)
})
