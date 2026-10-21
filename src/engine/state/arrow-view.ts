import type { CombatGroup } from './combat-view'

export type BoardArrow = {
  id: string
  kind: 'combat' | 'targetSpec'
  from: string
  to: string
}

export function computeArrows(
  promptKind: string | undefined,
  declaredAttackers: Set<number>,
  blockAssignments: { blocker: number; attacker: number }[],
  confirmed: CombatGroup[] = [],
): BoardArrow[] {
  if (promptKind === 'attackers') {
    return [...declaredAttackers].map((iid) => ({
      id: `combat-attack-${iid}`,
      kind: 'combat',
      from: String(iid),
      to: 'opponent',
    }))
  }
  if (promptKind === 'blockers') {
    return blockAssignments.map((b) => ({
      id: `combat-block-${b.blocker}-${b.attacker}`,
      kind: 'combat',
      from: String(b.blocker),
      to: String(b.attacker),
    }))
  }
  return confirmed.flatMap(({ attacker, blockers }) =>
    blockers.map((blocker) => ({
      id: `combat-block-${blocker.instanceId}-${attacker.instanceId}`,
      kind: 'combat' as const,
      from: String(blocker.instanceId),
      to: String(attacker.instanceId),
    })),
  )
}
