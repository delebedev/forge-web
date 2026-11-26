import type { CastingPromptView } from '@engine/state/gre-state'
import type { CastingControls } from '@engine/runtime/prompts/family'
import { manaColorLabel } from '@engine/state/gre-labels'
import { ChoiceLabel } from './ChoiceLabel'
import { cx } from '@shared/react/cx'
import styles from './PromptDock.module.css'

const PHYREXIAN_MANA_COLOR = 6

export function CastingPrompt({
  view,
  controls,
}: {
  view: CastingPromptView
  controls: CastingControls | null
}) {
  return (
    <>
      <div className={styles.promptBody}>
        <div className={styles.targetList}>
          {(view.castingOptions ?? []).map((option, optionIndex) => {
            if (option.manaColors.length > 0) {
              return (
                <div
                  key={option.ctoId}
                  role="group"
                  aria-label={`${option.manaColors.includes(PHYREXIAN_MANA_COLOR) ? 'Payment' : 'Hybrid symbol'} ${optionIndex + 1}`}
                  data-mana-choice
                  data-cto-id={option.ctoId}
                >
                  {option.manaColors.map((manaColor) => (
                    <button
                      key={manaColor}
                      className={cx(
                        styles.target,
                        option.selectedManaColor === manaColor && styles.selected,
                      )}
                      data-mana-color={manaColor}
                      data-option-type={option.optionType}
                      aria-pressed={option.selectedManaColor === manaColor}
                      disabled={!controls || view.waiting}
                      onClick={() => controls?.selectManaType(option, manaColor)}
                    >
                      <ChoiceLabel selected={option.selectedManaColor === manaColor}>
                        {manaColor === PHYREXIAN_MANA_COLOR
                          ? 'Pay 2 life'
                          : manaColorLabel(manaColor)}
                      </ChoiceLabel>
                    </button>
                  ))}
                </div>
              )
            }
            if (option.selectNOptions.length > 0) {
              return option.selectNOptions.map((choice) => (
                <button
                  key={choice.id}
                  className={styles.target}
                  data-cto-id={option.ctoId}
                  data-option-type={option.optionType}
                  data-grp-id={option.grpId || undefined}
                  data-ability-grp-id={option.abilityGrpId || undefined}
                  data-choice-id={choice.id}
                  disabled={!controls || view.waiting}
                  onClick={() => void controls?.chooseCastingOptionSelect(option, choice)}
                >
                  <span>{choice.label}</span>
                </button>
              ))
            }
            if (option.modalOptions.length > 0) {
              const multiSelect = option.maxSelect > 1
              const selectedCount = option.modalOptions.reduce(
                (sum, modal) => sum + (modal.selectedCount ?? Number(modal.selected)),
                0,
              )
              return (
                <div
                  key={option.ctoId}
                  className={styles.modalChoiceGroup}
                  role="group"
                  aria-label={option.label}
                  aria-busy={view.waiting}
                >
                  {multiSelect && (
                    <small className={styles.selectionHint}>
                      {selectedCount} selected · choose {option.minSelect}–{option.maxSelect}
                      {selectedCount >= option.minSelect && !option.selectionPayable
                        ? ' · selected modes cannot be paid together'
                        : ''}
                    </small>
                  )}
                  {option.modalOptions.map((modal) =>
                    option.repeatsAllowed && modal.available ? (
                      <div
                        key={`${modal.available}:${modal.index}:${modal.grpId}`}
                        className={styles.damageRow}
                        data-grp-id={modal.grpId}
                      >
                        <ChoiceLabel selected={modal.selected}>{modal.label}</ChoiceLabel>
                        <div className={styles.damageControls}>
                          <button
                            className={styles.target}
                            aria-label={`Remove one ${modal.label}`}
                            onClick={() => controls?.adjustModalOption(option, modal, -1)}
                            disabled={!controls || view.waiting || (modal.selectedCount ?? 0) === 0}
                          >
                            −
                          </button>
                          <strong
                            aria-label={`${modal.label} selected ${modal.selectedCount ?? 0} times`}
                          >
                            {modal.selectedCount ?? 0}
                          </strong>
                          <button
                            className={styles.target}
                            data-cto-id={option.ctoId}
                            data-grp-id={modal.grpId}
                            aria-label={`Add ${modal.label}`}
                            onClick={() => controls?.adjustModalOption(option, modal, 1)}
                            disabled={!controls || view.waiting || !modal.selectable}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        key={`${modal.available}:${modal.index}:${modal.grpId}`}
                        className={cx(
                          styles.target,
                          modal.selected && styles.selected,
                          !modal.selectable && styles.unavailable,
                        )}
                        data-cto-id={option.ctoId}
                        data-option-type={option.optionType}
                        data-grp-id={modal.grpId}
                        data-ability-grp-id={option.abilityGrpId || undefined}
                        aria-pressed={multiSelect ? modal.selected : undefined}
                        disabled={!controls || view.waiting || !modal.selectable}
                        onClick={() =>
                          multiSelect
                            ? controls?.toggleModalOption(option, modal)
                            : void controls?.chooseModalOption(option, modal)
                        }
                      >
                        <ChoiceLabel selected={modal.selected} unavailable={!modal.available}>
                          {modal.label}
                        </ChoiceLabel>
                        {modal.additionalCost &&
                          !modal.label
                            .replaceAll(' ', '')
                            .includes(modal.additionalCost.replaceAll(' ', '')) && (
                            <span className={styles.modeCost}>
                              {modal.additionalCost.startsWith('{')
                                ? `Additional cost ${modal.additionalCost}`
                                : modal.additionalCost}
                            </span>
                          )}
                        {modal.available && !modal.selectable && (
                          <span className={styles.modeCost}>
                            {option.maxSelect > 0 && selectedCount >= option.maxSelect
                              ? 'Maximum selected'
                              : 'Cannot pay with current selection'}
                          </span>
                        )}
                      </button>
                    ),
                  )}
                </div>
              )
            }
            return (
              <button
                key={option.ctoId}
                className={styles.target}
                data-cto-id={option.ctoId}
                data-option-type={option.optionType}
                data-grp-id={option.grpId || undefined}
                data-ability-grp-id={option.abilityGrpId || undefined}
                disabled={!controls || view.waiting}
                onClick={() => void controls?.chooseCastingOption(option)}
              >
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      </div>
      {castingFooter(view, controls)}
    </>
  )
}

function castingFooter(view: CastingPromptView, controls: CastingControls | null) {
  const submit = (label: string, action: () => void, disabled: boolean) => (
    <button
      className={cx(styles.target, styles.done)}
      onClick={action}
      disabled={!controls || view.waiting || disabled}
    >
      {label}
    </button>
  )
  const secondary = (label: string, action: () => void) => (
    <button className={styles.target} onClick={action} disabled={!controls || view.waiting}>
      {label}
    </button>
  )
  const options = view.castingOptions ?? []
  const modes = options.filter(
    (option) =>
      option.modalOptions.length > 0 &&
      (option.maxSelect > 1 || (view.isVote && option.minSelect === 0)),
  )
  const mana = options.filter((option) => option.manaColors.length > 0)
  if (!modes.length && !mana.length) {
    return view.canCancel ? (
      <div className={styles.promptFooter}>
        {secondary('Cancel', () => void controls?.cancel())}
      </div>
    ) : null
  }
  const actions = (
    <>
      {modes.map((option) => {
        const count = option.modalOptions.reduce(
          (sum, modal) => sum + (modal.selectedCount ?? Number(modal.selected)),
          0,
        )
        return (
          <div key={option.ctoId}>
            {submit(
              view.isVote ? 'Abstain' : 'Submit modes',
              () => void controls?.submitModalOptions(option),
              count < option.minSelect || count > option.maxSelect || !option.selectionPayable,
            )}
          </div>
        )
      })}
      {mana.length > 0 &&
        submit(
          'Submit mana choices',
          () => void controls?.submitManaTypes(),
          mana.some((option) => option.selectedManaColor == null) || Boolean(view.waiting),
        )}
      {view.canCancel && secondary('Cancel', () => void controls?.cancel())}
    </>
  )
  return <div className={styles.promptFooter}>{actions}</div>
}
