import { expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReplacementPromptView } from '@engine/state/gre-state'
import { ReplacementPrompt } from './ReplacementPrompt'
import { buttons } from './prompt-renderer-test-helpers'
const view: ReplacementPromptView = {
  ...{
    interactionKey: 11,
    kind: 'replacement',
    message: 'SelectReplacementReq',
    replacementCandidates: [
      {
        replacementEffectId: 501,
        sourceInstanceId: 111,
        name: 'Fiery Temper',
        detail: 'Madness {R}',
      },
      {
        replacementEffectId: 502,
        sourceInstanceId: 112,
        name: 'Kitchen Imp',
        detail: 'Madness {B}',
      },
    ],
  },
  canSubmit: true,
}
test('replacement renderer sends bound choice values and disables waiting and read-only views', () => {
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
  const select = (tree: ReactNode, value: number) =>
    buttons(tree).find((b) => b.props['data-replacement-effect-id'] === value)!
  const tree = ReplacementPrompt({ view, controls })
  for (const value of [501, 502]) {
    expect(select(tree, value).props.disabled).toBeFalsy()
    select(tree, value).props.onClick()
  }
  expect(calls).toEqual([501, 502])
  for (const state of ['read-only', 'waiting'] as const) {
    const inert = ReplacementPrompt({
      view: { ...view, waiting: state === 'waiting' },
      controls: state === 'read-only' ? null : controls,
    })
    for (const value of [501, 502]) {
      expect(select(inert, value).props.disabled).toBe(true)
    }
  }
  const html = renderToStaticMarkup(tree)
  expect(html).toContain('data-replacement-effect-id="501"')
  expect(html).toContain('Fiery Temper')
  expect(html).toContain('Madness {R}')
  expect(html).toContain('Kitchen Imp')
  expect(html).toContain('Madness {B}')
})
