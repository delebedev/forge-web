import { mulliganInstruction } from '@engine/runtime/prompts/mulligan'
import { numericInstruction } from '@engine/runtime/prompts/numeric'
import { optionalActionInstruction } from '@engine/runtime/prompts/optional-action'
import { replacementInstruction } from '@engine/runtime/prompts/replacement'
import { searchInstruction } from '@engine/runtime/prompts/search'
import { paymentInstruction } from '@engine/runtime/prompts/payment'
import { selectionInstruction } from '@engine/runtime/prompts/selection'
import { castingInstruction } from '@engine/runtime/prompts/casting'
import { orderInstruction } from '@engine/runtime/prompts/order'
import { groupInstruction } from '@engine/runtime/prompts/group'
import { damageInstruction } from '@engine/runtime/prompts/damage'
import { blockersInstruction } from '@engine/runtime/prompts/blockers'
import { attackersInstruction } from '@engine/runtime/prompts/attackers'
import { distributionInstruction } from '@engine/runtime/prompts/distribution'
import { targetingInstruction } from '@engine/runtime/prompts/targeting'
import type { PromptBinding } from '@engine/runtime/prompts/family'
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PromptView } from '@engine/state/gre-state'
import { PromptDock } from './PromptDock'

const prompts: PromptView[] = [
  ((view: Extract<PromptView, { kind: 'targets' }>) => ({
    ...view,
    instruction: targetingInstruction(view),
  }))({
    interactionKey: 1,
    kind: 'targets',
    message: 'SelectTargetsReq',
    canSubmit: true,
    candidates: [
      {
        targetInstanceId: 101,
        targetIdx: 0,
        legalAction: 2,
        name: 'Opponent',
        grpId: 201,
        selected: true,
      },
    ],
  }),
  ((view: Extract<PromptView, { kind: 'distribution' }>) => ({
    ...view,
    instruction: distributionInstruction(view),
  }))({
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
  }),
  ((view: Extract<PromptView, { kind: 'attackers' }>) => ({
    ...view,
    instruction: attackersInstruction(view),
  }))({
    interactionKey: 3,
    kind: 'attackers',
    message: 'DeclareAttackersReq',
    canSubmit: true,
    attackers: [
      {
        attackerInstanceId: 102,
        optionIndex: 0,
        damageRecipient: { playerSystemSeatId: 2 },
        damageRecipientKey: '1:0:2:0',
        damageRecipientName: 'Opponent',
        name: 'Goblin',
        grpId: 202,
        selected: true,
      },
    ],
  }),
  ((view: Extract<PromptView, { kind: 'blockers' }>) => ({
    ...view,
    instruction: blockersInstruction(view),
  }))({
    interactionKey: 3,
    kind: 'blockers',
    message: 'DeclareBlockersReq',
    canSubmit: true,
    blockers: [
      {
        blockerInstanceId: 103,
        blockerName: 'Bear',
        blockerGrpId: 203,
        attackers: [{ attackerInstanceId: 104, name: 'Goblin', grpId: 204, selected: true }],
      },
    ],
  }),
  ((view: Extract<PromptView, { kind: 'assignDamage' }>) => ({
    ...view,
    instruction: damageInstruction(view),
  }))({
    interactionKey: 4,
    kind: 'assignDamage',
    message: 'AssignDamageReq',
    canSubmit: false,
    damageAssigners: [
      {
        interactionKey: 4,
        instanceId: 105,
        name: 'Goblin',
        grpId: 205,
        totalDamage: 2,
        assignedTotal: 1,
        canIgnoreBlockers: false,
        assignments: [
          {
            interactionKey: 4,
            instanceId: 2,
            name: 'Opponent',
            grpId: 0,
            minDamage: 0,
            maxDamage: 2,
            assignedDamage: 1,
            isDefender: true,
          },
        ],
      },
    ],
  }),
  ((view: Extract<PromptView, { kind: 'group' }>) => ({
    ...view,
    instruction: groupInstruction(view),
  }))({
    interactionKey: 5,
    kind: 'group',
    message: 'GroupReq',
    canSubmit: true,
    groupCandidates: [{ instanceId: 106, grpId: 206, name: 'Opt', selectedGroup: 0 }],
    groupSpecs: [
      {
        index: 0,
        label: 'Library / Top',
        zoneType: 1,
        subZoneType: 1,
        lowerBound: 0,
        upperBound: 1,
        count: 1,
      },
    ],
  }),
  ((view: Extract<PromptView, { kind: 'order' }>) => ({
    ...view,
    instruction: orderInstruction(view),
  }))({
    interactionKey: 6,
    kind: 'order',
    message: 'OrderReq',
    canSubmit: false,
    orderContextLabel: 'Order on top',
    orderCandidates: [{ instanceId: 107, grpId: 207, name: 'Opt', position: 1 }],
  }),
  ((view: Extract<PromptView, { kind: 'castingOptions' }>) => ({
    ...view,
    instruction: castingInstruction(view),
  }))({
    interactionKey: 7,
    kind: 'castingOptions',
    message: 'CastingTimeOptionsReq',
    castingOptions: [
      {
        interactionKey: 1,
        ctoId: 9,
        optionType: 10,
        grpId: 208,
        abilityGrpId: 308,
        minSelect: 1,
        maxSelect: 1,
        selectionPayable: true,
        label: 'Choose a mode',
        manaColors: [],
        selectedManaColor: null,
        modalOptions: [
          {
            index: 0,
            grpId: 408,
            label: 'Draw a card',
            additionalCost: null,
            available: true,
            selectable: true,
            selected: false,
          },
        ],
        selectNOptions: [],
      },
      {
        interactionKey: 1,
        ctoId: 17,
        optionType: 5,
        grpId: 209,
        abilityGrpId: 309,
        minSelect: 1,
        maxSelect: 1,
        selectionPayable: true,
        label: 'Pay an additional cost',
        manaColors: [],
        selectedManaColor: null,
        modalOptions: [],
        selectNOptions: [{ id: 3, label: 'Sacrifice a creature' }],
      },
    ],
  }),
  ((view: Extract<PromptView, { kind: 'selectN' }>) => ({
    ...view,
    instruction: selectionInstruction(view),
  }))({
    interactionKey: 8,
    kind: 'selectN',
    message: 'SelectNReq',
    minSelect: 1,
    maxSelect: 2,
    canSubmit: true,
    selectNCandidates: [
      {
        interactionKey: 8,
        instanceId: 108,
        grpId: 0,
        name: 'White',
        zoneType: 0,
        selected: true,
        staticChoice: true,
      },
    ],
  }),
  ((view: Extract<PromptView, { kind: 'payCosts' }>) => ({
    ...view,
    instruction: paymentInstruction(view),
  }))({
    interactionKey: 9,
    kind: 'payCosts',
    message: 'PayCostsReq',
    canSubmit: true,
    payCostCandidates: [
      {
        interactionKey: 9,
        actionIndex: 0,
        actionType: 12,
        instanceId: 110,
        grpId: 210,
        abilityGrpId: 310,
        name: 'Ornithopter',
      },
    ],
  }),
  ((view: Extract<PromptView, { kind: 'search' }>) => ({
    ...view,
    instruction: searchInstruction(view),
  }))({
    interactionKey: 10,
    kind: 'search',
    searchGroups: [],
    message: 'SearchReq',
    minSelect: 0,
    maxSelect: 1,
    canSubmit: true,
    searchCandidates: [
      { instanceId: 109, grpId: 209, name: 'Plains', zoneType: 1, selected: false, sought: false },
    ],
  }),
  ((view: Extract<PromptView, { kind: 'search' }>) => ({
    ...view,
    instruction: searchInstruction(view),
  }))({
    interactionKey: 10,
    kind: 'search',
    message: 'SearchFromGroupsReq',
    minSelect: 0,
    maxSelect: 1,
    canSubmit: true,
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
    ],
  }),
  ((view: Extract<PromptView, { kind: 'replacement' }>) => ({
    ...view,
    instruction: replacementInstruction(view),
  }))({
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
  }),
  ((view: Extract<PromptView, { kind: 'optionalAction' }>) => ({
    ...view,
    instruction: optionalActionInstruction(view),
  }))({ interactionKey: 12, kind: 'optionalAction', message: 'OptionalActionMessage', result: '' }),
  ((view: Extract<PromptView, { kind: 'numericInput' }>) => ({
    ...view,
    instruction: numericInstruction(view),
  }))({
    interactionKey: 13,
    kind: 'numericInput',
    decrementEnabled: true,
    incrementEnabled: true,
    message: 'Choose X',
    numericValue: 2,
    numericMin: 0,
    numericMax: 4,
    numericStep: 1,
    canSubmit: true,
  }),
  ((view: Extract<PromptView, { kind: 'mulligan' }>) => ({
    ...view,
    instruction: mulliganInstruction(view),
  }))({ interactionKey: 14, kind: 'mulligan', result: 'Keep or mulligan', message: 'MulliganReq' }),
]

test('supported prompt chrome keeps protocol identity data-only', () => {
  const html = prompts
    .map((prompt) => renderToStaticMarkup(<PromptDock prompt={prompt} />))
    .join('\n')
  const withoutDataAttributes = html.replace(/ data-[\w-]+="[^"]*"/g, '')

  expect(html).toContain('data-instance-id="101"')
  expect(html).toContain('data-grp-id="201"')
  expect(html).toContain('data-option-type="10"')
  expect(html).toMatch(/data-cto-id="17"[^>]+data-choice-id="3"/)
  expect(html).toContain('data-damage-assigner-id="105"')
  expect(html).toMatch(/data-damage-recipient-id="2"[^>]+data-assigned-damage="1"/)
  expect(withoutDataAttributes).not.toMatch(
    /\b(?:iid|grp|cto)\s*\d+\b|\b(?:zone|type|seat|group)\s*\d+\b|Player seat|GRE type/i,
  )
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('aria-hidden="true">✓</small>')
  expect(html).toContain('>Unavailable</small>')
  expect(html).not.toContain('aria-hidden="true">Unavailable</small>')
  const fields = html.match(/<input\b[^>]*>/g) ?? []
  expect(fields).toHaveLength(1)
  expect(fields[0]).toContain('type="search"')
  expect(html).toContain('<label>Filter choices<input')
})

test('waiting generic prompts disable every choice and submit control', () => {
  const kinds = new Set<PromptView['kind']>([
    'assignDamage',
    'group',
    'order',
    'optionalAction',
    'numericInput',
    'selectN',
    'search',
    'replacement',
  ])
  for (const prompt of prompts.filter((candidate) => kinds.has(candidate.kind))) {
    const html = renderToStaticMarkup(<PromptDock prompt={{ ...prompt, waiting: true }} />)
    const buttons = html.match(/<button[^>]*>/g) ?? []
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.every((button) => button.includes('disabled=""'))).toBe(true)
  }
})

test('optional actions render source-scoped player language without technical identity', () => {
  const html = renderToStaticMarkup(
    <PromptDock
      prompt={((view: Extract<PromptView, { kind: 'optionalAction' }>) => ({
        ...view,
        instruction: optionalActionInstruction(view),
      }))({
        interactionKey: 14,
        kind: 'optionalAction',
        message: 'Optional action for Arabella',
        result: 'Return Arabella to the command zone.',
        canSubmit: true,
      })}
    />,
  )

  expect(html).toContain('Optional action for Arabella')
  expect(html).toContain('Return Arabella to the command zone.')
  expect(html).not.toMatch(/\b(?:iid|grpId)\s*\d+\b/)
  expect(html).toContain('>Accept</button>')
  expect(html).toContain('>Decline</button>')
})

test('opening hand completion does not require a selection-ready flag', () => {
  for (const [kind, label] of [['mulligan', 'Keep hand']] as const) {
    const view = {
      kind,
      message: '',
      interactionKey: 1,
      canSubmit: false,
      result: 'Keep or mulligan',
    }
    const html = renderToStaticMarkup(
      <PromptDock
        prompt={view}
        binding={{ kind, view, controls: { keep: async () => true, mulligan: async () => true } }}
      />,
    )
    const button = html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0]
    expect(button).toBeDefined()
    expect(button).not.toContain('disabled')
  }
})

for (const kind of ['group', 'order'] as const) {
  test(`${kind} dock only enables controls for its exact published view`, () => {
    const view = { ...prompts.find((p) => p.kind === kind)!, canSubmit: true }
    const controls = { move: () => true, toggle: () => true, submit: async () => true }
    const binding: PromptBinding =
      view.kind === 'group'
        ? { kind: 'group', view, controls }
        : view.kind === 'order'
          ? { kind: 'order', view, controls }
          : (() => {
              throw new Error('Expected family')
            })()
    const active = renderToStaticMarkup(<PromptDock prompt={view} binding={binding} />)
    const identities =
      kind === 'group'
        ? ['data-group-index="0"', '(?=[^>]*>Submit groups)']
        : ['data-instance-id="107"', '(?=[^>]*>Submit order)']
    for (const identity of identities) {
      expect(controlMarkup(active, identity)).not.toContain('disabled=""')
    }
    const stale = renderToStaticMarkup(<PromptDock prompt={{ ...view }} binding={binding} />)
    for (const identity of identities) {
      expect(controlMarkup(stale, identity)).toContain('disabled=""')
    }
  })
}

function controlMarkup(html: string, identity: string) {
  const match = html.match(new RegExp('<button\\b[^>]*' + identity + '[^>]*>'))
  if (!match) {
    throw new Error('Missing control ' + identity)
  }
  return match[0]
}
for (const kind of [
  'distribution',
  'replacement',
  'optionalAction',
  'castingOptions',
  'selectN',
  'targets',
  'payCosts',
  'attackers',
  'blockers',
  'assignDamage',
] as const) {
  test(`${kind} dock enables only exact bound controls and keeps stale, waiting and read-only controls inert`, () => {
    const view = prompts.find((p) => p.kind === kind)!
    const controls = {
      all: async () => true,
      pay: async () => true,
      finish: async () => true,
      toggle: () => true,
      adjust: () => true,
      submit: async () => true,
      choose: async () => true,
      respond: async () => true,
      chooseCastingOption: async () => true,
      chooseCastingOptionSelect: async () => true,
      selectManaType: () => true,
      submitManaTypes: async () => true,
      chooseModalOption: async () => true,
      toggleModalOption: () => true,
      adjustModalOption: () => true,
      submitModalOptions: async () => true,
      cancel: async () => true,
    }
    const binding: PromptBinding =
      view.kind === 'assignDamage'
        ? { kind: 'assignDamage', view, controls }
        : view.kind === 'attackers'
          ? { kind: 'attackers', view, controls }
          : view.kind === 'blockers'
            ? { kind: 'blockers', view, controls }
            : view.kind === 'payCosts'
              ? { kind: 'payCosts', view, controls }
              : view.kind === 'distribution'
                ? { kind: 'distribution', view, controls }
                : view.kind === 'replacement'
                  ? { kind: 'replacement', view, controls }
                  : view.kind === 'optionalAction'
                    ? { kind: 'optionalAction', view, controls }
                    : view.kind === 'selectN'
                      ? { kind: 'selectN', view, controls }
                      : view.kind === 'targets'
                        ? { kind: 'targets', view, controls }
                        : view.kind === 'castingOptions'
                          ? { kind: 'castingOptions', view, controls }
                          : (() => {
                              throw new Error('Expected family')
                            })()
    const identities =
      kind === 'assignDamage'
        ? ['aria-label="Assign 1 damage', '(?=[^>]*>Assign damage)']
        : kind === 'attackers'
          ? ['data-option-index="0"', '(?=[^>]*>Submit attackers)']
          : kind === 'blockers'
            ? ['data-instance-id="104"', '(?=[^>]*>Submit blockers)']
            : kind === 'payCosts'
              ? ['data-action-index="0"', '(?=[^>]*>Done paying)']
              : kind === 'distribution'
                ? [
                    'aria-label="Remove 1 from Coral Merfolk"',
                    'aria-label="Assign 1 to Coral Merfolk"',
                    'aria-label="Remove 1 from Savannah Lions"',
                    'aria-label="Assign 1 to Savannah Lions"',
                    '(?=[^>]*>Submit distribution)',
                  ]
                : kind === 'replacement'
                  ? ['data-replacement-effect-id="501"', 'data-replacement-effect-id="502"']
                  : kind === 'selectN'
                    ? ['data-choice-id="108"', '(?=[^>]*>Submit selection)']
                    : kind === 'targets'
                      ? ['data-target-index="0"', '(?=[^>]*>Submit targets)']
                      : kind === 'castingOptions'
                        ? ['data-cto-id="9"', 'data-choice-id="3"']
                        : ['(?=[^>]*>Accept)', '(?=[^>]*>Decline)']
    const render = (prompt: PromptView, bound: PromptBinding) =>
      renderToStaticMarkup(<PromptDock prompt={prompt} binding={bound} />)
    const active = render(view, binding)
    for (const identity of identities) {
      const intrinsic =
        (kind === 'assignDamage' && identity.includes('Assign damage)')) ||
        (kind === 'distribution' &&
          identity.includes('aria-label') &&
          !identity.includes('Remove 1 from Savannah Lions'))
      expect(controlMarkup(active, identity).includes('disabled=""')).toBe(intrinsic)
    }
    for (const [prompt, bound] of [
      [{ ...view }, binding],
      [{ ...view, waiting: true }, binding],
      [view, { ...binding, controls: null }],
    ] as const) {
      const html = render(prompt, bound)
      for (const identity of identities) {
        expect(controlMarkup(html, identity)).toContain('disabled=""')
      }
    }
  })
}
