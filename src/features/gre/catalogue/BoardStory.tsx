import { useBoardInteractions } from '@features/gre/board/board-interactions'
import type { PromptBinding } from '@engine/runtime/prompts/family'
import { useEffect, useState } from 'react'
import type { BoardSnapshot } from '@engine/runtime/snapshot'
import type { CardView, LegalAction } from '@engine/state/gre-state'
import { Board } from '@features/gre/board/variants/classic/Board'
import { READ_ONLY_INTERACTIONS } from '@features/gre/board/read-only-interactions'
import {
  BOARD_VIEW_DEFAULTS,
  BOARD_WIDTHS,
  boardView,
  type BoardViewSnapshot,
} from '@features/gre/board/board-view'
import { useBoardView } from '@features/gre/board/BoardSettings'
import { currentZoneViewer, type ZoneViewerState } from '@features/gre/board/types'
import styles from './BoardStory.module.css'

export type BoardStoryProps = {
  board: BoardSnapshot
  interactive?: boolean
  replay?: boolean
  onLegalAction: (action: LegalAction) => void
  promptBinding?: PromptBinding | null
}

function setBoardView(view: BoardViewSnapshot): void {
  boardView.setWidth(view.width)
  boardView.setCardScale(view.cardScale)
  boardView.setHandScale(view.handScale)
  boardView.setHandOverlap(view.handOverlap)
  boardView.setPreviewScale(view.previewScale)
  boardView.setPlayerPanelScale(view.playerPanelScale)
  boardView.setHideStack(view.hideStack)
  boardView.setHideCardArt(view.hideCardArt)
}

export function BoardStory({
  board,
  interactive = true,
  replay = false,
  onLegalAction,
  promptBinding,
}: BoardStoryProps) {
  const view = useBoardView()
  const [hoveredCard, setHoveredCard] = useState<CardView | null>(null)
  const [zoneViewer, setZoneViewer] = useState<ZoneViewerState>(null)
  const width = BOARD_WIDTHS[view.width].px

  useEffect(() => {
    const previous = boardView.snapshot()
    setBoardView(BOARD_VIEW_DEFAULTS)
    return () => setBoardView(previous)
  }, [])

  const boardInteractions = useBoardInteractions(board.prompt, false, promptBinding ?? null, null)
  const interactions = {
    ...READ_ONLY_INTERACTIONS,
    boardCardState: boardInteractions.boardCardState,
    declaredAttackers: boardInteractions.declaredAttackers,
    blockAssignments: boardInteractions.blockAssignments,
  }

  return (
    <main className={styles.canvas}>
      <div className={styles.frame} style={width ? { width } : undefined}>
        <Board
          board={board}
          interactive={interactive}
          replay={replay}
          embedded={false}
          interactions={interactions}
          stops={new Set<string>()}
          canRespond={false}
          passing={false}
          onToggleStop={() => {}}
          onPassPriority={() => {}}
          onResolveAll={() => {}}
          onEndTurn={() => {}}
          onLegalAction={onLegalAction}
          promptBinding={promptBinding}
          hoveredCard={hoveredCard}
          onHover={setHoveredCard}
          zoneViewer={currentZoneViewer(zoneViewer, board)}
          onOpenZone={(title, source) =>
            setZoneViewer({ title, source, matchId: board.currentMatchId })
          }
          onCloseZone={() => setZoneViewer(null)}
          dropZoneRef={() => {}}
          onBackToPlay={() => {}}
          onPlayAgain={() => {}}
        />
      </div>
    </main>
  )
}

export function MotionBoardStory({
  boards,
  onLegalAction,
}: {
  boards: BoardSnapshot[]
  onLegalAction: (action: LegalAction) => void
}) {
  const [stage, setStage] = useState(0)
  const [resetKey, setResetKey] = useState(0)

  function reset(): void {
    setStage(0)
    setResetKey((value) => value + 1)
  }

  return (
    <>
      <BoardStory key={resetKey} board={boards[stage]!} onLegalAction={onLegalAction} />
      <div className={styles.fixtureControls} aria-label="Fixture controls">
        <button
          type="button"
          onClick={() => setStage((value) => Math.min(boards.length - 1, value + 1))}
          disabled={stage === boards.length - 1}
        >
          Step
        </button>
        <span className={styles.stageLabel} data-motion-stage>
          {stage + 1} of {boards.length}
        </span>
        <button type="button" onClick={reset} disabled={stage === 0}>
          Reset
        </button>
      </div>
    </>
  )
}
