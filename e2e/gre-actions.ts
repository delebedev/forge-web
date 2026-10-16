/**
 * Cast and activate through real controls to a declared changing result.
 * Keep payment, target and choice steps explicit when they are the claim.
 * resolveTo owns the input callback and captures its pre-action request.
 */
import type { Page } from '@playwright/test'
import {
  activate,
  cast,
  target,
  conditions,
  conditionsMet,
  latestAnnotationSeq,
  type ActionSpec,
  type Condition,
} from './gre-acceptance'
import { completionState, resolveResult } from './gre-action-completion'

/** Resolve a real UI action to its declared gameplay result, then playable priority or game over. */
export async function resolveTo(
  page: Page,
  result: Condition,
  action: () => Promise<void>,
): Promise<void> {
  const before = {
    state: await completionState(page),
    annotationSeq: await latestAnnotationSeq(page),
  }
  const checks = conditions(result)
  if (checks.length === 0 || (await conditionsMet(page, checks, before))) {
    throw new Error('gameplay completion needs an outcome not already true before the action')
  }
  await action()
  await resolveResult(page, {
    before: before.state,
    result: () => conditionsMet(page, checks, before),
    expected: checks,
    expectedPrompt: checks.some((check) => 'prompt' in check),
  })
}

export async function castSpell(
  page: Page,
  spec: Omit<ActionSpec, 'type'> & { target?: unknown; until: Condition },
): Promise<void> {
  await resolveTo(page, spec.until, async () => {
    await cast(page, { ...spec, type: 'cast' })
    if (spec.target != null) {
      await target(page, spec.target)
    }
  })
}

export async function activateAbility(
  page: Page,
  spec: Parameters<typeof activate>[1] & { target?: unknown; until: Condition },
): Promise<void> {
  await resolveTo(page, spec.until, async () => {
    await activate(page, spec)
    if (spec.target != null) {
      await target(page, spec.target)
    }
  })
}
