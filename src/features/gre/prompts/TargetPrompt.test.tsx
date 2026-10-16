import { createFixture } from '../catalogue/fixture-builder'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { TargetPromptView } from '@engine/state/gre-state'
import { bindingFor, encodedPromptHarness } from '@engine/runtime/prompts/prompt-test-harness'
import { TargetPrompt } from './TargetPrompt'
import { buttons } from './prompt-renderer-test-helpers'

const view: TargetPromptView = {
  interactionKey: 1,
  kind: 'targets',
  message: 'SelectTargetsReq',
  candidates: [],
  canSubmit: true,
}

test('target prompts render cancellation only when server policy permits it', () => {
  const render = (canCancel: boolean, waiting = false) =>
    renderToStaticMarkup(
      <TargetPrompt view={{ ...view, canCancel, waiting }} cards={[]} controls={null} />,
    )
  expect(render(true)).toContain('>Cancel</button>')
  expect(render(false)).not.toContain('>Cancel</button>')
  expect(render(true, true)).toMatch(/disabled=""[^>]*>Cancel<\/button>/)
})

test('target renderer invokes real bound choices and disables waiting or read-only controls', async () => {
  const h = encodedPromptHarness()
  h.owner.applyFamilyRequest({
    type: 34,
    msgId: 4,
    gameStateId: 6,
    selectTargetsReq: {
      targets: [
        {
          targetIdx: 1,
          minTargets: 1,
          maxTargets: 1,
          selectedTargets: 0,
          targets: [{ targetInstanceId: 101, legalAction: 1 }],
        },
      ],
    },
  })
  const bound = bindingFor(h.owner, 'targets')
  const choices = buttons(TargetPrompt({ view: bound.view, controls: bound.controls, cards: [] }))
  const choice = choices.find((button) => button.props['data-instance-id'] === 101)!
  expect(choice.props.disabled).toBe(false)
  choice.props.onClick()
  await Bun.sleep(0)
  expect(h.sent).toHaveLength(1)
  const waiting = bindingFor(h.owner, 'targets')
  expect(
    buttons(TargetPrompt({ view: waiting.view, controls: waiting.controls, cards: [] })).every(
      (button) => button.props.disabled,
    ),
  ).toBe(true)
  expect(
    buttons(TargetPrompt({ view: bound.view, controls: null, cards: [] })).every(
      (button) => button.props.disabled,
    ),
  ).toBe(true)
})

test('read-only card rows remain focusable with no executable handler', () => {
  const { card: makeCard } = createFixture()
  const card = makeCard('Lightning Bolt')
  const h = encodedPromptHarness()
  h.owner.applyFamilyRequest({
    type: 34,
    selectTargetsReq: {
      targets: [
        {
          targetIdx: 1,
          minTargets: 0,
          maxTargets: 1,
          targets: [{ targetInstanceId: card.instanceId, legalAction: 1 }],
        },
      ],
    },
  })
  const bound = bindingFor(h.owner, 'targets')
  const rows = buttons(TargetPrompt({ view: bound.view, controls: null, cards: [card] }))
  const row = rows.find((button) => button.props['data-instance-id'] === card.instanceId)!
  expect(row.props.disabled).toBe(false)
  expect(row.props['aria-disabled']).toBe(true)
  expect(row.props.onClick).toBeUndefined()
  expect(rows.at(-1)!.props.disabled).toBe(true)
  expect(h.sent).toEqual([])
})
