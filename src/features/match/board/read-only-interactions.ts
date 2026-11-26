import type { CardView } from '@engine/state/gre-state'
import type { BoardClick, BoardInteractions } from './board-interactions'

export const READ_ONLY_INTERACTIONS: BoardInteractions = {
  drag: null,
  declaredAttackers: new Set<number>(),
  blockAssignments: [],
  boardCardState: (_card: CardView): BoardClick => ({
    selectable: false,
    selected: false,
    disabled: false,
  }),
  startHandDrag: () => false,
  moveDrag: () => {},
  endDrag: () => {},
}
