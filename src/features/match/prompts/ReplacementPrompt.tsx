import type { CardView, ReplacementPromptView } from '@engine/state/gre-state'
import type { ReplacementControls } from '@engine/runtime/prompts/family'
import { ChoiceLabel } from './ChoiceLabel'
import styles from './PromptDock.module.css'

export function ReplacementPrompt({
  view,
  controls,
  cards = [],
}: {
  view: ReplacementPromptView
  controls: ReplacementControls | null
  cards?: CardView[]
}) {
  return (
    <div className={styles.promptBody}>
      <div className={styles.targetList}>
        {view.replacementCandidates.map((candidate) => (
          <button
            key={candidate.replacementEffectId}
            className={styles.target}
            data-instance-id={candidate.sourceInstanceId || undefined}
            data-replacement-effect-id={candidate.replacementEffectId}
            onClick={() => void controls?.choose(candidate.replacementEffectId)}
            disabled={!controls || view.waiting}
          >
            <ChoiceLabel
              card={cards.find((card) => card.instanceId === candidate.sourceInstanceId)}
            >
              {candidate.name}
            </ChoiceLabel>
            <small className={styles.choiceState}>{candidate.detail}</small>
          </button>
        ))}
      </div>
    </div>
  )
}
