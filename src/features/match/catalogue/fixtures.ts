import { optionalActionInstruction } from '@engine/runtime/prompts/optional-action'
import { mulliganInstruction } from '@engine/runtime/prompts/mulligan'
import { attackersInstruction } from '@engine/runtime/prompts/attackers'
import { numericInstruction } from '@engine/runtime/prompts/numeric'
import { selectionInstruction } from '@engine/runtime/prompts/selection'
import { castingInstruction } from '@engine/runtime/prompts/casting'
import { replacementInstruction } from '@engine/runtime/prompts/replacement'
import { targetingInstruction } from '@engine/runtime/prompts/targeting'
import type { BoardSnapshot } from '@engine/runtime/snapshot'
import { applyGsm, EMPTY_GAME_STATE } from '@engine/state/gre-accumulator'
import { buildBoardProjection } from '@engine/state/gre-projection'
import {
  ACTION_CAST,
  ACTION_CAST_ADVENTURE,
  GAME_OBJECT_TYPE_ABILITY,
  GAME_STATE_TYPE_FULL,
  ZONE_BATTLEFIELD,
  ZONE_EXILE,
  ZONE_GRAVEYARD,
  type CardMeta,
  type PromptView,
  type ProtoObject,
} from '@engine/state/gre-state'
import { createFixture } from './fixture-builder'

const ART = {
  llanowarElves:
    'https://cards.scryfall.io/normal/front/6/a/6a0b230b-d391-4998-a3f7-7b158a0ec2cd.jpg',
  questingBeast:
    'https://cards.scryfall.io/normal/front/e/4/e41cf82d-3213-47ce-a015-6e51a8b07e4f.jpg',
  wallOfOmens:
    'https://cards.scryfall.io/normal/front/3/d/3d134bb2-17ec-4e65-976e-f06fa983f3fb.jpg',
  thalia: 'https://cards.scryfall.io/normal/front/c/9/c9f8b8fb-1cd8-450e-a1fe-892e7a323479.jpg',
  lightningBolt:
    'https://cards.scryfall.io/normal/front/7/6/7673784e-db4b-43a1-8d55-1bb9fc1e284f.jpg',
  giantGrowth:
    'https://cards.scryfall.io/normal/front/f/d/fd1f95bf-48ea-455a-8a6c-0249b11c8900.jpg',
  beastWithin:
    'https://cards.scryfall.io/normal/front/4/0/400b43aa-c1d2-4435-b863-061f43889422.jpg',
  opt: 'https://cards.scryfall.io/normal/front/b/b/bbc99a51-1501-4525-a3cc-f48249b64bed.jpg',
  treasure: 'https://cards.scryfall.io/normal/back/2/1/21f5880d-6272-4ba8-bdf8-f9a7e54a3336.jpg',
  pacifism: 'https://cards.scryfall.io/normal/front/4/3/433eed50-81af-4a59-b624-57b6f5f1bb0f.jpg',
  restoration:
    'https://cards.scryfall.io/normal/front/a/1/a11a33ae-e7fa-4bd4-8cd8-3a3239a29bcc.jpg?1783923920',
} as const

export function midgameBoard(): BoardSnapshot {
  const { action, board, card, land } = createFixture(100)
  const questingBeast = card('Questing Beast', {
    pt: '4/4',
    mana: '{2}{G}{G}',
    type: 'Creature — Beast',
    keywords: ['Vigilance', 'Deathtouch', 'Haste'],
    mechanicHelp: [
      {
        keyword: 'Vigilance',
        title: 'Vigilance',
        description: "Attacking doesn't cause this creature to tap.",
      },
      {
        keyword: 'Deathtouch',
        title: 'Deathtouch',
        description: 'Any amount of damage this deals to a creature is enough to destroy it.',
      },
      {
        keyword: 'Haste',
        title: 'Haste',
        description: 'This creature can attack and tap as soon as it comes under your control.',
      },
    ],
    rules:
      "Vigilance, deathtouch, haste\nQuesting Beast can't be blocked by creatures with power 2 or less.\nCombat damage that would be dealt by creatures you control can't be prevented.\nWhenever Questing Beast deals combat damage to an opponent, it deals that much damage to target planeswalker that player controls.",
    art: ART.questingBeast,
  })
  const optOnStack = card('Opt', {
    mana: '{U}',
    type: 'Instant',
    rules: 'Scry 1.\nDraw a card.',
    owner: 'opponent',
    art: ART.opt,
  })
  const bolt = card('Lightning Bolt', {
    mana: '{R}',
    type: 'Instant',
    rules: 'Lightning Bolt deals 3 damage to any target.',
    playable: true,
    art: ART.lightningBolt,
  })
  const forest = land('Forest', { playable: true })
  const snapshot = board({
    turnNumber: 6,
    life: [17, 14],
    battlefield: [
      land('Forest', { tapped: true }),
      land('Forest'),
      land('Forest'),
      land('Mountain', { tapped: true }),
      card('Llanowar Elves', {
        pt: '1/1',
        mana: '{G}',
        type: 'Creature — Elf Druid',
        activatable: true,
        art: ART.llanowarElves,
      }),
      questingBeast,
      card('Treasure', { type: 'Artifact — Treasure', art: ART.treasure }),
    ],
    opponentBattlefield: [
      land('Island', { tapped: true, owner: 'opponent' }),
      land('Plains', { owner: 'opponent' }),
      card('Wall of Omens', {
        pt: '0/4',
        mana: '{1}{W}',
        type: 'Creature — Wall',
        keywords: ['Defender'],
        owner: 'opponent',
        art: ART.wallOfOmens,
      }),
      card('Thalia, Guardian of Thraben', {
        pt: '2/1',
        mana: '{1}{W}',
        type: 'Legendary Creature — Human Soldier',
        owner: 'opponent',
        art: ART.thalia,
      }),
    ],
    hand: [
      bolt,
      card('Giant Growth', {
        mana: '{G}',
        type: 'Instant',
        rules: 'Target creature gets +3/+3 until end of turn.',
        playable: true,
        art: ART.giantGrowth,
      }),
      card('Beast Within', {
        mana: '{2}{G}',
        type: 'Instant',
        rules: 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
        art: ART.beastWithin,
      }),
      card('Llanowar Elves', {
        pt: '1/1',
        mana: '{G}',
        type: 'Creature — Elf Druid',
        rules: '{T}: Add {G}.',
        playable: true,
        art: ART.llanowarElves,
      }),
      card('The Restoration of Eiganjo', {
        mana: '{2}{W}',
        type: 'Enchantment — Saga',
        rules:
          '(As this Saga enters and after your draw step, add a lore counter.)\nI — Search your library for a basic Plains card, reveal it, put it into your hand, then shuffle.\nII — You may discard a card. When you do, return target permanent card with mana value 2 or less from your graveyard to the battlefield tapped.\nIII — Exile this Saga, then return it to the battlefield transformed under your control.',
        art: ART.restoration,
      }),
      forest,
    ],
    stack: [optOnStack],
    targetArrows: [
      {
        id: 'midgame-target',
        kind: 'targetSpec',
        from: String(optOnStack.instanceId),
        to: String(questingBeast.instanceId),
      },
    ],
    graveyard: [card('Giant Growth', { mana: '{G}', art: ART.giantGrowth }), land('Mountain')],
    opponentGraveyard: [card('Opt', { mana: '{U}', owner: 'opponent', art: ART.opt })],
    legalActions: [
      action('Cast Lightning Bolt', { card: bolt }),
      action('Play Forest', { card: forest }),
    ],
  })
  snapshot.viewer = { ...snapshot.viewer, counters: [{ type: 35, name: 'Energy', count: 3 }] }
  snapshot.opponent = { ...snapshot.opponent!, counters: [{ type: 3, name: 'Poison', count: 2 }] }
  return snapshot
}

export type CrowdedVariant = 'hand and stack' | 'dense support'

export function crowdedBoard(variant: CrowdedVariant = 'hand and stack'): BoardSnapshot {
  const fixture = createFixture(1000)
  const base = midgameBoard()
  base.viewer = {
    ...base.viewer,
    counters: [
      { type: 3, name: 'Poison', count: 8 },
      { type: 35, name: 'Energy', count: 1200 },
      { type: 175, name: 'Experience', count: 2400 },
    ],
  }
  const beast = base.battlefield.find((candidate) => candidate.name === 'Questing Beast')!
  const wall = base.opponentBattlefield.find((candidate) => candidate.name === 'Wall of Omens')!
  if (variant === 'dense support') {
    const support = (owner?: 'opponent') => [
      fixture.land('Forest', { owner }),
      fixture.land('Island', { owner }),
      fixture.land('Plains', { owner }),
      fixture.land('Mountain', { owner }),
      fixture.card('Treasure', { type: 'Artifact — Treasure', owner }),
      fixture.card('Clue', { type: 'Artifact — Clue', owner }),
      fixture.card('Food', { type: 'Artifact — Food', owner }),
      fixture.card('Map', { type: 'Artifact — Map', owner }),
      fixture.card('Powerstone', { type: 'Artifact — Powerstone', owner }),
    ]
    return {
      ...base,
      battlefield: support(),
      opponentBattlefield: support('opponent'),
      targetArrows: [],
    }
  }
  return {
    ...base,
    hand: [
      ...base.hand,
      ...base.hand.map((card, index) => ({ ...card, instanceId: 1100 + index })),
    ],
    battlefield: [
      ...base.battlefield,
      ...Array.from({ length: 6 }, (_, index) => ({ ...beast, instanceId: 1200 + index })),
    ],
    opponentBattlefield: [
      ...base.opponentBattlefield,
      ...Array.from({ length: 5 }, (_, index) => ({ ...wall, instanceId: 1300 + index })),
    ],
    stack: [
      {
        ...fixture.card('Llanowar Elves', { owner: 'opponent' }),
        objectType: GAME_OBJECT_TYPE_ABILITY,
      },
      ...Array.from({ length: 5 }, (_, index) => ({ ...base.stack[0]!, instanceId: 1404 - index })),
    ],
    stackCount: 6,
    targetArrows: [],
  }
}

export function targetingBoard(): BoardSnapshot {
  const { board, card } = createFixture(2000)
  const goblin = card('Raging Goblin', {
    grpId: 94612,
    pt: '1/1',
    mana: '{R}',
    type: 'Creature — Goblin',
  })
  const spell = card('Shock', { mana: '{R}', type: 'Instant' })
  const targetsView: Extract<PromptView, { kind: 'targets' }> = {
    interactionKey: 1,
    kind: 'targets',
    message: 'SelectTargetsReq',
    source: { instanceId: spell.instanceId, name: 'Shock' },
    targetGroups: [{ index: 1, min: 1, max: 1, selected: 1 }],
    candidates: [
      {
        targetInstanceId: goblin.instanceId,
        targetIdx: 0,
        legalAction: 1,
        name: goblin.name,
        grpId: goblin.grpId,
        selected: false,
      },
      {
        targetInstanceId: 1,
        targetIdx: 0,
        legalAction: 1,
        name: 'You',
        grpId: 0,
        selected: false,
      },
      {
        targetInstanceId: 2,
        targetIdx: 0,
        legalAction: 2,
        name: 'Opponent',
        grpId: 0,
        selected: true,
      },
    ],
    canSubmit: true,
    waiting: false,
  }
  return {
    ...board({ battlefield: [goblin], stack: [spell] }),
    prompt: {
      ...targetsView,
      instruction: targetingInstruction(targetsView),
    },
  }
}

export function replacementBoard(): BoardSnapshot {
  const { board, card } = createFixture(2500)
  const fieryTemper = card('Fiery Temper', { mana: '{1}{R}{R}', type: 'Instant' })
  const kitchenImp = card('Kitchen Imp', { mana: '{3}{B}', type: 'Creature — Imp' })
  const replacementView: Extract<PromptView, { kind: 'replacement' }> = {
    interactionKey: 1,
    kind: 'replacement',
    message: 'SelectReplacementReq',
    replacementCandidates: [
      {
        replacementEffectId: 501,
        sourceInstanceId: fieryTemper.instanceId,
        name: fieryTemper.name,
        detail: 'Madness {R}',
      },
      {
        replacementEffectId: 502,
        sourceInstanceId: kitchenImp.instanceId,
        name: kitchenImp.name,
        detail: 'Madness {B}',
      },
    ],
    waiting: false,
  }
  return {
    ...board({ hand: [fieryTemper, kitchenImp] }),
    prompt: {
      ...replacementView,
      instruction: replacementInstruction(replacementView),
    },
  }
}

export type CastingVariant = 'single mode' | 'multiple modes'

export function castingBoard(variant: CastingVariant): BoardSnapshot {
  const { board, card } = createFixture(3000)
  if (variant === 'multiple modes') {
    const spell = card('Requisition Raid', { grpId: 90372, mana: '{W}', type: 'Sorcery' })
    const castingOptionsView: Extract<PromptView, { kind: 'castingOptions' }> = {
      interactionKey: 1,
      kind: 'castingOptions',
      message: 'Choose modes for Requisition Raid',
      castingOptions: [
        {
          interactionKey: 1,
          ctoId: 2,
          optionType: 10,
          grpId: 90372,
          abilityGrpId: 173711,
          minSelect: 1,
          maxSelect: 2,
          selectionPayable: true,
          label: 'Spree',
          manaColors: [],
          selectedManaColor: null,
          modalOptions: [
            {
              index: 0,
              grpId: 171743,
              label: '+ {1} — Destroy target artifact.',
              additionalCost: '{1}',
              available: true,
              selectable: true,
              selected: true,
            },
            {
              index: 1,
              grpId: 171745,
              label: '+ {1} — Put a +1/+1 counter on each creature target player controls.',
              additionalCost: '{1}',
              available: true,
              selectable: true,
              selected: true,
            },
            {
              index: 2,
              grpId: 171744,
              label: '+ {1} — Destroy target enchantment.',
              additionalCost: '{1}',
              available: false,
              selectable: false,
              selected: false,
            },
          ],
          selectNOptions: [],
        },
      ],
    }
    return {
      ...board({
        stack: [spell],
        opponentBattlefield: [card('Treasure', { type: 'Artifact — Treasure', owner: 'opponent' })],
      }),
      prompt: {
        ...castingOptionsView,
        instruction: castingInstruction(castingOptionsView),
      },
    }
  }
  const spell = card('Ice Magic', { grpId: 95912, mana: '{1}{U}', type: 'Instant' })
  const castingOptionsView: Extract<PromptView, { kind: 'castingOptions' }> = {
    interactionKey: 1,
    kind: 'castingOptions',
    message: 'Choose how to cast Ice Magic',
    castingOptions: [
      {
        interactionKey: 1,
        ctoId: 9,
        optionType: 10,
        grpId: 95912,
        abilityGrpId: 189137,
        minSelect: 1,
        maxSelect: 1,
        selectionPayable: false,
        label: 'Choose a mode',
        manaColors: [],
        selectedManaColor: null,
        modalOptions: [
          {
            index: 0,
            grpId: 189134,
            label: "Blizzard — {0} — Return target creature to its owner's hand.",
            additionalCost: '{0}',
            available: true,
            selectable: true,
            selected: false,
          },
          {
            index: 1,
            grpId: 189135,
            label:
              "Blizzara — {2} — Target creature's owner puts it on their choice of the top or bottom of their library.",
            additionalCost: '{2}',
            available: true,
            selectable: true,
            selected: false,
          },
          {
            index: 2,
            grpId: 189136,
            label: "Blizzaga — {5}{U} — Target creature's owner shuffles it into their library.",
            additionalCost: '{5}{U}',
            available: true,
            selectable: true,
            selected: false,
          },
        ],
        selectNOptions: [],
      },
    ],
  }
  const prompt: PromptView = {
    ...castingOptionsView,
    instruction: castingInstruction(castingOptionsView),
  }
  return { ...board({ stack: [spell] }), prompt }
}

export type SelectionVariant = 'text choices' | 'card choices'

export function selectionBoard(variant: SelectionVariant): BoardSnapshot {
  const { board, card } = createFixture(4000)
  const hand = [
    card('Lightning Bolt', { grpId: 1001, mana: '{R}', art: ART.lightningBolt }),
    card('Giant Growth', { grpId: 1002, mana: '{G}', art: ART.giantGrowth }),
    card('Opt', { grpId: 1003, mana: '{U}', art: ART.opt }),
  ]
  const selectNView: Extract<PromptView, { kind: 'selectN' }> = {
    interactionKey: 1,
    kind: 'selectN',
    message: variant === 'card choices' ? 'Choose a card' : 'SelectNReq (1/2 selected)',
    selectNCandidates:
      variant === 'card choices'
        ? hand.map((candidate) => ({
            interactionKey: 1,
            instanceId: candidate.instanceId,
            grpId: candidate.grpId,
            name: candidate.name,
            zoneType: 2,
            selected: false,
            staticChoice: false,
          }))
        : [
            {
              interactionKey: 1,
              instanceId: 1,
              grpId: 0,
              name: 'White',
              zoneType: 0,
              selected: true,
              staticChoice: true,
            },
            {
              interactionKey: 1,
              instanceId: 2,
              grpId: 0,
              name: 'Blue',
              zoneType: 0,
              selected: false,
              staticChoice: true,
            },
            {
              interactionKey: 1,
              instanceId: 3,
              grpId: 0,
              name: 'Black',
              zoneType: 0,
              selected: false,
              staticChoice: true,
            },
          ],
    minSelect: 1,
    maxSelect: variant === 'card choices' ? 1 : 2,
    canSubmit: variant !== 'card choices',
  }
  return {
    ...board({
      hand: variant === 'card choices' ? hand : [],
      stack: [card('Collected Company', { mana: '{3}{G}', type: 'Instant' })],
    }),
    prompt: {
      ...selectNView,
      instruction: selectionInstruction(selectNView),
    },
  }
}

export type NumericInputVariant = 'minimum' | 'chosen' | 'maximum' | 'waiting'

export function numericInputBoard(variant: NumericInputVariant): BoardSnapshot {
  const { board, card } = createFixture(4500)
  const source = card('Wildborn Preserver', {
    mana: '{1}{G}',
    pt: '2/2',
    type: 'Creature — Elf Archer',
  })
  const value = variant === 'minimum' ? 0 : variant === 'maximum' ? 3 : 2
  const waiting = variant === 'waiting'
  const numericInputView: Extract<PromptView, { kind: 'numericInput' }> = {
    interactionKey: 1,
    kind: 'numericInput',
    decrementEnabled: value > 0,
    incrementEnabled: value < 3,
    message: 'Choose X for Wildborn Preserver',
    numericValue: value,
    numericMin: 0,
    numericMax: 3,
    numericStep: 1,
    canSubmit: !waiting,
    waiting,
  }
  return {
    ...board({ battlefield: [source] }),
    prompt: {
      ...numericInputView,
      instruction: numericInstruction(numericInputView),
    },
  }
}

export function combatBoard(): BoardSnapshot {
  const { board, card } = createFixture(5000)
  const goblin = card('Raging Goblin', {
    grpId: 94612,
    pt: '1/1',
    mana: '{R}',
    type: 'Creature — Goblin',
  })
  const attackersView: Extract<PromptView, { kind: 'attackers' }> = {
    interactionKey: 1,
    kind: 'attackers',
    message: 'DeclareAttackersReq',
    attackers: [
      {
        attackerInstanceId: goblin.instanceId,
        optionIndex: 0,
        damageRecipient: { type: 1, playerSystemSeatId: 2 },
        damageRecipientKey: '1:0:2:0',
        damageRecipientName: 'Opponent',
        name: goblin.name,
        grpId: goblin.grpId,
        selected: true,
      },
    ],
    canSubmit: true,
    waiting: false,
  }
  return {
    ...board({ battlefield: [goblin] }),
    prompt: {
      ...attackersView,
      instruction: attackersInstruction(attackersView),
    },
  }
}

export function openingHandBoard(): BoardSnapshot {
  const { board, card, land } = createFixture(5500)
  const hand = [
    land('Forest'),
    land('Forest'),
    land('Island'),
    card('Llanowar Elves', {
      pt: '1/1',
      mana: '{G}',
      type: 'Creature — Elf Druid',
      art: ART.llanowarElves,
    }),
    card('Opt', { mana: '{U}', type: 'Instant', art: ART.opt }),
    card('Giant Growth', { mana: '{G}', type: 'Instant', art: ART.giantGrowth }),
    card('Questing Beast', {
      pt: '4/4',
      mana: '{2}{G}{G}',
      type: 'Creature — Beast',
      art: ART.questingBeast,
    }),
  ]
  const mulliganView: Extract<PromptView, { kind: 'mulligan' }> = {
    kind: 'mulligan',
    result: 'Keep or mulligan',
    message: 'Your opening hand',
    interactionKey: 1,
    waiting: false,
    canSubmit: true,
  }
  return {
    ...board({ hand, opponentHandCount: 7, libraryCount: 53, turnNumber: 0, phase: '-' }),
    canPass: false,
    prompt: {
      ...mulliganView,
      instruction: mulliganInstruction(mulliganView),
    },
  }
}

export function outsideHandBoard(): BoardSnapshot {
  const { action, board, card, land } = createFixture(6000)
  const bolt = card('Lightning Bolt', {
    grpId: 1101,
    mana: '{R}',
    type: 'Instant',
    art: ART.lightningBolt,
  })
  const familiar = card('Bramble Familiar', {
    grpId: 901,
    mana: '{1}{G}',
    type: 'Creature — Elemental Raccoon',
  })
  const fetchQuest = {
    ...familiar,
    grpId: 902,
    name: 'Fetch Quest',
    typeLine: 'Sorcery — Adventure',
  }
  const extras = Array.from({ length: 8 }, (_, index) =>
    card(`Playable spell ${index + 1}`, { mana: '{1}{U}' }),
  )
  const actions = [
    action('Cast Lightning Bolt (Flashback) from graveyard', {
      card: bolt,
      actionType: ACTION_CAST,
      zoneType: ZONE_GRAVEYARD,
      abilityGrpId: 35,
    }),
    action('Cast Bramble Familiar (Adventure) from exile', {
      card: familiar,
      actionType: ACTION_CAST_ADVENTURE,
      zoneType: ZONE_EXILE,
      facetId: 11,
      uniqueAbilityId: 701,
    }),
    action('Cast Bramble Familiar (Adventure alternate) from exile', {
      card: familiar,
      actionType: ACTION_CAST_ADVENTURE,
      zoneType: ZONE_EXILE,
      facetId: 11,
      uniqueAbilityId: 702,
    }),
    action('Use Bramble Familiar from exile', {
      card: familiar,
      actionType: 99,
      zoneType: ZONE_EXILE,
    }),
    action('Cast Fetch Quest from exile', {
      card: fetchQuest,
      actionType: ACTION_CAST_ADVENTURE,
      zoneType: ZONE_EXILE,
      facetId: 12,
      uniqueAbilityId: 703,
    }),
    action('Cast Fetch Quest (alternate) from exile', {
      card: fetchQuest,
      actionType: ACTION_CAST_ADVENTURE,
      zoneType: ZONE_EXILE,
      facetId: 12,
      uniqueAbilityId: 704,
    }),
    ...extras.map((candidate, index) =>
      action(`Cast ${candidate.name}`, {
        card: candidate,
        actionType: ACTION_CAST,
        zoneType: index < 4 ? ZONE_GRAVEYARD : ZONE_EXILE,
      }),
    ),
  ]
  return board({
    hand: [card('Giant Growth', { mana: '{G}', art: ART.giantGrowth }), land('Forest')],
    graveyard: [bolt, land('Mountain'), ...extras.slice(0, 4)],
    exile: [familiar, ...extras.slice(4)],
    legalActions: actions,
    nonHandActionCards: [
      ...actions.slice(1, 4).map((legalAction) => ({ action: legalAction, card: familiar })),
      ...actions.slice(4, 6).map((legalAction) => ({ action: legalAction, card: fetchQuest })),
    ],
  })
}

export function replayDecisionBoard(): BoardSnapshot {
  const board = castingBoard('multiple modes')
  const card = createFixture(6500).card('Giant Growth', {
    mana: '{G}',
    type: 'Instant',
    art: ART.giantGrowth,
  })
  return { ...board, graveyard: [card], viewer: { ...board.viewer, graveyardCount: 1 } }
}

export function tallStackDecisionBoard(): BoardSnapshot {
  const board = crowdedBoard()
  const optionalActionView: Extract<PromptView, { kind: 'optionalAction' }> = {
    interactionKey: 1,
    kind: 'optionalAction',
    message: 'Optional action for Coastal Piracy',
    result: "Choose whether to use Coastal Piracy's optional effect.",
    canSubmit: true,
  }
  return {
    ...board,
    stack: [{ ...board.stack[1]!, instanceId: 6600 }, ...board.stack],
    stackCount: 7,
    prompt: {
      ...optionalActionView,
      instruction: optionalActionInstruction(optionalActionView),
    },
  }
}

export function interruptedBoard(): BoardSnapshot {
  return { ...midgameBoard(), connected: false, status: 'disconnected' }
}

export function outcomeBoard(): BoardSnapshot {
  return {
    ...midgameBoard(),
    gameOver: true,
    outcome: {
      resultType: 3,
      reason: 1,
      winningTeamId: 1,
      viewerTeamId: 1,
      viewerResult: 'win',
      title: 'Victory',
      detail: 'You won the game.',
    },
    legalActions: [],
    canPass: false,
  }
}

export type AttachmentStage = 'attached' | 'counter changed' | 'reattached'

const attachmentMetadata = new Map<number, CardMeta>([
  [
    101,
    {
      grpId: 101,
      name: "Ajani's Pridemate",
      types: 'Creature',
      subtypes: 'Cat Soldier',
      manaCost: '{1}{W}',
      power: '2',
      toughness: '2',
      imageUrl: null,
    },
  ],
  [
    102,
    {
      grpId: 102,
      name: 'Pacifism',
      types: 'Enchantment',
      subtypes: 'Aura',
      manaCost: '{1}{W}',
      imageUrl: null,
    },
  ],
  [
    103,
    {
      grpId: 103,
      name: 'Swiftfoot Boots',
      types: 'Artifact',
      subtypes: 'Equipment',
      manaCost: '{2}',
      imageUrl: null,
    },
  ],
  [
    104,
    {
      grpId: 104,
      name: 'Llanowar Elves',
      types: 'Creature',
      subtypes: 'Elf Druid',
      manaCost: '{G}',
      power: '1',
      toughness: '1',
      imageUrl: ART.llanowarElves,
    },
  ],
])

function counter(id: number, target: number, type: number, count: number): ProtoObject {
  return {
    id,
    type: [14],
    affectedIds: [target],
    details: [
      { key: 'counter_type', valueInt32: [type] },
      { key: 'count', valueInt32: [count] },
    ],
  }
}

function swiftfootKeywords(id: number, target: number): ProtoObject {
  return {
    id,
    type: [9, 51],
    affectorId: 103,
    affectedIds: [target],
    details: [
      { key: 'grpid', valueInt32: [7] },
      { key: 'grpid', valueInt32: [2] },
    ],
  }
}

export function attachmentsBoard(stage: AttachmentStage): BoardSnapshot {
  const objects = [
    {
      instanceId: 101,
      grpId: 101,
      controllerSeatId: 1,
      ownerSeatId: 1,
      power: { value: 7 },
      toughness: { value: 5 },
    },
    { instanceId: 102, grpId: 102, controllerSeatId: 2, ownerSeatId: 2 },
    { instanceId: 103, grpId: 103, controllerSeatId: 1, ownerSeatId: 1 },
    {
      instanceId: 104,
      grpId: 104,
      controllerSeatId: 2,
      ownerSeatId: 2,
      power: { value: 1 },
      toughness: { value: 1 },
    },
  ]
  const initial = applyGsm(EMPTY_GAME_STATE, {
    type: GAME_STATE_TYPE_FULL,
    gameStateId: 1,
    turnInfo: { activePlayer: 1, priorityPlayer: 1, turnNumber: 4, phase: 2 },
    players: [
      { systemSeatNumber: 1, lifeTotal: 23 },
      { systemSeatNumber: 2, lifeTotal: 20 },
    ],
    zones: [{ zoneId: 30, type: ZONE_BATTLEFIELD, objectInstanceIds: [101, 102, 103, 104] }],
    gameObjects: objects,
    persistentAnnotations: [
      { id: 1, type: [20], affectorId: 102, affectedIds: [101] },
      { id: 2, type: [20], affectorId: 103, affectedIds: [101] },
      counter(3, 101, 1, 3),
      counter(4, 104, 172, 2),
      swiftfootKeywords(5, 101),
    ],
  })
  const grown = applyGsm(initial, {
    gameStateId: 2,
    gameObjects: [{ ...objects[0], power: { value: 8 }, toughness: { value: 6 } }],
    persistentAnnotations: [counter(3, 101, 1, 4)],
  })
  const reattached = applyGsm(grown, {
    gameStateId: 3,
    gameObjects: [
      { ...objects[0], power: { value: 2 }, toughness: { value: 2 } },
      { ...objects[3], power: { value: 3 }, toughness: { value: 1 } },
    ],
    zones: [
      { zoneId: 30, type: ZONE_BATTLEFIELD, objectInstanceIds: [101, 103, 104] },
      { zoneId: 31, type: 5, ownerSeatId: 2, objectInstanceIds: [102] },
    ],
    diffDeletedPersistentAnnotationIds: [1, 3, 4, 5],
    persistentAnnotations: [
      { id: 2, type: [20], affectorId: 103, affectedIds: [104] },
      swiftfootKeywords(6, 104),
    ],
  })
  const state = stage === 'counter changed' ? grown : stage === 'reattached' ? reattached : initial
  const projection = buildBoardProjection(
    { ...state, actions: [{ actionType: 2, instanceId: 103, grpId: 103 }] },
    attachmentMetadata,
    false,
  )
  return { ...createFixture(7000).board(), ...projection, gameStateId: state.gameStateId }
}

export function motionBoards(): BoardSnapshot[] {
  const { board, card, land } = createFixture(8000)
  const bolt = card('Lightning Bolt', {
    id: 8101,
    grpId: 1101,
    mana: '{R}',
    type: 'Instant',
    art: ART.lightningBolt,
  })
  const forest = land('Forest', { id: 8102 })
  const base = board({
    hand: [bolt],
    battlefield: [forest],
    opponentBattlefield: [land('Mountain', { id: 8103, owner: 'opponent' })],
  })
  const cast = {
    ...base,
    gameStateId: 2,
    hand: [],
    stack: [bolt],
    stackCount: 1,
    presentation: {
      seq: 1,
      lagging: false,
      hints: [{ kind: 'cast' as const, affectedIds: [bolt.instanceId], category: 'CastSpell' }],
      moves: [
        {
          key: '1:8101:hand:stack',
          instanceId: bolt.instanceId,
          from: 'hand' as const,
          to: 'stack' as const,
          fromOwnerSeatId: 1,
          toOwnerSeatId: 0,
          card: bolt,
          category: 'CastSpell',
          hidden: false,
        },
      ],
    },
  }
  const resolved = {
    ...cast,
    gameStateId: 3,
    stack: [],
    stackCount: 0,
    graveyard: [bolt],
    opponent: cast.opponent ? { ...cast.opponent, lifeTotal: 17 } : null,
    presentation: {
      seq: 2,
      lagging: false,
      hints: [{ kind: 'resolve' as const, affectedIds: [bolt.instanceId], category: 'Resolve' }],
      moves: [
        {
          key: '2:8101:stack:graveyard',
          instanceId: bolt.instanceId,
          from: 'stack' as const,
          to: 'graveyard' as const,
          fromOwnerSeatId: 0,
          toOwnerSeatId: 1,
          card: bolt,
          category: 'Resolve',
          hidden: false,
        },
      ],
    },
  }
  return [base, cast, resolved]
}
