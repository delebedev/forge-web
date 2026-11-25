import { isRecord, type CardMeta } from '@engine/state/gre-state'

/** Default for sources that carry no catalog, such as replays without embedded card metadata. */
export async function noCardMeta(
  _grpIds: number[],
  _authToken?: string,
): Promise<Map<number, CardMeta>> {
  return new Map()
}

export function parseGreCardMeta(data: unknown): Map<number, CardMeta> {
  if (!isRecord(data)) {
    return new Map()
  }
  const cards = new Map<number, CardMeta>()
  for (const [key, value] of Object.entries(data)) {
    if (!isRecord(value)) {
      continue
    }
    const grpId = Number(key)
    cards.set(grpId, {
      grpId,
      name: typeof value['name'] === 'string' ? value['name'] : null,
      setCode: typeof value['setCode'] === 'string' ? value['setCode'] : null,
      rarity: typeof value['rarity'] === 'string' ? value['rarity'] : null,
      manaCost: typeof value['manaCost'] === 'string' ? value['manaCost'] : null,
      power: typeof value['power'] === 'string' ? value['power'] : null,
      toughness: typeof value['toughness'] === 'string' ? value['toughness'] : null,
      loyalty: typeof value['loyalty'] === 'string' ? value['loyalty'] : null,
      defense: typeof value['defense'] === 'string' ? value['defense'] : null,
      faceLayout: typeof value['faceLayout'] === 'string' ? value['faceLayout'] : null,
      types: typeof value['types'] === 'string' ? value['types'] : null,
      subtypes: typeof value['subtypes'] === 'string' ? value['subtypes'] : null,
      rulesText: typeof value['rulesText'] === 'string' ? value['rulesText'] : null,
      imageUrl: typeof value['imageUrl'] === 'string' ? value['imageUrl'] : null,
      keywords: Array.isArray(value['keywords'])
        ? value['keywords'].filter((k): k is string => typeof k === 'string')
        : [],
      mechanicHelp: parseMechanicHelp(value['mechanicHelp']),
      abilities: parseAbilities(value['abilities']),
      linkedFaceGrpIds: Array.isArray(value['linkedFaceGrpIds'])
        ? value['linkedFaceGrpIds'].filter((id): id is number => Number.isInteger(id) && id > 0)
        : [],
    })
  }
  return cards
}

function parseMechanicHelp(value: unknown): NonNullable<CardMeta['mechanicHelp']> {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate['keyword'] !== 'string' ||
      typeof candidate['title'] !== 'string' ||
      typeof candidate['description'] !== 'string'
    ) {
      return []
    }
    return [
      {
        keyword: candidate['keyword'],
        title: candidate['title'],
        description: candidate['description'],
        cost: typeof candidate['cost'] === 'string' ? candidate['cost'] : null,
      },
    ]
  })
}

function parseAbilities(value: unknown): CardMeta['abilities'] {
  if (!isRecord(value)) {
    return {}
  }
  const abilities: NonNullable<CardMeta['abilities']> = {}
  for (const [key, candidate] of Object.entries(value)) {
    const abilityGrpId = Number(key)
    if (
      !Number.isInteger(abilityGrpId) ||
      !isRecord(candidate) ||
      typeof candidate['text'] !== 'string'
    ) {
      continue
    }
    abilities[abilityGrpId] = {
      text: candidate['text'],
      manaCost: typeof candidate['manaCost'] === 'string' ? candidate['manaCost'] : null,
      ...(typeof candidate['keyword'] === 'string' ? { keyword: candidate['keyword'] } : {}),
    }
  }
  return abilities
}
