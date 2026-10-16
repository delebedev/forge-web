import { expect, test } from 'bun:test'
import {
  ACTION_CAST,
  ACTION_CAST_ADVENTURE,
  ACTION_CAST_LEFT_ROOM,
  ACTION_CAST_MDFC,
  ACTION_CAST_OMEN,
  ACTION_CAST_PROTOTYPE,
  ACTION_CAST_RIGHT_ROOM,
  ACTION_PASS,
  ACTION_PLAY_MDFC,
  type CardView,
  type LegalAction,
} from '@engine/state/gre-state'
import { hasPlayOf, opponentOnStackOf } from './priority-derive'

function card(partial: Partial<CardView>): CardView {
  return {
    instanceId: 1,
    grpId: 1,
    name: 'Card',
    controllerSeatId: 1,
    typeLine: '',
    manaCost: '',
    powerToughness: '',
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
    imageUrl: '',
    ...partial,
  }
}

function action(actionType: number, shouldStop = false): LegalAction {
  return {
    actionType,
    instanceId: 1,
    grpId: 1,
    facetId: 0,
    abilityGrpId: 0,
    uniqueAbilityId: 0,
    sourceId: 0,
    alternativeGrpId: 0,
    alternativeSourceZcid: 0,
    zoneType: 2,
    hasAlternativeCost: false,
    label: 'Action',
    cardName: 'Card',
    shouldStop,
  }
}

test('runtime stop-worthy card actions count as plays', () => {
  const variants = [
    ACTION_CAST,
    ACTION_CAST_ADVENTURE,
    ACTION_CAST_MDFC,
    ACTION_PLAY_MDFC,
    ACTION_CAST_PROTOTYPE,
    ACTION_CAST_LEFT_ROOM,
    ACTION_CAST_RIGHT_ROOM,
    ACTION_CAST_OMEN,
  ]

  for (const actionType of variants) {
    expect(hasPlayOf({ legalActions: [action(actionType, true)], nonHandActionCards: [] })).toBe(
      true,
    )
  }
  expect(hasPlayOf({ legalActions: [action(ACTION_PASS)], nonHandActionCards: [] })).toBe(false)
  expect(
    hasPlayOf({ legalActions: [], nonHandActionCards: [{ action: action(7), card: card({}) }] }),
  ).toBe(false)
})

test('opponent stack ownership is independent of whose turn it is', () => {
  const opponentSpell = card({ controllerSeatId: 2 })
  const ownSpell = card({ controllerSeatId: 1 })
  const opponentResponseDuringOurTurn = {
    stack: [opponentSpell],
    opponentSeatId: 2,
    activeSeatId: 1,
  }
  const ownSpellDuringOpponentTurn = { stack: [ownSpell], opponentSeatId: 2, activeSeatId: 2 }

  expect(opponentOnStackOf(opponentResponseDuringOurTurn)).toBe(true)
  expect(opponentOnStackOf(ownSpellDuringOpponentTurn)).toBe(false)
})

for (const topController of [1, 2]) {
  test(`opponent stack ownership follows top controller ${topController}`, () => {
    expect(
      opponentOnStackOf({
        opponentSeatId: 2,
        stack: [
          card({ controllerSeatId: topController }),
          card({ controllerSeatId: 3 - topController }),
        ],
      }),
    ).toBe(topController === 2)
  })
}

test('empty stack and absent opponent have no opponent entry', () => {
  expect(opponentOnStackOf({ stack: [], opponentSeatId: 2 })).toBe(false)
  expect(opponentOnStackOf({ stack: [card({ controllerSeatId: 0 })], opponentSeatId: 0 })).toBe(
    false,
  )
})
