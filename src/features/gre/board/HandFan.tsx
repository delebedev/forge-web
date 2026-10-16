import type { CSSProperties } from 'react'
import type { CardView, LegalAction } from '@engine/state/gre-state'
import type { PresentationMotionKind } from '@engine/state/presentation-policy'
import { cx } from '@shared/react/cx'
import { Card } from './Card'
import styles from './HandFan.module.css'

export function HandFan({
  cards,
  interactive,
  gameOver,
  compact = false,
  actionChrome = true,
  actions,
  onCardAction,
  onHover,
  onDragStart,
  motionFor,
}: {
  cards: CardView[]
  interactive: boolean
  gameOver: boolean
  compact?: boolean
  actionChrome?: boolean
  actions: LegalAction[]
  onCardAction: (card: CardView) => void
  onHover?: (card: CardView | null) => void
  onDragStart?: (card: CardView, action: LegalAction, event: React.PointerEvent) => void
  motionFor?: (instanceId: number) => PresentationMotionKind | undefined
}) {
  /** Gated here rather than on the card, which stays hoverable for its preview. */
  function actionsFor(card: CardView): LegalAction[] {
    return actions.filter((action) => action.instanceId === card.instanceId)
  }

  return (
    <section
      className={cx(styles.hand, compact && styles.compact)}
      data-zone="hand"
      data-owner="self"
      aria-label={`Your hand: ${cards.length} cards`}
      style={{ '--hand-count': Math.max(cards.length, 1) } as CSSProperties}
    >
      <div className={cx(styles.cards, styles.handCards)}>
        {cards.map((card, index) => {
          const cardActions = actionsFor(card)
          const actionable = interactive && !gameOver && cardActions.length > 0
          return (
            <Card
              key={card.instanceId}
              card={card}
              variant="hand"
              index={index}
              count={cards.length}
              compact={compact}
              actionChrome={actionChrome}
              actions={cardActions}
              ariaLabel={
                cardActions.length === 1
                  ? cardActions[0]!.label
                  : cardActions.length > 1
                    ? `Choose an action for ${card.name}`
                    : undefined
              }
              disabled={!interactive || gameOver}
              onClick={() => {
                if (actionable) {
                  onCardAction(card)
                }
              }}
              onPointerDown={(clicked, event) => {
                if (actionable && cardActions.length === 1) {
                  onDragStart?.(clicked, cardActions[0]!, event)
                }
              }}
              onHover={onHover}
              motion={motionFor?.(card.instanceId)}
            />
          )
        })}
      </div>
    </section>
  )
}
