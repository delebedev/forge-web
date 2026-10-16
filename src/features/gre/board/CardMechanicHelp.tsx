import type { MechanicHelp } from '@engine/state/gre-state'
import { keywordIcons, parseManaSymbols } from '@shared/cards/mana'
import styles from './CardMechanicHelp.module.css'

export function CardMechanicHelp({ items }: { items: MechanicHelp[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <aside className={styles.panel} aria-label="Card mechanics">
      {items.map((item) => {
        const icon = keywordIcons([{ keyword: item.keyword, text: item.title }])[0]
        const cost = parseManaSymbols(item.cost ?? '')

        return (
          <section className={styles.mechanic} key={`${item.keyword}:${item.title}`}>
            <h2 className={styles.title}>
              <span className={styles.icon} aria-hidden="true">
                <i className={icon?.classes ?? 'ms ms-ability-static'} />
              </span>
              <span>{item.title}</span>
              {cost.length > 0 && (
                <span
                  className={styles.cost}
                  aria-label={`Cost ${cost.map((symbol) => symbol.label).join(' ')}`}
                >
                  {cost.map((symbol, index) => (
                    <i
                      className={symbol.classes}
                      aria-hidden="true"
                      key={`${symbol.label}:${index}`}
                    />
                  ))}
                </span>
              )}
            </h2>
            <p>{item.description}</p>
          </section>
        )
      })}
    </aside>
  )
}
