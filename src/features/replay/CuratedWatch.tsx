import type { MouseEvent } from 'react'
import { useRouter } from '@app/router'
import { SiteHeader } from '@shared/SiteHeader'
import { SelectField } from '@shared/ui/Field'
import { NotFoundPage } from '@features/not-found/NotFoundPage'
import { ReplayView } from './ReplayView'
import { CURATED_REPLAYS, curatedReplay, replaySetupPath } from './curated-replays'
import styles from './CuratedWatch.module.css'

export function CuratedWatch({ id, embedded = false }: { id?: string; embedded?: boolean }) {
  const router = useRouter()
  const sample = id ? curatedReplay(id) : CURATED_REPLAYS[0]
  if (!sample) {
    return <NotFoundPage />
  }

  function follow(event: MouseEvent<HTMLAnchorElement>): void {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    router.navigate(event.currentTarget.getAttribute('href')!)
  }

  return (
    <div className={`public-theme ${styles.page} ${embedded ? styles.embedded : ''}`}>
      {!embedded && (
        <SiteHeader onNavigate={follow}>
          <a href="/play/game" onClick={follow}>
            Play against AI
          </a>
        </SiteHeader>
      )}
      <section className={styles.viewer} aria-label="Curated match replays">
        <header className={styles.heading}>
          <div className={styles.identity}>
            <strong className={styles.label}>Replay</strong>
            <label className={styles.picker}>
              Watch a game
              <SelectField
                aria-label="Choose replay"
                value={sample.id}
                onChange={(event) => router.navigate(`/watch/${event.currentTarget.value}`)}
              >
                {CURATED_REPLAYS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))}
              </SelectField>
            </label>
          </div>
          <a className={styles.play} href={replaySetupPath(sample.id)} onClick={follow}>
            Play these decks
          </a>
        </header>
        <p className={styles.description}>{sample.description}</p>
        <div className={styles.board}>
          <ReplayView key={sample.id} curated={sample} />
        </div>
      </section>
    </div>
  )
}
