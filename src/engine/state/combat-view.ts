import type { CardView } from './gre-state'

export type CombatGroup = {
  attacker: CardView
  blockers: CardView[]
}

/** Only confirmed assignments between permanents in the displayed battlefield. */
export function combatGroups(cards: CardView[]): CombatGroup[] {
  return cards
    .filter((card) => card.attacking && card.blocked !== undefined && !card.phasedOut)
    .map((attacker) => ({
      attacker,
      blockers: cards.filter(
        (card) => !card.phasedOut && card.blocking?.includes(attacker.instanceId),
      ),
    }))
}
