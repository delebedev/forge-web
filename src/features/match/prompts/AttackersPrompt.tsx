import type { CardView, AttackersPromptView } from '@engine/state/gre-state'
import type { AttackerControls } from '@engine/runtime/prompts/family'
import { ChoiceLabel } from './ChoiceLabel'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function AttackersPrompt({
  view,
  controls,
  cards,
}: {
  view: AttackersPromptView
  controls: AttackerControls | null
  cards: CardView[]
}) {
  const cardFor = (id: number) => cards.find((card) => card.instanceId === id)
  return (
    <>
      <div className={styles.promptBody}>
        <div className={styles.targetList}>
          {(view.attackers ?? []).map((attacker) => (
            <button
              key={`${attacker.attackerInstanceId}-${attacker.optionIndex}-${attacker.damageRecipientKey}`}
              className={cx(styles.target, attacker.selected && styles.selected)}
              data-option-index={attacker.optionIndex}
              data-recipient={attacker.damageRecipientKey}
              data-instance-id={attacker.attackerInstanceId}
              data-grp-id={attacker.grpId || undefined}
              aria-pressed={attacker.selected}
              onClick={controls ? () => void controls.choose(attacker) : undefined}
              aria-disabled={!controls || view.waiting}
              disabled={
                (!controls && !cardFor(attacker.attackerInstanceId)) ||
                Boolean(controls && view.waiting)
              }
            >
              <ChoiceLabel card={cardFor(attacker.attackerInstanceId)} selected={attacker.selected}>
                {attacker.name} attacks {attacker.damageRecipientName}
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
          Submit attackers
        </button>
      </div>
    </>
  )
}
