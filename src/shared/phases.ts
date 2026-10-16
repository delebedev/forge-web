export const PHASES = [
  'UP',
  'DR',
  'M1',
  'BC',
  'DA',
  'DB',
  'FS',
  'CD',
  'EC',
  'M2',
  'ET',
  'CL',
] as const

export const PHASE_MAP: Record<string, string> = {
  UNTAP: 'UP',
  UPKEEP: 'UP',
  DRAW: 'DR',
  MAIN1: 'M1',
  COMBAT_BEGIN: 'BC',
  COMBAT_DECLARE_ATTACKERS: 'DA',
  COMBAT_DECLARE_BLOCKERS: 'DB',
  COMBAT_FIRST_STRIKE_DAMAGE: 'FS',
  COMBAT_DAMAGE: 'CD',
  COMBAT_END: 'EC',
  BEGIN_COMBAT: 'BC',
  DECLARE_ATTACKERS: 'DA',
  DECLARE_BLOCKERS: 'DB',
  FIRST_STRIKE: 'FS',
  END_COMBAT: 'EC',
  MAIN2: 'M2',
  END_OF_TURN: 'ET',
  END: 'ET',
  END_TURN: 'ET',
  CLEANUP: 'CL',
}

export const PHASE_REVERSE_MAP: Record<string, string> = {
  UP: 'UPKEEP',
  DR: 'DRAW',
  M1: 'MAIN1',
  BC: 'COMBAT_BEGIN',
  DA: 'COMBAT_DECLARE_ATTACKERS',
  DB: 'COMBAT_DECLARE_BLOCKERS',
  FS: 'COMBAT_FIRST_STRIKE_DAMAGE',
  CD: 'COMBAT_DAMAGE',
  EC: 'COMBAT_END',
  M2: 'MAIN2',
  ET: 'END_OF_TURN',
  CL: 'CLEANUP',
}

/** Human-readable phase labels for display. */
export const PHASE_LABELS: Record<string, string> = {
  UNTAP: 'Untap',
  UPKEEP: 'Upkeep',
  DRAW: 'Draw',
  MAIN1: 'Main 1',
  COMBAT_BEGIN: 'Begin Combat',
  COMBAT_DECLARE_ATTACKERS: 'Declare Attackers',
  COMBAT_DECLARE_BLOCKERS: 'Declare Blockers',
  COMBAT_FIRST_STRIKE_DAMAGE: 'First Strike',
  COMBAT_DAMAGE: 'Combat Damage',
  COMBAT_END: 'End Combat',
  BEGIN_COMBAT: 'Begin Combat',
  DECLARE_ATTACKERS: 'Declare Attackers',
  DECLARE_BLOCKERS: 'Declare Blockers',
  FIRST_STRIKE: 'First Strike',
  END_COMBAT: 'End Combat',
  MAIN2: 'Main 2',
  END_OF_TURN: 'End Step',
  END: 'End Step',
  END_TURN: 'End Step',
  CLEANUP: 'Cleanup',
}

export function isDeclareAttackersPhase(phase: string | undefined | null): boolean {
  if (!phase) {
    return false
  }
  return phase === 'COMBAT_DECLARE_ATTACKERS' || phase === 'DECLARE_ATTACKERS'
}

export function isDeclareBlockersPhase(phase: string | undefined | null): boolean {
  if (!phase) {
    return false
  }
  return phase === 'COMBAT_DECLARE_BLOCKERS' || phase === 'DECLARE_BLOCKERS'
}
