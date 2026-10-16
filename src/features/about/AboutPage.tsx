import type { MouseEvent } from 'react'
import { useRouter } from '@app/router'
import styles from './AboutPage.module.css'
import { productionFeedbackEnabled } from '@shared/feedback'

/** Content for the shared public page shell. */
export function AboutPage() {
  const router = useRouter()
  const productionFeedback = productionFeedbackEnabled()
  function follow(event: MouseEvent<HTMLAnchorElement>): void {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    router.navigate(event.currentTarget.getAttribute('href')!)
  }
  return (
    <article className={styles.article}>
      <h1>
        A seat at the table.
        <br />
        Any time.
      </h1>
      <p className={styles.lede}>
        Forge Web brings your favourite card game to the browser. A place to try a deck, find a new
        line, or simply watch a game unfold.
      </p>
      <div className={styles.columns}>
        <section>
          <h2>Play at your own pace</h2>
          <p>
            Choose a deck and play against the computer. No download required. Sign in with an email
            code when you’re ready to play.
          </p>
          <h2>Watch before you play</h2>
          <p>
            The live table is open to everyone, without an account. AI opponents play continuously,
            with a new game following each result.
          </p>
          <a href="/" onClick={follow}>
            Back to the live table
          </a>
        </section>
        <section>
          <h2>Bring your own deck</h2>
          <p>
            Import a deck list, keep it in your library, and take it into a game. We’re focusing on
            Standard and Commander play while the other modes take a break.
          </p>
          <h2>Built on Forge</h2>
          <p>
            Powered by the community’s open-source{' '}
            <a href="https://github.com/Card-Forge/forge" target="_blank" rel="noopener noreferrer">
              Card-Forge
            </a>{' '}
            rules engine, with a browser interface for casual play and experimentation.
          </p>
          <p>
            Want to build something with it?{' '}
            <a
              href="https://github.com/delebedev/forge-web"
              target="_blank"
              rel="noopener noreferrer"
            >
              Explore the source and contribute
            </a>{' '}
            code, puzzles, documentation, or your own agents.
          </p>
          <p className={styles.affiliation}>
            An independent project, not affiliated with the Card-Forge team.
          </p>
        </section>
      </div>
      <section className={styles.contact} aria-labelledby="contact-title">
        <div>
          <h2 id="contact-title">Get in touch</h2>
          {productionFeedback ? (
            <>
              <p>Feedback, questions, or ideas for the next game? Leave a note.</p>
              <a href="https://tally.so/r/obMXDX" target="_blank" rel="noopener noreferrer">
                Open form separately
              </a>
            </>
          ) : (
            <p>
              This copy does not send reports to Forge Web. Report local issues to the person
              running it. For the maintained project, use{' '}
              <a href="https://forgeweb.app/about" target="_blank" rel="noopener noreferrer">
                Forge Web’s contact page
              </a>{' '}
              or <a href="mailto:hello@forgeweb.app">email the maintainer</a>. No GitHub account
              needed.
            </p>
          )}
        </div>
        {productionFeedback && (
          <iframe
            title="Contact Forge Web"
            src="https://tally.so/embed/obMXDX?alignLeft=1&hideTitle=1&transparentBackground=1&dynamicHeight=1"
            loading="lazy"
          />
        )}
      </section>
      <section className={styles.faq} aria-label="Common questions">
        <h2>Before you take a seat</h2>
        <details>
          <summary>Is it free?</summary>
          <p>Yes. You can watch and play for free.</p>
        </details>
        <details>
          <summary>Do I need an account?</summary>
          <p>
            You can watch without signing in. To play and keep your decks, sign in with your email.
            There’s no password to remember.
          </p>
        </details>
        <details>
          <summary>Can I use my phone?</summary>
          <p>
            Desktop is the best experience right now. The mobile layout and game board still need
            refinement.
          </p>
        </details>
      </section>
      <div className={styles.actions}>
        <a className="public-primary" href="/login" onClick={follow}>
          Play against AI
        </a>
      </div>
      <footer className={styles.disclaimer}>
        Not affiliated with, endorsed, sponsored, or approved by Wizards of the Coast LLC. Magic:
        The Gathering and MTG are trademarks of Wizards of the Coast LLC. Card images and mana
        symbols are copyright Wizards of the Coast.
      </footer>
    </article>
  )
}
