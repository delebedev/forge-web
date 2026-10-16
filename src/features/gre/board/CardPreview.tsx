import type { CardView } from '@engine/state/gre-state'
import { CardMechanicHelp } from './CardMechanicHelp'
import { ComposedCardBody, cardBodyFromView } from './ComposedCardBody'
import styles from './CardPreview.module.css'

export function CardPreview({
  card,
  hideCardArt = false,
}: {
  card: CardView | null
  hideCardArt?: boolean
}) {
  if (!card) {
    return null
  }
  const faceDown = card.faceDown === true
  const mechanicHelp = faceDown ? [] : (card.mechanicHelp ?? [])
  const inspectionName = faceDown ? 'Face-down card' : card.name

  return (
    <aside className={styles.inspection} aria-label={`${inspectionName} inspection`}>
      <div className={styles.cardPreview}>
        {/\bDungeon\b/i.test(card.typeLine) && card.imageUrl && !hideCardArt ? (
          <img className={styles.dungeonPreview} src={card.imageUrl} alt={card.name} />
        ) : (
          <ComposedCardBody card={cardBodyFromView(card)} />
        )}
      </div>
      <CardMechanicHelp items={mechanicHelp} />
    </aside>
  )
}
