import { expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import type { OptionalActionPromptView } from '@engine/state/gre-state'
import { OptionalActionPrompt } from './OptionalActionPrompt'
import { buttons } from './prompt-renderer-test-helpers'
const view: OptionalActionPromptView = {
  ...{ interactionKey: 12, kind: 'optionalAction', message: 'OptionalActionMessage', result: '' },
  canSubmit: true,
}
test('optionalAction renderer sends bound choice values and disables waiting and read-only views', () => {
  const calls: unknown[] = []
  const controls = {
    choose: async (id: number) => {
      calls.push(id)
      return true
    },
    respond: async (accept: boolean) => {
      calls.push(accept)
      return true
    },
  }
  const select = (tree: ReactNode, value: string) =>
    buttons(tree).find((b) => b.props.children === value)!
  const tree = OptionalActionPrompt({ view, controls })
  for (const value of ['Accept', 'Decline']) {
    expect(select(tree, value).props.disabled).toBeFalsy()
    select(tree, value).props.onClick()
  }
  expect(calls).toEqual([true, false])
  for (const state of ['read-only', 'waiting'] as const) {
    const inert = OptionalActionPrompt({
      view: { ...view, waiting: state === 'waiting' },
      controls: state === 'read-only' ? null : controls,
    })
    for (const value of ['Accept', 'Decline']) {
      expect(select(inert, value).props.disabled).toBe(true)
    }
  }
})

test('payment intent labels bind pay and refusal to their existing response values', () => {
  const calls: boolean[] = []
  const tree = OptionalActionPrompt({
    view: { ...view, paymentCost: '{2}' },
    controls: {
      respond: async (accept) => {
        calls.push(accept)
        return true
      },
    },
  })
  const options = buttons(tree)
  expect(options.map((button) => button.props.children)).toEqual(['Pay', 'Don’t pay'])
  for (const button of options) {
    button.props.onClick()
  }
  expect(calls).toEqual([true, false])
})
