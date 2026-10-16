import type { MulliganPromptView } from '@engine/state/gre-state'
import type { MulliganControls } from '@engine/runtime/prompts/family'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function MulliganPrompt({
  view,
  controls,
}: {
  view: MulliganPromptView
  controls: MulliganControls | null
}) {
  return (
    <>
      <div className={styles.promptBody}>{view.result}</div>
      <div className={styles.promptFooter}>
        <button
          className={cx(styles.target, styles.done)}
          disabled={!controls || view.waiting}
          onClick={() => void controls?.keep()}
        >
          Keep hand
        </button>
        <button
          className={styles.target}
          disabled={!controls || view.waiting}
          onClick={() => void controls?.mulligan()}
        >
          Mulligan
        </button>
      </div>
    </>
  )
}
