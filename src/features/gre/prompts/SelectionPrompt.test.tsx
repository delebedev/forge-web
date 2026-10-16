import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SelectionPromptView } from '@engine/state/gre-state'
import type { SelectionControls } from '@engine/runtime/prompts/family'
import { createFixture } from '../catalogue/fixture-builder'
import { SelectionPrompt } from './SelectionPrompt'
import { buttons } from './prompt-renderer-test-helpers'
import { promptHarness, bindingFor } from '@engine/runtime/prompts/prompt-test-harness'
const controls: SelectionControls = {
  toggle: () => true,
  submit: async () => true,
  cancel: async () => true,
}
test('only abortable SelectN prompts show action cancellation', () => {
  const abortable = renderToStaticMarkup(
    <SelectionPrompt
      cards={[]}
      view={{
        interactionKey: 20,
        kind: 'selectN',
        message: 'PayCostsReq',
        canSubmit: false,
        canCancel: true,
        selectNCandidates: [],
      }}
      controls={controls}
    />,
  )
  const required = renderToStaticMarkup(
    <SelectionPrompt
      cards={[]}
      view={{
        interactionKey: 21,
        kind: 'selectN',
        message: 'SelectNReq',
        canSubmit: false,
        canCancel: false,
        selectNCandidates: [],
      }}
      controls={controls}
    />,
  )

  expect(abortable).toContain('>Cancel</button>')
  expect(required).not.toContain('>Cancel</button>')
})

test('weighted selections expose each candidate contribution', () => {
  const prompt: SelectionPromptView = {
    interactionKey: 13,
    kind: 'selectN',
    message: 'PayCostsReq',
    minSelect: 2,
    maxSelect: 2_147_483_647,
    canSubmit: true,
    selectNCandidates: [
      {
        interactionKey: 13,
        instanceId: 108,
        grpId: 208,
        name: 'Coral Merfolk',
        zoneType: 3,
        selected: true,
        staticChoice: false,
        weight: 2,
      },
      {
        interactionKey: 13,
        instanceId: 109,
        grpId: 208,
        name: 'Coral Merfolk',
        zoneType: 3,
        selected: false,
        staticChoice: false,
        weight: 1,
      },
    ],
  }

  const html = renderToStaticMarkup(
    <SelectionPrompt cards={[]} view={prompt as SelectionPromptView} controls={controls} />,
  )

  expect(html).toContain('Coral Merfolk · 2 toward total')
  expect(html).toContain('Coral Merfolk · 1 toward total')
})

test('static choices do not inspect an unrelated card with the same numeric id', () => {
  const { card: makeCard } = createFixture()
  const card = makeCard('Lightning Bolt')
  const candidate = {
    interactionKey: 1,
    instanceId: card.instanceId,
    grpId: 0,
    name: 'White',
    zoneType: 0,
    selected: false,
    staticChoice: true,
  }
  const html = renderToStaticMarkup(
    <SelectionPrompt
      view={{
        interactionKey: 1,
        kind: 'selectN',
        message: 'Choose a color',
        selectNCandidates: [candidate],
      }}
      cards={[card]}
      controls={controls}
    />,
  )
  expect(html).toContain(`data-choice-id="${card.instanceId}"`)
  expect(html).not.toContain('data-instance-id')
  expect(html).not.toContain('<img')
})

test('real bound selection gestures project drafts and keep read-only and waiting controls inert', () => {
  const host = promptHarness()
  host.owner.applyFamilyRequest({
    type: 36,
    msgId: 7,
    gameStateId: 8,
    allowCancel: 2,
    payCostsReq: {
      effectCostReq: { effectCostType: 1, costSelection: { ids: [101], minSel: 1, maxSel: 1 } },
    },
  })
  const render = () => {
    const bound = bindingFor(host.owner, 'selectN')
    return SelectionPrompt({ view: bound.view, controls: bound.controls, cards: [] })
  }
  let rendered = buttons(render())
  expect(rendered[1]!.props.disabled).toBe(true)
  rendered[0]!.props.onClick()
  expect(viewFor(host.owner, 'selectN').selectNCandidates?.[0]?.selected).toBe(true)
  rendered = buttons(render())
  expect(rendered[1]!.props.disabled).toBe(false)
  rendered[2]!.props.onClick()
  expect(host.sent).toEqual([{ type: 'CancelActionReq_097b', payload: { gameStateId: 8 } }])
  expect(buttons(render()).every((button) => button.props.disabled)).toBe(true)
  host.owner.rejectPromptResponse()
  const bound = bindingFor(host.owner, 'selectN')
  expect(bound.view.selectNCandidates[0]!.selected).toBe(true)
  expect(
    buttons(SelectionPrompt({ view: bound.view, controls: null, cards: [] })).every(
      (button) => button.props.disabled,
    ),
  ).toBe(true)
})

test('read-only card rows remain focusable with no executable handler', () => {
  const { card: makeCard } = createFixture()
  const card = makeCard('Lightning Bolt')
  const h = promptHarness()
  h.owner.applyFamilyRequest({
    type: 22,
    selectNReq: { ids: [card.instanceId], minSel: 1, maxSel: 1 },
  })
  const bound = bindingFor(h.owner, 'selectN')
  const rows = buttons(SelectionPrompt({ view: bound.view, controls: null, cards: [card] }))
  const row = rows.find((button) => button.props['data-instance-id'] === card.instanceId)!
  expect(row.props.disabled).toBe(false)
  expect(row.props['aria-disabled']).toBe(true)
  expect(row.props.onClick).toBeUndefined()
  expect(rows.at(-1)!.props.disabled).toBe(true)
  expect(h.sent).toEqual([])
})
