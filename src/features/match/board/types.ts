/**
 * Shared board overlay state.
 */

import type { BoardSnapshot } from '@engine/runtime/snapshot'
import type { CardView } from '@engine/state/gre-state'

export type ZoneViewerSource =
  'graveyard' | 'opponentGraveyard' | 'exile' | 'opponentExile' | 'libraryTop' | 'opponentHand'

export type ZoneViewerState = {
  title: string
  source: ZoneViewerSource
  matchId: string
  libraryInstanceId?: number
} | null

export function currentZoneViewer(
  zone: ZoneViewerState,
  board: Pick<BoardSnapshot, ZoneViewerSource | 'currentMatchId'>,
): { title: string; cards: CardView[] } | null {
  if (!zone || zone.matchId !== board.currentMatchId) {
    return null
  }
  if (zone.source === 'libraryTop') {
    return board.libraryTop ? { title: zone.title, cards: [board.libraryTop] } : null
  }
  const cards = board[zone.source]
  return zone.source === 'opponentHand' && !cards.length ? null : { title: zone.title, cards }
}

export function libraryViewerIdentityChanged(
  zone: ZoneViewerState,
  libraryTop: CardView | null | undefined,
): boolean {
  return zone?.source === 'libraryTop' && zone.libraryInstanceId !== libraryTop?.instanceId
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
