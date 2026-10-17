/**
 * Container for the limited (draft/sealed) surface: set-picker setup screen,
 * live phase transitions, deck build, and hand-off into a GRE match. Mounted
 * by `LimitedRoute` (`src/shell/LimitedRoute.tsx`), which supplies the
 * callbacks that talk to `/api/{draft,sealed}` and `greSession`.
 */

import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { SEALED_ENABLED } from '@shared/flags'
import { apiFetch } from '@shared/api/client'
import { SealedSetSchema, type SealedSet } from '@shared/api/contracts'
import { draftStore } from '@features/limited/draft-store'
import { sealedStore } from '@features/limited/sealed-store'
import { useRouter } from '@app/router'
import { useDraftSnapshot, useSealedSnapshot } from './limited-stores'
import { DraftPicking } from './draft/DraftPicking'
import { LimitedDeckBuilder } from './LimitedDeckBuilder'
import { SetPicker } from './SetPicker'
import { SavedPools } from './SavedPools'
import { cx } from '@shared/react/cx'
import { Button } from '@shared/ui/Button'
import styles from './LimitedView.module.css'

const CONFIG = {
  draft: {
    title: 'Booster Draft',
    subtitle: 'Draft three packs against seven opponents, build a 40-card deck, then play.',
    startLabel: 'Start Draft',
    startingLabel: 'Starting draft...',
    connectingLabel: 'Starting draft...',
    poolLabel: 'Sideboard',
    initialSide: 'mainboard' as const,
    formats: ['draft'] as string[],
    finishedLabel: 'Draft Complete',
    newLabel: 'New Draft',
    buildTitle: 'Build your draft deck',
  },
  sealed: {
    title: 'Sealed Deck',
    subtitle: 'Open 6 booster packs and build a 40-card deck',
    startLabel: 'Open Packs',
    startingLabel: 'Opening packs...',
    connectingLabel: 'Opening booster packs...',
    poolLabel: 'Pool',
    initialSide: 'sideboard' as const,
    formats: ['sealed'] as string[],
    finishedLabel: 'Sealed Complete',
    newLabel: 'New Sealed',
    buildTitle: 'Sealed Deck Build',
  },
} as const

export function LimitedView({
  mode,
  onPlaySaved,
  onPlayBuilt,
  onPlayMatch,
  onEditSaved,
}: {
  mode: 'draft' | 'sealed'
  onPlaySaved?: (deckId: string) => Promise<void>
  onPlayBuilt?: (
    mainboard: string[],
    sideboard: string[],
    mode: 'draft' | 'sealed',
  ) => Promise<void>
  onPlayMatch?: (
    launch: { coursePlayId: string; seat1Deck: string; seat2Deck: string },
    mode: 'draft' | 'sealed',
  ) => Promise<void>
  onEditSaved?: (deckId: string) => void
}) {
  // Rules of hooks: both snapshots are read unconditionally, then the active
  // one is picked by `mode`.
  const draft = useDraftSnapshot()
  const sealed = useSealedSnapshot()
  const router = useRouter()
  const store = mode === 'draft' ? draftStore : sealedStore
  const active = mode === 'draft' ? draft : sealed

  const cfg = CONFIG[mode]
  const { phase, pool, error } = active

  const [sets, setSets] = useState<SealedSet[]>([])
  const [selectedSetCode, setSelectedSetCode] = useState('NEO')
  const [loadingSets, setLoadingSets] = useState(true)
  const [starting, setStarting] = useState(false)
  const [enteringGame, setEnteringGame] = useState(false)

  // Resume an in-progress build whenever the sealed tab becomes the active
  // one. The draft/sealed tabs swap this component's props without remounting
  // it, so checking only on mount would skip the resume for anyone who lands
  // on draft first and switches over.
  useEffect(() => {
    if (mode === 'sealed' && sealedStore.phase === 'idle') {
      void sealedStore.tryResume()
    }
  }, [mode])

  const mounted = useRef(false)
  useEffect(() => {
    if (mounted.current) {
      return
    }
    mounted.current = true

    void (async () => {
      try {
        const res = await apiFetch('/api/sealed/sets')
        const raw: unknown = await res.json()
        const parsed = z.array(SealedSetSchema).safeParse(raw)
        if (parsed.success) {
          setSets(parsed.data)
          if (parsed.data.length > 0 && !parsed.data.some((s) => s.code === selectedSetCode)) {
            setSelectedSetCode(parsed.data[0]!.code)
          }
        }
      } catch (err) {
        console.warn('[limited] Failed to fetch sets', err)
      } finally {
        setLoadingSets(false)
      }
    })()
    // Runs once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const launch = active.matchLaunch
  useEffect(() => {
    if (!onPlayMatch || enteringGame || phase !== 'playing' || !launch) {
      return
    }
    setEnteringGame(true)
    setLimitedError(null)
    void onPlayMatch(launch, mode).catch((err) => {
      setLimitedError(err instanceof Error ? err.message : 'Failed to start game')
      setEnteringGame(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch, phase, mode])

  async function handleStart(): Promise<void> {
    if (starting) {
      return
    }
    setStarting(true)
    if (mode === 'draft') {
      await draftStore.startDraft(selectedSetCode)
    } else {
      await sealedStore.startSealed(selectedSetCode)
    }
    setStarting(false)
  }

  function handleReset(): void {
    if ((mode === 'draft' && draft.submitting) || enteringGame) {
      return
    }
    if (mode === 'draft') {
      void draftStore.discardDraft()
    } else {
      store.reset()
    }
  }

  function handleBack(): void {
    if ((mode === 'draft' && draft.submitting) || enteringGame) {
      return
    }
    store.reset()
  }

  async function handleSubmitDeck(mainboard: string[], sideboard: string[]): Promise<void> {
    if (enteringGame) {
      return
    }
    if (active.savedDeckId && onPlayBuilt) {
      setEnteringGame(true)
      setLimitedError(null)
      try {
        await onPlayBuilt(mainboard, sideboard, mode)
      } catch (err) {
        setLimitedError(err instanceof Error ? err.message : 'Failed to start game')
        setEnteringGame(false)
      }
      return
    }
    setLimitedError(null)
    if (mode === 'draft') {
      void draftStore.submitDeck(mainboard, sideboard)
    } else {
      void sealedStore.submitDeck(mainboard, sideboard)
    }
  }

  function setLimitedError(message: string | null): void {
    if (mode === 'draft') {
      draftStore.setError(message)
    } else {
      sealedStore.setError(message)
    }
  }

  function switchMode(newMode: 'draft' | 'sealed'): void {
    if (newMode === mode) {
      return
    }
    router.navigate(`/play/limited?mode=${newMode}`)
  }

  if (phase === 'idle') {
    return (
      <div className={styles.setupScreen}>
        {SEALED_ENABLED && (
          <div className={styles.modeToggle}>
            <button
              className={cx(styles.modeTab, mode === 'draft' && styles.active)}
              type="button"
              onClick={() => switchMode('draft')}
            >
              Draft
            </button>
            <button
              className={cx(styles.modeTab, mode === 'sealed' && styles.active)}
              type="button"
              onClick={() => switchMode('sealed')}
            >
              Sealed
            </button>
          </div>
        )}

        <h2 className={styles.setupTitle}>{cfg.title}</h2>
        <p className={styles.setupSubtitle}>{cfg.subtitle}</p>

        <div className={styles.setupColumns}>
          {onPlaySaved && onEditSaved && (
            <SavedPools formats={cfg.formats} onplay={onPlaySaved} onedit={onEditSaved} />
          )}
          <section className={styles.newDraft} aria-label={cfg.newLabel}>
            <h3 className={styles.sectionTitle}>{cfg.newLabel}</h3>
            <SetPicker
              sets={sets}
              selectedCode={selectedSetCode}
              loading={loadingSets}
              onSelect={setSelectedSetCode}
            />
            <Button
              onClick={() => void handleStart()}
              disabled={starting || loadingSets || sets.length === 0}
            >
              {starting ? cfg.startingLabel : cfg.startLabel}
            </Button>
          </section>
        </div>

        {error && <div className={styles.errorMsg}>{error}</div>}
      </div>
    )
  }

  if (phase === 'connecting') {
    return (
      <div className={styles.setupScreen}>
        <div className={styles.spinner} />
        <p className={styles.connectingLabel}>{cfg.connectingLabel}</p>
      </div>
    )
  }

  if (phase === 'drafting') {
    return <DraftPicking />
  }

  if (phase === 'deck_build') {
    return (
      <div className={styles.buildScreen}>
        <div className={styles.buildHeader}>
          <Button
            variant="secondary"
            size="compact"
            onClick={handleBack}
            disabled={(mode === 'draft' && draft.submitting) || enteringGame}
          >
            Back to Saved Pools
          </Button>
          <h2 className={styles.buildTitle}>{cfg.buildTitle}</h2>
          <span className={styles.poolInfo}>{pool.length} cards in pool</span>
          <button
            className={styles.newBtn}
            type="button"
            onClick={handleReset}
            disabled={(mode === 'draft' && draft.submitting) || enteringGame}
          >
            {cfg.newLabel}
          </button>
        </div>
        <div className={styles.builderContainer}>
          <LimitedDeckBuilder
            pool={pool}
            initialSide={cfg.initialSide}
            poolLabel={cfg.poolLabel}
            error={error}
            submitting={mode === 'draft' && draft.submitting}
            onSubmit={(m, s) => void handleSubmitDeck(m, s)}
          />
        </div>
      </div>
    )
  }

  if (phase === 'playing') {
    return (
      <div className={styles.phaseMessage}>
        <h2>Game Time</h2>
        <p>Transitioning to GRE match</p>
      </div>
    )
  }

  // phase === 'finished'
  return (
    <div className={styles.phaseMessage}>
      <h2>{cfg.finishedLabel}</h2>
      <button className={styles.actionBtn} type="button" onClick={handleReset}>
        {cfg.newLabel}
      </button>
    </div>
  )
}
