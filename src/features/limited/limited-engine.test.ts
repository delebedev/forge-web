import { expect, it } from 'bun:test'
import { createLimitedEngine } from './limited-engine'

type FakeWorker = {
  disposed: boolean
  failed: boolean
  versions: { resolve: () => void; reject: (error: Error) => void }[]
}

function fakeLimited() {
  const workers: FakeWorker[] = []
  const limited = createLimitedEngine(() => {
    const worker: FakeWorker = { disposed: false, failed: false, versions: [] }
    workers.push(worker)
    return {
      catalogVersion: () =>
        new Promise<string>((resolve, reject) =>
          worker.versions.push({ resolve: () => resolve('catalog'), reject }),
        ),
      limited: async () => ({}),
      diagnostics: () => ({ failed: worker.failed }),
      dispose: () => {
        worker.disposed = true
      },
    }
  })
  return { limited, workers }
}

it('a release while another store runs a command keeps the worker until it ends', async () => {
  const { limited, workers } = fakeLimited()
  const first = limited.catalogVersion()
  const second = limited.catalogVersion()
  expect(workers).toHaveLength(1)
  const worker = workers[0]!

  limited.release()
  expect(worker.disposed).toBe(false)
  worker.versions[0]!.resolve()
  await first
  limited.release()
  expect(worker.disposed).toBe(false)
  worker.versions[1]!.resolve()
  expect(await second).toBe('catalog')
  expect(worker.disposed).toBe(false)

  limited.release()
  expect(worker.disposed).toBe(true)
})

it('a command error keeps the worker for other commands unless the worker died', async () => {
  const { limited, workers } = fakeLimited()
  const failing = limited.catalogVersion().catch((error: Error) => error.message)
  const other = limited.catalogVersion()
  const worker = workers[0]!
  worker.versions[0]!.reject(new Error('bad request'))
  expect(await failing).toBe('bad request')
  expect(worker.disposed).toBe(false)
  worker.versions[1]!.resolve()
  expect(await other).toBe('catalog')

  const dying = limited.catalogVersion().catch((error: Error) => error.message)
  worker.failed = true
  worker.versions[2]!.reject(new Error('worker crashed'))
  expect(await dying).toBe('worker crashed')
  expect(worker.disposed).toBe(true)
  limited.release()
})
