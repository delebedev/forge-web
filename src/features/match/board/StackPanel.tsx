import {
  GAME_OBJECT_TYPE_ABILITY,
  GAME_OBJECT_TYPE_EMBLEM,
  GAME_OBJECT_TYPE_TRIGGER_HOLDER,
  type CardView,
} from '@engine/state/gre-state'
import type { BoardArrow } from '@engine/state/arrow-view'
import type { PresentationMotionKind } from '@engine/state/presentation-policy'
import { cx } from '@shared/react/cx'
import { artCropUrl } from '@shared/cards/scryfall'
import { Card } from '../../../shared/cards/Card'
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

/**
 * Names the confirmed targets of each stack entry from its TargetSpec arrows,
 * in target-group order. Players read from the viewer's side.
 */
export function stackTargetNames(
  arrows: BoardArrow[],
  cards: CardView[],
  replay = false,
): Map<number, string[]> {
  const names = new Map(cards.map((card) => [String(card.instanceId), card.name]))
  const byEntry = new Map<number, string[]>()
  for (const arrow of arrows) {
    if (arrow.kind !== 'targetSpec') {
      continue
    }
    const name =
      arrow.to === 'self'
        ? replay
          ? 'Near side'
          : 'You'
        : arrow.to === 'opponent'
          ? replay
            ? 'Far side'
            : 'Opponent'
          : names.get(arrow.to) || 'Hidden card'
    const entryId = Number(arrow.from)
    byEntry.set(entryId, [...(byEntry.get(entryId) ?? []), name])
  }
  return byEntry
}

function StackTargets({ names = [] }: { names?: string[] }) {
  if (names.length === 0) {
    return null
  }
  return (
    <p className={styles.targets} data-stack-targets>
      <span>{names.length === 1 ? 'Target' : 'Targets'}</span> {names.join(', ')}
    </p>
  )
}

export function StackPanel({
  cards,
  compact = false,
  canRespond = false,
  viewerSeatId = 0,
  replay = false,
  onHover,
  motionFor,
  targetsFor,
}: {
  cards: CardView[]
  compact?: boolean
  canRespond?: boolean
  viewerSeatId?: number
  replay?: boolean
  onHover?: (card: CardView | null) => void
  motionFor?: (instanceId: number) => PresentationMotionKind | undefined
  /** Confirmed target names of a stack entry, in group order. */
  targetsFor?: (instanceId: number) => string[] | undefined
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
              <StackTargets names={targetsFor?.(card.instanceId)} />
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
