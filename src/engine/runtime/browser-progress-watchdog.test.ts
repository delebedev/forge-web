import { expect, it } from 'bun:test'
import { BrowserProgressWatchdog, type BrowserProgressSnapshot } from './browser-progress-watchdog'

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

it('expires only while the browser engine owns an unresolved progress gap', async () => {
  let snapshot: BrowserProgressSnapshot = {
    matchId: 'browser-match',
    gameStateId: 1,
    gameOver: false,
    prompt: true,
    canPass: false,
    legalActionCount: 0,
  }
  const listeners = new Set<() => void>()
  let expirations = 0
  const watchdog = new BrowserProgressWatchdog(
    () => snapshot,
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => {
      expirations += 1
    },
    5,
  )
  watchdog.start()
  await wait(10)
  expect(expirations).toBe(0)

  snapshot = { ...snapshot, prompt: false }
  listeners.forEach((listener) => listener())
  await wait(10)
  expect(expirations).toBe(1)

  watchdog.stop()
  expect(listeners).toHaveLength(0)
})
