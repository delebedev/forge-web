import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import type { CastingControls } from '@engine/runtime/prompts/family'
import { expect, test } from 'bun:test'
import { ACTION_CAST, type CardView, type LegalAction } from '@engine/state/gre-state'

Object.defineProperty(globalThis, 'location', {
  configurable: true,
  value: new URL('http://localhost'),
})

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: globalThis,
})

const { greStore } = await import('@engine/runtime/gre-store')
const { greSession } = await import('@engine/runtime/gre-session')
const { installGreDebugBridge } = await import('./gre-debug-bridge')

test('state exposes only the active match and exact decision horizon needed by a browser driver', () => {
  const originalMatchId = greStore.currentMatchId
  const originalPrompt = greStore.prompt
  const originalConnected = greStore.connected
  const originalStatus = greStore.status
  const originalHorizon = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(greStore),
    'decisionHorizon',
  )
  greStore.currentMatchId = 'match-driver'
  greStore.prompt = { kind: 'unsupported', interactionKey: 23, message: 'Choice' }
  greStore.connected = true
  greStore.status = 'playing'
  Object.defineProperty(greStore, 'decisionHorizon', {
    configurable: true,
    value: { kind: 'actions', promptKey: '8:11', gameStateId: 8, respId: 11 },
  })
  installGreDebugBridge()

  try {
    expect(window.__greState()).toMatchObject({
      matchId: 'match-driver',
      prompt: { interactionKey: 23 },
      horizon: { kind: 'actions', promptKey: '8:11', gameStateId: 8, respId: 11 },
      presentationLagging: false,
      positionKey: expect.any(String),
    })
  } finally {
    delete (greStore as unknown as { decisionHorizon?: unknown }).decisionHorizon
    if (originalHorizon) {
      Object.defineProperty(Object.getPrototypeOf(greStore), 'decisionHorizon', originalHorizon)
    }
    greStore.currentMatchId = originalMatchId
    greStore.prompt = originalPrompt
    greStore.connected = originalConnected
    greStore.status = originalStatus
  }
})

const debugCard: CardView = {
  instanceId: 101,
  grpId: 7,
  name: 'Command',
  typeLine: 'Sorcery',
  manaCost: '{1}',
  powerToughness: '',
  tapped: false,
  attacking: false,
  playableLand: false,
  playableSpell: true,
  playableActivation: false,
  imageUrl: '',
  controllerSeatId: 1,
}

function debugAction(label: string, abilityGrpId: number): LegalAction {
  return {
    actionType: ACTION_CAST,
    instanceId: debugCard.instanceId,
    grpId: debugCard.grpId,
    facetId: 0,
    abilityGrpId,
    uniqueAbilityId: 0,
    sourceId: 0,
    alternativeGrpId: 0,
    alternativeSourceZcid: 0,
    zoneType: 2,
    hasAlternativeCost: false,
    label,
    cardName: debugCard.name,
    shouldStop: true,
  }
}

test('card shortcuts reject ambiguous actions and defer to the exact action selector', async () => {
  const originalPerform = greStore.performLegalAction
  const actions = [debugAction('Cast first mode', 700), debugAction('Cast second mode', 701)]
  const performed: LegalAction[] = []
  Object.defineProperties(greStore, {
    hand: { configurable: true, value: [debugCard] },
    legalActions: { configurable: true, value: actions },
  })
  greStore.performLegalAction = async (action) => {
    performed.push(action)
  }
  installGreDebugBridge()

  try {
    expect(await window.__greAct('cast', 'Command')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Multiple actions'),
    })
    expect(await window.__greAct('action', 'Cast')).toMatchObject({
      ok: false,
      error: expect.stringContaining('No exact action'),
    })
    expect(await window.__greAct('action', 'Cast first mode')).toMatchObject({ ok: true })
    expect(performed).toEqual([actions[0]])
  } finally {
    delete (greStore as unknown as { hand?: CardView[] }).hand
    delete (greStore as unknown as { legalActions?: LegalAction[] }).legalActions
    greStore.performLegalAction = originalPerform
  }
})

test('casting debug actions stage locally, reject under-min submit, then wait for server progress', async () => {
  const originalPrompt = greStore.prompt
  const originalBinding = greStore.bindPrompt
  const diagnostics = (
    greStore as unknown as { diagnostics: { trafficStats: typeof greStore.trafficStats } }
  ).diagnostics
  const originalTraffic = diagnostics.trafficStats
  const option = {
    interactionKey: 1,
    ctoId: 2,
    optionType: 10,
    grpId: 90372,
    abilityGrpId: 173711,
    minSelect: 1,
    maxSelect: 2,
    selectionPayable: false,
    label: 'Spree',
    manaColors: [],
    selectedManaColor: null,
    modalOptions: [
      {
        index: 0,
        grpId: 171743,
        label: 'Destroy target artifact',
        additionalCost: '{1}',
        available: true,
        selectable: true,
        selected: false,
      },
      {
        index: 1,
        grpId: 171745,
        label: 'Destroy target creature',
        additionalCost: '{1}',
        available: true,
        selectable: false,
        selected: false,
      },
      {
        index: 0,
        grpId: 171744,
        label: 'Destroy target enchantment',
        additionalCost: '{1}',
        available: false,
        selectable: false,
        selected: false,
      },
    ],
    selectNOptions: [],
  }
  greStore.prompt = {
    interactionKey: 1,
    kind: 'castingOptions',
    message: 'Choose modes',
    castingOptions: [option],
  }
  let submits = 0
  const toggle: CastingControls['toggleModalOption'] = (_option, modal) => {
    modal.selected = true
    option.selectionPayable = true
    return true
  }
  const submit = async () => {
    submits += 1
    setTimeout(() => {
      greStore.prompt = null
      diagnostics.trafficStats = {
        ...diagnostics.trafficStats,
        recvMessages: diagnostics.trafficStats.recvMessages + 1,
      }
    }, 0)
    return true
  }
  greStore.bindPrompt = (view) =>
    view?.kind === 'castingOptions'
      ? {
          kind: 'castingOptions',
          view,
          controls: {
            toggleModalOption: toggle,
            submitModalOptions: submit,
          } as unknown as CastingControls,
        }
      : null
  installGreDebugBridge({ actionTimeoutMs: 100, pollMs: 0 })

  try {
    const underMin = await window.__greAct('casting', 0)
    expect(underMin.ok).toBe(false)
    expect(underMin.error).toContain('Choose 1–2 modes')
    expect(submits).toBe(0)

    const unavailable = await window.__greAct('casting', 0, 'enchantment')
    expect(unavailable.ok).toBe(false)
    expect(unavailable.error).toContain('unavailable')

    const unpayable = await window.__greAct('casting', 0, 'creature')
    expect(unpayable.ok).toBe(false)
    expect(unpayable.error).toContain('cannot be paid with the current selection')

    const staged = await window.__greActWait('casting', 0, 'artifact')
    expect(staged.ok).toBe(true)
    expect(staged.local).toBe(true)

    const submitted = await window.__greActWait('casting', 0)
    expect(submitted.ok).toBe(true)
    expect(submitted.local).toBeUndefined()
    expect(submitted.after?.diagnostics.traffic.recvMessages).toBe(
      (submitted.before?.diagnostics.traffic.recvMessages ?? 0) + 1,
    )
    expect(submits).toBe(1)
  } finally {
    greStore.prompt = originalPrompt
    greStore.bindPrompt = originalBinding
    diagnostics.trafficStats = originalTraffic
  }
})

test('installed action wait rejects a locally cleared prompt without inbound progress', async () => {
  const originalBind = greStore.bindPrompt
  const originalPrompt = greStore.prompt
  greStore.prompt = {
    interactionKey: 1,
    kind: 'mulligan',
    result: 'Keep or mulligan',
    message: 'Opening hand',
  }
  greStore.bindPrompt = () => ({
    kind: 'mulligan',
    view: {
      kind: 'mulligan',
      interactionKey: 1,
      message: 'Opening hand',
      result: 'Keep or mulligan',
    },
    controls: {
      mulligan: async () => true,
      keep: async () => {
        greStore.prompt = null
        return true
      },
    },
  })
  installGreDebugBridge({ actionTimeoutMs: 1, pollMs: 0 })

  try {
    const result = await window.__greActWait('keep')
    expect(result.ok).toBe(false)
    expect(result.before?.prompt?.kind).toBe('mulligan')
    expect(result.after?.prompt).toBeNull()
    expect(result.after?.diagnostics.traffic.recvMessages).toBe(
      result.before?.diagnostics.traffic.recvMessages,
    )
  } finally {
    greStore.bindPrompt = originalBind
    greStore.prompt = originalPrompt
  }
})

test('installed action wait ignores ambient inbound traffic after a local prompt clear', async () => {
  const originalBind = greStore.bindPrompt
  const originalPrompt = greStore.prompt
  const diagnostics = (
    greStore as unknown as { diagnostics: { trafficStats: typeof greStore.trafficStats } }
  ).diagnostics
  const originalTraffic = diagnostics.trafficStats
  greStore.prompt = {
    interactionKey: 1,
    kind: 'mulligan',
    result: 'Keep or mulligan',
    message: 'Opening hand',
  }
  greStore.bindPrompt = () => ({
    kind: 'mulligan',
    view: {
      kind: 'mulligan',
      interactionKey: 1,
      message: 'Opening hand',
      result: 'Keep or mulligan',
    },
    controls: {
      mulligan: async () => true,
      keep: async () => {
        greStore.prompt = null
        setTimeout(() => {
          diagnostics.trafficStats = {
            ...diagnostics.trafficStats,
            recvMessages: diagnostics.trafficStats.recvMessages + 1,
          }
        }, 0)
        return true
      },
    },
  })
  installGreDebugBridge({ actionTimeoutMs: 5, pollMs: 0 })

  try {
    const result = await window.__greActWait('keep')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('made no observable progress')
    expect(result.after?.prompt).toBeNull()
    expect(result.after?.diagnostics.traffic.recvMessages).toBe(
      (result.before?.diagnostics.traffic.recvMessages ?? 0) + 1,
    )
  } finally {
    greStore.bindPrompt = originalBind
    greStore.prompt = originalPrompt
    diagnostics.trafficStats = originalTraffic
  }
})

test('installed action wait ignores ambient inbound traffic with the same prompt', async () => {
  const originalBind = greStore.bindPrompt
  const originalPrompt = greStore.prompt
  const originalStatus = greStore.status
  const diagnostics = (
    greStore as unknown as { diagnostics: { trafficStats: typeof greStore.trafficStats } }
  ).diagnostics
  const originalTraffic = diagnostics.trafficStats
  greStore.prompt = {
    interactionKey: 1,
    kind: 'mulligan',
    result: 'Keep or mulligan',
    message: 'Opening hand',
  }
  greStore.bindPrompt = () => ({
    kind: 'mulligan',
    view: {
      kind: 'mulligan',
      interactionKey: 1,
      message: 'Opening hand',
      result: 'Keep or mulligan',
    },
    controls: {
      mulligan: async () => true,
      keep: async () => {
        diagnostics.trafficStats = {
          ...diagnostics.trafficStats,
          recvMessages: diagnostics.trafficStats.recvMessages + 1,
        }
        greStore.status = 'receiving GRE'
        return true
      },
    },
  })
  installGreDebugBridge({ actionTimeoutMs: 1, pollMs: 0 })

  try {
    const result = await window.__greActWait('keep')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('made no observable progress')
    expect(result.after?.diagnostics.traffic.recvMessages).toBe(
      (result.before?.diagnostics.traffic.recvMessages ?? 0) + 1,
    )
    expect(result.after?.prompt).toEqual(result.before?.prompt)
  } finally {
    greStore.bindPrompt = originalBind
    greStore.prompt = originalPrompt
    greStore.status = originalStatus
    diagnostics.trafficStats = originalTraffic
  }
})

test('installed action wait reports an inbound rejection as failure', async () => {
  const originalBind = greStore.bindPrompt
  const originalPrompt = greStore.prompt
  const diagnostics = (greStore as unknown as { diagnostics: { errorCount: number } }).diagnostics
  const originalErrorCount = diagnostics.errorCount
  greStore.prompt = {
    interactionKey: 1,
    kind: 'mulligan',
    result: 'Keep or mulligan',
    message: 'Opening hand',
  }
  greStore.bindPrompt = () => ({
    kind: 'mulligan',
    view: {
      kind: 'mulligan',
      interactionKey: 1,
      message: 'Opening hand',
      result: 'Keep or mulligan',
    },
    controls: {
      mulligan: async () => true,
      keep: async () => {
        diagnostics.errorCount += 1
        return true
      },
    },
  })
  installGreDebugBridge({ actionTimeoutMs: 100, pollMs: 0 })

  try {
    const result = await window.__greActWait('keep')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('was rejected')
    expect(result.after?.diagnostics.errorCount).toBe(
      (result.before?.diagnostics.errorCount ?? 0) + 1,
    )
  } finally {
    greStore.bindPrompt = originalBind
    greStore.prompt = originalPrompt
    diagnostics.errorCount = originalErrorCount
  }
})

test('installed action wait reports connection loss as failure', async () => {
  const originalBind = greStore.bindPrompt
  const originalConnected = greStore.connected
  const originalStatus = greStore.status
  greStore.connected = true
  greStore.status = 'connected'
  greStore.bindPrompt = () => ({
    kind: 'mulligan',
    view: {
      kind: 'mulligan',
      interactionKey: 1,
      message: 'Opening hand',
      result: 'Keep or mulligan',
    },
    controls: {
      mulligan: async () => true,
      keep: async () => {
        greStore.connected = false
        greStore.status = 'closed'
        return true
      },
    },
  })
  installGreDebugBridge({ actionTimeoutMs: 100, pollMs: 0 })

  try {
    const result = await window.__greActWait('keep')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('lost the GRE connection')
    expect(result.before?.connected).toBe(true)
    expect(result.after?.connected).toBe(false)
  } finally {
    greStore.bindPrompt = originalBind
    greStore.connected = originalConnected
    greStore.status = originalStatus
  }
})

test('installed start aborts a pending request and returns terminal evidence', async () => {
  const originalStart = greSession.connectBrowser
  const originalAttach = greStore.attachSource
  let signal: AbortSignal | null = null
  let attachments = 0
  greSession.connectBrowser = (_config, abortSignal) =>
    new Promise<string>((_resolve, reject) => {
      signal = abortSignal ?? null
      signal?.addEventListener('abort', () => reject(signal?.reason), { once: true })
    })
  greStore.attachSource = () => {
    attachments += 1
  }
  // Leave enough time for the pending local start to begin before timing out.
  installGreDebugBridge({ startTimeoutMs: 1000, pollMs: 0 })

  try {
    const result = await window.__greStart({ seat1Deck: '60 Mountain' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('made no observable progress')
    expect((signal as AbortSignal | null)?.aborted).toBe(true)
    expect(attachments).toBe(0)
    expect(result.after?.connected).toBe(false)
    expect(result.after?.status).toBe('closed')
  } finally {
    greSession.connectBrowser = originalStart
    greStore.attachSource = originalAttach
  }
})

test('installed start rejects initial state that disconnects before readiness', async () => {
  const originalStart = greSession.connectBrowser
  const originalPrompt = greStore.prompt
  const originalConnected = greStore.connected
  const originalStatus = greStore.status
  greSession.connectBrowser = async () => {
    greStore.prompt = {
      interactionKey: 1,
      kind: 'mulligan',
      result: 'Keep or mulligan',
      message: 'Opening hand',
    }
    greStore.connected = true
    greStore.status = 'connected'
    setTimeout(() => {
      greStore.connected = false
      greStore.status = 'closed'
    }, 0)
    return 'match-1'
  }
  installGreDebugBridge({ startTimeoutMs: 5, pollMs: 0 })

  try {
    const result = await window.__greStart({ seat1Deck: '60 Mountain' })
    expect(result.ok).toBe(false)
    expect(result.after?.connected).toBe(false)
    expect(result.after?.status).toBe('closed')
  } finally {
    greSession.connectBrowser = originalStart
    greStore.prompt = originalPrompt
    greStore.connected = originalConnected
    greStore.status = originalStatus
  }
})

test('installed start closes a connected socket when readiness times out', async () => {
  const originalStart = greSession.connectBrowser
  const originalConnected = greStore.connected
  const originalStatus = greStore.status
  greSession.connectBrowser = async () => {
    greStore.connected = true
    greStore.status = 'connected'
    return 'match-1'
  }
  installGreDebugBridge({ startTimeoutMs: 1, pollMs: 0 })

  try {
    const result = await window.__greStart({ seat1Deck: '60 Mountain' })
    expect(result.ok).toBe(false)
    expect(result.after?.connected).toBe(false)
    expect(result.after?.status).toBe('closed')
    expect(result.state?.connected).toBe(false)
  } finally {
    greSession.connectBrowser = originalStart
    greStore.connected = originalConnected
    greStore.status = originalStatus
  }
})

test('selection shortcuts cross real bound controls and reject unavailable submissions', async () => {
  const { promptHarness } = await import('@engine/runtime/prompts/prompt-test-harness')
  const originalPrompt = greStore.prompt
  const originalBinding = greStore.bindPrompt
  const host = promptHarness({
    publish: () => {
      greStore.prompt = host.owner.prompt
    },
  })
  host.owner.applyFamilyRequest({
    type: 22,
    msgId: 7,
    gameStateId: 8,
    selectNReq: { ids: [0, 4], listType: 3, staticList: 6, minSel: 1, maxSel: 1 },
  })
  greStore.prompt = host.owner.prompt
  greStore.bindPrompt = (view) => host.owner.bindPrompt(view)
  installGreDebugBridge()
  try {
    expect(await window.__greAct('submitSelectN')).toMatchObject({ ok: false })
    expect(await window.__greAct('selectN', 999)).toMatchObject({ ok: false })
    expect(await window.__greAct('selectN', 0)).toMatchObject({ ok: true })
    expect(viewFor(greStore, 'selectN').selectNCandidates?.[0]?.selected).toBe(true)
    expect(await window.__greAct('submitSelectN')).toMatchObject({ ok: true })
    expect(host.sent).toEqual([
      { type: 'SelectNresp', payload: { respId: 7, gameStateId: 8, selectNResp: { ids: [0] } } },
    ])
    expect(await window.__greAct('submitSelectN')).toMatchObject({ ok: false })
  } finally {
    greStore.prompt = originalPrompt
    greStore.bindPrompt = originalBinding
  }
})

test('target shortcuts invoke real bound controls and reject duplicate waiting input', async () => {
  const { promptHarness } = await import('@engine/runtime/prompts/prompt-test-harness')
  const originalPrompt = greStore.prompt
  const originalBinding = greStore.bindPrompt
  const host = promptHarness({
    publish: () => {
      greStore.prompt = host.owner.prompt
    },
  })
  host.owner.applyFamilyRequest({
    type: 34,
    msgId: 7,
    gameStateId: 8,
    selectTargetsReq: {
      targets: [
        {
          targetIdx: 1,
          minTargets: 1,
          maxTargets: 1,
          selectedTargets: 0,
          targets: [{ targetInstanceId: 101, legalAction: 1 }],
        },
      ],
    },
  })
  greStore.prompt = host.owner.prompt
  greStore.bindPrompt = (view) => host.owner.bindPrompt(view)
  installGreDebugBridge()
  try {
    expect(await window.__greAct('target', 999)).toMatchObject({ ok: false })
    expect(await window.__greAct('target', 101)).toMatchObject({ ok: true })
    expect(await window.__greAct('target', 101)).toMatchObject({ ok: false })
    expect(host.sent).toEqual([
      {
        type: 'SelectTargetsResp_097b',
        payload: {
          respId: 7,
          gameStateId: 8,
          selectTargetsResp: {
            target: {
              targetIdx: 1,
              minTargets: 1,
              maxTargets: 1,
              selectedTargets: 1,
              targets: [{ targetInstanceId: 101, legalAction: 1 }],
            },
          },
        },
      },
    ])
  } finally {
    greStore.prompt = originalPrompt
    greStore.bindPrompt = originalBinding
  }
})

test('combat shortcuts use current bound declarations including attack-all and reject waiting input', async () => {
  const { promptHarness } = await import('@engine/runtime/prompts/prompt-test-harness')
  const originalPrompt = greStore.prompt
  const originalBinding = greStore.bindPrompt
  const h = promptHarness({
    publish: () => {
      greStore.prompt = h.owner.prompt
    },
  })
  const attackers = (msgId: number) => ({
    type: 26,
    msgId,
    gameStateId: msgId,
    declareAttackersReq: {
      attackers: [
        { attackerInstanceId: 101, legalDamageRecipients: [{ type: 1, playerSystemSeatId: 2 }] },
      ],
    },
  })
  greStore.bindPrompt = (view) => h.owner.bindPrompt(view)
  installGreDebugBridge()
  const apply = (request: Parameters<typeof h.owner.applyFamilyRequest>[0]) => {
    h.owner.applyFamilyRequest(request)
    greStore.prompt = h.owner.prompt
  }
  try {
    apply(attackers(7))
    expect(await window.__greAct('attacker', 999)).toMatchObject({ ok: false })
    expect(await window.__greAct('attacker', 101)).toMatchObject({ ok: true })
    expect(await window.__greAct('submitAttackers')).toMatchObject({ ok: false })
    apply(attackers(8))
    expect(await window.__greAct('attackAll')).toMatchObject({ ok: true })
    expect(h.sent[1]).toMatchObject({ payload: { declareAttackersResp: { autoDeclare: true } } })
    apply(attackers(9))
    expect(await window.__greAct('submitAttackers')).toMatchObject({ ok: true })
    apply({
      type: 28,
      msgId: 10,
      gameStateId: 10,
      declareBlockersReq: { blockers: [{ blockerInstanceId: 101, attackerInstanceIds: [102] }] },
    })
    expect(await window.__greAct('block', 101, 999)).toMatchObject({ ok: false })
    expect(await window.__greAct('block', 101, 102)).toMatchObject({ ok: true })
    expect(await window.__greAct('submitBlockers')).toMatchObject({ ok: false })
    apply({ type: 28, msgId: 11, gameStateId: 11, declareBlockersReq: { blockers: [] } })
    expect(await window.__greAct('submitBlockers')).toMatchObject({ ok: true })
  } finally {
    greStore.prompt = originalPrompt
    greStore.bindPrompt = originalBinding
  }
})

test('damage debug edits and submission use current bound controls and reject missing or read-only input', async () => {
  const { promptHarness } = await import('@engine/runtime/prompts/prompt-test-harness')
  const originalPrompt = greStore.prompt
  const originalBinding = greStore.bindPrompt
  const h = promptHarness({
    publish: () => {
      greStore.prompt = h.owner.prompt
    },
  })
  greStore.bindPrompt = (view) => h.owner.bindPrompt(view)
  installGreDebugBridge()
  try {
    h.owner.applyFamilyRequest({
      type: 30,
      msgId: 7,
      gameStateId: 8,
      assignDamageReq: {
        damageAssigners: [
          {
            instanceId: 101,
            totalDamage: 2,
            assignments: [{ instanceId: 102, assignedDamage: 0 }],
          },
        ],
      },
    })
    greStore.prompt = h.owner.prompt
    expect(await window.__greAct('damage', 99, 0, 1)).toMatchObject({ ok: false })
    expect(await window.__greAct('submitDamage')).toMatchObject({ ok: false })
    expect(await window.__greAct('damage', 0, 0, 1)).toMatchObject({ ok: true })
    expect(await window.__greAct('damage', 0, 0, 1)).toMatchObject({ ok: true })
    expect(viewFor(h.owner, 'assignDamage').damageAssigners?.[0]?.assignedTotal).toBe(2)
    expect(await window.__greAct('submitDamage')).toMatchObject({ ok: true })
    expect(h.sent[0]).toMatchObject({
      type: 'AssignDamageResp_097b',
      payload: {
        gameStateId: 8,
        respId: 7,
        assignDamageResp: {
          assigners: [{ instanceId: 101, assignments: [{ instanceId: 102, assignedDamage: 2 }] }],
        },
      },
    })
    h.owner.applyFamilyRequest({
      type: 30,
      msgId: 8,
      gameStateId: 9,
      assignDamageReq: {
        damageAssigners: [
          {
            instanceId: 101,
            totalDamage: 2,
            assignments: [{ instanceId: 102, assignedDamage: 2 }],
          },
        ],
      },
    })
    greStore.prompt = h.owner.prompt
    h.readOnly()
    expect(await window.__greAct('damage', 0, 0, -1)).toMatchObject({ ok: false })
    expect(await window.__greAct('submitDamage')).toMatchObject({ ok: false })
    expect(h.sent).toHaveLength(1)
  } finally {
    greStore.prompt = originalPrompt
    greStore.bindPrompt = originalBinding
  }
})
