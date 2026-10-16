/**
 * Mainboard CMC columns plus the basic-land adjuster column.
 */

import type { DraftCard } from '@shared/api/contracts'
import {
  LAND_COLORS,
  LAND_PIPS,
  basicLandImageUrl,
  type BasicLandCounts,
  type CmcBucket,
  type IndexedCard,
  type LandName,
} from '@shared/cards/deck-builder'
import { parseManaSymbols } from '@shared/cards/mana'
import { cx } from '@shared/react/cx'
import { LimitedCardColumns, LimitedCardThumbnail } from './LimitedCardColumns'
import styles from './LimitedMainboardColumns.module.css'

export function LimitedMainboardColumns({
  mainboardGroups,
  totalLands,
  landCounts,
  onRemoveCard,
  onIncrementLand,
  onDecrementLand,
  onAutoFillLands,
  onCardHover,
  onCardLeave,
}: {
  mainboardGroups: CmcBucket[]
  totalLands: number
  landCounts: BasicLandCounts
  onRemoveCard: (card: IndexedCard) => void
  onIncrementLand: (land: LandName) => void
  onDecrementLand: (land: LandName) => void
  onAutoFillLands: () => void
  onCardHover: (card: DraftCard, x: number, y: number) => void
  onCardLeave: () => void
}) {
  return (
    <div className={styles.mainboard}>
      <div className={styles.columns}>
        <LimitedCardColumns
          groups={mainboardGroups}
          onCardClick={onRemoveCard}
          onCardHover={onCardHover}
          onCardLeave={onCardLeave}
        />

        <div className={styles.landCol}>
          <div className={styles.colLabel}>
            <span className={styles.colLabelText}>Basics</span>
            <span className={styles.colLabelCount}>{totalLands}</span>
          </div>
          <div className={styles.cardStack}>
            {LAND_COLORS.map(
              (land) =>
                landCounts[land] > 0 && (
                  <LimitedCardThumbnail
                    key={land}
                    name={land}
                    imageUrl={basicLandImageUrl(land)}
                    count={landCounts[land]}
                    onClick={() => onDecrementLand(land)}
                  />
                ),
            )}
          </div>
          <div className={styles.landControls}>
            {LAND_COLORS.map((land) => (
              <div
                key={land}
                className={cx(styles.landPill, landCounts[land] === 0 && styles.empty)}
              >
                <span className={styles.landPip}>
                  {parseManaSymbols(`{${LAND_PIPS[land]}}`).map((sym, i) => (
                    <i key={i} className={sym.classes} title={sym.label} />
                  ))}
                </span>
                <span className={styles.landX}>{landCounts[land]}</span>
                <button
                  className={styles.landAdj}
                  type="button"
                  onClick={() => onDecrementLand(land)}
                  disabled={landCounts[land] === 0}
                  aria-label={`Decrease ${land}`}
                >
                  −
                </button>
                <button
                  className={styles.landAdj}
                  type="button"
                  onClick={() => onIncrementLand(land)}
                  aria-label={`Increase ${land}`}
                >
                  +
                </button>
              </div>
            ))}
            <button className={styles.autoFillBtn} type="button" onClick={onAutoFillLands}>
              Auto-fill
            </button>
          </div>
        </div>

        {mainboardGroups.length === 0 && totalLands === 0 && (
          <div className={styles.emptyHint}>Click cards in pool to add</div>
        )}
      </div>
    </div>
  )
}
