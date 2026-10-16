import { useEffect, useRef } from 'react'
import type { CardView } from '@engine/state/gre-state'
import { Card } from './Card'
import styles from './ZoneViewer.module.css'

export function ZoneViewer({
  zone,
  onClose,
  onHover,
}: {
  zone: { title: string; cards: CardView[] }
  onClose: () => void
  onHover: (card: CardView | null) => void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => {
      previous?.focus()
    }
  }, [])
  return (
    <section
      className={styles.zoneViewer}
      role="dialog"
      aria-label={`${zone.title} — ${zone.cards.length}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onHover(null)
          onClose()
        }
      }}
    >
      <header className={styles.zoneHead}>
        <div>
          <h2>{zone.title}</h2>
          <span>{zone.cards.length} cards</span>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={() => {
            onHover(null)
            onClose()
          }}
          aria-label={`Close ${zone.title}`}
        >
          Close
        </button>
      </header>
      <div className={styles.zonePanel}>
        {zone.cards.length > 0 ? (
          <div className={styles.zoneGrid}>
            {zone.cards.map((card) => (
              <Card key={card.instanceId} card={card} variant="preview" onHover={onHover} />
            ))}
          </div>
        ) : (
          <p className={styles.empty}>This zone is empty.</p>
        )}
      </div>
    </section>
  )
}
