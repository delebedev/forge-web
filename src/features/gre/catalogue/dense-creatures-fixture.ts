import { createFixture } from './fixture-builder'
import { midgameBoard } from './fixtures'

export function denseCreaturesBoard() {
  const { card } = createFixture(8000)
  const creatures = (owner?: 'opponent') =>
    Array.from({ length: 64 }, () =>
      card('Scute Swarm', { owner, type: 'Creature — Insect', pt: '1/1', mana: '{2}{G}' }),
    )
  const board = midgameBoard()
  return {
    ...board,
    battlefield: creatures(),
    opponentBattlefield: creatures('opponent'),
    stack: [],
    stackCount: 0,
    targetArrows: [],
    legalActions: [],
  }
}
