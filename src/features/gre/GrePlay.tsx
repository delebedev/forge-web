import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { priority } from '@engine/priority/priority'
import { canRespondOf } from '@engine/priority/priority-derive'
import { greSession } from '@engine/runtime/gre-session'
import { greStore } from '@engine/runtime/gre-store'
import { useBoardSnapshot } from '@engine/runtime/hooks'
import type { GreStartConfig } from '@engine/runtime/start'
import { GreStartError } from '@engine/runtime/gre-transport'
import { currentBrowserPreflightFailure } from '@engine/runtime/browser-support'
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

type LaunchError = {
  message: string
  category?: 'capacity' | 'deployment' | 'server'
  retryAfterSeconds?: number
}

function launchFailure(error: unknown, fallback: string): LaunchError {
  if (error instanceof GreStartError) {
    return {
      message: error.message,
      category: error.category,
      retryAfterSeconds: error.retryAfterSeconds,
    }
  }
  return { message: error instanceof Error ? error.message : fallback }
}

function resumeGreGame(config: GreStartConfig, onError: (error: LaunchError | null) => void): void {
  onError(null)
  void greStore.resumeGame(config).catch((error: unknown) => {
    if (isAbortError(error)) {
      return
    }
    onError(launchFailure(error, 'Could not reconnect to the match'))
  })
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
  executionFallback = '',
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
  executionFallback?: string
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
  const [retryReady, setRetryReady] = useState(true)
  const [browserFallbackError, setBrowserFallbackError] = useState<string | null>(null)
  const [launchAttempt, setLaunchAttempt] = useState(0)
  const dropZoneElRef = useRef<HTMLElement | null>(null)
  const autoStartSent = useRef<number | null>(null)
  const puzzle = useMemo(() => new URLSearchParams(location.search).get('puzzle')?.trim() ?? '', [])
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
    if (config.execution === 'browser') {
      const matchId = await greSession.connectBrowser(config, signal)
      onMatchStarted?.(matchId)
      return
    }
    const matchId = config.matchId
      ? await greStore.resumeGame(config, signal)
      : await greStore.startGame(config, signal)
    onMatchStarted?.(matchId)
  }

  function leaveGame(): void {
    if (!onBackToPlay) {
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
    if (!onPlayAgain) {
      return
    }
    setLaunchError(null)
    void Promise.resolve(onPlayAgain()).catch((error: unknown) => {
      setLaunchError(launchFailure(error, 'Could not restart the match'))
    })
  }

  function startBrowserFallback(): void {
    if (!initialConfig) {
      return
    }
    setBrowserFallbackError(null)
    try {
      if (currentBrowserPreflightFailure()) {
        setBrowserFallbackError('Browser play is no longer available.')
        return
      }
      const { seat1Deck, seat2Deck, deckId, gameType, returnPath } = initialConfig
      greSession.startBrowser({ seat1Deck, seat2Deck, deckId, gameType, returnPath })
    } catch (error) {
      setBrowserFallbackError(
        error instanceof Error ? error.message : 'Could not start the browser game',
      )
    }
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
      if (greSession.fallbackBrowserToServer(initialConfig, error)) {
        return
      }
      setLaunchError(launchFailure(error, 'Could not start the match'))
    })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, initialConfig, launchKey, launchAttempt])

  useEffect(() => {
    if (
      (launchError?.category !== 'capacity' && launchError?.category !== 'deployment') ||
      !launchError.retryAfterSeconds
    ) {
      setRetryReady(true)
      return
    }
    setRetryReady(false)
    const timer = setTimeout(() => setRetryReady(true), launchError.retryAfterSeconds * 1000)
    return () => clearTimeout(timer)
  }, [launchError])

  const canOfferBrowserFallback =
    launchError?.category === 'capacity' &&
    initialConfig?.execution !== 'browser' &&
    !spectator &&
    (initialConfig?.gameType === 'constructed' || initialConfig?.gameType === 'commander')

  const browserFallbackReady = canOfferBrowserFallback && !currentBrowserPreflightFailure()

  useEffect(() => {
    setBrowserFallbackError(null)
  }, [canOfferBrowserFallback])

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

  useEffect(() => {
    function resumeCurrentMatch() {
      const { autoStart: shouldAutoStart, initialConfig: config } = latest.current
      if (!shouldAutoStart || !config?.matchId || document.visibilityState === 'hidden') {
        return
      }
      if (config.execution === 'browser') {
        return
      }
      resumeGreGame(config, setLaunchError)
    }
    document.addEventListener('visibilitychange', resumeCurrentMatch)
    window.addEventListener('pageshow', resumeCurrentMatch)
    window.addEventListener('focus', resumeCurrentMatch)
    return () => {
      document.removeEventListener('visibilitychange', resumeCurrentMatch)
      window.removeEventListener('pageshow', resumeCurrentMatch)
      window.removeEventListener('focus', resumeCurrentMatch)
    }
  }, [])

  function resumeGame(config = initialConfig): void {
    if (!config?.matchId) {
      return
    }
    resumeGreGame(config, setLaunchError)
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
    void startGreGame(
      puzzle
        ? { puzzle, gameType: 'puzzle' }
        : { seat1Deck, seat2Deck, spectatorMode: spectator || undefined },
    )
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

        {executionFallback && !board.connected && !board.gameOver && (
          <section className={styles.launchError} role="status">
            <strong>Continuing on server</strong>
            <p>{executionFallback}</p>
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
            <strong>
              {launchError.category === 'deployment'
                ? 'Forge is getting a quick update'
                : launchError.category === 'capacity'
                  ? 'All game slots are busy'
                  : 'Match could not start'}
            </strong>
            <p>{launchError.message}</p>
            {browserFallbackReady && (
              <p>
                Play on this device instead. Refreshing or closing this tab ends a browser game.
              </p>
            )}
            {browserFallbackError && <p role="status">{browserFallbackError}</p>}
            <div>
              {browserFallbackReady && (
                <button type="button" onClick={startBrowserFallback}>
                  Start browser game
                </button>
              )}
              <button
                type="button"
                disabled={!retryReady}
                onClick={() => {
                  if (initialConfig?.execution === 'browser') {
                    restartGame()
                    return
                  }
                  autoStartSent.current = null
                  setLaunchAttempt((value) => value + 1)
                }}
              >
                {initialConfig?.execution === 'browser'
                  ? 'Retry in browser'
                  : retryReady
                    ? 'Try again'
                    : 'Try again shortly'}
              </button>
              {launchError.category === 'deployment' && <a href="/">Watch a game</a>}
              {onBackToPlay && (
                <button type="button" onClick={leaveGame}>
                  Back to Play
                </button>
              )}
              {initialConfig?.execution === 'browser' && (
                <a href={bugReport.url} target="_blank" rel="noreferrer" onClick={bugReport.onOpen}>
                  Report a problem
                </a>
              )}
            </div>
          </section>
        )}

        {autoStart &&
          initialConfig?.matchId &&
          initialConfig.execution !== 'browser' &&
          !board.connected &&
          board.status === 'closed' &&
          !board.gameOver &&
          !launchError &&
          board.connectionClose?.category === 'transient' && (
            <section className={styles.launchError} role="alert">
              <strong>Connection lost</strong>
              <p>Reconnect to check whether the match is still available.</p>
              <div>
                <button type="button" onClick={() => resumeGame()}>
                  Reconnect
                </button>
              </div>
            </section>
          )}

        {autoStart &&
          initialConfig?.matchId &&
          initialConfig.execution !== 'browser' &&
          !board.connected &&
          board.status === 'closed' &&
          !board.gameOver &&
          !launchError &&
          board.connectionClose &&
          board.connectionClose.category !== 'transient' && (
            <section className={styles.launchError} role="alert">
              <strong>
                {board.connectionClose.category === 'terminated'
                  ? 'Match ended unexpectedly'
                  : board.connectionClose.category === 'completed'
                    ? 'Match complete'
                    : board.connectionClose.category === 'abandoned'
                      ? 'Match ended'
                      : 'Match unavailable'}
              </strong>
              <p>
                {board.connectionClose.category === 'terminated'
                  ? 'The game stopped and can’t be rejoined.'
                  : board.connectionClose.category === 'completed'
                    ? 'This game has ended.'
                    : board.connectionClose.category === 'abandoned'
                      ? 'This match was ended.'
                      : 'This match can’t be rejoined.'}
              </p>
              {onBackToPlay && (
                <div>
                  <button type="button" onClick={leaveGame}>
                    Back to Play
                  </button>
                </div>
              )}
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
            outcomeExtra={outcomeExtra}
            bugReport={bugReport}
          />
        )}
      </section>
    </Container>
  )
}
