import { useEffect, useState, type MouseEvent } from 'react'
import { useRouter } from '@app/router'
import { apiFetch } from '@shared/api/client'
import { readJson } from '@shared/api/decoding'
import { DevelopmentPuzzleSchema } from '@shared/api/wire-schemas'
import { challengeToGreStartConfig } from '@engine/runtime/gre-launch'
import { greSession } from '@engine/runtime/gre-session'
import { challengesStore, type Challenge } from './challenges-store'
import { useChallengesSnapshot } from './challenges-hooks'
import { authStore } from '@shared/auth/auth'
import styles from './ChallengesView.module.css'
import { CandidateEditor } from './CandidateEditor'

const LOADING_STATUS = 'Loading challenges…'

export function ChallengeLauncher({
  challenges,
  onLaunch,
}: {
  challenges: Challenge[]
  onLaunch: (challenge: Challenge) => void
}) {
  function launch(event: MouseEvent<HTMLAnchorElement>, challenge: Challenge): void {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    onLaunch(challenge)
  }

  return (
    <section className={styles.launcher} aria-labelledby="challenges-title">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Development tools</p>
        <h1 id="challenges-title">Challenges</h1>
        <p>Open a pinned puzzle on the standard gameplay board.</p>
      </header>
      <ul className={styles.list} role="list">
        {challenges.map((challenge) => (
          <li key={challenge.id}>
            <a
              href={`/challenges/${encodeURIComponent(challenge.id)}`}
              onClick={(event) => launch(event, challenge)}
            >
              <strong>{challenge.name}</strong>
              <span>{challenge.objective}</span>
            </a>
          </li>
        ))}
      </ul>
      <CandidateEditor />
    </section>
  )
}

export function ChallengesView({ challengeId }: { challengeId?: string }) {
  const router = useRouter()
  const challenges = useChallengesSnapshot()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setError(null)

    async function prepare(): Promise<void> {
      if (!(await authStore.ensureSession())) {
        if (active) {
          setError('Could not start a development session.')
        }
        return
      }
      await challengesStore.ensureLoaded()
      if (!active) {
        return
      }
      if (challengesStore.error) {
        setError(`Could not load challenges: ${challengesStore.error}`)
        return
      }
      if (!challengeId) {
        return
      }
      const challenge = challengesStore.find(challengeId)
      if (!challenge) {
        setError(`Challenge not found: ${challengeId}`)
        return
      }
      const response = await apiFetch(`/api/dev/puzzles/${encodeURIComponent(challenge.id)}`)
      if (!response.ok) {
        throw new Error('Puzzle content is unavailable')
      }
      const puzzle = await readJson(response, DevelopmentPuzzleSchema)
      if (active) {
        greSession.startBrowser({
          ...challengeToGreStartConfig(challenge),
          puzzleText: puzzle.text,
        })
      }
    }

    void prepare().catch((error: unknown) => {
      if (active) {
        setError(error instanceof Error ? error.message : String(error))
      }
    })
    return () => {
      active = false
    }
  }, [challengeId])

  if (error) {
    return (
      <section className={styles.message} role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => router.navigate('/challenges')}>
          Return to Challenges
        </button>
      </section>
    )
  }
  if (challengeId || !challenges.loaded) {
    return (
      <p className={styles.message} aria-live="polite">
        {challengeId ? `Opening ${challengeId}…` : LOADING_STATUS}
      </p>
    )
  }

  return (
    <ChallengeLauncher
      challenges={challenges.list}
      onLaunch={(challenge) => router.navigate(`/challenges/${encodeURIComponent(challenge.id)}`)}
    />
  )
}
