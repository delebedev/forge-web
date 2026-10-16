import type { CSSProperties } from 'react'
import { Card } from './Card'
import { catalogCardView, type CatalogCard } from './catalog-card-view'
import styles from './CardHoverPreview.module.css'

type Position = 'fixed-right' | 'fixed-left' | 'follow-mouse'

export function CardHoverPreview({
  card = null,
  x = 0,
  y = 0,
  position = 'follow-mouse',
}: {
  card?: CatalogCard | null
  x?: number
  y?: number
  position?: Position
}) {
  if (!card) {
    return null
  }

  const positionStyle: CSSProperties = {
    top: `clamp(calc(var(--card-face-width-inspection) * 88 / 126 + 16px), ${y}px, calc(100dvh - var(--card-face-width-inspection) * 88 / 126 - 16px))`,
    ...(position === 'fixed-right'
      ? { right: 290 }
      : position === 'fixed-left'
        ? { left: 360 }
        : { left: x, translate: 'calc(-100% - 16px) 0' }),
  }

  return (
    <aside
      className={styles.hoverPreview}
      style={positionStyle}
      aria-label={`${card.name} inspection`}
    >
      <Card card={catalogCardView(card)} variant="preview" actionChrome={false} />
    </aside>
  )
}
