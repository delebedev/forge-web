/** Live match surface with navigation and settings floating on the board. */

import { useEffect } from 'react'
import { greSession } from '@engine/runtime/gre-session'
import { GrePlay } from './GrePlay'
import { useRouter } from '@app/router'
import { useGreSessionSnapshot } from '@engine/runtime/hooks'
import styles from './MatchRoute.module.css'

export function MatchRoute() {
  const router = useRouter()
  const session = useGreSessionSnapshot()
  const matchId = router.params['matchId']

  // Full-bleed match room: `app.css` styles this via the `body.match-route`
  // hook.
  useEffect(() => {
    document.body.classList.add('match-route')
    return () => {
      document.body.classList.remove('match-route')
    }
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
    if (matchId === 'replay') {
      router.navigate('/play/replay', true)
      return
    }
    const stored = greSession.config ?? greSession.reload()
    if (greSession.canResumeRoute(matchId, stored)) {
      return
    }
    if (stored) {
      greSession.clear()
    }
    router.navigate(greSession.setupPath(matchId), true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId])

  if (matchId === 'replay' || !greSession.canResumeRoute(matchId, session.config)) {
    return null
  }

  return (
    <div className={styles.matchRoom}>
      <GrePlay
        initialConfig={session.config}
        autoStart={session.config != null && session.browserPhase !== 'lost'}
        launchKey={session.launchKey}
        showDeckConfig={false}
        showHeader={false}
        showHeaderActions={false}
        spectator={session.isSpectator}
        browserPhase={session.browserPhase}
        browserStatus={session.browserStatus}
        browserError={session.browserError}
        browserRecovered={session.browserRecovered}
        onRecoverBrowser={
          session.browserRecoveryAvailable ? () => greSession.recoverBrowser() : undefined
        }
        executionFallback={session.executionFallback}
        onMatchStarted={(id) => greSession.recordMatchId(id)}
        onBackToPlay={() => greSession.leave()}
        onPlayAgain={() => greSession.playAgain()}
      />
    </div>
  )
}
