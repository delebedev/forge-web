import { expect, test } from 'bun:test'
import type { CardView } from '@engine/state/gre-state'
import { attachmentsOf, lanesOf, pilesOf, soloPilesOf } from './board-derive'

let nextId = 1

function permanent(name: string, overrides: Partial<CardView> = {}): CardView {
  return {
    instanceId: nextId++,
    grpId: 0,
    name,
    typeLine: 'Basic Land — Forest',
    manaCost: '',
    powerToughness: '',
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
    imageUrl: '',
    controllerSeatId: 1,
    keywords: [],
    ...overrides,
  }
}

test('identical permanents collapse into one pile', () => {
  const piles = pilesOf([permanent('Forest'), permanent('Forest'), permanent('Forest')])

  expect(piles).toHaveLength(1)
  expect(piles[0]?.members).toHaveLength(3)
  expect(piles[0]?.card.name).toBe('Forest')
})

test('tapped and untapped copies pile separately', () => {
  const piles = pilesOf([
    permanent('Forest'),
    permanent('Forest', { tapped: true }),
    permanent('Forest'),
  ])

  expect(piles).toHaveLength(2)
  expect(piles.map((pile) => pile.members.length)).toEqual([2, 1])
  expect(piles[1]?.card.tapped).toBe(true)
})

test('different names never merge', () => {
  const piles = pilesOf([permanent('Forest'), permanent('Mountain'), permanent('Forest')])

  expect(piles).toHaveLength(2)
  expect(piles.map((pile) => pile.card.name)).toEqual(['Forest', 'Mountain'])
})

test('an actionable permanent stays on its own so the action keeps its target', () => {
  const piles = pilesOf([
    permanent('Llanowar Elves', { typeLine: 'Creature — Elf Druid' }),
    permanent('Llanowar Elves', { typeLine: 'Creature — Elf Druid', playableActivation: true }),
    permanent('Llanowar Elves', { typeLine: 'Creature — Elf Druid' }),
  ])

  expect(piles).toHaveLength(2)
  expect(piles[0]?.members).toHaveLength(2)
  expect(piles[1]?.members).toHaveLength(1)
  expect(piles[1]?.card.playableActivation).toBe(true)
})

test('attackers stay individually visible', () => {
  const piles = pilesOf([
    permanent('Goblin', { typeLine: 'Creature — Goblin', attacking: true }),
    permanent('Goblin', { typeLine: 'Creature — Goblin', attacking: true }),
  ])

  expect(piles).toHaveLength(2)
})

test('pile order follows first appearance', () => {
  const piles = pilesOf([permanent('Island'), permanent('Forest'), permanent('Island')])

  expect(piles.map((pile) => pile.card.name)).toEqual(['Island', 'Forest'])
})

test('creatures are never collapsed, however identical they look', () => {
  const bears = [permanent('Grizzly Bears'), permanent('Grizzly Bears')]
  const piles = soloPilesOf(bears)

  expect(piles).toHaveLength(2)
  expect(piles.every((pile) => pile.members.length === 1)).toBe(true)
  expect(piles.map((pile) => pile.card.instanceId)).toEqual(bears.map((card) => card.instanceId))
})

test('artifact creatures stay with the creatures', () => {
  const lanes = lanesOf([
    permanent('Bonded Construct', { typeLine: 'Artifact Creature — Construct' }),
  ])

  expect(lanes.creatures.map((c) => c.name)).toEqual(['Bonded Construct'])
  expect(lanes.permanents).toHaveLength(0)
})

test('noncreature permanents sort away from lands and creatures', () => {
  const lanes = lanesOf([
    permanent('Forest'),
    permanent('Questing Beast', { typeLine: 'Creature — Beast' }),
    permanent('Treasure', { typeLine: 'Artifact — Treasure' }),
    permanent('Pacifism', { typeLine: 'Enchantment — Aura' }),
  ])

  expect(lanes.lands.map((c) => c.name)).toEqual(['Forest'])
  expect(lanes.creatures.map((c) => c.name)).toEqual(['Questing Beast'])
  expect(lanes.permanents.map((c) => c.name)).toEqual(['Treasure', 'Pacifism'])
})

test('attachments group across controllers and missing hosts remain standalone', () => {
  const host = permanent('Bear', { typeLine: 'Creature' })
  const aura = permanent('Pacifism', {
    typeLine: 'Enchantment — Aura',
    controllerSeatId: 2,
    attachedTo: host.instanceId,
  })
  const missing = permanent('Equipment', { attachedTo: 9999 })
  expect(attachmentsOf([host, aura, missing])).toEqual(new Map([[host.instanceId, [aura]]]))
  expect(attachmentsOf([aura, missing]).size).toBe(0)
})

test('cyclic relationships do not hide permanents or recurse forever', () => {
  const a = permanent('A')
  const b = permanent('B', { attachedTo: a.instanceId })
  a.attachedTo = b.instanceId
  expect(attachmentsOf([a, b]).size).toBe(0)
})

test('lands with counters or attachments do not disappear into an identical pile', () => {
  const host = permanent('Forest')
  const countered = permanent('Forest', { counters: [{ type: 1, name: '+1/+1', count: 1 }] })
  expect(
    pilesOf(
      [host, countered, permanent('Forest'), permanent('Forest')],
      new Set([host.instanceId]),
    ).map((pile) => pile.members.length),
  ).toEqual([1, 1, 2])
})

test('phased-out lands do not ghost or hide active identical lands', () => {
  const active = permanent('Forest')
  const ghost = permanent('Forest', { phasedOut: true })
  const piles = pilesOf([active, ghost, permanent('Forest')])
  expect(piles.map((pile) => pile.members.length)).toEqual([2, 1])
  expect(piles[0]?.card.phasedOut).toBeUndefined()
  expect(piles[1]?.card).toBe(ghost)
})
