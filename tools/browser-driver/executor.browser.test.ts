import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium, type Browser, type Page } from '@playwright/test'
import { DriverFailure, executeProposal } from './executor.ts'
import { launchInput, retireActiveMatch } from './run.ts'
import { driveMatch, requestBrowserAdvice } from './runner.ts'
import type { CopilotProposal, DecisionHorizon } from './types.ts'

let browser: Browser

before(async () => {
  browser = await chromium.launch({ headless: true })
})
after(async () => {
  await browser.close()
})

async function fixture(markup: string, horizon: DecisionHorizon): Promise<Page> {
  const page = await browser.newPage()
  await page.setContent(`<main data-board>${markup}</main>`)
  await page.evaluate((initial) => {
    const runtime = { matchId: 'match-1', horizon: initial, clicks: [] as string[] }
    Object.assign(window, {
      fixtureRuntime: runtime,
      __greState: () => ({
        matchId: runtime.matchId,
        horizon: runtime.horizon,
        prompt: { kind: runtime.horizon.kind },
        gameOver: false,
        outcome: null,
      }),
    })
    for (const button of document.querySelectorAll('button')) {
      button.addEventListener('click', () => runtime.clicks.push(button.id))
    }
  }, horizon)
  return page
}

const actionHorizon: DecisionHorizon = {
  kind: 'actions',
  promptKey: '8:11',
  gameStateId: 8,
  respId: 11,
}

function proposal(input: Partial<CopilotProposal>): CopilotProposal {
  return {
    intent: 'pass',
    promptType: 'ActionsAvailableReq_695e',
    seat: 1,
    promptKey: actionHorizon.promptKey,
    gameStateId: actionHorizon.gameStateId,
    respId: actionHorizon.respId,
    targets: [],
    targetGroups: {},
    blocks: [],
    modalGrpIds: [],
    manaTypes: [],
    distribution: [],
    combatDamageAssignments: [],
    groupAssignments: [],
    responseIds: [],
    ...input,
  }
}

void test('performs an ordinary card action by instance and action identities', async () => {
  const page = await fixture(
    `
    <button id="right" data-card="localized name" data-instance-id="42" data-action-tuples="1:0 1:ability:700 1:0:700">card</button>
    <button id="wrong" data-card="desired text" data-instance-id="43" data-action-tuples="1:0 1:ability:700 1:0:700">card</button>
  `,
    actionHorizon,
  )

  const result = await executeProposal(
    page,
    proposal({
      intent: 'cast',
      card: { instanceId: 42, kind: 'card', name: 'Different server name' },
      abilityGrpId: 700,
    }),
    { matchId: 'match-1', horizon: actionHorizon },
  )

  assert.deepEqual(
    result.actions.map((action) => action.control),
    ['card-action:42:1'],
  )
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    ['right'],
  )
  await page.close()
})

void test('applies one pending blocker from a complete multi-block proposal', async () => {
  const horizon: DecisionHorizon = {
    kind: 'blockers',
    promptKey: '9:20',
    gameStateId: 9,
    respId: 20,
  }
  const page = await fixture(
    `<section data-prompt="blockers">
      <div role="group" data-instance-id="100"><button id="selected" data-instance-id="200" aria-pressed="true">Block A</button></div>
      <div role="group" data-instance-id="101"><button id="pending" data-instance-id="201" aria-pressed="false">Block B</button></div>
      <button id="submit">Submit blockers</button>
    </section>`,
    horizon,
  )

  const result = await executeProposal(
    page,
    proposal({
      intent: 'block',
      promptKey: horizon.promptKey,
      gameStateId: horizon.gameStateId,
      respId: horizon.respId,
      blocks: [
        {
          blocker: { instanceId: 100, kind: 'card' },
          attacker: { instanceId: 200, kind: 'card' },
        },
        {
          blocker: { instanceId: 101, kind: 'card' },
          attacker: { instanceId: 201, kind: 'card' },
        },
      ],
    }),
    { matchId: 'match-1', horizon },
  )

  assert.deepEqual(
    result.actions.map((action) => action.control),
    ['block:101:201'],
  )
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    ['pending'],
  )
  await page.close()
})

void test('applies one pending attacker from a complete multi-attack proposal', async () => {
  const horizon: DecisionHorizon = {
    kind: 'attackers',
    promptKey: '9:19',
    gameStateId: 9,
    respId: 19,
  }
  const page = await fixture(
    `<section data-prompt="attackers">
      <button id="selected" data-option-index="0" data-instance-id="100" data-recipient="1:0:2:0" aria-pressed="true">Attack A</button>
      <button id="pending" data-option-index="1" data-instance-id="101" data-recipient="1:0:2:0" aria-pressed="false">Attack B</button>
      <button id="submit">Submit attackers</button>
    </section>`,
    horizon,
  )

  const result = await executeProposal(
    page,
    proposal({
      intent: 'attack',
      promptKey: horizon.promptKey,
      gameStateId: horizon.gameStateId,
      respId: horizon.respId,
      targets: [
        { instanceId: 100, kind: 'card' },
        { instanceId: 101, kind: 'card' },
      ],
    }),
    { matchId: 'match-1', horizon },
  )

  assert.deepEqual(
    result.actions.map((action) => action.control),
    ['attack:101'],
  )
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    ['pending'],
  )
  await page.close()
})

void test('attacks the opposing player when an attacker can also attack a planeswalker', async () => {
  const horizon: DecisionHorizon = {
    kind: 'attackers',
    promptKey: '9:19',
    gameStateId: 9,
    respId: 19,
  }
  const page = await fixture(
    `<section data-prompt="attackers">
      <button id="player" data-option-index="0" data-instance-id="703" data-recipient="1:0:2:0">Attack Opponent</button>
      <button id="planeswalker" data-option-index="0" data-instance-id="703" data-recipient="2:0:0:900">Attack Planeswalker</button>
    </section>`,
    horizon,
  )

  const result = await executeProposal(
    page,
    proposal({
      intent: 'attack',
      promptKey: horizon.promptKey,
      gameStateId: horizon.gameStateId,
      respId: horizon.respId,
      targets: [{ instanceId: 703, kind: 'card' }],
    }),
    { matchId: 'match-1', horizon },
  )

  assert.deepEqual(
    result.actions.map((action) => action.control),
    ['choice:703'],
  )
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    ['player'],
  )
  await page.close()
})

void test('a hidden exact action fails without clicking a visible alternative control', async () => {
  const page = await fixture(
    `
    <button hidden id="required" data-card="Card" data-instance-id="42" data-action-tuples="1:1:700">required alternative</button>
    <button id="base" data-card="Card" data-instance-id="42" data-action-tuples="1:0:700">base cast</button>
    <button id="other" data-card="Card" data-instance-id="42" data-action-tuples="1:1:701">other alternative</button>
  `,
    actionHorizon,
  )

  await assert.rejects(
    executeProposal(
      page,
      proposal({
        intent: 'cast_mdfc',
        card: { instanceId: 42, kind: 'card' },
        abilityGrpId: 700,
        alternativeGrpId: 900,
      }),
      { matchId: 'match-1', horizon: actionHorizon },
    ),
    (error: unknown) => error instanceof DriverFailure && error.classification === 'ui_missing',
  )
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    [],
  )
  await page.close()
})

void test('completes a local multi-selection before submitting the prompt', async () => {
  const promptHorizon: DecisionHorizon = {
    kind: 'selectN',
    promptKey: '9:12',
    gameStateId: 9,
    respId: 12,
  }
  const page = await fixture(
    `
    <section data-prompt="selectN">
      <button id="first" data-choice-id="101" data-instance-id="101">first</button>
      <button id="second" data-choice-id="102" data-instance-id="102">second</button>
      <button id="submit">Submit selection</button>
    </section>
  `,
    promptHorizon,
  )
  await page.locator('#submit').evaluate((button) =>
    button.addEventListener('click', () => {
      const runtime = (window as never as { fixtureRuntime: { horizon: DecisionHorizon } })
        .fixtureRuntime
      runtime.horizon = { kind: 'actions', promptKey: '10:13', gameStateId: 10, respId: 13 }
    }),
  )

  const result = await executeProposal(
    page,
    proposal({
      intent: 'select_n',
      promptType: 'SelectNreq',
      promptKey: '9:12',
      gameStateId: 9,
      respId: 12,
      targets: [
        { instanceId: 101, kind: 'card' },
        { instanceId: 102, kind: 'card' },
      ],
      responseIds: [101, 102],
    }),
    { matchId: 'match-1', horizon: promptHorizon },
  )

  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    ['first', 'second', 'submit'],
  )
  assert.equal(result.actions.at(-1)?.control, 'button:/Submit (selection|cost)/')
  await page.close()
})

void test('targets a player through the visible board plate identity', async () => {
  const promptHorizon: DecisionHorizon = {
    kind: 'targets',
    promptKey: '9:12',
    gameStateId: 9,
    respId: 12,
  }
  const page = await fixture(
    `
    <button id="opponent" aria-label="Target opponent" aria-pressed="false">3</button>
    <section data-prompt="targets"></section>
  `,
    promptHorizon,
  )

  const result = await executeProposal(
    page,
    proposal({
      intent: 'target',
      promptType: 'SelectTargetsReq_695e',
      promptKey: '9:12',
      gameStateId: 9,
      respId: 12,
      targets: [{ instanceId: 2, kind: 'player' }],
      targetGroups: { 0: [2] },
      responseIds: [2],
    }),
    { matchId: 'match-1', horizon: promptHorizon },
  )

  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    ['opponent'],
  )
  assert.deepEqual(
    result.actions.map((action) => action.control),
    ['button:Target opponent'],
  )
  await page.close()
})

void test('moves grouped cards by exact destination identity before submitting', async () => {
  const promptHorizon: DecisionHorizon = {
    kind: 'group',
    promptKey: '9:12',
    gameStateId: 9,
    respId: 12,
  }
  const page = await fixture(
    `
    <section data-prompt="group">
      <div data-instance-id="101">
        <button id="top" data-group-zone-type="1" data-group-sub-zone-type="1" aria-pressed="true">Top</button>
        <button id="bottom" data-group-zone-type="1" data-group-sub-zone-type="2" aria-pressed="false">Bottom</button>
      </div>
      <button id="submit">Submit groups</button>
    </section>
  `,
    promptHorizon,
  )

  const result = await executeProposal(
    page,
    proposal({
      intent: 'group',
      promptType: 'GroupReq_695e',
      promptKey: '9:12',
      gameStateId: 9,
      respId: 12,
      responseIds: [101],
      groupAssignments: [{ zoneType: 1, subZoneType: 2, instanceIds: [101] }],
    }),
    { matchId: 'match-1', horizon: promptHorizon },
  )

  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    ['bottom', 'submit'],
  )
  assert.deepEqual(
    result.actions.map((action) => action.control),
    ['group:101:1:2', 'button:Submit groups'],
  )
  await page.close()
})

void test('chooses a replacement effect by exact visible identity', async () => {
  const promptHorizon: DecisionHorizon = {
    kind: 'replacement',
    promptKey: '9:12',
    gameStateId: 9,
    respId: 12,
  }
  const page = await fixture(
    `
    <section data-prompt="replacement">
      <button id="first" data-replacement-effect-id="501">Fiery Temper</button>
      <button id="second" data-replacement-effect-id="502">Kitchen Imp</button>
    </section>
  `,
    promptHorizon,
  )

  const result = await executeProposal(
    page,
    proposal({
      intent: 'select_replacement',
      promptType: 'SelectReplacementReq',
      promptKey: '9:12',
      gameStateId: 9,
      respId: 12,
      replacementEffectId: 502,
    }),
    { matchId: 'match-1', horizon: promptHorizon },
  )

  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    ['second'],
  )
  assert.deepEqual(
    result.actions.map((action) => action.control),
    ['replacement:502'],
  )
  await page.close()
})

void test('rejects a stale proposal before any visible interaction', async () => {
  const page = await fixture('<button id="pass">Pass</button>', actionHorizon)

  await assert.rejects(
    executeProposal(page, proposal({ promptKey: '7:10', gameStateId: 7, respId: 10 }), {
      matchId: 'match-1',
      horizon: { kind: 'actions', promptKey: '7:10', gameStateId: 7, respId: 10 },
    }),
    (error: unknown) =>
      error instanceof DriverFailure && error.classification === 'advisor_unavailable',
  )
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    [],
  )
  await page.close()
})

void test('decision loop requires an accepted horizon change and records terminal loss distinctly', async () => {
  const first: DecisionHorizon = { kind: 'actions', promptKey: '1:1', gameStateId: 1, respId: 1 }
  const page = await fixture('<button id="pass">Pass</button>', first)
  await page.locator('#pass').evaluate((button) =>
    button.addEventListener('click', () => {
      const runtime = (
        window as never as {
          fixtureRuntime: {
            horizon: DecisionHorizon
            clicks: string[]
            gameOver?: boolean
            outcome?: { title: string; result: string }
          }
        }
      ).fixtureRuntime
      if (runtime.horizon.promptKey === '1:1') {
        runtime.horizon = { kind: 'actions', promptKey: '2:2', gameStateId: 2, respId: 2 }
      } else {
        runtime.gameOver = true
        runtime.outcome = { title: 'Defeat', result: 'loss' }
      }
      Object.assign(window, {
        __greState: () => ({
          matchId: 'match-1',
          horizon: runtime.horizon,
          prompt: { kind: runtime.horizon.kind },
          gameOver: runtime.gameOver ?? false,
          outcome: runtime.outcome ?? null,
        }),
      })
    }),
  )
  const proposals = [
    proposal({ promptKey: '1:1', gameStateId: 1, respId: 1 }),
    proposal({ promptKey: '2:2', gameStateId: 2, respId: 2 }),
  ]

  const result = await driveMatch(page, {
    maxActions: 3,
    timeoutMs: 2_000,
    progressTimeoutMs: 200,
    stallLimit: 1,
    getAdvice: async () => proposals.shift()!,
  })

  assert.equal(
    result.terminal.kind,
    'loss',
    JSON.stringify({
      terminal: result.terminal,
      runtime: await page.evaluate(
        () => (window as never as { fixtureRuntime: unknown }).fixtureRuntime,
      ),
    }),
  )
  assert.deepEqual(result.finalState?.outcome, { title: 'Defeat', result: 'loss' })
  assert.equal(result.finalState?.gameOver, true)
  assert.equal(result.decisions.length, 2)
  assert.deepEqual(
    result.decisions.map((decision) => decision.before.horizon?.promptKey),
    ['1:1', '2:2'],
  )
  await page.close()
})

void test('reobserves a terminal board when the runtime retires before advice', async () => {
  const page = await fixture('<button id="pass">Pass</button>', actionHorizon)

  const result = await driveMatch(page, {
    maxActions: 1,
    timeoutMs: 1_000,
    progressTimeoutMs: 100,
    stallLimit: 1,
    getAdvice: async () => {
      await page.evaluate(() => {
        ;(window as never as { __greState: () => unknown }).__greState = () => ({
          matchId: 'match-1',
          horizon: null,
          prompt: null,
          gameOver: true,
          outcome: { title: 'Defeat', result: 'loss' },
        })
      })
      throw new Error('No active browser game')
    },
  })

  assert.equal(result.terminal.kind, 'loss')
  assert.equal(result.decisions.length, 0)
  await page.close()
})

void test('surfaces a visible runtime failure when advice loses the active game', async () => {
  const page = await fixture(
    '<div id="failure" role="alert" style="display:none">Browser game stopped: engine detail</div><button id="pass">Pass</button>',
    actionHorizon,
  )

  const result = await driveMatch(page, {
    maxActions: 1,
    timeoutMs: 1_000,
    progressTimeoutMs: 100,
    stallLimit: 1,
    getAdvice: async () => {
      await page.locator('#failure').evaluate((alert) => {
        alert.style.display = 'block'
      })
      throw new Error('No active browser game')
    },
  })

  assert.equal(result.terminal.kind, 'failure')
  assert.equal(result.terminal.classification, 'environment')
  assert.match(result.terminal.message ?? '', /engine detail/)
  await page.close()
})

void test('decision loop classifies unchanged prompt identity as a stall', async () => {
  const page = await fixture('<button id="pass">Pass</button>', actionHorizon)

  const result = await driveMatch(page, {
    maxActions: 2,
    timeoutMs: 2_000,
    progressTimeoutMs: 25,
    stallLimit: 1,
    getAdvice: async () => proposal({}),
  })

  assert.equal(result.terminal.classification, 'stalled')
  assert.equal(result.decisions.length, 1)
  await page.close()
})

void test('reconsults after the browser horizon moves before any visible interaction', async () => {
  const page = await fixture('<button id="pass">Pass</button>', actionHorizon)
  const second: DecisionHorizon = { ...actionHorizon, kind: 'targets' }
  const third: DecisionHorizon = {
    kind: 'actions',
    promptKey: '10:13',
    gameStateId: 10,
    respId: 13,
  }
  await page.locator('#pass').evaluate(
    (button, next) =>
      button.addEventListener('click', () => {
        ;(
          window as never as { fixtureRuntime: { horizon: DecisionHorizon } }
        ).fixtureRuntime.horizon = next
      }),
    third,
  )
  let calls = 0

  const result = await driveMatch(page, {
    maxActions: 2,
    timeoutMs: 2_000,
    progressTimeoutMs: 200,
    stallLimit: 2,
    getAdvice: async () => {
      if (calls++ === 0) {
        await page.evaluate((next) => {
          ;(
            window as never as { fixtureRuntime: { horizon: DecisionHorizon } }
          ).fixtureRuntime.horizon = next
        }, second)
        return proposal({})
      }
      return proposal({
        promptKey: second.promptKey,
        gameStateId: second.gameStateId,
        respId: second.respId,
      })
    },
  })

  assert.equal(result.terminal.kind, 'budget')
  assert.equal(result.decisions[0]?.rejection?.classification, 'advisor_unavailable')
  assert.deepEqual(result.decisions[0]?.interactions, [])
  assert.equal(result.decisions[0]?.after?.horizon?.promptKey, second.promptKey)
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    ['pass'],
  )
  await page.close()
})

void test('reconsults when a visible control becomes unavailable before activation', async () => {
  const page = await fixture('<button id="pass">Pass</button>', actionHorizon)
  const next: DecisionHorizon = {
    kind: 'actions',
    promptKey: '10:13',
    gameStateId: 10,
    respId: 13,
  }
  await page.locator('#pass').evaluate(
    (button, horizon) =>
      button.addEventListener('click', () => {
        ;(
          window as never as { fixtureRuntime: { horizon: DecisionHorizon } }
        ).fixtureRuntime.horizon = horizon
      }),
    next,
  )
  let calls = 0

  const result = await driveMatch(page, {
    maxActions: 2,
    timeoutMs: 5_000,
    progressTimeoutMs: 200,
    stallLimit: 2,
    getAdvice: async () => {
      calls += 1
      await page.locator('#pass').evaluate((button, unavailable) => {
        button.style.pointerEvents = unavailable ? 'none' : 'auto'
      }, calls === 1)
      return proposal({})
    },
  })

  assert.equal(result.terminal.kind, 'budget')
  assert.equal(result.decisions[0]?.rejection?.classification, 'advisor_unavailable')
  assert.deepEqual(result.decisions[0]?.interactions, [])
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    ['pass'],
  )
  await page.close()
})

void test('stops repeated reconsults when the same visible control stays unavailable', async () => {
  const page = await fixture(
    '<button id="pass" style="pointer-events:none">Pass</button>',
    actionHorizon,
  )

  const result = await driveMatch(page, {
    maxActions: 20,
    timeoutMs: 10_000,
    progressTimeoutMs: 200,
    stallLimit: 2,
    getAdvice: async () => proposal({}),
  })

  assert.equal(result.terminal.classification, 'advisor_unavailable')
  assert.match(String(result.terminal.details?.['cause']), /locator\.click:/)
  assert.equal(result.decisions.length, 3)
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    [],
  )
  await page.close()
})

void test('bounds browser advice by the remaining run budget', async () => {
  const page = await browser.newPage()
  await page.setContent('<main data-board></main>')
  await page.evaluate(() => {
    window.__greBrowserAdvice = () => new Promise(() => undefined)
  })

  await assert.rejects(requestBrowserAdvice(page, 25), (error: unknown) => {
    assert.ok(error instanceof DriverFailure)
    assert.equal(error.classification, 'budget_exhausted')
    return true
  })
  await page.close()
})

void test('waits for the visible presentation before consulting advice', async () => {
  const page = await fixture('<button id="pass">Pass</button>', actionHorizon)
  const next: DecisionHorizon = {
    kind: 'actions',
    promptKey: '9:12',
    gameStateId: 9,
    respId: 12,
  }
  await page.evaluate((nextHorizon) => {
    const runtime = (
      window as never as {
        fixtureRuntime: { horizon: DecisionHorizon; presentationLagging?: boolean; gsId?: number }
      }
    ).fixtureRuntime
    runtime.presentationLagging = true
    runtime.gsId = 1
    const current = window.__greState!
    window.__greState = () => ({
      ...current()!,
      presentationLagging: runtime.presentationLagging,
      gsId: runtime.gsId,
    })
    setTimeout(() => {
      runtime.gsId = 2
    }, 10)
    setTimeout(() => {
      runtime.presentationLagging = false
    }, 50)
    document.querySelector('#pass')?.addEventListener('click', () => {
      runtime.horizon = nextHorizon
    })
  }, next)
  let calls = 0

  const result = await driveMatch(page, {
    maxActions: 1,
    timeoutMs: 2_000,
    progressTimeoutMs: 200,
    stallLimit: 2,
    getAdvice: async () => {
      calls += 1
      return proposal({})
    },
  })

  assert.equal(result.terminal.kind, 'budget')
  assert.equal(calls, 1)
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    ['pass'],
  )
  await page.close()
})

void test('assigns exact combat damage by assigner and recipient identities before submitting', async () => {
  const damageHorizon: DecisionHorizon = {
    kind: 'assignDamage',
    promptKey: '9:12',
    gameStateId: 9,
    respId: 12,
  }
  const page = await fixture(
    `<section data-prompt="assignDamage">
    <div data-damage-assigner-id="100">
      <div data-damage-recipient-id="200" data-assigned-damage="2"><button id="remove-200" aria-label="Remove 1 damage from Bear">-</button><button id="add-200" aria-label="Assign 1 damage to Bear">+</button></div>
      <div data-damage-recipient-id="2" data-assigned-damage="0"><button id="remove-2" aria-label="Remove 1 damage from Opponent">-</button><button id="add-2" aria-label="Assign 1 damage to Opponent" disabled>+</button></div>
    </div>
    <button id="submit">Assign damage</button>
  </section>`,
    damageHorizon,
  )
  await page.locator('[data-damage-recipient-id] button').evaluateAll((buttons) => {
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const row = button.closest('[data-damage-recipient-id]')!
        const current = Number(row.getAttribute('data-assigned-damage'))
        row.setAttribute(
          'data-assigned-damage',
          String(current + (button.getAttribute('aria-label')?.startsWith('Assign ') ? 1 : -1)),
        )
        const total = [...document.querySelectorAll('[data-damage-recipient-id]')].reduce(
          (sum, candidate) => sum + Number(candidate.getAttribute('data-assigned-damage')),
          0,
        )
        ;(document.querySelector('#add-2') as HTMLButtonElement).disabled = total >= 2
      })
    }
  })

  const result = await executeProposal(
    page,
    proposal({
      intent: 'assign_damage',
      promptType: 'AssignDamageReq',
      promptKey: '9:12',
      gameStateId: 9,
      respId: 12,
      combatDamageAssignments: [
        {
          assignerId: 100,
          recipients: [
            { recipientId: 2, amount: 1 },
            { recipientId: 200, amount: 1 },
          ],
        },
      ],
    }),
    { matchId: 'match-1', horizon: damageHorizon },
  )

  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    ['remove-200', 'add-2', 'submit'],
  )
  assert.deepEqual(
    result.actions.map((action) => action.control),
    ['combat-damage:100:200:-1', 'combat-damage:100:2:+1', 'button:Assign damage'],
  )
  await page.close()
})

void test('does not submit combat damage when advisor assignments are absent', async () => {
  const damageHorizon: DecisionHorizon = {
    kind: 'assignDamage',
    promptKey: '9:12',
    gameStateId: 9,
    respId: 12,
  }
  const page = await fixture(
    '<section data-prompt="assignDamage"><button id="submit">Assign damage</button></section>',
    damageHorizon,
  )
  await assert.rejects(
    executeProposal(
      page,
      proposal({
        intent: 'assign_damage',
        promptType: 'AssignDamageReq',
        promptKey: '9:12',
        gameStateId: 9,
        respId: 12,
      }),
      { matchId: 'match-1', horizon: damageHorizon },
    ),
    (error: unknown) =>
      error instanceof DriverFailure && error.classification === 'driver_unsupported',
  )
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    [],
  )
  await page.close()
})

void test('does not treat a missing visible combat-damage amount as zero', async () => {
  const damageHorizon: DecisionHorizon = {
    kind: 'assignDamage',
    promptKey: '9:12',
    gameStateId: 9,
    respId: 12,
  }
  const page = await fixture(
    `<section data-prompt="assignDamage">
    <div data-damage-assigner-id="100"><div data-damage-recipient-id="2"><button aria-label="Assign 1 damage to Opponent">+</button></div></div>
    <button id="submit">Assign damage</button>
  </section>`,
    damageHorizon,
  )
  await assert.rejects(
    executeProposal(
      page,
      proposal({
        intent: 'assign_damage',
        promptType: 'AssignDamageReq',
        promptKey: '9:12',
        gameStateId: 9,
        respId: 12,
        combatDamageAssignments: [{ assignerId: 100, recipients: [{ recipientId: 2, amount: 1 }] }],
      }),
      { matchId: 'match-1', horizon: damageHorizon },
    ),
    (error: unknown) => error instanceof DriverFailure && error.classification === 'ui_missing',
  )
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    [],
  )
  await page.close()
})

void test('reports an unrecognized game-over outcome as a failure with final state', async () => {
  const page = await browser.newPage()
  await page.setContent('<main data-board></main>')
  for (const outcome of [
    null,
    { title: 'Pending', result: 'pending_win' },
    { title: 'Withdrawn', result: 'withdrawn' },
  ]) {
    await page.evaluate(
      (outcome) =>
        Object.assign(window, {
          __greState: () => ({
            matchId: 'match-1',
            horizon: null,
            prompt: { kind: 'gameOver' },
            gameOver: true,
            outcome,
          }),
        }),
      outcome,
    )

    const result = await driveMatch(page, {
      maxActions: 2,
      timeoutMs: 2_000,
      progressTimeoutMs: 25,
      stallLimit: 1,
      getAdvice: async () => proposal({}),
    })

    assert.equal(result.terminal.kind, 'failure')
    assert.equal(result.terminal.classification, 'environment')
    assert.equal(result.terminal.details?.['state'], result.finalState)
  }
  await page.close()
})

void test('classifies a prompt without an executable horizon as unsupported', async () => {
  const page = await browser.newPage()
  await page.setContent(
    '<main data-board><section data-prompt="unsupported">Unsupported choice</section></main>',
  )
  await page.evaluate(() =>
    Object.assign(window, {
      __greState: () => ({
        matchId: 'match-1',
        horizon: null,
        prompt: { kind: 'unsupported' },
        gameOver: false,
        outcome: null,
      }),
    }),
  )

  const result = await driveMatch(page, {
    maxActions: 2,
    timeoutMs: 2_000,
    progressTimeoutMs: 25,
    stallLimit: 1,
    getAdvice: async () => proposal({}),
  })

  assert.equal(result.terminal.classification, 'driver_unsupported')
  assert.equal(result.matchId, 'match-1')
  assert.equal(result.finalState?.matchId, 'match-1')
  assert.equal(
    (result.terminal.details?.['state'] as { prompt?: { kind?: string } })?.prompt?.kind,
    'unsupported',
  )
  await page.close()
})

void test('decision loop retains a failed proposal when its required control is missing', async () => {
  const page = await fixture('<button id="pass">Pass</button>', actionHorizon)
  const missing = proposal({ intent: 'cast', card: { instanceId: 404, kind: 'card' } })

  const result = await driveMatch(page, {
    maxActions: 2,
    timeoutMs: 2_000,
    progressTimeoutMs: 25,
    stallLimit: 1,
    getAdvice: async () => missing,
  })

  assert.equal(result.terminal.classification, 'ui_missing')
  assert.equal(result.terminal.details?.['description'], 'card-action:404:1')
  assert.ok(Array.isArray(result.terminal.details?.['visibleControls']))
  assert.equal(result.decisions.length, 1)
  assert.equal(result.decisions[0]?.proposal.card?.instanceId, 404)
  assert.deepEqual(result.decisions[0]?.interactions, [])
  assert.deepEqual(
    await page.evaluate(
      () => (window as never as { fixtureRuntime: { clicks: string[] } }).fixtureRuntime.clicks,
    ),
    [],
  )
  await page.close()
})

void test('decision loop reports a visible match-start failure instead of timing out', async () => {
  const page = await browser.newPage()
  await page.setContent(
    '<section role="alert"><strong>Match could not start</strong><p>Start game failed: 403</p></section>',
  )

  const result = await driveMatch(page, {
    maxActions: 2,
    timeoutMs: 2_000,
    progressTimeoutMs: 25,
    stallLimit: 1,
    getAdvice: async () => proposal({}),
  })

  assert.equal(result.terminal.classification, 'environment')
  assert.match(result.terminal.message ?? '', /403/)
  await page.close()
})

void test('candidate trial time does not consume the visible entry budget', async () => {
  const page = await browser.newPage()
  await page.route('http://driver.test/challenges', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `
      <label for="candidate">Puzzle text</label><textarea id="candidate"></textarea>
      <button id="validate">Validate puzzle</button>
      <button id="trial">Try engine</button>
      <button id="play">Play candidate</button>
      <div id="results"></div>
      <script>
        document.getElementById('validate').onclick = () => { document.getElementById('results').innerHTML = '<section aria-label="Engine validation"><strong>Position loaded by the engine</strong><p>Candidate · 1 cards. Ready.</p></section>' }
        document.getElementById('trial').onclick = () => setTimeout(() => { document.getElementById('results').insertAdjacentHTML('beforeend', '<section aria-label="Engine trial result"><strong>Time budget reached</strong><p>0 decisions · 30.0 seconds.</p></section>') }, 1200)
        document.getElementById('play').onclick = () => history.pushState(null, '', '/match/candidate')
      </script>
    `,
    }),
  )

  const result = await launchInput(
    page,
    'http://driver.test',
    {
      kind: 'candidate',
      sourcePath: '/tmp/candidate.pzl',
      puzzleText: 'candidate',
      tryEngine: true,
    },
    Date.now() + 1000,
  )

  assert.equal(result?.engineTrial.attempted, true)
  assert.equal(result?.engineTrial.solved, false)
  assert.match(result?.engineTrial.observed ?? '', /Time budget reached/)
  assert.match(page.url(), /\/match\/candidate$/)
  await page.close()
})

void test('visible match cleanup waits for the product Return transition', async () => {
  const page = await browser.newPage()
  await page.route('http://driver.test/match/one', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<button onclick="setTimeout(() => location.href=\'/challenges\', 20)">← Return to Challenges</button>',
    }),
  )
  await page.route('http://driver.test/challenges', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Challenges</h1>' }),
  )
  await page.goto('http://driver.test/match/one')

  await retireActiveMatch(page, 500)

  assert.equal(new URL(page.url()).pathname, '/challenges')
  await page.close()
})

void test('visible match cleanup reports a failed Return transition', async () => {
  const page = await browser.newPage()
  await page.route('http://driver.test/match/two', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<button id="return-control">← Return to Challenges</button><script>document.getElementById('return-control').onclick = () => document.body.insertAdjacentHTML('beforeend', '<section role="alert"><strong>Could not leave the match</strong><p>server failed</p></section>')</script>`,
    }),
  )
  await page.goto('http://driver.test/match/two')

  await assert.rejects(
    retireActiveMatch(page, 500),
    (error: unknown) =>
      error instanceof DriverFailure &&
      error.classification === 'environment' &&
      /server failed/.test(error.message),
  )
  assert.equal(new URL(page.url()).pathname, '/match/two')
  await page.close()
})

void test('match cleanup stops when no visible lifecycle control exists', async () => {
  const page = await browser.newPage()
  await page.route('http://driver.test/match/three', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<main data-board><button>Pass</button></main>',
    }),
  )
  await page.goto('http://driver.test/match/three')

  await assert.rejects(
    retireActiveMatch(page, 50),
    (error: unknown) => error instanceof DriverFailure && error.classification === 'ui_missing',
  )
  assert.equal(new URL(page.url()).pathname, '/match/three')
  await page.close()
})
