/**
 * Chrome's derived display values, computed off a `BoardSnapshot` — connection
 * status, status text, active-match flag, log entries, and the phase summary
 * shown in `TopBar`.
 */

import type { BoardSnapshot } from '@engine/runtime/snapshot'

export type GreConnectionStatus = 'connecting' | 'connected' | 'error'

export function connectionStatusOf(board: BoardSnapshot): GreConnectionStatus {
  return board.connected ? 'connected' : board.status.includes('error') ? 'error' : 'connecting'
}

export function statusTextOf(board: BoardSnapshot): string {
  return board.outcome?.title ?? (board.gameOver ? 'Game over' : board.status)
}

export function hasActiveMatchOf(board: BoardSnapshot): boolean {
  return board.currentMatchId !== ''
}

export type ChromeLogEntry = { id: number; time: string; message: string }

/** Wraps the raw `string[]` log for display. */
export function logEntriesOf(board: BoardSnapshot): ChromeLogEntry[] {
  return board.logs.map((message, index) => ({ id: index, time: '', message }))
}

export function phaseSummaryOf(board: BoardSnapshot): string {
  const phase = formatPhase(
    board.stepName && board.stepName !== '-' ? board.stepName : board.phaseName,
    board,
  )
  const priority =
    board.prioritySeatId === board.viewerSeatId
      ? 'You'
      : board.prioritySeatId === board.opponentSeatId
        ? 'Opp'
        : ''
  return priority ? `${phase} · ${priority}` : phase
}

function formatPhase(value: string, board: BoardSnapshot): string {
  if (!value || value === '-') {
    return statusTextOf(board)
  }
  return value.replace(/([a-z])([0-9])/i, '$1 $2').replace(/([a-z])([A-Z])/g, '$1 $2')
}
