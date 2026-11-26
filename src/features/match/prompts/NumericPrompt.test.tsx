import { expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { NumericPromptView } from '@engine/state/gre-state'
import { NumericPrompt } from './NumericPrompt'
import { buttons } from './prompt-renderer-test-helpers'

const view: NumericPromptView = {
  kind: 'numericInput',
  interactionKey: 13,
  message: 'Choose X',
  numericValue: 2,
  numericMin: 0,
  numericMax: 4,
  numericStep: 1,
  decrementEnabled: true,
  incrementEnabled: true,
  canSubmit: true,
}
const named = (tree: ReactNode, name: string) =>
  buttons(tree).find(
    (button) =>
      (button.props['aria-label'] ??
        (Array.isArray(button.props.children)
          ? button.props.children.join('')
          : button.props.children)) === name,
  )!
const names = ['Decrease X', 'Increase X', 'Choose X = 2']

test('numeric controls map named decrement, increment and submit to bound commands', () => {
  const calls: unknown[] = []
  const controls = {
    adjust: (direction: -1 | 1) => {
      calls.push(direction)
      return true
    },
    submit: async () => {
      calls.push('submit')
      return true
    },
  }
  const tree = NumericPrompt({ view, controls })
  for (const name of names) {
    expect(named(tree, name).props.disabled).toBeFalsy()
    named(tree, name).props.onClick()
  }
  expect(calls).toEqual([-1, 1, 'submit'])
  const html = renderToStaticMarkup(tree)
  expect(html).toContain('aria-label="Choose X"')
  expect(html).toContain('aria-label="Decrease X"')
  expect(html).toContain('aria-label="Increase X"')
  expect(html).toContain('aria-label="X is 2"')
  expect(html).not.toContain('<input')
})

test('numeric bounds and readiness disable only their named controls', () => {
  const controls = { adjust: () => true, submit: async () => true }
  for (const [state, disabled] of [
    [{ decrementEnabled: false }, 'Decrease X'],
    [{ incrementEnabled: false }, 'Increase X'],
    [{ canSubmit: false }, 'Choose X = 2'],
  ] as const) {
    const tree = NumericPrompt({ view: { ...view, ...state }, controls })
    for (const name of names) {
      expect(!!named(tree, name).props.disabled).toBe(name === disabled)
    }
  }
})

test('numeric waiting and read-only views disable decrease, increase and submit', () => {
  for (const state of ['read-only', 'waiting'] as const) {
    const tree = NumericPrompt({
      view: { ...view, waiting: state === 'waiting' },
      controls: state === 'read-only' ? null : { adjust: () => true, submit: async () => true },
    })
    for (const name of names) {
      expect(named(tree, name).props.disabled).toBe(true)
    }
  }
})
