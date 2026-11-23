import { expect, test } from 'bun:test'
import { effectiveKeywordCoverage, lostKeywords } from './effective-keywords'
import { permanentState } from './permanent-state'
import { applyGsm, EMPTY_GAME_STATE } from './gre-accumulator'
import { buildBoardProjection } from './gre-projection'
import type { CardMeta, GameObject } from './gre-state'

const meta: CardMeta = {
  grpId: 100,
  name: 'Synthetic flyer',
  keywords: ['Flying', 'Vigilance'],
  abilities: { 300123: { keyword: 'Flying', text: 'Flying' }, 300124: { text: 'Other ability' } },
  mechanicHelp: [{ keyword: 'Flying', title: 'Flying', description: 'Flying help' }],
}
const object: GameObject = { instanceId: 101, grpId: 100, controllerSeatId: 1 }

const names = new Map<number, string>([
  [8, 'Flying'],
  [7, 'Haste'],
  [300123, 'Flying'],
  [300125, 'Vigilance'],
])

test('coverage is explicit and unknown metadata is not an empty effective set', () => {
  expect(effectiveKeywordCoverage(undefined)).toBeUndefined()
  expect(effectiveKeywordCoverage('Flying')).toBeUndefined()
  expect(effectiveKeywordCoverage(['Flying', 8])).toBeUndefined()
  expect(effectiveKeywordCoverage(['Vigilance'])).toEqual(['Vigilance'])
  expect(lostKeywords(object, meta, undefined, names)).toBeUndefined()
  expect(lostKeywords(object, meta, [], names)).toBeUndefined()
  expect(lostKeywords({ ...object, isFacedown: true }, meta, ['Flying'], names)).toBeUndefined()
  expect(
    lostKeywords(object, { ...meta, abilities: { 300123: { text: 'Flying' } } }, ['Flying'], names),
  ).toEqual(new Set())
  expect(lostKeywords(object, meta, ['Flying'], names)).toEqual(new Set(['flying']))
  expect(
    lostKeywords(
      { ...object, uniqueAbilities: [{ id: 50, grpId: 300123 }] },
      meta,
      ['Flying'],
      names,
    ),
  ).toEqual(new Set())
})

test('every covered printed keyword follows its ability row, and printed metadata stays intact', () => {
  const angel: CardMeta = {
    ...meta,
    abilities: {
      300123: { keyword: 'Flying', text: 'Flying' },
      300125: { keyword: 'Vigilance', text: 'Vigilance' },
    },
    mechanicHelp: [
      { keyword: 'Flying', title: 'Flying', description: 'Flying help' },
      { keyword: 'Vigilance', title: 'Vigilance', description: 'Vigilance help' },
    ],
  }
  const coverage = ['Flying', 'Vigilance']
  const decorate = (rows: number[]) =>
    permanentState(
      [],
      new Map([[100, angel]]),
      new Map([[101, { ...object, uniqueAbilities: rows.map((grpId, id) => ({ id, grpId })) }]]),
      coverage,
    )({
      ...object,
      objectType: 1,
      name: angel.name,
      grpId: 100,
      keywords: angel.keywords,
      mechanicHelp: angel.mechanicHelp,
    } as Parameters<ReturnType<typeof permanentState>>[0])
  const lostAll = decorate([])
  expect(lostAll.keywords).toEqual([])
  expect(lostAll.mechanicHelp).toEqual([])
  const keptVigilance = decorate([300125])
  expect(keptVigilance.keywords).toEqual(['Vigilance'])
  expect(keptVigilance.mechanicHelp?.map((help) => help.keyword)).toEqual(['Vigilance'])
  expect(decorate([300123, 300125]).keywords).toEqual(['Flying', 'Vigilance'])
  expect(angel.keywords).toEqual(['Flying', 'Vigilance'])
})

test('covered empty membership defeats persistent grants and help, without mutating printed metadata', () => {
  const grant = {
    id: 1,
    type: [9, 51],
    affectedIds: [101],
    details: [{ key: 'grpid', valueInt32: [8, 7] }],
  }
  const withHaste = { ...object, uniqueAbilities: [{ id: 61, grpId: 7 }] }
  const decorate = permanentState([grant], new Map([[100, meta]]), new Map([[101, withHaste]]), [
    'Flying',
    'Haste',
  ])
  const card = decorate({
    ...object,
    objectType: 1,
    name: meta.name,
    grpId: 100,
    keywords: meta.keywords,
    mechanicHelp: meta.mechanicHelp,
  } as Parameters<typeof decorate>[0])
  expect(card.keywords).toEqual(['Vigilance', 'Haste'])
  expect(card.grantedKeywords).toEqual(['Haste'])
  expect(card.mechanicHelp?.some((help) => help.keyword === 'Flying')).toBe(false)
  expect(meta.keywords).toEqual(['Flying', 'Vigilance'])
  expect(meta.mechanicHelp?.[0]?.keyword).toBe('Flying')
  expect(
    lostKeywords(
      { ...object, uniqueAbilities: [{ id: 61, grpId: 8 }] },
      { ...meta, keywords: [], abilities: {} },
      ['Flying'],
      names,
    ),
  ).toEqual(new Set())
})

test('resync, suppression, source retirement and old-source fallback use current object authority', () => {
  const full = {
    type: 1,
    gameStateId: 1,
    players: [
      { systemSeatNumber: 1, lifeTotal: 20 },
      { systemSeatNumber: 2, lifeTotal: 20 },
    ],
    zones: [{ zoneId: 28, type: 3, objectInstanceIds: [101] }],
    gameObjects: [{ ...object, uniqueAbilities: [{ id: 50, grpId: 300123 }] }],
  }
  const cards = new Map([[100, meta]])
  const initial = applyGsm(EMPTY_GAME_STATE, full)
  const project = (state: typeof initial, coverage: readonly string[] | undefined = ['Flying']) =>
    buildBoardProjection(state, cards, false, state, coverage).battlefield[0]!
  expect(project(initial).keywords).toContain('Flying')
  const suppressed = applyGsm(initial, { gameStateId: 2, gameObjects: [object] })
  expect(project(suppressed).keywords).not.toContain('Flying')
  const resynced = applyGsm(suppressed, { ...full, gameStateId: 3, gameObjects: [object] })
  expect(project(resynced).keywords).not.toContain('Flying')
  expect(project(resynced, []).keywords).toContain('Flying')
  const restored = applyGsm(resynced, { gameStateId: 4, gameObjects: full.gameObjects })
  expect(project(restored).keywords).toContain('Flying')
  const removed = applyGsm(restored, {
    diffDeletedInstanceIds: [101],
    zones: [{ zoneId: 28, type: 3, objectInstanceIds: [] }],
  })
  expect(buildBoardProjection(removed, cards, false, removed, ['Flying']).battlefield).toEqual([])
})
