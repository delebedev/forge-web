import { useState } from 'react'
import type { CardView, SelectionPromptView } from '@engine/state/gre-state'
import type { SelectionControls } from '@engine/runtime/prompts/family'
import { TextField } from '@shared/ui/Field'
import { ChoiceLabel } from './ChoiceLabel'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

type SelectionPromptProps = {
  view: SelectionPromptView
  controls: SelectionControls | null
  cards: CardView[]
}

export function SelectionPrompt(props: SelectionPromptProps) {
  const { view } = props
  const filterable =
    view.selectNCandidates.length > 0 &&
    view.selectNCandidates.every((candidate) => candidate.staticChoice && candidate.name.trim())
  return filterable ? (
    <StaticSelectionPrompt key={view.interactionKey} {...props} />
  ) : (
    SelectionContents({ ...props, candidates: view.selectNCandidates })
  )
}

function StaticSelectionPrompt(props: SelectionPromptProps) {
  const [query, setQuery] = useState('')
  const match = query.trim().toLowerCase()
  const candidates = props.view.selectNCandidates.filter((candidate) =>
    candidate.name.toLowerCase().includes(match),
  )
  return (
    <>
      <div className={styles.choiceFilter}>
        <label>
          Filter choices
          <TextField
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {query && (
          <button className={styles.target} onClick={() => setQuery('')}>
            Clear filter
          </button>
        )}
      </div>
      <SelectionContents {...props} candidates={candidates} />
    </>
  )
}

function SelectionContents({
  view,
  controls,
  cards,
  candidates,
}: SelectionPromptProps & { candidates: SelectionPromptView['selectNCandidates'] }) {
  return (
    <>
      <div className={styles.promptBody}>
        <div className={styles.targetList}>
          {candidates.length === 0 && view.selectNCandidates.length > 0 && (
            <p role="status" className={styles.selectionHint}>
              No matching choices. Clear the filter to see all choices.
            </p>
          )}
          {candidates.map((candidate) => (
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
