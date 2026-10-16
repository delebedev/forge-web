import type { NumericPromptView } from '@engine/state/gre-state'
import type { NumericControls } from '@engine/runtime/prompts/family'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function NumericPrompt({
  view,
  controls,
}: {
  view: NumericPromptView
  controls: NumericControls | null
}) {
  return (
    <>
      <div className={styles.promptBody}>
        <div className={styles.numericChoice} role="group" aria-label="Choose X">
          <button
            className={styles.target}
            aria-label="Decrease X"
            onClick={() => controls?.adjust(-1)}
            disabled={!controls || view.waiting || !view.decrementEnabled}
          >
            −
          </button>
          <strong aria-live="polite" aria-label={`X is ${view.numericValue}`}>
            {view.numericValue}
          </strong>
          <button
            className={styles.target}
            aria-label="Increase X"
            onClick={() => controls?.adjust(1)}
            disabled={!controls || view.waiting || !view.incrementEnabled}
          >
            +
          </button>
        </div>
      </div>
      <div className={styles.promptFooter}>
        <button
          className={cx(styles.target, styles.done)}
          onClick={() => void controls?.submit()}
          disabled={!controls || !view.canSubmit || view.waiting}
        >
          Choose X = {view.numericValue}
        </button>
      </div>
    </>
  )
}
