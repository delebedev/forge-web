import { useState, type ReactNode, type MouseEvent } from 'react'
import { SiteHeader } from '@shell/SiteHeader'
import { useRouter } from '@shared/router'
import { useAuthSnapshot } from '@shared/auth/hooks'
import { loginReturnPath, signInHeading } from '@features/auth/login-return'
import { CuratedWatch } from '@features/replay/CuratedWatch'
import { useWhatsNew } from '@features/whats-new/WhatsNewController'
import '@shell/public-theme.css'
import styles from './LandingPage.module.css'
import { dailyBrowserChallengePath } from '@features/challenges/browser-challenges'
import { productionFeedbackEnabled } from '@shared/feedback'
import { hasCompletedDailyPuzzle } from '@features/challenges/daily-progress'

/** One public shell keeps the replay mounted through landing, login and About. */
export function LandingPage({
  screen,
  login,
  about,
}: {
  screen: 'landing' | 'login' | 'about'
  login: ReactNode
  about: ReactNode
}) {
  const router = useRouter()
  const auth = useAuthSnapshot()
  const { openWhatsNew } = useWhatsNew()
  const [expanded, setExpanded] = useState(false)
  const signingIn = screen === 'login'
  const returnPath = loginReturnPath(
    router.query.get('returnTo'),
    `${router.path}?${router.query.toString()}`,
  )
  const showingAbout = screen === 'about'
  const dailyComplete = hasCompletedDailyPuzzle()
  function follow(event: MouseEvent<HTMLAnchorElement>): void {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    setExpanded(false)
    router.navigate(event.currentTarget.getAttribute('href')!)
  }

  return (
    <div className={`public-theme ${styles.page}`}>
      <SiteHeader onNavigate={follow}>
        <nav className="site-header-links" aria-label="Main navigation">
          <a href="/watch" onClick={follow}>
            Watch
          </a>
          <a className="nav-link-with-badge" href={dailyBrowserChallengePath()} onClick={follow}>
            Daily Puzzle
            <span className="nav-badge" data-complete={dailyComplete}>
              {dailyComplete ? 'Done' : 'New'}
            </span>
          </a>
          {showingAbout && (
            <a
              className="site-contact"
              href={
                productionFeedbackEnabled() ? 'https://tally.so/r/obMXDX' : '/about#contact-title'
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              Get in touch
            </a>
          )}
          <button type="button" onClick={() => openWhatsNew('landing')}>
            What's new
          </button>
          <a href="/roadmap" onClick={follow}>
            Roadmap
          </a>
          <a href={showingAbout ? '/' : '/about'} onClick={follow}>
            {showingAbout ? 'Back to table' : 'About'}
          </a>
          {!signingIn && auth.ready && !auth.isAuthenticated && (
            <a href="/login" onClick={follow}>
              Sign in
            </a>
          )}
        </nav>
      </SiteHeader>
      <main
        className={`${styles.main} ${expanded ? styles.expanded : ''} ${showingAbout ? styles.about : ''}`}
      >
        <section
          className={styles.invitation}
          hidden={expanded || showingAbout}
          aria-labelledby="entry-title"
        >
          {signingIn ? (
            <>
              <a
                className={styles.back}
                href={returnPath === '/roadmap' ? '/roadmap' : '/'}
                onClick={follow}
              >
                Back
              </a>
              <h1 id="entry-title">{signInHeading(returnPath)}</h1>
              <p className={styles.description}>
                An account saves your decks, keeps your draft and sealed runs, and lets you vote on
                the roadmap. Enter your email and we’ll send you a sign-in code.
              </p>
              {login}
            </>
          ) : (
            <>
              <h1 id="entry-title">Play your next game.</h1>
              <p className={styles.description}>
                Choose a deck or bring your own. Play against AI, right in your browser.
              </p>
              <a className="public-primary" href="/play/game" onClick={follow}>
                Play against AI
              </a>
            </>
          )}
          <p className={styles.disclaimer}>
            Not affiliated with or endorsed by Wizards of the Coast.
          </p>
        </section>
        {showingAbout && about}
        <div className={styles.match} hidden={showingAbout}>
          <CuratedWatch embedded active={!showingAbout} />
          <button
            className={styles.expand}
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Back to landing' : 'Expand game'}
          </button>
        </div>
      </main>
    </div>
  )
}
