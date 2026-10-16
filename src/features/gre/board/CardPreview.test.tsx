import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CardView } from '@engine/state/gre-state'
import { CardPreview } from './CardPreview'

test('face-down inspection exposes neither identity nor mechanic help', () => {
  const card: CardView = {
    instanceId: 1,
    grpId: 2,
    name: 'Secret creature',
    typeLine: 'Creature — Ninja',
    manaCost: '{2}{U}',
    powerToughness: '3/2',
    rulesText: 'Ninjutsu {1}{U}',
    imageUrl: 'https://cards.scryfall.io/normal/front/secret.jpg',
    faceDown: true,
    controllerSeatId: 2,
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
    mechanicHelp: [{ keyword: 'Ninjutsu', title: 'Ninjutsu', description: 'Secret help.' }],
  }

  const html = renderToStaticMarkup(<CardPreview card={card} />)

  expect(html).toContain('aria-label="Face-down card inspection"')
  expect(html).not.toContain('Secret creature')
  expect(html).not.toContain('Ninjutsu')
  expect(html).not.toContain('Secret help.')
})

test('dungeon inspection shows its full image', () => {
  const card: CardView = {
    instanceId: 401,
    grpId: 78769,
    name: 'Lost Mine of Phandelver',
    typeLine: 'Dungeon',
    manaCost: '',
    powerToughness: '',
    imageUrl: 'https://cards.scryfall.io/normal/front/dungeon.jpg',
    controllerSeatId: 1,
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
  }
  const html = renderToStaticMarkup(<CardPreview card={card} />)

  expect(html).toContain('src="https://cards.scryfall.io/normal/front/dungeon.jpg"')
  expect(html).toContain('alt="Lost Mine of Phandelver"')
  expect(renderToStaticMarkup(<CardPreview card={card} hideCardArt />)).not.toContain(
    'src="https://cards.scryfall.io/normal/front/dungeon.jpg"',
  )
})
