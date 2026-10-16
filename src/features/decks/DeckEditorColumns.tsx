/**
 * `DeckEditor`'s left pane: mainboard grouped by CMC, plus the basic-land
 * adjuster row. Split out of `DeckEditor.tsx` to keep both files under the
 * file-size budget.
 */

import { parseManaSymbols } from '@shared/cards/mana'
import {
  LAND_COLORS,
  LAND_PIPS,
  quantityWarning,
  type CmcBucket,
  type LandName,
  type BasicLandCounts,
} from '@shared/cards/deck-builder'
import type { DraftCard } from '@shared/api/contracts'
import { cx } from '@shared/react/cx'
import styles from './DeckEditorColumns.module.css'

import type { LibraryCard } from './deck-value'

export function DeckEditorColumns({
  cmcGroups,
  mainboard,
  landCounts,
  onRemoveCard,
  onIncrementLand,
  onDecrementLand,
  onCardHover,
  onCardLeave,
}: {
  cmcGroups: CmcBucket[]
  mainboard: LibraryCard[]
  landCounts: BasicLandCounts
  onRemoveCard: (grpId: number) => void
  onIncrementLand: (land: LandName) => void
  onDecrementLand: (land: LandName) => void
  onCardHover: (card: DraftCard, y: number) => void
  onCardLeave: () => void
}) {
  return (
    <div className={styles.deckContents}>
      <div className={styles.cmcColumns}>
        {cmcGroups.map((group) => (
          <div key={group.key} className={styles.cmcCol}>
            <div className={styles.colLabel}>
              <span className={styles.colLabelText}>{group.label}</span>
              <span className={styles.colLabelCount}>{group.cards.length}</span>
            </div>
            <div className={styles.cardStack}>
              {group.cards.map((card) => {
                const entry = mainboard.find((c) => c.grpId === card.grpId)
                if (!entry) {
                  return null
                }
                const quantity = mainboard
                  .filter((card) => card.name === entry.name)
                  .reduce((sum, card) => sum + card.quantity, 0)
                const warn = quantityWarning(quantity, entry.name)
                return (
                  <button
                    key={card.grpId}
                    className={cx(styles.cardEntry, warn && styles.warn)}
                    type="button"
                    onClick={() => onRemoveCard(entry.grpId)}
                    onMouseEnter={(e) =>
                      onCardHover(card, e.currentTarget.getBoundingClientRect().top)
                    }
                    onMouseLeave={onCardLeave}
                  >
                    <span className={styles.entryName}>{card.name}</span>
                    <span className={styles.entryMana}>
                      {parseManaSymbols(card.manaCost ?? '').map((sym, i) => (
                        <i key={i} className={sym.classes} title={sym.label} />
                      ))}
                    </span>
                    {entry.quantity > 1 && (
                      <span className={cx(styles.entryQty, warn && styles.warn)}>
                        x{entry.quantity}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.landControls}>
        {LAND_COLORS.map((land) => (
          <div key={land} className={cx(styles.landPill, landCounts[land] === 0 && styles.empty)}>
            <span className={styles.landPip}>
              {parseManaSymbols(`{${LAND_PIPS[land]}}`).map((sym, i) => (
                <i key={i} className={sym.classes} title={sym.label} />
              ))}
            </span>
            <span className={styles.landX}>{landCounts[land]}</span>
            <button
              className={styles.landAdj}
              type="button"
              aria-label={`Remove ${land}`}
              onClick={() => onDecrementLand(land)}
              disabled={landCounts[land] === 0}
            >
              −
            </button>
            <button
              className={styles.landAdj}
              type="button"
              aria-label={`Add ${land}`}
              onClick={() => onIncrementLand(land)}
            >
              +
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
