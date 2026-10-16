import { useEffect, useRef, useState } from 'react'
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
import {
  canGeneratePuzzle,
  getPuzzle,
  getPuzzleRun,
  listPuzzles,
  startPuzzleGeneration,
  type PuzzleRun,
} from './puzzle-api'
import { markDailyPuzzleComplete } from './daily-progress'
import styles from './BrowserChallenge.module.css'

type Position = { id: string; name: string; objective: string; turns: number; generated: boolean }

const GENERATION_STAGES = [
  { id: 'finding_idea', label: 'Finding a card interaction' },
  { id: 'building_challenge', label: 'Building a position' },
  { id: 'testing_solution', label: 'Testing the winning line' },
  { id: 'checking_shortcuts', label: 'Checking for shortcuts' },
]

export function BrowserChallenge({ challengeId }: { challengeId: string }) {
  const session = useGreSessionSnapshot()
  const board = useBoardSnapshot()
  const { navigate } = useRouter()
  const [position, setPosition] = useState<Position | null>(null)
  const [failure, setFailure] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [canGenerate, setCanGenerate] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generation, setGeneration] = useState<PuzzleRun | null>(null)
  const [generationError, setGenerationError] = useState('')
  const generationController = useRef<AbortController | null>(null)

  useEffect(() => {
    document.body.classList.add('match-route')
    return () => {
      document.body.classList.remove('match-route')
      generationController.current?.abort()
      greSession.clear()
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setFailure('')
    setPosition(null)
    setGenerating(false)
    setGeneration(null)
    setGenerationError('')
    void canGeneratePuzzle(controller.signal)
      .then(setCanGenerate)
      .catch(() => setCanGenerate(false))

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

  async function pollGeneration(runId: string, signal: AbortSignal): Promise<void> {
    let run: PuzzleRun
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      if (signal.aborted) {
        return
      }
      run = await getPuzzleRun(runId, signal)
      if (signal.aborted) {
        return
      }
      setGeneration(run)
    } while (run.status === 'running')
    if (run.status !== 'published' || !run.puzzleId) {
      setGenerationError('No puzzle passed the engine checks this time. Try again.')
      return
    }
    navigate(browserChallengePath(run.puzzleId))
  }

  async function generateNext(resumeId?: string): Promise<void> {
    generationController.current?.abort()
    const controller = new AbortController()
    generationController.current = controller
    setGenerating(true)
    setGenerationError('')
    try {
      const run = resumeId
        ? await getPuzzleRun(resumeId, controller.signal)
        : await startPuzzleGeneration(controller.signal)
      if (controller.signal.aborted) {
        return
      }
      setGeneration(run)
      await pollGeneration(run.id, controller.signal)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setGenerationError(
          cause instanceof Error ? cause.message : 'Could not generate a puzzle. Try again.',
        )
      }
    }
  }

  async function nextChallenge(): Promise<void> {
    if (canGenerate || (await canGeneratePuzzle().catch(() => false))) {
      await generateNext()
    } else {
      navigate(browserChallengePath('random'))
    }
  }

  const outcome =
    session.config?.challengeId === challengeId ? board.outcome?.viewerResult : undefined
  const isDailyChallenge = challengeId === dailyBrowserChallengeId()
  useEffect(() => {
    if (isDailyChallenge && outcome === 'win') {
      markDailyPuzzleComplete()
    }
  }, [isDailyChallenge, outcome])

  if (generating) {
    const stage = generation?.stage ?? 'finding_idea'
    const stageIndex = GENERATION_STAGES.findIndex((item) => item.id === stage)
    return (
      <main className={`public-theme ${styles.loading}`}>
        <h1>Making your next challenge</h1>
        <p>Each position is played through and checked before it joins the pool.</p>
        <ol className={styles.stages} aria-label="Generation progress">
          {GENERATION_STAGES.map((item, index) => (
            <li key={item.id} data-active={index === stageIndex} data-complete={index < stageIndex}>
              {item.label}
            </li>
          ))}
        </ol>
        {generationError ? (
          <div className={styles.recovery} role="alert">
            <p>{generationError}</p>
            <Button
              onClick={() =>
                void generateNext(generation?.status === 'running' ? generation.id : undefined)
              }
            >
              {generation?.status === 'running' ? 'Check again' : 'Try again'}
            </Button>
            <Button variant="secondary" onClick={() => navigate(browserChallengePath('random'))}>
              Choose from the pool
            </Button>
          </div>
        ) : (
          <p role="status">{GENERATION_STAGES[stageIndex]?.label ?? 'Finishing the puzzle'}…</p>
        )}
      </main>
    )
  }

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
        backLabel={
          isDailyChallenge && outcome === 'win'
            ? 'Done for today'
            : canGenerate
              ? 'Generate next'
              : 'Another challenge'
        }
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
