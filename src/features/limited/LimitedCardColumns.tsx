import type { CmcBucket, IndexedCard } from '@shared/cards/deck-builder'
import { handleImageError, scryfallUrl } from '@shared/cards/scryfall'
import styles from './LimitedCardColumns.module.css'

export function LimitedCardThumbnail({
  name,
  imageUrl,
  count,
  onClick,
  onHover,
  onLeave,
}: {
  name: string
  imageUrl: string
  count?: number
  onClick: () => void
  onHover?: (x: number, y: number) => void
  onLeave?: () => void
}) {
  return (
    <button
      className={styles.cardThumb}
      type="button"
      onClick={onClick}
      onMouseEnter={(event) => onHover?.(event.clientX, event.clientY)}
      onMouseLeave={onLeave}
      data-card={name}
    >
      <img
        src={imageUrl}
        alt={name}
        className={styles.thumbImg}
        loading="lazy"
        decoding="async"
        onError={(event) => handleImageError(event.nativeEvent)}
      />
      {count != null && count > 1 && <span className={styles.countBadge}>×{count}</span>}
    </button>
  )
}

/** Shared CMC columns used by both halves of the limited deck builder. */
export function LimitedCardColumns({
  groups,
  onCardClick,
  onCardHover,
  onCardLeave,
}: {
  groups: CmcBucket[]
  onCardClick: (card: IndexedCard) => void
  onCardHover: (card: IndexedCard, x: number, y: number) => void
  onCardLeave: () => void
}) {
  return groups.map((group) => (
    <div key={group.key} className={styles.cmcCol}>
      <div className={styles.colLabel}>
        <span className={styles.colLabelText}>{group.label}</span>
        <span className={styles.colLabelCount}>{group.cards.length}</span>
      </div>
      <div className={styles.cardStack}>
        {group.cards.map((card) => (
          <LimitedCardThumbnail
            key={card.poolIndex}
            name={card.name}
            imageUrl={scryfallUrl(card)}
            onClick={() => onCardClick(card)}
            onHover={(x, y) => onCardHover(card, x, y)}
            onLeave={onCardLeave}
          />
        ))}
      </div>
    </div>
  ))
}
