import type { CardNamePromptView } from '@engine/state/gre-state'
import type { CardNameControls } from '@engine/runtime/prompts/family'
import { CARD_NAME_INPUT_LIMIT } from '@engine/runtime/prompts/card-name'
import { TextField } from '@shared/ui/Field'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function CardNamePrompt({
  view,
  controls,
}: {
  view: CardNamePromptView
  controls: CardNameControls | null
}) {
  const disabled = !controls || view.waiting
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled && view.canSubmit) {
          void controls?.submit()
        }
      }}
    >
      <div className={styles.promptBody}>
        <label>
          Card name
          <TextField
            value={view.value}
            onChange={(event) => controls?.edit(event.target.value)}
            disabled={disabled}
            maxLength={CARD_NAME_INPUT_LIMIT}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={Boolean(view.validationError)}
          />
        </label>
        {view.validationError && <p role="alert">{view.validationError}</p>}
      </div>
      <div className={styles.promptFooter}>
        <button
          type="submit"
          className={cx(styles.target, styles.done)}
          disabled={disabled || !view.canSubmit}
        >
          Name card
        </button>
      </div>
    </form>
  )
}
