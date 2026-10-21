import type { CombatGroup } from '@engine/state/combat-view'
import type { CardView } from '@engine/state/gre-state'
import styles from './CombatSummary.module.css'

function combatName(card: CardView): string {
  return card.faceDown ? 'Face-down creature' : card.name
}

export function CombatSummary({ groups }: { groups: CombatGroup[] }) {
  if (groups.length === 0) {
    return null
  }

  return (
    <section className={styles.summary} aria-label="Combat assignments">
      <h2>Combat assignments</h2>
      <ul>
        {groups.map(({ attacker, blockers }) => (
          <li key={attacker.instanceId}>
            <strong>{combatName(attacker)}</strong>
            <span>
              {blockers.length > 0
                ? `Blocked by ${blockers.map(combatName).join(', ')}`
                : attacker.blocked
                  ? 'Blocked · no remaining blockers'
                  : 'Unblocked'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
