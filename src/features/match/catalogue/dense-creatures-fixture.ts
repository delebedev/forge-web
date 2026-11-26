import { createFixture } from './fixture-builder'
import { midgameBoard } from './fixtures'

export function denseCreaturesBoard() {
  const { card } = createFixture(8000)
  const creatures = (owner?: 'opponent') =>
    Array.from({ length: 64 }, (_, index) =>
      card('Scute Swarm', {
        owner,
        type: 'Creature — Insect',
        pt: '1/1',
        mana: '{2}{G}',
        tapped: index === 0,
      }),
    )
  const board = midgameBoard()
  const battlefield = creatures()
  const opponentBattlefield = creatures('opponent')
  const growth = card('Giant Growth', { type: 'Instant', mana: '{G}' })
  return {
    ...board,
    battlefield,
    opponentBattlefield,
    stack: [growth],
    stackCount: 1,
    targetArrows: [
      {
        id: 'dense-target',
        kind: 'targetSpec' as const,
        from: String(growth.instanceId),
        to: String(battlefield[0]!.instanceId),
      },
    ],
    legalActions: [],
  }
}
