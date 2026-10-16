import type { PaymentPromptView } from '@engine/state/gre-state'
import type { PaymentControls } from '@engine/runtime/prompts/family'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function PaymentPrompt({
  view,
  controls,
}: {
  view: PaymentPromptView
  controls: PaymentControls | null
}) {
  return (
    <>
      <div className={styles.promptBody}>
        {view.gatherCounterCandidates && (
          <div className={styles.damageList}>
            {view.gatherCounterCandidates.map((candidate) => (
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
                    aria-label={`Remove one fewer counter from ${candidate.name}`}
                    onClick={() => controls?.adjust(candidate, -1)}
                    disabled={!controls || view.waiting || candidate.amount <= candidate.minAmount}
                  >
                    −
                  </button>
                  <strong
                    aria-label={`${candidate.amount} counters selected from ${candidate.name}`}
                  >
                    {candidate.amount}
                  </strong>
                  <button
                    className={styles.target}
                    aria-label={`Remove one counter from ${candidate.name}`}
                    onClick={() => controls?.adjust(candidate, 1)}
                    disabled={
                      !controls ||
                      view.waiting ||
                      candidate.amount >= candidate.maxAmount ||
                      view.gatherCounterCandidates!.reduce((sum, item) => sum + item.amount, 0) >=
                        (view.amountToGather ?? 0)
                    }
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!view.gatherCounterCandidates && (
          <div className={styles.targetList}>
            {(view.payCostCandidates ?? []).map((candidate) => (
              <button
                key={`${candidate.actionIndex}:${candidate.instanceId}:${candidate.abilityGrpId}`}
                className={styles.target}
                data-action-index={candidate.actionIndex}
                data-instance-id={candidate.instanceId}
                data-grp-id={candidate.grpId || undefined}
                data-ability-grp-id={candidate.abilityGrpId || undefined}
                onClick={() => void controls?.pay(candidate)}
                disabled={!controls || view.waiting}
              >
                {candidate.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={styles.promptFooter}>
        <button
          className={cx(styles.target, styles.done)}
          disabled={!controls || view.waiting || (view.gatherCounterCandidates && !view.canSubmit)}
          onClick={() =>
            void (view.gatherCounterCandidates ? controls?.submit() : controls?.finish())
          }
        >
          {view.gatherCounterCandidates ? 'Remove counters' : 'Done paying'}
        </button>
        {view.gatherCounterCandidates && view.canCancel && (
          <button
            className={styles.target}
            disabled={!controls || view.waiting}
            onClick={() => void controls?.cancel()}
          >
            Cancel
          </button>
        )}
      </div>
    </>
  )
}
