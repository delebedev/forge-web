import { useEffect, useRef } from 'react'
import { GAME_LOG_LIMIT, type GameLogEntry } from '@engine/state/game-log'
import styles from './GameLogDrawer.module.css'

export function GameLogDrawer({
  entries,
  onClose,
}: {
  entries: GameLogEntry[]
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => previous?.focus()
  }, [])
  return (
    <section
      className={styles.drawer}
      role="dialog"
      aria-label="Game log"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <header className={styles.header}>
        <div>
          <h2>Game log</h2>
          <p>Latest first · Up to {GAME_LOG_LIMIT} recent events</p>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close game log">
          Close
        </button>
      </header>
      {entries.length === 0 ? (
        <p className={styles.empty}>No gameplay events yet.</p>
      ) : (
        <ol className={styles.entries} aria-label="Recent gameplay events">
          {[...entries].reverse().map((entry) => (
            <li key={entry.id}>
              <span className={styles.turn}>Turn {entry.turn}</span>
              <p>{entry.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
