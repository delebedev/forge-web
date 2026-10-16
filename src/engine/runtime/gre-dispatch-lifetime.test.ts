import { viewFor } from '@engine/runtime/prompts/prompt-test-harness'
import { expect, test } from 'bun:test'
import { GreDispatch } from '@engine/runtime/gre-dispatch'
import {
  dispatchHost,
  promptHarness as harness,
  bindingFor,
  encodedPromptHarness,
  decodeGre,
} from './prompts/prompt-test-harness'
import type { ProtoObject } from '@engine/state/gre-state'
test('decision horizon exposes the exact pending prompt identity without response access', () => {
  const dispatch = new GreDispatch(dispatchHost())

  dispatch.applyFamilyRequest({
    type: 43,
    msgId: 17,
    gameStateId: 23,
    numericInputReq: { minValue: 0, maxValue: 3, stepSize: 1, numericInputType: 1 },
  })

  expect(dispatch.decisionHorizon).toEqual({
    kind: 'numericInput',
    promptKey: '23:17',
    gameStateId: 23,
    respId: 17,
  })
})

const delayedPromptResponses: Array<{
  name: string
  apply(dispatch: GreDispatch): void
  respond(dispatch: GreDispatch): Promise<void>
}> = [
  ...(['keep', 'mulligan'] as const).map((decision) => ({
    name: `mulligan ${decision}`,
    apply: (dispatch: GreDispatch) =>
      dispatch.applyFamilyRequest({ type: 15, msgId: 1, gameStateId: 41, mulliganReq: {} }),
    respond: async (dispatch: GreDispatch) => {
      await bindingFor(dispatch, 'mulligan').controls[decision]()
    },
  })),
  {
    name: 'casting',
    apply: (dispatch) =>
      dispatch.applyFamilyRequest({
        type: 46,
        msgId: 1,
        gameStateId: 41,
        castingTimeOptionsReq: { castingTimeOptionReq: [{ ctoId: 9, castingTimeOptionType: 1 }] },
      }),
    respond: async (dispatch) => {
      const bound = bindingFor(dispatch, 'castingOptions')
      await bound.controls.chooseCastingOption(bound.view.castingOptions[0]!)
    },
  },
  {
    name: 'replacement',
    apply: (dispatch) =>
      dispatch.applyFamilyRequest({
        type: 39,
        msgId: 1,
        gameStateId: 41,
        selectReplacementReq: {
          replacements: [
            {
              objectInstance: 101,
              uniqueAbilityId: 301,
              abilityGrpId: 401,
              affectedObject: 101,
              replacementEffectId: 501,
            },
          ],
        },
      }),
    respond: async (dispatch) => {
      await bindingFor(dispatch, 'replacement').controls.choose(501)
    },
  },
  {
    name: 'distribution',
    apply: (dispatch) =>
      dispatch.applyFamilyRequest({
        type: 42,
        msgId: 1,
        gameStateId: 41,
        distributionReq: {
          minAmount: 1,
          maxAmount: 1,
          minPerTarget: 1,
          targetIds: [101],
          validSelectedTargetIds: [101],
        },
      }),
    respond: async (dispatch) => {
      await bindingFor(dispatch, 'distribution').controls.submit()
    },
  },

  {
    name: 'damage assignment',
    apply: (dispatch) =>
      dispatch.applyFamilyRequest({
        type: 30,
        msgId: 1,
        gameStateId: 41,
        assignDamageReq: {
          damageAssigners: [
            {
              instanceId: 1,
              totalDamage: 1,
              assignments: [{ instanceId: 2, minDamage: 0, maxDamage: 1, assignedDamage: 1 }],
            },
          ],
        },
      }),
    respond: async (dispatch) => {
      await bindingFor(dispatch, 'assignDamage').controls.submit()
    },
  },
  {
    name: 'group',
    apply: (dispatch) =>
      dispatch.applyFamilyRequest({
        type: 11,
        msgId: 1,
        gameStateId: 41,
        groupReq: { instanceIds: [101], groupSpecs: [{ lowerBound: 0, upperBound: 1 }] },
      }),
    respond: async (dispatch) => {
      await bindingFor(dispatch, 'group').controls.submit()
    },
  },
  {
    name: 'order',
    apply: (dispatch) => {
      dispatch.applyFamilyRequest({ type: 17, msgId: 1, gameStateId: 41, orderReq: { ids: [101] } })
      bindingFor(dispatch, 'order').controls.toggle(101)
    },
    respond: async (dispatch) => {
      await bindingFor(dispatch, 'order').controls.submit()
    },
  },
  {
    name: 'optional action',
    apply: (dispatch) =>
      dispatch.applyFamilyRequest({
        type: 45,
        optionalActionMessage: {},
        msgId: 1,
        gameStateId: 41,
      }),
    respond: async (dispatch) => {
      await bindingFor(dispatch, 'optionalAction').controls.respond(true)
    },
  },
  {
    name: 'numeric input',
    apply: (dispatch) =>
      dispatch.applyFamilyRequest({
        type: 43,
        msgId: 1,
        gameStateId: 41,
        numericInputReq: { minValue: 0, maxValue: 2, stepSize: 1, numericInputType: 1 },
      }),
    respond: async (dispatch) => {
      await bindingFor(dispatch, 'numericInput').controls.submit()
    },
  },
  {
    name: 'SelectN',
    apply: (dispatch) =>
      dispatch.applyFamilyRequest({
        type: 22,
        msgId: 1,
        gameStateId: 41,
        selectNReq: { minSel: 0, maxSel: 1, ids: [] },
      }),
    respond: async (dispatch) => {
      await bindingFor(dispatch, 'selectN').controls.submit()
    },
  },
  {
    name: 'effect-cost SelectN',
    apply: (dispatch) =>
      dispatch.applyFamilyRequest({
        type: 36,
        msgId: 1,
        gameStateId: 41,
        payCostsReq: {
          effectCostReq: { effectCostType: 1, costSelection: { minSel: 0, maxSel: 1, ids: [] } },
        },
      }),
    respond: async (dispatch) => {
      await bindingFor(dispatch, 'selectN').controls.submit()
    },
  },
  {
    name: 'GatherCounters',
    apply: (dispatch) =>
      dispatch.applyFamilyRequest({
        type: 36,
        msgId: 1,
        gameStateId: 41,
        payCostsReq: {
          paymentActions: {},
          effectCostReq: {
            effectCostType: 5,
            gatherReq: {
              amountToGather: 2,
              sources: [{ sourceId: 1, minAmount: 2, maxAmount: 2 }],
            },
          },
        },
      }),
    respond: async (dispatch) => {
      await bindingFor(dispatch, 'payCosts').controls.submit()
    },
  },
  {
    name: 'search',
    apply: (dispatch) =>
      dispatch.applyFamilyRequest({
        type: 44,
        msgId: 1,
        gameStateId: 41,
        searchReq: { allowFailToFind: 1, itemsSought: [], itemsToSearch: [] },
      }),
    respond: async (dispatch) => {
      await bindingFor(dispatch, 'search').controls.fail()
    },
  },
]

for (const scenario of delayedPromptResponses) {
  test(`${scenario.name} response preserves the request game state`, async () => {
    let currentGameStateId = 41
    let sent: ProtoObject | null = null
    const dispatch = new GreDispatch(
      dispatchHost({
        gameStateId: () => currentGameStateId,
        sendGreResponse: (_type, payload) => {
          sent = payload
          return Promise.resolve(true)
        },
      }),
    )

    scenario.apply(dispatch)
    currentGameStateId = 99
    await scenario.respond(dispatch)

    expect(sent).toMatchObject({ gameStateId: 41, respId: 1 })
  })

  test(`${scenario.name} response cannot send or retire a replacement prompt`, async () => {
    const h = encodedPromptHarness({}, { deferDelivery: true })
    const dispatch = h.owner
    scenario.apply(dispatch)
    const response = scenario.respond(dispatch)
    const delivery = await h.waitForDelivery()
    dispatch.applyFamilyRequest({ type: 45, optionalActionMessage: {}, msgId: 2 })
    dispatch.refreshPendingPrompts()
    delivery.release()
    await response

    expect(await delivery.result).toBe(false)
    expect(h.sent).toHaveLength(0)
    expect(dispatch.prompt).toMatchObject({ kind: 'optionalAction', interactionKey: 2 })
  })

  test(`${scenario.name} response rejects a duplicate and restores a rejected current prompt`, async () => {
    const h = encodedPromptHarness({}, { deferDelivery: true })
    const dispatch = h.owner
    scenario.apply(dispatch)
    const canSubmit = dispatch.prompt?.canSubmit
    const first = scenario.respond(dispatch)
    const delivery = await h.waitForDelivery()
    expect(dispatch.prompt).toMatchObject({ waiting: true, canSubmit: false })
    dispatch.refreshPendingPrompts()
    expect(dispatch.prompt).toMatchObject({ waiting: true, canSubmit: false })
    await scenario.respond(dispatch)
    expect(h.sent).toHaveLength(0)

    delivery.release(false)
    await first
    expect(dispatch.prompt).toMatchObject({ waiting: false })
    expect(dispatch.prompt?.canSubmit).toBe(canSubmit)
  })
}

const numeric = (msgId = 1) => ({
  type: 43,
  msgId,
  gameStateId: 10,
  numericInputReq: {
    numericInputType: 1,
    minValue: 0,
    maxValue: 4,
    stepSize: 1,
    disallowedValues: [1, 3],
  },
})

test('metadata cannot revive a legacy target over the family and retired family stays retired', () => {
  const { owner } = harness()
  owner.applyFamilyRequest({
    type: 34,
    msgId: 8,
    gameStateId: 9,
    selectTargetsReq: { targets: [] },
  })
  owner.applyFamilyRequest(numeric())
  bindingFor(owner, 'numericInput').controls.adjust(1)
  owner.refreshPendingPrompts()
  expect(owner.prompt).toMatchObject({ kind: 'numericInput', numericValue: 2 })
  owner.prompt = null
  owner.refreshPendingPrompts()
  expect(owner.prompt).toBeNull()
})

test('numeric controls stay retired across a legacy interaction and another numeric request', async () => {
  const { owner, sent } = harness()
  owner.applyFamilyRequest(numeric())
  const old = bindingFor(owner, 'numericInput').controls
  owner.applyFamilyRequest({
    type: 34,
    msgId: 8,
    gameStateId: 9,
    selectTargetsReq: { targets: [] },
  })
  owner.applyFamilyRequest(numeric(2))
  expect(old.adjust(1)).toBe(false)
  expect(await old.submit()).toBe(false)
  expect(owner.prompt).toMatchObject({ numericValue: 0 })
  expect(sent).toEqual([])
})

test('delayed family submission cannot publish or retire after its source changes', async () => {
  let finish!: () => void
  const { owner, observed, nextSource } = harness({
    sendGreResponse: async (_type, _payload, _generation, current) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return current!()
    },
  })
  owner.applyFamilyRequest(numeric())
  const pending = bindingFor(owner, 'numericInput').controls.submit()
  const waiting = owner.prompt
  const publications = observed.length
  nextSource()
  finish()
  expect(await pending).toBe(false)
  expect(owner.prompt).toBe(waiting)
  expect(observed).toHaveLength(publications)
})

test(`numeric controls cannot edit or submit a replacement, reset, or new source`, async () => {
  for (const retire of [
    'replacement',
    'reset',
    'source',
    'clear',
    'legacy',
    'other-family',
    'unsupported',
  ] as const) {
    const { owner, nextSource, sent } = harness()
    owner.applyFamilyRequest(numeric())
    const binding = bindingFor(owner, 'numericInput')
    if (retire === 'replacement') {
      owner.applyFamilyRequest(numeric(2))
    }
    if (retire === 'reset') {
      owner.reset()
    }
    if (retire === 'source') {
      nextSource()
    }
    if (retire === 'clear') {
      owner.prompt = null
    }
    if (retire === 'legacy') {
      owner.applyFamilyRequest({ type: 34, msgId: 8, selectTargetsReq: { targets: [] } })
    }
    if (retire === 'other-family') {
      owner.applyFamilyRequest({ type: 45, msgId: 8, optionalActionMessage: {} })
    }
    if (retire === 'unsupported') {
      owner.applyFamilyRequest({ type: 49, searchFromGroupsReq: {} })
    }
    const current = owner.prompt
    expect(binding.controls.adjust(1)).toBe(false)
    expect(await binding.controls.submit()).toBe(false)
    expect(owner.prompt).toBe(current)
    expect(sent).toEqual([])
    if (retire === 'clear') {
      owner.refreshPendingPrompts()
      expect(owner.prompt).toBeNull()
    }
  }
})
test(`numeric binds only the published value and offers no read-only controls`, () => {
  const { owner, readOnly } = harness()
  owner.applyFamilyRequest(numeric())
  const view = owner.prompt!
  expect(owner.bindPrompt({ ...view })).toBeNull()
  expect(owner.bindPrompt(null)).toBeNull()
  const controls = bindingFor(owner, 'numericInput').controls
  readOnly()
  expect(controls.adjust(1)).toBe(false)
  expect(owner.bindPrompt(view)?.controls).toBeNull()
})

test('spectator bindings have no controls and old read-only controls cannot submit', async () => {
  const { owner, readOnly, sent } = harness()
  owner.applyFamilyRequest(numeric())
  const old = bindingFor(owner, 'numericInput').controls
  readOnly()
  expect(await old.submit()).toBe(false)
  expect(sent).toEqual([])
  const spectator = harness({ isSpectatorMode: () => true }).owner
  spectator.applyFamilyRequest(numeric())
  expect(spectator.bindPrompt(spectator.prompt)?.controls).toBeNull()
})
for (const failure of ['rejected', 'exception'] as const) {
  test(`shared family ${failure} restores the same draft, blocks edits/duplicates and publishes retry/retirement`, async () => {
    let finish!: () => void
    let attempts = 0
    const { owner, published } = harness({
      sendGreResponse: async () => {
        if (++attempts > 1) {
          return true
        }
        await new Promise<void>((resolve) => {
          finish = resolve
        })
        if (failure === 'exception') {
          throw new Error('delivery failed')
        }
        return false
      },
    })
    owner.applyFamilyRequest(numeric())
    const bound = bindingFor(owner, 'numericInput')
    bound.controls.adjust(1)
    const pending = bound.controls.submit()
    owner.refreshPendingPrompts()
    expect(owner.prompt).toMatchObject({ waiting: true, canSubmit: false, numericValue: 2 })
    expect(bound.controls.adjust(1)).toBe(false)
    expect(await bound.controls.submit()).toBe(false)
    expect(attempts).toBe(1)
    finish()
    if (failure === 'exception') {
      expect(await pending.catch((e: Error) => e.message)).toBe('delivery failed')
    } else {
      expect(await pending).toBe(false)
    }
    expect(owner.prompt).toMatchObject({ waiting: false, canSubmit: true, numericValue: 2 })
    expect(await bound.controls.submit()).toBe(true)
    expect(owner.prompt).toBeNull()
    owner.refreshPendingPrompts()
    expect(owner.prompt).toBeNull()
    expect(published.map((p) => (p ? !!p.waiting : null))).toEqual([false, true, false, true, null])
  })
}
test('late successful host completion cannot retire a same-family replacement', async () => {
  let finish!: () => void
  let fresh = true
  const { owner } = harness({
    sendGreResponse: async (_type, _payload, _source, current) => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      fresh = current!()
      return true
    },
  })
  owner.applyFamilyRequest(numeric())
  const old = bindingFor(owner, 'numericInput').controls
  const pending = old.submit()
  owner.applyFamilyRequest(numeric(2))
  const newer = owner.prompt
  finish()
  expect(await pending).toBe(false)
  expect(fresh).toBe(false)
  expect(owner.prompt).toBe(newer)
})

const abortableCasting = (msgId = 7) => ({
  type: 46,
  msgId,
  gameStateId: 23,
  allowCancel: 2,
  castingTimeOptionsReq: { castingTimeOptionReq: [{ ctoId: 9, castingTimeOptionType: 1 }] },
})

test('family cancellation encodes no response id, waits for state, and rejection restores only its interaction', async () => {
  const { owner, sent, published } = encodedPromptHarness()
  owner.applyFamilyRequest(abortableCasting())
  const bound = bindingFor(owner, 'castingOptions')
  expect(await bound.controls.cancel()).toBe(true)
  const decoded = await decodeGre(sent[0])
  expect(decoded).toMatchObject({ gameStateId: 23 })
  expect(decoded['respId']).toBeUndefined()
  expect(owner.decisionHorizon?.respId).toBe(7)
  owner.refreshPendingPrompts()
  expect(owner.prompt).toMatchObject({ waiting: true })
  expect(await bound.controls.cancel()).toBe(false)
  owner.rejectPromptResponse()
  expect(owner.prompt).toMatchObject({ waiting: false, interactionKey: bound.view.interactionKey })
  expect(await bound.controls.cancel()).toBe(true)
  owner.retireCancelledAction()
  expect(owner.prompt).toBeNull()
  expect(await bound.controls.cancel()).toBe(false)
  expect(published.map((view) => view?.waiting)).toEqual([true, false, true])
  owner.applyFamilyRequest(abortableCasting(8))
  const successor = owner.prompt
  owner.rejectPromptResponse()
  owner.retireCancelledAction()
  expect(owner.prompt).toBe(successor)
})

for (const kind of ['castingOptions', 'selectN', 'targets', 'payCosts'] as const) {
  const request = (msgId = 7): ProtoObject =>
    kind === 'payCosts'
      ? {
          type: 36,
          msgId,
          gameStateId: 23,
          payCostsReq: {
            effectCostReq: {
              effectCostType: 5,
              gatherReq: {
                amountToGather: 1,
                sources: [{ sourceId: 101, minAmount: 1, maxAmount: 1 }],
              },
            },
          },
        }
      : kind === 'targets'
        ? {
            type: 34,
            msgId,
            gameStateId: 23,
            allowCancel: 2,
            selectTargetsReq: {
              sourceId: 106,
              targets: [
                {
                  targetIdx: 1,
                  minTargets: 0,
                  maxTargets: 1,
                  selectedTargets: 0,
                  targets: [{ targetInstanceId: 101, legalAction: 1 }],
                },
              ],
            },
          }
        : kind === 'castingOptions'
          ? abortableCasting(msgId)
          : {
              type: 36,
              msgId,
              gameStateId: 23,
              allowCancel: 2,
              payCostsReq: {
                effectCostReq: {
                  effectCostType: 1,
                  costSelection: { ids: [], minSel: 0, maxSel: 1 },
                },
              },
            }
  for (const action of ['choice', 'cancel'] as const) {
    for (const retire of ['same-kind', 'reset', 'source', 'readonly', 'rejection'] as const) {
      if (
        action === 'choice' &&
        retire === 'rejection' &&
        kind !== 'targets' &&
        kind !== 'payCosts'
      ) {
        continue
      }
      test(`delayed ${kind} ${action} codec rejects ${retire} immediately before delivery`, async () => {
        const h = encodedPromptHarness({}, { deferDelivery: true })
        h.owner.applyFamilyRequest(request())
        const bound = bindingFor(h.owner, kind)
        const pending =
          action === 'cancel'
            ? bound.controls.cancel()
            : bound.kind === 'payCosts'
              ? bound.controls.submit()
              : bound.kind === 'targets'
                ? bound.controls.choose(bound.view.candidates[0]!)
                : bound.kind === 'selectN'
                  ? bound.controls.submit()
                  : bound.controls.chooseCastingOption(bound.view.castingOptions[0]!)
        const delivery = await h.waitForDelivery()
        if (retire === 'same-kind') {
          h.owner.applyFamilyRequest(request(8))
        }
        if (retire === 'reset') {
          h.owner.reset()
        }
        if (retire === 'source') {
          h.nextSource()
        }
        if (retire === 'readonly') {
          h.readOnly()
        }
        if (retire === 'rejection') {
          h.owner.rejectPromptResponse()
        }
        const successor = h.owner.prompt
        delivery.release()
        expect(await pending).toBe(false)
        expect(h.sent).toEqual([])
        if (retire !== 'readonly' && retire !== 'rejection') {
          expect(h.owner.prompt).toBe(successor)
        }
        if (retire !== 'rejection') {
          expect(await bound.controls.cancel()).toBe(false)
        }
      })
    }
  }
}

for (const failure of ['rejected', 'exception'] as const) {
  test(`family cancel ${failure} restores readiness and permits a retry`, async () => {
    let attempts = 0
    const { owner } = harness({
      sendGreResponse: async () => {
        if (++attempts > 1) {
          return true
        }
        if (failure === 'exception') {
          throw new Error('delivery failed')
        }
        return false
      },
    })
    owner.applyFamilyRequest(abortableCasting())
    const bound = bindingFor(owner, 'castingOptions')
    if (failure === 'exception') {
      expect(bound.controls.cancel()).rejects.toThrow('delivery failed')
    } else {
      expect(await bound.controls.cancel()).toBe(false)
    }
    expect(owner.prompt).toMatchObject({ waiting: false })
    expect(await bound.controls.cancel()).toBe(true)
    expect(owner.prompt).toMatchObject({ waiting: true })
  })
}

test('rejected cancel cannot send or release a retry while its old encode finishes', async () => {
  const releases: Array<() => void> = []
  const delivered: ProtoObject[] = []
  const { owner } = harness({
    sendGreResponse: async (_type, payload, _generation, current) => {
      await new Promise<void>((resolve) => releases.push(resolve))
      if (!current?.()) {
        return false
      }
      delivered.push(payload)
      return true
    },
  })
  owner.applyFamilyRequest(abortableCasting())
  const bound = bindingFor(owner, 'castingOptions')
  const old = bound.controls.cancel()
  owner.rejectPromptResponse()
  const retry = bound.controls.cancel()
  releases[0]!()
  expect(await old).toBe(false)
  expect(owner.prompt).toMatchObject({ waiting: true })
  releases[1]!()
  expect(await retry).toBe(true)
  expect(delivered).toEqual([{ gameStateId: 23 }])
  owner.retireCancelledAction()
  expect(owner.prompt).toBeNull()
})

test('a target echo preserves interaction focus but expires request controls when IDs repeat', async () => {
  const h = encodedPromptHarness()
  const request = (msgId: number, legalAction: number) => ({
    type: 34,
    msgId,
    gameStateId: msgId + 10,
    selectTargetsReq: {
      sourceId: 106,
      abilityGrpId: 700,
      targets: [
        {
          targetIdx: 1,
          minTargets: 0,
          maxTargets: 2,
          selectedTargets: legalAction === 2 ? 1 : 0,
          targets: [{ targetInstanceId: 101, legalAction }],
        },
      ],
    },
  })
  h.owner.applyFamilyRequest(request(1, 1))
  const first = bindingFor(h.owner, 'targets')
  expect(await first.controls.choose(first.view.candidates[0]!)).toBe(true)
  expect(await first.controls.choose(first.view.candidates[0]!)).toBe(false)
  h.owner.applyFamilyRequest(request(2, 1))
  expect(h.owner.prompt?.interactionKey).toBe(first.view.interactionKey)
  expect(await first.controls.choose(first.view.candidates[0]!)).toBe(false)
  expect(await first.controls.submit()).toBe(false)
  const echo = bindingFor(h.owner, 'targets')
  expect(await echo.controls.choose(echo.view.candidates[0]!)).toBe(true)
  const replacement = request(3, 1)
  replacement.selectTargetsReq.sourceId = 107
  h.owner.applyFamilyRequest(replacement)
  expect(h.owner.prompt?.interactionKey).not.toBe(first.view.interactionKey)
  expect(await echo.controls.cancel()).toBe(false)
})
test('target confirmation only retires its current continuation and rejection restores its request', async () => {
  const h = encodedPromptHarness()
  const request = {
    type: 34,
    msgId: 1,
    gameStateId: 4,
    selectTargetsReq: {
      targets: [{ targetIdx: 1, minTargets: 0, maxTargets: 1, selectedTargets: 0, targets: [] }],
    },
  }
  h.owner.applyFamilyRequest(request)
  const bound = bindingFor(h.owner, 'targets')
  h.owner.retireFamilyContinuation('targets')
  expect(h.owner.prompt).toBe(bound.view)
  expect(await bound.controls.submit()).toBe(true)
  h.owner.rejectPromptResponse()
  expect(h.owner.prompt).toMatchObject({ waiting: false, canSubmit: true })
  expect(await bound.controls.submit()).toBe(true)
  h.owner.retireFamilyContinuation('targets')
  expect(h.owner.prompt).toBeNull()
  h.owner.applyFamilyRequest(numeric())
  const successor = h.owner.prompt
  h.owner.retireFamilyContinuation('targets')
  expect(h.owner.prompt).toBe(successor)
})

for (const retire of ['replacement', 'reset', 'source'] as const) {
  test(`delayed automatic target completion cannot send after ${retire}`, async () => {
    const h = encodedPromptHarness({}, { deferDelivery: 'SubmitTargetsReq' })
    const request = (msgId: number, selected: boolean) => ({
      type: 34,
      msgId,
      gameStateId: msgId + 10,
      selectTargetsReq: {
        sourceId: 106,
        targets: [
          {
            targetIdx: 1,
            minTargets: 1,
            maxTargets: 1,
            selectedTargets: selected ? 1 : 0,
            targets: [{ targetInstanceId: 101, legalAction: selected ? 2 : 1 }],
          },
        ],
      },
    })
    h.owner.applyFamilyRequest(request(1, false))
    const bound = bindingFor(h.owner, 'targets')
    expect(await bound.controls.choose(bound.view.candidates[0]!)).toBe(true)
    h.owner.applyFamilyRequest(request(2, true))
    expect(h.owner.prompt).toMatchObject({ waiting: true })
    const delivery = await h.waitForDelivery()
    if (retire === 'replacement') {
      h.owner.applyFamilyRequest(request(3, false))
    }
    if (retire === 'reset') {
      h.owner.reset()
    }
    if (retire === 'source') {
      h.nextSource()
    }
    const successor = h.owner.prompt
    delivery.release()
    expect(await delivery.result).toBe(false)
    expect(h.sent).toHaveLength(1)
    expect(h.owner.prompt).toBe(successor)
  })
}

for (const failure of ['rejected', 'exception'] as const) {
  test(`payment ${failure} retains draft and restores only the current attempt for retry`, async () => {
    let release!: () => void
    let attempts = 0
    const h = harness({
      sendGreResponse: async () => {
        if (++attempts > 1) {
          return true
        }
        await new Promise<void>((resolve) => {
          release = resolve
        })
        if (failure === 'exception') {
          throw new Error('payment delivery failed')
        }
        return false
      },
    })
    h.owner.applyFamilyRequest({
      type: 36,
      msgId: 8,
      gameStateId: 30,
      payCostsReq: {
        effectCostReq: {
          effectCostType: 5,
          gatherReq: { amountToGather: 1, sources: [{ sourceId: 101, maxAmount: 2 }] },
        },
      },
    })
    const bound = bindingFor(h.owner, 'payCosts')
    bound.controls.adjust(bound.view.gatherCounterCandidates![0]!, 1)
    const sending = bound.controls.submit()
    expect(await bound.controls.submit()).toBe(false)
    expect(bound.controls.adjust(bound.view.gatherCounterCandidates![0]!, -1)).toBe(false)
    const result = sending.catch((e: Error) => e.message)
    release()
    if (failure === 'exception') {
      expect(await result).toBe('payment delivery failed')
    } else {
      expect(await result).toBe(false)
    }
    expect(h.owner.prompt).toMatchObject({
      waiting: false,
      canSubmit: true,
      gatherCounterCandidates: [{ amount: 1 }],
    })
    expect(await bound.controls.submit()).toBe(true)
    h.owner.retireFamilyStateWait()
    expect(h.owner.prompt).toBeNull()
  })
}

test('payment state retirement ignores unsent and replacement requests, rejection restores the same draft', async () => {
  const h = encodedPromptHarness()
  const request = (msgId: number) => ({
    type: 36,
    msgId,
    gameStateId: 30,
    payCostsReq: {
      paymentActions: { actions: [{ actionType: 12, instanceId: 101 }] },
    },
  })
  h.owner.applyFamilyRequest(request(8))
  const bound = bindingFor(h.owner, 'payCosts')
  h.owner.retireFamilyStateWait()
  expect(h.owner.prompt).toBe(bound.view)
  expect(await bound.controls.pay(bound.view.payCostCandidates![0]!)).toBe(true)
  expect(await bound.controls.finish()).toBe(false)
  h.owner.rejectPromptResponse()
  expect(h.owner.prompt?.waiting).toBe(false)
  expect(await bound.controls.finish()).toBe(true)
  h.owner.applyFamilyRequest(request(9))
  const replacement = h.owner.prompt
  h.owner.retireFamilyStateWait()
  expect(h.owner.prompt).toBe(replacement)
  expect(await bound.controls.finish()).toBe(false)
})

test('payment actions cannot send after delayed encoding and a newer request', async () => {
  let finishEncoding!: () => void
  const sent: ProtoObject[] = []
  const dispatch = new GreDispatch(
    dispatchHost({
      sendGreResponse: async (_type, payload, _generation, isCurrent) => {
        await new Promise<void>((resolve) => {
          finishEncoding = resolve
        })
        if (!isCurrent?.()) {
          return false
        }
        sent.push(payload)
        return true
      },
    }),
  )
  const request = (msgId: number, instanceId: number): ProtoObject => ({
    msgId,
    gameStateId: msgId + 10,
    payCostsReq: {
      paymentActions: { actions: [{ actionType: 12, instanceId }] },
      paymentSelection: {},
    },
  })

  dispatch.applyFamilyRequest({ ...request(1, 101), type: 36 })
  const stale = viewFor(dispatch, 'payCosts').payCostCandidates![0]!
  const sending = bindingFor(dispatch, 'payCosts').controls.pay(stale)
  expect(dispatch.prompt).toMatchObject({ waiting: true })
  dispatch.applyFamilyRequest({ ...request(2, 102), type: 36 })
  finishEncoding()
  expect(await sending).toBe(false)
  expect(sent).toHaveLength(0)
  expect(dispatch.prompt).toMatchObject({
    kind: 'payCosts',
    interactionKey: 2,
    payCostCandidates: [{ instanceId: 102 }],
    waiting: false,
  })
  expect(await bindingFor(dispatch, 'payCosts').controls.pay(stale)).toBe(false)
})

test('a rejected payment send restores the current request', async () => {
  const dispatch = new GreDispatch(dispatchHost({ sendGreResponse: () => Promise.resolve(false) }))
  dispatch.applyFamilyRequest({
    type: 36,
    msgId: 1,
    gameStateId: 11,
    payCostsReq: {
      paymentActions: { actions: [{ actionType: 12, instanceId: 101 }] },
      paymentSelection: {},
    },
  })

  expect(
    await bindingFor(dispatch, 'payCosts').controls.pay(
      viewFor(dispatch, 'payCosts').payCostCandidates![0]!,
    ),
  ).toBe(false)
  expect(dispatch.prompt).toMatchObject({
    kind: 'payCosts',
    waiting: false,
    payCostCandidates: [{ instanceId: 101 }],
  })
})

for (const kind of ['attackers', 'blockers'] as const) {
  const request = (msgId = 7): ProtoObject => ({
    type: kind === 'attackers' ? 26 : 28,
    msgId,
    gameStateId: 23,
    ...(kind === 'attackers'
      ? {
          declareAttackersReq: {
            canSubmitAttackers: true,
            attackers: [
              {
                attackerInstanceId: 101,
                legalDamageRecipients: [{ type: 1, playerSystemSeatId: 2 }],
              },
            ],
          },
        }
      : {
          declareBlockersReq: {
            blockers: [
              {
                blockerInstanceId: 101,
                attackerInstanceIds: [102],
                selectedAttackerInstanceIds: [],
              },
            ],
          },
        }),
  })
  for (const operation of ['choice', 'submit'] as const) {
    for (const retirement of ['same-kind', 'reset', 'source', 'readonly', 'rejection'] as const) {
      test(`${kind} ${operation} encoding cannot send or unlock after ${retirement}`, async () => {
        const h = encodedPromptHarness({}, { deferDelivery: true })
        h.owner.applyFamilyRequest(request())
        const bound = bindingFor(h.owner, kind)
        const respond = () =>
          operation === 'submit'
            ? bound.controls.submit()
            : bound.kind === 'attackers'
              ? bound.controls.choose(bound.view.attackers[0]!)
              : bound.controls.choose(bound.view.blockers[0]!, 102)
        const pending = respond()
        const delivery = await h.waitForDelivery()
        expect(await respond()).toBe(false)
        h.owner.retireFamilyContinuation(kind)
        expect(h.owner.prompt).toMatchObject({ kind, waiting: true })
        if (retirement === 'same-kind') {
          h.owner.applyFamilyRequest(request(8))
        }
        if (retirement === 'reset') {
          h.owner.reset()
          h.owner.applyFamilyRequest(request(8))
        }
        if (retirement === 'source') {
          h.nextSource()
          h.owner.applyFamilyRequest(request(8))
        }
        if (retirement === 'readonly') {
          h.readOnly()
        }
        if (retirement === 'rejection') {
          h.owner.rejectPromptResponse()
        }
        const successor = h.owner.prompt
        delivery.release()
        expect(await pending).toBe(false)
        expect(h.sent).toHaveLength(0)
        if (retirement === 'readonly') {
          expect(h.owner.prompt).toMatchObject({ kind, waiting: false })
        } else {
          expect(h.owner.prompt).toBe(successor)
        }
        if (retirement !== 'rejection') {
          expect(await respond()).toBe(false)
        } else {
          expect(h.owner.prompt?.waiting).toBe(false)
        }
      })
    }
  }
  test(`${kind} echoes expire retained controls, rejection recovers authoritative selection, and only completion retires`, async () => {
    const h = encodedPromptHarness()
    h.owner.applyFamilyRequest(request())
    const old = bindingFor(h.owner, kind)
    const choose = () =>
      old.kind === 'attackers'
        ? old.controls.choose(old.view.attackers[0]!)
        : old.controls.choose(old.view.blockers[0]!, 102)
    expect(await choose()).toBe(true)
    h.owner.retireFamilyContinuation(kind)
    expect(h.owner.prompt?.waiting).toBe(true)
    h.owner.rejectPromptResponse()
    expect(h.owner.prompt).toMatchObject({
      waiting: false,
      interactionKey: old.view.interactionKey,
    })
    expect(await choose()).toBe(true)
    h.owner.applyFamilyRequest(request(8))
    const fresh = bindingFor(h.owner, kind)
    expect(fresh.view.interactionKey).toBe(old.view.interactionKey)
    expect(await old.controls.submit()).toBe(false)
    expect(await fresh.controls.submit()).toBe(true)
    expect(await decodeGre(h.sent[2])).toMatchObject({ gameStateId: 23, respId: 8 })
    h.owner.retireFamilyContinuation(kind)
    expect(h.owner.prompt).toBeNull()
    h.owner.applyFamilyRequest(request(9))
    const newer = h.owner.prompt
    h.owner.retireFamilyContinuation(kind)
    expect(h.owner.prompt).toBe(newer)
  })
}

for (const retire of ['same-kind', 'reset', 'source', 'readonly'] as const) {
  test(`delayed damage codec cannot send or retire after ${retire}`, async () => {
    const h = encodedPromptHarness({}, { deferDelivery: true })
    const request = (msgId: number) => ({
      type: 30,
      msgId,
      gameStateId: 23,
      assignDamageReq: {
        damageAssigners: [
          { instanceId: 101, totalDamage: 1, assignments: [{ instanceId: 2, assignedDamage: 1 }] },
        ],
      },
    })
    h.owner.applyFamilyRequest(request(7))
    const b = bindingFor(h.owner, 'assignDamage')
    const pending = b.controls.submit()
    const delivery = await h.waitForDelivery()
    expect(
      b.controls.adjust(b.view.damageAssigners[0]!, b.view.damageAssigners[0]!.assignments[0]!, -1),
    ).toBe(false)
    if (retire === 'same-kind') {
      h.owner.applyFamilyRequest(request(8))
    }
    if (retire === 'reset') {
      h.owner.reset()
    }
    if (retire === 'source') {
      h.nextSource()
    }
    if (retire === 'readonly') {
      h.readOnly()
    }
    const successor = h.owner.prompt
    delivery.release()
    expect(await pending).toBe(false)
    expect(h.sent).toEqual([])
    if (retire === 'readonly') {
      expect(h.owner.prompt).toMatchObject({
        kind: 'assignDamage',
        waiting: false,
        canSubmit: true,
      })
    } else {
      expect(h.owner.prompt).toBe(successor)
    }
  })
}

for (const decision of ['keep', 'mulligan'] as const) {
  test(`mulligan ${decision} rejection during encoding restores readiness and cannot deliver the rejected attempt`, async () => {
    const h = encodedPromptHarness()
    h.owner.applyFamilyRequest({ type: 15, msgId: 9, gameStateId: 14, mulliganReq: {} })
    const controls = bindingFor(h.owner, 'mulligan').controls
    const pending = controls[decision]()
    h.owner.rejectPromptResponse()
    expect(h.owner.prompt).toMatchObject({ kind: 'mulligan', waiting: false, canSubmit: true })
    expect(await pending).toBe(false)
    expect(h.sent).toHaveLength(0)
    expect(await controls[decision]()).toBe(true)
    expect(h.sent).toHaveLength(1)
    expect(h.owner.prompt).toBeNull()
  })
}

test('spectator automatic keep uses shared freshness while its view has no executable controls', async () => {
  const h = encodedPromptHarness({ isSpectatorMode: () => true })
  h.owner.applyFamilyRequest({ type: 15, msgId: 9, gameStateId: 14, mulliganReq: {} })
  expect(h.owner.bindPrompt(h.owner.prompt)?.controls).toBeNull()
  await Bun.sleep(0)
  expect(h.sent).toHaveLength(1)
  expect(await decodeGre(h.sent[0])).toMatchObject({
    gameStateId: 14,
    respId: 9,
    mulliganResp: { decision: 2 },
  })
  expect(h.owner.prompt).toBeNull()
  h.owner.applyFamilyRequest({ type: 15, msgId: 10, gameStateId: 15, mulliganReq: {} })
  h.owner.reset()
  await Bun.sleep(0)
  expect(h.sent).toHaveLength(1)
})

test('source replacement preserves delivered continuation gating while rejecting retained controls', async () => {
  const h = encodedPromptHarness()
  h.owner.applyFamilyRequest({
    type: 36,
    msgId: 8,
    gameStateId: 13,
    payCostsReq: { paymentActions: { actions: [] }, paymentSelection: {} },
  })
  const old = bindingFor(h.owner, 'payCosts').controls
  expect(await old.finish()).toBe(true)
  h.nextSource()
  h.owner.attachSource()
  expect(await old.finish()).toBe(false)
  expect(h.owner.prompt).toMatchObject({ kind: 'payCosts', waiting: true })
  expect(await bindingFor(h.owner, 'payCosts').controls.finish()).toBe(false)
  expect(h.sent).toHaveLength(1)
  h.owner.retireFamilyStateWait()
  expect(h.owner.prompt).toBeNull()
})

for (const outcome of ['delivered', 'failed', 'rejected', 'successor'] as const) {
  test(`cancellation state waits for delivery and preserves ${outcome} lifetime`, async () => {
    const h = encodedPromptHarness({}, { deferDelivery: true })
    h.owner.applyFamilyRequest(abortableCasting())
    const bound = bindingFor(h.owner, 'castingOptions')
    const pending = bound.controls.cancel()
    const delivery = await h.waitForDelivery()
    h.owner.retireCancelledAction()
    expect(h.owner.prompt).toMatchObject({ kind: 'castingOptions', waiting: true })
    expect(h.sent).toHaveLength(0)
    if (outcome === 'rejected') {
      h.owner.rejectPromptResponse()
    }
    if (outcome === 'successor') {
      h.owner.applyFamilyRequest(abortableCasting(8))
    }
    const successor = h.owner.prompt
    delivery.release(outcome !== 'failed')
    expect(await pending).toBe(outcome === 'delivered')
    expect(h.sent).toHaveLength(outcome === 'delivered' ? 1 : 0)
    h.owner.retireCancelledAction()
    if (outcome === 'delivered') {
      expect(h.owner.prompt).toBeNull()
    } else if (outcome === 'successor') {
      expect(h.owner.prompt).toBe(successor)
    } else {
      expect(h.owner.prompt).toMatchObject({ kind: 'castingOptions', waiting: false })
      expect(viewFor(h.owner, 'castingOptions').castingOptions).toEqual(bound.view.castingOptions)
      const retry = bindingFor(h.owner, 'castingOptions').controls.cancel()
      const retryDelivery = await h.waitForDelivery()
      retryDelivery.release()
      expect(await retry).toBe(true)
    }
  })
}
