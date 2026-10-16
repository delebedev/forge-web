import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ACTION_CAST_ADVENTURE,
  type CardView,
  type LegalAction,
  type TargetPromptView,
} from '@engine/state/gre-state'
import { droppedLegalAction, useBoardInteractions } from './board-interactions'

const targetCard = { instanceId: 202 } as CardView
const targetPrompt: TargetPromptView = {
  interactionKey: 1,
  kind: 'targets',
  message: 'Select a target',
  candidates: [
    {
      targetInstanceId: 202,
      targetIdx: 0,
      legalAction: 1,
      name: 'Target',
      grpId: 2,
      selected: false,
    },
  ],
}

function BoardCardStateProbe({
  interactive,
  phasedOut,
}: {
  interactive: boolean
  phasedOut?: boolean
}) {
  const state = useBoardInteractions(targetPrompt, false, {
    kind: 'targets',
    view: targetPrompt,
    controls: { choose: async () => true, submit: async () => true, cancel: async () => true },
  }).boardCardState({ ...targetCard, phasedOut }, 'opp', interactive)
  return createElement('button', {
    disabled: state.disabled,
    'data-selectable': state.selectable,
    'data-has-handler': Boolean(state.onClick),
  })
}

test('board targets have no interaction until game input is enabled', () => {
  const disabled = renderToStaticMarkup(createElement(BoardCardStateProbe, { interactive: false }))
  const enabled = renderToStaticMarkup(createElement(BoardCardStateProbe, { interactive: true }))

  expect(disabled).toContain('disabled=""')
  expect(disabled).toContain('data-selectable="false"')
  expect(disabled).toContain('data-has-handler="false"')
  expect(enabled).not.toContain('disabled=""')
  expect(enabled).toContain('data-selectable="true"')
  expect(enabled).toContain('data-has-handler="true"')
})

test('hand drops preserve the exact special cast action', () => {
  const exactAction: LegalAction = {
    actionType: ACTION_CAST_ADVENTURE,
    instanceId: 101,
    grpId: 10,
    facetId: 7,
    abilityGrpId: 8,
    uniqueAbilityId: 9,
    sourceId: 10,
    alternativeGrpId: 11,
    alternativeSourceZcid: 12,
    zoneType: 2,
    hasAlternativeCost: true,
    label: 'Special action',
    cardName: 'Branching Card',
    shouldStop: true,
  }
  const rect = { left: 0, right: 200, top: 100, bottom: 300 }

  expect(
    droppedLegalAction({ action: exactAction, started: true }, { clientX: 50, clientY: 150 }, rect),
  ).toBe(exactAction)
})

test('phased-out cards cannot select a stale prompt target', () => {
  const html = renderToStaticMarkup(
    createElement(BoardCardStateProbe, { interactive: true, phasedOut: true }),
  )
  expect(html).toContain('disabled=""')
  expect(html).toContain('data-selectable="false"')
  expect(html).toContain('data-has-handler="false"')
})

test('board card input uses the same current target controls and makes retained clicks stale', async () => {
  const { encodedPromptHarness, bindingFor, decodeGre } =
    await import('@engine/runtime/prompts/prompt-test-harness')
  const h = encodedPromptHarness()
  const request = (msgId: number) => ({
    type: 34,
    msgId,
    gameStateId: 6,
    selectTargetsReq: {
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
  })
  h.owner.applyFamilyRequest(request(4))
  const bound = bindingFor(h.owner, 'targets')
  let click: (() => void) | undefined
  function Probe() {
    const state = useBoardInteractions(bound.view, false, bound).boardCardState(
      { instanceId: 101 } as CardView,
      'self',
      true,
    )
    click = state.onClick
    return createElement('button', { disabled: state.disabled })
  }
  expect(renderToStaticMarkup(createElement(Probe))).not.toContain('disabled=""')
  click!()
  await Bun.sleep(0)
  expect(h.sent).toHaveLength(1)
  expect(await decodeGre(h.sent[0])).toMatchObject({
    respId: 4,
    gameStateId: 6,
    selectTargetsResp: {
      target: { targetIdx: 1, targets: [{ targetInstanceId: 101, legalAction: 1 }] },
    },
  })
  h.owner.applyFamilyRequest(request(5))
  click!()
  await Bun.sleep(0)
  expect(h.sent).toHaveLength(1)
})

test('board attacker uses the same exact family control and refuses ambiguous, waiting or unbound input', () => {
  const candidate = {
    attackerInstanceId: 101,
    optionIndex: 0,
    damageRecipient: { type: 1, playerSystemSeatId: 2 },
    damageRecipientKey: '1:0:2:0',
    damageRecipientName: 'Opponent',
    name: 'Coral Merfolk',
    grpId: 201,
    selected: false,
  }
  let calls = 0
  let state: ReturnType<ReturnType<typeof useBoardInteractions>['boardCardState']> | undefined
  const view = {
    kind: 'attackers' as const,
    interactionKey: 1,
    message: '',
    attackers: [candidate],
  }
  const controls = {
    choose: async (value: typeof candidate) => {
      expect(value).toBe(candidate)
      calls++
      return true
    },
    all: async () => true,
    submit: async () => true,
  }
  function Probe({ waiting = false, ambiguous = false, bound = true }) {
    const prompt = {
      ...view,
      waiting,
      attackers: ambiguous ? [candidate, { ...candidate, optionIndex: 1 }] : [candidate],
    }
    state = useBoardInteractions(
      prompt,
      false,
      bound ? { kind: 'attackers', view: prompt, controls } : null,
    ).boardCardState({ instanceId: 101 } as CardView, 'self', true)
    return null
  }
  renderToStaticMarkup(createElement(Probe, {}))
  expect(state?.disabled).toBe(false)
  state?.onClick?.()
  expect(calls).toBe(1)
  for (const props of [{ waiting: true }, { bound: false }]) {
    renderToStaticMarkup(createElement(Probe, props))
    expect(state?.disabled).toBe(true)
  }
  renderToStaticMarkup(createElement(Probe, { ambiguous: true }))
  expect(state?.selectable).toBe(false)
  expect(state?.onClick).toBeUndefined()
})

test('hand drops reject an unfinished gesture, missing zone and pointers outside its bounds', () => {
  const action = { instanceId: 101 } as LegalAction
  const rect = { left: 0, right: 200, top: 100, bottom: 300 }
  expect(
    droppedLegalAction({ action, started: false }, { clientX: 50, clientY: 150 }, rect),
  ).toBeNull()
  expect(droppedLegalAction({ action, started: true }, { clientX: 50, clientY: 150 })).toBeNull()
  expect(
    droppedLegalAction({ action, started: true }, { clientX: 250, clientY: 150 }, rect),
  ).toBeNull()
  expect(
    droppedLegalAction({ action, started: true }, { clientX: 50, clientY: 350 }, rect),
  ).toBeNull()
})
