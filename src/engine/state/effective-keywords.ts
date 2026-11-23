import type { CardMeta, CardView, GameObject } from './gre-state'

/** Explicit grant identities, shared by every card that receives the keyword. */
export const GRANTED_KEYWORDS: ReadonlyMap<number, string> = new Map([
  [2, 'Hexproof'],
  [4, 'Double strike'],
  [5, 'Deathtouch'],
  [6, 'First strike'],
  [7, 'Haste'],
  [8, 'Flying'],
  [11, 'Indestructible'],
  [12, 'Lifelink'],
  [13, 'Reach'],
  [14, 'Trample'],
  [15, 'Vigilance'],
  [142, 'Menace'],
])

const GRANTED_NAMES = new Set([...GRANTED_KEYWORDS.values()].map((name) => name.toLowerCase()))

/** Coverage is a launch contract, never inferred from a build ID or printed text. */
export function effectiveKeywordCoverage(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((name) => typeof name === 'string')
    ? Object.freeze([...value])
    : undefined
}

/**
 * Covered keywords, lowercased, that the object's current ability rows no longer carry.
 * Undefined is unknown. A printed keyword is known only through a declared ability row and a
 * granted keyword only through its explicit grant identity, so absence is never inferred from
 * printed text alone.
 */
export function lostKeywords(
  object: GameObject | undefined,
  meta: CardMeta | undefined,
  coverage: readonly string[] | undefined,
  keywordNames: ReadonlyMap<number, string>,
): ReadonlySet<string> | undefined {
  if (!coverage?.length || !object || object.isFacedown || !meta?.keywords) {
    return undefined
  }
  const covered = new Set(coverage.map((name) => name.toLowerCase()))
  const declared = new Set(
    Object.values(meta.abilities ?? {}).flatMap((ability) =>
      ability.keyword ? [ability.keyword.toLowerCase()] : [],
    ),
  )
  const present = new Set(
    (object.uniqueAbilities ?? []).flatMap((ability) => {
      const name = keywordNames.get(ability.grpId)
      return name ? [name.toLowerCase()] : []
    }),
  )
  const printed = new Set(meta.keywords.map((name) => name.toLowerCase()))
  const known = (name: string) => (printed.has(name) ? declared.has(name) : GRANTED_NAMES.has(name))
  return new Set(
    [...printed, ...declared, ...GRANTED_NAMES].filter(
      (name) => covered.has(name) && known(name) && !present.has(name),
    ),
  )
}

export function reconcileEffectiveKeywords(
  card: CardView,
  lost: ReadonlySet<string> | undefined,
): CardView {
  if (!lost?.size) {
    return card
  }
  const kept = (keyword: string) => !lost.has(keyword.toLowerCase())
  return {
    ...card,
    keywords: card.keywords?.filter(kept),
    grantedKeywords: card.grantedKeywords?.filter(kept),
    mechanicHelp: card.mechanicHelp?.filter((help) => kept(help.keyword)),
  }
}
