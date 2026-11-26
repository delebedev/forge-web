import type { CardView, TargetPromptView } from '@engine/state/gre-state'
import type { TargetControls } from '@engine/runtime/prompts/family'
import { ChoiceLabel } from './ChoiceLabel'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function TargetPrompt({
  view,
  controls,
  cards,
}: {
  view: TargetPromptView
  controls: TargetControls | null
  cards: CardView[]
}) {
  const cardFor = (id: number) => cards.find((card) => card.instanceId === id)
  return (
    <>
      <div className={styles.promptBody}>
        {view.targetGroups && (
          <div className={styles.targetProgress}>
            {view.targetGroups.map((group) => (
              <span key={group.index}>
                {view.targetGroups!.length > 1 ? `Selection ${group.index} · ` : ''}
                {group.selected} /{' '}
                {group.min === group.max ? group.max : `${group.min}–${group.max}`} targets
              </span>
            ))}
          </div>
        )}

        <div className={styles.targetList}>
          {view.candidates.map((target) => (
            <button
              key={`${target.targetIdx}:${target.targetInstanceId}:${target.legalAction}`}
              className={cx(styles.target, target.selected && styles.selected)}
              data-target-index={target.targetIdx}
              data-instance-id={target.targetInstanceId}
              data-legal-action={target.legalAction}
              data-grp-id={target.grpId || undefined}
              aria-pressed={target.selected}
              onClick={controls ? () => void controls.choose(target) : undefined}
              aria-disabled={!controls || view.waiting}
              disabled={
                (!controls && !cardFor(target.targetInstanceId)) ||
                Boolean(controls && view.waiting)
              }
            >
              <ChoiceLabel card={cardFor(target.targetInstanceId)} selected={target.selected}>
                {target.name}
              </ChoiceLabel>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.promptFooter}>
        <button
          className={cx(styles.target, styles.done)}
          disabled={!controls || !view.canSubmit || view.waiting}
          onClick={() => void controls?.submit()}
        >
          Submit targets
        </button>
        {view.canCancel && (
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
