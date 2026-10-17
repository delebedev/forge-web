/** The selected deck section, card movement, and basic-land controls. */

import { parseManaSymbols } from '@shared/cards/mana'
import {
  LAND_COLORS,
  LAND_PIPS,
  type CmcBucket,
  type LandName,
  type BasicLandCounts,
} from '@shared/cards/deck-builder'
import type { DraftCard } from '@shared/api/contracts'
import { cx } from '@shared/react/cx'
import styles from './DeckEditorColumns.module.css'

import type { LibraryCard } from './deck-value'
import type { EditableSection } from './deck-editing'
import { Button } from '@shared/ui/Button'

export function DeckEditorColumns({
  cmcGroups,
  mainboard,
  section,
  mainCount,
  sideCount,
  onSectionChange,
  onMoveCard,
  landCounts,
  onRemoveCard,
  onIncrementLand,
  onDecrementLand,
  onCardHover,
  onCardLeave,
}: {
  cmcGroups: CmcBucket[]
  mainboard: LibraryCard[]
  section: EditableSection
  mainCount: number
  sideCount: number
  onSectionChange: (section: EditableSection) => void
  onMoveCard: (grpId: number) => void
  landCounts: BasicLandCounts
  onRemoveCard: (grpId: number) => void
  onIncrementLand: (land: LandName) => void
  onDecrementLand: (land: LandName) => void
  onCardHover: (card: DraftCard, y: number) => void
  onCardLeave: () => void
}) {
  return (
    <div className={styles.deckContents}>
      <div className={styles.sectionTabs} role="group" aria-label="Deck section">
        <Button
          size="compact"
          variant={section === 'mainboard' ? 'primary' : 'secondary'}
          aria-pressed={section === 'mainboard'}
          onClick={() => onSectionChange('mainboard')}
        >
          Main deck ({mainCount})
        </Button>
        <Button
          size="compact"
          variant={section === 'sideboard' ? 'primary' : 'secondary'}
          aria-pressed={section === 'sideboard'}
          onClick={() => onSectionChange('sideboard')}
        >
          Sideboard ({sideCount})
        </Button>
      </div>
      {section === 'sideboard' && (
        <p className={styles.sectionNote}>
          Sideboard cards are saved with your deck. Games start with the main deck.
        </p>
      )}
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
                return (
                  <div key={card.grpId} className={styles.cardRow}>
                    <button
                      className={styles.cardEntry}
                      type="button"
                      aria-label={`Remove one ${entry.name}`}
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
                      <span className={styles.entryQty}>x{entry.quantity}</span>
                    </button>
                    <Button
                      size="compact"
                      variant="secondary"
                      aria-label={`Move one ${entry.name} to ${section === 'mainboard' ? 'sideboard' : 'main deck'}`}
                      onClick={() => onMoveCard(entry.grpId)}
                    >
                      → {section === 'mainboard' ? 'Sideboard' : 'Main'}
                    </Button>
                  </div>
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
