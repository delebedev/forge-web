import { expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GroupPromptView } from '@engine/state/gre-state'
import { GroupPrompt } from './GroupPrompt'
import { buttons } from './prompt-renderer-test-helpers'
const view: GroupPromptView = {
  ...{
    interactionKey: 5,
    kind: 'group',
    message: 'GroupReq',
    canSubmit: true,
    groupCandidates: [{ instanceId: 106, grpId: 206, name: 'Opt', selectedGroup: 0 }],
    groupSpecs: [
      {
        index: 0,
        label: 'Library / Top',
        zoneType: 1,
        subZoneType: 1,
        lowerBound: 0,
        upperBound: 1,
        count: 1,
      },
    ],
  },
  canSubmit: true,
}
test('group renderer invokes bound identity controls and honors submit availability', () => {
  const calls: unknown[] = []
  const controls = {
    move: (id: number, index: number) => {
      calls.push([id, index])
      return true
    },
    toggle: (id: number) => {
      calls.push(id)
      return true
    },
    submit: async () => {
      calls.push('submit')
      return true
    },
  }
  const select = (tree: ReactNode) => buttons(tree).find((b) => b.props['data-group-index'] === 0)!
  const submit = (tree: ReactNode) =>
    buttons(tree).find((b) => b.props.children === 'Submit groups')!
  const tree = GroupPrompt({ view, controls })
  expect(select(tree).props.disabled).toBeFalsy()
  expect(submit(tree).props.disabled).toBeFalsy()
  select(tree).props.onClick()
  submit(tree).props.onClick()
  expect(calls).toEqual([[106, 0], 'submit'])
  expect(
    submit(GroupPrompt({ view: { ...view, canSubmit: false }, controls })).props.disabled,
  ).toBe(true)
  for (const state of ['read-only', 'waiting'] as const) {
    const inert = GroupPrompt({
      view: { ...view, waiting: state === 'waiting' },
      controls: state === 'read-only' ? null : controls,
    })
    expect(select(inert).props.disabled).toBe(true)
    expect(submit(inert).props.disabled).toBe(true)
  }
  const html = renderToStaticMarkup(tree)
  expect(html).toContain('Library / Top')
  expect(html).toMatch(/data-group-zone-type="1"[^>]+data-group-sub-zone-type="1"/)
  expect(html).toContain('1/0-1')
})
