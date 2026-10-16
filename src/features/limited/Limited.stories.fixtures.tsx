import type { PropsWithChildren } from 'react'
import type { DraftCard, SealedSet } from '@shared/api/contracts'

function card(
  name: string,
  manaCost: string,
  typeLine: string,
  rarity: string,
  colors: string[],
  score: number,
): DraftCard {
  return {
    name,
    grpId: null,
    manaCost,
    typeLine,
    rarity,
    colors,
    setCode: 'FDN',
    collectorNumber: null,
    score,
  }
}

export const draftPack: DraftCard[] = [
  {
    ...card('Day of Judgment', '{2}{W}{W}', 'Sorcery', 'rare', ['W'], 86),
    rulesText: 'Destroy all creatures.',
  },
  card('Faebloom Trick', '{2}{U}', 'Instant', 'common', ['U'], 61),
  card('Hero’s Downfall', '{1}{B}{B}', 'Instant', 'rare', ['B'], 79),
  card('Burst Lightning', '{R}', 'Instant', 'uncommon', ['R'], 74),
  {
    ...card('Llanowar Elves', '{G}', 'Creature — Elf Druid', 'common', ['G'], 82),
    rulesText: '{T}: Add {G}.',
    power: '1',
    toughness: '1',
  },
  card('Empyrean Eagle', '{1}{W}{U}', 'Creature — Bird Spirit', 'uncommon', ['W', 'U'], 70),
  card('Solemn Simulacrum', '{4}', 'Artifact Creature — Golem', 'rare', [], 68),
  card('Evolving Wilds', '', 'Land', 'common', [], 55),
  card('Helpful Hunter', '{1}{W}', 'Creature — Cat', 'common', ['W'], 52),
  card('Think Twice', '{1}{U}', 'Instant', 'common', ['U'], 58),
  card('Stab', '{B}', 'Enchantment — Aura', 'common', ['B'], 49),
  card('Gorehorn Raider', '{3}{R}', 'Creature — Minotaur Warrior', 'common', ['R'], 47),
  card('Dwynen’s Elite', '{1}{G}', 'Creature — Elf Warrior', 'uncommon', ['G'], 65),
  card('Pilfer', '{1}{B}', 'Sorcery', 'common', ['B'], 42),
  card('Campus Guide', '{2}', 'Artifact Creature — Golem', 'common', [], 38),
]

export const draftedPool: DraftCard[] = [
  draftPack[4]!,
  draftPack[12]!,
  draftPack[3]!,
  draftPack[6]!,
  draftPack[0]!,
  draftPack[1]!,
  draftPack[7]!,
]

export const deckPool: DraftCard[] = Array.from({ length: 40 }, (_, index) => ({
  ...draftPack[index % draftPack.length]!,
  grpId: index + 1,
}))

export const limitedSets: SealedSet[] = [
  {
    code: 'FDN',
    name: 'Foundations',
    date: '2024-11-15',
    type: 'expansion',
    cardCount: 291,
    description: 'Core Magic themes with clear archetype signposts.',
    mechanics: ['Raid', 'Threshold'],
    archetypes: [
      { pair: 'WU', name: 'Flyers', strategy: 'Build an evasive tempo deck.' },
      { pair: 'BG', name: 'Morbid', strategy: 'Profit when creatures die.' },
    ],
  },
  {
    code: 'TDM',
    name: 'Tarkir: Dragonstorm',
    date: '2025-04-11',
    type: 'expansion',
    cardCount: 286,
    description: 'Clan pairs return alongside multicolour dragons.',
    mechanics: ['Mobilize', 'Omen'],
    archetypes: [
      { pair: 'UR', name: 'Spells', strategy: 'Chain spells and prowess threats.' },
      { pair: 'RG', name: 'Dragons', strategy: 'Ramp into oversized flyers.' },
    ],
  },
  {
    code: 'DSK',
    name: 'Duskmourn: House of Horror',
    date: '2024-09-27',
    type: 'expansion',
    cardCount: 276,
    description: 'Rooms, eerie creatures, and graveyard pressure.',
    mechanics: ['Eerie', 'Survival'],
    archetypes: [
      { pair: 'BR', name: 'Sacrifice', strategy: 'Turn expendable bodies into damage.' },
    ],
  },
]

export function LimitedStoryFrame({
  children,
  padded = true,
}: PropsWithChildren<{ padded?: boolean }>) {
  return (
    <div
      className="public-theme"
      style={{
        boxSizing: 'border-box',
        width: '100%',
        height: '100vh',
        padding: padded ? 32 : 0,
        overflow: 'hidden',
        background: 'var(--public-bg)',
        color: 'var(--public-text)',
      }}
    >
      {children}
    </div>
  )
}
