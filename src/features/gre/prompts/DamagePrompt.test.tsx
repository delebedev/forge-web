import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { expect, test } from 'bun:test'
import { bindingFor, promptHarness } from '@engine/runtime/prompts/prompt-test-harness'
import { DamagePrompt } from './DamagePrompt'
import { buttons } from './prompt-renderer-test-helpers'
import { renderToStaticMarkup } from 'react-dom/server'

test('damage renderer edits exact pairs from retained callbacks and gates invalid, waiting and read-only submission', async () => {
  const h = promptHarness()
  h.owner.applyFamilyRequest({
    type: 30,
    msgId: 7,
    gameStateId: 8,
    assignDamageReq: {
      damageAssigners: [
        {
          instanceId: 101,
          totalDamage: 3,
          assignments: [{ instanceId: 102, minDamage: 0, assignedDamage: 0 }],
        },
      ],
    },
  })
  const b = bindingFor(h.owner, 'assignDamage')
  const choices = buttons(DamagePrompt({ view: b.view, controls: b.controls }))
  expect(choices).toHaveLength(3)
  expect(choices[0]!.props.disabled).toBe(true)
  expect(choices[2]!.props.disabled).toBe(true)
  choices[1]!.props.onClick()
  choices[1]!.props.onClick()
  choices[1]!.props.onClick()
  expect(viewFor(h.owner, 'assignDamage').damageAssigners?.[0]?.assignedTotal).toBe(3)
  const ready = bindingFor(h.owner, 'assignDamage')
  const current = buttons(DamagePrompt({ view: ready.view, controls: ready.controls }))
  expect(current[1]!.props.disabled).toBe(true)
  expect(current[2]!.props.disabled).toBe(false)
  current[2]!.props.onClick()
  await Bun.sleep(0)
  expect(h.sent[0]).toMatchObject({
    type: 'AssignDamageResp_097b',
    payload: {
      assignDamageResp: {
        assigners: [{ instanceId: 101, assignments: [{ instanceId: 102, assignedDamage: 3 }] }],
      },
    },
  })
  expect(
    buttons(
      DamagePrompt({ view: { ...ready.view, waiting: true }, controls: ready.controls }),
    ).every((button) => button.props.disabled),
  ).toBe(true)
  expect(
    buttons(DamagePrompt({ view: ready.view, controls: null })).every(
      (button) => button.props.disabled,
    ),
  ).toBe(true)
})

test('damage rows label lethal thresholds without claiming an unconditional minimum', () => {
  const h = promptHarness()
  h.tables.objects.set(103, { instanceId: 103, grpId: 203 })
  h.owner.applyFamilyRequest({
    type: 30,
    msgId: 7,
    gameStateId: 8,
    assignDamageReq: {
      damageAssigners: [
        {
          instanceId: 101,
          totalDamage: 2,
          assignments: [
            { instanceId: 102, minDamage: 2, assignedDamage: 1 },
            { instanceId: 103, minDamage: 2, assignedDamage: 1 },
          ],
        },
      ],
    },
  })
  const b = bindingFor(h.owner, 'assignDamage')
  const html = renderToStaticMarkup(<DamagePrompt view={b.view} controls={b.controls} />)
  expect(html.match(/lethal 2/g)).toHaveLength(2)
  expect(html).not.toContain('min 2')
  expect(buttons(DamagePrompt({ view: b.view, controls: b.controls })).at(-1)!.props.disabled).toBe(
    false,
  )
})
