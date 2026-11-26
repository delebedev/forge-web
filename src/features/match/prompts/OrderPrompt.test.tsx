import { expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { OrderPromptView } from '@engine/state/gre-state'
import { OrderPrompt } from './OrderPrompt'
import { buttons } from './prompt-renderer-test-helpers'
const view: OrderPromptView = {
  ...{
    interactionKey: 6,
    kind: 'order',
    message: 'OrderReq',
    canSubmit: false,
    orderContextLabel: 'Order on top',
    orderCandidates: [{ instanceId: 107, grpId: 207, name: 'Opt', position: 1 }],
  },
  canSubmit: true,
}
test('order renderer invokes bound identity controls and honors submit availability', () => {
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
  const select = (tree: ReactNode) =>
    buttons(tree).find((b) => b.props['data-instance-id'] === 107)!
  const submit = (tree: ReactNode) =>
    buttons(tree).find((b) => b.props.children === 'Submit order')!
  const tree = OrderPrompt({ view, controls })
  expect(select(tree).props.disabled).toBeFalsy()
  expect(submit(tree).props.disabled).toBeFalsy()
  select(tree).props.onClick()
  submit(tree).props.onClick()
  expect(calls).toEqual([107, 'submit'])
  expect(
    submit(OrderPrompt({ view: { ...view, canSubmit: false }, controls })).props.disabled,
  ).toBe(true)
  for (const state of ['read-only', 'waiting'] as const) {
    const inert = OrderPrompt({
      view: { ...view, waiting: state === 'waiting' },
      controls: state === 'read-only' ? null : controls,
    })
    expect(select(inert).props.disabled).toBe(true)
    expect(submit(inert).props.disabled).toBe(true)
  }
  const html = renderToStaticMarkup(tree)
  expect(html).toContain('Order on top')
  expect(html).toContain('Opt')
  expect(html).toContain('data-instance-id="107"')
  expect(html).toContain('data-grp-id="207"')
  expect(html).toContain('>1</span>')
})
