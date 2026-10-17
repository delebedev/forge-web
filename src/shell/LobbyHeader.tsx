import { useMemo, type MouseEvent } from 'react'
import { SiteHeader } from '@shared/SiteHeader'
import { useRouter } from '@app/router'
import { prepareBugReport, trackBugReportOpen } from '@shared/feedback'
import { authStore } from '@shared/auth/auth'
import { useAuthSnapshot } from '@shared/auth/hooks'
import { useDecksSnapshot } from '@features/decks/decks-hooks'
import { useBoardSnapshot, useGreSessionSnapshot } from '@engine/runtime/hooks'
import styles from './LobbyHeader.module.css'
import { useWhatsNew } from '@features/whats-new/WhatsNewController'
import { dailyBrowserChallengePath } from '@features/challenges/browser-challenges'
import { hasCompletedDailyPuzzle } from '@features/challenges/daily-progress'

export function LobbyHeader() {
  const router = useRouter()
  const auth = useAuthSnapshot()
  const board = useBoardSnapshot()
  const decks = useDecksSnapshot()
  const session = useGreSessionSnapshot()
  const { openWhatsNew } = useWhatsNew()
  const dailyComplete = hasCompletedDailyPuzzle()
  const reportDeckId = router.route === 'decks' ? decks.selectedDeck?.id : undefined
  const report = useMemo(
    () =>
      prepareBugReport({
        source: 'header',
        accountId: auth.player?.id,
        deckId: reportDeckId,
      }),
    [auth.player?.id, reportDeckId],
  )
  function follow(e: MouseEvent<HTMLAnchorElement>) {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return
    }
    e.preventDefault()
    router.navigate(e.currentTarget.getAttribute('href')!)
  }
  return (
    <SiteHeader onNavigate={follow}>
      <nav className={styles.navigation} aria-label="Main navigation">
        <a
          href="/play/game"
          onClick={follow}
          aria-current={router.route === 'game' ? 'page' : undefined}
        >
          Play
        </a>
        <a
          className="nav-link-with-badge"
          href="/play/limited?mode=draft"
          onClick={follow}
          aria-current={router.route === 'limited' ? 'page' : undefined}
        >
          Draft
          <span className={`nav-badge ${styles.draftBadge}`}>New</span>
        </a>
        <a
          href="/decks"
          onClick={follow}
          aria-current={router.route === 'decks' ? 'page' : undefined}
        >
          Decks
        </a>
        <a className="nav-link-with-badge" href={dailyBrowserChallengePath()} onClick={follow}>
          Daily puzzle
          <span className="nav-badge" data-complete={dailyComplete}>
            {dailyComplete ? 'Done' : 'New'}
          </span>
        </a>
        <a href="/watch" onClick={follow}>
          Watch
        </a>
        <a href="/roadmap" onClick={follow}>
          Roadmap
        </a>
        {import.meta.env.DEV && (
          <a
            href="/challenges"
            onClick={follow}
            aria-current={router.route === 'challenges' ? 'page' : undefined}
          >
            Challenges
          </a>
        )}
      </nav>
      <div className={styles.utilities}>
        {session.config?.matchId &&
          !session.isSpectator &&
          board.connected &&
          !board.gameOver &&
          router.lastMatchPath && (
            <a href={router.lastMatchPath} onClick={follow}>
              Return to game
            </a>
          )}
        <button className={styles.newsLink} type="button" onClick={() => openWhatsNew('header')}>
          What's new
        </button>
        <a
          href={report.url}
          onClick={() => trackBugReportOpen(report)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Feedback
        </a>
        <details>
          <summary>Account</summary>
          <div className={styles.menu}>
            <span>{auth.player?.name ?? 'Player'}</span>
            <a href="/about" onClick={follow}>
              About Forge Web
            </a>
            <button type="button" onClick={() => void authStore.logout()}>
              Sign out
            </button>
          </div>
        </details>
      </div>
    </SiteHeader>
  )
}
