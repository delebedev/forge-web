/** Allocation controls use IDs bound to the displayed interaction, never stale rows. */
import type { DistributionPromptView } from '@engine/state/gre-state'
import type { DistributionControls } from '@engine/runtime/prompts/family'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function DistributionPrompt({
  view,
  controls,
}: {
  view: DistributionPromptView
  controls: DistributionControls | null
}) {
  const total = view.distributionCandidates.reduce((sum, candidate) => sum + candidate.amount, 0)
  return (
    <>
      <div className={styles.promptBody}>
        <div className={styles.damageList}>
          {view.distributionCandidates.map((candidate) => (
            <div
              key={candidate.instanceId}
              className={styles.damageRow}
              data-instance-id={candidate.instanceId}
              data-grp-id={candidate.grpId || undefined}
            >
              <span>{candidate.name}</span>
              <div className={styles.damageControls}>
                <button
                  className={styles.target}
                  aria-label={`Remove 1 from ${candidate.name}`}
                  onClick={() => controls?.adjust(candidate.instanceId, -1)}
                  disabled={!controls || view.waiting || candidate.amount <= candidate.minAmount}
                >
                  −
                </button>
                <strong aria-label={`${candidate.amount} assigned`}>{candidate.amount}</strong>
                <button
                  className={styles.target}
                  aria-label={`Assign 1 to ${candidate.name}`}
                  onClick={() => controls?.adjust(candidate.instanceId, 1)}
                  disabled={!controls || view.waiting || total >= view.maxSelect}
                >
                  +
                </button>
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
          Submit distribution
        </button>
      </div>
    </>
  )
}
