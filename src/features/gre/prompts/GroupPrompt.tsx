/** Renders the family draft; all mutations use controls bound to this interaction. */
import type { GroupPromptView } from '@engine/state/gre-state'
import type { GroupControls } from '@engine/runtime/prompts/family'
import { ChoiceLabel } from './ChoiceLabel'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function GroupPrompt({
  view,
  controls,
}: {
  view: GroupPromptView
  controls: GroupControls | null
}) {
  return (
    <>
      <div className={styles.promptBody}>
        <div className={styles.groupList}>
          <div className={styles.groupSpecs}>
            {view.groupSpecs.map((spec) => (
              <div key={spec.index} className={styles.groupSpec} data-group-index={spec.index}>
                <strong>{spec.label}</strong>{' '}
                <small>
                  {spec.count}/
                  {spec.lowerBound === spec.upperBound
                    ? spec.upperBound
                    : `${spec.lowerBound}-${spec.upperBound}`}{' '}
                  cards
                </small>
              </div>
            ))}
          </div>
          {view.groupCandidates.map((candidate) => (
            <div
              key={candidate.instanceId}
              className={styles.groupCard}
              data-card={candidate.name}
              data-instance-id={candidate.instanceId}
              data-grp-id={candidate.grpId || undefined}
            >
              <div>
                <strong>{candidate.name}</strong>
              </div>
              <div className={styles.groupControls}>
                {view.groupSpecs.map((spec) => (
                  <button
                    key={spec.index}
                    className={cx(
                      styles.target,
                      candidate.selectedGroup === spec.index && styles.selected,
                    )}
                    data-group-index={spec.index}
                    data-group-zone-type={spec.zoneType}
                    data-group-sub-zone-type={spec.subZoneType}
                    aria-pressed={candidate.selectedGroup === spec.index}
                    onClick={() => controls?.move(candidate.instanceId, spec.index)}
                    disabled={!controls || view.waiting}
                  >
                    <ChoiceLabel selected={candidate.selectedGroup === spec.index}>
                      {spec.label}
                    </ChoiceLabel>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.promptFooter}>
        <button
          className={cx(styles.target, styles.done)}
          onClick={() => void controls?.submit()}
          disabled={!controls || !view.canSubmit || view.waiting}
        >
          Submit groups
        </button>
      </div>
    </>
  )
}
