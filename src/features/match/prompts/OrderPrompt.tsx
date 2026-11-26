/** Renders the family draft; all mutations use controls bound to this interaction. */
import type { OrderPromptView } from '@engine/state/gre-state'
import type { OrderControls } from '@engine/runtime/prompts/family'
import { ChoiceLabel } from './ChoiceLabel'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function OrderPrompt({
  view,
  controls,
}: {
  view: OrderPromptView
  controls: OrderControls | null
}) {
  return (
    <>
      <div className={styles.promptBody}>
        <div className={cx(styles.targetList, styles.orderList)}>
          {view.orderContextLabel && (
            <small className={styles.orderHint}>{view.orderContextLabel}</small>
          )}
          {view.orderCandidates.map((candidate) => (
            <button
              key={candidate.instanceId}
              className={cx(styles.target, candidate.position != null && styles.selected)}
              data-instance-id={candidate.instanceId}
              data-grp-id={candidate.grpId || undefined}
              aria-pressed={candidate.position != null}
              onClick={() => controls?.toggle(candidate.instanceId)}
              disabled={!controls || view.waiting}
            >
              {candidate.position != null && (
                <span className={styles.orderBadge}>{candidate.position}</span>
              )}
              <ChoiceLabel selected={candidate.position != null}>{candidate.name}</ChoiceLabel>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.promptFooter}>
        <button
          className={cx(styles.target, styles.done)}
          onClick={() => void controls?.submit()}
          disabled={!controls || !view.canSubmit || view.waiting}
        >
          Submit order
        </button>
      </div>
    </>
  )
}
