import { useState } from 'react'
import type { BoardSnapshot } from '@engine/runtime/snapshot'
import { cx } from '@shared/react/cx'
import { connectionStatusOf, logEntriesOf } from '../chrome-derive'
import { ConnectionPopup } from './ConnectionPopup'
import styles from '../TopBar.module.css'

export function BoardConnectionDetails({ board }: { board: BoardSnapshot }) {
  const [open, setOpen] = useState(false)
  const status = connectionStatusOf(board)
  return (
    <>
      <button
        className={cx(
          styles.connButton,
          open && styles.open,
          status === 'connected' && styles.connected,
          status === 'error' && styles.error,
        )}
        style={{ width: 28, height: 28 }}
        type="button"
        aria-label="Connection details"
        title="Connection details"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className={styles.connDot} />
        {board.errorCount > 0 && <span className={styles.connError}>{board.errorCount}</span>}
      </button>
      <ConnectionPopup
        open={open}
        onClose={() => setOpen(false)}
        connectionStatus={status}
        messageTypeFeed={board.messageTypeFeed}
        lastMessage={board.lastMessage}
        errorCount={board.errorCount}
        trafficStats={board.trafficStats}
        roomId={board.currentMatchId || null}
        gameId={board.currentGameType}
        logs={logEntriesOf(board)}
      />
    </>
  )
}
