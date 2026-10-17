import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { useRouter } from '@app/router'
import { SiteHeader } from '@shared/SiteHeader'
import { NotFoundPage } from '@features/not-found/NotFoundPage'
import { ReplayView } from './ReplayView'
import { CURATED_REPLAYS, curatedReplay, replaySetupPath } from './curated-replays'
import styles from './CuratedWatch.module.css'

const RESULT_DWELL_MS = 3_000

export function CuratedWatch({
  id,
  embedded = false,
  active = true,
}: {
  id?: string
  embedded?: boolean
  active?: boolean
}) {
  const router = useRouter()
  const [offset, setOffset] = useState(0)
  const [finished, setFinished] = useState(false)
  const initial = id ? curatedReplay(id) : CURATED_REPLAYS[0]
  const firstIndex = initial ? CURATED_REPLAYS.indexOf(initial) : -1
  const sample =
    firstIndex < 0 ? undefined : CURATED_REPLAYS[(firstIndex + offset) % CURATED_REPLAYS.length]
  const complete = useCallback(() => setFinished(true), [])

  useEffect(() => {
    if (!finished || !active) {
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    function schedule() {
      clearTimeout(timer)
      if (!document.hidden) {
        timer = setTimeout(() => {
          setFinished(false)
          setOffset((value) => value + 1)
        }, RESULT_DWELL_MS)
      }
    }
    schedule()
    document.addEventListener('visibilitychange', schedule)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [finished, active])

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
  const View = embedded ? 'section' : 'main'

  return (
    <div className={`public-theme ${styles.page} ${embedded ? styles.embedded : ''}`}>
      {!embedded && (
        <SiteHeader onNavigate={follow}>
          <nav className="site-header-links" aria-label="Main navigation">
            <a href="/play/game" onClick={follow}>
              Play against AI
            </a>
          </nav>
        </SiteHeader>
      )}
      <View className={styles.viewer} aria-label="Continuous gameplay">
        <div className={styles.heading}>
          <span>{sample.title}</span>
          <a className={styles.play} href={replaySetupPath(sample.id)} onClick={follow}>
            Play these decks
          </a>
        </div>
        <div className={styles.board}>
          <ReplayView key={sample.id} curated={sample} active={active} onComplete={complete} />
        </div>
      </View>
    </div>
  )
}
