/**
 * Picked cards grouped by color with hover inspection callbacks.
 */

import type { DraftCard } from '@shared/api/contracts'
import { parseManaSymbols } from '@shared/cards/mana'
import styles from './DraftPoolSidebar.module.css'

const COLOR_LABELS: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  M: 'Multi',
  C: 'Colorless',
  L: 'Land',
}

function groupByColor(pool: DraftCard[]): Record<string, DraftCard[]> {
  const groups: Record<string, DraftCard[]> = {
    W: [],
    U: [],
    B: [],
    R: [],
    G: [],
    M: [],
    C: [],
    L: [],
  }
  for (const card of pool) {
    if (card.typeLine?.toLowerCase().includes('land')) {
      groups['L']!.push(card)
    } else if ((card.colors?.length ?? 0) > 1) {
      groups['M']!.push(card)
    } else if (card.colors?.length === 1) {
      const c = card.colors[0]!
      if (groups[c]) {
        groups[c]!.push(card)
      } else {
        groups['C']!.push(card)
      }
    } else {
      groups['C']!.push(card)
    }
  }
  return groups
}

export function DraftPoolSidebar({
  pool,
  onCardHover,
  onCardLeave,
}: {
  pool: DraftCard[]
  onCardHover: (card: DraftCard, y: number) => void
  onCardLeave: () => void
}) {
  const poolByColor = groupByColor(pool)

  return (
    <aside className={styles.poolSidebar} aria-label="Draft pool">
      <div className={styles.poolHeader}>
        <span className={styles.poolTitle}>Pool</span>
        <span className={styles.poolCount}>{pool.length} cards</span>
      </div>
      <div className={styles.poolGroups} role="list">
        {Object.entries(poolByColor).map(
          ([color, cards]) =>
            cards.length > 0 && (
              <div key={color} className={styles.poolGroup}>
                <div className={styles.poolGroupHeader}>
                  <span className={styles.poolColorLabel}>{COLOR_LABELS[color] ?? color}</span>
                  <span className={styles.poolGroupCount}>{cards.length}</span>
                </div>
                {cards.map((card, i) => (
                  <div
                    key={card.name + i}
                    className={styles.poolCard}
                    role="listitem"
                    onMouseEnter={(e) =>
                      onCardHover(card, e.currentTarget.getBoundingClientRect().top)
                    }
                    onMouseLeave={onCardLeave}
                  >
                    <span className={styles.poolCardMana}>
                      {parseManaSymbols(card.manaCost ?? '').map((sym, j) => (
                        <i key={j} className={sym.classes} title={sym.label} />
                      ))}
                    </span>
                    <span className={styles.poolCardName}>{card.name}</span>
                  </div>
                ))}
              </div>
            ),
        )}
      </div>
    </aside>
  )
}
