/**
 * Deck-building surface for a drafted/opened pool: mainboard/sideboard
 * split, basic-land counts, and submit.
 *
 * This container owns deck-building state. `LimitedPoolStrip` and
 * `LimitedMainboardColumns` render the sideboard and mainboard panes.
 */

import { useState } from 'react'
import type { DraftCard } from '@shared/api/contracts'
import {
  type IndexedCard,
  type LandName,
  BASIC_LAND_NAMES,
  CMC_BUCKETS,
  buildCmcGroups,
  emptyLandCounts,
  incrementLand as incLandCount,
  decrementLand as decLandCount,
  totalLandCount,
  curveCounts as cmcCurveCounts,
  maxCurveCount,
} from '@shared/cards/deck-builder'
import { CardHoverPreview } from '@features/gre/board/CardHoverPreview'
import { cx } from '@shared/react/cx'
import { LimitedPoolStrip } from './LimitedPoolStrip'
import { LimitedMainboardColumns } from './LimitedMainboardColumns'
import styles from './LimitedDeckBuilder.module.css'

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const
const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
}

function suggestedLandCounts(cards: DraftCard[]) {
  const pipCounts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  for (const card of cards) {
    for (const pip of card.manaCost?.match(/\{([WUBRG])\}/g) ?? []) {
      const color = pip[1]!
      pipCounts[color] = (pipCounts[color] ?? 0) + 1
    }
  }

  const totalPips = Object.values(pipCounts).reduce((sum, count) => sum + count, 0)
  if (totalPips === 0) {
    return { Plains: 4, Island: 4, Swamp: 3, Mountain: 3, Forest: 3 }
  }

  const distribution: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  for (const [color, count] of Object.entries(pipCounts)) {
    distribution[color] = Math.round((count / totalPips) * 17)
  }
  const sortedColors = Object.entries(pipCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
  let currentTotal = Object.values(distribution).reduce((sum, count) => sum + count, 0)
  for (const [color] of sortedColors) {
    if (currentTotal >= 17) {
      break
    }
    distribution[color]!++
    currentTotal++
  }
  for (const [color] of sortedColors) {
    if (currentTotal <= 17) {
      break
    }
    if (distribution[color]! > 0) {
      distribution[color]!--
      currentTotal--
    }
  }
  return {
    Plains: distribution['W'] ?? 0,
    Island: distribution['U'] ?? 0,
    Swamp: distribution['B'] ?? 0,
    Mountain: distribution['R'] ?? 0,
    Forest: distribution['G'] ?? 0,
  }
}

export function LimitedDeckBuilder({
  pool,
  initialSide = 'sideboard',
  poolLabel = 'Sideboard',
  error,
  submitting = false,
  onSubmit,
}: {
  pool: DraftCard[]
  /** 'mainboard' = all cards start in mainboard (draft); 'sideboard' = all in pool (sealed) */
  initialSide?: 'mainboard' | 'sideboard'
  /** Label for the right panel */
  poolLabel?: string
  error: string | null
  submitting?: boolean
  onSubmit: (mainboard: string[], sideboard: string[]) => void
}) {
  const [mainboardIndices, setMainboardIndices] = useState<Set<number>>(
    () => new Set(initialSide === 'mainboard' ? pool.map((_, i) => i) : []),
  )
  const [removedIndices, setRemovedIndices] = useState<Set<number>>(() => new Set())
  const [landCounts, setLandCounts] = useState(emptyLandCounts())

  const [poolCollapsed, setPoolCollapsed] = useState(initialSide === 'mainboard')
  const [searchQuery, setSearchQuery] = useState('')
  const [colorFilter, setColorFilter] = useState<Set<string>>(() => new Set())

  const [hoveredCard, setHoveredCard] = useState<DraftCard | null>(null)
  const [tooltipX, setTooltipX] = useState(0)
  const [tooltipY, setTooltipY] = useState(0)

  const indexedPool: IndexedCard[] = pool.map((c, i) => ({ ...c, poolIndex: i }))
  const mainboardCards = indexedPool.filter((c) => mainboardIndices.has(c.poolIndex))
  const sideboardCards = indexedPool
    .filter((c) => !mainboardIndices.has(c.poolIndex) && !removedIndices.has(c.poolIndex))
    .sort((a, b) => a.name.localeCompare(b.name))

  let filteredSideboardCards = sideboardCards
  const q = searchQuery.toLowerCase().trim()
  if (q) {
    filteredSideboardCards = filteredSideboardCards.filter((c) => c.name.toLowerCase().includes(q))
  }
  if (colorFilter.size > 0) {
    filteredSideboardCards = filteredSideboardCards.filter(
      (c) => c.colors.length === 0 || c.colors.some((clr) => colorFilter.has(clr)),
    )
  }
  const filteredSideboardGroups = buildCmcGroups(filteredSideboardCards)

  const totalLands = totalLandCount(landCounts)
  const deckSize = mainboardCards.length + totalLands
  const canSubmit = deckSize >= 40

  const mainboardGroups = buildCmcGroups(mainboardCards)
  const curveCounts = cmcCurveCounts(mainboardGroups)
  const maxCurve = maxCurveCount(curveCounts)

  function moveToMainboard(idx: number): void {
    setRemovedIndices((prev) => {
      if (!prev.has(idx)) {
        return prev
      }
      const next = new Set(prev)
      next.delete(idx)
      return next
    })
    setMainboardIndices((prev) => new Set(prev).add(idx))
  }

  function removeFromMainboard(card: IndexedCard): void {
    setMainboardIndices((prev) => {
      const next = new Set(prev)
      next.delete(card.poolIndex)
      return next
    })
    if (BASIC_LAND_NAMES.has(card.name)) {
      setRemovedIndices((prev) => new Set(prev).add(card.poolIndex))
    }
  }

  function moveAllToSideboard(): void {
    setMainboardIndices(new Set())
  }

  function incrementLand(land: LandName): void {
    setLandCounts((counts) => incLandCount(counts, land))
  }

  function decrementLand(land: LandName): void {
    setLandCounts((counts) => decLandCount(counts, land))
  }

  function toggleColor(color: string): void {
    setColorFilter((prev) => {
      const next = new Set(prev)
      if (next.has(color)) {
        next.delete(color)
      } else {
        next.add(color)
      }
      return next
    })
  }

  function autoFillLands(): void {
    setLandCounts(suggestedLandCounts(mainboardCards))
  }

  function autoBuildDeck(): void {
    const selected = indexedPool.slice(0, 23)
    setMainboardIndices(new Set(selected.map((card) => card.poolIndex)))
    setRemovedIndices(new Set())
    setLandCounts(suggestedLandCounts(selected))
    setPoolCollapsed(false)
  }

  function handleSubmit(): void {
    if (!canSubmit || submitting) {
      return
    }
    const mainboardNames: string[] = mainboardCards.map((c) => c.name)
    for (const [land, count] of Object.entries(landCounts)) {
      for (let i = 0; i < count; i++) {
        mainboardNames.push(land)
      }
    }
    onSubmit(
      mainboardNames,
      sideboardCards.map((c) => c.name),
    )
  }

  function showPreview(card: DraftCard, x: number, y: number): void {
    setHoveredCard(card)
    setTooltipX(x)
    setTooltipY(y)
  }

  function hidePreview(): void {
    setHoveredCard(null)
  }

  return (
    <div className={styles.deckBuilder}>
      <div className={styles.toolbar}>
        <button
          className={styles.poolToggle}
          type="button"
          onClick={() => setPoolCollapsed((c) => !c)}
        >
          <span className={styles.toggleArrow}>{poolCollapsed ? '▶' : '▼'}</span>
          <span className={styles.toggleLabel}>{poolLabel}</span>
          <span className={styles.toggleCount}>{sideboardCards.length}</span>
        </button>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="Search pool..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.currentTarget.value)}
        />
        <div className={styles.colorFilters}>
          {COLORS.map((color) => (
            <button
              key={color}
              className={cx(styles.colorChip, colorFilter.has(color) && styles.active)}
              type="button"
              title={COLOR_NAMES[color]}
              onClick={() => toggleColor(color)}
            >
              <i
                className={`ms ms-cost ms-${color.toLowerCase()}`}
                aria-label={COLOR_NAMES[color]}
              />
            </button>
          ))}
        </div>
      </div>

      {!poolCollapsed && (
        <LimitedPoolStrip
          poolLabel={poolLabel}
          groups={filteredSideboardGroups}
          isEmpty={filteredSideboardCards.length === 0}
          sideboardIsEmpty={sideboardCards.length === 0}
          onCardClick={moveToMainboard}
          onCardHover={showPreview}
          onCardLeave={hidePreview}
        />
      )}

      {error && <div className={styles.deckError}>{error}</div>}

      <div className={styles.deckHeader}>
        <div className={styles.deckHeaderLeft}>
          <span className={styles.deckLabel}>Deck</span>
          <span className={cx(styles.deckCount, deckSize < 40 && styles.warning)}>
            {deckSize}
            <span className={styles.deckTarget}>/40</span>
          </span>
          {mainboardCards.length > 0 && (
            <button className={styles.bulkBtn} type="button" onClick={moveAllToSideboard}>
              Clear
            </button>
          )}
        </div>
        <div className={styles.miniCurve}>
          {CMC_BUCKETS.map((cmc) => {
            const count = curveCounts[cmc] ?? 0
            return (
              <div key={cmc} className={styles.miniCurveCol}>
                <div
                  className={styles.miniCurveBar}
                  style={{ height: count > 0 ? Math.max(3, (count / maxCurve) * 28) : 0 }}
                />
                <div className={styles.miniCurveLabel}>{cmc}</div>
              </div>
            )
          })}
        </div>
        <div className={styles.deckHeaderRight}>
          {import.meta.env.DEV && (
            <button className={styles.bulkBtn} type="button" onClick={autoBuildDeck}>
              Auto-build deck
            </button>
          )}
          <button
            className={styles.submitBtn}
            type="button"
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
          >
            {submitting
              ? 'Starting game...'
              : canSubmit
                ? 'Start Game'
                : `Start Game (${deckSize}/40)`}
          </button>
        </div>
      </div>

      <LimitedMainboardColumns
        mainboardGroups={mainboardGroups}
        totalLands={totalLands}
        landCounts={landCounts}
        onRemoveCard={removeFromMainboard}
        onIncrementLand={incrementLand}
        onDecrementLand={decrementLand}
        onAutoFillLands={autoFillLands}
        onCardHover={showPreview}
        onCardLeave={hidePreview}
      />

      <CardHoverPreview card={hoveredCard} x={tooltipX} y={tooltipY} position="follow-mouse" />
    </div>
  )
}
