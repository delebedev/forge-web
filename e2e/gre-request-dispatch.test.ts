import { expect, test } from 'bun:test'
import type { Locator, Page } from '@playwright/test'
import { passUntil } from './gre-acceptance'
import { requestDispatch } from './gre-request-dispatch'
import type { ActionCompletionState } from './action-completion'

function fixture() {
  const horizon = { kind: 'actions', respId: 45, gameStateId: 29, promptKey: '29:45' }
  const state = {
    horizon: horizon as typeof horizon | null,
    connected: true,
    gameOver: false,
    presentationLagging: false,
    prompt: { waiting: false, interactionKey: 7 },
    diagnostics: { errorCount: 0 },
    stack: [{}] as object[],
    annotations: [],
    life: { opp: 40 },
    prioritySeat: 1,
    viewerSeat: 1,
  }
  const expected: ActionCompletionState = {
    request: 45,
    decision: JSON.stringify(horizon),
    interaction: 7,
    kind: 'actions',
    connected: true,
    terminal: false,
    waiting: false,
    lagging: false,
    stack: 1,
    errors: 0,
  }
  let clicks = 0
  let probes = 0
  let onProbe = () => {}
  let onEvaluate = () => {}
  const inBrowser = <T>(callback: () => T): T => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { __greState: () => state },
    })
    try {
      return callback()
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'window', original)
      } else {
        Reflect.deleteProperty(globalThis, 'window')
      }
    }
  }
  const button = {
    isConnected: true,
    matches: () => false,
    click: () => {
      clicks += 1
      state.life.opp = 39
      state.horizon = { ...horizon, respId: 49, gameStateId: 33, promptKey: '33:49' }
    },
  }
  const locator = (name: unknown = ''): Locator =>
    ({
      getByRole: (_role: string, options: { name: unknown }) => locator(options.name),
      locator: () => locator(),
      filter: () => locator(name),
      and: () => locator(name),
      first: () => locator(name),
      isVisible: async () => false,
      isEnabled: async () => {
        probes += 1
        onProbe()
        return name instanceof RegExp || name === 'Pass priority'
      },
      innerText: async () => String(state.life.opp),
      click: async () => button.click(),
      evaluate: async (
        callback: (element: unknown, argument: unknown) => unknown,
        argument: unknown,
      ) => {
        onEvaluate()
        return inBrowser(() => callback(button, argument))
      },
    }) as unknown as Locator
  const page = {
    evaluate: async (callback: (argument: unknown) => unknown, argument: unknown) =>
      inBrowser(() => callback(argument)),
    locator: () => locator(),
    getByRole: (_role: string, options: { name: unknown }) => locator(options.name),
    waitForTimeout: async () => {},
  } as unknown as Page
  return {
    state,
    expected,
    button,
    page,
    control: locator(/Pass/),
    clicks: () => clicks,
    probes: () => probes,
    onProbe: (callback: () => void) => {
      onProbe = callback
    },
    onEvaluate: (callback: () => void) => {
      onEvaluate = callback
    },
  }
}

test('pass-until does not pass an empty stack when the goal resolves during control probes', async () => {
  const f = fixture()
  f.onProbe(() => {
    f.state.life.opp = 39
    f.state.stack = []
    f.state.horizon = { kind: 'actions', respId: 49, gameStateId: 33, promptKey: '33:49' }
  })
  await passUntil(f.page, { opponent_life: 39, max_passes: 2 })
  expect(f.probes()).toBeGreaterThan(0)
  expect(f.clicks()).toBe(0)
})

test('pass-until still activates the unchanged request when its goal is not met', async () => {
  const f = fixture()
  await passUntil(f.page, { opponent_life: 39, max_passes: 2 })
  expect(f.clicks()).toBe(1)
})

test('pass-until priority still submits the initial request before accepting fresh priority', async () => {
  const f = fixture()
  await passUntil(f.page, { priority: 'ours', max_passes: 2 })
  expect(f.clicks()).toBe(1)
})

for (const retirement of [
  'replacement',
  'missing',
  'waiting',
  'lagging',
  'prompt',
  'disconnected',
  'terminal',
  'disabled',
] as const) {
  test(`dispatch rejects a ${retirement} decision after locator resolution`, async () => {
    const f = fixture()
    f.onEvaluate(() => {
      switch (retirement) {
        case 'replacement':
          f.state.horizon = { kind: 'actions', respId: 49, gameStateId: 33, promptKey: '33:49' }
          break
        case 'missing':
          f.state.horizon = null
          break
        case 'waiting':
          f.state.prompt.waiting = true
          break
        case 'lagging':
          f.state.presentationLagging = true
          break
        case 'prompt':
          f.state.prompt.interactionKey = 8
          break
        case 'disconnected':
          f.state.connected = false
          break
        case 'terminal':
          f.state.gameOver = true
          break
        case 'disabled':
          f.button.matches = () => true
          break
      }
    })
    expect(await requestDispatch(f.expected, async () => false)(f.control)).toBe(false)
    expect(f.clicks()).toBe(0)
  })
}
