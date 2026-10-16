import { describe, it, expect } from 'bun:test'
import {
  cmcBucketKey,
  buildCmcGroups,
  curveCounts,
  maxCurveCount,
  emptyLandCounts,
  incrementLand,
  decrementLand,
  totalLandCount,
  type IndexedCard,
} from './deck-builder'

function card(overrides: Partial<IndexedCard> & { name: string }): IndexedCard {
  return {
    poolIndex: 0,
    grpId: null,
    manaCost: null,
    typeLine: null,
    rarity: null,
    colors: [],
    setCode: null,
    collectorNumber: null,
    ...overrides,
  }
}

describe('cmcBucketKey', () => {
  it('counts variable mana as zero in a saved card cost', () => {
    expect(cmcBucketKey(card({ name: 'Variable', manaCost: '{X}{Y}{Z}{2}{G}' }))).toBe('3')
  })
  it('buckets a 5-drop under its own cmc', () => {
    expect(cmcBucketKey(card({ name: 'Five', manaCost: '{5}' }))).toBe('5')
  })

  it('buckets exactly 6 cmc into the 6+ bucket', () => {
    expect(cmcBucketKey(card({ name: 'Six', manaCost: '{6}' }))).toBe('6+')
  })

  it('buckets above 6 cmc into the 6+ bucket', () => {
    expect(cmcBucketKey(card({ name: 'Ten', manaCost: '{7}{3}' }))).toBe('6+')
  })

  it('buckets lands into the land bucket regardless of mana cost', () => {
    expect(cmcBucketKey(card({ name: 'Island', typeLine: 'Basic Land — Island' }))).toBe('L')
  })
})

describe('curveCounts / maxCurveCount', () => {
  it('excludes the land bucket and counts the rest', () => {
    const groups = buildCmcGroups([
      card({ name: 'One', manaCost: '{1}' }),
      card({ name: 'Two', manaCost: '{2}' }),
      card({ name: 'Two-B', manaCost: '{2}' }),
      card({ name: 'Island', typeLine: 'Basic Land — Island' }),
    ])
    expect(curveCounts(groups)).toEqual({ '1': 1, '2': 2 })
  })

  it('returns 1 as the floor when there are no non-land cards', () => {
    expect(maxCurveCount(curveCounts([]))).toBe(1)
  })

  it('returns the largest bucket count', () => {
    expect(maxCurveCount({ '1': 2, '2': 5, '3': 1 })).toBe(5)
  })
})

describe('basic land counts', () => {
  it('starts all lands at zero', () => {
    expect(emptyLandCounts()).toEqual({ Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 })
  })

  it('increments only the target land, without mutating the input', () => {
    const start = emptyLandCounts()
    const next = incrementLand(start, 'Island')
    expect(next).toEqual({ Plains: 0, Island: 1, Swamp: 0, Mountain: 0, Forest: 0 })
    expect(start.Island).toBe(0)
  })

  it('decrements only the target land, without mutating the input', () => {
    const start = { ...emptyLandCounts(), Forest: 3 }
    const next = decrementLand(start, 'Forest')
    expect(next.Forest).toBe(2)
    expect(start.Forest).toBe(3)
  })

  it('floors at zero and returns the same reference instead of going negative', () => {
    const start = emptyLandCounts()
    const next = decrementLand(start, 'Swamp')
    expect(next).toBe(start)
    expect(next.Swamp).toBe(0)
  })

  it('sums all five basic lands', () => {
    const counts = { Plains: 4, Island: 3, Swamp: 0, Mountain: 6, Forest: 4 }
    expect(totalLandCount(counts)).toBe(17)
  })
})
