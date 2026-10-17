export type GreCloseCategory =
  'transient' | 'terminated' | 'unavailable' | 'denied' | 'completed' | 'abandoned'
export type GreSourceClose = { code: number; reason: string; wasClean: boolean }
export type GreConnectionClose = Pick<GreSourceClose, 'code'> & { category: GreCloseCategory }
export function classifyGreClose(
  _close: GreSourceClose | undefined,
  gameOver: boolean,
): GreCloseCategory {
  return gameOver ? 'completed' : 'terminated'
}
