import type { CardFaceView, CardView } from '@engine/state/gre-state'

let nextId = 0

const llanowarElves = card({
  name: 'Llanowar Elves',
  setCode: 'DOM',
  rarity: 'Common',
  manaCost: '{G}',
  typeLine: 'Creature — Elf Druid',
  rulesText: '{T}: Add {G}.',
  powerToughness: '1/1',
  imageUrl: 'https://cards.scryfall.io/normal/front/6/a/6a0b230b-d391-4998-a3f7-7b158a0ec2cd.jpg',
})

const marwyn = card({
  name: 'Marwyn, the Preserver',
  manaCost: '{1}{G}',
  typeLine: 'Legendary Creature — Elf Druid',
  rulesText:
    'Lands you control have hexproof.\n{2}: Return target land card from your graveyard to your hand.',
  powerToughness: '3/2',
  setCode: 'Y25',
  rarity: 'Rare',
})

const yuriko = card({
  name: 'Yuriko, Hope from the Shadows',
  manaCost: '{U}',
  typeLine: 'Legendary Creature — Human Ninja',
  rulesText:
    'Whenever this creature attacks, it gains your choice of trample or deathtouch until end of turn.\nFlash\nWhen Yuriko enters, choose one —\n• Target creature gets -X/-0 until end of turn, where X is the number of cards in your graveyard.\n• Surveil 2.',
  powerToughness: '3/1',
  setCode: 'Y25',
  rarity: 'Rare',
})

const restorationOfEiganjo = card({
  name: 'The Restoration of Eiganjo',
  setCode: 'NEO',
  rarity: 'Rare',
  manaCost: '{2}{W}',
  typeLine: 'Enchantment — Saga',
  rulesText:
    '(As this Saga enters and after your draw step, add a lore counter.)\nI — Search your library for a basic Plains card, reveal it, put it into your hand, then shuffle.\nII — You may discard a card. When you do, return target permanent card with mana value 2 or less from your graveyard to the battlefield tapped.\nIII — Exile this Saga, then return it to the battlefield transformed under your control.',
  imageUrl:
    'https://cards.scryfall.io/normal/front/a/1/a11a33ae-e7fa-4bd4-8cd8-3a3239a29bcc.jpg?1783923920',
})

const lightningBolt = card({
  name: 'Lightning Bolt',
  setCode: 'M11',
  rarity: 'Common',
  manaCost: '{R}',
  typeLine: 'Instant',
  rulesText: 'Lightning Bolt deals 3 damage to any target.',
  imageUrl: 'https://cards.scryfall.io/normal/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg',
})

const dualLand = card({
  name: 'Botanical Sanctum',
  setCode: 'KLD',
  rarity: 'Rare',
  typeLine: 'Land — Forest Island',
  rulesText:
    'Botanical Sanctum enters tapped unless you control two or fewer other lands.\n{T}: Add {G} or {U}.',
  imageUrl: '',
  playableLand: true,
})

const longMulticolorCard = card({
  name: 'Niv-Mizzet, Parun',
  setCode: 'GRN',
  rarity: 'MythicRare',
  manaCost: '{U}{U}{U}{R}{R}{R}',
  typeLine: 'Legendary Creature — Dragon Wizard',
  rulesText:
    "This spell can't be countered.\nFlying\nWhenever you draw a card, Niv-Mizzet, Parun deals 1 damage to any target.\nWhenever a player casts an instant or sorcery spell, you draw a card.",
  powerToughness: '5/5',
  imageUrl: '',
})

const liliana = card({
  name: 'Liliana of the Veil',
  setCode: 'ISD',
  rarity: 'MythicRare',
  manaCost: '{1}{B}{B}',
  typeLine: 'Legendary Planeswalker — Liliana',
  rulesText:
    '[+1]: Each player discards a card.\n[-2]: Target player sacrifices a creature.\n[-6]: Separate all permanents target player controls into two piles. That player sacrifices all permanents in the pile of their choice.',
  loyalty: '3',
  imageUrl: image('Liliana of the Veil'),
})

const invasion = card({
  name: 'Invasion of Zendikar',
  setCode: 'MOM',
  rarity: 'Uncommon',
  manaCost: '{3}{G}',
  typeLine: 'Battle — Siege',
  rulesText:
    'When Invasion of Zendikar enters, search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.',
  defense: '3',
  faceLayout: 'Transform',
  imageUrl: image('Invasion of Zendikar'),
  linkedFaces: [
    face({
      name: 'Awakened Skyclave',
      typeLine: 'Creature — Elemental',
      rulesText: 'Vigilance, haste\n{T}: Add one mana of any color.',
      powerToughness: '4/4',
      imageUrl: image('Invasion of Zendikar', 'back'),
    }),
  ],
})

const deadGone = card({
  name: 'Dead // Gone',
  manaCost: '{R} // {2}{R}',
  typeLine: 'Instant',
  faceLayout: 'Split',
  linkedFaces: [
    face({
      name: 'Dead',
      manaCost: '{R}',
      typeLine: 'Instant',
      rulesText: 'Dead deals 2 damage to target creature.',
      imageUrl: image('Dead // Gone'),
    }),
    face({
      name: 'Gone',
      manaCost: '{2}{R}',
      typeLine: 'Instant',
      rulesText: "Return target creature you don't control to its owner's hand.",
      imageUrl: image('Dead // Gone'),
    }),
  ],
})

const beanstalkGiant = card({
  name: 'Beanstalk Giant',
  setCode: 'ELD',
  rarity: 'Uncommon',
  manaCost: '{6}{G}',
  typeLine: 'Creature — Giant',
  powerToughness: '*/*',
  faceLayout: 'Adventure',
  linkedFaces: [
    face({
      name: 'Beanstalk Giant',
      manaCost: '{6}{G}',
      typeLine: 'Creature — Giant',
      rulesText:
        "Beanstalk Giant's power and toughness are each equal to the number of lands you control.",
      powerToughness: '*/*',
      imageUrl: image('Beanstalk Giant'),
    }),
    face({
      name: 'Fertile Footsteps',
      manaCost: '{2}{G}',
      typeLine: 'Sorcery — Adventure',
      rulesText:
        'Search your library for a basic land card, put it onto the battlefield, then shuffle.',
      imageUrl: image('Beanstalk Giant'),
    }),
  ],
})

const delver = card({
  name: 'Delver of Secrets',
  setCode: 'ISD',
  rarity: 'Common',
  manaCost: '{U}',
  typeLine: 'Creature — Human Wizard',
  rulesText:
    'At the beginning of your upkeep, look at the top card of your library. You may reveal it. If an instant or sorcery card is revealed this way, transform Delver of Secrets.',
  powerToughness: '1/1',
  faceLayout: 'Transform',
  imageUrl: image('Delver of Secrets', 'front'),
  linkedFaces: [
    face({
      name: 'Insectile Aberration',
      typeLine: 'Creature — Human Insect',
      rulesText: 'Flying',
      powerToughness: '3/2',
      imageUrl: image('Delver of Secrets', 'back'),
    }),
  ],
})

const room = card({
  name: 'Surgical Suite // Hospital Room',
  typeLine: 'Enchantment — Room',
  faceLayout: 'Split',
  linkedFaces: [
    face({
      name: 'Surgical Suite',
      manaCost: '{1}{W}',
      typeLine: 'Enchantment — Room',
      rulesText:
        'When you unlock this door, return a small creature card from your graveyard to the battlefield.',
      imageUrl: image('Surgical Suite // Hospital Room'),
    }),
    face({
      name: 'Hospital Room',
      manaCost: '{3}{W}',
      typeLine: 'Enchantment — Room',
      rulesText: 'Whenever you attack, put a +1/+1 counter on target attacking creature.',
      imageUrl: image('Surgical Suite // Hospital Room'),
    }),
  ],
  roomDoors: [
    { grpId: 1, name: 'Surgical Suite', manaCost: '{1}{W}', unlocked: true },
    { grpId: 2, name: 'Hospital Room', manaCost: '{3}{W}', unlocked: false },
  ],
})

const rangerClass = card({
  name: 'Ranger Class',
  manaCost: '{1}{G}',
  typeLine: 'Enchantment — Class',
  rulesText:
    '(Gain the next level as a sorcery to add its ability.)\nWhen Ranger Class enters, create a 2/2 green Wolf creature token.\n{1}{G}: Level 2\nWhenever you attack, put a +1/+1 counter on target attacking creature.\n{3}{G}: Level 3\nYou may look at the top card of your library any time.\nYou may cast creature spells from the top of your library.',
  classLevel: 2,
  imageUrl: image('Ranger Class'),
})

const solvedCase = card({
  name: 'Case of the Uneaten Feast',
  manaCost: '{W}',
  typeLine: 'Enchantment — Case',
  rulesText:
    "Whenever a creature you control enters, you gain 1 life.\nTo solve — You've gained 5 or more life this turn.\nSolved — Sacrifice this Case: Creature cards in your graveyard gain an ability until end of turn.",
  solved: true,
  imageUrl: image('Case of the Uneaten Feast'),
})

const leveler = card({
  name: 'Student of Warfare',
  manaCost: '{W}',
  typeLine: 'Creature — Human Knight',
  rulesText: 'Level up {W}\nLEVEL 2-6\n3/3\nFirst strike\nLEVEL 7+\n4/4\nDouble strike',
  powerToughness: '3/3',
  counters: [{ type: 1, name: 'Level', count: 4 }],
  imageUrl: image('Student of Warfare'),
})

const supplemental = card({
  name: 'Lost Mine of Phandelver',
  typeLine: 'Dungeon',
  rulesText:
    'Cave Entrance — Scry 1.\nGoblin Lair — Create a 1/1 Goblin creature token.\nDark Pool — Each opponent loses 1 life and you gain 1 life.',
  imageUrl: image('Lost Mine of Phandelver'),
})

const layoutViews = [
  restorationOfEiganjo,
  liliana,
  invasion,
  deadGone,
  beanstalkGiant,
  delver,
  room,
  rangerClass,
  solvedCase,
  supplemental,
]

const ordinaryViews = [
  llanowarElves,
  lightningBolt,
  dualLand,
  longMulticolorCard,
  card({
    name: 'Mox Pearl',
    manaCost: '{0}',
    typeLine: 'Artifact',
    rulesText: '{T}: Add {W}.',
    imageUrl: image('Mox Pearl'),
  }),
  card({
    name: 'Pacifism',
    manaCost: '{1}{W}',
    typeLine: 'Enchantment — Aura',
    rulesText: "Enchant creature\nEnchanted creature can't attack or block.",
    imageUrl: image('Pacifism'),
  }),
  card({
    name: 'Wolf Token',
    typeLine: 'Token Creature — Wolf',
    powerToughness: '2/2',
    imageUrl: image('Wolf Token'),
  }),
]

const dynamicViews: CardView[] = [
  { ...liliana, counters: [{ type: 1, name: 'Loyalty', count: 1 }] },
  { ...invasion, counters: [{ type: 2, name: 'Defense', count: 1 }] },
  room,
  rangerClass,
  solvedCase,
  leveler,
  { ...llanowarElves, powerToughness: '4/4', grantedKeywords: ['Flying'] },
  { ...llanowarElves, name: 'Hidden identity', faceDown: true },
]

export { ordinaryViews, layoutViews, dynamicViews, lightningBolt, longMulticolorCard }
export const textViews = { short: marwyn, dense: yuriko, 'mana-heavy': longMulticolorCard }

function card(values: Partial<CardView> & Pick<CardView, 'name' | 'typeLine'>): CardView {
  return {
    instanceId: ++nextId,
    grpId: nextId,
    manaCost: '',
    powerToughness: '',
    rulesText: '',
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

function face(
  values: Partial<CardFaceView> & Pick<CardFaceView, 'name' | 'typeLine'>,
): CardFaceView {
  return {
    grpId: ++nextId,
    manaCost: '',
    powerToughness: '',
    rulesText: '',
    imageUrl: '',
    ...values,
  }
}

function image(name: string, faceName?: 'front' | 'back'): string {
  const faceParam = faceName ? `&face=${faceName}` : ''
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=art_crop${faceParam}`
}
