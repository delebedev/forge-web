import type { DamagePromptView } from '@engine/state/gre-state'
import type { DamageControls } from '@engine/runtime/prompts/family'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function DamagePrompt({
  view,
  controls,
}: {
  view: DamagePromptView
  controls: DamageControls | null
}) {
  return (
    <>
      <div className={styles.promptBody}>
        <div className={styles.damageList}>
          {view.damageAssigners.map((assigner) => (
            <div
              key={assigner.instanceId}
              className={styles.damageAssigner}
              data-instance-id={assigner.instanceId}
              data-grp-id={assigner.grpId || undefined}
              data-damage-assigner-id={assigner.instanceId}
            >
              <strong>{assigner.name}</strong>{' '}
              <small>
                {assigner.assignedTotal}/{assigner.totalDamage} damage assigned
                {assigner.canIgnoreBlockers ? ' · trample' : ''}
              </small>
              {assigner.assignments.map((assignment) => (
                <div
                  key={assignment.instanceId}
                  className={styles.damageRow}
                  data-instance-id={assignment.instanceId}
                  data-grp-id={assignment.grpId || undefined}
                  data-damage-recipient-id={assignment.instanceId}
                  data-assigned-damage={assignment.assignedDamage}
                >
                  <div>
                    <span>{assignment.name}</span>{' '}
                    <small>
                      {assignment.isDefender ? 'defender' : `lethal ${assignment.minDamage || 0}`}
                      {assignment.maxDamage ? ` · max ${assignment.maxDamage}` : ''}
                    </small>
                  </div>
                  <div className={styles.damageControls}>
                    <button
                      className={styles.target}
                      aria-label={`Remove 1 damage from ${assignment.name}`}
                      onClick={() => controls?.adjust(assigner, assignment, -1)}
                      disabled={!controls || view.waiting || assignment.assignedDamage <= 0}
                    >
                      −
                    </button>
                    <strong>{assignment.assignedDamage}</strong>
                    <button
                      className={styles.target}
                      aria-label={`Assign 1 damage to ${assignment.name}`}
                      onClick={() => controls?.adjust(assigner, assignment, 1)}
                      disabled={
                        !controls ||
                        view.waiting ||
                        (assignment.maxDamage > 0
                          ? assignment.assignedDamage >= assignment.maxDamage
                          : assignment.assignedDamage >= assigner.totalDamage)
                      }
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.promptFooter}>
        <button
          className={cx(styles.target, styles.done)}
          disabled={!controls || !view.canSubmit || view.waiting}
          onClick={() => void controls?.submit()}
        >
          Assign damage
        </button>
      </div>
    </>
  )
}
