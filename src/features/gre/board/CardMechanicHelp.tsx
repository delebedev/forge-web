import type { MechanicHelp } from '@engine/state/gre-state'
import { keywordIcons, parseManaSymbols } from '@shared/cards/mana'
import styles from './CardMechanicHelp.module.css'

export function keyedMechanicHelp(items: MechanicHelp[]) {
  const occurrences = new Map<string, number>()
  return items.map((item) => {
    const content = JSON.stringify([item.keyword, item.title, item.cost ?? '', item.description])
    const occurrence = occurrences.get(content) ?? 0
    occurrences.set(content, occurrence + 1)
    // Metadata has no row id; only equal-content occurrences are interchangeable.
    return { item, key: JSON.stringify([content, occurrence]) }
  })
}

export function CardMechanicHelp({ items }: { items: MechanicHelp[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <aside className={styles.panel} aria-label="Card mechanics">
      {keyedMechanicHelp(items).map(({ item, key }) => {
        const icon = keywordIcons([{ keyword: item.keyword, text: item.title }])[0]
        const cost = parseManaSymbols(item.cost ?? '')

        return (
          <section className={styles.mechanic} key={key}>
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
