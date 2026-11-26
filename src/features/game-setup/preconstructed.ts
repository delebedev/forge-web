import type { DeckDetail, ParseDecklistResponse } from '@shared/api/contracts'
import { cmcOf } from '@shared/cards/deck-builder'
import { formatDecklist } from '@shared/cards/parse-decklist'
import green from '../../../content/decks/Pauper Green Stompy.txt?raw'
import red from '../../../content/decks/Pauper Red Burn.txt?raw'
import blue from '../../../content/decks/Pauper Blue Tempo.txt?raw'
import white from '../../../content/decks/Pauper White Lifegain.txt?raw'
import black from '../../../content/decks/Pauper Black Sacrifice.txt?raw'

export const PRECONSTRUCTED_DECKS: DeckDetail[] = [
  ['Green Stompy', 'G', 'Llanowar Elves', 'Build your mana. Send in the creatures.', green],
  ['Red Burn', 'R', 'Lightning Bolt', 'Fast threats and direct damage.', red],
  ['Blue Tempo', 'U', 'Delver of Secrets', 'Stay ahead with evasive threats and answers.', blue],
  ['White Lifegain', 'W', 'Soul Warden', 'Grow your board and your life total.', white],
  ['Black Sacrifice', 'B', 'Carrion Feeder', 'Turn small creatures into lasting advantage.', black],
].map(([name, color, cover, description, content]) => ({
  id: `precon:${name}`,
  name: name!,
  colors: [color!],
  description,
  content,
  cards: [{ name: cover!, quantity: 1, colors: [color!], cmc: 1 }],
  stats: { totalCards: 60, creatures: 0, nonCreatures: 0, lands: 0, manaCurve: {}, averageCmc: 0 },
  hasCommander: false,
  userOwned: false,
}))

const commanderLists = import.meta.glob('../../../content/decks/commander/*.txt', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export const COMMANDER_DECKS: DeckDetail[] = Object.entries(commanderLists).map(
  ([path, content]) => {
    const name = path
      .split('/')
      .pop()!
      .replace(/\.txt$/, '')
    const commander = content.match(/\[Commander\]\s*\n\d+ (.+)/i)![1]!
    const card = { name: commander, quantity: 1, colors: [], cmc: 0 }
    return {
      id: `precon:${name}`,
      name,
      content,
      colors: [],
      cards: [],
      commandZone: [card],
      stats: {
        totalCards: 100,
        creatures: 0,
        nonCreatures: 0,
        lands: 0,
        manaCurve: {},
        averageCmc: 0,
      },
      hasCommander: true,
      userOwned: false,
    }
  },
)

/** A pasted decklist played without saving it, for players without an account. */
export function pastedDeck(name: string, deck: ParseDecklistResponse): DeckDetail {
  const rows = (entries: ParseDecklistResponse['mainboard']) =>
    entries.map(({ card, quantity }) => ({
      name: card.name,
      quantity,
      colors: card.colors,
      cmc: cmcOf(card),
    }))
  const count = (entries: ParseDecklistResponse['mainboard']) =>
    entries.reduce((sum, entry) => sum + entry.quantity, 0)
  return {
    id: `pasted:${name}`,
    name,
    content: formatDecklist(deck),
    colors: [],
    cards: rows(deck.mainboard),
    commandZone: rows(deck.commandZone),
    stats: {
      totalCards: count(deck.mainboard) + count(deck.commandZone),
      creatures: 0,
      nonCreatures: 0,
      lands: 0,
      manaCurve: {},
      averageCmc: 0,
    },
    hasCommander: deck.commandZone.length > 0,
    userOwned: false,
  }
}
