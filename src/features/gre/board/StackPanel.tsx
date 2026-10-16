import {
  GAME_OBJECT_TYPE_ABILITY,
  GAME_OBJECT_TYPE_EMBLEM,
  GAME_OBJECT_TYPE_TRIGGER_HOLDER,
  type CardView,
} from '@engine/state/gre-state'
import type { PresentationMotionKind } from '@engine/state/presentation-policy'
import { cx } from '@shared/react/cx'
import { artCropUrl } from '@shared/cards/scryfall'
import { Card } from './Card'
import styles from './StackPanel.module.css'

/** An ability without a source card remains a text entry. */
export function isRenderableStackCard(card: CardView): boolean {
  const kind = card.objectType ?? 0
  if (kind === GAME_OBJECT_TYPE_ABILITY || kind === GAME_OBJECT_TYPE_TRIGGER_HOLDER) {
    return false
  }
  if (kind > 0) {
    return true
  }
  return Boolean(card.imageUrl || card.typeLine || card.manaCost || card.powerToughness)
}

export function StackPanel({
  cards,
  compact = false,
  canRespond = false,
  viewerSeatId = 0,
  replay = false,
  onHover,
  motionFor,
}: {
  cards: CardView[]
  compact?: boolean
  canRespond?: boolean
  viewerSeatId?: number
  replay?: boolean
  onHover?: (card: CardView | null) => void
  motionFor?: (instanceId: number) => PresentationMotionKind | undefined
}) {
  const entries = cards.filter((card) => card.objectType !== GAME_OBJECT_TYPE_TRIGGER_HOLDER)
  if (entries.length === 0) {
    return null
  }
  return (
    <aside
      className={cx(styles.stackPanel, compact && styles.compact)}
      aria-label="Stack"
      data-zone="stack"
      data-owner="shared"
      data-count={entries.length}
    >
      <div className={styles.stackLabel}>
        <strong>{canRespond ? 'Your response' : 'On the stack'}</strong>
        <span>{entries.length}</span>
      </div>
      <ol className={styles.stackCards}>
        {entries.map((card, index) => (
          <li
            key={card.instanceId}
            className={cx(styles.stackSlot, index === 0 && styles.resolvesNext)}
          >
            <div className={styles.order}>{index + 1}</div>
            <div
              className={styles.entry}
              data-instance-id={card.instanceId}
              data-card={card.name}
              tabIndex={0}
              onMouseEnter={() => onHover?.(card.sourceCard ?? card)}
              onMouseLeave={() => onHover?.(null)}
              onFocus={() => onHover?.(card.sourceCard ?? card)}
              onBlur={() => onHover?.(null)}
            >
              <div className={styles.entryHead}>
                {index === 0 && (
                  <span className={styles.nextTag}>
                    {motionFor?.(card.instanceId) === 'resolve' ? 'Resolving' : 'Resolves next'}
                  </span>
                )}
                <span className={styles.ownerTag}>
                  {card.controllerSeatId === viewerSeatId
                    ? replay
                      ? 'Near side'
                      : 'Yours'
                    : replay
                      ? 'Far side'
                      : "Opponent's"}
                </span>
              </div>
              <div className={styles.entryTitle}>
                {card.imageUrl && <img src={artCropUrl(card.imageUrl)} alt="" />}
                <strong>{card.name}</strong>
              </div>
              {index === 0 && (isRenderableStackCard(card) || card.sourceCard) && (
                <div className={cx(styles.topCard, card.sourceCard && styles.sourceCard)}>
                  <Card
                    card={{ ...(card.sourceCard ?? card), tapped: false, attacking: false }}
                    variant="preview"
                    actionChrome={false}
                    motion={motionFor?.(card.instanceId)}
                  />
                </div>
              )}
              {card.objectType === GAME_OBJECT_TYPE_ABILITY && (
                <>
                  <span className={styles.ability}>
                    {card.sourceCard?.objectType === GAME_OBJECT_TYPE_EMBLEM
                      ? 'Emblem ability'
                      : 'Ability'}
                  </span>
                  {card.rulesText && <p>{card.rulesText}</p>}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </aside>
  )
}
