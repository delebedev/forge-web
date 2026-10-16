import {
  annotationHasType,
  asArray,
  asNumber,
  dungeonRoomName,
  isRecord,
  type CardMeta,
  type CardView,
  type ProtoObject,
} from './gre-state'

export type DungeonView = {
  instanceId: number | null
  grpId: number | null
  name: string | null
  imageUrl: string | null
  rulesText: string | null
  room: string | null
  completed: string[]
}

export function dungeonCardIds(annotations: Iterable<ProtoObject>): number[] {
  const ids = new Set<number>()
  for (const annotation of annotations) {
    if (!annotationHasType(annotation, 86, 'DungeonStatus')) {
      continue
    }
    for (const detail of asArray(annotation['details'])) {
      if (
        !isRecord(detail) ||
        (detail['key'] !== 'CurrentDungeon' && detail['key'] !== 'AllDungeonsCompleted')
      ) {
        continue
      }
      for (const value of asArray(detail['valueInt32'])) {
        const id = asNumber(value)
        if (id > 0) {
          ids.add(id)
        }
      }
    }
  }
  return Array.from(ids)
}

export function dungeonViews(
  annotations: Iterable<ProtoObject>,
  cardMeta: ReadonlyMap<number, CardMeta>,
): Map<number, DungeonView> {
  const result = new Map<number, DungeonView>()
  for (const annotation of annotations) {
    if (!annotationHasType(annotation, 86, 'DungeonStatus')) {
      continue
    }
    const seat = asNumber(annotation['affectorId'])
    if (seat <= 0) {
      continue
    }
    const details = new Map(
      asArray(annotation['details'])
        .filter(isRecord)
        .map((detail) => [detail['key'], detail]),
    )
    const value = (key: string) => asNumber(asArray(details.get(key)?.['valueInt32'])[0])
    const dungeonId = value('CurrentDungeon')
    const roomId = value('CurrentRoom')
    const completedIds = asArray(details.get('AllDungeonsCompleted')?.['valueInt32'])
      .map(asNumber)
      .filter((id) => id > 0)
    result.set(seat, {
      instanceId: value('CurrentDungeonZCID') || null,
      grpId: dungeonId || null,
      name: dungeonId > 0 ? (cardMeta.get(dungeonId)?.name ?? `Dungeon ${dungeonId}`) : null,
      imageUrl: dungeonId > 0 ? (cardMeta.get(dungeonId)?.imageUrl ?? null) : null,
      rulesText: dungeonId > 0 ? (cardMeta.get(dungeonId)?.rulesText ?? null) : null,
      room: roomId > 0 ? (dungeonRoomName(roomId, cardMeta) ?? `Room ${roomId}`) : null,
      completed: completedIds.map((id) => cardMeta.get(id)?.name ?? `Dungeon ${id}`),
    })
  }
  return result
}

export function dungeonCardView(dungeon: DungeonView | null, seatId: number): CardView | null {
  if (!dungeon?.name) {
    return null
  }
  return {
    instanceId: dungeon.instanceId ?? 0,
    grpId: dungeon.grpId ?? 0,
    name: dungeon.name,
    typeLine: 'Dungeon',
    manaCost: '',
    powerToughness: '',
    imageUrl: dungeon.imageUrl ?? '',
    rulesText: dungeon.rulesText ?? '',
    controllerSeatId: seatId,
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
  }
}
