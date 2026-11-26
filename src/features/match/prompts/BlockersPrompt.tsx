import type { CardView, BlockersPromptView } from '@engine/state/gre-state'
import type { BlockerControls } from '@engine/runtime/prompts/family'
import { ChoiceLabel } from './ChoiceLabel'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function BlockersPrompt({
  view,
  controls,
  cards,
}: {
  view: BlockersPromptView
  controls: BlockerControls | null
  cards: CardView[]
}) {
  return (
    <>
      <div className={styles.promptBody}>
        <div className={cx(styles.targetList, styles.blockerList)}>
          {(view.blockers ?? []).map((blocker) => (
            <div
              key={blocker.blockerInstanceId}
              className={styles.blockerGroup}
              role="group"
              aria-label={`${blocker.blockerName} blocking choices`}
              data-instance-id={blocker.blockerInstanceId}
              data-grp-id={blocker.blockerGrpId || undefined}
            >
              <strong>{blocker.blockerName}</strong>
              {blocker.attackers.map((attacker) => (
                <button
                  key={attacker.attackerInstanceId}
                  className={cx(styles.target, attacker.selected && styles.selected)}
                  data-instance-id={attacker.attackerInstanceId}
                  data-grp-id={attacker.grpId || undefined}
                  aria-pressed={attacker.selected}
                  onClick={
                    controls
                      ? () => void controls.choose(blocker, attacker.attackerInstanceId)
                      : undefined
                  }
                  aria-disabled={!controls || view.waiting}
                  disabled={
                    (!controls &&
                      !cards.find((card) => card.instanceId === attacker.attackerInstanceId)) ||
                    Boolean(controls && view.waiting)
                  }
                >
                  <ChoiceLabel selected={attacker.selected}>Block {attacker.name}</ChoiceLabel>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.promptFooter}>
        <button
          className={cx(styles.target, styles.done)}
          disabled={!controls || !view.canSubmit || view.waiting}
          onClick={() => void controls?.submit()}
        >
          Submit blockers
        </button>
      </div>
    </>
  )
}
