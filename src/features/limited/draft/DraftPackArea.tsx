/**
 * Draft pack header, controls, and selectable card grid.
 */

import { Card } from '@features/gre/board/Card'
import type { DraftCard } from '@shared/api/contracts'
import { catalogCardView } from '@features/gre/board/catalog-card-view'
import { cx } from '@shared/react/cx'
import styles from './DraftPackArea.module.css'

function rarityClass(rarity: string | null | undefined): string | false {
  if (!rarity) {
    return false
  }
  const r = rarity.toLowerCase()
  if (r === 'mythic' || r === 'mythic rare') {
    return styles.rarityMythic
  }
  if (r === 'rare') {
    return styles.rarityRare
  }
  if (r === 'uncommon') {
    return styles.rarityUncommon
  }
  return false
}

function scoreLabel(score: number | null | undefined): string {
  if (score == null || score <= -100) {
    return ''
  }
  return Math.round(score).toString()
}

function scoreGrade(score: number | null | undefined): string | false {
  if (score == null || score <= -100) {
    return false
  }
  if (score >= 80) {
    return styles.scoreHigh
  }
  if (score >= 50) {
    return styles.scoreMid
  }
  return styles.scoreLow
}

export function DraftPackArea({
  pack,
  round,
  pick,
  picking,
  error,
  autoPicking,
  sortMode,
  hasScores,
  onPick,
  onToggleAutoPick,
  onToggleSort,
}: {
  pack: DraftCard[]
  round: number
  pick: number
  picking: boolean
  error: string | null
  autoPicking: boolean
  sortMode: 'ranked' | 'natural'
  hasScores: boolean
  onPick: (card: DraftCard) => void
  onToggleAutoPick?: () => void
  onToggleSort: () => void
}) {
  const passDirection = round % 2 === 0 ? 'left' : 'right'

  return (
    <div className={styles.packArea}>
      <div className={styles.packHeader}>
        <div className={styles.roundInfo}>
          <span className={styles.roundBadge}>Round {round + 1}</span>
          <span className={styles.pickBadge}>Pick {pick + 1}</span>
          <span className={cx(styles.directionBadge, passDirection === 'right' && styles.right)}>
            {passDirection === 'left' ? '←' : '→'} Pass {passDirection}
          </span>
        </div>
        <div className={styles.packActions}>
          {/* Restore draft advice when the server exposes its advice endpoint. */}
          {onToggleAutoPick && (
            <button
              className={styles.devBtn}
              type="button"
              disabled={autoPicking}
              onClick={onToggleAutoPick}
            >
              {autoPicking ? 'Auto-picking draft...' : 'Auto-pick draft'}
            </button>
          )}
          <button
            className={cx(styles.sortToggle, sortMode === 'ranked' && styles.active)}
            type="button"
            onClick={onToggleSort}
            title={
              sortMode === 'natural'
                ? 'Sorted by rarity/color'
                : hasScores
                  ? 'Sorted by score'
                  : 'Original pack order'
            }
          >
            {sortMode === 'natural' ? 'Natural' : hasScores ? 'Ranked' : 'Pack order'}
          </button>
          <span className={styles.packCount}>{pack.length} cards</span>
        </div>
      </div>

      <div className={cx(styles.packGrid, picking && styles.disabled)}>
        {pack.map((card, i) => (
          <div key={card.name + i} className={cx(styles.packCard, rarityClass(card.rarity))}>
            {card.score != null && scoreLabel(card.score) && (
              <div className={cx(styles.scorePill, scoreGrade(card.score))}>
                {scoreLabel(card.score)}
              </div>
            )}
            <Card
              card={catalogCardView(card, i)}
              variant="preview"
              actionChrome={false}
              disabled={picking}
              onClick={() => onPick(card)}
              ariaLabel={`${scoreLabel(card.score)} ${card.name}`.trim()}
            />
          </div>
        ))}
      </div>

      {error && <div className={styles.draftError}>{error}</div>}
    </div>
  )
}
