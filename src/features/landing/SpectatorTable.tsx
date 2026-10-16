import { PublicSpectatorResponseSchema } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
/** Shared public spectator lifecycle. Survives public-page navigation. */

import { useEffect, useState, type ReactNode } from 'react'
import { greStore } from '@engine/runtime/gre-store'
import type { GameOutcome } from '@engine/state/gre-outcome'
import type { GreStartConfig } from '@engine/runtime/start'
import { useBoardSnapshot } from '@engine/runtime/hooks'
import { GrePlay } from '../gre/GrePlay'
import styles from './SpectatorTable.module.css'

const RESTART_DELAY_MS = 6_000

/**
 * The result as a spectator reads it: which deck beat which, not whether "you"
 * won. The feed seats the spectator behind seat one, so the viewer-relative
 * result names seat one's deck on a win and seat two's on a loss.
 */
function spectatorResult(outcome: GameOutcome | null, decks: [string, string]): string {
  const [first, second] = decks
  if (!outcome || !first || !second) {
    return 'Game over'
  }
  switch (outcome.viewerResult) {
    case 'win':
      return `${first} defeats ${second}`
    case 'loss':
      return `${second} defeats ${first}`
    case 'draw':
      return `${first} and ${second} draw`
    default:
      return 'Game over'
  }
}

type SpectatorStartRequest = { restart?: boolean }

const FALLBACK_SPECTATOR_DECKS: [string, string] = ['Pulverize', 'The Spikes']

export function SpectatorTable({ actions }: { actions?: ReactNode }) {
  const board = useBoardSnapshot()
  const isGameOver = board.gameOver

  const [landingReady, setLandingReady] = useState(false)
  const [spectatorRun, setSpectatorRun] = useState(0)
  const [currentSpectatorDecks, setCurrentSpectatorDecks] =
    useState<[string, string]>(FALLBACK_SPECTATOR_DECKS)
  const [spectatorConfig, setSpectatorConfig] = useState<GreStartConfig | null>(null)
  // Simulated audience for the public table, independent of connection telemetry.
  const [viewerCount, setViewerCount] = useState(() => 3 + Math.floor(Math.random() * 5))

  async function initializeSpectator(request: SpectatorStartRequest = {}): Promise<void> {
    setLandingReady(false)
    try {
      const base = import.meta.env['VITE_WEBDOOR_URL'] ?? location.origin
      const res = await fetch(`${base}/api/public/spectator/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!res.ok) {
        throw new Error(`spectator_start_${res.status}`)
      }
      const data = await readJson(res, PublicSpectatorResponseSchema)
      setCurrentSpectatorDecks([data.seat1.name, data.seat2.name])
      setSpectatorConfig({
        matchId: data.matchId,
        wireMatchId: data.wireMatchId,
        spectatorMode: true,
        gameType: 'spectator',
      })
    } catch {
      setCurrentSpectatorDecks(FALLBACK_SPECTATOR_DECKS)
      setSpectatorConfig(null)
    }
    setLandingReady(true)
  }

  useEffect(() => {
    void initializeSpectator()
    const interval = setInterval(() => {
      setViewerCount((count) => Math.max(3, Math.min(7, count + Math.floor(Math.random() * 3) - 1)))
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!landingReady || !isGameOver) {
      return
    }
    const timer = setTimeout(() => {
      greStore.clearSession()
      setSpectatorRun((run) => run + 1)
      void initializeSpectator({ restart: true })
    }, RESTART_DELAY_MS)
    return () => clearTimeout(timer)
  }, [landingReady, isGameOver])

  return (
    <section className={styles.table} aria-label="Continuous gameplay">
      <div className={styles.boardShell} aria-label="Live AI match">
        {landingReady && spectatorConfig ? (
          <GrePlay
            key={spectatorRun}
            initialConfig={spectatorConfig}
            autoStart
            showDeckConfig={false}
            spectator
            showHeader={false}
            showHeaderActions={false}
          />
        ) : (
          <div className={styles.loading} role="status">
            <p>
              {landingReady
                ? 'The live match could not be loaded. You can still sign in to play.'
                : 'Joining the table…'}
            </p>
            {landingReady && (
              <button type="button" onClick={() => void initializeSpectator()}>
                Try again
              </button>
            )}
          </div>
        )}
        {isGameOver && spectatorConfig && (
          <div className={styles.result} role="status">
            <strong>{spectatorResult(board.outcome, currentSpectatorDecks)}</strong>
            <p>Next game starting soon…</p>
          </div>
        )}
      </div>
      <footer className={styles.footer}>
        <div className={styles.decks} role="region" aria-label="Current spectator decks">
          <span>{currentSpectatorDecks[0]}</span>
          <span className={styles.versus}>vs</span>
          <span>{currentSpectatorDecks[1]}</span>
        </div>
        <div className={styles.actions}>
          <span className={styles.viewers} aria-label={`${viewerCount} watching`}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {viewerCount} watching
          </span>
          {actions}
        </div>
      </footer>
    </section>
  )
}
