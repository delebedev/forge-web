import { useEffect } from 'react'
import { Modal } from '@shared/ui/Modal'
import { formatWhatsNewDate, type WhatsNewDay } from './feed'
import styles from './WhatsNewModal.module.css'

export function WhatsNewModal({
  open,
  days,
  onClose,
  onPresented,
}: {
  open: boolean
  days: WhatsNewDay[]
  onClose: () => void
  onPresented: () => void
}) {
  useEffect(() => {
    if (open) {
      onPresented()
    }
  }, [onPresented, open])

  return (
    <Modal open={open} onClose={onClose} title="What's new" maxWidth="640px">
      <section className={styles.body} aria-label="What's new updates">
        {days.length === 0 ? (
          <p className={styles.empty}>There’s nothing new right now.</p>
        ) : (
          <div className={styles.feed}>
            {days.map((day) => (
              <article className={styles.entry} key={day.date}>
                <time className={styles.date} dateTime={day.date}>
                  {formatWhatsNewDate(day.date)}
                </time>
                {day.headline && <h3>{day.headline}</h3>}
                {day.bullets.length > 0 && (
                  <ul>
                    {day.bullets.map((bullet, index) => (
                      <li key={`${day.date}-${index}`}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </Modal>
  )
}
