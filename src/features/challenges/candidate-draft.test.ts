import { expect, test } from 'bun:test'
import { CandidateDraft } from './candidate-draft'

const loaded = (candidateId: string) => ({
  candidateId,
  validation: {
    status: 'Loaded',
    issues: [],
    name: 'Puzzle',
    goal: 'Win',
    turns: 1,
    inputCardCount: 5,
  },
})

test('editing a draft discards an outstanding validation result', async () => {
  let finish!: (response: Response) => void
  const draft = new CandidateDraft(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  draft.edit('first puzzle')
  const validating = draft.validate()
  draft.edit('second puzzle')
  finish(Response.json(loaded('old')))
  await validating
  expect(draft.snapshot()).toMatchObject({
    text: 'second puzzle',
    validated: null,
    trial: null,
    busy: null,
  })
})

test('invalid input retains useful diagnostics and has no playable identity', async () => {
  const draft = new CandidateDraft(async () =>
    Response.json({
      candidateId: null,
      validation: {
        status: 'Invalid',
        issues: ['Unknown card: Made Up'],
        inputCardCount: 0,
        name: null,
        goal: null,
        turns: null,
      },
    }),
  )
  draft.edit('bad puzzle')
  await draft.validate()
  expect(draft.snapshot().validated?.candidateId).toBeNull()
  expect(draft.snapshot().validated?.validation.issues).toEqual(['Unknown card: Made Up'])
  expect(draft.snapshot().busy).toBeNull()
})

test('a losing engine trial remains distinct from a loaded playable candidate', async () => {
  const paths: string[] = []
  const draft = new CandidateDraft(async (path) => {
    paths.push(path)
    return Response.json(
      path.endsWith('/trial')
        ? {
            status: 'Lost',
            definitionId: 'test',
            matchId: null,
            engineSeed: null,
            limits: { maxDecisions: 256, maxElapsedMillis: 60000 },
            decisions: [],
            elapsedMillis: 5,
            outcome: null,
            reason: null,
          }
        : loaded('owned'),
    )
  })
  draft.edit('valid puzzle')
  await draft.validate()
  await draft.tryEngine()
  expect(paths).toEqual(['/api/dev/puzzle-candidates', '/api/dev/puzzle-candidates/owned/trial'])
  expect(draft.snapshot().validated?.candidateId).toBe('owned')
  expect(draft.snapshot().trial?.status).toBe('Lost')
  draft.edit('changed puzzle')
  expect(draft.snapshot().validated).toBeNull()
  expect(draft.snapshot().trial).toBeNull()
})

test('a late winning trial cannot validate an edited position', async () => {
  let finish!: (response: Response) => void
  const draft = new CandidateDraft((path) =>
    path.endsWith('/trial')
      ? new Promise((resolve) => {
          finish = resolve
        })
      : Promise.resolve(Response.json(loaded('original'))),
  )
  draft.edit('original position')
  await draft.validate()
  const pending = draft.tryEngine()
  draft.edit('different position')
  finish(Response.json({ status: 'Won', decisions: [], elapsedMillis: 1 }))
  await pending
  expect(draft.snapshot()).toMatchObject({
    text: 'different position',
    validated: null,
    trial: null,
    busy: null,
  })
})
