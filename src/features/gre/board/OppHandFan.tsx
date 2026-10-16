import type { CSSProperties } from 'react'
import type { CardView } from '@engine/state/gre-state'
import { Card } from './Card'
import styles from './OppHandFan.module.css'

/** Known faces share the hand count with concealed slots and remain inspection-only. */
export function OppHandFan({
  count = 0,
  known = [],
  onHover,
  onInspect,
}: {
  count?: number
  known?: CardView[]
  onHover?: (card: CardView | null) => void
  onInspect?: () => void
}) {
  if (count <= 0) {
    return null
  }
  const faces = known.slice(0, count)
  const concealed = Math.max(0, count - faces.length)
  const shown = Math.min(concealed, 10)

  const cards = Array.from({ length: shown }, (_, i) => {
    const spread = i - (shown - 1) / 2
    return { i, spread, lift: Math.abs(spread) }
  })

  const contents = (
    <>
      {faces.map((card) => (
        <div key={card.instanceId} className={styles.known}>
          <Card
            card={card}
            variant="opponent"
            actionChrome={false}
            onHover={onHover}
            onClick={onInspect}
            ariaLabel={`Inspect ${card.name} in opponent's hand`}
          />
        </div>
      ))}
      {cards.map((card) => (
        <div
          key={card.i}
          className={styles.back}
          style={{ '--spread': card.spread, '--lift': card.lift } as CSSProperties}
        />
      ))}
    </>
  )

  return (
    <div
      className={`${styles.oppHandFan} ${faces.length ? styles.revealed : ''}`}
      data-zone="hand"
      data-owner="opponent"
      data-zone-count={count}
      role="region"
      aria-label={`Opponent hand: ${count} cards`}
    >
      {faces.length > 0 ? <div className={styles.knownCards}>{contents}</div> : contents}
      {faces.length > 0 && (
        <span className={styles.summary}>
          {faces.length} known · {concealed} concealed
        </span>
      )}
    </div>
  )
}
