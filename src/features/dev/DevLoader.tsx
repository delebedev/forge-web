import { DevelopmentPuzzleSchema } from '@shared/api/wire-schemas'
import { readJson } from '@shared/api/decoding'
/**
 * Standalone dev-only bootstrap for `/dev/game` and `/dev/puzzle/:puzzleId`.
 * Renders outside `AppShell`, same as `gre-play`: it establishes a dev
 * session (if needed) then hands straight off to `greSession.start`, which
 * navigates into `/match/:matchId`.
 */

import { useEffect, useState } from 'react'
import { authStore } from '@shared/auth/auth'
import { devDefaultGreStartConfig, puzzleToGreStartConfig } from '@engine/runtime/gre-launch'
import { greSession } from '@engine/runtime/gre-session'
import { apiFetch } from '@shared/api/client'
import styles from './DevLoader.module.css'

export function DevLoader({
  puzzleId: puzzleIdProp,
  deckQuery,
}: {
  puzzleId?: string
  deckQuery?: string
}) {
  // Props may not be populated if router state hasn't synced yet on first
  // render — parse the URL directly as a reliable fallback.
  const pathMatch = location.pathname.match(/^\/dev\/puzzle\/(.+)$/)
  const puzzleId = puzzleIdProp || pathMatch?.[1] || undefined

  const [status, setStatus] = useState('Initializing…')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function boot(): Promise<void> {
      try {
        if (!authStore.isAuthenticated) {
          setStatus('Creating dev session…')
          // `refresh` only reads an existing session, so a first visit to a dev
          // route with no cookie yet would report the endpoints as missing.
          if (!(await authStore.ensureSession())) {
            if (!cancelled) {
              setError('Dev auth endpoints not available')
            }
            return
          }
        }
        if (puzzleId) {
          setStatus(`Loading puzzle ${puzzleId}…`)
          const metadata = await loadPuzzleMetadata(puzzleId)
          if (!metadata) {
            throw new Error('Puzzle content is unavailable')
          }
          greSession.startBrowser({
            ...puzzleToGreStartConfig(puzzleId, metadata),
            puzzleText: metadata.text,
          })
        } else {
          setStatus('Starting constructed game…')
          greSession.startBrowser(devDefaultGreStartConfig(deckQuery))
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={styles.devLoader}>
      {error ? (
        <>
          <p className={styles.error}>{error}</p>
          <p className={styles.hint}>
            puzzleId={puzzleId ?? '(none)'} deck={deckQuery ?? '(default)'}
          </p>
        </>
      ) : (
        <p>{status}</p>
      )}
    </div>
  )
}

async function loadPuzzleMetadata(
  puzzleId: string,
): Promise<{ name: string; objective: string; text: string } | null> {
  const response = await apiFetch(`/api/dev/puzzles/${encodeURIComponent(puzzleId)}`)
  if (!response.ok) {
    return null
  }
  const body = await readJson(response, DevelopmentPuzzleSchema)
  return typeof body.name === 'string' && typeof body.objective === 'string'
    ? { name: body.name, objective: body.objective, text: body.text }
    : null
}
