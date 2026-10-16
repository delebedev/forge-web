/**
 * `DeckEditor`'s right pane: card search input and results. Split out of
 * `DeckEditor.tsx` to keep both files under the file-size budget.
 */

import { parseManaSymbols } from '@shared/cards/mana'
import type { DraftCard } from '@shared/api/contracts'
import { TextField } from '@shared/ui/Field'
import styles from './DeckEditorSearchPanel.module.css'

export function DeckEditorSearchPanel({
  searchQuery,
  searchResults,
  searching,
  onSearchInput,
  onAddCard,
  onCardHover,
  onCardLeave,
}: {
  searchQuery: string
  searchResults: DraftCard[]
  searching: boolean
  onSearchInput: (value: string) => void
  onAddCard: (card: DraftCard) => void
  onCardHover: (card: DraftCard, y: number) => void
  onCardLeave: () => void
}) {
  return (
    <div className={styles.searchPanel}>
      <h2 className={styles.searchTitle}>Add cards</h2>
      <p className={styles.searchHint}>Search by name, then select a card to add it.</p>
      <TextField
        type="text"
        placeholder="Search cards..."
        aria-label="Search cards"
        value={searchQuery}
        onChange={(e) => onSearchInput(e.currentTarget.value)}
      />
      <div className={styles.searchResults}>
        {searching ? (
          <div className={styles.searchLoading}>Searching...</div>
        ) : searchResults.length > 0 ? (
          searchResults.map((card) => (
            <button
              key={card.name}
              className={styles.searchResult}
              type="button"
              onClick={() => onAddCard(card)}
              onMouseEnter={(e) => onCardHover(card, e.currentTarget.getBoundingClientRect().top)}
              onMouseLeave={onCardLeave}
            >
              <span className={styles.resultName}>{card.name}</span>
              <span className={styles.resultMana}>
                {parseManaSymbols(card.manaCost ?? '').map((sym, i) => (
                  <i key={i} className={sym.classes} title={sym.label} />
                ))}
              </span>
              <span className={styles.resultType}>{card.typeLine ?? ''}</span>
            </button>
          ))
        ) : searchQuery.length >= 2 ? (
          <div className={styles.searchEmpty}>No results</div>
        ) : null}
      </div>
    </div>
  )
}
