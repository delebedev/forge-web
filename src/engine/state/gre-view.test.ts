import { expect, test } from 'bun:test'
import {
  castingOptionCandidateView,
  modeSelectionAllowed,
  optionalActionPresentation,
  targetCandidateView,
} from './gre-view'
import type { CardMeta, GreTables } from './gre-state'

const tables: GreTables = {
  objects: new Map([[100, { instanceId: 100, grpId: 42 }]]),
  zones: new Map(),
  players: new Map(),
}
const cardMeta = new Map<number, CardMeta>([
  [
    42,
    {
      grpId: 42,
      abilities: {
        700: { text: 'Gift a tapped Fish token — {1}', manaCost: '{1}' },
        801: { text: 'Return target creature to its owner’s hand — {2}{U}', manaCost: '{2}{U}' },
        802: { text: 'Draw two cards', manaCost: null },
      },
    },
  ],
])

test('casting options join flat and modal ability presentation to the affected card', () => {
  expect(
    castingOptionCandidateView(
      {
        ctoId: 3,
        castingTimeOptionType: 5,
        affectedId: 100,
        grpId: 700,
      },
      tables,
      cardMeta,
    ),
  ).toMatchObject({
    ctoId: 3,
    grpId: 700,
    label: 'Gift a tapped Fish token — {1}',
  })

  expect(
    castingOptionCandidateView(
      {
        ctoId: 9,
        castingTimeOptionType: 10,
        affectedId: 100,
        modalReq: {
          abilityGrpId: 800,
          minSel: 1,
          maxSel: 2,
          modalOptions: [{ grpId: 801 }, { grpId: 802 }],
        },
      },
      tables,
      cardMeta,
      [802],
    ),
  ).toMatchObject({
    ctoId: 9,
    abilityGrpId: 800,
    minSelect: 1,
    maxSelect: 2,
    modalOptions: [
      { grpId: 801, label: 'Return target creature to its owner’s hand — {2}{U}', selected: false },
      { grpId: 802, label: 'Draw two cards', selected: true },
    ],
  })
})

test('casting options use human fallbacks when ability metadata is absent', () => {
  expect(
    castingOptionCandidateView(
      {
        ctoId: 4,
        castingTimeOptionType: 5,
        affectedId: 100,
        grpId: 999,
      },
      tables,
      new Map(),
    )?.label,
  ).toBe('Pay the additional cost')

  expect(
    castingOptionCandidateView(
      {
        ctoId: 5,
        castingTimeOptionType: 10,
        affectedId: 100,
        modalReq: { modalOptions: [{ grpId: 901 }, { grpId: 902 }] },
      },
      tables,
      new Map(),
    )?.modalOptions.map((option) => option.label),
  ).toEqual(['First choice', 'Second choice'])

  expect(
    castingOptionCandidateView(
      {
        ctoId: 6,
        castingTimeOptionType: 11,
        selectNReq: {
          ids: [1, 2],
          prompt: {
            parameters: [
              { type: 5, promptId: 15008 },
              { type: 5, promptId: 4160 },
            ],
          },
        },
      },
      tables,
      new Map(),
    )?.selectNOptions,
  ).toEqual([
    { id: 1, label: 'Blight cost' },
    { id: 2, label: 'Mana cost' },
  ])
})

test('mana type options preserve request colors and staged choice', () => {
  expect(
    castingOptionCandidateView(
      {
        ctoId: 2,
        castingTimeOptionType: 9,
        selectManaTypeReq: { manaColors: [10, 5] },
      },
      tables,
      new Map(),
      [],
      new Map([[2, 10]]),
    ),
  ).toMatchObject({
    ctoId: 2,
    manaColors: [10, 5],
    selectedManaColor: 10,
  })
})
test('target options use relative players and neutral card fallbacks', () => {
  const targetTables: GreTables = {
    objects: new Map([[100, { instanceId: 100, grpId: 42 }]]),
    zones: new Map(),
    players: new Map([[2, { systemSeatNumber: 2 }]]),
  }

  expect(targetCandidateView({ targetInstanceId: 2 }, 0, targetTables, new Map(), 1)?.name).toBe(
    'Opponent',
  )
  expect(targetCandidateView({ targetInstanceId: 100 }, 0, targetTables, new Map(), 1)?.name).toBe(
    'Card',
  )
})

test('optional actions prefer localized ability text and retain source context', () => {
  const optionalTables: GreTables = {
    objects: new Map([
      [100, { instanceId: 100, type: 1, grpId: 42 }],
      [101, { instanceId: 101, type: 3, grpId: 700, parentId: 100 }],
      [102, { instanceId: 102, type: 1, grpId: 43 }],
    ]),
    zones: new Map(),
    players: new Map(),
  }
  const meta = new Map<number, CardMeta>([
    [
      42,
      {
        grpId: 42,
        name: 'Arabella',
        abilities: { 700: { text: 'Return Arabella to the command zone.' } },
      },
    ],
    [43, { grpId: 43, name: 'Target card' }],
  ])

  expect(
    optionalActionPresentation(
      { optionalActionMessage: { sourceId: 101, recipientIds: [102], optionalActionTypes: [22] } },
      optionalTables,
      meta,
    ),
  ).toEqual({
    title: 'Optional action for Arabella',
    detail: 'Return Arabella to the command zone.',
  })
  expect(
    optionalActionPresentation(
      { optionalActionMessage: { sourceId: 100, recipientIds: [102], optionalActionTypes: [22] } },
      optionalTables,
      meta,
    ),
  ).toEqual({
    title: 'Optional action for Arabella',
    detail: 'Choose whether to move Target card.',
  })
})

test('modal projection exposes additional costs, exclusions, and payable subsets', () => {
  const request = {
    ctoId: 9,
    castingTimeOptionType: 10,
    affectedId: 100,
    modalReq: {
      minSel: 1,
      maxSel: 2,
      modalOptions: [
        {
          grpId: 801,
          modeCost: [
            { manaCost: { color: [7], count: 2 } },
            { manaCost: { color: [2], count: 1 } },
          ],
        },
        { grpId: 804, modeCost: [{ manaCost: { color: [7], count: 3 } }] },
      ],
      excludedOptions: [{ grpId: 803, modeCost: [{ manaCost: { color: [7], count: 1 } }] }],
      modeCostSolutions: [{ modeGrpIds: [801] }, { modeGrpIds: [804] }],
    },
  }

  const view = castingOptionCandidateView(request, tables, cardMeta, [801, 804])!
  expect(view.selectionPayable).toBe(false)
  expect(view.modalOptions).toEqual([
    {
      index: 0,
      grpId: 801,
      label: 'Return target creature to its owner’s hand — {2}{U}',
      additionalCost: '{2}{U}',
      available: true,
      selectable: true,
      selected: true,
      selectedCount: 1,
    },
    {
      index: 1,
      grpId: 804,
      label: 'Second choice',
      additionalCost: '{3}',
      available: true,
      selectable: true,
      selected: true,
      selectedCount: 1,
    },
    {
      index: 0,
      grpId: 803,
      label: 'Unavailable choice',
      additionalCost: '{1}',
      available: false,
      selectable: false,
      selected: false,
      selectedCount: 0,
    },
  ])
  const partial = castingOptionCandidateView(request, tables, cardMeta, [801])!
  expect(partial.selectionPayable).toBe(true)
  expect(partial.modalOptions[0]!.selectable).toBe(true)
  expect(partial.modalOptions[1]!.selectable).toBe(false)
})

test('missing and empty mode cost solutions leave modal selection unconstrained', () => {
  expect(modeSelectionAllowed({}, [801])).toBe(true)
  expect(modeSelectionAllowed({ modeCostSolutions: [] }, [801])).toBe(true)
})

test('mode cost solutions preserve repeated-mode cardinality', () => {
  const request = { modeCostSolutions: [{ modeGrpIds: [801, 801, 802] }] }
  expect(modeSelectionAllowed(request, [801, 801], true)).toBe(true)
  expect(modeSelectionAllowed(request, [801, 801, 802])).toBe(true)
  expect(modeSelectionAllowed(request, [801, 802, 802])).toBe(false)
})

test('cost choices project aligned Forge text and typed native fallbacks without changing ids', () => {
  const view = castingOptionCandidateView(
    {
      ctoId: 41,
      castingTimeOptionType: 11,
      selectNReq: {
        ids: [9, 0, 17, 22, 30, 31, 32, 33],
        prompt: {
          parameters: [
            { type: 1, stringValue: '  Sacrifice an artifact  ' },
            { type: 1, stringValue: 'Invalid slot' },
            { type: 1, stringValue: 'Discard a card' },
            { type: 5, promptId: 1523 },
            { type: 5, promptId: 1024 },
            { type: 1, stringValue: ' ', promptId: 1523 },
            { type: 2, stringValue: 'Wrong type', promptId: 1024 },
            { type: 5, promptId: 4275 },
          ],
        },
      },
    },
    tables,
    cardMeta,
  )!
  expect(view.ctoId).toBe(41)
  expect(view.selectNOptions).toEqual([
    { id: 9, label: 'Sacrifice an artifact' },
    { id: 17, label: 'Discard a card' },
    { id: 22, label: 'Sacrifice an artifact' },
    { id: 30, label: 'Discard a card' },
    { id: 31, label: 'Choose this cost option' },
    { id: 32, label: 'Choose this cost option' },
    { id: 33, label: 'Pay 3 life' },
  ])
})

test('optional costs prefer typed Forge text while retaining catalog and type fallbacks', () => {
  const option = { ctoId: 1, castingTimeOptionType: 3, affectedId: 100, grpId: 700 }
  const prompt = (type: number, text: string, name = 'Cost') => ({
    parameters: [{ parameterName: name, type, stringValue: text }],
  })
  expect(
    castingOptionCandidateView(
      { ...option, prompt: prompt(1, ' Kicker - {4} ') },
      tables,
      cardMeta,
    ),
  ).toMatchObject({ ctoId: 1, grpId: 700, label: 'Kicker - {4}' })
  for (const invalid of [
    prompt(5, 'Wrong type'),
    prompt(1, ' '),
    prompt(1, 'Other text', 'Source'),
  ]) {
    expect(
      castingOptionCandidateView({ ...option, prompt: invalid }, tables, cardMeta)?.label,
    ).toBe('Gift a tapped Fish token — {1}')
    expect(
      castingOptionCandidateView({ ...option, prompt: invalid }, tables, new Map())?.label,
    ).toBe('Pay kicker')
  }
  expect(
    castingOptionCandidateView(
      { ...option, castingTimeOptionType: 1, prompt: prompt(1, 'Kicker') },
      tables,
      new Map(),
    )?.label,
  ).toBe('Cast without an additional cost')
})
