import type { ReactNode } from 'react'
import { useRouter } from '@app/router'
import { cx } from '@shared/react/cx'
import { TopBar } from './TopBar'
import { LobbyHeader } from './LobbyHeader'
import '@shared/public-theme.css'
import styles from './AppShell.module.css'

export function AppShell({
  children,
  onLeaveMatch,
}: {
  children: ReactNode
  onLeaveMatch?: () => void
}) {
  const router = useRouter()

  /**
   * Full-bleed, no rail: a board wants the whole window. Replay is a board too —
   * watching a game back should look like the game, not like a panel inside a
   * page.
   */
  const isMatch = router.route === 'match' || router.route === 'replay'

  /** Lobby surfaces share the entry palette; matches retain the full viewport. */
  const lobby =
    router.route === 'game' ||
    router.route === 'limited' ||
    router.route === 'decks' ||
    router.route === 'challenges'

  return (
    <div
      className={cx(
        styles.shell,
        lobby && 'public-theme',
        lobby && styles.lobby,
        isMatch && styles.matchMode,
        router.route === 'match' && styles.boardOnly,
      )}
    >
      {router.route !== 'match' && (
        <div className={styles.shellTopbar}>
          {lobby ? <LobbyHeader /> : <TopBar onLeaveMatch={onLeaveMatch} />}
        </div>
      )}

      <main className={cx(styles.shellContent, isMatch && styles.matchContent)}>{children}</main>
    </div>
  )
}
