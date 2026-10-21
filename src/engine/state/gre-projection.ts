/**
 * Board projection — the read-model derived from shown/current GameStates and cardMeta.
 * Pure and side-effect-free so GreStore can memoize it: every getter it used
 * to expose (hand, battlefield, players, legalActions, ...) recomputed
 * independently on every access, re-deriving `playerViews`/`cardsInZone`
 * many times per publish. Compute once per projection input here.
 */
import type { GameState } from './gre-accumulator'
import type { BoardArrow } from './arrow-view'
import {
  cardsInZone,
  cardViewForAction,
  commandZoneCards,
  GAME_OBJECT_TYPE_EMBLEM,
  deriveLegalActions,
  passAction,
  playerViews,
  stackEntryCount,
  visibleLibraryTop,
  visibleHandCards,
  ZONE_BATTLEFIELD,
  ZONE_COMMAND,
  ZONE_EXILE,
  ZONE_GRAVEYARD,
  ZONE_HAND,
  ZONE_LIBRARY,
  ZONE_SIDEBOARD,
  ZONE_STACK,
  type Action,
  type CardMeta,
  type CardView,
  type LegalAction,
  type PlayerView,
} from './gre-state'
import { counterTotals, permanentState } from './permanent-state'
import { targetSpecArrows } from './target-spec'
import { emptyPlayer } from './gre-view'
import { dungeonCardView, dungeonViews, type DungeonView } from './dungeon-view'

export type BoardProjection = {
  hand: CardView[]
  /** Your authoritative command-zone cards, regardless of cast legality. */
  commandZone: CardView[]
  emblems: CardView[]
  opponentEmblems: CardView[]
  dungeon: DungeonView | null
  dungeonCard: CardView | null
  opponentDungeon: DungeonView | null
  opponentDungeonCard: CardView | null
  battlefield: CardView[]
  graveyard: CardView[]
  exile: CardView[]
  sideboard: CardView[]
  libraryTop: CardView | null
  stack: CardView[]
  stackCount: number
  targetArrows: BoardArrow[]
  legalActions: LegalAction[]
  nonHandActionCards: Array<{ action: LegalAction; card: CardView }>
  players: PlayerView[]
  viewer: PlayerView
  opponent: PlayerView | null
  opponentSeatId: number
  opponentHand: CardView[]
  opponentBattlefield: CardView[]
  opponentGraveyard: CardView[]
  opponentExile: CardView[]
  canPass: boolean
}

/** Drawn cards use `state`; legal-action identity uses `current`.
 *  `actionsInFlight`: while a submit is pending, every actions-derived view
 *  (legal actions, pass availability, per-card playable flags) reads as if
 *  the server had sent zero actions — matching the old "clear this.actions on
 *  submit" behaviour, without destroying the accumulator's own action list. */
export function buildBoardProjection(
  state: GameState,
  cardMeta: Map<number, CardMeta>,
  actionsInFlight: boolean,
  current: GameState = state,
  effectiveKeywordCoverage?: readonly string[],
): BoardProjection {
  const { tables, turn, viewerSeatId } = state
  const actions: Action[] = actionsInFlight ? [] : current.actions

  const counters = counterTotals(state.persistentAnnotations.values())
  const players = playerViews(tables, viewerSeatId, turn).map((player) => ({
    ...player,
    counters: counters.get(player.seatId) ?? [],
  }))
  const viewer = players.find((player) => player.isViewer) ?? emptyPlayer(viewerSeatId)
  const opponent = players.find((player) => !player.isViewer) ?? null
  const opponentSeatId = opponent?.seatId ?? 0
  const dungeons = dungeonViews(state.persistentAnnotations.values(), cardMeta)
  const dungeon = dungeons.get(viewerSeatId) ?? null
  const opponentDungeon = dungeons.get(opponentSeatId) ?? null
  const legalActions = deriveLegalActions(actions, current.tables, cardMeta)
  const commandZone = commandZoneCards(
    current.tables,
    viewerSeatId,
    actions,
    cardMeta,
    current.persistentAnnotations.values(),
  )
  const nonHandActionCards = legalActions.flatMap((action) => {
    if (
      action.zoneType !== ZONE_GRAVEYARD &&
      action.zoneType !== ZONE_EXILE &&
      action.zoneType !== ZONE_LIBRARY &&
      action.zoneType !== ZONE_COMMAND
    ) {
      return []
    }
    const card = cardViewForAction(action, current.tables, cardMeta)
    return card ? [{ action, card }] : []
  })

  const decorate = permanentState(
    state.persistentAnnotations.values(),
    cardMeta,
    tables.objects,
    effectiveKeywordCoverage,
  )

  return {
    hand: cardsInZone(tables, ZONE_HAND, viewerSeatId, actions, cardMeta),
    commandZone,
    emblems: cardsInZone(current.tables, ZONE_COMMAND, viewerSeatId, [], cardMeta).filter(
      (card) => card.objectType === GAME_OBJECT_TYPE_EMBLEM,
    ),
    opponentEmblems:
      opponentSeatId > 0
        ? cardsInZone(current.tables, ZONE_COMMAND, opponentSeatId, [], cardMeta).filter(
            (card) => card.objectType === GAME_OBJECT_TYPE_EMBLEM,
          )
        : [],
    dungeon,
    dungeonCard: dungeonCardView(dungeon, viewerSeatId),
    opponentDungeon,
    opponentDungeonCard: dungeonCardView(opponentDungeon, opponentSeatId),
    battlefield: cardsInZone(tables, ZONE_BATTLEFIELD, viewerSeatId, actions, cardMeta).map(
      decorate,
    ),
    graveyard: cardsInZone(tables, ZONE_GRAVEYARD, viewerSeatId, actions, cardMeta),
    exile: cardsInZone(tables, ZONE_EXILE, viewerSeatId, actions, cardMeta),
    sideboard: cardsInZone(tables, ZONE_SIDEBOARD, viewerSeatId, actions, cardMeta),
    libraryTop: visibleLibraryTop(tables, viewerSeatId, actions, cardMeta),
    stack: cardsInZone(tables, ZONE_STACK, 0, actions, cardMeta),
    stackCount: stackEntryCount(current.tables),
    targetArrows: targetSpecArrows(
      state.persistentAnnotations.values(),
      tables,
      viewerSeatId,
      opponentSeatId,
    ),
    legalActions,
    nonHandActionCards,
    players,
    viewer,
    opponent,
    opponentSeatId,
    opponentHand:
      opponentSeatId > 0
        ? visibleHandCards(current.tables, opponentSeatId, viewerSeatId, cardMeta)
        : [],
    opponentBattlefield:
      opponentSeatId > 0
        ? cardsInZone(tables, ZONE_BATTLEFIELD, opponentSeatId, actions, cardMeta).map(decorate)
        : [],
    opponentGraveyard:
      opponentSeatId > 0
        ? cardsInZone(tables, ZONE_GRAVEYARD, opponentSeatId, actions, cardMeta)
        : [],
    opponentExile:
      opponentSeatId > 0 ? cardsInZone(tables, ZONE_EXILE, opponentSeatId, actions, cardMeta) : [],
    canPass: passAction(actions) != null,
  }
}
