import { expect, test } from 'bun:test'
import type { CardView } from '@engine/state/gre-state'
import {
  currentZoneViewer,
  currentHandHoveredCard,
  libraryViewerIdentityChanged,
  type ZoneViewerState,
} from './types'

function card(instanceId: number, name: string): CardView {
  return {
    instanceId,
    grpId: 1,
    name,
    typeLine: 'Land',
    manaCost: '',
    powerToughness: '',
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
    imageUrl: '',
    controllerSeatId: 1,
  }
}

function viewerBoard(overrides: Partial<Parameters<typeof currentZoneViewer>[1]> = {}) {
  return {
    currentMatchId: 'match',
    libraryTop: null,
    opponentHand: [],
    graveyard: [],
    opponentGraveyard: [],
    exile: [],
    opponentExile: [],
    ...overrides,
  }
}

for (const source of ['graveyard', 'opponentGraveyard', 'exile', 'opponentExile'] as const) {
  test(`${source} viewer follows additions, metadata refresh and removals while open`, () => {
    const zone: ZoneViewerState = { title: 'Zone', source, matchId: 'match' }
    const old = card(10, 'Old face')
    const current = card(10, 'Current face')
    expect(currentZoneViewer(zone, viewerBoard({ [source]: [old] }))?.cards).toEqual([old])
    expect(
      currentZoneViewer(zone, viewerBoard({ [source]: [current, card(11, 'New card')] }))?.cards,
    ).toEqual([current, card(11, 'New card')])
    expect(currentZoneViewer(zone, viewerBoard())?.cards).toEqual([])
  })
}

test('zone inspection expires on a different match even when object identifiers are reused', () => {
  const zone: ZoneViewerState = { title: 'Your Graveyard', source: 'graveyard', matchId: 'old' }
  expect(currentZoneViewer(zone, viewerBoard({ graveyard: [card(10, 'New match')] }))).toBeNull()
  expect(currentZoneViewer(null, viewerBoard())).toBeNull()
})

test('library viewer reads current metadata for the same object identity', () => {
  const zone: ZoneViewerState = {
    title: 'Top of your Library',
    source: 'libraryTop',
    matchId: 'match',
    libraryInstanceId: 10,
  }
  const enriched = card(10, 'Command Tower')

  expect(currentZoneViewer(zone, viewerBoard({ libraryTop: enriched }))?.cards[0]).toBe(enriched)
  expect(libraryViewerIdentityChanged(zone, enriched)).toBe(false)
})

test('library viewer withdraws and clears hover when authorization or identity changes', () => {
  const zone: ZoneViewerState = {
    title: 'Top of your Library',
    source: 'libraryTop',
    matchId: 'match',
    libraryInstanceId: 10,
  }

  expect(currentZoneViewer(zone, viewerBoard())).toBeNull()
  expect(libraryViewerIdentityChanged(zone, null)).toBe(true)
  expect(libraryViewerIdentityChanged(zone, card(11, 'Forest'))).toBe(true)
})

test('known-hand inspection follows the current permitted inventory, including reset', () => {
  const zone: ZoneViewerState = {
    title: 'Known opponent hand',
    source: 'opponentHand',
    matchId: 'match',
  }
  const current = card(11, 'Currently visible')
  expect(currentZoneViewer(zone, viewerBoard({ opponentHand: [current] }))?.cards).toEqual([
    current,
  ])
  expect(currentZoneViewer(zone, viewerBoard())).toBeNull()
})

function hoverBoard(opponentHand: CardView[] = [], opponentBattlefield: CardView[] = []) {
  return {
    opponentHand,
    opponentBattlefield,
    hand: [],
    battlefield: [],
    graveyard: [],
    opponentGraveyard: [],
    exile: [],
    opponentExile: [],
    stack: [],
  }
}

test('known-hand hover uses current metadata and disappears after withdrawal or seek', () => {
  const old = card(10, 'Old face')
  const current = card(10, 'Current face')
  const prior = new Set([10])
  expect(currentHandHoveredCard(old, prior, hoverBoard([current]))).toBe(current)
  expect(currentHandHoveredCard(old, prior, hoverBoard())).toBeNull()
  expect(currentHandHoveredCard(old, prior, hoverBoard([card(11, 'Other face')]))).toBeNull()
  expect(currentHandHoveredCard(card(20, 'Battlefield'), prior, hoverBoard())?.instanceId).toBe(20)
})

test('known-hand hover survives a transfer to a currently visible public zone', () => {
  const old = card(10, 'Hand face')
  const current = card(10, 'Public face')
  const prior = new Set([10])
  expect(currentHandHoveredCard(old, prior, hoverBoard([], [current]))).toBe(current)
  expect(currentHandHoveredCard(current, prior, hoverBoard([], [current]))).toBe(current)
  expect(
    currentHandHoveredCard(old, prior, {
      ...hoverBoard(),
      stack: [{ ...card(20, 'Ability'), sourceCard: current }],
    }),
  ).toBe(current)
  expect(currentHandHoveredCard(old, prior, hoverBoard())).toBeNull()
})
