import type { OptionalActionPromptView } from '@engine/state/gre-state'
import type { OptionalActionControls } from '@engine/runtime/prompts/family'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function OptionalActionPrompt({
  view,
  controls,
}: {
  view: OptionalActionPromptView
  controls: OptionalActionControls | null
}) {
  return (
    <div className={styles.promptFooter}>
      <button
        className={cx(styles.target, styles.done)}
        data-optional-response="yes"
        onClick={() => void controls?.respond(true)}
        disabled={!controls || view.waiting}
      >
        {view.choiceLabels?.accept ?? (view.paymentCost ? 'Pay' : 'Accept')}
      </button>
      <button
        className={styles.target}
        data-optional-response="no"
        onClick={() => void controls?.respond(false)}
        disabled={!controls || view.waiting}
      >
        {view.choiceLabels?.decline ?? (view.paymentCost ? 'Don’t pay' : 'Decline')}
      </button>
    </div>
  )
}
