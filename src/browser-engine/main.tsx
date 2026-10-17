import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { BrowserEngineEvent } from '@engine/runtime/browser-match-source'
import { BrowserEngine, type BrowserMatch } from '@engine/runtime/browser-engine'
import { currentBrowserPreflightFailure } from '@engine/runtime/browser-support'
export { browserPreflight, browserPreflightFailure } from '@engine/runtime/browser-support'
import { greStore } from '@engine/runtime/gre-store'
import { useBoardSnapshot } from '@engine/runtime/hooks'
import { GrePlay } from '@features/gre/GrePlay'
import '@app/app.css'
import '@shared/cards/mana.css'
import styles from './BrowserLauncher.module.css'

const RED_DECK = '/browser-engine/decks/26-03-07-red-deck-wins-quinn-tonole-819932.txt'
const GOLGARI_DECK = '/browser-engine/decks/26-04-23-golgari-midrange-tentaclefan-838086.txt'
const DEFAULT_SEED = 42
const BUILD_ID = import.meta.env?.['VITE_BROWSER_BUILD'] || 'development'
export const MAX_DIAGNOSTIC_EVENTS = 240
export const ENGINE_PROGRESS_TIMEOUT_MS = 180_000
const MAX_HOST_TIMER_LATENESS_MS = 30_000

const CURATED_DECKS = {
  red: { label: 'Red Deck Wins', file: RED_DECK },
  golgari: { label: 'Golgari Midrange', file: GOLGARI_DECK },
} as const

type CuratedDeckId = keyof typeof CURATED_DECKS
type DeckChoice = CuratedDeckId | 'custom'
type LauncherPhase = 'ready' | 'preparing' | 'active' | 'failed'

export type EngineProgressWatchdogSnapshot = {
  phase: LauncherPhase
  gameOver: boolean
  prompt: boolean
  canPass: boolean
  legalActionCount: number
}

const events: BrowserEngineEvent[] = []
let engine: BrowserEngine | null = null

export function appendDiagnosticEvent(
  history: BrowserEngineEvent[],
  event: BrowserEngineEvent,
): void {
  if (event.event === 'frame' || event.event === 'reply') {
    return
  }
  const data =
    typeof event.data === 'string' && event.data.length > 4096
      ? `${event.data.slice(0, 4096)}…`
      : event.data
  history.push(data === event.data ? event : { ...event, data })
  if (history.length > MAX_DIAGNOSTIC_EVENTS) {
    history.splice(0, history.length - MAX_DIAGNOSTIC_EVENTS)
  }
}

export function parseBrowserSeed(value: string | null): number {
  if (!value?.trim()) {
    return DEFAULT_SEED
  }
  const seed = Number(value)
  return Number.isSafeInteger(seed) && seed >= 0 && seed <= 2_147_483_647 ? seed : DEFAULT_SEED
}

function queryOrRandomSeed(): number {
  const querySeed = new URLSearchParams(location.search).get('seed')
  if (querySeed?.trim()) {
    return parseBrowserSeed(querySeed)
  }
  const values = new Uint32Array(1)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(values)
    return values[0]! % 2_147_483_648
  }
  return Math.floor(Math.random() * 2_147_483_648)
}

export function engineProgressWatchdogNeeded(snapshot: EngineProgressWatchdogSnapshot): boolean {
  if (snapshot.phase !== 'active' || snapshot.gameOver) {
    return false
  }
  return !snapshot.prompt && !snapshot.canPass && snapshot.legalActionCount === 0
}

export function watchdogTimerAction(now: number, deadline: number): 'early' | 'expire' | 'rearm' {
  if (now < deadline) {
    return 'early'
  }
  return now - deadline > MAX_HOST_TIMER_LATENESS_MS ? 'rearm' : 'expire'
}

function storedValue(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function saveValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* Storage is optional. */
  }
}

class MatchErrorBoundary extends Component<
  { children: ReactNode; onError: (error: unknown) => void; onReset: () => void },
  { error: unknown }
> {
  state: { error: unknown } = { error: null }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error }
  }

  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError(error)
  }

  render(): ReactNode {
    if (this.state.error == null) {
      return this.props.children
    }
    return (
      <section className={styles.failure} role="alert">
        <strong>The game surface stopped</strong>
        <span>{conciseError(this.state.error)}</span>
        <button className={styles.primaryButton} type="button" onClick={this.props.onReset}>
          Choose decks
        </button>
      </section>
    )
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function conciseError(error: unknown): string {
  const message = errorMessage(error).split('\n', 1)[0]!.trim()
  return message.length > 280 ? `${message.slice(0, 280)}…` : message
}

function eventLabel(event: BrowserEngineEvent): string | null {
  if (event.event === 'frame' || event.event === 'reply' || event.event === 'memory') {
    return null
  }
  if (event.event === 'error') {
    return `Engine error: ${conciseError(event.data)}`
  }
  const labels: Record<string, string> = {
    'engine-created': 'Preparing the local engine…',
    'engine-recycled': 'Preparing a fresh engine for the next game…',
    initializing: 'Preparing the local engine…',
    'runtime-ready': 'Runtime ready. Loading the card library…',
    'jars-ready': 'Card library ready. Installing the catalog…',
    'facade-ready': 'Engine ready. Preparing the full card pool…',
    'catalog-assets-ready': 'Catalog ready. Starting the local game…',
    'resources-installed': 'Catalog installed. Preparing the rules engine…',
    'card-database-ready': 'Rules engine ready. Starting the local game…',
    'catalog-ready': 'Full card pool ready. Starting the local game…',
    started: 'Local game started',
    result: 'Game finished',
    closed: 'Local game ended',
  }
  return labels[event.event] ?? event.event
}

async function fetchDeck(choice: DeckChoice, customText: string, seat: string): Promise<string> {
  if (choice === 'custom') {
    const text = customText.trim()
    if (!text) {
      throw new Error(`${seat} decklist is empty.`)
    }
    return text
  }
  const response = await fetch(CURATED_DECKS[choice].file)
  if (!response.ok) {
    throw new Error(`Could not load the ${CURATED_DECKS[choice].label} deck.`)
  }
  const text = await response.text()
  if (!text.trim()) {
    throw new Error(`The ${CURATED_DECKS[choice].label} deck is empty.`)
  }
  return text
}

function DeckPicker({
  seat,
  choice,
  customText,
  disabled,
  onChoice,
  onCustomText,
}: {
  seat: string
  choice: DeckChoice
  customText: string
  disabled: boolean
  onChoice: (choice: DeckChoice) => void
  onCustomText: (text: string) => void
}) {
  return (
    <label className={styles.deckPicker}>
      <span className={styles.fieldLabel}>{seat} deck</span>
      <select
        aria-label={`${seat} deck`}
        value={choice}
        disabled={disabled}
        onChange={(event) => onChoice(event.currentTarget.value as DeckChoice)}
      >
        {Object.entries(CURATED_DECKS).map(([id, deck]) => (
          <option key={id} value={id}>
            {deck.label}
          </option>
        ))}
        <option value="custom">Paste a decklist</option>
      </select>
      {choice === 'custom' && (
        <textarea
          aria-label={`${seat} decklist`}
          value={customText}
          disabled={disabled}
          onChange={(event) => onCustomText(event.currentTarget.value)}
          placeholder={'Deck\n4 Mountain\n...'}
          spellCheck={false}
          maxLength={32_768}
        />
      )}
    </label>
  )
}

function BrowserMatch() {
  const [phase, setPhaseState] = useState<LauncherPhase>('ready')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Ready to start a local game.')
  const spectator = false
  const [match, setMatch] = useState<BrowserMatch | null>(null)
  const [playerChoice, setPlayerChoice] = useState<DeckChoice>('red')
  const [opponentChoice, setOpponentChoice] = useState<DeckChoice>('golgari')
  const [playerCustom, setPlayerCustom] = useState(() =>
    storedValue('forge:browser-engine:player-deck'),
  )
  const [opponentCustom, setOpponentCustom] = useState(() =>
    storedValue('forge:browser-engine:opponent-deck'),
  )
  const [activeSeed, setActiveSeed] = useState(() => queryOrRandomSeed())
  const board = useBoardSnapshot()
  const hasPrompt = board.prompt != null
  const legalActionCount = board.legalActions.length
  const phaseRef = useRef<LauncherPhase>('ready')
  const launchEpochRef = useRef(0)
  const watchdogRef = useRef<{ key: string; deadline: number; timer: number | null }>({
    key: '',
    deadline: 0,
    timer: null,
  })
  const armProgressWatchdogRef = useRef<(key: string, deadline: number) => void>(() => undefined)
  const latestWatchdogRef = useRef<
    EngineProgressWatchdogSnapshot & { matchId: string; gameStateId: number }
  >({
    phase: 'ready',
    gameOver: false,
    prompt: false,
    canPass: false,
    legalActionCount: 0,
    matchId: '',
    gameStateId: 0,
  })

  function setPhase(next: LauncherPhase): void {
    phaseRef.current = next
    setPhaseState(next)
  }

  function clearProgressWatchdog(): void {
    if (watchdogRef.current.timer !== null) {
      window.clearTimeout(watchdogRef.current.timer)
    }
    watchdogRef.current = { key: '', deadline: 0, timer: null }
  }

  function resetEngine(): void {
    clearProgressWatchdog()
    launchEpochRef.current += 1
    greStore.clearSession()
    engine?.dispose()
    engine = null
    setMatch(null)
  }

  function createEngine(): BrowserEngine {
    return new BrowserEngine((event) => {
      appendDiagnosticEvent(events, event)
      const label = eventLabel(event)
      if (label) {
        setStatus(label)
      }
      if (event.event === 'error' && phaseRef.current === 'active') {
        setError(conciseError(event.data))
        resetEngine()
        setPhase('failed')
      }
    })
  }

  async function launch(): Promise<{ matchId: string }> {
    if (phaseRef.current === 'preparing') {
      throw new Error('A local game is already preparing.')
    }
    if (phaseRef.current === 'active' && !greStore.gameOver) {
      throw new Error('A local game is already running.')
    }
    const launchEpoch = ++launchEpochRef.current
    setError('')
    setPhase('preparing')
    setStatus('Preparing the local engine…')
    const seed = queryOrRandomSeed()
    setActiveSeed(seed)
    try {
      const unsupported = currentBrowserPreflightFailure()
      if (unsupported) {
        throw new Error(unsupported)
      }
      if (greStore.gameOver) {
        greStore.clearSession()
      }
      const active = engine ?? (engine = createEngine())
      const activeDecks = await Promise.all([
        fetchDeck(playerChoice, playerCustom, 'Your'),
        fetchDeck(opponentChoice, opponentCustom, 'Opponent'),
      ])
      const result = await active.createMatch(
        activeDecks[0],
        activeDecks[1],
        seed,
        'constructed',
        `browser-${crypto.randomUUID()}`,
      )
      if (launchEpoch !== launchEpochRef.current) {
        result.source.stop()
        throw new Error('Local game start was cancelled.')
      }
      greStore.connectSource(result.source, {
        matchId: result.matchId,
        execution: 'browser',
        fetchCardMeta: (ids) => active.fetchCardMeta(ids),
      })
      setMatch(result)
      setStatus('Local game started')
      setPhase('active')
      return { matchId: result.matchId }
    } catch (caught) {
      if (launchEpoch !== launchEpochRef.current) {
        throw caught
      }
      const message = conciseError(caught)
      resetEngine()
      setError(message)
      setStatus('The local game could not start.')
      setPhase('failed')
      throw caught
    }
  }

  function launchFromSetup(): void {
    void launch().catch(() => {})
  }

  function downloadReport(): void {
    const diagnostics = engine?.diagnostics() ?? null
    const report = {
      generatedAt: new Date().toISOString(),
      build: BUILD_ID,
      phase: phaseRef.current,
      seed: activeSeed,
      status,
      error,
      decks: {
        player: {
          source: playerChoice === 'custom' ? 'pasted' : 'curated',
          label: playerLabel,
          catalogPath: playerChoice === 'custom' ? null : CURATED_DECKS[playerChoice].file,
          decklistIncluded: playerChoice === 'custom',
          decklist: playerChoice === 'custom' ? playerCustom : null,
        },
        opponent: {
          source: opponentChoice === 'custom' ? 'pasted' : 'curated',
          label: opponentLabel,
          catalogPath: opponentChoice === 'custom' ? null : CURATED_DECKS[opponentChoice].file,
          decklistIncluded: opponentChoice === 'custom',
          decklist: opponentChoice === 'custom' ? opponentCustom : null,
        },
      },
      events: [...events],
      diagnostics,
      greState: window.__greState?.() ?? null,
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `forge-browser-engine-${Date.now()}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function returnToLauncher(): void {
    if (
      phaseRef.current === 'active' &&
      !greStore.gameOver &&
      !window.confirm('End this local game and return to deck setup?')
    ) {
      return
    }
    clearProgressWatchdog()
    if (greStore.gameOver) {
      greStore.clearSession()
      setMatch(null)
    } else {
      resetEngine()
    }
    setError('')
    setStatus('Ready to start a local game.')
    setPhase('ready')
  }

  function failGame(error: unknown): void {
    resetEngine()
    setError(conciseError(error))
    setStatus('The game surface stopped.')
    setPhase('failed')
  }

  function cancelPreparation(): void {
    if (phaseRef.current !== 'preparing') {
      return
    }
    resetEngine()
    setError('')
    setStatus('Ready to start a local game.')
    setPhase('ready')
  }

  function armProgressWatchdog(key: string, deadline: number): void {
    const current = watchdogRef.current
    if (current.key !== key || current.deadline !== deadline || current.timer !== null) {
      return
    }
    const delay = Math.max(1, deadline - performance.now())
    current.timer = window.setTimeout(() => {
      current.timer = null
      if (watchdogRef.current.key !== key || watchdogRef.current.deadline !== deadline) {
        return
      }
      const latest = latestWatchdogRef.current
      if (
        !engineProgressWatchdogNeeded(latest) ||
        `${latest.matchId}:${latest.gameStateId}` !== key
      ) {
        return
      }
      const now = performance.now()
      const action = watchdogTimerAction(now, deadline)
      if (action === 'early') {
        armProgressWatchdog(key, deadline)
        return
      }
      if (action === 'rearm') {
        watchdogRef.current.deadline = now + ENGINE_PROGRESS_TIMEOUT_MS
        armProgressWatchdog(key, watchdogRef.current.deadline)
        return
      }
      const matchId = latest.matchId.slice(0, 128) || 'unknown'
      appendDiagnosticEvent(events, {
        event: 'error',
        data: `Engine progress watchdog expired (match=${matchId}, gsId=${latest.gameStateId})`,
        at: now,
      })
      failGame(
        new Error('The local engine stopped making progress. Try again to start a fresh worker.'),
      )
    }, delay)
  }

  armProgressWatchdogRef.current = armProgressWatchdog

  useEffect(() => {
    const disposeForPageHide = () => {
      clearProgressWatchdog()
      launchEpochRef.current += 1
      greStore.clearSession()
      engine?.dispose()
      engine = null
    }
    const resetRestoredPage = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        return
      }
      clearProgressWatchdog()
      setMatch(null)
      setError('')
      setStatus('Ready to start a local game.')
      setPhase('ready')
    }
    window.addEventListener('pagehide', disposeForPageHide)
    window.addEventListener('pageshow', resetRestoredPage)
    return () => {
      window.removeEventListener('pagehide', disposeForPageHide)
      window.removeEventListener('pageshow', resetRestoredPage)
      disposeForPageHide()
    }
  }, [])

  useEffect(() => {
    saveValue('forge:browser-engine:player-deck', playerCustom)
    saveValue('forge:browser-engine:opponent-deck', opponentCustom)
  }, [opponentCustom, playerCustom])

  latestWatchdogRef.current = {
    phase,
    gameOver: board.gameOver,
    prompt: hasPrompt,
    canPass: board.canPass,
    legalActionCount,
    matchId: board.currentMatchId,
    gameStateId: board.gameStateId,
  }

  useEffect(() => {
    const snapshot = latestWatchdogRef.current
    if (!engineProgressWatchdogNeeded(snapshot)) {
      clearProgressWatchdog()
      return
    }
    const key = `${snapshot.matchId}:${snapshot.gameStateId}`
    if (watchdogRef.current.key !== key) {
      if (watchdogRef.current.timer !== null) {
        window.clearTimeout(watchdogRef.current.timer)
      }
      watchdogRef.current = {
        key,
        deadline: performance.now() + ENGINE_PROGRESS_TIMEOUT_MS,
        timer: null,
      }
    }
    armProgressWatchdogRef.current(watchdogRef.current.key, watchdogRef.current.deadline)
    return () => {
      if (watchdogRef.current.timer !== null) {
        window.clearTimeout(watchdogRef.current.timer)
        watchdogRef.current.timer = null
      }
    }
  }, [
    board.canPass,
    board.currentMatchId,
    board.gameOver,
    board.gameStateId,
    hasPrompt,
    legalActionCount,
    phase,
  ])

  const playerLabel = playerChoice === 'custom' ? 'Custom deck' : CURATED_DECKS[playerChoice].label
  const opponentLabel =
    opponentChoice === 'custom' ? 'Custom deck' : CURATED_DECKS[opponentChoice].label
  const defaultPlayLabel = playerChoice === 'red' && opponentChoice === 'golgari'
  const nextMatchLabel = defaultPlayLabel ? 'Play Red Deck Wins' : 'Play local game'

  function startNextMatch(): void {
    if (!greStore.gameOver) {
      returnToLauncher()
      return
    }
    clearProgressWatchdog()
    greStore.clearSession()
    setMatch(null)
    setError('')
    setStatus('Ready to start a local game.')
    setPhase('ready')
  }

  if (phase === 'active' && match) {
    return (
      <main className={styles.matchPage}>
        <header className={styles.matchBar}>
          <div>
            <p className={styles.eyebrow}>Browser-local Forge</p>
            <h1>Local game</h1>
          </div>
          <div className={styles.matchActions}>
            <span className={styles.liveStatus} role="status">
              {board.gameOver ? 'Game finished' : status}
            </span>
            <button className={styles.quietButton} type="button" onClick={returnToLauncher}>
              Choose decks
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              title="Includes game diagnostics and any pasted decklists"
              onClick={downloadReport}
            >
              Download report
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={board.gameOver ? () => launchFromSetup() : startNextMatch}
            >
              {board.gameOver ? nextMatchLabel : 'New game'}
            </button>
          </div>
        </header>
        <div className={styles.board}>
          <MatchErrorBoundary onError={failGame} onReset={returnToLauncher}>
            <GrePlay
              showDeckConfig={false}
              showHeader={false}
              showHeaderActions={false}
              spectator={spectator}
            />
          </MatchErrorBoundary>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <section className={styles.launcher} aria-labelledby="launcher-title">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>Browser-local Forge</p>
          <h1 id="launcher-title">Play Forge in your browser.</h1>
          <p className={styles.lede}>
            A complete Forge card pool runs on your machine. Pick a deck or paste a decklist. two
            decks play through the normal tabletop.
          </p>
          <a
            className={styles.vendorLink}
            href="https://cheerpj.com"
            target="_blank"
            rel="noreferrer"
          >
            Powered by CheerpJ
          </a>
        </div>

        <section className={styles.setup} aria-label="Local game setup">
          <div className={styles.setupHeading}>
            <div>
              <p className={styles.sectionKicker}>Choose a matchup</p>
              <h2>Start from a decklist</h2>
            </div>
            <span className={styles.readyMark} data-phase={phase}>
              {phase === 'preparing'
                ? 'Preparing'
                : phase === 'failed'
                  ? 'Needs attention'
                  : 'Ready'}
            </span>
          </div>
          <div className={styles.decks}>
            <DeckPicker
              seat="Your"
              choice={playerChoice}
              customText={playerCustom}
              disabled={phase === 'preparing'}
              onChoice={setPlayerChoice}
              onCustomText={setPlayerCustom}
            />
            <div className={styles.vs} aria-hidden="true">
              vs
            </div>
            <DeckPicker
              seat="Opponent"
              choice={opponentChoice}
              customText={opponentCustom}
              disabled={phase === 'preparing'}
              onChoice={setOpponentChoice}
              onCustomText={setOpponentCustom}
            />
          </div>
          <p className={styles.deckSummary}>
            {playerLabel} against {opponentLabel}. Forge decklists may include main and sideboard
            entries.
          </p>
          {phase === 'failed' && (
            <section className={styles.failure} role="alert">
              <strong>Could not start the local game</strong>
              <span>{error}</span>
              <div className={styles.failureActions}>
                <button
                  className={styles.primaryButton}
                  type="button"
                  onClick={() => launchFromSetup()}
                >
                  Try again
                </button>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  title="Includes game diagnostics and any pasted decklists"
                  onClick={downloadReport}
                >
                  Download local report
                </button>
              </div>
            </section>
          )}
          {phase === 'preparing' && (
            <p className={styles.preparing} role="status" aria-live="polite">
              {status}
            </p>
          )}
          {phase !== 'preparing' && phase !== 'failed' && (
            <p className={styles.readyText} role="status" aria-live="polite">
              {status} The first start downloads the complete catalog once.
            </p>
          )}
          <div className={styles.actions}>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={phase === 'preparing'}
              onClick={() => launchFromSetup()}
            >
              {defaultPlayLabel ? 'Play Red Deck Wins' : 'Play local game'}
            </button>
          </div>
          {phase === 'preparing' && (
            <button className={styles.quietButton} type="button" onClick={cancelPreparation}>
              Cancel preparation
            </button>
          )}
          <p className={styles.refreshNote}>
            Pasted decklists stay on this device. Refreshing the page ends the current game.
          </p>
        </section>
      </section>
    </main>
  )
}

if (typeof document !== 'undefined') {
  createRoot(document.getElementById('app')!).render(<BrowserMatch />)
}
