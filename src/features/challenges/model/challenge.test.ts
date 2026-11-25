import { afterEach, expect, it } from 'bun:test'
import { fetchDevPuzzle, puzzleChallenge } from './challenge'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

it('reads challenge context from puzzle metadata', () => {
  const text = [
    '[metadata]',
    'Name:Brainstorm Order',
    'Goal:Survive',
    'Turns:1',
    'Description:Order the top of your library.',
    '',
    '[state]',
    'Name:ignored',
  ].join('\n')

  expect(puzzleChallenge('brainstorm-order', text)).toEqual({
    id: 'brainstorm-order',
    name: 'Brainstorm Order',
    objective: 'Survive within 1 turn. Order the top of your library.',
  })
  expect(puzzleChallenge('bare', '[state]\n')).toEqual({
    id: 'bare',
    name: 'bare',
    objective: 'Win.',
  })
})

it('rejects the HTML fallback served for a missing fixture', async () => {
  const serve = (body: string, type: string) => {
    globalThis.fetch = (async () =>
      new Response(body, { headers: { 'Content-Type': type } })) as unknown as typeof fetch
  }
  serve('<!doctype html><html></html>', 'text/html')
  expect(await fetchDevPuzzle('missing-fixture')).toBeNull()
  serve('[metadata]\nName:Bolt\n', 'text/plain; charset=utf-8')
  expect((await fetchDevPuzzle('bolt'))?.challenge.name).toBe('Bolt')
})
