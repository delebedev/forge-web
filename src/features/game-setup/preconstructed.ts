import type { DeckDetail } from '@shared/api/contracts'
import green from '../../../dev/decks/Pauper Green Stompy.txt?raw'
import red from '../../../dev/decks/Pauper Red Burn.txt?raw'
import blue from '../../../dev/decks/Pauper Blue Tempo.txt?raw'
import white from '../../../dev/decks/Pauper White Lifegain.txt?raw'
import black from '../../../dev/decks/Pauper Black Sacrifice.txt?raw'

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

const commanderLists = import.meta.glob('../../../dev/decks/commander/*.txt', {
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
