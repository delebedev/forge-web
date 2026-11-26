import { expect, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SearchPromptView } from '@engine/state/gre-state'
import { SearchPrompt } from './SearchPrompt'
import { buttons } from './prompt-renderer-test-helpers'

const view: SearchPromptView = {
  kind: 'search',
  interactionKey: 10,
  message: 'SearchFromGroupsReq',
  minSelect: 0,
  maxSelect: 1,
  canSubmit: true,
  canFail: true,
  searchGroups: [{ groupId: 7, label: 'Option 1', minSelect: 0, maxSelect: 1, selected: 1 }],
  searchCandidates: [
    {
      instanceId: 110,
      grpId: 210,
      name: 'Nightpack Ambusher',
      zoneType: 1,
      selected: true,
      sought: true,
      groupId: 7,
    },
    {
      instanceId: 111,
      grpId: 211,
      name: 'Plains',
      zoneType: 1,
      selected: false,
      sought: false,
      groupId: 7,
    },
  ],
}
const candidate = (tree: ReactNode, id: number) =>
  buttons(tree).find((button) => button.props['data-instance-id'] === id)!
const named = (tree: ReactNode, name: string) =>
  buttons(tree).find((button) => button.props.children === name)!

test('search maps offered card, submit and fail-to-find to distinct bound commands', () => {
  const calls: unknown[] = []
  const controls = {
    toggle: (id: number) => {
      calls.push(id)
      return true
    },
    submit: async () => {
      calls.push('submit')
      return true
    },
    fail: async () => {
      calls.push('fail')
      return true
    },
  }
  const tree = SearchPrompt({ view, controls, cards: [] })
  expect(candidate(tree, 110).props.disabled).toBeFalsy()
  expect(candidate(tree, 111).props.disabled).toBe(true)
  candidate(tree, 110).props.onClick()
  for (const name of ['Submit search', 'Fail to find']) {
    expect(named(tree, name).props.disabled).toBeFalsy()
    named(tree, name).props.onClick()
  }
  expect(calls).toEqual([110, 'submit', 'fail'])
  const html = renderToStaticMarkup(tree)
  expect(html).toContain('aria-label="Option 1"')
  expect(html).toContain('Option 1 · 1 selected · choose up to 1')
  expect(html).toContain('Nightpack Ambusher')
  expect(html).toContain('data-instance-id="110"')
  expect(html).toContain('data-grp-id="210"')
  expect(html).toContain('data-zone-type="1"')
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('>Unavailable</small>')
  expect(html).not.toContain('aria-hidden="true">Unavailable</small>')
})

test('search submit readiness and fail policy preserve available card controls', () => {
  const controls = { toggle: () => true, submit: async () => true, fail: async () => true }
  const tree = SearchPrompt({
    view: { ...view, canSubmit: false, canFail: false },
    controls,
    cards: [],
  })
  expect(candidate(tree, 110).props.disabled).toBeFalsy()
  expect(named(tree, 'Submit search').props.disabled).toBe(true)
  expect(buttons(tree).find((button) => button.props.children === 'Fail to find')).toBeUndefined()
  const canFail = SearchPrompt({ view: { ...view, canSubmit: false }, controls, cards: [] })
  expect(named(canFail, 'Submit search').props.disabled).toBe(true)
  expect(named(canFail, 'Fail to find').props.disabled).toBeFalsy()
})

test('search waiting and read-only views disable named choices, submit and fail-to-find', () => {
  for (const state of ['read-only', 'waiting'] as const) {
    const tree = SearchPrompt({
      view: { ...view, waiting: state === 'waiting' },
      controls:
        state === 'read-only'
          ? null
          : { toggle: () => true, submit: async () => true, fail: async () => true },
      cards: [],
    })
    expect(candidate(tree, 110).props.disabled).toBe(true)
    expect(candidate(tree, 111).props.disabled).toBe(true)
    for (const name of ['Submit search', 'Fail to find']) {
      expect(named(tree, name).props.disabled).toBe(true)
    }
  }
})
