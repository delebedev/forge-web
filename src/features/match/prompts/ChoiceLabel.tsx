import type { ReactNode } from 'react'
import type { CardView } from '@engine/state/gre-state'
import { artCropUrl } from '@shared/cards/scryfall'
import styles from './PromptDock.module.css'

export function ChoiceLabel({
  children,
  card,
  selected = false,
  unavailable = false,
}: {
  children: ReactNode
  card?: CardView
  selected?: boolean
  unavailable?: boolean
}) {
  return (
    <>
      {card?.imageUrl && (
        <img className={styles.choiceArt} src={artCropUrl(card.imageUrl)} alt="" />
      )}
      <span>{children}</span>
      {unavailable && <small className={styles.choiceState}>Unavailable</small>}
      {selected && (
        <small className={styles.choiceState} aria-hidden="true">
          ✓
        </small>
      )}
    </>
  )
}
