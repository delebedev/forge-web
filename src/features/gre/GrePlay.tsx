import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { priority } from '@engine/priority/priority'
import { canRespondOf } from '@engine/priority/priority-derive'
import { reportCourseResult } from '@engine/runtime/course-result'
import { greSession } from '@engine/runtime/gre-session'
import { greStore } from '@engine/runtime/gre-store'
import { useBoardSnapshot } from '@engine/runtime/hooks'
import type { GreStartConfig } from '@engine/runtime/start'
import type { CardView } from '@engine/state/gre-state'
import { authStore } from '@shared/auth/auth'
import { prepareBugReport, trackBugReportOpen } from '@shared/feedback'
import { cx } from '@shared/react/cx'
import { useBoardSounds } from './board/use-board-sounds'
import { useBoardInteractions } from './board/board-interactions'
import { Board } from './board/variants/classic/Board'
import { usePrioritySnapshot } from './priority-runtime'
import {
  currentZoneViewer,
  currentHandHoveredCard,
  libraryViewerIdentityChanged,
  type ZoneViewerState,
  type ZoneViewerSource,
} from './board/types'
import styles from './GrePlay.module.css'

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  )
}

type LaunchError = { message: string }
function launchFailure(error: unknown, fallback: string): LaunchError {
  return { message: error instanceof Error ? error.message : fallback }
}

export function GrePlay({
  initialConfig = null,
  autoStart = false,
  launchKey = 0,
  showDeckConfig = true,
  spectator = false,
  eyebrow = '',
  title = 'Match',
  showHeader = true,
  showHeaderActions = true,
  onMatchStarted,
  onBackToPlay,
  onPlayAgain,
  onRecoverBrowser,
  browserRecovered = false,
  browserPhase = 'idle',
  browserStatus = '',
  browserError = '',
  fullGameHref,
  outcomeExtra,
  backLabel,
}: {
  initialConfig?: GreStartConfig | null
  autoStart?: boolean
  launchKey?: number
  showDeckConfig?: boolean
  spectator?: boolean
  eyebrow?: string
  title?: string
  showHeader?: boolean
  showHeaderActions?: boolean
  onMatchStarted?: (matchId: string) => void
  onBackToPlay?: () => void | Promise<unknown>
  onPlayAgain?: () => void | Promise<unknown>
  onRecoverBrowser?: () => Promise<unknown>
  browserRecovered?: boolean
  browserPhase?: 'idle' | 'preparing' | 'active' | 'recovering' | 'failed' | 'lost'
  browserStatus?: string
  browserError?: string
  fullGameHref?: string
  outcomeExtra?: ReactNode
  backLabel?: string
}) {
  useBoardSounds(!spectator)
  const board = useBoardSnapshot()
  const waitingForBrowserState = browserPhase === 'active' && board.gameStateId === 0
  const preparingBrowser = browserPhase === 'preparing' || waitingForBrowserState
  const priorityState = usePrioritySnapshot()
  const [acknowledgedRecovery, setAcknowledgedRecovery] = useState('')
  const showRecoveryNotice = browserRecovered && acknowledgedRecovery !== initialConfig?.matchId

  const interactive = !spectator
  const inputEnabled =
    interactive &&
    !showRecoveryNotice &&
    board.connected &&
    !board.connectionClose &&
    board.presentation?.lagging !== true
  const embedded = !showDeckConfig || board.connected
  const startLabel = board.gameOver
    ? (board.outcome?.title ?? 'Game over')
    : board.connected
      ? 'Game running'
      : board.status === 'starting game'
        ? 'Starting...'
        : 'Start game'

  const [seat1Deck, setSeat1Deck] = useState('60 Plains')
  const [seat2Deck, setSeat2Deck] = useState('60 Plains')
  const [zoneViewer, setZoneViewer] = useState<ZoneViewerState>(null)
  const [hoveredCard, setHoveredCard] = useState<CardView | null>(null)
  const priorKnownHandIds = useRef<Set<number>>(new Set())
  const [launchError, setLaunchError] = useState<LaunchError | null>(null)
  const [leaveError, setLeaveError] = useState<string | null>(null)
  const [courseResult, setCourseResult] = useState<{ wins: number; losses: number } | null>(null)
  const [courseError, setCourseError] = useState('')
  const [courseRetry, setCourseRetry] = useState(0)
  useEffect(() => {
    const id = initialConfig?.coursePlayId
    const outcome = board.outcome?.viewerResult
    if (!id || !board.gameOver || !outcome || outcome === 'unknown') {
      return
    }
    let active = true
    setCourseResult(null)
    setCourseError('')
    void reportCourseResult(id, outcome === 'win').then(
      (course) => {
        if (active) {
          setCourseResult(course)
        }
      },
      (error: unknown) => {
        if (active) {
          setCourseError(error instanceof Error ? error.message : String(error))
        }
      },
    )
    return () => {
      active = false
    }
  }, [initialConfig?.coursePlayId, board.gameOver, board.outcome?.viewerResult, courseRetry])
  const courseUnsaved = !!initialConfig?.coursePlayId && board.gameOver && !courseResult
  const courseOutcomeUnknown =
    courseUnsaved && (!board.outcome?.viewerResult || board.outcome.viewerResult === 'unknown')
  const dropZoneElRef = useRef<HTMLElement | null>(null)
  const autoStartSent = useRef<number | null>(null)
  const puzzle = initialConfig?.puzzleText ?? ''
  const reportContext = greSession.config
  const reportAccountId = authStore.player?.id
  const bugReport = useMemo(() => {
    const prepared = prepareBugReport({
      source: 'board',
      accountId: reportAccountId,
      matchId: reportContext?.matchId,
      deckId: reportContext?.deckId,
      closeCategory: board.connectionClose?.category,
      closeCode: board.connectionClose?.code,
      connectionStatus: board.connected ? 'connected' : 'disconnected',
      execution: reportContext?.execution,
      attemptId: reportContext?.attemptId,
      frontendBuild: reportContext?.frontendBuild,
      engineBuild: reportContext?.engineBuild,
    })
    return {
      url: prepared.url,
      onOpen: () => {
        if (reportContext?.execution === 'browser') {
          void greSession.uploadBrowserReplay('feedback', prepared.reportId)
        }
        trackBugReportOpen(prepared)
      },
    }
  }, [
    board.connected,
    board.connectionClose?.category,
    board.connectionClose?.code,
    reportAccountId,
    reportContext?.attemptId,
    reportContext?.deckId,
    reportContext?.engineBuild,
    reportContext?.execution,
    reportContext?.frontendBuild,
    reportContext?.matchId,
  ])

  async function startGreGame(config: GreStartConfig, signal?: AbortSignal): Promise<void> {
    const matchId = await greSession.connectBrowser(config, signal)
    onMatchStarted?.(matchId)
  }

  function leaveGame(): void {
    if (!onBackToPlay) {
      return
    }
    if (
      courseUnsaved &&
      !window.confirm('This course result has not been saved. Leave without saving it?')
    ) {
      return
    }
    setLeaveError(null)
    void Promise.resolve()
      .then(onBackToPlay)
      .catch((error: unknown) => {
        setLeaveError(error instanceof Error ? error.message : 'Could not leave the match')
      })
  }

  function restartGame(): void {
    if (!onPlayAgain || courseUnsaved) {
      return
    }
    setLaunchError(null)
    void Promise.resolve(onPlayAgain()).catch((error: unknown) => {
      setLaunchError(launchFailure(error, 'Could not restart the match'))
    })
  }

  useEffect(() => {
    if (!autoStart || autoStartSent.current === launchKey || !initialConfig) {
      return
    }
    autoStartSent.current = launchKey
    setLeaveError(null)
    const controller = new AbortController()
    setLaunchError(null)
    void startGreGame(initialConfig, controller.signal).catch((error: unknown) => {
      if (isAbortError(error)) {
        return
      }
      setLaunchError(launchFailure(error, 'Could not start the match'))
    })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, initialConfig, launchKey])

  // Holds the latest values the two mount-only listener effects below need, so
  // registering them doesn't churn on every GRE message (they arrive at a high
  // rate once a match is live).
  const visibleZoneViewer = currentZoneViewer(zoneViewer, board)
  const visibleHoveredCard = zoneViewer
    ? (visibleZoneViewer?.cards.find((card) => card.instanceId === hoveredCard?.instanceId) ?? null)
    : currentHandHoveredCard(hoveredCard, priorKnownHandIds.current, board)
  useEffect(() => {
    if (hoveredCard !== visibleHoveredCard) {
      setHoveredCard(visibleHoveredCard)
    }
    if (zoneViewer && !visibleZoneViewer) {
      setZoneViewer(null)
    }
    priorKnownHandIds.current = new Set(board.opponentHand.map((card) => card.instanceId))
  }, [board.opponentHand, hoveredCard, visibleHoveredCard, visibleZoneViewer, zoneViewer])
  const latest = useRef({
    autoStart,
    initialConfig,
    inputEnabled,
    gameOver: board.gameOver,
    canPass: board.canPass,
    zoneViewerOpen: visibleZoneViewer != null,
  })
  latest.current = {
    autoStart,
    initialConfig,
    inputEnabled,
    gameOver: board.gameOver,
    canPass: board.canPass,
    zoneViewerOpen: visibleZoneViewer != null,
  }

  // Keyboard: Space = pass/resolve, E = pass turn. Ignored while typing or when
  // a control is focused (so it never double-fires with a focused button).
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      const { inputEnabled: canInput, gameOver, canPass, zoneViewerOpen } = latest.current
      if (event.key === 'Escape') {
        setHoveredCard(null)
      }
      if (zoneViewerOpen && event.key === 'Escape') {
        event.preventDefault()
        setZoneViewer(null)
        return
      }
      if (!canInput || gameOver) {
        return
      }
      const el = event.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA|BUTTON|SELECT)$/.test(el.tagName)) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (event.code === 'Space') {
        if (!canPass || priority.passing) {
          return
        }
        event.preventDefault()
        void greStore.passPriority()
      } else if (event.key === 'e' || event.key === 'E') {
        if (!canPass) {
          return
        }
        event.preventDefault()
        void priority.passToEndOfTurn()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const promptBinding = inputEnabled ? greStore.bindPrompt(board.prompt) : null
  const boardInteractions = useBoardInteractions(
    board.prompt,
    board.gameOver,
    promptBinding,
    (action) => {
      void greStore.performLegalAction(action)
    },
  )

  useEffect(() => {
    function moveDrag(event: PointerEvent) {
      boardInteractions.moveDrag(event)
    }
    function endDrag(event: PointerEvent) {
      boardInteractions.endDrag(event, dropZoneElRef.current)
    }
    window.addEventListener('pointermove', moveDrag)
    window.addEventListener('pointerup', endDrag)
    return () => {
      window.removeEventListener('pointermove', moveDrag)
      window.removeEventListener('pointerup', endDrag)
    }
  }, [boardInteractions])

  function startConfiguredGame(): void {
    greSession.startBrowser({ seat1Deck, seat2Deck, gameType: 'constructed' })
  }

  function openZone(zoneTitle: string, source: ZoneViewerSource): void {
    setZoneViewer({
      title: zoneTitle,
      source,
      matchId: board.currentMatchId,
      libraryInstanceId: board.libraryTop?.instanceId,
    })
    setHoveredCard(null)
  }

  useEffect(() => {
    if (zoneViewer?.source !== 'libraryTop') {
      return
    }
    if (!libraryViewerIdentityChanged(zoneViewer, board.libraryTop)) {
      return
    }
    setHoveredCard(null)
    setZoneViewer(
      board.libraryTop ? { ...zoneViewer, libraryInstanceId: board.libraryTop.instanceId } : null,
    )
  }, [board.libraryTop, zoneViewer])

  const Container = spectator ? 'div' : 'main'
  return (
    <Container
      className={cx(
        'public-theme',
        styles.grePage,
        embedded && styles.embedded,
        !showHeader && styles.headerless,
      )}
    >
      <section className={styles.tabletopShell} aria-label="Tabletop">
        {showHeader && (
          <header className={styles.topbar}>
            <div>
              {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
              <h1>{title}</h1>
            </div>
            {showHeaderActions && (
              <div className={styles.actions}>
                <button onClick={startConfiguredGame} disabled={board.connected}>
                  {startLabel}
                </button>
                {interactive && (
                  <button
                    className={styles.danger}
                    onClick={() => void greStore.concede()}
                    disabled={!board.connected || board.gameOver}
                  >
                    Concede
                  </button>
                )}
                <button
                  className={styles.ghost}
                  onClick={() => greStore.disconnect()}
                  disabled={!board.connected}
                >
                  Disconnect
                </button>
              </div>
            )}
          </header>
        )}

        {showDeckConfig && !board.connected && (
          <section className={styles.deckConfig} aria-label="Deck configuration">
            {puzzle && (
              <div className={styles.puzzleChip} data-puzzle={puzzle}>
                Puzzle: {puzzle}
              </div>
            )}
            <label>
              <span>Seat 1 deck</span>
              <textarea
                value={seat1Deck}
                onChange={(e) => setSeat1Deck(e.currentTarget.value)}
                disabled={board.connected || Boolean(puzzle)}
              />
            </label>
            <label>
              <span>Seat 2 deck</span>
              <textarea
                value={seat2Deck}
                onChange={(e) => setSeat2Deck(e.currentTarget.value)}
                disabled={board.connected || Boolean(puzzle)}
              />
            </label>
          </section>
        )}

        {leaveError && (
          <section className={styles.launchError} role="alert">
            <strong>Could not leave the match</strong>
            <p>{leaveError}</p>
            <button type="button" onClick={leaveGame}>
              Try Return again
            </button>
          </section>
        )}

        {browserPhase === 'lost' && (
          <section className={styles.launchError} role="alert">
            <strong>Local game ended</strong>
            <p>Refreshing or closing this tab ends a browser game.</p>
            <div>
              {onPlayAgain && (
                <button type="button" onClick={restartGame}>
                  Start again
                </button>
              )}
              {onBackToPlay && (
                <button type="button" onClick={leaveGame}>
                  Back to Play
                </button>
              )}
            </div>
          </section>
        )}

        {(preparingBrowser || browserPhase === 'recovering') && browserStatus && (
          <section className={styles.launchError} role="status">
            <strong>
              {browserPhase === 'recovering'
                ? 'Recovering browser game'
                : initialConfig?.challengeId
                  ? 'Preparing challenge'
                  : 'Preparing browser game'}
            </strong>
            <p>{waitingForBrowserState ? 'Preparing your opening hand…' : browserStatus}</p>
            {initialConfig?.challengeId && (
              <p>
                First load can take longer on a phone. Keep this tab open; later challenges reuse
                the engine.
              </p>
            )}
            {onBackToPlay && (
              <button type="button" onClick={leaveGame}>
                Cancel
              </button>
            )}
          </section>
        )}

        {browserPhase === 'failed' && browserError && !launchError && (
          <section className={styles.launchError} role="alert">
            <strong>Browser game stopped</strong>
            <p>{browserError}</p>
            {onRecoverBrowser && (
              <p>
                Experimental recovery. Undoes your last choice and later progress. One try per game
                in this tab.
              </p>
            )}
            <div>
              {onRecoverBrowser && (
                <button type="button" onClick={() => void onRecoverBrowser()}>
                  Recover game
                </button>
              )}
              {onBackToPlay && (
                <button type="button" onClick={leaveGame}>
                  Choose another deck
                </button>
              )}
              <a href={bugReport.url} target="_blank" rel="noreferrer" onClick={bugReport.onOpen}>
                Report a problem
              </a>
            </div>
          </section>
        )}

        {launchError && (
          <section className={styles.launchError} role="alert">
            <strong>Browser game could not start</strong>
            <p>{launchError.message}</p>
            <div>
              <button type="button" onClick={restartGame}>
                Retry in browser
              </button>
              {onBackToPlay && (
                <button type="button" onClick={leaveGame}>
                  Back to Play
                </button>
              )}
              <a href={bugReport.url} target="_blank" rel="noreferrer" onClick={bugReport.onOpen}>
                Report a problem
              </a>
            </div>
          </section>
        )}

        {showRecoveryNotice && browserPhase === 'active' && (
          <section className={styles.launchError} role="status">
            <strong>Game recovered</strong>
            <p>Last choice undone. Review the board, then continue.</p>
            <button
              type="button"
              onClick={() => setAcknowledgedRecovery(initialConfig?.matchId ?? '')}
            >
              Continue game
            </button>
          </section>
        )}
        {browserPhase !== 'recovering' && (
          <Board
            board={board}
            interactive={interactive}
            inputEnabled={inputEnabled}
            embedded={embedded}
            interactions={boardInteractions}
            stops={priorityState.stops}
            canRespond={canRespondOf(greStore.authoritativeSnapshot())}
            passing={priorityState.passing}
            fullControl={priorityState.fullControl}
            onFullControl={(enabled) => void priority.setFullControl(enabled)}
            onCancelYield={() => void priority.cancelYield()}
            onToggleStop={(key) => void priority.toggleStop(key)}
            onPassPriority={() => void greStore.passPriority()}
            onResolveAll={() => void priority.resolveAll()}
            onEndTurn={() => void priority.passToEndOfTurn()}
            onLegalAction={(actionView) => void greStore.performLegalAction(actionView)}
            promptBinding={promptBinding}
            hoveredCard={visibleHoveredCard}
            onHover={setHoveredCard}
            zoneViewer={visibleZoneViewer}
            onOpenZone={openZone}
            onCloseZone={() => setZoneViewer(null)}
            dropZoneRef={(el) => {
              dropZoneElRef.current = el
            }}
            onBackToPlay={onBackToPlay ? leaveGame : undefined}
            onPlayAgain={onPlayAgain ? restartGame : undefined}
            playAgainDisabled={courseUnsaved}
            context={
              initialConfig?.label && initialConfig.objective
                ? {
                    label: initialConfig.label,
                    objective: initialConfig.objective,
                    turns: initialConfig.turnLimit,
                  }
                : undefined
            }
            backLabel={
              backLabel ??
              (fullGameHref
                ? 'Another challenge'
                : initialConfig?.returnPath === '/challenges'
                  ? 'Return to Challenges'
                  : undefined)
            }
            playAgainLabel={
              initialConfig?.gameType === 'puzzle'
                ? fullGameHref
                  ? 'Retry'
                  : 'Restart'
                : undefined
            }
            fullGameHref={fullGameHref}
            outcomeExtra={
              <>
                {initialConfig?.coursePlayId && board.gameOver && (
                  <section role={courseError ? 'alert' : 'status'}>
                    {courseResult ? (
                      <p>
                        Course result saved: {courseResult.wins} wins · {courseResult.losses}{' '}
                        losses.
                      </p>
                    ) : courseOutcomeUnknown ? (
                      <p>
                        Course result is unavailable because the game outcome is unknown. No result
                        has been saved.
                      </p>
                    ) : courseError ? (
                      <>
                        <p>{courseError}</p>
                        <button type="button" onClick={() => setCourseRetry((n) => n + 1)}>
                          Retry saving result
                        </button>
                      </>
                    ) : (
                      <p>Saving course result…</p>
                    )}
                  </section>
                )}
                {outcomeExtra}
              </>
            }
            bugReport={bugReport}
          />
        )}
      </section>
    </Container>
  )
}
