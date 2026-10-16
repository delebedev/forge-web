/**
 * Search/color-filtered pool cards grouped by CMC.
 */

import type { DraftCard } from '@shared/api/contracts'
import type { CmcBucket } from '@shared/cards/deck-builder'
import { LimitedCardColumns } from './LimitedCardColumns'
import styles from './LimitedPoolStrip.module.css'

export function LimitedPoolStrip({
  poolLabel,
  groups,
  isEmpty,
  sideboardIsEmpty,
  onCardClick,
  onCardHover,
  onCardLeave,
}: {
  poolLabel: string
  groups: CmcBucket[]
  /** True when the search/color filter matched nothing. */
  isEmpty: boolean
  /** True when the whole sideboard is empty (distinct empty-hint copy from a no-match filter). */
  sideboardIsEmpty: boolean
  onCardClick: (poolIndex: number) => void
  onCardHover: (card: DraftCard, x: number, y: number) => void
  onCardLeave: () => void
}) {
  return (
    <div className={styles.poolStrip} role="region" aria-label={poolLabel}>
      <div className={styles.columnsPoolColumns}>
        <LimitedCardColumns
          groups={groups}
          onCardClick={(card) => onCardClick(card.poolIndex)}
          onCardHover={onCardHover}
          onCardLeave={onCardLeave}
        />
        {isEmpty && (
          <div className={styles.emptyHint}>
            {sideboardIsEmpty ? 'All cards in mainboard' : 'No matches'}
          </div>
        )}
      </div>
    </div>
  )
}
