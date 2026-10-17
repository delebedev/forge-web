import type {
  LegalAction,
  CardView,
  MessageTypeEntry,
  PlayerView,
  PromptView,
  TrafficStats,
} from '@engine/state/gre-state'
import type { GameOutcome } from '@engine/state/gre-outcome'
import type { BoardArrow } from '@engine/state/arrow-view'
import type { DungeonView } from '@engine/state/dungeon-view'
import type { GreGameType } from './start'
import type { GreConnectionClose } from './gre-connection'
import type { PresentationHint, PresentationMove } from '@engine/state/presentation-policy'
import type { GameLogEntry } from '@engine/state/game-log'

export type BoardPresentation = {
  seq: number
  lagging: boolean
  newStackAbility?: boolean
  hints: PresentationHint[]
  moves: PresentationMove[]
}

export type BoardSnapshot = {
  gameLog?: GameLogEntry[]
  connected: boolean
  status: string
  connectionClose: GreConnectionClose | null
  gameStateId: number
  phaseName: string
  stepName: string
  turnNumber: number
  activeSeatId: number
  prioritySeatId: number
  decisionSeatId: number
  gameOver: boolean
  outcome: GameOutcome | null
  viewer: PlayerView
  opponent: PlayerView | null
  hand: CardView[]
  /** Your command-zone cards, including cards without a currently legal action. */
  commandZone?: CardView[]
  emblems?: CardView[]
  opponentEmblems?: CardView[]
  dungeon?: DungeonView | null
  dungeonCard?: CardView | null
  opponentDungeon?: DungeonView | null
  opponentDungeonCard?: CardView | null
  battlefield: CardView[]
  graveyard: CardView[]
  exile: CardView[]
  sideboard: CardView[]
  libraryTop?: CardView | null
  opponentHand: CardView[]
  opponentBattlefield: CardView[]
  opponentGraveyard: CardView[]
  opponentExile: CardView[]
  stack: CardView[]
  stackCount: number
  targetArrows: BoardArrow[]
  legalActions: LegalAction[]
  nonHandActionCards: Array<{ action: LegalAction; card: CardView }>
  prompt: PromptView | null
  canPass: boolean
  // Chrome fields (connection/session diagnostics) — not read by the board itself,
  // but part of the same GreStore signal set and needed by TopBar/ConnectionPopup.
  viewerSeatId: number
  opponentSeatId: number
  currentMatchId: string
  currentGameType: GreGameType | null
  messageTypeFeed: MessageTypeEntry[]
  lastMessage: string
  trafficStats: TrafficStats
  logs: string[]
  errorCount: number
  /** Semantic motion for the step currently drawn by the board. */
  presentation?: BoardPresentation
}

export interface SnapshotSource {
  snapshot(): BoardSnapshot
  subscribe(listener: () => void): () => void
}
