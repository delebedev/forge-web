import { createFixture } from '../catalogue/fixture-builder'
import { expect, test } from 'bun:test'
import { bindingFor, promptHarness } from '@engine/runtime/prompts/prompt-test-harness'
import { AttackersPrompt } from './AttackersPrompt'
import { buttons } from './prompt-renderer-test-helpers'

test('attacker renderer passes exact offered destinations and gates submit, waiting and read-only input', async () => {
  const h = promptHarness()
  h.owner.applyFamilyRequest({
    type: 26,
    msgId: 7,
    gameStateId: 8,
    declareAttackersReq: {
      canSubmitAttackers: false,
      attackers: [
        {
          attackerInstanceId: 101,
          alternativeGrpId: 162,
          legalDamageRecipients: [
            { type: 1, playerSystemSeatId: 2 },
            { type: 2, planeswalkerInstanceId: 102 },
          ],
        },
      ],
    },
  })
  const bound = bindingFor(h.owner, 'attackers')
  const choices = buttons(
    AttackersPrompt({ view: bound.view, controls: bound.controls, cards: [] }),
  )
  expect(choices).toHaveLength(3)
  expect(choices[2]!.props.disabled).toBe(true)
  choices[1]!.props.onClick()
  await Bun.sleep(0)
  expect(h.sent[0]).toMatchObject({
    type: 'DeclareAttackersResp_097b',
    payload: {
      declareAttackersResp: {
        selectedAttackers: [
          {
            alternativeGrpId: 162,
            selectedDamageRecipient: { type: 2, planeswalkerInstanceId: 102 },
          },
        ],
      },
    },
  })
  expect(
    buttons(
      AttackersPrompt({
        view: { ...bound.view, waiting: true },
        controls: bound.controls,
        cards: [],
      }),
    ).every((button) => button.props.disabled),
  ).toBe(true)
  expect(
    buttons(AttackersPrompt({ view: bound.view, controls: null, cards: [] })).every(
      (button) => button.props.disabled,
    ),
  ).toBe(true)
})

test('read-only card rows remain focusable with no executable handler', () => {
  const { card: makeCard } = createFixture()
  const card = makeCard('Lightning Bolt')
  const h = promptHarness()
  h.owner.applyFamilyRequest({
    type: 26,
    declareAttackersReq: {
      attackers: [
        {
          attackerInstanceId: card.instanceId,
          legalDamageRecipients: [{ type: 1, playerSystemSeatId: 2 }],
        },
      ],
    },
  })
  const bound = bindingFor(h.owner, 'attackers')
  const rows = buttons(AttackersPrompt({ view: bound.view, controls: null, cards: [card] }))
  const row = rows.find((button) => button.props['data-instance-id'] === card.instanceId)!
  expect(row.props.disabled).toBe(false)
  expect(row.props['aria-disabled']).toBe(true)
  expect(row.props.onClick).toBeUndefined()
  expect(rows.at(-1)!.props.disabled).toBe(true)
  expect(h.sent).toEqual([])
})
