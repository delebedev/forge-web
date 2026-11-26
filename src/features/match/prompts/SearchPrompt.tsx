import type { CardView, SearchPromptView } from '@engine/state/gre-state'
import type { SearchControls } from '@engine/runtime/prompts/family'
import { ChoiceLabel } from './ChoiceLabel'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

export function SearchPrompt({
  view,
  controls,
  cards,
}: {
  view: SearchPromptView
  controls: SearchControls | null
  cards: CardView[]
}) {
  const groups = view.searchGroups.length
    ? view.searchGroups
    : [{ groupId: 0, label: '', minSelect: 0, maxSelect: 0, selected: 0 }]
  return (
    <>
      <div className={styles.promptBody}>
        <div className={cx(styles.targetList, styles.searchList)}>
          {groups.map((group) => (
            <div
              className={styles.searchGroup}
              key={group.groupId}
              role={view.searchGroups.length ? 'group' : undefined}
              aria-label={group.label || undefined}
            >
              {group.label && (
                <small className={styles.selectionHint}>
                  {group.label} · {group.selected} selected · choose up to {group.maxSelect}
                </small>
              )}
              {view.searchCandidates
                .filter(
                  (candidate) => !view.searchGroups.length || candidate.groupId === group.groupId,
                )
                .map((candidate) => {
                  const card = cards.find((card) => card.instanceId === candidate.instanceId)
                  return (
                    <button
                      key={candidate.instanceId}
                      className={cx(
                        styles.target,
                        candidate.selected && styles.selected,
                        !candidate.sought && styles.unavailable,
                      )}
                      data-instance-id={candidate.instanceId}
                      data-grp-id={candidate.grpId || undefined}
                      data-zone-type={candidate.zoneType || undefined}
                      aria-pressed={candidate.selected}
                      onClick={() => controls?.toggle(candidate.instanceId)}
                      disabled={!controls || view.waiting || !candidate.sought}
                    >
                      <ChoiceLabel
                        card={card}
                        selected={candidate.selected}
                        unavailable={!candidate.sought}
                      >
                        {candidate.name}
                      </ChoiceLabel>
                    </button>
                  )
                })}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.promptFooter}>
        <button
          className={cx(styles.target, styles.done)}
          onClick={() => void controls?.submit()}
          disabled={!controls || !view.canSubmit || view.waiting}
        >
          Submit search
        </button>
        {view.canFail && (
          <button
            className={styles.target}
            onClick={() => void controls?.fail()}
            disabled={!controls || view.waiting}
          >
            Fail to find
          </button>
        )}
      </div>
    </>
  )
}
