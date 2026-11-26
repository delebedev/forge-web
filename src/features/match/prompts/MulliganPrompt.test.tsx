import { expect, test } from 'bun:test'
import { MulliganPrompt } from './MulliganPrompt'
import { buttons } from './prompt-renderer-test-helpers'
import type { MulliganPromptView } from '@engine/state/gre-state'

test('opening hand invokes bound decisions and disables waiting or read-only input', () => {
  const calls: string[] = []
  const view: MulliganPromptView = {
    kind: 'mulligan',
    interactionKey: 3,
    message: 'Opening hand',
    result: 'Keep or mulligan',
  }
  const controls = {
    keep: async () => {
      calls.push('keep')
      return true
    },
    mulligan: async () => {
      calls.push('mulligan')
      return true
    },
  }
  for (const button of buttons(MulliganPrompt({ view, controls }))) {
    expect(button.props.disabled).toBeFalsy()
    button.props.onClick()
  }
  expect(calls).toEqual(['keep', 'mulligan'])
  for (const state of ['read-only', 'waiting'] as const) {
    for (const button of buttons(
      MulliganPrompt({
        view: { ...view, waiting: state === 'waiting' },
        controls: state === 'read-only' ? null : controls,
      }),
    )) {
      expect(button.props.disabled).toBe(true)
    }
  }
})
