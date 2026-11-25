/**
 * Bounded cause categories for a rejected decklist, matched on the engine's error
 * wording. Telemetry reports only these categories and their counts, never the card
 * names or lines the messages quote.
 */
export const DECKLIST_REJECTION_CAUSES = [
  'card_not_found',
  'card_details_missing',
  'unrecognized_line',
  'invalid_quantity',
  'empty',
  'unsupported_section',
  'commander_missing',
  'commander_ineligible',
  'commander_copies',
  'partnership',
  'color_identity',
  'copy_limit',
  'deck_size',
  'unavailable',
  'other',
] as const

export type DecklistRejectionCause = (typeof DECKLIST_REJECTION_CAUSES)[number]

const PATTERNS: [RegExp, DecklistRejectionCause][] = [
  [/^Card not found:/, 'card_not_found'],
  [/^Card details are unavailable:/, 'card_details_missing'],
  [/^Unrecognized line:/, 'unrecognized_line'],
  [/^(Invalid quantity|Missing card name) on line:/, 'invalid_quantity'],
  [/^No cards found|decklist is blank|empty decklist/i, 'empty'],
  [/section is not supported/, 'unsupported_section'],
  [
    /need a commander|Choose a commander|missing a commander|doesn't have a commander/i,
    'commander_missing',
  ],
  [/can't be a commander|illegal commander$|too many commanders/, 'commander_ineligible'],
  [/exactly one copy/, 'commander_copies'],
  [/partnership|Background without/, 'partnership'],
  [/color identity/, 'color_identity'],
  [/allows at most/, 'copy_limit'],
  [/need 100 cards|need at least 60/, 'deck_size'],
  [/^Could not (check|load)/, 'unavailable'],
]

export function decklistRejectionCause(error: string): DecklistRejectionCause {
  return PATTERNS.find(([pattern]) => pattern.test(error))?.[1] ?? 'other'
}

/** Count of each cause among a rejection's errors. */
export function decklistRejectionCauses(
  errors: string[],
): Partial<Record<DecklistRejectionCause, number>> {
  const counts: Partial<Record<DecklistRejectionCause, number>> = {}
  for (const error of errors) {
    const cause = decklistRejectionCause(error)
    counts[cause] = (counts[cause] ?? 0) + 1
  }
  return counts
}
