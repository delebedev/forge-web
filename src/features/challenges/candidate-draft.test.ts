import { expect, test } from 'bun:test'
import { CandidateDraft } from './candidate-draft'

const loaded = {
  status: 'Loaded',
  name: 'Authored puzzle',
  turns: 1,
  inputCardCount: 4,
  issues: [],
}

test('local validation keeps the exact authored text and exposes failures', async () => {
  const seen: string[] = []
  const draft = new CandidateDraft(async (text) => {
    seen.push(text)
    return loaded
  })
  draft.edit('position\nexact text ')
  await draft.validate()
  expect(seen).toEqual(['position\nexact text '])
  expect(draft.snapshot().validated?.status).toBe('Loaded')
  draft.edit('different position')
  expect(draft.snapshot().validated).toBeNull()
})

test('a late local result cannot validate an edited position', async () => {
  let finish!: (value: unknown) => void
  const draft = new CandidateDraft(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  draft.edit('original')
  const pending = draft.validate()
  draft.edit('changed')
  finish(loaded)
  await pending
  expect(draft.snapshot()).toMatchObject({ text: 'changed', validated: null, busy: false })
})

test('local initialization failure is visible and another validation can retry', async () => {
  let fail = true
  const draft = new CandidateDraft(async () => {
    if (fail) {
      throw new Error('Local engine unavailable')
    }
    return loaded
  })
  draft.edit('position')
  await draft.validate()
  expect(draft.snapshot().error).toBe('Local engine unavailable')
  expect(draft.snapshot().busy).toBe(false)
  fail = false
  await draft.validate()
  expect(draft.snapshot().validated?.status).toBe('Loaded')
  expect(draft.snapshot().error).toBeNull()
})
