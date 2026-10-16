import { enumName } from '@engine/wire/gre-proto'
import {
  annotationHasType,
  asArray,
  asNumber,
  isRecord,
  type CardCounter,
  type CardMeta,
  type CardView,
  type MechanicHelp,
  type ProtoObject,
} from './gre-state'

const GRANTED_KEYWORDS = new Map([
  [2, 'Hexproof'],
  [4, 'Double strike'],
  [5, 'Deathtouch'],
  [6, 'First strike'],
  [7, 'Haste'],
  [8, 'Flying'],
  [11, 'Indestructible'],
  [12, 'Lifelink'],
  [13, 'Reach'],
  [14, 'Trample'],
  [15, 'Vigilance'],
  [142, 'Menace'],
])

/** Current persistent rows describe totals and relationships, never event deltas. */
export function permanentState(
  annotations: Iterable<ProtoObject>,
  cardMeta: ReadonlyMap<number, CardMeta>,
): (card: CardView) => CardView {
  const persistent = [...annotations]
  const keywordNames = new Map(GRANTED_KEYWORDS)
  const keywordHelp = new Map<string, MechanicHelp>()
  for (const meta of cardMeta.values()) {
    for (const [id, ability] of Object.entries(meta.abilities ?? {})) {
      if (!ability.keyword) {
        continue
      }
      keywordNames.set(Number(id), ability.keyword)
      keywordHelp.set(ability.keyword, {
        keyword: ability.keyword,
        title: ability.keyword,
        description: ability.text,
      })
    }
  }
  const attachments = new Map<number, number>()
  const counters = counterTotals(persistent)
  const keywords = new Map<number, Set<string>>()
  const classLevels = new Map<number, number>()
  const solved = new Set<number>()
  const unlockedRoomDoors = new Map<number, Set<number>>()
  for (const annotation of persistent) {
    const affected = asArray(annotation['affectedIds'])
      .map(asNumber)
      .filter((id) => id > 0)
    if (annotationHasType(annotation, 20, 'Attachment')) {
      const source = asNumber(annotation['affectorId'])
      if (source > 0 && affected[0] && source !== affected[0]) {
        attachments.set(source, affected[0])
      }
    }
    if (annotationHasType(annotation, 45, 'Designation')) {
      const designation = asArray(annotation['details'])
        .filter(isRecord)
        .find((detail) => detail['key'] === 'DesignationType')
      const doorIndex = asNumber(asArray(designation?.['valueInt32'])[0]) - 19
      const designationType = asNumber(asArray(designation?.['valueInt32'])[0])
      if (designationType === 15) {
        affected.forEach((id) => solved.add(id))
      }
      if (doorIndex === 0 || doorIndex === 1) {
        for (const id of affected) {
          const doors = unlockedRoomDoors.get(id) ?? new Set<number>()
          doors.add(doorIndex)
          unlockedRoomDoors.set(id, doors)
        }
      }
    }
    if (annotationHasType(annotation, 88, 'ClassLevel')) {
      const level = asArray(annotation['details'])
        .filter(isRecord)
        .find((detail) => detail['key'] === 'Level')
      const value = asNumber(asArray(level?.['valueInt32'])[0])
      if (value > 0) {
        affected.forEach((id) => classLevels.set(id, value))
      }
    }
    if (annotationHasType(annotation, 9, 'AddAbility')) {
      const granted = asArray(annotation['details'])
        .filter(isRecord)
        .filter((detail) => detail['key'] === 'grpid')
        .flatMap((detail) => [...asArray(detail['valueInt32']), ...asArray(detail['valueUint32'])])
        .map(asNumber)
        .map((id) => keywordNames.get(id))
        .filter((name) => name != null)
      for (const id of affected) {
        const names = keywords.get(id) ?? new Set<string>()
        granted.forEach((name) => names.add(name))
        keywords.set(id, names)
      }
    }
  }
  return (card) => ({
    ...card,
    attachedTo: attachments.get(card.instanceId),
    counters: counters.get(card.instanceId) ?? [],
    keywords: [...new Set([...(card.keywords ?? []), ...(keywords.get(card.instanceId) ?? [])])],
    grantedKeywords: [...(keywords.get(card.instanceId) ?? [])],
    mechanicHelp: [
      ...(card.mechanicHelp ?? []),
      ...[...(keywords.get(card.instanceId) ?? [])]
        .filter((name) => !card.mechanicHelp?.some((item) => item.keyword === name))
        .flatMap((name) => keywordHelp.get(name) ?? []),
    ],
    classLevel: classLevels.get(card.instanceId),
    solved: solved.has(card.instanceId),
    roomDoors: card.roomDoors?.map((door, index) => ({
      ...door,
      unlocked: unlockedRoomDoors.get(card.instanceId)?.has(index) === true,
    })),
  })
}

export function counterTotals(annotations: Iterable<ProtoObject>): Map<number, CardCounter[]> {
  const counters = new Map<number, Map<number, CardCounter>>()
  for (const annotation of annotations) {
    if (!annotationHasType(annotation, 14, 'Counter')) {
      continue
    }
    const details = new Map(
      asArray(annotation['details'])
        .filter(isRecord)
        .map((detail) => [detail['key'], asNumber(asArray(detail['valueInt32'])[0])]),
    )
    const type = details.get('counter_type') ?? 0
    const count = details.get('count') ?? 0
    if (type <= 0) {
      continue
    }
    for (const id of asArray(annotation['affectedIds'])
      .map(asNumber)
      .filter((id) => id > 0)) {
      const rows = counters.get(id) ?? new Map<number, CardCounter>()
      if (count > 0) {
        rows.set(type, { type, name: counterName(type), count })
      } else {
        rows.delete(type)
      }
      counters.set(id, rows)
    }
  }
  return new Map(
    [...counters].map(([id, rows]) => [id, [...rows.values()].sort((a, b) => a.type - b.type)]),
  )
}

function counterName(type: number): string {
  const name = enumName('CounterType', type)?.replace(/_[a-f0-9]+$/, '')
  if (!name) {
    return `Counter ${type}`
  }
  if (/^[PM]\d[PM]\d$/.test(name)) {
    return name
      .replace(/P/g, '+')
      .replace(/M/g, '-')
      .replace(/^([+-]\d)/, '$1/')
  }
  return name.replace(/([a-z])([A-Z])/g, '$1 $2')
}
