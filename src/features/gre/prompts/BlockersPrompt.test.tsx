import { createFixture } from '../catalogue/fixture-builder'
import { expect, test } from 'bun:test'
import { bindingFor, promptHarness } from '@engine/runtime/prompts/prompt-test-harness'
import { BlockersPrompt } from './BlockersPrompt'
import { buttons } from './prompt-renderer-test-helpers'

test('blocker renderer passes exact pair and gates waiting and read-only input', async () => {
  const h = promptHarness()
  h.owner.applyFamilyRequest({
    type: 28,
    msgId: 7,
    gameStateId: 8,
    declareBlockersReq: {
      blockers: [
        { blockerInstanceId: 101, attackerInstanceIds: [102], selectedAttackerInstanceIds: [] },
      ],
    },
  })
  const bound = bindingFor(h.owner, 'blockers')
  const choices = buttons(BlockersPrompt({ view: bound.view, controls: bound.controls, cards: [] }))
  expect(choices).toHaveLength(2)
  expect(choices.every((button) => !button.props.disabled)).toBe(true)
  choices[0]!.props.onClick()
  await Bun.sleep(0)
  expect(h.sent[0]).toMatchObject({
    type: 'DeclareBlockersResp_097b',
    payload: {
      declareBlockersResp: {
        selectedBlockers: [{ blockerInstanceId: 101, selectedAttackerInstanceIds: [102] }],
      },
    },
  })
  expect(
    buttons(
      BlockersPrompt({
        view: { ...bound.view, waiting: true },
        controls: bound.controls,
        cards: [],
      }),
    ).every((button) => button.props.disabled),
  ).toBe(true)
  expect(
    buttons(BlockersPrompt({ view: bound.view, controls: null, cards: [] })).every(
      (button) => button.props.disabled,
    ),
  ).toBe(true)
})

test('read-only card rows remain focusable with no executable handler', () => {
  const { card: makeCard } = createFixture()
  const card = makeCard('Lightning Bolt')
  const h = promptHarness()
  h.owner.applyFamilyRequest({
    type: 28,
    declareBlockersReq: {
      blockers: [
        {
          blockerInstanceId: 101,
          attackerInstanceIds: [card.instanceId],
          selectedAttackerInstanceIds: [],
        },
      ],
    },
  })
  const bound = bindingFor(h.owner, 'blockers')
  const rows = buttons(BlockersPrompt({ view: bound.view, controls: null, cards: [card] }))
  const row = rows.find((button) => button.props['data-instance-id'] === card.instanceId)!
  expect(row.props.disabled).toBe(false)
  expect(row.props['aria-disabled']).toBe(true)
  expect(row.props.onClick).toBeUndefined()
  expect(rows.at(-1)!.props.disabled).toBe(true)
  expect(h.sent).toEqual([])
})
