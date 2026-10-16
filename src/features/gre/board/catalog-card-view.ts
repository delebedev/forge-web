import type { CardView } from '@engine/state/gre-state'
import type { DraftCard } from '@shared/api/contracts'
import { scryfallUrl } from '@shared/cards/scryfall'

export type CatalogCard = Pick<DraftCard, 'name'> & Partial<DraftCard>

/** Catalog inspection has no match object or legal actions. */
export function catalogCardView(card: CatalogCard, index = 0): CardView {
  return {
    instanceId: index + 1,
    grpId: card.grpId ?? index + 1,
    name: card.name,
    setCode: card.setCode ?? undefined,
    rarity: card.rarity ?? undefined,
    typeLine: card.typeLine ?? '',
    manaCost: card.manaCost ?? '',
    powerToughness:
      card.power != null && card.toughness != null ? `${card.power}/${card.toughness}` : '',
    rulesText: card.rulesText ?? '',
    loyalty: card.loyalty ?? undefined,
    defense: card.defense ?? undefined,
    faceLayout: card.faceLayout ?? undefined,
    linkedFaces: card.linkedFaces?.map((face) => ({
      grpId: face.grpId,
      name: face.name ?? 'Card face',
      typeLine: [face.types, face.subtypes].filter(Boolean).join(' — '),
      manaCost: face.manaCost ?? '',
      rulesText: face.rulesText ?? '',
      powerToughness:
        face.power != null && face.toughness != null ? `${face.power}/${face.toughness}` : '',
      loyalty: face.loyalty ?? undefined,
      defense: face.defense ?? undefined,
      imageUrl: face.imageUrl ?? '',
    })),
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
    imageUrl: scryfallUrl(card),
    controllerSeatId: 0,
  }
}
