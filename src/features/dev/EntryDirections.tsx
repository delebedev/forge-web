import type { ReactNode } from 'react'
import { useRouter } from '@app/router'
import { scryfallUrl } from '@shared/cards/scryfall'
import './EntryDirections.css'

const cardImage = (name: string) => scryfallUrl({ name })

/** Card-room reference. Authentication remains owned by LoginPage. */
export function EntryDirections({ login }: { login: ReactNode }) {
  const router = useRouter()
  const signingIn = router.query.get('screen') === 'login'
  const href = (screen: string) => `/dev/entry?screen=${screen}`

  return (
    <div
      className="public-theme entry-study"
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }
        const anchor = (event.target as HTMLElement).closest('a')
        if (anchor?.getAttribute('href')?.startsWith('/dev/entry?')) {
          event.preventDefault()
          router.navigate(anchor.getAttribute('href')!)
        }
      }}
    >
      <div className="entry-world">
        <header className="entry-header">
          <a className="entry-brand" href={href('landing')} aria-label="Forge Web home">
            <svg viewBox="0 0 32 36" aria-hidden="true">
              <path d="M16 1 30 9v18l-14 8L2 27V9Zm0 7-8 5v10l8 5 8-5V13Z" fill="currentColor" />
              <path d="m12 13 9 0-5 7h5L11 29l4-11h-3Z" fill="currentColor" />
            </svg>
            <span>
              Forge<span className="entry-brand-web"> Web</span>
            </span>
          </a>
          <nav aria-label="Main navigation">
            <a href="/">Watch a match</a>
            <a href={href(signingIn ? 'landing' : 'login')}>
              {signingIn ? 'Back to home' : 'Sign in'}
            </a>
          </nav>
        </header>

        <main className={`entry-stage ${signingIn ? 'entry-signing' : ''}`}>
          <section className="entry-copy">
            {signingIn ? (
              <>
                <h1>
                  Your next
                  <br />
                  game awaits.
                </h1>
                <p className="entry-description">Sign in, choose your deck, and take a seat.</p>
                <div className="entry-auth">{login}</div>
              </>
            ) : (
              <>
                <p className="entry-intro">Your favourite card game.</p>
                <h1>
                  A good deck.
                  <br />A great game.
                </h1>
                <p className="entry-description">
                  <>
                    Bring your favorite deck to the table.
                    <br className="entry-desktop-break" /> Play against AI, whenever you feel like
                    it.
                  </>
                </p>
                <a className="entry-play" href={href('login')}>
                  Play against AI{' '}
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="m7 4 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                </a>
                <p className="entry-reassurance">Free to play. Nothing to download.</p>
              </>
            )}
          </section>

          <div
            className="entry-art"
            aria-label="Magic cards: Counterspell, Serra Angel and Lightning Bolt"
            role="img"
          >
            <div className="entry-table-ring" />
            <div className="entry-card-fan">
              <img className="entry-card entry-card-left" src={cardImage('Counterspell')} alt="" />
              <img
                className="entry-card entry-card-right"
                src={cardImage('Lightning Bolt')}
                alt=""
              />
              <img className="entry-card entry-card-center" src={cardImage('Serra Angel')} alt="" />
            </div>
            <span className="entry-art-caption">Old favorites. New possibilities.</span>
          </div>
        </main>
        <footer className="entry-footer">
          <span>A seat at the table. Any time.</span>
          <a href="/about">About Forge Web</a>
        </footer>
      </div>
      <aside className="entry-review" aria-label="Design reference">
        <span>Card-room reference</span>
        <a href="/">Live table</a>
        <a className="entry-review-screen" href={href(signingIn ? 'landing' : 'login')}>
          {signingIn ? 'View landing' : 'View login'}
        </a>
      </aside>
    </div>
  )
}
