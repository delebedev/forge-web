import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CardView } from '@engine/state/gre-state'
import {
  ComposedCardBody,
  cardBodyFromView,
  parsePlaneswalkerRulesText,
  parseProgressionRulesText,
  parseSagaRulesText,
  type OrdinaryCardBody,
  type SagaCardBody,
} from './ComposedCardBody'

const base = {
  manaCost: '{2}{W}',
  typeLine: 'Enchantment — Saga',
  imageUrl: 'https://cards.scryfall.io/normal/front/a/b/card.jpg',
  artist: 'An Artist',
  frame: 'white' as const,
  material: 'ordinary' as const,
  stateLabels: [],
}

test('renders a Saga as art crop with a chapter rail', () => {
  const card: SagaCardBody = {
    ...base,
    layout: 'saga',
    name: 'A Saga',
    reminderText: 'Add a lore counter.',
    chapters: [
      { label: 'I', text: 'First chapter.' },
      { label: 'II', text: 'Second chapter.' },
      { label: 'III', text: 'Third chapter.' },
    ],
  }

  const html = renderToStaticMarkup(<ComposedCardBody card={card} />)

  expect(html).toContain('data-layout="saga"')
  expect(html).toContain('/art_crop/front/a/b/card.jpg')
  expect(html).toContain('First chapter.')
  expect(html).toContain('>III<')
})

test('renders ordinary rules text, inline mana, and power/toughness', () => {
  const card: OrdinaryCardBody = {
    ...base,
    layout: 'ordinary',
    name: 'A Creature',
    typeLine: 'Creature — Elf Druid',
    rulesText: '{T}: Add {G}.',
    powerToughness: '1/1',
    frame: 'green',
  }

  const html = renderToStaticMarkup(<ComposedCardBody card={card} />)

  expect(html).toContain('data-layout="ordinary"')
  expect(html).toContain('aria-label="T"')
  expect(html).toContain('aria-label="G"')
  expect(html).toContain('1/1')
})

test('renders catalog set symbols and rarity while suppressing missing and hidden identities', () => {
  const card = view({ name: 'A Creature', typeLine: 'Creature — Elf Druid', setCode: ' DOM ' })
  for (const [rarity, cssClass, label] of [
    ['BasicLand', 'common', 'basic land'],
    ['Common', 'common', 'common'],
    ['Uncommon', 'uncommon', 'uncommon'],
    ['Rare', 'rare', 'rare'],
    ['MythicRare', 'mythic', 'mythic rare'],
    ['mythic', 'mythic', 'mythic rare'],
    ['Special', 'timeshifted', 'special'],
  ]) {
    const html = renderToStaticMarkup(
      <ComposedCardBody card={cardBodyFromView({ ...card, rarity })} />,
    )
    expect(html).toContain(`ss-dom ss-${cssClass}`)
    expect(html).toContain(`aria-label="Set DOM, ${label}"`)
  }
  for (const hidden of [
    { ...card, setCode: undefined },
    { ...card, setCode: 'dom ss-mythic' },
    { ...card, faceDown: true },
  ]) {
    expect(
      renderToStaticMarkup(<ComposedCardBody card={cardBodyFromView(hidden)} />),
    ).not.toContain('ss-dom')
  }
})

test('derives production Saga and affiliation models from card views', () => {
  const saga = view({
    name: 'A Saga',
    manaCost: '{1}{W}',
    typeLine: 'Enchantment — Saga',
    rulesText: '(Add a lore counter.)\\nI — First chapter.\\nII, III — Later chapters.',
  })
  const dualLand = view({
    name: 'Dual Land',
    typeLine: 'Land — Forest Island',
  })

  expect(cardBodyFromView(saga)).toMatchObject({
    layout: 'saga',
    frame: 'white',
    reminderText: '(Add a lore counter.)',
    chapters: [
      { label: 'I', text: 'First chapter.' },
      { label: 'II, III', text: 'Later chapters.' },
    ],
  })
  expect(cardBodyFromView(dualLand)).toMatchObject({ layout: 'ordinary', frame: 'multicolor' })
  expect(parseSagaRulesText('No chapter markers.').chapters).toEqual([])
})

test('derives each specialized layout from production card fields', () => {
  const linkedFaces = [
    {
      grpId: 2,
      name: 'Left',
      manaCost: '{R}',
      typeLine: 'Instant',
      rulesText: 'Left text.',
      powerToughness: '',
      imageUrl: '',
    },
    {
      grpId: 3,
      name: 'Right',
      manaCost: '{2}{R}',
      typeLine: 'Instant',
      rulesText: 'Right text.',
      powerToughness: '',
      imageUrl: '',
    },
  ]

  expect(
    cardBodyFromView(
      view({
        name: 'A Walker',
        typeLine: 'Legendary Planeswalker — Test',
        rulesText: '[+1]: Draw.\n[-2]: Destroy.',
        loyalty: '3',
      }),
    ),
  ).toMatchObject({ layout: 'planeswalker', loyalty: '3' })
  expect(
    cardBodyFromView(
      view({ name: 'A Battle', typeLine: 'Battle — Siege', defense: '4', rulesText: 'Fight.' }),
    ),
  ).toMatchObject({ layout: 'battle', defense: '4' })
  expect(
    cardBodyFromView(
      view({ name: 'Left // Right', typeLine: 'Instant', faceLayout: 'Split', linkedFaces }),
    ),
  ).toMatchObject({ layout: 'split', mode: 'Split' })
  expect(
    cardBodyFromView(
      view({
        name: 'Creature half',
        typeLine: 'Creature',
        faceLayout: 'Adventure',
        linkedFaces: [{ ...linkedFaces[0]!, grpId: 4, name: 'Adventure half' }],
      }),
    ),
  ).toMatchObject({
    layout: 'split',
    mode: 'Adventure',
    faces: [{ name: 'Creature half' }, { name: 'Adventure half' }],
  })
  expect(
    cardBodyFromView(
      view({
        name: 'Permanent half',
        typeLine: 'Enchantment',
        faceLayout: 'Omen',
        linkedFaces: [{ ...linkedFaces[0]!, grpId: 5, name: 'Omen half' }],
      }),
    ),
  ).toMatchObject({
    layout: 'split',
    mode: 'Omen',
    faces: [{ name: 'Permanent half' }, { name: 'Omen half' }],
  })
  expect(
    cardBodyFromView(
      view({ name: 'Front', typeLine: 'Creature', faceLayout: 'Transform', linkedFaces }),
    ),
  ).toMatchObject({ layout: 'two-faced' })
  expect(
    cardBodyFromView(
      view({ name: 'A Class', typeLine: 'Enchantment — Class', rulesText: '{2}: Level 2\nFly.' }),
    ),
  ).toMatchObject({ layout: 'progression', sections: [{ label: 'Level 2' }] })
  expect(
    cardBodyFromView(view({ name: 'Hidden', typeLine: 'Creature', faceDown: true })),
  ).toMatchObject({
    layout: 'face-down',
    name: 'Face-down card',
  })
})

test('parses loyalty and progression rows without card-specific rules', () => {
  expect(parsePlaneswalkerRulesText('[+1]: Draw.\n[-2]: Destroy.')).toEqual([
    { label: '+1', text: 'Draw.' },
    { label: '−2', text: 'Destroy.' },
  ])
  expect(
    parseProgressionRulesText(
      'Level up {W}\nLEVEL 2-6\n3/3\nFirst strike\nLEVEL 7+\n4/4\nDouble strike',
    ),
  ).toEqual({
    introText: 'Level up {W}',
    sections: [
      { label: 'Level 2-6', text: '3/3\nFirst strike' },
      { label: 'Level 7+', text: '4/4\nDouble strike' },
    ],
  })
})

function view(values: Partial<CardView> & Pick<CardView, 'name' | 'typeLine'>): CardView {
  return {
    instanceId: 1,
    grpId: 1,
    manaCost: '',
    powerToughness: '',
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
    imageUrl: '',
    controllerSeatId: 1,
    ...values,
  }
}

test('moves only structured keyword reminders out of displayed card bodies', () => {
  const card = view({
    name: 'Goblin Trailblazer',
    typeLine: 'Creature — Goblin Pirate',
    rulesText:
      "Menace (This creature can't be blocked except by two or more creatures.)\nAn ability (choose up to one target).",
    mechanicHelp: [
      {
        keyword: 'Menace',
        title: 'Menace',
        description: "This creature can't be blocked except by two or more creatures.",
      },
    ],
  })
  expect(cardBodyFromView(card)).toMatchObject({
    rulesText: 'Menace\nAn ability (choose up to one target).',
  })
  expect(cardBodyFromView({ ...card, mechanicHelp: [] })).toMatchObject({
    rulesText: card.rulesText,
  })
  expect(card.rulesText).toContain('(This creature')
  expect(
    cardBodyFromView(
      view({
        name: 'Zurgo Bellstriker',
        typeLine: 'Legendary Creature — Orc Warrior',
        rulesText: 'Dash {1}{R} (You may cast this spell for its dash cost.)',
        mechanicHelp: [
          {
            keyword: 'Dash',
            title: 'Dash',
            description: 'You may cast this spell for its dash cost.',
            cost: '{1}{R}',
          },
        ],
      }),
    ),
  ).toMatchObject({ rulesText: 'Dash {1}{R}' })
})
