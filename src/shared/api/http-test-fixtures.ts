import type { components } from './types'

type Card = components['schemas']['GreCardMetaDto']

/** Synthetic HTTP output with the production codec's emitted defaults. */
export function httpCardMeta(grpId: number, fields: Partial<Card> = {}): Card {
  return {
    grpId,
    name: null,
    setCode: null,
    rarity: null,
    titleId: null,
    manaCost: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    faceLayout: null,
    types: null,
    subtypes: null,
    rulesText: null,
    imageUrl: null,
    keywords: [],
    mechanicHelp: [],
    linkedFaceGrpIds: [],
    abilities: {},
    ...fields,
  }
}
