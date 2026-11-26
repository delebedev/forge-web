import { cx } from '@shared/react/cx'
import styles from './PhaseRail.module.css'

const PHASES = [
  {
    name: 'Beginning',
    phases: ['Beginning', 'Untap', 'Upkeep', 'Draw'],
    steps: [
      ['upkeep', 'Upkeep'],
      ['draw', 'Draw'],
    ],
  },
  { name: 'Main 1', phases: ['Main1'], steps: [['main1', 'Main 1']] },
  {
    name: 'Combat',
    phases: ['Combat'],
    steps: [
      ['begincombat', 'Beginning'],
      ['declareattack', 'Attackers'],
      ['declareblock', 'Blockers'],
      ['firststrike', 'First strike damage'],
      ['combatdamage', 'Damage'],
      ['endcombat', 'End of combat'],
    ],
  },
  { name: 'Main 2', phases: ['Main2'], steps: [['main2', 'Main 2']] },
  { name: 'Ending', phases: ['End', 'Ending'], steps: [['end', 'End step']] },
]

/** Five turn phases, with exact stops scoped to either player's next occurrence. */
export function PhaseRail({
  seat,
  taking,
  phaseName,
  stepName,
  stops,
  interactive,
  onToggleStop,
}: {
  seat: 'self' | 'opponent'
  taking: boolean
  phaseName: string
  stepName: string
  stops: Set<string>
  interactive: boolean
  onToggleStop: (key: string) => void
}) {
  return (
    <nav
      className={styles.phaseRail}
      data-seat={seat}
      data-taking={taking}
      aria-label="Turn phases"
    >
      {PHASES.map((phase) => {
        const active =
          taking && (phase.phases.includes(phaseName) || phase.phases.includes(stepName))
        const hasStop = phase.steps.some(
          ([key]) => stops.has(`self:${key}`) || stops.has(`opponent:${key}`),
        )
        return interactive ? (
          <details key={phase.name} className={styles.phase} name="phase-stops">
            <summary
              className={cx(active && styles.active, hasStop && styles.stop)}
              aria-current={active ? 'step' : undefined}
              title={`Set stops in ${phase.name}`}
            >
              {phase.name}
            </summary>
            <div className={styles.stopMenu}>
              <strong>{phase.name} stops</strong>
              <span className={styles.hint}>Pause at the next selected step.</span>
              <div className={styles.stopGrid}>
                <span /> <span>Your turn</span> <span>Opponent</span>
                {phase.steps.map(([key, label]) => (
                  <div className={styles.stopRow} key={key}>
                    <span>{label}</span>
                    {(['self', 'opponent'] as const).map((scope) => (
                      <button
                        key={scope}
                        type="button"
                        aria-label={`${scope === 'self' ? 'Your' : 'Opponent'} ${label} stop`}
                        aria-pressed={stops.has(`${scope}:${key}`)}
                        onClick={() => onToggleStop(`${scope}:${key}`)}
                      >
                        {stops.has(`${scope}:${key}`) ? 'On' : 'Off'}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </details>
        ) : (
          <span
            key={phase.name}
            className={cx(styles.readOnly, active && styles.active)}
            aria-current={active ? 'step' : undefined}
          >
            {phase.name}
          </span>
        )
      })}
    </nav>
  )
}
