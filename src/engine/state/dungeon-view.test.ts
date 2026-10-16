import { expect, test } from 'bun:test'
import { dungeonViews } from './dungeon-view'
import type { CardMeta, ProtoObject } from './gre-state'

const meta = new Map<number, CardMeta>([
  [
    78769,
    {
      grpId: 78769,
      name: 'Lost Mine of Phandelver',
      imageUrl: 'https://example.test/dungeon.jpg',
      abilities: {
        146074: { text: 'Goblin Lair — Create a Goblin token.' },
      },
    },
  ],
])

function status(
  dungeon: number | null,
  room: number | null,
  completed: number[] = [],
): ProtoObject {
  return {
    id: 609,
    type: [86],
    affectorId: 1,
    affectedIds: [1],
    details: [
      {
        key: 'CurrentDungeon',
        ...(dungeon ? { valueInt32: [dungeon] } : { valueString: ['nil'] }),
      },
      { key: 'CurrentRoom', ...(room ? { valueInt32: [room] } : { valueString: ['nil'] }) },
      {
        key: 'CurrentDungeonZCID',
        ...(dungeon ? { valueInt32: [401] } : { valueString: ['nil'] }),
      },
      { key: 'AllDungeonsCompleted', valueInt32: completed },
    ],
  }
}

test('projects the current room and retains completed history through reentry', () => {
  const active = dungeonViews([status(78769, 146074)], meta).get(1)
  expect(active).toEqual({
    instanceId: 401,
    grpId: 78769,
    name: 'Lost Mine of Phandelver',
    imageUrl: 'https://example.test/dungeon.jpg',
    rulesText: null,
    room: 'Goblin Lair',
    completed: [],
  })
  const complete = dungeonViews([status(null, null, [78769])], meta).get(1)
  expect(complete).toMatchObject({ name: null, room: null, completed: ['Lost Mine of Phandelver'] })
  const reentered = dungeonViews([status(78769, 146074, [78769])], meta).get(1)
  expect(reentered).toMatchObject({ room: 'Goblin Lair', completed: ['Lost Mine of Phandelver'] })
})

test('ignores unrelated persistent rows and keeps progress with unavailable metadata', () => {
  expect(dungeonViews([{ type: [45], affectorId: 1 }], meta).size).toBe(0)
  expect(dungeonViews([status(999, 444)], new Map()).get(1)).toMatchObject({
    name: 'Dungeon 999',
    room: 'Room 444',
    completed: [],
  })
})
