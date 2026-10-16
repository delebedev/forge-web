import type { ReactNode } from 'react'
import type { DeckSummary } from '@shared/api/contracts'
import { cx } from '@shared/react/cx'
import { scryfallUrl, artCropUrl } from '@shared/cards/scryfall'
import { TextField } from '@shared/ui/Field'
import styles from './DeckList.module.css'

const COLORS = ['W', 'U', 'B', 'R', 'G'] as const
const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
}

export function DeckList({
  decks,
  selectedDeckId = null,
  loading = false,
  searchQuery = '',
  colorFilter = new Set<string>(),
  onSearch,
  onToggleColor,
  onSelect,
  headerActions,
}: {
  decks: DeckSummary[]
  selectedDeckId?: string | null
  loading?: boolean
  searchQuery?: string
  colorFilter?: Set<string>
  onSearch?: (q: string) => void
  onToggleColor?: (c: string) => void
  onSelect?: (deck: DeckSummary) => void
  headerActions?: ReactNode
}) {
  return (
    <div className={styles.listPanel}>
      <div className={styles.listHeader}>
        <h1 className={styles.listTitle}>Deck library</h1>
        <TextField
          type="text"
          placeholder="Search decks..."
          aria-label="Search decks"
          value={searchQuery}
          onChange={(e) => onSearch?.(e.currentTarget.value)}
        />
        <div className={styles.colorFilters}>
          {COLORS.map((color) => (
            <button
              key={color}
              className={cx(styles.colorChip, colorFilter.has(color) && styles.active)}
              type="button"
              title={COLOR_NAMES[color]}
              aria-pressed={colorFilter.has(color)}
              onClick={() => onToggleColor?.(color)}
            >
              <i
                className={`ms ms-cost ms-${color.toLowerCase()}`}
                aria-label={COLOR_NAMES[color]}
              />
            </button>
          ))}
        </div>
        <div className={styles.listCountRow}>
          <span className={styles.listCount}>{decks.length} decks</span>
          {headerActions}
        </div>
      </div>

      <div className={styles.deckList}>
        {!loading && decks.length === 0 && <p className={styles.emptyList}>No decks found.</p>}
        {loading ? (
          <div className={styles.listLoading}>
            <div className={styles.spinner} />
            <span>Loading decks...</span>
          </div>
        ) : (
          decks.map((deck) => (
            <button
              key={deck.id}
              className={cx(styles.deckRow, selectedDeckId === deck.id && styles.selected)}
              type="button"
              data-deck-id={deck.id}
              aria-label={`${deck.name} ${deck.cardCount} cards`}
              aria-describedby={deck.colors.length ? `deck-colors-${deck.id}` : undefined}
              aria-pressed={selectedDeckId === deck.id}
              onClick={() => onSelect?.(deck)}
            >
              {deck.coverName && (
                <img
                  className={styles.deckArt}
                  src={artCropUrl(scryfallUrl({ name: deck.coverName }))}
                  alt=""
                />
              )}
              <div className={styles.deckRowBody}>
                <div className={styles.deckRowMain}>
                  <span className={styles.deckRowName}>{deck.name}</span>
                  <span
                    className={styles.deckRowColors}
                    id={`deck-colors-${deck.id}`}
                    role="img"
                    aria-label={`Colors: ${deck.colors.map((color) => COLOR_NAMES[color] ?? color).join(', ')}`}
                  >
                    {deck.colors.map((c, i) => (
                      <i
                        aria-hidden="true"
                        key={i}
                        className={`ms ms-cost ms-${c.toLowerCase()}`}
                        title={COLOR_NAMES[c]}
                      />
                    ))}
                  </span>
                </div>
                <div className={styles.deckRowMeta}>
                  <span className={styles.deckRowCount}>{deck.cardCount} cards</span>
                  {deck.set && <span className={styles.deckRowSet}>{deck.set}</span>}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
