import { afterEach, expect, test } from 'bun:test'
import { testDatabase, testServer } from './test-support.ts'

let server: ReturnType<typeof testServer>
afterEach(() => server?.stop())

const DEVICE = '0bed291b-fb16-49a0-94ad-2c4a97300f90'

function withPuzzle() {
  const db = testDatabase()
  db.run(
    "INSERT INTO puzzle_generation_runs VALUES ('r1', 'o', 't', 't', 'published', 'ready', 'm', 'v', '[]', '[]', 'pz1', NULL)",
  )
  db.run(
    "INSERT INTO generated_puzzles VALUES ('pz1', 'r1', 'Title', 'text', '2026-01-01T00:00:00Z', 1)",
  )
  return db
}

test('active puzzles are listed and read', async () => {
  server = testServer({ db: withPuzzle() })
  const puzzle = { id: 'pz1', title: 'Title', text: 'text', createdAt: '2026-01-01T00:00:00Z' }
  expect(await (await server.request('/api/puzzles')).json()).toEqual([puzzle])
  expect(await (await server.request('/api/puzzles/pz1')).json()).toEqual(puzzle)
  expect((await server.request('/api/puzzles/missing')).status).toBe(404)
})

test('a device rates a puzzle once, and rating again replaces it', async () => {
  const db = withPuzzle()
  server = testServer({ db })
  const { cookie } = await server.signIn()
  const rate = (body: unknown, headers: Record<string, string> = { 'X-Device-Id': DEVICE }) =>
    server.post('/api/puzzles/pz1/ratings', body, headers)
  expect((await rate({ reaction: 'fun', outcome: 'won' })).status).toBe(204)
  expect(
    (
      await rate(
        { reaction: 'meh', outcome: 'lost', actions: ['a'] },
        { 'X-Device-Id': DEVICE, Cookie: cookie },
      )
    ).status,
  ).toBe(204)
  expect(
    db
      .query(
        'SELECT device_id, reaction, outcome, actions_json, player_id IS NOT NULL AS signed FROM puzzle_ratings',
      )
      .all(),
  ).toEqual([
    { device_id: DEVICE, reaction: 'meh', outcome: 'lost', actions_json: '["a"]', signed: 1 },
  ])
  const unknown = await rate({ reaction: 'wow', outcome: 'won' })
  expect([unknown.status, await unknown.text()]).toEqual([400, 'Unknown reaction'])
  expect((await rate({ reaction: 'fun', outcome: 'won' }, {})).status).toBe(400)
  expect(
    (await server.post('/api/puzzles/missing/ratings', {}, { 'X-Device-Id': DEVICE })).status,
  ).toBe(404)
})
