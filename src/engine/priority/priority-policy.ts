import { asArray, asNumber, isRecord } from '@engine/state/gre-state'
import type { ProtoObject } from '@engine/wire/gre-proto'

export type StepKey = string
export type StopScope = 'self' | 'opponent'

export const STOP_TYPES: Record<string, string> = {
  upkeep: 'UpkeepStep',
  draw: 'DrawStep',
  main1: 'PrecombatMainPhase',
  begincombat: 'BeginCombatStep',
  declareattack: 'DeclareAttackersStep',
  declareblock: 'DeclareBlockersStep',
  firststrike: 'FirstStrikeDamageStep',
  combatdamage: 'CombatDamageStep',
  endcombat: 'EndCombatStep',
  main2: 'PostcombatMainPhase',
  end: 'EndStep_ad1f',
}

// StopType values are protocol identities, independent of presentation order.
const STOP_KEYS: Record<number, string> = {
  1: 'upkeep',
  2: 'draw',
  3: 'main1',
  4: 'begincombat',
  5: 'declareattack',
  6: 'declareblock',
  7: 'combatdamage',
  8: 'endcombat',
  9: 'main2',
  10: 'end',
  11: 'firststrike',
}

export function stepKey(phaseName: string, stepName: string): StepKey {
  return (stepName && stepName !== '-' ? stepName : phaseName).trim().toLowerCase()
}

/** Only explicit transient stops are highlighted as player commitments. */
export function stopsOf(settings: ProtoObject): Set<StepKey> {
  const stops = new Set<StepKey>()
  for (const raw of asArray(settings['transientStops'])) {
    if (!isRecord(raw) || asNumber(raw['status']) !== 1) {
      continue
    }
    const key = STOP_KEYS[asNumber(raw['stopType'])]
    if (!key) {
      continue
    }
    const scope = asNumber(raw['appliesTo'])
    if (scope === 1 || scope === 3) {
      stops.add(`self:${key}`)
    }
    if (scope === 1 || scope === 2) {
      stops.add(`opponent:${key}`)
    }
  }
  return stops
}

export function fullControlOf(settings: ProtoObject): boolean {
  return asNumber(settings['autoPassOption']) === 7
}

export function yieldingOf(settings: ProtoObject): boolean {
  return (
    [1, 2, 3, 5, 9].includes(asNumber(settings['autoPassOption'])) ||
    asNumber(settings['stackAutoPassOption']) === 9
  )
}
