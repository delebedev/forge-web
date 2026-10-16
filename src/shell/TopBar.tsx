import { useState } from 'react'
import { boardAudio } from '@shared/audio'
import { useSoundPreferences } from '@shared/audio-react'
import { authStore } from '@shared/auth/auth'
import { useRouter } from '@app/router'
import { cx } from '@shared/react/cx'
import {
  connectionStatusOf,
  hasActiveMatchOf,
  logEntriesOf,
  phaseSummaryOf,
  statusTextOf,
} from './chrome-derive'
import { useAuthSnapshot } from '@shared/auth/hooks'
import { useBoardSnapshot, useGreSessionSnapshot } from '@engine/runtime/hooks'
import { TopBarNav } from './TopBarNav'
import { TopBarMatchPill } from './TopBarMatchPill'
import { TopBarUserControls } from './TopBarUserControls'
import styles from './TopBar.module.css'

type Section = 'play' | 'decks'

export function TopBar({ onLeaveMatch }: { onLeaveMatch?: () => void }) {
  const router = useRouter()
  const auth = useAuthSnapshot()
  const board = useBoardSnapshot()
  const session = useGreSessionSnapshot()

  const isMatch = router.route === 'match'
  const activeSection: Section = router.route === 'decks' ? 'decks' : 'play'

  const rawConnectionStatus = connectionStatusOf(board)
  const iconConnectionStatus = isMatch ? rawConnectionStatus : 'idle'
  const hasActiveGame = !isMatch && hasActiveMatchOf(board) && router.lastMatchPath != null
  const phaseSummary = isMatch ? phaseSummaryOf(board) : ''
  const matchLabel =
    session.config?.label ?? board.currentGameType ?? router.params['matchId'] ?? 'match'
  const matchPrimary = session.config?.objective ?? phaseSummary
  const matchSecondary = session.config?.objective ? phaseSummary : statusTextOf(board)

  const [showConnectionPopup, setShowConnectionPopup] = useState(false)
  const sound = useSoundPreferences()

  function closeAllPopups(): void {
    setShowConnectionPopup(false)
  }

  function navTo(path: string): void {
    closeAllPopups()
    router.navigate(path)
  }

  function leaveMatch(): void {
    closeAllPopups()
    if (onLeaveMatch) {
      onLeaveMatch()
    } else {
      router.navigate('/play/game')
    }
  }

  return (
    <header className={cx(styles.topbar, isMatch && styles.matchMode)}>
      <TopBarNav
        isMatch={isMatch}
        activeSection={activeSection}
        hasActiveGame={hasActiveGame}
        onLeaveMatch={leaveMatch}
        onNavigate={navTo}
        onReturnToGame={() => router.navigate(router.lastMatchPath!)}
      />

      {isMatch && (
        <TopBarMatchPill label={matchLabel} primary={matchPrimary} secondary={matchSecondary} />
      )}

      <TopBarUserControls
        playerName={auth.player?.name}
        onLogout={() => void authStore.logout()}
        soundMuted={sound.muted}
        onToggleSound={boardAudio.toggleMute}
        iconConnectionStatus={iconConnectionStatus}
        errorCount={board.errorCount}
        showConnectionPopup={showConnectionPopup}
        onToggleConnectionPopup={() => setShowConnectionPopup((value) => !value)}
        onCloseConnectionPopup={closeAllPopups}
        popupConnectionStatus={rawConnectionStatus}
        messageTypeFeed={board.messageTypeFeed}
        lastMessage={board.lastMessage}
        trafficStats={board.trafficStats}
        roomId={board.currentMatchId || null}
        gameId={board.currentGameType}
        logs={logEntriesOf(board)}
      />
    </header>
  )
}
