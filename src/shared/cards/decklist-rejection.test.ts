import { describe, expect, it } from 'bun:test'
import { decklistRejectionCause, decklistRejectionCauses } from './decklist-rejection'

describe('decklist rejection causes', () => {
  it('maps engine and dialog errors to bounded categories', () => {
    const cases: [string, string][] = [
      ['Card not found: Wulfgar of Icewind', 'card_not_found'],
      ['Card details are unavailable: Sol Ring', 'card_details_missing'],
      ['Unrecognized line: [Collection]', 'unrecognized_line'],
      ['Invalid quantity on line: -1 Island', 'invalid_quantity'],
      ['No cards found in decklist', 'empty'],
      ['Companion section is not supported for Web import: Lurrus', 'unsupported_section'],
      ['Commander decks need a commander.', 'commander_missing'],
      ['Choose a commander for this deck.', 'commander_missing'],
      ["Forest can't be a commander. Choose an eligible legendary card.", 'commander_ineligible'],
      ['Forest must have exactly one copy in the command zone.', 'commander_copies'],
      ['Commander deck has an illegal commander partnership.', 'partnership'],
      ["Commander deck has cards outside its commanders' color identity: Swamp.", 'color_identity'],
      ['Austere Command allows at most 1 copy across the main deck and sideboard.', 'copy_limit'],
      ['Commander decks need 100 cards including the commanders.', 'deck_size'],
      ['Could not check this decklist. Try again.', 'unavailable'],
      ['Something new', 'other'],
    ]
    for (const [error, cause] of cases) {
      expect([error, decklistRejectionCause(error)]).toEqual([error, cause])
    }
  })

  it('counts each cause', () => {
    expect(
      decklistRejectionCauses(['Card not found: A', 'Card not found: B', 'Unrecognized line: x']),
    ).toEqual({ card_not_found: 2, unrecognized_line: 1 })
  })
})
