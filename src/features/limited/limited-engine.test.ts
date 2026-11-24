import { expect, it } from 'bun:test'
import { createLimitedEngine } from './limited-engine'

it('a release while another store runs a command keeps the worker until it ends', async () => {
  const workers: { disposed: boolean; versions: (() => void)[] }[] = []
  const limited = createLimitedEngine(() => {
    const worker = { disposed: false, versions: [] as (() => void)[] }
    workers.push(worker)
    return {
      catalogVersion: () =>
        new Promise<string>((resolve) => worker.versions.push(() => resolve('catalog'))),
      limited: async () => ({}),
      dispose: () => {
        worker.disposed = true
      },
    }
  })
  const first = limited.catalogVersion()
  const second = limited.catalogVersion()
  expect(workers).toHaveLength(1)
  const worker = workers[0]!

  limited.release()
  expect(worker.disposed).toBe(false)
  worker.versions[0]!()
  await first
  limited.release()
  expect(worker.disposed).toBe(false)
  worker.versions[1]!()
  expect(await second).toBe('catalog')
  expect(worker.disposed).toBe(false)

  limited.release()
  expect(worker.disposed).toBe(true)
})
