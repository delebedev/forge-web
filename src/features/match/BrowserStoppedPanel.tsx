/** Stopped browser game: the cause, the one recovery try, and ways to continue. */

import styles from './GrePlay.module.css'

export function BrowserStoppedPanel({
  error,
  recoveryFailed,
  courseUnsaved,
  onRecover,
  onStartAgain,
  onChooseDeck,
  reportUrl,
  onReportOpen,
}: {
  error: string
  recoveryFailed: boolean
  /** An unsaved course result must not be discarded by a restart. */
  courseUnsaved: boolean
  onRecover?: () => void
  onStartAgain?: () => void
  onChooseDeck?: () => void
  reportUrl: string
  onReportOpen?: () => void
}) {
  const canStartAgain = !onRecover && onStartAgain && !courseUnsaved
  return (
    <section className={styles.launchError} role="alert">
      <strong>{recoveryFailed ? 'Game could not be recovered' : 'Browser game stopped'}</strong>
      {recoveryFailed && <p>Start again with the same decks, or choose another deck.</p>}
      <p>{error}</p>
      {onRecover && (
        <p>
          Experimental recovery. Undoes your last choice and later progress. One try per game in
          this tab.
        </p>
      )}
      <div>
        {onRecover && (
          <button type="button" onClick={onRecover}>
            Recover game
          </button>
        )}
        {canStartAgain && (
          <button type="button" onClick={onStartAgain}>
            Start again
          </button>
        )}
        {onChooseDeck && (
          <button type="button" onClick={onChooseDeck}>
            Choose another deck
          </button>
        )}
        <a href={reportUrl} target="_blank" rel="noreferrer" onClick={onReportOpen}>
          Report a problem
        </a>
      </div>
    </section>
  )
}
