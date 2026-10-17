import { useEffect, useState } from 'react'
import { useRouter } from '@app/router'
import { useBoardSnapshot, useGreSessionSnapshot } from '@engine/runtime/hooks'
import { greSession } from '@engine/runtime/gre-session'
import { GrePlay } from '@features/gre/GrePlay'
import { Button } from '@shared/ui/Button'
import { telemetry } from '@shared/telemetry'
import {
  browserChallenge,
  browserChallengePath,
  dailyBrowserChallengeId,
  dailyBrowserChallengePath,
  nextBrowserChallenge,
} from './browser-challenges'
import { PuzzleRating } from './PuzzleRating'
import { getPuzzle, listPuzzles } from './puzzle-api'
import { markDailyPuzzleComplete } from './daily-progress'
import styles from './BrowserChallenge.module.css'

type Position = { id: string; name: string; objective: string; turns: number; generated: boolean }

export function BrowserChallenge({ challengeId }: { challengeId: string }) {
  const session = useGreSessionSnapshot()
  const board = useBoardSnapshot()
  const { navigate } = useRouter()
  const [position, setPosition] = useState<Position | null>(null)
  const [failure, setFailure] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  useEffect(() => {
    document.body.classList.add('match-route')
    return () => {
      document.body.classList.remove('match-route')
      greSession.clear()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setFailure('')
    setPosition(null)
    async function openPosition(): Promise<void> {
      if (challengeId === 'random') {
        const pool = await listPuzzles(controller.signal).catch(() => [])
        const other = pool.filter((puzzle) => puzzle.id !== greSession.config?.challengeId)
        const picked = other[Math.floor(Math.random() * other.length)]
        const previous = greSession.config?.challengeId
        const fallback =
          previous && browserChallenge(previous)
            ? browserChallengePath(nextBrowserChallenge(previous).id)
            : dailyBrowserChallengePath()
        if (!controller.signal.aborted) {
          navigate(picked ? browserChallengePath(picked.id) : fallback)
        }
        return
      }

      const fixed = browserChallenge(challengeId)
      let text: string
      let chosen: Position
      if (fixed) {
        const response = await fetch(`/challenges/${challengeId}.pzl`, {
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error('The challenge could not be loaded.')
        }
        text = await response.text()
        chosen = {
          id: fixed.id,
          name: fixed.name,
          objective: fixed.objective,
          turns: fixed.turns,
          generated: false,
        }
      } else {
        const puzzle = await getPuzzle(challengeId, controller.signal)
        text = puzzle.text
        chosen = {
          id: puzzle.id,
          name: puzzle.title,
          objective: 'Win this turn.',
          turns: 1,
          generated: true,
        }
      }
      if (!text.trim()) {
        throw new Error('The challenge is empty.')
      }
      if (controller.signal.aborted) {
        return
      }
      setPosition(chosen)
      telemetry.track('challenge_opened', fixed ? challengeId : 'generated')
      greSession.startBrowser(
        {
          gameType: 'puzzle',
          challengeId: chosen.id,
          puzzleText: text,
          label: chosen.name,
          objective: chosen.objective,
          turnLimit: chosen.turns,
          returnPath: browserChallengePath('random'),
        },
        false,
      )
    }

    void openPosition().catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        setFailure(cause instanceof Error ? cause.message : 'The challenge could not be loaded.')
      }
    })
    return () => controller.abort()
  }, [challengeId, loadAttempt, navigate])

  function nextChallenge(): void {
    navigate(browserChallengePath('random'))
  }

  const outcome =
    session.config?.challengeId === challengeId ? board.outcome?.viewerResult : undefined
  const isDailyChallenge = challengeId === dailyBrowserChallengeId()
  useEffect(() => {
    if (isDailyChallenge && outcome === 'win') {
      markDailyPuzzleComplete()
    }
  }, [isDailyChallenge, outcome])

  if (failure || !position || session.config?.challengeId !== challengeId) {
    return (
      <main className={`public-theme ${styles.loading}`}>
        <h1>{position?.name ?? 'Finding a challenge'}</h1>
        {failure ? (
          <div role="alert">
            <p>{failure}</p>
            <Button onClick={() => setLoadAttempt((value) => value + 1)}>Try again</Button>
            <Button variant="secondary" onClick={() => navigate(browserChallengePath('random'))}>
              Choose from the pool
            </Button>
          </div>
        ) : (
          <p role="status">Preparing the position…</p>
        )}
      </main>
    )
  }

  return (
    <div className={styles.matchRoom}>
      <GrePlay
        initialConfig={session.config}
        autoStart={session.browserPhase !== 'lost'}
        launchKey={session.launchKey}
        showDeckConfig={false}
        showHeader={false}
        showHeaderActions={false}
        browserPhase={session.browserPhase}
        browserStatus={session.browserStatus}
        browserError={session.browserError}
        onMatchStarted={(id) => greSession.recordMatchId(id)}
        onBackToPlay={() =>
          isDailyChallenge && outcome === 'win' ? navigate('/') : void nextChallenge()
        }
        backLabel={isDailyChallenge && outcome === 'win' ? 'Done for today' : 'Another challenge'}
        onPlayAgain={() => {
          telemetry.track('challenge_restart', position.generated ? 'generated' : challengeId)
          return greSession.playAgain()
        }}
        outcomeExtra={
          position.generated && (outcome === 'win' || outcome === 'loss') ? (
            <PuzzleRating
              key={session.launchKey}
              puzzleId={position.id}
              outcome={outcome === 'win' ? 'won' : 'lost'}
            />
          ) : undefined
        }
        fullGameHref="/play/game"
      />
    </div>
  )
}
