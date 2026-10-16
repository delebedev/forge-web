/**
 * Shared board overlay state.
 */

import type { BoardSnapshot } from '@engine/runtime/snapshot'
import type { CardView } from '@engine/state/gre-state'

export type ZoneViewerState = {
  title: string
  cards: CardView[]
  source?: 'library-top' | 'opponent-hand'
} | null

export function currentZoneViewer(
  zone: ZoneViewerState,
  libraryTop: CardView | null | undefined,
  opponentHand: CardView[] = [],
): ZoneViewerState {
  if (zone?.source === 'opponent-hand') {
    return opponentHand.length ? { ...zone, cards: opponentHand } : null
  }
  if (zone?.source !== 'library-top') {
    return zone
  }
  return libraryTop ? { ...zone, cards: [libraryTop] } : null
}

export function libraryViewerIdentityChanged(
  zone: ZoneViewerState,
  libraryTop: CardView | null | undefined,
): boolean {
  return zone?.source === 'library-top' && zone.cards[0]?.instanceId !== libraryTop?.instanceId
}

export function currentHandHoveredCard(
  hovered: CardView | null,
  priorKnownHandIds: ReadonlySet<number>,
  board: Pick<
    BoardSnapshot,
    | 'opponentHand'
    | 'hand'
    | 'battlefield'
    | 'opponentBattlefield'
    | 'graveyard'
    | 'opponentGraveyard'
    | 'exile'
    | 'opponentExile'
    | 'stack'
    | 'commandZone'
    | 'libraryTop'
  >,
): CardView | null {
  if (!hovered || !priorKnownHandIds.has(hovered.instanceId)) {
    return hovered
  }
  const visibleCards = [
    ...board.opponentHand,
    ...board.hand,
    ...board.battlefield,
    ...board.opponentBattlefield,
    ...board.graveyard,
    ...board.opponentGraveyard,
    ...board.exile,
    ...board.opponentExile,
    ...board.stack.flatMap((card) => (card.sourceCard ? [card, card.sourceCard] : [card])),
    ...(board.commandZone ?? []),
    ...(board.libraryTop ? [board.libraryTop] : []),
  ]
  return visibleCards.find((card) => card.instanceId === hovered.instanceId) ?? null
}
