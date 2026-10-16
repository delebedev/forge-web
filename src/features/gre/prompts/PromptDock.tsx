import { MulliganPrompt } from './MulliganPrompt'
import { DamagePrompt } from './DamagePrompt'
import { AttackersPrompt } from './AttackersPrompt'
import { BlockersPrompt } from './BlockersPrompt'
import { PaymentPrompt } from './PaymentPrompt'
import { TargetPrompt } from './TargetPrompt'
import { SelectionPrompt } from './SelectionPrompt'
import { CastingPrompt } from './CastingPrompt'
import { ReplacementPrompt } from './ReplacementPrompt'
import { OptionalActionPrompt } from './OptionalActionPrompt'
import { DistributionPrompt } from './DistributionPrompt'
import { OrderPrompt } from './OrderPrompt'
import { GroupPrompt } from './GroupPrompt'
import type { PromptBinding } from '@engine/runtime/prompts/family'
import { NumericPrompt } from './NumericPrompt'
import { SearchPrompt } from './SearchPrompt'
import { useEffect, useId, useRef } from 'react'
import type { CardView, PromptView } from '@engine/state/gre-state'
import { promptHeading, promptInstruction } from '@engine/state/gre-prompt-view'
import styles from './PromptDock.module.css'

export function PromptDock({
  prompt,
  binding = null,
  cards = [],
  onHover,
}: {
  prompt: PromptView | null
  binding?: PromptBinding | null
  cards?: CardView[]
  onHover?: (card: CardView | null) => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const headingId = useId()
  const instructionId = useId()
  const interactionKey = prompt?.interactionKey

  useEffect(() => {
    if (interactionKey != null) {
      headingRef.current?.focus()
    }
  }, [interactionKey])

  if (!prompt) {
    return null
  }

  const cardFor = (id: number) => cards.find((card) => card.instanceId === id)
  const inspect = (target: EventTarget | null) => {
    const element = target instanceof Element ? target.closest('[data-instance-id]') : null
    onHover?.(cardFor(Number(element?.getAttribute('data-instance-id'))) ?? null)
  }
  const targetGroups = prompt.kind === 'targets' ? (prompt.targetGroups ?? []) : []
  const targetHeading =
    targetGroups.length === 0
      ? promptHeading(prompt)
      : targetGroups.length === 1 && targetGroups[0]!.max === 1
        ? 'Choose a target'
        : 'Choose targets'

  return (
    <section
      onMouseOver={(event) => inspect(event.target)}
      onMouseLeave={() => onHover?.(null)}
      onFocusCapture={(event) => inspect(event.target)}
      onBlurCapture={() => onHover?.(null)}
      className={styles.promptPanel}
      data-prompt={prompt.kind}
      aria-labelledby={headingId}
      aria-describedby={instructionId}
      aria-busy={prompt.waiting}
    >
      <div className={styles.promptHead}>
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {prompt.kind === 'targets' && !prompt.waiting
            ? `${targetHeading}${prompt.source ? ` for ${prompt.source.name}` : ''}`
            : promptHeading(prompt)}
        </h2>
        <p id={instructionId} aria-live="polite">
          {promptInstruction(prompt)}
        </p>
      </div>

      {prompt.kind === 'mulligan' ? (
        <MulliganPrompt
          view={prompt}
          controls={
            binding?.kind === 'mulligan' && binding.view === prompt ? binding.controls : null
          }
        />
      ) : prompt.kind === 'assignDamage' ? (
        <DamagePrompt
          view={prompt}
          controls={
            binding?.kind === 'assignDamage' && binding.view === prompt ? binding.controls : null
          }
        />
      ) : prompt.kind === 'attackers' ? (
        <AttackersPrompt
          view={prompt}
          cards={cards}
          controls={
            binding?.kind === 'attackers' && binding.view === prompt ? binding.controls : null
          }
        />
      ) : prompt.kind === 'blockers' ? (
        <BlockersPrompt
          view={prompt}
          cards={cards}
          controls={
            binding?.kind === 'blockers' && binding.view === prompt ? binding.controls : null
          }
        />
      ) : prompt.kind === 'targets' ? (
        <TargetPrompt
          view={prompt}
          cards={cards}
          controls={
            binding?.kind === 'targets' && binding.view === prompt ? binding.controls : null
          }
        />
      ) : prompt.kind === 'castingOptions' ? (
        <CastingPrompt
          view={prompt}
          controls={
            binding?.kind === 'castingOptions' && binding.view === prompt ? binding.controls : null
          }
        />
      ) : prompt.kind === 'payCosts' ? (
        <PaymentPrompt
          view={prompt}
          controls={
            binding?.kind === 'payCosts' && binding.view === prompt ? binding.controls : null
          }
        />
      ) : prompt.kind === 'selectN' ? (
        <SelectionPrompt
          view={prompt}
          cards={cards}
          controls={
            binding?.kind === 'selectN' && binding.view === prompt ? binding.controls : null
          }
        />
      ) : prompt.kind === 'numericInput' ? (
        <NumericPrompt
          view={prompt}
          controls={
            binding?.kind === 'numericInput' && binding.view === prompt ? binding.controls : null
          }
        />
      ) : prompt.kind === 'search' ? (
        <SearchPrompt
          view={prompt}
          cards={cards}
          controls={binding?.kind === 'search' && binding.view === prompt ? binding.controls : null}
        />
      ) : prompt.kind === 'group' ? (
        <GroupPrompt
          view={prompt}
          controls={binding?.kind === 'group' && binding.view === prompt ? binding.controls : null}
        />
      ) : prompt.kind === 'replacement' ? (
        <ReplacementPrompt
          view={prompt}
          cards={cards}
          controls={
            binding?.kind === 'replacement' && binding.view === prompt ? binding.controls : null
          }
        />
      ) : prompt.kind === 'optionalAction' ? (
        <OptionalActionPrompt
          view={prompt}
          controls={
            binding?.kind === 'optionalAction' && binding.view === prompt ? binding.controls : null
          }
        />
      ) : prompt.kind === 'distribution' ? (
        <DistributionPrompt
          view={prompt}
          controls={
            binding?.kind === 'distribution' && binding.view === prompt ? binding.controls : null
          }
        />
      ) : prompt.kind === 'order' ? (
        <OrderPrompt
          view={prompt}
          controls={binding?.kind === 'order' && binding.view === prompt ? binding.controls : null}
        />
      ) : (
        <div className={styles.promptBody} />
      )}
    </section>
  )
}
