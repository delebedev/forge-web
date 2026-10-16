import { expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DistributionPromptView } from '@engine/state/gre-state'
import { DistributionPrompt } from './DistributionPrompt'
import { buttons } from './prompt-renderer-test-helpers'
const view: DistributionPromptView = {
  ...{
    interactionKey: 2,
    kind: 'distribution',
    message: 'DistributionReq',
    minSelect: 3,
    maxSelect: 3,
    canSubmit: true,
    distributionCandidates: [
      { instanceId: 110, grpId: 210, name: 'Coral Merfolk', amount: 1, minAmount: 1 },
      { instanceId: 111, grpId: 211, name: 'Savannah Lions', amount: 2, minAmount: 1 },
    ],
  },
  canSubmit: true,
}
test('allocation renderer uses bound IDs and respects minima, total limits and submit readiness', () => {
  const calls: unknown[] = []
  const controls = {
    adjust: (id: number, delta: number) => {
      calls.push([id, delta])
      return true
    },
    submit: async () => {
      calls.push('submit')
      return true
    },
  }
  const named = (tree: ReactNode, name: string) =>
    buttons(tree).find((b) => (b.props['aria-label'] ?? b.props.children) === name)!
  const names = [
    'Remove 1 from Coral Merfolk',
    'Assign 1 to Coral Merfolk',
    'Remove 1 from Savannah Lions',
    'Assign 1 to Savannah Lions',
    'Submit distribution',
  ]
  const tree = DistributionPrompt({ view, controls })
  const states: Record<string, boolean> = {
    'Remove 1 from Coral Merfolk': true,
    'Assign 1 to Coral Merfolk': true,
    'Remove 1 from Savannah Lions': false,
    'Assign 1 to Savannah Lions': true,
    'Submit distribution': false,
  }
  for (const name of names) {
    expect(!!named(tree, name).props.disabled).toBe(states[name]!)
  }
  named(tree, 'Remove 1 from Savannah Lions').props.onClick()
  named(tree, 'Submit distribution').props.onClick()
  expect(calls).toEqual([[111, -1], 'submit'])
  const incomplete = DistributionPrompt({
    view: {
      ...view,
      canSubmit: false,
      distributionCandidates: view.distributionCandidates.map((c) => ({ ...c, amount: 1 })),
    },
    controls,
  })
  for (const name of names) {
    expect(!!named(incomplete, name).props.disabled).toBe(
      name.startsWith('Remove') || name === 'Submit distribution',
    )
  }
  for (const state of ['read-only', 'waiting'] as const) {
    const inert = DistributionPrompt({
      view: { ...view, waiting: state === 'waiting' },
      controls: state === 'read-only' ? null : controls,
    })
    for (const name of names) {
      expect(named(inert, name).props.disabled).toBe(true)
    }
  }
  const html = renderToStaticMarkup(tree)
  expect(html).toContain('Coral Merfolk')
  expect(html).toContain('Savannah Lions')
  expect(html).toContain('data-instance-id="111"')
  expect(html).toContain('data-grp-id="211"')
  expect(html).toContain('aria-label="2 assigned"')
})
