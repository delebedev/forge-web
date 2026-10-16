import type { BoardSnapshot } from '@engine/runtime/snapshot'
import { stepKey, type StepKey } from './priority-policy'

export function isMyTurnOf(board: BoardSnapshot): boolean {
  return board.activeSeatId === board.viewerSeatId
}

/** Normalized current phase/step key. */
export function currentStepKeyOf(board: BoardSnapshot): StepKey {
  return stepKey(board.phaseName, board.stepName)
}

export function viewerHasPriorityOf(board: BoardSnapshot): boolean {
  return board.canPass && board.prioritySeatId === board.viewerSeatId
}

export function hasPlayOf(
  board: Pick<BoardSnapshot, 'legalActions' | 'nonHandActionCards'>,
): boolean {
  return board.legalActions.some((action) => action.shouldStop)
}

export function opponentOnStackOf(board: Pick<BoardSnapshot, 'stack' | 'opponentSeatId'>): boolean {
  return board.opponentSeatId > 0 && board.stack[0]?.controllerSeatId === board.opponentSeatId
}

/** Holding priority with the stack live and a play available = a response window. */
export function canRespondOf(board: BoardSnapshot): boolean {
  return viewerHasPriorityOf(board) && board.stack.length > 0 && hasPlayOf(board)
}
