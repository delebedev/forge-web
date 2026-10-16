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

test('library viewer reads current metadata for the same object identity', () => {
  const zone: ZoneViewerState = {
    title: 'Top of your Library',
    cards: [card(10, 'Card')],
    source: 'library-top',
  }
  const enriched = card(10, 'Command Tower')

  expect(currentZoneViewer(zone, enriched)?.cards[0]).toBe(enriched)
  expect(libraryViewerIdentityChanged(zone, enriched)).toBe(false)
})

test('library viewer withdraws and clears hover when authorization or identity changes', () => {
  const zone: ZoneViewerState = {
    title: 'Top of your Library',
    cards: [card(10, 'Command Tower')],
    source: 'library-top',
  }

  expect(currentZoneViewer(zone, null)).toBeNull()
  expect(libraryViewerIdentityChanged(zone, null)).toBe(true)
  expect(libraryViewerIdentityChanged(zone, card(11, 'Forest'))).toBe(true)
})

test('known-hand inspection follows the current permitted inventory, including reset', () => {
  const zone: ZoneViewerState = {
    title: 'Known opponent hand',
    source: 'opponent-hand',
    cards: [card(10, 'Old face')],
  }
  const current = card(11, 'Currently visible')
  expect(currentZoneViewer(zone, null, [current])?.cards).toEqual([current])
  expect(currentZoneViewer(zone, null, [])).toBeNull()
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
