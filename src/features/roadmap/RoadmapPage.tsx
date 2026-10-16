import { RoadmapItemSchema } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useRouter } from '@app/router'
import { apiFetch } from '@shared/api/client'
import type { WebComponents } from '@shared/api/contracts'
import { useAuthSnapshot } from '@shared/auth/hooks'
import { prepareBugReport, trackBugReportOpen } from '@shared/feedback'
import { SiteHeader } from '@shared/SiteHeader'
import '@shared/public-theme.css'
import styles from './RoadmapPage.module.css'

type Status = 'building' | 'planned' | 'considering' | 'shipped'

type RoadmapItem = WebComponents['schemas']['RoadmapItem']

const sections: { status: Status; title: string }[] = [
  { status: 'building', title: 'Building' },
  { status: 'planned', title: 'Next' },
  { status: 'considering', title: 'Considering' },
  { status: 'shipped', title: 'Shipped' },
]

export function RoadmapPage() {
  const router = useRouter()
  const auth = useAuthSnapshot()
  const [items, setItems] = useState<RoadmapItem[] | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const canVote = auth.ready && auth.isAuthenticated && !auth.guest
  const report = useMemo(
    () => prepareBugReport({ source: 'roadmap', accountId: auth.player?.id }),
    [auth.player?.id],
  )

  function follow(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    router.navigate(event.currentTarget.getAttribute('href')!)
  }

  const load = useCallback(async () => {
    try {
      const response = await apiFetch('/api/roadmap')
      if (!response.ok) {
        throw new Error('Could not load the roadmap. Try again.')
      }
      setItems(await readJson(response, RoadmapItemSchema.array()))
      setError('')
    } catch {
      setError('Could not load the roadmap. Try again.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [auth.ready, auth.isAuthenticated, auth.guest, load])

  async function vote(item: RoadmapItem) {
    if (!canVote || pending) {
      return
    }
    setPending(item.id)
    setError('')
    try {
      const response = await apiFetch(`/api/roadmap/${encodeURIComponent(item.id)}/vote`, {
        method: item.voted ? 'DELETE' : 'PUT',
      })
      if (!response.ok) {
        throw new Error()
      }
      await load()
    } catch {
      setError('Could not save your vote. Try again.')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className={`public-theme ${styles.page}`}>
      <SiteHeader onNavigate={follow}>
        <nav className="site-header-links" aria-label="Main navigation">
          <a href="/" onClick={follow}>
            Live table
          </a>
          <a href="/roadmap" aria-current="page" onClick={follow}>
            Roadmap
          </a>
          <a href="/about" onClick={follow}>
            About
          </a>
          <a href={canVote ? '/play/game' : '/login?returnTo=/roadmap'} onClick={follow}>
            {canVote ? 'Play' : 'Sign in'}
          </a>
        </nav>
      </SiteHeader>
      <main className={styles.main}>
        <header className={styles.intro}>
          <h1>What’s next at the table.</h1>
          <div className={styles.introActions}>
            {!canVote && auth.ready && (
              <a className={styles.signIn} href="/login?returnTo=/roadmap" onClick={follow}>
                Sign in to vote
              </a>
            )}
            <a
              className={styles.report}
              href={report.url}
              onClick={() => trackBugReportOpen(report)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Share feedback ↗
            </a>
          </div>
        </header>

        {error && (
          <p className={styles.error} role="alert">
            {error}{' '}
            <button type="button" onClick={() => void load()}>
              Retry
            </button>
          </p>
        )}
        {!items && !error && <p className={styles.loading}>Loading the roadmap…</p>}
        {items &&
          sections.map((section) => {
            const entries = items.filter((item) => item.status === section.status)
            if (entries.length === 0) {
              return null
            }
            return (
              <section
                className={styles.section}
                key={section.status}
                aria-labelledby={`roadmap-${section.status}`}
              >
                <div className={styles.sectionHeading}>
                  <h2 id={`roadmap-${section.status}`}>{section.title}</h2>
                </div>
                <div className={styles.entries}>
                  {entries.map((item) => (
                    <article className={styles.entry} key={item.id}>
                      <div className={styles.entryText}>
                        <h3>{item.title}</h3>
                        <p>{item.description}</p>
                        {item.note && <p className={styles.note}>{item.note}</p>}
                        {item.statusUpdatedAt && (
                          <time dateTime={item.statusUpdatedAt}>
                            Updated{' '}
                            {new Date(item.statusUpdatedAt).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </time>
                        )}
                      </div>
                      {section.status === 'shipped' ? (
                        <span className={styles.shipped}>
                          Available now · {item.votes} {item.votes === 1 ? 'vote' : 'votes'}
                        </span>
                      ) : (
                        <button
                          className={styles.vote}
                          type="button"
                          aria-label={`${item.voted ? 'Remove vote for' : 'Vote for'} ${item.title}; ${item.votes} ${item.votes === 1 ? 'vote' : 'votes'}`}
                          aria-pressed={item.voted}
                          title={!canVote ? 'Sign in to vote' : undefined}
                          disabled={!canVote || pending != null}
                          onClick={() => void vote(item)}
                        >
                          <span aria-hidden="true">{item.voted ? '✓' : '↑'}</span>
                          <strong>{item.votes}</strong>
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )
          })}
        <footer className={styles.footer}>
          <p>Votes help guide us. They don’t decide what gets built.</p>
        </footer>
      </main>
    </div>
  )
}
