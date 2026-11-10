import type { CardMeta, CardView, GameObject } from './gre-state'

/** Coverage is a launch contract, never inferred from a build ID or printed text. */
export function effectiveKeywordCoverage(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((name) => typeof name === 'string')
    ? Object.freeze(value.filter((name) => name === 'Flying'))
    : undefined
}

/** Undefined is unknown; false is a covered, authoritatively empty Flying set. */
export function effectiveFlying(
  object: GameObject | undefined,
  meta: CardMeta | undefined,
  coverage: readonly string[] | undefined,
): boolean | undefined {
  if (!coverage?.includes('Flying') || !object || object.isFacedown || !meta?.keywords) {
    return undefined
  }
  const declared = Object.entries(meta.abilities ?? {})
    .filter(([, ability]) => ability.keyword === 'Flying')
    .map(([id]) => Number(id))
  if (meta.keywords?.includes('Flying') && declared.length === 0) {
    return undefined
  }
  // 8 is the existing explicit Flying grant identity, not a synthetic intrinsic row ID.
  return (object.uniqueAbilities ?? []).some(
    (ability) => ability.grpId === 8 || declared.includes(ability.grpId),
  )
}

export function reconcileEffectiveFlying(card: CardView, flying: boolean | undefined): CardView {
  if (flying !== false) {
    return card
  }
  return {
    ...card,
    keywords: card.keywords?.filter((keyword) => keyword !== 'Flying'),
    grantedKeywords: card.grantedKeywords?.filter((keyword) => keyword !== 'Flying'),
    mechanicHelp: card.mechanicHelp?.filter((help) => help.keyword !== 'Flying'),
  }
}
