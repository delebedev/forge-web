import { expect, test } from 'bun:test'
import { bindingFor, encodedPromptHarness, decodeGre, viewFor } from './prompt-test-harness'
import { enumValueSync } from '@engine/wire/gre-proto'

for (const [decision, option] of [
  ['keep', 'AcceptHand'],
  ['mulligan', 'Mulligan'],
] as const) {
  test(`opening hand ${decision} answers its exact envelope once and publishes waiting then retirement`, async () => {
    let state = 4
    const h = encodedPromptHarness({ gameStateId: () => state })
    h.owner.applyFamilyRequest({
      type: 15,
      msgId: 7,
      gameStateId: 4,
      mulliganReq: { mulliganCount: 1, freeMulliganCount: 2 },
    })
    const view = viewFor(h.owner, 'mulligan')
    expect(view.result).toBe('1 free mulligan available')
    expect(h.owner.decisionHorizon).toMatchObject({ gameStateId: 4, respId: 7 })
    expect(h.owner.bindPrompt({ ...view })).toBeNull()
    const controls = bindingFor(h.owner, 'mulligan').controls
    state = 5
    const send = controls[decision]()
    expect(await controls[decision === 'keep' ? 'mulligan' : 'keep']()).toBe(false)
    expect(h.published.at(-1)).toMatchObject({ waiting: true, canSubmit: false })
    expect(await send).toBe(true)
    expect(h.sent).toHaveLength(1)
    expect(await decodeGre(h.sent[0])).toMatchObject({
      gameStateId: 4,
      respId: 7,
      mulliganResp: { decision: enumValueSync('MulliganOption', option) },
    })
    expect(h.published.at(-1)).toBeNull()
    expect(h.owner.decisionHorizon).toBeNull()
    expect(await controls.keep()).toBe(false)
  })
}

test('Commander opening requests show a free redraw only before it is used', () => {
  const h = encodedPromptHarness()
  for (const [count, result] of [
    [0, '1 free mulligan available'],
    [1, 'Mulligan count 1'],
    [2, 'Mulligan count 2'],
  ] as const) {
    h.owner.applyFamilyRequest({
      type: 15,
      msgId: count + 7,
      gameStateId: count + 4,
      mulliganReq: { mulliganCount: count, freeMulliganCount: 1 },
    })
    expect(viewFor(h.owner, 'mulligan').result).toBe(result)
  }
})

test('opening hand refresh retains counts and read-only controls are absent', () => {
  const h = encodedPromptHarness()
  h.owner.applyFamilyRequest({
    type: 15,
    msgId: 7,
    gameStateId: 4,
    mulliganReq: { mulliganCount: 2 },
  })
  const first = viewFor(h.owner, 'mulligan')
  h.owner.refreshPendingPrompts()
  expect(h.owner.prompt).toMatchObject({
    result: 'Mulligan count 2',
    interactionKey: first.interactionKey,
  })
  h.readOnly()
  expect(h.owner.bindPrompt(h.owner.prompt)?.controls).toBeNull()
})

test('keep hands a following bottom-card request to selection with its own identity and exact envelope', async () => {
  const h = encodedPromptHarness()
  h.owner.applyFamilyRequest({ type: 15, msgId: 7, gameStateId: 4, mulliganReq: {} })
  const opening = bindingFor(h.owner, 'mulligan').controls
  expect(await opening.keep()).toBe(true)
  h.owner.applyFamilyRequest({
    type: 22,
    msgId: 8,
    gameStateId: 5,
    selectNReq: { ids: [101, 102], minSel: 1, maxSel: 1, listType: 0 },
  })
  const bottom = bindingFor(h.owner, 'selectN')
  expect(bottom.controls.toggle(bottom.view.selectNCandidates[0]!)).toBe(true)
  expect(await opening.mulligan()).toBe(false)
  expect(await bottom.controls.submit()).toBe(true)
  expect(await decodeGre(h.sent[1])).toMatchObject({
    gameStateId: 5,
    respId: 8,
    selectNResp: { ids: [101] },
  })
  expect(h.owner.prompt).toBeNull()
})
