import { cx } from '@shared/react/cx'
import styles from './TopBar.module.css'

/** Nav-left leaf: back-to-lobby in match mode, section tabs plus "return to game" otherwise. */
export function TopBarNav({
  isMatch,
  activeSection,
  hasActiveGame,
  onLeaveMatch,
  onNavigate,
  onReturnToGame,
}: {
  isMatch: boolean
  activeSection: 'play' | 'decks'
  hasActiveGame: boolean
  onLeaveMatch: () => void
  onNavigate: (path: string) => void
  onReturnToGame: () => void
}) {
  return (
    <div className={styles.navLeft}>
      {isMatch ? (
        <button className={cx(styles.navBtn, styles.backBtn)} type="button" onClick={onLeaveMatch}>
          <span className={styles.backArrow}>&larr;</span> Leave Match
        </button>
      ) : (
        <>
          <button
            className={cx(
              styles.navBtn,
              styles.sectionBtn,
              activeSection === 'play' && styles.active,
            )}
            type="button"
            onClick={() => onNavigate('/play/game')}
          >
            Play
          </button>
          <button
            className={cx(
              styles.navBtn,
              styles.sectionBtn,
              activeSection === 'decks' && styles.active,
            )}
            type="button"
            onClick={() => onNavigate('/decks')}
          >
            Decks
          </button>
        </>
      )}

      {hasActiveGame && (
        <button className={styles.returnPill} type="button" onClick={onReturnToGame}>
          <span className={styles.returnDot} />
          Return to Game
        </button>
      )}
    </div>
  )
}
