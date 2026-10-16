import type { CardView, SelectionPromptView } from '@engine/state/gre-state'
import type { SelectionControls } from '@engine/runtime/prompts/family'
import { ChoiceLabel } from './ChoiceLabel'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function SelectionPrompt({
  view,
  controls,
  cards,
}: {
  view: SelectionPromptView
  controls: SelectionControls | null
  cards: CardView[]
}) {
  return (
    <>
      <div className={styles.promptBody}>
        <div className={styles.targetList}>
          {view.selectNCandidates.map((candidate) => (
            <button
              key={candidate.instanceId}
              className={cx(styles.target, candidate.selected && styles.selected)}
              data-choice-id={candidate.instanceId}
              data-instance-id={candidate.staticChoice ? undefined : candidate.instanceId}
              data-grp-id={candidate.grpId || undefined}
              data-zone-type={candidate.zoneType || undefined}
              aria-pressed={candidate.selected}
              onClick={controls ? () => controls.toggle(candidate) : undefined}
              aria-disabled={!controls || view.waiting}
              disabled={
                (!controls &&
                  (candidate.staticChoice ||
                    !cards.some((card) => card.instanceId === candidate.instanceId))) ||
                Boolean(controls && view.waiting)
              }
            >
              <ChoiceLabel
                card={
                  candidate.staticChoice
                    ? undefined
                    : cards.find((card) => card.instanceId === candidate.instanceId)
                }
                selected={candidate.selected}
              >
                {candidate.name}
                {candidate.weight == null ? '' : ` · ${candidate.weight} toward total`}
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
          Submit selection
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
